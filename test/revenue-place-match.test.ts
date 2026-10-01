/**
 * Starting the revenue-map picker from the address.
 *
 * The picker asked for district, taluk and village by hand, every time, on
 * files whose address already said them. These pin the matcher on real
 * entries in the Karnataka village index: it finds the village an address
 * names, uses the hobli or taluk to choose between villages that share a
 * name, refuses to guess when they do not, and never reads a hobli's name as
 * the village.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProject, type RevenueMapRead } from '@realytica/shared';
import { kaVillageFromAddress } from '../packages/site-intel/src/karnataka/place-match';
import { suggestRevenuePlace } from '../apps/api/src/gis/revenue-map';

describe('the village an address names', () => {
  it('is found with its hobli and taluk, spelt as people spell them', () => {
    const hit = kaVillageFromAddress('Plot at Balagere Village, Varthur Hobli, Bengaluru East Taluk, Bengaluru Urban District');
    assert.equal(hit.kind, 'match');
    if (hit.kind !== 'match') return;
    assert.equal(hit.village.code, '2004050006');
    assert.equal(hit.village.taluk, 'Bangalore-East');
    assert.equal(hit.label, 'Balagere (Varturu-2)');
    assert.ok(hit.agrees.includes('hobli') && hit.agrees.includes('taluk'));
  });

  it('is found on its own when only one village has the name', () => {
    const hit = kaVillageFromAddress('Survey No. 118/2, Whitefield, Bengaluru 560066');
    assert.equal(hit.kind, 'match');
    if (hit.kind === 'match') assert.equal(hit.village.village, 'White Field');
  });

  it('is not guessed between villages that share a name, with nothing to choose by', () => {
    const hit = kaVillageFromAddress('Kodigehalli Village, Bengaluru');
    assert.equal(hit.kind, 'ambiguous');
  });

  it('is not the hobli the address names', () => {
    // "Harohalli Hobli" names the hobli; the village is not given.
    const hit = kaVillageFromAddress('Sy. Nos. 41/1, 41/2 & 42, Harohalli Hobli, Kanakapura Taluk');
    assert.notEqual(hit.kind, 'match');
  });
});

describe('where the picker starts', () => {
  const project = () =>
    createProject({ name: 'Balagere plot', type: 'residential', location: 'Balagere Village, Varthur Hobli', city: 'Bengaluru', parcelId: 'Sy. No. 41/2' }, 'RYT-C1');

  it('is the village the address names, with the parcel’s survey number, and says it is a guess', () => {
    const s = suggestRevenuePlace(project());
    assert.equal(s.from, 'address');
    assert.equal(s.state, 'KA');
    assert.equal(s.mandal, 'Bangalore-East');
    assert.equal(s.village, 'Balagere (Varturu-2)');
    assert.equal(s.surveyNo, '41/2');
    assert.match(s.note ?? '', /Check it before reading/);
  });

  it('is the last read when there is one, whatever the address says', () => {
    const p = project();
    p.location = 'Somewhere else entirely';
    p.revenueMap = { state: 'KA', parcelRef: 'kgis:2004030029:118/2', surveyNo: '118/2', village: 'White Field', mandal: 'Bangalore-East', district: 'Bengaluru (Urban)' } as RevenueMapRead;
    const s = suggestRevenuePlace(p);
    assert.equal(s.from, 'last read');
    assert.equal(s.village, 'White Field (K R Pura-3)');
    assert.equal(s.surveyNo, '118/2');
  });
});
