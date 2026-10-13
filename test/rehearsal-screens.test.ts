/**
 * What a rehearsal on a firm's own papers found wrong with the screens, each
 * held here.
 *
 * One way to write money and one way to write a day, with a check over the
 * web app's source that fails on an amount or a date written without the
 * formatter. A column of money in one unit. No key printed as text on
 * Overview. A record added and closed blank leaves nothing behind. An owner
 * pack that is a page or two: a source said once a section, nobody's address
 * printed, and the detail behind "more". The project's parties by role, read
 * from the copy in hand.
 *
 * Every project, party, package and figure is invented.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  OVERLAY_STANDING_LABEL,
  OWNER_PACK_LINES_SHOWN,
  PARTY_GROUPS,
  addChecklistItems,
  addFieldRecord,
  addMilestones,
  addWorkPackages,
  approvalsRegister,
  compareProjectGis,
  compareProjectPlanning,
  costReportOf,
  createProject,
  departmentAnalytics,
  formatMoney,
  formatMoneyIn,
  issueCostReport,
  moneySaid,
  moneyUnitFor,
  ownerPack,
  ownerPackPeriod,
  packageAwaitsNoAward,
  partiesByRole,
  personSaid,
  progressSummary,
  projectBrief,
  projectView,
  raiseChecklistRequests,
  removeFieldRecord,
  setMilestonePercent,
  setTeamMember,
  startCostReport,
  updateCostReportRow,
  type DdProject,
  type OwnerPack,
  type ProjectGrant,
} from '@realytica/shared';
import { amount, date, dayTime, moneyColumn, monthYear, person } from '../apps/web/src/lib/format';

const LEAD = 'pm@example.com';
const NOW = new Date('2026-10-12T06:00:00.000Z');
const WEB = path.resolve(import.meta.dirname, '../apps/web/src');

function project(reference = 'RYT-RH1'): DdProject {
  return createProject({ name: 'Hillview Residences', type: 'residential', location: 'Hillview Road', city: 'Mysuru', currentStage: 'construction' }, reference, LEAD);
}

/** Every source file of the web app, with its text. */
function webSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const at = path.join(dir, name);
      if (statSync(at).isDirectory()) walk(at);
      else if (/\.tsx?$/.test(name)) out.push({ file: path.relative(WEB, at), text: readFileSync(at, 'utf8') });
    }
  };
  walk(WEB);
  return out;
}

describe('one way to write money', () => {
  it('writes an amount in words the same way wherever it is said: to two places of a lakh or a crore', () => {
    // The three ways one column was written in: to the rupee, to four places of a crore, to two of a lakh.
    assert.deepEqual([43_875_000, 1_047_000, 12_345_678].map((n) => moneySaid(n)), ['₹4.39 Cr', '₹10.47 lakh', '₹1.23 Cr']);
    for (const n of [43_875_000, 1_047_000, 12_345_678, 95_000, 0]) {
      assert.equal(moneySaid(n), formatMoney(n, 'INR'), 'the cost register and a field say an amount alike');
      assert.equal(amount(n), formatMoney(n, 'INR'), 'and so does a page');
    }
  });

  it('writes a column in one unit, chosen for the column, with the figure in full for the cell’s title', () => {
    const ledger = [43_875_000, 1_047_000, 250_000_000, 0, 295_922_000];
    assert.equal(moneyUnitFor(ledger), 'crore');
    const column = moneyColumn(ledger, 'INR');
    assert.deepEqual(ledger.map((n) => column.cell(n).text), ['₹4.39 Cr', '₹0.10 Cr', '₹25.00 Cr', '₹0.00 Cr', '₹29.59 Cr']);
    assert.equal(column.cell(1_047_000).title, '₹10,47,000');
    assert.ok(ledger.every((n) => column.cell(n).text.endsWith(' Cr')), 'no row of it is in another unit');
    // A column that a crore would flatten to nothing is written in lakh; one of small sums, to the rupee.
    assert.equal(moneyUnitFor([43_875_000, 18_000]), 'lakh');
    assert.deepEqual([43_875_000, 18_000].map((n) => formatMoneyIn(n, 'lakh')), ['₹438.75 lakh', '₹0.18 lakh']);
    assert.equal(moneyUnitFor([95_000, 1_200]), 'rupees');
    assert.equal(formatMoneyIn(95_000, 'rupees'), '₹95,000');
    assert.equal(formatMoneyIn(-1_250_000, 'lakh'), '−₹12.50 lakh');
    assert.equal(column.cell(undefined).text, '—');
  });

  it('writes a day one way, a month and a moment from it, and never a machine’s address for a person', () => {
    assert.equal(date('2026-10-13'), '13 Oct 2026');
    assert.equal(monthYear('2026-10-13'), 'Oct 2026');
    assert.equal(dayTime('2026-10-13T08:35:00.000Z'), '13 Oct 2026, 14:05');
    assert.equal(person('operator@localhost'), 'you');
    assert.equal(personSaid(undefined, 'operator@localhost'), 'you');
    const p = project();
    setTeamMember(p, { email: 'a.rao@firm.example', name: 'A. Rao', departments: { finance: 'lead' } }, LEAD);
    assert.equal(personSaid(p, 'a.rao@firm.example'), 'A. Rao');
  });
});

