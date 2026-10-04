/**
 * The example project's pages are data, and the screens trust that data.
 *
 * Each department of the example is one JSON file: its functions, their
 * sections, and the blocks each section is made of. Nothing type-checks a
 * JSON file, so a block with a mistyped kind, a table row one cell short, or
 * a value that claims to come from a document the function does not hold
 * would only show as a broken page. These are the rules the screens rely on,
 * checked on the files themselves.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

interface Line {
  t: string;
  state: string;
  ref?: { dept: string; fn: string; t: string };
}
interface Block {
  type: string;
  groups?: Array<{ name: string; lines: Line[] }>;
  items?: Array<Record<string, unknown>>;
  cols?: string[];
  rows?: unknown[];
  status?: number | null;
  bar?: number | null;
  money?: number[];
  source?: string;
  view?: string;
  layers?: string[];
  pins?: Array<{ kind: string; x: number; y: number }>;
  measures?: Array<{ tone: string }>;
  share?: Array<{ p: number }>;
  legend?: string[];
}
interface Section {
  id: string;
  name: string;
  icon: string;
  blocks: Block[];
}
interface Fn {
  name: string;
  stages: string[];
  standing: { state: string; by?: string; role?: string; on?: string; basis?: string };
  sections: Section[];
  insights: Array<{ t: string; rests?: string[] }>;
  flags: Array<{ t: string; by: string; level: string }>;
  outputs: Record<string, string[]>;
  mustHave: string[];
  standards: Array<{ name: string; why: string; url: string }>;
}

/** The departments in the order of the menu, with the functions each must hold. */
const EXPECTED: Record<string, string[]> = {
  legal: ['Title', 'Approvals', 'RERA', 'Contracts', 'Handover'],
  finance: ['Valuation', 'Feasibility', 'Budget', 'Funding', 'Tax'],
  engineering: ['Design', 'Progress', 'Technical', 'Site', 'Safety'],
  commercial: ['Market', 'Sales', 'Collections', 'Handover', 'Operations'],
  procurement: ['Tenders', 'Orders', 'Vendors', 'Deliveries'],
};

const STAGES = new Set(['land', 'pre', 'build', 'done']);
const ICONS = new Set('details checks docs photos flags ai report fns links map table calendar money people search timeline shield truck box key chat scale'.split(' '));
const BLOCKS = new Set(['slots', 'fields', 'table', 'photos', 'map', 'search', 'timeline', 'figure', 'board', 'calendar', 'grid', 'qa', 'outputs']);
const LAYERS = new Set(['plot', 'survey', 'water', 'planning', 'roads', 'power', 'airport', 'rings']);

const SPEC: Record<string, Fn[]> = Object.fromEntries(
  Object.keys(EXPECTED).map((dept) => {
    const file = new URL(`../apps/web/src/pages/example/spec/${dept}.json`, import.meta.url);
    return [dept, (JSON.parse(readFileSync(file, 'utf8')) as { functions: Fn[] }).functions];
  }),
);

const everyFunction = Object.entries(SPEC).flatMap(([dept, fns]) => fns.map((fn) => ({ dept, fn, at: `${dept} · ${fn.name}` })));
const blocksOf = (fn: Fn) => fn.sections.flatMap((sec) => sec.blocks.map((block) => ({ sec, block })));
const linesOf = (fn: Fn) => blocksOf(fn).flatMap(({ block }) => (block.type === 'slots' ? (block.groups ?? []).flatMap((g) => g.lines) : []));

