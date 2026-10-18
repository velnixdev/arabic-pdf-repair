/** What a bare CFF font program says about its glyphs, without drawing them:
 * the name or CID of each glyph (its charset), and a Type 1C font's own
 * code-to-glyph encoding. Used to read fonts whose PDF text layer is
 * missing: a CID font's CID (or a simple font's code) leads to a glyph, and
 * the glyph's name ("uni0627", "alef") or the CID it keeps from the
 * original font says what it draws. */
import { i16, i32, latin1, u16, uintBE } from "./bytes.js";
import { OTTO_TAG, readTable } from "./sfnt.js";

/** Read one CFF INDEX at `p`, returning item [start,end) pairs and the end position */
export function readCffIndex(b: Uint8Array, p: number): { items: [number, number][]; end: number } {
  const count = u16(b, p);
  if (count === 0) return { items: [], end: p + 2 };
  const offSize = b[p + 2]!;
  const readOff = (i: number) => uintBE(b, p + 3 + i * offSize, offSize);
  const dataStart = p + 3 + (count + 1) * offSize - 1;
  const items: [number, number][] = [];
  for (let i = 0; i < count; i++) items.push([dataStart + readOff(i), dataStart + readOff(i + 1)]);
  return { items, end: dataStart + readOff(count) };
}

/** Operator -> last operands of a CFF DICT */
export function parseCffDict(b: Uint8Array, start: number, end: number): Map<number, number[]> {
  const ops = new Map<number, number[]>();
  let operands: number[] = [];
  let i = start;
  while (i < end) {
    const b0 = b[i]!;
    if (b0 <= 21) {
      let op = b0;
      if (b0 === 12) op = 1200 + b[++i]!;
      ops.set(op, operands);
      operands = [];
      i++;
    } else if (b0 === 28) {
      operands.push(i16(b, i + 1));
      i += 3;
    } else if (b0 === 29) {
      operands.push(i32(b, i + 1));
      i += 5;
    } else if (b0 === 30) {
      // real number: nibbles until an 0xf terminator
      i++;
      while (i < end && (b[i]! & 0x0f) !== 0x0f && b[i]! >> 4 !== 0x0f) i++;
      i++;
      operands.push(NaN);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + b[i + 1]! + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - b[i + 1]! - 108);
      i += 2;
    } else {
      i++;
    }
  }
  return ops;
}

export interface CffGlyphs {
  /** CID-keyed: `charset[gid]` is the glyph's CID; otherwise the glyph's name
   * when it has a custom one ("g12", "uni0627"), or "sid:N" for a standard one. */
  cidKeyed: boolean;
  charset: Array<number | string>;
  /** A Type 1C font's own encoding: code -> glyph id. */
  encoding: Map<number, number>;
}

/** The glyph list of a CFF program: a bare CFF, or an OpenType wrapper's table. Null when unreadable. */
export function readCffGlyphs(program: Uint8Array): CffGlyphs | null {
  try {
    let cff = program;
    if (program.length > 4 && ((program[0]! << 24) | (program[1]! << 16) | (program[2]! << 8) | program[3]!) >>> 0 === OTTO_TAG) {
      const table = readTable(program, "CFF ");
      if (!table) return null;
      cff = table;
    }
    const nameIndex = readCffIndex(cff, cff[2]!);
    const topIndex = readCffIndex(cff, nameIndex.end);
    const stringIndex = readCffIndex(cff, topIndex.end);
    const top = topIndex.items[0];
    if (!top) return null;
    const ops = parseCffDict(cff, top[0], top[1]);
    const charStrings = ops.get(17)?.[0];
    if (charStrings === undefined) return null;
    const nGlyphs = u16(cff, charStrings);
    const cidKeyed = ops.has(1230);
    const charsetAt = ops.get(15)?.[0] ?? 0;
    const sids: number[] = [0];
    if (charsetAt > 2) {
      const fmt = cff[charsetAt]!;
      let p = charsetAt + 1;
      if (fmt === 0) for (; sids.length < nGlyphs; p += 2) sids.push(u16(cff, p));
      else if (fmt === 1 || fmt === 2) {
        while (sids.length < nGlyphs) {
          const first = u16(cff, p);
          const left = fmt === 1 ? cff[p + 2]! : u16(cff, p + 2);
          p += fmt === 1 ? 3 : 4;
          for (let k = 0; k <= left && sids.length < nGlyphs; k++) sids.push(first + k);
        }
      } else return null;
    } else for (let g = 1; g < nGlyphs; g++) sids.push(g); // predefined charsets: the standard order
    const charset = sids.map((sid) => {
      if (cidKeyed) return sid;
      const item = stringIndex.items[sid - 391];
      return item ? latin1(cff, item[0], item[1]) : `sid:${sid}`;
    });
    const encoding = new Map<number, number>();
    const encAt = ops.get(16)?.[0] ?? 0;
    if (!cidKeyed && encAt > 1) {
      const fmt = cff[encAt]! & 0x7f;
      let p = encAt + 1;
      if (fmt === 0) { const n = cff[p++]!; for (let k = 0; k < n; k++) encoding.set(cff[p + k]!, k + 1); }
      else if (fmt === 1) {
        const n = cff[p++]!;
        let gid = 1;
        for (let r = 0; r < n; r++, p += 2) for (let k = 0; k <= cff[p + 1]!; k++) encoding.set(cff[p]! + k, gid++);
      }
    }
    return { cidKeyed, charset, encoding };
  } catch {
    return null;
  }
}
