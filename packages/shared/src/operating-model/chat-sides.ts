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
import { CAPABILITY_KIND_LABEL } from './catalogs';
import { computeCapabilityRuns, matchProjectLocality } from './capabilities';
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

const CONNECTOR_ALIASES: Array<{ keys: string[]; test: RegExp }> = [
  { keys: ['kaveri_ec', 'kaveri_cc'], test: /\bkaveri\b|\bencumbrance\b|\b\bec\b|\bform\s*15|\bform\s*16|\bcertified cop/i },
  { keys: ['kaveri_gv'], test: /\bguidance value\b|\bstamp duty\b|\bcircle rate\b/i },
  { keys: ['bhoomi', 'mutation_register'], test: /\bbhoomi\b|\brtc\b|\bpahani\b|\brecord of rights\b|\bmutation\b/i },
  { keys: ['ekhata'], test: /\bkhata\b|\be-?aasthi\b|\be-?khata\b/i },
  { keys: ['survey_settlement', 'dishaank'], test: /\bmojini\b|\bdishaank\b|\btippani\b|\bsurvey (sketch|map)\b/i },
  { keys: ['krera', 'krera_updates'], test: /\brera\b|\bk-?rera\b/i },
  { keys: ['cersai'], test: /\bcersai\b/i },
  { keys: ['ecourts'], test: /\becourts?\b|\blitigation\b|\bcause list\b/i },
  { keys: ['fire_noc'], test: /\bfire noc\b|\bfire (and|&) emergency\b/i },
  { keys: ['kspcb'], test: /\bkspcb\b|\bcfe\b|\bcfo\b|\bpollution\b/i },
  { keys: ['ceig'], test: /\bceig\b|\blift licence\b/i },
  { keys: ['bbmp_tax'], test: /\bproperty tax\b|\bbbmp tax\b/i },
  { keys: ['bbmp_plan'], test: /\bsanction(ed)? plan\b|\bbbmp plan\b|\bbda plan\b/i },
  { keys: ['aai_nocas'], test: /\bnocas\b|\bheight clearance\b|\baai\b/i },
];

const DEFAULT_PORTALS = ['bhoomi', 'kaveri_ec', 'ekhata', 'krera', 'fire_noc'];

export function detectChatSideIntents(question: string): ChatSideIntent[] {
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
  const genericPortal =
    /\b(govt|government) portals?\b|\bstatutory records?\b|\bopen (the )?portal\b|\bdownload (the )?(ec|rtc|khata)\b/i.test(q)
    || /\b(fetch|pull|get) (the )?(ec|rtc|khata|encumbrance|rera)\b/i.test(q);
  if (genericPortal && connectorKeys.size === 0) {
    for (const key of DEFAULT_PORTALS) connectorKeys.add(key);
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

  if (/\bcommit (all )?(the )?(ai )?drafts?\b|\baccept (all )?(the )?(ai )?drafts?\b/.test(q.toLowerCase())) {
    out.push({ kind: 'commit_drafts' });
  }

  return out;
}

export interface ChatSideHandle {
  proposals: ChatProposal[];
  text: string;
  toolCalls: { name: string; summary: string }[];
  pane: 'work' | 'graph' | 'actions' | 'orchestrate' | 'drafts' | 'evidence' | 'valuation';
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
  const cards = pull.hits.slice(0, 4).map((hit) =>
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

function proposalsFromConnectors(project: DdProject, keys: string[] | undefined, actor: string, scraped: boolean): { cards: ChatProposal[]; text: string } {
  const rows = connectorsFor(keys);
  const owner = project.owner || actor;
  const cards: ChatProposal[] = [];
  for (const c of rows.slice(0, 8)) {
    const existing = project.evidence.find((e) => e.title.toLowerCase() === c.label.toLowerCase());
    cards.push(
      proposal(
        'open_connector',
        `Obtain ${c.label}`,
        `${c.authority} settles: ${c.settles} Manual route: ${c.route}${c.url ? ` Portal: ${c.url}` : ''}. This product does not log in or scrape the portal.`,
        'Writes a requested evidence row and an action to collect it. Attach the extract in this chat when you have the file.',
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
        },
        actor,
        { citedEvidenceIds: existing ? [existing.id] : undefined },
      ),
    );
  }
  const preface = scraped
    ? 'We do not scrape CAPTCHA/OTP-gated government sites. The supported route is: open the portal, download the extract, attach it here.\n\n'
    : '';
  return {
    cards,
    text:
      preface
      + (cards.length
        ? `Named authorities for this ask:\n${cards.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n')}\n\nApprove a card to put a collection action on the register. Then attach the file in chat.`
        : 'No matching connector in the Karnataka catalogue.'),
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
  const card = proposal(
    'commit_draft',
    `Commit ${pending.length} AI draft(s)`,
    pending.map((d) => `${d.title} (${d.kind})`).join('; '),
    'Writes accepted draft payloads into findings, risks, actions or decisions. Plans and check comments mark committed without a register row.',
    { draftIds: pending.map((d) => d.id) },
    actor,
    { citedNodeIds: pending.map((d) => d.id) },
  );
  return { cards: [card], text: `Pending drafts:\n${pending.map((d) => `• ${d.title} [${d.kind}]`).join('\n')}\n\nApprove to commit them into registers.` };
}

export function handleChatSides(
  project: DdProject,
  question: string,
  actor = 'operator',
  sides?: ChatSideBundle,
): ChatSideHandle | null {
  ensureProjectShape(project);
  const intents = detectChatSideIntents(question);
  if (!intents.length) return null;

  const scraped = /\bscrap(e|ing)\b/i.test(question);
  const cards: ChatProposal[] = [];
  const texts: string[] = [];
  const tools: { name: string; summary: string }[] = [];
  let pane: ChatSideHandle['pane'] = 'work';
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
      if (result.cards.length) pane = 'work';
    } else if (intent.kind === 'connectors') {
      const result = proposalsFromConnectors(project, intent.keys, actor, scraped);
      cards.push(...result.cards);
      texts.push(result.text);
      tools.push({ name: 'connectors', summary: `${result.cards.length} portal route(s)` });
      pane = 'actions';
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
  return {
    evidence: {
      title: label,
      kind,
      source: String(payload.connectorKey ?? 'connector'),
      status: 'requested',
      description: `${payload.settles ?? ''}\n\nRoute: ${route}${url ? `\nPortal: ${url}` : ''}`,
    },
    action: {
      title: `Obtain ${label}`,
      kind: 'evidence_request',
      owner,
      priority: 'high',
      description: `${route}${url ? `\n${url}` : ''}`,
    },
  };
}
