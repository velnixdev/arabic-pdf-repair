# arabic-pdf-repair

[![npm](https://img.shields.io/npm/v/arabic-pdf-repair)](https://www.npmjs.com/package/arabic-pdf-repair) [![CI](https://github.com/velnixdev/arabic-pdf-repair/actions/workflows/ci.yml/badge.svg)](https://github.com/velnixdev/arabic-pdf-repair/actions/workflows/ci.yml) [![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/arabic-pdf-repair#provenance) [![license](https://img.shields.io/npm/l/arabic-pdf-repair)](LICENSE)

Fix Arabic text that comes out as garbage when you copy, search or extract it from an old PDF.

PDFs made by older Windows print-to-PDF tools (PDFCreator, Ghostscript, old Acrobat Distiller) store Arabic in one-byte TrueType fonts. The page looks perfect, but the file never says which letter each glyph is, so copying gives control characters, boxes, or Hebrew letters.

`arabic-pdf-repair` works out which letter each glyph is, from the glyph names the font carries, from its Arabic code page (Windows-1256, ISO-8859-6, Mac Arabic) or from the known layout of Diwan XT fonts, and writes a complete `/ToUnicode` map for it. The page is not redrawn: it looks exactly the same, but the text layer is correct.

```text
before (copied from the PDF):  ␁␂␃␄␅ ␊␋␃␌␆␇␈␉
after  (copied from the fixed PDF):  بطاقة كتاب نحو
```

## Why

Copy Arabic out of a PDF and you often get gibberish: letters in reverse order, disconnected forms, boxes, accented Latin characters, or Hebrew. The page looks fine because the PDF draws glyphs, but the file never says which Unicode letter each glyph is (the `/ToUnicode` map is missing, wrong or partial). Search, copy, screen readers and text extraction all depend on that map. This package writes it, and does not touch how the page looks.

## Install

```sh
npm install arabic-pdf-repair
```

Node 20 or newer. The only runtime dependency is [pdf-lib](https://pdf-lib.js.org/).

## API

```ts
import { readFile, writeFile } from "node:fs/promises";
import { repairTextLayer } from "arabic-pdf-repair";

const result = await repairTextLayer(new Uint8Array(await readFile("old.pdf")));
if (result) {
  await writeFile("fixed.pdf", result.bytes);
  console.log(result.fonts); // [{ name: "LegacyArabic", codes: 11 }]
}
```

`repairTextLayer(bytes: Uint8Array): Promise<TextRepair | null>`

- Returns `{ bytes, fonts }`: the repaired file, and for each fixed font its name and how many character codes got their letters.
- Returns `null` when nothing needed repair, or the file cannot be rewritten (damaged, or it needs a password to open). Running it on its own output also returns `null`.

`arabicGlyphName(name: string): { text: string; certain: boolean } | null` is the underlying lookup: the Arabic text a glyph name stands for (`afii62761` gives `ب`, `inhaa` gives `ح`). `certain` is `false` for names another script also uses, such as `alef`.

## CLI

```sh
npx arabic-pdf-repair in.pdf [out.pdf]
```

Prints each font it fixed and writes `out.pdf` (default: `in.repaired.pdf`). Prints `nothing to repair` when the file needs nothing.

## How it works

1. A font qualifies when its `/Encoding /Differences` array names at least three codes with Arabic glyph names. The names come in several families: Microsoft's `afii62xxx` joining forms, Adobe's `afii57xxx` letters, Monotype's `inhaa`, `midsad`, `fnalefmaqsurah`, Unicode-style `uniFE91`, and plain words such as `behmedial`.
2. Each name is mapped to its Arabic letters; a joining form (initial, medial, final) is read as its base letter, and ligatures such as lam-alef as two letters.
3. Names that Hebrew shares (`alef`, `kaf`, `mem`...) are trusted only inside a font that is plainly Arabic by its other names.
4. One known trap: Microsoft's fonts call the initial kaf `afii57410`, which Adobe's list gives to alef with madda. The glyph's own bounding box decides: an alef is a tall narrow stem, a kaf is not.
5. Diwan's Arabic XT fonts (`AXtManal`, `AXtMuna`, `AXtAmineFont`...) carry no useful names: each one-byte code stands for a fixed letter or joining form (ASMO 449 in the low half). Those codes are read from the font's cmap (TrueType), its CIDToGIDMap (Type0) or its encoding (Type 1). A glyph is read as alef only if it is tall, and Kufi layouts are left alone.
6. A glyph whose name contradicts its shape (a dash called `I`, a space called `less`) is read by the shape it draws, in documents that are being repaired.
7. Files protected with RC4, AES-128 or AES-256 (revisions 5 and 6) that open without a password are repaired and stay protected.
8. Arabic drawn in Latin slots (new in 0.3.0): a simple TrueType font with no `/ToUnicode` whose codes are an 8-bit Arabic code page (Windows-1256, ISO-8859-6 or Mac Arabic) while the PDF says WinAnsi reads as `ÇáÚÑÈíÉ`. The package scans the strings each font actually draws (page contents and form XObjects) and uses a code page only when they read as real Arabic by it: 90% of the high bytes Arabic, Arabic letters at least 60% of all letters, frequent Arabic letter pairs at least 35% of the pairs (in either direction, for visual-order lines), and any code read as alef must draw a tall stem. Latin text with accents is left alone.
9. CFF copies of XT fonts (new in 0.3.0): Type 1C fonts whose glyphs are called `g62`, and CID-keyed CFF fonts, keep the original glyph number but no letter. The glyph order of the XT families gives the letter, accepted only when the whole font passes the same Arabic pair-statistics check. For CID fonts it only fills codes the font's own `/ToUnicode` leaves out; existing entries are never overwritten.
10. A new `/ToUnicode` CMap is written for the font, keeping any Arabic the producer had already mapped correctly.

## Limits

- A font is fixed only when its letters can be known for sure: by glyph names, by an Arabic code page that the drawn text confirms, or by a known XT layout. Anything else is left alone rather than guessed.
- It does not OCR: scanned pages that are only pictures have no text to repair.
- It does not change how the page looks, and it does not reorder text. Reading order in the extracted text is what your PDF reader produces.
- Files that need a password to open, and badly damaged files, return `null`.
- The map gives each code its letter, but readers differ in how they order a letter and its hamza or madda mark, and some XT punctuation codes are not mapped yet.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

All fixtures are built in code (no PDFs are checked in). The tests build legacy-style PDFs in memory from a bundled font (Noto Naskh Arabic, SIL Open Font License, see `test/fixtures/OFL.txt`) and check that pdf.js extracts garbage before the repair and the expected Arabic after it.

## Releasing

Releases are published by GitHub Actions with npm provenance (trusted publishing, no tokens). Bump `version` in `package.json`, add a `CHANGELOG.md` entry, then push a matching tag:

```sh
git tag v0.3.2 && git push origin main v0.3.2
```

The workflow refuses a tag that does not match `package.json`.

## Security

See [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See `LICENSE` and `NOTICE`.

Made by GenPDF — edit Arabic PDFs in your browser at https://genpdf.com

---

## بالعربية

عند نسخ نص عربي من ملفات PDF القديمة (التي أنشأتها برامج مثل PDFCreator أو Ghostscript) يظهر نص مشوّه. تقرأ هذه المكتبة أسماء الحروف داخل الخطوط وتكتب جدول ToUnicode كاملاً، فيُنسخ النص صحيحاً دون أن يتغيّر شكل الصفحة.
