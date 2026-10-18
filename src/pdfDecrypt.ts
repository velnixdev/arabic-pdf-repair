/** The standard security handler of PDF 1.4-2.0 (revisions 2-4: RC4 40 to
 * 128 bits, AES-128; revisions 5-6: AES-256), for a document that opens without a password -- the
 * usual case: a file "protected" only against copying or printing. Enough
 * to read a stream and write one back encrypted, so a repair can keep the
 * file's protection as it was. Runs in the browser and in Node (MD5 and RC4
 * here; AES and SHA-2 through WebCrypto). */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
  const length = ((data.length + 8) >> 6) * 64 + 64;
  const message = new Uint8Array(length);
  message.set(data);
  message[data.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(length - 8, (data.length * 8) >>> 0, true);
  view.setUint32(length - 4, Math.floor(data.length / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let block = 0; block < length; block += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + K[i]! + view.getUint32(block + 4 * g, true)) | 0;
      a = d; d = c; c = b;
      b = (b + ((sum << S[i]!) | (sum >>> (32 - S[i]!)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, k) => outView.setUint32(4 * k, word >>> 0, true));
  return out;
}

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, k) => byte === b[k]);
const bytesOf = (value: unknown) => (value instanceof PDFString || value instanceof PDFHexString ? value.asBytes() : null);

export interface StreamCipher {
  decrypt(ref: PDFRef, data: Uint8Array): Promise<Uint8Array>;
  encrypt(ref: PDFRef, data: Uint8Array): Promise<Uint8Array>;
}

const subtle = () => globalThis.crypto.subtle;
const digest = async (name: string, data: Uint8Array) => new Uint8Array(await subtle().digest(name, new Uint8Array(data)));

/** AES-CBC without padding, which WebCrypto doesn't offer: encrypting drops
 * the padding block it appends; decrypting first appends the block that
 * decrypts to a whole padding block. */
async function aesRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array, usage: "encrypt" | "decrypt"): Promise<Uint8Array> {
  const handle = await subtle().importKey("raw", new Uint8Array(key), "AES-CBC", false, ["encrypt", "decrypt"]);
  if (usage === "encrypt") return new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: new Uint8Array(iv) }, handle, new Uint8Array(data))).slice(0, data.length);
  const last = data.length >= 16 ? data.slice(-16) : iv;
  const pad = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: new Uint8Array(last) }, handle, new Uint8Array(16).fill(16))).slice(0, 16);
  return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv: new Uint8Array(iv) }, handle, concat(data, pad)));
}

/** Algorithm 2.B (revision 6; revision 5 stops at its first SHA-256). */
async function hardenedHash(password: Uint8Array, salt: Uint8Array, r: number): Promise<Uint8Array> {
  let k = await digest("SHA-256", concat(password, salt));
  if (r < 6) return k;
  let e: Uint8Array = new Uint8Array();
  for (let round = 0; round < 64 || e[e.length - 1]! > round - 32; round++) {
    const once = concat(password, k);
    const k1 = new Uint8Array(once.length * 64);
    for (let i = 0; i < 64; i++) k1.set(once, i * once.length);
    e = await aesRaw(k.subarray(0, 16), k.subarray(16, 32), k1, "encrypt");
    const pick = e.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3;
    k = await digest(["SHA-256", "SHA-384", "SHA-512"][pick]!, e);
  }
  return k.subarray(0, 32);
}

/** The AES-256 cipher (revisions 5 and 6) from the empty user password, or null. */
async function aes256Cipher(user: Uint8Array, userKey: Uint8Array | null): Promise<StreamCipher | null> {
  if (user.length < 48 || !userKey || userKey.length < 32) return null;
  const password = new Uint8Array();
  for (const r of [6, 5]) {
    if (!equal(await hardenedHash(password, user.subarray(32, 40), r), user.subarray(0, 32))) continue;
    const key = await aesRaw(await hardenedHash(password, user.subarray(40, 48), r), new Uint8Array(16), userKey.subarray(0, 32), "decrypt");
    const handle = (usage: "encrypt" | "decrypt") => subtle().importKey("raw", new Uint8Array(key), "AES-CBC", false, [usage]);
    return {
      async decrypt(_, data) {
        if (data.length < 32 || data.length % 16) return new Uint8Array();
        return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv: data.slice(0, 16) }, await handle("decrypt"), data.slice(16)));
      },
      async encrypt(_, data) {
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
        return concat(iv, new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv }, await handle("encrypt"), new Uint8Array(data))));
      },
    };
  }
  return null;
}

/** The cipher of a document encrypted by the standard handler with an empty
 * user password, or null: not encrypted that way (another handler, a
 * password needed). */
