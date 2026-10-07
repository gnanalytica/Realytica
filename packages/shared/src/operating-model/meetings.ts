/**
 * The notes of a meeting, kept on the file.
 *
 * People meet, decide, and forget what was said. Notes of a meeting pasted
 * into the chat or dropped as a file are kept as a meeting: the day it was
 * held, who was there, where the words are kept, and what was proposed from
 * them. The words themselves are a file in the project's storage, beside its
 * other files, and never on the record: a project's record is read whole on
 * every request, and notes are long.
 *
 * Notes are not a paper about the land. They are not filed on the register
 * of documents and nothing reads them for a survey number or an extent.
 * Whether some words are notes of a meeting is read from how they are laid
 * out (`meetingNotesSeen`): a heading that says so, a line of who was there,
 * lines marked as decisions and actions. Where that cannot be told the chat
 * asks, and nothing is kept as a meeting or filed as a paper until a person
 * says which.
 *
 * What the notes hold is read as three things: what was decided, what is to
 * be done with who and by when, and what was left open. By rule where the
 * notes mark their lines ("Decision:", "Action: … by Friday", "Open:"), and
 * by a model where one is set up, whose reading is held to the notes' own
 * words (`meetingItemsHeld`): an item is kept only with words found in the
 * notes, a person's name only when those words have it, and a date is read
 * from those words by the rule here and never taken from the model. A date
 * or a name the notes do not give is left empty.
 *
 * Nothing read from notes is on the record. Each item waits on a card, with
 * the words it came from, for a person to accept. Accepted, a decision and
 * an action are the records the project already has for them. A point left
 * open is a decision nobody has made yet: a decision record that stands as
 * pending, which is where "what is still undecided" looks.
 *
 * A meeting knows the cards it raised, and through a card the record that
 * was made of it. So a decision or an action can say which meeting it came
 * from and the words it rests on, with nothing new kept on the decision or
 * the action itself.
 */

import { datesIn } from './document-parse';
import { functionDepartment, workstreamOfCheck, type DepartmentKey } from './departments';
import { allChecks } from './engagements';
import { asksAQuestion } from './instruction';
import { recordAuditEvent } from './operations';
import { projectDepartments } from './team';
import type { ActionKind, ChatChoice, ChatIngestFile, ChatProposal, DdProject } from './types';
import { documentWorkstream } from './vault';
import { createChatProposal } from './wizard';

/** One thing notes say: a decision made, something to be done, or a point left open. */
export type MeetingItemKind = 'decision' | 'action' | 'open';

/** What was read out of notes, before it is on a card. */
export interface MeetingRead {
  kind: MeetingItemKind;
  /** What was decided, what is to be done, or what was left open: one line. */
  text: string;
  /** For something to be done: who it is on, as the notes name them. */
  owner?: string;
  /** And the day it is due, when the notes' words give one. */
  dueDate?: string;
  /** The words of the notes it came from. */
  quote: string;
  /** Who read it out of the notes: this server's rules, or a model. */
  readBy: 'rules' | 'model';
}

export interface MeetingItem extends MeetingRead {
  id: string;
  /** The card raised for it. The record made of it, once accepted, is the card's. */
  proposalId: string;
}

/** A whole reading of some notes. */
export interface MeetingReading {
  title?: string;
  heldOn?: string;
  attendees: string[];
  items: MeetingRead[];
  /** True when a model read the notes as well as the rules, whatever it found. */
  byModel?: boolean;
}

/** Where the words of a meeting's notes are kept: a file in the project's storage. */
export interface MeetingFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MeetingRecord {
  id: string;
  title: string;
  /** The day it was held, when the notes say. */
  heldOn?: string;
  /** Who was there, as the notes name them. */
  attendees: string[];
  /** Where the words are kept. The record holds none of them but the few each item quotes. */
  file: MeetingFile;
  /** How the notes came: pasted into the chat, or dropped as a file. */
  came: 'pasted' | 'dropped';
  /** What was proposed from them. */
  items: MeetingItem[];
  /** The page of the menu the chat was on. */
  place?: { department?: string; fn?: string };
  /** A short digest of the words, so the same notes given twice are one meeting. */
  digest?: string;
  /**
   * Set while this is not yet a meeting. `asked`: the chat could not tell
   * whether the words are notes of a meeting, and has asked. `paper`: a person
   * answered that the file is a document, and it is on its way to the register.
   */
  standing?: 'asked' | 'paper';
  keptAt: string;
  keptBy: string;
}

/** How many items one meeting's notes are read for, and how long a line of one may be. */
export const MEETING_ITEMS_AT_MOST = 40;
export const MEETING_LINE = 200;
export const MEETING_QUOTE = 240;

/* ==================================================================== */
/* Whether words are notes of a meeting                                   */
/* ==================================================================== */

