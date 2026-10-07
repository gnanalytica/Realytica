/**
 * A plan: the steps of a job that touches many records, shown before any of
 * it starts.
 *
 * An instruction that would read twenty papers, or do three different things
 * one after another, does not start. The chat shows its steps first, each
 * with what it will touch and how many, and a person runs the plan, takes a
 * step out, narrows one, or cancels. Run, it goes step by step and says what
 * each did. It can be stopped: what was done stays done, and the rest can be
 * taken up again.
 *
 * Where the line is. A job is planned when it has more than one kind of
 * step, or one step would touch more than `PLAN_ABOVE` records, or the
 * person asked for a plan. Anything smaller runs as it always has. An
 * instruction to accept is never planned by its size alone: it is already
 * the person approving each thing it names.
 *
 * The steps are a fixed list of kinds, each something the chat already does
 * by a sentence (`PLAN_STEP_KINDS`). A plan is made by code from the words of
 * the instruction (`planWants`). A model may propose the steps for words the
 * rules do not read, and what it proposes is held to the same list
 * (`planWantsHeld`): a kind that is not on it is not a step.
 *
 * Approving a plan is approving that its steps run. It accepts nothing they
 * raise: a step does exactly what its sentence does when typed alone, so a
 * value read off a paper still waits on its row for a person, and an answer
 * suggested for a question still waits on the question. A step that accepts
 * names its cards when the plan is made, so it can never take what a step
 * before it raised.
 *
 * This file is the words and the shape. What a step would touch is asked of
 * the record by the server, which also runs it and keeps the plan in the run
 * ledger (`run-ledger.ts`): the plan is not on the project's record.
 */

import { REPORT_KIND_LABEL } from './catalogs';
import { chatPlaceLabel } from './chat-places';
import { DEPARTMENT_SHORT, MENU_DEPARTMENTS, menuFunctions } from './departments';
import { readInstruction } from './instruction';
import { asksForStatusReport, statusPeriodSaid, type StatusPeriod } from './status-report';
import type { ChatChoice, ChatTurnPlace, ReportKind } from './types';

/** The kinds of step a plan may hold, and no others. */
export const PLAN_STEP_KINDS = ['read_filed', 'accept_raised', 'suggest_answers', 'write_report', 'keep_meeting', 'run_playbook'] as const;
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];

/** A job is planned when one step would touch more than this many records. Ten is what one reading turn takes. */
export const PLAN_ABOVE = 10;

/** How many steps one plan holds at most. */
export const PLAN_STEPS_AT_MOST = 8;

/* ==================================================================== */
/* The shape                                                              */
/* ==================================================================== */

/** What a sentence asks one step to be, before the record is asked what it would touch. */
export interface PlanWant {
  kind: PlanStepKind;
  /** The words of the instruction it was read from. */
  said: string;
  /** For reading: papers already read are read again. */
  again?: boolean;
  /** For reading and for a playbook: only the papers of this page of the menu, in the words given. */
  only?: string;
  /** For accepting: what the last reply raised, or everything open. */
  form?: 'last' | 'open';
  /** For a report: which one. `status` is the status report, over the period its words name. */
  report?: ReportKind;
  /** For a playbook: its name, in the words given. */
  playbook?: string;
}

export type PlanStepState = 'to_do' | 'running' | 'done' | 'failed' | 'out';

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  /** What it will touch, and how many: "Read 14 filed papers". Written by code from the step. */
  label: string;
  /** How many records it would touch, counted when the plan was shown or last changed. */
  count: number;
  state: PlanStepState;
  again?: boolean;
  /** The page of the menu it is narrowed to, by its key. */
  fn?: string;
  department?: string;
  form?: 'last' | 'open';
  /** For accepting: the cards it names, as they stood when the plan was made. It accepts these and no card raised since. */
  proposalIds?: string[];
  questionnaireIds?: string[];
  /** For reading: the papers this step has read so far, in any go. One taken up again does not read them a second time, and says how many it has read in all. */
  readIds?: string[];
  report?: ReportKind;
  period?: StatusPeriod;
  audience?: string;
  meetingId?: string;
  playbookId?: string;
  playbookName?: string;
  /** The sentence that does the same when typed alone, where the step is carried out by one. */
  sentence?: string;
  /** How many of `count` it has got through. */
  did?: number;
  /** What it did, in one line: set when it ends, or when it is stopped part way. */
  said?: string;
  endedAt?: string;
}

