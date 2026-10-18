// Writes examples/certificate.pdf: a one-page Arabic certificate with a broken
// text layer, the way a Windows writer left it. Its letters are one-byte
// TrueType glyphs named by Microsoft's glyph names (afii62753 onward for the
// joining forms, afii57409 onward for the isolated letters), with no
// ToUnicode: a reader only knows the names, so copying gives the wrong text.
// Each letter is drawn in its joined form; lam-alef ligatures are not used.
//
// Run from the repository root (Node 24 strips the types; no build step):
//   node scripts/make-example.ts
// Then repair it with the real CLI:
//   node dist/cli.js examples/certificate.pdf examples/certificate.repaired.pdf
//
// Everything in the document is fictional. The font is the bundled Noto Naskh
// Arabic (SIL OFL), the same one the tests use.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument, PDFHexString, PDFName, beginText, endText, moveText, rgb, setFontAndSize, showText } from "pdf-lib";
import { fontkitFont, loadFont, macCmap, swapCmap } from "../test/helpers.ts";

/** One line of the certificate, as a person would read it (logical order). */
export interface Line {
  text: string;
  size: number;
  y: number;
  align: "center" | "left" | "right";
  /** For "center": the x of the centre (default: the page's centre). */
  cx?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 60;
const SIGN_LEFT = 145; // centre of the signer's block
const SIGN_RIGHT = 450; // centre of the date block

/** The intended text, top to bottom. Arabic in logical (reading) order. */
export const LINES: Line[] = [
  { text: "شهادة إتمام دورة", size: 28, y: 652, align: "center" },
  { text: "مركز ريادة للتدريب المهني", size: 13, y: 620, align: "center" },
  { text: "تشهد إدارة المركز بأن", size: 15, y: 566, align: "center" },
  { text: "سارة يوسف المنصوري", size: 26, y: 522, align: "center" },
  { text: "قد أتمت بنجاح دورة", size: 15, y: 480, align: "center" },
  { text: "أساسيات تحرير المستندات الرقمية", size: 20, y: 440, align: "center" },
  { text: "بواقع اثنتين وعشرين ساعة تدريبية،", size: 15, y: 396, align: "center" },
  { text: "وذلك في الفترة من 3 مارس إلى 21 مارس 2026.", size: 15, y: 370, align: "center" },
  { text: "ونقدر التزامها وحرصها على التعلم المستمر.", size: 15, y: 330, align: "center" },
  { text: "21 مارس 2026", size: 11, y: 188, align: "center", cx: SIGN_RIGHT },
  { text: "تاريخ الإصدار", size: 10, y: 172, align: "center", cx: SIGN_RIGHT },
  { text: "كريم عادل النجار", size: 11, y: 188, align: "center", cx: SIGN_LEFT },
  { text: "المدير التنفيذي", size: 10, y: 172, align: "center", cx: SIGN_LEFT },
  { text: "رقم الشهادة 0412", size: 9, y: 96, align: "center" },
];

const ARABIC_RUN = /[\p{Script=Arabic}ً-ٰٟ]/u;
const TOKEN = /[0-9]+|[\p{Script=Arabic}ً-ٰٟ]+|[^0-9\p{Script=Arabic}ً-ٰٟ]+/gu;

// Joining. A letter in DUAL joins on both sides; one in RIGHT only to the
// letter before it (in logical order), so the letter after it starts afresh.
const DUAL = new Set("ئبتثجحخسشصضطظعغفقكلمنهي");
const RIGHT = new Set("آأؤإاةدذرزوى");

/** Presentation forms by letter: isolated, initial, medial, final (0: none). */
const FORMS: Record<string, [number, number, number, number]> = {
  "ء": [0xfe80, 0, 0, 0],
  "آ": [0xfe81, 0, 0, 0xfe82], "أ": [0xfe83, 0, 0, 0xfe84], "ؤ": [0xfe85, 0, 0, 0xfe86], "إ": [0xfe87, 0, 0, 0xfe88],
  "ئ": [0xfe89, 0xfe8b, 0xfe8c, 0xfe8a], "ا": [0xfe8d, 0, 0, 0xfe8e], "ب": [0xfe8f, 0xfe91, 0xfe92, 0xfe90],
  "ة": [0xfe93, 0, 0, 0xfe94], "ت": [0xfe95, 0xfe97, 0xfe98, 0xfe96], "ث": [0xfe99, 0xfe9b, 0xfe9c, 0xfe9a],
  "ج": [0xfe9d, 0xfe9f, 0xfea0, 0xfe9e], "ح": [0xfea1, 0xfea3, 0xfea4, 0xfea2], "خ": [0xfea5, 0xfea7, 0xfea8, 0xfea6],
  "د": [0xfea9, 0, 0, 0xfeaa], "ذ": [0xfeab, 0, 0, 0xfeac], "ر": [0xfead, 0, 0, 0xfeae], "ز": [0xfeaf, 0, 0, 0xfeb0],
  "س": [0xfeb1, 0xfeb3, 0xfeb4, 0xfeb2], "ش": [0xfeb5, 0xfeb7, 0xfeb8, 0xfeb6], "ص": [0xfeb9, 0xfebb, 0xfebc, 0xfeba],
  "ض": [0xfebd, 0xfebf, 0xfec0, 0xfebe], "ط": [0xfec1, 0xfec3, 0xfec4, 0xfec2], "ظ": [0xfec5, 0xfec7, 0xfec8, 0xfec6],
  "ع": [0xfec9, 0xfecb, 0xfecc, 0xfeca], "غ": [0xfecd, 0xfecf, 0xfed0, 0xfece], "ف": [0xfed1, 0xfed3, 0xfed4, 0xfed2],
  "ق": [0xfed5, 0xfed7, 0xfed8, 0xfed6], "ك": [0xfed9, 0xfedb, 0xfedc, 0xfeda], "ل": [0xfedd, 0xfedf, 0xfee0, 0xfede],
  "م": [0xfee1, 0xfee3, 0xfee4, 0xfee2], "ن": [0xfee5, 0xfee7, 0xfee8, 0xfee6], "ه": [0xfee9, 0xfeeb, 0xfeec, 0xfeea],
  "و": [0xfeed, 0, 0, 0xfeee], "ى": [0xfeef, 0, 0, 0xfef0], "ي": [0xfef1, 0xfef3, 0xfef4, 0xfef2],
};

/** Microsoft's order of the joining forms and ligatures, named afii62753 on
 * (the order glyphNames.ts reads). */
const FORM_ORDER = [
  0xfe82, 0xfe84, 0xfe86, 0xfe88, 0xfe8b, 0xfe8c, 0xfe8a, 0xfe8e, 0xfe91, 0xfe92, 0xfe90, 0xfe94, 0xfe97, 0xfe98, 0xfe96, 0xfe9b, 0xfe9c, 0xfe9a, 0xfe9f, 0xfea0, 0xfe9e, 0xfea3, 0xfea4, 0xfea2, 0xfea7, 0xfea8, 0xfea6, 0xfeaa, 0xfeac, 0xfeae, 0xfeb0, 0xfeb3, 0xfeb4, 0xfeb2, 0xfeb7, 0xfeb8, 0xfeb6, 0xfebb, 0xfebc, 0xfeba, 0xfebf, 0xfec0, 0xfebe, 0xfec3, 0xfec4, 0xfec2, 0xfec7, 0xfec8, 0xfec6, 0xfecb, 0xfecc, 0xfeca, 0xfecf, 0xfed0, 0xfece, 0xfed3, 0xfed4, 0xfed2, 0xfed7, 0xfed8, 0xfed6, 0xfedb, 0xfedc, 0xfeda, 0xfedf, 0xfee0, 0xfede, 0xfee3, 0xfee4, 0xfee2, 0xfee7, 0xfee8, 0xfee6, 0xfeeb, 0xfeec, 0xfeea, 0xfeee, 0xfef0, 0xfef3, 0xfef4, 0xfef2, 0xfef5, 0xfef6, 0xfef7, 0xfef8, 0xfef9, 0xfefa, 0xfefb, 0xfefc,
];
/** The isolated letters' names (afii57xxx). */
const ISOLATED_NAME: Record<string, number> = {
  "ء": 57409, "آ": 57410, "أ": 57411, "ؤ": 57412, "إ": 57413, "ئ": 57414, "ا": 57415, "ب": 57416, "ة": 57417, "ت": 57418, "ث": 57419, "ج": 57420, "ح": 57421, "خ": 57422,
  "د": 57423, "ذ": 57424, "ر": 57425, "ز": 57426, "س": 57427, "ش": 57428, "ص": 57429, "ض": 57430, "ط": 57431, "ظ": 57432, "ع": 57433, "غ": 57434,
  "ف": 57441, "ق": 57442, "ك": 57443, "ل": 57444, "م": 57445, "ن": 57446, "ه": 57447, "و": 57448, "ى": 57449, "ي": 57450,
};
const DIGIT_NAMES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** A glyph of the document: the name the file gives it and the Unicode
 * character its outline is (a presentation form, or a plain character). */
interface Glyph {
  name: string;
  cp: number;
}

/** The glyph of a joined or isolated letter in a form. */
function glyphOf(letter: string, form: "iso" | "init" | "medi" | "fin"): Glyph {
  const index = { iso: 0, init: 1, medi: 2, fin: 3 }[form];
  const cp = FORMS[letter]![index]!;
  if (FORM_ORDER.includes(cp)) return { cp, name: `afii${62753 + FORM_ORDER.indexOf(cp)}` };
  return { cp, name: `afii${ISOLATED_NAME[letter]}` };
}

/** The glyphs of an Arabic word, in logical order, joined. There are no
 * lam-alef ligatures: a viewer reverses a ligature's text with its line, so
 * a logical "لإ" would read "إل"; lam and alef are drawn as two joined letters. */
function shapeWord(word: string): Glyph[] {
  return [...word].map((letter, k, letters) => {
    const before = k > 0 ? letters[k - 1]! : "";
    const after = k + 1 < letters.length ? letters[k + 1]! : "";
    const joinsRight = DUAL.has(before) && (DUAL.has(letter) || RIGHT.has(letter));
    const joinsLeft = DUAL.has(letter) && (DUAL.has(after) || RIGHT.has(after));
    const form = joinsRight ? (joinsLeft ? "medi" : "fin") : joinsLeft ? "init" : "iso";
    return glyphOf(letter, form);
  });
}

/** The glyph of a digit, space, full stop or Arabic comma. */
function plainGlyph(ch: string): Glyph {
  if (/[0-9]/.test(ch)) return { cp: ch.codePointAt(0)!, name: DIGIT_NAMES[Number(ch)]! };
  if (ch === " ") return { cp: 0x20, name: "space" };
  if (ch === ".") return { cp: 0x2e, name: "period" };
  if (ch === "،") return { cp: 0x60c, name: "afii57388" };
  throw new Error(`No glyph for ${JSON.stringify(ch)}`);
}

/** The glyphs of a logical line in drawing order: the words and digit runs
 * are put in visual order (the last word leftmost), each word's letters
 * reversed, digits left to right. This is the order a Windows writer streams glyphs in. */
export function glyphsOf(logical: string): Glyph[] {
  const tokens = logical.match(TOKEN) ?? [];
  return tokens.reverse().flatMap((token) => (ARABIC_RUN.test(token) ? shapeWord(token).reverse() : [...token].map(plainGlyph)));
}

export async function buildCertificate(): Promise<Uint8Array> {
  const face = loadFont();
  const font = fontkitFont(face);
  const lines = LINES.map((line) => ({ line, glyphs: glyphsOf(line.text) }));

  // One code per glyph name, in order of first use; codes run from 1.
  const codeOf = new Map<string, number>();
  const glyphOfName = new Map<string, Glyph>();
  for (const { glyphs } of lines) {
    for (const glyph of glyphs) {
      if (codeOf.has(glyph.name)) continue;
      codeOf.set(glyph.name, codeOf.size + 1);
      glyphOfName.set(glyph.name, glyph);
    }
  }
  if (codeOf.size > 255) throw new Error(`The page needs ${codeOf.size} glyphs; one byte holds 255.`);
  const names = [...codeOf.keys()];
  const fontGlyphs = names.map((name) => font.glyphForCodePoint(glyphOfName.get(name)!.cp));
  fontGlyphs.forEach((glyph, k) => {
    if (glyph.id === 0) throw new Error(`The bundled font lacks ${names[k]} (U+${glyphOfName.get(names[k]!)!.cp.toString(16)}).`);
  });
  const program = swapCmap(face, macCmap(1, fontGlyphs.map((glyph) => glyph.id)));

  const doc = await PDFDocument.create();
  const sheet = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const context = doc.context;
  const widths = fontGlyphs.map((glyph) => Math.round((glyph.advanceWidth * 1000) / font.unitsPerEm));
  const descriptor = context.register(context.obj({
    Type: "FontDescriptor", FontName: "ABCDEF+CertArabic", Flags: 4, FontBBox: [-500, -300, 1500, 1000], ItalicAngle: 0, Ascent: 900, Descent: -250, CapHeight: 700, StemV: 80,
    FontFile2: context.register(context.flateStream(program, { Length1: program.length })),
  }));
  // No /ToUnicode: the names are all a reader has, and the joined forms' names are not letters to it.
  const fontRef = context.register(context.obj({
    Type: "Font", Subtype: "TrueType", BaseFont: "ABCDEF+CertArabic", FirstChar: 1, LastChar: names.length, Widths: widths, FontDescriptor: descriptor,
    Encoding: context.obj({ Type: "Encoding", BaseEncoding: "WinAnsiEncoding", Differences: [1, ...names.map((name) => PDFName.of(name))] }),
  }));
  const key = sheet.node.newFontDictionary("CertArabic", fontRef);

  const teal = rgb(0.11, 0.3, 0.34);
  const gold = rgb(0.72, 0.56, 0.24);
  sheet.drawRectangle({ x: 26, y: 26, width: PAGE_WIDTH - 52, height: PAGE_HEIGHT - 52, borderColor: teal, borderWidth: 1.4 });
  sheet.drawRectangle({ x: 34, y: 34, width: PAGE_WIDTH - 68, height: PAGE_HEIGHT - 68, borderColor: gold, borderWidth: 0.6 });
  sheet.drawLine({ start: { x: 200, y: 600 }, end: { x: PAGE_WIDTH - 200, y: 600 }, thickness: 0.8, color: gold });
  sheet.drawLine({ start: { x: SIGN_LEFT - 85, y: 205 }, end: { x: SIGN_LEFT + 85, y: 205 }, thickness: 0.6, color: teal });
  sheet.drawLine({ start: { x: SIGN_RIGHT - 85, y: 205 }, end: { x: SIGN_RIGHT + 85, y: 205 }, thickness: 0.6, color: teal });

  for (const { line, glyphs } of lines) {
    const scale = line.size / font.unitsPerEm;
    const width = glyphs.reduce((sum, glyph) => sum + font.glyphForCodePoint(glyph.cp).advanceWidth * scale, 0);
    const centre = line.cx ?? PAGE_WIDTH / 2;
    const x = line.align === "center" ? centre - width / 2 : line.align === "right" ? PAGE_WIDTH - MARGIN_X - width : MARGIN_X;
    const hex = glyphs.map((glyph) => codeOf.get(glyph.name)!.toString(16).padStart(2, "0")).join("");
    sheet.pushOperators(beginText(), setFontAndSize(key, line.size), moveText(x, line.y), showText(PDFHexString.of(hex)), endText());
  }
  return doc.save({ useObjectStreams: false });
}

async function main(): Promise<void> {
  const bytes = await buildCertificate();
  const target = fileURLToPath(new URL("../examples/certificate.pdf", import.meta.url));
  writeFileSync(target, bytes);
  console.log(`wrote ${target} (${bytes.length} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
