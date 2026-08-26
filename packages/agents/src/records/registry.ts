/**
 * Which records vendor this deployment has.
 *
 * Resolved per call rather than cached, for the same reason the place
 * registry is: a serverless function reads its environment at invocation, and
 * a cached "unconfigured" from a cold start that predated the key being set
 * would be wrong for the life of the instance.
 */

import { createAggregatorProvider, readAggregatorConfig } from './aggregator';
import { unconfiguredRecordProvider } from './unconfigured';
import type { RecordProvider } from './types';

export function recordProviderFor(env: NodeJS.ProcessEnv = process.env): RecordProvider {
  const config = readAggregatorConfig(env);
  return config ? createAggregatorProvider(config) : unconfiguredRecordProvider;
}

/** True when a real records vendor is available. Used by the capability probe. */
export function recordProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readAggregatorConfig(env) !== null;
}