export type PlanStatus = 'shown' | 'running' | 'stopped' | 'done' | 'cancelled';

export interface ChatPlan {
  /** The instruction it was made from, cut short. */
  asked: string;
  status: PlanStatus;
  steps: PlanStep[];
  /** What of the instruction no step could be made of, in its own words. */
  unread?: string[];
  /** What it asked for that would have touched nothing, each with why: no step was made of these either. */
  nothing?: string[];
  /** A person asked it to stop: the run ends before its next step, or the next batch of the one under way. */
  stopAsked?: boolean;
  /** Why it stopped, where no person stopped it. */
  stoppedBecause?: string;
  /**
   * The go that is carrying it out: a mark set when a go is opened, which
   * that go reads again as it works. A go that finds another mark there, or
   * none, is no longer the plan's and ends without writing to it.
   */
  runToken?: string;
  /** Who it belongs to: whoever laid it out, and from the moment somebody runs it or takes it up, that person. Then the chat and page it was last run from. */
  by: string;
  sessionId?: string;
  place?: ChatTurnPlace;
  /** A model proposed the steps. Code checked each against the list and counted what it would touch. */
  byModel?: boolean;
}

/* ==================================================================== */
/* Reading an instruction                                                 */
/* ==================================================================== */

const ASKS_FOR_PLAN = /^(?:please\s+)?(?:plan\b|make (?:me )?a plan\b|draw up a plan\b|work out (?:a plan|the steps)\b|prepare a plan\b|show (?:me )?(?:a|the) plan\b)|\bstep by step\b/i;
const PLAN_LEAD = /^(?:please\s+)?(?:plan|make (?:me )?a plan|draw up a plan|work out (?:a plan|the steps)|prepare a plan|show (?:me )?(?:a|the) plan)\s*(?:to|for|:|-|–)?\s*/i;
/** What a clause may open with before its verb, and says nothing: "first", "2.", "then", "and". */
const CLAUSE_LEAD = /^(?:[-*•]\s*|\d{1,2}[.)]\s*|(?:and|then|first|next|finally|lastly|after that|afterwards|please|also)[,\s]+)+/i;
/** The verbs a step's sentence opens with. A clause is split off only before one of them. */
const STEP_VERB = String.raw`(?:re-?read|read|accept|approve|suggest|draft|answer|fill(?: in)?|complete|write|generate|prepare|make|create|produce|keep|run|apply)`;

/**
 * Verbs that open something else a person may ask for in the same breath. A
 * clause is split off before one of these too. What follows is then read on
 * its own, and where it is no step it is said back in its own words, not
 * swallowed by the step before it.
 */
const OTHER_VERB = String.raw`(?:tell|send|give|let|inform|email|share|notify|summari[sz]e|go through|look|sort|ask|remind|see|find|work out|compare|explain|flag|highlight|update\s+(?:the|me|us|him|her|them|everyone))`;
/** A clause that asks for nothing: a word of thanks at the end of an instruction. */
const COURTESY = /^(?:thanks|thank you|many thanks|cheers|ta|ok|okay|please)\b.{0,20}$/i;

