/**
 * Network-backed extras for project cockpit chat: Google Maps Platform and
 * locality-only web search. Government portals are not fetched from here.
 */

import {
  agentCapability,
  capabilityBlocksRoute,
  createWebFetchTool,
  createWebSearchTool,
  describeError,
  haversineMetres,
  nearbyQueryFor,
  placeProviderFor,
  resolveRoute,
  textOf,
  type LlmServerTool,
} from '@realytica/agents';
import {
  detectChatSideIntents,
  type ChatPlacesAmenity,
  type ChatPlacesPull,
  type ChatSideBundle,
  type ChatWebHit,
  type ChatWebPull,
  type DdProject,
} from '@realytica/shared';
import type { AmenityKind, GeoPoint } from '@realytica/shared';

const CITY_BIAS: Record<string, GeoPoint> = {
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  rotterdam: { lat: 51.9244, lng: 4.4777 },
  utrecht: { lat: 52.0907, lng: 5.1214 },
};

const REGION_FOR_CITY: Record<string, string> = {
  bengaluru: 'in',
  bangalore: 'in',
  amsterdam: 'nl',
  rotterdam: 'nl',
  utrecht: 'nl',
};

const ALL_KINDS: AmenityKind[] = ['transit', 'school', 'hospital', 'market', 'airport'];

function geocodeQuery(project: DdProject): string {
  const address = project.siteAddress?.trim();
  if (address) return `${address}, ${project.city}`;
  return [project.location, project.city].filter(Boolean).join(', ');
}

function caveatFor(precision: string | undefined, resolved: string): string {
  if (precision === 'rooftop') {
    return `Located from the address on file, which matched "${resolved}". The pin marks that address — it is not a surveyed parcel boundary.`;
  }
  if (precision === 'interpolated') {
    return `Located by interpolating along the street from "${resolved}", so the pin may sit some way from the actual gate.`;
  }
  if (precision === 'locality_centre') {
    return `The query resolved to the centre of "${resolved}", not this property. Distances describe the neighbourhood, not the site.`;
  }
  return `The geocoder matched "${resolved}" but could not say how precisely. Treat the pin as indicative of the area only.`;
}

export async function pullPlacesForProject(project: DdProject, kinds?: string[]): Promise<ChatPlacesPull> {
  const provider = placeProviderFor();
  const query = geocodeQuery(project);
  const wanted = (kinds?.length ? kinds : ALL_KINDS).filter((k): k is AmenityKind => ALL_KINDS.includes(k as AmenityKind));

  if (!provider.configured) {
    return {
      provider: provider.id,
      configured: false,
      query,
      amenities: [],
      gaps: [
        {
          code: 'no_provider_key',
          consequence:
            'No mapping provider is configured (set REALYTICA_GOOGLE_MAPS_API_KEY). The site is not pinned and nothing nearby is listed.',
        },
      ],
    };
  }

  if (!query) {
    return {
      provider: provider.id,
      configured: true,
      query,
      amenities: [],
      gaps: [
        {
          code: 'no_address_on_file',
          consequence: 'The project has no address, location or city to geocode.',
        },
      ],
    };
  }

  const cityKey = project.city.trim().toLowerCase();
  const geocoded = await provider.geocode({
    query,
    biasTo: CITY_BIAS[cityKey],
    regionCode: REGION_FOR_CITY[cityKey],
  });

  if (!geocoded.ok) {
    return {
      provider: provider.id,
      configured: true,
      query,
      amenities: [],
      gaps: [{ code: geocoded.gap.code, consequence: geocoded.gap.consequence }],
    };
  }

  const point = geocoded.value.point;
  const amenities: ChatPlacesAmenity[] = [];
  const amenityPoints: GeoPoint[] = [];
  const gaps: ChatPlacesPull['gaps'] = [];

  for (const kind of wanted) {
    const spec = nearbyQueryFor(kind);
    const found = await provider.nearby({
      around: point,
      kind,
      radiusMetres: spec?.radiusMetres ?? 5000,
      limit: spec?.limit ?? 3,
    });
    if (!found.ok) {
      if (!found.gap.code.startsWith('nearby_kind_unsupported')) {
        gaps.push({ code: found.gap.code, consequence: found.gap.consequence });
      }
      continue;
    }
    for (const place of found.value) {
      amenities.push({
        kind,
        name: place.name,
        metres: Math.round(haversineMetres(point, place.point)),
      });
      amenityPoints.push(place.point);
    }
  }

  if (amenityPoints.length) {
    const routed = await provider.route({ from: point, to: amenityPoints });
    if (routed.ok) {
      for (const leg of routed.value) {
        const row = amenities[leg.toIndex];
        if (!row) continue;
        row.drivingMetres = leg.metres;
        row.drivingSeconds = leg.seconds;
      }
    } else {
      gaps.push({ code: routed.gap.code, consequence: routed.gap.consequence });
    }
  }

  let streetView: ChatPlacesPull['streetView'];
  const pano = await provider.findStreetView({ near: point, radiusMetres: 60 });
  if (!pano.ok) {
    gaps.push({ code: pano.gap.code, consequence: pano.gap.consequence });
  } else if (pano.value) {
    streetView = {
      capturedAt: pano.value.capturedAt,
      offsetMetres: Math.round(haversineMetres(pano.value.point, point)),
    };
  } else {
    gaps.push({
      code: 'streetview_no_coverage',
      consequence: 'There is no dated street-level photograph within 60 m of this pin.',
    });
  }

  return {
    provider: provider.id,
    configured: true,
    query,
    resolvedAddress: geocoded.value.resolvedAddress,
    precision: geocoded.value.precision,
    caveat: caveatFor(geocoded.value.precision, geocoded.value.resolvedAddress),
    point: point,
    amenities,
    streetView,
    gaps,
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return undefined;
  }
}

