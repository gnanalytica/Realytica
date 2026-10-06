/**
 * The facts of the project's memory.
 *
 * An entry says that something happened. A fact says what the record holds
 * now, value by value, each tagged with where it stands: approved by a
 * person, or proposed and waiting. `memoryFacts` gives them from the record
 * alone, and memory is brought to them by difference.
 *
 * What is pinned here. First, the one that catches silent corruption: a
 * record told step by step, after every change, and the same record told
 * once from nothing leave memory holding the same facts and the same
 * entries, and those are the facts the record gives. Then the tags: who a
 * value is approved by, who read a value that waits and whether the record's
 * own rule lets it stand, two readings that differ, a value on a check, a
 * field of the project, a value waiting on a card. Then what a fact may
 * hold: a key on a fixed list with that list's label, a value in the key's
 * form, a name, and never an identity number, a phone number, a bank
 * account, an address for mail or a paragraph, however it reaches the store.
 *
 * Run against the file the memory is kept in on a machine with no graph
 * database, in a temporary directory.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  STANDARD_FACT_KEYS,
  addAction,
  addComparable,
  addDecision,
  addEvidence,
  addFinding,
  allChecks,
  applyProjectChat,
  changeStage,
  checkSchema,
  clearProjectConversation,
  createAssessment,
  createProject,
  decideComparables,
  memFactRev,
  memFactsDiff,
  memFactsRev,
  memWho,
  memoryFacts,
  noteProjectEdit,
  patchProject,
  recordAuditEvent,
  recordCheckFields,
  reviewFacts,
  scrubMemFact,
  standingFacts,
  type ChatProposal,
  type DdProject,
  type DocumentFact,
  type MemEntry,
  type MemFact,
  type MemWatermark,
} from '@realytica/shared';
import type { MemoryPort } from '../apps/api/src/graph/mem/types';

let root: string;
let memory: MemoryPort;
let syncMemory: typeof import('../apps/api/src/graph/mem/sync').syncMemory;
let writeMemory: typeof import('../apps/api/src/graph/mem/write').writeMemory;

const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';
const TENANT = 'tnt_fact_tests';

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-mem-facts-'));
  process.env.REALYTICA_DATA_DIR = root;
  delete process.env.VERCEL_ENV;
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  ({ syncMemory } = await import('../apps/api/src/graph/mem/sync'));
  ({ writeMemory } = await import('../apps/api/src/graph/mem/write'));
});

after(async () => {
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

function fresh(name: string): DdProject {
  const project = createProject({ name, type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-F1');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  return project;
}

const value = (key: string, held: DocumentFact['value'], display = String(held), more: Partial<DocumentFact> = {}): DocumentFact => ({
  key,
  label: `${key} as the paper words it`,
  value: held,
  display,
  page: 1,
  quote: `${key}: ${display}`,
  review: 'proposed',
  ...more,
});

/** The two kinds of paper used here, as the register names them, and the keys each carries. */
const KHATA = 'Khata certificate and extract';
const DEED = 'Sale deed';
const CARRIED: Record<string, string[]> = {
  [KHATA]: ['extent_khata', 'khata_number', 'owner', 'survey_numbers'],
  [DEED]: ['registration_date', 'consideration', 'survey_numbers'],
};

/** A paper of a kind on the register with these values read off it, each waiting unless it says otherwise. */
function paper(project: DdProject, documentType: string, facts: DocumentFact[], title = documentType) {
  const row = addEvidence(project, { title, kind: 'document' }, LEAD);
  row.documentType = documentType;
  row.facts = facts;
  return row;
}

/** One pass that tells memory this copy, as an instance that holds what it last learned in `known`. */
async function tell(project: DdProject, known: Map<string, MemWatermark>): Promise<void> {
  const passed = await syncMemory({ owed: [{ project, tenantId: TENANT }], gone: [], known, stillStored: async () => true }, memory, false);
  assert.deepEqual([passed.settled.length, passed.failed], [1, 0], 'the copy was told');
}

const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));

async function held(project: DdProject): Promise<{ facts: MemFact[]; entries: MemEntry[] }> {
  return { facts: byId(await memory.factsOf(project.id)), entries: byId(await memory.entries(project.id, 100_000)) };
}

const factOf = (facts: MemFact[], slot: string): MemFact | undefined => facts.find((fact) => fact.id.endsWith(`::fact::${slot}`));

