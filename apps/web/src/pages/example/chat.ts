import {
  allFlags,
  changed,
  fieldValue,
  fieldsIn,
  homeOf,
  many,
  photosIn,
  slotState,
  slotsIn,
  summary,
  type At,
  type FieldRef,
  type FlagRef,
  type Marks,
  type SlotRef,
  type Suggestion,
} from './engine';
import { EXAMPLE_STAGE_NOW, type ExampleStage } from './paths';
import { DEPARTMENTS, STAGES, fnsOf, placeLabel, runs } from './spec';
import type { Block, Department, FunctionSpec } from './types';

/**
 * The copilot of the example project. Its replies are scripted: each is
 * worked out from the same files and marks the page is drawn from, so what it
 * says agrees with what is on screen.
 *
 * It can show anything without asking, because looking changes nothing. A
 * change comes as a card, and nothing happens until the card is approved.
 */

/** Something to show: it moves the work and the proof pane, and changes nothing. */
export type Act =
  | { kind: 'summary'; dept: Department; stage: ExampleStage; part?: string }
  | { kind: 'fn'; dept: Department; fn: FunctionSpec; part?: string }
  | { kind: 'field'; id: string }
  | { kind: 'paper'; id: string }
  | { kind: 'photo'; id: string }
  | { kind: 'flag'; flag: FlagRef };

/** What shows a suggestion: a value or a photograph with its proof, an answer or an entry in the section it sits in. */
export function showing(s: Suggestion): Act {
  if (s.kind === 'field') return { kind: 'field', id: s.id };
  if (s.kind === 'photo') return { kind: 'photo', id: s.id };
  return { kind: 'fn', dept: s.dept, fn: s.fn, part: s.section.id };
}

/** A change the copilot proposes: accept what it suggested, or ask for the papers nobody has asked for. */
export interface Card {
  say: string;
  apply: 'suggestions' | 'papers';
  dept: Department;
  stage: ExampleStage;
  toast: string;
}

export type ChatMessage =
  | { kind: 'said'; me?: boolean; t: string; refs?: { t: string; act: Act }[] }
  | { kind: 'card'; t: string; card: Card; state?: 'yes' | 'no'; shown?: Act };

export type Ask = 'attention' | 'waiting' | 'why' | 'map' | 'missing';

export interface Prompt {
  t: string;
  ask?: Ask;
  card?: Card;
}

/** An answer, the things it mentions as links that show them, and what to show straight away. */
export interface Answer {
  t: string;
  refs?: { t: string; act: Act }[];
  act?: Act;
}

/** Where the person is, and what they have picked. */
export interface Here {
  /** Null on the project's overview. */
  dept: Department | null;
  /** Null on a department's Summary, and on the overview. */
  fn: FunctionSpec | null;
  stage: ExampleStage;
  marks: Marks;
  /** The field that is picked, when one is. */
  picked: FieldRef | null;
}

/** The department a stage is opened in when the person is on the overview. */
const HOME = DEPARTMENTS.find((d) => d.key === 'engineering') ?? DEPARTMENTS[0];

export function prompts(here: Here): Prompt[] {
  const { dept, stage, marks } = here;
  if (!dept) {
    return [
      { t: 'What needs attention across the project?', ask: 'attention' },
      { t: 'What is waiting to be accepted?', ask: 'waiting' },
    ];
  }
  const sum = summary(dept, stage, marks);
  const out: Prompt[] = [here.picked ? { t: 'Why does this one matter?', ask: 'why' } : { t: 'Show the site on the map', ask: 'map' }];
  if (sum.waiting.length) {
    out.push({
      t: 'Accept what the copilot suggested',
      card: { say: `Accept the ${many(sum.waiting.length, 'suggestion', 'suggestions')} waiting here?`, apply: 'suggestions', dept, stage, toast: 'Accepted.' },
    });
  } else if (sum.pending) {
    out.push({
      t: `Ask for the ${many(sum.pending, 'missing document', 'missing documents')}`,
      card: { say: `Ask for ${many(sum.pending, 'document', 'documents')}?`, apply: 'papers', dept, stage, toast: 'Asks for them.' },
    });
  }
  out.push({ t: 'What is still missing here?', ask: 'missing' });
  return out;
}

/** The departments with work at the stage the project is in. */
const running = (): Department[] => DEPARTMENTS.filter((d) => runs(d, EXAMPLE_STAGE_NOW));

function acrossTheProject(ask: 'attention' | 'waiting', marks: Marks): string {
  if (ask === 'attention') {
    const worst = running()
      .map((dept) => ({ dept, n: summary(dept, EXAMPLE_STAGE_NOW, marks).flags.length }))
      .sort((a, b) => b.n - a.n)[0];
    return worst && worst.n ? `${placeLabel(worst.dept, EXAMPLE_STAGE_NOW)} has the most open flags: ${worst.n}.` : 'Nothing is flagged at this stage.';
  }
  const waiting = running()
    .map((dept) => ({ dept, n: summary(dept, EXAMPLE_STAGE_NOW, marks).waiting.length }))
    .filter((x) => x.n);
  return waiting.length
    ? `${waiting.map((x) => `${placeLabel(x.dept, EXAMPLE_STAGE_NOW)} has ${many(x.n, 'suggestion', 'suggestions')} to accept`).join('; ')}.`
    : 'Nothing is waiting to be accepted.';
}

