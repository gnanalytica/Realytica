/**
 * A records vendor reached over HTTP.
 *
 * Deliberately written against a *shape* rather than one company's API. The
 * Indian title-search aggregators — Landeed and its peers — all do the same
 * thing: you POST an identifier and a record kind, you get back a document or
 * a nil result. Which one a deployment uses is a commercial decision and a
 * base URL, not a code change, so the endpoint, the auth header and the field
 * names all come from configuration.
 *
 * Three properties this adapter holds regardless of which vendor is behind
 * it, because they are the ones that decide whether its output can be
 * trusted:
 *
 * 1. **Everything is `secondary`.** An aggregator assembles its answer from
 *    the same state registries; it is a convenience layer over the register,
 *    never an independent authority. A discrepancy between an aggregator
 *    result and the Sub-Registrar record resolves against the aggregator, and
 *    tagging it here means no downstream consumer has to remember that.
 *
 * 2. **A nil result is a result, and a failure is not.** A vendor returning
 *    "no encumbrance recorded" is one of the most valuable answers this
 *    product can obtain. A vendor timing out looks identical downstream
 *    unless the two are kept apart, and confusing them turns "we could not
 *    check" into "nothing is registered against this title".
 *
 * 3. **It never throws.** Every failure becomes a `RecordGap` carrying what
 *    is now unknown and the manual route to it, so a vendor outage degrades
 *    to the same answer the unconfigured provider gives rather than to an
 *    exception in the middle of a screen.
 */

import { readEnv } from '../env';
import { MANUAL_ROUTES } from './manual';
import {
  RECORD_DOCUMENT_KIND,
  recordGap,
  recordOk,
  type RecordKind,
  type RecordOutcome,
  type RecordProvider,
  type RecordRequest,
} from './types';

export interface AggregatorConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  /** Header the key goes in. Vendors differ; none of them agree. */
  authHeader: string;
  /** Record kinds this contract actually covers. */
  kinds: RecordKind[];
  regions: string[];
  monitor: boolean;
  timeoutMs: number;
}

/**
 * Read the vendor config, or `null` when this deployment has none.
 *
 * `REALYTICA_RECORDS_KINDS` is required rather than defaulted to everything,
 * for a reason worth stating: coverage varies by vendor and by state, and a
 * provider that claims a record kind it cannot actually deliver produces a
 * failed fetch where an honest one would have produced a coverage gap naming
 * the manual route. Silence about coverage is how a nil result gets
 * manufactured.
 */
export function readAggregatorConfig(env: NodeJS.ProcessEnv = process.env): AggregatorConfig | null {
  const baseUrl = readEnv('RECORDS_BASE_URL', env);
  const apiKey = readEnv('RECORDS_API_KEY', env);
  const kindsRaw = readEnv('RECORDS_KINDS', env);
  if (!baseUrl || !apiKey || !kindsRaw) return null;

  const known = new Set<string>(Object.keys(RECORD_DOCUMENT_KIND));
  const kinds = kindsRaw
    .split(',')
    .map(k => k.trim())
    .filter((k): k is RecordKind => known.has(k));
  if (kinds.length === 0) return null;

  const timeoutRaw = Number(readEnv('RECORDS_TIMEOUT_MS', env));
  return {
    id: readEnv('RECORDS_PROVIDER', env) ?? 'records-vendor',
    label: readEnv('RECORDS_LABEL', env) ?? 'Records vendor',
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    authHeader: readEnv('RECORDS_AUTH_HEADER', env) ?? 'Authorization',
    kinds,
    regions: (readEnv('RECORDS_REGIONS', env) ?? 'Karnataka').split(',').map(r => r.trim()).filter(Boolean),
    monitor: readEnv('RECORDS_MONITOR', env) === '1',
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000,
  };
}

