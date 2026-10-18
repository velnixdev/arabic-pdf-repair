/** What Arabic glyph names say. A PDF "printed" from an older Windows
 * program (PDFCreator, Ghostscript, Distiller) keeps each font as a one-byte
 * font whose codes are named in /Encoding /Differences. The names a producer
 * could translate became the text layer; the ones it couldn't -- the joining
 * forms Microsoft's fonts named "afii62761"..., Monotype's "inhaa",
 * "midsad"... -- were left without Unicode, and every reader then shows
 * control characters where the page shows Arabic. The names still tell the
 * letter, so the text layer can be rebuilt from them (textRepair.ts).
 *
 * The afii62xxx table was derived by matching the glyphs so named in real
 * documents, outline to outline, with the presentation forms of the same
 * fonts (Courier New, Arial, Times New Roman): one run of forms in
 * Microsoft's order -- the letters by alphabet, each as initial, medial,
 * final -- with no exception among the 98 names met. */

/** afii62753.. in order: the presentation form each name draws. */
const AFII_FORMS = [
  0xfe82, 0xfe84, 0xfe86, 0xfe88, 0xfe8b, 0xfe8c, 0xfe8a, 0xfe8e, // alef madda, alef hamza, waw hamza, alef hamza below, yeh hamza (init, medi, fina), alef
  0xfe91, 0xfe92, 0xfe90, 0xfe94, // beh; teh marbuta
  0xfe97, 0xfe98, 0xfe96, 0xfe9b, 0xfe9c, 0xfe9a, // teh, theh
  0xfe9f, 0xfea0, 0xfe9e, 0xfea3, 0xfea4, 0xfea2, 0xfea7, 0xfea8, 0xfea6, // jeem, hah, khah
  0xfeaa, 0xfeac, 0xfeae, 0xfeb0, // dal, thal, reh, zain (final)
  0xfeb3, 0xfeb4, 0xfeb2, 0xfeb7, 0xfeb8, 0xfeb6, // seen, sheen
  0xfebb, 0xfebc, 0xfeba, 0xfebf, 0xfec0, 0xfebe, // sad, dad
  0xfec3, 0xfec4, 0xfec2, 0xfec7, 0xfec8, 0xfec6, // tah, zah
  0xfecb, 0xfecc, 0xfeca, 0xfecf, 0xfed0, 0xfece, // ain, ghain
  0xfed3, 0xfed4, 0xfed2, 0xfed7, 0xfed8, 0xfed6, // feh, qaf
  0xfedb, 0xfedc, 0xfeda, 0xfedf, 0xfee0, 0xfede, // kaf, lam
  0xfee3, 0xfee4, 0xfee2, 0xfee7, 0xfee8, 0xfee6, // meem, noon
  0xfeeb, 0xfeec, 0xfeea, 0xfeee, // heh, waw (final)
  0xfef0, 0xfef3, 0xfef4, 0xfef2, // alef maksura (final), yeh
  0xfef5, 0xfef6, 0xfef7, 0xfef8, 0xfef9, 0xfefa, 0xfefb, 0xfefc, // lam-alef: madda, hamza above, hamza below, plain (isolated, final)
];
const AFII_FORMS_FIRST = 62753;

/** Ligature glyphs of the same fonts, as met. */
const AFII_LIGATURES: Record<number, number> = {
  62891: 0xfc32, 62939: 0xfcca, 62943: 0xfccc, 62946: 0xfccd, 62947: 0xfc43, 62951: 0xfccf,
  63759: 0xfc0e, 63761: 0xfc75, 63824: 0xfc4f,
  62942: 0xfc42, 62945: 0xfd88, 63763: 0xfc12, 63795: 0xfc31, // lam meem, lam meem hah, theh meem, feh alef maksura
};

/** Glyphs read as text no presentation form gives: the shadda with each
 * vowel above or below it (forms U+FC5E..FC62 without the space their
 * compatibility mapping starts with), and "lillah", drawn after an alef in
 * "عباد الله" -- matched the same way, by outline, or by the words of the
 * pages they were met on. */
