import { useMemo } from 'react';
import { cn } from '../ui/kit';
import { positionClass } from './position';
import { between, rngFor } from './seed';

/*
 * The schematic yield, as a massing render.
 *
 * The yield calculation has always produced the right numbers — a permissible
 * footprint, a floor count, a buildable area — and has always presented them
 * as three figures in a row. Which is fine, except that what somebody is
 * actually deciding when they read it is "how big a thing can I put here", and
 * that is a spatial question. Three numbers make you build the picture in your
 * head; the picture makes you check the numbers.
 *
 * Two solids, both drawn to the same scale:
 *
 *   The envelope   — dashed, empty. What the setbacks and the height cap
 *                    permit. Nobody builds this; it is the ceiling.
 *   The massing    — solid, extruded floor by floor. What the schematic
 *                    yield actually proposes inside that ceiling.
 *
 * The gap between them is the finding. A massing that fills its envelope says
 * the site is height-constrained; one rattling around inside says the
 * constraint is somewhere else — coverage, parking, a setback — and the
 * reader should go and look at which. No caption can make that point as fast
 * as two shapes at the same scale.
 *
 * Axonometric rather than perspective, deliberately: parallel projection keeps
 * every floor the same drawn height, so counting them is reliable and the
 * height dimension on the right is true at both ends. A perspective view is
 * prettier and cannot be measured.
 */

export interface MassingRenderProps {
  seed: string;
  /** Floors in the proposed massing. Ground counts as one. */
  floors?: number;
  /** Floors the envelope permits. Defaults to the massing, i.e. no headroom drawn. */
  envelopeFloors?: number;
  /** 0–1: how much of the plot the footprint covers. Drives the plan area of the solid. */
  coverage?: number;
  className?: string;
  animate?: boolean;
  /** Height callout and floor labels. Off for thumbnails. */
  labels?: boolean;
}

const OX = 152;
const OY = 148;
const SCALE = 0.92;
const PLOT = 52;

/**
 * How tall a storey is drawn, given how many there are.
 *
 * Fixed at 13 units the drawing was right for the two-to-five storey schemes
 * it was designed against and walked straight off the top of the sheet at
 * twelve — which is an ordinary Bengaluru apartment scheme, not an edge case.
 * The height compresses instead, down to a floor thick enough to still read as
 * a separate slab. Beyond that the block is drawn at its true proportion and
 * the storeys stop being individually countable, which is the honest outcome:
 * the height callout still says G+n, and nobody counts thirty slabs by eye.
 */
function floorHeight(floors: number): number {
  return Math.max(3.4, Math.min(13, 122 / Math.max(1, floors)));
}

/** Axonometric projection. Parallel, so every floor measures the same on the page. */
function iso(x: number, y: number, z: number): [number, number] {
  return [OX + (x - y) * 0.866 * SCALE, OY + (x + y) * 0.5 * SCALE - z * SCALE];
}

