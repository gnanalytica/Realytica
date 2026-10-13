/**
 * The questions a person running a project asks the chat, answered by rule.
 *
 * What is pending from a party, what changed in cost and why, what is late
 * or about to be, what needs me, what is due this period, and a figure by
 * name. Each is a shape of question with one answer builder
 * (`CHAT_QUESTIONS`), and every builder reads the function a screen reads:
 * `papersOwed`, `costReportChanges`, `scheduleWatch`, `projectBrief`,
 * `periodsDue`, `stationsDue`, `costReportTotals`. So what the chat says and
 * what the page shows are one reading, and cannot disagree.
 *
 * An answer is a card of fields (`chat-answer.ts`): rows of a label, the
 * figure as the screen says it, and the page that holds it. No sentence is
 * written here beyond the fixed lines that lead a card.
 *
 * With no model, a sentence is matched to a shape by its words
 * (`chatQuestionAsked`). With one, the model picks the shape and the party,
 * package or figure, and this file still makes the card: a model composes no
 * figure.
 *
 * Also here: the report a sentence asks to be opened, by its period
 * (`reportPlaceAsked`), what the chat says when it cannot answer
 * (`chatNotAnswered`), and what it opens with on a project that is past the
 * land (`chatOpening`).
 *
 * Pure.
 */

import type { ChatAnswerCard, ChatAnswerRow, ChatOpen } from './chat-answer';
import { chatAnswerCard } from './chat-answer';
import type { ChatPlace } from './chat-places';
import { chatPlaceLabel, menuPlaceOfWords, papersOwedOpen } from './chat-places';
import { moneySaid } from './cost';
import { costReportPeriodOrder, costReportTotals, costReportsOf, type CostReportPackageRow, type CostReportPeriod } from './cost-report';
import { costReportChanges, largestCostMovements, type CostReportChangeCause, type CostReportPackageChange } from './cost-report-compare';
import { stageOf } from './departments';
import { projectFigure } from './field-figures';
import { periodsDue } from './field-periods';
import type { FieldCatalog } from './field-registry';
import { fieldRecords } from './field-sheets';
import { fieldCatalogFor } from './firm-fields';
import { scheduleWatch, type MilestoneWatch, type ScheduleLevel } from './milestone-schedule';
import { PAPERS_OWED, PAPER_STANDING_LABEL, papersHeldAt, papersOwed, papersPlacePath, type PaperLine, type PaperStanding, type PapersPlace } from './papers-owed';
import { stationsDue } from './photo-stations';
import { projectBrief } from './project-brief';
import { ownerPacksKept } from './report-day';
import { daySaid } from './said';
import { projectDepartments } from './team';
import type { DdProject, FieldAddress } from './types';

/* ==================================================================== */
/* The shapes                                                            */
/* ==================================================================== */

export const CHAT_QUESTION_SHAPES = ['needs_me', 'papers_pending', 'cost_changed', 'schedule_late', 'due_this_period', 'figure'] as const;
export type ChatQuestionShape = (typeof CHAT_QUESTION_SHAPES)[number];

/** A question as it is answered: its shape, and what it names. */
export interface ChatQuestionAsked {
  shape: ChatQuestionShape;
  /** `papers_pending`: the party or consultant named. Absent: every party. */
  party?: string;
  /** `figure`: the figure named, and the package it is asked of. */
  figure?: string;
  of?: string;
}

/** The tool a turn answered by rule carries, and the one it carries when it could not answer. */
export const CHAT_QUESTION = 'chat_question';
export const CHAT_NOT_ANSWERED = 'not_answered';

export interface ChatQuestionAnswer {
  card: ChatAnswerCard;
  /** What the chip under the reply says. */
  summary: string;
}

interface Setting {
  now: Date;
  here?: ChatPlace;
  catalog?: FieldCatalog;
}

type Builder = (project: DdProject, asked: ChatQuestionAsked, setting: Setting) => ChatQuestionAnswer;

const PROGRESS: PapersPlace = { pane: 'workstream', extra: { workstream: 'construction.progress', section: 'progress' } };
const BUDGET: PapersPlace = { pane: 'workstream', extra: { workstream: 'finance.budget' } };
const SITE: PapersPlace = { pane: 'workstream', extra: { workstream: 'construction.site' } };
const REPORTS: PapersPlace = { pane: 'reports' };

const COST_REPORT = 'Cost Report';
const SCHEDULE = 'Progress board';

const at = (project: DdProject, place: PapersPlace, label: string): ChatOpen => ({ label, path: papersPlacePath(project.id, place) });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const fold = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const packageLabel = (pack: { code?: string; name: string }): string => [pack.code, pack.name].filter(Boolean).join(' · ');

function figure(label: string, value: string, open: ChatOpen, standing: ChatAnswerRow['standing'] = 'on_record'): ChatAnswerRow {
  return { kind: 'figure', label, value, standing, open };
}

