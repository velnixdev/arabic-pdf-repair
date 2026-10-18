#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { repairTextLayer } from "./textRepair.js";

const [input, output] = process.argv.slice(2);
if (!input || input === "-h" || input === "--help") {
  console.log("Usage: arabic-pdf-repair <in.pdf> [out.pdf]");
  process.exit(input ? 0 : 1);
}

try {
  const repaired = await repairTextLayer(new Uint8Array(await readFile(input)));
  if (!repaired) {
    console.log("nothing to repair");
  } else {
    const target = output ?? input.replace(/(\.pdf)?$/i, ".repaired.pdf");
    await writeFile(target, repaired.bytes);
    for (const font of repaired.fonts) console.log(`fixed ${font.name}: ${font.codes} codes`);
    console.log(`wrote ${target}`);
  }
} catch (error) {
  console.error(`arabic-pdf-repair: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
