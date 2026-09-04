/**
 * A briefing is not an answer, and must not be mistaken for one.
 *
 * The copilot is reached only when the deterministic router declines a
 * question. When that call cannot be made — no endpoint, a rate limit, a
 * timeout — the request falls through to the day's standing briefing so chat
 * keeps working. That part is right. What was wrong is that it fell through in
 * silence.
 *
 * Measured against the seeded project with no model configured: twelve
 * questions, seven of which came back with the SAME 337-character briefing —
 * "what would a buyer pay for this?", "when was the last EC checked?",
 * "compare this to the other Bengaluru project", "thanks" and "asdkjhasd"
 * among them — each rendered in the same voice and the same position as a real
 * reply, with nothing to say the question had never been reached.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  createProject,
  ensureProjectShape,
  failureCause,
  looksLikeProviderError,
  unansweredReason,
} from '@realytica/shared';

describe('failureCause', () => {
  it('reads a deployment with no endpoint as unconfigured, not as an auth problem', () => {
    // The exact string this deployment emits — it names a key while being a
    // configuration problem, so the credential branch must not claim it first.
    assert.equal(
      failureCause('No model endpoint is configured for this deployment (set REALYTICA_API_KEY, or REALYTICA_BASE_URL for a proxy) — document intelligence is unavailable.'),
      'unconfigured',
    );
  });

  it('classifies the provider bodies seen in a real upload batch', () => {
    assert.equal(
      failureCause('Request rejected: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Failed to parse the file: The document parsing engine is currently rate limited. Please retry shortly."}}'),
      'rate_limited',
      'a rate limit inside a parse error is still a rate limit',
    );
    assert.equal(
      failureCause('Model output failed schema validation: [{ "code": "invalid_type", "path": ["fields", 6, "unit"] }]'),
      'malformed',
    );
    assert.equal(failureCause('socket hang up'), 'timeout');
    assert.equal(failureCause(''), 'unknown');
    assert.equal(failureCause(undefined), 'unknown');
  });
});

describe('unansweredReason', () => {
  it('says whether waiting helps or somebody must change a setting', () => {
    assert.match(unansweredReason('rate_limited'), /again in a minute/);
    assert.match(unansweredReason('unconfigured'), /no model endpoint is configured/);
  });

  it('never leaks transport detail into a diligence file', () => {
    for (const cause of ['rate_limited', 'unconfigured', 'timeout', 'malformed', 'unknown'] as const) {
      const text = unansweredReason(cause);
      assert.ok(!/\b(400|401|403|429|500)\b|request_id|invalid_type|\{"/.test(text), text);
      assert.ok(text.startsWith('I c'), `speaks in the first person to the asker: ${text}`);
    }
  });
});

/**
 * Notes already written before the two fields were separated.
 *
 * Four NOCs on a live project carry an HTTP 400 body as their extraction note,
 * filed when a rate-limited parse rendered as a classification and was
 * approved along with the two that had genuinely been read. New uploads cannot
 * do this; these are the rows already on disk.
 *
 * The detector has to be wrong on purpose to fire. Clearing a real extraction
 * note destroys the only record of what a document said, which is worse than
 * leaving an ugly one in place — so what is pinned here is mostly what it must
 * NOT touch.
 */
describe('looksLikeProviderError', () => {
  it('recognises the bodies that were actually filed', () => {
    for (const text of [
      'Request rejected: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Failed to parse the file: The document parsing engine is currently rate limited."},"request_id":"gen-1788542189-prKYqtxrO7uDaQMCSLvG"}',
      'Model output failed schema validation: [ { "code": "invalid_type", "expected": "string", "path": [ "fields", 6, "unit" ] } ]',
      'No model endpoint is configured for this deployment (set REALYTICA_API_KEY).',
    ]) assert.equal(looksLikeProviderError(text), true, text.slice(0, 60));
  });

  it('leaves a real extraction note alone', () => {
    for (const text of [
      'The document is a project-level K-RERA registration certificate (FORM-C) covering the entire Sobha Ayana at Dream Acres Wings 60-71 development — not an individual unit registration. Validity: only the end date 31-12-2031 is stated.',
      'A merge of six Encumbrance Certificates (Form 16 under Rule 148), all issued by the Sub-Registrar, Varthur, covering Balagere Village. Only the first lists a transaction, dated 23/Mar/2021.',
      'The EC subject line lists Sy. Nos. 50/2, 50/4, 51/2B1, 53/1 — every survey number in the case property’s parcel.',
      'Sanction is conditional; condition 4 requires a fire NOC before occupancy. Status not stated.',
      '',
    ]) assert.equal(looksLikeProviderError(text), false, text.slice(0, 60));
  });

  it('clears a poisoned note off an evidence row on load, and only that one', () => {
    const p = createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');
    const good = addEvidence(p, { title: 'RERA certificate', kind: 'document', status: 'received' }, 'operator');
    const bad = addEvidence(p, { title: 'BWSSB NOC', kind: 'document', status: 'received' }, 'operator');
    good.extractionNotes = 'FORM-C registration certificate, valid to 31-12-2031.';
    bad.extractionNotes = 'Request rejected: 400 {"type":"error","error":{"type":"invalid_request_error"}}';

    ensureProjectShape(p);

    assert.equal(p.evidence.find((e) => e.id === bad.id)?.extractionNotes, undefined, 'the error is gone');
    assert.equal(
      p.evidence.find((e) => e.id === good.id)?.extractionNotes,
      'FORM-C registration certificate, valid to 31-12-2031.',
      'a real note survives untouched',
    );
    assert.equal(p.evidence.length, 2, 'the document itself is never removed — the PDF is real');
  });
});
