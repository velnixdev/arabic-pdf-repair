import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFHexString, PDFName, beginText, endText, moveText, setFontAndSize, showText } from "pdf-lib";

export const SENTENCE = "بطاقة كتاب نحو";

const FONT_URL = new URL("./fixtures/NotoNaskhArabic-Regular.ttf", import.meta.url);

/** The bundled font (SIL OFL, see fixtures/OFL.txt). Reading it throws when
 * it is missing, so the tests fail instead of skipping. */
export function loadFont(): Uint8Array {
  return new Uint8Array(readFileSync(FONT_URL));
}

/** The font with its cmap table replaced: the directory is rewritten, the
 * other tables copied as they are. */
export function swapCmap(font: Uint8Array, cmap: Uint8Array): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  const tables: Array<{ tag: string; data: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(rec, rec + 4));
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    tables.push({ tag, data: tag === "cmap" ? cmap : font.subarray(offset, offset + length) });
  }
  if (!tables.some((t) => t.tag === "cmap")) tables.push({ tag: "cmap", data: cmap });
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const dirEnd = 12 + tables.length * 16;
  let size = dirEnd;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(font.subarray(0, 4));
  dv.setUint16(4, tables.length);
  let power = 0;
  while (2 ** (power + 1) <= tables.length) power++;
  dv.setUint16(6, 2 ** power * 16);
  dv.setUint16(8, power);
  dv.setUint16(10, tables.length * 16 - 2 ** power * 16);
  let at = dirEnd;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    const padded = new Uint8Array((t.data.length + 3) & ~3);
    padded.set(t.data);
    const pv = new DataView(padded.buffer);
    let sum = 0;
    for (let k = 0; k < padded.length; k += 4) sum = (sum + pv.getUint32(k)) >>> 0;
    dv.setUint32(rec + 4, sum);
    dv.setUint32(rec + 8, at);
    dv.setUint32(rec + 12, t.data.length);
    out.set(padded, at);
    at += padded.length;
  });
  return out;
}

export interface FontkitFont {
  unitsPerEm: number;
  glyphForCodePoint(cp: number): { id: number; advanceWidth: number };
}

/** A PDF as PDFCreator/Ghostscript wrote Arabic: a one-byte TrueType font
 * whose codes are named in /Differences (Microsoft's afii62xxx names for the
 * joining forms, Monotype's for one word), a Macintosh cmap from code to
 * glyph, and a ToUnicode that names only what the producer could translate
 * -- the space, and the initial kaf as the alef with madda its name says. */
export async function legacyFixture(): Promise<Uint8Array> {
  return (await legacyDocument()).save({ useObjectStreams: false });
}

/** The bundled font, read by fontkit. */
export function fontkitFont(face: Uint8Array): FontkitFont {
  return (fontkit as unknown as { create(bytes: Uint8Array): FontkitFont }).create(face);
}

/** A Macintosh (1,0) format 6 cmap from `first`, one glyph per code. */
export function macCmap(first: number, gids: number[]): Uint8Array {
  const cmap = new Uint8Array(12 + 10 + 2 * gids.length);
  const view = new DataView(cmap.buffer);
  view.setUint16(2, 1); // one subtable
  view.setUint16(4, 1); // platform: Macintosh
  view.setUint32(8, 12);
  view.setUint16(12, 6); // format 6
  view.setUint16(14, 10 + 2 * gids.length);
  view.setUint16(18, first);
  view.setUint16(20, gids.length);
  gids.forEach((gid, k) => view.setUint16(22 + 2 * k, gid));
  return cmap;
}

/** The legacy fixture as a document, before saving. */
export async function legacyDocument(): Promise<PDFDocument> {
  const face = loadFont();
  const font = fontkitFont(face);
  // code -> [glyph name in the PDF, the form the glyph draws]
  const glyphs: Array<[string, string]> = [
    ["afii62761", "ﺑ"], ["afii62797", "ﻄ"], ["afii62760", "ﺎ"], ["afii62811", "ﻗ"], ["afii62764", "ﺔ"], // بطاقة
    ["space", " "],
    ["innoon", "ﻧ"], ["inhaa", "ﺤ"], ["waw", "ﻮ"], // نحو
    ["afii57410", "ﻛ"], ["afii62766", "ﺘ"], ["afii57416", "ﺏ"], // ك ت (ا) ب
  ];
  const glyphFor = glyphs.map(([, form]) => font.glyphForCodePoint(form.codePointAt(0)!));
  const gids = glyphFor.map((g) => g.id);
  if (gids.some((gid) => gid === 0)) throw new Error("The bundled font lacks a presentation form the fixture needs.");
  // A Macintosh cmap: codes 1..n in order.
  const program = swapCmap(face, macCmap(1, gids));

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const context = doc.context;
  const toUnicode = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapType 2 def 1 begincodespacerange <00><ff> endcodespacerange 2 beginbfrange <06><06><0020> <0a><0a><0622> endbfrange endcmap end end";
  const widths = glyphFor.map((g) => Math.round((g.advanceWidth * 1000) / font.unitsPerEm));
  const descriptor = context.register(context.obj({
    Type: "FontDescriptor", FontName: "ABCDEF+LegacyArabic", Flags: 4, FontBBox: [-500, -300, 1500, 1000], ItalicAngle: 0, Ascent: 900, Descent: -250, CapHeight: 700, StemV: 80,
    FontFile2: context.register(context.flateStream(program, { Length1: program.length })),
  }));
  const fontRef = context.register(context.obj({
    Type: "Font", Subtype: "TrueType", BaseFont: "ABCDEF+LegacyArabic", FirstChar: 1, LastChar: gids.length, Widths: widths, FontDescriptor: descriptor,
    Encoding: context.obj({ Type: "Encoding", BaseEncoding: "WinAnsiEncoding", Differences: [1, ...glyphs.map(([name]) => PDFName.of(name))] }),
    ToUnicode: context.register(context.flateStream(toUnicode)),
  }));
  const key = page.node.newFontDictionary("LegacyArabic", fontRef);
  // The line in drawing order: its codes, last letter leftmost.
  const logical = [1, 2, 3, 4, 5, 6, 10, 11, 3, 12, 6, 7, 8, 9];
  const hex = [...logical].reverse().map((code) => code.toString(16).padStart(2, "0")).join("");
  page.pushOperators(beginText(), setFontAndSize(key, 18), moveText(300, 700), showText(PDFHexString.of(hex)), endText());
  return doc;
}
