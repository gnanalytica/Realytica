/**
 * `runIngestion` — the one entry point that turns a case plus whatever the
 * operator has supplied into an `IngestionReport`.
 *
 * THE CENTRAL BEHAVIOUR
 * --------------------
 * A source the registry declares unreachable is reported as `unreachable`
 * **without a request being made**. Not attempted-and-failed: not attempted.
 * That is the whole design, and it buys three things.
 *
 * - *Honesty.* The report distinguishes "we checked and there is nothing" from
 *   "we could not check", and for the second it carries the registry's
 *   `whatItWouldHaveAnswered` so the user knows the shape of the hole in their
 *   diligence rather than just its existence.
 * - *Cost.* Nothing is spent rediscovering a CAPTCHA that has been there for
 *   years. The exploration agent already learned this lesson the expensive way
 *   (see `../tools/exploration-tools.ts`); this is the same lesson applied to
 *   ingestion.
 * - *Manners.* Public services do not get load from a client that has no
 *   business talking to them.
 *
 * The mirror-image failure is also avoided: a source that has nothing to say
 * about this case — BBMP asked about a gram panchayat site — reports `skipped`
 * with the scope reason, not `unreachable`. Inflating the list of things "we
 * could not check" with things that were never applicable is its own form of
 * dishonesty, and it trains users to ignore the list.
 *
 * DETERMINISM
 * -----------
 * No `Math.random()`, no `Date.now()` for anything that reaches the report:
 * the clock arrives as `now` and the report id, `startedAt` and every record
 * id derive from it and from the input. The only non-deterministic part is the
 * network, and it is confined to `adapters/http.ts` behind an injectable
 * `fetch`, so the whole pipeline can be exercised with `network.enabled:
 * false` and produce byte-identical output every run.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not build graph nodes or edges. `addedNodeIds` and `addedEdgeIds`
 * come back empty by design — the title graph is a legal object with its own
 * strict builder (`packages/shared/src/graph/`), and ingestion's job is to
 * produce well-formed `IngestedRecord`s for that builder to consume, not to
 * quietly assert edges on its own authority.
 */

import type {
  IngestionAttempt,
  IngestionOutcome,
  IngestionReport,
  IngestedRecord,
  PropertyCase,
} from '@valytica/shared';
import type { ParsedTable, SuppliedFile } from './adapters/file';
import { ingestSuppliedFile } from './adapters/file';
import type { FetchLike } from './adapters/http';
import { fetchOpenSource } from './adapters/http';
import type { RejectedRow } from './normalise';
import type { RegisteredSource } from './registry';
import { DATA_SOURCES, findSource, sourceApplies } from './registry';

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

/**
 * Network policy for one run.
 *
 * Off by default, and the default is the point: a pipeline that reaches the
 * network unless told not to will eventually do so from a unit test, a
 * migration script or a batch re-screen of every case in the store. The caller
 * has to mean it.
 */
export interface NetworkPolicy {
  enabled: boolean;
  timeoutMs?: number;
  /** Injected in tests; defaults to the runtime's `fetch`. */
  fetchImpl?: FetchLike;
  userAgent?: string;
}

export interface IngestionRequest {
  /** The case. A full `PropertyCase` satisfies this; only the id and identity are read. */
  caseData: Pick<PropertyCase, 'id' | 'identity'>;
  /** The clock. Nothing in this module reads a global one. */
  now: Date;
  /**
   * Which sources to run. `'all_applicable'` (the default) runs every source
   * the registry says has something to say about this case. An explicit list
   * is always unioned with the sources of any supplied file — a caller who
   * hands over a guidance-value CSV and forgets to name its source meant to
   * ingest it.
   */
  sources?: readonly string[] | 'all_applicable';
  suppliedFiles?: readonly SuppliedFile[];
  network?: NetworkPolicy;
  /** Overrides `now` for `finishedAt`; useful when a caller times the run itself. */
  finishedAt?: Date;
  /** Carry file columns the schema did not claim onto records as `extra.<key>`. Default true. */
  keepUnmappedColumns?: boolean;
}

/* ------------------------------------------------------------------ */
/* Detailed result                                                     */
/* ------------------------------------------------------------------ */

export interface SourceRejections {
  sourceId: string;
  sourceLabel: string;
  fileName?: string;
  rows: RejectedRow[];
}

export interface ParsedTableRecord {
  sourceId: string;
  fileName: string;
  table: ParsedTable;
}

