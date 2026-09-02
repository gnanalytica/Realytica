/**
 * A sheet placed on the ground, and the honesty of the placement.
 *
 * The interesting property here is not that the fit works — two regressions
 * are not hard. It is that a fit which CANNOT work says so. A raster overlay
 * of a master plan is a layer somebody will read a boundary off; a placement
 * that is quietly 200 m out is worse than no overlay at all, because the
 * absence of an overlay is visible and a wrong one is not.
 *
 * So the tests below are weighted towards the failure paths: too few points,
 * a degenerate line of them, and above all a rotated sheet — the one case the
 * north-up model cannot represent and therefore the one it must refuse rather
 * than approximate.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SHEET_ROTATION_TOLERANCE_DEG,
  addEvidence,
  addSheet,
  createProject,
  estimateRotationDeg,
  fitSheet,
  readSheetFit,
  setSheetControlPoints,
  sheetIsPlaceable,
  sheetPlacements,
  type DdProject,
  type GroundControlPoint,
} from '@realytica/shared';

const gcp = (id: string, u: number, v: number, lat: number, lng: number, label?: string): GroundControlPoint => ({ id, u, v, lat, lng, label });

/**
 * Control points for a sheet whose "up" sits `deg` clockwise off north.
 *
 * Built from the rotation rather than written as coordinates, so the test says
 * what it means and the expected answer is the input. `sx`/`sy` are metres per
 * unit of u and v — deliberately unequal by default, because an oblong sheet is
 * exactly the case that broke the first estimator.
 */
function rotatedSheet(deg: number, sx = 1400, sy = 900): GroundControlPoint[] {
  const lat0 = 12.65;
  const lng0 = 77.45;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const rad = (deg * Math.PI) / 180;
  // Page-x points at bearing deg+90, page-y (down the page) at deg+180.
  const xE = Math.sin(rad + Math.PI / 2) * sx;
  const xN = Math.cos(rad + Math.PI / 2) * sx;
  const yE = Math.sin(rad + Math.PI) * sy;
  const yN = Math.cos(rad + Math.PI) * sy;
  const at = (id: string, u: number, v: number): GroundControlPoint => ({
    id,
    u,
    v,
    lat: lat0 + (u * xN + v * yN) / 111_320,
    lng: lng0 + (u * xE + v * yE) / mPerDegLng,
  });
  return [at('a', 0, 0), at('b', 1, 0), at('c', 0, 1), at('d', 1, 1)];
}

/** A clean north-up sheet: 0.1° of latitude tall, 0.1° of longitude wide. */
const SQUARE: GroundControlPoint[] = [
  gcp('a', 0, 0, 12.7, 77.4, 'NW corner'),
  gcp('b', 1, 0, 12.7, 77.5, 'NE corner'),
  gcp('c', 0, 1, 12.6, 77.4, 'SW corner'),
  gcp('d', 1, 1, 12.6, 77.5, 'SE corner'),
];

function file(): DdProject {
  return createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-G1');
}

describe('a north-up sheet lands where its control points say', () => {
  it('recovers the bounds exactly from four corners', () => {
    const fit = fitSheet(SQUARE);
    assert.ok(!('problem' in fit));
    assert.ok(Math.abs(fit.bounds.north - 12.7) < 1e-9);
    assert.ok(Math.abs(fit.bounds.south - 12.6) < 1e-9);
    assert.ok(Math.abs(fit.bounds.west - 77.4) < 1e-9);
    assert.ok(Math.abs(fit.bounds.east - 77.5) < 1e-9);
    assert.ok(fit.worstM < 0.01, 'a perfect fit has no residual');
  });

  it('places a point in the middle of the sheet, not just its corners', () => {
    // Two points on a diagonal are enough, which is the minimum the model
    // needs: one for each axis's slope.
    const fit = fitSheet([gcp('a', 0.25, 0.25, 12.675, 77.425), gcp('b', 0.75, 0.75, 12.625, 77.475)]);
    assert.ok(!('problem' in fit));
    assert.ok(Math.abs(fit.bounds.north - 12.7) < 1e-9);
    assert.ok(Math.abs(fit.bounds.east - 77.5) < 1e-9);
  });

  it('handles an upside-down scan without inverting the bounds', () => {
    // Taking min/max rather than assuming the slope's sign. North stays north.
    const fit = fitSheet([gcp('a', 0, 0, 12.6, 77.4), gcp('b', 1, 1, 12.7, 77.5)]);
    assert.ok(!('problem' in fit));
    assert.ok(fit.bounds.north > fit.bounds.south);
  });

  it('reports the residual at every control point, not just the worst', () => {
    // A reader has to be able to find WHICH point is wrong. "The fit is 80 m
    // out" with four points is four things to check; naming the point is one.
    const off = [...SQUARE.slice(0, 3), gcp('d', 1, 1, 12.61, 77.5, 'SE corner')];
    const fit = fitSheet(off);
    assert.ok(!('problem' in fit));
    assert.equal(fit.residuals.length, 4);
    assert.ok(fit.residuals.every((r) => r.pointId && r.metres >= 0));
    assert.ok(fit.residuals.some((r) => r.label === 'SE corner'));
    assert.ok(fit.worstM > 100, 'a corner a hundredth of a degree out is hundreds of metres');
  });
});