function localitySearchTopic(question: string): string {
  if (/\brera\b/i.test(question)) return 'K-RERA public project registration listings in this locality';
  if (/\bmarket|comps?|price|yield\b/i.test(question)) return 'residential real estate market signal for this locality';
  if (/\bnews|developer\b/i.test(question)) return 'public news about this development corridor';
  return 'public real estate context for this locality';
}

export async function pullWebForProject(project: DdProject, question: string): Promise<ChatWebPull> {
  const topic = localitySearchTopic(question);
  const query = `${topic} — ${project.location}, ${project.city}`;
  const { provider, route, descriptor } = resolveRoute('market_research');
  const capability = agentCapability();

  if (capabilityBlocksRoute(route, capability)) {
    return { enabled: false, query, hits: [], note: `Web search is unavailable (${capability.reason}) — no model endpoint is configured.` };
  }
  if (!capability.webSearchEnabled) {
    return {
      enabled: false,
      query,
      hits: [],
      note: 'Web search is disabled (set REALYTICA_AGENT_WEB_SEARCH=1). Chat will not silently scrape the public web instead.',
    };
  }
  if (!descriptor.capabilities.serverWebSearch) {
    return {
      enabled: false,
      query,
      hits: [],
      note: 'This route does not host server web search. Research was skipped rather than inventing sources.',
    };
  }
  if (!descriptor.configured) {
    return { enabled: false, query, hits: [], note: 'No model credentials are configured for web search.' };
  }

  const tools: LlmServerTool[] = [
    { kind: 'server', name: 'web_search', gap: 'server_web_search_unavailable', native: createWebSearchTool(3) },
    { kind: 'server', name: 'web_fetch', gap: 'server_web_search_unavailable', native: createWebFetchTool(2) },
  ];

  try {
    const result = await provider.runTools({
      agent: 'market_research',
      model: route.model,
      maxTokens: 2500,
      system: [
        {
          text:
            'You search the public web for locality-level real estate context. You are given city, locality and property type only — never an address, owner, survey number or document. Do not try government portals behind login or CAPTCHA (Kaveri, Bhoomi, BBMP). Return a JSON array of up to 4 objects: { "title", "claim", "url", "sourceTitle" }. Every claim needs a url you actually saw. If you cannot corroborate, return [].',
        },
      ],
      tools,
      messages: [
        {
          role: 'user',
          content: `Locality terms (this is all you are given):\n${JSON.stringify({
            city: project.city,
            locality: project.location,
            type: project.type,
            stage: project.currentStage,
            topic,
          })}`,
        },
      ],
    });
    const parsed = extractJson(textOf(result));
    const hits: ChatWebHit[] = [];
    if (Array.isArray(parsed)) {
      for (const row of parsed.slice(0, 4)) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const title = typeof rec.title === 'string' ? rec.title : undefined;
        const claim = typeof rec.claim === 'string' ? rec.claim : undefined;
        if (!title || !claim) continue;
        hits.push({
          title,
          claim,
          url: typeof rec.url === 'string' ? rec.url : undefined,
          sourceTitle: typeof rec.sourceTitle === 'string' ? rec.sourceTitle : undefined,
        });
      }
    }
    return {
      enabled: true,
      query,
      hits,
      note: hits.length ? undefined : 'Search ran but returned no structured, sourced hits to propose.',
    };
  } catch (err) {
    return { enabled: false, query, hits: [], note: describeError(err) };
  }
}

export async function pullPinForProject(project: DdProject): Promise<ChatPlacesPull> {
  const provider = placeProviderFor();
  const query = geocodeQuery(project);
  if (!provider.configured) {
    return {
      provider: provider.id,
      configured: false,
      query,
      amenities: [],
      gaps: [
        {
          code: 'no_provider_key',
          consequence:
            'No mapping provider is configured (set REALYTICA_GOOGLE_MAPS_API_KEY). The overlay has no pin — it still names the kept plan and the obtain route.',
        },
      ],
    };
  }
  if (!query) {
    return {
      provider: provider.id,
      configured: true,
      query,
      amenities: [],
      gaps: [{ code: 'no_address_on_file', consequence: 'The project has no address, location or city to geocode.' }],
    };
  }
  const cityKey = project.city.trim().toLowerCase();
  const geocoded = await provider.geocode({
    query,
    biasTo: CITY_BIAS[cityKey],
    regionCode: REGION_FOR_CITY[cityKey],
  });
  if (!geocoded.ok) {
    return {
      provider: provider.id,
      configured: true,
      query,
      amenities: [],
      gaps: [{ code: geocoded.gap.code, consequence: geocoded.gap.consequence }],
    };
  }
  return {
    provider: provider.id,
    configured: true,
    query,
    resolvedAddress: geocoded.value.resolvedAddress,
    precision: geocoded.value.precision,
    caveat: caveatFor(geocoded.value.precision, geocoded.value.resolvedAddress),
    point: geocoded.value.point,
    amenities: [],
    gaps: [],
  };
}

export async function gatherChatSides(project: DdProject, question: string): Promise<ChatSideBundle | undefined> {
  const intents = detectChatSideIntents(question);
  if (!intents.some((i) => i.kind === 'places' || i.kind === 'web_search' || i.kind === 'planning')) return undefined;
  const bundle: ChatSideBundle = {};
  const places = intents.find((i) => i.kind === 'places');
  const planning = intents.find((i) => i.kind === 'planning');
  const web = intents.find((i) => i.kind === 'web_search');
  if (places) bundle.places = await pullPlacesForProject(project, places.keys);
  else if (planning) bundle.places = await pullPinForProject(project);
  if (web) bundle.web = await pullWebForProject(project, question);
  return bundle;
}