const READS = /^(?:re-?read|read)\b/i;
const PAPERS = /\b(?:documents?|docs|files|papers)\b/i;
const SUGGESTS = /^(?:suggest|draft|answer|fill(?: in)?|complete)\b/i;
const QUESTIONS = /\b(?:questionnaires?|questions|requisitions)\b/i;
const KEEPS = /^keep\b/i;
const NOTES = /\b(?:notes|minutes)\b/i;
const RUNS = /^(?:run|apply)\b/i;
const PLAYBOOK = /\bplaybook\b/i;
const MAKES = /^(?:write|generate|prepare|make|create|produce|draft)\b/i;
const A_REPORT = /\breports?\b|\bred[\s-]flag\b/i;
const ACCEPTS_RAISED = /^(?:accept|approve)\s+(?:what|whatever|everything)\s+(?:it|that|the last reply|the reply)\s+(?:raised|proposed|offered)\b/i;
/**
 * A clause that asks for something to send to somebody: a reply, a letter, an
 * email. That is a draft to send (`outgoing.ts`) and no step of a plan,
 * whatever it is about: "draft a reply to the lender's questions" answers no
 * questionnaire, and "draft a letter about the red flag report" writes no
 * report. A word or two may describe it ("a short reply", "a brief formal
 * letter"). A word that begins what it is about, or names an answer, a
 * questionnaire, a report or minutes, describes nothing: "draft answers to
 * the letter" is no letter.
 */
const DESCRIBES = String.raw`(?:(?!(?:to|for|about|on|of|in|as|an?|the|it|this|that|him|her|them|us|me|and|or|answers?|questionnaires?|questions|requisitions|reports?|minutes|notes)\b)[\w-]+\s+){0,3}`;
const TO_SEND = new RegExp(String.raw`^((?:(?:please|can you|could you)\s+)*(?:draft|write|prepare)\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+|my\s+|our\s+)?)${DESCRIBES}(reply|response|letter|e-?mail|rfi|request for information)\b`, 'i');

/**
 * A sentence that asks for a draft to send, said the way the reader of those
 * takes it (`outgoing.ts`): without the words that only describe it, and
 * with an email called a letter, since the firm drafts and approves both the
 * same way. Any other sentence is given back as it was.
 */
export function draftToSendSaid(sentence: string): string {
  return sentence.replace(TO_SEND, (_all, lead: string, kind: string) => `${lead}${/^e-?mail$/i.test(kind) ? 'letter' : kind}`);
}

/** Words in a clause about reading that say nothing of which papers. */
const READ_FILLER = new Set(
  'read reread re all the my our these those filed uploaded existing unread stored only just again please documents document docs files file papers paper on this project of in from and that are were which is ones'.split(' '),
);

/** Which report a clause asks for, by the words the chat's own rule reads. A report asked for with no kind named is the executive one. */
function reportAsked(clause: string): ReportKind {
  const q = clause.toLowerCase();
  if (/\bred[\s-]flag/.test(q)) return 'red_flag';
  if (/\bdetailed\b/.test(q)) return 'detailed_dd';
  if (/\b(?:evidence\s+)?completeness\b/.test(q)) return 'evidence_completeness';
  if (/\b(?:open\s+)?risks?\b.*\bactions?\b|\brisk\s+(?:and|&)\s+action\b/.test(q)) return 'open_risk_action';
  if (/\bchanges?\b/.test(q)) return 'changes_since_previous';
  if (/\bvaluation\b/.test(q)) return 'indicative_valuation';
  if (/\bhandover\b/.test(q)) return 'handover_readiness';
  if (/\btechnical\b|\btdd\b|\bobservations?\b/.test(q)) return 'technical_dd';
  if (/\blegal\b|\btitle\s+(?:report|dd|due)\b/.test(q)) return 'legal_dd';
  if (/\bfinancial\b|\bfinance\s+(?:report|dd|due)\b/.test(q)) return 'financial_dd';
  return 'executive_dd';
}

