/**
 * The numbers that say where to look: across projects, by department inside
 * one, and by person. Each is read from a project built here with data and
 * from an empty one, the thirty days are held to at both edges, and who may
 * read a person's figures is asked of every role.
 *
 * Every firm, person, project, party and paper is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYTICS_WINDOW_DAYS,
  acrossProjects,
  addAction,
  addChecklistItems,
  addDecision,
  addEvidence,
  addMilestones,
  addRequest,
  addWorkPackages,
  costReportOf,
  createProject,
  departmentAnalytics,
  inAnalyticsWindow,
  issueCostReport,
  peopleAnalytics,
  personAnalytics,
  readsAnalytics,
  readsPersonFigures,
  setTeamMember,
  startCostReport,
  syncAlerts,
  updateCostReportRow,
  type AnalyticsMember,
  type ChatProposal,
  type DdProject,
  type DepartmentKey,
  type DepartmentRole,
} from '@realytica/shared';

const WHO = 'lead@firm.example';
const NOW = new Date('2026-10-12T06:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number, ms = 0): string => new Date(NOW.getTime() - days * DAY - ms).toISOString();

let serial = 0;
function project(name: string, over: Partial<Pick<DdProject, 'currency'>> = {}): DdProject {
  serial += 1;
  const p = createProject({ name, type: 'residential', location: 'Ward 4', city: 'Kadamba', currentStage: 'construction' }, `RYT-AN${serial}`, WHO);
  Object.assign(p, over);
  return p;
}

/** A project with a Cost Report issued for each month given: one package budgeted at 1,000 and forecast as said. */
function withReports(name: string, forecasts: Array<[month: string, forecast: number]>, over: Partial<Pick<DdProject, 'currency'>> = {}): DdProject {
  const p = project(name, over);
  addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }], WHO);
  for (const [month, forecast] of forecasts) {
    const report = startCostReport(p, { month }, WHO);
    updateCostReportRow(p, report.id, costReportOf(p, report.id).rows[0]!.id, { poIssued: 900, anticipatedCost: forecast }, WHO);
    issueCostReport(p, report.id, WHO);
  }
  return p;
}

function card(p: DdProject, over: Partial<ChatProposal>): ChatProposal {
  const made: ChatProposal = { id: `card-${p.chatProposals.length + 1}`, kind: 'add_finding', title: 'Record a finding', rationale: '', impact: '', status: 'proposed', payload: {}, createdAt: ago(3), createdBy: 'chat', ...over };
  p.chatProposals.push(made);
  return made;
}

/** A paper held by a function, with values read off it that wait for a person. */
function paperWaiting(p: DdProject, title: string, workstream: string, filedDaysAgo: number, values = 2) {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, WHO);
  row.workstream = workstream;
  row.attachments.push({ id: `file-${row.id}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k/${row.id}`, uploadedAt: ago(filedDaysAgo) });
  row.facts = Array.from({ length: values }, (_, i) => ({ key: `k${i}`, label: `Value ${i}`, value: i, display: String(i), page: 1, quote: 'as written', review: 'proposed' as const }));
  return row;
}

