/**
 * When a write moves the property, the pin follows.
 *
 * Until this existed a pin was built only when somebody went to the Location
 * view and asked for one. So approving "record the address as Balagere
 * Village, Varthur Hobli" changed the record and left the map showing the old
 * place, or nothing at all — and the file's whole account of its surroundings
 * silently described somewhere else.
 *
 * The guard is the geocoder's own query string, taken before and after the
 * write, because rebuilding costs four billed calls: a geocode, a places
 * search, a distance matrix and a Street View metadata lookup. Renaming a
 * project must not spend them; moving it must.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProject, patchProject, type DdProject } from '@realytica/shared';
import { projectSiteQuery } from '../apps/api/src/site-context';

const project = (): DdProject =>
  createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');

describe('projectSiteQuery, the guard on rebuilding a pin', () => {
  it('changes when the recorded address changes', () => {
    const p = project();
    const before = projectSiteQuery(p);
    patchProject(p, { siteAddress: 'Balagere Village, Varthur Hobli' }, 'operator');
    assert.notEqual(projectSiteQuery(p), before);
    assert.match(projectSiteQuery(p), /Varthur Hobli/);
  });

  it('does not change when something that is not a place changes', () => {
    const p = project();
    const before = projectSiteQuery(p);
    patchProject(p, { name: 'Dream Acres Phase 2', budget: 42_00_00_000, owner: 'Sobha' }, 'operator');
    assert.equal(projectSiteQuery(p), before, 'a rename must not spend four billed calls');
  });

  it('does not change when the address is set to what it already said', () => {
    const p = project();
    patchProject(p, { siteAddress: 'Balagere Village' }, 'operator');
    const before = projectSiteQuery(p);
    patchProject(p, { siteAddress: 'Balagere Village' }, 'operator');
    assert.equal(projectSiteQuery(p), before);
  });

  it('does not change when the parcel changes, because a survey number is not geocodable', () => {
    const p = project();
    const before = projectSiteQuery(p);
    patchProject(p, { parcelId: '50/2, 53/1' }, 'operator');
    assert.equal(projectSiteQuery(p), before, 'Google cannot find "50/2"; the address is what it is given');
  });
});
