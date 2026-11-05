/**
 * The four things a person running a project asks first, each in a line:
 * what needs me, what is slipping, what is owed, what changed in cost.
 *
 * Overview opens with them. Every line is read off records other pages
 * already keep, and each part of a line opens the page that holds it, so
 * nothing here is a second place to work. Papers are owed to a department:
 * a count or a party opens the Documents part of the department holding most
 * of those papers, and a request that belongs to none opens the firm's
 * Requests. It is read off the project as it was handed over: somebody
 * working from a grant gets the lines their copy can answer, and never the
 * firm's papers owed.
 */
import { chatPlaceLabel, functionRank, papersOwedOpen } from './chat-places';
import { placeCountSaid, suggestionPlaces, suggestionsOn, waitsWhereItLands } from './chat-suggestions';
import { fieldsNeeding } from './field-sheets';
import { waitingOnCanvas } from './cockpit';
import { formatMoney } from './units';
import { costReportDecisions } from './cost-report-compare';
import { costReportIssuedBefore, costReportTotals, costReportsOf } from './cost-report';
import { costPapersOf } from './cost-import';
import { daySaid } from './said';
import { scheduleWatch } from './milestone-schedule';
import { DEPARTMENT_SHORT, menuDepartment, withDepartment } from './departments';
import { PAPERS_OWED, notAskedSaid, paperPlace, papersHeldAt, papersOwed, type PaperLine, type PapersPlace } from './papers-owed';
import { projectDepartments } from './team';
import type { ChatProposalKind, DdProject } from './types';

export interface BriefPart {
  text: string;
  tone?: 'critical' | 'warning';
  open: PapersPlace;
}

