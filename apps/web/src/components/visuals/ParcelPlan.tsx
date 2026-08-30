import { useMemo, type CSSProperties } from 'react';
import { cn } from '../ui/kit';
import { positionClass } from './position';
import { between, intBetween, perimeter, pick, polygonPath, rngFor } from './seed';

/*
 * A cadastral plan, drawn from a case id.
 *
 * --- Why this exists ------------------------------------------------------
 *
 * Every case in this product used to be represented by a rounded rectangle
 * with its address in it, which meant a grid of cases was a grid of identical
 * grey boxes and finding the one you worked on yesterday was a reading task.
 * A drawing is recognised, not read: you find your case the way you find your
 * car in a car park.
 *
 * It is also the right *kind* of drawing. A stock photograph of a house would
 * be a picture of a building nobody in the case has ever seen; a survey plan
 * is the artefact this product actually deals in, and it is the one image that
 * could not have come from anywhere else.
 *
 * --- What it is not -------------------------------------------------------
 *
 * It is not survey data and it is not this plot. The geometry is derived from
 * the case identifier, which means it is stable — the same case is always the
 * same drawing — and it means nothing at all about the land. That distinction
 * is the same one the engine draws everywhere else ("a pin is never a
 * boundary"), so the component states it rather than leaving a reader to work
 * out that the plan they are looking at is decorative: `caption` is on by
 * default and says so, and the whole figure carries a description for anyone
 * on a screen reader.
 *
 * Where a real boundary exists, `BoundaryCard` draws that instead. This is for
 * the ninety percent of the product where one does not.
 */

export interface ParcelPlanProps {
  /** Any stable string — a case id, a reference. The same seed always draws the same plan. */
  seed: string;
  className?: string;
  /** `full` carries dimensions, a north arrow and a scale; `mark` is the thumbnail. */
  detail?: 'full' | 'mark';
  /** Lines trace themselves in on mount. Off for anything that re-renders often. */
  animate?: boolean;
  /** The line colour family. Identity colours only — a plan is not a verdict. */
  hue?: 'brand' | 'accent' | 'violet' | 'cyan';
  /** Set false only where the surrounding copy already says the drawing is indicative. */
  caption?: boolean;
}

const HUE_VAR: Record<NonNullable<ParcelPlanProps['hue']>, string> = {
  brand: 'var(--brand-rgb)',
  accent: 'var(--accent-rgb)',
  violet: 'var(--violet-rgb)',
  cyan: 'var(--cyan-rgb)',
};

/** Plot sizes people in Bengaluru actually quote, in feet. */
const PLOT_SIZES: readonly (readonly [number, number])[] = [
  [20, 30],
  [30, 40],
  [30, 50],
  [40, 60],
  [50, 80],
  [60, 40],
  [24, 36],
  [40, 30],
];

interface Plan {
  corners: [number, number][];
  setback: [number, number][];
  footprint: [number, number][];
  neighbours: [number, number][][];
  markers: [number, number][];
  size: readonly [number, number];
  northDeg: number;
  cornerLen: number;
  setbackLen: number;
}

/**
 * Scale a polygon toward its own centroid.
 *
 * A true offset polygon (each edge moved along its normal) is the correct way
 * to draw a setback and is about forty lines of edge-intersection maths that
 * degenerates on concave corners. These parcels are convex quadrilaterals by
 * construction, and at this scale a centroid scale is indistinguishable from
 * the real thing.
 */
function shrink(points: [number, number][], k: number): [number, number][] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]);
}

