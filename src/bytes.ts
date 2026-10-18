/** Portable byte helpers for the text engine, which runs both in Node (server
 * fallback) and in the browser (Web Worker) -- the engine never touches
 * Node's Buffer. Big-endian reads match Buffer's readUInt16BE & co, including
 * throwing a RangeError past the end. */

const views = new WeakMap<Uint8Array, DataView>();

/** A DataView over exactly `bytes` (honouring its byteOffset -- a subarray's
 * view must not start at the underlying buffer's 0). Cached per array. */
function viewOf(bytes: Uint8Array): DataView {
  let view = views.get(bytes);
  if (!view) {
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    views.set(bytes, view);
  }
  return view;
}

export const u16 = (bytes: Uint8Array, offset: number): number => viewOf(bytes).getUint16(offset);
export const i16 = (bytes: Uint8Array, offset: number): number => viewOf(bytes).getInt16(offset);
export const u32 = (bytes: Uint8Array, offset: number): number => viewOf(bytes).getUint32(offset);
export const i32 = (bytes: Uint8Array, offset: number): number => viewOf(bytes).getInt32(offset);
export const setU16 = (bytes: Uint8Array, value: number, offset: number): void => viewOf(bytes).setUint16(offset, value);
export const setU32 = (bytes: Uint8Array, value: number, offset: number): void => viewOf(bytes).setUint32(offset, value);

/** Unsigned big-endian integer of 1-4 bytes (Buffer.readUIntBE for those sizes). */
export function uintBE(bytes: Uint8Array, offset: number, size: number): number {
  if (offset < 0 || offset + size > bytes.length) throw new RangeError("Offset is outside the bounds of the font data.");
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + bytes[offset + i]!;
  return value;
}

/** One byte per char, like Buffer#toString("latin1", start, end). */
export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = "";
  for (let i = Math.max(0, start); i < Math.min(end, bytes.length); i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

const CHUNK = 0x2000;

function fromCodeUnits(units: number[] | Uint16Array): string {
  let out = "";
  for (let i = 0; i < units.length; i += CHUNK) {
    out += String.fromCharCode(...(units.slice(i, i + CHUNK) as unknown as number[]));
  }
  return out;
}

/** UTF-16 code units, kept as-is (lone surrogates included, like Buffer's
 * "utf16le" decoding -- TextDecoder would replace them with U+FFFD). */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const count = bytes.length >> 1;
  const units = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const a = bytes[2 * i]!;
    const b = bytes[2 * i + 1]!;
    units[i] = littleEndian ? a | (b << 8) : (a << 8) | b;
  }
  return fromCodeUnits(units);
}

export const utf16leToString = (bytes: Uint8Array): string => decodeUtf16(bytes, true);
export const utf16beToString = (bytes: Uint8Array): string => decodeUtf16(bytes, false);

/** `text` plus a NUL terminator as UTF-16LE bytes (Buffer.from(s + "\0", "utf16le")). */
export function utf16leWithNul(text: string): Uint8Array {
  const out = new Uint8Array((text.length + 1) * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out[2 * i] = unit & 0xff;
    out[2 * i + 1] = unit >> 8;
  }
  return out;
}

const utf8 = new TextDecoder("utf-8");
export const utf8ToString = (bytes: Uint8Array): string => utf8.decode(bytes);