/** One clause as a step it asks for, or nothing when it asks for none of the fixed kinds. */
function wantOf(clause: string): PlanWant | undefined {
  const said = clause.trim().replace(/[.!\s]+$/, '');
  if (!said || TO_SEND.test(said)) return undefined;
  if (READS.test(said) && PAPERS.test(said)) {
    const only = said
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word && !READ_FILLER.has(word))
      .join(' ');
    return { kind: 'read_filed', said, ...(/\bre-?read\b|\bagain\b/i.test(said) ? { again: true } : {}), ...(only ? { only } : {}) };
  }
  if (ACCEPTS_RAISED.test(said)) return { kind: 'accept_raised', said, form: 'last' };
  const instruction = readInstruction(said);
  if (instruction?.verb === 'accept' && (instruction.form === 'last' || instruction.form === 'open')) return { kind: 'accept_raised', said, form: instruction.form };
  if (SUGGESTS.test(said) && QUESTIONS.test(said)) return { kind: 'suggest_answers', said };
  if (KEEPS.test(said) && NOTES.test(said)) return { kind: 'keep_meeting', said };
  if (RUNS.test(said) && PLAYBOOK.test(said)) {
    const name = /^(?:run|apply)\s+(?:the\s+|my\s+|our\s+)?(.*?)\s*playbook\b/i.exec(said)?.[1]?.replace(/^["“]|["”]$/g, '').trim();
    // Which papers, where the clause says: the words between "on" and the papers, less the ones that say nothing of which.
    const only = (/\bon\s+(.+?)\s+(?:documents?|docs|files|papers)\b/i.exec(said)?.[1] ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word && !READ_FILLER.has(word))
      .join(' ');
    return { kind: 'run_playbook', said, ...(name ? { playbook: name } : {}), ...(only ? { only } : {}) };
  }
  if (asksForStatusReport(said)) return { kind: 'write_report', said, report: 'status' };
  if (MAKES.test(said) && A_REPORT.test(said)) return { kind: 'write_report', said, report: reportAsked(said) };
  return undefined;
}

/**
 * The steps an instruction asks for, in the order it gives them.
 *
 * The sentence is cut into clauses at "then", at a line or a full stop, and
 * at a comma or an "and" that stands before one of the verbs a step opens
 * with, or before a verb that opens something else a person may ask for
 * ("and tell the owner"). Each clause is one step of the fixed kinds or it
 * is none, and what is none is given back in its own words (`unread`).
 * `asksForPlan` says the person asked to be shown a plan, however small the
 * job.
 */
export function planWants(question: string): { wants: PlanWant[]; unread: string[]; asksForPlan: boolean } {
  const q = question.trim();
  if (!q || q.length > 600) return { wants: [], unread: [], asksForPlan: false };
  const asksForPlan = ASKS_FOR_PLAN.test(q);
  const body = q.replace(PLAN_LEAD, '');
  const clauses = body
    .split(/\n+|;|(?<=[.!])\s+(?=\p{Lu})/u)
    .flatMap((piece) => piece.split(new RegExp(String.raw`,?\s+(?:and\s+)?then\s+|,\s*(?:and\s+)?(?=(?:${STEP_VERB}|${OTHER_VERB})\b)|\s+and\s+(?=(?:${STEP_VERB}|${OTHER_VERB})\b)`, 'i')))
    .map((clause) => clause.replace(CLAUSE_LEAD, '').trim())
    .filter((clause) => clause && !COURTESY.test(clause));
  const wants: PlanWant[] = [];
  const unread: string[] = [];
  const read = (clause: string): void => {
    const want = wantOf(clause);
    // A clause about reading says which papers and no more. Where it goes on past a comma to something that names no page, the rest is read on its own.
    const cut = want?.kind === 'read_filed' && want.only && !planPlaceOf(want.only) ? clause.indexOf(',') : -1;
    if (cut > 0) {
      read(clause.slice(0, cut));
      const rest = clause.slice(cut + 1).replace(CLAUSE_LEAD, '').trim();
      if (rest && !COURTESY.test(rest)) read(rest);
      return;
    }
    if (want && wants.length < PLAN_STEPS_AT_MOST) wants.push(want);
    else unread.push(clause.replace(/[.!\s]+$/, ''));
  };
  clauses.forEach(read);
  return { wants, unread, asksForPlan };
}

