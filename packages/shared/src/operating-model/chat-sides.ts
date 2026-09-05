/**
 * Side features the project cockpit chat can run: Maps (API, not scrape),
 * licensed web search, named government connectors, locality pack, capability
 * snapshots, and AI-draft commit.
 *
 * Nothing here opens a socket. The API layer fills `ChatSideBundle` for Places
 * and web search; this module turns those results — and the in-process
 * connector catalogue — into propose-and-review cards.
 */

import { DD_CONNECTORS, type DdConnector } from '../dd-connectors';
import { CONNECTOR_ALIASES, portalForCheck, wantsPortalObtain } from './portals';
import { compareProjectPlanning, landUseSittingOf, serializePlanningOverlay, wantsPlanningOverlay } from './planning-overlay';
import { wantsGisOverlay } from './gis-overlay';
import { CAPABILITY_KIND_LABEL } from './catalogs';
import { computeCapabilityRuns, matchProjectLocality } from './capabilities';
import type { ProjectCockpitPane } from './cockpit';
import type {
  ChatPlacesPull,
  ChatProposal,
  ChatProposalKind,
  ChatSideBundle,
  ChatSideIntent,
  ChatWebPull,
  CreateActionInput,
  CreateEvidenceInput,
  CreateFindingInput,
  DdProject,
} from './types';
import { ensureProjectShape } from './operations';
import { sittingCheckOf, type SittingRef } from './sitting';
import { plural } from './text';

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function proposal(
  kind: ChatProposalKind,
  title: string,
  rationale: string,
  impact: string,
  payload: Record<string, unknown>,
  actor: string,
  extra: Partial<ChatProposal> = {},
): ChatProposal {
  return {
    id: id('prp'),
    kind,
    title,
    rationale,
    impact,
    status: 'proposed',
    payload,
    createdAt: nowIso(),
    createdBy: actor,
    ...extra,
  };
}

const PLACE_KIND_RE: Array<{ kind: string; test: RegExp }> = [
  { kind: 'school', test: /\bschools?\b|\beducation\b/i },
  { kind: 'hospital', test: /\bhospitals?\b|\bclinic|\bhealth\b/i },
  { kind: 'transit', test: /\bmetro\b|\btransit\b|\bstation\b|\btrain\b|\bsubway\b/i },
  { kind: 'airport', test: /\bairports?\b/i },
  { kind: 'market', test: /\bmalls?\b|\bsupermarket|\bshopping\b/i },
];

const DEFAULT_PORTALS = ['bhoomi', 'kaveri_ec', 'ekhata', 'krera', 'fire_noc'];

