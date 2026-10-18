import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, beginText, endText, moveText, setFontAndSize, showText } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { repairTextLayer } from "../src/index.js";
import { SENTENCE, fontkitFont, legacyDocument, loadFont, macCmap, swapCmap } from "./helpers.js";

/** The page's text as a reader (pdf.js) extracts it. */
async function extract(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  await doc.destroy();
  return content.items.map((item) => ("str" in item ? item.str : "")).join("").replace(/\s+/g, " ").trim();
}

const hexOf = (codes: number[], width = 2) => codes.map((code) => code.toString(16).padStart(width, "0")).join("");

/** A PDF drawing "باب" in a Diwan XT font as Mac layout software wrote it:
 * no glyph names, no ToUnicode, a Macintosh cmap from the XT code (0x84 the
 * initial beh, 0x47 the alef, 0x48 the beh) to the glyph -- as a one-byte
 * TrueType font, or as a CID font whose codes are the glyphs. */
async function xtFixture(kind: "TrueType" | "Type0"): Promise<Uint8Array> {
  const face = loadFont();
  const font = fontkitFont(face);
  const forms = new Map([[0x47, "ا"], [0x48, "ﺏ"], [0x84, "ﺑ"]]);
  const first = 0x47, count = 0x84 - first + 1;
  const glyphs = Array.from({ length: count }, (_, k) => (forms.has(first + k) ? font.glyphForCodePoint(forms.get(first + k)!.codePointAt(0)!) : null));
  const gids = glyphs.map((glyph) => glyph?.id ?? 0);
  const program = swapCmap(face, macCmap(first, gids));
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const context = doc.context;
  const descriptor = context.register(context.obj({
    Type: "FontDescriptor", FontName: "ABCDEF+AXtTest", Flags: 4, FontBBox: [-500, -300, 1500, 1000], ItalicAngle: 0, Ascent: 900, Descent: -250, CapHeight: 700, StemV: 80,
    FontFile2: context.register(context.flateStream(program, { Length1: program.length })),
  }));
  const logical = [0x84, 0x47, 0x48];
  let fontRef, hex: string;
  if (kind === "TrueType") {
    const widths = glyphs.map((glyph) => Math.round(((glyph?.advanceWidth ?? 0) * 1000) / font.unitsPerEm));
    fontRef = context.register(context.obj({ Type: "Font", Subtype: "TrueType", BaseFont: "ABCDEF+AXtTest", FirstChar: first, LastChar: 0x84, Widths: widths, FontDescriptor: descriptor }));
    hex = hexOf([...logical].reverse());
  } else {
    const cidFont = context.register(context.obj({
      Type: "Font", Subtype: "CIDFontType2", BaseFont: "ABCDEF+AXtTest", CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
      FontDescriptor: descriptor, CIDToGIDMap: "Identity", DW: 500,
    }));
    fontRef = context.register(context.obj({ Type: "Font", Subtype: "Type0", BaseFont: "ABCDEF+AXtTest", Encoding: "Identity-H", DescendantFonts: [cidFont] }));
    hex = hexOf([...logical].reverse().map((code) => gids[code - first]!), 4);
  }
  const key = page.node.newFontDictionary("XT", fontRef);
  page.pushOperators(beginText(), setFontAndSize(key, 18), moveText(300, 700), showText(PDFHexString.of(hex)), endText());
  return doc.save({ useObjectStreams: false });
}

const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
function rc4(key: Buffer, data: Uint8Array): Buffer {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) { i = (i + 1) & 255; j = (j + s[i]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!; }
  return out;
}
const aesRaw = (bits: 128 | 256, key: Buffer, iv: Buffer, data: Buffer) => { const cipher = createCipheriv(`aes-${bits}-cbc`, key, iv).setAutoPadding(false); return Buffer.concat([cipher.update(data), cipher.final()]); };

/** Algorithm 2.B of PDF 2.0 (revision 6). */
function hash2B(password: Buffer, salt: Buffer, extra: Buffer): Buffer {
  let k = createHash("sha256").update(Buffer.concat([password, salt, extra])).digest();
  let e = Buffer.alloc(0);
  for (let round = 0; round < 64 || e[e.length - 1]! > round - 32; round++) {
    e = aesRaw(128, k.subarray(0, 16), k.subarray(16, 32), Buffer.concat(Array(64).fill(Buffer.concat([password, k, extra]))));
    k = createHash(["sha256", "sha384", "sha512"][e.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3]!).update(e).digest();
  }
  return k.subarray(0, 32);
}

