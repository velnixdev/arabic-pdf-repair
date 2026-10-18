/** Repair of a PDF's text layer. A document printed to PDF by an older
 * Windows tool (PDFCreator, Ghostscript, Distiller...) draws Arabic with
 * one-byte fonts whose joining forms the producer couldn't name: the page
 * looks right, but copying, searching and editing meet control characters
 * (or Hebrew, where a glyph called "alef" was taken for the Hebrew letter).
 * The fonts' glyph names still say what each code draws (glyphNames.ts), so
 * a correct /ToUnicode is written for every such font, once, when the
 * document is opened -- everything downstream (PDFium's text, the editor's
 * blocks, the glyph learner, search) then reads the real text, and so does
 * any other program opening the saved file. */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import { latin1 } from "./bytes.js";
import { chooseCodePage, codePageTexts } from "./codePages.js";
import { readCffGlyphs } from "./cffNames.js";
import { fontStrings } from "./fontUsage.js";
import { arabicGlyphName } from "./glyphNames.js";
import { standardCipher, type StreamCipher } from "./pdfDecrypt.js";
import { OBJECT_STREAM, ascii, enclosingObject, indexObjects, indexOfBytes, objectText, streamedObjects } from "./rawObjects.js";
import { glyphBox, simpleTrueTypeGlyph } from "./sfnt.js";
import { readToUnicode } from "./toUnicode.js";
import { isXtFont, xtCodeOfName, xtCodeOfWinAnsi, xtCodeTexts, xtOrderTexts, xtText, type XtGlyph } from "./xtFonts.js";

export interface TextRepair {
  bytes: Uint8Array;
  /** Each font whose text layer was completed: its name, and how many of
   * its codes got their letters. */
  fonts: Array<{ name: string; codes: number }>;
}

const DIFFERENCES = ascii("/Differences");
const XT_NAME = ascii("AXt");
const TRUETYPE = ascii("/TrueType");
const isArabic = (text: string) => /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(text);

/** Whether any font names a code by an Arabic glyph name the usual glyph
 * lists don't know, or is an XT font (xtFonts.ts) -- read from the bytes,
 * without loading the document. */
function needsRepair(bytes: Uint8Array): boolean {
  if (indexOfBytes(bytes, XT_NAME, 0) >= 0) return true;
  const named = (array: string | null) => Boolean(array && [...array.matchAll(/\/([^\s/[\]<>()]+)/g)].some((match) => arabicGlyphName(match[1]!)?.certain));
  for (let at = indexOfBytes(bytes, DIFFERENCES, 0); at >= 0; at = indexOfBytes(bytes, DIFFERENCES, at + DIFFERENCES.length)) {
    if (named(objectText(bytes, at + DIFFERENCES.length))) return true;
  }
  const index = indexObjects(bytes);
  // A simple TrueType font with no /ToUnicode: its codes may be a code page's.
  for (let at = indexOfBytes(bytes, TRUETYPE, 0); at >= 0; at = indexOfBytes(bytes, TRUETYPE, at + TRUETYPE.length)) {
    const object = enclosingObject(index, at);
    const text = object ? objectText(bytes, object.body) : null;
    if (text && text.includes("/FontDescriptor") && !text.includes("/ToUnicode")) return true;
  }
  if (indexOfBytes(bytes, OBJECT_STREAM, 0) < 0) return false;
  for (const { text } of streamedObjects(bytes, index).values()) {
    if (text.includes("AXt")) return true;
    if (text.includes("/TrueType") && text.includes("/FontDescriptor") && !text.includes("/ToUnicode")) return true;
    for (let at = text.indexOf("/Differences"); at >= 0; at = text.indexOf("/Differences", at + 12)) {
      const open = text.indexOf("[", at);
      const close = open < 0 ? -1 : text.indexOf("]", open);
      if (close > 0 && named(text.slice(open, close + 1))) return true;
    }
  }
  return false;
}

