// Projecting parcel boundaries into a drawable survey sketch.
//
// The point of this view is recognition: a person who knows their land knows
// its shape and which numbers sit next to it. A tiled basemap would need an API
// key and would bury the boundaries under imagery; the village survey map they
// are used to is line work, so this draws line work.
//
// Pure: takes rings in degrees, returns SVG-space paths. No DOM, no network.

import type { LatLng } from "./geo/measure";
import { latMetersPerDegree, lngMetersPerDegree, ringsCentroid } from "./geometry";
import type { Ring } from "./geometry";
import type { AreaFeature, AreaFeatureKind } from "./types";

export type PlotShape = {
  ref: string;
  parcelNo: string;
  /** SVG path data for the outer ring. */
  d: string;
  /** Where to put the survey number, in SVG space. */
  labelX: number;
  labelY: number;
  /** False when that anchor falls outside the frame, so the label is skipped. */
  labelVisible: boolean;
  subject: boolean;
  prohibited: boolean;
};

/** A layer feature projected into the same frame as the parcels. */
export type OverlayShape = {
  id: string;
  kind: AreaFeatureKind;
  name: string | null;
  /** Path data. Closed for polygons, open for lines, absent for a point. */
  d: string | null;
  closed: boolean;
  /** Set for a station; SVG space. */
  x?: number;
  y?: number;
  /** Where a label could go, when the anchor is inside the frame. */
  labelX: number | null;
  labelY: number | null;
};

export type PlotSketch = {
  width: number;
  height: number;
  shapes: PlotShape[];
  overlays: OverlayShape[];
  /** The subject's own centre, SVG space — drawn as a marker when zoomed out. */
  centre: { x: number; y: number };
  /** Length of the scale bar in SVG units, and what it represents. */
  scale: { pixels: number; metres: number } | null;
};

export type SketchOptions = {
  /**
   * Half-width of the frame in metres. Omitted, the frame fits the subject
   * (the plot view); set, it fixes the frame regardless of the plot's size
   * (the area views), so a big lake and a small plot share one scale.
   */
  frameHalfSpanM?: number;
  overlays?: AreaFeature[];
  /** Skip the neighbour parcels — at 2 km they are noise, not line work. */
  parcelsOnly?: "subject";
};

type Input = {
  ref: string;
  parcelNo: string;
  rings: Ring[];
  prohibited: boolean;
};

const PAD = 8;

/**
 * Longitude is compressed relative to latitude at Indian latitudes, so degrees
 * cannot be plotted square. Scaling longitude by cos(lat) before fitting keeps
 * a square plot square, which is the whole basis on which someone recognises
 * their own boundary.
 */