/**
 * Everything the run produced, including the parts the frozen contract has no
 * field for.
 *
 * `IngestionReport` carries `attempted` and `records` but no per-row rejection
 * list, and a rejection list truncated into a note string is a summary, not
 * data. Rather than bend the contract, the full detail comes back here and the
 * report stays exactly the shape the rest of the app expects. A caller that
 * only wants the contract shape uses `runIngestion`.
 */
export interface IngestionDetail {
  report: IngestionReport;
  rejections: SourceRejections[];
  tables: ParsedTableRecord[];
  /**
   * How many HTTP requests were actually issued. A caller — or a test — can
   * assert this is zero for a run over blocked sources, which is the claim
   * this whole module makes.
   */
  networkRequests: number;
  /** Supplied files naming a source id the registry does not know. */
  unknownFileSourceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Confidence calibration                                              */
/* ------------------------------------------------------------------ */

/**
 * What a complete record from a source is worth, before per-row deductions.
 *
 * These are calibration constants, not measurements, and they are set by how
 * many hands the data passed through rather than by how official the authority
 * sounds. A live query against a national register is the strongest; a
 * transcription an operator made from an official portal is next; a comparables
 * list an operator assembled themselves is the weakest, because "the broker
 * told me" and "the sub-registrar recorded it" are not the same evidence even
 * when they carry the same number.
 */
export function baseConfidenceFor(source: RegisteredSource): number {
  if (source.access === 'open') return 0.9;
  if (source.obtainedFrom) return 0.85;
  if (source.kind === 'comparables') return 0.7;
  return 0.8;
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

/** The contract-shaped result. Delegates to `runIngestionDetailed`. */
export async function runIngestion(request: IngestionRequest): Promise<IngestionReport> {
  return (await runIngestionDetailed(request)).report;
}

export async function runIngestionDetailed(request: IngestionRequest): Promise<IngestionDetail> {
  const { caseData, now } = request;
  const identity = caseData.identity;
  const startedAt = now.toISOString();
  const suppliedFiles = request.suppliedFiles ?? [];
  const network = request.network ?? { enabled: false };

  const selection = resolveSelection(request.sources ?? 'all_applicable', suppliedFiles);

  const attempted: IngestionAttempt[] = [];
  const records: IngestedRecord[] = [];
  const rejections: SourceRejections[] = [];
  const tables: ParsedTableRecord[] = [];
  let networkRequests = 0;

  for (const source of DATA_SOURCES) {
    if (!selection.matches(source, identity)) continue;

    const verdict = sourceApplies(source, identity);
    if (!verdict.applies) {
      attempted.push(attempt(source, 'skipped', verdict.reason, 0));
      continue;
    }

    if (source.access === 'open') {
      if (!network.enabled) {
        attempted.push(
          attempt(
            source,
            'skipped',
            `Network access is off for this run, so ${source.label} was not queried. It is the rare source that can be: ${source.accessBasis}`,
            0,
          ),
        );
        continue;
      }
      const result = await fetchOpenSource(source, identity, {
        now,
        baseConfidence: baseConfidenceFor(source),
        timeoutMs: network.timeoutMs,
        fetchImpl: network.fetchImpl,
        userAgent: network.userAgent,
      });
      if (result.networkAttempted) networkRequests += 1;
      records.push(...result.records);
      if (result.rejected.length > 0) {
        rejections.push({ sourceId: source.id, sourceLabel: source.label, rows: result.rejected });
      }
      attempted.push(attempt(source, result.outcome, result.note, result.records.length));
      continue;
    }

    if (source.access === 'file_upload') {
      const files = suppliedFiles.filter(f => f.sourceId === source.id);
      if (files.length === 0) {
        attempted.push(
          attempt(
            source,
            'skipped',
            `No file supplied for this source, so nothing was ingested from it. ${source.whatItWouldHaveAnswered} To supply one: ${source.manualRoute ?? 'obtain the extract from the authority and supply it as CSV or JSON.'}`,
            0,
          ),
        );
        continue;
      }

      let ingestedHere = 0;
      const notes: string[] = [];
      files.forEach((file, index) => {
        const result = ingestSuppliedFile(file, source, {
          now,
          baseConfidence: baseConfidenceFor(source),
          keepUnmapped: request.keepUnmappedColumns ?? true,
          idDiscriminator: files.length > 1 ? `f${index + 1}` : undefined,
        });
        records.push(...result.records);
        ingestedHere += result.records.length;
        if (result.rejected.length > 0) {
          rejections.push({ sourceId: source.id, sourceLabel: source.label, fileName: file.fileName, rows: result.rejected });
        }
        if (result.table) tables.push({ sourceId: source.id, fileName: file.fileName, table: result.table });
        notes.push(result.note);
      });

      attempted.push(attempt(source, ingestedHere > 0 ? 'ingested' : 'no_match', notes.join(' '), ingestedHere));
      continue;
    }

    // Declared unreachable. Nothing is attempted — this is the branch the
    // whole module exists for.
    attempted.push(
      attempt(
        source,
        'unreachable',
        `Not attempted: declared \`${source.access}\` in the source registry, so no request was made. ${source.accessBasis} What it would have answered: ${source.whatItWouldHaveAnswered}${
          source.manualRoute ? ` How to obtain it by hand: ${source.manualRoute}` : ''
        }`,
        0,
      ),
    );
  }

  // Files naming a source the registry does not know. Reported rather than
  // dropped: an operator who mistypes a source id should see that, not a
  // silently empty result.
  const unknownFileSourceIds = [...new Set(suppliedFiles.filter(f => !findSource(f.sourceId)).map(f => f.sourceId))].sort();
  for (const sourceId of unknownFileSourceIds) {
    const names = suppliedFiles.filter(f => f.sourceId === sourceId).map(f => f.fileName);
    attempted.push({
      sourceId,
      sourceLabel: `Unregistered source id "${sourceId}"`,
      access: 'file_upload',
      outcome: 'skipped',
      note: `${names.length} supplied file(s) (${names.join(', ')}) name source id "${sourceId}", which is not in the registry, so they were not ingested. Register the source or correct the id.`,
      recordCount: 0,
    });
  }

  const report: IngestionReport = {
    id: `ingest-${caseData.id}-${startedAt}`,
    caseId: caseData.id,
    startedAt,
    finishedAt: (request.finishedAt ?? now).toISOString(),
    attempted,
    records,
    // Wired by the graph bridge, not here — see the file header.
    addedNodeIds: [],
    addedEdgeIds: [],
  };

  return { report, rejections, tables, networkRequests, unknownFileSourceIds };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function attempt(source: RegisteredSource, outcome: IngestionOutcome, note: string, recordCount: number): IngestionAttempt {
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    access: source.access,
    outcome,
    note,
    recordCount,
  };
}

interface Selection {
  matches(source: RegisteredSource, identity: PropertyCase['identity']): boolean;
}

/**
 * Which sources this run considers.
 *
 * `'all_applicable'` still walks every source in the registry and lets
 * `sourceApplies` decide, so an out-of-scope source appears in the report as
 * `skipped` with its reason rather than vanishing. That matters: a user
 * looking at a Devanahalli case should be able to see that BBMP was
 * considered and found to be the wrong authority, not be left wondering
 * whether it was checked.
 */
function resolveSelection(sources: readonly string[] | 'all_applicable', suppliedFiles: readonly SuppliedFile[]): Selection {
  if (sources === 'all_applicable') {
    return { matches: () => true };
  }
  const ids = new Set<string>(sources);
  for (const file of suppliedFiles) ids.add(file.sourceId);
  return { matches: source => ids.has(source.id) };
}

/* ------------------------------------------------------------------ */
/* Report reading helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * The gaps, in the order a user should read them.
 *
 * Convenience for the UI and for the critic agent: the unreachable sources are
 * the diligence's declared blind spots, and something has to be able to ask for
 * exactly that list without re-deriving it from the registry.
 */
export function unreachableSources(report: IngestionReport): IngestionAttempt[] {
  return report.attempted.filter(a => a.outcome === 'unreachable');
}

export function ingestedRecordsBySource(report: IngestionReport): Map<string, IngestedRecord[]> {
  const out = new Map<string, IngestedRecord[]>();
  for (const record of report.records) {
    const list = out.get(record.sourceId);
    if (list) list.push(record);
    else out.set(record.sourceId, [record]);
  }
  return out;
}

/** One-line summary for a log line or a UI banner. */
export function summariseIngestion(report: IngestionReport): string {
  const counts = { ingested: 0, unreachable: 0, no_match: 0, skipped: 0 } as Record<IngestionOutcome, number>;
  for (const a of report.attempted) counts[a.outcome] += 1;
  return `${report.records.length} record(s) from ${counts.ingested} source(s); ${counts.unreachable} declared unreachable and not attempted, ${counts.no_match} answered with no match, ${counts.skipped} out of scope or awaiting a supplied file.`;
}
