import {
  allFlags,
  fieldState,
  fieldValue,
  fieldsIn,
  firstBlock,
  homeOf,
  many,
  photosIn,
  slotState,
  slotsIn,
  summary,
  type FieldRef,
  type FlagRef,
  type Marks,
} from './engine';
import { EXAMPLE_STAGE_NOW, type ExampleStage } from './paths';
import { DEPARTMENTS, STAGES, fnsOf, placeLabel, runs } from './spec';
import type { Department, FunctionSpec } from './types';

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

/** A change the copilot proposes. */
export interface Card {
  say: string;
  apply: 'fields' | 'papers';
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
  stage: ExampleStage;
  marks: Marks;
  /** The field that is picked, when one is. */
  picked: FieldRef | null;
}

/** The department a stage is opened in when the person is on the overview. */
const HOME = DEPARTMENTS.find((d) => d.key === 'engineering') ?? DEPARTMENTS[0];

export const TRY = 'Try “show actual progress”, “open the progress report”, “show the flags”, “show a photograph”, “show connections” or “go to Legal”.';

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
      t: 'Accept what was read from the documents',
      card: { say: `Accept the ${many(sum.waiting.length, 'value', 'values')} read from your documents?`, apply: 'fields', dept, stage, toast: 'Accepted.' },
    });
  } else if (sum.pending) {
    out.push({
      t: `Ask for the ${many(sum.pending, 'missing document', 'missing documents')}`,
      card: { say: `Ask for ${many(sum.pending, 'document', 'documents')}, each with a due date?`, apply: 'papers', dept, stage, toast: 'Asked.' },
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
  return waiting.length ? `${waiting.map((x) => `${placeLabel(x.dept, EXAMPLE_STAGE_NOW)} has ${many(x.n, 'value', 'values')} to accept`).join('; ')}.` : 'Nothing is waiting to be accepted.';
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
  const pending = fnsOf(dept, stage)
    .flatMap(slotsIn)
    .find((x) => slotState(x, marks) === 'none');
  if (pending) refs.push({ t: 'Show a document not asked for', act: { kind: 'paper', id: homeOf(pending).id } });
  if (sum.waiting[0]) refs.push({ t: `Show the ${many(sum.waiting.length, 'value', 'values')} waiting`, act: { kind: 'field', id: sum.waiting[0].id } });
  if (sum.flags[0]) refs.push({ t: `Show the ${many(sum.flags.length, 'flag', 'flags')}`, act: { kind: 'flag', flag: sum.flags[0] } });
  return {
    t: `${many(sum.pending, 'document is', 'documents are')} not asked for yet, ${many(sum.waiting.length, 'value waits', 'values wait')} for you, and ${many(sum.flags.length, 'flag is', 'flags are')} open.`,
    refs,
  };
}

/** What a typed line asks to see, or null when it asks for nothing the example knows. */
export function command(text: string, here: Here): Answer | null {
  const q = text.toLowerCase();
  const { marks } = here;
  const named = DEPARTMENTS.find((d) => q.includes(d.label.toLowerCase()));
  const stageNamed = STAGES.find((s) => q.includes(s.label.toLowerCase()));
  if (named || stageNamed) {
    const dept = named ?? here.dept ?? HOME;
    const stage = stageNamed?.key ?? here.stage;
    if (!dept || !runs(dept, stage)) return { t: `${named ? named.label : 'That department'} is not running at that stage.` };
    return { t: `Opened ${placeLabel(dept, stage)}.`, act: { kind: 'summary', dept, stage } };
  }
  const dept = here.dept;
  if (!dept) return null;
  const stage = here.stage;
  const fns = fnsOf(dept, stage);
  if (/\b(map|lake|drain|canal|zoning|planning|buffer)\b/.test(q)) return reply('map', here);
  const field = fns.flatMap(fieldsIn).find((x) => q.includes(x.item.l.toLowerCase()));
  if (field) {
    const read = field.item.from ? ` Read from ${field.item.from}${field.item.page ? `, page ${field.item.page}` : ''}.` : '';
    return { t: `${field.item.l}: ${fieldValue(field, marks) || 'not filled yet'}.${read}`, act: { kind: 'field', id: field.id } };
  }
  const paper = fns
    .flatMap(slotsIn)
    .filter((x) => q.includes(x.line.t.toLowerCase()))
    .sort((a, b) => b.line.t.length - a.line.t.length)[0];
  if (paper) {
    const state = { in: 'in hand', asked: 'asked for', none: 'not asked for yet' }[slotState(paper, marks)];
    return { t: `${paper.line.t} is ${state}.`, act: { kind: 'paper', id: homeOf(paper).id } };
  }
  if (q.includes('flag') || q.includes('risk')) {
    const flag = allFlags(dept, stage, marks)[0];
    return flag ? { t: `First open flag: ${flag.t}.`, act: { kind: 'flag', flag } } : { t: 'There are no open flags here.' };
  }
  if (q.includes('photo')) {
    const photo = fns.flatMap(photosIn)[0];
    return photo ? { t: `${photo.photo.where}: ${photo.photo.says}`, act: { kind: 'photo', id: photo.id } } : { t: 'No photographs here.' };
  }
  if (q.includes('missing') || q.includes('pending')) return reply('missing', here);
  const fn = fns.find((f) => q.includes(f.name.toLowerCase()));
  if (fn) return { t: `Opened ${fn.name}.`, act: { kind: 'fn', dept, fn } };
  if (q.includes('summary')) return { t: 'Opened Summary.', act: { kind: 'summary', dept, stage } };
  if (q.includes('connect') || q.includes('graph')) return { t: 'Opened Connections.', act: { kind: 'summary', dept, stage, part: 'links' } };
  if (q.includes('report') || q.includes('result')) return { t: 'Opened Reports.', act: { kind: 'summary', dept, stage, part: 'reports' } };
  return null;
}

/** What a card is about, so it can be shown before it is approved and again after. */
export function cardAct(card: Card): Act {
  const fns = fnsOf(card.dept, card.stage);
  if (card.apply === 'papers') {
    const paper = fns.flatMap(slotsIn).find((x) => homeOf(x).line.state === 'none');
    return paper ? { kind: 'paper', id: homeOf(paper).id } : { kind: 'summary', dept: card.dept, stage: card.stage, part: 'docs' };
  }
  const field = fns.flatMap(fieldsIn).find((x) => x.item.state === 'sug');
  return field ? { kind: 'field', id: field.id } : { kind: 'summary', dept: card.dept, stage: card.stage, part: 'fns' };
}

/** Everything a card would change: the papers it would ask for, or the values it would accept. */
export function cardIds(card: Card, marks: Marks): string[] {
  const fns = fnsOf(card.dept, card.stage);
  if (card.apply === 'papers') {
    return fns
      .flatMap(slotsIn)
      .filter((x) => !x.line.ref && slotState(x, marks) === 'none')
      .map((x) => x.id);
  }
  return fns
    .flatMap(fieldsIn)
    .filter((x) => fieldState(x, marks) === 'sug')
    .map((x) => x.id);
}