/** The things a plan's steps work on, each by the words people use for it. */
const JOB_NOUNS = [/\b(?:documents?|docs|files|papers)\b/i, /\b(?:questionnaires?|questions|requisitions)\b/i, /\b(?:reports?|status|update)\b/i, /\b(?:meeting|minutes)\b/i, /\bplaybooks?\b/i];

/**
 * Whether a sentence the rules read no step from may still be a job of
 * several steps: an instruction, not a question, that names two or more of
 * the things a plan works on. Only then is a model asked to propose its
 * steps. A question, a short sentence and one about a single thing are
 * answered as they always were.
 */
export function planMayBeAsked(question: string): boolean {
  const q = question.trim();
  if (q.length < 30 || q.length > 600 || /\?\s*$/.test(q) || /^(?:what|which|who|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will)\b/i.test(q)) return false;
  // One draft to send is one thing, however many of these it mentions.
  if (TO_SEND.test(q.replace(CLAUSE_LEAD, ''))) return false;
  return JOB_NOUNS.filter((noun) => noun.test(q)).length >= 2;
}

/** Words that may stand beside the name of a page and say nothing more. */
const PLACE_FILLER = new Set('the a an of and page pages section department side function work related'.split(' '));

/**
 * The page of the menu some words name: a function by its one word ("title",
 * "approvals"), or a department ("legal"). Nothing when they name neither,
 * or more than one, or say anything beside the name: a step is never
 * narrowed by a guess, and words that ask for something else are never read
 * as which papers.
 */
export function planPlaceOf(words: string): { fn?: string; department?: string } | undefined {
  const said = new Set(words.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!said.size) return undefined;
  const fns = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu)).filter((fn) => said.has(fn.label.toLowerCase()));
  const departments = MENU_DEPARTMENTS.filter((menu) => said.has(DEPARTMENT_SHORT[menu].toLowerCase()));
  const names = new Set([...fns.map((fn) => fn.label.toLowerCase()), ...departments.map((menu) => DEPARTMENT_SHORT[menu].toLowerCase())]);
  if ([...said].some((word) => !names.has(word) && !PLACE_FILLER.has(word))) return undefined;
  // A function's word that several departments use ("Quality") is that function only where its department is named too.
  const narrowed = departments.length === 1 ? fns.filter((fn) => fn.department === departments[0] || fns.length === 1) : fns;
  if (narrowed.length === 1) return { fn: narrowed[0]!.key };
  if (!fns.length && departments.length === 1) return { department: departments[0] };
  return undefined;
}

/**
 * A model's proposal for a plan, held to the list.
 *
 * `said` is what a model answered: a list of steps. A step is kept only when
 * its kind is one of the fixed kinds, and of what it says beside the kind
 * only short plain words are kept, to be read by the same rules a typed
 * sentence is. What each step would touch, and whether it is a step at all,
 * is still asked of the record. A model adds no kind and names no record.
 */
export function planWantsHeld(said: unknown): PlanWant[] {
  const out: PlanWant[] = [];
  const words = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() && value.length <= 80 && !/[\r\n]/.test(value) ? value.trim() : undefined);
  for (const item of Array.isArray(said) ? said : []) {
    if (out.length >= PLAN_STEPS_AT_MOST) break;
    const step = (item ?? {}) as Record<string, unknown>;
    const kind = PLAN_STEP_KINDS.find((known) => known === step.kind);
    if (!kind) continue;
    const only = words(step.only);
    const report = typeof step.report === 'string' && Object.hasOwn(REPORT_KIND_LABEL, step.report) ? (step.report as ReportKind) : undefined;
    const period = words(step.period);
    const want: PlanWant = {
      kind,
      // The sentence a person would have typed for it: the period of a status report is read from these words by the rule.
      said: kind === 'write_report' && report === 'status' ? `write the status ${period ?? ''}`.trim() : (words(step.said) ?? kind.replace('_', ' ')),
      ...(kind === 'read_filed' && step.again === true ? { again: true } : {}),
      ...((kind === 'read_filed' || kind === 'run_playbook') && only ? { only: only.toLowerCase() } : {}),
      ...(kind === 'accept_raised' ? { form: step.form === 'open' ? ('open' as const) : ('last' as const) } : {}),
      ...(kind === 'write_report' ? { report: report ?? 'executive_dd' } : {}),
      ...(kind === 'run_playbook' && words(step.playbook) ? { playbook: words(step.playbook) } : {}),
    };
    if (!out.some((held) => JSON.stringify({ ...held, said: '' }) === JSON.stringify({ ...want, said: '' }))) out.push(want);
  }
  return out;
}

