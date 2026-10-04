import type { Tone } from '../../components/ui/kit';
import type { MapLayer } from './MapBlock';
import type { ExampleStage } from './paths';
import { DEPARTMENTS, fnsOf } from './spec';
import type { Block, CertifiedStanding, Department, FieldItem, FunctionSpec, PhotoItem, Section, SlotLine, Standing } from './types';

/**
 * What the example project's screens work out from its files and from what a
 * person has done since the page opened. Nothing here touches the screen:
 * every function takes the marks it needs and returns a plain answer.
 */

/* ---- what a person has done ---- */

export type CheckMark = 'yes' | 'no' | 'na' | '';

/** The things that are either done or not: a value accepted, a paper asked for, a list opened. */
export type MarkKind = 'accepted' | 'rejected' | 'asked' | 'raised' | 'dismissed' | 'drafted' | 'filed' | 'sent' | 'described' | 'confirmed' | 'opened';

type Done = Readonly<Partial<Record<string, true>>>;

export interface Marks extends Record<MarkKind, Done> {
  /** Values typed or chosen, by field. */
  values: Readonly<Partial<Record<string, string>>>;
  /** The must-have checklist, by line. */
  checks: Readonly<Partial<Record<string, CheckMark>>>;
  /** Certified results added here, by function. */
  certified: Readonly<Partial<Record<string, CertifiedStanding>>>;
  /** The layers switched on, by map. */
  layers: Readonly<Partial<Record<string, MapLayer[]>>>;
}

/* ---- everything a person can pick, found by its id. Built once. ---- */

/** Where something sits: its department, function and section. */
export interface At {
  dept: Department;
  fn: FunctionSpec;
  section: Section;
}

/** Where a block sits, and the id its marks are kept under. */
export interface BlockAt extends At {
  id: string;
}

export interface FieldRef extends At {
  id: string;
  item: FieldItem;
}

export interface SlotRef extends At {
  id: string;
  line: SlotLine;
}

export interface PhotoRef extends At {
  id: string;
  photo: PhotoItem;
}

export const fnId = (dept: Department, fn: FunctionSpec): string => `${dept.key}/${fn.name}`;
export const blockId = (dept: Department, fn: FunctionSpec, section: Section, index: number): string => `${fnId(dept, fn)}/${section.id}/${index}`;

const FIELDS = new Map<string, FieldRef>();
const SLOTS = new Map<string, SlotRef>();
const PHOTOS = new Map<string, PhotoRef>();

for (const dept of DEPARTMENTS) {
  for (const fn of dept.functions) {
    for (const section of fn.sections) {
      section.blocks.forEach((block, index) => {
        const at = { dept, fn, section };
        const bid = blockId(dept, fn, section, index);
        if (block.type === 'fields') block.items.forEach((item, i) => FIELDS.set(`${bid}/${i}`, { id: `${bid}/${i}`, ...at, item }));
        if (block.type === 'slots') block.groups.forEach((g, gi) => g.lines.forEach((line, li) => SLOTS.set(`${bid}/${gi}.${li}`, { id: `${bid}/${gi}.${li}`, ...at, line })));
        if (block.type === 'photos') block.items.forEach((photo, i) => PHOTOS.set(`${bid}/${i}`, { id: `${bid}/${i}`, ...at, photo }));
      });
    }
  }
}

export const fieldById = (id: string): FieldRef | undefined => FIELDS.get(id);
export const slotById = (id: string): SlotRef | undefined => SLOTS.get(id);
export const photoById = (id: string): PhotoRef | undefined => PHOTOS.get(id);

export const fieldsIn = (fn: FunctionSpec): FieldRef[] => [...FIELDS.values()].filter((x) => x.fn === fn);
export const slotsIn = (fn: FunctionSpec): SlotRef[] => [...SLOTS.values()].filter((x) => x.fn === fn);
export const photosIn = (fn: FunctionSpec): PhotoRef[] => [...PHOTOS.values()].filter((x) => x.fn === fn);

/* ---- fields, papers, photographs ---- */

/** A field as it stands now. `no` is a value a person said was not right. */
export type FieldState = FieldItem['state'] | 'no';

