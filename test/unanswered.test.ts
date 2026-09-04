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
import { failureCause, unansweredReason } from '@realytica/shared';

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
