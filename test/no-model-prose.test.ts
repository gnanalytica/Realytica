/**
 * No model call may hand back a sentence that is stored or shown.
 *
 * This test fails when one could. It walks the shape of what every model
 * call in the product answers with, and requires each member that admits
 * free text to be on a list here, with what kind of thing it is: a key code
 * holds to a list, words copied off a page, a value read with its source,
 * the name of a thing, words searched with, or something nothing reads. A
 * new tool, a new free-text member, or a new place that reads a model's
 * words fails here until somebody classifies it. One member is prose, and it
 * is named with the reason it is still there.
 *
 * It also checks the features this was built for: that what each keeps of a
 * model's answer is picks, and that sentences sent beside them are thrown
 * away.
 *
 * Every project, paper and figure is invented.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import {
  LETTER_TEMPLATES,
  PHOTO_NOTE_MOST,
  addAction,
  addEvidence,
  createProject,
  letterBody,
  letterChoiceFrom,
  photoObservationOfPicks,
  photoSeenFrom,
  photoWrittenByModelBefore,
  recordPhotoObservation,
  setFieldValues,
  setPhotoNote,
  structuredProposal,
} from '@realytica/shared';
import { buildExtractionTool } from '../packages/agents/src/agents/document-intelligence';
import { fileSweepTool } from '../packages/agents/src/agents/file-sweep';
import { lawChangeTool } from '../packages/agents/src/agents/law-watch';
import { meetingItemsFromPicks, meetingNotesTool } from '../packages/agents/src/agents/meeting-notes';
import { outgoingDraftTool } from '../packages/agents/src/agents/outgoing-draft';
import { secondReadingTool } from '../packages/agents/src/agents/page-check';
import { buildObservationTool } from '../packages/agents/src/agents/photo-intelligence';
import { planProposalTool } from '../packages/agents/src/agents/plan-proposal';
import { ANSWER_SCHEMA, ANSWER_TOOL, HAND_OVER_REASONS } from '../packages/agents/src/agents/project-copilot';
import { paperCellValue, reviewAnswersTool } from '../packages/agents/src/agents/review-answers';
import { templateFieldsTool } from '../packages/agents/src/agents/template-fields';
import { voiceItemsFromPicks, voiceNoteTool } from '../packages/agents/src/agents/voice-note';
import { createProjectTools } from '../packages/agents/src/tools/project-tools';

/** What a member that admits free text may be. Nothing else passes. */
const KINDS = {
  key: 'an id, a mark or an address: kept only where it names something on a list or on the record',
  quote: 'words copied off a page or out of notes: kept only where the page or the notes write them',
  value: 'a value, a date, a unit or a reference read off a page: held to the page’s words, typed, and waiting on a person',
  name: 'the name of a thing or a person as the source names it: held to the source or capped, never a sentence',
  query: 'words a model searches or asks with: neither stored nor shown',
  unread: 'accepted by the tool and read by nothing',
  payload: 'a JSON object of ids, picks and values: every sentence in it is taken out by code before a card is made',
  prose: 'a sentence a model writes that is stored or shown',
} as const;
type Kind = keyof typeof KINDS;

/** Every member of a tool's answer that admits free text: a string that is not one of a list. */
function freeText(schema: unknown, at = '', out: string[] = []): string[] {
  const node = (schema && typeof schema === 'object' ? schema : {}) as { type?: unknown; enum?: unknown; properties?: Record<string, unknown>; items?: unknown };
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('string') && !node.enum) out.push(at);
  for (const [key, child] of Object.entries(node.properties ?? {})) freeText(child, `${at}.${key}`, out);
  if (node.items) freeText(node.items, `${at}[]`, out);
  return out;
}