describe('a record told step by step, and the same record told once', () => {
  /** A small generator of numbers that gives the same run for the same seed. */
  function dice(seed: number): (below: number) => number {
    let state = seed >>> 0;
    return (below) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % below;
    };
  }

  const HELD: Record<string, DocumentFact['value'][]> = {
    extent_khata: [1100.9, 1096.2],
    khata_number: ['1234/56', '1234/57'],
    owner: ['A Person', 'Another Person'],
    survey_numbers: ['73/4', '73/1'],
    registration_date: ['2019-03-12', '2021-07-09'],
    consideration: [12_500_000, 31_850],
  };

  /** Everything a person or a reader can do to a record that memory is told of, each done through the operation that really does it. */
  function act(project: DdProject, roll: (below: number) => number, step: number): void {
    const rows = project.evidence.filter((row) => (row.facts ?? []).length > 0);
    const row = rows.length ? rows[roll(rows.length)]! : undefined;
    const carried = CARRIED[row?.documentType ?? KHATA]!;
    const key = carried[roll(carried.length)]!;
    const actor = roll(2) ? LEAD : VALUER;
    switch (roll(16)) {
      case 0:
      case 1: {
        // A paper is filed with what was read off it, some of it by a model, some of it read two ways.
        const kind = roll(2) ? KHATA : DEED;
        const facts = CARRIED[kind]!.filter(() => roll(3) !== 0).map((k) => value(k, HELD[k]![roll(2)]!, undefined, roll(3) === 0 ? { source: 'model', proof: 'page_text', pageCheck: 'text' } : {}));
        if (facts.length && roll(3) === 0) facts[0]!.otherReading = { ...value(facts[0]!.key, HELD[facts[0]!.key]![1]!), source: 'model', proof: 'second_reader', pageCheck: 'page' };
        paper(project, kind, facts, `Paper ${step}`);
        break;
      }
      case 2:
      case 3:
        if (row) reviewFacts(project, row.id, [key], 'accept', actor);
        break;
      case 4:
        if (row) reviewFacts(project, row.id, [key], 'reject', actor);
        break;
      case 5:
        if (row) reviewFacts(project, row.id, [key], 'reopen', actor);
        break;
      case 6:
        if (row) reviewFacts(project, row.id, [key], 'accept', actor, { value: HELD[key]![1]!, display: String(HELD[key]![1]) });
        break;
      case 7:
        // The paper is read again: what waits is replaced, with no line on the trail.
        if (row) row.facts = (row.facts ?? []).map((fact) => (fact.review === 'proposed' ? { ...fact, value: HELD[fact.key]?.[roll(2)] ?? fact.value } : fact));
        break;
      case 8:
        patchProject(project, roll(2) ? { landAreaSqm: 1000 + roll(500) } : { siteAddress: `Plot ${roll(90)}, Northfield Road`, parcelId: `73/${roll(9)}` }, actor);
        break;
      case 9:
        changeStage(project, { subject: 'project', stage: roll(2) ? 'acquisition' : 'design', reason: 'moved on' }, actor);
        break;
      case 10: {
        const check = allChecks(project).find((held_) => checkSchema(held_).fields.some((field) => field.kind === 'number' && field.proof !== 'required'));
        const field = check && checkSchema(check).fields.find((f) => f.kind === 'number' && f.proof !== 'required');
        if (check && field) recordCheckFields(project, check.id, { [field.key]: Math.max(field.min ?? 0, 1) + roll(3) }, actor);
        break;
      }
      case 11:
        if (roll(2)) addDecision(project, { title: `Decision ${step}`, decisionType: 'hold_payment', decisionMaker: 'Lead', rationale: 'Waiting.' }, actor);
        else addAction(project, { title: `Action ${step}`, kind: 'evidence_request', owner: 'operator', priority: 'high' }, actor);
        break;
      case 12: {
        const comparable = addComparable(project, { title: `Plot ${step}`, price: 9_000_000 + roll(9) * 100_000, areaSqm: 200 + roll(50) }, actor);
        if (roll(2)) decideComparables(project, [comparable.id], 'reject', actor);
        break;
      }
      case 13: {
        const asked = applyProjectChat(project, 'what is missing?', { actor });
        for (const turn of [asked.userTurn, asked.assistantTurn]) turn.actor = actor;
        break;
      }
      case 14:
        if (roll(3) === 0) clearProjectConversation(project);
        else noteProjectEdit(project, `Noted ${step}.`, { actor });
        break;
      default:
        addFinding(project, { title: `Finding ${step}`, description: 'Made up.', severity: 'low', discipline: 'legal' }, actor);
    }
  }

  it('leave memory holding the same facts and the same entries, which are the facts the record gives', async () => {
    let facts = 0;
    let tags = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const roll = dice(seed);
      const project = fresh(`Sequence ${seed}`);
      const known = new Map<string, MemWatermark>();
      await tell(project, known);
      const steps = 8 + roll(16);
      for (let step = 1; step <= steps; step += 1) {
        try {
          act(project, roll, step);
        } catch {
          // An operation the record refuses changes nothing, and is one more step.
        }
        project.updatedAt = new Date(Date.parse('2026-10-06T08:00:00.000Z') + seed * 100_000 + step * 1000).toISOString();
        // Told after some steps and not others, as saves and passes fall.
        if (roll(4) !== 0) await tell(project, known);
      }
      await tell(project, known);
      const increments = await held(project);

      await memory.purge(project.id);
      await tell(project, new Map());
      const rebuilt = await held(project);

      assert.deepEqual(increments.facts, rebuilt.facts, `sequence ${seed}: the facts`);
      assert.deepEqual(increments.entries, rebuilt.entries, `sequence ${seed}: the entries`);
      assert.deepEqual(increments.facts, memoryFacts(project).held, `sequence ${seed}: and they are what the record gives`);
      const stands = (await memory.watermarks([project.id])).get(project.id)!;
      assert.equal(stands.factsRev, memFactsRev(new Map(rebuilt.facts.map((fact) => [fact.id, memFactRev(fact)]))), 'and memory says which facts it holds');
      facts += rebuilt.facts.length;
      tags = new Set([...tags, ...rebuilt.facts.map((fact) => `${fact.tag}${fact.tag === 'proposed' ? (fact.stands ? ' standing' : ' waiting') : ''}`)]);
      await memory.purge(project.id);
    }
    assert.ok(facts > 250, `the sequences made facts enough to matter (${facts})`);
    assert.deepEqual([...tags].sort(), ['approved', 'proposed standing', 'proposed waiting'], 'of every kind');
  });

  it('is told a long record’s facts a write at a time, and ends holding them all', async () => {
    const project = fresh('Many values');
    for (let i = 0; i < 180; i += 1) paper(project, i % 2 ? KHATA : DEED, CARRIED[i % 2 ? KHATA : DEED]!.map((key) => value(key, HELD[key]![i % 2]!)), `Paper ${i}`);
    project.updatedAt = '2026-10-06T09:00:00.000Z';
    const given = memoryFacts(project).held;
    assert.ok(given.length > 500, 'more facts than one write takes');
    await tell(project, new Map());
    assert.deepEqual(byId(await memory.factsOf(project.id)), given);
    await memory.purge(project.id);
  });
});

