/**
 * Putting a scanned plan sheet where it belongs on the ground.
 *
 * A BDA or BBMP master plan arrives as a raster sheet — a PDF or a JPEG that
 * somebody downloaded after an OTP. Uploaded, it is a picture. It only becomes
 * usable when a reader can see it UNDER the pin, because the question is never
 * "what does the sheet look like" but "which side of that line is my parcel
 * on". This module is what turns the first into the second.
 *
 * ## The authored part and the derived part
 *
 * A person clicks a point on the sheet and says what it is on the ground —
 * a road junction, a survey corner, a lake edge. That pairing is AUTHORED: it
 * is their judgement, nothing can recompute it, and it is the only thing
 * stored. The transform is DERIVED from those pairs on every read, so a sheet
 * can never carry a stale placement from control points that were since moved
 * or deleted. Same split as the report blocks and the condition rating.
 *
 * Control points are held as FRACTIONS of the sheet (0..1 from the top-left),
 * not pixels. A sheet re-scanned at a different resolution, or downsampled for
 * the web, keeps its georeference; pixel coordinates would silently place it
 * somewhere else. Nothing here needs to know the image's natural size.
 *
 * ## What this deliberately does NOT model
 *
 * **Rotation and skew.** The fit is north-up: latitude from the vertical
 * fraction, longitude from the horizontal one, each by its own least-squares
 * line. That covers the overwhelming majority of published plan sheets and it
 * is what a raster overlay can actually draw — Leaflet's image overlay takes a
 * bounding box, and a rotated sheet has no bounding box that is also correct.
 *
 * The important half is that a rotated sheet is DETECTED rather than quietly
 * drawn wrong. `fitSheet` returns the residual at every control point, and
 * `estimateRotationDeg` compares the bearing between two points on the ground
 * with the angle between them on the sheet. So the answer to a rotated sheet
 * is "this sheet sits about 12° off north, so it cannot be overlaid squarely"
 * — a diagnosis somebody can act on, not a silent 200-metre error in the one
 * layer they trusted.
 *
 * A projection library would let us do better and would also let a bad fit
 * pass unnoticed behind a plausible-looking image. Given a choice between a
 * narrower model that reports its own failure and a broader one that hides it,
 * for a layer somebody will read a boundary off, this takes the narrower one.
 */

/** Metres per degree of latitude. Spherical; the error is far below GPS noise at this scale. */
const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/**
 * One pairing of a spot on the sheet with a spot on the ground.
 *
 * `u` and `v` are fractions of the sheet from its top-left corner: u across,
 * v down. `label` is what the person recognised — "Kanakapura Rd / Ring Rd
 * junction" — and it is the only thing that lets somebody else check the
 * pairing later, so the UI should press for it.
 */
export interface GroundControlPoint {
  id: string;
  u: number;
  v: number;
  lat: number;
  lng: number;
  label?: string;
}

export type SheetKind = 'master_plan' | 'zoning' | 'site_plan' | 'layout_plan' | 'survey_sketch' | 'other';

export const SHEET_KIND_LABEL: Record<SheetKind, string> = {
  master_plan: 'Master plan sheet',
  zoning: 'Zoning / land-use sheet',
  site_plan: 'Site plan',
  layout_plan: 'Layout plan',
  survey_sketch: 'Survey sketch',
  other: 'Other sheet',
};

/**
 * A sheet on the file, and the control points somebody has placed on it.
 *
 * `evidenceId` rather than a copy of the file: the sheet IS a piece of
 * evidence, with a status, a source and a place in the pack. A second store of
 * the same document would be a second thing to keep in step.
 */
