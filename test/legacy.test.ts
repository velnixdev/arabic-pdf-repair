import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, beginText, decodePDFRawStream, endText, moveText, setFontAndSize, showText } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { CODE_PAGES, chooseCodePage, codePageChar, type CodePage } from "../src/codePages.js";
import { repairTextLayer } from "../src/index.js";
import { readToUnicode } from "../src/toUnicode.js";
import { fontkitFont, loadFont, macCmap, swapCmap } from "./helpers.js";

const SENTENCE = "بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين";
const page = (name: string): CodePage => CODE_PAGES.find((entry) => entry.name === name)!;
const reversed = (bytes: Uint8Array) => Uint8Array.from([...bytes].reverse());
const latin = (text: string) => Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));

/** The bytes of `text` in a code page: its Arabic letters by the table, ASCII as it is. */
function encode(text: string, codePage: CodePage): Uint8Array {
  const byChar = new Map<string, number>();
  for (let code = 0x80; code <= 0xff; code++) {
    const ch = codePageChar(codePage, code);
    if (ch && !byChar.has(ch)) byChar.set(ch, code);
  }
  return Uint8Array.from([...text].map((ch) => byChar.get(ch) ?? ch.charCodeAt(0)));
}

/** The /ToUnicode entries of every font that has one. */
async function toUnicodes(bytes: Uint8Array): Promise<Map<number, string>[]> {
  const doc = await PDFDocument.load(bytes);
  const out: Map<number, string>[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of("Type"))?.toString() !== "/Font") continue;
    const stream = doc.context.lookup(object.get(PDFName.of("ToUnicode")));
    if (stream instanceof PDFRawStream) out.push(readToUnicode(Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")));
  }
  return out;
}

/** A one-byte TrueType font whose codes are `codePage`'s while the page says
 * WinAnsi: a Macintosh cmap sends each code to the Arabic letter's glyph, and
 * there is no /ToUnicode. Built in code from the bundled font. */
async function slotFixture(codePage: CodePage, drawn: Uint8Array): Promise<Uint8Array> {
  const face = loadFont();
  const font = fontkitFont(face);
  const first = 0x20;
  const glyphs = [];
  for (let code = first; code <= 0xff; code++) {
    const ch = codePageChar(codePage, code) ?? (code < 0x80 ? String.fromCharCode(code) : "\u0000");
    glyphs.push(font.glyphForCodePoint(ch.codePointAt(0)!));
  }
  const program = swapCmap(face, macCmap(first, glyphs.map((glyph) => glyph.id)));
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([595, 842]);
  const context = doc.context;
  const widths = glyphs.map((glyph) => Math.round((glyph.advanceWidth * 1000) / font.unitsPerEm));
  const descriptor = context.register(context.obj({
    Type: "FontDescriptor", FontName: "ABCDEF+SlotArabic", Flags: 4, FontBBox: [-500, -300, 1500, 1000], ItalicAngle: 0, Ascent: 900, Descent: -250, CapHeight: 700, StemV: 80,
    FontFile2: context.register(context.flateStream(program, { Length1: program.length })),
  }));
  const fontRef = context.register(context.obj({
    Type: "Font", Subtype: "TrueType", BaseFont: "ABCDEF+SlotArabic", FirstChar: first, LastChar: 0xff, Widths: widths, FontDescriptor: descriptor, Encoding: "WinAnsiEncoding",
  }));
  const key = sheet.node.newFontDictionary("SlotArabic", fontRef);
  sheet.pushOperators(beginText(), setFontAndSize(key, 14), moveText(40, 700), showText(PDFHexString.of([...drawn].map((byte) => byte.toString(16).padStart(2, "0")).join(""))), endText());
  return doc.save({ useObjectStreams: false });
}