const AFII_TEXT: Record<number, string> = {
  62882: "ٌّ", 62883: "ٍّ", 62884: "َّ", 62885: "ُّ", 62886: "ِّ",
  64184: "لله",
};

/** afii574xx: the Arabic letters, digits, punctuation and marks (Adobe's
 * glyph list). */
const AFII_LETTERS: Record<number, number> = {
  57388: 0x060c, 57403: 0x061b, 57407: 0x061f, 57440: 0x0640, 57470: 0x0647, 57381: 0x066a,
  57447: 0x0647, // the list's ae (U+06D5), which these fonts draw as a final heh
  ...Object.fromEntries(Array.from({ length: 10 }, (_, k) => [57392 + k, 0x0660 + k])),
  ...Object.fromEntries(Array.from({ length: 26 }, (_, k) => [57409 + k, 0x0621 + k])), // hamza .. ghain
  ...Object.fromEntries(Array.from({ length: 6 }, (_, k) => [57441 + k, 0x0641 + k])), // feh .. noon
  ...Object.fromEntries(Array.from({ length: 3 }, (_, k) => [57448 + k, 0x0648 + k])), // waw, alef maksura, yeh
  ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => [57451 + k, 0x064b + k])), // tanween .. sukun
};

/** Letter names as fonts spell them (Unicode's own, Monotype's, common
 * transliterations), longest first where one starts another. */
const LETTERS: Array<[RegExp, string]> = [
  [/^(alefwithmaddaabove|alefmaddaabove|alefmadda|maddahonalef|maddaonalef)$/, "آ"],
  [/^(alefwithhamzaabove|alefhamzaabove|hamzahonalef|hamzaonalef)$/, "أ"],
  [/^(alefwithhamzabelow|alefhamzabelow|hamzahunderalef|hamzaunderalef)$/, "إ"],
  [/^(wawwithhamzaabove|wawhamzaabove|hamzahonwaw|hamzaonwaw)$/, "ؤ"],
  [/^(yehwithhamzaabove|yehhamzaabove|hamzahonyah|hamzahonya|hamzaonyeh)$/, "ئ"],
  [/^(lamwithalefwithmaddaabove|lamalefmaddaabove|maddahonlamelef|maddahonlamalef)$/, "لآ"],
  [/^(lamwithalefwithhamzaabove|lamalefhamzaabove|hamzahonlamelef|hamzahonlamalef)$/, "لأ"],
  [/^(lamwithalefwithhamzabelow|lamalefhamzabelow|hamzahunderlamelef|hamzahunderlamalef)$/, "لإ"],
  [/^(lamwithalef|lamalef|lamelef)$/, "لا"],
  [/^(tehmarbuta|taamarbutah|taamarbuta|tamarbuta|tamarbutah)$/, "ة"],
  [/^(alefmaksura|alefmaqsurah|alefmaqsura)$/, "ى"],
  [/^(hamza|hamzah)$/, "ء"],
  [/^(alef|alif)$/, "ا"],
  [/^(beh|baa)$/, "ب"],
  [/^(teh|taa)$/, "ت"],
  [/^(theh|thaa)$/, "ث"],
  [/^(jeem|jim)$/, "ج"],
  [/^(hah|haa)$/, "ح"],
  [/^(khah|khaa)$/, "خ"],
  [/^dal$/, "د"],
  [/^thal$/, "ذ"],
  [/^(reh|raa)$/, "ر"],
  [/^(zain|zay|zeh)$/, "ز"],
  [/^(seen|sin)$/, "س"],
  [/^(sheen|shin)$/, "ش"],
  [/^sad$/, "ص"],
  [/^dad$/, "ض"],
  [/^tah$/, "ط"],
  [/^zah$/, "ظ"],
  [/^ain$/, "ع"],
  [/^ghain$/, "غ"],
  [/^(feh|faa)$/, "ف"],
  [/^qaf$/, "ق"],
  [/^(kaf|caf)$/, "ك"],
  [/^lam$/, "ل"],
  [/^(meem|mem|mim)$/, "م"],
  [/^(noon|nun)$/, "ن"],
  [/^heh$/, "ه"],
  [/^waw$/, "و"],
  [/^(yeh|yaa)$/, "ي"],
];
/** Two-letter names a font of another script could use too ("ra", "ya"):
 * taken only in a font whose other names are plainly Arabic. */