export function fieldState(x: FieldRef, m: Marks): FieldState {
  if (m.rejected[x.id]) return 'no';
  if ((x.item.state === 'sug' && m.accepted[x.id]) || (x.item.state === 'empty' && m.values[x.id])) return 'set';
  return x.item.state;
}

export const fieldValue = (x: FieldRef, m: Marks): string => m.values[x.id] ?? x.item.v ?? '';

/** The other typed facts of the same block: what a worked-out value is worked out from. */
export function inputsOf(x: FieldRef): FieldRef[] {
  const block = x.id.slice(0, x.id.lastIndexOf('/') + 1);
  return fieldsIn(x.fn).filter((y) => y !== x && y.id.startsWith(block) && y.item.state !== 'calc');
}

/** A paper has one home. A line that only refers to it resolves to the original there. */
export function homeOf(x: SlotRef): SlotRef {
  const ref = x.line.ref;
  if (!ref) return x;
  for (const y of SLOTS.values()) if (y.dept.key === ref.dept && y.fn.name === ref.fn && y.line.t === ref.t) return y;
  return x;
}

export function slotState(x: SlotRef, m: Marks): SlotLine['state'] {
  const home = homeOf(x);
  return home.line.state === 'none' && m.asked[home.id] ? 'asked' : home.line.state;
}

/** A photograph's description counts once a person has accepted it. */
export const photoOk = (x: PhotoRef, m: Marks): boolean => x.photo.state === 'ok' || Boolean(m.described[x.id]);

export const standingOf = (dept: Department, fn: FunctionSpec, m: Marks): Standing => m.certified[fnId(dept, fn)] ?? fn.standing;

/* ---- words and figures ---- */

const TONES: [RegExp, Tone][] = [
  [/^(high|critical|expired|overdue|missing|rejected|failed|late)$/i, 'critical'],
  [/^(medium|moderate|expiring|due|asked|open|pending|partly|partial)$/i, 'warning'],
  [/^(low|in force|done|closed|paid|passed|accepted|met|received|filed|on time|stated)$/i, 'good'],
];

/** The colour a status word is drawn in. A word the rules do not know stays grey. */
export const tone = (word: string): Tone => TONES.find(([re]) => re.test(word.trim()))?.[1] ?? 'neutral';

/** The first number in a cell: "₹ 1,840 L" is 1840. */
export function num(cell: string): number | null {
  const hit = cell.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return hit ? Number(hit[0]) : null;
}

export const fmt = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-IN');

export const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;

/** A steady number from a piece of text, so an example default is the same on every visit. */
export function hash(text: string): number {
  let n = 7;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  return n;
}

const EXPECTED: CheckMark[] = ['yes', 'yes', '', 'yes', 'no', 'yes'];

/** What stands against a line of the must-have checklist: a person's mark, or the example's own. */
export const expectation = (id: string, m: Marks): CheckMark => m.checks[id] ?? EXPECTED[hash(id) % EXPECTED.length] ?? '';

/* ---- where a name leads ---- */

/** A function, or a department's Summary when `fn` is null. */
export interface Target {
  dept: Department;
  fn: FunctionSpec | null;
}

/** A function of this department first, then any function, then a department. */
export function target(name: string, from: Department): Target | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  for (const dept of [from, ...DEPARTMENTS.filter((d) => d !== from)]) {
    const fn = dept.functions.find((f) => f.name.toLowerCase() === wanted);
    if (fn) return { dept, fn };
  }
  const dept = DEPARTMENTS.find((d) => d.label.toLowerCase() === wanted);
  return dept ? { dept, fn: null } : null;
}

/** "Budget and Progress" names two places; a name that leads nowhere is dropped. */
export function targets(names: string, from: Department): Target[] {
  const found: Target[] = [];
  for (const name of names.split(/,|\band\b/)) {
    const to = target(name, from);
    if (to && !found.some((t) => t.dept === to.dept && t.fn === to.fn)) found.push(to);
  }
  return found;
}

export const targetLabel = (to: Target): string => (to.fn ? `${to.dept.label} · ${to.fn.name}` : to.dept.label);

