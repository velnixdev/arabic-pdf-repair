# arabic-pdf-repair

[![npm](https://img.shields.io/npm/v/arabic-pdf-repair)](https://www.npmjs.com/package/arabic-pdf-repair)
[![CI](https://github.com/velnixdev/arabic-pdf-repair/actions/workflows/ci.yml/badge.svg)](https://github.com/velnixdev/arabic-pdf-repair/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/arabic-pdf-repair#provenance)
[![license](https://img.shields.io/npm/l/arabic-pdf-repair)](LICENSE)

**Make Arabic text in old PDFs copyable, searchable and extractable again, without changing how the pages look.**

```text
Copied from the original PDF:   ÈØÇÞÉ ßÊÇÈ äÍæ
Copied from the repaired PDF:   بطاقة كتاب نحو
```

[العربية](#بالعربية) · [Quick start](#quick-start) · [API](#api) · [What it fixes](#what-it-fixes) · [Limits](#limits) · [FAQ](#faq) · [How it works](docs/how-it-works.md)

---

## The problem

Many PDFs made by older Windows tools (PDFCreator, Ghostscript, old Acrobat Distiller, Arabic word processors) look perfect on screen. But when you copy the Arabic you get:

- accented Latin letters: `ÇáÚÑÈíÉ`
- boxes, control characters or Hebrew letters
- nothing at all in search, screen readers and text extraction

The page is drawn from font glyphs. What is missing is the `/ToUnicode` map that tells a reader which letter each glyph is. This package rebuilds that map and touches nothing else, so the pages look exactly the same.

## Quick start

No install needed:

```sh
npx arabic-pdf-repair old.pdf
```

```text
fixed LegacyArabic: 41 codes
wrote old.repaired.pdf
```

- Choose the output name with a second argument: `npx arabic-pdf-repair old.pdf fixed.pdf`.
- If the file needs nothing, it prints `nothing to repair` and writes nothing.

## Install

```sh
npm install arabic-pdf-repair
```

- Node.js 20 or newer. ES module only (`import`, not `require`).
- One runtime dependency: [pdf-lib](https://pdf-lib.js.org/).
- The library uses no Node APIs, so it also runs in the browser and in web workers. Only the CLI reads and writes files.

## API

### `repairTextLayer(bytes)`

```ts
import { readFile, writeFile } from "node:fs/promises";
import { repairTextLayer } from "arabic-pdf-repair";

const input = new Uint8Array(await readFile("old.pdf"));
const result = await repairTextLayer(input);

if (result) {
  await writeFile("fixed.pdf", result.bytes);
  console.log(result.fonts); // [{ name: "LegacyArabic", codes: 41 }]
} else {
  console.log("nothing to repair");
}
```

| | |
|---|---|
| **Takes** | `Uint8Array`: the bytes of a PDF file. |
| **Returns** | `Promise<TextRepair \| null>` |
| `result.bytes` | The repaired PDF. |
| `result.fonts` | Each font that was fixed, as `{ name, codes }`. `codes` is how many character codes got their letters. |
| `null` | Nothing needed repair, or the file cannot be rewritten (damaged, or it needs a password to open). |

It does not throw on a broken PDF: it returns `null`. Running it again on its own output also returns `null`.

### `arabicGlyphName(name)`

The lookup underneath: which Arabic text a glyph name stands for.

```ts
import { arabicGlyphName } from "arabic-pdf-repair";

arabicGlyphName("afii62761"); // { text: "ب", certain: true }
arabicGlyphName("inhaa");     // { text: "ح", certain: true }
arabicGlyphName("alef");      // { text: "ا", certain: false }  Hebrew fonts use this name too
arabicGlyphName("A");         // null
```

### Repair a whole folder

```ts
import { readdir, readFile, writeFile } from "node:fs/promises";
import { repairTextLayer } from "arabic-pdf-repair";

for (const name of await readdir("in")) {
  if (!name.toLowerCase().endsWith(".pdf")) continue;
  const result = await repairTextLayer(new Uint8Array(await readFile(`in/${name}`)));
  if (result) await writeFile(`out/${name}`, result.bytes);
}
```

## What it fixes

| Fonts in the PDF | What you get when copying | Since |
|---|---|---|
| One-byte TrueType or Type 1 fonts with Arabic glyph names (`afii57xxx`, `afii62xxx`, `uniFE91`, `behmedial`, Monotype names) | control characters, boxes, Hebrew | 0.1.0 |
| Diwan Arabic XT fonts (`AXtManal`, `AXtMuna`, …) | Latin letters and symbols | 0.2.0 |
| Arabic stored in Latin slots: Windows-1256, ISO-8859-6 or Mac Arabic codes that the PDF calls WinAnsi | `ÇáÚÑÈíÉ` | 0.3.0 |
| CFF copies of XT fonts (glyphs called `g62`, CID-keyed CFF) | nothing, or wrong letters | 0.3.0 |

It also handles:

- **Encrypted files** that open without a password (RC4, AES-128, AES-256). They stay encrypted.
- **Partly correct maps.** Letters the producer already mapped correctly are kept. In CID fonts it only fills the gaps.
- **Persian and Urdu letters** that these code pages contain (پ چ ژ گ ک ی ٹ ڈ ڑ ے).

## Limits

- **It only fixes what it can prove.** A font is changed only when its letters are shown by glyph names, by a code page that the drawn text confirms, or by a known XT layout. Anything uncertain is left alone, never guessed.
- **No OCR.** Scanned pages are pictures, so there is no text to repair.
- **No reordering.** The order of extracted text is decided by your PDF reader.
- **Digital signatures break.** The file is rewritten, so a signed PDF's signature no longer validates. Keep the signed original.
- **Password-protected files** (needing a password to open) and badly damaged files return `null`.
- Readers differ in how they order a letter and its hamza or madda mark. A few XT punctuation codes are not mapped yet.

## Is it safe to run on my files?

- **The pages look exactly the same.** Only `/ToUnicode` maps are added or completed. Page drawing, fonts and images are not changed.
- **Nothing leaves your machine.** No network calls, no telemetry.
- **Your original file is kept.** The CLI writes a new file unless you name the original as the output.
- **Releases are verifiable.** Every version from 0.3.1 on is built and published by GitHub Actions from this repository, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Check it with `npm audit signatures`.

## FAQ

**Why not OCR the PDF instead?**
OCR re-reads the picture and makes mistakes, especially with Arabic joining forms and diacritics. The fonts in these files already say which glyph is which letter. Reading that is exact, and takes milliseconds.

**Does the file size change?**
A little. The file is saved again as a whole, and each repaired font gets a small map (a few kilobytes).

**My file still copies badly. What now?**
Open an [issue](https://github.com/velnixdev/arabic-pdf-repair/issues/new/choose) with the font names (`pdffonts file.pdf` lists them). If you can, attach a sample page with no private content.

**Can I edit the Arabic text, not only copy it?**
That is outside this package. [GenPDF](https://genpdf.com) edits Arabic PDFs in the browser.

## How it works

In short: it finds fonts with no usable `/ToUnicode` map, works out each glyph's letter from what the font carries, checks that against the text the pages actually draw, and writes a new map. The full rules are in [docs/how-it-works.md](docs/how-it-works.md).

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests and releases.
Please report security problems privately: see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Third-party attributions are in [NOTICE](NOTICE).

Made by [GenPDF](https://genpdf.com).

---

## بالعربية

<div dir="rtl">

**إصلاح النص العربي في ملفات PDF القديمة ليصبح قابلاً للنسخ والبحث والاستخراج، دون أي تغيير في شكل الصفحات.**

عند نسخ نص عربي من ملفات PDF أنشأتها برامج قديمة (مثل PDFCreator أو Ghostscript أو برامج النشر العربية) يظهر نص مشوّه مثل `ÇáÚÑÈíÉ` أو مربعات أو حروف عبرية. السبب أن الملف لا يحتوي على جدول `ToUnicode` الذي يربط كل شكل بالحرف الذي يمثّله.

تكتب هذه المكتبة هذا الجدول اعتماداً على أسماء الأشكال داخل الخط، أو على صفحة الترميز العربية (Windows-1256 وغيرها)، أو على ترتيب خطوط Diwan XT المعروف.

**طريقة الاستخدام:**

</div>

```sh
npx arabic-pdf-repair old.pdf
```

<div dir="rtl">

- لا تُرسَل الملفات إلى أي خادم، فكل شيء يعمل على جهازك.
- لا يُعدَّل أي خط إلا عند التأكد من حروفه، ولا يُخمَّن شيء.
- لا تقوم المكتبة بالتعرّف الضوئي على الحروف (OCR)، فالصفحات الممسوحة ضوئياً صور وليست نصاً.

</div>