/** A card whose lead is one of this file's fixed lines. */
function card(lead: string, rows: ChatAnswerRow[], look: ChatAnswerCard['look'] = [], outcome: ChatAnswerCard['outcome'] = rows.length ? 'answered' : 'not_on_record'): ChatAnswerCard {
  return { v: 1, outcome, rows, look, said: { lead, ...(look.length ? { lookAt: rows.length ? 'Also:' : 'The nearest things on this project:' } : {}) } };
}

/* ==================================================================== */
/* What is pending from a party                                          */
/* ==================================================================== */

/** Words that name no one party: "the consultants", "everybody", "them". */
const NO_ONE_PARTY = new Set('the a an our their all each every any everybody everyone anyone anybody them they whom who consultant consultants party parties people firm firms team teams others other'.split(' '));

const partyWords = (name: string): string[] => fold(name).split(' ').filter((word) => word && !NO_ONE_PARTY.has(word));

/** Whether a party on a list is the one a question names: every word of the name asked is a word of the party's, or the other way about. */
function partyNamed(party: string | undefined, asked: string[]): boolean {
  if (!party) return false;
  const own = new Set(partyWords(party));
  if (!own.size) return false;
  return asked.every((word) => own.has(word)) || [...own].every((word) => asked.includes(word));
}

/** How many parties a card names before it says how many more there are. */
export const PARTIES_SAID = 8;

const STANDING_ORDER: PaperStanding[] = ['answered', 'asked', 'partial', 'not_asked'];

const oldestAsk = (lines: readonly PaperLine[]): string | undefined => lines.map((line) => line.askedOn?.slice(0, 10)).filter((day): day is string => Boolean(day)).sort()[0];

/** The counts of some lines by where they stand, with how many are overdue and the oldest day one was asked for. */
function standingSaid(lines: readonly PaperLine[]): string {
  const counts = STANDING_ORDER.map((standing) => [standing, lines.filter((line) => line.standing === standing).length] as const).filter(([, n]) => n > 0);
  const overdue = lines.filter((line) => line.overdue).length;
  const oldest = oldestAsk(lines);
  return [...counts.map(([standing, n]) => `${n} ${PAPER_STANDING_LABEL[standing].toLowerCase()}`), overdue ? `${overdue} overdue` : '', oldest ? `oldest asked ${daySaid(oldest)}` : ''].filter(Boolean).join(' · ');
}

const papersPending: Builder = (project, asked, { now }) => {
  const view = papersOwed(project, { now: now.toISOString() });
  // Where a list is read or loaded when nothing is owed: the first department that keeps one.
  const first = projectDepartments(project).map((department) => papersOwedOpen(department)).find((place) => place.pane === 'workstream') ?? { pane: 'evidence' as const };
  const open = (lines: readonly PaperLine[]): ChatOpen => at(project, papersHeldAt(lines) ?? first, PAPERS_OWED);
  if (!view.parties.length) {
    return {
      card: card(view.total ? `Nothing is owed: all ${view.total} on the list are in hand.` : 'No list of papers is loaded and nothing has been asked for.', [], [{ label: PAPERS_OWED, open: at(project, first, PAPERS_OWED) }]),
      summary: PAPERS_OWED,
    };
  }
  const words = asked.party ? partyWords(asked.party) : [];
  const named = words.length ? view.parties.filter((party) => partyNamed(party.party, words)) : [];
  if (words.length && named.length) {
    const rows: ChatAnswerRow[] = [];
    for (const party of named) {
      rows.push(figure(`${party.party} · owed`, standingSaid(party.lines), open(party.lines)));
      for (const standing of STANDING_ORDER) {
        const lines = party.lines.filter((line) => line.standing === standing);
        if (!lines.length || named.length > 1) continue;
        const oldest = oldestAsk(lines);
        const overdue = lines.filter((line) => line.overdue).length;
        rows.push(figure(`${party.party} · ${PAPER_STANDING_LABEL[standing]}`, [String(lines.length), overdue ? `${overdue} overdue` : '', oldest ? `oldest asked ${daySaid(oldest)}` : ''].filter(Boolean).join(' · '), open(lines)));
      }
    }
    return { card: card(`From the ${PAPERS_OWED.toLowerCase()} lists:`, rows), summary: `${PAPERS_OWED}: ${named.map((party) => party.party).join(', ')}` };
  }
  const rows: ChatAnswerRow[] = [
    figure('All parties · owed', standingSaid(view.parties.flatMap((party) => party.lines)), open(view.parties.flatMap((party) => party.lines))),
    ...view.parties.slice(0, PARTIES_SAID).map((party) => figure(`${party.party ?? 'Nobody named'} · owed`, standingSaid(party.lines), open(party.lines))),
  ];
  const more = view.parties.length - PARTIES_SAID;
  return {
    card: card(
      words.length ? `Nobody on the ${PAPERS_OWED.toLowerCase()} lists goes by “${asked.party!.trim()}”. Who the lists name:` : `From the ${PAPERS_OWED.toLowerCase()} lists:`,
      rows,
      more > 0 ? [{ label: `${plural(more, 'more party', 'more parties')} on ${PAPERS_OWED}`, open: open(view.parties.slice(PARTIES_SAID).flatMap((party) => party.lines)) }] : [],
      words.length ? 'partly' : 'answered',
    ),
    summary: PAPERS_OWED,
  };
};

