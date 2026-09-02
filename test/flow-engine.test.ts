/**
 * Running a drawn flow.
 *
 * The engine is a graph walk over data with every outside reach injected, and
 * that is exactly why it is worth testing hard: these run every branch, loop,
 * filter and failure path without a key, a network or a clock, because the
 * only thing to fake is one function.
 *
 * What is asserted is mostly about *ending* and *not guessing*. An operator
 * can draw a wasteful flow; they must not be able to draw one that never
 * stops, and a node that failed must never leave its absence on the payload
 * looking like an answer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OUT_PORT,
  MAX_LOOP_ITERATIONS,
  evaluateGroup,
  fillTemplate,
  flowCanRun,
  pathPreview,
  readPath,
  runFlow,
  validateFlow,
  type Flow,
  type FlowNode,
  type NodeHandler,
} from '@realytica/shared';

let seq = 0;
const at = () => `2026-09-02T00:00:${String(seq++).padStart(2, '0')}.000Z`;

function node(over: Partial<FlowNode> & Pick<FlowNode, 'id' | 'kind' | 'config'>): FlowNode {
  return { position: { x: 0, y: 0 }, ...over };
}

function flowOf(nodes: FlowNode[], edges: Array<[string, string, string?]>): Flow {
  return {
    id: 'flw_1',
    tenantId: 't1',
    name: 'Test',
    nodes,
    edges: edges.map(([from, to, port], i) => ({ id: `e${i}`, from, fromPort: port ?? DEFAULT_OUT_PORT, to })),
    enabled: true,
    createdAt: at(),
    createdBy: 'dev@firm.in',
    updatedAt: at(),
    updatedBy: 'dev@firm.in',
    version: 1,
  };
}

const TRIGGER = node({ id: 'start', kind: 'trigger', config: { kind: 'trigger', on: 'manual' } });

/** Records what it was asked, and answers with whatever the test set up. */
function handlerFor(answers: Record<string, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const handler: NodeHandler = async ({ node: n }) => {
    calls.push(n.id);
    const answer = answers[n.id];
    if (answer === undefined) return {};
    if (answer.__throw) throw new Error(String(answer.__throw));
    return answer;
  };
  return { handler, calls };
}

describe('a flow that just runs', () => {
  it('walks the trigger into what it feeds', async () => {
    const flow = flowOf(
      [TRIGGER, node({ id: 'a', kind: 'agent', config: { kind: 'agent', agent: 'analyst_copilot' } })],
      [['start', 'a']],
    );
    const { handler, calls } = handlerFor({ a: { answer: 'yes' } });
    const run = await runFlow(flow, { handler, now: at });

    assert.deepEqual(calls, ['a']);
    assert.equal(run.status, 'ok');
    assert.equal(run.payload.answer, 'yes');
    assert.deepEqual(run.steps.map((s) => s.nodeId), ['start', 'a']);
  });

  it('carries what one node produced into the next', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'a', kind: 'agent', config: { kind: 'agent', agent: 'document_intelligence' } }),
        node({ id: 'b', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'a'], ['a', 'b']],
    );
    const seen: unknown[] = [];
    const handler: NodeHandler = async ({ node: n, payload }) => {
      if (n.id === 'b') seen.push(payload.pages);
      return n.id === 'a' ? { pages: 12 } : {};
    };
    await runFlow(flow, { handler, now: at });
    assert.deepEqual(seen, [12]);
  });

  it('runs a node that is turned off as a pass-through, not a stop', async () => {
    // Off is a decision somebody made about one node, not about the path.
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'a', kind: 'agent', disabled: true, config: { kind: 'agent', agent: 'critic' } }),
        node({ id: 'b', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'a'], ['a', 'b']],
    );
    const { handler, calls } = handlerFor();
    const run = await runFlow(flow, { handler, now: at });
    assert.deepEqual(calls, ['b']);
    assert.equal(run.steps.find((s) => s.nodeId === 'a')?.status, 'skipped');
  });
});