/** The legacy fixture as a "protected" file opening without a password: the
 * standard handler, revision 3 (RC4 128), 4 (AES-128) or 6 (AES-256),
 * written with Node's own MD5, SHA-2 and AES, apart from the code under test. */
async function encryptedFixture(mode: "rc4" | "aes" | "aes256"): Promise<Uint8Array> {
  const doc = await legacyDocument();
  const context = doc.context;
  const aes = mode !== "rc4";
  const owner = randomBytes(32), id = randomBytes(16), p = -1340;
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(p);
  let key = md5(PAD, owner, permissions, id);
  for (let i = 0; i < 50; i++) key = md5(key);
  let user: Buffer = md5(PAD, id);
  for (let i = 0; i < 20; i++) user = rc4(Buffer.from(key.map((byte) => byte ^ i)), user);
  let filter: Record<string, unknown> = aes ? { V: 4, R: 4, CF: { StdCF: { CFM: "AESV2", Length: 16, AuthEvent: "DocOpen" } }, StmF: "StdCF", StrF: "StdCF" } : { V: 2, R: 3 };
  let o = owner, u = Buffer.concat([user, Buffer.alloc(16)]);
  if (mode === "aes256") {
    key = randomBytes(32);
    const none = Buffer.alloc(0), zero = Buffer.alloc(16), ownerPassword = Buffer.from("owner");
    const [uvs, uks, ovs, oks] = [randomBytes(8), randomBytes(8), randomBytes(8), randomBytes(8)];
    u = Buffer.concat([hash2B(none, uvs, none), uvs, uks]);
    o = Buffer.concat([hash2B(ownerPassword, ovs, u), ovs, oks]);
    const perms = Buffer.concat([permissions, Buffer.from([255, 255, 255, 255]), Buffer.from("Tadb"), randomBytes(4)]);
    const ecb = createCipheriv("aes-256-ecb", key, null).setAutoPadding(false);
    filter = {
      V: 5, R: 6, Length: 256, CF: { StdCF: { CFM: "AESV3", Length: 32, AuthEvent: "DocOpen" } }, StmF: "StdCF", StrF: "StdCF",
      UE: PDFHexString.of(aesRaw(256, hash2B(none, uks, none), zero, key).toString("hex")),
      OE: PDFHexString.of(aesRaw(256, hash2B(ownerPassword, oks, u), zero, key).toString("hex")),
      Perms: PDFHexString.of(Buffer.concat([ecb.update(perms), ecb.final()]).toString("hex")),
    };
  }
  const seal = (num: number, gen: number, data: Uint8Array) => {
    const objectKey = mode === "aes256" ? key : md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, gen >> 8]), aes ? Buffer.from("sAlT") : Buffer.alloc(0)).subarray(0, 16);
    if (!aes) return rc4(objectKey, data);
    const iv = randomBytes(16);
    const cipher = createCipheriv(mode === "aes256" ? "aes-256-cbc" : "aes-128-cbc", objectKey, iv);
    return Buffer.concat([iv, cipher.update(data), cipher.final()]);
  };
  const strings = (value: unknown, num: number, gen: number): unknown => {
    if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.of(seal(num, gen, value.asBytes()).toString("hex"));
    if (value instanceof PDFDict) for (const [name, item] of value.entries()) value.set(name, strings(item, num, gen) as never);
    if (value instanceof PDFArray) for (let k = 0; k < value.size(); k++) value.set(k, strings(value.get(k), num, gen) as never);
    return value;
  };
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    const { objectNumber: num, generationNumber: gen } = ref;
    if (object instanceof PDFStream) { strings(object.dict, num, gen); context.assign(ref, PDFRawStream.of(object.dict, seal(num, gen, object.getContents()))); }
    else strings(object, num, gen);
  }
  context.trailerInfo.Encrypt = context.register(context.obj({
    Filter: "Standard", Length: 128, ...filter, P: p,
    O: PDFHexString.of(o.toString("hex")), U: PDFHexString.of(u.toString("hex")),
  } as never));
  context.trailerInfo.ID = context.obj([PDFHexString.of(id.toString("hex")), PDFHexString.of(id.toString("hex"))]);
  return doc.save({ useObjectStreams: false });
}

