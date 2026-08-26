/**
 * The place provider port, as one import.
 *
 * A consumer mapping service is a context layer for this product, not an
 * evidence layer: it says where a site is and what surrounds it, and it is
 * never permitted to say how big it is or where its boundary runs. See
 * `SiteContext` in the shared types for the full reasoning.
 */

export * from './types';
export * from './registry';
export * from './context';
export { unconfiguredPlaceProvider } from './unconfigured';
export {
  createGoogleMapsProvider,
  readGoogleMapsConfig,
  staticMapUrl,
  streetViewImageUrl,
  nearbyQueryFor,
  type GoogleMapsConfig,
} from './google';