/** The first place a kind of block lives: in this department if it has one, otherwise wherever it is. */
export function firstBlock(type: Block['type'], first: Department | null): At | null {
  for (const dept of [...(first ? [first] : []), ...DEPARTMENTS.filter((d) => d !== first)]) {
    for (const fn of dept.functions) {
      const section = fn.sections.find((s) => s.blocks.some((b) => b.type === type));
      if (section) return { dept, fn, section };
    }
  }
  return null;
}

/** The project keeps one map, in Engineering · Site. Every other map is a view of it. */
export function mapHome(): At | null {
  const dept = DEPARTMENTS.find((d) => d.key === 'engineering');
  const fn = dept?.functions.find((f) => f.name === 'Site');
  const section = fn?.sections.find((s) => s.blocks.some((b) => b.type === 'map'));
  return dept && fn && section ? { dept, fn, section } : null;
}

/* ---- what the copilot notices, and what is on the record as a flag ---- */

export interface InsightRef {
  id: string;
  fn: FunctionSpec;
  t: string;
  /** The fields it rests on. */
  rests: FieldRef[];
}

export interface FlagRef {
  id: string;
  dept: Department;
  fn: FunctionSpec;
  t: string;
  by: 'rule' | 'person' | 'ai';
  high: boolean;
}

/** The insights nobody has dismissed. */
export function insightsOf(dept: Department, fn: FunctionSpec, m: Marks): InsightRef[] {
  const fields = fieldsIn(fn);
  return fn.insights
    .map((x, i) => ({
      id: `${fnId(dept, fn)}/ins/${i}`,
      fn,
      t: x.t,
      rests: x.rests.map((label) => fields.find((y) => y.item.l === label)).filter((y): y is FieldRef => Boolean(y)),
    }))
    .filter((x) => !m.dismissed[x.id]);
}

/** The flags on the record, and the insights a person raised as one. */
export function flagsOf(dept: Department, fn: FunctionSpec, m: Marks): FlagRef[] {
  return [
    ...fn.flags.map((f, i): FlagRef => ({ id: `${fnId(dept, fn)}/flag/${i}`, dept, fn, t: f.t, by: f.by, high: f.level === 'high' })),
    ...insightsOf(dept, fn, m)
      .filter((x) => m.raised[x.id])
      .map((x): FlagRef => ({ id: x.id, dept, fn, t: x.t, by: 'ai', high: false })),
  ];
}

/** A flag by its id, wherever it was raised. Gone once the insight behind it is dismissed. */
export function flagById(id: string, m: Marks): FlagRef | undefined {
  for (const dept of DEPARTMENTS) {
    for (const fn of dept.functions) {
      const hit = flagsOf(dept, fn, m).find((f) => f.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Every open flag of a department at a stage, the most serious first. */
export function allFlags(dept: Department, stage: ExampleStage, m: Marks): FlagRef[] {
  return fnsOf(dept, stage)
    .flatMap((fn) => flagsOf(dept, fn, m))
    .sort((a, b) => Number(b.high) - Number(a.high));
}

/* ---- a department at a stage, in four figures ---- */

export interface Summary {
  /** Papers kept here, leaving out the ones that only refer to an original elsewhere. */
  docs: SlotRef[];
  docsIn: number;
  /** Papers nobody has asked for yet. */
  pending: number;
  /** Values the copilot read that wait for a person. */
  waiting: FieldRef[];
  flags: FlagRef[];
  /** Papers in hand, as a percentage. */
  ready: number;
}

export function summary(dept: Department, stage: ExampleStage, m: Marks): Summary {
  const fns = fnsOf(dept, stage);
  const docs = fns.flatMap(slotsIn).filter((x) => !x.line.ref);
  const docsIn = docs.filter((x) => slotState(x, m) === 'in').length;
  return {
    docs,
    docsIn,
    pending: docs.filter((x) => slotState(x, m) === 'none').length,
    waiting: fns.flatMap(fieldsIn).filter((x) => fieldState(x, m) === 'sug'),
    flags: allFlags(dept, stage, m),
    ready: docs.length ? Math.round((docsIn / docs.length) * 100) : 0,
  };
}