describe('across projects', () => {
  it('says nothing of no projects', () => {
    const view = acrossProjects([], NOW);
    assert.equal(view.projects, 0);
    assert.deepEqual(view.cost, { lines: [], totals: [], notIssued: { count: 0, rows: [] } });
    assert.deepEqual(view.schedule, { lines: [], extensions: { count: 0, rows: [] } });
    assert.deepEqual(view.papers, { owed: 0, parties: [] });
    assert.deepEqual(view.alerts, { open: 0, kinds: [] });
    assert.deepEqual(view.decisions, { count: 0, rows: [] });
    assert.equal(view.today, '2026-10-12');
  });

  it('says nothing of a project with nothing on it', () => {
    const view = acrossProjects([project('Empty plot')], NOW);
    assert.equal(view.projects, 1);
    assert.equal(view.cost.lines.length + view.cost.notIssued.count + view.schedule.lines.length + view.papers.owed + view.alerts.open + view.decisions.count, 0);
  });

  it('reads forecast against budget from the last report issued, with what moved since the one before', () => {
    const p = withReports('Lakeside Block', [['2026-07-01', 1000], ['2026-08-01', 1250]]);
    // A draft for September moves nothing: nobody has issued it.
    const draft = startCostReport(p, { month: '2026-09-01' }, WHO);
    updateCostReportRow(p, draft.id, costReportOf(p, draft.id).rows[0]!.id, { anticipatedCost: 9999 }, WHO);

    const [line] = acrossProjects([p], NOW).cost.lines;
    assert.equal(line!.reportLabel, 'August 2026');
    assert.equal(line!.budget, 1000);
    assert.equal(line!.forecast, 1250);
    assert.equal(line!.over, 250);
    assert.equal(line!.movement, 250);
    assert.equal(line!.previousLabel, 'July 2026');
    assert.equal(line!.overBudget.count, 1);
    assert.match(line!.overBudget.rows[0]!.source, /^Cost Report August 2026, issued /);
  });

  it('leaves the movement out where there is one report only, and adds no two currencies together', () => {
    const first = withReports('First Tower', [['2026-08-01', 900]]);
    const second = withReports('Second Tower', [['2026-07-01', 1000], ['2026-08-01', 1100]]);
    const abroad = withReports('Harbour Court', [['2026-08-01', 1500]], { currency: 'EUR' });
    const { lines, totals } = acrossProjects([first, second, abroad], NOW).cost;

    assert.equal(lines.find((l) => l.projectName === 'First Tower')!.movement, undefined);
    // Worst first: the furthest over its budget.
    assert.deepEqual(lines.map((l) => l.projectName), ['Harbour Court', 'Second Tower', 'First Tower']);
    assert.deepEqual(totals.find((t) => t.currency === 'INR'), { currency: 'INR', projects: 2, budget: 2000, forecast: 2000, over: 0, movement: 100, compared: 1 });
    assert.deepEqual(totals.find((t) => t.currency === 'EUR'), { currency: 'EUR', projects: 1, budget: 1000, forecast: 1500, over: 500, movement: 0, compared: 0 });
  });

  it('names a project that has packages and no report issued, and gives it no figures', () => {
    const p = project('Unreported Block');
    addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }], WHO);
    startCostReport(p, { month: '2026-09-01' }, WHO);
    const { cost } = acrossProjects([p], NOW);
    assert.equal(cost.lines.length, 0);
    assert.equal(cost.notIssued.count, 1);
    assert.match(cost.notIssued.rows[0]!.detail!, /1 draft/);
  });

  it('reads planned against projected completion, and flags an extension of time', () => {
    const late = project('Overrun Block');
    const [plinth] = addMilestones(late, [{ name: 'Plinth', weight: 5, plannedFinish: '2026-10-01' }], WHO);
    plinth!.percent = 40;
    const fine = project('On Time Block');
    addMilestones(fine, [{ name: 'Plinth', weight: 5, plannedFinish: '2027-03-01' }], WHO);
    const none = project('No Schedule');

    const { schedule, decisions } = acrossProjects([fine, late, none], NOW);
    assert.deepEqual(schedule.lines.map((l) => [l.projectName, l.plannedCompletion, l.extensionLikely, l.warned.count]), [
      ['Overrun Block', '2026-10-01', true, 1],
      ['On Time Block', '2027-03-01', false, 0],
    ]);
    assert.equal(schedule.extensions.count, 1);
    assert.equal(schedule.lines[0]!.warned.rows[0]!.overdue, true);
    // An extension of time is the owner's to decide, so it waits there as well.
    assert.ok(decisions.rows.some((row) => row.title === 'Extension of time likely' && row.projectName === 'Overrun Block'));
  });

  it('adds up what each party owes on every project, the one that owes most first and nobody named last', () => {
    const a = project('Block A');
    addChecklistItems(a, 'construction', [{ title: 'Column schedule', owedBy: 'Structural consultant' }, { title: 'Soil report', owedBy: 'Geotechnical consultant' }, { title: 'Site photographs' }], WHO);
    const b = project('Block B');
    addChecklistItems(b, 'construction', [{ title: 'Beam layout', owedBy: 'structural  consultant' }, { title: 'Rebar schedule', owedBy: 'Structural consultant' }], WHO);

    const { papers } = acrossProjects([a, b], NOW);
    assert.equal(papers.owed, 5);
    assert.deepEqual(papers.parties.map((p) => [p.party, p.papers.count, p.projects]), [
      ['Structural consultant', 3, 2],
      ['Geotechnical consultant', 1, 1],
      [undefined, 1, 1],
    ]);
    const row = papers.parties[0]!.papers.rows[0]!;
    assert.equal(row.source, 'the Engineering checklist');
    assert.equal(row.pane, 'department');
  });

  it('counts a paper asked for and past its date as overdue for the party it was asked of', () => {
    const p = project('Block C');
    const [line] = addChecklistItems(p, 'legal', [{ title: 'Khata extract' }], WHO).added;
    const request = addRequest(p, { title: 'Khata extract', recipient: 'Owner’s advocate', dueAt: '2026-10-01', send: true }, WHO);
    request.checklistItemIds = [line!.id];

    const party = acrossProjects([p], NOW).papers.parties.find((x) => x.party === 'Owner’s advocate')!;
    assert.equal(party.papers.count, 1);
    assert.equal(party.overdue, 1);
  });

  it('counts open alerts by what they are about, and leaves out one that has cleared', () => {
    const p = project('Alerted Block');
    const [plinth] = addMilestones(p, [{ name: 'Plinth', weight: 5, plannedFinish: '2026-10-01' }], WHO);
    plinth!.percent = 40;
    addAction(p, { title: 'Chase the fire NOC', kind: 'clarification', owner: 'asha@firm.example', priority: 'high', dueDate: '2026-10-05' }, WHO);
    syncAlerts(p, NOW);
    p.alerts!.find((a) => a.key.startsWith('eot:'))!.resolvedAt = NOW.toISOString();

    const { alerts } = acrossProjects([p], NOW);
    const by = new Map(alerts.kinds.map((k) => [k.kind, k]));
    assert.equal(by.get('late')!.alerts.count, 1);
    assert.equal(by.get('late')!.label, 'Milestones late');
    assert.equal(by.get('action')!.alerts.count, 1);
    assert.equal(by.has('eot'), false);
    assert.equal(alerts.open, alerts.kinds.reduce((n, k) => n + k.alerts.count, 0));
    assert.match(by.get('action')!.alerts.rows[0]!.source, /^an alert raised 12 Oct 2026 in /);
  });

  it('lists what waits on the owner: over budget, not awarded, and decisions not yet made', () => {
    const p = project('Decision Block');
    addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }, { code: 'B', name: 'Facade', budget: 500 }], WHO);
    const september = startCostReport(p, { month: '2026-09-01' }, WHO);
    updateCostReportRow(p, september.id, costReportOf(p, september.id).rows[0]!.id, { poIssued: 900, anticipatedCost: 1250 }, WHO);
    issueCostReport(p, september.id, WHO);
    const pending = addDecision(p, { title: 'Approve the revised facade', decisionType: 'proceed', decisionMaker: 'The owner', rationale: 'Awaiting drawings', status: 'pending' }, WHO);
    pending.createdAt = ago(9);
    addDecision(p, { title: 'Proceed with piling', decisionType: 'proceed', decisionMaker: 'The owner', rationale: 'Agreed', status: 'approved' }, WHO);

    const { rows } = acrossProjects([p], NOW).decisions;
    assert.deepEqual(rows.map((row) => row.title), ['Over budget: A Structure', 'Not awarded: B Facade', 'To be decided: Approve the revised facade']);
    assert.equal(rows[2]!.ageDays, 9);
  });
});

