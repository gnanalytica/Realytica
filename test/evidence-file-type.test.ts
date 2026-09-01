/**
 * The evidence download decides its Content-Type from the BYTES.
 *
 * `document-file.ts` has held this rule since before the project evidence
 * route existed, but it was reachable only from the retired case path — so
 * the defence sat on dead code while the live route echoed the client's
 * declared `mimeType` back and served it `inline`. Upload HTML announced as
 * text/html, send someone the `?inline=1` link, and it executes on this
 * origin against an API with no authentication.
 *
 * These tests pin the property that closes it: what a client CLAIMS a file is
 * never reaches the response. `nosniff` is not a substitute — it stops a
 * browser guessing, not a server being told.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentDisposition, resolveServedType, sniffContentType } from '../apps/api/src/routes/document-file';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HTML = Buffer.from('<!doctype html><script>fetch("/api/projects")</script>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('type is decided by the bytes', () => {
  it('serves a real PDF inline', () => {
    const served = resolveServedType(PDF, 'deed.pdf');
    assert.equal(served.contentType, 'application/pdf');
    assert.equal(served.inline, true);
  });

  it('refuses to inline HTML, whatever it is called', () => {
    // The attack: bytes are HTML, the name says PDF, the upload declared
    // application/pdf. Nothing but the bytes may decide.
    for (const name of ['deed.pdf', 'khata.png', 'notes.html']) {
      const served = resolveServedType(HTML, name);
      assert.equal(served.inline, false, `${name} must not render inline`);
      assert.notEqual(served.contentType, 'text/html');
      assert.equal(served.contentType, 'application/octet-stream');
    }
  });

  it('refuses to inline SVG — a script container this app cannot render anyway', () => {
    const served = resolveServedType(SVG, 'plan.svg');
    assert.equal(served.inline, false);
    assert.equal(served.contentType, 'application/octet-stream');
  });

  it('downloads anything it cannot identify rather than guessing', () => {
    assert.equal(sniffContentType(Buffer.from('not a known signature at all')), null);
    const served = resolveServedType(Buffer.from('not a known signature at all'), 'x.pdf');
    assert.equal(served.contentType, 'application/octet-stream');
    assert.equal(served.inline, false);
  });

  it('honours an explicit download of a type it could otherwise render', () => {
    const served = resolveServedType(PNG, 'site.png', true);
    assert.equal(served.inline, false);
    assert.equal(served.contentType, 'application/octet-stream');
  });
});

describe('the filename never breaks the header', () => {
  it('strips quotes, backslashes and newlines rather than escaping them', () => {
    const header = documentDisposition(false, 'ev"il\\\nname.pdf');
    assert.ok(!header.includes('\n'), 'a newline in a header is a response-splitting bug');
    assert.equal(header.split('"').length - 1, 2, 'exactly the two quotes around the ASCII parameter');
  });

  it('carries a non-ASCII name in filename* rather than dropping it', () => {
    const header = documentDisposition(true, 'ಖಾತೆ-ಸಾರ.pdf');
    assert.match(header, /filename\*=UTF-8''/);
    assert.match(header, /filename="_+-_+\.pdf"/, 'the ASCII fallback is placeholdered, not empty');
  });
});
