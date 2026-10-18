/** Shared low-level sfnt (TrueType/OpenType) binary readers: glyph coverage
 * (fontCoversText) and name/table access, used by the engine and by the
 * server's system font index. Ported from genoffice's
 * packages/font-metrics/src/sfnt.ts + apps/pdf/src/main/font-cmap.ts. */
import { i16, latin1, setU16, setU32, u16, u32, utf16beToString } from "./bytes.js";

export const OTTO_TAG = 0x4f54544f; // 'OTTO' - CFF-flavored sfnt
export const TTC_TAG = 0x74746366; // 'ttcf' - font collection

export interface TableDirEntry {
  tag: string;
  offset: number;
  length: number;
}

/** Table directory of a single sfnt face. `offset` is the face's own start
 * (0 for a plain ttf/otf, the face offset inside a .ttc for a collection). */
function readTableDir(font: Uint8Array, offset = 0): TableDirEntry[] {
  const numTables = u16(font, offset + 4);
  const entries: TableDirEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16;
    entries.push({
      tag: latin1(font, rec, rec + 4),
      offset: u32(font, rec + 8),
      length: u32(font, rec + 12),
    });
  }
  return entries;
}

function tableOffset(font: Uint8Array, tag: string, faceOffset = 0): number {
  const numTables = u16(font, faceOffset + 4);
  for (let i = 0; i < numTables; i++) {
    const rec = faceOffset + 12 + i * 16;
    if (latin1(font, rec, rec + 4) === tag) return u32(font, rec + 8);
  }
  return -1;
}

export function readTable(font: Uint8Array, tag: string, faceOffset = 0): Uint8Array | null {
  const entries = readTableDir(font, faceOffset);
  const entry = entries.find((e) => e.tag === tag);
  return entry ? font.subarray(entry.offset, entry.offset + entry.length) : null;
}

interface CmapSubtable {
  offset: number;
  format: number;
}

function cmapSubtable(font: Uint8Array): CmapSubtable | null {
  const cmap = tableOffset(font, "cmap");
  if (cmap < 0) return null;
  const n = u16(font, cmap + 2);
  let best: CmapSubtable | null = null;
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = u16(font, rec);
    const encoding = u16(font, rec + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = cmap + u32(font, rec + 4);
    const format = u16(font, offset);
    if (format === 12) return { offset, format };
    if (format === 4 && !best) best = { offset, format };
  }
  return best;
}

/** Glyph id for a codepoint, 0 = unmapped (.notdef) */
function glyphId(font: Uint8Array, sub: CmapSubtable, cp: number): number {
  const o = sub.offset;
  if (sub.format === 12) {
    const groups = u32(font, o + 12);
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      if (cp < u32(font, g)) return 0; // groups are sorted ascending
      if (cp <= u32(font, g + 4)) return u32(font, g + 8) + (cp - u32(font, g));
    }
    return 0;
  }
  if (cp > 0xffff) return 0;
  const segX2 = u16(font, o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffs = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    if (cp > u16(font, ends + s)) continue;
    if (cp < u16(font, starts + s)) return 0;
    const ro = u16(font, rangeOffs + s);
    if (ro === 0) return (cp + i16(font, deltas + s)) & 0xffff;
    const gi = u16(font, rangeOffs + s + ro + (cp - u16(font, starts + s)) * 2);
    return gi === 0 ? 0 : (gi + i16(font, deltas + s)) & 0xffff;
  }
  return 0;
}

const hasGlyph = (font: Uint8Array, sub: CmapSubtable, cp: number): boolean =>
  glyphId(font, sub, cp) !== 0;

/** The glyph a font's Unicode cmap (Windows BMP or full, or a Unicode
 * platform one) gives a codepoint; 0 when it has none or none for it. */
export function unicodeGlyph(font: Uint8Array, cp: number): number {
  const sub = cmapSubtable(font);
  return sub ? glyphId(font, sub, cp) : 0;
}

