/**
 * The daily review of the whole file, with a stand-in for the model.
 *
 * The brief: that it is built from the record alone, carries paper and page
 * where a paper states a value, names nobody, and stays under its length.
 * The rules: that four of the six kinds are found by code with no model.
 * The holding: that only a kind and marks are read from a model, that any
 * sentence it sends is thrown away and never stored, and that a nomination
 * citing a line the brief does not have is dropped whole. The wording: that
 * every line a person reads is a template's. The memory: that a matter is
 * raised once across days, and that a dismissed one never comes back. The
 * spending: a project a day, every project a day, and a run that stops
 * starting reviews. And that with no model the rules still run.
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
  sweepNominationsHeld,
  sweepRuleFindings,
  setFieldValues,
  proposeFieldValues,
  decideField,
  sweepSaid,
  sweepRaise,
  sweepStateOf,
  syncAlerts,
  updateCostReportRow,
  type DdProject,
  type DocumentFact,
  type FileSweepState,
  type SweepBrief,
  type SweepSuggestion,
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

/** What a model would answer about `built`, sentences and all: the cost that moved, a kind that is a rule's and not its to name, and things that cite what is not there. */
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

/** Every string a stored thing holds, at any depth. */
const stringsOf = (held: unknown): string[] => (typeof held === 'string' ? [held] : held && typeof held === 'object' ? Object.values(held).flatMap(stringsOf) : []);

