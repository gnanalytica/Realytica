/**
 * Completeness measures the pack, not the paperwork you happen to hold.
 *
 * The denominator was `pack.length` — the count of evidence rows whose title
 * matched a core item — so it grew with the numerator. An empty project read
 * 0/16 from a fallback; file one encumbrance certificate and it read 1/1, one
 * hundred per cent. A gauge of sixteen expected documents jumped to full on a
 * single upload and could never report a gap again.
 *
 * Found by putting the figure before and after an upload side by side in the
 * chat receipt, which is the one place the two numbers were ever compared.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addEvidence, createProject, packCompleteness, type DdProject } from '@realytica/shared';

const project = (): DdProject =>
  createProject({ name: 'Balagere', type: 'residential', location: 'Varthur', city: 'Bengaluru' }, 'RYT-C1');

const file = (p: DdProject, title: string): void => {
  addEvidence(p, { title, kind: 'document', status: 'received' }, 'operator');
};

describe('packCompleteness', () => {
  it('holds the denominator steady as documents arrive', () => {
    const p = project();
    const empty = packCompleteness(p);
    assert.equal(empty.received, 0);
    assert.equal(empty.percent, 0);

    file(p, 'Encumbrance certificate 2015-2024');
    const one = packCompleteness(p);
    assert.equal(one.total, empty.total, 'the pack does not shrink to fit what arrived');
    assert.equal(one.received, 1);
    assert.ok(one.percent > 0 && one.percent < 100, `one of ${one.total} is not complete, got ${one.percent}%`);
  });

  it('counts a core item once however many documents answer it', () => {
    const p = project();
    file(p, 'Encumbrance certificate — Sy. 50/2');
    file(p, 'Encumbrance certificate — Sy. 51/1');
    file(p, 'Encumbrance certificate — Sy. 53/1');
    assert.equal(packCompleteness(p).received, 1, 'three ECs answer one core item');
  });

  it('names what is still missing rather than what arrived', () => {
    const p = project();
    file(p, 'RERA registration certificate');
    const pack = packCompleteness(p);
    assert.ok(!pack.missingTitles.some((t) => t.includes('rera')), 'a held item is not missing');
    assert.equal(pack.missing, pack.total - pack.received);
  });

  it('reaches 100% only when every core item is held', () => {
    const p = project();
    for (const t of [
      'title extract', 'title chain', 'title schedule', 'sale deed', 'mother deed', 'encumbrance',
      'survey plan', 'cadastral map', 'boundary survey', 'conversion order', 'sanction plan',
      'layout plan', 'khata certificate', 'fire noc', 'soil report', 'rera certificate',
    ]) file(p, t);
    assert.equal(packCompleteness(p).percent, 100);
  });
});