export function detectChatSideIntents(question: string, sitting?: SittingRef, project?: DdProject): ChatSideIntent[] {
  const q = question.trim();
  if (!q) return [];
  const out: ChatSideIntent[] = [];

  const placeKinds = PLACE_KIND_RE.filter((row) => row.test.test(q)).map((row) => row.kind);
  const wantsMaps =
    placeKinds.length > 0
    || /\bgoogle maps\b|\bstreet view\b|\bgeocode|\bwhat.?s around|\bnearby\b|\bamenities?\b|\bsurroundings?\b|\bmaps?\b (lookup|pin|context)/i.test(q)
    || /\b(locate|pin) (the )?(site|property|project)\b/i.test(q);
  if (wantsMaps) out.push({ kind: 'places', keys: placeKinds.length ? placeKinds : undefined });

  const connectorKeys = new Set<string>();
  for (const row of CONNECTOR_ALIASES) {
    if (row.test.test(q)) for (const key of row.keys) connectorKeys.add(key);
  }
  const seated = project ? sittingCheckOf(project, sitting)?.check : undefined;
  const sittingPortal = seated ? portalForCheck(seated) : undefined;
  if (sittingPortal && (wantsPortalObtain(q) || (connectorKeys.size === 0 && /\bthis (check|field|noc|extract)\b/i.test(q)))) {
    connectorKeys.add(sittingPortal.key);
  }
  const genericPortal =
    /\b(govt|government) portals?\b|\bstatutory records?\b|\bopen (the )?portal\b|\bdownload (the )?(ec|rtc|khata)\b/i.test(q)
    || /\b(fetch|pull|get) (the )?(ec|rtc|khata|encumbrance|rera)\b/i.test(q);
  if (genericPortal && connectorKeys.size === 0) {
    for (const key of DEFAULT_PORTALS) connectorKeys.add(key);
  }

  const seatedCheck = seated;
  const planning =
    wantsPlanningOverlay(q)
    || wantsGisOverlay(q)
    || Boolean(seatedCheck && portalForCheck(seatedCheck)?.key === 'bda_rmp' && /\b(zone|overlay|compare|plan|sheet|what (zone|use))\b/i.test(q));
  if (planning) {
    connectorKeys.delete('bda_rmp');
    out.push({ kind: 'planning' });
  }
  if (connectorKeys.size) out.push({ kind: 'connectors', keys: [...connectorKeys] });

  const explicitWeb =
    /\bsearch (the )?(web|online|internet|google)\b|\bweb search\b|\bgoogle it\b|\bonline search\b|\bmarket research\b|\bbrowse (the )?(web|internet)\b/i.test(q);
  const scrape = /\bscrap(e|ing)\b/i.test(q);
  if (explicitWeb || (scrape && !connectorKeys.size && !wantsMaps)) {
    out.push({ kind: 'web_search' });
  }

  if (
    /\blocality (pack|note|market|comps?|median)\b|\bmarket (comps?|comparables|signal)\b|\bguidance value\b|\bwhat.?s the market\b|\blocality reference\b/i.test(q)
    && !explicitWeb
  ) {
    out.push({ kind: 'locality' });
  }

  if (
    (/\b(run|snapshot|compute|refresh)\b.{0,24}\b(capabilit|cost|schedule|benchmark)\b/i.test(q)
      || (/\bcapabilit(y|ies)\b/i.test(q) && /\b(run|snapshot|show|compute)\b/i.test(q)))
    && !/\bmarket research\b/i.test(q)
  ) {
    out.push({ kind: 'capabilities' });
  }

  if (/\bcommit (all )?(the )?(ai )?drafts?\b|\baccept (all )?(the )?(ai )?drafts?\b|\breview (pending )?(ai )?drafts?\b/.test(q.toLowerCase())) {
    out.push({ kind: 'commit_drafts' });
  }

  return out;
}

export interface ChatSideHandle {
  proposals: ChatProposal[];
  text: string;
  toolCalls: { name: string; summary: string }[];
  pane: ProjectCockpitPane;
  citedEvidenceIds: string[];
  citedNodeIds: string[];
}

function connectorsFor(keys?: string[]): DdConnector[] {
  if (!keys?.length) return DD_CONNECTORS.filter((c) => DEFAULT_PORTALS.includes(c.key));
  const wanted = new Set(keys);
  return DD_CONNECTORS.filter((c) => wanted.has(c.key));
}

function evidenceKindForConnector(connector: DdConnector): CreateEvidenceInput['kind'] {
  if (connector.domain === 'approvals' || connector.domain === 'compliance') return 'approval';
  if (connector.domain === 'land') return 'gis';
  return 'document';
}

function placesNarrative(pull: ChatPlacesPull): string {
  const lines: string[] = [];
  if (pull.resolvedAddress) {
    lines.push(`Geocoded “${pull.query}” → ${pull.resolvedAddress} (${pull.precision ?? 'unknown precision'}).`);
  } else {
    lines.push(`Looked up “${pull.query}” via ${pull.provider}.`);
  }
  if (pull.caveat) lines.push(pull.caveat);
  if (pull.amenities.length) {
    lines.push('Nearby (straight-line, from this pin — not a surveyed boundary):');
    for (const a of pull.amenities.slice(0, 16)) {
      const dist = a.metres != null ? `${a.metres.toLocaleString()} m` : 'distance unknown';
      const drive = a.drivingSeconds != null ? `, ~${Math.round(a.drivingSeconds / 60)} min drive` : '';
      lines.push(`• ${a.kind}: ${a.name} (${dist}${drive})`);
    }
  }
  if (pull.streetView) {
    lines.push(`Street View imagery exists (captured ${pull.streetView.capturedAt}${pull.streetView.offsetMetres != null ? `, ${pull.streetView.offsetMetres} m from pin` : ''}). Context only.`);
  }
  for (const gap of pull.gaps) lines.push(`Gap (${gap.code}): ${gap.consequence}`);
  lines.push('This is mapping context, not a parcel boundary, setback or certified survey.');
  return lines.join('\n');
}

