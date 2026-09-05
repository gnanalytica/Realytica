/**
 * Reading WHERE a property is out of the documents that say so.
 *
 * The pin, the map, Street View, the nearby list, the locality rate and every
 * connector route key off two fields — `siteAddress` and `parcelId`. Both have
 * existed since the screen was written. Nothing filled them. So a file could
 * carry an encumbrance certificate whose subject line names twelve survey
 * numbers and still report "no geocoded pin on this project, so there is
 * nothing to overlay".
 *
 * The subject line below is the real one, from a merged EC for Sobha Dream
 * Acres at Balagere. Everything this reads becomes a card somebody approves: a
 * survey number on a scan is that scan's claim about the parcel, and the
 * difference between a claim and a record is the whole product.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createProject,
  extractCoordinate,
  extractPlaceLine,
  extractSurveyNumbers,
  placeProposalsFromIngest,
  type ChatIngestFile,
  type DdProject,
} from '@realytica/shared';

const project = (extra: Partial<DdProject> = {}): DdProject =>
  Object.assign(
    createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1'),
    extra,
  );

const file = (text: string, fileName = 'ECs_2015_to_2024_merged.pdf'): ChatIngestFile => ({
  fileName,
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  storageKey: 's3://x',
  excerpt: text,
});

/** Verbatim from the certificate the user uploaded. */
const EC_SUBJECT =
  'Encumbrance Certificate — Sy. Nos. 50/2, 50/4, 50/5, 50/6, 51/1, 51/2B1, 51/2B2, 51/3, 51/4, 51/2C1, 51/2C2, 53/1 of Balagere Village, Varthur Hobli.';

describe('extractSurveyNumbers', () => {
  it('reads the whole parcel off a real EC subject line, in order', () => {
    assert.deepEqual(extractSurveyNumbers(EC_SUBJECT), [
      '50/2', '50/4', '50/5', '50/6', '51/1', '51/2B1', '51/2B2', '51/3', '51/4', '51/2C1', '51/2C2', '53/1',
    ]);
  });

  it('needs a survey word, because a Karnataka deed is full of slashes', () => {
    for (const text of [
      'Registration No: PRM/KA/RERA/1251/446/PR/030824/006958',
      'Form 16 under Rule 148 of the Registration Rules, dated 23/03/2021.',
      'Khata 1234/5, assessment 56789, PID 83/12/1.',
      'Certificate IGR-EC-C-0004458-2021-22 for the period 17/02/2021 to 28/07/2021.',
    ]) assert.deepEqual(extractSurveyNumbers(text), [], text);
  });

  it('handles the ways one document writes the same thing', () => {
    assert.deepEqual(extractSurveyNumbers('Survey No. 42/1 and Sy.No 42/2'), ['42/1', '42/2']);
    assert.deepEqual(extractSurveyNumbers('SURVEY NUMBERS 51/2b1, 51/2c2'), ['51/2B1', '51/2C2']);
  });

  it('does not repeat a number two documents both name', () => {
    assert.deepEqual(extractSurveyNumbers('Sy. No. 50/2 ... and again Sy. No. 50/2'), ['50/2']);
  });
});

describe('extractCoordinate', () => {
  it('reads a decimal pair off a site plan', () => {
    assert.deepEqual(extractCoordinate('Site centroid 12.9352, 77.6245 as surveyed.'), { lat: 12.9352, lng: 77.6245 });
  });

  it('refuses a pair that is not in India', () => {
    // Amsterdam. Pinning a Bengaluru file there is worse than finding nothing.
    assert.equal(extractCoordinate('52.3702, 4.8952'), undefined);
  });

  it('is not fooled by a number pair with too little precision to be a fix', () => {
    assert.equal(extractCoordinate('12.9, 77.6'), undefined);
  });
});