/* ==================================================================== */
/* The plan                                                               */
/* ==================================================================== */

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What a step will touch and how many, in one line. Made from the step, so the plan always says what will run. */
export function planStepLabel(step: Omit<PlanStep, 'label' | 'id' | 'state'>): string {
  const where = step.fn ? `, only ${chatPlaceLabel({ fn: step.fn })}` : step.department ? `, only ${chatPlaceLabel({ department: step.department })}` : '';
  switch (step.kind) {
    case 'read_filed':
      return `Read ${counted(step.count, 'filed paper', 'filed papers')}${step.again ? ' again' : ''}${where}`;
    case 'accept_raised':
      return `Accept ${counted(step.count, 'thing', 'things')} ${step.form === 'open' ? 'waiting on the project' : 'the last reply raised'}`;
    case 'suggest_answers':
      return `Suggest answers to ${counted(step.count, 'question', 'questions')} from the file`;
    case 'write_report':
      if (step.report === 'status' && step.period) return `Write the status for ${statusPeriodSaid(step.period)}${step.audience ? `, for ${step.audience}` : ''}`;
      return `Put the ${REPORT_KIND_LABEL[step.report ?? 'executive_dd'].replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())} on a card, to be generated when you accept it`;
    case 'keep_meeting':
      return 'Keep the notes the chat is holding as a meeting';
    case 'run_playbook':
      return `Run the playbook “${step.playbookName ?? ''}” on ${counted(step.count, 'paper', 'papers')}${where}`;
  }
}

/**
 * Whether a job is shown as a plan before it starts: more than one step, one
 * step over more than `PLAN_ABOVE` records, or a plan asked for by name. An
 * instruction to accept is not planned by its size alone.
 */
export function isPlanned(steps: readonly PlanStep[], asksForPlan = false): boolean {
  if (!steps.length) return false;
  if (asksForPlan || steps.length > 1) return true;
  return steps[0]!.kind !== 'accept_raised' && steps[0]!.count > PLAN_ABOVE;
}

/** The steps still in the plan: every one a person has not taken out. */
export function planStepsIn(plan: ChatPlan): PlanStep[] {
  return plan.steps.filter((step) => step.state !== 'out');
}

/** "3 of 5 steps done". */
export function planCountSaid(plan: ChatPlan): string {
  const all = planStepsIn(plan);
  return `${all.filter((step) => step.state === 'done').length} of ${counted(all.length, 'step', 'steps')} done`;
}

/** The steps as a numbered list, each with where it stands once the plan has run at all. */
function stepLines(plan: ChatPlan): string[] {
  let n = 0;
  return plan.steps.flatMap((step) => {
    if (step.state === 'out') return [];
    n += 1;
    const stands =
      plan.status === 'shown'
        ? ''
        : step.state === 'done'
          ? ` Done: ${step.said ?? ''}`
          : step.state === 'failed'
            ? ` Not done: ${step.said ?? ''}`
            : step.said
              ? ` Part done: ${step.said}`
              : plan.status === 'cancelled'
                ? ' Not run.'
                : ' Left.';
    return [`${n}. ${step.label}.${stands}`.replace(/\.\.$/, '.').trimEnd()];
  });
}

