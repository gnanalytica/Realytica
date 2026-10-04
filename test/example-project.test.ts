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
  low?: boolean;
  estimate?: number | null;
  total?: boolean;
  source?: string;
  from?: string;
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
const PINS = new Set(['borehole', 'photo', 'visit', 'comparable', 'competitor', 'amenity']);
const DEPARTMENT_NAMES = new Set(['legal', 'finance', 'engineering', 'commercial', 'procurement']);

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
        // The page adds a last section of its own under this id.
        assert.notEqual(sec.id, 'checks', `${at}: a section takes the id of the page's own Checks and flags`);
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
        for (const row of block.rows as unknown[][]) for (const cell of row) assert.equal(typeof cell, 'string', `${where}: a cell is not text`);
      }
    }
  });

  it('totals a column only in one unit', () => {
    for (const { fn, at } of everyFunction) {
      for (const { sec, block } of blocksOf(fn)) {
        if (block.type !== 'table' || !block.total) continue;
        for (const index of block.money ?? []) {
          const units = new Set((block.rows as string[][]).map((row) => row[index]!.trim().split(' ').at(-1)).filter((unit) => unit === 'L' || unit === 'Cr'));
          assert.ok(units.size <= 1, `${at} › ${sec.name}: column ${index} mixes lakh and crore, so its total would be wrong`);
        }
      }
    }
  });

  it('compares bids across at least two columns, with the estimate named where there is one', () => {
    let comparisons = 0;
    for (const { fn, at } of everyFunction) {
      for (const { sec, block } of blocksOf(fn)) {
        if (block.type !== 'table' || !block.low) continue;
        comparisons += 1;
        const cols = block.cols!;
        const where = `${at} › ${sec.name}`;
        if (block.estimate != null) assert.ok(Number.isInteger(block.estimate) && block.estimate >= 1 && block.estimate < cols.length, `${where}: estimate column ${block.estimate}`);
        // A column headed "Estimate" that the data does not name would be compared as if it were a bid.
        cols.forEach((col, i) => {
          if (/^estimate$/i.test(col.trim())) assert.equal(block.estimate, i, `${where}: the Estimate column is not named as the estimate`);
        });
        assert.ok(cols.length - 1 - (block.estimate != null ? 1 : 0) >= 2, `${where}: nothing to compare`);
      }
    }
    assert.ok(comparisons > 0);
  });

  it('names a function or a department wherever rows arrive from one', () => {
    const functions = new Set(everyFunction.map(({ fn }) => fn.name.toLowerCase()));
    for (const { fn, at } of everyFunction) {
      for (const { sec, block } of blocksOf(fn)) {
        if (block.type !== 'table' || block.source !== 'link') continue;
        assert.equal(typeof block.from, 'string', `${at} › ${sec.name}: rows arrive from nowhere`);
        for (const name of block.from!.split(/,| and /).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
          assert.ok(functions.has(name) || DEPARTMENT_NAMES.has(name), `${at} › ${sec.name}: rows arrive from "${name}", which is neither a function nor a department`);
        }
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
        assert.equal(line.state, original.state, `${at}: "${line.t}" says ${line.state} where its original says ${original.state}`);
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
        assert.ok(Array.isArray(block.layers), `${where}: no layers`);
        for (const layer of block.layers ?? []) assert.ok(LAYERS.has(layer), `${where}: layer "${layer}"`);
        for (const pin of block.pins ?? []) {
          assert.ok(PINS.has(pin.kind), `${where}: pin "${pin.kind}"`);
          assert.ok(pin.x >= 0 && pin.x <= 100 && pin.y >= 0 && pin.y <= 100, `${where}: a pin is off the map`);
        }
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
      for (const list of ['indicative', 'certified', 'reports', 'sent']) assert.ok(Array.isArray(fn.outputs[list]), `${at}: outputs.${list} is missing`);
      for (const insight of fn.insights) assert.ok(Array.isArray(insight.rests), `${at}: the insight "${insight.t}" does not say what it rests on, even as an empty list`);
    }
  });
});
