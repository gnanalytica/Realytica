/**
 * The daily review of the whole file, with a stand-in for the model.
 *
 * The brief: that it is built from the record alone, carries paper and page
 * where a paper states a value, names nobody, and stays under its length.
 * The holding: that a proposal citing a line the brief does not have is
 * dropped whole. The memory: that a matter is raised once across days
 * however it is worded, and that a dismissed one never comes back. The
 * spending: a project a day, every project a day, and a run that stops
 * starting reviews. And that with no model nothing is done.
 *
 * Every project, paper, package, activity and date is invented.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import {
  DecisionRefused,
  SWEEP_BRIEF_CHARS,
  SWEEP_SECTION_AT_MOST,
  acceptSweepSuggestion,
  addAction,
  addEvidence,
  addFinding,
  addMilestones,
  addRisk,
  addWorkPackages,
  createProject,
  decidesIn,
  dismissSweepSuggestion,
  issueCostReport,
  logSiteEntry,
  openAlerts,
  openSweepSuggestions,
  setTeamMember,
  startCostReport,
  sweepBrief,
  sweepBriefText,
  sweepDue,
  sweepEntries,
  sweepFingerprint,
  sweepProposalsHeld,
  sweepRaise,
  sweepStateOf,
  syncAlerts,
  updateCostReportRow,
  type DdProject,
  type DocumentFact,
  type FileSweepState,
  type SweepBrief,
} from '@realytica/shared';

type Cron = typeof import('../apps/api/src/cron/file-sweep');
let cron: Cron;

const LEAD = 'lead@builders.example';
const day = (d: string) => new Date(`${d}T01:30:00.000Z`);

before(async () => {
  process.env.REALYTICA_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'realytica-file-sweep-'));
  process.env.REALYTICA_AUTH_MODE = 'off';
  cron = await import('../apps/api/src/cron/file-sweep');
});

const value = (key: string, held: DocumentFact['value'], display: string, page: number): DocumentFact => ({ key, label: key, value: held, display, page, quote: `${key}: ${display}`, review: 'accepted' });

/**
 * A project under construction: a deed and a khata that give the land two
 * extents, a plinth behind its dates, a site log of concrete poured, two
 * Cost Reports with the structure up 250 and no reason typed, and an action
 * on nobody.
 */
function built(reference = 'RYT-SW1'): DdProject {
  const p = createProject({ name: `Canal Bank homes ${reference}`, type: 'residential', location: 'Canal Bank', city: 'Kadamba', currentStage: 'construction' }, reference, LEAD);
  p.status = 'active';
  const deed = addEvidence(p, { title: 'Sale deed of the northern parcel', kind: 'document', status: 'received' }, LEAD);
  deed.documentType = 'Sale deed';
  deed.facts = [value('registration_date', '2019-04-12', '12 April 2019', 3), value('survey_numbers', '41/2', '41/2', 2)];
  const khata = addEvidence(p, { title: 'Khata extract', kind: 'document', status: 'received' }, LEAD);
  khata.documentType = 'Khata certificate and extract';
  khata.facts = [value('extent_khata', 4046, '4,046 sq m', 1), { ...value('survey_numbers', '41/3', '41/3', 1), review: 'proposed', source: 'model', proof: 'page_text' }];
  const [plinth] = addMilestones(p, [{ name: 'Plinth', weight: 5, plannedFinish: '2026-10-31' }], LEAD);
  plinth!.plannedStart = '2026-09-01';
  plinth!.percent = 20;
  logSiteEntry(p, { clientId: 'log-1', date: '2026-10-08', workDone: 'Concrete poured to the plinth beams, grid A to D.', manpower: [], milestoneUpdates: [], issues: [{ title: 'Pump broke down for two hours', severity: 'low' }] }, 'site@builders.example');
  addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }, { code: 'B', name: 'Facade', budget: 500 }], LEAD);
  const july = startCostReport(p, { month: '2026-07-01' }, LEAD);
  updateCostReportRow(p, july.id, july.rows[0]!.id, { poIssued: 900, amountPaid: 300, anticipatedCost: 1000 }, LEAD);
  issueCostReport(p, july.id, LEAD);
  const august = startCostReport(p, { month: '2026-08-01' }, LEAD);
  updateCostReportRow(p, august.id, august.rows.find((row) => row.name === 'Structure')!.id, { poIssued: 900, amountPaid: 700, anticipatedCost: 1250 }, LEAD);
  issueCostReport(p, august.id, LEAD);
  addAction(p, { title: 'Get the revised structural drawings stamped', kind: 'approval_submission', owner: 'Unassigned', priority: 'high' }, LEAD);
  addAction(p, { title: 'Chase the lift supplier', kind: 'clarification', owner: 'Anika Rao', priority: 'low', dueDate: '2026-10-20' }, LEAD);
  return p;
}

