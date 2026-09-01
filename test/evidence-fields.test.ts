/**
 * A citation has to point at something.
 *
 * `kind: 'evidence'` fields were declared on five checks and rendered as a
 * plain text box — a person typed a filename into it. Two things were wrong
 * with that and only one of them was the missing control:
 *
 * 1. The field held ONE string, while every label on it is plural. "Site
 *    photographs" could hold one of forty shots and read as satisfied.
 * 2. Nothing checked the value named a row that exists. A deleted evidence
 *    row left the check rendering as evidenced, the report counting it, and
 *    nobody finding out until they clicked.
 *
 * The second is the one that matters: a dangling citation is worse than a
 * blank, because a blank is visibly missing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  checkInsights,
  createAssessment,
  createProject,
  formatFieldValue,
  recordCheckFields,
  validateFieldValue,
  type CheckFieldDef,
  type DdProject,
} from '@realytica/shared';

const SITE_PHOTOS: CheckFieldDef = { key: 'site_photos', label: 'Site photographs', kind: 'evidence', accepts: 'image', required: false };

function fileWith(dds: Parameters<typeof createAssessment>[1]['ddType'][]): DdProject {
  const project = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-E1');
  for (const ddType of dds) createAssessment(project, { ddType, name: `${ddType} DD`, owner: 'Lead', targetType: 'project' });
  return project;
}

function checkIn(project: DdProject, definitionId: string): string {
  for (const a of project.assessments) {
    for (const s of a.scopes) {
      const hit = s.checks.find((c) => c.definitionId === definitionId);
      if (hit) return hit.id;
    }
  }
  throw new Error(`no ${definitionId} on this file`);
}

describe('an evidence field holds a set of rows', () => {
  it('takes a list, and a comma string, and de-duplicates', () => {
    assert.deepEqual(validateFieldValue(SITE_PHOTOS, ['ev_1', 'ev_2']), { value: ['ev_1', 'ev_2'] });
    assert.deepEqual(validateFieldValue(SITE_PHOTOS, 'ev_1, ev_2'), { value: ['ev_1', 'ev_2'] });
    assert.deepEqual(validateFieldValue(SITE_PHOTOS, ['ev_1', 'ev_1']), { value: ['ev_1'] });
  });

  it('reads a blank as nothing recorded, not as an empty citation', () => {
    assert.deepEqual(validateFieldValue(SITE_PHOTOS, ''), { value: null });
    assert.deepEqual(validateFieldValue(SITE_PHOTOS, []), { value: null });
  });

  it('counts rather than printing ids at a reader', () => {
    // The titles live on the project, which the formatter cannot see. Better
    // to say how many than to put "ev_1a05…" in a report.
    const at = '2026-09-01T00:00:00.000Z';
    assert.equal(formatFieldValue(SITE_PHOTOS, { value: ['ev_1', 'ev_2'], at, by: 'x' }), '2 document(s)');
  });
});

describe('a citation that points at nothing is refused', () => {
  it('rejects an id that is not on the register', () => {
    const project = fileWith(['technical']);
    const checkId = checkIn(project, 'technical.fire_life_safety');
    const outcome = recordCheckFields(project, checkId, { site_photos: ['ev_nope'] });
    assert.equal(outcome.rejected.length, 1);
    assert.match(outcome.rejected[0]!.error, /not on the evidence register/);
  });

  it('takes ids that are', () => {
    const project = fileWith(['technical']);
    const a = addEvidence(project, { title: 'Refuge floor, level 12', kind: 'photograph' });
    const b = addEvidence(project, { title: 'Staircase pressurisation', kind: 'photograph' });
    const checkId = checkIn(project, 'technical.fire_life_safety');
    const outcome = recordCheckFields(project, checkId, { site_photos: [a.id, b.id] });
    assert.deepEqual(outcome.rejected, []);
    assert.deepEqual(outcome.check.fields!.site_photos!.value, [a.id, b.id]);
  });

  it('takes the whole write down with it, so a half-cited check cannot exist', () => {
    const project = fileWith(['technical']);
    const good = addEvidence(project, { title: 'Refuge floor', kind: 'photograph' });
    const checkId = checkIn(project, 'technical.fire_life_safety');
    const outcome = recordCheckFields(project, checkId, { staircases: 3, site_photos: [good.id, 'ev_nope'] });
    assert.equal(outcome.rejected.length, 1);
    assert.equal(outcome.check.fields?.staircases, undefined, 'the good value did not land either');
  });
});

describe('a row carries its own proof', () => {
  it('holds one document per row, because a cell is a scalar', () => {
    const def: CheckFieldDef = {
      key: 'nocs',
      label: 'Statutory NOCs',
      kind: 'table',
      columns: [
        { key: 'noc', label: 'NOC', kind: 'enum', options: ['Fire', 'Lake / SWD'] },
        { key: 'certificate', label: 'Certificate', kind: 'evidence', accepts: 'document' },
      ],
    };
    const ok = validateFieldValue(def, [{ noc: 'Fire', certificate: 'ev_1' }]);
    assert.deepEqual(ok, { value: [{ noc: 'Fire', certificate: 'ev_1' }] });

    const two = validateFieldValue(def, [{ noc: 'Fire', certificate: ['ev_1', 'ev_2'] }]);
    assert.ok('error' in two);
    assert.match(two.error, /one document per row/);
  });
});

describe('a NOC register says what a multi-select could not', () => {
  const at = '2026-09-01T00:00:00.000Z';
  const NOW = new Date('2026-09-01T00:00:00.000Z');

  function nocCheck(rows: Array<Record<string, unknown>>) {
    const project = fileWith(['approval_compliance']);
    const checkId = checkIn(project, 'regulatory.nocs');
    return { project, checkId, rows };
  }

  it('flags a NOC held in hand that has already expired', () => {
    const { project, checkId } = nocCheck([]);
    const outcome = recordCheckFields(project, checkId, {
      nocs: [{ noc: 'Fire', authority: 'KSFES', number: 'F/2021/88', valid_to: '2025-06-30', status: 'in hand' }],
    });
    assert.deepEqual(outcome.rejected, []);
    const insights = checkInsights(outcome.reading.defs, outcome.reading.values, [
      { kind: 'row_expired', fields: ['nocs'], column: 'valid_to', gate: 'status', whenIn: ['in hand'], severity: 'high', say: '{row} expired on {a}, {days} day(s) ago.' },
    ], NOW);
    assert.equal(insights.length, 1);
    assert.match(insights[0]!.text, /Fire expired on 2025-06-30/);
  });

  it('leaves alone a NOC that is not required', () => {
    // The gate. An expired date on a NOC marked "not required" is not a
    // finding, and a register that nagged about it would be ignored wholesale.
    const { project, checkId } = nocCheck([]);
    const outcome = recordCheckFields(project, checkId, {
      nocs: [{ noc: 'Railways', valid_to: '2020-01-01', status: 'not required' }],
    });
    const insights = checkInsights(outcome.reading.defs, outcome.reading.values, [
      { kind: 'row_expired', fields: ['nocs'], column: 'valid_to', gate: 'status', whenIn: ['in hand'], severity: 'high', say: '{row} expired.' },
    ], NOW);
    assert.deepEqual(insights, []);
  });

  it('says a NOC nobody can produce the certificate for is not in hand', () => {
    const { project, checkId } = nocCheck([]);
    const outcome = recordCheckFields(project, checkId, {
      nocs: [{ noc: 'Lake / SWD', status: 'in hand', valid_to: '2027-01-01' }],
    });
    const insights = checkInsights(outcome.reading.defs, outcome.reading.values, [
      { kind: 'row_missing', fields: ['nocs'], column: 'certificate', gate: 'status', whenIn: ['in hand'], severity: 'medium', say: '{row} has no certificate.' },
    ], NOW);
    assert.equal(insights.length, 1);
    assert.match(insights[0]!.text, /Lake \/ SWD has no certificate/);
  });

  it('keeps a missing expiry apart from an expired one', () => {
    // Different facts, different rules. A blank valid-to is not in the past.
    const { project, checkId } = nocCheck([]);
    const outcome = recordCheckFields(project, checkId, { nocs: [{ noc: 'Fire', status: 'in hand' }] });
    const expired = checkInsights(outcome.reading.defs, outcome.reading.values, [
      { kind: 'row_expired', fields: ['nocs'], column: 'valid_to', gate: 'status', whenIn: ['in hand'], severity: 'high', say: 'expired' },
    ], NOW);
    assert.deepEqual(expired, [], 'a blank date has not expired');

    const missing = checkInsights(outcome.reading.defs, outcome.reading.values, [
      { kind: 'row_missing', fields: ['nocs'], column: 'valid_to', gate: 'status', whenIn: ['in hand'], severity: 'low', say: '{row} has no validity date.' },
    ], NOW);
    assert.equal(missing.length, 1);
  });

  it('names the row by its identifying cell, and falls back to a position', () => {
    const { project, checkId } = nocCheck([]);
    const outcome = recordCheckFields(project, checkId, { nocs: [{ status: 'in hand' }] });
    const insights = checkInsights(outcome.reading.defs, outcome.reading.values, [
      { kind: 'row_missing', fields: ['nocs'], column: 'certificate', gate: 'status', whenIn: ['in hand'], severity: 'medium', say: '{row} has no certificate.' },
    ], NOW);
    assert.match(insights[0]!.text, /row 1 has no certificate/);
  });

  it('fires the rules this product actually ships, not hand-written ones', () => {
    /*
     * The declarations in `check-schemas.ts`, reached the way the panel
     * reaches them. Dates are built relative to now rather than written down,
     * so the test does not quietly start passing for the wrong reason in 2031.
     */
    const past = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const { project, checkId } = nocCheck([]);
    const { reading } = recordCheckFields(project, checkId, {
      nocs: [
        { noc: 'Fire', authority: 'KSFES', valid_to: past, status: 'in hand' },
        { noc: 'Airport height', authority: 'AAI', valid_to: future, status: 'in hand' },
        { noc: 'Railways', valid_to: past, status: 'not required' },
      ],
    });

    assert.equal(reading.values.noc_count?.value, 3, 'the computed count reads the table');
    const texts = reading.insights.map((i) => i.text);
    assert.ok(texts.some((t) => /^Fire is recorded as in hand but expired/.test(t)), texts.join(' | '));
    assert.ok(!texts.some((t) => /Airport height .*expired/.test(t)), 'a live NOC is not a finding');
    assert.ok(!texts.some((t) => /Railways/.test(t)), 'and neither is one that is not required');
    // Both in-hand NOCs lack a certificate, and the shipped rule says so.
    assert.equal(texts.filter((t) => /no certificate filed/.test(t)).length, 2);
  });
});
