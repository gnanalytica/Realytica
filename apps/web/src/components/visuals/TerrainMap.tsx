import { useMemo, type CSSProperties } from 'react';
import { cn } from '../ui/kit';
import { positionClass } from './position';
import { between, intBetween, perimeter, polygonPath, ringNoise, rngFor } from './seed';

/*
 * A locality, as a topographic sheet.
 *
 * The Location tab used to be a labelled coordinate pair and a caveat. The
 * caveat was the important part — a geocoded pin in Bengaluru is frequently
 * the centre of a village, and the product refuses to pretend otherwise — but
 * a caveat with nothing to qualify is just a paragraph, and nobody read it.
 *
 * Drawing it fixes that. The precision the geocoder reported becomes a circle
 * you can see, with the pin at its centre and the parcel somewhere inside it,
 * and the sentence underneath stops being an apology and starts being a
 * caption. The one claim this product most needs a reader to internalise is
 * now the largest thing on the tab.
 *
 * Everything else on the sheet — contours, the water course, the road grid —
 * is generated from the case id and is scenery. It is drawn in the register of
 * a survey sheet rather than a satellite tile for the same reason `ParcelPlan`
 * is a plan and not a photograph: a photograph of somewhere would be a claim
 * about somewhere, and this is not one.
 */

export interface TerrainMapProps {
  seed: string;
  className?: string;
  /** Metres of geocoder uncertainty. Drives the ring, which is the point of the drawing. */
  precisionM?: number;
  /** Sits under the pin. A locality name, usually. */
  place?: string;
  animate?: boolean;
  /** Hides the pin, ring and labels — for use purely as a decorative ground. */
  bare?: boolean;
}

interface Terrain {
  contours: { path: string; len: number; level: number }[];
  water: string;
  roads: { path: string; len: number; arterial: boolean }[];
  blocks: { x: number; y: number; w: number; h: number }[];
  pin: [number, number];
}

const W = 320;
const H = 180;

function buildTerrain(seed: string): Terrain {
  const rng = rngFor(seed);

  /* --- Relief ---------------------------------------------------------- */
  // One massif, off centre, with six to eight contour intervals. Each ring is
  // the same noise function at a larger radius, so the contours nest without
  // ever crossing — crossed contours are the single detail that would give the
  // drawing away as decoration to anybody who has read a survey sheet.
  const hx = between(rng, 90, 230);
  const hy = between(rng, 50, 130);
  const wobble = ringNoise(rng, 7);
  const rings = intBetween(rng, 6, 8);
  const step = between(rng, 12, 17);

  const contours = Array.from({ length: rings }, (_, i) => {
    const base = 16 + i * step;
    const pts: [number, number][] = Array.from({ length: 46 }, (_, k) => {
      const t = k / 46;
      const a = t * Math.PI * 2;
      const r = base * (1 + 0.2 * wobble(t) + 0.05 * Math.sin(a * 3));
      return [hx + Math.cos(a) * r * 1.25, hy + Math.sin(a) * r * 0.78];
    });
    return { path: polygonPath(pts), len: perimeter(pts), level: i / rings };
  });

  /* --- Water ----------------------------------------------------------- */
  // A tank overflow channel: three control points across the sheet, drawn as a
  // smooth cubic rather than a polyline, because water does not have corners.
  const wy = between(rng, 108, 156);
  const water = `M-10 ${wy.toFixed(1)} C ${between(rng, 60, 90).toFixed(1)} ${(wy - between(rng, 14, 30)).toFixed(1)}, ${between(rng, 150, 200).toFixed(1)} ${(wy + between(rng, 14, 32)).toFixed(1)}, ${W + 10} ${(wy - between(rng, 4, 24)).toFixed(1)}`;

  /* --- Roads ----------------------------------------------------------- */
  const roads: Terrain['roads'] = [];
  const arterialY = between(rng, 40, 78);
  const arterialPts: [number, number][] = [
    [-10, arterialY],
    [between(rng, 70, 110), arterialY + between(rng, -10, 10)],
    [between(rng, 180, 230), arterialY + between(rng, 6, 34)],
    [W + 10, arterialY + between(rng, 20, 50)],
  ];
  roads.push({ path: polygonPath(arterialPts, false), len: perimeter(arterialPts) * 0.8, arterial: true });

  const minorCount = intBetween(rng, 3, 5);
  for (let i = 0; i < minorCount; i++) {
    const vertical = rng() > 0.45;
    const at = between(rng, 30, vertical ? W - 30 : H - 30);
    const pts: [number, number][] = vertical
      ? [
          [at, -10],
          [at + between(rng, -14, 14), H / 2],
          [at + between(rng, -20, 20), H + 10],
        ]
      : [
          [-10, at],
          [W / 2, at + between(rng, -12, 12)],
          [W + 10, at + between(rng, -18, 18)],
        ];
    roads.push({ path: polygonPath(pts, false), len: perimeter(pts) * 0.8, arterial: false });
  }

  /* --- Built-up blocks -------------------------------------------------- */
  // Clustered rather than scattered: settlement follows the road, and evenly
  // sprinkled rectangles read as noise rather than as a village.
  const blocks: Terrain['blocks'] = [];
  const clusters = intBetween(rng, 2, 3);
  for (let c = 0; c < clusters; c++) {
    const cxx = between(rng, 30, W - 50);
    const cyy = between(rng, 30, H - 40);
    const n = intBetween(rng, 5, 10);
    for (let i = 0; i < n; i++) {
      blocks.push({
        x: cxx + between(rng, -26, 26),
        y: cyy + between(rng, -20, 20),
        w: between(rng, 4, 11),
        h: between(rng, 3.5, 9),
      });
    }
  }

  // The pin sits near the middle third: a precision ring drawn around a pin in
  // the corner would spill off two edges and stop reading as a circle, which
  // is the one thing this drawing has to communicate.
  return { contours, water, roads, blocks, pin: [between(rng, 125, 195), between(rng, 78, 104)] };
}

