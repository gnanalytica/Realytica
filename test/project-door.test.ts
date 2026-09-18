/**
 * What the door lets through, against what the model can hold.
 *
 * `CreateProjectInput` has carried `parcelId` and `tenure` since the model was
 * written, `createProject` writes both onto the file, and neither was on the
 * request schema — so zod stripped them, quietly, and the API answered 201
 * with a project that had silently lost its survey number. Every project in
 * the system was created that way. Nothing in the client could have detected
 * it, because a dropped optional field and an absent one look identical.
 *
 * The survey number is not a nicety: `planDiscovery` refuses to search without
 * one and the revenue-map read has no parcel to fetch. A door that drops it
 * disables two features silently.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectBodySchema, patchProjectBodySchema } from '../apps/api/src/project-schemas';

const base = { name: 'Balagere plot', type: 'residential', location: 'Balagere', city: 'Bengaluru' };

describe('the create-project door', () => {
  it('lets a survey number through', () => {
    const out = createProjectBodySchema.parse({ ...base, parcelId: 'Sy. No. 41/2' });
    assert.equal(out.parcelId, 'Sy. No. 41/2');
  });

  it('lets tenure through, and refuses a tenure that is not one', () => {
    assert.equal(createProjectBodySchema.parse({ ...base, tenure: 'leasehold' }).tenure, 'leasehold');
    assert.equal(createProjectBodySchema.safeParse({ ...base, tenure: 'rented' }).success, false);
  });

  it('takes the survey number as the deed writes it', () => {
    // Karnataka writes these many ways; a regex at the door would refuse ones
    // a reader copied correctly.
    for (const written of ['41/2', '41/2P1', 'Sy. No. 41/2 and 43', '124/1A2']) {
      assert.equal(createProjectBodySchema.parse({ ...base, parcelId: written }).parcelId, written);
    }
  });

  it('accepts every measurement the valuation reads off the project', () => {
    // `valuation-run.ts` takes Plot area from `landAreaSqm` and Area valued
    // from `saleableAreaSqm ?? builtUpAreaSqm`. A door that dropped any of
    // these would put a file back into the state this release was about.
    const out = createProjectBodySchema.parse({ ...base, landAreaSqm: 1200, saleableAreaSqm: 950, builtUpAreaSqm: 1100 });
    assert.deepEqual(
      { land: out.landAreaSqm, saleable: out.saleableAreaSqm, built: out.builtUpAreaSqm },
      { land: 1200, saleable: 950, built: 1100 },
    );
  });
});

describe('the patch-project door', () => {
  it('lets the same two through, so a file can be corrected after the fact', () => {
    const out = patchProjectBodySchema.parse({ parcelId: 'Sy. No. 41/2', tenure: 'freehold' });
    assert.equal(out.parcelId, 'Sy. No. 41/2');
    assert.equal(out.tenure, 'freehold');
  });
});