describe('a sheet that cannot be placed says why', () => {
  it('refuses a single point, which fixes nothing but itself', () => {
    const result = fitSheet([gcp('a', 0.5, 0.5, 12.65, 77.45)]);
    assert.deepEqual(result, { problem: 'too_few' });
    assert.match(readSheetFit([gcp('a', 0.5, 0.5, 12.65, 77.45)]).say, /at least two control points/);
  });

  it('refuses points stacked in a vertical line', () => {
    // Every point at the same `u`: nothing fixes the east–west scale, and a
    // fit would be inventing one.
    const stacked = [gcp('a', 0.5, 0.1, 12.69, 77.45), gcp('b', 0.5, 0.9, 12.61, 77.45)];
    assert.deepEqual(fitSheet(stacked), { problem: 'degenerate_u' });
  });

  it('refuses points stacked in a horizontal line', () => {
    const stacked = [gcp('a', 0.1, 0.5, 12.65, 77.41), gcp('b', 0.9, 0.5, 12.65, 77.49)];
    assert.deepEqual(fitSheet(stacked), { problem: 'degenerate_v' });
  });

  it('says nothing has been placed yet rather than failing', () => {
    const reading = readSheetFit([]);
    assert.equal(reading.verdict, 'unusable');
    assert.equal(sheetIsPlaceable(reading), false);
    assert.match(reading.say, /No control point/);
  });
});

describe('a rotated sheet is diagnosed, never approximated', () => {
  /*
   * The case the north-up model cannot represent. Drawing it anyway would put
   * a plan boundary in the wrong place on the one layer somebody trusts, so
   * the answer has to be a diagnosis a person can act on.
   */
  it('recovers the rotation it was built from', () => {
    for (const deg of [12, -20, 45, 90]) {
      const got = estimateRotationDeg(rotatedSheet(deg));
      assert.ok(got !== null, `${deg}° gave nothing`);
      assert.ok(Math.abs(got - deg) < 0.5, `expected ${deg}°, got ${got}`);
    }
  });

  it('returns near zero for a north-up sheet, however oblong', () => {
    /*
     * The bug this pins. Control points are fractions of the sheet, so a sheet
     * twice as wide as it is tall covers twice the metres per unit of u — and
     * the first estimator, which compared a diagonal's page angle with its
     * ground bearing, read that anisotropy as rotation. A perfectly north-up
     * square in Bengaluru came back 0.7° off purely because a degree of
     * longitude here is 2.4% shorter than a degree of latitude.
     */
    assert.ok(Math.abs(estimateRotationDeg(SQUARE)!) < 0.01);
    assert.ok(Math.abs(estimateRotationDeg(rotatedSheet(0, 4000, 500))!) < 0.01, 'an 8:1 sheet is still north-up');
  });

  it('refuses to guess a rotation from two points', () => {
    // With two points, rotation and aspect are genuinely indistinguishable.
    // Any number returned would be a coin toss dressed as a measurement.
    assert.equal(estimateRotationDeg([gcp('a', 0, 0, 12.7, 77.4), gcp('b', 1, 1, 12.6, 77.5)]), null);
  });

  it('tells the person to rotate the scan, not to add more points', () => {
    // More control points on a rotated sheet produce a better-fitting wrong
    // answer, so advising "add more" would be actively harmful.
    const reading = readSheetFit(rotatedSheet(18));
    assert.equal(reading.verdict, 'rotated');
    assert.match(reading.say, /18° off north/);
    assert.match(reading.say, /more points will not fix this/);
    assert.equal(sheetIsPlaceable(reading), false, 'and it does not draw');
  });

  it('leads on rotation rather than on the residuals it also causes', () => {
    // Both symptoms are present on a rotated sheet; only one names the cause.
    const reading = readSheetFit(rotatedSheet(30));
    assert.equal(reading.verdict, 'rotated');
    assert.ok(reading.fit!.worstM > 100, 'the residuals are terrible too');
  });

  it('keeps the tolerance tight enough to be worth having', () => {
    assert.ok(SHEET_ROTATION_TOLERANCE_DEG <= 5, 'a few degrees is noise; ten is a sheet that is not north-up');
  });
});

