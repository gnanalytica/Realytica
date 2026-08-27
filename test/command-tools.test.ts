/**
 * The chat command tools — the authorship law's acting half.
 *
 * What must hold: a valid command lands in the collector exactly as typed; an
 * id the case does not hold is refused at collection time and collects
 * nothing (so the route's application step can never miss); a finding that is
 * not awaiting review cannot be reviewed; and a navigation target outside the
 * closed list never reaches the client.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandTools } from '@realytica/agents';
import type { CopilotCommand, CopilotNavigation } from '@realytica/agents';
import type { PropertyCase, TechnicalFinding } from '@realytica/shared';
import { NOW, caseFrom, screenSeed } from './fixtures';

interface RunnableTool {
  name: string;
  run: (args: never, context: never) => Promise<string> | string;
}

function harness(mutate?: (c: PropertyCase) => void) {
  const { result, identity, documents } = screenSeed('Site No. 118');
  const caseData = caseFrom(identity, documents, result, { id: 'cmd-1' });
  mutate?.(caseData);
  const commands: CopilotCommand[] = [];
  const navigations: CopilotNavigation[] = [];
  const tools = createCommandTools(caseData, commands, navigations) as unknown as RunnableTool[];
  const call = async (name: string, args: object) => {
    const tool = tools.find(t => t.name === name);
    assert.ok(tool, `expected a ${name} tool`);
    return JSON.parse(String(await tool.run(args as never, {} as never)));
  };
  return { caseData, commands, navigations, call };
}

function proposedFinding(caseId: string): TechnicalFinding {
  return {
    id: 'tf-prop',
    caseId,
    system: 'mep_electrical',
    zone: 'DG room',
    observation: 'Busduct floor cutout has no water barrier',
    severity: 'critical',
    recommendation: 'Install baffles',
    evidenceDocumentIds: [],
    source: 'agent',
    reviewState: 'proposed',
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('command tools', () => {
  test('a valid risk-status command collects exactly what was asked', async () => {
    const { caseData, commands, call } = harness();
    const risk = caseData.result?.risks[0];
    assert.ok(risk);
    const out = await call('set_risk_status', { riskId: risk.id, status: 'mitigated' });
    assert.equal(out.done, true);
    assert.deepEqual(commands, [{ kind: 'set_risk_status', riskId: risk.id, status: 'mitigated' }]);
  });

  test('an unknown id is refused and collects nothing', async () => {
    const { commands, call } = harness();
    const out = await call('set_risk_status', { riskId: 'no-such-risk', status: 'accepted' });
    assert.ok(out.error);
    assert.equal(commands.length, 0);
  });

  test('only a proposed finding is reviewable, and acceptance collects the decision', async () => {
    const { commands, call } = harness(c => {
      c.technicalFindings = [proposedFinding(c.id), { ...proposedFinding(c.id), id: 'tf-acc', reviewState: 'accepted' }];
    });
    const already = await call('review_technical_finding', { findingId: 'tf-acc', decision: 'accepted' });
    assert.ok(already.error, 'an already-accepted finding is not awaiting review');
    const ok = await call('review_technical_finding', { findingId: 'tf-prop', decision: 'accepted' });
    assert.equal(ok.done, true);
    assert.deepEqual(commands, [{ kind: 'review_technical_finding', findingId: 'tf-prop', decision: 'accepted' }]);
  });

  test('navigation accepts only the closed target list', async () => {
    const { navigations, call } = harness();
    const ok = await call('open_view', { target: 'diligence?view=graph' });
    assert.equal(ok.done, true);
    const bad = await call('open_view', { target: 'https://evil.example/phish' });
    assert.ok(bad.error);
    assert.deepEqual(navigations, [{ target: 'diligence?view=graph' }]);
  });

  test('reclassification validates both the document and the kind', async () => {
    const { caseData, commands, call } = harness();
    const doc = caseData.documents[0];
    const badKind = await call('set_document_kind', { documentId: doc.id, documentKind: 'not_a_kind' });
    assert.ok(badKind.error);
    const ok = await call('set_document_kind', { documentId: doc.id, documentKind: 'mother_deed' });
    assert.equal(ok.done, true);
    assert.deepEqual(commands, [{ kind: 'set_document_kind', documentId: doc.id, docKind: 'mother_deed' }]);
  });
});