describe("legacy Arabic code pages", () => {
  it("tells Arabic in a code page from Latin text with accents, and reads either direction", () => {
    for (const name of ["windows-1256", "iso-8859-6"]) {
      const bytes = encode(SENTENCE, page(name));
      expect(chooseCodePage([bytes])?.page.name).toBe(name);
      expect(chooseCodePage([reversed(bytes)])?.page.name).toBe(name); // visual order
    }
    expect(chooseCodePage([latin("Les étudiants ont déjà reçu à l'école leurs diplômes, très élevés, après une année écoulée. Ça va être là-bas, où il a été reçu. ".repeat(3))])).toBeNull();
    expect(chooseCodePage([latin("plain ASCII text only")])).toBeNull();
    expect(chooseCodePage([encode("الحمد لله", page("windows-1256"))])).toBeNull(); // too little to be sure
    const scrambled = [...encode(SENTENCE.replace(/ /g, ""), page("windows-1256"))].sort((a, b) => ((a * 7) % 13) - ((b * 7) % 13) || a - b);
    expect(chooseCodePage([Uint8Array.from(scrambled)])).toBeNull();
  });

  it.each(["windows-1256", "iso-8859-6"])("writes a /ToUnicode for a %s-coded simple font", async (name) => {
    const bytes = await slotFixture(page(name), reversed(encode(SENTENCE, page(name))));
    expect(await toUnicodes(bytes)).toEqual([]);
    const repaired = await repairTextLayer(bytes);
    expect(repaired?.fonts.map((font) => font.name)).toEqual(["SlotArabic"]);
    const [map] = await toUnicodes(repaired!.bytes);
    expect(map!.get(encode("ل", page(name))[0]!)).toBe("ل");
    expect(map!.get(encode("ا", page(name))[0]!)).toBe("ا");
    expect(await repairTextLayer(repaired!.bytes)).toBeNull(); // nothing left to fix
  });

  it("leaves Latin text with accents in the same font alone", async () => {
    const text = latin("Les étudiants ont déjà reçu à l'école leurs diplômes, très élevés. ".repeat(2));
    expect(await repairTextLayer(await slotFixture(page("windows-1256"), text))).toBeNull();
    expect(await repairTextLayer(await slotFixture(page("windows-1256"), latin("Invoice total")))).toBeNull();
  });
});

/** A bare CFF program of `labels.length + 1` glyphs (.notdef first), each just
 * an endchar: named glyphs ("g62"...) or, with `cid`, a CID-keyed font. */
