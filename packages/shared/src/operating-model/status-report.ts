/**
 * A status report: what changed on a project over a period, what is waiting
 * and on whom, and what comes next.
 *
 * It is made by code from what the project's memory is told and holds: the
 * entries, one for each event, and the facts, one for each value (`mem-delta`,
 * `mem-facts`). No model writes a line of it, so asked twice of the same
 * record it is the same report.
 *
 * Every line has something on the record behind it, a paper or a record, and
 * says where that stands in the record's own word. A line that rests only on
 * something nobody has accepted, values read off a paper or things waiting on
 * cards, says so. An event whose record has since gone has nothing behind it
 * and is left out.
 *
 * It is a report among the project's reports: three sections that read the
 * record until the report is issued (`resolveStatusBlock`), which a person
 * reads, edits and issues under their name. A model may reword its lines
 * where one is set up, and is held to them (`statusWordingHeld`): its words
 * replace the words of a line code wrote and nothing else, so it can add no
 * line, drop none, and change no date, person or source, nor what a line
 * says of where a thing stands.
 */

import { approvalsRegister } from './approvals';
import { ACTION_STATUS_LABEL, DECISION_STATUS_LABEL, FINDING_STATUS_LABEL, SEVERITY_LABEL } from './catalogs';
import { acceptedFacts, proposedFacts } from './fact-review';
import { meetingCalled, meetingDay, meetingItemStands, meetingOfRecord, meetingsHeld } from './meetings';
import { memPeople } from './mem-answer';
import { memPointer, memoryDelta, type MemEntry } from './mem-delta';
import { memoryFacts, type MemFact } from './mem-facts';
import { sameEmail } from './tenancy';
import type { ActionRecord, DdProject, DecisionRecord, GeneratedReport, ReportBlock, ReportBoundSource, ReportBoundSourceKind, ResolvedReportBlock } from './types';

/** A period: from this moment up to, and not including, that one. */
export interface StatusPeriod {
  from: string;
  to: string;
}

/** The three sections of a status report, by what each reads. */
export const STATUS_SOURCES: readonly ReportBoundSourceKind[] = ['status_changed', 'status_waiting', 'status_next'];

export function isStatusSource(kind: string | undefined): boolean {
  return STATUS_SOURCES.includes(kind as ReportBoundSourceKind);
}

/** How many lines a section prints at most. A status report is short; the rest are counted in one line under it. */
export const STATUS_AT_MOST: Record<'changed' | 'waiting' | 'next', number> = { changed: 30, waiting: 15, next: 8 };

/* ==================================================================== */
/* The period a person asks for                                           */
/* ==================================================================== */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86_400_000;

const startOfDay = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
const monthOf = (name: string): number => MONTHS.findIndex((month) => month.startsWith(name.slice(0, 3)));

/** The Monday a day's week began on. A week runs Monday to Sunday. */
function startOfWeek(at: Date): Date {
  const day = startOfDay(at);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

/** A day that is in its month, or nothing: 31 February is no day. */
function dayOf(year: number, month: number, date: number): Date | undefined {
  const day = new Date(Date.UTC(year, month, date));
  return day.getUTCFullYear() === year && day.getUTCMonth() === month && day.getUTCDate() === date ? day : undefined;
}

/**
 * The day some words name, read as a day already past: "1 October" is the
 * last 1 October on or before today, and "Monday" the last Monday before it.
 * A report looks back, so a day with no year is never read as one to come.
 */
function dayBefore(words: string, now: Date): Date | undefined {
  const text = words.toLowerCase();
  const today = startOfDay(now);
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return dayOf(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slashed = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(text);
  if (slashed) return dayOf(Number(slashed[3]), Number(slashed[2]) - 1, Number(slashed[1]));
  const dayMonth = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\.?(?:,?\s+(\d{4}))?\b`).exec(text);
  const monthDay = dayMonth ? null : new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`).exec(text);
  const named = dayMonth ? { date: Number(dayMonth[1]), month: monthOf(dayMonth[2]!), year: dayMonth[3] } : monthDay ? { date: Number(monthDay[2]), month: monthOf(monthDay[1]!), year: monthDay[3] } : undefined;
  if (named) {
    if (named.year) return dayOf(Number(named.year), named.month, named.date);
    const thisYear = dayOf(today.getUTCFullYear(), named.month, named.date);
    return thisYear && thisYear.getTime() <= today.getTime() ? thisYear : dayOf(today.getUTCFullYear() - 1, named.month, named.date);
  }
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(String.raw`\b${name}\b`).test(text));
  if (weekday !== -1) return new Date(today.getTime() - (((today.getUTCDay() - weekday + 7) % 7) || 7) * DAY_MS);
  if (/\byesterday\b/.test(text)) return new Date(today.getTime() - DAY_MS);
  return undefined;
}

/** A period as it is said: "5 Oct to 6 Oct 2026", "6 Oct 2026", or a whole month by its name. */
export function statusPeriodSaid(period: StatusPeriod): string {
  const from = new Date(period.from);
  // The last day the period takes in: the day before the moment it ends at, when that moment is the start of a day.
  const last = new Date(Date.parse(period.to) - 1);
  const firstDay = from.toISOString().slice(0, 10);
  const lastDay = last.toISOString().slice(0, 10);
  if (lastDay <= firstDay) return meetingDay(firstDay);
  const wholeMonth = from.getUTCDate() === 1 && Date.parse(period.to) === Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1);
  if (wholeMonth) return `${MONTHS[from.getUTCMonth()]!.replace(/^./, (c) => c.toUpperCase())} ${from.getUTCFullYear()}`;
  const start = meetingDay(firstDay);
  return `${firstDay.slice(0, 4) === lastDay.slice(0, 4) ? start.replace(/ \d{4}$/, '') : start} to ${meetingDay(lastDay)}`;
}

