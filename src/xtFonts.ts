/** Diwan's Arabic "XT" fonts (AXtManal, AXtShareQ, AXtLotfiBold...), the
 * Macintosh layout fonts of Arabic newspapers and ministries around 2010.
 * Their glyphs have no names and their cmap is a one-byte Macintosh one, so
 * the PDF says nothing about what they draw: copying a page gives Latin
 * letters and symbols. Every family shares one table from that code to the
 * letter, though -- ASMO 449 in the low half, the joining forms and
 * ligatures in the high half -- read here from the font's own cmap. */
import { isLetter, pairShare } from "./codePages.js";
import { glyphAdvance, glyphBox, simpleTrueTypeGlyph, unicodeGlyph } from "./sfnt.js";

/** An XT font by its PostScript name. AXtKufiLayout lays its high half out
 * differently, so it is left alone. */
export const isXtFont = (name: string): boolean => /AXt/.test(name) && !/Kufi/i.test(name);

const TABLE = new Map<number, string>();
// ASMO 449.
TABLE.set(0x2c, "،").set(0x3b, "؛").set(0x3f, "؟").set(0x40, "٭").set(0x60, "ـ");
for (let digit = 0; digit < 10; digit++) TABLE.set(0x30 + digit, String.fromCodePoint(0x660 + digit));
[..."ءآأؤإئابةتثجحخدذرزسشصضطظعغ"].forEach((ch, k) => TABLE.set(0x41 + k, ch));
[..."فقكلمنهوىي"].forEach((ch, k) => TABLE.set(0x61 + k, ch));
for (let k = 0; k < 8; k++) TABLE.set(0x6b + k, String.fromCodePoint(0x64b + k));
// The high half: joining forms, by the letter they are, and ligatures.
const HIGH = "7e=د 80=ئ 81=ئ 82=ئ 83=ا 84=ب 85=ب 86=ب 87=ة 88=ت 89=ت 8a=ت 8b=ث 8c=ث 8d=ث 8e=ج 8f=ج 90=ج 91=ح 92=ح 93=ح 94=خ 95=خ 96=خ 97=د 98=ذ 99=ر 9b=ز " +
  "9d=س 9e=ش 9f=ص a0=ض a3=ط a4=ط a5=ط a6=ظ a7=ظ a8=ظ a9=ع aa=ع ab=ع ac=غ ad=غ ae=غ af=ف b0=ف b1=ف b2=ق b3=ق b4=ق b5=ك b6=ك b7=ك b8=ل b9=ل ba=ل " +
  "bb=م bc=م bd=م be=ن bf=ن c0=ن c1=ه c2=ه c3=ه c4=و c5=ى c7=ي c8=ي c9=ي cc=بم ce=تج d0=تح d2=تم d3=تم d4=في d5=لا d6=لج d7=لح d8=لخ d9=لم da=لم " +
  "db=لى dc=لي dd=مج de=مح df=مخ e0=مم e2=نج e4=نم e6=ني e7=يم e8=يم e9=بر eb=تر ed=ثر ee=لا f1=ير f2=ين f6=لله";
for (const pair of HIGH.split(" ")) {
  const [code, text] = pair.split("=");
  TABLE.set(parseInt(code!, 16), text!);
}
// The tooth letters (س ش ص ض, codes 9d-a0) are drawn as a body and a tail
// (a1, a2): the body carries the letter, the tail a joiner, which the engine
// drops (an empty entry would let readers fall back to the font's "~").
TABLE.set(0xa1, "\u200d").set(0xa2, "\u200d");
// Drawn with no advance, the hamza and madda letters are marks set over the
// alef (or the lam-alef) before them.
const MARKS = new Map([[0x42, "\u0653"], [0x43, "\u0654"], [0x44, "\u0654"], [0x45, "\u0655"]]);

/** The text of an XT code, `zeroWidth` when its glyph has no advance. */
export function xtText(code: number, zeroWidth: boolean): string | undefined {
  const mark = MARKS.get(code);
  return mark && zeroWidth ? mark : TABLE.get(code);
}

// A Type 1 copy of an XT font names its glyphs as the Macintosh Roman
// letters in their slots ("product" for 0xb8, a lam): the name gives the code.
const MAC_NAMES = new Map<string, number>();
"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde".split(" ").forEach((name, k) => MAC_NAMES.set(name, 0x20 + k));
("Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex " +
  "edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent " +
  "sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal " +
  "greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical " +
  "florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright " +
  "quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase " +
  "quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute " +
  "Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron").split(" ").forEach((name, k) => MAC_NAMES.set(name, 0x80 + k));
