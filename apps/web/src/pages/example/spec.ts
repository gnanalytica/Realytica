import { EXAMPLE_STAGE_NOW, type ExampleStage } from './paths';
import type { Department, DepartmentSpec, DeptKey, FunctionSpec } from './types';
import commercial from './spec/commercial.json';
import engineering from './spec/engineering.json';
import finance from './spec/finance.json';
import legal from './spec/legal.json';
import procurement from './spec/procurement.json';

/**
 * The example project: one fictional tower, every department's screens
 * written out as data. Nothing here is fetched and nothing is saved.
 */

export const PROJECT_NAME = 'Lakeview Tower';

/** The one place the files are taken at their word to match the types. */
const FILES = { legal, finance, engineering, commercial, procurement } as unknown as Record<DeptKey, DepartmentSpec>;

const ORDER: DeptKey[] = ['legal', 'finance', 'engineering', 'commercial', 'procurement'];

export const DEPARTMENTS: Department[] = ORDER.map((key) => ({ key, label: FILES[key].department, functions: FILES[key].functions }));

export const STAGES: { key: ExampleStage; label: string }[] = [
  { key: 'land', label: 'Land' },
  { key: 'pre', label: 'Pre-construction' },
  { key: 'build', label: 'Under construction' },
  { key: 'done', label: 'Completed' },
];

export function stageLabel(stage: ExampleStage): string {
  return STAGES.find((s) => s.key === stage)?.label ?? '';
}

/** Behind the project, where it is now, or still ahead of it. */
export function when(stage: ExampleStage): 'past' | 'now' | 'future' {
  const order = STAGES.map((s) => s.key);
  const at = order.indexOf(stage);
  const now = order.indexOf(EXAMPLE_STAGE_NOW);
  return at < now ? 'past' : at > now ? 'future' : 'now';
}

/** A department by its key or its name, whatever the case: a path is typed by hand as often as it is followed. */
export function departmentOf(name: string | undefined): Department | undefined {
  const wanted = (name ?? '').trim().toLowerCase();
  return wanted ? DEPARTMENTS.find((d) => d.key === wanted || d.label.toLowerCase() === wanted) : undefined;
}

export function functionOf(dept: Department, name: string | undefined): FunctionSpec | undefined {
  const wanted = (name ?? '').trim().toLowerCase();
  return wanted ? dept.functions.find((f) => f.name.toLowerCase() === wanted) : undefined;
}

/** The functions of a department that have work at a stage. */
export function fnsOf(dept: Department, stage: ExampleStage): FunctionSpec[] {
  return dept.functions.filter((f) => f.stages.includes(stage));
}

export function runs(dept: Department, stage: ExampleStage): boolean {
  return dept.functions.some((f) => f.stages.includes(stage));
}

/** The department to show at a stage: the one asked for when it has work then, otherwise the first that has. */
export function departmentAt(wanted: Department | undefined, stage: ExampleStage): Department | undefined {
  return wanted && runs(wanted, stage) ? wanted : DEPARTMENTS.find((d) => runs(d, stage));
}

/**
 * The stage to open a function at: the one being looked at when the function
 * has work then, otherwise the stage the project is in, otherwise its first.
 */
export function stageFor(fn: FunctionSpec, looking: ExampleStage): ExampleStage {
  if (fn.stages.includes(looking)) return looking;
  return fn.stages.includes(EXAMPLE_STAGE_NOW) ? EXAMPLE_STAGE_NOW : (fn.stages[0] ?? looking);
}

/** "Legal · Under construction": a department at a stage, in words. */
export function placeLabel(dept: Department, stage: ExampleStage): string {
  return `${dept.label} · ${stageLabel(stage)}`;
}
