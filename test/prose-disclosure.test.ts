/**
 * Prose moved off the working screens, and must still be in the document.
 *
 * The registers used to print every sentence the engine writes: four
 * paragraphs per compliance check across thirteen checks, a cause under every
 * risk, an explanation under every driver. Measured in the browser, the
 * Findings pane carried 470 words and the Value tab 946.
 *
 * `Why` collapses that on screen. The thing that makes it safe rather than
 * merely quieter is that nothing is removed: the text stays in the DOM, so
 * find-in-page still reaches it, and `print-open` — the class the report
 * stylesheet forces open — means a document sent to a lender still carries
 * every sentence.
 *
 * This guards the second half. A `Why` that rendered its children
 * conditionally, or lost the class, would quietly strip the caveats out of the
 * report and nothing else would notice.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const kit = readFileSync('apps/web/src/components/ui/kit.tsx', 'utf8');
const css = readFileSync('apps/web/src/index.css', 'utf8');

/** The body of the `Why` component. */
function whySource(): string {
  const start = kit.indexOf('export function Why(');
  assert.ok(start > 0, 'the Why component must exist');
  const next = kit.indexOf('export function', start + 10);
  return kit.slice(start, next === -1 ? undefined : next);
}

describe('the Why disclosure', () => {
  it('carries the class the print stylesheet opens', () => {
    assert.match(whySource(), /print-open/);
  });

  it('renders its children rather than a summary of them', () => {
    // The failure this guards against is a "read more" that shows an excerpt:
    // the report would then print the excerpt, not the caveat.
    assert.match(whySource(), /\{children\}/);
  });

  it('is a details element, so find-in-page and the keyboard reach it', () => {
    const src = whySource();
    assert.match(src, /<details/);
    assert.match(src, /<summary/);
  });

  it('is matched by a print rule that forces it open', () => {
    // Both halves have to agree on the class name, and they live in different
    // files — which is exactly how one of them comes to be renamed alone.
    assert.match(css, /@media print/);
    assert.match(css, /details\.print-open\s*>\s*\*:not\(summary\)\s*\{[^}]*display:\s*block\s*!important/);
  });
});

describe('what the registers no longer print inline', () => {
  const compliance = readFileSync('apps/web/src/components/ScreenResultPanel.tsx', 'utf8');

  it('puts the compliance narrative behind the disclosure, not in the row', () => {
    // finding / consequence / nextStep were three paragraphs on every check.
    const row = compliance.slice(compliance.indexOf('function ComplianceRow'), compliance.indexOf('function ComplianceRow') + 1400);
    assert.match(row, /<Why>/, 'the check narrative must be disclosed rather than inline');
    for (const field of ['check.finding', 'check.consequence', 'check.nextStep']) {
      assert.ok(row.includes(field), `${field} must still be rendered somewhere in the row`);
    }
  });
});