MAC_NAMES.set("Euro", 0xdb).set("nbspace", 0xca);

/** The XT code a glyph name stands for. */
export const xtCodeOfName = (name: string): number | undefined => MAC_NAMES.get(name);

let fromWinAnsi: Map<number, number> | null = null;
/** The XT code of a WinAnsi byte: the Macintosh Roman byte of the same character. */
export function xtCodeOfWinAnsi(code: number): number | undefined {
  if (code < 0x80) return code;
  if (!fromWinAnsi) {
    const all = Uint8Array.from({ length: 128 }, (_, k) => 0x80 + k);
    const mac = [...new TextDecoder("macintosh").decode(all)];
    const win = [...new TextDecoder("windows-1252").decode(all)];
    fromWinAnsi = new Map();
    win.forEach((ch, k) => {
      const at = mac.indexOf(ch);
      if (at >= 0) fromWinAnsi!.set(0x80 + k, 0x80 + at);
    });
  }
  return fromWinAnsi.get(code);
}

/** The text of each one-byte code an XT font program draws, or null when
 * the program isn't laid out that way: its alef (0x47), when drawn, must be
 * a stem at least twice as tall as wide. */
export function xtCodeTexts(program: Uint8Array): Map<number, { gid: number; text: string }> | null {
  const gidOf = (code: number) => {
    try {
      return simpleTrueTypeGlyph(program, code);
    } catch {
      return 0;
    }
  };
  // A subset may leave the alef out (or empty); then a Unicode Arabic cmap
  // is what says the program is laid out some other way.
  const alefGid = gidOf(0x47);
  const alef = alefGid > 0 ? glyphBox(program, alefGid) : null;
  if (alef ? alef[3] - alef[1] < 2 * (alef[2] - alef[0]) : unicodeGlyph(program, 0x627) > 0) return null;
  const texts = new Map<number, { gid: number; text: string }>();
  for (const [code, letter] of TABLE) {
    const gid = gidOf(code);
    if (gid <= 0) continue;
    texts.set(code, { gid, text: xtText(code, glyphAdvance(program, gid) === 0) ?? letter });
  }
  return texts;
}

// The glyph order of each family's full font, as the glyph numbers (base 36)
// of the space and TABLE's codes in code order. A Type 1C or CID-keyed CFF copy of an XT
// font keeps the original glyph number in its names ("g62") or its CIDs, but
// nothing says what each draws -- the TrueType copies of the same families
// do (xtCodeTexts), and their order is read off here. The families differ in
// a few glyphs they leave out, and a document's copy may be shifted by one.
const ORDERS: string[] = [
  "3 f j k l m n o p q r s u y z 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 1g 1h 1i 1j 1k 1l 1m 1n 1o 1p 1s 1t 1u 1v 1w 1x 1y 1z 20 21 22 23 24 25 26 27 28 29 2a 2l 2n 2o 2p 2q 2r 2s 2t 2u 2v 2w 2x 2y 2z 30 31 32 33 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f 3g 3h 3i 3j 3k 3l 3m 3n 3o 3p 3q 3r 3s 3t 3u 3v 3w 3x 3y 3z 40 41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 4g 4h 4i 4j 4k 4l 4n 4p 4r 4t 4u 4v 4w 4x 4y 4z 50 51 52 53 54 55 56 57 59 5b 5d 5e 5f 5g 5i 5k 5l 5o 5p 5t",
  "3 f j k l m n o p q r s u y z 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 1g 1h 1i 1j 1k 1l 1m 1n 1o 1p 1v 1w 1x 1y 1z 20 21 22 23 24 25 26 27 28 29 2a 2b 2c 2d 2p 2r 2s 2t 2u 2v 2w 2x 2y 2z 30 31 32 33 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f 3g 3i 3k 3l 3m 3n 3o 3p 3q 3r 3s 3t 3u 3v 3w 3x 3y 3z 40 41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 4g 4h 4i 4j 4k 4l 4m 4n 4o 4q 4r 4s 4v 4x 4z 51 52 53 54 55 56 57 58 59 5a 5b 5c 5d 5e 5f 5h 5j 5l 5m 5n 5o 5q 5s 5t 5w 5x 61",
  "3 g k l m n o p q r s t v z 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 1g 1h 1i 1j 1k 1l 1m 1n 1o 1p 1q 1w 1x 1y 1z 20 21 22 23 24 25 26 27 28 29 2a 2b 2c 2d 2e 2q 2s 2t 2u 2v 2w 2x 2y 2z 30 31 32 33 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f 3g 3h 3i 3j 3k 3l 3m 3n 3o 3p 3q 3r 3s 3t 3u 3v 3w 3x 3y 3z 40 41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 4g 4h 4i 4j 4k 4l 4m 4n 4o 4p 4q 4s 4u 4w 4y 4z 50 51 52 53 54 55 56 57 58 59 5a 5b 5c 5e 5g 5i 5j 5k 5l 5n 5p 5q 5t 5u 5y",
  "3 f j k l m n o p q r s u y z 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 1g 1h 1i 1j 1k 1l 1m 1n 1o 1p 1v 1w 1x 1y 1z 20 21 22 23 24 25 26 27 28 29 2a 2b 2c 2d 2m 2o 2p 2q 2r 2s 2t 2u 2v 2w 2x 2y 2z 30 31 32 33 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f 3g 3h 3i 3j 3k 3l 3m 3n 3o 3p 3q 3r 3s 3t 3u 3v 3w 3x 3y 3z 40 41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 4g 4h 4i 4j 4k 4l 4m 4o 4q 4s 4u 4v 4w 4x 4y 4z 50 51 52 53 54 55 56 57 58 5a 5c 5e 5f 5g 5h 5j 5l 5m 5p 5q 5u",
];
let orderMaps: Array<Map<number, number>> | null = null; // glyph number -> XT code, one per family
function familyOrders(): Array<Map<number, number>> {
  if (!orderMaps) {
    const codes = [0x20, ...[...TABLE.keys()].sort((a, b) => a - b)];
    orderMaps = ORDERS.map((order) => new Map(order.split(" ").map((gid, k) => [parseInt(gid, 36), codes[k]!] as const)));
  }
  return orderMaps;
}