/** The first place a kind of block lives: in this department if it has one, otherwise wherever it is. */
function firstBlock(type: Block['type'], first: Department | null): At | null {
  for (const dept of [...(first ? [first] : []), ...DEPARTMENTS.filter((d) => d !== first)]) {
    for (const fn of dept.functions) {
      const section = fn.sections.find((s) => s.blocks.some((b) => b.type === type));
      if (section) return { dept, fn, section };
    }
  }
  return null;
}

export function reply(ask: Ask, here: Here): Answer {
  const { dept, stage, marks } = here;
  if (ask === 'attention' || ask === 'waiting') return { t: acrossTheProject(ask, marks) };
  if (ask === 'map') {
    const at = firstBlock('map', dept);
    return at ? { t: `Opened the map in ${at.fn.name}. Switch its layers on and off above it.`, act: { kind: 'fn', dept: at.dept, fn: at.fn, part: at.section.id } } : { t: 'No map here.' };
  }
  if (ask === 'why') {
    const x = here.picked;
    return x ? { t: `${x.item.l} is used in ${x.fn.name}, under ${x.section.name}.${x.item.from ? ` It was read from ${x.item.from}.` : ''}` } : { t: 'Pick a value first.' };
  }
  if (!dept) return { t: acrossTheProject('attention', marks) };
  const sum = summary(dept, stage, marks);
  const refs: { t: string; act: Act }[] = [];
  const pending = sum.docs.find((x) => slotState(x, marks) === 'none');
  if (pending) refs.push({ t: 'Show a document not asked for', act: { kind: 'paper', id: pending.id } });
  if (sum.waiting[0]) refs.push({ t: `Show the ${many(sum.waiting.length, 'suggestion', 'suggestions')} waiting`, act: showing(sum.waiting[0]) });
  if (sum.flags[0]) refs.push({ t: `Show the ${many(sum.flags.length, 'flag', 'flags')}`, act: { kind: 'flag', flag: sum.flags[0] } });
  return {
    t: `${many(sum.pending, 'document is', 'documents are')} not asked for yet, ${many(sum.waiting.length, 'suggestion waits', 'suggestions wait')} for you, and ${many(sum.flags.length, 'flag is', 'flags are')} open.`,
    refs,
  };
}

/* ---- a typed line ---- */

/** In lower case, with everything but letters and digits made one space and a space at each end, so a word can be looked for whole. */
const words = (text: string): string => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Whether a line holds a name as whole words: "far" is not in "farther", nor "land" in "island". */
const says = (line: string, name: string): boolean => words(name).length > 2 && line.includes(words(name));

/** Whether a line holds any of these words, each as a whole word. */
const mentions = (line: string, ...names: string[]): boolean => names.some((name) => line.includes(` ${name} `));

/** The thing a line names. The longest name wins: "surveyed extent against deed" before "surveyed extent". */
function named<T>(things: T[], name: (thing: T) => string, line: string): T | undefined {
  return things.filter((x) => says(line, name(x))).sort((a, b) => name(b).length - name(a).length)[0];
}

/** A value in a sentence, with where it came from. A value a person typed over says so, and what was there before. */
function about(x: FieldRef, marks: Marks): string {
  const page = x.item.from ? `${x.item.from}${x.item.page ? `, page ${x.item.page}` : ''}` : '';
  const typed = changed(x, marks);
  const source = page
    ? typed
      ? ` Changed by a person. ${page} says ${x.item.v}.`
      : ` Read from ${page}.`
    : x.item.state !== 'sug'
      ? ''
      : typed
        ? ` Changed by a person. The copilot suggested ${x.item.v}.`
        : ' Suggested by the copilot.';
  return `${x.item.l}: ${fieldValue(x, marks) || 'not filled yet'}.${source}`;
}

const PAPER_STATE: Record<SlotRef['line']['state'], string> = { in: 'in hand', asked: 'asked for', none: 'not asked for yet' };

/**
 * What a typed line asks to see, or null when it asks for nothing the script
 * knows. Words are matched whole. A value or a paper named in full comes
 * before anything else, so "what is the land area" is about the land area
 * and not about the Land stage.
 */
