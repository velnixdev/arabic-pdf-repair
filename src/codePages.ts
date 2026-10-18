/** The 8-bit Arabic code pages old Arabic software wrote its text in. Some
 * PDFs draw Arabic in a simple font whose codes are those bytes (WinAnsi or
 * no encoding says Latin, the font program draws the letters): copying the
 * page then gives "ÇáÚÑÈíÉ". A font is read with a code page only when what
 * its pages show -- each string drawn with it -- comes out as Arabic by
 * that table (see chooseCodePage), never by its name. High halves only
 * (0x80-0xFF); a dot is a byte with no Arabic letter. */

export interface CodePage {
  name: string;
  /** The Arabic character of each byte 0x80-0xFF, "." where there is none. */
  high: string;
}

export const CODE_PAGES: readonly CodePage[] = [
  { name: "windows-1256", high:
  ".پ........ٹ..چژڈگ.......ک.ڑ....ں" +
  ".،........ھ...............؛....؟" +
  "ہءآأؤإئابةتثجحخدذرزسشصض.طظعغـفقك" +
  ".ل.منهو.....ىي..ًٌٍَ.ُِ.ّ.ْ....ے" },
  { name: "iso-8859-6", high:
  "................................" +
  "............،..............؛...؟" +
  ".ءآأؤإئابةتثجحخدذرزسشصضطظعغ....." +
  "ـفقكلمنهوىيًٌٍَُِّْ............." },
  { name: "mac-arabic", high:
  "...........ں...................." +
  ".....٪......،...٠١٢٣٤٥٦٧٨٩.؛...؟" +
  ".ءآأؤإئابةتثجحخدذرزسشصضطظعغ....." +
  "ـفقكلمنهوىيًٌٍَُِّْپٹچەڤگڈڑ...ژے" },
];

/** The most frequent letter pairs inside Arabic words (counted over this
 * site's own Arabic pages): about 47% of all pairs in real text, against
 * about 23% when the same letters are shuffled. */
const COMMON_PAIRS = new Set("ال لم ات وا في لت لا ية يل عد لف لن لى بي را مل نص ار دي تع صف فح لي ما عر ان تو من ها ول ست حة رب نا تح عل رة اج لأ تر إل وق لع قر خط با لخ دا لص ير لح قي مس يع قا مو تي كل فا خت".split(" "));

/** Arabic letters, for counting (not marks, digits or punctuation). */
export const isLetter = (ch: string): boolean => /[ء-يٮ-ۓ]/.test(ch);

/** The letter pairs inside one Arabic word: how many, and how many are
 * common ones read forward or backward (old software often stored lines in
 * visual order). */
export function wordPairs(word: string): { seen: number; forward: number; backward: number } {
  let forward = 0;
  let backward = 0;
  for (let k = 1; k < word.length; k++) {
    if (COMMON_PAIRS.has(word[k - 1]! + word[k]!)) forward++;
    if (COMMON_PAIRS.has(word[k]! + word[k - 1]!)) backward++;
  }
  return { seen: Math.max(0, word.length - 1), forward, backward };
}

/** The share of common letter pairs in the words of `runs` (each a string,
 * words cut at anything that is not a letter), with how many pairs were
 * counted; the better of the two reading directions. */
export function pairShare(runs: readonly string[]): { seen: number; share: number } {
  let seen = 0;
  let forward = 0;
  let backward = 0;
  for (const run of runs) {
    for (const word of run.split(/[^ء-يٮ-ۓ]+/)) {
      const pairs = wordPairs(word);
      seen += pairs.seen;
      forward += pairs.forward;
      backward += pairs.backward;
    }
  }
  return { seen, share: seen ? Math.max(forward, backward) / seen : 0 };
}

/** The Arabic character a byte stands for in a code page, if any. */
export function codePageChar(page: CodePage, code: number): string | undefined {
  if (code < 0x80 || code > 0xff) return undefined;
  const ch = page.high[code - 0x80];
  return ch && ch !== "." ? ch : undefined;
}

/** Every code of `page` that draws an Arabic character, with that character. */
export function codePageTexts(page: CodePage): Map<number, string> {
  const texts = new Map<number, string>();
  for (let code = 0x80; code <= 0xff; code++) {
    const ch = codePageChar(page, code);
    if (ch) texts.set(code, ch);
  }
  return texts;
}

export interface CodePageReading {
  page: CodePage;
  /** How many of the drawn letters were high-half Arabic letters. */
  letters: number;
  /** The share of letter pairs inside words that are among the common ones. */
  pairs: number;
}

/** The code page that reads the strings a font drew as Arabic, or null.
 * `runs` are the strings drawn, byte by byte. The reading must be sure:
 *  - at least 40 high-half bytes, 90% of them an Arabic letter or mark in the
 *    table (a Latin accent in the font's own script would not be);
 *  - those letters at least 60% of all the letters drawn (the Latin ones are
 *    ASCII: a font with a Latin alphabet in its low half still qualifies for
 *    its Arabic text, but a Latin font with a few accents does not);
 *  - real Arabic pair statistics (frequent pairs make 35% or more of the
 *    pairs inside words), reading each word in either direction, since old
 *    software often stored its lines in visual order. */
export function chooseCodePage(runs: readonly Uint8Array[]): CodePageReading | null {
  let high = 0;
  for (const run of runs) for (const byte of run) if (byte >= 0x80) high++;
  if (high < 40) return null;
  let best: CodePageReading | null = null;
  for (const page of CODE_PAGES) {
    let arabic = 0;
    let letters = 0;
    let ascii = 0;
    let pairsSeen = 0;
    let pairsForward = 0;
    let pairsBackward = 0;
    for (const run of runs) {
      let word = "";
      const flush = () => {
        const pairs = wordPairs(word);
        pairsSeen += pairs.seen;
        pairsForward += pairs.forward;
        pairsBackward += pairs.backward;
        word = "";
      };
      for (const byte of run) {
        const ch = byte >= 0x80 ? codePageChar(page, byte) : undefined;
        if (ch && isLetter(ch)) { arabic++; letters++; word += ch; }
        else if (ch) { arabic++; flush(); }
        else {
          if (byte < 0x80 && /[A-Za-z]/.test(String.fromCharCode(byte))) ascii++;
          flush();
        }
      }
      flush();
    }
    if (arabic < 0.9 * high || letters < 0.6 * (letters + ascii) || pairsSeen < 30) continue;
    const pairs = Math.max(pairsForward, pairsBackward) / pairsSeen;
    if (pairs < 0.35) continue;
    if (!best || pairs > best.pairs + 0.02) best = { page, letters, pairs };
  }
  return best;
}