const chat = Object.fromEntries(
  (createProjectTools(createProject({ name: 'Any plot', type: 'residential', location: 'Any road', city: 'Kadamba' }, 'RYT-NP0'), 'tester', { proposals: [], navigations: [], toolCalls: [], choices: [] }) as unknown as Array<{ name: string; input_schema: unknown }>).map((tool) => [tool.name, tool.input_schema]),
);
const address = (at: string): Record<string, Kind> => ({ [`${at}.set`]: 'key', [`${at}.field`]: 'key', [`${at}.record`]: 'key' });

/** What each model call answers with, and what each free-text member of it is. */
const ANSWERS: Array<{ tool: string; file: string; schema: unknown; free: Record<string, Kind> }> = [
  { tool: 'record_cross_checks', file: 'packages/agents/src/agents/file-sweep.ts', schema: fileSweepTool().parameters, free: { '.proposals[].cites[]': 'key' } },
  {
    tool: 'record_law_change',
    file: 'packages/agents/src/agents/law-watch.ts',
    schema: lawChangeTool().parameters,
    free: { '.reference': 'value', '.dated': 'value', '.effective_from': 'value', '.was.date': 'value', '.now.date': 'value', '.affects[]': 'key', '.quote': 'quote', '.projects[].projectId': 'key', '.projects[].actions[].about': 'key' },
  },
  { tool: ANSWER_TOOL, file: 'packages/agents/src/agents/project-copilot.ts', schema: ANSWER_SCHEMA, free: { ...address('.fields[]'), '.records[]': 'key', '.facts[]': 'key', '.passages[]': 'key', ...address('.look_at.fields[]'), '.look_at.papers[]': 'key', ...address('.mark.field'), '.mark.record': 'key' } },
  { tool: 'record_photo_observation', file: 'packages/agents/src/agents/photo-intelligence.ts', schema: buildObservationTool().parameters, free: {} },
  { tool: 'record_outgoing_draft', file: 'packages/agents/src/agents/outgoing-draft.ts', schema: outgoingDraftTool('reply').parameters, free: {} },
  { tool: 'record_meeting_items', file: 'packages/agents/src/agents/meeting-notes.ts', schema: meetingNotesTool().parameters, free: { '.items[].owner': 'name', '.items[].quote': 'quote' } },
  { tool: 'record_voice_note', file: 'packages/agents/src/agents/voice-note.ts', schema: voiceNoteTool().parameters, free: { '.day.date': 'value', '.day.quote': 'quote', '.items[].quote': 'quote' } },
  { tool: 'record_paper_answers', file: 'packages/agents/src/agents/review-answers.ts', schema: reviewAnswersTool().parameters, free: { '.answers[].value': 'value', '.answers[].words': 'quote' } },
  // The readers of papers: values with the page's words, which wait on a person.
  {
    tool: 'record_document_extraction',
    file: 'packages/agents/src/agents/document-intelligence.ts',
    schema: buildExtractionTool().parameters,
    free: { '.fields[].key': 'key', '.fields[].label': 'name', '.fields[].value': 'value', '.fields[].unit': 'value', '.fields[].quote': 'quote', '.fields[].originalValue': 'value', '.notes': 'prose' },
  },
  { tool: 'record_page_values', file: 'packages/agents/src/agents/page-check.ts', schema: secondReadingTool().parameters, free: { '.values[].value': 'value', '.values[].unit': 'value', '.values[].originalValue': 'value', '.values[].words': 'quote' } },
  { tool: 'name_form_blanks', file: 'packages/agents/src/agents/template-fields.ts', schema: templateFieldsTool().parameters, free: { '.blanks[].key': 'key' } },
  { tool: 'propose_plan', file: 'packages/agents/src/agents/plan-proposal.ts', schema: planProposalTool().parameters, free: { '.steps[].only': 'key', '.steps[].report': 'key', '.steps[].period': 'value', '.steps[].playbook': 'key' } },
  // The chat's tools that leave something behind. The rest only read.
  { tool: 'propose_update', file: 'packages/agents/src/tools/project-tools.ts', schema: chat.propose_update, free: { ...address('.about.fields[]'), '.about.records[]': 'key', '.payloadJson': 'payload' } },
  { tool: 'propose_field_values', file: 'packages/agents/src/tools/project-tools.ts', schema: chat.propose_field_values, free: { '.values[].address.fn': 'key', ...address('.values[].address') } },
  { tool: 'suggest_answers', file: 'packages/agents/src/tools/project-tools.ts', schema: chat.suggest_answers, free: { '.questionnaireId': 'key', '.answers[].questionId': 'key', ...address('.answers[].field'), '.answers[].evidenceId': 'key', '.answers[].quote': 'quote', '.answers[].value': 'value' } },
  { tool: 'ask_to_choose', file: 'packages/agents/src/tools/project-tools.ts', schema: chat.ask_to_choose, free: { '.phrase': 'query', '.question': 'unread' } },
  { tool: 'navigate_pane', file: 'packages/agents/src/tools/project-tools.ts', schema: chat.navigate_pane, free: { '.function': 'key', '.section': 'key', '.ddId': 'key', '.scopeId': 'key', '.checkId': 'key', '.evidenceId': 'key', '.findingId': 'key' } },
  { tool: 'run_capability', file: 'packages/agents/src/tools/project-tools.ts', schema: chat.run_capability, free: {} },
];