function writeToUnicode(entries: Map<number, string>, twoByte = false): string {
  const hex = (text: string) => [...text].flatMap((ch) => { const cp = ch.codePointAt(0)!; return cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp]; }).map((unit) => unit.toString(16).padStart(4, "0")).join("");
  const lines = [...entries].sort((a, b) => a[0] - b[0]).map(([code, text]) => `<${code.toString(16).padStart(twoByte ? 4 : 2, "0")}> <${hex(text)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 100) blocks.push(`${Math.min(100, lines.length - i)} beginbfchar\n${lines.slice(i, i + 100).join("\n")}\nendbfchar`);
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n${twoByte ? "<0000> <ffff>" : "<00> <ff>"}\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

/** A stream's contents, decrypted and decoded; null when `value` isn't one. */
async function streamContents(pdf: PDFDocument, cipher: StreamCipher | null, value: unknown): Promise<Uint8Array | null> {
  const stream = value instanceof PDFRef ? pdf.context.lookup(value) : value;
  if (!(stream instanceof PDFRawStream)) return null;
  if (!cipher || !(value instanceof PDFRef)) return decodePDFRawStream(stream).decode();
  return decodePDFRawStream(PDFRawStream.of(stream.dict, await cipher.decrypt(value, stream.contents))).decode();
}

// Names of shapes that are never a flat bar nor blank: letters, digits and
// tall signs. A glyph under such a name that draws one was misnamed by the
// producer (a calligraphic Arabic font's date dashes called "I", its spaces
// "less"): what it draws is the text.
const TALL_NAME = /^(?:[A-Za-z]|zero|one|two|three|four|five|six|seven|eight|nine|less|greater|paren(?:left|right)|bracket(?:left|right)|brace(?:left|right)|slash|backslash|bar|exclam|question|numbersign|dollar|percent|ampersand|at)$/;

/** The text of each misnamed code of `names` by the shape it draws. */
function shapeTexts(program: Uint8Array, names: Map<number, string>): Map<number, string> {
  const texts = new Map<number, string>();
  for (const [code, name] of names) {
    if (!TALL_NAME.test(name)) continue;
    const gid = simpleTrueTypeGlyph(program, code);
    if (gid <= 0) continue;
    const box = glyphBox(program, gid);
    if (!box) texts.set(code, " ");
    // A bar: flat, and at least twice as wide as thick.
    else if (box[3] - box[1] <= 0.15 && box[2] - box[0] >= Math.max(0.1, 2 * (box[3] - box[1]))) texts.set(code, box[3] <= 0 ? "_" : "-");
  }
  return texts;
}

/** A simple font's embedded TrueType program, decoded; null without one. */
function fontProgram(pdf: PDFDocument, cipher: StreamCipher | null, font: PDFDict, lookup: (object: unknown) => unknown): Promise<Uint8Array | null> {
  const descriptor = lookup(font.get(PDFName.of("FontDescriptor")));
  return streamContents(pdf, cipher, descriptor instanceof PDFDict ? descriptor.get(PDFName.of("FontFile2")) : null);
}

/** Gives `font` the CMap `cmap` as its /ToUnicode, encrypted with the
 * file's key when it has one. */
async function setToUnicode(pdf: PDFDocument, cipher: StreamCipher | null, font: PDFDict, cmap: string): Promise<void> {
  const stream = pdf.context.flateStream(cmap);
  const ref = pdf.context.nextRef();
  pdf.context.assign(ref, cipher ? PDFRawStream.of(stream.dict, await cipher.encrypt(ref, stream.contents)) : stream);
  font.set(PDFName.of("ToUnicode"), ref);
}

/** The text of each code an XT font (xtFonts.ts) draws, keyed by the PDF's
 * own codes: a simple font's byte, or a CID font's two-byte CID (through
 * its CIDToGIDMap to the glyph, and the program's cmap back to the XT
 * code). Null for any other font. */
async function xtFontTexts(pdf: PDFDocument, cipher: StreamCipher | null, font: PDFDict, lookup: (object: unknown) => unknown, runsOf: () => Promise<Uint8Array[] | undefined>): Promise<{ texts: Map<number, string>; twoByte: boolean; fillOnly?: boolean } | null> {
  const subtype = lookup(font.get(PDFName.of("Subtype")))?.toString();
  if (subtype === "/TrueType") {
    const program = await fontProgram(pdf, cipher, font, lookup);
    const codes = program && xtCodeTexts(program);
    return codes ? { texts: new Map([...codes].map(([code, { text }]) => [code, text])), twoByte: false } : null;
  }
  if (subtype === "/Type1" || subtype === "/MMType1") {
    const bySlot = await type1XtTexts(pdf, cipher, font, lookup);
    const xtBySlot = Boolean(bySlot);
    const texts = bySlot ?? (await type1cOrderTexts(pdf, cipher, font, lookup, runsOf));
    return texts ? { texts, twoByte: false, fillOnly: !xtBySlot } : null;
  }
  if (subtype !== "/Type0" || !/^\/Identity-[HV]$/.test(lookup(font.get(PDFName.of("Encoding")))?.toString() ?? "")) return null;
  const descendants = lookup(font.get(PDFName.of("DescendantFonts")));
  const cidFont = descendants instanceof PDFArray ? lookup(descendants.get(0)) : null;
  if (!(cidFont instanceof PDFDict)) return null;
  if (lookup(cidFont.get(PDFName.of("Subtype")))?.toString() === "/CIDFontType0") {
    const texts = await cffCidOrderTexts(pdf, cipher, cidFont, lookup, runsOf);
    return texts ? { texts, twoByte: true, fillOnly: true } : null;
  }
  if (lookup(cidFont.get(PDFName.of("Subtype")))?.toString() !== "/CIDFontType2") return null;
  const program = await fontProgram(pdf, cipher, cidFont, lookup);
  const codes = program && xtCodeTexts(program);
  if (!codes) return null;
  // A glyph two codes draw reads as the lower one.
  const textOfGlyph = new Map<number, string>();
  for (const [, { gid, text }] of [...codes].sort((a, b) => a[0] - b[0])) if (!textOfGlyph.has(gid)) textOfGlyph.set(gid, text);
  const texts = new Map<number, string>();
  const cidToGid = await streamContents(pdf, cipher, cidFont.get(PDFName.of("CIDToGIDMap")));
  if (!cidToGid) for (const [gid, text] of textOfGlyph) texts.set(gid, text);
  else for (let cid = 0; 2 * cid + 1 < cidToGid.length; cid++) {
    const text = textOfGlyph.get((cidToGid[2 * cid]! << 8) | cidToGid[2 * cid + 1]!);
    if (text !== undefined) texts.set(cid, text);
  }
  return { texts, twoByte: true };
}

/** The advance of each CID a CID font declares: its /W array, and /DW for the rest. */
function cidWidths(cidFont: PDFDict, lookup: (object: unknown) => unknown): (cid: number) => number {
  const widths = new Map<number, number>();
  const array = lookup(cidFont.get(PDFName.of("W")));
  const items = array instanceof PDFArray ? array.asArray().map((item) => lookup(item)) : [];
  for (let k = 0; k < items.length;) {
    const first = items[k];
    const second = items[k + 1];
    if (!(first instanceof PDFNumber)) { k++; continue; }
    if (second instanceof PDFArray) {
      second.asArray().forEach((item, at) => { const width = lookup(item); if (width instanceof PDFNumber) widths.set(first.asNumber() + at, width.asNumber()); });
      k += 2;
    } else {
      const width = items[k + 2];
      if (second instanceof PDFNumber && width instanceof PDFNumber) for (let cid = first.asNumber(); cid <= second.asNumber() && cid - first.asNumber() < 65536; cid++) widths.set(cid, width.asNumber());
      k += 3;
    }
  }
  const dw = lookup(cidFont.get(PDFName.of("DW")));
  const fallback = dw instanceof PDFNumber ? dw.asNumber() : 1000;
  return (cid) => widths.get(cid) ?? fallback;
}

/** A CID-keyed CFF copy of an XT font (CIDFontType0C, Identity-H): the CID
 * is the glyph number of the original font, read through the families'
 * glyph order (xtFonts.ts) once the strings it draws spell Arabic. */
async function cffCidOrderTexts(pdf: PDFDocument, cipher: StreamCipher | null, cidFont: PDFDict, lookup: (object: unknown) => unknown, runsOf: () => Promise<Uint8Array[] | undefined>): Promise<Map<number, string> | null> {
  const descriptor = lookup(cidFont.get(PDFName.of("FontDescriptor")));
  const program = await streamContents(pdf, cipher, descriptor instanceof PDFDict ? descriptor.get(PDFName.of("FontFile3")) : null);
  const cff = program && readCffGlyphs(program);
  const bytes = await runsOf();
  if (!cff?.cidKeyed || !bytes) return null;
  const width = cidWidths(cidFont, lookup);
  const glyphs = new Map<number, XtGlyph>();
  const runs = bytes.map((run) => {
    const keys: number[] = [];
    for (let at = 0; at + 1 < run.length; at += 2) {
      const cid = (run[at]! << 8) | run[at + 1]!;
      keys.push(cid);
      if (!glyphs.has(cid)) glyphs.set(cid, { gid: cid, zeroWidth: width(cid) === 0 });
    }
    return keys;
  });
  return xtOrderTexts(glyphs, runs);
}

/** A Type 1C copy of an XT font: its codes name glyphs "g62" (the
 * Differences, or else the program's own encoding), and the number is the
 * glyph number of the original font. Null for any other font. */
async function type1cOrderTexts(pdf: PDFDocument, cipher: StreamCipher | null, font: PDFDict, lookup: (object: unknown) => unknown, runsOf: () => Promise<Uint8Array[] | undefined>): Promise<Map<number, string> | null> {
  const descriptor = lookup(font.get(PDFName.of("FontDescriptor")));
  const program = await streamContents(pdf, cipher, descriptor instanceof PDFDict ? descriptor.get(PDFName.of("FontFile3")) : null);
  const cff = program && readCffGlyphs(program);
  const bytes = await runsOf();
  if (!cff || cff.cidKeyed || !bytes) return null;
  const names = new Map<number, string>();
  for (const [code, gid] of cff.encoding) {
    const name = cff.charset[gid];
    if (typeof name === "string") names.set(code, name);
  }
  const encoding = lookup(font.get(PDFName.of("Encoding")));
  const differences = encoding instanceof PDFDict ? lookup(encoding.get(PDFName.of("Differences"))) : null;
  if (differences instanceof PDFArray) {
    let code = 0;
    for (const item of differences.asArray()) {
      if (item instanceof PDFNumber) code = item.asNumber();
      else if (item instanceof PDFName) names.set(code++, item.decodeText());
    }
  }
  const widths = lookup(font.get(PDFName.of("Widths")));
  const firstChar = Number(lookup(font.get(PDFName.of("FirstChar")))?.toString() ?? 0);
  const glyphs = new Map<number, XtGlyph>();
  for (const [code, name] of names) {
    const match = /^g(\d+)$/.exec(name);
    if (!match) continue;
    const width = widths instanceof PDFArray && code >= firstChar ? lookup(widths.get(code - firstChar)) : null;
    glyphs.set(code, { gid: Number(match[1]), zeroWidth: width instanceof PDFNumber && width.asNumber() === 0 });
  }
  if (glyphs.size < 10) return null;
  return xtOrderTexts(glyphs, bytes.map((run) => [...run]));
}

/** A Type 1 XT font's codes, each by the Macintosh Roman slot its glyph
 * takes: named by the Differences, or else by the base encoding, or else by
 * the program's own encoding. Null when the names are already Arabic ones
 * (the legacy path's) or none reaches the table. */
async function type1XtTexts(pdf: PDFDocument, cipher: StreamCipher | null, font: PDFDict, lookup: (object: unknown) => unknown): Promise<Map<number, string> | null> {
  const encoding = lookup(font.get(PDFName.of("Encoding")));
  const base = (encoding instanceof PDFDict ? lookup(encoding.get(PDFName.of("BaseEncoding"))) : encoding)?.toString();
  const names = new Map<number, string>();
  if (!base) {
    const descriptor = lookup(font.get(PDFName.of("FontDescriptor")));
    const program = await streamContents(pdf, cipher, descriptor instanceof PDFDict ? descriptor.get(PDFName.of("FontFile")) : null);
    const clear = program ? latin1(program) : "";
    const end = clear.indexOf("eexec");
    for (const [, code, name] of clear.slice(0, end < 0 ? clear.length : end).matchAll(/dup (\d+) ?\/([^\s/[\]{}()<>]+) put/g)) names.set(Number(code), name!);
  }
  const differences = encoding instanceof PDFDict ? lookup(encoding.get(PDFName.of("Differences"))) : null;
  if (differences instanceof PDFArray) {
    let code = 0;
    for (const item of differences.asArray()) {
      if (item instanceof PDFNumber) code = item.asNumber();
      else if (item instanceof PDFName) names.set(code++, item.decodeText());
    }
  }
  if ([...names.values()].filter((name) => arabicGlyphName(name)?.certain).length >= 3) return null;
  const widths = lookup(font.get(PDFName.of("Widths")));
  const firstChar = Number(lookup(font.get(PDFName.of("FirstChar")))?.toString() ?? 0);
  const texts = new Map<number, string>();
  for (let code = 0; code < 256; code++) {
    const name = names.get(code);
    const xtCode = name !== undefined ? xtCodeOfName(name) : base === "/MacRomanEncoding" ? code : base === "/WinAnsiEncoding" ? xtCodeOfWinAnsi(code) : undefined;
    if (xtCode === undefined) continue;
    const width = widths instanceof PDFArray && code >= firstChar ? lookup(widths.get(code - firstChar)) : null;
    const text = xtText(xtCode, width instanceof PDFNumber && width.asNumber() === 0);
    if (text !== undefined) texts.set(code, text);
  }
  return texts.size ? texts : null;
}

/** The text of each code of a simple TrueType font whose strings, as the
 * pages draw them, are Arabic in an 8-bit code page (codePages.ts): the font
 * program draws the letters in Latin slots. Null for any other font. Where
 * the program's own cmap finds the glyph of a code that reads as an alef,
 * that glyph must be a tall stem, as in the XT fonts' check. */
function codePageFontTexts(program: Uint8Array, runs: Uint8Array[]): Map<number, string> | null {
  const reading = chooseCodePage(runs);
  if (!reading) return null;
  const texts = new Map<number, string>();
  for (const [code, text] of codePageTexts(reading.page)) {
    if (text === "ا") {
      let gid: number;
      try {
        gid = simpleTrueTypeGlyph(program, code);
      } catch {
        gid = 0;
      }
      const box = gid > 0 ? glyphBox(program, gid) : null;
      if (box && box[3] - box[1] < 2 * (box[2] - box[0])) return null;
    }
    texts.set(code, text);
  }
  return texts;
}

/** `bytes` with the text layer of its legacy Arabic fonts completed, or
 * null when nothing needed it (or the file can't be rewritten: damaged, or
 * encrypted other than by the standard handler with no password to open).
 * An encrypted file stays encrypted: the new /ToUnicode is written with the
 * file's own key. */
export async function repairTextLayer(bytes: Uint8Array): Promise<TextRepair | null> {
  try {
    if (!needsRepair(bytes)) return null;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    // Objects inside an encrypted object stream are out of pdf-lib's reach.
    const cipher = pdf.isEncrypted ? await standardCipher(pdf) : null;
    if (pdf.isEncrypted && (!cipher || indexOfBytes(bytes, OBJECT_STREAM, 0) >= 0)) return null;
    const lookup = (object: unknown) => (object instanceof PDFRef ? pdf.context.lookup(object) : object);
    const fonts: TextRepair["fonts"] = [];
    let drawn: Map<PDFDict, Uint8Array[]> | null = null;
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || lookup(object.get(PDFName.of("Type")))?.toString() !== "/Font") continue;
      const fontName = (lookup(object.get(PDFName.of("BaseFont")))?.toString() ?? "").replace(/^\/(?:[A-Z]{6}\+)?/, "");
      const runsOf = async () => {
        drawn ??= await fontStrings(pdf, lookup, (value) => streamContents(pdf, cipher, value));
        return drawn.get(object);
      };
      const xt = isXtFont(fontName) ? await xtFontTexts(pdf, cipher, object, lookup, runsOf) : null;
      if (xt) {
        const current = await streamContents(pdf, cipher, object.get(PDFName.of("ToUnicode")));
        const entries = current ? readToUnicode(latin1(current)) : new Map<number, string>();
        // A producer that could name the letters (at least five) named them all.
        if ([...entries.values()].filter(isArabic).length >= 5) continue;
        let added = 0;
        for (const [at, text] of xt.texts) {
          if (entries.get(at) === text) continue;
          // A reading by glyph order only fills the codes the font's own
          // /ToUnicode leaves out.
          if (xt.fillOnly && entries.get(at)) continue;
          entries.set(at, text);
          added++;
        }
        if (!added) continue;
        await setToUnicode(pdf, cipher, object, writeToUnicode(entries, xt.twoByte));
        fonts.push({ name: fontName, codes: added });
        continue;
      }
      const subtype = lookup(object.get(PDFName.of("Subtype")))?.toString();
      if (subtype === "/TrueType" && object.has(PDFName.of("FontDescriptor"))) {
        const runs = await runsOf();
        const program = runs ? await fontProgram(pdf, cipher, object, lookup) : null;
        const texts = runs && program ? codePageFontTexts(program, runs) : null;
        if (texts) {
          const current = await streamContents(pdf, cipher, object.get(PDFName.of("ToUnicode")));
          const entries = current ? readToUnicode(latin1(current)) : new Map<number, string>();
          // A producer that could name the letters (at least five) named them all.
          if ([...entries.values()].filter(isArabic).length < 5) {
            let added = 0;
            for (const [at, text] of texts) {
              if (entries.get(at) === text) continue;
              entries.set(at, text);
              added++;
            }
            if (added) {
              await setToUnicode(pdf, cipher, object, writeToUnicode(entries));
              fonts.push({ name: fontName, codes: added });
              continue;
            }
          }
        }
      }
      if (subtype !== "/TrueType" && subtype !== "/Type1" && subtype !== "/MMType1") continue;
      const encoding = lookup(object.get(PDFName.of("Encoding")));
      const differences = encoding instanceof PDFDict ? lookup(encoding.get(PDFName.of("Differences"))) : null;
      if (!(differences instanceof PDFArray)) continue;
      const names = new Map<number, string>();
      let code = 0;
      for (const item of differences.asArray()) {
        if (item instanceof PDFNumber) code = item.asNumber();
        else if (item instanceof PDFName) names.set(code++, item.decodeText());
      }
      // An Arabic font by its names: only then are the names another
      // script shares ("alef", "ra") read as Arabic too.
      const resolved = new Map([...names].map(([at, name]) => [at, arabicGlyphName(name)] as const));
      const arabic = [...resolved.values()].filter((entry) => entry?.certain).length >= 3;
      const misnamed = subtype === "/TrueType" && [...names.values()].some((name) => TALL_NAME.test(name));
      if (!arabic && !misnamed) continue;
      if (!arabic) resolved.clear();
      if (misnamed) {
        const program = await fontProgram(pdf, cipher, object, lookup);
        if (program) for (const [at, text] of shapeTexts(program, names)) resolved.set(at, { text, certain: true });
      }
      if (!resolved.size) continue;
      // Microsoft's fonts of that time call their initial kaf "afii57410",
      // the glyph list's name for alef with madda: the glyph's own box says
      // which it is (an alef is a stem at least 2.2 times as tall as wide
      // in every font measured; a kaf at most 1.7 times).
      const legacy = [...names.values()].some((name) => /^afii62\d{3}/.test(name));
      const kafCode = legacy ? [...names].find(([, name]) => name === "afii57410")?.[0] : undefined;
      if (kafCode !== undefined) {
        const program = await fontProgram(pdf, cipher, object, lookup);
        const box = program ? glyphBox(program, simpleTrueTypeGlyph(program, kafCode)) : null;
        if (box && box[3] - box[1] < 1.95 * (box[2] - box[0])) resolved.set(kafCode, { text: "ك", certain: true });
      }
      const current = await streamContents(pdf, cipher, object.get(PDFName.of("ToUnicode")));
      const entries = current ? readToUnicode(latin1(current)) : new Map<number, string>();
      let added = 0;
      for (const [at, entry] of resolved) {
        if (!entry || at < 0 || at > 255) continue;
        const known = entries.get(at);
        // A code the producer left unnamed, or named in another script (or,
        // the kaf above, as another letter).
        if (known === entry.text || (known && isArabic(known) && at !== kafCode)) continue;
        entries.set(at, entry.text);
        added++;
      }
      if (!added) continue;
      await setToUnicode(pdf, cipher, object, writeToUnicode(entries));
      fonts.push({ name: fontName, codes: added });
    }
    if (!fonts.length) return null;
    return { bytes: await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }), fonts };
  } catch {
    return null;
  }
}