describe('a loose fit still draws, with its number attached', () => {
  it('judges the residual against the sheet’s own scale', () => {
    // 1% of a 40 km master plan and 1% of a 200 m layout are wildly different
    // distances, and a fixed metre tolerance would call one of them wrong.
    const wide = [gcp('a', 0, 0, 13.0, 77.0), gcp('b', 1, 0, 13.0, 77.5), gcp('c', 0, 1, 12.5, 77.0), gcp('d', 1, 1, 12.5, 77.502)];
    const reading = readSheetFit(wide);
    assert.ok(reading.fit);
    assert.ok(reading.fit!.worstM > 40, 'tens of metres out on a huge sheet');
    assert.equal(reading.verdict, 'good', 'and still within 1% of a sheet this size');
  });

  it('calls out one mis-clicked point among several good ones', () => {
    // A north-up sheet with a fifth point dropped in the wrong place. Enough
    // redundancy that the error shows up as a residual rather than being
    // absorbed into the fit.
    const small = rotatedSheet(0, 300, 300);
    const strays = [...small, { id: 'e', u: 0.5, v: 0.5, lat: small[0]!.lat - 0.0016, lng: small[0]!.lng + 0.0015, label: 'mis-clicked' }];
    const reading = readSheetFit(strays);
    assert.equal(reading.verdict, 'loose');
    assert.match(reading.say, /against a \d+ m tolerance/);
    assert.equal(sheetIsPlaceable(reading), true, 'loose still draws — with the caveat');
  });

  it('refuses to call a two-point placement verified', () => {
    /*
     * The trap. A north-up fit has two free parameters per axis, so two
     * control points fit EXACTLY — always, whatever they are, however badly
     * mis-clicked. Reporting "worst 0 m" for that would present a tautology as
     * a verification, and it is the reading somebody would trust most.
     */
    const two = [gcp('a', 0.1, 0.2, 12.69, 77.41), gcp('b', 0.9, 0.8, 12.61, 77.49)];
    const reading = readSheetFit(two);
    assert.ok(reading.fit!.worstM < 1e-6, 'the arithmetic cannot be anything else');
    assert.equal(reading.verdict, 'unchecked');
    assert.match(reading.say, /always fit exactly/);
    assert.equal(sheetIsPlaceable(reading), true, 'it still draws, saying what it is');
  });
});

describe('a sheet on a file', () => {
  it('has to name the evidence row its file is filed on', () => {
    // A sheet IS a piece of evidence, with a status and a place in the pack.
    // A second store of the same document would be a second thing to keep in
    // step.
    const project = file();
    assert.throws(
      () => addSheet(project, { title: 'RMP 2015 sheet 12', kind: 'master_plan', evidenceId: 'ev_nope' }),
      /has to name the evidence row/,
    );
  });

  it('recomputes the placement on every read rather than storing one', () => {
    const project = file();
    const evidence = addEvidence(project, { title: 'RMP 2015 sheet 12', kind: 'gis' });
    const sheet = addSheet(project, { title: 'RMP 2015 sheet 12', kind: 'master_plan', evidenceId: evidence.id, issuer: 'BDA' });
    assert.equal(sheetPlacements(project)[0]!.reading.verdict, 'unusable');

    setSheetControlPoints(project, sheet.id, SQUARE.map(({ u, v, lat, lng, label }) => ({ u, v, lat, lng, label })));
    const placed = sheetPlacements(project)[0]!;
    assert.equal(placed.reading.verdict, 'good');
    assert.ok(Math.abs(placed.reading.fit!.bounds.north - 12.7) < 1e-9);

    // Move one point and the placement moves with it — nothing cached it.
    setSheetControlPoints(project, sheet.id, [
      { u: 0, v: 0, lat: 12.8, lng: 77.4 },
      { u: 1, v: 1, lat: 12.6, lng: 77.5 },
    ]);
    assert.ok(Math.abs(sheetPlacements(project)[0]!.reading.fit!.bounds.north - 12.8) < 1e-9);
  });

  it('refuses a control point that is not on the sheet', () => {
    const project = file();
    const evidence = addEvidence(project, { title: 'Sheet', kind: 'gis' });
    const sheet = addSheet(project, { title: 'Sheet', kind: 'master_plan', evidenceId: evidence.id });
    assert.throws(() => setSheetControlPoints(project, sheet.id, [{ u: 1.4, v: 0, lat: 12.6, lng: 77.4 }]), /fractions between 0 and 1/);
  });
});