/**
 * The prose that is left, each with why. Short, and it may not grow: adding
 * to it is a decision for the owner, not a line to slip in.
 */
const PROSE_LEFT: Record<string, string> = {
  'record_document_extraction.notes':
    'The reader of a paper may leave a note about the reading (pages it could not read, a paper that is two papers). It is kept on the paper’s own row as the reading’s note, beside the values, and is no part of this change: the paper reading is another piece of work.',
};

/** The files that hold a tool a model answers with, each with the tools above that cover it, or why none has to. */
const TOOL_FILES: Record<string, string> = {
  'packages/agents/src/agents/file-sweep.ts': 'record_cross_checks',
  'packages/agents/src/agents/law-watch.ts': 'record_law_change',
  'packages/agents/src/agents/project-copilot.ts': `${ANSWER_TOOL}, and hand_over, whose one member is a reason off a list`,
  'packages/agents/src/agents/photo-intelligence.ts': 'record_photo_observation',
  'packages/agents/src/agents/outgoing-draft.ts': 'record_outgoing_draft',
  'packages/agents/src/agents/meeting-notes.ts': 'record_meeting_items',
  'packages/agents/src/agents/voice-note.ts': 'record_voice_note',
  'packages/agents/src/agents/review-answers.ts': 'record_paper_answers',
  'packages/agents/src/agents/document-intelligence.ts': 'record_document_extraction',
  'packages/agents/src/agents/page-check.ts': 'record_page_values',
  'packages/agents/src/agents/template-fields.ts': 'name_form_blanks',
  'packages/agents/src/agents/plan-proposal.ts': 'propose_plan',
  'packages/agents/src/tools/project-tools.ts': 'the chat’s tools: those that leave something behind are above, the rest only read',
  'apps/api/src/flows/handlers.ts': 'record_verdict',
  'packages/agents/src/tools/case-tools.ts': 'read-only tools of the earlier case screen: no model call in this build is handed them',
  'packages/agents/src/tools/command-tools.ts': 'commands by id of the earlier case screen: no model call in this build is handed them',
  'packages/agents/src/eval/executor.ts': 'the measuring harness, run by hand with a key: nothing it reads is stored on a project',
  'packages/agents/src/providers/anthropic.ts': 'the provider: it carries tools and makes none',
  'packages/agents/src/providers/types.ts': 'the provider’s types',
};

/** The only places that read a model's words rather than a tool's members, each with why. */
const WORDS_READ: Record<string, string> = {
  'packages/agents/src/agents/property-discovery.ts': 'public web search for a property’s surroundings: the words are parsed as JSON of sources, each with its link, and shown as what a public source says',
  'apps/api/src/project-chat-sides.ts': 'public web search for a locality: the words are parsed as JSON of hits, each a title, a link and the site’s own words, shown as a web signal with its link',
};