/**
 * Whether a reply's words already list a plan's steps as they stand now. A
 * page that draws the plan under the reply does not list them a second time.
 * False for a plan that has moved on since the reply was written.
 */
export function planListedIn(text: string, plan: ChatPlan): boolean {
  const lines = stepLines(plan);
  return lines.length > 0 && lines.every((line) => text.includes(line));
}

/** The sentences a person presses or types to act on a plan. A pressed one carries the plan's id beside it. */
export const PLAN_SENTENCE = {
  run: 'Run the plan',
  cancel: 'Cancel the plan',
  stop: 'Stop the plan',
  carry_on: 'Carry on with the plan',
  take_out: (n: number) => `Take step ${n} out of the plan`,
} as const;

/** What the chat says when it shows a plan and has started nothing. */
export function planShownSaid(plan: ChatPlan): string {
  const lines = stepLines(plan);
  return [
    lines.length > 1 ? `That is ${lines.length} steps, so nothing has started. The plan:` : 'That touches a lot, so nothing has started. The plan:',
    ...lines,
    ...(plan.unread?.length ? [`No step was made of: ${plan.unread.map((words) => `“${words}”`).join(', ')}.`] : []),
    ...(plan.nothing?.length ? [`Left out, with nothing to do: ${plan.nothing.join(' ')}`] : []),
    `Run it, take a step out (“take step 2 out”), narrow the papers (“only the title papers”), or cancel. Running it accepts nothing it raises: every value still waits for you.`,
  ].join('\n');
}

/** The choices under a plan, for where it stands. Each names the plan, so an old button acts on its own plan and no other. */
export function planChoices(planId: string, plan: ChatPlan, interrupted = false): ChatChoice[] {
  const press = (act: 'run' | 'cancel' | 'stop' | 'carry_on', label: string, detail: string): ChatChoice => ({ id: `${planId}_${act}`, label, detail, send: PLAN_SENTENCE[act], sitting: { plan: { id: planId, act } } });
  if (plan.status === 'shown') return [press('run', 'Run the plan', `${counted(planStepsIn(plan).length, 'step', 'steps')}. Nothing it raises is accepted.`), press('cancel', 'Cancel', 'Nothing is done.')];
  if (plan.status === 'stopped' || interrupted) return [press('carry_on', 'Carry on', 'Takes up the steps that are left.'), press('cancel', 'Leave the rest', 'What was done stays done.')];
  if (plan.status === 'running') return [press('stop', 'Stop', 'What is done stays done. The rest can be taken up again.')];
  return [];
}

/** What the chat says when a plan has ended, was stopped, or is asked how far it has got. */
export function planStandsSaid(plan: ChatPlan, interrupted = false): string {
  // A plan cancelled before any of it ran: there is nothing to list.
  if (plan.status === 'cancelled' && !plan.steps.some((step) => step.state === 'done' || step.said)) return 'The plan is cancelled. Nothing was done.';
  const head =
    plan.status === 'done'
      ? `The plan is done: ${planCountSaid(plan)}.`
      : plan.status === 'cancelled'
        ? `The plan was cancelled: ${planCountSaid(plan)}. What was done stays done.`
        : plan.status === 'shown'
          ? 'The plan has not started.'
          : interrupted
            ? `The plan was cut short: ${planCountSaid(plan)}. What was done stays done.`
            : plan.status === 'stopped'
              ? `The plan is stopped: ${planCountSaid(plan)}.${plan.stoppedBecause ? ` ${plan.stoppedBecause}` : ''} What was done stays done.`
              : `The plan is running: ${planCountSaid(plan)}.`;
  const tail = plan.status === 'stopped' || interrupted ? ['Say “carry on with the plan” to take up what is left.'] : plan.status === 'done' ? ['Nothing it raised is accepted: what waits, waits for you where it sits.'] : [];
  return [head, ...stepLines(plan), ...tail].join('\n');
}