/** Every cmap subtable of a face, with its platform and encoding ids. */
function cmapSubtables(font: Uint8Array): Array<{ platform: number; encoding: number; sub: CmapSubtable }> {
  const cmap = tableOffset(font, "cmap");
  if (cmap < 0) return [];
  const out: Array<{ platform: number; encoding: number; sub: CmapSubtable }> = [];
  const n = u16(font, cmap + 2);
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const offset = cmap + u32(font, rec + 4);
    out.push({ platform: u16(font, rec), encoding: u16(font, rec + 2), sub: { offset, format: u16(font, offset) } });
  }
  return out;
}

/** Glyph id for a code in any of the subtable formats a simple font's
 * cmap takes (0 byte table, 6 trimmed table, 4, 12); 0 = unmapped. */
function glyphIdAny(font: Uint8Array, sub: CmapSubtable, cp: number): number {
  const o = sub.offset;
  if (sub.format === 0) return cp < 256 ? font[o + 6 + cp]! : 0;
  if (sub.format === 6) {
    const first = u16(font, o + 6);
    const count = u16(font, o + 8);
    return cp >= first && cp < first + count ? u16(font, o + 10 + 2 * (cp - first)) : 0;
  }
  if (sub.format === 4 || sub.format === 12) return glyphId(font, sub, cp);
  return 0;
}

/** The glyph a simple (one-byte) TrueType font draws for a code, as a PDF
 * viewer finds it: through a (3,0) symbol cmap (the code itself, or with
 * the 0xF0xx prefixes), else a Macintosh (1,0) one, else -- no cmap at all
 * -- the code as the glyph index. 0 when nothing fits (a font mapped by
 * glyph names isn't followed here). */
export function simpleTrueTypeGlyph(font: Uint8Array, code: number): number {
  const subs = cmapSubtables(font);
  if (!subs.length) return code;
  const symbol = subs.find((s) => s.platform === 3 && s.encoding === 0);
  if (symbol) {
    for (const prefix of [0, 0xf000, 0xf100, 0xf200]) {
      const gid = glyphIdAny(font, symbol.sub, prefix + code);
      if (gid) return gid;
    }
  }
  const mac = subs.find((s) => s.platform === 1 && s.encoding === 0);
  return mac ? glyphIdAny(font, mac.sub, code) : 0;
}

/** True when the font maps every drawn char of text (unparseable font = false).
 * Only line breaks are excluded: Unicode spaces (NBSP, U+3000, ...) are drawn like
 * any glyph and must be mapped -- \s would silently exempt them. */
export function fontCoversText(font: Uint8Array, text: string): boolean {
  const chars = [...text.replace(/[\r\n]/g, "")];
  if (chars.length === 0) return true;
  try {
    const sub = cmapSubtable(font);
    return sub !== null && chars.every((c) => hasGlyph(font, sub, c.codePointAt(0)!));
  } catch {
    return false;
  }
}

/** Extract a single face from a .ttc into a standalone sfnt (rewrite the table
 * directory, copy table data); passthrough for a plain ttf/otf. */
export function extractFace(buf: Uint8Array, faceOffset: number): Uint8Array {
  if (u32(buf, 0) !== TTC_TAG) return buf;
  const numTables = u16(buf, faceOffset + 4);
  let total = 12 + 16 * numTables;
  const entries: Array<{ dirPos: number; tOff: number; tLen: number; newOff: number }> = [];
  for (let t = 0; t < numTables; t++) {
    const e = faceOffset + 12 + 16 * t;
    const tLen = u32(buf, e + 12);
    entries.push({ dirPos: e, tOff: u32(buf, e + 8), tLen, newOff: total });
    total += (tLen + 3) & ~3;
  }
  const out = new Uint8Array(total);
  out.set(buf.subarray(faceOffset, faceOffset + 12), 0);
  for (let t = 0; t < numTables; t++) {
    const e = entries[t]!;
    out.set(buf.subarray(e.dirPos, e.dirPos + 8), 12 + 16 * t);
    setU32(out, e.newOff, 12 + 16 * t + 8);
    setU32(out, e.tLen, 12 + 16 * t + 12);
    out.set(buf.subarray(e.tOff, e.tOff + e.tLen), e.newOff);
  }
  return out;
}

/** A TrueType glyph's box as fractions of the em (xMin, yMin, xMax, yMax),
 * read from its glyf header; null for an empty glyph or another format. */
