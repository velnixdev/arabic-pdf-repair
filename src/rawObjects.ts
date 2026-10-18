/** A PDF's objects read straight from its bytes, for what PDFium doesn't
 * expose. Objects are found by scanning for "12 0 obj" rather than through
 * the cross-reference table (a damaged table still reads), the latest
 * definition of each wins (incremental updates append newer ones), and
 * compressed object streams are opened too. */
import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFObjectParser, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject } from "pdf-lib";
import { latin1 } from "./bytes.js";

export const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
export const isSpace = (byte: number | undefined) => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00;
const isDigit = (byte: number | undefined) => byte !== undefined && byte >= 0x30 && byte <= 0x39;

export function indexOfBytes(bytes: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0]!;
  for (let i = bytes.indexOf(first, from); i >= 0 && i <= bytes.length - needle.length; i = bytes.indexOf(first, i + 1)) {
    let j = 1;
    while (j < needle.length && bytes[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

const OBJ = ascii("obj");
export const OBJECT_STREAM = ascii("/ObjStm");

export interface ObjectIndex {
  /** Every object definition ("12 0 obj"), in file order, with where its
   * body starts. */
  starts: Array<{ num: number; body: number }>;
  /** Each object's current body: its last definition, as incremental
   * updates append newer ones. */
  current: Map<number, number>;
}

export function indexObjects(bytes: Uint8Array): ObjectIndex {
  const starts: ObjectIndex["starts"] = [];
  const current = new Map<number, number>();
  for (let at = indexOfBytes(bytes, OBJ, 0); at >= 0; at = indexOfBytes(bytes, OBJ, at + 3)) {
    let i = at - 1;
    if (!isSpace(bytes[i])) continue; // "endobj"
    while (isSpace(bytes[i])) i--;
    const generationEnd = i;
    while (isDigit(bytes[i])) i--;
    if (i === generationEnd || !isSpace(bytes[i])) continue;
    while (isSpace(bytes[i])) i--;
    const numberEnd = i;
    while (isDigit(bytes[i])) i--;
    if (i === numberEnd) continue;
    const num = Number(latin1(bytes, i + 1, numberEnd + 1));
    starts.push({ num, body: at + 3 });
    current.set(num, at + 3);
  }
  return { starts, current };
}

/** The object definition `offset` falls in: the last one starting before it. */
export function enclosingObject(index: ObjectIndex, offset: number): { num: number; body: number } | null {
  let low = 0;
  let high = index.starts.length - 1;
  let found: { num: number; body: number } | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = index.starts[middle]!;
    if (entry.body <= offset) {
      found = entry;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** The object at `start`: a dictionary through its matching ">>" or an array
 * through its matching "]", nested ones included; null for anything else. */
export function objectText(bytes: Uint8Array, start: number): string | null {
  let i = start;
  while (isSpace(bytes[i])) i++;
  const open = bytes[i];
  if (open !== 0x3c && open !== 0x5b) return null; // "<" "["
  const begin = i;
  let depth = 0;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    if (byte === 0x28) {
      // A literal string: balanced parentheses, backslash escapes.
      let parens = 0;
      for (; i < bytes.length; i++) {
        if (bytes[i] === 0x5c) i++;
        else if (bytes[i] === 0x28) parens++;
        else if (bytes[i] === 0x29 && --parens === 0) break;
      }
    } else if (byte === 0x3c && bytes[i + 1] === 0x3c) {
      depth++;
      i++;
    } else if (byte === 0x3e && bytes[i + 1] === 0x3e) {
      depth--;
      i++;
      if (depth === 0) return latin1(bytes, begin, i + 1);
    } else if (byte === 0x3c) {
      // A hex string.
      while (i < bytes.length && bytes[i] !== 0x3e) i++;
    } else if (byte === 0x5b) {
      depth++;
    } else if (byte === 0x5d) {
      depth--;
      if (depth === 0) return latin1(bytes, begin, i + 1);
    }
    i++;
  }
  return null;
}

/** A dictionary's own entries: everything nested inside it blanked out, so
 * a key in a sub-dictionary (Encoding, Resources) is never read as its own. */
export function ownEntries(dict: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < dict.length; i++) {
    if (dict.startsWith("<<", i)) {
      depth++;
      out += depth === 1 ? "<<" : "  ";
      i++;
    } else if (dict.startsWith(">>", i)) {
      out += depth === 1 ? ">>" : "  ";
      depth--;
      i++;
    } else {
      out += depth === 1 ? dict[i] : " ";
    }
  }
  return out;
}

/** The objects stored inside compressed object streams, by number: their
 * text, and where their stream is in the file. */
export function streamedObjects(bytes: Uint8Array, index: ObjectIndex): Map<number, { text: string; at: number }> {
  const objects = new Map<number, { text: string; at: number }>();
  const seen = new Set<number>();
  for (let at = indexOfBytes(bytes, OBJECT_STREAM, 0); at >= 0; at = indexOfBytes(bytes, OBJECT_STREAM, at + OBJECT_STREAM.length)) {
    const stream = enclosingObject(index, at);
    if (!stream || index.current.get(stream.num) !== stream.body || seen.has(stream.num)) continue;
    seen.add(stream.num);
    try {
      const parsed = PDFObjectParser.forBytes(bytes.subarray(stream.body), PDFContext.create()).parseObject();
      if (!(parsed instanceof PDFRawStream)) continue;
      const count = parsed.dict.get(PDFName.of("N"));
      const first = parsed.dict.get(PDFName.of("First"));
      if (!(count instanceof PDFNumber) || !(first instanceof PDFNumber)) continue;
      const data = latin1(decodePDFRawStream(parsed).decode());
      const start = first.asNumber();
      // The stream opens with "number offset" pairs, offsets from `First`.
      const pairs = data.slice(0, start).trim().split(/\s+/).map(Number);
      for (let i = 0; i < count.asNumber(); i++) {
        const num = pairs[2 * i];
        const offset = pairs[2 * i + 1];
        if (!Number.isInteger(num) || !Number.isInteger(offset)) break;
        const end = pairs[2 * i + 3] ?? data.length - start;
        const known = objects.get(num!);
        if (!known || known.at < stream.body) objects.set(num!, { text: data.slice(start + offset!, start + end).trim(), at: stream.body });
      }
    } catch {
      // An unreadable stream: its objects stay unknown.
    }
  }
  return objects;
}

const readers = new WeakMap<Uint8Array, (num: number) => PDFObject | null>();

/** Reads the file's objects by number, plain or in object streams. One
 * reader per file: the index and the opened object streams are shared by
 * every read of the same bytes. */
function objectReader(bytes: Uint8Array): (num: number) => PDFObject | null {
  let reader = readers.get(bytes);
  if (!reader) {
    reader = makeObjectReader(bytes);
    readers.set(bytes, reader);
  }
  return reader;
}

function makeObjectReader(bytes: Uint8Array): (num: number) => PDFObject | null {
  const index = indexObjects(bytes);
  const streamed = indexOfBytes(bytes, OBJECT_STREAM, 0) >= 0 ? streamedObjects(bytes, index) : null;
  const context = PDFContext.create();
  const cache = new Map<number, PDFObject | null>();
  return (num) => {
    if (cache.has(num)) return cache.get(num)!;
    let object: PDFObject | null = null;
    try {
      const plain = index.current.get(num);
      const inStream = streamed?.get(num);
      if (inStream && (plain === undefined || inStream.at > plain)) object = PDFObjectParser.forBytes(ascii(inStream.text), context).parseObject();
      else if (plain !== undefined) object = PDFObjectParser.forBytes(bytes.subarray(plain), context).parseObject();
    } catch {
      object = null;
    }
    cache.set(num, object);
    return object;
  };
}

/** The decoded content streams of the page whose dictionary is object
 * `pageNum`, in drawing order; null when they can't be read (an encrypted
 * file, a damaged one). */
export function pageContentStreams(bytes: Uint8Array, pageNum: number): Uint8Array[] | null {
  try {
    const objectAt = objectReader(bytes);
    const page = objectAt(pageNum);
    if (!(page instanceof PDFDict)) return null;
    let contents = page.get(PDFName.of("Contents"));
    if (contents instanceof PDFRef) {
      const target = objectAt(contents.objectNumber);
      if (target instanceof PDFArray) contents = target;
    }
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const streams: Uint8Array[] = [];
    for (const ref of refs) {
      const stream = ref instanceof PDFRef ? objectAt(ref.objectNumber) : null;
      if (!(stream instanceof PDFRawStream)) return null;
      streams.push(decodePDFRawStream(stream).decode());
    }
    return streams;
  } catch {
    return null;
  }
}

/** A font resource of a page, as far as drawing with its codes goes. */
export interface PageFont {
  /** /BaseFont, subset tag included ("ABCDEF+Arial-BoldMT"). */
  baseFont: string;
  /** /Subtype of the font dictionary (Type0, TrueType, Type1, Type3, ...). */
  subtype: string;
  /** How many bytes one character code takes in its strings: 1 for a simple
   * font, 2 for a composite font with an Identity or UCS-2 encoding, 0 for a
   * composite font with another CMap (its codes aren't read here). */
  codeBytes: 0 | 1 | 2;
  /** Each code's advance width (thousandths of the text space unit), from
   * /Widths (simple) or /W (composite); codes not listed take `defaultWidth`
   * (/MissingWidth, /DW). Empty when the font lists none. */
  widths: Map<number, number>;
  defaultWidth: number;
  /** A composite TrueType font's /CIDToGIDMap stream (glyph index per CID),
   * when it has one; null means the identity (every other font too). */
  cidToGid: Uint16Array | null;
  /** A small PDF holding only this font, in which each of `codes` reads as
   * a private-use character -- U+E000 plus its place in `codes` -- and one
   * page drawing the first of them (see fontProbeDocument); null when it
   * can't be made. */
  probe(codes: number[]): Uint8Array | null;
}

/** PDFium reaches a glyph's outline by the character it reads as, and a
 * document's own ToUnicode names several codes alike (a letter's joining
 * forms) or none. So the font dictionary is written out again on its own,
 * with the objects it refers to (descriptor, program, widths, encoding), and
 * a ToUnicode that gives every wanted code a character of its own: whatever
 * the font's technology, PDFium then hands out each code's outline. */
function fontProbeDocument(font: PDFDict, objectAt: (num: number) => PDFObject | null, codeBytes: number, codes: number[]): Uint8Array | null {
  if (!codes.length || codes.length > 6400 || (codeBytes !== 1 && codeBytes !== 2)) return null;
  const hex = (value: number, digits: number) => value.toString(16).padStart(digits, "0");
  const digits = 2 * codeBytes;
  const lines = codes.map((code, k) => `<${hex(code, digits)}> <${hex(0xe000 + k, 4)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 100) blocks.push(`${Math.min(100, lines.length - i)} beginbfchar\n${lines.slice(i, i + 100).join("\n")}\nendbfchar`);
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<${"00".repeat(codeBytes)}> <${"ff".repeat(codeBytes)}>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
  const content = `BT /F1 10 Tf 10 10 Td <${hex(codes[0]!, digits)}> Tj ET`;
  // Objects 1-4 are the catalog, the page tree, the page and its content;
  // 5 the font, 6 its new ToUnicode; then whatever the font refers to.
  const numbers = new Map<number, number>();
  const queue: Array<{ num: number; object: PDFObject }> = [];
  let next = 7;
  const write = (object: PDFObject, skip?: string): string => {
    if (object instanceof PDFRef) {
      let num = numbers.get(object.objectNumber);
      if (num === undefined) {
        const target = objectAt(object.objectNumber);
        if (!target) return "null";
        num = next++;
        numbers.set(object.objectNumber, num);
        queue.push({ num, object: target });
      }
      return `${num} 0 R`;
    }
    if (object instanceof PDFArray) return `[${object.asArray().map((item) => write(item)).join(" ")}]`;
    if (object instanceof PDFDict) return `<<${object.entries().filter(([key]) => key.decodeText() !== skip).map(([key, value]) => `${key.toString()} ${write(value)}`).join(" ")}>>`;
    return object.toString();
  };
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const add = (num: number, body: string, stream?: Uint8Array) => {
    offsets[num] = length;
    push(ascii(`${num} 0 obj\n${body}\n`));
    if (stream) {
      push(ascii("stream\n"));
      push(stream);
      push(ascii("\nendstream\n"));
    }
    push(ascii("endobj\n"));
  };
  push(ascii("%PDF-1.7\n"));
  add(1, "<</Type /Catalog /Pages 2 0 R>>");
  add(2, "<</Type /Pages /Kids [3 0 R] /Count 1>>");
  add(3, "<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <</Font <</F1 5 0 R>>>> /Contents 4 0 R>>");
  add(4, `<</Length ${content.length}>>`, ascii(content));
  add(5, `${write(font, "ToUnicode").slice(0, -2)} /ToUnicode 6 0 R>>`);
  add(6, `<</Length ${cmap.length}>>`, ascii(cmap));
  for (let i = 0; i < queue.length; i++) {
    if (i >= 400) return null; // not a font's handful of objects
    const { num, object } = queue[i]!;
    if (object instanceof PDFRawStream) add(num, `${write(object.dict, "Length").slice(0, -2)} /Length ${object.contents.length}>>`, object.contents);
    else add(num, write(object));
  }
  const xref = length;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let num = 1; num < next; num++) table += `${String(offsets[num] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(ascii(`${table}trailer\n<</Size ${next} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The fonts in the /Resources of the page whose dictionary is object
 * `pageNum` (inherited resources included), by resource name; null when
 * the file can't be read. */
export function pageFontDicts(bytes: Uint8Array, pageNum: number): Map<string, PageFont> | null {
  try {
    const objectAt = objectReader(bytes);
    const resolve = (object: PDFObject | undefined | null): PDFObject | null => (object instanceof PDFRef ? objectAt(object.objectNumber) : object ?? null);
    const dictOf = (object: PDFObject | undefined | null): PDFDict | null => {
      const resolved = resolve(object);
      return resolved instanceof PDFDict ? resolved : resolved instanceof PDFRawStream ? resolved.dict : null;
    };
    const numberOf = (object: PDFObject | undefined | null, fallback: number): number => {
      const resolved = resolve(object);
      return resolved instanceof PDFNumber ? resolved.asNumber() : fallback;
    };
    const nameOf = (object: PDFObject | undefined | null): string => {
      const resolved = resolve(object);
      return resolved instanceof PDFName ? resolved.decodeText() : "";
    };
    // Resources: the page's own, else the nearest ancestor's.
    let node: PDFDict | null = dictOf(objectAt(pageNum));
    let resources: PDFDict | null = null;
    for (let depth = 0; node && depth < 64 && !resources; depth++) {
      resources = dictOf(node.get(PDFName.of("Resources")));
      node = dictOf(node.get(PDFName.of("Parent")));
    }
    const fontDict = resources ? dictOf(resources.get(PDFName.of("Font"))) : null;
    if (!fontDict) return null;
    const out = new Map<string, PageFont>();
    for (const [key, value] of fontDict.entries()) {
      const font = dictOf(value);
      if (!font) continue;
      const subtype = nameOf(font.get(PDFName.of("Subtype")));
      const widths = new Map<number, number>();
      let defaultWidth = 0;
      let codeBytes: 0 | 1 | 2 = 1;
      let cidToGid: Uint16Array | null = null;
      let baseFont = nameOf(font.get(PDFName.of("BaseFont")));
      if (subtype === "Type0") {
        const encoding = resolve(font.get(PDFName.of("Encoding")));
        const encodingName = encoding instanceof PDFName ? encoding.decodeText() : "";
        codeBytes = /^Identity-[HV]$/.test(encodingName) || /UCS2|UTF16/.test(encodingName) ? 2 : 0;
        const descendants = resolve(font.get(PDFName.of("DescendantFonts")));
        const cid = descendants instanceof PDFArray && descendants.size() ? dictOf(descendants.get(0)) : null;
        if (cid) {
          baseFont ||= nameOf(cid.get(PDFName.of("BaseFont")));
          defaultWidth = numberOf(cid.get(PDFName.of("DW")), 1000);
          const map = resolve(cid.get(PDFName.of("CIDToGIDMap")));
          if (map instanceof PDFRawStream) {
            const data = decodePDFRawStream(map).decode();
            cidToGid = new Uint16Array(data.length >> 1);
            for (let i = 0; i < cidToGid.length; i++) cidToGid[i] = (data[2 * i]! << 8) | data[2 * i + 1]!;
          }
          const w = resolve(cid.get(PDFName.of("W")));
          if (w instanceof PDFArray) {
            const items = w.asArray().map((item) => resolve(item));
            for (let i = 0; i < items.length; ) {
              const first = items[i];
              if (!(first instanceof PDFNumber)) break;
              const next = items[i + 1];
              if (next instanceof PDFArray) {
                const list = next.asArray().map((item) => resolve(item));
                list.forEach((item, k) => { if (item instanceof PDFNumber) widths.set(first.asNumber() + k, item.asNumber()); });
                i += 2;
              } else if (next instanceof PDFNumber && items[i + 2] instanceof PDFNumber) {
                const last = next.asNumber();
                const width = (items[i + 2] as PDFNumber).asNumber();
                for (let code = first.asNumber(); code <= last && code - first.asNumber() < 65536; code++) widths.set(code, width);
                i += 3;
              } else break;
            }
          }
        } else {
          defaultWidth = 1000;
        }
      } else {
        const descriptor = dictOf(font.get(PDFName.of("FontDescriptor")));
        defaultWidth = descriptor ? numberOf(descriptor.get(PDFName.of("MissingWidth")), 0) : 0;
        const firstChar = numberOf(font.get(PDFName.of("FirstChar")), 0);
        const list = resolve(font.get(PDFName.of("Widths")));
        if (list instanceof PDFArray) {
          list.asArray().map((item) => resolve(item)).forEach((item, k) => { if (item instanceof PDFNumber) widths.set(firstChar + k, item.asNumber()); });
        }
      }
      const bytesPerCode = codeBytes;
      const probe = (codes: number[]) => {
        try {
          return subtype === "Type3" ? null : fontProbeDocument(font, objectAt, bytesPerCode, codes);
        } catch {
          return null;
        }
      };
      out.set(key.decodeText(), { baseFont, subtype, codeBytes, widths, defaultWidth, cidToGid, probe });
    }
    return out;
  } catch {
    return null;
  }
}
