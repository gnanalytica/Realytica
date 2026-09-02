/**
 * Filing a folder of documents against the rows that were expecting them.
 *
 * The failure this guards against is not "no match" — that is visible and a
 * person fixes it in one select. It is a confident wrong match: the layout plan
 * filed as the site plan because both titles contain "plan", or one of two
 * encumbrance certificates chosen silently. Both are quiet, and both end with a
 * report citing a document that does not say what the report says it says.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_MATCH_FLOOR, matchFilesToEvidence, type EvidenceRecord } from '@realytica/shared';

let n = 0;
function row(title: string, status: EvidenceRecord['status'] = 'expected'): EvidenceRecord {
  n += 1;
  return {
    id: `ev-${n}`,
    title,
    kind: 'document',
    status,
    considered: false,
    used: false,
    assetIds: [],
    assessmentIds: [],
    scopeInstanceIds: [],
    checkIds: [],
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as EvidenceRecord;
}

const REGISTER = [
  row('Title extract'),
  row('Survey plan'),
  row('Layout plan'),
  row('Sanctioned building plan'),
  row('Encumbrance certificate'),
  row('Soil report'),
  row('Khata certificate'),
  row('Occupancy certificate'),
];

function fileOne(name: string, rows = REGISTER) {
  return matchFilesToEvidence(rows, [name])[0]!;
}

describe('matching a dropped folder to the register', () => {
  it('files a document whose name is the title', () => {
    const m = fileOne('Title extract.pdf');
    assert.equal(m.title, 'Title extract');
    assert.equal(m.score, 1);
  });

  it('sees through the noise a scanner adds', () => {
    for (const name of ['soil-report-final.pdf', 'Soil_Report_scanned_copy.PDF', 'soil report v2.pdf']) {
      assert.equal(fileOne(name).title, 'Soil report', name);
    }
  });

  it('does not file the layout plan as the site survey', () => {
    // "plan" is in three titles, so it cannot identify any of them.
    const m = fileOne('plan.pdf');
    assert.equal(m.evidenceId, undefined);
    assert.equal(m.score, 0);
  });

  it('picks the right plan when the deciding word is present', () => {
    assert.equal(fileOne('layout-plan.pdf').title, 'Layout plan');
    assert.equal(fileOne('Survey Plan (1).pdf').title, 'Survey plan');
    assert.equal(fileOne('sanctioned building plan.pdf').title, 'Sanctioned building plan');
  });

  it('prefers the longer title when both fully match', () => {
    const rows = [row('Survey'), row('Survey plan')];
    assert.equal(matchFilesToEvidence(rows, ['survey-plan.pdf'])[0]!.title, 'Survey plan');
  });

  it('refuses a filename that says nothing', () => {
    for (const name of ['IMG_2211.jpg', 'DSC00042.JPG', 'scan0001.pdf', '20260114.pdf']) {
      assert.equal(fileOne(name).evidenceId, undefined, name);
    }
  });

  it('asks rather than guessing between two rows that fit alike', () => {
    const rows = [row('Encumbrance certificate'), row('Encumbrance certificate')];
    const m = matchFilesToEvidence(rows, ['EC encumbrance certificate.pdf'])[0]!;
    assert.ok(m.evidenceId, 'it should still propose one');
    assert.ok(m.ambiguousWith, 'and flag that another fits as well');
    assert.notEqual(m.ambiguousWith!.evidenceId, m.evidenceId);
  });

  it('does not cry ambiguity when one row plainly fits better', () => {
    assert.equal(fileOne('khata certificate.pdf').ambiguousWith, undefined);
  });

  it('gives a row still waiting the document over one already filed', () => {
    const filed = row('Topo survey', 'received');
    const waiting = row('Topo survey', 'expected');
    const m = matchFilesToEvidence([filed, waiting], ['topo survey.pdf'])[0]!;
    assert.equal(m.evidenceId, waiting.id);
  });

  it('keeps the input order so a caller can zip results onto its own list', () => {
    const names = ['soil report.pdf', 'IMG_1.jpg', 'khata certificate.pdf'];
    const out = matchFilesToEvidence(REGISTER, names);
    assert.deepEqual(out.map((m) => m.fileName), names);
    assert.equal(out[1]!.evidenceId, undefined);
  });

  it('never files below the floor', () => {
    for (const m of matchFilesToEvidence(REGISTER, ['certificate.pdf', 'report.pdf', 'x.pdf'])) {
      if (m.evidenceId) assert.ok(m.score >= FILE_MATCH_FLOOR, `${m.fileName} at ${m.score}`);
    }
  });

  it('handles an empty register without throwing', () => {
    assert.deepEqual(matchFilesToEvidence([], ['anything.pdf']), [{ fileName: 'anything.pdf', score: 0 }]);
  });
});