export function glyphBox(font: Uint8Array, gid: number): [number, number, number, number] | null {
  try {
    const head = tableOffset(font, "head");
    const loca = tableOffset(font, "loca");
    const glyf = tableOffset(font, "glyf");
    if (head < 0 || loca < 0 || glyf < 0 || gid < 0) return null;
    const upem = u16(font, head + 18) || 1000;
    const long = u16(font, head + 50) === 1;
    const start = long ? u32(font, loca + 4 * gid) : 2 * u16(font, loca + 2 * gid);
    const end = long ? u32(font, loca + 4 * gid + 4) : 2 * u16(font, loca + 2 * gid + 2);
    if (end <= start) return null;
    const at = glyf + start;
    return [i16(font, at + 2) / upem, i16(font, at + 4) / upem, i16(font, at + 6) / upem, i16(font, at + 8) / upem];
  } catch {
    return null;
  }
}

/** A glyph's advance width in font units, from hmtx; null when unreadable. */
export function glyphAdvance(font: Uint8Array, gid: number): number | null {
  try {
    const hhea = tableOffset(font, "hhea");
    const hmtx = tableOffset(font, "hmtx");
    if (hhea < 0 || hmtx < 0 || gid < 0) return null;
    const metrics = u16(font, hhea + 34);
    if (!metrics) return null;
    return u16(font, hmtx + 4 * Math.min(gid, metrics - 1));
  } catch {
    return null;
  }
}

/** The single-face sfnt with table `tag` replaced by (or added as) `data`:
 * the directory is rewritten, the other tables copied as they are. */
export function replaceSfntTable(font: Uint8Array, tag: string, data: Uint8Array): Uint8Array {
  const kept = readTableDir(font).filter((entry) => entry.tag !== tag);
  const tables = [...kept.map((entry) => ({ tag: entry.tag, data: font.subarray(entry.offset, entry.offset + entry.length) })), { tag, data }];
  let total = 12 + 16 * tables.length;
  const offsets = tables.map((table) => {
    const at = total;
    total += (table.data.length + 3) & ~3;
    return at;
  });
  const out = new Uint8Array(total);
  out.set(font.subarray(0, 4), 0);
  out[4] = tables.length >> 8;
  out[5] = tables.length & 255;
  tables.forEach((table, i) => {
    const rec = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[rec + k] = table.tag.charCodeAt(k);
    setU32(out, offsets[i]!, rec + 8);
    setU32(out, table.data.length, rec + 12);
    out.set(table.data, offsets[i]!);
  });
  return out;
}

/** The font with its cmap replaced by one holding exactly `entries`
 * (codepoint -> glyph id): a Windows/Unicode BMP format 4 subtable when the
 * BMP part fits one, and a Windows/UCS-4 format 12 subtable with everything.
 * PDFium (FreeType) and browsers both read these. */