describe('where a fact stands', () => {
  it('is approved when a person accepted the value, with who and when, and proposed while it waits, with who read it', async () => {
    const project = fresh('Tagged plot');
    const row = paper(project, KHATA, [
      value('extent_khata', 1100.9, '11,850 sq ft', { unit: 'sqm', page: 2 }),
      value('owner', 'A Person', 'A Person'),
      value('khata_number', '1234/56', '1234/56', { source: 'model', proof: 'second_reader', pageCheck: 'page' }),
    ]);
    reviewFacts(project, row.id, ['extent_khata'], 'accept', VALUER);
    const facts = memoryFacts(project).held;

    const accepted = factOf(facts, `${row.id}::extent_khata::a`)!;
    assert.deepEqual(
      { tag: accepted.tag, label: accepted.label, value: accepted.value, unit: accepted.unit, display: accepted.display, by: accepted.by, aboutId: accepted.aboutId, source: accepted.source, page: accepted.page, stands: accepted.stands },
      { tag: 'approved', label: STANDARD_FACT_KEYS.extent_khata!.label, value: 1100.9, unit: 'sqm', display: '11,850 sq ft', by: memWho(project.id, VALUER), aboutId: row.id, source: row.id, page: 2, stands: undefined },
      'approved means a person, named as memory names a person, and the label is the fixed list’s',
    );
    assert.ok(accepted.at && accepted.recordedAt === accepted.at, 'with when they did');
    assert.deepEqual(accepted.was?.map((past) => [past.what, past.by, past.said]), [['accepted', memWho(project.id, VALUER), '11,850 sq ft']], 'and what the trail says happened to it');

    const standing = new Set(standingFacts(row).map((fact) => fact.key));
    const rules = factOf(facts, `${row.id}::owner::r`)!;
    assert.deepEqual([rules.tag, rules.readBy, rules.by, rules.value], ['proposed', 'rules', undefined, 'A Person'], 'a name is kept, and nobody has approved it');
    assert.equal(rules.stands, standing.has('owner'), 'whether it may be acted on is the record’s own rule’s to say');
    const model = factOf(facts, `${row.id}::khata_number::r`)!;
    assert.deepEqual([model.tag, model.readBy, model.proof], ['proposed', 'model', 'second_reader'], 'a model’s reading says so, with what stands behind it');
    assert.equal(model.stands, standing.has('khata_number'));
  });

  it('is two readings that name each other, where two readers differ, and neither is approved', () => {
    const project = fresh('Contested plot');
    const row = paper(project, DEED, [value('survey_numbers', '73/4', '73/4', { otherReading: { ...value('survey_numbers', '73/1', '73/1', { page: 2 }), source: 'model', proof: 'second_reader', pageCheck: 'page' } })]);
    const facts = memoryFacts(project).held;
    const mine = factOf(facts, `${row.id}::survey_numbers::r`)!;
    const theirs = factOf(facts, `${row.id}::survey_numbers::o`)!;
    assert.deepEqual([mine.tag, mine.value, mine.readBy, mine.contests], ['proposed', '73/4', 'rules', theirs.id]);
    assert.deepEqual([theirs.tag, theirs.value, theirs.readBy, theirs.proof, theirs.stands, theirs.contests], ['proposed', '73/1', 'model', 'second_reader', false, mine.id]);
    assert.equal(mine.stands, standingFacts(row).length > 0, 'and the record’s rule says whether either stands');
  });

  it('is gone with a value set aside, and back, waiting, with one reopened', () => {
    const project = fresh('Set aside plot');
    const row = paper(project, KHATA, [value('extent_khata', 1100.9)]);
    reviewFacts(project, row.id, ['extent_khata'], 'reject', VALUER);
    assert.deepEqual(memoryFacts(project).held.filter((fact) => fact.aboutId === row.id), [], 'a slot the record no longer fills is a fact memory lets go');
    reviewFacts(project, row.id, ['extent_khata'], 'reopen', LEAD);
    const back = factOf(memoryFacts(project).held, `${row.id}::extent_khata::r`)!;
    assert.equal(back.tag, 'proposed');
    assert.deepEqual(back.was?.map((past) => past.what), ['reopened', 'set_aside'], 'with what happened to it, newest first');
  });

  it('is approved for a value recorded on a check, a field of the project and a decision, each by who recorded it', () => {
    const project = fresh('Recorded plot');
    const check = allChecks(project).find((held_) => checkSchema(held_).fields.some((field) => field.kind === 'number' && field.proof !== 'required'))!;
    const field = checkSchema(check).fields.find((f) => f.kind === 'number' && f.proof !== 'required')!;
    const figure = Math.max(field.min ?? 0, 1) + 1;
    recordCheckFields(project, check.id, { [field.key]: figure }, VALUER);
    patchProject(project, { landAreaSqm: 1210 }, LEAD);
    const decision = addDecision(project, { title: 'Hold the advance', decisionType: 'hold_payment', decisionMaker: 'Lead', rationale: 'Waiting on a paper.' }, LEAD);
    const facts = memoryFacts(project).held;

    const recorded = factOf(facts, `${check.id}::${field.key}`)!;
    assert.deepEqual([recorded.tag, recorded.label, recorded.value, recorded.by, recorded.aboutId], ['approved', field.label, figure, memWho(project.id, VALUER), check.id], 'the catalogue’s own label for the field');
    const area = factOf(facts, `${project.id}::land_area`)!;
    assert.deepEqual([area.tag, area.label, area.value, area.aboutId, area.by], ['approved', 'Land area', 1210, project.id, memWho(project.id, LEAD)], 'by who the trail says set that field');
    const name = factOf(facts, `${project.id}::project_title`)!;
    assert.equal(name.by, undefined, 'and nobody is named for a field no change on the trail says it set');
    const held_ = factOf(facts, `${decision.id}::decision`)!;
    assert.deepEqual([held_.tag, held_.value, held_.by], ['approved', 'hold_payment', memWho(project.id, LEAD)]);
    const stage = factOf(facts, `${project.id}::stage`)!;
    assert.deepEqual([stage.tag, stage.value], ['approved', project.currentStage]);
  });

  it('is what a paper is: approved where a person said so, the rules’ reading where nobody has, and a model’s offer waiting', () => {
    const project = fresh('Kinds of paper');
    const read = paper(project, DEED, [value('survey_numbers', '73/4')]);
    read.readMethod = 'text';
    const offered = addEvidence(project, { title: 'Scan', kind: 'document' }, LEAD);
    offered.proposedDocumentType = KHATA;
    const byHand = addEvidence(project, { title: 'Typed by hand', kind: 'document' }, LEAD);
    byHand.documentType = DEED;
    let facts = memoryFacts(project).held;
    const rules = factOf(facts, `${read.id}::paper_kind`)!;
    assert.deepEqual([rules.tag, rules.readBy, rules.stands, rules.value, rules.label], ['proposed', 'rules', true, DEED, 'Kind of paper']);
    const offer = factOf(facts, `${offered.id}::paper_kind::offer`)!;
    assert.deepEqual([offer.tag, offer.readBy, offer.stands, offer.value], ['proposed', 'model', false, KHATA]);
    assert.equal(factOf(facts, `${byHand.id}::paper_kind`), undefined, 'a kind nobody is on record as saying is not told');

    // A person confirms the offer, as the register's own function records it.
    offered.documentType = KHATA;
    delete offered.proposedDocumentType;
    recordAuditEvent(project, { actor: VALUER, action: 'type_confirmed', entityType: 'evidence', entityId: offered.id, newValue: KHATA });
    facts = memoryFacts(project).held;
    const said = factOf(facts, `${offered.id}::paper_kind`)!;
    assert.deepEqual([said.tag, said.value, said.by], ['approved', KHATA, memWho(project.id, VALUER)]);
    assert.equal(factOf(facts, `${offered.id}::paper_kind::offer`), undefined, 'and the offer is no longer waiting');
  });

  it('is proposed for a value waiting on a card raised in chat', () => {
    const project = fresh('Card plot');
    const card: ChatProposal = { id: 'prop_1', kind: 'patch_project', title: 'Record the land area as 1,210 sqm', rationale: '', impact: '', status: 'proposed', payload: { landAreaSqm: 1210 }, createdAt: '2026-10-06T08:00:00.000Z', createdBy: 'assistant' };
    project.chatProposals.push(card);
    const waiting = factOf(memoryFacts(project).held, `${project.id}::land_area::card::prop_1`)!;
    assert.deepEqual([waiting.tag, waiting.readBy, waiting.stands, waiting.value, waiting.source], ['proposed', 'card', false, 1210, 'prop_1']);
    card.status = 'rejected';
    assert.equal(factOf(memoryFacts(project).held, `${project.id}::land_area::card::prop_1`), undefined, 'and gone once the card is decided');
  });
});

