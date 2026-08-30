/**
 * Deterministic randomness, keyed to a case.
 *
 * Every generated image in this app — the parcel plan on a case card, the
 * locality map behind a workspace header, the massing block on a yield tab —
 * is drawn from one of these generators, seeded with the case's own id.
 *
 * That constraint is the whole point. A property tool that showed a different
 * plot outline every time you opened the same case would be lying to you in a
 * small way on every render, and a reader who noticed once would be right to
 * distrust the rest of the screen. Seeded from the id, the drawing is stable
 * across renders, reloads and machines: the same case is always the same
 * picture, and two cases are never the same picture.
 *
 * None of these shapes are survey data. They are decoration derived from an
 * identifier, and anything drawn with them says so — see `ParcelPlan`, which
 * carries the caveat in its own caption rather than leaving it to be inferred.
 */

/** FNV-1a over the string, so any id — uuid, slug, reference — gives a usable seed. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — small, fast, and good enough for placing dots on a map.
 *
 * Not for anything that needs to be unguessable. Nothing here is.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator from any string key, in one call. */
export function rngFor(key: string): () => number {
  return makeRng(hashSeed(key));
}

export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function intBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(between(rng, min, max + 1));
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/**
 * Smooth 1-D value noise on a ring, used for wobbling closed contours.
 *
 * A contour built from raw `rng()` per vertex looks like a torn edge, because
 * consecutive samples are independent. Interpolating between a small number of
 * anchors gives the gentle, correlated wander that reads as terrain. Cosine
 * interpolation rather than linear so the joins are not visible as corners,
 * and the anchor array wraps so the loop closes without a seam.
 */
export function ringNoise(rng: () => number, anchors: number): (t: number) => number {
  const points = Array.from({ length: anchors }, () => rng() * 2 - 1);
  return (t: number) => {
    const x = ((t % 1) + 1) % 1;
    const scaled = x * anchors;
    const i = Math.floor(scaled);
    const frac = scaled - i;
    const a = points[i % anchors];
    const b = points[(i + 1) % anchors];
    const smooth = (1 - Math.cos(frac * Math.PI)) / 2;
    return a * (1 - smooth) + b * smooth;
  };
}

/** `M x y L … Z` from a list of points, rounded so the markup stays readable. */
export function polygonPath(points: readonly (readonly [number, number])[], close = true): string {
  if (points.length === 0) return '';
  const body = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return close ? `${body} Z` : body;
}

/**
 * The perimeter of a polygon.
 *
 * Needed because the trace animation runs on `stroke-dashoffset`, and a dash
 * offset only draws a line cleanly if the dash length is the path's real
 * length. Guessing it (the usual `strokeDasharray={1000}`) leaves either a
 * visible gap or a pause at the end of every trace.
 */
export function perimeter(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}
