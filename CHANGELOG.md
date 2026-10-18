# Changelog

## 0.3.1

- Published from GitHub Actions with npm provenance (trusted publishing).
- `bin` path fixed so `npx arabic-pdf-repair` resolves without warnings.

## 0.3.0

- Read Arabic code pages (Windows-1256, ASMO 708 and similar) in fonts that put Arabic in Latin slots.
- Repair CFF copies of Diwan XT fonts.

## 0.2.0

- Diwan XT fonts.
- Encrypted (owner-password) PDFs.
- Misnamed glyphs.

## 0.1.0

- First release: writes a complete `/ToUnicode` map from the glyph names of one-byte TrueType Arabic fonts.