function proposalsFromPlaces(project: DdProject, pull: ChatPlacesPull | undefined, actor: string): { cards: ChatProposal[]; text: string } {
  if (!pull) {
    return {
      cards: [],
      text: 'Maps lookup was not run on this turn. In the live app the server calls Google Maps Platform (geocode, nearby, Street View metadata) — it does not scrape maps.google.com. Set REALYTICA_GOOGLE_MAPS_API_KEY to enable it.',
    };
  }
  if (!pull.configured) {
    return {
      cards: [],
      text: pull.gaps.map((g) => g.consequence).join('\n') || 'No mapping provider is configured (set REALYTICA_GOOGLE_MAPS_API_KEY). Chat will not invent nearby schools or a pin.',
    };
  }
  const body = placesNarrative(pull);
  if (!pull.amenities.length && !pull.resolvedAddress && pull.gaps.length) {
    return { cards: [], text: body };
  }
  const land = project.assessments.flatMap((a) => a.scopes.filter((s) => s.scopeKey === 'land_site'));
  const card = proposal(
    'file_evidence',
    `File Maps context (${pull.amenities.length} nearby place(s))`,
    body.split('\n').slice(0, 8).join(' '),
    'Writes mapping context onto the evidence register as gis / external_dataset. It does not overwrite deed extents or become a boundary.',
    {
      title: `Maps context — ${pull.resolvedAddress || project.city}`,
      kind: 'gis',
      source: pull.provider,
      status: 'received',
      description: body,
      assessmentIds: [...new Set(land.map((s) => s.assessmentId).filter(Boolean))],
      scopeInstanceIds: land.map((s) => s.id),
    } satisfies Partial<CreateEvidenceInput> & Record<string, unknown>,
    actor,
  );
  return { cards: [card], text: `${body}\n\nApprove the card to file this as location evidence. It is not a survey.` };
}

/**
 * Web hits as cards.
 *
 * Exported because two callers build them now — the keyword side-channel and
 * the copilot's own `search_web` tool — and a market signal that arrives as a
 * card on one path and as prose on the other is the same claim with two
 * different standards of proof.
 */
export function webSignalCards(project: DdProject, pull: ChatWebPull, actor: string): ChatProposal[] {
  return pull.hits.slice(0, 4).map((hit) =>
    proposal(
      'add_finding',
      `Web signal: ${hit.title}`.slice(0, 160),
      `${hit.claim}${hit.url ? ` Source: ${hit.url}` : ' No URL — treat as unverified.'}`,
      'Creates an open commercial/market finding. It is not a statutory record. Link proof after you open the source.',
      {
        title: hit.title.slice(0, 160),
        description: [hit.claim, hit.url ? `Source: ${hit.url}` : 'No source URL returned.', `Search: ${pull.query}`].join('\n'),
        severity: 'low',
        discipline: 'commercial_market',
        owner: project.owner || actor,
      } satisfies CreateFindingInput,
      actor,
    ),
  );
}

function proposalsFromWeb(project: DdProject, pull: ChatWebPull | undefined, actor: string): { cards: ChatProposal[]; text: string } {
  if (!pull) {
    return {
      cards: [],
      text: 'Web search was not run on this turn. Enable REALYTICA_AGENT_WEB_SEARCH=1 for locality-only search (no address, owner or documents leave the system). Gated government portals stay blocked — we do not scrape them.',
    };
  }
  if (!pull.enabled) {
    return { cards: [], text: pull.note || 'Web search is disabled for this deployment.' };
  }
  if (!pull.hits.length) {
    return { cards: [], text: pull.note || `Search for “${pull.query}” returned no structured hits to propose.` };
  }
  const cards = webSignalCards(project, pull, actor);
  return {
    cards,
    text: [
      `Public-web search for locality terms (“${pull.query}”). Address, owner and documents were not sent.`,
      'Government portals behind login/CAPTCHA were not fetched.',
      ...cards.map((c) => `• ${c.title}`),
      'Approve a card to log it as a finding. It is web signal, not a Kaveri/Bhoomi extract.',
    ].join('\n'),
  };
}

