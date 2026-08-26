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
import { betaMemoryTool } from '@anthropic-ai/sdk/helpers/beta/memory';
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

function hostnameMatches(hostname: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  return hostname === p || hostname.endsWith(`.${p}`);
}

/** Finds the known-unreachable entry (if any) that a hostname belongs to — used to enrich a generic tool error with what was actually being sought. */
export function findKnownUnreachableSource(hostname: string | undefined): KnownUnreachableSource | undefined {
  if (!hostname) return undefined;
  return KNOWN_UNREACHABLE_SOURCES.find(s => s.hostnames.some(h => hostnameMatches(hostname, h)));
}

export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

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

/**
 * Each outer iteration of the explorer is a fresh conversation (see
 * explorer.ts) so the model has no transcript memory of earlier iterations —
 * only the structured state the explorer feeds back in, plus whatever it
 * chose to write here. Backed by a plain `Map` closed over per call, so nothing
 * survives past one `runExplorer` invocation and nothing leaks between cases.
 */
export function createExplorationMemoryTool(): { tool: ReturnType<typeof betaMemoryTool>; fileCount: () => number } {
  const files = new Map<string, string>();

  const normalize = (path: string): string => (path.startsWith('/') ? path : `/${path}`);

  const tool = betaMemoryTool({
    view: ({ path, view_range }) => {
      const p = normalize(path);
      if (p === '/' || p === '/memories') {
        const names = [...files.keys()].sort();
        return names.length > 0 ? names.join('\n') : '(empty — no notes written yet)';
      }
      const content = files.get(p);
      if (content === undefined) return `Error: no file at ${p}`;
      if (!view_range || view_range.length < 2) return content;
      const lines = content.split('\n');
      const [start, end] = view_range;
      const from = Math.max(1, start) - 1;
      const to = end === -1 ? lines.length : Math.min(lines.length, end);
      return lines.slice(from, to).join('\n');
    },
    create: ({ path, file_text }) => {
      files.set(normalize(path), file_text);
      return `Created ${normalize(path)} (${file_text.length} chars)`;
    },
    str_replace: ({ path, old_str, new_str }) => {
      const p = normalize(path);
      const content = files.get(p);
      if (content === undefined) return `Error: no file at ${p}`;
      if (!content.includes(old_str)) return `Error: text not found in ${p}`;
      files.set(p, content.replace(old_str, new_str));
      return `Updated ${p}`;
    },
    insert: ({ path, insert_line, insert_text }) => {
      const p = normalize(path);
      const content = files.get(p);
      if (content === undefined) return `Error: no file at ${p}`;
      const lines = content.split('\n');
      const at = Math.max(0, Math.min(lines.length, insert_line));
      lines.splice(at, 0, insert_text);
      files.set(p, lines.join('\n'));
      return `Inserted into ${p} at line ${insert_line}`;
    },
    delete: ({ path }) => {
      const p = normalize(path);
      if (!files.has(p)) return `Error: no file at ${p}`;
      files.delete(p);
      return `Deleted ${p}`;
    },
    rename: ({ old_path, new_path }) => {
      const from = normalize(old_path);
      const to = normalize(new_path);
      const content = files.get(from);
      if (content === undefined) return `Error: no file at ${from}`;
      files.delete(from);
      files.set(to, content);
      return `Renamed ${from} -> ${to}`;
    },
  });

  return { tool, fileCount: () => files.size };
}

/* ------------------------------------------------------------------ */
/* Reachability classification — from tool telemetry, never model say-so */
/* ------------------------------------------------------------------ */

export interface ReachabilityClassification {
  reachability: SourceReachability;
  note?: string;
}

const CAPTCHA_SIGNAL_RE = /captcha|verify you(?:'re| are) human|unusual traffic|are you a robot|prove you.?re not a robot/i;
const AUTH_SIGNAL_RE =
  /session (?:has )?expired|please log ?in|sign in to (?:continue|view)|invalid session|login required|access denied|401 unauthorized|403 forbidden|authentication required/i;

/**
 * A successful `web_fetch` is not necessarily the real page: a login wall or
 * a captcha challenge commonly comes back as HTTP 200 with a page of its own.
 * This is a best-effort keyword sniff over the fetched text, not a
 * guarantee — the note this returns says so, and callers should carry that
 * caveat forward rather than presenting the classification as certain.
 */
export function classifyFetchedContent(text: string | undefined): ReachabilityClassification {
  if (text) {
    if (CAPTCHA_SIGNAL_RE.test(text)) {
      return {
        reachability: 'blocked_captcha',
        note: 'Fetched 200 OK, but the page text reads as a captcha/bot challenge rather than the real content (best-effort detection).',
      };
    }
    if (AUTH_SIGNAL_RE.test(text)) {
      return {
        reachability: 'blocked_auth',
        note: 'Fetched 200 OK, but the page text reads as a login wall rather than the real content (best-effort detection).',
      };
    }
  }
  return { reachability: 'fetched' };
}

/** Best-effort extraction of a fetched page's own text — undefined for binary content (e.g. a PDF), which this cannot sniff. */
export function extractFetchedText(block: Anthropic.Beta.BetaWebFetchBlock): string | undefined {
  const source = block.content.source;
  return source.type === 'text' ? source.data : undefined;
}

export function classifyFetchError(errorCode: Anthropic.Beta.BetaWebFetchToolResultErrorCode, url: string): ReachabilityClassification {
  const known = findKnownUnreachableSource(hostnameOf(url));
  switch (errorCode) {
    case 'url_not_allowed':
      return {
        reachability: known?.reachability ?? 'blocked_auth',
        note: known
          ? `Excluded by this agent's domain policy — ${known.label} sits behind a login/CAPTCHA no web agent can pass.`
          : "Excluded by this agent's domain policy.",
      };
    case 'url_not_accessible':
      return {
        reachability: known?.reachability ?? 'blocked_auth',
        note: known ? known.whatItWouldHaveAnswered : 'Could not access the page (commonly a login wall or a block on automated fetches).',
      };
    case 'too_many_requests':
    case 'max_uses_exceeded':
      return { reachability: 'rate_limited', note: `Fetch tool reported "${errorCode}".` };
    case 'unavailable':
      return { reachability: 'rate_limited', note: 'The fetch service was temporarily unavailable.' };
    case 'unsupported_content_type':
    case 'url_too_long':
    case 'url_not_in_prior_context':
    case 'invalid_tool_input':
      return { reachability: 'not_found', note: `Fetch tool reported "${errorCode}".` };
    default:
      // Defensive: a future SDK version could add an error code this file predates.
      return { reachability: 'not_found', note: `Fetch tool reported an unrecognised error ("${errorCode}").` };
  }
}
