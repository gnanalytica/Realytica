/**
 * Keep the type scale a scale.
 *
 * The app had twenty-five distinct font sizes, five of them at half-pixel
 * steps: 9.5, 10.5, 11.5, 12.5, 13.5. A hundred and fifty-eight usages between
 * them. None of those halves is a decision anybody could defend — nobody can
 * see half a pixel at this size, and no two of them were chosen against each
 * other. They are what happens when a size is nudged in isolation and then
 * copied: the ladder stops being a ladder and becomes a slope, and the next
 * person nudges from wherever they landed.
 *
 * So half-pixel sizes are barred outright. The integer ladder that remains —
 * 10, 11, 12, 13, 14, 15 for interface text, larger for display — is small
 * enough to hold in your head, which is the whole point of a scale.
 *
 * Deliberately not a ban on arbitrary sizes as such. `text-[22px]` on one
 * headline is a legitimate one-off; `text-[12.5px]` in sixty-nine places is a
 * scale that has come apart, and only the second is worth failing a build for.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../apps/web/src/', import.meta.url).pathname;
const HALF_PIXEL = /text-\[(\d+)\.5px\]/g;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const offences = [];
for (const file of await walk(ROOT)) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const hit of line.matchAll(HALF_PIXEL)) {
      offences.push({ file: file.replace(ROOT, 'apps/web/src/'), line: i + 1, found: hit[0], whole: `text-[${hit[1]}px]` });
    }
  });
}

if (offences.length > 0) {
  console.error('\n[type] Half-pixel font sizes are not a scale, they are a slope:\n');
  for (const o of offences) {
    console.error(`  ${o.found}  →  ${o.whole} or its neighbour`);
    console.error(`      ${o.file}:${o.line}`);
  }
  console.error('\n  Pick a step on the ladder: 10, 11, 12, 13, 14, 15.\n');
  process.exit(1);
}

console.log('[type] the scale is a scale.');