function traceStyle(len: number, delay: number, animate: boolean): CSSProperties {
  const style: Record<string, string | number> = { strokeDasharray: len, animationDelay: `${delay}ms` };
  if (animate) style['--trace-len'] = len;
  else style.strokeDashoffset = 0;
  return style as CSSProperties;
}

export function TerrainMap({ seed, className, precisionM, place, animate = true, bare = false }: TerrainMapProps) {
  const t = useMemo(() => buildTerrain(seed), [seed]);
  const [px, py] = t.pin;

  /*
   * The precision ring, to scale.
   *
   * Mapped so that a rooftop-accurate geocode is a dot and a village-centroid
   * one is most of the neighbourhood, because that is the honest difference
   * between them. The square root keeps the middle of the range — where nearly
   * every real reading lands — spread out rather than bunched.
   *
   * The upper clamp is the load-bearing part and it was three times too
   * generous at first. A 640 m geocode drew a 139-unit radius on a 180-unit
   * sheet, so in a wide container the ring's edge was off every side of the
   * frame and what a reader saw was a faintly tinted map with no ring on it at
   * all — the section's entire argument, invisible. 62 keeps the largest ring
   * inside the shortest edge with room to read as a circle.
   */
  const ringR = precisionM ? Math.max(10, Math.min(62, Math.sqrt(precisionM) * 2.4)) : 0;

  return (
    <div className={cn(positionClass(className), 'overflow-hidden', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={
          bare
            ? 'Decorative topographic pattern'
            : `Indicative locality sketch${place ? ` near ${place}` : ''}${precisionM ? `, with a ${precisionM} metre geocoder precision ring` : ''}. Illustrative only.`
        }
      >
        <defs>
          <linearGradient id={`tm-sky-${seed}`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="rgb(var(--brand-rgb) / 0.10)" />
            <stop offset="55%" stopColor="rgb(var(--violet-rgb) / 0.07)" />
            <stop offset="100%" stopColor="rgb(var(--cyan-rgb) / 0.10)" />
          </linearGradient>
          <radialGradient id={`tm-relief-${seed}`}>
            <stop offset="0%" stopColor="rgb(var(--accent-rgb) / 0.18)" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb) / 0)" />
          </radialGradient>
        </defs>

        <rect width={W} height={H} fill={`url(#tm-sky-${seed})`} />

        {/* Relief: a warm glow under the summit, so the contours read as high
            ground rather than as a set of concentric circles. */}
        <ellipse
          cx={t.contours[0] ? px : W / 2}
          cy={H / 2}
          rx={W * 0.4}
          ry={H * 0.5}
          fill={`url(#tm-relief-${seed})`}
          className={cn(animate && 'animate-fade-in')}
        />

        {/* Contours, outermost first, so the sheet fills in from the edges. */}
        <g fill="none" strokeLinejoin="round">
          {t.contours
            .slice()
            .reverse()
            .map((c, i) => (
              <path
                key={i}
                d={c.path}
                stroke="rgb(var(--violet-rgb))"
                strokeOpacity={0.18 + c.level * 0.4}
                strokeWidth={c.level > 0.8 ? 1.1 : 0.7}
                className={cn(animate && 'animate-trace')}
                style={traceStyle(c.len, 120 + i * 90, animate)}
              />
            ))}
        </g>

        {/* Water. Drawn over the contours because a channel cuts them. */}
        <path
          d={t.water}
          fill="none"
          stroke="rgb(var(--cyan-rgb))"
          strokeOpacity="0.75"
          strokeWidth="3.2"
          strokeLinecap="round"
          className={cn(animate && 'animate-trace')}
          style={traceStyle(420, 320, animate)}
        />

        {/* Settlement. */}
        <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '620ms' }}>
          {t.blocks.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="rgb(var(--brand-rgb) / 0.5)" rx="0.8" />
          ))}
        </g>

        {/* Roads, arterial last so it sits on top of the grid it feeds. */}
        <g fill="none" strokeLinecap="round">
          {t.roads
            .filter(r => !r.arterial)
            .map((r, i) => (
              <path
                key={i}
                d={r.path}
                stroke="var(--text-muted)"
                strokeOpacity="0.5"
                strokeWidth="1.2"
                className={cn(animate && 'animate-trace')}
                style={traceStyle(r.len, 420 + i * 80, animate)}
              />
            ))}
          {t.roads
            .filter(r => r.arterial)
            .map((r, i) => (
              <g key={i}>
                <path
                  d={r.path}
                  stroke="rgb(var(--accent-rgb))"
                  strokeOpacity="0.85"
                  strokeWidth="3"
                  className={cn(animate && 'animate-trace')}
                  style={traceStyle(r.len, 260, animate)}
                />
                <path d={r.path} stroke="var(--surface-2)" strokeOpacity="0.6" strokeWidth="0.7" strokeDasharray="5 6" />
              </g>
            ))}
        </g>

        {!bare && (
          <>
            {/*
              * The precision ring.
              *
              * Two circles and a fill rather than one stroked circle: the
              * breathing outer ring says "this is uncertain and the number is
              * not converging", which is the emotional content of a 900 metre
              * geocode, and a static dashed circle does not say it.
              */}
            {ringR > 0 && (
              <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '900ms' }}>
                <circle cx={px} cy={py} r={ringR} fill="rgb(var(--brand-rgb) / 0.08)" />
                <circle
                  cx={px}
                  cy={py}
                  r={ringR}
                  fill="none"
                  stroke="rgb(var(--brand-rgb))"
                  strokeOpacity="0.55"
                  strokeWidth="1.1"
                  strokeDasharray="5 5"
                  className="animate-breathe"
                  style={{ transformOrigin: `${px}px ${py}px` }}
                />
              </g>
            )}

            <g className={cn(animate && 'animate-drop')} style={{ animationDelay: '1050ms', transformOrigin: `${px}px ${py}px` }}>
              <path
                d={`M${px} ${py} l-5.5 -9 a6.4 6.4 0 1 1 11 0 Z`}
                fill="rgb(var(--brand-rgb))"
                stroke="var(--surface-2)"
                strokeWidth="1.1"
              />
              <circle cx={px} cy={py - 11.5} r="2.2" fill="var(--surface-2)" />
            </g>

            {(place || precisionM) && (
              <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: '1200ms' }}>
                <text x={px + 9} y={py + 3.5} fontSize="7.5" fontFamily="ui-monospace, monospace" fill="var(--text-secondary)">
                  {place ?? ''}
                </text>
                {precisionM ? (
                  <text x={px + 9} y={py + 13} fontSize="6.5" fontFamily="ui-monospace, monospace" fill="var(--text-muted)">
                    ±{precisionM} m
                  </text>
                ) : null}
              </g>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
