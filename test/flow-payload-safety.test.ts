/**
 * What a drawn flow may write, and what it may reach.
 *
 * A transform node's target is a dotted path an operator types into a text
 * field. Nothing validated it, and `writePath` walked whatever it was given —
 * so `__proto__.x` descended into `Object.prototype` (an object, so the
 * "create it if missing" branch left it alone) and wrote onto every plain
 * object in the process. One workspace's drawn flow could change what every
 * other workspace's code read off `{}`, in an API that is long-running and
 * shared.
 *
 * The second half is quieter and was the same line of code. The engine builds
 * a transform's output as `{ ...into }`, which shares every nested object with
 * the input, so writing a nested path reached back through the copy and
 * changed the input — a transform in a loop body rewrote the payload the next
 * iteration was about to read.
 *
 * These are the two properties, pinned as behaviour rather than as
 * implementation: nothing a path can say may escape the payload it is given,
 * and writing to a copy may not alter the original.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readPath, writePath } from '../packages/shared/src/flow/payload';

describe('a path may not escape its payload', () => {
  it('refuses to write through __proto__', () => {
    const target: Record<string, unknown> = {};
    writePath(target, '__proto__.polluted', 'yes');

    // The victim is not the object that was written to — it is every other
    // object in the process, which is what makes this worth a test.
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'a fresh object must be untouched');
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
    assert.equal(target.polluted, undefined, 'and nothing is smuggled onto the target either');
  });

  it('refuses constructor and prototype for the same reason', () => {
    const target: Record<string, unknown> = {};
    writePath(target, 'constructor.prototype.x', 'yes');
    writePath(target, 'prototype.y', 'yes');
    assert.equal(({} as Record<string, unknown>).x, undefined);
    assert.equal((Object.prototype as Record<string, unknown>).x, undefined);
  });

  it('refuses to read them back, so a template cannot print the language', () => {
    // `{{constructor}}` in a node's body would otherwise hand a model or an
    // HTTP endpoint a function where the operator meant a fact.
    assert.equal(readPath({}, '__proto__'), undefined);
    assert.equal(readPath({}, 'constructor'), undefined);
    assert.equal(readPath({ a: {} }, 'a.__proto__.constructor'), undefined);
  });

  it('still writes and reads an ordinary nested path', () => {
    // The guard must not have cost the feature it protects.
    const target: Record<string, unknown> = {};
    writePath(target, 'site.khata.type', 'a_khata');
    assert.equal(readPath(target, 'site.khata.type'), 'a_khata');
  });
});

describe('writing to a copy does not alter the original', () => {
  it('leaves a shallow-copied input untouched', () => {
    // Exactly what the engine's transform does: `const out = { ...into }`.
    const into = { site: { khata: 'a_khata' }, n: 1 };
    const out: Record<string, unknown> = { ...into };

    writePath(out, 'site.khata', 'b_khata');

    assert.equal((out.site as Record<string, unknown>).khata, 'b_khata', 'the write must land');
    assert.equal(into.site.khata, 'a_khata', 'and must not reach back into the input');
  });

  it('keeps two writes to the same branch on one object', () => {
    // Copy-on-write must copy once per path, not once per write — otherwise
    // the second write lands on a different object and the first disappears.
    const out: Record<string, unknown> = { site: { a: 1 } };
    writePath(out, 'site.b', 2);
    writePath(out, 'site.c', 3);
    assert.deepEqual(out.site, { a: 1, b: 2, c: 3 });
  });

  it('does not let one loop iteration rewrite the next one input', () => {
    // The shape the engine builds per iteration. Before copy-on-write, the
    // first iteration's transform mutated `shared` and the second read it.
    const shared = { subject: { area: 100 } };
    const seen: unknown[] = [];
    for (const item of [1, 2]) {
      const inner: Record<string, unknown> = { ...shared, item };
      writePath(inner, 'subject.area', 999);
      seen.push(shared.subject.area);
    }
    assert.deepEqual(seen, [100, 100], 'the outer payload must survive every iteration unchanged');
  });
});
