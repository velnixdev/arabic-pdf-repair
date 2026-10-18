/** Reading a PDF font's ToUnicode CMap: what text each character code
 * stands for. Its own module, so readers outside the text engine take
 * this alone. */

/** A ToUnicode CMap's entries: code -> text. */
export function readToUnicode(cmap: string): Map<number, string> {
  const out = new Map<number, string>();
  const text = (hex: string) => (hex.match(/.{4}/g) ?? []).map((unit) => String.fromCharCode(parseInt(unit, 16))).join("");
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) out.set(parseInt(match[1]!, 16), text(match[2]!));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
      const first = parseInt(match[1]!, 16);
      const last = parseInt(match[2]!, 16);
      if (match[3] !== undefined) {
        const start = text(match[3]);
        for (let code = first; code <= last && code - first < 65536; code++) {
          out.set(code, start.slice(0, -1) + String.fromCharCode(start.charCodeAt(start.length - 1) + code - first));
        }
      } else {
        [...match[4]!.matchAll(/<([0-9a-fA-F]*)>/g)].forEach((item, k) => out.set(first + k, text(item[1]!)));
      }
    }
  }
  return out;
}