function proposalsFromConnectors(
  project: DdProject,
  keys: string[] | undefined,
  actor: string,
  scraped: boolean,
  sitting?: SittingRef,
): { cards: ChatProposal[]; text: string } {
  const rows = connectorsFor(keys);
  const owner = project.owner || actor;
  const seated = sittingCheckOf(project, sitting);
  const cards: ChatProposal[] = [];
  for (const c of rows.slice(0, 8)) {
    const existing = project.evidence.find((e) => e.title.toLowerCase() === c.label.toLowerCase());
    cards.push(
      proposal(
        'open_connector',
        `Obtain ${c.label}`,
        `${c.settles} From ${c.authority}: ${c.route}${c.url ? ` (${c.url})` : ''}`,
        seated
          ? `Puts it on the register against “${seated.check.title}”.`
          : 'Puts it on the register with an action to collect it.',
        {
          connectorKey: c.key,
          label: c.label,
          authority: c.authority,
          settles: c.settles,
          url: c.url,
          route: c.route,
          recordKind: c.recordKind,
          kind: evidenceKindForConnector(c),
          owner,
          evidenceId: existing?.id,
          ...(seated
            ? {
                checkId: seated.check.id,
                checkIds: [seated.check.id],
                assessmentIds: [seated.assessment.id],
                scopeInstanceIds: [seated.scope.id],
              }
            : {}),
        },
        actor,
        { citedEvidenceIds: existing ? [existing.id] : undefined, citedNodeIds: seated ? [seated.check.id] : undefined },
      ),
    );
  }
  /*
   * The cards say what they are; the reply says what to do.
   *
   * This reprinted every card's title and full rationale above the cards —
   * the same duplication the upload and wizard branches carried — under the
   * heading "Named authorities for this ask", which is not a phrase anybody
   * has ever said out loud. And every card ended "This product does not log
   * in or scrape the portal", a policy stated once per card, per turn,
   * forever. It is true and it belongs where somebody would wonder: the
   * preface, and only when a portal that blocks us was actually asked for.
   */
  /*
   * Said once, not once per card.
   *
   * "This product does not log in or scrape the portal" closed every
   * connector card — a standing disclosure repeated as many times as there
   * were places to look. It has to survive, because a card that names a
   * portal and does not say who fetches it is an implied promise. So it stays
   * in the reply, in the first person, once: the person reads it, and the
   * cards get on with naming the sources.
   */
  const preface = scraped
    ? 'Those portals sit behind a CAPTCHA, so I can’t fetch them at all.\n\n'
    : '';
  return {
    cards,
    text:
      preface
      + (cards.length
        ? `${plural(cards.length, 'place')} to get this. I can’t log in or scrape them — approve below and I’ll put it on the register for you to collect.`
        : 'Nothing in the Karnataka catalogue covers that.'),
  };
}

function proposalsFromLocality(project: DdProject, actor: string): { cards: ChatProposal[]; text: string } {
  const loc = matchProjectLocality(project);
  if (!loc) {
    return { cards: [], text: `No locality pack match for ${project.location}, ${project.city}. This is the offline country/state pack, not a live crawl.` };
  }
  const body = [
    `${loc.locality}, ${loc.city} (${loc.state}).`,
    `Median built-up ${loc.currency} ${loc.medianPricePerSqm.toLocaleString()}/sqm; land ${loc.currency} ${loc.medianLandRatePerSqm.toLocaleString()}/sqm; statutory land ${loc.currency} ${loc.statutoryLandRatePerSqm.toLocaleString()}/sqm.`,
    `Gross yield ${(loc.grossYield * 100).toFixed(1)}%; liquidity ${loc.liquidityDays} days; FAR ${loc.farAllowed}; zoning ${loc.zoning}.`,
    loc.planningNote,
    loc.infrastructureNote,
    'Offline locality pack — not a live transaction feed and not a certified valuation.',
  ].join('\n');
  const card = proposal(
    'file_evidence',
    `File locality pack: ${loc.locality}`,
    body.replace(/\s+/g, ' ').slice(0, 400),
    'Files the matched locality reference as evidence. It does not become an IBBI certificate.',
    {
      title: `Locality pack — ${loc.locality}`,
      kind: 'document',
      source: 'locality_pack',
      status: 'received',
      description: body,
    } satisfies Partial<CreateEvidenceInput> & Record<string, unknown>,
    actor,
  );
  return { cards: [card], text: `${body}\n\nApprove to file this pack note on the evidence register.` };
}