export function command(text: string, here: Here): Answer | null {
  const line = words(text);
  const { dept, stage, marks } = here;
  // Where the person is: one department, or on the overview every department with work at the stage.
  const scope = dept ? [dept] : DEPARTMENTS.filter((d) => runs(d, stage));
  const fns = scope.flatMap((d) => fnsOf(d, stage));

  const field = named(fns.flatMap(fieldsIn), (x) => x.item.l, line);
  if (field) return { t: about(field, marks), act: { kind: 'field', id: field.id } };
  const paper = named(fns.flatMap(slotsIn), (x) => x.line.t, line);
  if (paper) return { t: `${paper.line.t} is ${PAPER_STATE[slotState(paper, marks)]}.`, act: { kind: 'paper', id: homeOf(paper).id } };

  const deptNamed = DEPARTMENTS.find((d) => says(line, d.label));
  const stageNamed = STAGES.find((s) => says(line, s.label));
  if (deptNamed || stageNamed) {
    const to = deptNamed ?? dept ?? HOME;
    const at = stageNamed?.key ?? stage;
    if (!to || !runs(to, at)) return { t: `${deptNamed ? deptNamed.label : 'That department'} is not running at that stage.` };
    return { t: `Opened ${placeLabel(to, at)}.`, act: { kind: 'summary', dept: to, stage: at } };
  }

  if (mentions(line, 'map', 'maps', 'lake', 'drain', 'canal', 'zoning', 'planning', 'buffer', 'buffers')) return reply('map', here);
  if (mentions(line, 'flag', 'flags', 'risk', 'risks')) {
    const flag = scope.flatMap((d) => allFlags(d, stage, marks)).sort((a, b) => Number(b.high) - Number(a.high))[0];
    return flag ? { t: `First open flag: ${flag.t}.`, act: { kind: 'flag', flag } } : { t: 'There are no open flags here.' };
  }
  if (mentions(line, 'photo', 'photos', 'photograph', 'photographs')) {
    const photo = fns.flatMap(photosIn)[0];
    return photo ? { t: `${photo.photo.where}: ${photo.photo.says}`, act: { kind: 'photo', id: photo.id } } : { t: 'No photographs here.' };
  }
  if (mentions(line, 'missing', 'pending')) return reply('missing', here);
  if (!dept) return null;

  const fn = fnsOf(dept, stage).find((f) => says(line, f.name));
  if (fn) return { t: `Opened ${fn.name}.`, act: { kind: 'fn', dept, fn } };
  if (mentions(line, 'summary')) return { t: 'Opened Summary.', act: { kind: 'summary', dept, stage } };
  if (mentions(line, 'connect', 'connects', 'connected', 'connection', 'connections', 'graph')) return { t: 'Opened Connections.', act: { kind: 'summary', dept, stage, part: 'links' } };
  if (mentions(line, 'report', 'reports', 'result', 'results')) return { t: 'Opened Reports.', act: { kind: 'summary', dept, stage, part: 'reports' } };
  return null;
}

/**
 * What to say to a line the script has no answer for: a few it does answer,
 * from where the person is. Each is run before it is offered, so the line
 * never suggests a phrase that would only bring the same line back.
 */
export function tryLine(here: Here): string {
  const { dept, fn, stage } = here;
  const fns = (dept ? [dept] : DEPARTMENTS.filter((d) => runs(d, stage))).flatMap((d) => fnsOf(d, stage));
  // A value to ask for by name: the first on the page whose name is plain words.
  const fields = fn ? fieldsIn(fn) : fns.flatMap(fieldsIn);
  const field = fields.find((x) => /^[\p{L} ]+$/u.test(x.item.l)) ?? fields[0];
  const other = dept ? fns.find((f) => f !== fn) : undefined;
  const elsewhere = DEPARTMENTS.find((d) => d !== dept && runs(d, stage));
  const phrases = [
    field ? field.item.l : '',
    'show the flags',
    'show a photograph',
    other ? `open ${other.name}` : 'show the map',
    dept ? 'show connections' : '',
    elsewhere ? `go to ${elsewhere.label}` : '',
  ].filter((phrase) => {
    const answer = phrase ? command(phrase, here) : null;
    return answer !== null && (answer.act !== undefined || answer.refs !== undefined);
  });
  if (!phrases.length) return 'Try one of the suggestions above.';
  const quoted = phrases.map((phrase) => `“${phrase}”`);
  return `Try ${quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}` : quoted[0]}.`;
}

/* ---- a card ---- */

/** The papers a card would ask for: the department's own, that nobody has asked for yet. */
const cardPapers = (card: Card, marks: Marks): SlotRef[] => summary(card.dept, card.stage, marks).docs.filter((x) => slotState(x, marks) === 'none');

/** Everything a card would change: the suggestions it would accept, or the papers it would ask for. */
export function cardIds(card: Card, marks: Marks): string[] {
  return card.apply === 'papers' ? cardPapers(card, marks).map((x) => x.id) : summary(card.dept, card.stage, marks).waiting.map((s) => s.id);
}

/**
 * What a card is about: the first thing it would change, so it can be shown
 * before it is approved and again after. When nothing is left for it to
 * change, the list its things would have been in.
 */
export function cardAct(card: Card, marks: Marks): Act {
  if (card.apply === 'papers') {
    const paper = cardPapers(card, marks)[0];
    return paper ? { kind: 'paper', id: paper.id } : { kind: 'summary', dept: card.dept, stage: card.stage, part: 'docs' };
  }
  const first = summary(card.dept, card.stage, marks).waiting[0];
  return first ? showing(first) : { kind: 'summary', dept: card.dept, stage: card.stage, part: 'fns' };
}