/* ==================================================================== */
/* What changed in cost, and why                                         */
/* ==================================================================== */

/** The Cost Report the screens read for where cost stands: the last one issued. */
function lastIssued(project: DdProject): CostReportPeriod | undefined {
  return costReportsOf(project).filter((report) => report.status === 'issued').at(-1);
}

/** How many package movements a card says: the same three the Cost Report opens on. */
export const MOVEMENTS_SAID = 3;

const costChanged: Builder = (project, _asked, _setting) => {
  const open = at(project, BUDGET, COST_REPORT);
  const money = (amount: number) => moneySaid(amount, project.currency);
  const signed = (amount: number) => `${amount > 0 ? '+' : ''}${money(amount)}`;
  const last = lastIssued(project);
  if (!last) return { card: card('No Cost Report is issued yet, so nothing says what changed.', [], [{ label: COST_REPORT, open }]), summary: COST_REPORT };
  const comparison = costReportChanges(project, last.id);
  if (!comparison) {
    const totals = costReportTotals(last);
    return {
      card: card(`Only one Cost Report is issued (${last.label}), so there is nothing to compare it with.`, [figure(`Forecast · ${last.label}`, money(totals.anticipatedCost), open), figure(`Budget · ${last.label}`, money(totals.budget), open)], [], 'partly'),
      summary: COST_REPORT,
    };
  }
  const forecast = comparison.totals.figures.anticipatedCost;
  const causeSaid = (cause: CostReportChangeCause): string =>
    cause.kind === 'variation' ? `Variation: ${cause.description}${cause.contingencyDrawn ? ' (contingency)' : ''} ${signed(cause.amount)}` : `Awarded at ${money(cause.poIssued)} ${signed(cause.amount)}`;
  const movementSaid = (change: CostReportPackageChange): string =>
    [
      change.status === 'added' ? `new at ${money(change.figures.anticipatedCost.current ?? 0)}` : change.status === 'removed' ? `no longer on the report, was ${money(change.figures.anticipatedCost.previous ?? 0)}` : `${signed(change.figures.anticipatedCost.change)}, ${money(change.figures.anticipatedCost.previous ?? 0)} to ${money(change.figures.anticipatedCost.current ?? 0)}`,
      ...change.causes.map(causeSaid),
      change.unexplained !== 0 ? `Unexplained ${signed(change.unexplained)}` : '',
      // A reason is the one line a person typed against the change, kept on the report.
      change.reason ? `Reason given: ${change.reason.replace(/[.\s]+$/, '')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const largest = largestCostMovements(comparison, MOVEMENTS_SAID);
  const { unexplained, unexplainedPackages } = comparison.totals;
  const rows: ChatAnswerRow[] = [
    figure(`Forecast then · ${comparison.previous.label}`, money(forecast.previous), open),
    figure(`Forecast now · ${comparison.current.label}`, money(forecast.current), open),
    figure('Change in the forecast', forecast.change ? signed(forecast.change) : 'None', open, 'worked_out'),
    ...largest.map((change) => figure(packageLabel(change), movementSaid(change), open, 'worked_out')),
    figure('Unexplained', unexplainedPackages ? `${signed(unexplained)} on ${plural(unexplainedPackages, 'package')}` : 'None', open, 'worked_out'),
  ];
  return { card: card(`From the ${COST_REPORT}, ${comparison.previous.label} to ${comparison.current.label}:`, rows), summary: `${COST_REPORT}: since ${comparison.previous.label}` };
};

/* ==================================================================== */
/* What is late, or about to be                                          */
/* ==================================================================== */

const LEVEL_SAID: Record<ScheduleLevel, string> = { late: 'Late', behind: 'Behind', slipping: 'Late at the current rate' };
const LEVEL_ORDER: ScheduleLevel[] = ['late', 'behind', 'slipping'];

/** The milestones the board flags, the latest first within each level. */
export function milestonesFlagged(watch: { milestones: readonly MilestoneWatch[] }): MilestoneWatch[] {
  return LEVEL_ORDER.flatMap((level) => watch.milestones.filter((milestone) => milestone.level === level));
}

/** How many flagged milestones a card says before it says how many more there are. */
export const MILESTONES_SAID = 8;

const scheduleLate: Builder = (project, _asked, { now }) => {
  const open = at(project, PROGRESS, SCHEDULE);
  const watch = scheduleWatch(project, now);
  if (!watch.milestones.length) return { card: card('No schedule is on file, so nothing says what is late.', [], [{ label: SCHEDULE, open }]), summary: SCHEDULE };
  const flagged = milestonesFlagged(watch);
  const said = (milestone: MilestoneWatch): string =>
    [
      milestone.plannedFinish ? `planned ${daySaid(milestone.plannedFinish)}` : '',
      milestone.projectedFinish ? `projected ${daySaid(milestone.projectedFinish)}` : '',
      `${milestone.percent}% done${milestone.expectedPercent !== undefined && milestone.level === 'behind' ? `, expected ${milestone.expectedPercent}%` : ''}`,
      milestone.level === 'late' && milestone.daysToFinish !== undefined ? `${plural(-milestone.daysToFinish, 'day')} late` : milestone.projectedDaysLate ? `about ${plural(milestone.projectedDaysLate, 'day')} late at the current rate` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const rows: ChatAnswerRow[] = [
    ...flagged.slice(0, MILESTONES_SAID).map((milestone) => figure(`${milestone.name} · ${LEVEL_SAID[milestone.level!]}`, said(milestone), open, 'worked_out')),
    ...(watch.plannedCompletion ? [figure('Planned completion', daySaid(watch.plannedCompletion), open)] : []),
    ...(watch.projectedCompletion
      ? [figure('Completion at the current rate', `${daySaid(watch.projectedCompletion)}${watch.projectedDaysLate ? ` · ${plural(watch.projectedDaysLate, 'day')} after planned` : ''}`, open, 'worked_out')]
      : []),
  ];
  const more = flagged.length - MILESTONES_SAID;
  const counts = LEVEL_ORDER.map((level) => [level, flagged.filter((milestone) => milestone.level === level).length] as const).filter(([, n]) => n > 0);
  return {
    card: card(
      flagged.length ? `From the schedule: ${counts.map(([level, n]) => `${n} ${LEVEL_SAID[level].toLowerCase()}`).join(', ')}.` : 'From the schedule: nothing is late or behind.',
      rows,
      more > 0 ? [{ label: `${plural(more, 'more milestone')} on the ${SCHEDULE}`, open }] : [],
    ),
    summary: SCHEDULE,
  };
};

/* ==================================================================== */
/* What needs me                                                         */
/* ==================================================================== */

const needsMe: Builder = (project, _asked, { now }) => {
  const line = projectBrief(project, now).find((held) => held.key === 'needs')!;
  // Each part opens the page it waits on, named as the menu names it.
  const where = (place: PapersPlace): string => ('firm' in place ? 'Requests' : chatPlaceLabel({ pane: place.pane, fn: place.extra?.workstream }));
  const rows = line.parts.map((part) => figure(line.label, part.text, at(project, part.open, where(part.open))));
  return { card: rows.length ? card('What waits on a person:', rows) : card(line.quiet, [], [{ label: 'Actions', open: at(project, line.open, 'Actions') }]), summary: line.label };
};

/* ==================================================================== */
/* What is due this period                                               */
/* ==================================================================== */

/** How many stations a card names. */
export const STATIONS_SAID = 6;

const dueThisPeriod: Builder = (project, _asked, { now, catalog }) => {
  const dues = periodsDue(project, now, catalog ?? fieldCatalogFor(project));
  const stations = stationsDue(project, now);
  const rows: ChatAnswerRow[] = [
    ...dues.map((due) => figure(due.title, due.said, at(project, due.fn === 'finance.budget' ? BUDGET : { pane: 'workstream', extra: { workstream: due.fn } }, due.title))),
    ...(stations.length
      ? [figure('Stations to photograph', `${stations.length}: ${stations.slice(0, STATIONS_SAID).map((station) => station.label).join(', ')}${stations.length > STATIONS_SAID ? ` and ${stations.length - STATIONS_SAID} more` : ''}`, at(project, SITE, 'Site'))]
      : []),
  ];
  return { card: rows.length ? card('Due and not yet issued:', rows) : card('Nothing kept by period is due, and no station waits to be photographed.', [], [{ label: 'Reports', open: at(project, REPORTS, 'Reports') }]), summary: 'Due this period' };
};

/* ==================================================================== */
/* A figure by name                                                      */
/* ==================================================================== */

type ReportFigure = 'budget' | 'poIssued' | 'amountPaid' | 'anticipatedCost';

/** The figures of a Cost Report a question names, each by the words people use for it and as the report calls it. */
const REPORT_FIGURES: ReadonlyArray<{ key: ReportFigure; label: string; words: RegExp }> = [
  { key: 'budget', label: 'Budget', words: /\bbudget(?:ed)?\b/ },
  { key: 'anticipatedCost', label: 'Anticipated cost', words: /\b(?:forecast|anticipated|expected (?:final )?cost|final cost)\b/ },
  { key: 'amountPaid', label: 'Paid', words: /\bpaid\b/ },
  { key: 'poIssued', label: 'PO issued', words: /\b(?:po|pos|orders?) issued\b|\bcommitted\b|\bawarded\b/ },
];

const CERTIFIED = /\bcertified\b/;

/** Words of a package's name that tell one package from another. */
const packageWords = (name: string): string[] => fold(name).split(' ').filter((word) => word && !['the', 'a', 'package', 'packages', 'work', 'works', 'so', 'far', 'to', 'date', 'till', 'now', 'on', 'this', 'project'].includes(word));

function packagesNamed(report: CostReportPeriod, of: string): CostReportPackageRow[] {
  const asked = packageWords(of);
  if (!asked.length) return [];
  return report.rows.filter((row) => {
    const own = new Set(packageWords(`${row.code ?? ''} ${row.name}`));
    return asked.every((word) => own.has(word));
  });
}

/** How many rows a figure asked of a package may match before only the first few are said. */
export const PACKAGES_SAID = 5;

/** The fields of the project's sheets whose label is the name asked, and that hold something. */
function fieldsNamed(project: DdProject, name: string, catalog: FieldCatalog): FieldAddress[] {
  const asked = fold(name);
  if (!asked) return [];
  const out: FieldAddress[] = [];
  for (const set of catalog.sets.values()) {
    if (catalog.checks.has(set.id)) continue;
    for (const def of set.fields) {
      // A figure is a number or an amount, entered or worked out: a standing, a choice or a person's words is not one.
      if (fold(def.label) !== asked || !['number', 'money', 'computed'].includes(def.kind)) continue;
      if (set.records) for (const record of fieldRecords(project, set.id)) out.push({ fn: set.fn, set: set.id, field: def.key, record: record.id });
      else out.push({ fn: set.fn, set: set.id, field: def.key });
    }
  }
  return out;
}

const figureNamed: Builder = (project, asked, { now, catalog = fieldCatalogFor(project) }) => {
  const open = at(project, BUDGET, COST_REPORT);
  const money = (amount: number) => moneySaid(amount, project.currency);
  const name = fold(asked.figure ?? '');
  const summary = `Figure: ${asked.figure ?? ''}`.trim();
  if (CERTIFIED.test(name)) {
    const report = lastIssued(project) ?? costReportsOf(project).filter((held) => held.status !== 'superseded').sort(costReportPeriodOrder).at(-1);
    const packs = asked.of && report ? packagesNamed(report, asked.of) : [];
    const register = at(project, BUDGET, 'Cost register');
    const rows = packs.length
      ? packs.slice(0, PACKAGES_SAID).flatMap((pack) => {
          const amount = projectFigure(project, 'package.certified', now, pack.workPackageId);
          return amount === null ? [] : [figure(`Certified · ${packageLabel(pack)}`, money(amount), register, 'worked_out')];
        })
      : (() => {
          const amount = projectFigure(project, 'cost.certified', now);
          return amount === null ? [] : [figure('Certified to date', money(amount), register, 'worked_out')];
        })();
    if (rows.length) return { card: card('From the cost register:', rows), summary };
    return { card: card('No bill is certified on the cost register, so nothing says how much is certified.', [], [{ label: COST_REPORT, open }]), summary };
  }
  const which = REPORT_FIGURES.find((held) => held.words.test(name));
  const report = lastIssued(project) ?? costReportsOf(project).filter((held) => held.status !== 'superseded').sort(costReportPeriodOrder).at(-1);
  if (which && report) {
    const from = `${report.label}${report.status === 'issued' ? '' : ', not issued'}`;
    const total = figure(`${which.label} · all packages · ${from}`, money(costReportTotals(report)[which.key]), open);
    if (!asked.of) return { card: card(`From the ${COST_REPORT}:`, [total]), summary };
    const packs = packagesNamed(report, asked.of);
    if (packs.length) {
      return {
        card: card(
          `From the ${COST_REPORT}:`,
          packs.slice(0, PACKAGES_SAID).map((pack) => figure(`${which.label} · ${packageLabel(pack)} · ${from}`, money(pack[which.key]), open)),
          packs.length > PACKAGES_SAID ? [{ label: `${plural(packs.length - PACKAGES_SAID, 'more package')} on the ${COST_REPORT}`, open }] : [],
        ),
        summary,
      };
    }
    return { card: card(`No package on the ${COST_REPORT} goes by “${asked.of.trim()}”. The whole report:`, [total], [], 'partly'), summary };
  }
  // A field of a sheet, asked for by its own label.
  const fields = chatAnswerCard(project, { outcome: 'answered', fields: fieldsNamed(project, asked.figure ?? '', catalog), records: [], memory: [], passages: [], lookAtFields: [], lookAtPapers: [] }, { at: now }, catalog);
  if (fields.rows.length) return { card: { ...fields, look: [], outcome: 'answered', said: { lead: 'From the field sheets:' } }, summary };
  return { card: card(which ? 'No Cost Report is on file, so nothing holds that figure.' : 'No Cost Report figure or field goes by that name.', [], [{ label: COST_REPORT, open }]), summary };
};

/* ==================================================================== */
/* The table                                                             */
/* ==================================================================== */

/** Each shape of question, what it is for (said to a model that picks one), and its answer builder. */
export const CHAT_QUESTIONS: Readonly<Record<ChatQuestionShape, { asks: string; answer: Builder }>> = {
  needs_me: { asks: 'What waits on the person: values to accept, replies to confirm, decisions to make, actions overdue.', answer: needsMe },
  papers_pending: { asks: 'What papers or information a named party or consultant still owes, or what is owed in all. Give `party` when one is named.', answer: papersPending },
  cost_changed: { asks: 'What changed in cost since the last report and why: forecast then and now, the largest movements with their cause, the unexplained amount.', answer: costChanged },
  schedule_late: { asks: 'What is late, behind or about to be, which milestones, and when the work finishes.', answer: scheduleLate },
  due_this_period: { asks: 'What is due this week, month or quarter: sheets kept by period, and stations to photograph.', answer: dueThisPeriod },
  figure: { asks: 'One cost figure by name: budget, anticipated cost (forecast), paid, PO issued or certified. Give `figure`, and `of` when a package is named.', answer: figureNamed },
};

/** The card for a question of a known shape, from the functions the screens read. */
export function chatQuestionAnswer(project: DdProject, asked: ChatQuestionAsked, setting: { now?: Date; here?: ChatPlace; catalog?: FieldCatalog } = {}): ChatQuestionAnswer {
  return CHAT_QUESTIONS[asked.shape].answer(project, asked, { ...setting, now: setting.now ?? new Date() });
}

/* ==================================================================== */
/* A sentence read as a question of one of these shapes                  */
/* ==================================================================== */

/** A sentence that asks: it opens with a question word, or ends with a question mark. An instruction is never one of these questions. */
const ASKS = /^(?:(?:please|so|and|ok|okay|hi|hello)[,\s]+)*(?:what|what's|whats|which|who|whom|how|why|when|where|is|are|was|were|do|does|did|has|have|had|can|could|will|would|should|any|anything|tell me|give me|show me|list)\b|\?\s*$/i;

const NEEDS_ME =
  /\b(?:waiting|waits|pending|outstanding) (?:on|for|with) me\b|\bneeds? (?:me\b|my (?:attention|decision|approval|sign))|\b(?:do|must|should) i (?:need to |have to )?(?:decide|accept|approve|sign|confirm)\b|\bfor me to (?:decide|accept|approve|sign)\b|\bon my (?:desk|plate)\b/i;

const PENDING_FROM = /\b(?:pending|outstanding|awaited|awaiting|overdue|owed|due)\b[^?]*?\bfrom\b|\bwaiting (?:on|for)\b(?! me\b)[^?]*?\bfrom\b|\bnot (?:yet )?(?:received|got|been (?:sent|given))\b[^?]*?\bfrom\b/i;
const OWES = /\b(?:what|which|how much|how many)\b.*?\b(?:does|do|did) (?:the |our )?(.+?) (?:still )?owe\b/i;
const NOT_RECEIVED = /\b(?:have|has|did) (?:we|i) not (?:yet )?(?:received|got|been (?:sent|given))\b|\bnot (?:yet )?(?:been )?received\b|\bwho (?:still )?owes\b|\b(?:papers?|documents?|information|drawings?) (?:are |is )?(?:still )?(?:owed|pending|outstanding|awaited)\b|\bwhat (?:is|are) (?:still )?(?:owed|pending|outstanding|awaited)\b/i;
const FROM_PARTY = /\bfrom (?:the |our )?(.+?)(?: (?:yet|so far|still|as of|this (?:week|month)|today|now)\b.*)?\??$/i;

const COST_WORD = /\b(?:costs?|forecast|budget|anticipated|spend)\b/i;
const CHANGE_WORD = /\b(?:chang\w*|mov(?:ed?|ement|ements|ing)|went (?:up|down)|go(?:ne|ing|es)? (?:up|down)|increas\w*|ris(?:e|en|ing)|rose|jump\w*|differen\w*|since (?:the )?last|compared? (?:to|with) (?:the )?last|why)\b/i;

const NOT_THE_SCHEDULE = /\b(?:actions?|papers?|documents?|approvals?|payments?|bills?|invoices?|tenders?|findings?|risks?|requests?)\b/i;
const SCHEDULE_LATE =
  /\b(?:running (?:late|behind)|behind schedule|on schedule|on time|on track|slipp\w*|delay\w*)\b|\b(?:milestones?|activit(?:y|ies)|schedule|programme|program|works?|anything|project)\b.*\b(?:late|behind)\b|\b(?:late|behind)\b.*\b(?:milestones?|activit(?:y|ies)|schedule|programme)\b|\bwhen (?:do|will|does|would|are) (?:we|it|the (?:project|work|works|building|job)) (?:going to )?(?:finish|complete|end|be (?:done|finished|complete|completed))\b|\b(?:completion|finish|handover) date\b/i;

const DUE_PERIOD =
  /\bdue\b.*\b(?:this|the|current) (?:week|month|quarter|period)\b|\bwhat(?:'s|’s| is) due\b|\bdue (?:now|today|soon)\b|\b(?:stations?|photos?|photographs?)\b.*\b(?:photograph|shoot|take|due)\b|\b(?:sheets?|reports?) (?:are |is )?due\b/i;

const FIGURE = /\b(?:what(?:'s|’s| is| was| are)|how much|tell me|give me|show me)\b.*?\b(budget(?:ed)?|forecast|anticipated(?: cost)?|expected (?:final )?cost|final cost|certified|paid|(?:po|pos|orders?) issued|committed)\b(?:.*?\b(?:for|of|on|in|against|to)\b (?:the )?(.+?))?\??$/i;

const cleanParty = (raw: string | undefined): string | undefined => {
  const said = (raw ?? '').replace(/[?.!]+$/, '').trim();
  return said && partyWords(said).length ? said : undefined;
};

/**
 * The shape a sentence asks, by its words, and what it names. Undefined for
 * anything that is not a question, or is a question of no shape here: an
 * instruction ("set the budget to…") is never read as one.
 */
export function chatQuestionAsked(question: string): ChatQuestionAsked | undefined {
  const q = question.trim().replace(/\s+/g, ' ');
  if (!q || q.length > 200 || !ASKS.test(q)) return undefined;
  if (NEEDS_ME.test(q)) return { shape: 'needs_me' };
  const owes = OWES.exec(q);
  if (owes) return { shape: 'papers_pending', ...(cleanParty(owes[1]) ? { party: cleanParty(owes[1]) } : {}) };
  if (PENDING_FROM.test(q) || NOT_RECEIVED.test(q)) {
    const party = cleanParty(FROM_PARTY.exec(q)?.[1]);
    return { shape: 'papers_pending', ...(party ? { party } : {}) };
  }
  if (COST_WORD.test(q) && CHANGE_WORD.test(q)) return { shape: 'cost_changed' };
  if (SCHEDULE_LATE.test(q) && !NOT_THE_SCHEDULE.test(q)) return { shape: 'schedule_late' };
  if (DUE_PERIOD.test(q)) return { shape: 'due_this_period' };
  const named = FIGURE.exec(q);
  if (named) {
    const of = (named[2] ?? '').replace(/[?.!]+$/, '').trim();
    return { shape: 'figure', figure: named[1]!.toLowerCase(), ...(of && packageWords(of).length ? { of } : {}) };
  }
  return undefined;
}

/**
 * A sentence answered by rule, or undefined where it is not one of these
 * questions. Papers owed are the firm's own:
 * somebody working from a grant is not answered with them.
 */
export function chatQuestionRuled(project: DdProject, question: string, setting: { now?: Date; here?: ChatPlace; outside?: boolean } = {}): (ChatQuestionAnswer & { asked: ChatQuestionAsked }) | undefined {
  const asked = chatQuestionAsked(question);
  if (!asked) return undefined;
  if (setting.outside && (asked.shape === 'papers_pending' || asked.shape === 'needs_me')) return undefined;
  const answer = chatQuestionAnswer(project, asked, setting);
  return { ...answer, asked };
}

/* ==================================================================== */
/* A report asked for by its period                                      */
/* ==================================================================== */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SHOWN = /^(?:please\s+)?(?:open|show(?: me)?|go to|take me to|see|view|print|bring up|pull up)\b/i;
const OWNER_PACK = /\bowner(?:'s|’s|s)? pack\b|\bpack for the owner\b/i;

/** The month a sentence names, as `YYYY-MM`: "September 2026", "Sep 2026", "2026-09", "last month", "this month". */
function monthNamed(text: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  const key = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;
  const plain = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(t);
  if (plain) return `${plain[1]}-${plain[2]}`;
  const named = new RegExp(`\\b(${MONTHS.map((month) => `${month}|${month.slice(0, 3)}`).join('|')})\\.?(?:,)?\\s+(20\\d{2})\\b`).exec(t);
  if (named) return key(Number(named[2]), MONTHS.findIndex((month) => month.startsWith(named[1]!.slice(0, 3))) + 1);
  const shifted = /\blast month\b/.test(t) ? -1 : /\bthis month\b/.test(t) ? 0 : undefined;
  if (shifted === undefined) return undefined;
  const then = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shifted, 1));
  return key(then.getUTCFullYear(), then.getUTCMonth() + 1);
}

/** The word an address carries for a month's owner pack that is not kept yet. */
export const PACK_MONTH = 'month:';

export interface ReportPlace {
  open: { pane: 'reports'; extra: { item: string } };
  /** What the chip says opened. */
  label: string;
  /** The one line said. */
  text: string;
}

/**
 * A sentence that asks for the owner pack of a month nobody has kept one
 * for yet: reports and their periods are places the chat opens, so Reports
 * opens with that month picked, ready to open. Never a change to any record.
 * A pack that is kept is a record with a name, and is opened by the rule
 * that opens records and says how it stands; so is the pack asked for with
 * no month.
 */
export function reportPlaceAsked(project: DdProject, question: string, now: Date = new Date()): ReportPlace | undefined {
  const q = question.trim();
  if (!SHOWN.test(q) || !OWNER_PACK.test(q)) return undefined;
  const month = monthNamed(q, now);
  if (!month) return undefined;
  const said = `${MONTHS[Number(month.slice(5)) - 1]!.replace(/^./, (first) => first.toUpperCase())} ${month.slice(0, 4)}`;
  if (ownerPacksKept(project).some((pack) => pack.pack.period.from.slice(0, 7) === month && Date.parse(pack.pack.period.to) - Date.parse(pack.pack.period.from) < 32 * 86_400_000)) return undefined;
  return {
    open: { pane: 'reports', extra: { item: `${PACK_MONTH}${month}` } },
    label: `Opened the owner pack for ${said}`,
    text: `Reports is open with ${said} picked for the owner pack. No pack is kept for that month yet: open it there to read and issue it.`,
  };
}

/* ==================================================================== */
/* When the chat cannot answer                                           */
/* ==================================================================== */

/**
 * What the chat says to a question it cannot answer: one plain line, and the
 * nearest real things on the project to open: the list, the report, the
 * sheet. It proposes nothing, starts nothing and goes nowhere.
 */
export function chatNotAnswered(project: DdProject, question: string, here: ChatPlace = {}): ChatQuestionAnswer {
  const q = question.toLowerCase();
  const fn = menuPlaceOfWords(here).fn;
  const lists = projectDepartments(project).map((department) => papersOwedOpen(department)).find((place) => place.pane === 'workstream') ?? { pane: 'evidence' as const };
  const things: Array<{ label: string; place: PapersPlace; near: RegExp }> = [
    { label: `${PAPERS_OWED} (the list)`, place: lists, near: /\b(?:paper|papers|document|documents|drawing|drawings|information|consultant|architect|contractor|owe|owed|pending|received|list)\b/ },
    { label: `${COST_REPORT} (the report)`, place: BUDGET, near: /\b(?:cost|costs|budget|forecast|paid|certified|money|variation|variations|bill|bills|package|packages|price)\b/ },
    { label: `${SCHEDULE} (the schedule)`, place: PROGRESS, near: /\b(?:late|behind|schedule|milestone|milestones|finish|complete|completion|progress|delay|delayed|date|dates|programme)\b/ },
    { label: 'Reports (the owner pack)', place: REPORTS, near: /\b(?:report|reports|pack|owner|month|monthly|quarter)\b/ },
  ];
  const ranked = [...things].sort((a, b) => Number(b.near.test(q)) - Number(a.near.test(q)));
  const look: ChatAnswerCard['look'] = [
    ...ranked.slice(0, 3).map((thing) => ({ label: thing.label, open: at(project, thing.place, thing.label) })),
    // The sheet of the page the person is on, where they are on a function's page.
    ...(fn ? [{ label: 'This page’s field sheet (the sheet)', open: at(project, { pane: 'workstream', extra: { workstream: fn, section: 'sheet' } }, 'Field sheet') }] : []),
  ];
  return { card: card('I cannot answer that from what this project holds.', [], look), summary: 'Not answered' };
}

/* ==================================================================== */
/* What the chat opens with                                              */
/* ==================================================================== */

/** The questions offered on a project that is being built. */
export const RUNNING_PROMPTS: readonly string[] = ['What is waiting on me?', 'Is anything running late?', 'What have we not received?', 'What changed in cost since the last report?'];

/** Whether a project is past the land, by its stage or by what is on file: packages, a Cost Report, a schedule, a site log or a list of papers. */
export function projectIsRunning(project: DdProject): boolean {
  const stage = stageOf(project.currentStage);
  return (
    stage === 'construction' ||
    stage === 'operations' ||
    Boolean(project.milestones?.length || project.costReports?.length || project.cost?.workPackages.length || project.siteLog?.length || project.checklist?.length)
  );
}

/**
 * The line the chat opens with, before anything is asked, on a project that
 * is past the land: the first of the four lines Overview opens with that has
 * something to say, and the rest beneath it. Undefined on a project still at
 * the land, which opens on its next step as it always did.
 */
export function chatOpening(project: DdProject, now: Date = new Date(), opts: { outside?: boolean } = {}): { title: string; hint: string } | undefined {
  if (!projectIsRunning(project)) return undefined;
  const lines = projectBrief(project, now, opts).map((line) => `${line.label}: ${line.parts.length ? line.parts.map((part) => part.text).join(' · ') : line.quiet}`.replace(/: $/, ''));
  const [title, ...rest] = lines;
  return title ? { title, hint: rest.join('\n') } : undefined;
}