export interface SheetRecord {
  id: string;
  title: string;
  kind: SheetKind;
  evidenceId: string;
  attachmentId?: string;
  /** What the sheet is in force as at, when it says. Master plans are dated and superseded. */
  asOf?: string;
  /** Who published it. "BDA", "BBMP", "the vendor's architect" — provenance decides weight. */
  issuer?: string;
  controlPoints: GroundControlPoint[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SheetBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ControlResidual {
  pointId: string;
  label?: string;
  /** How far the fit puts this point from where the person said it is. */
  metres: number;
}

export interface SheetFit {
  bounds: SheetBounds;
  residuals: ControlResidual[];
  /** The worst control point, in metres. The number that decides whether this is usable. */
  worstM: number;
  rmsM: number;
  /** The diagonal of the fitted area, so a residual can be read against the sheet's own scale. */
  spanM: number;
  /** Worst residual as a fraction of the span. Scale-free, which is the comparable form. */
  worstFraction: number;
  /**
   * Best guess at how far the sheet is rotated off north, from the control
   * points. Absent with fewer than two usable pairs. A few degrees is
   * measurement noise; ten is a sheet that is not north-up.
   */
  rotationDeg?: number;
}

/**
 * Why a sheet has no fit. Returned instead of a fit so the caller says the
 * right thing rather than rendering an empty overlay.
 */
export type SheetFitProblem = 'no_points' | 'too_few' | 'degenerate_u' | 'degenerate_v';

export const SHEET_FIT_PROBLEM_TEXT: Record<SheetFitProblem, string> = {
  no_points: 'No control point has been placed on this sheet yet.',
  too_few: 'A sheet needs at least two control points before it can be placed — one point fixes nothing but itself.',
  degenerate_u: 'Every control point sits at the same place across the sheet, so nothing fixes its east–west scale.',
  degenerate_v: 'Every control point sits at the same height on the sheet, so nothing fixes its north–south scale.',
};

/** Least-squares `y = m·x + c`. Returns null when every x is the same. */
function fitLine(pairs: Array<[number, number]>): { m: number; c: number } | null {
  const n = pairs.length;
  if (n < 2) return null;
  const meanX = pairs.reduce((s, p) => s + p[0], 0) / n;
  const meanY = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pairs) {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  }
  if (den < 1e-12) return null;
  const m = num / den;
  return { m, c: meanY - m * meanX };
}

/**
 * Where this sheet sits, worked out from its control points.
 *
 * Two independent regressions — latitude against `v`, longitude against `u` —
 * which is exactly the north-up assumption written down. Every extra control
 * point improves the fit AND tightens the residuals that would expose the
 * assumption being wrong, so more points make the answer both better and more
 * honest, which is the property you want from a control scheme.
 */
export function fitSheet(points: readonly GroundControlPoint[]): SheetFit | { problem: SheetFitProblem } {
  if (points.length === 0) return { problem: 'no_points' };
  if (points.length < 2) return { problem: 'too_few' };

  const lngFit = fitLine(points.map((p) => [p.u, p.lng] as [number, number]));
  if (!lngFit) return { problem: 'degenerate_u' };
  const latFit = fitLine(points.map((p) => [p.v, p.lat] as [number, number]));
  if (!latFit) return { problem: 'degenerate_v' };

  // v runs downward and latitude runs upward, so the sheet's top edge (v=0) is
  // its northern one whenever the fit came out with a negative slope — which
  // it will for any sheet that is not upside down. Taking min/max rather than
  // assuming the sign means an inverted scan still produces correct bounds.
  const latAt = (v: number) => latFit.m * v + latFit.c;
  const lngAt = (u: number) => lngFit.m * u + lngFit.c;
  const lat0 = latAt(0);
  const lat1 = latAt(1);
  const lng0 = lngAt(0);
  const lng1 = lngAt(1);
  const bounds: SheetBounds = {
    north: Math.max(lat0, lat1),
    south: Math.min(lat0, lat1),
    east: Math.max(lng0, lng1),
    west: Math.min(lng0, lng1),
  };

  const midLat = (bounds.north + bounds.south) / 2;
  const residuals: ControlResidual[] = points.map((p) => {
    const dLatM = (latAt(p.v) - p.lat) * M_PER_DEG_LAT;
    const dLngM = (lngAt(p.u) - p.lng) * mPerDegLng(p.lat);
    return { pointId: p.id, label: p.label, metres: Math.hypot(dLatM, dLngM) };
  });

  const worstM = residuals.reduce((w, r) => Math.max(w, r.metres), 0);
  const rmsM = Math.sqrt(residuals.reduce((s, r) => s + r.metres ** 2, 0) / residuals.length);
  const spanM = Math.hypot(
    (bounds.north - bounds.south) * M_PER_DEG_LAT,
    (bounds.east - bounds.west) * mPerDegLng(midLat),
  );

  return {
    bounds,
    residuals,
    worstM,
    rmsM,
    spanM,
    worstFraction: spanM > 0 ? worstM / spanM : 0,
    rotationDeg: estimateRotationDeg(points) ?? undefined,
  };
}

/**
 * Solve `z = a·u + b·v + c` by least squares over three or more points.
 *
 * Normal equations on a 3×3, inverted directly. A general solver would be more
 * code for a system that is always this size, and a near-singular one — which
 * is what collinear control points produce — is detected by the determinant
 * and refused rather than returned as a wild answer.
 */
function fitPlane(points: readonly GroundControlPoint[], z: (p: GroundControlPoint) => number): { a: number; b: number; c: number } | null {
  if (points.length < 3) return null;
  let suu = 0, suv = 0, su = 0, svv = 0, sv = 0, n = 0;
  let suz = 0, svz = 0, sz = 0;
  for (const p of points) {
    const zv = z(p);
    suu += p.u * p.u;
    suv += p.u * p.v;
    su += p.u;
    svv += p.v * p.v;
    sv += p.v;
    n += 1;
    suz += p.u * zv;
    svz += p.v * zv;
    sz += zv;
  }
  const m = [
    [suu, suv, su],
    [suv, svv, sv],
    [su, sv, n],
  ];
  const det =
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  // Collinear points make this vanish. The scale is set by n and the unit
  // square, so a fixed small epsilon is meaningful here rather than arbitrary.
  if (Math.abs(det) < 1e-9) return null;

  const inv = (r: number, c: number): number => {
    const rows = [0, 1, 2].filter((i) => i !== c);
    const cols = [0, 1, 2].filter((j) => j !== r);
    const minor = m[rows[0]!]![cols[0]!]! * m[rows[1]!]![cols[1]!]! - m[rows[0]!]![cols[1]!]! * m[rows[1]!]![cols[0]!]!;
    return ((r + c) % 2 === 0 ? minor : -minor) / det;
  };
  const rhs = [suz, svz, sz];
  const solve = (row: number) => inv(row, 0) * rhs[0]! + inv(row, 1) * rhs[1]! + inv(row, 2) * rhs[2]!;
  return { a: solve(0), b: solve(1), c: solve(2) };
}

function wrapDeg(deg: number): number {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * How far off north the sheet sits, from the full affine map.
 *
 * The obvious version of this — take the two furthest-apart control points and
 * compare their bearing on the ground with their angle on the page — is wrong,
 * and wrong in a way that looks right. Control points are held as FRACTIONS of
 * the sheet, so a sheet twice as wide as it is tall covers twice the metres per
 * unit of `u` as per unit of `v`. That anisotropy tilts every diagonal. A
 * perfectly north-up sheet in Bengaluru reported 0.7° off north purely because
 * a degree of longitude there is 2.4% shorter than a degree of latitude, and a
 * genuinely oblong sheet would report far worse.
 *
 * Fitting the whole affine separates the two properly: `∂east/∂u` and
 * `∂north/∂u` give the direction the page's x-axis points on the ground
 * regardless of how far it travels, and the same for the y-axis. Scale, however
 * uneven, cancels out of a direction.
 *
 * Needs THREE non-collinear points, and returns null below that — with two,
 * rotation and aspect are genuinely indistinguishable, and any number returned
 * would be a coin toss dressed as a measurement.
 */
export function estimateRotationDeg(points: readonly GroundControlPoint[]): number | null {
  if (points.length < 3) return null;
  const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const east = fitPlane(points, (p) => p.lng * mPerDegLng(midLat));
  const north = fitPlane(points, (p) => p.lat * M_PER_DEG_LAT);
  if (!east || !north) return null;

  // Where the page's own axes end up pointing on the ground. Bearings, so the
  // sheet's scale in either direction is irrelevant.
  const xLen = Math.hypot(east.a, north.a);
  const yLen = Math.hypot(east.b, north.b);
  if (xLen < 1e-6 || yLen < 1e-6) return null;

  // Page-x runs across the sheet, which on a north-up sheet is due east (90°).
  // Page-y runs DOWN it, which is due south (180°).
  const fromX = wrapDeg((Math.atan2(east.a, north.a) * 180) / Math.PI - 90);
  const fromY = wrapDeg((Math.atan2(east.b, north.b) * 180) / Math.PI - 180);

  // Averaged through the unit circle so two estimates either side of ±180°
  // do not cancel to zero. Their disagreement is skew rather than rotation,
  // and the residuals are what report that.
  const x = Math.cos((fromX * Math.PI) / 180) + Math.cos((fromY * Math.PI) / 180);
  const y = Math.sin((fromX * Math.PI) / 180) + Math.sin((fromY * Math.PI) / 180);
  return wrapDeg((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Past this, the sheet is misplaced rather than imprecise.
 *
 * Expressed as a fraction of the sheet's own span so it means the same thing
 * on a 40 km master plan and a 200 m layout, with an absolute floor because
 * 1% of a small sheet is a couple of metres and no hand-clicked control point
 * is that good. Both are judgements, written down so somebody can argue with
 * them rather than discovering them in the behaviour.
 */
export const SHEET_FIT_TOLERANCE_FRACTION = 0.01;
export const SHEET_FIT_FLOOR_M = 15;
/** Past this the north-up assumption has failed, whatever the residuals say. */
export const SHEET_ROTATION_TOLERANCE_DEG = 3;

/**
 * `unchecked` is the one that is easy to leave out and dangerous to.
 *
 * A north-up fit has two free parameters per axis, so TWO control points fit
 * exactly — always, whatever they are, however badly mis-clicked. The residual
 * is zero because the arithmetic cannot be anything else, and a UI that
 * reported "worst 0 m" for that would be presenting a tautology as a
 * verification. Rotation cannot be measured from two points either. So two
 * points draw, and say plainly that nothing has checked them.
 */
export type SheetFitVerdict = 'good' | 'unchecked' | 'loose' | 'rotated' | 'unusable';

export interface SheetFitReading {
  fit?: SheetFit;
  problem?: SheetFitProblem;
  verdict: SheetFitVerdict;
  /** One sentence a person can act on. Never "error" — always what to do next. */
  say: string;
}

/**
 * What to tell somebody about this sheet's placement.
 *
 * The verdict leads on rotation when rotation is the cause, because "add more
 * control points" is useless advice for a sheet that is 12° off north — more
 * points on a rotated sheet produce a better-fitting wrong answer.
 */
export function readSheetFit(points: readonly GroundControlPoint[]): SheetFitReading {
  const result = fitSheet(points);
  if ('problem' in result) {
    return { problem: result.problem, verdict: 'unusable', say: SHEET_FIT_PROBLEM_TEXT[result.problem] };
  }

  const tolerance = Math.max(SHEET_FIT_FLOOR_M, result.spanM * SHEET_FIT_TOLERANCE_FRACTION);
  const rotation = result.rotationDeg;

  // Rotation leads, because it names the CAUSE. "Add more control points" is
  // useless advice for a sheet 12° off north — more points on a rotated sheet
  // produce a better-fitting wrong answer.
  if (rotation !== undefined && Math.abs(rotation) > SHEET_ROTATION_TOLERANCE_DEG) {
    return {
      fit: result,
      verdict: 'rotated',
      say: `This sheet sits about ${Math.abs(rotation).toFixed(0)}° off north, so it cannot be laid square on the map. Rotate the scan to north-up and place the control points again — more points will not fix this.`,
    };
  }

  if (result.worstM > tolerance) {
    return {
      fit: result,
      verdict: 'loose',
      say: `The worst control point is ${Math.round(result.worstM)} m from where the fit puts it, against a ${Math.round(tolerance)} m tolerance for a sheet this size. Check that point, or add more.`,
    };
  }

  // Two points give a zero residual by construction and no rotation estimate
  // at all, so "good" would be a claim nothing supports.
  if (rotation === undefined) {
    return {
      fit: result,
      verdict: 'unchecked',
      say: `Placed from ${points.length} control point(s), which always fit exactly — nothing here has checked the placement. Add a third, well away from the line between these two, and the fit starts being able to disagree with you.`,
    };
  }

  return {
    fit: result,
    verdict: 'good',
    say: `Placed from ${points.length} control points; worst ${Math.round(result.worstM)} m, RMS ${Math.round(result.rmsM)} m, ${Math.abs(rotation).toFixed(1)}° off north.`,
  };
}

/**
 * True when a fit is good enough to draw.
 *
 * `loose` and `unchecked` both draw — with their caveat. A placement somebody
 * can see and argue with beats one withheld until it is perfect, and both of
 * those readings say exactly what is wrong with them. `rotated` does not draw:
 * it would be wrong by a distance nobody can eyeball, on the one layer a
 * reader takes a boundary off.
 */
export function sheetIsPlaceable(reading: SheetFitReading): boolean {
  return reading.verdict === 'good' || reading.verdict === 'loose' || reading.verdict === 'unchecked';
}
