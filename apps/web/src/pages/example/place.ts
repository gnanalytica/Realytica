import { createContext, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Act } from './chat';
import { fieldById, photoById, slotById, type FlagRef } from './engine';
import { EXAMPLE_STAGE_NOW, examplePath, type ExampleStage } from './paths';
import { STAGES, departmentAt, departmentOf, functionOf, runs, stageFor } from './spec';
import { useExample } from './state';
import type { Department, FunctionSpec } from './types';

/**
 * Where the page is, and the ways to go somewhere else.
 *
 * The address holds the department, the function and the stage, so the back
 * button and a link from anywhere land on the same page. What is picked or
 * opened on a page is held with the page's key, so its proof and its paper
 * show there and nowhere else.
 */

export interface Place {
  /** Null on the project's overview. */
  dept: Department | null;
  /** Null on a department's Summary, and on the overview. */
  fn: FunctionSpec | null;
  /** The stage being looked at. */
  stage: ExampleStage;
  /** One string for the page. */
  key: string;
}

export const placeKey = (dept: Department | null, fn: FunctionSpec | null, stage: ExampleStage): string =>
  dept ? `${dept.key}/${fn ? fn.name : 'summary'}@${stage}` : 'overview';

/**
 * The page an address means, or the address to go to instead.
 *
 * A function named in a link is opened at a stage it has work in, whatever
 * stage the link carried. A department with no work at the stage gives way to
 * the first one that has. Either way the section the link asked for is kept.
 */
export function readPlace(department: string | undefined, fnName: string | undefined, stageParam: string | null, part: string | null): Place | { redirect: string } {
  const stage = STAGES.find((s) => s.key === stageParam)?.key ?? EXAMPLE_STAGE_NOW;
  const keep = part ?? undefined;
  if (!department) return { dept: null, fn: null, stage, key: placeKey(null, null, stage) };
  const dept = departmentOf(department);
  if (!dept) return { redirect: examplePath() };
  const fn = functionOf(dept, fnName);
  if (fn) {
    const at = stageFor(fn, stage);
    return at === stage ? { dept, fn, stage, key: placeKey(dept, fn, stage) } : { redirect: examplePath(dept.key, fn.name, { stage: at, part: keep }) };
  }
  const running = departmentAt(dept, stage);
  if (fnName || running !== dept) return { redirect: running ? examplePath(running.key, undefined, { stage, part: keep }) : examplePath() };
  return { dept, fn: null, stage, key: placeKey(dept, null, stage) };
}

const PlaceContext = createContext<Place | null>(null);

export const PlaceProvider = PlaceContext.Provider;

export function usePlace(): Place {
  const place = useContext(PlaceContext);
  if (!place) throw new Error('usePlace is used inside the example project page');
  return place;
}

/**
 * Whether this is the thing whose proof is on show: 0 when it is not,
 * otherwise the number of this showing, which changes each time it is shown.
 */
export function usePicked(kind: 'field' | 'photo' | 'flag', id: string): number {
  const { picked } = useExample().state;
  const place = usePlace();
  return picked !== null && picked.kind === kind && picked.id === id && picked.at === place.key ? picked.visit : 0;
}

export interface Open {
  /** The overview, a department's Summary or one of its functions. `part` brings a section into view. */
  to(dept: Department | null, fn?: FunctionSpec | null, at?: { stage?: ExampleStage; part?: string }): void;
  /** Look at another stage, keeping the department and the function where they have work then. */
  stage(stage: ExampleStage): void;
  /** A value on its own page, with its proof beside it. */
  field(id: string): void;
  photo(id: string): void;
  /** A flag's proof, here or on the page of the function that raised it. */
  flag(flag: FlagRef, where?: 'here' | 'home'): void;
  /** A paper, over the page being looked at or over the page of the function that keeps it. */
  paper(id: string, where?: 'here' | 'home'): void;
  /** Whatever the copilot says it will show. */
  act(act: Act): void;
}

export function useOpen(): Open {
  const navigate = useNavigate();
  const place = usePlace();
  const { dispatch } = useExample();

  /** Goes to a page unless it is the one on screen, and returns its key. */
  const go = (dept: Department | null, fn: FunctionSpec | null, stage: ExampleStage, part?: string): string => {
    const key = placeKey(dept, fn, stage);
    if (key !== place.key || part) navigate(examplePath(dept?.key, fn?.name, { stage, part }));
    return key;
  };

  const to: Open['to'] = (dept, fn = null, at = {}) => {
    dispatch({ type: 'close' });
    if (!dept) {
      go(null, null, place.stage);
      return;
    }
    const looking = at.stage ?? place.stage;
    const stage = fn ? stageFor(fn, looking) : runs(dept, looking) ? looking : EXAMPLE_STAGE_NOW;
    go(dept, fn, stage, at.part);
  };

  const field: Open['field'] = (id) => {
    const x = fieldById(id);
    if (x) dispatch({ type: 'pick', picked: { kind: 'field', id, at: go(x.dept, x.fn, stageFor(x.fn, place.stage)) } });
  };

  const photo: Open['photo'] = (id) => {
    const x = photoById(id);
    if (x) dispatch({ type: 'pick', picked: { kind: 'photo', id, at: go(x.dept, x.fn, stageFor(x.fn, place.stage)) } });
  };

  const flag: Open['flag'] = (f, where = 'here') => {
    const at = where === 'home' ? go(f.dept, f.fn, stageFor(f.fn, place.stage)) : place.key;
    dispatch({ type: 'pick', picked: { kind: 'flag', id: f.id, at } });
  };

  const paper: Open['paper'] = (id, where = 'here') => {
    const x = slotById(id);
    if (!x) return;
    if (where === 'here') {
      dispatch({ type: 'view', viewing: { id, at: place.key } });
      return;
    }
    dispatch({ type: 'close' });
    dispatch({ type: 'view', viewing: { id, at: go(x.dept, x.fn, stageFor(x.fn, place.stage)) } });
  };

  return {
    to,
    field,
    photo,
    flag,
    paper,
    stage(stage) {
      const dept = departmentAt(place.dept ?? departmentOf('engineering'), stage);
      if (dept) to(dept, dept === place.dept && place.fn?.stages.includes(stage) ? place.fn : null, { stage });
    },
    act(act) {
      dispatch({ type: 'view', viewing: null });
      if (act.kind === 'summary') to(act.dept, null, { stage: act.stage, part: act.part });
      else if (act.kind === 'fn') to(act.dept, act.fn, { part: act.part });
      else if (act.kind === 'field') field(act.id);
      else if (act.kind === 'photo') photo(act.id);
      else if (act.kind === 'flag') flag(act.flag, 'home');
      else paper(act.id, 'home');
    },
  };
}
