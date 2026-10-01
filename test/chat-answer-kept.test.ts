/**
 * Answers that were written and then lost.
 *
 * Both measured on Sobha Ayana through OpenRouter with Claude Sonnet 5.5:
 *
 * - The project copilot wrote its answer in the same message as its last tool
 *   call (`navigate_pane`), then ended the loop with one empty token. Only the
 *   last message was read, so the person got "I looked at the project".
 * - A short question that names a DD is answered from the register briefing,
 *   which names each finding but not what it rests on. Asked which documents
 *   say two NOCs lapsed, the model said the briefing did not name them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerOfLoop } from '../packages/agents/src/agents/project-copilot';
import { carryLastWords } from '../packages/agents/src/providers/anthropic';
import { addFinding, createProject, findingEvidenceBriefing, type DdProject } from '../packages/shared/src';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };

const look: Block = { type: 'tool_use', id: 'tu_1', name: 'get_project', input: {} };
const open: Block = { type: 'tool_use', id: 'tu_2', name: 'navigate_pane', input: { target: 'findings' } };

describe('the end of a tool loop', () => {
  it('keeps the answer written beside the last tool call when the loop ends empty', () => {
    const answer: Block = { type: 'text', text: 'Two NOCs have lapsed: BSNL on 15 Mar 2019 and the AAI height NOC on 10 Mar 2020.' };
    const messages = [
      { content: [{ type: 'text', text: 'Let me read the project.' } as Block, look] },
      { content: [answer, open] },
      { content: [] as Block[] },
    ];
    assert.deepEqual(carryLastWords([], messages), [answer]);
  });

  it('takes the latest words, not the preamble before the first look', () => {
    const answer: Block = { type: 'text', text: 'The answer.' };
    const messages = [{ content: [{ type: 'text', text: 'Let me check.' } as Block, look] }, { content: [answer, open] }, { content: [] as Block[] }];
    assert.deepEqual(carryLastWords([], messages), [answer]);
  });

  it('leaves a last message that says something as it is', () => {
    const last: Block[] = [{ type: 'text', text: 'Final answer.' }];
    const messages = [{ content: [{ type: 'text', text: 'Earlier words.' } as Block, look] }, { content: last }];
    assert.deepEqual(carryLastWords(last, messages), last);
  });

  it('ignores whitespace as words, and returns the last message when nothing was said', () => {
    const blank: Block[] = [{ type: 'text', text: '  \n ' }];
    assert.deepEqual(carryLastWords(blank, [{ content: [look] }, { content: blank }]), blank);
  });
});

describe("the copilot's answer", () => {
  const getFinding: Block = { type: 'tool_use', id: 'tu_3', name: 'get_finding', input: {} };
  const answer: Block = { type: 'text', text: 'Two NOCs have lapsed. BSNL NOC, page 1: “valid for a period of Five Years”.' };

  it('is everything written after the last lookup, not only the closing line', () => {
    const loop = [[look], [getFinding], [answer, open], [{ type: 'text', text: "I've opened the BSNL NOC finding on the right." } as Block]];
    assert.equal(answerOfLoop(loop), `${answer.text}\n\nI've opened the BSNL NOC finding on the right.`);
  });

  it('is the answer written beside the last pane opened when the loop ends empty', () => {
    assert.equal(answerOfLoop([[look], [answer, open], []]), answer.text);
  });

  it('leaves out what was said before a lookup returned', () => {
    const loop = [[{ type: 'text', text: 'Let me check the findings.' } as Block, getFinding], [answer]];
    assert.equal(answerOfLoop(loop), answer.text);
  });

  it('is empty when the loop stopped on a lookup, so the caller falls back', () => {
    assert.equal(answerOfLoop([[look], [{ type: 'text', text: 'Checking.' } as Block, getFinding]]), '');
  });
});

describe('what the material findings rest on', () => {
  function withLapsedNoc(): DdProject {
    const project = createProject({ name: 'Client villas', type: 'residential', location: 'Varthur', city: 'Bengaluru' }, 'RYT-0009');
    project.evidence.push({
      id: 'ev_bsnl',
      title: 'BSNL NOC',
      kind: 'document',
      source: 'chat_upload',
      status: 'received',
      documentType: 'Utility NOC',
      attachments: [],
      assessmentIds: [],
      scopeInstanceIds: [],
      checkIds: [],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    } as unknown as DdProject['evidence'][number]);
    addFinding(project, {
      title: 'BSNL telecom NOC lapsed on 15 Mar 2019',
      description: 'It was issued on 15 Mar 2014 and states it is valid for 5 years. Source: Utility NOC, page 1 — “The certificate is valid for five years”.',
      severity: 'high',
      discipline: 'regulatory',
      evidenceIds: ['ev_bsnl'],
    });
    addFinding(project, { title: 'Tenure not confirmed', description: 'Freehold or leasehold is not stated.', severity: 'high', discipline: 'legal' });
    return project;
  }

  it('names the document behind a finding and carries its page and words', () => {
    const lines = findingEvidenceBriefing(withLapsedNoc());
    assert.match(lines, /BSNL telecom NOC lapsed on 15 Mar 2019\. Evidence: BSNL NOC \(Utility NOC\)\./);
    assert.match(lines, /page 1 — “The certificate is valid for five years”/);
  });

  it('leaves out a finding with nothing behind it, which the briefing already calls unevidenced', () => {
    assert.doesNotMatch(findingEvidenceBriefing(withLapsedNoc()), /Tenure not confirmed/);
    const bare = createProject({ name: 'Empty', type: 'residential', location: 'Varthur', city: 'Bengaluru' }, 'RYT-0010');
    assert.equal(findingEvidenceBriefing(bare), '');
  });
});
