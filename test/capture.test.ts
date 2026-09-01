/**
 * What a photograph claims, and who is claiming it.
 *
 * A site photograph is the only evidence this product collects that is MADE
 * rather than obtained, and everything that makes it evidence — when, where,
 * why, who — lives in metadata that is easy to lose, easy to get wrong, and
 * impossible to reconstruct afterwards. So these tests are almost entirely
 * about provenance rather than storage:
 *
 * - a coordinate read off the file and one typed by a person are different
 *   claims and must never become indistinguishable;
 * - the purpose decides what a shot can be relied on for, so a shot without
 *   one is incomplete in a way the file should say out loud;
 * - and a visit that recorded nothing it could not see is making a claim, not
 *   leaving a blank.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPTURE_OFF_SITE_M,
  addSiteVisit,
  attachEvidenceFile,
  addEvidence,
  captureConcerns,
  captureDistanceM,
  createProject,
  describeCapture,
  isGeotagged,
  patchSiteVisit,
  setAttachmentCapture,
  visitCoverage,
  visitPhotos,
  type DdProject,
} from '@realytica/shared';

function file(): DdProject {
  return createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-C1');
}

/** The site pin, as the geocoder would have stored it. */
function withPin(project: DdProject, lat = 12.6, lng = 77.42): DdProject {
  project.siteContext = {
    location: { point: { lat, lng }, precision: 'rooftop', queried: 'x', resolvedAddress: 'x', provider: 'test', resolvedAt: '2026-01-01T00:00:00.000Z', caveat: '' },
  } as DdProject['siteContext'];
  return project;
}

function photo(project: DdProject, capture: Parameters<typeof attachEvidenceFile>[2]['capture'], name = 'IMG_0001.jpg') {
  const evidence = addEvidence(project, { title: 'Site photographs', kind: 'photograph' });
  const attachment = attachEvidenceFile(project, evidence.id, { fileName: name, mimeType: 'image/jpeg', sizeBytes: 1024, storageKey: 'k', capture });
  return { evidence, attachment };
}

describe('a capture fact carries who is claiming it', () => {
  it('keeps a camera position and a typed one apart', () => {
    // The whole point. "Geotagged" and "somebody says this is the north
    // boundary" are different strengths of claim, and a report that renders
    // them identically has overstated its own evidence.
    const project = file();
    const { evidence, attachment } = photo(project, { lat: 12.6, lng: 77.42, latLngSource: 'exif' });
    assert.equal(isGeotagged(attachment.capture), true);

    setAttachmentCapture(project, evidence.id, attachment.id, { lat: 12.61, lng: 77.43 });
    assert.equal(isGeotagged(attachment.capture), false, 'a person nudged it, so it is theirs now');
    assert.equal(attachment.capture!.latLngSource, 'stated');
  });

  it('will not let a caller dress a typed value as the camera’s', () => {
    // `CaptureFactsInput` omits the source fields, so there is no way to ask.
    // Asserted at runtime too, because the type is not there at the API door.
    const project = file();
    const { evidence, attachment } = photo(project, {});
    setAttachmentCapture(project, evidence.id, attachment.id, { lat: 1, lng: 1, latLngSource: 'exif' } as never);
    assert.equal(attachment.capture!.latLngSource, 'stated');
  });

  it('says both facts and their sources in one line', () => {
    const said = describeCapture({ purpose: 'valuation_inspection', takenAt: '2026-08-12T09:31:00', takenAtSource: 'exif', lat: 12.6, lng: 77.42, latLngSource: 'stated' });
    assert.match(said, /Valuation inspection/);
    assert.match(said, /taken 2026-08-12 \(read from the file\)/);
    assert.match(said, /\(entered by a person\)/);
  });

  it('clears a position rather than pretending null is a coordinate', () => {
    const project = file();
    const { evidence, attachment } = photo(project, { lat: 12.6, lng: 77.42, latLngSource: 'exif' });
    setAttachmentCapture(project, evidence.id, attachment.id, { lat: null, lng: null });
    assert.equal(attachment.capture!.lat, undefined);
    assert.equal(attachment.capture!.latLngSource, undefined);
  });

  it('leaves untouched facts alone when the request does not mention them', () => {
    // An omitted key is not an instruction to clear. Getting this wrong would
    // mean setting a caption wiped the geotag.
    const project = file();
    const { evidence, attachment } = photo(project, { lat: 12.6, lng: 77.42, latLngSource: 'exif', takenAt: '2026-08-12T09:31:00', takenAtSource: 'exif' });
    setAttachmentCapture(project, evidence.id, attachment.id, { caption: 'North boundary from the access road' });
    assert.equal(attachment.capture!.lat, 12.6);
    assert.equal(attachment.capture!.takenAtSource, 'exif');
  });

  it('refuses a visit or an asset that is not on this file', () => {
    const project = file();
    const { evidence, attachment } = photo(project, {});
    assert.throws(() => setAttachmentCapture(project, evidence.id, attachment.id, { visitId: 'vis_nope' }), /Site visit not found/);
    assert.throws(() => setAttachmentCapture(project, evidence.id, attachment.id, { assetId: 'ast_nope' }), /Asset not found/);
  });

  it('refuses an impossible coordinate at the door', () => {
    const project = file();
    const { evidence, attachment } = photo(project, {});
    assert.throws(() => setAttachmentCapture(project, evidence.id, attachment.id, { lat: 91, lng: 0 }), /between -90 and 90/);
  });
});

