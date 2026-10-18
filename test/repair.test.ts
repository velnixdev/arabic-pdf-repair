import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { arabicGlyphName, repairTextLayer } from "../src/index.js";
import { SENTENCE, legacyFixture, loadFont } from "./helpers.js";

/** The page's text as a reader (pdf.js) extracts it. */
async function extract(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  await doc.destroy();
  return content.items.map((item) => ("str" in item ? item.str : "")).join("").replace(/\s+/g, " ").trim();
}

describe("Arabic glyph names", () => {
  it.each([
    // Microsoft's legacy names for joining forms.
    ["afii62761", "ب"], ["afii62797", "ط"], ["afii62760", "ا"], ["afii62811", "ق"], ["afii62764", "ة"],
    ["afii62833", "ي"], ["afii62829", "و"], ["afii62840", "لا"], ["afii62836", "لأ"], ["afii62757", "ئ"],
    // Adobe's glyph list: letters, tatweel, digits.
    ["afii57415", "ا"], ["afii57444", "ل"], ["afii57440", "ـ"], ["afii57450", "ي"], ["afii57393", "١"],
    // Monotype's: the joining form as a prefix.
    ["inhaa", "ح"], ["midsad", "ص"], ["fnhamzahonalef", "أ"], ["fntaamarbutah", "ة"], ["hamzahonlamelef", "لأ"],
    ["fnalefmaqsurah", "ى"], ["incaf", "ك"], ["tatweelnarrow", "ـ"], ["righttoleftspace", " "],
    // Unicode-style names, and forms named in words.
    ["uniFE91", "ب"], ["uni0628", "ب"], ["behmedial", "ب"], ["yehfinal", "ي"], ["alefwithhamzaaboveisolated", "أ"],
  ])("%s draws %s", (name, text) => {
    expect(arabicGlyphName(name)?.text).toBe(text);
  });

  it("leaves other scripts' names alone, and is unsure of names they share", () => {
    for (const name of ["A", "space", "Igrave", "hyphen", "uni0041", "afii10017", "one", "minus"]) expect(arabicGlyphName(name)).toBeNull();
    // "alef" is a Hebrew letter's name too: Arabic only in an Arabic font.
    expect(arabicGlyphName("alef")).toEqual({ text: "ا", certain: false });
    expect(arabicGlyphName("ra")).toEqual({ text: "ر", certain: false });
    expect(arabicGlyphName("inhaa")?.certain).toBe(true);
  });
});

describe("text layer repair", () => {
  it("bundles its test font", () => {
    expect(loadFont().length).toBeGreaterThan(10_000);
  });

  it("gives a legacy Arabic font's codes their letters, so the line reads as the page shows it", async () => {
    const bytes = await legacyFixture();
    expect(await extract(bytes)).not.toContain("بطاقة");
    const repaired = await repairTextLayer(bytes);
    expect(repaired?.fonts).toEqual([{ name: "LegacyArabic", codes: 11 }]);
    // The initial kaf (named "afii57410", the glyph list's alef with madda)
    // reads as the kaf its shape is.
    expect(await extract(repaired!.bytes)).toBe(SENTENCE);
    // Nothing left to do the second time.
    expect(await repairTextLayer(repaired!.bytes)).toBeNull();
  });

  it("leaves a document without such fonts alone", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText("Invoice total");
    expect(await repairTextLayer(await doc.save())).toBeNull();
  });
});
