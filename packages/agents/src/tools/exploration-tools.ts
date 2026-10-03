/**
 * Server-tool declarations, domain policy and reachability classification for
 * the explorer (`../agents/explorer.ts`).
 *
 * This file encodes the honesty constraint the explorer is built around: the
 * authoritative registries for Indian property — Kaveri (encumbrance and
 * registration), Bhoomi (RTC / land records) and the BBMP khata and property
 * tax portals — sit behind logins, CAPTCHAs and session state that a web
 * agent cannot pass. An agent that quietly fails on those and reports only
 * what it scraped from listing sites would be actively misleading, so:
 *
 * 1. `KNOWN_UNREACHABLE_SOURCES` names them up front, unconditionally, with
 *    what each would have answered — the explorer seeds these into
 *    `ExplorationSession.unreachable` at the start of every run, without
 *    spending a single search or fetch attempting them.
 * 2. Their hostnames are also fed to both server tools' `blocked_domains`, so
 *    the model cannot burn iteration budget attempting them anyway even if it
 *    tries.
 * 3. `classifyFetchError` / `classifyFetchedContent` turn whatever the
 *    explorer *does* attempt into a `SourceReachability` from real tool
 *    telemetry (error codes, and a best-effort content sniff for a captcha or
 *    login wall dressed up as a 200 OK) — never from the model's own say-so.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SourceReachability } from '@realytica/shared';

/* ------------------------------------------------------------------ */
/* Known-unreachable authoritative sources                             */
/* ------------------------------------------------------------------ */

export interface KnownUnreachableSource {
  key: string;
  label: string;
  /** Plain hostnames — matched exactly or as a subdomain, never both allow+block on one tool. */
  hostnames: string[];
  reachability: SourceReachability;
  whatItWouldHaveAnswered: string;
}

export const KNOWN_UNREACHABLE_SOURCES: KnownUnreachableSource[] = [
  {
    key: 'kaveri',
    label: 'Kaveri Online Services (Karnataka Sub-Registrar / encumbrance)',
    hostnames: ['kaveri.karnataka.gov.in', 'kaverionline.karnataka.gov.in', 'igr.karnataka.gov.in'],
    reachability: 'blocked_auth',
    whatItWouldHaveAnswered:
      'Encumbrance certificate history (Form 15/16) for this survey number/PID — prior sale deeds, mortgages, and any pending litigation or attachment registered against the title.',
  },
  {
    key: 'bhoomi',
    label: 'Bhoomi (Karnataka RTC / land records)',
    hostnames: ['landrecords.karnataka.gov.in', 'bhoomi.karnataka.gov.in'],
    reachability: 'blocked_captcha',
    whatItWouldHaveAnswered:
      'RTC (Record of Rights, Tenancy and Crops) extract — the currently recorded owner, khata mutation history, and any pending mutation, for land of agricultural origin.',
  },
  {
    key: 'bbmp_khata',
    label: 'BBMP e-Khata / e-Aasthi portal',
    hostnames: ['bbmpeaasthi.karnataka.gov.in', 'bbmp.gov.in'],
    reachability: 'blocked_auth',
    whatItWouldHaveAnswered: "This property's A/B khata classification and khata certificate/extract details by PID.",
  },
  {
    key: 'bbmp_tax',
    label: 'BBMP property tax portal',
    hostnames: ['bbmptax.karnataka.gov.in'],
    reachability: 'blocked_auth',
    whatItWouldHaveAnswered: 'Property tax payment history and any arrears recorded against this PID.',
  },
];

/** Hostnames handed to both server tools' `blocked_domains` — see file header point 2. */
export const BLOCKED_HOSTNAMES: readonly string[] = KNOWN_UNREACHABLE_SOURCES.flatMap(s => s.hostnames);

/* ------------------------------------------------------------------ */
/* Server tool declarations                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_SEARCH_USES = 6;
const DEFAULT_FETCH_USES = 6;

export function createWebSearchTool(maxUses: number = DEFAULT_SEARCH_USES): Anthropic.Beta.BetaWebSearchTool20260209 {
  return {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: maxUses,
    // Never combined with allowed_domains on the same tool (see BLOCKED_HOSTNAMES doc above).
    blocked_domains: [...BLOCKED_HOSTNAMES],
  };
}

export function createWebFetchTool(maxUses: number = DEFAULT_FETCH_USES): Anthropic.Beta.BetaWebFetchTool20260209 {
  return {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    max_uses: maxUses,
    blocked_domains: [...BLOCKED_HOSTNAMES],
    // Bounds how much of any one page's text can enter context — a cost guard as much as a context one.
    max_content_tokens: 3000,
  };
}

/* ------------------------------------------------------------------ */
/* Memory tool — an in-process scratchpad, scoped to one explorer run  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Reachability classification — from tool telemetry, never model say-so */
/* ------------------------------------------------------------------ */