describe('a photograph is measured against the site it was filed on', () => {
  it('works out how far the camera thought it was', () => {
    // ~1.1 km north. Haversine on a sphere; the ellipsoid correction at this
    // distance is far below the GPS error already in the input.
    const metres = captureDistanceM({ lat: 12.61, lng: 77.42 }, { lat: 12.6, lng: 77.42 });
    assert.ok(metres !== null && metres > 1050 && metres < 1150, String(metres));
  });

  it('says nothing when either position is missing', () => {
    assert.equal(captureDistanceM({ purpose: 'record' }, { lat: 12.6, lng: 77.42 }), null);
    assert.equal(captureDistanceM({ lat: 12.6, lng: 77.42 }, undefined), null);
  });

  it('flags a shot the camera put kilometres away', () => {
    const project = withPin(file());
    photo(project, { purpose: 'diligence_inspection', lat: 12.9, lng: 77.6, latLngSource: 'exif' });
    const off = captureConcerns(project).filter((c) => c.code === 'off_site');
    assert.equal(off.length, 1);
    assert.match(off[0]!.say, /km from the site/);
  });

  it('does not flag ordinary GPS drift', () => {
    // The threshold says "this is not the same place", not "your GPS drifted".
    // Consumer GPS is routinely tens of metres out and worse between towers.
    const project = withPin(file());
    photo(project, { purpose: 'diligence_inspection', lat: 12.6009, lng: 77.4204, latLngSource: 'exif' });
    assert.deepEqual(captureConcerns(project).filter((c) => c.code === 'off_site'), []);
    assert.ok(CAPTURE_OFF_SITE_M >= 1000, 'a tight threshold would cry wolf on every accurate photo');
  });

  it('says a baseline with no date proves nothing about what changed', () => {
    const project = file();
    photo(project, { purpose: 'pre_construction' });
    const said = captureConcerns(project).find((c) => c.code === 'no_taken_at');
    assert.match(said!.say, /proves nothing about what changed/);
  });

  it('asks a valuation shot for its date, because the valuation is stated as at one', () => {
    const project = file();
    photo(project, { purpose: 'valuation_inspection' });
    assert.ok(captureConcerns(project).some((c) => c.code === 'no_taken_at'));
  });

  it('leaves a dated valuation shot alone', () => {
    const project = file();
    photo(project, { purpose: 'valuation_inspection', takenAt: '2026-08-12T09:31:00', takenAtSource: 'exif' });
    assert.deepEqual(captureConcerns(project).filter((c) => c.code === 'no_taken_at'), []);
  });

  it('never comments on a document, only on an image', () => {
    // A scanned conveyance has no capture facts, and complaining that it has
    // no purpose would fill the file with noise about deeds.
    const project = withPin(file());
    const evidence = addEvidence(project, { title: 'Sale deed 1994', kind: 'document' });
    attachEvidenceFile(project, evidence.id, { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k' });
    assert.deepEqual(captureConcerns(project), []);
  });
});

describe('a visit is the thing photographs are taken on', () => {
  it('groups the shots taken on it', () => {
    const project = file();
    const visit = addSiteVisit(project, { title: 'Condition walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer' });
    photo(project, { visitId: visit.id, lat: 12.6, lng: 77.42, latLngSource: 'exif' }, 'a.jpg');
    photo(project, { visitId: visit.id }, 'b.jpg');
    photo(project, {}, 'c.jpg');

    assert.equal(visitPhotos(project, visit.id).length, 2);
    const [row] = visitCoverage(project);
    assert.equal(row!.photos, 2);
    assert.equal(row!.geotagged, 1, 'and how many of those the camera vouched for');
  });

  it('exists even when nobody photographed anything', () => {
    // "We went, the gate was locked, we saw nothing" is one of the more
    // consequential things a diligence file can record, and it has no
    // attachment to hang off.
    const project = file();
    const visit = addSiteVisit(project, {
      title: 'Attempted inspection',
      purpose: 'diligence_inspection',
      visitedOn: '2026-08-12',
      surveyor: 'R. Iyer',
      status: 'aborted',
      limitations: [{ kind: 'no_access', what: 'Gate locked; no key holder on site' }],
    });
    const [row] = visitCoverage(project);
    assert.equal(row!.photos, 0);
    assert.equal(row!.limitations, 1);
    assert.equal(visit.status, 'aborted');
  });

  it('tells a visit that claims full access from one nobody wrote up', () => {
    // An empty limitations list is a CLAIM — it says the surveyor got
    // everywhere. A visit where nobody filled the section in is a different
    // thing, and a report that renders both as "no limitations" has invented
    // a completeness nobody asserted.
    const project = file();
    const bare = addSiteVisit(project, { title: 'Walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer' });
    assert.equal(visitCoverage(project)[0]!.limitationsStated, false);

    patchSiteVisit(project, bare.id, { notes: 'Full access to all floors and the roof.' });
    assert.equal(visitCoverage(project)[0]!.limitationsStated, true);
  });
});