function face(points: readonly (readonly [number, number, number])[]): string {
  return (
    points
      .map((p, i) => {
        const [sx, sy] = iso(p[0], p[1], p[2]);
        return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)} ${sy.toFixed(1)}`;
      })
      .join(' ') + ' Z'
  );
}

export function MassingRender({
  seed,
  floors,
  envelopeFloors,
  coverage,
  className,
  animate = true,
  labels = true,
}: MassingRenderProps) {
  const model = useMemo(() => {
    const rng = rngFor(seed);
    const n = floors ?? Math.round(between(rng, 2, 5));
    const env = Math.max(n, envelopeFloors ?? n + Math.round(between(rng, 0, 2)));
    const cov = coverage ?? between(rng, 0.4, 0.66);
    // Coverage is an area ratio; the solid's half-extents are its square root,
    // jittered so the block is not a perfect square. Skipping the root is the
    // usual error here and it draws a building with the square of the right
    // footprint.
    const side = Math.sqrt(cov);
    const a = PLOT * side * between(rng, 0.88, 1.12);
    const b = PLOT * side * ((PLOT * side) / a);
    return { n, env, a: Math.min(a, PLOT * 0.92), b: Math.min(b, PLOT * 0.92) };
  }, [seed, floors, envelopeFloors, coverage]);

  const { n, env, a, b } = model;
  const setback = PLOT * 0.86;
  // One height for both solids, taken from whichever is taller, so the massing
  // and its envelope stay comparable — scaling them independently would draw a
  // three-storey block the same height as the four-storey cap it sits inside.
  const FLOOR_H = floorHeight(env);
  const topZ = n * FLOOR_H;
  const envZ = env * FLOOR_H;

  const [dimX, dimTopY] = iso(PLOT, -PLOT, topZ);
  const [, dimBaseY] = iso(PLOT, -PLOT, 0);

  return (
    <div className={cn(positionClass(className), 'overflow-hidden', className)}>
      <svg
        viewBox="0 0 300 220"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Massing diagram: ${n} floor${n === 1 ? '' : 's'} proposed inside an envelope permitting ${env}.`}
      >
        <defs>
          <linearGradient id={`ms-top-${seed}`} x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="rgb(var(--brand-rgb) / 0.95)" />
            <stop offset="100%" stopColor="rgb(var(--violet-rgb) / 0.9)" />
          </linearGradient>
          <linearGradient id={`ms-left-${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--brand-rgb) / 0.7)" />
            <stop offset="100%" stopColor="rgb(var(--brand-rgb) / 0.45)" />
          </linearGradient>
          <linearGradient id={`ms-right-${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb) / 0.62)" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb) / 0.34)" />
          </linearGradient>
          <radialGradient id={`ms-glow-${seed}`}>
            <stop offset="0%" stopColor="rgb(var(--cyan-rgb) / 0.35)" />
            <stop offset="100%" stopColor="rgb(var(--cyan-rgb) / 0)" />
          </radialGradient>
        </defs>

        <ellipse cx="150" cy="120" rx="140" ry="86" fill={`url(#ms-glow-${seed})`} />

        {/* Ground plane. The graticule is what gives the projection a floor;
            without it the solid hangs in space and the eye cannot find its
            base. */}
        <g className={cn(animate && 'animate-fade-in')}>
          <path d={face([[-PLOT, -PLOT, 0], [PLOT, -PLOT, 0], [PLOT, PLOT, 0], [-PLOT, PLOT, 0]])} fill="rgb(var(--brand-rgb) / 0.07)" />
          {Array.from({ length: 9 }, (_, i) => {
            const t = -PLOT + (i * PLOT * 2) / 8;
            return (
              <g key={i} stroke="rgb(var(--brand-rgb) / 0.22)" strokeWidth="0.5">
                <path d={face([[t, -PLOT, 0], [t, PLOT, 0]])} fill="none" />
                <path d={face([[-PLOT, t, 0], [PLOT, t, 0]])} fill="none" />
              </g>
            );
          })}
          <path
            d={face([[-PLOT, -PLOT, 0], [PLOT, -PLOT, 0], [PLOT, PLOT, 0], [-PLOT, PLOT, 0]])}
            fill="none"
            stroke="rgb(var(--brand-rgb) / 0.6)"
            strokeWidth="1.3"
          />
        </g>

        {/* The setback line on the plan, and the envelope above it. */}
        <g
          fill="none"
          stroke="var(--text-muted)"
          strokeOpacity="0.75"
          strokeWidth="0.9"
          strokeDasharray="4 4"
          className={cn(animate && 'animate-fade-in')}
          style={{ animationDelay: '180ms' }}
        >
          <path d={face([[-setback, -setback, 0], [setback, -setback, 0], [setback, setback, 0], [-setback, setback, 0]])} />
          <path d={face([[-setback, -setback, envZ], [setback, -setback, envZ], [setback, setback, envZ], [-setback, setback, envZ]])} />
          <path d={face([[setback, setback, 0], [setback, setback, envZ]])} />
          <path d={face([[-setback, setback, 0], [-setback, setback, envZ]])} />
          <path d={face([[setback, -setback, 0], [setback, -setback, envZ]])} />
        </g>

        {/* The massing, floor by floor, from the ground up. */}
        {Array.from({ length: n }, (_, i) => {
          const z0 = i * FLOOR_H;
          const z1 = z0 + FLOOR_H;
          const delay = 260 + i * 130;
          return (
            <g
              key={i}
              className={cn(animate && 'animate-extrude')}
              style={{ animationDelay: `${delay}ms`, transformOrigin: 'center bottom', transformBox: 'fill-box' }}
            >
              {/* Every floor is outlined, not just filled. Three gradient
                  slabs stacked without edges merge into one block and the
                  storey count — the number a reader is here for — becomes
                  uncountable. */}
              <path
                d={face([[-a, b, z0], [a, b, z0], [a, b, z1], [-a, b, z1]])}
                fill={`url(#ms-left-${seed})`}
                stroke="rgb(var(--brand-rgb) / 0.75)"
                strokeWidth="0.55"
              />
              <path
                d={face([[a, -b, z0], [a, b, z0], [a, b, z1], [a, -b, z1]])}
                fill={`url(#ms-right-${seed})`}
                stroke="rgb(var(--accent-rgb) / 0.6)"
                strokeWidth="0.55"
              />
              <path
                d={face([[-a, -b, z1], [a, -b, z1], [a, b, z1], [-a, b, z1]])}
                fill={i === n - 1 ? `url(#ms-top-${seed})` : 'rgb(var(--brand-rgb) / 0.16)'}
                stroke="rgb(var(--brand-rgb) / 0.5)"
                strokeWidth="0.6"
              />
            </g>
          );
        })}

        {labels && (
          <g className={cn(animate && 'animate-fade-in')} style={{ animationDelay: `${300 + n * 130}ms` }}>
            {/* Height, measured on the same projection as the solid. */}
            <g stroke="var(--text-muted)" strokeWidth="0.8">
              <line x1={dimX + 16} y1={dimTopY} x2={dimX + 16} y2={dimBaseY} />
              <line x1={dimX + 12} y1={dimTopY} x2={dimX + 20} y2={dimTopY} />
              <line x1={dimX + 12} y1={dimBaseY} x2={dimX + 20} y2={dimBaseY} />
            </g>
            <text
              x={dimX + 24}
              y={(dimTopY + dimBaseY) / 2 + 3}
              fontSize="9"
              fontFamily="ui-monospace, monospace"
              fill="var(--text-secondary)"
            >
              {n === 1 ? 'G' : `G+${n - 1}`}
            </text>
            {env > n && (
              <text x={dimX + 24} y={(dimTopY + dimBaseY) / 2 + 15} fontSize="8" fontFamily="ui-monospace, monospace" fill="var(--text-muted)">
                cap G+{env - 1}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}