describe('deciding which way to go', () => {
  const branching = (cases: Array<{ id: string; label: string; path: string; value: string }>) =>
    flowOf(
      [
        TRIGGER,
        node({
          id: 'split',
          kind: 'branch',
          config: {
            kind: 'branch',
            cases: cases.map((c) => ({ id: c.id, label: c.label, where: { match: 'all', conditions: [{ path: c.path, operator: 'equals', value: c.value }] } })),
          },
        }),
        node({ id: 'yes', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
        node({ id: 'no', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'split'], ['split', 'yes', cases[0]?.id], ['split', 'no', 'default']],
    );

  it('takes the case that matches and nothing else', async () => {
    const flow = branching([{ id: 'c1', label: 'Readable', path: 'readable', value: 'true' }]);
    const { handler, calls } = handlerFor();
    await runFlow(flow, { handler, input: { readable: 'true' }, now: at });
    assert.deepEqual(calls, ['yes'], 'the untaken side must not run');
  });

  it('takes the default way out when nothing matches', async () => {
    const flow = branching([{ id: 'c1', label: 'Readable', path: 'readable', value: 'true' }]);
    const { handler, calls } = handlerFor();
    const run = await runFlow(flow, { handler, input: { readable: 'false' }, now: at });
    assert.deepEqual(calls, ['no']);
    assert.match(String(run.steps.find((s) => s.nodeId === 'split')?.detail), /default/i);
  });

  it('stops a path at a filter that does not pass', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'gate', kind: 'filter', config: { kind: 'filter', where: { match: 'all', conditions: [{ path: 'findings.length', operator: 'greater_than', value: '0' }] } } }),
        node({ id: 'after', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'gate'], ['gate', 'after', 'pass']],
    );
    const { handler, calls } = handlerFor();
    await runFlow(flow, { handler, input: { findings: [] }, now: at });
    assert.deepEqual(calls, []);

    const { handler: h2, calls: c2 } = handlerFor();
    await runFlow(flow, { handler: h2, input: { findings: [{ id: 'f1' }] }, now: at });
    assert.deepEqual(c2, ['after']);
  });
});

describe('repeating, and the ceiling on it', () => {
  const looping = (max?: number) =>
    flowOf(
      [
        TRIGGER,
        node({ id: 'each', kind: 'loop', config: { kind: 'loop', over: 'docs', itemName: 'doc', ...(max === undefined ? {} : { maxIterations: max }) } }),
        node({ id: 'read', kind: 'agent', config: { kind: 'agent', agent: 'document_intelligence' } }),
        node({ id: 'after', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'each'], ['each', 'read', 'body'], ['each', 'after', 'done']],
    );

  it('runs the body once per item, then carries on', async () => {
    const { handler, calls } = handlerFor();
    await runFlow(looping(), { handler, input: { docs: ['a', 'b', 'c'] }, now: at });
    assert.deepEqual(calls, ['read', 'read', 'read', 'after']);
  });

  it('names the item inside the body', async () => {
    const seen: unknown[] = [];
    const handler: NodeHandler = async ({ node: n, payload }) => {
      if (n.id === 'read') seen.push(payload.doc);
      return {};
    };
    await runFlow(looping(), { handler, input: { docs: ['deed', 'khata'] }, now: at });
    assert.deepEqual(seen, ['deed', 'khata']);
  });

  it('clamps a ceiling nobody should be able to raise', async () => {
    // The node asks for a thousand. An unbounded loop around an agent is an
    // unbounded bill, so the engine's own ceiling wins.
    const { handler, calls } = handlerFor();
    const many = Array.from({ length: 400 }, (_, i) => i);
    await runFlow(looping(1000), { handler, input: { docs: many }, now: at, maxSteps: 5000 });
    assert.equal(calls.filter((c) => c === 'read').length, MAX_LOOP_ITERATIONS);
  });

  it('says so when it stopped short of the collection', async () => {
    const { handler } = handlerFor();
    const run = await runFlow(looping(2), { handler, input: { docs: [1, 2, 3, 4] }, now: at });
    assert.match(String(run.steps.find((s) => s.nodeId === 'each')?.detail), /Stopped at 2 of 4/);
  });

  it('loops over nothing when the path is not a collection', async () => {
    const { handler, calls } = handlerFor();
    await runFlow(looping(), { handler, input: { docs: 'not an array' }, now: at });
    assert.deepEqual(calls, ['after']);
  });
});

describe('when something goes wrong', () => {
  it('stops the path rather than passing an absence off as an answer', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'reach', kind: 'http', config: { kind: 'http', method: 'GET', url: 'https://example.test' } }),
        node({ id: 'after', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'reach'], ['reach', 'after']],
    );
    const { handler, calls } = handlerFor({ reach: { __throw: 'the portal did not answer' } });
    const run = await runFlow(flow, { handler, now: at });

    assert.deepEqual(calls, ['reach'], 'nothing downstream of a failure may run');
    assert.equal(run.status, 'failed');
    const step = run.steps.find((s) => s.nodeId === 'reach');
    assert.equal(step?.status, 'failed');
    assert.match(String(step?.detail), /did not answer/);
  });

  it('lets a sibling path carry on', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'bad', kind: 'http', config: { kind: 'http', method: 'GET', url: 'https://example.test' } }),
        node({ id: 'good', kind: 'query', config: { kind: 'query', register: 'evidence' } }),
      ],
      [['start', 'bad'], ['start', 'good']],
    );
    const { handler, calls } = handlerFor({ bad: { __throw: 'nope' } });
    await runFlow(flow, { handler, now: at });
    assert.ok(calls.includes('good'));
  });

  it('ends a runaway rather than running forever', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'each', kind: 'loop', config: { kind: 'loop', over: 'items', itemName: 'i' } }),
        node({ id: 'work', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'each'], ['each', 'work', 'body']],
    );
    const { handler } = handlerFor();
    const run = await runFlow(flow, { handler, input: { items: Array.from({ length: 50 }, (_, i) => i) }, now: at, maxSteps: 10 });
    assert.equal(run.status, 'cut_short');
    assert.ok(run.steps.length <= 12);
    assert.match(String(run.stoppedBecause), /Stopped after 10 steps/);
  });

  it('refuses a flow with nowhere to start', async () => {
    const flow = flowOf([node({ id: 'a', kind: 'agent', config: { kind: 'agent', agent: 'critic' } })], []);
    const { handler, calls } = handlerFor();
    const run = await runFlow(flow, { handler, now: at });
    assert.equal(run.status, 'failed');
    assert.deepEqual(calls, []);
    assert.match(String(run.stoppedBecause), /no trigger/i);
  });
});

