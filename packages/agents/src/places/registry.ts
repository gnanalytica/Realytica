/**
 * Which place provider this deployment has.
 *
 * One function, resolved per call rather than cached in a module-level
 * constant, because a serverless function's environment is read at invocation
 * time and a cached "unconfigured" from a cold start that predated the key
 * being set would be wrong for the life of the instance.
 */

import { createGoogleMapsProvider, readGoogleMapsConfig } from './google';
import { unconfiguredPlaceProvider } from './unconfigured';
import type { PlaceProvider } from './types';

export function placeProviderFor(env: NodeJS.ProcessEnv = process.env): PlaceProvider {
  const config = readGoogleMapsConfig(env);
  return config ? createGoogleMapsProvider(config) : unconfiguredPlaceProvider;
}

/** True when a real mapping provider is available. Used by the capability probe. */
export function placeProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readGoogleMapsConfig(env) !== null;
}