describe('by department, within a project', () => {
  it('lists the departments with nothing on them, and no line for what no department holds', () => {
    const view = departmentAnalytics(project('Quiet Block'), NOW);
    assert.deepEqual(view.departments.map((d) => d.label), ['Legal', 'Finance', 'Engineering', 'Commercial', 'Procurement']);
    for (const d of view.departments) {
      assert.equal(d.waiting.count + d.actionsOpen.count + d.actionsOverdue.count + d.requestsOut.count + d.requestsOverdue + d.waitingOldestDays + d.requestsOldestDays, 0, d.label);
    }
  });

  it('counts what waits for acceptance in the department that holds it, and how long the oldest has waited', () => {
    const p = project('Waiting Block');
    paperWaiting(p, 'Sale deed', 'legal.title', 12, 3);
    paperWaiting(p, 'Tax receipt', 'legal.title', 4, 1);
    card(p, { title: 'Start a technical DD', kind: 'start_dd', createdAt: ago(6) });

    const by = new Map(departmentAnalytics(p, NOW).departments.map((d) => [d.label, d]));
    const legal = by.get('Legal')!;
    assert.equal(legal.waiting.count, 4);
    assert.equal(legal.waitingOldestDays, 12);
    assert.deepEqual(legal.waiting.rows.map((row) => [row.title, row.ageDays]), [['Sale deed', 12], ['Tax receipt', 4]]);
    assert.equal(legal.waiting.rows[0]!.source, 'the paper, filed 30 Sep 2026');
    assert.equal(by.get('Finance')!.waiting.count, 0);
    // A card no function holds is given to no department.
    const none = by.get('No department')!;
    assert.equal(none.department, undefined);
    assert.equal(none.waiting.count, 1);
    assert.equal(none.waitingOldestDays, 6);
  });

  it('counts actions open and overdue, by the department of the paper each is tied to', () => {
    const p = project('Action Block');
    const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' }, WHO);
    deed.workstream = 'legal.title';
    addAction(p, { title: 'Get the mother deed', kind: 'clarification', owner: 'asha@firm.example', priority: 'high', dueDate: '2026-10-11', evidenceIds: [deed.id] }, WHO);
    addAction(p, { title: 'Confirm the survey number', kind: 'clarification', owner: 'asha@firm.example', priority: 'low', dueDate: '2026-10-12', evidenceIds: [deed.id] }, WHO);
    const closed = addAction(p, { title: 'File the receipt', kind: 'clarification', owner: 'asha@firm.example', priority: 'low', dueDate: '2026-09-01', evidenceIds: [deed.id] }, WHO);
    closed.status = 'closed';
    addAction(p, { title: 'Ring the broker', kind: 'clarification', owner: '', priority: 'low' }, WHO);

    const by = new Map(departmentAnalytics(p, NOW).departments.map((d) => [d.label, d]));
    assert.equal(by.get('Legal')!.actionsOpen.count, 2);
    // Due yesterday is overdue; due today is not.
    assert.deepEqual(by.get('Legal')!.actionsOverdue.rows.map((row) => row.title), ['Get the mother deed']);
    assert.equal(by.get('No department')!.actionsOpen.count, 1);
    assert.equal(by.get('No department')!.actionsOpen.rows[0]!.detail, 'Nobody named');
  });

  it('counts requests out and their age, and leaves out one answered or not yet sent', () => {
    const p = project('Request Block');
    const row = addEvidence(p, { title: 'Encumbrance certificate', kind: 'document', status: 'expected' }, WHO);
    row.workstream = 'legal.title';
    const out = addRequest(p, { title: 'Encumbrance certificate', recipient: 'Owner’s advocate', dueAt: '2026-10-01', evidenceId: row.id, send: true }, WHO);
    out.sentAt = ago(20);
    const [line] = addChecklistItems(p, 'finance', [{ title: 'Basic prices' }], WHO).added;
    const fresh = addRequest(p, { title: 'Basic prices', recipient: 'Quantity surveyor', send: true }, WHO);
    fresh.sentAt = ago(2);
    fresh.checklistItemIds = [line!.id];
    addRequest(p, { title: 'A draft', recipient: 'Somebody' }, WHO);
    const answered = addRequest(p, { title: 'Answered', recipient: 'Somebody', send: true }, WHO);
    answered.status = 'answered';

    const by = new Map(departmentAnalytics(p, NOW).departments.map((d) => [d.label, d]));
    assert.deepEqual([by.get('Legal')!.requestsOut.count, by.get('Legal')!.requestsOverdue, by.get('Legal')!.requestsOldestDays], [1, 1, 20]);
    assert.deepEqual([by.get('Finance')!.requestsOut.count, by.get('Finance')!.requestsOverdue, by.get('Finance')!.requestsOldestDays], [1, 0, 2]);
    assert.equal(by.has('No department'), false);
  });
});