describe('no amount or date reaches a screen without the formatter', () => {
  /** The files that are the formatter, and where it lives. */
  const FORMATTER = new Set(['lib/format.ts']);
  const RULES: Array<{ what: string; test: RegExp }> = [
    { what: 'a currency sign put before a figure by hand', test: /(?:₹|€|\bRs\.?\s?|\bINR\s)\$?\{/ },
    { what: 'a currency built with Intl', test: /style:\s*'currency'/ },
    { what: 'a date formatted by the browser', test: /toLocaleDateString\(|toLocaleTimeString\(|Intl\.DateTimeFormat\(/ },
    { what: 'a moment formatted by the browser', test: /toLocaleString\([^)]*(?:dateStyle|timeStyle|month:|weekday:|hour:)/ },
    { what: 'a raw day printed as it is stored', test: /[>}"' ]\{\s*[A-Za-z_.?!]+\.(?:[A-Za-z]*(?:On|At|Date)|date|plannedFinish|plannedStart|validUntil|dueDate)\s*\}/ },
  ];
  /** A line that looks like one and is not: an attribute that takes the stored day, or a count whose name ends like a date's. */
  const NOT_PRINTED = /(?:key|value|dateTime|title|min|max|defaultValue|when|from|to|day|date|at|on|since|until)=\{|\.waitingOn\b/;

  it('holds over every source file of the web app', () => {
    const found: string[] = [];
    for (const { file, text } of webSources()) {
      if (FORMATTER.has(file)) continue;
      text.split('\n').forEach((line, at) => {
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
        for (const rule of RULES) {
          if (!rule.test.test(line)) continue;
          if (rule.what.startsWith('a raw day') && NOT_PRINTED.test(line)) continue;
          found.push(`${file}:${at + 1}: ${rule.what}`);
        }
      });
    }
    assert.deepEqual(found, [], 'write it with money, amount, moneyColumn, date, dayTime or monthYear from lib/format, or daySaid');
  });

  it('would catch each of the ways it was done before', () => {
    const caught = (line: string): boolean => RULES.some((rule) => rule.test.test(line) && !(rule.what.startsWith('a raw day') && NOT_PRINTED.test(line)));
    for (const line of [
      'return `₹${Math.round(n).toLocaleString("en-IN")}`;',
      '              ₹{brief.guidance.perUnit.toLocaleString()} per sq ft',
      "new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })",
      "const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });",
      "{new Date(c.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}",
      "return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });",
      '<span className="font-mono">due {e.dueDate}</span>',
      '{money(p.amount, project.currency)} on {p.paidOn}',
    ]) {
      assert.ok(caught(line), line);
    }
    for (const line of ['<li key={entry.date}>', '<Badge tone="neutral">{project.waitingOn} waiting</Badge>', '{daySaid(e.dueDate)}', '<time dateTime={row.issuedAt}>{date(row.issuedAt)}</time>']) {
      assert.ok(!caught(line), line);
    }
  });
});

describe('Overview prints words, never a key', () => {
  /** A word of two parts joined by an underscore, as a key is written. */
  const KEY = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

  it('says nothing that reads as a snake_case key, on a project of the rehearsal’s shape', () => {
    const p = project('RYT-RH2');
    addMilestones(p, [{ name: 'Superstructure', weight: 30, plannedFinish: '2026-10-19' }, { name: 'Handover', weight: 5, plannedFinish: '2028-03-15' }], LEAD);
    addWorkPackages(p, [{ name: 'Civil works', budget: 43_875_000 }], LEAD);
    const told: string[] = [
      ...projectBrief(p, NOW).flatMap((line) => [line.label, line.quiet, ...line.parts.map((part) => part.text)]),
      ...compareProjectGis(p, {}).hits.flatMap((hit) => [hit.text, OVERLAY_STANDING_LABEL[hit.standing]]),
      ...compareProjectPlanning(p).flags.map((flag) => flag.text),
      compareProjectPlanning(p).noPlan ?? '',
      ...departmentAnalytics(p, NOW).departments.map((department) => department.label),
      ...approvalsRegister(p, NOW).flatMap((line) => [line.kind.label, line.say]),
      String(progressSummary(p, NOW).percent),
    ];
    for (const text of told) assert.doesNotMatch(text, KEY, text);
  });

  it('draws no key as text in the files Overview is made of', () => {
    const files = ['pages/projects/Overview.tsx', 'components/GisOverlayCard.tsx', 'components/project/ProjectBrief.tsx', 'components/project/ProjectPanels.tsx', 'components/analytics/DepartmentFigures.tsx', 'components/departments/ApprovalsNotRecorded.tsx', 'components/departments/DepartmentsControl.tsx'];
    // A member that holds a key, printed bare between tags: `{hit.standing}`, `{line.status}`.
    const BARE = /[>}]\s*\{\s*[A-Za-z_.?!]+\.(?:status|standing|kind|code|key|state|severity|level|stage|result|priority)\s*\}/;
    const found: string[] = [];
    for (const file of files) {
      readFileSync(path.join(WEB, file), 'utf8')
        .split('\n')
        .forEach((line, at) => {
          if (BARE.test(line) || /^\s*\{\s*[A-Za-z_.?!]+\.(?:status|standing|kind|code|state|severity|level)\s*\}\s*$/.test(line)) found.push(`${file}:${at + 1}: ${line.trim()}`);
        });
    }
    assert.deepEqual(found, []);
    // The "By department" card is drawn once.
    assert.equal(readFileSync(path.join(WEB, 'pages/projects/Overview.tsx'), 'utf8').split('<DepartmentFigures ').length - 1, 1);
  });
});

describe('a record added and closed with nothing entered', () => {
  it('leaves nothing behind, and one that holds a value is kept as before', () => {
    const p = project('RYT-RH3');
    setTeamMember(p, { email: 'junior@firm.example', departments: { finance: 'contributor' } }, LEAD);
    const edits = { mayEdit: () => true, mayDecide: () => false };
    const blank = addFieldRecord(p, 'finance.lenders.drawdowns', {}, 'junior@firm.example', edits).record!;
    assert.equal(p.fieldSheets!['finance.lenders.drawdowns']!.records!.length, 1);
    removeFieldRecord(p, 'finance.lenders.drawdowns', blank.id, 'junior@firm.example', edits);
    const drawdowns = () => p.fieldSheets!['finance.lenders.drawdowns']!.records ?? [];
    assert.equal(drawdowns().length, 0, 'gone outright: no blank on the list, none kept as taken off');
    // Somebody else's blank record, and a record that holds something, are taken off only by who may decide, and are kept.
    const other = addFieldRecord(p, 'finance.lenders.drawdowns', {}, LEAD, edits).record!;
    assert.throws(() => removeFieldRecord(p, 'finance.lenders.drawdowns', other.id, 'junior@firm.example', edits));
    const held = addFieldRecord(p, 'finance.lenders.drawdowns', { tranche: 'T1' }, 'junior@firm.example', edits).record!;
    assert.throws(() => removeFieldRecord(p, 'finance.lenders.drawdowns', held.id, 'junior@firm.example', edits));
    removeFieldRecord(p, 'finance.lenders.drawdowns', held.id, LEAD, { mayEdit: () => true, mayDecide: () => true });
    assert.ok(drawdowns().find((record) => record.id === held.id)!.removed, 'what was entered is never thrown away');
    // And whoever only reads the department takes nothing away, blank or not.
    const mine = addFieldRecord(p, 'finance.lenders.drawdowns', {}, 'reader@firm.example').record!;
    assert.throws(() => removeFieldRecord(p, 'finance.lenders.drawdowns', mine.id, 'reader@firm.example', { mayEdit: () => false, mayDecide: () => false }));
  });
});

describe('the owner pack for a month is a page or two', () => {
  /** A project of the rehearsal's shape: thirteen budget lines, eleven milestones, a hundred papers owed by five parties. */
  function busy(): DdProject {
    const p = project('RYT-RH4');
    addWorkPackages(
      p,
      [
        ['Civil works', 43_875_000],
        ['Blockwork and plaster', 9_400_000],
        ['Waterproofing', 2_100_000],
        ['Flooring', 7_800_000],
        ['Doors and windows', 6_300_000],
        ['Facade', 12_500_000],
        ['Electrical', 8_900_000],
        ['Plumbing', 5_600_000],
        ['Fire fighting', 3_200_000],
        ['Lifts', 4_800_000],
        ['Design contingency', 1_047_000],
        ['Supervision fee', 2_500_000],
        ['Consultancy fees', 3_100_000],
      ].map(([name, budget]) => ({ name: name as string, budget: budget as number })),
      LEAD,
    );
    const report = startCostReport(p, { month: '2026-09-01' }, 'operator@localhost');
    const row = (name: string) => costReportOf(p, report.id).rows.find((held) => held.name === name)!.id;
    updateCostReportRow(p, report.id, row('Civil works'), { poIssued: 42_000_000, amountPaid: 21_000_000, anticipatedCost: 45_500_000 }, LEAD);
    updateCostReportRow(p, report.id, row('Electrical'), { anticipatedCost: 9_600_000 }, LEAD);
    issueCostReport(p, report.id, 'operator@localhost');
    const names = ['Excavation', 'Foundation', 'Plinth', 'Ground floor slab', 'First floor slab', 'Second floor slab', 'Third floor slab', 'Roof slab', 'Blockwork', 'Finishes', 'Handover'];
    const made = addMilestones(p, names.map((name, at) => ({ name, weight: 10, plannedFinish: `2026-${String(Math.min(12, at + 3)).padStart(2, '0')}-20` })), LEAD);
    made.forEach((milestone, at) => {
      milestone.plannedStart = `2026-${String(Math.min(12, at + 2)).padStart(2, '0')}-01`;
      setMilestonePercent(p, milestone.id, Math.max(0, 80 - at * 9), 'site@example.com', '2026-09-01T06:00:00.000Z', '2026-09-01');
      setMilestonePercent(p, milestone.id, Math.max(0, 85 - at * 9), 'site@example.com', '2026-10-10T06:00:00.000Z', '2026-10-10');
    });
    const parties = ['MEP consultant', 'Structural consultant', 'Architect', 'Main contractor', 'Lift vendor'];
    for (const party of parties) {
      addChecklistItems(p, 'construction', Array.from({ length: 20 }, (_, at) => ({ title: `${party} paper ${at + 1}`, owedBy: party })), LEAD);
    }
    raiseChecklistRequests(p, { department: 'construction', itemIds: p.checklist!.filter((item) => item.owedBy === 'MEP consultant').map((item) => item.id), dueAt: '2026-09-20' }, LEAD);
    return p;
  }

  /** What prints: every line of a part that is not detail, without what is behind “more”, and each section’s source once. */
  const printed = (pack: OwnerPack): string[] =>
    pack.sections.flatMap((section) => [section.title, ...section.parts.filter((part) => !part.detail).flatMap((part) => [part.heading ?? '', ...(part.lines.length ? part.lines.map((line) => `${line.what} ${line.who ?? ''}`) : [part.empty]), part.note ?? '']), section.source ?? '']);
  const words = (lines: string[]): number => lines.join(' ').split(/\s+/).filter(Boolean).length;

  it('is under five hundred words before its tables, with the rest behind “more”', () => {
    const pack = ownerPack(busy(), ownerPackPeriod({ month: '2026-09' }), NOW);
    const page = printed(pack);
    assert.ok(words(page) < 500, `${words(page)} words`);
    for (const section of pack.sections) for (const part of section.parts) assert.ok(part.detail || part.lines.length <= Math.max(OWNER_PACK_LINES_SHOWN, 6), `${section.key} › ${part.heading}: ${part.lines.length} lines on the page`);
    // Nothing is dropped: what is not on the page is behind “more”.
    const papers = pack.sections.find((section) => section.key === 'papers')!;
    assert.equal(papers.parts.filter((part) => part.detail).reduce((sum, part) => sum + Number(part.heading!.split(' · ')[1]), 0), 100);
    assert.deepEqual(papers.parts[0]!.lines[0]!.what, 'MEP consultant: 20 papers owed, 20 overdue, the oldest since 20 Sep 2026.');
    const time = pack.sections.find((section) => section.key === 'time')!.parts[0]!;
    assert.equal(time.lines.length, OWNER_PACK_LINES_SHOWN, 'a few of the late milestones on the page');
    assert.ok((time.more?.length ?? 0) > 0, 'and every other one behind “more”');
  });

  it('says what a section was read from once, and prints nobody’s address', () => {
    const pack = ownerPack(busy(), ownerPackPeriod({ month: '2026-09' }), NOW);
    // A section with a line in it says once what it was read from; one that only says it has nothing was read from nothing.
    for (const section of pack.sections) if (section.parts.some((part) => part.lines.length)) assert.ok(section.source, `${section.key} says what it was read from`);
    const cost = pack.sections.find((section) => section.key === 'cost')!;
    assert.match(cost.source!, /^Cost Report September 2026, issued \d+ \w+ 2026 and the register of running bills$/);
    const all = JSON.stringify(pack);
    assert.doesNotMatch(all, /@localhost|operator@/, 'with sign-in off nobody is named, and never the machine’s address');
    assert.doesNotMatch(printed(pack).join(' '), /@/, 'nor any other address on the page');
  });

  it('asks the owner to award work, not a contingency or a fee', () => {
    const pack = ownerPack(busy(), ownerPackPeriod({ month: '2026-09' }), NOW);
    const decisions = pack.sections.find((section) => section.key === 'decisions')!;
    assert.deepEqual(decisions.parts.map((part) => part.heading), ['Over budget', 'Packages to award', 'Time']);
    const award = decisions.parts[1]!;
    assert.equal(award.lines[0]!.what, 'Not awarded: Facade, budget ₹1.25 Cr, no PO issued.', 'the most valuable first');
    assert.equal(award.lines.length, OWNER_PACK_LINES_SHOWN);
    assert.doesNotMatch(JSON.stringify(decisions), /contingency|Supervision fee|Consultancy fees/);
    for (const name of ['Design contingency', 'Supervision fee', 'Consultancy fees', 'Provisional sum for rock', 'GST @ 18%', 'Sub-total', 'Escalation allowance']) assert.equal(packageAwaitsNoAward(name), true, name);
    for (const name of ['Civil works', 'Facade', 'Lifts', 'Fire fighting', 'Feeder pillar and cabling']) assert.equal(packageAwaitsNoAward(name), false, name);
  });
});

describe('the project’s parties, by role', () => {
  function withParties(): DdProject {
    const p = project('RYT-RH5');
    const add = (name: string, roles: string[]) => assert.deepEqual(addFieldRecord(p, 'shared.parties', { name, roles }, LEAD).rejected, [], name);
    add('Hillview Estates', ['owner']);
    add('Meridian Project Managers', ['project_manager']);
    add('Studio Banyan', ['architect']);
    add('Keystone Structures', ['structural_consultant']);
    add('Volt and Flow', ['mep_consultant']);
    add('Tally Quantity Surveyors', ['cost_consultant']);
    add('Northgate Builders', ['contractor']);
    add('Anchor Piling', ['contractor']);
    add('Riverside Bank', ['lender']);
    add('Asha Menon', ['customer']);
    return p;
  }

  it('is one short list under eight headings, each always there, and whatever fits none gathered last', () => {
    const view = partiesByRole(withParties());
    assert.deepEqual(
      view.groups.map((group) => [group.label, group.parties.map((party) => party.name)]),
      [
        ['Owner', ['Hillview Estates']],
        ['Project manager', ['Meridian Project Managers']],
        ['Architect', ['Studio Banyan']],
        ['Structural consultant', ['Keystone Structures']],
        ['MEP consultant', ['Volt and Flow']],
        ['Cost consultant', ['Tally Quantity Surveyors']],
        ['Contractors', ['Anchor Piling', 'Northgate Builders']],
        ['Lender', ['Riverside Bank']],
        ['Other parties', ['Asha Menon']],
      ],
    );
    assert.deepEqual(partiesByRole(project('RYT-RH6')).groups.map((group) => [group.label, group.parties.length]), PARTY_GROUPS.map((group) => [group.label, 0]), 'a project with nobody named still shows where each is named');
  });

  it('names only a party that stands, and counts one a paper offered', () => {
    const p = withParties();
    const offered = addFieldRecord(p, 'shared.parties', { name: 'Ridge Consultants' }, LEAD).record!;
    offered.values.name = { ...offered.values.name!, state: 'proposed', proposedBy: 'parser' };
    const view = partiesByRole(p);
    assert.equal(view.offered, 1);
    assert.ok(!view.groups.some((group) => group.parties.some((party) => party.name === 'Ridge Consultants')));
  });

  it('shows an outside collaborator the parties their copy holds, and no buyer', () => {
    const p = withParties();
    const grant = { id: 'g1', tenantId: 't', projectId: p.id, email: 'architect@studio.example', role: 'contributor', scopeKeys: ['design'], areas: [], grantedBy: LEAD, grantedAt: NOW.toISOString() } as unknown as ProjectGrant;
    const copy = projectView(p, { kind: 'granted', grant, email: 'architect@studio.example' }).project;
    const held = new Set((copy.fieldSheets?.['shared.parties']?.records ?? []).map((record) => record.values.name?.value));
    const listed = partiesByRole(copy).groups.flatMap((group) => group.parties.map((party) => party.name));
    assert.deepEqual(new Set(listed), held, 'the list is the copy’s parties, no more and no fewer');
    assert.ok(!listed.includes('Asha Menon'), 'a buyer is nobody’s outside the firm');
  });
});