export function buildSketch(
  subjectRef: string,
  parcels: Input[],
  size: { width: number; height: number },
  centre: LatLng,
  options: SketchOptions = {},
): PlotSketch | null {
  const lngScale = lngMetersPerDegree(centre.lat) / 111_320;
  const project = ([lng, lat]: [number, number]) => ({ x: lng * lngScale, y: lat });
  const projected = parcels
    .filter((p) => !options.parcelsOnly || p.ref === subjectRef)
    .map((p) => ({
      ...p,
      points: (p.rings[0] ?? []).map(project),
    }))
    .filter((p) => p.points.length >= 3);

  if (projected.length === 0) return null;

  const subject = projected.find((p) => p.ref === subjectRef) ?? projected[0];

  // Frame on the subject, not on the whole neighbour set: one long strip of
  // agricultural land in the box would otherwise shrink the plot to a speck.
  const sx = subject.points.map((p) => p.x);
  const sy = subject.points.map((p) => p.y);
  const cx = (Math.min(...sx) + Math.max(...sx)) / 2;
  const cy = (Math.min(...sy) + Math.max(...sy)) / 2;
  const halfSpan = options.frameHalfSpanM
    ? options.frameHalfSpanM / latMetersPerDegree()
    : Math.max(
        Math.max(...sx) - Math.min(...sx),
        Math.max(...sy) - Math.min(...sy),
      ) * 1.6 || 1e-6;

  const minX = cx - halfSpan;
  const maxX = cx + halfSpan;
  const minY = cy - halfSpan;
  const maxY = cy + halfSpan;

  const inner = Math.min(size.width, size.height) - PAD * 2;
  const k = inner / (halfSpan * 2);
  const offsetX = (size.width - (maxX - minX) * k) / 2;
  const offsetY = (size.height - (maxY - minY) * k) / 2;

  const toSvgX = (x: number) => offsetX + (x - minX) * k;
  // SVG y grows downward; latitude grows north, so the axis is flipped.
  const toSvgY = (y: number) => offsetY + (maxY - y) * k;

  const shapes: PlotShape[] = [];
  for (const p of projected) {
    const pts = p.points.map((pt) => ({ x: toSvgX(pt.x), y: toSvgY(pt.y) }));

    // Keep a parcel only if its bounding box actually overlaps the frame. The
    // neighbour set is a bounding box around the subject, so it routinely
    // contains long agricultural strips that begin inside the frame and run
    // hundreds of metres past it; the root SVG clips them, but there is no
    // reason to ship the geometry. Testing whether ANY single coordinate fell
    // in a loose range kept parcels that are nowhere near the frame.
    const bx = { min: Math.min(...pts.map((q) => q.x)), max: Math.max(...pts.map((q) => q.x)) };
    const by = { min: Math.min(...pts.map((q) => q.y)), max: Math.max(...pts.map((q) => q.y)) };
    const overlaps = bx.max >= 0 && bx.min <= size.width && by.max >= 0 && by.min <= size.height;
    if (!overlaps) continue;

    const d = `${pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")} Z`;

    // `ringsCentroid` is planar and unit-agnostic, so it works on SVG points as
    // well as on degrees. Averaging the vertices instead would drag the label
    // off centre on every ArcGIS ring, since each one repeats its first point
    // to close, and off the polygon entirely on an L-shaped parcel.
    const label = ringsCentroid([pts.map((pt) => [pt.x, pt.y] as [number, number])]);
    const labelX = label ? label.lng : pts.reduce((a, pt) => a + pt.x, 0) / pts.length;
    const labelY = label ? label.lat : pts.reduce((a, pt) => a + pt.y, 0) / pts.length;

    shapes.push({
      ref: p.ref,
      parcelNo: p.parcelNo,
      d,
      labelX,
      labelY,
      /** A label whose anchor is off-canvas would be drawn into the clip. */
      labelVisible:
        labelX >= 0 && labelX <= size.width && labelY >= 0 && labelY <= size.height,
      subject: p.ref === subject.ref,
      prohibited: p.prohibited,
    });
  }

  // Subject last so its stroke is never overdrawn by a neighbour's.
  shapes.sort((a, b) => Number(a.subject) - Number(b.subject));

  const inFrame = (x: number, y: number) => x >= 0 && x <= size.width && y >= 0 && y <= size.height;
  const overlays: OverlayShape[] = [];
  for (const f of options.overlays ?? []) {
    if (f.point) {
      const p = project(f.point);
      const x = toSvgX(p.x);
      const y = toSvgY(p.y);
      // A station just outside the frame is still worth a marker at the edge?
      // No — an off-frame marker reads as a wrong position. Skip it.
      if (!inFrame(x, y)) continue;
      overlays.push({ id: f.id, kind: f.kind, name: f.name, d: null, closed: false, x, y, labelX: x, labelY: y });
      continue;
    }
    const parts = f.rings ?? f.paths ?? [];
    const closed = !!f.rings;
    const segments: string[] = [];
    let anyInFrame = false;
    let labelX: number | null = null;
    let labelY: number | null = null;
    for (const part of parts) {
      const pts = part.map((c) => {
        const p = project(c);
        return { x: toSvgX(p.x), y: toSvgY(p.y) };
      });
      if (pts.length < 2) continue;
      const bx = { min: Math.min(...pts.map((q) => q.x)), max: Math.max(...pts.map((q) => q.x)) };
      const by = { min: Math.min(...pts.map((q) => q.y)), max: Math.max(...pts.map((q) => q.y)) };
      const overlaps = bx.max >= 0 && bx.min <= size.width && by.max >= 0 && by.min <= size.height;
      if (!overlaps) continue;
      anyInFrame = true;
      segments.push(
        `${pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")}${closed ? " Z" : ""}`,
      );
      if (labelX === null) {
        const c = closed
          ? ringsCentroid([pts.map((pt) => [pt.x, pt.y] as [number, number])])
          : null;
        const lx = c ? c.lng : pts[Math.floor(pts.length / 2)].x;
        const ly = c ? c.lat : pts[Math.floor(pts.length / 2)].y;
        if (inFrame(lx, ly)) {
          labelX = lx;
          labelY = ly;
        }
      }
    }
    if (!anyInFrame) continue;
    overlays.push({ id: f.id, kind: f.kind, name: f.name, d: segments.join(" "), closed, labelX, labelY });
  }

  // One degree of latitude is ~111,320 m everywhere, and the y axis is plain
  // latitude, so the scale bar is exact in the north-south direction.
  const metresPerPixel = 111_320 / k;
  const target = inner / 4;
  const rawMetres = target * metresPerPixel;
  const nice = niceRound(rawMetres);
  const scale = Number.isFinite(nice) && nice > 0
    ? { pixels: nice / metresPerPixel, metres: nice }
    : null;

  return {
    width: size.width,
    height: size.height,
    shapes,
    overlays,
    centre: { x: toSvgX(cx), y: toSvgY(cy) },
    scale,
  };
}

/** 1, 2, 5, 10, 20, 50… — the steps a scale bar is allowed to take. */
function niceRound(value: number): number {
  if (!(value > 0)) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalised = value / magnitude;
  const step = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
  return step * magnitude;
}
