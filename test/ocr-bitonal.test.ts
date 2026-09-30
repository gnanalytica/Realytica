/**
 * Black-and-white scans, the kind registries and utilities actually issue.
 *
 * Most scanned approvals and ECs are 1-bit images at 300 or 400 dpi. Every
 * page used to be expanded to full-colour RGB before OCR — 26 MB at 300 dpi,
 * 46 MB at 400 — which on a serverless function stalled a single page for
 * minutes. A 1-bit page now goes to OCR as a 1-bit bitmap, and an oversized
 * one at half size. Both are built here from the sample EC scan, so the test
 * reads real words through the same path production uses, and would read
 * nothing at all if the bitmap came out as a negative.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { parseDocumentText } from '@realytica/shared';
import { firstPageImage, readDocumentText, releaseOcr } from '../apps/api/src/documents/read-text';

after(() => releaseOcr());

/** The sample scan's page image, as greyscale pixels. */
async function samplePage(): Promise<{ width: number; height: number; grey: Uint8Array }> {
  const bytes = new Uint8Array(readFileSync(path.resolve('apps/api/sample-documents/SCANNED_Encumbrance_Certificate.pdf')));
  const img = (await firstPageImage(bytes))!;
  const stride = img.kind === 3 ? 4 : 3;
  const grey = new Uint8Array(img.width * img.height);
  for (let i = 0; i < grey.length; i += 1) {
    const j = i * stride;
    grey[i] = Math.round(0.299 * img.data[j]! + 0.587 * img.data[j + 1]! + 0.114 * img.data[j + 2]!);
  }
  return { width: img.width, height: img.height, grey };
}

/** A one-page PDF holding a 1-bit DeviceGray image, `scale` times the source size. */
function bitonalPdf(src: { width: number; height: number; grey: Uint8Array }, scale: number): Uint8Array {
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const rowBytes = Math.ceil(w / 8);
  const bits = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = src.grey[Math.min(src.height - 1, Math.floor(y / scale)) * src.width + Math.min(src.width - 1, Math.floor(x / scale))]!;
      // DeviceGray at 1 bit: a set sample is white.
      if (v > 150) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  const image = deflateSync(bits);
  const content = Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`),
      image,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let size = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    size += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

describe('a 1-bit scan', () => {
  it('is read as the document it is', async () => {
    const pdf = bitonalPdf(await samplePage(), 1);
    const text = await readDocumentText(pdf, 'application/pdf', 'bitonal-ec.pdf');
    assert.equal(text.method, 'ocr');
    const parsed = parseDocumentText(text.pages, 'bitonal-ec.pdf');
    assert.equal(parsed.type, 'encumbrance_certificate', text.pages[0]?.slice(0, 300));
    assert.ok(parsed.flags.some((f) => /mortgage/i.test(f.title)));
  });

  it('is read at half size when it is larger than OCR needs', async () => {
    // 2.2 × the sample: a 400-600 dpi scan's size, over the edge that halves it.
    const pdf = bitonalPdf(await samplePage(), 2.2);
    const text = await readDocumentText(pdf, 'application/pdf', 'large-bitonal-ec.pdf');
    assert.equal(text.method, 'ocr');
    assert.equal(parseDocumentText(text.pages, 'large-bitonal-ec.pdf').type, 'encumbrance_certificate');
  });

  it('stops sending pages to OCR once the deadline has passed, and says it was cut', async () => {
    const pdf = bitonalPdf(await samplePage(), 1);
    const text = await readDocumentText(pdf, 'application/pdf', 'late.pdf', { deadline: Date.now() - 1 });
    assert.equal(text.ocrPages.length, 0);
    assert.equal(text.truncated, true);
  });
});