describe("Diwan XT fonts", () => {
  it.each(["TrueType", "Type0"] as const)("reads an XT font (%s) by its codes' fixed layout", async (kind) => {
    const bytes = await xtFixture(kind);
    expect(await extract(bytes)).not.toContain("باب");
    const repaired = await repairTextLayer(bytes);
    expect(repaired?.fonts).toEqual([{ name: "AXtTest", codes: 3 }]);
    expect(await extract(repaired!.bytes)).toBe("باب");
    expect(await repairTextLayer(repaired!.bytes)).toBeNull();
  });

  it("reads a Type 1 XT font by the Macintosh slot of each glyph name, a hamza with no advance as a mark", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const context = doc.context;
    // "G" the alef, "product" (0xb8) a lam, "H" the beh, "C" (0x43) the hamza.
    const names = ["G", "product", "H", "C", "space"];
    const fontRef = context.register(context.obj({
      Type: "Font", Subtype: "Type1", BaseFont: "AXtMuna", FirstChar: 1, LastChar: 5, Widths: [250, 400, 500, 0, 250],
      Encoding: context.obj({ Type: "Encoding", Differences: [1, ...names.map((name) => PDFName.of(name))] }),
    }));
    const key = page.node.newFontDictionary("XT", fontRef);
    // "أب لب" in drawing order.
    page.pushOperators(beginText(), setFontAndSize(key, 18), moveText(300, 700), showText(PDFHexString.of(hexOf([3, 2, 5, 3, 4, 1]))), endText());
    const repaired = await repairTextLayer(await doc.save({ useObjectStreams: false }));
    expect(repaired?.fonts).toEqual([{ name: "AXtMuna", codes: 4 }]);
  });
});

describe("protected files", () => {
  it.each([["RC4", "rc4"], ["AES-128", "aes"], ["AES-256", "aes256"]] as const)("repairs a file protected with %s, and leaves it protected", async (_, mode) => {
    const bytes = await encryptedFixture(mode);
    expect((await PDFDocument.load(bytes, { ignoreEncryption: true })).isEncrypted).toBe(true);
    const repaired = await repairTextLayer(bytes);
    expect(repaired?.fonts).toEqual([{ name: "LegacyArabic", codes: 11 }]);
    expect((await PDFDocument.load(repaired!.bytes, { ignoreEncryption: true })).isEncrypted).toBe(true);
    expect(await extract(repaired!.bytes)).toBe(SENTENCE);
    expect(await repairTextLayer(repaired!.bytes)).toBeNull();
  });
});

describe("misnamed glyphs", () => {
  it("reads a glyph by its shape when its name can't be what it draws (a dash called \"I\", a space called \"less\")", async () => {
    // Drawn on the legacy fixture's page: the repair only runs where Arabic needs it.
    const doc = await legacyDocument();
    const page = doc.getPage(0);
    const face = loadFont();
    const font = fontkitFont(face);
    const gids = ["-", " "].map((ch) => font.glyphForCodePoint(ch.codePointAt(0)!).id);
    const program = swapCmap(face, macCmap(1, gids));
    const context = doc.context;
    const descriptor = context.register(context.obj({
      Type: "FontDescriptor", FontName: "GHIJKL+Calligraphic", Flags: 4, FontBBox: [-500, -300, 1500, 1000], ItalicAngle: 0, Ascent: 900, Descent: -250, CapHeight: 700, StemV: 80,
      FontFile2: context.register(context.flateStream(program, { Length1: program.length })),
    }));
    const fontRef = context.register(context.obj({
      Type: "Font", Subtype: "TrueType", BaseFont: "GHIJKL+Calligraphic", FirstChar: 1, LastChar: 2, Widths: [500, 300], FontDescriptor: descriptor,
      Encoding: context.obj({ Type: "Encoding", BaseEncoding: "WinAnsiEncoding", Differences: [1, PDFName.of("I"), PDFName.of("less")] }),
    }));
    const key = page.node.newFontDictionary("Calligraphic", fontRef);
    page.pushOperators(beginText(), setFontAndSize(key, 18), moveText(100, 600), showText(PDFHexString.of("010201")), endText());
    const bytes = await doc.save({ useObjectStreams: false });
    expect(await extract(bytes)).toContain("I<I");
    const repaired = await repairTextLayer(bytes);
    expect(repaired?.fonts).toContainEqual({ name: "Calligraphic", codes: 2 });
    const after = await extract(repaired!.bytes);
    expect(after).toContain("- -");
    expect(after).not.toContain("I<I");
    expect(await repairTextLayer(repaired!.bytes)).toBeNull();
  });
});
