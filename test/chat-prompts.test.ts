/**
 * The questions the chat offers, page by page.
 *
 * The same four were offered everywhere. Now a function's page, a
 * department's Summary and each shared place has its own few, kept in one
 * table, and anywhere else the questions follow from where the file stands.
 *
 * One rule decides whether a question may be offered at all: the file answers
 * it by itself. A chip that hands the question to a model can come back as an
 * apology on a deployment with none, and a chip that the engine reads as
 * something else is worse. So every question in the table is asked here, on
 * the page it is offered on, of both seeded projects.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  CHAT_PROMPTS,
  MENU_DEPARTMENTS,
  PROJECT_COCKPIT_PANES,
  addEvidence,
  applyProjectChat,
  attachEvidenceFile,
  chatPromptKey,
  chatPrompts,
  createProject,
  menuFunctions,
  paneOfFunction,
  seedBdaReferenceProject,
  seedDemoProject,
  stageOf,
  wantsDeterministicProjectChat,
  type ChatPlace,
  type DdProject,
  type ProjectCockpitPane,
} from '@realytica/shared';

/** "Read the filed documents", as the chat route reads it. The route's own rule, so the two cannot drift. */
let READ_FILED_REQUEST: RegExp;
before(async () => {
  ({ READ_FILED_REQUEST } = await import('../apps/api/src/documents/reread'));
});

const functions = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu).map((fn) => ({ ...fn, menu })));

/** The page a row of the table is offered on. */
function placeOf(project: DdProject, key: string): ChatPlace {
  const stage = stageOf(project.currentStage);
  const fn = functions.find((f) => f.key === key);
  if (fn) return { pane: paneOfFunction(fn.key), department: fn.menu, fn: fn.key, stage };
  const menu = MENU_DEPARTMENTS.find((m) => m === key);
  if (menu) return { pane: 'department', department: menu, stage };
  return { pane: key as ProjectCockpitPane, stage };
}

/**
 * Asks one question the way the chat would, and fails unless the file
 * answered it: with no model, in words, and without asking back what was
 * meant. "Read the filed documents" is the reader's own, taken by the route
 * before the engine sees it.
 */
function answered(make: () => DdProject, prompt: string, place: ChatPlace, where: string): void {
  if (READ_FILED_REQUEST.test(prompt)) return;
  assert.equal(wantsDeterministicProjectChat(make(), prompt, { place }), true, `${where}: “${prompt}” would be handed to a model`);
  const out = applyProjectChat(make(), prompt, { place });
  const tools = (out.assistantTurn.toolCalls ?? []).map((t) => t.name);
  assert.ok(out.assistantTurn.text.trim().length > 0, `${where}: “${prompt}” got no answer`);
  assert.ok(!tools.includes('clarify'), `${where}: “${prompt}” was asked back: ${out.assistantTurn.text}`);
  assert.ok(tools.length > 0, `${where}: “${prompt}” says nothing about how it was answered`);
}

describe('the table of questions', () => {
  it('has a row only for a page that exists', () => {
    for (const key of Object.keys(CHAT_PROMPTS)) {
      const known = functions.some((fn) => fn.key === key) || MENU_DEPARTMENTS.some((m) => m === key) || (PROJECT_COCKPIT_PANES as readonly string[]).includes(key);
      assert.ok(known, `“${key}” is no function, department or shared place`);
    }
  });

  it('offers three or four questions on each, none twice', () => {
    for (const [key, prompts] of Object.entries(CHAT_PROMPTS)) {
      assert.ok(prompts.length >= 3 && prompts.length <= 4, `${key} offers ${prompts.length}`);
      assert.equal(new Set(prompts).size, prompts.length, `${key} repeats itself`);
      for (const prompt of prompts) assert.ok(prompt.length <= 48, `${key}: “${prompt}” is too long for a chip`);
    }
  });

  it('gives every function its own questions or the ones that follow from the file', () => {
    const p = seedDemoProject();
    let own = 0;
    for (const fn of functions) {
      const place = placeOf(p, fn.key);
      const prompts = chatPrompts(p, place);
      assert.ok(prompts.length >= 3 && prompts.length <= 4, `${fn.label} offers ${prompts.length}`);
      if (chatPromptKey(place) === fn.key) own += 1;
      else assert.deepEqual(prompts, chatPrompts(p, { pane: 'overview' }), `${fn.label} has no row, so it offers what Overview offers`);
    }
    assert.ok(own >= 6, 'the built functions each have a row of their own');
    for (const menu of MENU_DEPARTMENTS) assert.equal(chatPromptKey(placeOf(p, menu)), menu, `${menu}’s Summary has a row`);
    assert.equal(chatPromptKey({ pane: 'graph' }), undefined, 'a place with no row reads none');
    assert.equal(chatPromptKey(undefined), undefined);
  });

  it('offers nothing the file cannot answer by itself', () => {
    for (const [name, make] of [['the project under construction', seedDemoProject], ['the acquisition at Land', seedBdaReferenceProject]] as const) {
      for (const [key, prompts] of Object.entries(CHAT_PROMPTS)) {
        const place = placeOf(make(), key);
        for (const prompt of prompts) answered(make, prompt, place, `${name}, on ${key}`);
      }
    }
  });
});

describe('the questions that follow from where the file stands', () => {
  const bare = () => createProject({ name: 'Bare', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-B1');
  const withUnread = () => {
    const p = seedDemoProject();
    const row = addEvidence(p, { title: 'Scanned deed', kind: 'document', status: 'received' });
    attachEvidenceFile(p, row.id, { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1024, storageKey: 's3://deed' });
    return p;
  };

  it('are three or four, and each one the file answers', () => {
    for (const [name, make] of [['a file with nothing on it', bare], ['the seeded project', seedDemoProject], ['the seeded acquisition', seedBdaReferenceProject], ['a file with a paper nobody read', withUnread]] as const) {
      for (const pane of ['overview', 'graph', 'people', 'assets', 'decisions'] as const) {
        const place: ChatPlace = { pane };
        const prompts = chatPrompts(make(), place);
        assert.ok(prompts.length >= 3 && prompts.length <= 4, `${name}, on ${pane}: ${prompts.length} questions`);
        for (const prompt of prompts) answered(make, prompt, place, `${name}, on ${pane}`);
      }
    }
  });

  it('offer to read a filed paper nobody has read, and only then', () => {
    assert.ok(chatPrompts(withUnread(), { pane: 'overview' }).includes('Read the filed documents'));
    assert.ok(!chatPrompts(seedDemoProject(), { pane: 'overview' }).includes('Read the filed documents'));
    assert.match('Read the filed documents', READ_FILED_REQUEST, 'the route takes it before the engine does');
  });

  it('start from the next step on a file with nothing on it', () => {
    const prompts = chatPrompts(bare(), { pane: 'overview' });
    assert.ok(prompts.includes('What can you do?') && prompts.includes('What documents do I need?'), prompts.join(' | '));
  });
});