describe('what the rules find, with no model', () => {
  it('finds two papers that state one field differently, with the paper and page of each', () => {
    const p = built();
    const found = sweepRuleFindings(p, day('2026-10-12')).filter((held) => held.kind === 'papers_disagree');
    assert.equal(found.length, 1);
    const [matter] = found;
    assert.equal(matter!.by, 'rule');
    assert.deepEqual(matter!.subjects, [{ fn: 'legal.title', set: 'land_site.parcel_identification', field: 'survey_numbers' }]);
    assert.deepEqual(matter!.sources.map((source) => [source.paper, source.page]), [['Sale deed of the northern parcel', 2], ['Khata extract', 1]]);
    assert.equal(sweepSaid(matter!).line, 'Survey number 41/2 (Sale deed of the northern parcel) against 41/3 (Khata extract, waiting on a person).');
    assert.deepEqual([matter!.severity, matter!.next, matter!.as], ['high', 'correct_value', 'finding']);
  });

  it('says nothing of two papers that agree within the tolerance, and gives the divergence where they do not', () => {
    const p = built();
    const [deed, khata] = p.evidence;
    deed!.facts = [value('extent_title', 4046, '4,046 sq m', 2)];
    khata!.documentType = 'RTC (record of rights)';
    khata!.facts = [value('extent_title', 4050, '4,050 sq m', 1)];
    assert.equal(sweepRuleFindings(p, day('2026-10-12')).filter((held) => held.kind === 'papers_disagree').length, 0);
    khata!.facts = [value('extent_title', 5000, '5,000 sq m', 1)];
    const [matter] = sweepRuleFindings(p, day('2026-10-12')).filter((held) => held.kind === 'papers_disagree');
    assert.deepEqual([matter!.difference, matter!.unit], [19.1, '%']);
    // The field that names its papers is the one the matter is about.
    assert.deepEqual(matter!.subjects, [{ fn: 'legal.title', set: 'legal.title.holding', field: 'extent' }]);
    assert.match(sweepSaid(matter!).line, /: 19\.1% apart\.$/);
  });

  it('finds a date that cannot be right: a finish before its start, work logged before its certificate', () => {
    const p = built();
    p.milestones![0]!.plannedStart = '2026-11-15';
    const cc = addEvidence(p, { title: 'Commencement certificate', kind: 'document', status: 'received' }, LEAD);
    cc.documentType = 'Commencement certificate';
    cc.facts = [value('issued_on', '2026-10-20', '20 October 2026', 1)];
    const lines = sweepRuleFindings(p, day('2026-10-22')).filter((held) => held.kind === 'date_impossible').map((held) => sweepSaid(held).line);
    assert.deepEqual(lines, [
      'Plinth: planned start (2026-11-15) is after its planned finish (2026-10-31), by 15 days.',
      'Commencement certificate: issued (2026-10-20) is after the first work logged on site (2026-10-08), by 12 days.',
    ]);
  });

  it('runs every date rule a department’s field set declares, wherever a paper states one of the two dates', () => {
    const p = built();
    const paper = addEvidence(p, { title: 'Commencement certificate', kind: 'document', status: 'received' }, LEAD);
    const OCCUPANCY = 'legal.approvals.occupancy';
    const at = (field: string) => ({ fn: 'legal.approvals', set: OCCUPANCY, field });
    const mine = (held: { subjects?: Array<{ set: string }> }) => Boolean(held.subjects?.some((subject) => subject.set === OCCUPANCY));
    // Liaison's own rule, on a sheet the review was never told about: the architect certified completion before work was allowed to begin.
    assert.deepEqual(setFieldValues(p, { set: OCCUPANCY }, { completion_certificate_on: '2026-06-01' }, LEAD).rejected, []);
    const offered = proposeFieldValues(p, [{ address: at('commencement_on'), value: '2026-08-01', origin: { kind: 'paper', evidenceId: paper.id, page: 1, quote: 'Commencement certificate issued on 1 August 2026', reader: 'parser' } }], 'parser');
    assert.deepEqual(offered.map((held) => held.outcome), ['waiting']);
    assert.equal(sweepRuleFindings(p, day('2026-10-12')).filter(mine).length, 0, 'a date that waits on a person breaks no rule');

    decideField(p, at('commencement_on'), 'accept', LEAD);
    const [matter] = sweepRuleFindings(p, day('2026-10-12')).filter(mine);
    assert.ok(matter, 'once it stands, the review raises it');
    assert.deepEqual([matter!.kind, matter!.by, matter!.department], ['date_impossible', 'rule', 'legal']);
    assert.equal(sweepSaid(matter!).line, 'Commencement and occupancy: Commencement certificate on (2026-08-01) is after Architect’s completion certificate on (2026-06-01), by 61 days.');
    assert.deepEqual(matter!.sources.map((source) => source.evidenceId), [paper.id]);
  });

  it('finds an approval work depends on that is missing or lapsed, and not one that is merely due', () => {
    const p = built();
    const missing = sweepRuleFindings(p, day('2026-10-12')).filter((held) => held.kind === 'approval_missing');
    assert.deepEqual(missing.map((held) => [sweepSaid(held).line, held.next]), [
      ['Building plan sanction: not on file, and work depends on it.', 'request_paper'],
      ['Commencement certificate: not on file, and work depends on it.', 'request_paper'],
    ]);
    assert.deepEqual(missing[0]!.sources.map((source) => source.kind), ['approval', 'site_log']);
    const plan = addEvidence(p, { title: 'Sanctioned plan', kind: 'document', status: 'received' }, LEAD);
    plan.documentType = 'Sanctioned building plan';
    plan.facts = [value('sanction_date', '2023-01-10', '10 January 2023', 1), value('valid_until', '2025-01-09', '9 January 2025', 1)];
    const lapsed = sweepRuleFindings(p, day('2026-10-12')).find((held) => held.kind === 'approval_missing' && held.left === 'Building plan sanction')!;
    assert.deepEqual([sweepSaid(lapsed).line, lapsed.next, sweepSaid(lapsed).next], ['Building plan sanction: expired, and work depends on it.', 'renew_approval', 'Renew the approval']);
    // No work logged and nothing under way: the register's own alert is all there is.
    p.siteLog = [];
    p.milestones![0]!.percent = 0;
    assert.equal(sweepRuleFindings(p, day('2026-10-12')).filter((held) => held.kind === 'approval_missing').length, 0);
  });

  it('finds an open action nobody is named for, and not one somebody is', () => {
    const p = built();
    const found = sweepRuleFindings(p, day('2026-10-12')).filter((held) => held.kind === 'action_unowned');
    assert.deepEqual(found.map((held) => [sweepSaid(held).line, held.next, held.severity, held.as]), [['Get the revised structural drawings stamped: nobody is named for it.', 'assign_owner', 'low', 'risk']]);
    assert.equal(found[0]!.sources[0]!.ref, p.actions[0]!.id);
  });
});