function buildPlan(seed: string): Plan {
  const rng = rngFor(seed);
  const size = pick(rng, PLOT_SIZES);

  // The drawn aspect follows the quoted plot size, so a 30×50 reads as deeper
  // than a 60×40 — otherwise the dimension labels and the picture disagree,
  // which is exactly the sort of small incoherence that makes a graphic feel
  // generated rather than drawn.
  const aspect = size[0] / size[1];
  const height = between(rng, 52, 64);
  const width = Math.max(50, Math.min(118, height * aspect * between(rng, 0.94, 1.06)));

  /*
   * The safe area.
   *
   * The SVG is drawn at 240×168 and rendered with `slice`, so in any container
   * wider than 1.43:1 — which is every container it is used in — the top and
   * bottom are cropped. At the widest realistic use (~1.8:1) the surviving
   * band is roughly y ∈ [17, 151].
   *
   * The widest use is wider still: the card strip is nearly 3.3:1, leaving
   * y ∈ [47, 121]. So the parcel, its dimensions and the north arrow all live
   * inside y ∈ [48, 120], and only the graticule, the neighbouring plots and
   * the street are allowed to run off the sheet — which is what those elements
   * are for.
   * The first cut ignored this and clipped a dimension label in half, which is
   * the one kind of error a drawing cannot recover from: a number with its
   * digits cut off is worse than no number.
   */
  const cx = 118;
  const cy = 84;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const j = (m: number) => between(rng, -m, m);

  // Corner jitter is what stops eight cases in a grid from reading as one
  // repeated icon. Kept under 8px so the parcel still reads as a plot rather
  // than as an abstract blob.
  const corners: [number, number][] = [
    [x0 + j(7), y0 + j(6)],
    [x1 + j(7), y0 + j(6)],
    [x1 + j(6), y1 + j(5)],
    [x0 + j(6), y1 + j(5)],
  ];

  const setback = shrink(corners, 0.82);

  // The footprint is drawn as a rectangle rather than a third shrunk copy:
  // buildings are rectangular and parcels are not, and three nested versions
  // of the same outline reads as a target rather than as a plan.
  const fw = width * between(rng, 0.44, 0.6);
  const fh = height * between(rng, 0.4, 0.54);
  const fx = cx + j(width * 0.06);
  const fy = cy + j(height * 0.08);
  const footprint: [number, number][] = [
    [fx - fw / 2, fy - fh / 2],
    [fx + fw / 2, fy - fh / 2],
    [fx + fw / 2, fy + fh / 2],
    [fx - fw / 2, fy + fh / 2],
  ];

  // Adjoining plots, running off the sheet on three sides. A parcel drawn
  // alone floats; a parcel drawn between its neighbours is on a street.
  const neighbours: [number, number][][] = [
    [
      [-30, y0 + j(10)],
      [x0 - between(rng, 8, 14), y0 + j(8)],
      [x0 - between(rng, 8, 14), y1 + j(8)],
      [-30, y1 + j(10)],
    ],
    [
      [x1 + between(rng, 8, 14), y0 + j(8)],
      [270, y0 + j(10)],
      [270, y1 + j(10)],
      [x1 + between(rng, 8, 14), y1 + j(8)],
    ],
    [
      [x0 + j(10), -30],
      [x1 + j(10), -30],
      [x1 + j(8), y0 - between(rng, 8, 13)],
      [x0 + j(8), y0 - between(rng, 8, 13)],
    ],
  ];

  return {
    corners,
    setback,
    footprint,
    neighbours,
    markers: corners,
    size,
    northDeg: intBetween(rng, -28, 28),
    cornerLen: perimeter(corners),
    setbackLen: perimeter(setback),
  };
}

/** `animation-delay` plus the path length the trace keyframe reads. */
function traceStyle(len: number, delay: number, animate: boolean): CSSProperties {
  const style: Record<string, string | number> = { strokeDasharray: len, animationDelay: `${delay}ms` };
  if (animate) style['--trace-len'] = len;
  else style.strokeDashoffset = 0;
  return style as CSSProperties;
}