const SHORT_LETTERS: Record<string, string> = { ra: "ر", fa: "ف", ya: "ي", ha: "ه", ba: "ب", ta: "ت" };
/** Names Adobe's glyph list gives to Hebrew letters (a producer then wrote
 * Hebrew into an Arabic font's text layer): Arabic only on other evidence. */
const SHARED_WITH_HEBREW = new Set(["alef", "kaf", "mem", "shin", "nun"]);

export interface GlyphNameText {
  /** The letters the glyph draws (a ligature draws several). */
  text: string;
  /** False for a name another script's font could also use. */
  certain: boolean;
}

const fromForm = (cp: number) => String.fromCodePoint(cp).normalize("NFKC");

/** The Arabic text a glyph name stands for, or null: not Arabic, or not a
 * name known here. Joining forms read as their letters. */
export function arabicGlyphName(name: string): GlyphNameText | null {
  const base = name.replace(/[.\-_].*$/, "");
  const afii = /^afii(\d{5})$/.exec(base);
  if (afii) {
    const n = Number(afii[1]);
    if (AFII_LETTERS[n]) return { text: String.fromCodePoint(AFII_LETTERS[n]!), certain: true };
    if (AFII_TEXT[n]) return { text: AFII_TEXT[n]!, certain: true };
    const form = AFII_FORMS[n - AFII_FORMS_FIRST] ?? AFII_LIGATURES[n] ?? (n >= 63846 && n <= 63961 ? n + 772 : undefined);
    return form ? { text: fromForm(form), certain: true } : null;
  }
  const isArabicCode = (cp: number) => (cp >= 0x600 && cp <= 0x6ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
  const uni = /^uni((?:[0-9A-F]{4})+)$/.exec(base) ?? /^u([0-9A-F]{4,6})$/.exec(base);
  if (uni) {
    const cps = uni[0]!.startsWith("uni") ? uni[1]!.match(/.{4}/g)!.map((hex) => parseInt(hex, 16)) : [parseInt(uni[1]!, 16)];
    return cps.every(isArabicCode) ? { text: cps.map(fromForm).join(""), certain: true } : null;
  }
  // The bare code point, lower case ("fe8e", "fcdb": DecoType's fonts). A
  // name without a digit could be a word ("feed", "face").
  if (/^[0-9a-f]{4}$/.test(base) && isArabicCode(parseInt(base, 16))) return { text: fromForm(parseInt(base, 16)), certain: /\d/.test(base) };
  const lower = base.toLowerCase();
  if (lower === "righttoleftspace") return { text: " ", certain: true };
  if (/^(tatweel|kashida)/.test(lower)) return { text: "ـ", certain: true };
  // The joining form as a prefix (Monotype: in, mid, fn) or a suffix.
  const formed = /^(?:in|mid|fn|iso)(?=[a-z]{2})/.test(lower) || /(isolated|isolate|isol|initial|init|medial|medi|final|fina)(arabic|ar)?$/.test(lower) || /arabic$/.test(lower);
  const letter = lower.replace(/^(?:mid|fn|iso|in)(?=[a-z]{2})/, "").replace(/(isolated|isolate|isol|initial|init|medial|medi|final|fina)?(arabic|ar)?$/, "");
  for (const [pattern, text] of LETTERS) if (pattern.test(letter)) return { text, certain: formed || (letter.length > 3 && !SHARED_WITH_HEBREW.has(letter)) };
  if (SHORT_LETTERS[letter]) return { text: SHORT_LETTERS[letter]!, certain: formed };
  return null;
}
