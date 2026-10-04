import type { MapBlockSpec } from './MapBlock';
import type { ExampleStage } from './paths';

/**
 * The example project's screens, as data.
 *
 * A department file lists its functions. A function names its own sections,
 * a section is made of blocks, and a block is one way of taking an input or
 * showing a result. The page draws whatever the files say, so a new section
 * is a change to a file and not to a screen.
 */

export type DeptKey = 'legal' | 'finance' | 'engineering' | 'commercial' | 'procurement';

/** The icons a section may ask for. `icons.ts` gives each its drawing. */
export type IconName =
  | 'details'
  | 'checks'
  | 'docs'
  | 'photos'
  | 'flags'
  | 'ai'
  | 'report'
  | 'fns'
  | 'links'
  | 'map'
  | 'table'
  | 'calendar'
  | 'money'
  | 'people'
  | 'search'
  | 'timeline'
  | 'shield'
  | 'truck'
  | 'box'
  | 'key'
  | 'chat'
  | 'scale';

/* ---- the blocks ---- */

/** A named paper the function expects. With `ref` it only refers to its original, kept in another function. */
export interface SlotLine {
  t: string;
  state: 'in' | 'asked' | 'none';
  pages?: number;
  who?: string;
  due?: string;
  ref?: { dept: DeptKey; fn: string; t: string };
}

export interface SlotsBlock {
  type: 'slots';
  title?: string;
  groups: { name: string; lines: SlotLine[] }[];
}

/** A typed fact: on record, read by the copilot and waiting, worked out, assumed, or not filled. */
export interface FieldItem {
  l: string;
  v: string;
  state: 'set' | 'sug' | 'calc' | 'assume' | 'empty';
  /** The paper it was read from, by the exact text of that paper's line. */
  from?: string;
  page?: number;
  options?: string[];
}

export interface FieldsBlock {
  type: 'fields';
  title?: string;
  items: FieldItem[];
}

export type TableSource = 'typed' | 'import' | 'phone' | 'link' | 'message' | 'fetched';

export interface TableBlock {
  type: 'table';
  title?: string;
  cols: string[];
  rows: string[][];
  /** The column drawn as a coloured chip. */
  status: number | null;
  /** Right-aligned amount columns. */
  money: number[];
  /** A column of percentages drawn as bars. */
  bar: number | null;
  total: boolean;
  /** A comparison: the lowest amount in each row is marked. */
  low: boolean;
  source: TableSource;
  /** Who or what the rows came from, when they were not typed here. */
  from: string;
  /** The label of the add button; empty when rows cannot be added by hand. */
  add: string;
  /** Longer than a register usually is. */
  long?: boolean;
}

export type PhotoArtKind = 'column' | 'damp' | 'edge' | 'stone' | 'road' | 'drain';

export interface PhotoItem {
  where: string;
  says: string;
  art: PhotoArtKind;
  state: 'sug' | 'ok';
}

export interface PhotosBlock {
  type: 'photos';
  title?: string;
  items: PhotoItem[];
}

export interface SearchBlock {
  type: 'search';
  title?: string;
  source: string;
  query: string;
  results: { t: string; sub?: string; picked?: boolean }[];
}

export interface TimelineBlock {
  type: 'timeline';
  title?: string;
  items: { year: string; t: string; sub?: string; state: 'in' | 'gap' | 'sug' }[];
}

export interface FigureBlock {
  type: 'figure';
  title?: string;
  label: string;
  value: string;
  range?: [string, string];
  chips?: string[];
  stats?: { l: string; v: string; n?: string }[];
  share?: { l: string; p: number }[];
}

export interface BoardBlock {
  type: 'board';
  title?: string;
  items: { t: string; plan: number; actual: number; due: string; state: string }[];
}

export interface CalendarBlock {
  type: 'calendar';
  title?: string;
  items: { t: string; due: string; who?: string; state: string }[];
}

export interface GridBlock {
  type: 'grid';
  title?: string;
  legend: string[];
  rows: { name: string; cells: string[] }[];
}

export interface QaItem {
  q: string;
  a: string;
  source: string;
  proof: string;
  state: 'answered' | 'suggested' | 'open';
}

export interface QaBlock {
  type: 'qa';
  title?: string;
  items: QaItem[];
}

/** Filled from the function's own `outputs`: certified results, reports, things sent on. */
export interface OutputsBlock {
  type: 'outputs';
  title?: string;
}

export type Block =
  | SlotsBlock
  | FieldsBlock
  | TableBlock
  | PhotosBlock
  | MapBlockSpec
  | SearchBlock
  | TimelineBlock
  | FigureBlock
  | BoardBlock
  | CalendarBlock
  | GridBlock
  | QaBlock
  | OutputsBlock;

/* ---- a function and its department ---- */

export interface Section {
  id: string;
  name: string;
  icon: IconName;
  blocks: Block[];
}

export interface CertifiedStanding {
  state: 'certified';
  by: string;
  role: string;
  on: string;
  /** The running estimate has drifted since it was signed. */
  moved: boolean;
}

export interface IndicativeStanding {
  state: 'indicative';
  basis: string;
}

export type Standing = CertifiedStanding | IndicativeStanding;

export interface Insight {
  t: string;
  /** Labels of the fields in this function that it rests on. */
  rests: string[];
}

export interface FlagSpec {
  t: string;
  by: 'rule' | 'person';
  level: 'high' | 'medium';
}

export interface Outputs {
  indicative: string[];
  certified: string[];
  reports: string[];
  sent: string[];
}

export interface Standard {
  name: string;
  why: string;
  url: string;
}

export interface FunctionSpec {
  name: string;
  /** The stages at which this function has work. */
  stages: ExampleStage[];
  standing: Standing;
  sections: Section[];
  insights: Insight[];
  flags: FlagSpec[];
  outputs: Outputs;
  mustHave: string[];
  standards: Standard[];
}

/** One department file, as written. */
export interface DepartmentSpec {
  department: string;
  functions: FunctionSpec[];
}

/** A department as the page uses it: its key in a path, its name, its functions. */
export interface Department {
  key: DeptKey;
  label: string;
  functions: FunctionSpec[];
}