const markOf = (brief: SweepBrief, words: string): string => {
  const entry = sweepEntries(brief).find((held) => held.says.includes(words));
  assert.ok(entry, `no line of the brief says “${words}”`);
  return entry.mark;
};

/** What a model would answer about `built`: the cost that moved, the action on nobody, and two things that cite what is not there. */
function answered(brief: SweepBrief, wording = 'The structure’s forecast rose with no reason recorded.') {
  return [
    { kind: 'cost_unexplained', statement: wording, why: 'The package moved and the report gives no variation, award or reason.', action: 'Ask the cost consultant for the reason and type it against the package.', cites: [markOf(brief, 'A Structure')], department: 'finance', severity: 'high', as: 'finding' },
    { kind: 'action_unowned', statement: 'The stamping of the revised drawings is on nobody.', why: 'It is open with nobody named and no due date, and the plinth is behind.', action: 'Name somebody for it.', cites: [markOf(brief, 'Get the revised structural drawings stamped'), `[${markOf(brief, 'Plinth: 20% done')}]`], department: 'construction', severity: 'medium', as: 'risk' },
    { kind: 'approval_missing', statement: 'The fire NOC lapsed last year.', why: 'A line that is not in the brief.', action: 'Renew it.', cites: ['e9999'], department: 'legal', severity: 'high', as: 'finding' },
    { kind: 'papers_disagree', statement: 'Two papers give the survey number differently.', why: 'Only one line is cited for two papers.', action: 'Read both.', cites: [markOf(brief, 'Survey number: 41/2')], department: 'legal', severity: 'high', as: 'finding' },
    { kind: 'cost_unexplained', statement: 'The facade is fine.', why: 'Cites nothing.', action: '', cites: [], department: 'finance', severity: 'low', as: 'finding' },
    { kind: 'something_else', statement: 'A kind nobody asked for.', why: 'x', action: '', cites: [markOf(brief, 'Plinth: 20% done')], department: 'finance', severity: 'low', as: 'finding' },
  ];
}