/** The response shape this adapter expects. Vendors that differ need a mapper, not a rewrite. */
interface VendorResponse {
  status?: string;
  nil?: boolean;
  issuedAt?: string;
  coverageNote?: string;
  document?: { base64?: string; contentType?: string; fileName?: string };
  message?: string;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

export function createAggregatorProvider(config: AggregatorConfig): RecordProvider {
  return {
    id: config.id,
    label: config.label,
    capabilities: { kinds: config.kinds, regions: config.regions, monitor: config.monitor },
    configured: true,
    standing:
      `${config.label} assembles its answers from the same state registries you would search yourself. It is a ` +
      'convenience layer over the register, not an independent authority — where it disagrees with the Sub-Registrar ' +
      'record, the Sub-Registrar record is right. Treat what it returns as a lead to verify, not as a substitute for ' +
      'the certified copy.',

    async fetch(request: RecordRequest): Promise<RecordOutcome> {
      const route = MANUAL_ROUTES[request.kind];

      if (!config.kinds.includes(request.kind)) {
        return recordGap({
          reason: 'out_of_coverage',
          kind: request.kind,
          leavesUnknown: route.leavesUnknown,
          manualRoute: route.manualRoute,
          detail: `${config.label} does not cover ${route.label.toLowerCase()} under this contract.`,
        });
      }
      if (!config.regions.some(r => r.toLowerCase() === request.identifiers.state.toLowerCase())) {
        return recordGap({
          reason: 'out_of_coverage',
          kind: request.kind,
          leavesUnknown: route.leavesUnknown,
          manualRoute: route.manualRoute,
          detail: `${config.label} does not cover ${request.identifiers.state}. Covered: ${config.regions.join(', ')}.`,
        });
      }
      if (!request.identifiers.parcelId && !request.identifiers.khataOrPid) {
        return recordGap({
          reason: 'insufficient_identifiers',
          kind: request.kind,
          leavesUnknown: route.leavesUnknown,
          manualRoute: route.manualRoute,
          detail:
            'A survey number or a khata/PID is needed to search a register. Supplying one is what unblocks this — ' +
            'widening anything else will not.',
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetch(`${config.baseUrl}/records/${request.kind}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [config.authHeader]: config.apiKey,
          },
          body: JSON.stringify({ identifiers: request.identifiers, period: request.period }),
          signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403 || res.status === 429) {
          return recordGap({
            reason: 'refused',
            kind: request.kind,
            leavesUnknown: route.leavesUnknown,
            manualRoute: route.manualRoute,
            detail: `${config.label} refused the request (HTTP ${res.status}) — check the contract, the key and the quota.`,
          });
        }
        if (!res.ok) {
          return recordGap({
            reason: 'unreachable',
            kind: request.kind,
            leavesUnknown: route.leavesUnknown,
            manualRoute: route.manualRoute,
            detail: `${config.label} returned HTTP ${res.status}.`,
          });
        }

        const body = (await res.json()) as VendorResponse;
        const retrievedAt = new Date().toISOString();

        // A nil result is a result. Kept distinct from every gap above,
        // because "the register holds nothing against this parcel" and "we
        // could not ask" are opposite statements that look identical once
        // they are both an absent document.
        if (body.nil === true) {
          return recordOk({
            kind: request.kind,
            providerId: config.id,
            authority: 'secondary',
            issuedAt: body.issuedAt,
            retrievedAt,
            nilResult: true,
            coverageNote: body.coverageNote,
          });
        }

        const b64 = body.document?.base64;
        if (!b64) {
          return recordGap({
            reason: 'unreachable',
            kind: request.kind,
            leavesUnknown: route.leavesUnknown,
            manualRoute: route.manualRoute,
            detail:
              `${config.label} answered without a document and without declaring a nil result` +
              (body.message ? `: ${body.message}` : '.') +
              ' Treated as "we could not check" rather than as "there is nothing" — the two are not interchangeable.',
          });
        }

        return recordOk({
          kind: request.kind,
          providerId: config.id,
          authority: 'secondary',
          issuedAt: body.issuedAt,
          retrievedAt,
          content: {
            bytes: decodeBase64(b64),
            contentType: body.document?.contentType ?? 'application/pdf',
            fileName: body.document?.fileName ?? `${request.kind}.pdf`,
          },
          coverageNote: body.coverageNote,
        });
      } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError';
        return recordGap({
          reason: 'unreachable',
          kind: request.kind,
          leavesUnknown: route.leavesUnknown,
          manualRoute: route.manualRoute,
          detail: aborted
            ? `${config.label} did not answer within ${config.timeoutMs}ms.`
            : `${config.label} could not be reached: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