function cffProgram(labels: Array<string | number>, cid: boolean): Uint8Array {
  const index = (items: number[][]): number[] => {
    if (!items.length) return [0, 0];
    const offsets = [1];
    for (const item of items) offsets.push(offsets[offsets.length - 1]! + item.length);
    return [items.length >> 8, items.length & 255, 2, ...offsets.flatMap((o) => [o >> 8, o & 255]), ...items.flat()];
  };
  const text = (value: string) => [...value].map((ch) => ch.charCodeAt(0));
  const head = [1, 0, 4, 2];
  const names = index([text("AXtTest")]);
  const strings = index(cid ? [text("Adobe"), text("Identity")] : labels.map((label) => text(String(label))));
  const subrs = [0, 0];
  const charset = [0, ...labels.flatMap((label, k) => { const sid = cid ? Number(label) : 391 + k; return [sid >> 8, sid & 255]; })];
  const charStrings = index([[14], ...labels.map(() => [14])]);
  const int = (n: number) => [29, (n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const dictBody = (charsetAt: number, charStringsAt: number) => [...(cid ? [28, 1, 135, 28, 1, 136, 28, 0, 0, 12, 30] : []), ...int(charsetAt), 15, ...int(charStringsAt), 17];
  const topIndexLength = index([dictBody(0, 0)]).length;
  const charsetAt = head.length + names.length + topIndexLength + strings.length + subrs.length;
  const charStringsAt = charsetAt + charset.length;
  return Uint8Array.from([...head, ...names, ...index([dictBody(charsetAt, charStringsAt)]), ...strings, ...subrs, ...charset, ...charStrings]);
}

describe("CFF copies of Diwan XT fonts (glyph names and CIDs)", () => {
  const letters = new Map<string, number>();
  [..."ءآأؤإئابةتثجحخدذرزسشصضطظعغ"].forEach((ch, k) => letters.set(ch, 0x41 + k));
  [..."فقكلمنهوىي"].forEach((ch, k) => letters.set(ch, 0x61 + k));
  const glyphOf = (code: number) => (code < 0x60 ? code - 29 : code - 32); // the Manal family's glyph order
  const sentence = "المعلومات التفصيلية الوافية عن الشركة والاكتتاب في الاسهم المطروحة للبيع";
  const lines = [sentence, sentence.split(" ").reverse().join(" "), sentence, sentence.slice(8)];
  const used = [...new Set(lines.join("").replace(/ /g, ""))].map((ch) => letters.get(ch)!);

  async function fixture(kind: "type1c" | "cid", toUnicode?: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([595, 842]);
    const context = doc.context;
    const glyphs = [...used.map(glyphOf), 3];
    const program = cffProgram(kind === "cid" ? glyphs : glyphs.map((gid) => `g${gid}`), kind === "cid");
    const descriptor = context.register(context.obj({
      Type: "FontDescriptor", FontName: "ABCDEF+AXtTest", Flags: 4, FontBBox: [0, -300, 1000, 1000], ItalicAngle: 0, Ascent: 900, Descent: -250, CapHeight: 700, StemV: 80,
      FontFile3: context.register(context.flateStream(program, { Subtype: "Type1C" })),
    }));
    const extra = toUnicode ? { ToUnicode: context.register(context.flateStream(toUnicode)) } : {};
    let fontRef;
    const codeOf = (ch: string) => (ch === " " ? used.length + 1 : used.indexOf(letters.get(ch)!) + 1);
    if (kind === "type1c") {
      fontRef = context.register(context.obj({
        Type: "Font", Subtype: "Type1", BaseFont: "ABCDEF+AXtTest", FirstChar: 1, LastChar: used.length + 1, Widths: [...used.map(() => 500), 250],
        Encoding: context.obj({ Type: "Encoding", Differences: [1, ...glyphs.map((gid) => PDFName.of(`g${gid}`))] }), FontDescriptor: descriptor, ...extra,
      }));
    } else {
      const cidFont = context.register(context.obj({
        Type: "Font", Subtype: "CIDFontType0", BaseFont: "ABCDEF+AXtTest", CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
        FontDescriptor: descriptor, DW: 500,
      }));
      fontRef = context.register(context.obj({ Type: "Font", Subtype: "Type0", BaseFont: "ABCDEF+AXtTest", Encoding: "Identity-H", DescendantFonts: [cidFont], ...extra }));
    }
    const key = sheet.node.newFontDictionary("XT", fontRef);
    const show = (line: string) => [...line].reverse().map((ch) => (kind === "cid" ? (ch === " " ? 3 : glyphOf(letters.get(ch)!)).toString(16).padStart(4, "0") : codeOf(ch).toString(16).padStart(2, "0"))).join("");
    sheet.pushOperators(beginText(), setFontAndSize(key, 14), moveText(50, 780));
    for (const line of lines) sheet.pushOperators(showText(PDFHexString.of(show(line))), moveText(0, -20));
    sheet.pushOperators(endText());
    return doc.save({ useObjectStreams: false });
  }

  it("reads a Type 1C copy whose glyphs are called g<number>, by the family's glyph order", async () => {
    const repaired = await repairTextLayer(await fixture("type1c"));
    expect(repaired?.fonts[0]?.name).toBe("AXtTest");
    const [map] = await toUnicodes(repaired!.bytes);
    expect(map!.get(used.indexOf(letters.get("ل")!) + 1)).toBe("ل");
    expect(map!.get(used.indexOf(letters.get("ا")!) + 1)).toBe("ا");
  });

  it("fills only the missing codes of a CID-keyed CFF copy, keeping the entries it has", async () => {
    const lam = glyphOf(letters.get("ل")!);
    const alef = glyphOf(letters.get("ا")!);
    const hex = (n: number) => n.toString(16).padStart(4, "0");
    const partial = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <ffff> endcodespacerange 2 beginbfchar <${hex(alef)}> <05D0> <${hex(lam)}> <0644> endbfchar endcmap end end`;
    const repaired = await repairTextLayer(await fixture("cid", partial));
    expect(repaired).not.toBeNull();
    const [map] = await toUnicodes(repaired!.bytes);
    expect(map!.get(alef)).toBe("א"); // the producer's own entry stays
    expect(map!.get(lam)).toBe("ل");
    expect(map!.get(glyphOf(letters.get("م")!))).toBe("م"); // a missing code is filled
  });

  it("writes nothing when the strings don't spell Arabic by the order", async () => {
    const doc = await PDFDocument.load(await fixture("type1c"));
    doc.getPages()[0]!.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("")));
    expect(await repairTextLayer(await doc.save({ useObjectStreams: false }))).toBeNull();
  });
});
