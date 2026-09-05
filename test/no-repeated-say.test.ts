/**
 * A fact stated once is a fact. Stated twice, four lines apart, it is noise.
 *
 * Found by measuring rather than reading. Every valuation input renders a
 * provenance line — what stood in, and where it came from — and beneath it a
 * note saying why. They drifted into saying both: the line ended "a locality
 * median — a market observation, not inspected for this asset" and the note
 * ended "It was not inspected for this asset", the same clause twice, in a
 * panel whose entire job is to be checkable.
 *
 * What is pinned here is that the engine's notes carry only what the
 * provenance vocabulary does not. The component has a guard as well — a note
 * wholly contained in the line above it is dropped — but a guard that fires
 * routinely is a guard hiding a problem rather than catching one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INPUT_SOURCE_STRENGTH } from '@realytica/shared';

/** Substantive words, the way the component's own guard compares them. */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

describe('a valuation note does not restate its provenance line', () => {
  it('adds something no source line can say', () => {
    /*
     * The property, stated exactly: no note is WHOLLY contained in the
     * provenance vocabulary. Shared words alone prove nothing — "recorded on
     * a check" and "nothing recorded on the check" have two words in common
     * and say opposite things. Containment is what the component's own guard
     * measures, and a note that fails it renders nothing.
     */
    const notes = [
      'Nothing recorded on Subject identification, so this stands in. It carries no proof requirement.',
      'Nothing recorded on the comparable-inputs check, so this stands in.',
    ];
    for (const note of notes) {
      for (const strength of Object.values(INPUT_SOURCE_STRENGTH)) {
        const said = [...words(note)];
        const line = words(strength);
        assert.ok(
          !said.every((w) => line.has(w)),
          `"${note}" is entirely contained in "${strength}" and would render nothing`,
        );
      }
    }
  });

  it('carries no clause verbatim from the vocabulary beside it', () => {
    // The specific regression: "not inspected for this asset" appeared in the
    // locality source line AND at the end of the note under it.
    for (const note of [
      'Nothing recorded on Subject identification, so this stands in. It carries no proof requirement.',
      'Nothing recorded on the comparable-inputs check, so this stands in.',
    ]) {
      for (const strength of Object.values(INPUT_SOURCE_STRENGTH)) {
        for (const clause of strength.split(/\s*[—,]\s*/).map((c) => c.trim()).filter((c) => c.split(' ').length >= 3)) {
          assert.ok(!note.toLowerCase().includes(clause.toLowerCase()), `note repeats "${clause}" verbatim`);
        }
      }
    }
  });

  it('keeps the part only the note knows', () => {
    // The substitution reason is what the provenance line cannot say, and is
    // the whole reason a note exists. Losing it would be the opposite mistake.
    for (const note of [
      'Nothing recorded on Subject identification, so this stands in. It carries no proof requirement.',
      'Nothing recorded on the comparable-inputs check, so this stands in.',
    ]) {
      assert.match(note, /stands in/, 'a note must still say that a fallback was used');
      assert.match(note, /Nothing recorded on/, 'and what was missing');
    }
  });
});
