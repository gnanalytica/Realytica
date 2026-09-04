/**
 * The screen's bookkeeping stopped being prose.
 *
 * `runProjectScreen` has to know whether it already filed a given finding, or
 * a second run files the missing-khata finding twice. It answered that by
 * appending `[screen:<code>]` to the record's own description and reading it
 * back — which worked, and put twenty internal keys in front of readers.
 * Measured in the running app: eight on Findings, eight on Risks, and four
 * inside the Red flag report, the document that goes to a client, where a
 * finding about permitted FAR ended `[screen:far_exceeded]`.
 *
 * Two properties, and the second is the one that makes the first safe to do:
 * no record's prose carries a marker, and the screen is still idempotent —
 * including for records written before the field existed, which have the
 * marker baked into their text and must not be re-filed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ensureProjectShape, type DdProject } from '@realytica/shared';

const MARK = /\[screen:[a-z0-9_-]+\]/i;

/** Every prose field the screen has ever written a marker into. */
function proseOf(project: DdProject): string[] {
  return [
    ...project.findings.map((f) => f.description),
    ...project.risks.flatMap((r) => [r.cause, r.residualNote ?? '']),
    ...project.actions.map((a) => a.description),
    ...project.evidence.map((e) => e.description ?? ''),
    ...project.decisions.map((d) => d.rationale),
  ].filter(Boolean) as string[];
}

/** A file as an earlier build left it: the code inline, no field. */
function legacyProject(): DdProject {
  return {
    id: 'prj_legacy',
    // The collections `ensureProjectShape` walks. Present and empty so the
    // migration is exercised against a realistic shape rather than a stub.
    assessments: [],
    reports: [],
    assets: [],
    visits: [],
    sheets: [],
    conversation: [],
    valuationRuns: [],
    findings: [{ id: 'f1', description: 'Built-up area implies a FAR of 2.27.\n\n[screen:far_exceeded]' }],
    risks: [{ id: 'r1', cause: 'Tenure is unconfirmed.\n\n[screen:unknown_tenure]', residualNote: undefined }],
    actions: [{ id: 'a1', description: 'Obtain the khata extract.\n\n[screen:missing_critical_documents]' }],
    evidence: [{ id: 'e1', description: 'Required for a complete screen.\n\n[screen:karnataka_no_ekhata]' }],
    decisions: [{ id: 'd1', rationale: 'Proceed with conditions.\n\n[screen:verdict]' }],
  } as unknown as DdProject;
}

describe('screen markers never reach a reader', () => {
  it('lifts an inline marker out of prose when an old file is loaded', () => {
    const project = legacyProject();
    ensureProjectShape(project);

    for (const text of proseOf(project)) {
      assert.doesNotMatch(text, MARK, `a marker survived into: ${JSON.stringify(text)}`);
    }
  });

  it('keeps the code, so the screen can still tell it already filed this', () => {
    // Stripping without keeping would be worse than leaking: the next screen
    // run would re-file every finding on every previously screened project.
    const project = legacyProject();
    ensureProjectShape(project);

    assert.equal(project.findings[0].screenCode, 'far_exceeded');
    assert.equal(project.risks[0].screenCode, 'unknown_tenure');
    assert.equal(project.actions[0].screenCode, 'missing_critical_documents');
    assert.equal(project.evidence[0].screenCode, 'karnataka_no_ekhata');
    assert.equal(project.decisions[0].screenCode, 'verdict');
  });

  it('leaves the sentence itself intact, ending where the author ended it', () => {
    const project = legacyProject();
    ensureProjectShape(project);
    assert.equal(project.findings[0].description, 'Built-up area implies a FAR of 2.27.');
    assert.equal(project.decisions[0].rationale, 'Proceed with conditions.');
  });

  it('is idempotent — loading twice changes nothing', () => {
    const project = legacyProject();
    ensureProjectShape(project);
    const after = JSON.stringify(project);
    ensureProjectShape(project);
    assert.equal(JSON.stringify(project), after);
  });

  it('leaves prose that merely mentions brackets alone', () => {
    // The migration must not be a general bracket-stripper: a finding may
    // legitimately quote a clause reference in square brackets.
    const project = {
      ...legacyProject(),
      findings: [{ id: 'f2', description: 'Deed clause [4(b)] conflicts with the schedule.' }],
    } as unknown as DdProject;
    ensureProjectShape(project);
    assert.equal(project.findings[0].description, 'Deed clause [4(b)] conflicts with the schedule.');
    assert.equal(project.findings[0].screenCode, undefined);
  });
});