describe('what a model answers', () => {
  it('is read for a kind and marks only: every sentence beside them is thrown away', () => {
    const p = built();
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const { kept, dropped } = sweepNominationsHeld(p, brief, answered(brief));
    assert.deepEqual(kept.map((proposal) => proposal.kind), ['cost_unexplained']);
    // A kind that is a rule's, a mark not in the brief, another rule's kind, no line at all, and a kind not asked for.
    assert.equal(dropped, 5);
    const [cost] = kept;
    assert.deepEqual(Object.keys(cost!).sort(), ['as', 'by', 'department', 'difference', 'kind', 'left', 'next', 'severity', 'sources', 'unit']);
    // What the model wrote is nowhere in what is kept; the line is worked out from the package's own figures.
    for (const written of ['forecast rose with no reason', 'gives no variation, award or reason', 'Ask the cost consultant']) assert.ok(!JSON.stringify(cost).includes(written), written);
    assert.deepEqual([cost!.left, cost!.difference, cost!.unit, cost!.by], ['A Structure', 250, 'INR', 'model']);
    // Severity, what it makes and the next step are the table's, whatever the model said of them.
    assert.deepEqual([cost!.severity, cost!.as, cost!.next, cost!.department], ['medium', 'finding', 'record_reason', 'finance']);
    assert.match(sweepSaid(cost!).line, /^A Structure: \+.*250 that no variation, award or reason accounts for\.$/);
    assert.equal(cost!.sources[0]!.ref, `${p.costReports!.at(-1)!.id}:${p.cost!.workPackages[0]!.id}`);
  });

  it('is dropped where it cites no line of a kind it is about, or code cannot work out what it claims', () => {
    const p = built();
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const action = markOf(brief, 'Get the revised structural drawings stamped');
    const other = markOf(brief, 'Chase the lift supplier');
    const log = markOf(brief, 'Concrete poured to the plinth beams');
    const plinth = markOf(brief, 'Plinth: 20% done');
    const report = markOf(brief, 'Cost Report');
    const approval = sweepEntries(brief).find((entry) => entry.kind === 'approval')!.mark;
    const { kept, dropped } = sweepNominationsHeld(p, brief, [
      { kind: 'cost_unexplained', cites: [log] },
      { kind: 'schedule_cost_differ', cites: [action, other] },
      // One line where two are set against each other.
      { kind: 'schedule_cost_differ', cites: [report] },
      // The plinth's line carries no unexplained amount.
      { kind: 'cost_unexplained', cites: [plinth] },
      { kind: 'approval_missing', cites: [approval, log] },
      { kind: 'schedule_cost_differ', cites: [`[${report}]`, plinth] },
    ]);
    assert.equal(dropped, 5);
    assert.deepEqual(kept.map((proposal) => [proposal.kind, proposal.sources.map((source) => source.kind).sort()]), [['schedule_cost_differ', ['cost', 'milestone']]]);
    // 700 of 1,750 forecast is paid, and the plinth is 20% done.
    assert.deepEqual([kept[0]!.left, kept[0]!.right, kept[0]!.difference, kept[0]!.unit], ['Cost Report August 2026', 'Plinth', 20, 'points']);
    assert.equal(sweepSaid(kept[0]!).line, 'Cost Report August 2026 against Plinth: money paid and work done are 20 points apart.');
  });

  it('falls to a department the project uses, and is nothing when it is no list', () => {
    const p = built();
    p.departments = ['construction'];
    const brief = sweepBrief(p, { now: day('2026-10-12') });
    const [kept] = sweepNominationsHeld(p, brief, [answered(brief)[0]]).kept;
    assert.equal(kept!.department, 'construction');
    assert.deepEqual(sweepNominationsHeld(p, brief, 'nothing wrong'), { kept: [], dropped: 0 });
  });
});