const ASHA = { email: 'asha@firm.example', name: 'Asha Rao' };

function accepted(p: DdProject, action: string, entityId: string, at: string, actor = ASHA.email): void {
  p.audit.push({ id: `aud-${p.audit.length + 1}`, at, actor, action, entityType: action.includes('fact') ? 'evidence' : 'proposal', entityId });
}

describe('by person', () => {
  it('says nothing of somebody with nothing on them', () => {
    assert.deepEqual(personAnalytics([], ASHA, NOW), { email: ASHA.email, name: ASHA.name, projects: 0, on: { count: 0, rows: [] }, overdue: { count: 0, rows: [] }, accepted: { count: 0, rows: [] }, waited: { count: 0, rows: [] } });
    const quiet = personAnalytics([project('Quiet Block')], ASHA, NOW);
    assert.equal(quiet.on.count + quiet.overdue.count + quiet.accepted.count + quiet.waited.count, 0);
    assert.equal(quiet.medianWaitDays, undefined);
  });

  it('counts what is on them and what is overdue, and nobody else’s', () => {
    const p = project('Work Block');
    addAction(p, { title: 'Get the mother deed', kind: 'clarification', owner: 'Asha Rao', priority: 'high', dueDate: '2026-10-01' }, WHO);
    addAction(p, { title: 'Confirm the survey number', kind: 'clarification', owner: 'asha@firm.example', priority: 'low', dueDate: '2026-11-01' }, WHO);
    addAction(p, { title: 'Ring the broker', kind: 'clarification', owner: 'Asha R', priority: 'low', dueDate: '2026-10-01' }, WHO);
    addAction(p, { title: 'Somebody else’s', kind: 'clarification', owner: 'ravi@firm.example', priority: 'low', dueDate: '2026-10-01' }, WHO);

    const figures = personAnalytics([p], ASHA, NOW);
    assert.equal(figures.on.count, 2);
    assert.deepEqual(figures.overdue.rows.map((row) => row.title), ['Get the mother deed']);
    assert.match(figures.on.rows[0]!.source, /whose owner reads “Asha Rao”/);
  });

  it('keeps to thirty days: in at exactly thirty, out a millisecond before, and out when it has not happened yet', () => {
    assert.equal(ANALYTICS_WINDOW_DAYS, 30);
    assert.equal(inAnalyticsWindow(ago(30), NOW), true);
    assert.equal(inAnalyticsWindow(ago(30, 1), NOW), false);
    assert.equal(inAnalyticsWindow(NOW.toISOString(), NOW), true);
    assert.equal(inAnalyticsWindow(new Date(NOW.getTime() + 1).toISOString(), NOW), false);
    assert.equal(inAnalyticsWindow(undefined, NOW), false);
    assert.equal(inAnalyticsWindow('not a day', NOW), false);

    const p = project('Window Block');
    const edge = card(p, { title: 'At the edge', status: 'committed', createdAt: ago(40) });
    const before = card(p, { title: 'Just before', status: 'committed', createdAt: ago(40) });
    const ahead = card(p, { title: 'Not yet', status: 'committed', createdAt: ago(1) });
    const today = card(p, { title: 'Today', status: 'committed', createdAt: ago(2) });
    accepted(p, 'accept_proposal', edge.id, ago(30));
    accepted(p, 'accept_proposal', before.id, ago(30, 1));
    accepted(p, 'accept_proposal', ahead.id, new Date(NOW.getTime() + 1).toISOString());
    accepted(p, 'accept_proposal', today.id, NOW.toISOString());

    const figures = personAnalytics([p], ASHA, NOW);
    assert.deepEqual(figures.accepted.rows.map((row) => row.title), ['Today', 'At the edge']);
    // Ten days and two days: the median of two is half way between.
    assert.deepEqual(figures.waited.rows.map((row) => [row.title, row.ageDays]), [['Today', 2], ['At the edge', 10]]);
    assert.equal(figures.medianWaitDays, 6);
  });

  it('counts the values accepted on one paper in one go as one thing, waited from when its file was put on it', () => {
    const p = project('Paper Block');
    const deed = paperWaiting(p, 'Sale deed', 'legal.title', 9, 3);
    deed.facts!.forEach(() => accepted(p, 'accept_fact', deed.id, ago(2)));
    accepted(p, 'accept_fact_corrected', deed.id, ago(1));
    accepted(p, 'set_aside_fact', deed.id, ago(1));
    accepted(p, 'accept_fact', deed.id, ago(1), 'ravi@firm.example');

    const figures = personAnalytics([p], ASHA, NOW);
    assert.deepEqual(figures.accepted.rows.map((row) => [row.title, row.detail]), [
      ['Sale deed', '1 value accepted, waited 8 days'],
      ['Sale deed', '3 values accepted, waited 7 days'],
    ]);
    assert.equal(figures.medianWaitDays, 7.5);
    assert.deepEqual(figures.accepted.rows[0]!.extra, { evidenceId: deed.id });
  });

  it('takes an action on them that closed in the window into the median, and one closed before it out', () => {
    const p = project('Closing Block');
    const inside = addAction(p, { title: 'Closed lately', kind: 'clarification', owner: ASHA.email, priority: 'low' }, WHO);
    Object.assign(inside, { status: 'closed', createdAt: ago(14), closedAt: ago(4) });
    const outside = addAction(p, { title: 'Closed long ago', kind: 'clarification', owner: ASHA.email, priority: 'low' }, WHO);
    Object.assign(outside, { status: 'closed', createdAt: ago(90), closedAt: ago(31) });
    const theirs = addAction(p, { title: 'Not hers', kind: 'clarification', owner: 'ravi@firm.example', priority: 'low' }, WHO);
    Object.assign(theirs, { status: 'closed', createdAt: ago(20), closedAt: ago(1) });

    const figures = personAnalytics([p], ASHA, NOW);
    assert.deepEqual(figures.waited.rows.map((row) => [row.title, row.ageDays, row.source]), [['Closed lately', 10, 'the action register: closed 8 Oct 2026']]);
    assert.equal(figures.medianWaitDays, 10);
    assert.equal(figures.accepted.count, 0);
  });
});