describe('the example project', () => {
  it('holds the five departments and their twenty-four functions, in the order of the menu', () => {
    for (const [dept, names] of Object.entries(EXPECTED)) {
      assert.deepEqual(SPEC[dept]!.map((f) => f.name), names, dept);
    }
    assert.equal(everyFunction.length, 24);
  });

  it('places every function at stages that exist, and says how it stands', () => {
    for (const { fn, at } of everyFunction) {
      assert.ok(fn.stages.length > 0 && fn.stages.every((s) => STAGES.has(s)), `${at}: stages ${fn.stages.join(', ')}`);
      if (fn.standing.state === 'certified') assert.ok(fn.standing.by && fn.standing.role && fn.standing.on, `${at}: a certified result names who signed, as what, and when`);
      else assert.ok(fn.standing.state === 'indicative' && fn.standing.basis, `${at}: an indicative result says what it rests on`);
    }
  });

  it('gives every section its own id and a known icon, and ends each function on what it puts out', () => {
    for (const { fn, at } of everyFunction) {
      const ids = fn.sections.map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length, `${at}: section ids repeat`);
      for (const sec of fn.sections) {
        assert.match(sec.id, /^[a-z]+$/, `${at}: section id "${sec.id}"`);
        assert.ok(ICONS.has(sec.icon), `${at} › ${sec.name}: icon "${sec.icon}"`);
        assert.ok(sec.blocks.length > 0, `${at} › ${sec.name}: no blocks`);
        for (const block of sec.blocks) assert.ok(BLOCKS.has(block.type), `${at} › ${sec.name}: block "${block.type}"`);
      }
      const all = blocksOf(fn);
      assert.equal(all.filter(({ block }) => block.type === 'outputs').length, 1, `${at}: exactly one outputs block`);
      assert.equal(all.at(-1)!.block.type, 'outputs', `${at}: outputs comes last`);
    }
  });

  it('keeps every table square and its marked columns inside it', () => {
    for (const { fn, at } of everyFunction) {
      for (const { sec, block } of blocksOf(fn)) {
        if (block.type !== 'table') continue;
        const cols = block.cols!.length;
        const where = `${at} › ${sec.name}`;
        for (const row of block.rows as unknown[][]) assert.equal(row.length, cols, `${where}: a row does not have ${cols} cells`);
        for (const index of [block.status, block.bar, ...(block.money ?? [])]) {
          if (index != null) assert.ok(Number.isInteger(index) && index >= 0 && index < cols, `${where}: column ${index} of ${cols}`);
        }
        assert.ok(['typed', 'import', 'phone', 'link', 'message', 'fetched'].includes(block.source ?? ''), `${where}: source "${block.source}"`);
      }
    }
  });

  it('reads a value only from a paper the same function holds', () => {
    for (const { fn, at } of everyFunction) {
      const papers = new Set(linesOf(fn).map((l) => l.t));
      for (const { sec, block } of blocksOf(fn)) {
        if (block.type !== 'fields') continue;
        for (const item of block.items ?? []) {
          if (item.from) assert.ok(papers.has(String(item.from)), `${at} › ${sec.name}: "${String(item.l)}" is read from "${String(item.from)}", which the function does not list`);
        }
      }
    }
  });

  it('keeps one home for a paper: a line that refers elsewhere finds its original there', () => {
    let refs = 0;
    for (const { fn, at } of everyFunction) {
      for (const line of linesOf(fn)) {
        if (!line.ref) continue;
        refs += 1;
        const home = (SPEC[line.ref.dept] ?? []).find((f) => f.name === line.ref!.fn);
        assert.ok(home, `${at}: "${line.t}" is filed in ${line.ref.dept} · ${line.ref.fn}, which does not exist`);
        const original = linesOf(home).find((l) => l.t === line.ref!.t);
        assert.ok(original, `${at}: "${line.t}" has no original in ${line.ref.dept} · ${line.ref.fn}`);
        assert.equal(original.ref, undefined, `${at}: the original of "${line.t}" is itself a reference`);
      }
    }
    assert.ok(refs > 0, 'the example shows the rule at least once');
  });

  it('draws every map from known views, layers and pins that sit on it', () => {
    let maps = 0;
    for (const { fn, at } of everyFunction) {
      for (const { sec, block } of blocksOf(fn)) {
        if (block.type !== 'map') continue;
        maps += 1;
        const where = `${at} › ${sec.name}`;
        assert.ok(['site', 'area', 'plot'].includes(block.view ?? ''), `${where}: view "${block.view}"`);
        for (const layer of block.layers ?? []) assert.ok(LAYERS.has(layer), `${where}: layer "${layer}"`);
        for (const pin of block.pins ?? []) assert.ok(pin.x >= 0 && pin.x <= 100 && pin.y >= 0 && pin.y <= 100, `${where}: a pin is off the map`);
        for (const measure of block.measures ?? []) assert.ok(['ok', 'warn', 'crit'].includes(measure.tone), `${where}: tone "${measure.tone}"`);
      }
    }
    assert.ok(maps > 0);
  });

  it('adds a figure split to a hundred and colours a stack plan only from its legend', () => {
    for (const { fn, at } of everyFunction) {
      for (const { sec, block } of blocksOf(fn)) {
        const where = `${at} › ${sec.name}`;
        if (block.type === 'figure' && block.share) assert.equal(block.share.reduce((n, s) => n + s.p, 0), 100, `${where}: the split`);
        if (block.type === 'grid') {
          const legend = new Set(block.legend);
          for (const row of block.rows as Array<{ cells: string[] }>) for (const cell of row.cells) assert.ok(legend.has(cell), `${where}: "${cell}" is not in the legend`);
        }
      }
    }
  });

  it('says for every function what a proper project expects of it and what it rests on', () => {
    for (const { fn, at } of everyFunction) {
      assert.ok(fn.mustHave.length > 0, `${at}: nothing to check`);
      assert.ok(fn.standards.length > 0, `${at}: no standard named`);
      for (const standard of fn.standards) assert.match(standard.url, /^https:\/\//, `${at}: "${standard.name}" has no https link`);
      for (const flag of fn.flags) assert.ok(['rule', 'person'].includes(flag.by) && ['high', 'medium'].includes(flag.level), `${at}: flag "${flag.t}"`);
    }
  });
});