describe('a suggestion kept before suggestions were fields', () => {
  const before: SweepSuggestion = {
    id: 'swp_before',
    kind: 'cost_unexplained',
    statement: 'The structure’s forecast rose with no reason recorded.',
    why: 'The package moved and the report gives no variation.',
    action: 'Ask the cost consultant for the reason.',
    department: 'finance',
    severity: 'high',
    as: 'finding',
    sources: [{ ref: 'cr_1:wp_1', kind: 'cost', says: 'A Structure: forecast 1,000 to 1,250' }],
    fingerprint: 'cost_unexplained:x',
    raisedAt: '2026-10-01T01:30:00.000Z',
    status: 'open',
  };

  it('still opens, reads as it was written, and is marked as a model’s', () => {
    const state = sweepStateOf({ v: 1, suggestions: [before] });
    assert.deepEqual(state.suggestions, [before]);
    assert.deepEqual(sweepSaid(state.suggestions[0]!), { line: before.statement, why: before.why, next: before.action, byModelBefore: true });
  });

  it('is the same matter as one raised now about the same line, so it is not raised twice', () => {
    const state = sweepStateOf({ v: 1, suggestions: [before] });
    const now = { kind: 'cost_unexplained' as const, by: 'model' as const, left: 'A Structure', difference: 250, unit: 'INR', department: 'finance' as const, severity: 'medium' as const, as: 'finding' as const, next: 'record_reason' as const, sources: before.sources };
    assert.deepEqual(sweepRaise(state, [now], '2026-10-13T01:30:00.000Z').repeats, 1);
    assert.equal(sweepSaid(now).byModelBefore, false);
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
    // Four by rule (the survey number, two approvals, the action on nobody) and the one the model named.
    assert.deepEqual({ projects: run.projects, due: run.due, swept: run.swept, byRule: run.byRule, raised: run.raised, dropped: run.dropped, failed: run.failed, noModel: run.noModel }, { projects: 1, due: 1, swept: 1, byRule: 4, raised: 5, dropped: 5, failed: 0, noModel: 0 });
    assert.equal(JSON.stringify(p), was);
    const state = states.get(p.id)!;
    assert.equal(state.sweptThrough, p.updatedAt);
    assert.equal(state.tokens, 7000);
    const [first] = openSweepSuggestions(state);
    assert.equal(first!.status, 'open');
    assert.ok(first!.sources.length > 0 && first!.department && first!.next && first!.by);
    assert.equal(first!.fingerprint, sweepFingerprint(first!.kind, first!.sources.map((s) => s.ref)));
    // Nothing a model wrote is stored: no suggestion has a sentence of its own, and none of the model's words is in the file.
    for (const held of state.suggestions) assert.deepEqual([held.statement, held.why, held.action], [undefined, undefined, undefined]);
    const stored = stringsOf(state).join('\n');
    for (const written of ['forecast rose with no reason', 'is on nobody', 'Name somebody for it', 'Ask the cost consultant', 'lapsed last year']) assert.ok(!stored.includes(written), written);
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
    assert.equal((await cron.fileSweep(day('2026-10-12'), cronSource)).raised, 5);
    // The record moves, so the project is due again, and the model says the same things in other words.
    addAction(p, { title: 'Order the rebar', kind: 'clarification', owner: 'Anika Rao', priority: 'low' }, LEAD);
    wording = 'Package A went up by 250 and nobody wrote down why.';
    const next = await cron.fileSweep(day('2026-10-13'), cronSource);
    assert.deepEqual({ swept: next.swept, raised: next.raised, repeats: next.repeats }, { swept: 1, raised: 0, repeats: 5 });
    assert.equal(states.get(p.id)!.suggestions.length, 5);
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
      assert.deepEqual({ swept: run.swept, raised: run.raised, repeats: run.repeats }, { swept: 1, raised: 0, repeats: 5 }, on);
    }
    const kept = states.get(p.id)!;
    assert.deepEqual(kept.suggestions.map((s) => s.status).sort(), ['accepted', 'dismissed', 'open', 'open', 'open']);
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
    const next = await cron.fileSweep(day('2026-10-13'), first.cronSource);
    assert.equal(first.states.get(p.id)!.suggestions[0]!.status, 'dismissed');
    // And the action added since, on nobody, is raised by rule beside it.
    assert.equal(next.byRule, 1);
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
    // What the rules found is kept all the same, once, and the project stays due for a model.
    assert.deepEqual([runs.map((run) => run.byRule), states.get(p.id)!.suggestions.length, states.get(p.id)!.sweptAt], [[4, 0, 0, 0], 4, undefined]);
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

  it('runs the rules with no model set up, asks nothing, and says so', async () => {
    const p = built();
    const { cronSource, asked, states } = source([p], { model: false });
    const run = await cron.fileSweep(day('2026-10-12'), cronSource);
    assert.deepEqual(run, { projects: 1, due: 1, swept: 1, byRule: 4, raised: 4, dropped: 0, repeats: 0, overCeiling: 0, deferred: 0, failed: 0, tokens: 0, noModel: 1 });
    assert.deepEqual(asked, []);
    assert.deepEqual(states.get(p.id)!.suggestions.map((held) => held.by), ['rule', 'rule', 'rule', 'rule']);
    assert.equal(states.get(p.id)!.tokens, undefined);
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
    // The record's words are the template's line and the kind's reason; the model's sentence was never kept.
    assert.match(finding.title, /^A Structure: \+.*250 that no variation, award or reason accounts for\.$/);
    assert.match(finding.description, /^The forecast moved and the cost report gives no variation, award or typed reason for it\./);
    assert.equal(finding.severity, 'medium');
    assert.equal(finding.status, 'open');
    assert.equal(finding.discipline, 'cost_quantity');
    assert.match(finding.description, /Rests on: A Structure: forecast/);
    assert.equal(finding.confidenceNote, `Suggested by the daily review on 2026-10-12, accepted by ${LEAD} on 2026-10-12.`);
    assert.equal(finding.mitigation, 'Record the reason');
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
    assert.equal(risk.title, 'Get the revised structural drawings stamped: nobody is named for it.');
    assert.equal(risk.materiality, 'low');
    assert.equal(risk.mitigation, 'Name who it is on');
    assert.equal(p.findings.length, 0);
  });

  it('dismissed, needs a reason and leaves the project as it was', async () => {
    const { p, state, cost } = await raised();
    const was = JSON.stringify(p);
    assert.throws(() => dismissSweepSuggestion(state, cost.id, { actor: LEAD, reason: ' ' }), /Say why/);
    dismissSweepSuggestion(state, cost.id, { actor: LEAD, reason: 'Minuted in August.' });
    assert.equal(JSON.stringify(p), was);
    assert.equal(openSweepSuggestions(state).length, 4);
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
    const about = (kind: 'cost_unexplained' | 'action_unowned', ...refs: string[]) => ({ kind, department: 'finance' as const, severity: 'low' as const, as: 'finding' as const, sources: refs.map((ref) => ({ ref, kind: 'cost' as const, says: ref })) });
    assert.equal(sweepRaise(state, [about('cost_unexplained', 'a', 'b')], '2026-10-12T01:30:00.000Z').raised.length, 1);
    const next = sweepRaise(state, [about('cost_unexplained', 'b', 'a'), about('cost_unexplained', 'a'), about('cost_unexplained', 'a', 'b', 'c'), about('action_unowned', 'a', 'b'), about('cost_unexplained', 'c', 'd')], '2026-10-13T01:30:00.000Z');
    assert.deepEqual([next.repeats, next.raised.map((s) => s.kind)], [3, ['action_unowned', 'cost_unexplained']]);
    assert.equal(sweepFingerprint('cost_unexplained', ['b', 'a']), sweepFingerprint('cost_unexplained', ['a', 'b', 'a']));
  });

  it('silences, for a dismissed matter, only a proposal about the very same entries, whatever kind it is called', () => {
    const state = sweepStateOf(undefined);
    const about = (kind: 'approval_missing' | 'date_impossible', ...refs: string[]) => ({ kind, department: 'legal' as const, severity: 'low' as const, as: 'finding' as const, sources: refs.map((ref) => ({ ref, kind: 'approval' as const, says: ref })) });
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
