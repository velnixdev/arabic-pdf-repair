# How arabic-pdf-repair works

This page explains the rules the package follows. You do not need it to use the package. It is for people who want to know why a file was, or was not, changed.

## 1. Which fonts are looked at

A font is a candidate when it has no `/ToUnicode` map, or one that leaves Arabic codes unmapped. Fonts that already copy correctly are never touched.

## 2. Where the letters come from

The package uses four kinds of evidence. A font is repaired only when one of them proves its letters.

### Glyph names

The font's `/Encoding /Differences` array gives each code a glyph name. A font qualifies when at least three codes have Arabic names. Several naming families exist:

| Family | Example | Letter |
|---|---|---|
| Microsoft joining forms | `afii62761` | ب |
| Adobe Glyph List | `afii57416` | ب |
| Monotype | `inhaa`, `midsad`, `fnalefmaqsurah` | ح, ص, ى |
| Unicode style | `uniFE91` | ب |
| Plain words | `behmedial` | ب |

- A joining form (initial, medial, final) is read as its base letter.
- A ligature such as lam-alef is read as two letters.
- Names that Hebrew also uses (`alef`, `kaf`, `mem`) are trusted only in a font that is plainly Arabic by its other names.
- **Known trap:** Microsoft's fonts call the initial kaf `afii57410`, which Adobe's list gives to alef with madda. The glyph's bounding box decides: an alef is a tall narrow stem, a kaf is not.
- A glyph whose name contradicts what it draws (a dash called `I`, a space called `less`) is read by its shape.

### Diwan XT layouts

Diwan's Arabic XT fonts (`AXtManal`, `AXtMuna`, `AXtAmineFont`, …) carry no useful names. Each one-byte code stands for a fixed letter or joining form (ASMO 449 in the low half). The code is read from the font's `cmap` (TrueType), its `CIDToGIDMap` (Type0) or its encoding (Type 1).

- A glyph is read as alef only if it is tall.
- Kufi layouts are left alone, because their slots differ.

### Arabic code pages in Latin slots

Some producers store Arabic as one-byte codes from an Arabic code page but tell the reader the font is WinAnsi. Then `العربية` copies as `ÇáÚÑÈíÉ`.

For a simple TrueType font with no `/ToUnicode`, the package collects the strings the font actually draws (page contents and form XObjects) and tries Windows-1256, ISO-8859-6 and Mac Arabic. A code page is accepted only when the text reads as real Arabic by it:

| Check | Threshold |
|---|---|
| High bytes that are Arabic letters | at least 90% |
| Arabic letters among all letters | at least 60% |
| Letter pairs that are frequent in Arabic (either direction, for visual-order lines) | at least 35% |
| Every code read as alef | must draw a tall stem |

Latin text with accents (French, Spanish, …) fails these checks and is left alone.

### CFF copies of XT fonts

Type 1C fonts whose glyphs are called `g62`, and CID-keyed CFF fonts, keep the original glyph number but no letter. The glyph order of the XT families gives the letter. This is accepted only when the whole font passes the same Arabic letter-pair check. For CID fonts, only codes missing from the font's own `/ToUnicode` are filled. Existing entries are never overwritten.

## 3. What is written

- One new `/ToUnicode` CMap per repaired font.
- Arabic that the producer had already mapped correctly is kept.
- Page content, fonts and images stay as they were. The file is saved again with pdf-lib (without object streams), so byte offsets change and digital signatures no longer validate.

## 4. Encrypted files

Files protected with RC4, AES-128 or AES-256 (revisions 5 and 6) that open without a password are repaired and stay protected. Files that need a password to open return `null`.

## 5. When the answer is `null`

- No font needed a repair.
- The evidence for a font was not strong enough.
- The file is damaged, needs a password, or has a structure that cannot be rewritten safely (for example an encrypted file with object streams).