export async function standardCipher(pdf: PDFDocument): Promise<StreamCipher | null> {
  const lookup = (object: unknown) => (object instanceof PDFRef ? pdf.context.lookup(object) : object);
  const encrypt = lookup(pdf.context.trailerInfo.Encrypt);
  const ids = lookup(pdf.context.trailerInfo.ID);
  if (!(encrypt instanceof PDFDict) || lookup(encrypt.get(PDFName.of("Filter")))?.toString() !== "/Standard") return null;
  const number = (key: string) => { const value = lookup(encrypt.get(PDFName.of(key))); return value instanceof PDFNumber ? value.asNumber() : undefined; };
  const v = number("V") ?? 0, r = number("R") ?? 0, p = number("P");
  const owner = bytesOf(lookup(encrypt.get(PDFName.of("O")))), user = bytesOf(lookup(encrypt.get(PDFName.of("U"))));
  const id0 = ids instanceof PDFArray ? bytesOf(lookup(ids.get(0))) ?? new Uint8Array() : new Uint8Array();
  if (v === 5 && (r === 5 || r === 6)) {
    const filters = lookup(encrypt.get(PDFName.of("CF")));
    const name = lookup(encrypt.get(PDFName.of("StmF")))?.toString().slice(1) ?? "Identity";
    const filter = filters instanceof PDFDict ? lookup(filters.get(PDFName.of(name))) : null;
    const method = filter instanceof PDFDict ? lookup(filter.get(PDFName.of("CFM")))?.toString() : undefined;
    if (name !== "StdCF" || method !== "/AESV3" || !user) return null;
    return aes256Cipher(user, bytesOf(lookup(encrypt.get(PDFName.of("UE")))));
  }
  if (r < 2 || r > 4 || p === undefined || !owner || owner.length < 32 || !user || user.length < 32) return null;
  let aes = false;
  let n = v === 1 ? 5 : (number("Length") ?? 40) / 8;
  if (v === 4) {
    const filters = lookup(encrypt.get(PDFName.of("CF")));
    const name = lookup(encrypt.get(PDFName.of("StmF")))?.toString().slice(1) ?? "Identity";
    const filter = filters instanceof PDFDict ? lookup(filters.get(PDFName.of(name))) : null;
    const method = filter instanceof PDFDict ? lookup(filter.get(PDFName.of("CFM")))?.toString() : undefined;
    if (method === "/AESV2") aes = true;
    else if (method !== "/V2") return null;
    if (name !== "StdCF") return null;
    const length = filter instanceof PDFDict ? lookup(filter.get(PDFName.of("Length"))) : null;
    n = aes ? 16 : length instanceof PDFNumber ? (length.asNumber() > 40 ? length.asNumber() / 8 : length.asNumber()) : n;
  } else if (v !== 1 && v !== 2) return null;
  if (!Number.isInteger(n) || n < 5 || n > 16) return null;

  // Algorithm 2: the file key from the empty user password.
  const permissions = new Uint8Array(4);
  new DataView(permissions.buffer).setInt32(0, p, true);
  const metadata = lookup(encrypt.get(PDFName.of("EncryptMetadata")))?.toString() === "false" && r >= 4;
  let key = md5(concat(PAD, owner.subarray(0, 32), permissions, id0, metadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array()));
  if (r >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  key = key.slice(0, n);
  // Algorithms 4 and 5: the key is right when it gives /U back.
  if (r === 2) {
    if (!equal(rc4(key, PAD), user.subarray(0, 32))) return null;
  } else {
    let check = md5(concat(PAD, id0));
    for (let i = 0; i < 20; i++) check = rc4(key.map((byte) => byte ^ i), check);
    if (!equal(check, user.subarray(0, 16))) return null;
  }

  const objectKey = (ref: PDFRef) => {
    const { objectNumber: num, generationNumber: gen } = ref;
    const salt = aes ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) : new Uint8Array();
    return md5(concat(key, Uint8Array.of(num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255), salt)).slice(0, Math.min(n + 5, 16));
  };
  const aesKey = (ref: PDFRef, usage: "encrypt" | "decrypt") => globalThis.crypto.subtle.importKey("raw", objectKey(ref), "AES-CBC", false, [usage]);
  return {
    async decrypt(ref, data) {
      if (!aes) return rc4(objectKey(ref), data);
      if (data.length < 32 || data.length % 16) return new Uint8Array();
      return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-CBC", iv: data.slice(0, 16) }, await aesKey(ref, "decrypt"), data.slice(16)));
    },
    async encrypt(ref, data) {
      if (!aes) return rc4(objectKey(ref), data);
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
      return concat(iv, new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-CBC", iv }, await aesKey(ref, "encrypt"), new Uint8Array(data))));
    },
  };
}
