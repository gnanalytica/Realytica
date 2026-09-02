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
  addSheet,
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
  addAction,
  addFinding,
  classifyFinding,
  projectGraphOf,
  resolveReportBlock,
  retrieveProjectNeighbourhood,
  setActionCost,
  setSheetControlPoints,
  visitPhotos,
  type DdProject,
  type ReportBlock,
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

  it('leaves a scanned plan alone, image or not', () => {
    /*
     * Caught by looking at the screen rather than by a test: a BDA master plan
     * sheet uploaded as a JPEG was told it had "no purpose recorded, so what
     * this photograph is meant to show is not on the file". It is a drawing.
     * A panel of genuine concerns with one piece of nonsense in it is a panel
     * somebody scrolls past.
     */
    const project = withPin(file());
    const evidence = addEvidence(project, { title: 'RMP 2015 sheet 12', kind: 'gis' });
    const attachment = attachEvidenceFile(project, evidence.id, { fileName: 'rmp12.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'k' });
    assert.deepEqual(captureConcerns(project), [], 'a row filed as a map is not a photograph');

    // And the same file reached the other way: a sheet points at it, whatever
    // kind the row happens to carry.
    const asPhoto = addEvidence(project, { title: 'Layout scan', kind: 'photograph' });
    const scan = attachEvidenceFile(project, asPhoto.id, { fileName: 'layout.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'k2' });
    assert.equal(captureConcerns(project).length, 1, 'unclaimed, it is still a photograph with no purpose');
    addSheet(project, { title: 'Layout', kind: 'layout_plan', evidenceId: asPhoto.id, attachmentId: scan.id });
    assert.deepEqual(captureConcerns(project), [], 'claimed by a sheet, it is a plan');
    assert.ok(attachment.id);
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

describe('the inspection record, as a reader meets it', () => {
  /*
   * The block exists for one sentence: what could NOT be seen. A report that
   * lists what was inspected and stays silent about the rest reads as more
   * complete than it is, and the reader has no way to tell "no defect found"
   * from "could not get onto the roof".
   */
  function block(): ReportBlock {
    return { id: 'blk-visits', origin: 'derived', heading: 'Inspection record', source: { kind: 'site_visits' }, createdAt: '', updatedAt: '' } as ReportBlock;
  }

  it('prints who looked, when, and what they could not reach', () => {
    const project = file();
    addSiteVisit(project, {
      title: 'Condition walk',
      purpose: 'diligence_inspection',
      visitedOn: '2026-08-12',
      surveyor: 'R. Iyer',
      accompaniedBy: 'Site engineer',
      weather: 'Dry, overcast',
      limitations: [{ kind: 'height', what: 'Roof parapet — no access equipment on site' }],
    });
    const lines = resolveReportBlock(project, block()).lines;
    assert.match(lines[0]!, /2026-08-12 — Condition walk/);
    assert.match(lines[0]!, /by R\. Iyer with Site engineer/);
    assert.match(lines[1]!, /Not inspected — out of reach.*Roof parapet/);
  });

  it('names a visit nobody wrote up rather than printing it as complete', () => {
    const project = file();
    addSiteVisit(project, { title: 'Walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer' });
    assert.ok(resolveReportBlock(project, block()).lines.some((l) => /Nothing recorded about what could or could not be inspected/.test(l)));
  });

  it('stays silent about limitations when full access was stated', () => {
    const project = file();
    addSiteVisit(project, {
      title: 'Walk',
      purpose: 'diligence_inspection',
      visitedOn: '2026-08-12',
      surveyor: 'R. Iyer',
      notes: 'Full access to all floors and the roof.',
    });
    const lines = resolveReportBlock(project, block()).lines;
    assert.equal(lines.length, 1, 'one line, and no invented caveat');
  });

  it('says an aborted visit could not be carried out', () => {
    const project = file();
    addSiteVisit(project, {
      title: 'Attempted inspection',
      purpose: 'valuation_inspection',
      visitedOn: '2026-07-30',
      surveyor: 'R. Iyer',
      status: 'aborted',
      limitations: [{ kind: 'no_access', what: 'Gate locked, no key holder' }],
    });
    assert.match(resolveReportBlock(project, block()).lines[0]!, /Inspection could not be carried out/);
  });

  it('counts the photographs taken on the visit, not every image on the file', () => {
    const project = file();
    const visit = addSiteVisit(project, { title: 'Walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer', notes: 'Full access.' });
    photo(project, { visitId: visit.id }, 'a.jpg');
    photo(project, {}, 'b.jpg');
    assert.match(resolveReportBlock(project, block()).lines[0]!, /1 photograph\(s\)/);
  });

  it('returns a note rather than a fabricated line when nobody has been', () => {
    assert.match(resolveReportBlock(file(), block()).note!, /No site visit has been recorded/);
  });
});

describe('the graph can reach what a conclusion rests on', () => {
  /*
   * The gap this closes: visits and sheets were registers the graph could not
   * see, so `get_subgraph` and `trace_conclusion` answered "what is this
   * finding resting on" without ever reaching the visit that says the roof was
   * never inspected. A traversal that cannot reach the limitation has answered
   * a different question from the one asked.
   */
  it('carries a visit, and the photographs taken on it', () => {
    const project = file();
    const visit = addSiteVisit(project, {
      title: 'Condition walk',
      purpose: 'diligence_inspection',
      visitedOn: '2026-08-12',
      surveyor: 'R. Iyer',
      limitations: [{ kind: 'height', what: 'Roof — no access equipment' }],
    });
    const { evidence } = photo(project, { visitId: visit.id });

    const graph = projectGraphOf(project);
    const node = graph.nodes.find((n) => n.id === visit.id);
    assert.equal(node?.kind, 'site_visit');
    assert.match(node!.detail!, /R\. Iyer/);
    assert.match(node!.detail!, /1 limitation\(s\)/, 'the limitation count is on the node itself');
    assert.ok(graph.edges.some((e) => e.from === evidence.id && e.to === visit.id && e.rel === 'observed_on'));
  });

  it('says on the node whether a visit recorded any limitation at all', () => {
    const project = file();
    addSiteVisit(project, { title: 'Walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer' });
    const node = projectGraphOf(project).nodes.find((n) => n.kind === 'site_visit');
    assert.match(node!.detail!, /no limitation recorded/);
  });

  it('carries a sheet with how well it is placed', () => {
    // A sheet nobody has placed and one placed from two points look identical
    // without the verdict, and they are worth very different amounts to
    // anything reading a boundary off them.
    const project = file();
    const evidence = addEvidence(project, { title: 'RMP 2015 sheet 12', kind: 'gis' });
    const sheet = addSheet(project, { title: 'RMP 2015 sheet 12', kind: 'master_plan', evidenceId: evidence.id });
    assert.match(projectGraphOf(project).nodes.find((n) => n.id === sheet.id)!.detail!, /unusable/);

    setSheetControlPoints(project, sheet.id, [
      { u: 0, v: 0, lat: 12.7, lng: 77.4 },
      { u: 1, v: 0, lat: 12.7, lng: 77.5 },
      { u: 0, v: 1, lat: 12.6, lng: 77.4 },
    ]);
    assert.match(projectGraphOf(project).nodes.find((n) => n.id === sheet.id)!.detail!, /Master plan sheet · good/);
  });

  it('puts the escalation on the finding node, where a traversal can see it', () => {
    // "Critical" does not say somebody had to be told today, and that is the
    // fact a reader traversing for what is urgent is looking for.
    const project = file();
    const finding = addFinding(project, { title: 'Facade', description: 'Spalling.', severity: 'medium', discipline: 'technical' });
    classifyFinding(project, finding.id, { escalation: { immediateAction: true }, environmentalCondition: 'rec' });
    const node = projectGraphOf(project).nodes.find((n) => n.id === finding.id);
    assert.match(node!.detail!, /RICS 2/);
    assert.match(node!.detail!, /immediate action/);
    assert.match(node!.detail!, /REC/);
  });

  it('keeps an escalated finding when the subgraph is pruned, whatever its severity', () => {
    // A medium-severity defect somebody had to escalate is exactly the row a
    // pruned neighbourhood must not drop.
    const project = file();
    const finding = addFinding(project, { title: 'Lift brake', description: 'Failed.', severity: 'medium', discipline: 'technical' });
    classifyFinding(project, finding.id, { escalation: { immediateAction: true } });
    const hit = retrieveProjectNeighbourhood(project, 'Lift brake', 2);
    assert.ok(hit.graph.nodes.some((n) => n.id === finding.id));
  });

  it('bands the action on its node', () => {
    const project = file();
    const action = addAction(project, { title: 'Repoint', kind: 'remediation', owner: 'QS', priority: 'high' });
    setActionCost(project, action.id, { costBand: 'immediate', costEstimate: 400000 });
    assert.match(projectGraphOf(project).nodes.find((n) => n.id === action.id)!.detail!, /Immediate/);
  });
});