describe('the brief of a project', () => {
  it('is built from the record: values with paper and page, what waits, schedule, site log, cost, actions', () => {
    const p = built();
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const text = sweepBriefText(brief);
    const byKey = Object.fromEntries(brief.sections.map((section) => [section.key, section.entries]));
    const deedDate = byKey.facts!.find((entry) => entry.says.includes('12 April 2019'))!;
    assert.deepEqual(deedDate.paper, { evidenceId: p.evidence[0]!.id, title: 'Sale deed of the northern parcel', page: 3 });
    assert.match(text, /\[e\d+\] Registered on: 12 April 2019 — paper “Sale deed of the northern parcel”, page 3/);
    // The model's reading of the khata waits, and is under the heading that says so.
    assert.ok(byKey.waiting!.some((entry) => entry.says.includes('41/3')));
    assert.ok(!byKey.facts!.some((entry) => entry.says.includes('41/3')));
    assert.ok(byKey.schedule!.some((entry) => entry.kind === 'milestone' && /Plinth: 20% done; planned 2026-09-01 to 2026-10-31/.test(entry.says)));
    assert.ok(byKey.site_log!.some((entry) => entry.says.startsWith('2026-10-08: Concrete poured') && entry.says.includes('Pump broke down')));
    assert.ok(byKey.cost!.some((entry) => /A Structure: forecast .*1,000 to .*1,250 \(\+.*250\).*unexplained \+.*250; no reason given/.test(entry.says)), text);
    assert.ok(byKey.actions!.some((entry) => entry.says.includes('nobody named for it; no due date')));
    assert.ok(byKey.approvals!.some((entry) => entry.ref === 'approval:commencement'));
    assert.ok(byKey.changes!.length > 0);
    // Every mark is one line, and every line is an entry on the record under its own id.
    const entries = sweepEntries(brief);
    assert.equal(new Set(entries.map((entry) => entry.mark)).size, entries.length);
    assert.equal(new Set(entries.map((entry) => entry.ref)).size, entries.length);
  });

  it('names nobody: an action says whether somebody is named, the team’s trail is left out', () => {
    const p = built();
    setTeamMember(p, { email: 'vera@builders.example', name: 'Vera Iyer', departments: { finance: 'viewer' } }, LEAD);
    const text = sweepBriefText(sweepBrief(p, { now: day('2026-10-12') }));
    assert.match(text, /Chase the lift supplier: somebody is named for it; due 2026-10-20/);
    for (const name of ['Anika', 'vera@', 'Vera Iyer', 'site@builders', LEAD]) assert.ok(!text.includes(name), name);
  });

  it('lists what changed since the last review, and only that', () => {
    const p = built();
    const before = sweepBrief(p, { now: day('2026-10-12'), since: new Date(Date.now() + 60_000).toISOString() });
    assert.equal(before.sections.find((section) => section.key === 'changes')!.entries.length, 0);
    assert.match(sweepBriefText(before), /## Changed since the last review, newest first\nNothing on the record\./);
  });

  it('stays under its length however much the record holds, and counts what it left out', () => {
    const p = built();
    for (let i = 0; i < 400; i += 1) addAction(p, { title: `Action ${i}: ${'a long title that goes on '.repeat(12)}`, kind: 'clarification', owner: 'Unassigned', priority: 'low' }, LEAD);
    for (let i = 0; i < 300; i += 1) logSiteEntry(p, { clientId: `bulk-${i}`, date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, workDone: 'Shuttering and steel fixing '.repeat(20), manpower: [], milestoneUpdates: [], issues: [] }, 'site@builders.example');
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const text = sweepBriefText(brief);
    assert.ok(text.length <= SWEEP_BRIEF_CHARS + 2000, String(text.length));
    for (const section of brief.sections) assert.ok(section.entries.length <= SWEEP_SECTION_AT_MOST[section.key]);
    const actions = brief.sections.find((section) => section.key === 'actions')!;
    assert.equal(actions.entries.length + actions.more, 402);
    assert.match(text, /\(\d+ more on the record, not shown\.\)/);
  });
});

describe('a brief cut to its length', () => {
  const section = (brief: SweepBrief, key: string) => brief.sections.find((held) => held.key === key)!;

  it('keeps the actions that press and the newest, and leaves out the oldest', () => {
    const p = built();
    for (let i = 0; i < 100; i += 1) {
      const action = addAction(p, { title: `Action number ${i} of the hundred`, kind: 'clarification', owner: i === 3 ? 'Unassigned' : 'Anika Rao', priority: 'low', dueDate: i === 5 ? '2026-09-01' : '2026-12-01' }, LEAD);
      action.createdAt = new Date(Date.parse('2026-10-01T00:00:00.000Z') + i * 60_000).toISOString();
    }
    const actions = section(sweepBrief(p, { now: day('2026-10-12') }), 'actions');
    const said = actions.entries.map((entry) => entry.says);
    assert.equal(said.length, SWEEP_SECTION_AT_MOST.actions);
    const has = (n: number) => said.some((line) => line.startsWith(`Action number ${n} of the hundred`));
    assert.ok(has(99) && has(60), 'the newest are in');
    assert.ok(has(3) && has(5), 'so are an old one nobody is named for and an old one overdue');
    assert.ok(!has(10) && !has(20), 'the oldest that press on nobody are the ones left out');
    assert.ok(said.findIndex((line) => line.startsWith('Action number 5 of')) < said.findIndex((line) => line.startsWith('Action number 99 of')), 'and what presses comes first');
  });

  it('keeps the values recorded last', () => {
    const p = built();
    for (let i = 0; i < 140; i += 1) {
      const paper = addEvidence(p, { title: `Khata extract ${i}`, kind: 'document', status: 'received' }, LEAD);
      paper.documentType = 'Khata certificate and extract';
      paper.createdAt = new Date(Date.parse('2026-06-01T00:00:00.000Z') + i * 3_600_000).toISOString();
      paper.facts = [value('extent_khata', 1000 + i, `${1000 + i} sq m`, 1)];
    }
    const facts = section(sweepBrief(p, { now: day('2026-10-12') }), 'facts');
    assert.equal(facts.entries.length, SWEEP_SECTION_AT_MOST.facts);
    const papers = facts.entries.map((entry) => entry.paper?.title);
    assert.ok(papers.includes('Khata extract 139') && papers.includes('Khata extract 100'));
    assert.ok(!papers.includes('Khata extract 0'), 'the oldest papers are the ones cut');
  });

  it('shares what is already raised among findings, risks and alerts', () => {
    const p = built();
    for (let i = 0; i < 45; i += 1) addFinding(p, { title: `Finding ${i}`, description: 'x', severity: 'medium', discipline: 'legal' }, LEAD);
    addRisk(p, { title: 'The retaining wall may not hold', category: 'cost', cause: 'x', impactType: 'cost', probability: 'possible', impactScore: 5, materiality: 'critical' }, LEAD);
    syncAlerts(p, day('2026-10-12'));
    const alerts = Math.min(openAlerts(p).length, 13);
    assert.ok(alerts > 0, 'the project has an open alert');
    const register = section(sweepBrief(p, { now: day('2026-10-12') }), 'register');
    assert.equal(register.entries.length, SWEEP_SECTION_AT_MOST.register);
    assert.ok(register.entries.some((entry) => entry.kind === 'risk' && entry.says.includes('The retaining wall may not hold')), 'the one critical risk is not crowded out by 45 findings');
    assert.equal(register.entries.filter((entry) => entry.kind === 'alert').length, alerts);
    assert.equal(register.entries.filter((entry) => entry.kind === 'finding').length, SWEEP_SECTION_AT_MOST.register - 1 - alerts);
    assert.equal(register.more, 45 + 1 + openAlerts(p).length - SWEEP_SECTION_AT_MOST.register);
  });
});

describe('what a model answers', () => {
  it('is dropped where it cites no line of a kind it is about', () => {
    const p = built();
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const action = markOf(brief, 'Get the revised structural drawings stamped');
    const other = markOf(brief, 'Chase the lift supplier');
    const approval = sweepEntries(brief).find((entry) => entry.kind === 'approval')!.mark;
    const log = markOf(brief, 'Concrete poured to the plinth beams');
    const base = { statement: 'Something looks wrong.', why: 'Read off the lines cited.', action: 'Look.', department: 'legal', severity: 'medium', as: 'finding' };
    const { kept, dropped } = sweepProposalsHeld(p, brief, [
      { ...base, kind: 'approval_missing', cites: [action] },
      { ...base, kind: 'papers_disagree', cites: [action, other] },
      { ...base, kind: 'cost_unexplained', cites: [log] },
      { ...base, kind: 'action_unowned', cites: [approval] },
      { ...base, kind: 'approval_missing', cites: [approval, log] },
    ]);
    assert.equal(dropped, 4);
    assert.deepEqual(kept.map((proposal) => [proposal.kind, proposal.sources.map((source) => source.kind).sort()]), [['approval_missing', ['approval', 'site_log']]]);
  });
  it('is kept only where every line it cites is a line of the brief', () => {
    const p = built();
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const { kept, dropped } = sweepProposalsHeld(p, brief, answered(brief));
    assert.deepEqual(kept.map((proposal) => proposal.kind), ['cost_unexplained', 'action_unowned']);
    // A mark not in the brief, one line for two papers, no line at all, and a kind not asked for.
    assert.equal(dropped, 4);
    const cost = kept[0]!;
    assert.equal(cost.sources.length, 1);
    assert.match(cost.sources[0]!.says, /A Structure: forecast/);
    assert.equal(cost.sources[0]!.ref, `${p.costReports!.at(-1)!.id}:${p.cost!.workPackages[0]!.id}`);
    // A mark written in brackets is the same mark.
    assert.deepEqual(kept[1]!.sources.map((source) => source.kind).sort(), ['action', 'milestone']);
  });

  it('carries the paper and page of a line that has them', () => {
    const p = built();
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const said = [{ kind: 'papers_disagree', statement: 'The deed and the khata give the survey number differently.', why: 'One says 41/2 and the other, waiting, 41/3.', action: 'Read both pages.', cites: [markOf(brief, 'Survey number: 41/2'), markOf(brief, 'Survey number: 41/3')], department: 'legal', severity: 'high', as: 'finding' }];
    const [kept] = sweepProposalsHeld(p, brief, said).kept;
    assert.deepEqual(
      kept!.sources.map((source) => [source.paper, source.page]),
      [['Sale deed of the northern parcel', 2], ['Khata extract', 1]],
    );
  });

  it('falls to a department the project uses, and is nothing when it is no list', () => {
    const p = built();
    p.departments = ['construction'];
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const [kept] = sweepProposalsHeld(p, brief, [answered(brief)[0]]).kept;
    assert.equal(kept!.department, 'construction');
    assert.deepEqual(sweepProposalsHeld(p, brief, 'nothing wrong'), { kept: [], dropped: 0 });
  });
});

/** A stand-in for the store and the model: counts what it is asked, and answers each project as `answer` says. */
function source(projects: DdProject[], opts: { model?: boolean; tokens?: number; ahead?: number; answer?: (project: DdProject, brief: string) => unknown[] | null; unread?: string[]; clock?: () => number } = {}) {
  const states = new Map<string, FileSweepState>();
  const asked: string[] = [];
  const writes: string[] = [];
  const cronSource: import('../apps/api/src/cron/file-sweep').FileSweepSource = {
    ids: () => projects.map((p) => p.id),
    fresh: async (id) => {
      if (opts.unread?.includes(id)) throw new Error('storage did not answer');
      return projects.find((p) => p.id === id);
    },
    read: async (id) => sweepStateOf(structuredClone(states.get(id))),
    write: async (id, state) => {
      writes.push(id);
      states.set(id, structuredClone(state));
    },
    modelSetUp: () => opts.model ?? true,
    ahead: () => opts.ahead ?? 9000,
    ask: async ({ brief, caseId }) => {
      asked.push(caseId);
      const project = projects.find((p) => p.id === caseId)!;
      const proposals = opts.answer ? opts.answer(project, brief) : answered(sweepBrief(project, { now: day('2026-10-12') }));
      return proposals ? { proposals, tokens: opts.tokens ?? 7000 } : null;
    },
    clock: opts.clock ?? (() => 0),
  };
  return { cronSource, states, asked, writes };
}

describe('the daily review', () => {
  it('stores what survives as suggestions, with their sources, and writes nothing on the project', async () => {
    const p = built();
    const was = JSON.stringify(p);
    const { cronSource, states } = source([p]);
    const run = await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.deepEqual({ projects: run.projects, due: run.due, swept: run.swept, raised: run.raised, dropped: run.dropped, failed: run.failed, noModel: run.noModel }, { projects: 1, due: 1, swept: 1, raised: 2, dropped: 4, failed: 0, noModel: 0 });
    assert.equal(JSON.stringify(p), was);
    const state = states.get(p.id)!;
    assert.equal(state.sweptThrough, p.updatedAt);
    assert.equal(state.tokens, 7000);
    const [first] = openSweepSuggestions(state);
    assert.equal(first!.status, 'open');
    assert.ok(first!.sources.length > 0 && first!.statement && first!.why && first!.department);
    assert.equal(first!.fingerprint, sweepFingerprint(first!.kind, first!.sources.map((s) => s.ref)));
  });

  it('called twice on one day reviews once', async () => {
    const p = built();
    const { cronSource, asked } = source([p]);
    await cron.fileSweep(day('2026-10-12'), cronSource);
    const again = await cron.fileSweep(new Date('2026-10-12T09:00:00.000Z'), cronSource);
    assert.equal(asked.length, 1);
    assert.deepEqual({ due: again.due, swept: again.swept, raised: again.raised, tokens: again.tokens }, { due: 0, swept: 0, raised: 0, tokens: 0 });
  });

  it('leaves alone a project that has not moved, and one not in work', async () => {
    const p = built();
    const closed = built('RYT-SW2');
    closed.status = 'closed';
    const { cronSource, asked } = source([p, closed]);
    await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.deepEqual(asked, [p.id]);
    assert.equal((await cron.fileSweep(day('2026-10-13'), cronSource)).due, 0);
    addAction(p, { title: 'Order the rebar', kind: 'clarification', owner: 'Unassigned', priority: 'low' }, LEAD);
    assert.equal((await cron.fileSweep(day('2026-10-14'), cronSource)).due, 1);
  });

  it('does not raise the same matter on a later day, however it is worded', async () => {
    const p = built();
    let wording = 'The structure’s forecast rose with no reason recorded.';
    const { cronSource, states } = source([p], { answer: (project) => answered(sweepBrief(project, { now: day('2026-10-12') }), wording).slice(0, 2) });
    assert.equal((await cron.fileSweep(day('2026-10-12'), cronSource)).raised, 2);
    // The record moves, so the project is due again, and the model says the same things in other words.
    addAction(p, { title: 'Order the rebar', kind: 'clarification', owner: 'Unassigned', priority: 'low' }, LEAD);
    wording = 'Package A went up by 250 and nobody wrote down why.';
    const next = await cron.fileSweep(day('2026-10-13'), cronSource);
    assert.deepEqual({ swept: next.swept, raised: next.raised, repeats: next.repeats }, { swept: 1, raised: 0, repeats: 2 });
    assert.equal(states.get(p.id)!.suggestions.length, 2);
  });

  it('never raises a dismissed matter again, and does not duplicate an accepted one', async () => {
    const p = built();
    const { cronSource, states } = source([p], { answer: (project) => answered(sweepBrief(project, { now: day('2026-10-12') })).slice(0, 2) });
    await cron.fileSweep(day('2026-10-12'), cronSource);
    const state = states.get(p.id)!;
    const [cost, unowned] = [state.suggestions.find((s) => s.kind === 'cost_unexplained')!, state.suggestions.find((s) => s.kind === 'action_unowned')!];
    dismissSweepSuggestion(state, cost.id, { actor: LEAD, reason: 'The rise is the steel escalation, minuted in August.' });
    acceptSweepSuggestion(p, state, unowned.id, { actor: LEAD });
    for (const on of ['2026-10-13', '2026-10-14', '2026-10-20']) {
      addAction(p, { title: `Something else on ${on}`, kind: 'clarification', owner: 'Anika Rao', priority: 'low' }, LEAD);
      const run = await cron.fileSweep(day(on), cronSource);
      assert.deepEqual({ swept: run.swept, raised: run.raised, repeats: run.repeats }, { swept: 1, raised: 0, repeats: 2 }, on);
    }
    const kept = states.get(p.id)!;
    assert.deepEqual(kept.suggestions.map((s) => s.status).sort(), ['accepted', 'dismissed']);
    assert.equal(kept.suggestions.find((s) => s.status === 'dismissed')!.reason, 'The rise is the steel escalation, minuted in August.');
  });

  it('keeps a decision made while the model was answering', async () => {
    const p = built();
    const first = source([p], { answer: (project) => answered(sweepBrief(project, { now: day('2026-10-12') })).slice(0, 1) });
    await cron.fileSweep(day('2026-10-12'), first.cronSource);
    addAction(p, { title: 'Order the rebar', kind: 'clarification', owner: 'Unassigned', priority: 'low' }, LEAD);
    const original = first.cronSource.ask;
    first.cronSource.ask = async (input) => {
      const state = first.states.get(p.id)!;
      dismissSweepSuggestion(state, state.suggestions[0]!.id, { actor: LEAD, reason: 'Known and minuted.' });
      return original(input);
    };
    await cron.fileSweep(day('2026-10-13'), first.cronSource);
    assert.equal(first.states.get(p.id)!.suggestions[0]!.status, 'dismissed');
  });

  it('stops at a project’s tokens for the day: a model that fails is charged and not retried past the ceiling', async () => {
    const p = built();
    const ahead = Math.ceil(cron.SWEEP_TOKENS_PER_PROJECT_PER_DAY / 2) - 1;
    const { cronSource, asked, states } = source([p], { answer: () => null, ahead });
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push(await cron.fileSweep(day('2026-10-12'), cronSource));
    assert.equal(asked.length, 2);
    assert.deepEqual(runs.map((run) => [run.failed, run.overCeiling]), [[1, 0], [1, 0], [0, 1], [0, 1]]);
    assert.equal(states.get(p.id)!.tokens, ahead * 2);
    assert.ok(states.get(p.id)!.tokens! <= cron.SWEEP_TOKENS_PER_PROJECT_PER_DAY);
    // A new day is a new allowance.
    assert.equal((await cron.fileSweep(day('2026-10-13'), cronSource)).failed, 1);
    assert.equal(asked.length, 3);
  });

  it('stops at the day’s tokens over every project, and takes the rest another day', async () => {
    const projects = Array.from({ length: 6 }, (_, i) => built(`RYT-D${i}`));
    const each = Math.floor(cron.SWEEP_TOKENS_PER_PROJECT_PER_DAY * 0.9);
    const fits = Math.floor(cron.SWEEP_TOKENS_PER_DAY / each);
    const many = Array.from({ length: fits + 3 }, (_, i) => projects[i] ?? built(`RYT-E${i}`));
    const { cronSource, asked } = source(many, { ahead: each, tokens: each, answer: () => [] });
    const run = await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.equal(asked.length, fits);
    assert.deepEqual({ swept: run.swept, overCeiling: run.overCeiling }, { swept: fits, overCeiling: 3 });
    assert.ok(run.tokens <= cron.SWEEP_TOKENS_PER_DAY);
    // The same day again spends nothing more; the next day takes the three left over.
    assert.equal((await cron.fileSweep(day('2026-10-12'), cronSource)).tokens, 0);
    const next = await cron.fileSweep(day('2026-10-13'), cronSource);
    assert.deepEqual({ due: next.due, swept: next.swept }, { due: 3, swept: 3 });
  });

  it('stops starting reviews when the run has gone on long enough, the one reviewed longest ago first next time', async () => {
    const [a, b, c] = [built('RYT-T1'), built('RYT-T2'), built('RYT-T3')];
    let now = 0;
    const { cronSource, asked } = source([a, b, c], { answer: () => [], clock: () => now });
    const original = cronSource.ask;
    cronSource.ask = async (input) => {
      now += cron.SWEEP_RUN_LIMIT_MS;
      return original(input);
    };
    const run = await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.deepEqual({ swept: run.swept, deferred: run.deferred }, { swept: 2, deferred: 1 });
    assert.deepEqual(asked, [a.id, b.id]);
    now = 0;
    await cron.fileSweep(new Date('2026-10-12T06:00:00.000Z'), cronSource);
    assert.deepEqual(asked, [a.id, b.id, c.id]);
  });

  it('goes on past a project storage does not answer for', async () => {
    const [a, b] = [built('RYT-F1'), built('RYT-F2')];
    const { cronSource, asked } = source([a, b], { unread: [a.id] });
    const run = await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.deepEqual({ failed: run.failed, swept: run.swept }, { failed: 1, swept: 1 });
    assert.deepEqual(asked, [b.id]);
  });

  it('does nothing with no model set up, and says so', async () => {
    const p = built();
    const { cronSource, asked, writes } = source([p], { model: false });
    const run = await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.deepEqual(run, { projects: 1, due: 0, swept: 0, raised: 0, dropped: 0, repeats: 0, overCeiling: 0, deferred: 0, failed: 0, tokens: 0, noModel: 1 });
    assert.deepEqual([asked, writes], [[], []]);
  });
});

describe('a person’s answer to a suggestion', () => {
  async function raised() {
    const p = built();
    const { cronSource, states } = source([p]);
    await cron.fileSweep(day('2026-10-12'), cronSource);
    const state = states.get(p.id)!;
    return { p, state, cost: state.suggestions.find((s) => s.kind === 'cost_unexplained')!, unowned: state.suggestions.find((s) => s.kind === 'action_unowned')! };
  }

  it('accepted, becomes a finding with what it rests on, and the trail says who accepted it', async () => {
    const { p, state, cost } = await raised();
    const { record } = acceptSweepSuggestion(p, state, cost.id, { actor: LEAD, at: '2026-10-12T08:00:00.000Z' });
    const finding = p.findings.find((held) => held.id === record.id)!;
    assert.equal(finding.title, 'The structure’s forecast rose with no reason recorded.');
    assert.equal(finding.severity, 'high');
    assert.equal(finding.status, 'open');
    assert.equal(finding.discipline, 'cost_quantity');
    assert.match(finding.description, /Rests on: A Structure: forecast/);
    assert.equal(finding.confidenceNote, `Suggested by the daily review on 2026-10-12, accepted by ${LEAD} on 2026-10-12.`);
    assert.equal(finding.mitigation, 'Ask the cost consultant for the reason and type it against the package.');
    const line = p.audit.at(-1)!;
    assert.deepEqual([line.action, line.actor, line.entityId], ['accept_review_suggestion', LEAD, finding.id]);
    assert.deepEqual(cost.record, { type: 'finding', id: finding.id });
    assert.throws(() => acceptSweepSuggestion(p, state, cost.id, { actor: LEAD }), /accepted already/);
  });

  it('accepted as a risk, becomes a risk', async () => {
    const { p, state, unowned } = await raised();
    const { record } = acceptSweepSuggestion(p, state, unowned.id, { actor: LEAD });
    const risk = p.risks.find((held) => held.id === record.id)!;
    assert.equal(risk.status, 'identified');
    assert.equal(risk.materiality, 'medium');
    assert.equal(risk.mitigation, 'Name somebody for it.');
    assert.equal(p.findings.length, 0);
  });

  it('dismissed, needs a reason and leaves the project as it was', async () => {
    const { p, state, cost } = await raised();
    const was = JSON.stringify(p);
    assert.throws(() => dismissSweepSuggestion(state, cost.id, { actor: LEAD, reason: ' ' }), /Say why/);
    dismissSweepSuggestion(state, cost.id, { actor: LEAD, reason: 'Minuted in August.' });
    assert.equal(JSON.stringify(p), was);
    assert.equal(openSweepSuggestions(state).length, 1);
    assert.throws(() => dismissSweepSuggestion(state, 'swp_nothing', { actor: LEAD, reason: 'No such thing.' }), /No suggestion by that id/);
  });

  it('is a lead’s or a signer’s of its department, and nobody else’s', async () => {
    const { p, state, cost } = await raised();
    setTeamMember(p, { email: 'sign@builders.example', departments: { finance: 'signer' }, signer: { profession: 'Chartered accountant' } }, LEAD);
    setTeamMember(p, { email: 'vera@builders.example', departments: { finance: 'viewer', construction: 'lead' } }, LEAD);
    const as = (email: string, workspaceRole: 'owner' | 'staff' | 'viewer') => decidesIn(p, { email, workspaceRole });
    for (const refused of [as('staff@builders.example', 'staff'), as('reader@builders.example', 'viewer'), as('vera@builders.example', 'owner')]) {
      assert.throws(() => acceptSweepSuggestion(p, state, cost.id, { actor: 'x' }, refused), DecisionRefused);
      assert.throws(() => dismissSweepSuggestion(state, cost.id, { actor: 'x', reason: 'Not mine to say.' }, refused), DecisionRefused);
    }
    assert.equal(p.findings.length, 0);
    assert.equal(cost.status, 'open');
    assert.throws(() => acceptSweepSuggestion(p, state, cost.id, { actor: 'x' }, as('vera@builders.example', 'owner')), /team list makes you a viewer there/);
    acceptSweepSuggestion(p, state, cost.id, { actor: 'sign@builders.example' }, as('sign@builders.example', 'staff'));
    assert.equal(p.findings.length, 1);
  });
});

describe('what the review keeps', () => {
  it('opens whatever was written: nothing, another build’s file, a suggestion of a kind since dropped', () => {
    assert.deepEqual(sweepStateOf(undefined), { v: 1, suggestions: [] });
    assert.deepEqual(sweepStateOf('not a file'), { v: 1, suggestions: [] });
    const kept = sweepStateOf({ sweptAt: '2026-10-11T01:30:00.000Z', tokens: 'many', extra: true, suggestions: [{ id: 'swp_1', kind: 'gone', sources: [] }, { id: 'swp_2', kind: 'action_unowned', sources: [] }, null] });
    assert.deepEqual(kept, { v: 1, sweptAt: '2026-10-11T01:30:00.000Z', suggestions: [{ id: 'swp_2', kind: 'action_unowned', sources: [] }] });
  });

  it('tells a matter by what it is about: one cited line more or fewer is the same matter, another kind is not', () => {
    const state = sweepStateOf(undefined);
    const about = (kind: 'cost_unexplained' | 'action_unowned', ...refs: string[]) => ({ kind, statement: 's', why: 'w', action: '', department: 'finance' as const, severity: 'low' as const, as: 'finding' as const, sources: refs.map((ref) => ({ ref, kind: 'cost' as const, says: ref })) });
    assert.equal(sweepRaise(state, [about('cost_unexplained', 'a', 'b')], '2026-10-12T01:30:00.000Z').raised.length, 1);
    const next = sweepRaise(state, [about('cost_unexplained', 'b', 'a'), about('cost_unexplained', 'a'), about('cost_unexplained', 'a', 'b', 'c'), about('action_unowned', 'a', 'b'), about('cost_unexplained', 'c', 'd')], '2026-10-13T01:30:00.000Z');
    assert.deepEqual([next.repeats, next.raised.map((s) => s.kind)], [3, ['action_unowned', 'cost_unexplained']]);
    assert.equal(sweepFingerprint('cost_unexplained', ['b', 'a']), sweepFingerprint('cost_unexplained', ['a', 'b', 'a']));
  });

  it('silences, for a dismissed matter, only a proposal about the very same entries, whatever kind it is called', () => {
    const state = sweepStateOf(undefined);
    const about = (kind: 'approval_missing' | 'date_impossible', ...refs: string[]) => ({ kind, statement: 's', why: 'w', action: '', department: 'legal' as const, severity: 'low' as const, as: 'finding' as const, sources: refs.map((ref) => ({ ref, kind: 'approval' as const, says: ref })) });
    const [first] = sweepRaise(state, [about('approval_missing', 'approval:fire_noc')], '2026-10-12T01:30:00.000Z').raised;
    dismissSweepSuggestion(state, first!.id, { actor: LEAD, reason: 'It expires soon; the renewal is in hand.' });
    // The same entry under another kind is the same matter the person dismissed.
    const again = sweepRaise(state, [about('approval_missing', 'approval:fire_noc'), about('date_impossible', 'approval:fire_noc')], '2026-10-13T01:30:00.000Z');
    assert.deepEqual([again.raised.length, again.dismissedBefore], [0, 2]);
    // A month on, the same approval with a site entry beside it is another matter: slab cast after the NOC lapsed.
    const later = sweepRaise(state, [about('approval_missing', 'approval:fire_noc', 'log-1')], '2026-11-12T01:30:00.000Z');
    assert.deepEqual([later.raised.length, later.dismissedBefore], [1, 0]);
    // And while that one is open, one line more or fewer is still the same matter.
    const open = sweepRaise(state, [about('approval_missing', 'approval:fire_noc', 'log-1', 'log-2'), about('approval_missing', 'log-1')], '2026-11-13T01:30:00.000Z');
    assert.deepEqual([open.raised.length, open.repeats], [0, 2]);
  });

  it('is due only for a project in work that has moved and was not reviewed today', () => {
    const p = built();
    assert.equal(sweepDue(p, {}, day('2026-10-12')), true);
    assert.equal(sweepDue(p, { sweptAt: '2026-10-11T01:30:00.000Z', sweptThrough: p.updatedAt }, day('2026-10-12')), false);
    assert.equal(sweepDue(p, { sweptAt: '2026-10-12T00:10:00.000Z', sweptThrough: 'earlier' }, day('2026-10-12')), false);
    assert.equal(sweepDue(p, { sweptAt: '2026-10-11T01:30:00.000Z', sweptThrough: 'earlier' }, day('2026-10-12')), true);
    assert.equal(sweepDue({ ...p, status: 'on_hold' }, {}, day('2026-10-12')), false);
  });
});