function proposalsFromCapabilities(project: DdProject, actor: string): { cards: ChatProposal[]; text: string } {
  const runs = computeCapabilityRuns(project);
  const card = proposal(
    'snapshot_capabilities',
    'Store cost / schedule / market / benchmark snapshot',
    runs.map((r) => `${CAPABILITY_KIND_LABEL[r.kind]}: ${r.summary}`).join(' '),
    'Computes from live registers (no model). Approve to persist the snapshot on the project.',
    { kinds: runs.map((r) => r.kind) },
    actor,
    { citedNodeIds: [project.id] },
  );
  return {
    cards: [card],
    text: `Capability read from project registers (no model, no web). Approve to store the snapshot.\n${runs.map((r) => `• ${CAPABILITY_KIND_LABEL[r.kind]} — ${r.summary}`).join('\n')}`,
  };
}

function proposalsFromDrafts(project: DdProject, actor: string): { cards: ChatProposal[]; text: string } {
  const pending = project.aiDrafts.filter((d) => d.status === 'draft' || d.status === 'in_review' || d.status === 'accepted');
  if (!pending.length) {
    return { cards: [], text: 'No AI drafts waiting. Say “orchestrate” first — that proposes drafts from registers without writing findings.' };
  }
  const first = pending[0]!;
  const more = pending.length - 1;
  const card = proposal(
    'commit_draft',
    `Commit “${first.title}”`,
    more
      ? `${first.kind} draft. ${more} more stay in the drafts register — this card commits one.`
      : `${first.title} (${first.kind}). Nothing writes until you approve.`,
    'Writes this draft into the matching register. Other drafts stay proposed.',
    { draftIds: [first.id] },
    actor,
    { citedNodeIds: [first.id] },
  );
  return {
    cards: [card],
    text: `Pending drafts:\n${pending.map((d) => `• ${d.title} [${d.kind}]`).join('\n')}\n\nApprove to commit the first. The rest stay in drafts.`,
  };
}

export function reviewPendingDrafts(project: DdProject, actor = 'operator'): { cards: ChatProposal[]; text: string } {
  return proposalsFromDrafts(project, actor);
}

