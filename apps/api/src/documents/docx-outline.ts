/**
 * The paragraphs of a Word file, and which of them its author numbered.
 *
 * A questionnaire arrives as a .docx far more often than as anything else,
 * and Word already says which lines are the questions: they are the list
 * items. That mark is the only reliable one — a question need not end in a
 * question mark and an answer may — so the reader keeps it instead of
 * flattening the file to text and guessing afterwards.
 *
 * A .docx is a zip of XML. Only two things are read from it: the entry
 * `word/document.xml`, and inside it each paragraph's text, whether it has
 * list numbering, and whether its style is a heading. No dependency: the zip
 * is read with the central directory and Node's own inflate.
 */

import { inflateRawSync } from 'node:zlib';
import type { OutlineLine } from '@realytica/shared';

/** The largest document.xml this will inflate. A questionnaire is kilobytes; this stops a zip bomb. */
const MAX_XML_BYTES = 8 * 1024 * 1024;

function entry(zip: Buffer, name: string): Buffer | null {
  // End of central directory: the last 22 bytes, plus up to 64 KB of comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entryName = zip.toString('utf8', at + 46, at + 46 + nameLen);
    if (entryName === name) {
      if (size > MAX_XML_BYTES) throw new Error('That document is too large to read as a questionnaire.');
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
      return null;
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Every paragraph with text, in document order.
 *
 * Text boxes are stored twice in a .docx — once for new Word, once as a
 * fallback for old — so a paragraph repeating the one before it is dropped.
 */
export function docxOutline(file: Buffer): OutlineLine[] {
  const xml = entry(file, 'word/document.xml');
  if (!xml) throw new Error('That does not look like a Word document.');
  const body = xml.toString('utf8');
  const lines: OutlineLine[] = [];
  const paragraph = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  let last = '';
  while ((m = paragraph.exec(body))) {
    const p = m[0];
    const text = unescapeXml(
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((t) => (t[1] !== undefined ? t[1] : ' ')).join(''),
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === last) continue;
    last = text;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    lines.push({ text, listed: /<w:numPr>/.test(p) || undefined, heading: /^(Heading|Title)/i.test(style) || undefined });
  }
  return lines;
}
