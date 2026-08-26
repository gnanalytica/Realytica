/**
 * The record provider that exists when no vendor is configured.
 *
 * A real provider, not a null. It answers every request, quickly, with a
 * named gap that states what is now unknown and exactly how to get it by
 * hand — which for Karnataka is not a degraded answer but the correct one,
 * since the authoritative registries have no machine interface to configure a
 * key against in the first place.
 *
 * The alternative, returning empty, is the failure this codebase keeps
 * finding: a subsystem that looks complete and reports nothing, so a case
 * where no encumbrance search was ever attempted is indistinguishable from
 * one where the search came back clean.
 */

import { MANUAL_ROUTES } from './manual';
import { recordGap, type RecordOutcome, type RecordProvider, type RecordRequest } from './types';

export const unconfiguredRecordProvider: RecordProvider = {
  id: 'unconfigured',
  label: 'No records vendor configured',
  capabilities: { kinds: [], regions: [], monitor: false },
  configured: false,
  standing:
    'No commercial records vendor is connected. Karnataka’s own registries — Kaveri, Bhoomi, the BBMP portals — have no ' +
    'supported machine interface, so supplying the file yourself is not a workaround here, it is the supported route.',

  async fetch(request: RecordRequest): Promise<RecordOutcome> {
    const route = MANUAL_ROUTES[request.kind];
    return recordGap({
      reason: 'not_configured',
      kind: request.kind,
      leavesUnknown: route.leavesUnknown,
      manualRoute: route.manualRoute,
      detail:
        'No records vendor is configured for this deployment. Set REALYTICA_RECORDS_PROVIDER and its key to connect one, ' +
        'or supply the document yourself — both routes end with the same file on the case.',
    });
  },
};