export function handleChatSides(
  project: DdProject,
  question: string,
  actor = 'operator',
  sides?: ChatSideBundle,
  sitting?: SittingRef,
): ChatSideHandle | null {
  ensureProjectShape(project);
  const intents = detectChatSideIntents(question, sitting, project);
  if (!intents.length) return null;

  const scraped = /\bscrap(e|ing)\b/i.test(question);
  const cards: ChatProposal[] = [];
  const texts: string[] = [];
  const tools: { name: string; summary: string }[] = [];
  let pane: ChatSideHandle['pane'] = 'overview';
  const citedEvidenceIds: string[] = [];
  const citedNodeIds: string[] = [];

  for (const intent of intents) {
    if (intent.kind === 'places') {
      const result = proposalsFromPlaces(project, sides?.places, actor);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'places', summary: sides?.places?.configured ? `${sides.places.amenities.length} nearby` : 'Maps lookup' });
      if (result.cards.length) pane = 'evidence';
    } else if (intent.kind === 'web_search') {
      const result = proposalsFromWeb(project, sides?.web, actor);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'web_search', summary: sides?.web?.enabled ? `${sides.web.hits.length} hit(s)` : 'Search unavailable' });
      if (result.cards.length) pane = 'overview';
    } else if (intent.kind === 'connectors') {
      const result = proposalsFromConnectors(project, intent.keys, actor, scraped, sitting);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'connectors', summary: `${result.cards.length} portal route(s)` });
      pane = 'actions';
    } else if (intent.kind === 'planning') {
      const seated = landUseSittingOf(project, sitting);
      const read = compareProjectPlanning(project, { sitting: seated ? { checkId: seated.check.id, ddId: seated.assessment.id, scopeId: seated.scope.id } : sitting, places: sides?.places });
      const connector = proposalsFromConnectors(
        project,
        ['bda_rmp'],
        actor,
        scraped,
        seated ? { checkId: seated.check.id, ddId: seated.assessment.id, scopeId: seated.scope.id } : sitting,
      );
      cards.push(...connector.cards);
      texts.push(serializePlanningOverlay(read), connector.text);
      if (wantsGisOverlay(question)) {
        texts.push(
          'GIS CONTEXT MAP — OpenStreetMap water and landuse around the pin, OpenCity GBA wards and BBMP lakes clipped to the pin, plus a supplied survey sketch if one is on file. That is not the RMP hatch and not a classified drain. Open Overview to see the overlay. Do not file OSM or OpenCity as this project\'s extract.',
        );
        pane = 'overview';
      } else {
        pane = 'scope';
      }
      tools.push({ name: 'planning_overlay', summary: read.pin ? 'pin vs kept plan' : 'kept plan, no pin' });
    } else if (intent.kind === 'locality') {
      const result = proposalsFromLocality(project, actor);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'locality', summary: matchProjectLocality(project)?.locality ?? 'no match' });
      if (result.cards.length) pane = 'evidence';
    } else if (intent.kind === 'capabilities') {
      const result = proposalsFromCapabilities(project, actor);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'capabilities', summary: 'Register snapshot' });
      pane = 'orchestrate';
    } else if (intent.kind === 'commit_drafts') {
      const result = proposalsFromDrafts(project, actor);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'commit_draft', summary: `${result.cards.length ? 'pending drafts' : 'none pending'}` });
      pane = 'drafts';
    }
  }

  for (const c of cards) {
    citedEvidenceIds.push(...(c.citedEvidenceIds ?? []));
    citedNodeIds.push(...(c.citedNodeIds ?? []));
  }

  return {
    proposals: cards,
    text: texts.filter(Boolean).join('\n\n'),
    toolCalls: tools,
    pane,
    citedEvidenceIds,
    citedNodeIds,
  };
}

export function connectorEvidenceInput(payload: Record<string, unknown>, actor: string): { evidence: CreateEvidenceInput; action: CreateActionInput } {
  const label = String(payload.label ?? 'Statutory extract');
  const route = String(payload.route ?? '');
  const url = typeof payload.url === 'string' ? payload.url : undefined;
  const owner = String(payload.owner ?? actor);
  const kind = (payload.kind as CreateEvidenceInput['kind']) ?? 'document';
  const checkIds = Array.isArray(payload.checkIds) ? payload.checkIds.filter((id): id is string => typeof id === 'string') : [];
  if (typeof payload.checkId === 'string' && !checkIds.includes(payload.checkId)) checkIds.push(payload.checkId);
  const assessmentIds = Array.isArray(payload.assessmentIds) ? payload.assessmentIds.filter((id): id is string => typeof id === 'string') : [];
  const scopeInstanceIds = Array.isArray(payload.scopeInstanceIds)
    ? payload.scopeInstanceIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    evidence: {
      title: label,
      kind,
      source: String(payload.connectorKey ?? 'connector'),
      status: 'requested',
      description: `${payload.settles ?? ''}\n\nRoute: ${route}${url ? `\nPortal: ${url}` : ''}`,
      checkIds,
      assessmentIds,
      scopeInstanceIds,
    },
    action: {
      title: `Obtain ${label}`,
      kind: 'evidence_request',
      owner,
      priority: 'high',
      description: `${route}${url ? `\n${url}` : ''}`,
      checkIds,
    },
  };
}