describe('placeProposalsFromIngest', () => {
  it('proposes the parcel as a card, never a write', () => {
    const p = project();
    const cards = placeProposalsFromIngest(p, [file(EC_SUBJECT)], 'operator');
    assert.equal(cards[0]!.kind, 'patch_project');
    assert.equal(cards[0]!.status, 'proposed');
    assert.equal(p.parcelId, undefined, 'nothing is written until somebody approves');
    assert.equal(cards[0]!.payload.parcelId, '50/2, 50/4, 50/5, 50/6, 51/1, 51/2B1, 51/2B2, 51/3, 51/4, 51/2C1, 51/2C2, 53/1');
  });

  it('says which document said so, and that it did not verify it', () => {
    const cards = placeProposalsFromIngest(project(), [file(EC_SUBJECT)], 'operator');
    assert.match(cards[0]!.rationale, /ECs_2015_to_2024_merged\.pdf/);
    assert.match(cards[0]!.rationale, /not verifying it/i);
    assert.match(cards[0]!.rationale, /RTC|encumbrance certificate/i, 'it names what would settle it');
  });

  it('never overwrites a parcel already on the record', () => {
    const p = project({ parcelId: '42/1' });
    const cards = placeProposalsFromIngest(p, [file(EC_SUBJECT)], 'operator');
    assert.equal(cards.filter((c) => 'parcelId' in c.payload).length, 0, 'changing a recorded parcel is a different act');
  });

  it('offers one card however many documents name the same parcel', () => {
    const cards = placeProposalsFromIngest(project(), [file(EC_SUBJECT), file(EC_SUBJECT, 'RTC.pdf')], 'operator');
    assert.equal(cards.filter((c) => 'parcelId' in c.payload).length, 1, 'two cards for one field is a choice nobody asked for');
  });

  it('mentions a coordinate as a placement, not a boundary', () => {
    const cards = placeProposalsFromIngest(
      project(),
      [file(`${EC_SUBJECT} Centroid 12.9352, 77.6245.`)],
      'operator',
    );
    assert.match(cards[0]!.rationale, /without bounding it/i);
  });

  it('stays silent on a document that names no parcel', () => {
    assert.deepEqual(placeProposalsFromIngest(project(), [file('BWSSB no objection certificate for water and sewerage.')], 'operator'), []);
  });
});

describe('extractPlaceLine', () => {
  it('reads the revenue division off the same real subject line', () => {
    assert.equal(extractPlaceLine(EC_SUBJECT), 'Balagere Village, Varthur Hobli');
  });

  it('writes the chain narrowest first, however the document orders it', () => {
    assert.equal(
      extractPlaceLine('Bangalore Urban District, Bengaluru East Taluk, Varthur Hobli, Balagere Village'),
      'Balagere Village, Varthur Hobli, Bengaluru East Taluk, Bangalore Urban District',
    );
  });

  it('drops the connective the deed uses to introduce the place', () => {
    assert.equal(
      extractPlaceLine('All that piece and parcel of land situated at Balagere Village'),
      'Balagere Village',
    );
  });

  it('keeps the first of two villages rather than inventing which parcel is meant', () => {
    assert.equal(extractPlaceLine('Balagere Village and Panathur Village'), 'Balagere Village');
  });

  it('finds nothing in a document that names no revenue division', () => {
    assert.equal(extractPlaceLine('Sanction plan LP/BBMP/0123/2019-20 dated 14 March 2019.'), '');
  });

  it('reads an all-capitals scan the same way', () => {
    assert.equal(extractPlaceLine('OF BALAGERE VILLAGE, VARTHUR HOBLI'), 'Balagere Village, Varthur Hobli');
  });
});

describe('placeProposalsFromIngest, on the address', () => {
  it('offers the address beside the parcel, from one document', () => {
    const cards = placeProposalsFromIngest(project(), [file(EC_SUBJECT)]);
    assert.equal(cards.length, 2);
    assert.equal((cards[1].payload as { siteAddress: string }).siteAddress, 'Balagere Village, Varthur Hobli');
    assert.equal(cards[1].kind, 'patch_project');
  });

  it('says the address will find the neighbourhood and not the plot', () => {
    const [, address] = placeProposalsFromIngest(project(), [file(EC_SUBJECT)]);
    assert.match(address.rationale, /revenue division, not a street address/);
    assert.match(address.rationale, /never find the plot/);
  });

  it('never overwrites an address already on the record', () => {
    const cards = placeProposalsFromIngest(project({ siteAddress: '5th Main, Panathur' }), [file(EC_SUBJECT)]);
    assert.equal(cards.filter((c) => 'siteAddress' in (c.payload as object)).length, 0);
  });

  it('still offers the address when the parcel is already recorded', () => {
    const cards = placeProposalsFromIngest(project({ parcelId: '50/2' }), [file(EC_SUBJECT)]);
    assert.equal(cards.length, 1);
    assert.equal((cards[0].payload as { siteAddress: string }).siteAddress, 'Balagere Village, Varthur Hobli');
  });

  it('states the coordinate once, not on both cards', () => {
    const cards = placeProposalsFromIngest(project(), [file(`${EC_SUBJECT} GPS 12.9352, 77.6994.`)]);
    assert.equal(cards.filter((c) => /12\.9352/.test(c.rationale)).length, 1);
  });
});