/** One glyph an XT copy draws: the key the PDF shows it by (a simple font's
 * byte, a CID font's CID), its original glyph number, and whether it has no
 * advance. */
export interface XtGlyph {
  gid: number;
  zeroWidth: boolean;
}

/** The text of each key of a Type 1C or CID-keyed CFF copy of an XT font,
 * through the glyph order of the families (see ORDERS), or null. `runs` are
 * the strings the font drew, as keys. A family order and shift (documents'
 * copies are numbered from 0 or 1) is accepted only when it reads the drawn
 * glyphs the way the glyphs behave -- its zero-advance glyphs are marks or
 * joiners, the large majority of the drawn glyphs get a letter -- and the
 * words it spells have the letter pairs of real Arabic (codePages.ts); and
 * only when no other order reads them as well. */
export function xtOrderTexts(glyphs: Map<number, XtGlyph>, runs: readonly (readonly number[])[]): Map<number, string> | null {
  const readings: Array<{ texts: Map<number, string>; share: number }> = [];
  for (const order of familyOrders()) {
    for (let shift = -2; shift <= 2; shift++) {
      const texts = new Map<number, string>();
      let bad = false;
      for (const [key, { gid, zeroWidth }] of glyphs) {
        const code = order.get(gid + shift);
        const text = code === undefined ? undefined : code === 0x20 ? " " : xtText(code, zeroWidth);
        if (text === undefined) continue;
        // A zero-advance glyph is a mark or a tail joiner, never a letter.
        if (zeroWidth && isLetter(text)) bad = true;
        texts.set(key, text);
      }
      if (bad || !texts.size) continue;
      let drawn = 0;
      let read = 0;
      const lines = runs.map((run) => run.map((key) => {
        drawn++;
        const text = texts.get(key);
        if (text !== undefined) read++;
        return text ?? " ";
      }).join(""));
      const { seen, share } = pairShare(lines);
      if (read < 0.7 * drawn || seen < 20 || share < 0.35) continue;
      readings.push({ texts, share });
    }
  }
  if (!readings.length) return null;
  readings.sort((a, b) => b.share - a.share);
  const best = readings[0]!;
  // Another reading of the same glyphs that spells just as well is no proof.
  const rival = readings.find((reading, k) => k > 0 && best.share - reading.share < 0.08 && [...best.texts].some(([key, text]) => reading.texts.get(key) !== text));
  return rival ? null : best.texts;
}
