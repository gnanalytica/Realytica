/**
 * The two reads the copilot prompt has always instructed and could not make:
 * a check's field schema, and the report as it stands.
 *
 * The bug these cover is not a wrong answer, it is an impossible instruction.
 * Rule 8a told the model to call `get_check_fields` before asking for a value,
 * and rule 3d to call `get_report` before touching a report; neither tool was
 * in the set handed to it, so the only moves left were to invent field keys
 * (refused on the way in) or to narrate a call it never made. The last test
 * here is the general guard: every tool the prompts name must exist.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  checkFieldReading,
  findCheck,
  openReportOf,
  seedDemoProject,
  type DdProject,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

interface CustomTool {
  name: string;
  description?: string;
  run: (args: never, context: never) => Promise<string> | string;
}

function toolsFor(project: DdProject) {
  const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] };
  const tools = createProjectTools(project, 'tester', bag) as unknown as CustomTool[];
  return { bag, tools };
}

function tool(project: DdProject, name: string) {
  const { bag, tools } = toolsFor(project);
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `expected the tool set to include ${name}`);
  return { bag, run: (args: unknown) => found.run(args as never, undefined as never) };
}

/** A check that declares fields, so there is a schema to read. */
function checkWithFields(project: DdProject) {
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (checkFieldReading(check).total > 0) return check;
      }
    }
  }
  throw new Error('the demo file has no check with declared fields');
}

describe('get_check_fields', () => {
  it('hands back the exact keys record_check_fields will accept', async () => {
    const project = seedDemoProject();
    const check = checkWithFields(project);
    const { run } = tool(project, 'get_check_fields');

    const out = JSON.parse(String(await run({ checkId: check.id })));
    const reading = checkFieldReading(check);

    assert.equal(out.check.id, check.id);
    assert.equal(out.total, reading.total);
    assert.equal(out.filled, reading.filled);
    assert.deepEqual(
      out.fields.map((f: { key: string }) => f.key),
      reading.defs.map((d) => d.key),
    );
    // The point of the tool: a label and a unit to ask the question with.
    for (const field of out.fields) {
      assert.equal(typeof field.key, 'string');
      assert.equal(typeof field.label, 'string');
      assert.equal(typeof field.blank, 'boolean');
    }
  });

  it('separates what is still blank from what is recorded without proof', async () => {
    const project = seedDemoProject();
    const check = checkWithFields(project);
    const reading = checkFieldReading(check);
    const { run } = tool(project, 'get_check_fields');

    const out = JSON.parse(String(await run({ checkId: check.id })));

    assert.deepEqual(
      out.missing.map((f: { key: string }) => f.key),
      reading.missing.map((d) => d.key),
    );
    assert.deepEqual(
      out.unproven.map((f: { key: string }) => f.key),
      reading.unproven.map((d) => d.key),
    );
    // A computed field cannot be answered by a person, so it must never be
    // asked for — the flag is how the model knows to skip it.
    for (const field of out.fields) {
      assert.equal(field.computed, field.kind === 'computed');
    }
    assert.ok(!out.missing.some((f: { computed: boolean }) => f.computed));
  });

  it('carries the computed insights and tolerances rather than inviting arithmetic', async () => {
    const project = seedDemoProject();
    const check = checkWithFields(project);
    const { run } = tool(project, 'get_check_fields');

    const out = JSON.parse(String(await run({ checkId: check.id })));

    assert.ok(Array.isArray(out.insights));
    assert.ok(Array.isArray(out.tolerances));
    assert.match(String(out.note), /never state a divergence/i);
    assert.match(String(out.note), /exact keys/i);
  });

  it('opens the check in the right-hand pane and records the call', async () => {
    const project = seedDemoProject();
    const check = checkWithFields(project);
    const { bag, run } = tool(project, 'get_check_fields');

    await run({ checkId: check.id });

    assert.ok(bag.toolCalls.some((c: { name: string }) => c.name === 'get_check_fields'));
    assert.ok(
      bag.navigations.some((n: { checkId?: string }) => n.checkId === check.id),
      'reading a check should open it',
    );
  });

  it('refuses an unknown check by name instead of throwing', async () => {
    const project = seedDemoProject();
    const { run } = tool(project, 'get_check_fields');

    const out = JSON.parse(String(await run({ checkId: 'chk_nope' })));

    assert.match(String(out.error), /not found/i);
    assert.equal(out.fields, undefined);
  });
});