const ROOT = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(path.join(ROOT, at)).isDirectory()) return name === 'node_modules' ? [] : sources(at);
    return /\.ts$/.test(name) ? [at] : [];
  });
}
const CODE = [...sources('packages/agents/src'), ...sources('apps/api/src')];
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf-8');

/** The flow engine's handlers, loaded once the API has somewhere of its own to keep files. */
let flows: typeof import('../apps/api/src/flows/handlers');

before(async () => {
  process.env.REALYTICA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'realytica-no-prose-'));
  process.env.REALYTICA_AUTH_MODE = 'off';
  flows = await import('../apps/api/src/flows/handlers');
});

describe('what a model call may answer with', () => {
  it('record_verdict: every member that admits free text is classified', () => {
    assert.deepEqual(freeText(flows.flowVerdictTool().parameters), ['.keys[]'], 'a flow’s agent node answers with a verdict off a list and keys, each held to the payload it was given');
  });

  for (const answer of ANSWERS) {
    it(`${answer.tool}: every member that admits free text is classified`, () => {
      assert.ok(answer.schema, `${answer.tool} has a shape`);
      const found = freeText(answer.schema).sort();
      assert.deepEqual(found, Object.keys(answer.free).sort(), `${answer.tool} (${answer.file}): a free-text member is not on the list, or one on the list is gone. Classify it in test/no-model-prose.test.ts: a model may not hand back a sentence that is stored or shown.`);
      for (const [member, kind] of Object.entries(answer.free)) assert.ok(kind in KINDS, `${answer.tool}${member}`);
    });
  }

  it('leaves one member of prose, named with its reason, and no other', () => {
    const prose = ANSWERS.flatMap((answer) => Object.entries(answer.free).filter(([, kind]) => kind === 'prose').map(([member]) => `${answer.tool}${member}`));
    assert.deepEqual(prose, Object.keys(PROSE_LEFT));
    assert.ok(Object.keys(PROSE_LEFT).length <= 1, 'the list of prose that is left does not grow');
    for (const why of Object.values(PROSE_LEFT)) assert.ok(why.length > 40);
  });

  it('has every file that holds a tool on its list', () => {
    const holding = CODE.filter((file) => /kind: 'schema'|betaTool\(/.test(read(file))).sort();
    assert.deepEqual(holding, Object.keys(TOOL_FILES).sort(), 'a file holds a tool a model answers with and is not classified here, or one that is listed no longer does');
    // The earlier case screen's tools are handed to no model call.
    for (const made of ['createCaseTools', 'createCommandTools']) assert.deepEqual(CODE.filter((file) => read(file).includes(`${made}(`) && !/tools\/(case|command)-tools\.ts$/.test(file)), [], made);
  });

  it('reads a model’s own words in two places only, both a search of the public web', () => {
    const reading = CODE.filter((file) => !file.includes('/providers/') && /\btextOf\(/.test(read(file))).sort();
    assert.deepEqual(reading, Object.keys(WORDS_READ).sort(), 'a file reads the words a model wrote, and is not on the list of places that may');
  });

  it('gives a first model that hands a question on a reason off a list, never its own', () => {
    assert.ok(HAND_OVER_REASONS.length > 0 && HAND_OVER_REASONS.every((reason) => /^[a-z_]+$/.test(reason)));
    assert.match(read('packages/agents/src/agents/project-copilot.ts'), /properties: \{ reason: \{ type: 'string', enum: \[\.\.\.HAND_OVER_REASONS\] \} \}/);
  });
});

describe('a photograph', () => {
  it('is read as picks off three lists, worded and graded by code, and nothing else a model sends is kept', () => {
    const picks = photoSeenFrom([
      { element: 'column', condition: 'exposed_reinforcement', location: 'ground_floor', confidence: 0.8, note: 'The steel is badly rusted and the column should be jacketed.' },
      { element: 'slab', condition: 'work_in_progress', location: 'upper_floor', confidence: 2 },
      { element: 'a gargoyle', condition: 'crack', location: 'roof_terrace', confidence: 0.5 },
      { element: 'wall', condition: 'haunted', location: 'basement', confidence: 0.5 },
    ]);
    assert.deepEqual(picks, [{ element: 'column', condition: 'exposed_reinforcement', location: 'ground_floor', confidence: 0.8 }, { element: 'slab', condition: 'work_in_progress', location: 'upper_floor', confidence: 1 }]);
    const observation = photoObservationOfPicks('property', picks, 'vision/model', '2026-10-12T08:00:00.000Z');
    assert.equal(observation.description, 'Column: exposed reinforcement (ground floor); Slab: work in progress (upper floor)');
    assert.deepEqual(observation.notes, []);
    assert.deepEqual(observation.suggestedFindings.map((finding) => [finding.title, finding.suggestedSeverity, finding.whyItMayMatter]), [['Column: exposed reinforcement (ground floor)', 'high', 'Reinforcement left exposed corrodes and has lost its cover.']]);
    assert.ok(!JSON.stringify(observation).includes('jacketed'));

    // The draft a person reviews is the pick's own words, the table's reason and severity, and what it is as fields.
    const project = createProject({ name: 'Mill Lane flats', type: 'residential', location: 'Mill Lane', city: 'Kadamba' }, 'RYT-NP1', 'lead@builders.example');
    const paper = addEvidence(project, { title: 'Site photographs', kind: 'document', status: 'received' }, 'lead@builders.example');
    paper.attachments.push({ id: 'att_1', fileName: 'column-c4.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'k', uploadedAt: '2026-10-12T08:00:00.000Z' } as (typeof paper.attachments)[number]);
    const { drafts } = recordPhotoObservation(project, paper.id, 'att_1', observation, 'lead@builders.example');
    assert.equal(drafts[0]!.body, 'Seen in column-c4.jpg: Column: exposed reinforcement (ground floor)\nReinforcement left exposed corrodes and has lost its cover.\nPicked from the lists by vision/model, at confidence 80%. Next: inspect on site.');
    assert.deepEqual(drafts[0]!.proposedPayload!.structured, { kind: 'finding', entries: [paper.id], element: 'column', condition: 'exposed_reinforcement', location: 'ground_floor', severity: 'high', next: 'inspect_on_site' });
  });

  it('takes free words only from a person, capped, and one read before this is marked as a model’s', () => {
    const observation = photoObservationOfPicks('property', [], 'vision/model', '2026-10-12T08:00:00.000Z');
    setPhotoNote(observation, '  Taken from the east gate,   after the rain. ', 'site@builders.example', '2026-10-12T09:00:00.000Z');
    assert.deepEqual(observation.personNote, { text: 'Taken from the east gate, after the rain.', by: 'site@builders.example', at: '2026-10-12T09:00:00.000Z' });
    assert.throws(() => setPhotoNote(observation, 'x'.repeat(PHOTO_NOTE_MOST + 1), 'site@builders.example', '2026-10-12T09:00:00.000Z'), /at most 240 characters/);
    setPhotoNote(observation, ' ', 'site@builders.example', '2026-10-12T09:05:00.000Z');
    assert.equal(observation.personNote, undefined);
    assert.equal(photoWrittenByModelBefore(observation), false);
    assert.equal(photoWrittenByModelBefore({ subject: 'property', description: 'A column with rusted steel showing at its base.', elements: [], notes: [], suggestedFindings: [], model: 'vision/model', at: '2026-09-01T08:00:00.000Z' }), true);
  });
});

describe('a letter', () => {
  const sources = [{ n: 1, says: 'Extension claimed: 47 days' }, { n: 2, says: 'Completion certificate: not on file' }, { n: 3, says: '“Completion will move to 30 April 2027.”' }];

  it('is one of the firm’s templates with the record’s own lines in its slots, chosen by id and number', () => {
    const choice = letterChoiceFrom({ template: 'reply_from_record', refers_to: 3, facts: [1, 9, 1, 3], body: 'We regret the delay and will make it good.' }, 'reply', sources)!;
    assert.deepEqual(choice, { template: 'reply_from_record', refersTo: 3, states: [1] });
    assert.deepEqual(letterBody(choice, sources), [
      { sentences: [{ text: 'We refer to the following.', sources: [] }, { text: '“Completion will move to 30 April 2027.”', sources: [3] }] },
      { sentences: [{ text: 'On this, our record shows the following.', sources: [] }, { text: 'Extension claimed: 47 days.', sources: [1] }] },
      { sentences: [{ text: 'Please let us know if anything further is needed.', sources: [] }] },
    ]);
    // A template of another kind of letter, and one that does not exist, are no choice. A template alone says nothing.
    assert.equal(letterChoiceFrom({ template: 'letter_on_record', facts: [1] }, 'reply', sources), undefined);
    assert.equal(letterChoiceFrom({ template: 'a letter of my own', facts: [1] }, 'reply', sources), undefined);
    assert.deepEqual(letterBody({ template: 'reply_from_record', states: [] }, sources), []);
  });

  it('has no fact about any project in a template', () => {
    for (const template of LETTER_TEMPLATES) for (const said of [template.refers ?? '', template.lead, template.close]) assert.ok(!/\d/.test(said), `${template.id}: ${said}`);
  });
});

describe('a card a model proposes', () => {
  function held() {
    const project = createProject({ name: 'Tank Road plots', type: 'residential', location: 'Tank Road', city: 'Kadamba' }, 'RYT-NP2', 'lead@builders.example');
    setFieldValues(project, { set: 'legal.title.holding' }, { tenure: 'inam' }, 'lead@builders.example');
    const action = addAction(project, { title: 'Get the encumbrance certificate', kind: 'clarification', owner: 'Anika Rao', priority: 'high' }, 'lead@builders.example');
    return { project, actionId: action.id };
  }

  it('is worded from the record: its title, its reason, its severity and its next step, and no sentence the model sent', () => {
    const { project } = held();
    const made = structuredProposal(project, { kind: 'add_finding', concern: 'not_as_the_rule_requires', about: { fields: [{ set: 'legal.title.holding', field: 'tenure' }] } }, { title: 'The land is inam and cannot be sold.', description: 'Inam land is restricted. The sale would be void.', severity: 'critical', discipline: 'legal' });
    assert.ok(!('error' in made));
    if ('error' in made) return;
    assert.equal(made.title, 'Not as the rule requires: Tenure (Land holding)');
    assert.equal(made.rationale, 'Rests on: Tenure (Land holding): Inam (Entered by a person).');
    assert.deepEqual([made.payload.title, made.payload.description, made.payload.severity, made.payload.discipline], [made.title, made.rationale, 'high', 'legal']);
    assert.deepEqual(made.payload.structured, { kind: 'finding', concern: 'not_as_the_rule_requires', entries: ['legal.title.holding::tenure'], severity: 'high', next: 'Check the value against the rule.' });
    assert.ok(!JSON.stringify(made).includes('cannot be sold') && !JSON.stringify(made).includes('would be void'));
  });

  it('is refused where it is about nothing on the record, or picks nothing off the list', () => {
    const { project, actionId } = held();
    assert.match((structuredProposal(project, { kind: 'add_finding', concern: 'value_missing', about: { records: ['not_a_record'] } }, {}) as { error: string }).error, /about nothing on the record/);
    assert.match((structuredProposal(project, { kind: 'add_risk', concern: 'a bad feeling', about: { records: [actionId] } }, {}) as { error: string }).error, /concern off the list/);
    assert.match((structuredProposal(project, { kind: 'edit_report', about: {} }, { reportId: 'rpt_1', text: 'The title is clean.' }) as { error: string }).error, /A report’s words are a person’s/);
    const action = structuredProposal(project, { kind: 'add_action', next: 'follow_up', about: { records: [actionId] } }, { title: 'Chase them hard.', owner: 'Anika Rao', comments: 'They have been slow. Push.' });
    assert.ok(!('error' in action) && action.title === 'Follow up: Get the encumbrance certificate' && action.payload.owner === 'Anika Rao' && !('comments' in action.payload));
    const check = structuredProposal(project, { kind: 'record_check', about: { fields: [{ set: 'legal.title.holding', field: 'tenure' }] } }, { checkId: 'chk_1', result: 'non_compliant', comments: 'Clearly a problem. I am sure.' });
    assert.ok(!('error' in check) && check.payload.comments === 'Rests on: Tenure (Land holding): Inam (Entered by a person).');
  });
});

describe('the smaller readers', () => {
  it('a review table’s cell holds a value its quoted words write, else the quoted words', () => {
    assert.equal(paperCellValue('Rs. 3,18,50,000', 'a total sale consideration of Rs. 3,18,50,000'), 'Rs. 3,18,50,000');
    assert.equal(paperCellValue('The price was three crore and eighteen lakh.', 'a total sale consideration of Rs. 3,18,50,000'), 'a total sale consideration of Rs. 3,18,50,000');
    assert.equal(paperCellValue(null, 'witnessed by two persons'), 'witnessed by two persons');
  });

  it('a meeting’s item is its quote, with an owner only where the notes name them', () => {
    const notes = 'Vikram to get the encumbrance certificate by Friday. The wall was discussed.';
    assert.deepEqual(meetingItemsFromPicks([{ kind: 'action', text: 'Vikram will chase the EC urgently.', owner: 'Vikram', quote: 'Vikram to get the encumbrance certificate by Friday.' }, { kind: 'open', owner: 'Asha', quote: 'The wall was discussed.' }, { kind: 'decision', text: 'Build it.' }], notes), [
      { kind: 'action', text: 'Vikram to get the encumbrance certificate by Friday.', owner: 'Vikram', quote: 'Vikram to get the encumbrance certificate by Friday.' },
      { kind: 'open', text: 'The wall was discussed.', owner: null, quote: 'The wall was discussed.' },
    ]);
  });

  it('a voice note’s item is its quote in the note’s own script, with a trade off the list', () => {
    assert.deepEqual(voiceItemsFromPicks([{ kind: 'manpower', text: 'Twelve masons were on site.', quote: 'ಹನ್ನೆರಡು ಮೇಸ್ತ್ರಿಗಳು ಬಂದಿದ್ದರು', trade: 'masons', count: 12 }, { kind: 'work', quote: 'slab shuttering done', trade: 'wizards', count: 3 }]), [
      { kind: 'manpower', text: 'ಹನ್ನೆರಡು ಮೇಸ್ತ್ರಿಗಳು ಬಂದಿದ್ದರು', quote: 'ಹನ್ನೆರಡು ಮೇಸ್ತ್ರಿಗಳು ಬಂದಿದ್ದರು', trade: 'masons', count: 12 },
      { kind: 'work', text: 'slab shuttering done', quote: 'slab shuttering done', trade: null, count: null },
    ]);
  });

  it('a flow’s agent node answers with a verdict off a list and keys the payload has', () => {
    assert.deepEqual(flows.flowVerdictHeld({ verdict: 'yes', keys: ['amount', 'nothing', 'amount'], text: 'The amount is over the limit, so yes.' }, { amount: 12, vendor: 'x' }), { verdict: 'yes', keys: ['amount'] });
    assert.deepEqual(flows.flowVerdictHeld({ verdict: 'probably' }, {}), { verdict: 'cannot_tell', keys: [] });
  });
});
