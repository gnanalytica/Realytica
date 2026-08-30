/**
 * The visual system: generated artwork, ambient colour, and the reel.
 *
 * Everything here is drawn by the browser from a seed or from the shipped
 * pack. There is not a single raster asset in the product and no component in
 * this directory makes a network request — which is the same constraint the
 * rest of the app runs under, and the reason the front door can carry this
 * much imagery without a CDN, a build step, or a licence.
 */
export { AmbientField, RampRule } from './AmbientField';
export { BrandMark, BrandLock } from './BrandMark';
export { MassingRender } from './MassingRender';
export { ParcelPlan } from './ParcelPlan';
export { ScreenReel } from './ScreenReel';
export { TerrainMap } from './TerrainMap';
export { hashSeed, makeRng, rngFor } from './seed';