export function ParcelPlan({ seed, className, detail = 'full', animate = true, hue = 'brand', caption = true }: ParcelPlanProps) {
  const plan = useMemo(() => buildPlan(seed), [seed]);
  const rgb = HUE_VAR[hue];
  const full = detail === 'full';

  /*
   * Line weights are in device pixels, not drawing units.
   *
   * The viewBox is 240 units wide whatever size the box is, so a plain
   * 1.8-unit boundary is half a pixel in a 74px header thumbnail — a grey
   * hint, with only the solid footprint left legible — and six pixels in a
   * full-width card strip, which reads as a cartoon. Same component, same
   * numbers, two different drawings.
   *
   * `non-scaling-stroke` takes the stroke out of the transform: a 2px boundary
   * is 2px at every size, which is how a technical drawing is actually
   * reproduced. The `mark` variant then needs only a small bump, on the
   * ordinary principle that a drawing shown small wants a relatively heavier
   * line.
   */
  const w = full ? 1 : 1.35;
  const px = { vectorEffect: 'non-scaling-stroke' } as const;

  return (
    <figure className={cn(positionClass(className), 'm-0 overflow-hidden', className)}>
      <svg
        viewBox="0 0 240 168"
        className="h-full w-full"
        role="img"
        aria-label={`Indicative plot diagram, ${plan.size[0]} by ${plan.size[1]} feet. Illustrative only — not survey data.`}
        /*
         * `meet` for the dimensioned drawing, `slice` for the thumbnail.
         *
         * Cropping a drawing that carries numbers eventually crops a number,
         * and no container aspect can be assumed — the same component sits in a
         * 1.8:1 tile in the hero and a 1:1 box in the reel. Fitting it leaves
         * bands of the container's own surface at two edges, which is invisible
         * because the plan's ground is transparent: it reads as a drawing on a
         * sheet, which is what it is. The thumbnail has no labels to lose, so
         * it fills instead.
         */
        preserveAspectRatio={full ? 'xMidYMid meet' : 'xMidYMid slice'}
        style={{ color: `rgb(${rgb})` }}
      >
        <defs>
          <linearGradient id={`pp-fill-${seed}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`rgb(${rgb} / 0.30)`} />
            <stop offset="100%" stopColor={`rgb(${rgb} / 0.06)`} />
          </linearGradient>
          <linearGradient id={`pp-build-${seed}`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor={`rgb(${rgb} / 0.9)`} />
            <stop offset="100%" stopColor="rgb(var(--violet-rgb) / 0.75)" />
          </linearGradient>
          {/* The survey graticule. A pattern rather than 40 <line> elements —
              same picture, a twentieth of the DOM in a grid of 24 cases. */}
          <pattern id={`pp-grid-${seed}`} width={full ? 12 : 24} height={full ? 12 : 24} patternUnits="userSpaceOnUse">
            <path
              d={full ? 'M12 0 L0 0 0 12' : 'M24 0 L0 0 0 24'}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.16"
              strokeWidth={0.7 * w}
              {...px}
            />
          </pattern>
          <pattern id={`pp-hatch-${seed}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width="240" height="168" fill={`url(#pp-grid-${seed})`} className={cn(animate && 'animate-fade-in')} />

        {/* Adjoining plots, hatched, behind everything. */}
        <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '80ms' }}>
          {plan.neighbours.map((poly, i) => (
            <path
              key={i}
              d={polygonPath(poly)}
              fill={`url(#pp-hatch-${seed})`}
              fillOpacity="0.5"
              stroke="var(--axis)"
              strokeWidth={0.8 * w}
              strokeOpacity="0.7"
              {...px}
            />
          ))}
        </g>

        {/* The street. Every plot in this product is bought for its frontage,
            so the drawing puts one on the sheet. */}
        <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '120ms' }}>
          <rect x="-10" y="141" width="260" height="34" fill="var(--surface-3)" />
          <line x1="-10" y1="141" x2="250" y2="141" stroke="var(--axis)" strokeWidth={1 * w} {...px} />
          <line x1="-10" y1="154" x2="250" y2="154" stroke="currentColor" strokeOpacity="0.45" strokeWidth={1.2 * w} strokeDasharray="7 6" {...px} />
        </g>

        {/* The parcel: filled, then traced. */}
        <path d={polygonPath(plan.corners)} fill={`url(#pp-fill-${seed})`} className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '180ms' }} />
        <path
          d={polygonPath(plan.corners)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.1 * w}
          strokeLinejoin="round"
          {...px}
          className={cn(animate && 'animate-trace')}
          style={traceStyle(plan.cornerLen, 200, animate)}
        />

        {/* The setback line — dashed, because it is a rule rather than an edge. */}
        <path
          d={polygonPath(plan.setback)}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth={1.1 * w}
          strokeDasharray="4 4"
          {...px}
          className={cn(animate && 'animate-fade-in')}
          style={{ animationDelay: '760ms' }}
        />

        {/* The buildable footprint, rising out of the plan. */}
        <path
          d={polygonPath(plan.footprint)}
          fill={`url(#pp-build-${seed})`}
          className={cn(animate && 'animate-extrude')}
          style={{ animationDelay: '900ms', transformOrigin: 'center', transformBox: 'fill-box' }}
        />

        {/* Survey pegs. */}
        {plan.markers.map(([x, y], i) => (
          <g key={i} className={cn(animate && 'animate-drop')} style={{ animationDelay: `${1000 + i * 70}ms`, transformOrigin: `${x}px ${y}px` }}>
            <circle cx={x} cy={y} r={2.6 * (full ? 1 : 1.5)} fill="var(--surface-2)" stroke="currentColor" strokeWidth={1.5 * w} {...px} />
          </g>
        ))}

        {full && (
          <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '1200ms' }}>
            {/*
              * Dimensions, on the two edges that are quoted when a plot is
              * sold — depth outside the western boundary, frontage set inside
              * the southern one.
              *
              * The frontage runs inside rather than below the plot because
              * below is where the street is and, at these aspect ratios, where
              * the crop is. Dimensioning inside a tight boundary is ordinary
              * drafting practice, so nothing is lost by it.
              */}
            <Dimension
              x1={plan.corners[3][0] - 11}
              y1={plan.corners[0][1]}
              x2={plan.corners[3][0] - 11}
              y2={plan.corners[3][1]}
              label={`${plan.size[1]}'`}
              vertical
            />
            <Dimension
              x1={plan.corners[3][0] + 6}
              y1={plan.corners[3][1] - 8}
              x2={plan.corners[2][0] - 6}
              y2={plan.corners[2][1] - 8}
              label={`${plan.size[0]}'`}
              above
            />

            {/* North. Rotated per seed, because a plan whose north is always up
                is a plan nobody has oriented. */}
            <g transform={`translate(214 40) rotate(${plan.northDeg})`}>
              <path d="M0 -11 L4 6 L0 2.5 L-4 6 Z" fill="currentColor" />
              <text x="0" y="17" textAnchor="middle" fontSize="7" fill="var(--text-muted)" fontFamily="ui-monospace, monospace">
                N
              </text>
            </g>
          </g>
        )}
      </svg>

      {caption && full && (
        /*
          * Top left, on a chip.
          *
          * It sat bottom-left over the street and the frontage dimension, where
          * it was both illegible and in the way of the two things it was
          * qualifying. A caveat nobody can read is not a caveat.
          */
        <figcaption className="pointer-events-none absolute left-2 top-2 rounded bg-page/75 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          Indicative · not survey data
        </figcaption>
      )}
    </figure>
  );
}

