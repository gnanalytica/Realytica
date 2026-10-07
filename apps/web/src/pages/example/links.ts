import { blockId, homeOf, slotById, targets, type At } from './engine';
import type { ExampleStage } from './paths';
import { DEPARTMENTS } from './spec';
import type { Department, FunctionSpec, Section } from './types';

/**
 * How the departments connect, read from the files themselves: a paper that
 * is filed in another function, and a table whose rows arrive from one.
 *
 * Nobody draws these. A function that refers to another's paper, or takes its
 * rows from it, has said so in its own screen, and that is the connection.
 */

export interface Link {
  id: string;
  kind: 'paper' | 'table';
  /** The paper or the table, as the function that uses it names it. */
  what: string;
  /** Where it is used. */
  user: At;
  /** Where it is kept or comes from: a function, or a department as a whole. */
  origin: { dept: Department; fn: FunctionSpec | null; section: Section | null };
}

const LINKS: Link[] = [];

for (const dept of DEPARTMENTS) {
  for (const fn of dept.functions) {
    for (const section of fn.sections) {
      section.blocks.forEach((block, index) => {
        const user = { dept, fn, section };
        const bid = blockId(dept, fn, section, index);
        if (block.type === 'slots') {
          block.groups.forEach((group, gi) =>
            group.lines.forEach((line, li) => {
              const here = slotById(`${bid}/${gi}.${li}`);
              const home = here ? homeOf(here) : undefined;
              if (here && home && home !== here) LINKS.push({ id: here.id, kind: 'paper', what: line.t, user, origin: { dept: home.dept, fn: home.fn, section: home.section } });
            }),
          );
        }
        if (block.type === 'table' && block.source === 'link') {
          targets(block.from, dept).forEach((to, i) => {
            if (to.fn !== fn) LINKS.push({ id: `${bid}>${i}`, kind: 'table', what: block.title ?? 'Register', user, origin: { dept: to.dept, fn: to.fn, section: null } });
          });
        }
      });
    }
  }
}

export interface Connections {
  /** What the department takes in from another function. */
  takes: Link[];
  /** What other departments take from it. */
  gives: Link[];
}

export function connections(dept: Department, stage: ExampleStage): Connections {
  return {
    takes: LINKS.filter((l) => l.user.dept === dept && l.user.fn.stages.includes(stage)),
    gives: LINKS.filter((l) => l.origin.dept === dept && l.user.dept !== dept && (!l.origin.fn || l.origin.fn.stages.includes(stage))),
  };
}

export const originLabel = (l: Link): string => (l.origin.fn ? `${l.origin.dept.label} · ${l.origin.fn.name}` : l.origin.dept.label);
export const userLabel = (l: Link): string => `${l.user.dept.label} · ${l.user.fn.name}`;

/** "Filed in Legal · Approvals", "Arrives from Engineering · Progress". */
export const takenFrom = (l: Link): string => `${l.kind === 'paper' ? 'Filed in' : 'Arrives from'} ${originLabel(l)}`;

/** The same connection, said from the side that gives. */
export const passedTo = (l: Link): string => `${l.kind === 'paper' ? 'Used in' : 'Arrives in'} ${userLabel(l)}`;
