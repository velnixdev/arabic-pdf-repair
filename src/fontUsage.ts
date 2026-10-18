/** The strings each font of a document draws, read from its page contents
 * (and form XObjects) without a rendering engine: the show-text operators
 * (Tj, TJ, ', ") under the font the last Tf selected. What a font draws is
 * what decides whether its codes are a code page's (codePages.ts). */
import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument, PDFRawStream } from "pdf-lib";

type Token = { kind: "name" | "op" | "num" | "string" | "[" | "]"; text: string; bytes?: Uint8Array };

const SPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITER = new Set("()<>[]{}/%".split("").map((ch) => ch.charCodeAt(0)));

/** The tokens of a content stream (dictionaries and inline images are
 * skipped over as unknown operators, which is harmless here). */
function* tokens(data: Uint8Array): Generator<Token> {
  let i = 0;
  const n = data.length;
  while (i < n) {
    const byte = data[i]!;
    if (SPACE.has(byte)) { i++; continue; }
    if (byte === 0x25) { while (i < n && data[i] !== 10 && data[i] !== 13) i++; continue; }
    if (byte === 0x28) {
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = data[i++]!;
        if (c === 0x5c) {
          const e = data[i++]!;
          if (e >= 0x30 && e <= 0x37) {
            let value = e - 0x30;
            for (let k = 0; k < 2 && data[i]! >= 0x30 && data[i]! <= 0x37; k++) value = value * 8 + data[i++]! - 0x30;
            out.push(value & 0xff);
          } else if (e === 0x6e) out.push(10);
          else if (e === 0x72) out.push(13);
          else if (e === 0x74) out.push(9);
          else if (e === 0x62) out.push(8);
          else if (e === 0x66) out.push(12);
          else if (e === 13) { if (data[i] === 10) i++; }
          else if (e !== 10) out.push(e);
        } else if (c === 0x28) { depth++; out.push(c); }
        else if (c === 0x29) { depth--; if (depth > 0) out.push(c); }
        else out.push(c);
      }
      yield { kind: "string", text: "", bytes: Uint8Array.from(out) };
      continue;
    }
    if (byte === 0x3c && data[i + 1] !== 0x3c) {
      const out: number[] = [];
      let half = -1;
      i++;
      while (i < n && data[i] !== 0x3e) {
        const digit = parseInt(String.fromCharCode(data[i++]!), 16);
        if (Number.isNaN(digit)) continue;
        if (half < 0) half = digit;
        else { out.push(half * 16 + digit); half = -1; }
      }
      if (half >= 0) out.push(half * 16);
      i++;
      yield { kind: "string", text: "", bytes: Uint8Array.from(out) };
      continue;
    }
    if (byte === 0x5b) { i++; yield { kind: "[", text: "[" }; continue; }
    if (byte === 0x5d) { i++; yield { kind: "]", text: "]" }; continue; }
    if (byte === 0x3c || byte === 0x3e || byte === 0x7b || byte === 0x7d || byte === 0x29) { i++; continue; }
    const start = i;
    i++;
    while (i < n && !SPACE.has(data[i]!) && !(DELIMITER.has(data[i]!) && data[i] !== 0x2f)) i++;
    const text = String.fromCharCode(...data.subarray(start, Math.min(i, start + 64)));
    if (byte === 0x2f) yield { kind: "name", text: text.slice(1) };
    else if (/^[+-]?[\d.]/.test(text)) yield { kind: "num", text };
    else yield { kind: "op", text };
  }
}

/** The strings drawn under each font name by one content stream. */
function drawnStrings(data: Uint8Array, fonts: Map<string, PDFDict>, into: Map<PDFDict, Uint8Array[]>, forms: Set<string>): void {
  let font: PDFDict | undefined;
  let lastName = "";
  let strings: Uint8Array[] = [];
  let inArray = false;
  const show = (list: Uint8Array[]) => {
    if (!font) return;
    const runs = into.get(font) ?? [];
    runs.push(...list);
    into.set(font, runs);
  };
  for (const token of tokens(data)) {
    if (token.kind === "name") { lastName = token.text; strings = []; }
    else if (token.kind === "string") strings.push(token.bytes!);
    else if (token.kind === "[") { inArray = true; strings = []; }
    else if (token.kind === "]") inArray = false;
    else if (token.kind === "op" && !inArray) {
      if (token.text === "Tf") font = fonts.get(lastName);
      else if (token.text === "Tj" || token.text === "TJ" || token.text === "'" || token.text === '"') show(strings.slice(-(token.text === "TJ" ? strings.length : 1)));
      else if (token.text === "Do") forms.add(lastName);
      strings = [];
    }
  }
}

/** The strings drawn with each font dictionary in the first `maxPages`
 * pages' contents, forms included (to a depth of 3). */
export async function fontStrings(
  pdf: PDFDocument,
  lookup: (object: unknown) => unknown,
  decode: (value: unknown) => Promise<Uint8Array | null>,
  maxPages = 12,
): Promise<Map<PDFDict, Uint8Array[]>> {
  const into = new Map<PDFDict, Uint8Array[]>();
  const seen = new Set<unknown>();
  const resourceFonts = (resources: unknown): Map<string, PDFDict> => {
    const map = new Map<string, PDFDict>();
    const dict = lookup(resources);
    const fonts = dict instanceof PDFDict ? lookup(dict.get(PDFName.of("Font"))) : null;
    if (fonts instanceof PDFDict) for (const [key, value] of fonts.entries()) {
      const font = lookup(value);
      if (font instanceof PDFDict) map.set(key.decodeText(), font);
    }
    return map;
  };
  const visit = async (data: Uint8Array | null, resources: unknown, depth: number): Promise<void> => {
    if (!data) return;
    const fonts = resourceFonts(resources);
    const forms = new Set<string>();
    drawnStrings(data, fonts, into, forms);
    const dict = lookup(resources);
    const xobjects = dict instanceof PDFDict ? lookup(dict.get(PDFName.of("XObject"))) : null;
    if (depth >= 3 || !(xobjects instanceof PDFDict)) return;
    for (const name of forms) {
      const ref = xobjects.get(PDFName.of(name));
      const form = lookup(ref);
      if (!(form instanceof PDFRawStream) || seen.has(form) || lookup(form.dict.get(PDFName.of("Subtype")))?.toString() !== "/Form") continue;
      seen.add(form);
      await visit(await decode(ref), form.dict.get(PDFName.of("Resources")) ?? resources, depth + 1);
    }
  };
  for (const page of pdf.getPages().slice(0, maxPages)) {
    const contents = page.node.get(PDFName.of("Contents"));
    const parts = lookup(contents) instanceof PDFArray ? (lookup(contents) as PDFArray).asArray() : [contents];
    const chunks: Uint8Array[] = [];
    for (const part of parts) {
      if (!(part instanceof PDFRef)) continue;
      const chunk = await decode(part);
      if (chunk) chunks.push(chunk, Uint8Array.of(10));
    }
    const data = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    await visit(data, page.node.Resources(), 0);
  }
  return into;
}