export interface BriefLine {
  key: 'needs' | 'slipping' | 'owed' | 'cost';
  label: string;
  /** What it says, part by part. Empty: `quiet` is said instead. */
  parts: BriefPart[];
  /** What the line says when there is nothing to act on, and where that still opens. */
  quiet: string;
  open: PapersPlace;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const dayOf = daySaid;

const PROGRESS = { pane: 'workstream', extra: { workstream: 'construction.progress', section: 'progress' } } as const;
const BUDGET = { pane: 'workstream', extra: { workstream: 'finance.budget' } } as const;

/**
 * The replies that wait to be confirmed, each part opening the page its
 * Confirm is on: one part where they all wait in one place, otherwise one
 * for each place, named.
 */
function repliesToConfirm(lines: readonly PaperLine[]): BriefPart[] {
  const places = new Map<string, { place: PapersPlace; where: string; n: number }>();
  for (const line of lines) {
    const place = paperPlace(line);
    const where = 'firm' in place || !line.department ? 'on Requests' : `in ${DEPARTMENT_SHORT[menuDepartment(line.department)]}`;
    const key = JSON.stringify(place);
    places.set(key, { place, where, n: (places.get(key)?.n ?? 0) + 1 });
  }
  return [...places.values()].map(({ place, where, n }) => ({ text: `${plural(n, 'reply to confirm', 'replies to confirm')}${places.size > 1 ? ` ${where}` : ''}`, open: place }));
}

/** How many places Needs you names one by one. The rest are one part, opening the first of them. */
const PLACES_NAMED = 4;

/**
 * What waits to be accepted, a place at a time: "Legal › Title: 3
 * suggestions", "Findings: 1 suggestion", each opening where they sit. A
 * value on a sheet or a check waits on its field, a finding, an action, a
 * risk or a decision as a row of its register, a fact of the project record
 * beside it on Overview: none is listed here one by one. The values on
 * papers waiting to be read are one part, opening the desk. What has no
 * field or row (a valuation to run, a report to make, a stage to change) is
 * one count, opening the first of it, as before. A dispute is a part of its
 * own, opening the function that holds it.
 */
function acceptParts(project: DdProject, now: Date): BriefPart[] {
  const needing = fieldsNeeding(project, now);
  const waiting = waitingOnCanvas(project);
  const sheet = (fn: string): PapersPlace => ({ pane: 'workstream', extra: { workstream: fn, section: 'sheet' } });
  const suggestions = suggestionsOn(project);
  // A sheet's suggestions are counted as its function's page counts them, a line each (a new record a paper offered is one), with the situations a paper proposes:
  // the same count the By department card makes, so the two never disagree. A check's values, a register's rows and the record's facts are counted off their cards.
  const onSheet = (one: (typeof suggestions)[number]): boolean => one.kind === 'value' && one.id.includes('::');
  const places = suggestionPlaces(suggestions.filter((one) => !onSheet(one)));
  for (const row of needing) {
    const offered = row.counts.proposed + row.counts.situation;
    if (!offered) continue;
    const key = `fn:${row.fn}`;
    // It opens at the first field where one waits, where one does.
    const first = suggestions.find((one) => onSheet(one) && one.fn === row.fn);
    const held = places.find((place) => place.key === key);
    if (held) held.count += offered;
    else places.push({ key, label: withDepartment(row.fn, chatPlaceLabel({ fn: row.fn })), count: offered, kinds: { value: offered }, open: first?.open ?? { pane: 'workstream', extra: { workstream: row.fn, section: 'sheet' } }, ids: [] });
  }
  places.sort((a, b) => functionRank(a.key.startsWith('fn:') ? a.key.slice(3) : undefined) - functionRank(b.key.startsWith('fn:') ? b.key.slice(3) : undefined));
  const named = places.slice(0, PLACES_NAMED);
  const more = places.slice(PLACES_NAMED);
  const papers = waiting.entries.filter((entry) => entry.kind === 'facts');
  const onPapers = papers.reduce((sum, entry) => sum + entry.count, 0);
  const others = waiting.entries.filter((entry) => entry.kind !== 'facts' && !(entry.proposalId && waitsWhereItLands({ kind: entry.kind as ChatProposalKind, id: entry.proposalId }, project)));
  const otherCount = others.reduce((sum, entry) => sum + entry.count, 0);
  const at = (entry: (typeof waiting.entries)[number]): PapersPlace => ({ pane: entry.pane, ...(entry.extra ? { extra: entry.extra } : {}) });
  const disputed = needing.reduce((sum, row) => sum + row.counts.disputed, 0);
  const holds = [...needing].sort((a, b) => b.counts.disputed - a.counts.disputed)[0];
  return [
    ...named.map((place) => ({ text: placeCountSaid(place), open: place.open as PapersPlace })),
    ...(more.length ? [{ text: `${plural(more.reduce((sum, place) => sum + place.count, 0), 'suggestion')} in ${plural(more.length, 'more place')}`, open: more[0]!.open as PapersPlace }] : []),
    ...(onPapers ? [{ text: plural(onPapers, 'value on papers to read', 'values on papers to read'), open: at(papers[0]!) }] : []),
    ...(otherCount ? [{ text: `${otherCount} ${named.length || onPapers ? 'more ' : ''}to accept`, open: at(others[0]!) }] : []),
    ...(disputed && holds ? [{ text: plural(disputed, 'value in dispute', 'values in dispute'), tone: 'critical' as const, open: sheet(holds.fn) }] : []),
  ];
}

/**
 * The brief for a project on a day. `outside` is somebody working from a
 * grant: they are not shown the firm's papers owed or its replies.
 */
export function projectBrief(project: DdProject, now: Date, opts: { outside?: boolean } = {}): BriefLine[] {
  const today = now.toISOString().slice(0, 10);
  const lines: BriefLine[] = [];
  const owed = opts.outside ? undefined : papersOwed(project, { now: now.toISOString() });
  const owing = owed?.parties.flatMap((party) => party.lines) ?? [];

  // What needs a person: what waits to be accepted, replies to confirm, decisions to make, actions past their date.
  const decisions = (project.decisions ?? []).filter((decision) => decision.status === 'pending' || decision.status === 'proposed').length;
  const late = (project.actions ?? []).filter((action) => action.status !== 'closed' && (action.status === 'overdue' || Boolean(action.dueDate && action.dueDate.slice(0, 10) < today))).length;
  // Rows a cost report offered to the Cost Report, on a paper still on the file: each waits for a lead or signer of Finance.
  const costRows = costPapersOf(project)
    .filter((paper) => project.evidence.some((row) => row.id === paper.evidenceId))
    .reduce((sum, paper) => sum + paper.offers.filter((offer) => offer.status === 'offered').length, 0);
  lines.push({
    key: 'needs',
    label: 'Needs you',
    parts: [
      ...acceptParts(project, now),
      ...(costRows ? [{ text: plural(costRows, 'cost row to accept', 'cost rows to accept'), open: BUDGET }] : []),
      ...repliesToConfirm(owing.filter((line) => line.standing === 'answered')),
      ...(decisions ? [{ text: plural(decisions, 'decision to make', 'decisions to make'), open: { pane: 'decisions' as const } }] : []),
      ...(late ? [{ text: plural(late, 'action overdue', 'actions overdue'), tone: 'critical' as const, open: { pane: 'actions' as const } }] : []),
    ],
    quiet: 'Nothing waits for you.',
    open: { pane: 'actions' },
  });

  // What is slipping: milestones late, behind or finishing late at the current rate, and where completion lands.
  const watch = scheduleWatch(project, now);
  const count = (level: 'late' | 'behind' | 'slipping') => watch.milestones.filter((m) => m.level === level).length;
  const [lateM, behind, slipping] = [count('late'), count('behind'), count('slipping')];
  lines.push({
    key: 'slipping',
    label: 'Slipping',
    parts: [
      ...(lateM ? [{ text: `${lateM} late`, tone: 'critical' as const, open: PROGRESS }] : []),
      ...(behind ? [{ text: `${behind} behind`, tone: 'warning' as const, open: PROGRESS }] : []),
      ...(slipping ? [{ text: `${slipping} late at the current rate`, tone: 'warning' as const, open: PROGRESS }] : []),
      ...(watch.projectedDaysLate && watch.projectedCompletion
        ? [{ text: `completion ${dayOf(watch.projectedCompletion)}, ${plural(watch.projectedDaysLate, 'day')} after planned`, tone: 'warning' as const, open: PROGRESS }]
        : watch.extensionLikely
          ? [{ text: 'planned completion has passed', tone: 'critical' as const, open: PROGRESS }]
          : []),
    ],
    quiet: !watch.milestones.length ? 'No schedule yet. Bring it in on Progress.' : watch.plannedCompletion ? `On schedule. Planned completion ${dayOf(watch.plannedCompletion)}.` : 'Nothing is behind.',
    open: PROGRESS,
  });

  // What is owed: the papers the project waits for, and who owes the most. Each count opens the department holding most of those papers.
  if (owed) {
    // With nothing owed the line still opens somewhere a list can be read or loaded: where the papers in hand are, or the first department with a list.
    const first = projectDepartments(project).map((department) => papersOwedOpen(department)).find((place) => place.pane === 'workstream');
    const most = papersHeldAt(owing) ?? papersHeldAt(owed.inHand) ?? first ?? { pane: 'evidence' };
    const at = (lines: PaperLine[]): PapersPlace => papersHeldAt(lines) ?? most;
    // A paper is owed once somebody has been asked for it. What is on a list and asked of nobody is the list, not a debt.
    const askedFor = owing.filter((line) => line.standing !== 'not_asked');
    const named = owed.parties
      .map((party) => ({ ...party, lines: party.lines.filter((line) => line.standing !== 'not_asked') }))
      .filter((party) => party.lines.length)
      .sort((a, b) => Number(!a.party) - Number(!b.party) || b.lines.length - a.lines.length);
    const shown = named.slice(0, 3);
    lines.push({
      key: 'owed',
      label: PAPERS_OWED,
      parts: askedFor.length
        ? [
            { text: `${askedFor.length} owed`, open: at(askedFor) },
            ...(owed.overdue ? [{ text: `${owed.overdue} overdue`, tone: 'critical' as const, open: at(owing.filter((line) => line.overdue)) }] : []),
            ...shown.map((party) => ({ text: `${party.party ?? 'Nobody named'} ${party.lines.length}`, open: at(party.lines) })),
            ...(named.length > shown.length ? [{ text: `${named.length - shown.length} more`, open: at(named.slice(shown.length).flatMap((party) => party.lines)) }] : []),
          ]
        : [],
      quiet: owed.notAsked ? notAskedSaid(owed.notAsked) : owed.total ? `All ${owed.total} in hand.` : 'Nothing asked for yet. Load the list of papers on a department’s Documents.',
      open: most,
    });
  }

  // What changed in cost: the last Cost Report issued, against its budget and against the one before it.
  const issued = costReportsOf(project).filter((report) => report.status === 'issued');
  const last = issued.at(-1);
  if (last) {
    const totals = costReportTotals(last);
    const before = costReportIssuedBefore(project, last);
    const moved = before ? totals.anticipatedCost - costReportTotals(before).anticipatedCost : 0;
    const over = costReportDecisions(last).overBudget.length;
    // In lakh and crore, as every figure on a page is; the Cost Report itself keeps each figure in full.
    const money = (amount: number) => formatMoney(amount, project.currency);
    lines.push({
      key: 'cost',
      label: 'Cost',
      parts: [
        { text: `forecast ${money(totals.anticipatedCost)} against a budget of ${money(totals.budget)}`, ...(totals.anticipatedVariance > 0 ? { tone: 'warning' as const } : {}), open: BUDGET },
        ...(before ? [{ text: moved ? `${moved > 0 ? 'up' : 'down'} ${money(Math.abs(moved))} since ${before.label}` : `unchanged since ${before.label}`, ...(moved > 0 ? { tone: 'warning' as const } : {}), open: BUDGET }] : []),
        ...(over ? [{ text: plural(over, 'package over budget', 'packages over budget'), tone: 'critical' as const, open: BUDGET }] : []),
      ],
      quiet: '',
      open: BUDGET,
    });
  } else if (costReportsOf(project).length || project.cost?.workPackages.length) {
    lines.push({ key: 'cost', label: 'Cost', parts: [], quiet: 'No Cost Report issued yet. Issue one on Budget.', open: BUDGET });
  }
  return lines;
}
