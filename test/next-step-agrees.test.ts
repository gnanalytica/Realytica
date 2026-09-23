/**
 * The copilot's next step, against what the rest of the screen is showing.
 *
 * The chat pane and the work pane sit side by side and are computed
 * independently, so it is possible for them to contradict each other, and
 * they did. `projectNextStep` decided on `assets.length === 0` alone and
 * announced "Nothing on the file to diligence yet" — a claim about the whole
 * file, made on the strength of one empty list.
 *
 * That was survivable while a new project really did arrive empty. Once the
 * create form began collecting the plot area, the area being valued and the
 * survey number, and the file opened on its own indicative figure, the
 * sentence was rendered beside ₹10.97 Cr and a filled-in property. A reader
 * cannot be expected to work out which half of the screen to believe.
 *
 * So these tests are about agreement, not about wording: whatever the branch
 * says, the condition that reaches it has to be true.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, fileIsBare, projectNextStep } from '../packages/shared/src/operating-model';
import type { DdProject } from '../packages/shared/src/operating-model';

const bare = (): DdProject =>
  createProject({ name: 'Balagere plot', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-NS1');

describe('the next step on a file with nothing on it', () => {
  it('offers the first asset, and the reason it gives is true', () => {
    const project = bare();
    assert.equal(fileIsBare(project), true);
    const next = projectNextStep(project);
    assert.equal(next.kind, 'add_asset');
    assert.equal(next.why, 'Nothing on the file to diligence yet.');
  });
});

describe('the next step on a file that carries its measurements', () => {
  it('stops claiming the file is empty once a plot area is on it', () => {
    const project = { ...bare(), landAreaSqm: 1200 };
    assert.equal(fileIsBare(project), false);
    const next = projectNextStep(project);
    assert.notEqual(next.kind, 'add_asset');
    assert.doesNotMatch(next.why, /Nothing on the file/);
  });

  it('does the same for the area being valued and for a survey number', () => {
    for (const patch of [{ saleableAreaSqm: 950 }, { builtUpAreaSqm: 1100 }, { parcelId: 'Sy. No. 41/2' }]) {
      const project = { ...bare(), ...patch };
      assert.equal(fileIsBare(project), false, `${Object.keys(patch)[0]} should count as something on the file`);
      assert.doesNotMatch(projectNextStep(project).why, /Nothing on the file/);
    }
  });

  it('moves on to starting the diligence, which does not need an asset', () => {
    // `start_dd` targets the project when nothing else exists, so a file with
    // no asset is not blocked — which is why the asset step was never the
    // prerequisite the ordering implied.
    const next = projectNextStep({ ...bare(), landAreaSqm: 1200, saleableAreaSqm: 950 });
    assert.equal(next.kind, 'start_dd');
    assert.equal(next.proposals[0]?.payload.targetType, 'project');
  });

  it('treats a blank survey number as no survey number', () => {
    assert.equal(fileIsBare({ ...bare(), parcelId: '   ' }), true);
  });
});