export function withCmap(font: Uint8Array, entries: Map<number, number>): Uint8Array {
  const sorted = [...entries].filter(([cp, gid]) => cp >= 0 && cp <= 0x10ffff && gid > 0).sort((a, b) => a[0] - b[0]);
  // Runs of consecutive codepoints with consecutive glyph ids.
  const runs: Array<[number, number, number]> = [];
  for (const [cp, gid] of sorted) {
    const last = runs[runs.length - 1];
    if (last && cp === last[1] + 1 && gid === last[2] + (last[1] - last[0]) + 1) last[1] = cp;
    else runs.push([cp, cp, gid]);
  }
  const subtables: Array<{ platform: number; encoding: number; data: Uint8Array }> = [];
  const bmp = runs.filter(([, end]) => end < 0xffff);
  const segments = bmp.length + 1; // plus the 0xFFFF end segment
  if (segments <= 8000) {
    const sub = new Uint8Array(16 + 8 * segments);
    sub[1] = 4;
    setU16(sub, sub.length, 2);
    setU16(sub, 2 * segments, 6);
    const entrySelector = Math.floor(Math.log2(segments));
    const searchRange = 2 * 2 ** entrySelector;
    setU16(sub, searchRange, 8);
    setU16(sub, entrySelector, 10);
    setU16(sub, 2 * segments - searchRange, 12);
    const ends = 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    [...bmp, [0xffff, 0xffff, 0] as [number, number, number]].forEach(([start, end, gid], i) => {
      setU16(sub, end, ends + 2 * i);
      setU16(sub, start, starts + 2 * i);
      setU16(sub, (gid - start) & 0xffff, deltas + 2 * i);
    });
    subtables.push({ platform: 3, encoding: 1, data: sub });
  }
  const sub = new Uint8Array(16 + 12 * runs.length);
  sub[1] = 12;
  setU32(sub, sub.length, 4);
  setU32(sub, runs.length, 12);
  runs.forEach(([start, end, gid], i) => {
    setU32(sub, start, 16 + 12 * i);
    setU32(sub, end, 20 + 12 * i);
    setU32(sub, gid, 24 + 12 * i);
  });
  subtables.push({ platform: 3, encoding: 10, data: sub });
  const header = 4 + 8 * subtables.length;
  const cmap = new Uint8Array(header + subtables.reduce((n, table) => n + table.data.length, 0));
  setU16(cmap, subtables.length, 2);
  let at = header;
  subtables.forEach((table, i) => {
    setU16(cmap, table.platform, 4 + 8 * i);
    setU16(cmap, table.encoding, 6 + 8 * i);
    setU32(cmap, at, 8 + 8 * i);
    cmap.set(table.data, at);
    at += table.data.length;
  });
  return replaceSfntTable(font, "cmap", cmap);
}

/** The font with its cmap replaced by one naming glyph `gids[k]` as the
 * private-use codepoint U+E000 + k (and nothing else), so each wanted
 * glyph can be reached by a codepoint of its own. */
export function withPrivateUseCmap(font: Uint8Array, gids: number[]): Uint8Array {
  return withCmap(font, new Map(gids.map((gid, k) => [0xe000 + k, gid])));
}

/** True when a sfnt buffer is TrueType-flavored (glyf outlines, embed as
 * FontFile2/TRUETYPE); false = CFF-flavored (OTTO, embed as FontFile3/TYPE1). */
export const isTruetype = (b: Uint8Array): boolean => b.length >= 4 && u32(b, 0) !== OTTO_TAG;

/** Decode a sfnt `name` table string record to a JS string: platform 1 (Mac)
 * records are 1-byte-per-char (approximated here as latin1); platform 0/3
 * (Unicode/Windows) records are UTF-16BE. */
function decodeNameRecord(raw: Uint8Array, platformId: number): string {
  if (platformId === 1) return latin1(raw);
  if (raw.length % 2 !== 0) return "";
  return utf16beToString(raw);
}

export interface SfntNames {
  family: string;
  subfamily: string;
  fullName: string;
  postscriptName: string;
}

/** Read nameID 1 (family), 2 (subfamily), 4 (full name), 6 (PostScript name)
 * from a sfnt `name` table, preferring platform 3 (Windows) records. */
export function readNameTable(font: Uint8Array, faceOffset = 0): SfntNames {
  const out: SfntNames = { family: "", subfamily: "", fullName: "", postscriptName: "" };
  const nameOff = tableOffset(font, "name", faceOffset);
  if (nameOff < 0) return out;
  const count = u16(font, nameOff + 2);
  const stringOffset = nameOff + u16(font, nameOff + 4);
  const wanted: Record<number, keyof SfntNames> = {
    1: "family",
    2: "subfamily",
    4: "fullName",
    6: "postscriptName",
  };
  const bestPlatform: Record<number, number> = {};
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platformId = u16(font, rec);
    const nameId = u16(font, rec + 6);
    const key = wanted[nameId];
    if (!key) continue;
    // Prefer platform 3 (Windows/Unicode) over platform 1 (Mac) if both present.
    if (out[key] && (bestPlatform[nameId] ?? 0) >= platformId) continue;
    const length = u16(font, rec + 8);
    const off = u16(font, rec + 10);
    try {
      const raw = font.subarray(stringOffset + off, stringOffset + off + length);
      const decoded = decodeNameRecord(raw, platformId);
      if (decoded) {
        out[key] = decoded;
        bestPlatform[nameId] = platformId;
      }
    } catch {
      /* skip unparseable record */
    }
  }
  return out;
}
