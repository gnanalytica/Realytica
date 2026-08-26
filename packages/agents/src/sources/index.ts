/**
 * Public surface of the data-acquisition pipeline.
 *
 * The layering, outermost first, is:
 *
 *   `ingest.ts`      — `runIngestion(case, sources, files) -> IngestionReport`
 *   `adapters/*`     — the two routes that actually work: an operator-supplied
 *                      file, and an unauthenticated HTTP query to a source the
 *                      registry has verified is open
 *   `normalise.ts`   — raw rows -> `IngestedRecord`, with every rejection named
 *   `registry.ts`    — the catalogue, and the honest account of what cannot be
 *                      reached and what that leaves unchecked
 *
 * Re-exported from one place so callers never reach in by deep path and the
 * file layout stays free to move. This module is deliberately *not* wired into
 * `packages/agents/src/index.ts` from here — that file is owned elsewhere and
 * imports this one when the pipeline is connected up.
 */

export * from './registry';
export * from './normalise';
export * from './adapters/file';
export * from './adapters/http';
export * from './ingest';