describe('get_report', () => {
  it('reads the open report and marks which blocks are live', async () => {
    const project = seedDemoProject();
    const open = openReportOf(project);
    assert.ok(open, 'the demo file has an open report');
    const { run } = tool(project, 'get_report');

    const out = JSON.parse(String(await run({})));

    assert.equal(out.report.id, open.id);
    assert.equal(out.report.frozen, false);
    assert.equal(out.blockCount, open.body.blocks.length);
    for (const block of out.blocks) {
      assert.equal(typeof block.id, 'string');
      assert.equal(typeof block.live, 'boolean');
      assert.ok(Array.isArray(block.lines));
    }
    // A derived block that nobody detached is live, and that is the flag the
    // model needs before it proposes text.
    const derived = open.body.blocks.find((b) => b.origin === 'derived' && b.source && !b.detachedAt);
    if (derived) {
      assert.equal(out.blocks.find((b: { id: string }) => b.id === derived.id)?.live, true);
    }
    assert.match(String(out.note), /live block/i);
  });

  it('says a frozen report may not be edited, and shows what it said at issue', async () => {
    const project = seedDemoProject();
    const open = openReportOf(project);
    assert.ok(open);
    open.status = 'issued';
    const first = open.body.blocks[0];
    assert.ok(first);
    first.frozen = ['What the pack said on the day it went out.'];
    const { run } = tool(project, 'get_report');

    const out = JSON.parse(String(await run({ reportId: open.id })));

    assert.equal(out.report.frozen, true);
    assert.deepEqual(out.blocks[0].lines, ['What the pack said on the day it went out.']);
    assert.match(String(out.note), /frozen/i);
    assert.doesNotMatch(String(out.note), /To add prose/i);
  });

  it('answers with no report rather than an error when there is nothing open', async () => {
    const project = seedDemoProject();
    project.reports = [];
    const { run } = tool(project, 'get_report');

    const out = JSON.parse(String(await run({})));

    assert.equal(out.report, null);
    assert.match(String(out.note), /generate_report/);
  });

  it('opens the report pane and records the call', async () => {
    const project = seedDemoProject();
    const { bag, run } = tool(project, 'get_report');

    await run({});

    assert.ok(bag.toolCalls.some((c: { name: string }) => c.name === 'get_report'));
    assert.ok(
      bag.navigations.some((n: { target: string }) => n.target === 'reports'),
      'reading the report should open the reports pane',
    );
  });
});

describe('the prompts and the tool set agree', () => {
  /*
   * The regression itself. A prompt naming a tool that was never registered
   * is invisible until a model follows the instruction, and then it either
   * invents the arguments or claims a call it never made — so the check is
   * mechanical: pull every tool-shaped name out of the prompt source and
   * assert the tool set has it.
   *
   * Only verb prefixes that belong to tools are scanned. Proposal kinds read
   * the same way in prose (`record_check_fields`, `request_evidence`) and are
   * not tools; `run_capability` is the one tool with a `run_` name, so it is
   * named rather than matched by prefix.
   */
  const TOOL_SHAPED = /\b(?:get|search|lookup|ask|review|trace|navigate|compare|propose)_[a-z_]+\b/g;

  function namedIn(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const prompt = source.slice(source.indexOf('const SYSTEM = `'), source.indexOf('`;', source.indexOf('const SYSTEM = `')));
    assert.ok(prompt.length > 200, `could not find the system prompt in ${file}`);
    const found = new Set(prompt.match(TOOL_SHAPED) ?? []);
    if (/\brun_capability\b/.test(prompt)) found.add('run_capability');
    return [...found];
  }

  const registered = new Set(toolsFor(seedDemoProject()).tools.map((t) => t.name));

  for (const file of [
    'packages/agents/src/agents/project-copilot.ts',
    'packages/agents/src/agents/project-orchestrator.ts',
  ]) {
    it(`${file.split('/').pop()} names only tools that exist`, () => {
      const named = namedIn(file);
      assert.ok(named.length > 0, 'the prompt should name at least one tool');
      const missing = named.filter((name) => !registered.has(name));
      assert.deepEqual(missing, [], `the prompt instructs tools that are not registered: ${missing.join(', ')}`);
    });
  }

  it('propose_update points at a field-key read that exists', () => {
    const source = readFileSync('packages/agents/src/tools/project-tools.ts', 'utf8');
    // The payload description tells the model where the keys come from. If
    // that name ever drifts from the registered tool, the advice is a dead end.
    assert.match(source, /call get_check_fields first and use its exact field keys/);
    assert.ok(registered.has('get_check_fields'));
  });

  it('every check the copilot can be sat on can have its fields read', async () => {
    const project = seedDemoProject();
    const check = checkWithFields(project);
    // findCheck is what the API route behind the panel uses; the tool must
    // agree with it, or the model reads a different check than the person sees.
    const seated = findCheck(project, check.id);
    const { run } = tool(project, 'get_check_fields');

    const out = JSON.parse(String(await run({ checkId: check.id })));

    assert.equal(out.assessment.id, seated.assessment.id);
    assert.equal(out.scope.id, seated.scope.id);
  });
});