/** A heading that says notes or minutes, with the meeting named in a word or two: "Minutes of the site meeting", "Notes from the client meeting". */
const HEADING = /\b(?:(?:minutes|notes) (?:of|from) (?:the |a |our )?(?:[\w’'-]+ ){0,3}meeting|meeting minutes|meeting notes|record of (?:the |a )?(?:meeting|discussion)|mom)\b/i;
/** A first line that is only the word: "Minutes", "Notes:". */
const HEADED_ONLY = /^[\s>#*_-]*(?:minutes|notes)[\s:.*_–-]*$/i;
const NAMED_AS_NOTES = /\b(?:minutes|meeting|mom)\b/i;
const PRESENT = /^[ \t>*#-]*(?:attendees|attendance|present|participants|in attendance|attended by|members present)\b[^\n:]{0,20}:/im;
const HELD = /^[ \t>*#-]*(?:date|held on|meeting date|date of (?:the )?meeting)\b[^\n:]{0,10}:[ \t]*(.*)$/im;
const AGENDA = /^[ \t>*#-]*agenda\b/im;
const TALK = /\b(?:discussed|it was agreed|agreed that|next meeting|action items?|action points?)\b/i;
/** A body's own formal meeting: a company's board, a society's general body. Its minutes can be a paper of title, so the chat asks. */
const FORMAL_BODY = /\b(?:board of directors|board resolution|resolved that|general body|company secretary|certified true copy|extract of the minutes)\b/i;

const BULLET = String.raw`[ \t]*(?:[-*•–]|\d{1,2}[.)]|[a-z][.)])?[ \t]*`;
const DECISION_WORDS = String.raw`decisions?(?: taken| made)?|decided|agreed|resolutions?|key decisions`;
const ACTION_WORDS = String.raw`actions?|action items?|action points?|to[- ]?dos?|tasks?|next steps|follow[- ]?ups?`;
const OPEN_WORDS = String.raw`open|open points?|open items?|open issues?|open questions?|pending|pending items?|unresolved|parked|to be decided|tbd`;

const MARKED = new RegExp(String.raw`^${BULLET}(?:(${DECISION_WORDS})|(${ACTION_WORDS})|(${OPEN_WORDS}))(?:[ \t]+\d{1,2})?[ \t]*[:–-][ \t]*(\S.*)$`, 'i');
const SECTION = new RegExp(String.raw`^[ \t#*_]*(?:\d{1,2}[.)][ \t]*)?(?:(${DECISION_WORDS})|(${ACTION_WORDS})|(${OPEN_WORDS}))[ \t*_]*:?[ \t]*$`, 'i');
/** A short line that heads something else: it ends a section of decisions, actions or open points. */
const OTHER_HEADING = /^[ \t]*(?:#{1,4}[ \t]+\S.*|[A-Z][^.!?\n]{0,48}:[ \t]*)$/;

/** The lines of some notes, without the marks a reader of pages puts between them. */
function linesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\[page \d+\]$/.test(line.trim()));
}

/**
 * Whether some words are the notes of a meeting: `yes`, `no`, or `maybe`
 * where it cannot be told and a person is asked.
 *
 * Read from how the words are laid out. A heading that says they are notes
 * or minutes, a line of who was there, a line with the date, an agenda, and
 * lines marked as decisions, actions and open points each count. Yes takes a
 * heading or a line of who was there, and more besides. The minutes of a
 * company's board or a society's general body are never a plain yes: they
 * may be a paper of title, so a person says.
 */
export function meetingNotesSeen(text: string, fileName = ''): 'yes' | 'maybe' | 'no' {
  return layoutOf(text, fileName).seen;
}

/**
 * How some words are laid out: the lines that are not blank, whether they
 * open under a heading that says notes or minutes, whether they hold what
 * notes hold (who was there, the day, a line marked as a decision, an action
 * or an open point), and what that comes to.
 *
 * In a typed message a line that asks a question heads nothing, whatever it
 * mentions ("In the meeting notes, what does this mean?"), unless it hands
 * the notes over.
 */
function layoutOf(text: string, fileName = '', typed = false): { lines: string[]; heading: boolean; present: boolean; marked: number; items: boolean; seen: 'yes' | 'maybe' | 'no' } {
  const lines = linesOf(text).filter((line) => line.trim());
  const first = lines.slice(0, 6).filter((line) => !typed || !asksAQuestion(line) || HANDS_OVER.test(opening(line)));
  const heading = HEADING.test(first.join('\n')) || HEADED_ONLY.test(first[0] ?? '') || NAMED_AS_NOTES.test(fileName.replace(/[_.-]+/g, ' '));
  const present = PRESENT.test(text);
  const held = HELD.test(text);
  const marked = lines.filter((line) => MARKED.test(line) || SECTION.test(line)).length;
  const score = (heading ? 3 : 0) + (present ? 2 : 0) + (held ? 1 : 0) + (AGENDA.test(text) ? 1 : 0) + Math.min(marked, 3) + (TALK.test(text) ? 1 : 0);
  const formal = FORMAL_BODY.test(text);
  const seen = lines.length < 2 ? 'no' : (heading || present) && score >= 4 && !formal ? 'yes' : score >= 3 || (score >= 2 && (lines.length >= 3 || marked >= 2)) ? 'maybe' : 'no';
  return { lines, heading, present, marked, items: present || held || marked > 0, seen };
}

/**
 * Whether a file dropped into the chat is the notes of a meeting. Never one
 * no words were read from.
 *
 * The rules that read papers go by the words a paper uses, and notes of a
 * meeting about a property use the same words: they talk of the survey
 * sketch and the encumbrance certificate. So a file the rules read as a
 * paper is still asked about when it is laid out as notes, with a heading,
 * who was there and what was decided. Two readings disagree there, and a
 * person says which it is: notes are not filed as a paper, and a paper that
 * recites a meeting is not kept as one, without anybody having said so.
 */
export function meetingNotesDropped(file: ChatIngestFile): 'yes' | 'maybe' | 'no' {
  if (!file.excerpt?.trim()) return 'no';
  const seen = meetingNotesSeen(file.excerpt, file.fileName);
  if (file.read && file.read.type !== 'other') return seen === 'yes' ? 'maybe' : 'no';
  return seen;
}

/**
 * What a file dropped on this project is taken for: the notes of a meeting
 * (`yes`), words a person is asked about (`maybe`), or a paper (`no`).
 *
 * Asked in two places that have to agree: where the file is read, which puts
 * a paper on the register the moment it is read and must not put notes
 * there, and the chat's rules, which keep the notes as a meeting. A paper it
 * is, whatever its words look like, when it is on the register already, when
 * it was put there as it was read, or when a person has said the held file
 * is a document.
 */
export function meetingNotesFor(project: DdProject, file: ChatIngestFile): 'yes' | 'maybe' | 'no' {
  if (file.landed) return 'no';
  if ((project.meetings ?? []).some((held) => held.standing === 'paper' && held.file.storageKey === file.storageKey)) return 'no';
  if (project.evidence.some((row) => row.attachments.some((attached) => attached.storageKey === file.storageKey))) return 'no';
  return meetingNotesDropped(file);
}

/** How a message opens when it asks for something: "can you", "please", a question word, or a verb that tells the chat what to do. */
const OPENS_ASKING = new RegExp(
  [
    String.raw`^(?:please|kindly|can you|could you|would you|will you|can we|could we|shall we|should we|can i|could i|may i|i need|i want|i would like|i'd like|we need|we want|let's|let us|help me)\b`,
    String.raw`^(?:what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|has|have|had)\b(?!\s*:)`,
    String.raw`^(?:check|find|look|search|read|show|open|list|tell|give|get|send|share|draft|write|prepare|make|create|summari[sz]e|compare|explain|remind|update)\s+(?:me|us|the|a|an|my|our|this|that|these|those|up|out|through|for|at|into|whether|if|what|who|when|how|all|any|every)\b`,
  ].join('|'),
  'i',
);
/**
 * A first line that hands notes over to be kept: "keep these notes", "here
 * are the minutes", "please find the minutes below". It leads into a paste
 * and asks for nothing else.
 */
const HANDS_OVER = /^(?:(?:please|kindly|can you|could you|would you|will you)\s+)*(?:keep|save|file|record|log|store|add|take|note)\b.*\b(?:notes|minutes|mom)\b|^(?:here|these|those|below|following|attached)\b.*\b(?:notes|minutes|mom)\b|^(?:(?:please|kindly)\s+)?(?:find|see)\b(?=.*\b(?:below|attached|enclosed)\b).*\b(?:notes|minutes|mom)\b/i;

/** A line as it opens, without the marks a paste puts in front of it. */
const opening = (line: string): string => line.replace(/^[\s>#*_-]+/, '').replace(/[’‘]/g, "'");

/**
 * Whether words typed or pasted into the chat are the notes of a meeting. A
 * message of a line or two is a message, whatever it mentions.
 *
 * Kept at once: a heading that says notes or minutes anywhere in the first
 * lines, and under it what notes hold (who was there, the day, or a line
 * marked as a decision, an action or an open point). A polite line over them
 * changes nothing ("Please find below the minutes of the meeting"). A first
 * line that only names the meeting ("Weekly progress meeting, 3 Oct 2026")
 * heads notes when who was there and a marked line stand under it.
 *
 * Answered as a question: a message that asks for something and holds
 * nothing notes hold. "Can you check the meeting notes from last week?" typed
 * over three lines says "meeting notes" and is a question.
 *
 * Anything in between that still reads as notes is asked about.
 */
export function meetingNotesPasted(text: string): 'yes' | 'maybe' | 'no' {
  const layout = layoutOf(text, '', true);
  if (layout.lines.length < 3) return 'no';
  const first = opening(layout.lines[0]!);
  const asks = !HANDS_OVER.test(first) && (asksAQuestion(first) || OPENS_ASKING.test(first));
  const named = layout.present && layout.marked > 0 && /\bmeeting\b/i.test(first) && (!asks || /:\s*$/.test(first));
  if (layout.seen === 'yes' && ((layout.heading && layout.items) || named)) return 'yes';
  if (!layout.items && (asks || asksAQuestion(text))) return 'no';
  return layout.seen === 'yes' ? 'maybe' : layout.seen;
}

/* ==================================================================== */
/* Reading dates and names out of the notes' words                        */
/* ==================================================================== */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const iso = (y: number, m: number, d: number): string | undefined => {
  const day = new Date(Date.UTC(y, m - 1, d));
  // A day that is not in its month is no day: 31 February is refused, not read as March.
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day.toISOString().slice(0, 10) : undefined;
};

const plusDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The day some words state, or nothing.
 *
 * A date written out in full is read as the rules read one. A day and a
 * month with no year, a weekday, "tomorrow" and "the end of the month" say a
 * day only beside another: they are read from the day the meeting was held,
 * as the next such day after it, and are left unread where the notes do not
 * say when the meeting was. Nothing here is guessed from today's date.
 */
export function meetingDayIn(words: string, heldOn?: string): string | undefined {
  const full = datesIn(words)[0];
  if (full) return full;
  const text = words.toLowerCase();
  const monthFirst = new RegExp(String.raw`\b${MONTH}\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?,?[ \t]+(\d{4})\b`).exec(text);
  if (monthFirst) return iso(Number(monthFirst[3]), MONTHS.indexOf(monthFirst[1]!.slice(0, 3)) + 1, Number(monthFirst[2]));
  if (!heldOn) return undefined;
  const year = Number(heldOn.slice(0, 4));
  const dayMonth = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[ \t]+(?:of[ \t]+)?${MONTH}\b`).exec(text) ?? undefined;
  const monthDay = dayMonth ? undefined : (new RegExp(String.raw`\b${MONTH}\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?\b`).exec(text) ?? undefined);
  const named = dayMonth ? { d: Number(dayMonth[1]), m: MONTHS.indexOf(dayMonth[2]!.slice(0, 3)) + 1 } : monthDay ? { d: Number(monthDay[2]), m: MONTHS.indexOf(monthDay[1]!.slice(0, 3)) + 1 } : undefined;
  if (named) {
    const thisYear = iso(year, named.m, named.d);
    // A day already gone when the meeting was held is that day next year.
    return thisYear && thisYear < heldOn ? iso(year + 1, named.m, named.d) : thisYear;
  }
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(String.raw`\b${name}\b`).test(text));
  if (weekday !== -1) {
    const held = new Date(`${heldOn}T00:00:00Z`).getUTCDay();
    return plusDays(heldOn, (weekday - held + 7) % 7 || 7);
  }
  if (/\btomorrow\b/.test(text)) return plusDays(heldOn, 1);
  if (/\bend of (?:the |this )?month\b|\bmonth[- ]end\b/.test(text)) return new Date(Date.UTC(year, Number(heldOn.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return undefined;
}

/** The words that say by when: what follows "by", "before", "due", "deadline". */
const DUE = /\b(?:by|before|due(?:[ \t]+(?:on|by))?|on or before|deadline|until|till|eta)\b[ \t:]*([^.;()\n]{3,48})/gi;

/** The day something is due, read from the words that say so, or nothing. */
export function meetingDueIn(words: string, heldOn?: string): string | undefined {
  for (const found of words.matchAll(DUE)) {
    const day = meetingDayIn(found[1]!, heldOn);
    if (day) return day;
  }
  return undefined;
}

const NAME = String.raw`[A-Z][\p{L}.'-]*(?:[ \t]+[A-Z][\p{L}.'-]*){0,2}`;
/** Words that open a sentence with a capital and are nobody's name. */
const NOBODY = /^(?:We|I|It|They|This|That|The|All|Everyone|Somebody|Someone|Nobody|Need|Needs|Action|Decision|Open|Pending|To)$/;
const OWNER_SAID = new RegExp(String.raw`\b(?:owner|responsible|responsibility|assigned to|by whom)[ \t]*[:–-][ \t]*(${NAME})`, 'u');
const OWNER_LEADS = new RegExp(String.raw`^(${NAME})[ \t]+(?:to|will|shall|must|should)\b`, 'u');
const OWNER_PREFIX = new RegExp(String.raw`^(${NAME}):[ \t]+\S`, 'u');
const OWNER_TRAILS = new RegExp(String.raw`[(\[][ \t]*(${NAME})[ \t]*[)\]][ \t.]*$`, 'u');

/** Who something is on, where the line names them: "Owner: …", "Ravi to …", "Ravi: …", or a name in brackets at its end. */
function ownerIn(line: string): string | undefined {
  for (const form of [OWNER_SAID, OWNER_LEADS, OWNER_PREFIX, OWNER_TRAILS]) {
    const name = form.exec(line)?.[1]?.trim();
    if (name && !NOBODY.test(name.split(/\s+/)[0]!) && !meetingDayIn(name, '2000-01-01')) return name;
  }
  return undefined;
}

/** A name as the record keeps it: no address for mail and no number with it, one short line. */
function nameOnly(raw: string): string | undefined {
  const name = raw
    .replace(/\S+@\S+/g, '')
    .replace(/\+?\d[\d \t().-]{5,}\d/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s>*•–-]+|[\s,;:.–-]+$/g, '')
    .replace(/\s+/g, ' ');
  return name && name.length <= 60 && /\p{L}{2}/u.test(name) ? name : undefined;
}

/** One line as an item keeps it: its spaces closed up, cut at a word where it runs long. */
function oneLine(text: string, atMost: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= atMost) return line;
  const cut = line.slice(0, atMost - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), atMost - 30)).trimEnd()}…`;
}

/* ==================================================================== */
/* Reading notes by rule                                                  */
/* ==================================================================== */

/**
 * What notes say, read by rule: the meeting's name, the day it was held, who
 * was there, and the lines the notes mark as decisions, actions and open
 * points. A line is marked by a word and a colon before it ("Decision: …"),
 * or by standing under a heading of that word ("Action items"). A first line
 * that asks for the notes to be kept, or hands them over ("Please find below
 * the minutes of the meeting"), is no name for the meeting.
 */
export function readMeetingNotes(text: string): MeetingReading {
  const lines = linesOf(text);
  const first = lines.find((line) => line.trim());
  const cleaned = first?.replace(/^[\s#*_>-]+|[\s#*_:]+$/g, '') ?? '';
  const named = cleaned && cleaned.length <= 100 && !MARKED.test(first!) && !PRESENT.test(first!) && !HELD.test(first!);
  const title = named && !OPENS_ASKING.test(opening(first!)) && !HANDS_OVER.test(opening(first!)) ? cleaned : undefined;

  const heldLine = HELD.exec(text)?.[1];
  const heldOn = (heldLine ? meetingDayIn(heldLine) : undefined) ?? (title ? meetingDayIn(title) : undefined) ?? meetingDayIn(lines.slice(0, 6).join(' '));

  const attendees: string[] = [];
  const at = lines.findIndex((line) => PRESENT.test(line));
  if (at !== -1) {
    const rest = lines[at]!.slice(lines[at]!.indexOf(':') + 1);
    const listed = rest.trim()
      ? rest.split(/[,;]|\band\b/)
      : (() => {
          const under: string[] = [];
          for (const line of lines.slice(at + 1)) {
            if (!line.trim() || SECTION.test(line) || MARKED.test(line) || OTHER_HEADING.test(line)) break;
            under.push(line);
          }
          return under;
        })();
    for (const raw of listed) {
      const name = nameOnly(raw);
      if (name && !attendees.includes(name) && attendees.length < 20) attendees.push(name);
    }
  }

  const items: MeetingRead[] = [];
  let section: MeetingItemKind | undefined;
  const kindOf = (found: RegExpExecArray): MeetingItemKind => (found[1] ? 'decision' : found[2] ? 'action' : 'open');
  for (const line of lines) {
    if (items.length >= MEETING_ITEMS_AT_MOST) break;
    const heading = SECTION.exec(line);
    if (heading) {
      section = kindOf(heading);
      continue;
    }
    const marked = MARKED.exec(line);
    const body = marked ? marked[4]! : section && line.trim() ? line.replace(new RegExp(`^${BULLET}`), '') : undefined;
    if (!marked && section && OTHER_HEADING.test(line)) {
      section = undefined;
      continue;
    }
    if (!body || body.trim().length < 4) continue;
    const kind = marked ? kindOf(marked) : section!;
    const owner = kind === 'action' ? ownerIn(body.trim()) : undefined;
    const dueDate = kind === 'action' ? meetingDueIn(body, heldOn) : undefined;
    items.push({ kind, text: oneLine(body, MEETING_LINE), ...(owner ? { owner } : {}), ...(dueDate ? { dueDate } : {}), quote: oneLine(line, MEETING_QUOTE), readBy: 'rules' });
  }
  return { ...(title ? { title } : {}), ...(heldOn ? { heldOn } : {}), attendees, items };
}

/* ==================================================================== */
/* Holding a model's reading to the notes' own words                      */
/* ==================================================================== */

/** What a model says it read: nothing in it is believed until it is held to the notes. */
export interface MeetingSaidByModel {
  items?: Array<{ kind?: unknown; text?: unknown; owner?: unknown; quote?: unknown }>;
}

/** Letters and digits of any script, lower-cased, everything else one space: the form words are looked for in. */
function plain(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

/**
 * A model's reading of notes, held to the notes' own words.
 *
 * An item is kept only when the words it quotes are in the notes. A person's
 * name is kept only when those quoted words have it. The day something is
 * due is never the model's: it is read from the quoted words by the rule
 * here, so a date the notes do not give stays empty whatever a model said.
 */
export function meetingItemsHeld(notes: string, said: MeetingSaidByModel, heldOn?: string): MeetingRead[] {
  const words = ` ${plain(notes)} `;
  const out: MeetingRead[] = [];
  for (const item of Array.isArray(said.items) ? said.items : []) {
    if (out.length >= MEETING_ITEMS_AT_MOST) break;
    if (item.kind !== 'decision' && item.kind !== 'action' && item.kind !== 'open') continue;
    if (typeof item.text !== 'string' || typeof item.quote !== 'string') continue;
    const quoted = plain(item.quote);
    if (quoted.split(' ').length < 3 || !words.includes(` ${quoted} `)) continue;
    const text = oneLine(item.text, MEETING_LINE);
    if (text.length < 4) continue;
    const name = item.kind === 'action' && typeof item.owner === 'string' ? nameOnly(item.owner) : undefined;
    const owner = name && ` ${quoted} `.includes(` ${plain(name)} `) ? name : undefined;
    const dueDate = item.kind === 'action' ? meetingDueIn(item.quote, heldOn) : undefined;
    out.push({ kind: item.kind, text, ...(owner ? { owner } : {}), ...(dueDate ? { dueDate } : {}), quote: oneLine(item.quote, MEETING_QUOTE), readBy: 'model' });
  }
  return out;
}

/**
 * Two readings of the same notes as one: every line the rules read, and what
 * a model read from words the rules did not. Where both read the same words,
 * the rules' reading is the one kept.
 */
export function meetingItemsTogether(byRule: readonly MeetingRead[], byModel: readonly MeetingRead[]): MeetingRead[] {
  const out = [...byRule];
  for (const item of byModel) {
    const quoted = plain(item.quote);
    const read = out.some((held) => {
      const other = plain(held.quote);
      return other.includes(quoted) || quoted.includes(other);
    });
    if (!read && out.length < MEETING_ITEMS_AT_MOST) out.push(item);
  }
  return out;
}

/* ==================================================================== */
/* Keeping a meeting, and the cards for what its notes say                */
/* ==================================================================== */

const DAY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day as it is written for a person: 6 Oct 2026. */
export function meetingDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return y && m && d ? `${d} ${DAY_MONTHS[m - 1]} ${y}` : day;
}

/** What a meeting is called in a sentence: "the meeting of 3 Oct 2026", or by its name where the notes give no day. */
export function meetingCalled(meeting: Pick<MeetingRecord, 'title' | 'heldOn'>): string {
  return meeting.heldOn ? `the meeting of ${meetingDay(meeting.heldOn)}` : `the meeting “${meeting.title}”`;
}

/** The kind of action some words ask for: a paper to get, an application to make, a visit, or a thing to settle. */
function actionKindOf(text: string): ActionKind {
  if (/\b(?:obtain|collect|get|share|send|submit|provide|furnish|upload)\b.*\b(?:copy|certificate|deed|document|drawing|plan|report|receipt|ec|khata|rtc|noc|sketch|extract)\b/i.test(text)) return 'evidence_request';
  if (/\b(?:apply|application|file for|renew)\b/i.test(text)) return 'approval_submission';
  if (/\b(?:inspect|site visit|visit the site|re-?inspect)\b/i.test(text)) return 'reinspection';
  if (/\b(?:decide|confirm whether|take a call)\b/i.test(text)) return 'decision_request';
  return 'clarification';
}

/** The card for one item: what it would put on the record, and the words of the notes it came from. */
function cardFor(meeting: MeetingRecord, item: MeetingRead, itemId: string, actor: string): ChatProposal {
  const from = meetingCalled(meeting);
  const From = `${from.charAt(0).toUpperCase()}${from.slice(1)}`;
  const says = `The notes say: “${item.quote}”`;
  const link = { quotes: [{ text: item.quote }], meetingId: meeting.id, meetingItemId: itemId };
  if (item.kind === 'action') {
    const who = item.owner ? `On ${item.owner}` : 'The notes name nobody for it';
    const when = item.dueDate ? `due ${meetingDay(item.dueDate)}` : 'with no date given';
    return createChatProposal(
      'add_action',
      `Action: ${item.text}`,
      `From ${from}. ${who}, ${when}. ${says}`,
      'Recorded as an action on this project.',
      { title: item.text, kind: actionKindOf(item.text), owner: item.owner ?? '', priority: 'medium', ...(item.dueDate ? { dueDate: item.dueDate } : {}), description: `From ${from}.`, ...link },
      actor,
    );
  }
  const made = item.kind === 'decision';
  return createChatProposal(
    'add_decision',
    `${made ? 'Decision' : 'Open point'}: ${item.text}`,
    `${made ? 'Decided at' : 'Left open at'} ${from}. ${says}`,
    made ? 'Recorded as a decision on this project.' : 'Recorded as a decision still to be made.',
    {
      title: item.text,
      decisionType: 'other',
      decisionMaker: made ? From : '',
      rationale: `${made ? 'Decided at' : 'Left open at'} ${from}.`,
      status: made ? 'approved' : 'pending',
      ...link,
    },
    actor,
  );
}

let made = 0;
const mint = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${(made += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A short digest of some words: the same notes give the same one, whatever their spacing. */
export function meetingDigest(text: string): string {
  let h = 5381;
  const words = plain(text);
  for (let i = 0; i < words.length; i += 1) h = (Math.imul(h, 33) ^ words.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}${words.length.toString(16)}`;
}

export interface MeetingToKeep {
  file: MeetingFile;
  came: MeetingRecord['came'];
  reading: MeetingReading;
  place?: MeetingRecord['place'];
  digest?: string;
}

/**
 * Notes of a meeting as the chat's rules are handed them by the caller, which
 * is the one that can reach storage and a model. `keep`: these are notes,
 * read, to be kept (`askedId` when they are what the chat had asked about).
 * `ask`: it cannot be told whether they are notes, so a person is asked.
 * `not`: a person said what was held is no meeting. `more`: a kept meeting's
 * notes were read again, and this is what the reading found. `say`: a line
 * for when the words could not be read back.
 */
export type MeetingGiven =
  | { keep: MeetingToKeep; askedId?: string }
  | { ask: { file: MeetingFile; came: MeetingRecord['came'] } }
  | { not: string }
  | { more: { meetingId: string; items: MeetingRead[]; byModel?: boolean } }
  | { say: string };

/**
 * Keep a meeting on the file and make the cards for what its notes say.
 *
 * The meeting is kept at once: the notes are the person's own, as a paper
 * they drop is. What the notes would put on the record is not: each item is
 * a card, returned here for the caller to offer, and nothing is a decision
 * or an action until a person accepts it. `asked` is the meeting the chat
 * had asked about, when a person has now said it is one.
 */
export function keepMeeting(project: DdProject, given: MeetingToKeep, actor: string, asked?: MeetingRecord): { meeting: MeetingRecord; cards: ChatProposal[] } {
  const at = new Date().toISOString();
  const { reading } = given;
  const meeting: MeetingRecord = asked ?? { id: mint('mtg'), title: '', attendees: [], file: given.file, came: given.came, items: [], keptAt: at, keptBy: actor };
  meeting.title = reading.title ?? (reading.heldOn ? `Meeting, ${meetingDay(reading.heldOn)}` : given.file.fileName.replace(/\.[A-Za-z0-9]{2,5}$/, ''));
  if (reading.heldOn) meeting.heldOn = reading.heldOn;
  meeting.attendees = reading.attendees;
  if (given.place?.department || given.place?.fn) meeting.place = given.place;
  if (given.digest) meeting.digest = given.digest;
  delete meeting.standing;
  meeting.keptAt = at;
  meeting.keptBy = actor;
  const cards: ChatProposal[] = [];
  meeting.items = reading.items.slice(0, MEETING_ITEMS_AT_MOST).map((item) => {
    const id = mint('mi');
    const card = cardFor(meeting, item, id, actor);
    cards.push(card);
    return { ...item, id, proposalId: card.id };
  });
  if (!asked) project.meetings = [...(project.meetings ?? []), meeting];
  recordAuditEvent(project, { actor, action: 'create', entityType: 'meeting', entityId: meeting.id, newValue: meeting.title, at });
  return { meeting, cards };
}

/**
 * Add to a kept meeting what a later reading of its notes found: the items
 * it does not already hold, each on a card of its own. Returns the cards.
 */
export function addMeetingItems(meeting: MeetingRecord, items: readonly MeetingRead[], actor: string): ChatProposal[] {
  const fresh = meetingItemsTogether(meeting.items, items).slice(meeting.items.length);
  const cards: ChatProposal[] = [];
  for (const item of fresh) {
    if (meeting.items.length >= MEETING_ITEMS_AT_MOST) break;
    const id = mint('mi');
    const card = cardFor(meeting, item, id, actor);
    cards.push(card);
    meeting.items.push({ ...item, id, proposalId: card.id });
  }
  return cards;
}

/** Hold words the chat could not tell are notes of a meeting, until a person says. Nothing of it is a meeting yet. */
export function askAboutMeeting(project: DdProject, file: MeetingFile, came: MeetingRecord['came'], actor: string, place?: MeetingRecord['place']): MeetingRecord {
  const meeting: MeetingRecord = { id: mint('mtg'), title: file.fileName, attendees: [], file, came, items: [], standing: 'asked', keptAt: new Date().toISOString(), keptBy: actor, ...(place?.department || place?.fn ? { place } : {}) };
  project.meetings = [...(project.meetings ?? []), meeting];
  return meeting;
}

/** Let go of words that turned out not to be a meeting's notes. */
export function dropMeeting(project: DdProject, meetingId: string): void {
  project.meetings = (project.meetings ?? []).filter((meeting) => meeting.id !== meetingId);
}

/** The meetings kept on the file, the latest first. Not what the chat has only asked about. */
export function meetingsHeld(project: DdProject): MeetingRecord[] {
  return (project.meetings ?? [])
    .filter((meeting) => !meeting.standing)
    .sort((a, b) => ((a.heldOn ?? a.keptAt.slice(0, 10)) < (b.heldOn ?? b.keptAt.slice(0, 10)) ? 1 : -1));
}

/** The words the chat is still waiting to be told about, in the order it was given them. */
export function meetingsAsked(project: DdProject): MeetingRecord[] {
  return (project.meetings ?? []).filter((meeting) => meeting.standing === 'asked');
}

/** The one the chat's question is about now: it asks about one at a time, the earliest first. */
export function meetingAskedNow(project: DdProject): MeetingRecord | undefined {
  return meetingsAsked(project)[0];
}

/** The meeting whose notes were kept last, which is the one "read the meeting notes" means. */
export function meetingKeptLast(project: DdProject): MeetingRecord | undefined {
  return meetingsHeld(project).sort((a, b) => (a.keptAt < b.keptAt ? 1 : -1))[0];
}

/**
 * The meeting a decision or an action came out of, and the item of its notes
 * it was made from: found through the card that made the record.
 */
export function meetingOfRecord(project: DdProject, recordId: string): { meeting: MeetingRecord; item: MeetingItem } | undefined {
  if (!project.meetings?.length) return undefined;
  const cards = new Set((project.chatProposals ?? []).filter((card) => card.committedRecordId === recordId).map((card) => card.id));
  if (!cards.size) return undefined;
  for (const meeting of project.meetings ?? []) {
    const item = meeting.items.find((held) => cards.has(held.proposalId));
    if (item && !meeting.standing) return { meeting, item };
  }
  return undefined;
}

/** Where an item of a meeting's notes stands: waiting on its card, on the record, or set aside. */
export function meetingItemStands(project: DdProject, item: MeetingItem): { standing: 'waiting' | 'recorded' | 'set_aside'; recordId?: string } {
  const card = (project.chatProposals ?? []).find((held) => held.id === item.proposalId);
  if (card?.status === 'committed') return { standing: 'recorded', ...(card.committedRecordId ? { recordId: card.committedRecordId } : {}) };
  return { standing: card?.status === 'proposed' ? 'waiting' : 'set_aside' };
}

/** A meeting as it is shown when its notes are opened: everything but the words, with where each item stands. */
export interface MeetingShown {
  id: string;
  title: string;
  heldOn?: string;
  attendees: string[];
  came: MeetingRecord['came'];
  fileName: string;
  keptAt: string;
  keptBy: string;
  items: Array<MeetingItem & { standing: 'waiting' | 'recorded' | 'set_aside'; recordId?: string }>;
}

export function meetingShown(project: DdProject, meeting: MeetingRecord): MeetingShown {
  return {
    id: meeting.id,
    title: meeting.title,
    ...(meeting.heldOn ? { heldOn: meeting.heldOn } : {}),
    attendees: meeting.attendees,
    came: meeting.came,
    fileName: meeting.file.fileName,
    keptAt: meeting.keptAt,
    keptBy: meeting.keptBy,
    items: meeting.items.map((item) => ({ ...item, ...meetingItemStands(project, item) })),
  };
}

/* ==================================================================== */
/* What the chat says                                                     */
/* ==================================================================== */

/**
 * The mark an answer puts where a meeting's notes can be opened: the
 * meeting, and the item whose words to open them at. The chat draws it as a
 * link to the notes.
 */
export function meetingNotesMark(meetingId: string, itemId?: string): string {
  return `[notes:${meetingId}${itemId ? `:${itemId}` : ''}]`;
}

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line for a kept meeting: its name and day, who was there, and what its notes gave. */
function meetingLine(project: DdProject, meeting: MeetingRecord): string {
  const of = (kind: MeetingItemKind) => meeting.items.filter((item) => item.kind === kind);
  const waiting = meeting.items.filter((item) => meetingItemStands(project, item).standing === 'waiting').length;
  const gave = [
    of('decision').length ? counted(of('decision').length, 'decision', 'decisions') : '',
    of('action').length ? counted(of('action').length, 'action', 'actions') : '',
    of('open').length ? counted(of('open').length, 'open point', 'open points') : '',
  ].filter(Boolean);
  const named = meeting.heldOn && !meeting.title.includes(meetingDay(meeting.heldOn)) ? `${meeting.title}, ${meetingDay(meeting.heldOn)}` : meeting.title;
  return [
    `${named} ${meetingNotesMark(meeting.id)}`,
    meeting.attendees.length ? `present: ${meeting.attendees.join(', ')}` : '',
    gave.length ? `${gave.join(', ')}${waiting ? `, ${waiting} still waiting to be accepted` : ''}` : 'nothing marked as a decision, an action or an open point',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the chat says when a meeting's notes have just been kept. `modelCanRead`: a model is set up and has not read these yet. */
export function meetingKeptSaid(project: DdProject, meeting: MeetingRecord, options: { modelCanRead?: boolean } = {}): string {
  const lines = [`Kept the notes as a meeting: ${meetingLine(project, meeting)}.`];
  for (const item of meeting.items.slice(0, 12)) {
    const who = item.kind === 'action' ? ` · ${item.owner ?? 'nobody named'} · ${item.dueDate ? `due ${meetingDay(item.dueDate)}` : 'no date given'}` : '';
    lines.push(`- ${item.kind === 'decision' ? 'Decided' : item.kind === 'action' ? 'To do' : 'Open'}: ${item.text}${who} ${meetingNotesMark(meeting.id, item.id)}`);
  }
  if (meeting.items.length > 12) lines.push(`- and ${meeting.items.length - 12} more`);
  if (meeting.items.length) lines.push('Each is waiting on a card. Nothing is on the record until you accept it there.');
  else lines.push(options.modelCanRead ? 'No line of them is marked as a decision, an action or an open point. Say “read the meeting notes” and I will read them through.' : 'No line of them is marked as a decision, an action or an open point, so nothing was proposed. Mark lines “Decision:”, “Action:” or “Open:” and give them again.');
  if (!meeting.heldOn) lines.push('The notes do not say when the meeting was held, so its day is left empty, and so is any date given only as a weekday.');
  return lines.join('\n');
}

/** The kept meeting the same words were already given as, if they were. */
export function meetingTwin(project: DdProject, digest: string | undefined): MeetingRecord | undefined {
  return digest ? meetingsHeld(project).find((held) => held.digest === digest) : undefined;
}

/** What the chat says when notes it already keeps are given again. */
export function meetingAlreadyKeptSaid(twin: MeetingRecord): string {
  return `These notes are already kept, as ${meetingCalled(twin)} ${meetingNotesMark(twin.id)}. Nothing new was proposed.`;
}

/** The sentences a person answers the chat's question with, pressed or typed. */
export const MEETING_IS_NOTES = 'These are the notes of a meeting';
export const MEETING_IS_PAPER = 'It is a document for the file';
export const MEETING_IS_NEITHER = 'They are not the notes of a meeting';

/** The question the chat asks when it cannot tell, and the two answers to it. */
export function meetingQuestion(meeting: MeetingRecord): { text: string; choices: ChatChoice[] } {
  const dropped = meeting.came === 'dropped';
  return {
    text: dropped
      ? `Is “${meeting.file.fileName}” the notes of a meeting, or a document for the file? It is not filed and not kept as a meeting until you say.`
      : 'Are these the notes of a meeting? Nothing is kept as one until you say.',
    choices: [
      { id: `${meeting.id}_notes`, label: 'Notes of a meeting', detail: 'Kept as a meeting. What was decided and what is to be done wait on cards.', send: MEETING_IS_NOTES },
      dropped
        ? { id: `${meeting.id}_paper`, label: 'A document for the file', detail: 'Filed on the register and read as a paper.', send: MEETING_IS_PAPER }
        : { id: `${meeting.id}_neither`, label: 'Not a meeting', detail: 'Nothing is kept.', send: MEETING_IS_NEITHER },
    ],
  };
}

/** What a sentence answers the chat's question with, or nothing when it is no answer to it. */
export function meetingAnswerSaid(question: string): 'notes' | 'paper' | 'neither' | undefined {
  const said = question.trim().replace(/[.!\s]+$/, '').toLowerCase();
  if (said === MEETING_IS_NOTES.toLowerCase() || /^(?:yes[, ]+)?(?:these|they|those|it) (?:are|is) (?:the )?(?:notes|minutes) of (?:a|the) meeting$/.test(said) || /^(?:keep (?:them|it|these) as )?(?:meeting notes|minutes)$/.test(said) || /^keep (?:the |these |those )?(?:notes|minutes)(?: as (?:a |the )?meeting)?$/.test(said)) return 'notes';
  if (said === MEETING_IS_PAPER.toLowerCase() || /^(?:no[, ]+)?(?:it is|it's|file it as) a (?:document|paper)(?: for the file)?$/.test(said)) return 'paper';
  if (said === MEETING_IS_NEITHER.toLowerCase() || /^(?:no[, ]+)?(?:they|these|those) are not (?:the )?(?:notes|minutes) of a meeting$/.test(said)) return 'neither';
  return undefined;
}

/** Whether a sentence asks which meetings were held. */
export function asksForMeetings(question: string): boolean {
  const q = question.trim().toLowerCase();
  return /^(?:what|which) meetings? (?:were|was|have been|did we|do we)\b/.test(q) || /^(?:list|show)(?: me)? (?:the |all |our )?meetings?\b/.test(q) || /\bmeetings? (?:were )?held\b.*\?$/.test(q);
}

/** The meetings kept on the file, one line each, each with a way to open its notes. */
export function meetingsSaid(project: DdProject): string {
  const held = meetingsHeld(project);
  if (!held.length) return 'No meeting is kept on this file yet. Paste a meeting’s notes here, or drop them as a file, and I will keep them and list what was decided.';
  return [`${counted(held.length, 'meeting is', 'meetings are')} kept on this file:`, ...held.slice(0, 20).map((meeting) => `- ${meetingLine(project, meeting)}`), ...(held.length > 20 ? [`- and ${held.length - 20} more`] : [])].join('\n');
}

/** Whether a sentence asks for a kept meeting's notes to be read through. */
export function asksToReadMeetingNotes(question: string): boolean {
  return /^(?:please\s+)?read (?:the |these |those )?(?:meeting(?:'s|’s)? notes|notes of the meeting|minutes)(?: through| again)?[.!]?$/i.test(question.trim());
}

/** How many words some text is, said roundly. */
export function aboutWords(text: string): string {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  const round = n < 100 ? Math.max(10, Math.round(n / 10) * 10) : Math.round(n / 100) * 100;
  return `about ${round.toLocaleString('en-IN')} words`;
}

/* ==================================================================== */
/* An action past its date                                                */
/* ==================================================================== */

/** A condition worth an alert, in the shape `alertConditions` gathers them. */
export interface ActionPastDue {
  key: string;
  department: DepartmentKey;
  workstream?: string;
  severity: 'warning';
  title: string;
  detail: string;
  dueOn: string;
  /** The person it is on, as the record names them. */
  to?: string[];
}

/**
 * The actions still open after the day they were due, each as a condition
 * worth an alert.
 *
 * The key is the action and its date, so the alert is raised once for that
 * date, cleared when the action is closed, and raised again only if a new
 * date passes. It belongs to the department of the check or the paper the
 * action is tied to, else to where the meeting it came from was kept, else
 * to the first department the project uses: that department's lead is who
 * hears of it, with the person the action is on.
 */
export function actionsPastDue(project: DdProject, now = new Date()): ActionPastDue[] {
  const today = now.toISOString().slice(0, 10);
  const checks = new Map(allChecks(project).map((check) => [check.id, check]));
  const out: ActionPastDue[] = [];
  for (const action of project.actions) {
    if (action.status === 'closed' || !action.dueDate || action.dueDate.slice(0, 10) >= today) continue;
    const check = action.checkIds.map((id) => checks.get(id)).find(Boolean);
    const paper = action.evidenceIds.map((id) => project.evidence.find((row) => row.id === id)).find(Boolean);
    const from = meetingOfRecord(project, action.id)?.meeting;
    const workstream = (check ? workstreamOfCheck(check.definitionId) : undefined) ?? (paper ? documentWorkstream(project, paper) : undefined) ?? from?.place?.fn;
    const department = (workstream ? functionDepartment(workstream) : undefined) ?? (projectDepartments(project).find((key) => key === from?.place?.department) as DepartmentKey | undefined) ?? projectDepartments(project)[0];
    if (!department) continue;
    out.push({
      key: `action:${action.id}:due:${action.dueDate.slice(0, 10)}`,
      department,
      ...(workstream ? { workstream } : {}),
      severity: 'warning',
      title: `Overdue: ${action.title}`,
      detail: `Due ${meetingDay(action.dueDate)}${action.owner ? `, on ${action.owner}` : ', with nobody named for it'}${from ? `. From ${meetingCalled(from)}` : ''}.`,
      dueOn: action.dueDate.slice(0, 10),
      ...(action.owner ? { to: [action.owner] } : {}),
    });
  }
  return out;
}