describe('what a run leaves behind', () => {
  it('proposes rather than writes', async () => {
    // The rule the whole product runs on: a flow an operator drew is not
    // evidence, so it puts a card in front of a person and stops.
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'say', kind: 'output', config: { kind: 'output', draft: 'finding', title: 'Setback breach on {{plot.name}}', bodyTemplate: '{{detail}}' } }),
      ],
      [['start', 'say']],
    );
    const { handler } = handlerFor();
    const run = await runFlow(flow, { handler, input: { plot: { name: 'North edge' }, detail: '1.2m inside' }, now: at });

    assert.equal(run.proposals.length, 1);
    assert.equal(run.proposals[0]?.title, 'Setback breach on North edge');
    assert.equal(run.proposals[0]?.body, '1.2m inside');
  });

  it('keeps a trace small enough to store', async () => {
    const flow = flowOf([TRIGGER, node({ id: 'a', kind: 'query', config: { kind: 'query', register: 'evidence' } })], [['start', 'a']]);
    const { handler } = handlerFor({ a: { rows: Array.from({ length: 200 }, (_, i) => ({ id: `ev-${i}` })) } });
    const run = await runFlow(flow, { handler, now: at });
    const produced = run.steps.find((s) => s.nodeId === 'a')?.produced as { rows: unknown[] };
    assert.ok(produced.rows.length <= 6, 'a trace must not be bigger than the project it describes');
    assert.match(String(produced.rows[produced.rows.length - 1]), /more of 200/);
  });

  it('says a rehearsal is a rehearsal', async () => {
    const flow = flowOf([TRIGGER, node({ id: 'a', kind: 'agent', config: { kind: 'agent', agent: 'critic' } })], [['start', 'a']]);
    let sawDryRun = false;
    const handler: NodeHandler = async ({ dryRun }) => {
      sawDryRun = dryRun;
      return {};
    };
    await runFlow(flow, { handler, dryRun: true, now: at });
    assert.equal(sawDryRun, true);
  });
});

describe('reshaping the payload on the way through', () => {
  it('sets a path from another path, and from a template', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({
          id: 'shape',
          kind: 'transform',
          config: { kind: 'transform', set: [{ to: 'title', from: 'doc.name' }, { to: 'label', from: '{{doc.name}} ({{doc.pages}}p)' }], drop: ['secret'] },
        }),
      ],
      [['start', 'shape']],
    );
    const { handler } = handlerFor();
    const run = await runFlow(flow, { handler, input: { doc: { name: 'Sale deed', pages: 4 }, secret: 'x' }, now: at });
    assert.equal(run.payload.title, 'Sale deed');
    assert.equal(run.payload.label, 'Sale deed (4p)');
    assert.equal(run.payload.secret, undefined);
  });
});