/* ==================================================================== */
/* What a sentence does to a plan                                         */
/* ==================================================================== */

export type PlanAct =
  | { act: 'run' | 'cancel' | 'stop' | 'carry_on' | 'progress' }
  /** Take a step out, by its place in the list as shown. */
  | { act: 'take_out'; step: number }
  /** Narrow the steps that work through papers to one page of the menu. */
  | { act: 'narrow'; only: string };

const RUN_IT = /^(?:please\s+)?(?:ok[,\s]+|yes[,\s]+)?(?:run|start|approve|go ahead with|do)\s+(?:it|the plan|this plan|that plan)$|^(?:please\s+)?go ahead$/i;
const CANCEL_IT = /^(?:please\s+)?(?:cancel|drop|forget|scrap|leave)\s+(?:it|the plan|this plan|that plan|the rest)$/i;
const STOP_IT = /^(?:please\s+)?(?:stop|pause|halt)(?:\s+(?:it|the plan|this plan|the run|now))?$/i;
const CARRY_ON = /^(?:please\s+)?(?:carry on|continue|resume|take it up again|pick it up again)(?:\s+with\s+(?:it|the plan|the rest))?$/i;
const HOW_FAR = /^(?:how (?:is|far (?:is|along is)) (?:it|the plan)(?: going| got)?|where (?:is|has) the plan(?: got to| got)?|what is left of the plan|how far has (?:it|the plan) got)$/i;
const TAKE_OUT = /^(?:please\s+)?(?:take\s+(?:out\s+)?step\s+(\d{1,2})(?:\s+out)?|(?:remove|skip|drop|leave out|without)\s+step\s+(\d{1,2}))(?:\s+(?:of|from)\s+the plan)?$/i;
const ONLY = /^(?:please\s+)?(?:only|just)\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:documents?|docs|files|papers|ones))?$/i;

/** Whether a sentence is one of the few things said of a plan at all, whatever plan there is: asked before a plan is looked for. */
export function planMayBeMeant(sentence: string): boolean {
  const said = sentence.trim().replace(/[.!?\s]+$/, '');
  return said.length <= 80 && [RUN_IT, CANCEL_IT, STOP_IT, CARRY_ON, HOW_FAR, TAKE_OUT, ONLY].some((form) => form.test(said));
}

/**
 * Whether a sentence names the plan it is about: "run the plan", "carry on
 * with the plan". "Go ahead", "do it" and "carry on" name nothing. They are
 * an answer to whatever was said last, and run a plan only where the plan is
 * that (`planTurnFor`).
 */
export function planIsNamed(sentence: string): boolean {
  return /\bplan\b/i.test(sentence);
}

/**
 * What a sentence asks of a plan, read against where the plan stands, or
 * nothing when it asks nothing of it. A sentence is read as one of these
 * only in full: "run it" runs the plan, and a question that has "run" in it
 * is a question.
 */
export function planAct(sentence: string, plan: Pick<ChatPlan, 'status'>, interrupted = false): PlanAct | undefined {
  const said = sentence.trim().replace(/[.!?\s]+$/, '');
  if (HOW_FAR.test(said)) return { act: 'progress' };
  if (plan.status === 'shown') {
    if (RUN_IT.test(said)) return { act: 'run' };
    if (CANCEL_IT.test(said)) return { act: 'cancel' };
    const out = TAKE_OUT.exec(said);
    if (out) return { act: 'take_out', step: Number(out[1] ?? out[2]) };
    const only = ONLY.exec(said)?.[1];
    if (only && planPlaceOf(only)) return { act: 'narrow', only };
    return undefined;
  }
  if (plan.status === 'running' && !interrupted) return STOP_IT.test(said) ? { act: 'stop' } : undefined;
  if (plan.status === 'stopped' || interrupted) {
    if (CARRY_ON.test(said) || RUN_IT.test(said)) return { act: 'carry_on' };
    if (CANCEL_IT.test(said)) return { act: 'cancel' };
  }
  return undefined;
}