/** A dimension line with end ticks and a label sitting on it. */
function Dimension({
  x1,
  y1,
  x2,
  y2,
  label,
  vertical,
  above,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  vertical?: boolean;
  /** Sets the label above the line rather than below it. */
  above?: boolean;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g stroke="var(--text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - (vertical ? 3 : 0)} y1={y1 - (vertical ? 0 : 3)} x2={x1 + (vertical ? 3 : 0)} y2={y1 + (vertical ? 0 : 3)} />
      <line x1={x2 - (vertical ? 3 : 0)} y1={y2 - (vertical ? 0 : 3)} x2={x2 + (vertical ? 3 : 0)} y2={y2 + (vertical ? 0 : 3)} />
      {/* A halo behind the label, painted by stroking the same text underneath
          in the ground colour. Without it the digits sit on top of the
          graticule and the setback dashes and stop being readable at the small
          sizes this is used at. */}
      {[true, false].map(halo => (
        <text
          key={String(halo)}
          x={mx}
          y={my}
          dx={vertical ? -4 : 0}
          dy={vertical ? 3 : above ? -3.5 : 9}
          textAnchor={vertical ? 'end' : 'middle'}
          fontSize="8"
          fontFamily="ui-monospace, monospace"
          fill={halo ? 'none' : 'var(--text-secondary)'}
          stroke={halo ? 'var(--surface-1)' : 'none'}
          strokeWidth={halo ? 2.6 : 0}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {label}
        </text>
      ))}
    </g>
  );
}