describe('showing the path before paying for it', () => {
  it('dims what this payload cannot reach', () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'gate', kind: 'filter', config: { kind: 'filter', where: { match: 'all', conditions: [{ path: 'ok', operator: 'is_true' }] } } }),
        node({ id: 'after', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'gate'], ['gate', 'after', 'pass']],
    );
    assert.ok(!pathPreview(flow, { ok: false }).has('after'));
    assert.ok(pathPreview(flow, { ok: true }).has('after'));
  });
});

describe('the little language, which is deliberately little', () => {
  it('reads a length off an array without anybody writing a filter for it', () => {
    assert.equal(readPath({ rows: [1, 2, 3] }, 'rows.length'), 3);
    assert.equal(readPath({ a: { b: 'c' } }, 'a.b'), 'c');
    assert.equal(readPath({}, 'a.b.c'), undefined);
  });

  it('compares as numbers when both sides are numbers', () => {
    // "10" > "9" is false as text and true as a threshold, and a threshold is
    // what somebody typing a number into a condition means.
    const group = { match: 'all' as const, conditions: [{ path: 'n', operator: 'greater_than' as const, value: '9' }] };
    assert.equal(evaluateGroup(group, { n: 10 }), true);
    assert.equal(evaluateGroup(group, { n: '10' }), true);
  });

  it('leaves no braces behind for a path that resolved to nothing', () => {
    // Left in, they reach a model as content and get answered as if they meant
    // something.
    assert.equal(fillTemplate('Re: {{missing.thing}}!', {}), 'Re: !');
  });

  it('lets an empty group through, and the validator complains separately', () => {
    assert.equal(evaluateGroup({ match: 'all', conditions: [] }, {}), true);
  });
});

describe('whether a drawn flow can run at all', () => {
  it('refuses a circle that is not a loop', async () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'a', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
        node({ id: 'b', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'a'], ['a', 'b'], ['b', 'a']],
    );
    const problems = validateFlow(flow);
    assert.ok(problems.some((p) => p.severity === 'error' && /circle/i.test(p.message)));
    assert.equal(flowCanRun(flow), false);
  });

  it('allows the one circle that is a loop’s own body', () => {
    const flow = flowOf(
      [
        TRIGGER,
        node({ id: 'each', kind: 'loop', config: { kind: 'loop', over: 'items', itemName: 'i' } }),
        node({ id: 'work', kind: 'agent', config: { kind: 'agent', agent: 'critic' } }),
      ],
      [['start', 'each'], ['each', 'work', 'body']],
    );
    assert.equal(flowCanRun(flow), true);
  });

  it('warns about a node nothing reaches rather than refusing to save it', () => {
    // Half-drawn is a normal state, and a canvas that will not save one is a
    // canvas people work around by not using it.
    const flow = flowOf([TRIGGER, node({ id: 'lonely', kind: 'agent', config: { kind: 'agent', agent: 'critic' } })], []);
    const problems = validateFlow(flow);
    assert.ok(problems.some((p) => p.nodeId === 'lonely' && p.severity === 'warning'));
    assert.equal(flowCanRun(flow), true);
  });

  it('refuses two triggers, because a flow starts in one place', () => {
    const flow = flowOf([TRIGGER, node({ id: 'other', kind: 'trigger', config: { kind: 'trigger', on: 'manual' } })], []);
    assert.ok(validateFlow(flow).some((p) => p.nodeId === 'other' && p.severity === 'error'));
  });

  it('warns about an http node that is not https', () => {
    const flow = flowOf(
      [TRIGGER, node({ id: 'call', kind: 'http', config: { kind: 'http', method: 'GET', url: 'http://portal.test/x' } })],
      [['start', 'call']],
    );
    assert.ok(validateFlow(flow).some((p) => p.nodeId === 'call' && /clear/i.test(p.message)));
  });

  it('refuses a connection into a node that takes no input', () => {
    const flow = flowOf(
      [TRIGGER, node({ id: 'a', kind: 'agent', config: { kind: 'agent', agent: 'critic' } })],
      [['start', 'a'], ['a', 'start']],
    );
    assert.ok(validateFlow(flow).some((p) => /Nothing can feed a trigger/i.test(p.message)));
  });
});
