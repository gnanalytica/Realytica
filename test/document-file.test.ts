/**
 * How a stored file is served back.
 *
 * The property under test is that the response type comes from the BYTES,
 * never from the mime type the uploading client announced. That is the
 * difference between a viewer and a stored-XSS hole: a file uploaded as
 * `application/pdf` whose contents are HTML must not come back as something
 * the browser will execute on our origin.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveServedType, sniffContentType } from '../apps/api/src/routes/document-file';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(8)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('sniffContentType', () => {
  it('names the formats it can be certain of from the head of the file', () => {
    assert.equal(sniffContentType(PDF), 'application/pdf');
    assert.equal(sniffContentType(PNG), 'image/png');
    assert.equal(sniffContentType(JPEG), 'image/jpeg');
  });

  it('says only "a zip" for an OOXML container, because that is all the bytes say', () => {
    assert.equal(sniffContentType(ZIP), 'application/zip');
  });

  it('returns null rather than guessing at anything it does not recognise', () => {
    assert.equal(sniffContentType(HTML), null);
    assert.equal(sniffContentType(Buffer.alloc(0)), null);
    assert.equal(sniffContentType(Buffer.from([0x25])), null);
  });
});

describe('resolveServedType', () => {
  it('inlines the types the viewer can render', () => {
    assert.deepEqual(resolveServedType(PDF, 'deed.pdf'), { contentType: 'application/pdf', inline: true });
    assert.deepEqual(resolveServedType(PNG, 'shot.png'), { contentType: 'image/png', inline: true });
  });

  /*
   * The load-bearing one. An HTML payload named and announced as a PDF has to
   * come back as an opaque download — if it came back as text/html inline, a
   * malicious upload would run as script on the app's own origin the moment
   * someone opened the proof pane.
   */
  it('never trusts the extension: HTML bytes named .pdf serve as an opaque attachment', () => {
    assert.deepEqual(resolveServedType(HTML, 'title-deed.pdf'), {
      contentType: 'application/octet-stream',
      inline: false,
    });
  });

  it('names a docx from its extension but still refuses to inline it', () => {
    const resolved = resolveServedType(ZIP, 'Report.docx');
    assert.equal(resolved.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(resolved.inline, false);
  });

  it('treats a zip with no known Office extension as a plain zip', () => {
    assert.deepEqual(resolveServedType(ZIP, 'bundle.zip'), { contentType: 'application/zip', inline: false });
    assert.deepEqual(resolveServedType(ZIP, 'noextension'), { contentType: 'application/zip', inline: false });
  });

  /*
   * A site photograph off an iPhone arrives as HEIC and nothing else in the
   * head of the file separates it from an MP4 — so it is identified by the
   * ISO-BMFF brand, not by the `ftyp` box alone.
   */
  it('recognises a HEIC photograph by its brand', () => {
    assert.equal(sniffContentType(HEIC), 'image/heic');
    assert.deepEqual(resolveServedType(HEIC, 'IMG_4471.HEIC'), { contentType: 'image/heic', inline: true });
  });

  /*
   * `?download=1` has to override a type that would otherwise render, or the
   * download button beside the viewer would open the file in place instead of
   * saving it.
   */
  it('forces an attachment when the caller asks to download', () => {
    assert.deepEqual(resolveServedType(PDF, 'deed.pdf', true), {
      contentType: 'application/octet-stream',
      inline: false,
    });
  });

  it('matches the extension case-insensitively — a scanner writes .DOCX', () => {
    assert.equal(
      resolveServedType(ZIP, 'REPORT.DOCX').contentType,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