describe('what a fact may hold', () => {
  // Made up, and shaped like the real thing: an Aadhaar number, a PAN, a phone number, a bank account number.
  const NEVER = ['2345 6789 0123', '२३४५ ६७८९ ०१२३', 'ABCDE1234F', 'ABCDE 1234 F', '+91 98765 43210', '(080) 2345 6789', '50100123456789', 'seller@example.com', 'A Person, 98765-43210'];

  it('is never an identity number, a phone number, a bank account or an address for mail, under any key', () => {
    const project = fresh('Scrubbed plot');
    const row = paper(project, KHATA, [
      ...NEVER.map((text, at) => value(['owner', 'khata_number', 'sub_registrar', 'vendor', 'purchaser', 'pid', 'sas_number', 'zoning', 'tax_year'][at]!, text)),
      value('extent_khata', 1100.9, 'Extent 1100.9, call 98765 43210'),
      value('boundary_north', 'A paragraph. '.repeat(20)),
      value('made_up_key', 'kept nowhere'),
      value('survey_numbers', '73/4'),
    ]);
    reviewFacts(project, row.id, 'all', 'accept', VALUER);
    const { held: facts, withheld } = memoryFacts(project);
    const kept = JSON.stringify(facts);
    for (const text of [...NEVER, '98765 43210', 'A paragraph', 'kept nowhere', 'as the paper words it']) assert.ok(!kept.includes(text), `${text} is not in memory`);
    assert.deepEqual(facts.filter((fact) => fact.aboutId === row.id).map((fact) => [fact.key, fact.value, fact.display]), [
      ['extent_khata', 1100.9, undefined],
      ['survey_numbers', '73/4', undefined],
    ], 'what is left is the values that are values, a display that is not one left off');
    assert.deepEqual(withheld, { offList: 1, notAValue: NEVER.length + 1 }, 'and what was left out is counted');
  });

  it('is in the form its key takes, with the fixed list’s label and nothing the caller hung on it', () => {
    const projectId = 'prj_one';
    const fact = {
      id: `${projectId}::fact::ev_1::extent_khata::a`,
      tag: 'approved',
      key: 'extent_khata',
      label: 'Account 50100123456789',
      value: 1100.9,
      unit: 'sqm',
      aboutId: 'ev_1',
      recordedAt: '2026-10-06T08:00:00.000Z',
      by: 'valuer@example.com',
      source: 'ev_1',
      quote: 'Extent: 11,850 sq ft',
      text: 'what somebody typed',
      was: [{ at: '2026-10-06T07:00:00.000Z', what: 'accepted', by: 'lead@example.com', said: 'call 98765 43210' }],
    } as unknown as MemFact;
    assert.deepEqual(scrubMemFact(projectId, fact), {
      id: fact.id,
      tag: 'approved',
      key: 'extent_khata',
      label: STANDARD_FACT_KEYS.extent_khata!.label,
      value: 1100.9,
      unit: 'sqm',
      aboutId: 'ev_1',
      recordedAt: '2026-10-06T08:00:00.000Z',
      by: memWho(projectId, 'valuer@example.com'),
      source: 'ev_1',
      quote: 'Extent: 11,850 sq ft',
      was: [{ at: '2026-10-06T07:00:00.000Z', what: 'accepted', by: memWho(projectId, 'lead@example.com') }],
    });
    for (const [key, held_] of [['extent_khata', '1100.9'], ['registration_date', '12 March 2019'], ['ec_nil', 'yes'], ['access_type', 'by helicopter'], ['made_up_key', 'x']] as const) {
      assert.equal(scrubMemFact(projectId, { ...fact, key, value: held_ }), undefined, `${key} does not take ${held_}`);
    }
    assert.equal(scrubMemFact(projectId, { ...fact, key: 'access_type', value: 'Public Road' })!.value, 'public road', 'one of a few words is kept as the list writes it');
    assert.equal(scrubMemFact('prj_other', fact), undefined, 'a fact of another project is not this one’s to write');
    assert.equal(scrubMemFact(projectId, { ...fact, tag: 'thought' }), undefined, 'and a fact told from the record is never a thought');
  });

  it('is held to that on the way into a store too, whoever made the fact', async () => {
    const projectId = 'prj_facts_on_write';
    const fact = (slot: string, more: Partial<MemFact>): MemFact => ({ id: `${projectId}::fact::${slot}`, tag: 'approved', key: 'owner', label: 'Owner on record', value: 'A Person', aboutId: 'ev_1', recordedAt: '2026-10-06T08:00:00.000Z', source: 'ev_1', ...more });
    const put = [fact('a', {}), fact('b', { value: 'A Person, 98765 43210' }), fact('c', { value: 'seller@example.com' }), fact('d', { key: 'made_up_key' }), { ...fact('e', {}), id: 'prj_another::fact::e' }];
    const through = { auditThrough: 'aud_1', factsRev: memFactsRev(memFactsDiff([put[0]!], new Map(), 10).index) };
    assert.deepEqual(await writeMemory(memory, TENANT, {}, { projectId, entries: [], through, factChanges: { put, drop: [] } }), { written: 0 });
    assert.deepEqual(await memory.factsOf(projectId), [fact('a', {})], 'the one fact that is one');
    await memory.purge(projectId);
  });
});
