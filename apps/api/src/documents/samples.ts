/**
 * The synthetic document set, for somebody trying the product.
 *
 * "Use the sample documents" in the chat loads these through the same upload
 * path a real file takes. Every one is invented and carries a DEMO banner on
 * each page; see `scripts/sample-documents/make.py` for what they contain and
 * the two discrepancies they are built to surface.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** "use the sample documents", "load sample docs", "try it with the samples". */
export const SAMPLE_REQUEST = /\b(?:use|load|try|add|give\s+me|drop\s+in|upload|attach|file)\b[^.?!]{0,40}\bsamples?(?:\s+(?:documents?|docs|files|papers|deeds))?\b|\bsample\s+(?:documents?|docs|files|papers|deeds)\b/i;

/**
 * The order they are read in: title first, then the certificates that test
 * it, then the approvals. Scans are left out of the default set — the chat
 * takes ten files a turn — and are in the folder for anyone who wants them.
 */
const ORDER = [
  'Sale_Deed_2019_Sy_118-2_Whitefield.pdf',
  'Mother_Deed_1998_Sy_118-2.pdf',
  'Encumbrance_Certificate_Form15_1995-2025.pdf',
  'Khata_Certificate_and_Extract_BBMP.pdf',
  'Property_Tax_Receipt_BBMP_2025-26.pdf',
  'Zoning_Certificate_BDA_RMP2015.pdf',
  'DC_Conversion_Order_2017.pdf',
  'Building_Plan_Sanction_BBMP_2021.pdf',
  'Survey_Sketch_11E_Sy_118-2.pdf',
];

async function sampleDirectory(): Promise<string | null> {
  // Beside the bundle on a deployment; in the API package in development.
  for (const dir of [path.join(HERE, 'sample-documents'), path.resolve(HERE, '../../sample-documents')]) {
    const ok = await stat(dir).then((s) => s.isDirectory()).catch(() => false);
    if (ok) return dir;
  }
  return null;
}

export interface SampleFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  /** Bundled with the app, so the browser can fetch its pages by name while it is read. */
  sample: true;
}

export async function loadSampleDocuments(): Promise<SampleFile[]> {
  const dir = await sampleDirectory();
  if (!dir) return [];
  const present = new Set(await readdir(dir));
  const out: SampleFile[] = [];
  for (const name of ORDER) {
    if (!present.has(name)) continue;
    const buffer = await readFile(path.join(dir, name));
    out.push({ originalname: name, mimetype: 'application/pdf', size: buffer.length, buffer, sample: true });
  }
  return out;
}

/**
 * One sample document's bytes, by its file name, for drawing its pages while
 * it is read. Only a name in the bundled set: the name arrives from a browser
 * and is never joined onto a path otherwise.
 */
export async function readSampleDocument(name: string): Promise<Buffer | null> {
  if (!ORDER.includes(name)) return null;
  const dir = await sampleDirectory();
  if (!dir) return null;
  return readFile(path.join(dir, name)).catch(() => null);
}