describe('who may read', () => {
  const everywhere = (role: DepartmentRole): Partial<Record<DepartmentKey, DepartmentRole>> => ({ legal: role, finance: role, design: role, construction: role, procurement: role, commercial: role });
  const owner = { email: 'dev@firm.example', role: 'owner' as const };
  const manager = { email: 'mira@firm.example', role: 'manager' as const };
  const staff = { email: ASHA.email, role: 'staff' as const };
  const colleague = { email: 'ravi@firm.example', role: 'staff' as const };
  const viewer = { email: 'vera@firm.example', role: 'viewer' as const };
  const outside = { email: 'sam@site.example', role: 'collaborator' as const };

  it('gives somebody working from a grant none of it', () => {
    assert.equal(readsAnalytics('collaborator'), false);
    for (const role of ['owner', 'manager', 'staff', 'viewer'] as const) assert.equal(readsAnalytics(role), true, role);
  });

  it('lets a person read their own figures, and a viewer nobody’s, their own included', () => {
    const p = project('Rule Block');
    assert.equal(readsPersonFigures(staff, staff, p), true);
    assert.equal(readsPersonFigures(viewer, viewer, p), false);
    assert.equal(readsPersonFigures(viewer, staff, p), false);
    assert.equal(readsPersonFigures(outside, outside, p), false);
    assert.equal(readsPersonFigures(outside, staff, p), false);
  });

  it('lets only somebody who leads a department on the project read a colleague’s figures from it', () => {
    const p = project('Led Block');
    assert.equal(readsPersonFigures(owner, staff, p), true);
    assert.equal(readsPersonFigures(manager, staff, p), true);
    assert.equal(readsPersonFigures(colleague, staff, p), false);

    // The team list makes one of the staff a lead in Finance here, and here only.
    setTeamMember(p, { email: colleague.email, departments: { finance: 'lead' } }, WHO);
    assert.equal(readsPersonFigures(colleague, staff, p), true);
    assert.equal(readsPersonFigures(colleague, staff, project('Another Block')), false);
    // A signer decides and does not lead.
    setTeamMember(p, { email: colleague.email, departments: { finance: 'signer' }, signer: { profession: 'Chartered Accountant', registration: 'CA-000000' } }, WHO);
    assert.equal(readsPersonFigures(colleague, staff, p), false);

    // And it holds a manager back where it gives them no department to lead.
    setTeamMember(p, { email: manager.email, departments: everywhere('contributor') }, WHO);
    assert.equal(readsPersonFigures(manager, staff, p), false);
    assert.equal(readsPersonFigures(manager, manager, p), true);
  });

  it('keeps no figures about somebody from outside the firm, whoever asks', () => {
    assert.equal(readsPersonFigures(owner, outside, project('Outside Block')), false);
  });

  it('hands each reader the people they may read, by name, and the projects they may read them on', () => {
    const led = project('Led Block');
    addAction(led, { title: 'On the led project', kind: 'clarification', owner: ASHA.email, priority: 'low' }, WHO);
    addAction(led, { title: 'A contractor’s', kind: 'clarification', owner: outside.email, priority: 'low' }, WHO);
    setTeamMember(led, { email: colleague.email, departments: { finance: 'lead' } }, WHO);
    const other = project('Other Block');
    addAction(other, { title: 'On the other project', kind: 'clarification', owner: ASHA.email, priority: 'low' }, WHO);
    const members: AnalyticsMember[] = [{ ...colleague, name: 'Ravi Nair' }, { ...staff, name: ASHA.name }, { ...owner, name: 'Dev Menon' }, viewer, outside];

    const forOwner = peopleAnalytics([led, other], members, owner, NOW);
    assert.deepEqual(forOwner.map((person) => person.email), [staff.email, owner.email, colleague.email, viewer.email]);
    assert.deepEqual([forOwner[0]!.projects, forOwner[0]!.on.count], [2, 2]);

    const forStaff = peopleAnalytics([led, other], members, staff, NOW);
    assert.deepEqual(forStaff.map((person) => [person.email, person.on.count]), [[staff.email, 2]]);

    // A lead on one project reads a colleague from that project alone, and themselves from every one.
    const forLead = peopleAnalytics([led, other], members, colleague, NOW);
    const asha = forLead.find((person) => person.email === staff.email)!;
    assert.deepEqual([asha.projects, asha.on.rows.map((row) => row.title)], [1, ['On the led project']]);
    assert.equal(forLead.find((person) => person.email === colleague.email)!.projects, 2);
    assert.equal(forLead.some((person) => person.email === outside.email), false);

    assert.deepEqual(peopleAnalytics([led, other], members, viewer, NOW), []);
    assert.deepEqual(peopleAnalytics([led, other], members, outside, NOW), []);
    // With no project at all a person still reads their own line.
    assert.deepEqual(peopleAnalytics([], members, staff, NOW).map((person) => person.email), [staff.email]);
  });
});