const MAKES = /^(?:please\s+|can you\s+|could you\s+)?(?:write|draft|prepare|make|generate|create|put together|give me|send me|i need|we need|let me have)\b/i;
const A_STATUS = /\bstatus(?:\s+(?:report|update|note))?\b|\b(?:weekly|monthly|progress)\s+(?:report|update)\b/i;
const NAMED_ONLY = /^(?:(?:this|last)\s+(?:week|month)(?:'s|’s)?\s+|weekly\s+|monthly\s+)?status\s+(?:report|update)\b/i;

/** The status of one thing, "the status of the khata": a question about that thing, and no report on the project. */
const OF_ONE_THING = /\bstatus(?:\s+(?:report|update|note))?\s+(?:of|on|about)\s+(?!(?:the|this|our)\s+(?:project|file|site|plot|property|deal|work)\b)/i;

/** Whether a sentence asks for a status report to be written: "write this week's status for the owner". A question about the status is not that. */
export function asksForStatusReport(question: string): boolean {
  const q = question.trim();
  if (!q || q.length > 300 || OF_ONE_THING.test(q)) return false;
  return (MAKES.test(q) && A_STATUS.test(q)) || NAMED_ONLY.test(q);
}

const AUDIENCE = /\bfor\s+(?:the\s+|our\s+)?(owners?|landowners?|clients?|lenders?|bank|investors?|buyers?|sellers?|board|management|partners?|developer|team)\b/i;

/** What a person asked a status report to cover. */
export interface StatusAsked {
  period: StatusPeriod;
  /** Who it is written for, in the words asked: "the owner". */
  audience?: string;
  /** Asked "since the last report", when no status report has been issued: it covers the project from its start. */
  noEarlier?: boolean;
}

/**
 * The last status report that went out, and the moment its period ended at.
 * Only one that was issued: a draft nobody sent is not a report anybody has
 * read, and the next one must not start after it.
 */
function lastStatusReport(project: DdProject): { report: GeneratedReport; to: string } | undefined {
  const reports = project.reports.filter((report) => report.kind === 'status' && report.status !== 'generated' && report.status !== 'draft' && report.status !== 'reviewed').sort((a, b) => ((a.signedAt ?? a.generatedAt) < (b.signedAt ?? b.generatedAt) ? 1 : -1));
  const report = reports[0];
  if (!report) return undefined;
  const to = report.body.blocks.find((block) => isStatusSource(block.source?.kind) && block.source?.to)?.source?.to;
  return { report, to: to ?? report.generatedAt };
}

/**
 * The period a request for a status report names, up to now: this week when
 * it names none. "This week", "last week", "this month", "last month", a
 * month by its name, "since the last report", "since 1 October", "since
 * Monday", "the last 10 days".
 */
export function statusPeriodAsked(project: DdProject, question: string, now = new Date()): StatusAsked {
  const q = question.toLowerCase();
  const until = now.toISOString();
  const audience = AUDIENCE.exec(question)?.[1]?.toLowerCase();
  const asked = (from: Date, to: string = until, more: Partial<StatusAsked> = {}): StatusAsked => ({ period: { from: from.toISOString(), to }, ...(audience ? { audience: `the ${audience}` } : {}), ...more });
  const today = startOfDay(now);

  if (/\bsince\s+(?:the\s+|my\s+|our\s+)?(?:last|previous)\s+(?:status\s+)?(?:report|update|one)\b/.test(q)) {
    const last = lastStatusReport(project);
    return last ? asked(new Date(last.to)) : asked(new Date(project.createdAt), until, { noEarlier: true });
  }
  const since = /\bsince\s+([^?.!]{3,40})/.exec(q)?.[1];
  const sinceDay = since ? dayBefore(since, now) : undefined;
  if (sinceDay) return asked(sinceDay);
  const days = /\b(?:last|past)\s+(\d{1,3})\s+days\b/.exec(q)?.[1];
  if (days) return asked(new Date(today.getTime() - Number(days) * DAY_MS));
  if (/\blast\s+week\b/.test(q)) {
    const monday = startOfWeek(now);
    return asked(new Date(monday.getTime() - 7 * DAY_MS), monday.toISOString());
  }
  if (/\blast\s+month\b/.test(q)) return asked(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString());
  if (/\b(?:this\s+month|monthly)\b/.test(q)) return asked(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  if (/\btoday\b/.test(q)) return asked(today);
  // A month by its name: the last such month that has begun. "May" is a month only after "for", "in" or "of", or before a year.
  const month = new RegExp(String.raw`\b(?:for|in|of|during)\s+${MONTH}\b(?:\s+(\d{4}))?|\b${MONTH}(?:'s|’s)\s+status\b|\b${MONTH}\s+(\d{4})\b`).exec(q);
  if (month) {
    const at = monthOf((month[1] ?? month[3] ?? month[4])!);
    const year = Number(month[2] ?? month[5]) || (at <= today.getUTCMonth() ? today.getUTCFullYear() : today.getUTCFullYear() - 1);
    const from = new Date(Date.UTC(year, at, 1));
    const end = new Date(Date.UTC(year, at + 1, 1));
    return asked(from, end.getTime() < now.getTime() ? end.toISOString() : until);
  }
  return asked(startOfWeek(now));
}

/* ==================================================================== */
/* The lines                                                              */
/* ==================================================================== */

export type StatusLineKind = 'paper' | 'approval' | 'decision' | 'action_done' | 'action_overdue' | 'finding' | 'meeting' | 'report' | 'action' | 'card' | 'values' | 'request' | 'milestone';

export interface StatusLine {
  kind: StatusLineKind;
  /** What changed, what waits or what comes next: one line, written by code. */
  what: string;
  /** The day it happened, since when it waits, or by when it is due. */
  when?: string;
  /** Who did it, or on whom it waits, as the record names them. */
  who?: string;
  /** Where it stands, in the record's own word. */
  stands: string;
  /** True when it rests only on something nobody has accepted. Its words say so too. */
  waits?: boolean;
  /** What is behind it, by title. */
  behind: string;
  recordId?: string;
  evidenceIds?: string[];
  /** For a paper: how many of its values were accepted in the period. */
  accepted?: number;
}

export interface StatusReport {
  period: StatusPeriod;
  changed: StatusLine[];
  waiting: StatusLine[];
  next: StatusLine[];
}

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const day = (iso: string): string => iso.slice(0, 10);
/** A title as a line quotes it: in quotation marks, without the full stop a title read off notes may end with. */
const titled = (title: string): string => `“${title.replace(/[.\s]+$/, '')}”`;

/** A value as a person reads it: the record's own way of writing it, else the value and its unit. */
function valueSaid(fact: MemFact): string {
  if (fact.display) return fact.display;
  if (typeof fact.value === 'boolean') return fact.value ? 'yes' : 'no';
  return fact.unit ? `${fact.value} ${fact.unit}` : String(fact.value);
}

/**
 * The status of a project over a period, as three lists of lines.
 *
 * `changed` is told from memory's entries in the period, each with the
 * record it is about as the record stands now. `waiting` and `next` are told
 * from the record as it stands at `now`: what waits cannot be told as of an
 * earlier day, because the record keeps what waits now and not what waited
 * then.
 */
export function statusReport(project: DdProject, period: StatusPeriod, now = new Date()): StatusReport {
  const today = now.toISOString().slice(0, 10);
  const [fromDay, toDay] = [day(period.from), day(period.to)];
  const inside = (at: string | undefined): boolean => at !== undefined && at >= period.from && at < period.to;
  // Every entry memory is told of this record, whatever a store has been written so far.
  const told = memoryDelta(project, {}, { atMost: (project.audit?.length ?? 0) + (project.conversation?.length ?? 0) + 1 }).entries;
  const entries = told.filter((entry) => inside(entry.at));
  const facts = memoryFacts(project).held;
  const people = memPeople(project);
  const named = (actor: string | undefined): string | undefined => {
    if (!actor) return undefined;
    if (actor === 'system') return 'the system';
    return (project.team ?? []).find((member) => member.name && sameEmail(member.email, actor))?.name ?? actor;
  };
  const by = (entry: MemEntry): string | undefined => named(people.get(entry.by));
  const several = (names: Array<string | undefined>): string | undefined => [...new Set(names.filter((name): name is string => Boolean(name)))].join(', ') || undefined;
  const latest = (list: readonly MemEntry[]): string => day(list.map((entry) => entry.at).sort().at(-1)!);

  const titleOf = (id: string): string | undefined => project.evidence.find((row) => row.id === id)?.title;
  /** What is behind a decision or an action: the meeting it came out of, else the papers it cites, else its own register. */
  const behindRecord = (record: ActionRecord | DecisionRecord, register: string): { behind: string; evidenceIds?: string[] } => {
    const from = meetingOfRecord(project, record.id);
    if (from) return { behind: `${meetingCalled(from.meeting)}, its notes on file` };
    const papers = record.evidenceIds.filter((id) => titleOf(id));
    if (papers.length) return { behind: papers.slice(0, 2).map((id) => titled(titleOf(id)!)).join(', '), evidenceIds: papers };
    return { behind: register };
  };

  /* ---- What changed ---- */
  const changed: StatusLine[] = [];
  const approvals = approvalsRegister(project, new Date(period.to));
  const approvalOf = new Map(approvals.flatMap((line) => line.held.map((held) => [held.evidenceId, line] as const)));
  const APPROVAL_STANDS: Record<string, string> = { in_force: 'in force', expiring: 'expiring', expired: 'lapsed' };

  // A paper is one line, whatever happened to it in the period: filed, read, values accepted.
  const PAPER_KINDS = ['paper_filed', 'file_added', 'paper_read', 'value_accepted', 'value_corrected'];
  const papers = new Map<string, MemEntry[]>();
  for (const entry of entries) {
    if (PAPER_KINDS.includes(entry.kind) && entry.about[0]) papers.set(entry.about[0], [...(papers.get(entry.about[0]) ?? []), entry]);
  }
  for (const [id, seen] of papers) {
    const row = project.evidence.find((held) => held.id === id);
    if (!row) continue;
    const has = (kind: string): boolean => seen.some((entry) => entry.kind === kind);
    const accepted = seen.filter((entry) => entry.kind === 'value_accepted' || entry.kind === 'value_corrected');
    const act = has('paper_filed') ? (has('paper_read') ? 'Filed and read' : 'Filed') : has('file_added') ? (has('paper_read') ? 'File added and read' : 'File added') : has('paper_read') ? 'Read' : 'Values accepted on';
    const approval = approvalOf.get(row.id);
    // The values accepted in the period, as memory holds them now: the key the entry names, approved, about this paper.
    const pointer = memPointer(project.id, row.id);
    const values = [...new Set(accepted.map((entry) => entry.key).filter((key): key is string => Boolean(key)))]
      .flatMap((key) => facts.filter((fact) => fact.tag === 'approved' && fact.aboutId === pointer && fact.key === key).slice(0, 1))
      .map((fact) => `${fact.label} ${valueSaid(fact)}`);
    const waiting = proposedFacts(row).length;
    const nothingAccepted = waiting > 0 && acceptedFacts(row).length === 0;
    const parts = [
      `${act}${approval ? ` (${approval.kind.label})` : ''}: ${titled(row.title)}`,
      values.length ? `accepted: ${values.slice(0, 3).join('; ')}${values.length > 3 ? `, and ${values.length - 3} more` : ''}` : accepted.length && act !== 'Values accepted on' ? `${counted(accepted.length, 'value', 'values')} accepted` : '',
      approval ? approval.say.replace(/\.$/, '') : '',
      waiting ? (nothingAccepted ? `none of its ${counted(waiting, 'value', 'values')} read is accepted yet` : `${counted(waiting, 'value waits', 'values wait')} to be accepted`) : '',
    ].filter(Boolean);
    changed.push({
      kind: approval ? 'approval' : 'paper',
      what: `${parts.join(' · ')}.`,
      when: latest(seen),
      who: several(seen.filter((entry) => entry.kind !== 'paper_read').map(by)) ?? several(seen.map(by)),
      stands: approval ? (APPROVAL_STANDS[approval.status] ?? 'on file') : nothingAccepted ? 'waiting' : 'on file',
      ...(nothingAccepted ? { waits: true } : {}),
      behind: `${titled(row.title)}${row.documentType && row.documentType !== row.title ? `, ${row.documentType}` : ''}`,
      recordId: row.id,
      evidenceIds: [row.id],
      ...(accepted.length ? { accepted: accepted.length } : {}),
    });
  }

  // An approval that lapsed in the period, with no paper event to say so.
  for (const line of approvals) {
    const until = line.held.map((held) => held.validUntil).filter((value): value is string => Boolean(value)).sort()[0];
    if (line.status !== 'expired' || !until || until < fromDay || until >= toDay || papers.has(line.held[0]!.evidenceId)) continue;
    changed.push({ kind: 'approval', what: `Lapsed: ${line.kind.label}, on ${meetingDay(until)}.`, when: until, stands: 'lapsed', behind: titled(line.held[0]!.document), recordId: line.held[0]!.evidenceId, evidenceIds: [line.held[0]!.evidenceId] });
  }

  const recorded = new Set(entries.filter((entry) => entry.kind === 'decision_recorded').map((entry) => entry.about[0]));
  for (const entry of entries) {
    const id = entry.about[0];
    if (!id) continue;
    if (entry.kind === 'decision_recorded' || (entry.kind === 'decision_settled' && !recorded.has(id))) {
      const decision = project.decisions.find((held) => held.id === id);
      if (!decision) continue;
      const open = decision.status === 'pending';
      changed.push({
        kind: 'decision',
        what: `${entry.kind === 'decision_settled' ? 'Decision made' : open ? 'Left open' : 'Decision'}: ${titled(decision.title)}.`,
        when: day(entry.at),
        who: by(entry),
        stands: DECISION_STATUS_LABEL[decision.status].toLowerCase(),
        ...behindRecord(decision, 'the decision register'),
        recordId: decision.id,
      });
    } else if (entry.kind === 'action_closed') {
      const action = project.actions.find((held) => held.id === id);
      // Closed in the period and open again since: the record no longer says it is done.
      if (!action || action.status !== 'closed') continue;
      changed.push({ kind: 'action_done', what: `Done: ${titled(action.title)}.`, when: day(entry.at), who: by(entry), stands: 'closed', ...behindRecord(action, 'the action register'), recordId: action.id });
    } else if (entry.kind === 'finding_raised') {
      const finding = project.findings.find((held) => held.id === id);
      if (!finding) continue;
      const cited = finding.evidenceIds.filter((paper) => titleOf(paper));
      changed.push({
        kind: 'finding',
        what: `Finding raised: ${titled(finding.title)} (${SEVERITY_LABEL[finding.severity].toLowerCase()}).`,
        when: day(entry.at),
        who: by(entry),
        stands: FINDING_STATUS_LABEL[finding.status].toLowerCase(),
        behind: cited.length ? cited.slice(0, 2).map((paper) => titled(titleOf(paper)!)).join(', ') : 'the findings register',
        recordId: finding.id,
        ...(cited.length ? { evidenceIds: cited } : {}),
      });
    } else if (entry.kind === 'meeting_kept') {
      const meeting = meetingsHeld(project).find((held) => held.id === id);
      if (!meeting) continue;
      const stands = meeting.items.map((item) => meetingItemStands(project, item).standing);
      const [onRecord, waiting] = [stands.filter((standing) => standing === 'recorded').length, stands.filter((standing) => standing === 'waiting').length];
      const onlyWaiting = waiting > 0 && onRecord === 0;
      changed.push({
        kind: 'meeting',
        what: `Notes kept of ${meetingCalled(meeting)}: ${meeting.items.length ? `${counted(meeting.items.length, 'thing', 'things')} read from them, ${onRecord} on the record${waiting ? `, ${waiting} waiting to be accepted` : ''}` : 'nothing in them was read as a decision or an action'}.`,
        when: day(entry.at),
        who: by(entry),
        stands: onlyWaiting ? 'waiting' : 'on file',
        ...(onlyWaiting ? { waits: true } : {}),
        behind: `its notes, ${meeting.came}`,
      });
    } else if (entry.kind === 'report_issued') {
      const report = project.reports.find((held) => held.id === id);
      if (!report) continue;
      changed.push({ kind: 'report', what: `Report issued: ${titled(report.title)}.`, when: day(entry.at), who: report.signedBy ?? by(entry), stands: 'issued', behind: 'the report as issued', recordId: report.id });
    }
  }

  // An action whose date passed in the period and that is still open.
  for (const action of project.actions) {
    const due = action.dueDate?.slice(0, 10);
    if (action.status === 'closed' || !due || due < fromDay || due >= toDay) continue;
    changed.push({ kind: 'action_overdue', what: `Overdue: ${titled(action.title)}, due ${meetingDay(due)}.`, when: due, who: action.owner || 'nobody named', stands: 'overdue', ...behindRecord(action, 'the action register'), recordId: action.id });
  }
  changed.sort((a, b) => (a.when === b.when ? 0 : (a.when ?? '') < (b.when ?? '') ? -1 : 1));

  /* ---- What is waiting, and on whom ---- */
  const waitingLines: StatusLine[] = [];
  const open = project.actions.filter((action) => action.status !== 'closed');
  for (const action of open) {
    const due = action.dueDate?.slice(0, 10);
    if (due && due >= today) continue;
    waitingLines.push({
      kind: due ? 'action_overdue' : 'action',
      what: due ? `Overdue: ${titled(action.title)}, due ${meetingDay(due)}.` : `To do, with no date given: ${titled(action.title)}.`,
      when: due ?? day(action.createdAt),
      who: action.owner || 'nobody named',
      stands: due ? 'overdue' : ACTION_STATUS_LABEL[action.status].toLowerCase(),
      ...behindRecord(action, 'the action register'),
      recordId: action.id,
    });
  }
  for (const decision of project.decisions) {
    if (decision.status !== 'pending') continue;
    waitingLines.push({ kind: 'decision', what: `To be decided: ${titled(decision.title)}.`, when: day(decision.createdAt), who: decision.decisionMaker || 'nobody named', stands: 'pending', ...behindRecord(decision, 'the decision register'), recordId: decision.id });
  }
  // Things read from a meeting's notes and still on cards: one line a meeting. Every other card is a line of its own.
  const cards = (project.chatProposals ?? []).filter((card) => card.status === 'proposed');
  const fromMeeting = new Set<string>();
  for (const meeting of meetingsHeld(project)) {
    const waiting = meeting.items.filter((item) => cards.some((card) => card.id === item.proposalId));
    for (const item of waiting) fromMeeting.add(item.proposalId);
    if (!waiting.length) continue;
    waitingLines.push({
      kind: 'card',
      what: `${counted(waiting.length, 'thing', 'things')} read from the notes of ${meetingCalled(meeting)} ${waiting.length === 1 ? 'waits' : 'wait'} on ${waiting.length === 1 ? 'a card' : 'cards'}, not yet accepted.`,
      when: day(meeting.keptAt),
      who: named(meeting.keptBy),
      stands: 'waiting',
      waits: true,
      behind: `its notes, ${meeting.came}`,
    });
  }
  for (const card of cards) {
    if (fromMeeting.has(card.id)) continue;
    const cited = (card.citedEvidenceIds ?? []).filter((id) => titleOf(id));
    waitingLines.push({
      kind: 'card',
      what: `On a card, not yet accepted: ${card.title.replace(/[.\s]+$/, '')}.`,
      when: day(card.createdAt),
      who: named(card.createdBy),
      stands: 'waiting',
      waits: true,
      behind: cited.length ? titled(titleOf(cited[0]!)!) : 'the card, raised in chat',
      ...(cited.length ? { recordId: cited[0], evidenceIds: cited } : {}),
    });
  }
  for (const row of project.evidence) {
    const waiting = proposedFacts(row).length;
    if (!waiting) continue;
    const filed = (project.audit ?? []).find((event) => event.entityType === 'evidence' && event.entityId === row.id && event.action === 'create');
    waitingLines.push({
      kind: 'values',
      what: `${counted(waiting, 'value', 'values')} read off ${titled(row.title)} ${waiting === 1 ? 'waits' : 'wait'} to be accepted.`,
      when: day(row.modelReadAt ?? row.createdAt),
      who: named(filed?.actor),
      stands: 'waiting',
      waits: true,
      behind: titled(row.title),
      recordId: row.id,
      evidenceIds: [row.id],
    });
  }
  for (const request of project.requests ?? []) {
    if (request.status !== 'sent') continue;
    waitingLines.push({ kind: 'request', what: `Asked for and not received: ${request.title.replace(/[.\s]+$/, '')}.`, when: day(request.sentAt ?? request.createdAt), who: request.recipient || 'nobody named', stands: 'asked for', behind: 'the request', recordId: request.id });
  }

  /* ---- What comes next ---- */
  const next: StatusLine[] = [];
  for (const action of open) {
    const due = action.dueDate?.slice(0, 10);
    if (!due || due < today) continue;
    next.push({ kind: 'action', what: `Due ${meetingDay(due)}: ${titled(action.title)}.`, when: due, who: action.owner || 'nobody named', stands: ACTION_STATUS_LABEL[action.status].toLowerCase(), ...behindRecord(action, 'the action register'), recordId: action.id });
  }
  for (const line of approvalsRegister(project, now)) {
    const until = line.held.map((held) => held.validUntil).filter((value): value is string => Boolean(value)).sort()[0];
    if (line.status !== 'expiring' || !until) continue;
    next.push({ kind: 'approval', what: `Valid until ${meetingDay(until)}: ${line.kind.label}.`, when: until, stands: 'expiring', behind: titled(line.held[0]!.document), recordId: line.held[0]!.evidenceId, evidenceIds: [line.held[0]!.evidenceId] });
  }
  for (const request of project.requests ?? []) {
    const due = request.dueAt?.slice(0, 10);
    if (request.status !== 'sent' || !due || due < today) continue;
    next.push({ kind: 'request', what: `Promised by ${meetingDay(due)}: ${request.title.replace(/[.\s]+$/, '')}.`, when: due, who: request.recipient || 'nobody named', stands: 'asked for', behind: 'the request', recordId: request.id });
  }
  for (const milestone of project.milestones ?? []) {
    const planned = milestone.plannedFinish?.slice(0, 10);
    if (milestone.completedOn || !planned || planned < today) continue;
    next.push({ kind: 'milestone', what: `Planned to finish ${meetingDay(planned)}: ${milestone.name}, now at ${milestone.percent}%.`, when: planned, who: named(milestone.updatedBy), stands: 'in progress', behind: 'the milestone', recordId: milestone.id });
  }
  next.sort((a, b) => ((a.when ?? '') < (b.when ?? '') ? -1 : (a.when ?? '') > (b.when ?? '') ? 1 : 0));

  return { period, changed, waiting: waitingLines, next };
}

/* ==================================================================== */
/* The sections of the report                                             */
/* ==================================================================== */

/** The period a section covers: the one it names, or the seven days up to now for one that names none. */
function periodOf(source: ReportBoundSource, now: Date): StatusPeriod {
  const to = source.to && !Number.isNaN(Date.parse(source.to)) ? source.to : now.toISOString();
  const from = source.from && !Number.isNaN(Date.parse(source.from)) ? source.from : new Date(Date.parse(to) - 7 * DAY_MS).toISOString();
  return { from, to };
}

const SECTION: Record<string, { list: 'changed' | 'waiting' | 'next'; columns: string[]; empty: (said: string) => string }> = {
  status_changed: { list: 'changed', columns: ['No.', 'What changed', 'When', 'Who', 'Stands', 'Behind it'], empty: (said) => `Nothing changed on this project in the period (${said}).` },
  status_waiting: { list: 'waiting', columns: ['No.', 'Waiting', 'Since', 'On whom', 'Stands', 'Behind it'], empty: () => 'Nothing is waiting on anybody.' },
  status_next: { list: 'next', columns: ['No.', 'Next', 'By when', 'On whom', 'Stands', 'Behind it'], empty: () => 'Nothing on the record has a date ahead of it.' },
};

/** The lines of one section as code writes them, cut to the section's length. What a model is given to reword, and what its wording is held to. */
export function statusSectionLines(project: DdProject, source: ReportBoundSource, now = new Date()): { lines: StatusLine[]; more: number; period: StatusPeriod } {
  const section = SECTION[source.kind];
  const period = periodOf(source, now);
  if (!section) return { lines: [], more: 0, period };
  const all = statusReport(project, period, now)[section.list];
  const atMost = STATUS_AT_MOST[section.list];
  // Of what changed, the newest are kept: the list is in the order it happened.
  const lines = section.list === 'changed' ? all.slice(-atMost) : all.slice(0, atMost);
  return { lines, more: all.length - lines.length, period };
}

/**
 * One section of a status report, read from the record as it stands.
 *
 * A table: the line, its day, its person, where it stands and what is behind
 * it. Only the first of these may be a model's wording, and only while the
 * section still gives the very line that wording was made for.
 */
export function resolveStatusBlock(project: DdProject, block: ReportBlock, now = new Date()): ResolvedReportBlock {
  const source = block.source!;
  const section = SECTION[source.kind];
  if (!section) return { lines: [], recordIds: [] };
  const { lines, more, period } = statusSectionLines(project, source, now);
  if (!lines.length) return { lines: [], recordIds: [], note: section.empty(statusPeriodSaid(period)) };
  const wording = source.plain ? [] : (block.wording ?? []);
  const shown = lines.map((line) => {
    const as = wording.find((worded) => worded.said === line.what)?.as;
    return { line, what: as ?? line.what, worded: as !== undefined };
  });
  const reworded = shown.filter((row) => row.worded).length;
  const notes = [
    more > 0 ? `${counted(more, 'more line is', 'more lines are')} not shown: ${section.list === 'changed' ? 'the earliest of the period' : 'the list is cut to its length'}.` : '',
    reworded ? `A model reworded ${counted(reworded, 'line', 'lines')}. The day, the person and what is behind each line are the file’s own.` : '',
  ].filter(Boolean);
  return {
    lines: shown.map(({ line, what }) => [what, line.when ? meetingDay(line.when) : '', line.who ?? '', line.stands, line.behind].filter(Boolean).join(' · ')),
    recordIds: shown.map(({ line }) => line.recordId ?? ''),
    table: {
      columns: section.columns,
      rows: shown.map(({ line, what, worded }, at) => ({
        cells: [String(at + 1), what, line.when ? meetingDay(line.when) : '', line.who ?? '', line.stands, line.behind],
        ...(line.recordId ? { recordId: line.recordId } : {}),
        ...(line.evidenceIds?.length ? { evidenceIds: line.evidenceIds } : {}),
        ...(worded ? { worded: true } : {}),
      })),
    },
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/** What a status report opens as: its three sections, each over the period. */
export function statusTemplate(period: StatusPeriod): Array<{ heading: string; source: ReportBoundSource }> {
  return [
    { heading: `What changed, ${statusPeriodSaid(period)}`, source: { kind: 'status_changed', ...period } },
    { heading: 'Waiting, and on whom', source: { kind: 'status_waiting', ...period } },
    { heading: 'What comes next', source: { kind: 'status_next', ...period } },
  ];
}

/** What a status report is called: who it is for, the project and the period. */
export function statusTitle(project: DdProject, period: StatusPeriod, audience?: string): string {
  return `Status report${audience ? ` for ${audience}` : ''} — ${project.name}, ${statusPeriodSaid(period)}`;
}

/** The period a status report covers, as its sections hold it, in words. Nothing for a report whose sections name none. */
export function statusReportPeriodSaid(report: GeneratedReport): string | undefined {
  const source = report.body.blocks.find((block) => isStatusSource(block.source?.kind) && block.source?.from && block.source.to)?.source;
  return source ? statusPeriodSaid({ from: source.from!, to: source.to! }) : undefined;
}

/** The week so far: the period of a status report nobody named one for. */
export function statusWeekSoFar(now = new Date()): StatusPeriod {
  return { from: startOfWeek(now).toISOString(), to: now.toISOString() };
}

/**
 * The draft already written for a period, if there is one: a status report
 * not yet issued, for the same reader, that starts at the same moment. Asked
 * for again, that draft is the answer, brought up to now, and not a second
 * report.
 */
export function statusDraftFor(project: DdProject, asked: StatusAsked): GeneratedReport | undefined {
  const title = statusTitle(project, asked.period, asked.audience).split(' — ')[0];
  return project.reports.find(
    (report) =>
      report.kind === 'status' &&
      report.status !== 'issued' &&
      report.status !== 'superseded' &&
      report.status !== 'archived' &&
      report.title.split(' — ')[0] === title &&
      report.body.blocks.some((block) => block.source?.kind === 'status_changed' && block.source.from === asked.period.from),
  );
}

/**
 * Bring a draft up to the period now asked for: its sections that still read
 * the record take the new end of the period, and its name and the heading
 * that say the period say the new one. A heading a person changed is theirs
 * and is left. Returns whether anything was changed.
 */
export function statusDraftBroughtTo(project: DdProject, report: GeneratedReport, asked: StatusAsked): boolean {
  let changed = false;
  for (const block of report.body.blocks) {
    const source = block.source;
    if (block.origin !== 'derived' || block.detachedAt || !source || !isStatusSource(source.kind) || source.to === asked.period.to) continue;
    const was = source.from && source.to ? `What changed, ${statusPeriodSaid({ from: source.from, to: source.to })}` : undefined;
    if (source.kind === 'status_changed' && block.heading === was) block.heading = `What changed, ${statusPeriodSaid(asked.period)}`;
    block.source = { ...source, to: asked.period.to };
    changed = true;
  }
  if (changed) report.title = statusTitle(project, asked.period, asked.audience);
  return changed;
}

/* ==================================================================== */
/* What the chat says of it                                               */
/* ==================================================================== */

/** What changed, counted by kind, in a few words: "2 papers filed, 5 values accepted, 1 decision". */
function changedCounted(lines: readonly StatusLine[]): string {
  const of = (...kinds: StatusLineKind[]): number => lines.filter((line) => kinds.includes(line.kind)).length;
  const values = lines.reduce((sum, line) => sum + (line.accepted ?? 0), 0);
  return [
    of('paper', 'approval') ? counted(of('paper', 'approval'), 'paper', 'papers') : '',
    values ? counted(values, 'value accepted', 'values accepted') : '',
    of('decision') ? counted(of('decision'), 'decision', 'decisions') : '',
    of('action_done') ? counted(of('action_done'), 'action done', 'actions done') : '',
    of('action_overdue') ? counted(of('action_overdue'), 'action overdue', 'actions overdue') : '',
    of('finding') ? counted(of('finding'), 'finding raised', 'findings raised') : '',
    of('meeting') ? counted(of('meeting'), 'meeting', 'meetings') : '',
    of('report') ? counted(of('report'), 'report issued', 'reports issued') : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** The one line the chat says for a period nothing happened in. No report is written for it. */
export function statusNothingSaid(asked: StatusAsked): string {
  return `Nothing changed on this project in the period asked for (${statusPeriodSaid(asked.period)}), so no report was written.`;
}

/**
 * What the chat says when a status report is written: the report short, with
 * a way to open it. `reportId` in brackets is drawn as a link to the report.
 */
export function statusSaid(project: DdProject, report: GeneratedReport, asked: StatusAsked, status: StatusReport, written: boolean): string {
  const who = new Map<string, number>();
  for (const line of status.waiting) if (line.who && line.who !== 'nobody named') who.set(line.who, (who.get(line.who) ?? 0) + 1);
  const most = [...who.entries()].sort((a, b) => b[1] - a[1])[0];
  const first = status.next[0];
  return [
    `${written ? 'Wrote the' : 'The'} status report${asked.audience ? ` for ${asked.audience}` : ''}, ${statusPeriodSaid(asked.period)}, ${written ? 'as a draft' : 'is already written as a draft'}: [${report.id}]`,
    ...(asked.noEarlier ? ['No status report has been issued before, so this one starts where the project did.'] : []),
    `- Changed: ${changedCounted(status.changed)}.`,
    status.waiting.length ? `- Waiting: ${counted(status.waiting.length, 'thing', 'things')}${most ? `, ${most[1]} of them on ${most[0]}` : ''}.` : '- Waiting: nothing.',
    first ? `- Next: ${first.what.replace(/\.$/, '')}${first.who && first.who !== 'nobody named' ? `, on ${first.who}` : ''}.` : '- Next: nothing on the record has a date ahead of it.',
    'Every line in it names the record or paper behind it. Read it, edit it and issue it under your name.',
  ].join('\n');
}

/* ==================================================================== */
/* A model's wording, held to the lines                                   */
/* ==================================================================== */

/** How long a reworded line may be. */
export const STATUS_WORDING_LINE = 260;

/** The figures of a line, in order: every run of digits, with the marks that group them taken out. */
const figures = (text: string): string[] => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((run) => run.replaceAll(',', '')).sort();
/** The titles a line quotes. */
const quoted = (text: string): string[] => text.match(/“[^”]*”/g) ?? [];

/** The words of a line outside the titles it quotes, lower case. A shortened "not" is read as the word. */
const wordsOutside = (text: string): string[] =>
  text
    .replace(/“[^”]*”/g, ' ')
    .toLowerCase()
    .replace(/n['’]t\b/g, ' not')
    .match(/\p{L}+/gu) ?? [];

/** Words that only join a line's other words and say nothing of their own. */
const JOINING = new Set(
  'the and but for from with per its was were are has have had been being this that these those also now then than which who whom whose will would there here into onto over under about after before both each any all some such only just very more most less still since until while when where'.split(' '),
);

/** A word without the ending that makes it a plural or puts it in another tense, so that "accepted" and "accepts" count as one word. */
const stemOf = (word: string): string => (word.length > 4 ? word.replace(/(?:ing|ed|es|s)$/, '') : word).replace(/e$/, '');

/** A line's own words: what it says outside the titles it quotes, without its figures and the words that only join. */
const ownWords = (text: string): Set<string> => new Set(wordsOutside(text).filter((word) => word.length >= 3 && !JOINING.has(word)).map(stemOf));

/** How many of these words are among those. */
const among = (these: ReadonlySet<string>, those: ReadonlySet<string>): number => [...these].filter((word) => those.has(word)).length;

const IS_MONTH = new RegExp(`^${MONTH}$`);
/** The months a line names, by their number: Sep and September are one month. */
const monthsNamed = (text: string): string => [...new Set(wordsOutside(text).filter((word) => IS_MONTH.test(word)).map(monthOf))].sort().join('|');

/** The start of each word by which a line says where a thing stands: done, overdue, waiting, accepted, filed, read, open, and the rest. */
const STANDING = /^(?:done|overdue|late|laps|expir|valid|wait|accept|approv|reject|refus|open|clos|decid|pending|issu|filed|filing|read|receiv|promis|plann|complet|finish|settl|clear|resolv|record|cancel|withdr|paid|sign|sent|releas|grant|confirm|agree|delay|early|ahead|behind)/;
/** The words that turn one of those into its opposite. */
const DENYING = new Set(['not', 'no', 'none', 'never', 'nothing', 'nobody', 'neither', 'nor', 'without', 'yet']);

/**
 * What a line says of where things stand: its standing words and the words
 * that deny them, as written, in the order it first says them. "Accepted" and
 * "accepting" are two standings, and so are "expired" and "expiring". Only
 * the ending of a plural is let go, so "1 value waits" and "2 values wait"
 * stand the same.
 */
const standingSaid = (text: string): string =>
  [...new Set(wordsOutside(text).filter((word) => DENYING.has(word) || STANDING.test(word)).map((word) => (word.length > 4 && !word.endsWith('ss') ? word.replace(/s$/, '') : word)))].join('|');

/**
 * A model's wording of some lines, held to the lines.
 *
 * `lines` are the lines as code wrote them, numbered from one, and `said` is
 * what a model answered: a list of `{ n, text }`. A wording is kept for a
 * line only when it names a line that exists, is one line of a sensible
 * length, and still says what the line says:
 *
 * - it has every figure of the line and no other, names the months the line
 *   names and no other, and quotes every title the line quotes and no other;
 * - it says the same of where things stand (`standingSaid`): it adds no
 *   "done", "overdue", "waiting" or "accepted" the line does not have, drops
 *   none it has, puts no "not" in and takes none out, and says them in the
 *   line's order;
 * - most of the line's own words are in it, and most of its own words are the
 *   line's (`ownWords`). Most is two in three. A rewording has to be free to
 *   swap a word or two for a plainer one, and at two in three a line of three
 *   telling words may lose one. At a half, a line of two could keep one and
 *   bring one in, which is another sentence. Counted both ways, because a
 *   wording that keeps the whole line and then says something more has said
 *   something the record did not.
 *
 * The figures and titles alone are not enough: the titles are a paper's name
 * or a line of somebody's notes, quoted inside the line a model is given, and
 * a wording that keeps them can still say the opposite around them. So a
 * model cannot add a line, cannot drop one, and cannot change a date, an
 * amount, the name of a paper or where a thing stands. Wherever its wording
 * fails any of this, the line stays as code wrote it. The person, the day and
 * what is behind a line are not in the words it rewords at all.
 */
export function statusWordingHeld(lines: readonly string[], said: unknown): Array<{ said: string; as: string }> {
  const out = new Map<string, string>();
  for (const item of Array.isArray(said) ? said : []) {
    const { n, text } = (item ?? {}) as { n?: unknown; text?: unknown };
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > lines.length || typeof text !== 'string') continue;
    const line = lines[n - 1]!;
    const as = text.replace(/\s+/g, ' ').trim();
    if (!as || as === line || as.length > STATUS_WORDING_LINE || out.has(line)) continue;
    if (figures(as).join('|') !== figures(line).join('|') || monthsNamed(as) !== monthsNamed(line)) continue;
    if ([...quoted(as)].sort().join('|') !== [...quoted(line)].sort().join('|')) continue;
    if (standingSaid(as) !== standingSaid(line)) continue;
    const [its, ours] = [ownWords(as), ownWords(line)];
    if (among(ours, its) * 3 < ours.size * 2 || among(its, ours) * 3 < its.size * 2) continue;
    out.set(line, as);
  }
  return [...out].map(([line, as]) => ({ said: line, as }));
}

/** The lines of a report's status sections that a model may be asked to reword, in the order they stand, each with the section it is in. */
export function statusLinesToWord(project: DdProject, report: GeneratedReport, now = new Date()): Array<{ blockId: string; line: string }> {
  return report.body.blocks
    .filter((block) => block.origin === 'derived' && isStatusSource(block.source?.kind) && !block.detachedAt && !block.source?.plain)
    .flatMap((block) => statusSectionLines(project, block.source!, now).lines.map((line) => ({ blockId: block.id, line: line.what })));
}

/**
 * Lay a model's wording over a report's status sections. `asked` is what
 * `statusLinesToWord` gave, and `said` the model's answer to it. Returns how
 * many lines were given a wording.
 */
export function keepStatusWording(report: GeneratedReport, asked: ReadonlyArray<{ blockId: string; line: string }>, said: unknown): number {
  const held = statusWordingHeld(asked.map((row) => row.line), said);
  let kept = 0;
  for (const block of report.body.blocks) {
    const own = new Set(asked.filter((row) => row.blockId === block.id).map((row) => row.line));
    if (!own.size) continue;
    const wording = held.filter((worded) => own.has(worded.said));
    if (wording.length) block.wording = wording;
    else delete block.wording;
    kept += wording.length;
  }
  return kept;
}
