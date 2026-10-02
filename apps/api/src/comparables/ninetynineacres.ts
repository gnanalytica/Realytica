/**
 * 99acres. Results are server-rendered into `window.__initialData__`:
 *
 *   srp.pageData.properties     — the rows
 *   srp.pageData.search_params  — what 99acres actually searched, which is how
 *                                 a silent widening to the whole city is caught
 *
 * Rows mix builder project cards (camelCase, no SPID) with resale listings
 * (SCREAMING_SNAKE, SPID present). The cards are flagged and dropped.
 *
 * Ported from Valytica, verified there against live pages; the notes on each
 * field say what went wrong before the rule existed.
 */

import { parseAreaSqm, type ComparableAreaBasis, type ComparableQuery, type RawListing } from '@realytica/shared';
import { AllVendorsUnavailable, unblockedFetch } from './unblocker';
import { extractAssignedObject, localityCityPairs, num, slugify, str, type AdapterOpts, type LocalityCityPair } from './ladder';

const ORIGIN = 'https://www.99acres.com';

type Row = Record<string, unknown>;

interface PageData {
  properties: Row[];
  localityIds: string[];
  cityId: string | null;
}

function get(row: unknown, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function readPageData(html: string): PageData | null {
  const pd = get(extractAssignedObject(html, /window\.__initialData__\s*=/), 'srp.pageData') as Record<string, unknown> | undefined;
  if (!pd || typeof pd !== 'object' || !Array.isArray(pd.properties)) return null;
  const sp = (pd.search_params ?? {}) as Record<string, unknown>;
  const rawLocality = sp.localityID;
  const localityIds = Array.isArray(rawLocality) ? rawLocality.map(str).filter((v): v is string => !!v) : [];
  const rawCity = sp.cityID;
  const cityId = Array.isArray(rawCity) ? str(rawCity[0]) : str(rawCity);
  return { properties: pd.properties as Row[], localityIds, cityId };
}

/*
 * Bangalore is split into zones, and the plain city slug 404s for every
 * locality in it: "property-in-koramangala-bangalore-ffid" is a 404 while
 * "...-bangalore-south-ffid" resolves. All five zones are tried; a wrong one
 * is one fast 404.
 */
const CITY_ZONES: Record<string, string[]> = {
  bangalore: ['bangalore-south', 'bangalore-north', 'bangalore-east', 'bangalore-west', 'bangalore-central'],
  bengaluru: ['bangalore-south', 'bangalore-north', 'bangalore-east', 'bangalore-west', 'bangalore-central'],
};

export function seoUrlsFor(pair: LocalityCityPair): string[] {
  if (pair.cityLevel) return [`${ORIGIN}/property-in-${slugify(pair.city)}-ffid`];
  const zones = CITY_ZONES[slugify(pair.city)];
  if (zones) return zones.map((z) => `${ORIGIN}/property-in-${slugify(pair.locality)}-${z}-ffid`);
  return [`${ORIGIN}/property-in-${slugify(pair.locality)}-${slugify(pair.city)}-ffid`];
}

/* A backstop on paid requests: zone fan-out multiplies URLs per pair. */
const MAX_SEO_FETCHES = 12;

function searchUrl(cityId: string, localityIds: string[], resCom: 'R' | 'C', slug: string, page: number): string {
  const params = new URLSearchParams({ city: cityId, locality: localityIds.join(','), preference: 'S', res_com: resCom });
  if (page > 1) params.set('page', String(page));
  return `${ORIGIN}/search/property/buy/${slug}?${params.toString()}`;
}

/* Which measure a row quotes; only that one area field is populated. */
const AREA_BASIS_BY_TYPE: Record<string, ComparableAreaBasis> = {
  CARPET_AREA: 'carpet',
  BUILTUP_AREA: 'builtup',
  SUPERBUILTUP_AREA: 'super_builtup',
  SUPER_AREA: 'super_builtup',
  PLOT_AREA: 'plot',
  LAND_AREA: 'plot',
};

/*
 * LOCALIZED_AREA_VALUE leads: present on every row and already parsed.
 * Deliberately NOT MIN_AREA_SQFT — despite the name it carries square metres,
 * and reading it made areas ten times too small and rates ten times too high.
 */
function rowAreaSqm(row: Row): number | null {
  const localized = num(row.LOCALIZED_AREA_VALUE);
  if (localized != null && localized > 0) return parseAreaSqm(localized, str(row.LOCALIZED_AREA_UNIT_LABEL) ?? 'sqft');
  for (const [field, unitField] of [
    ['SUPER_AREA', 'SUPERAREA_UNIT'],
    ['SUPERBUILTUP_AREA', 'SUPERBUILTUPAREA_UNIT'],
    ['BUILTUP_AREA', 'BUILTUPAREA_UNIT'],
    ['CARPET_AREA', 'CARPETAREA_UNIT'],
  ] as const) {
    const raw = num(row[field]);
    if (raw != null && raw > 0) return parseAreaSqm(raw, str(row[unitField]) ?? 'sq.ft.');
  }
  const formatted = str(row.AREA);
  return formatted ? parseAreaSqm(formatted) : null;
}

/* MIN_PRICE and MAX_PRICE are already rupees. */
function rowPrice(row: Row): number | null {
  const min = num(row.MIN_PRICE);
  const max = num(row.MAX_PRICE);
  if (min != null && max != null && max > 0) return (min + max) / 2;
  return min ?? max ?? num(get(row, 'FORMATTED.AVG_PRICE'));
}

export function mapRow(row: Row): RawListing | null {
  if (str(row.entityType) === 'PROJECT' || !str(row.SPID)) {
    const projectUrl = str(get(row, 'landingPage.url'));
    if (!projectUrl) return null;
    return { source: '99acres', sourceUrl: projectUrl, title: str(row.heading) ?? 'Project', point: null, price: null, areaSqm: null, areaBasis: null, bhk: null, subtype: null, listedOn: null, isProjectAd: true };
  }
  const pdUrl = str(row.PD_URL);
  const spid = str(row.SPID)!;
  const sourceUrl = pdUrl ? `${ORIGIN}${pdUrl.startsWith('/') ? '' : '/'}${pdUrl}` : `${ORIGIN}/${spid}`;
  const propertyType = str(row.PROPERTY_TYPE) ?? str(get(row, 'FORMATTED.PROP_TYPE_LABEL'));
  const isLand = /plot|land/i.test(propertyType ?? '');
  const mapped = str(get(row, 'MAP_DETAILS.MAPPED')) === 'Y';
  const lat = mapped ? num(get(row, 'MAP_DETAILS.LATITUDE')) : null;
  const lng = mapped ? num(get(row, 'MAP_DETAILS.LONGITUDE')) : null;
  const posted = num(row.POSTING_DATE);
  const listedOn = posted && posted > 0 && !Number.isNaN(new Date(posted).getTime()) ? new Date(posted).toISOString().slice(0, 10) : null;
  const type = str(row.AREA_TYPE) ?? str(row.PER_UNIT_AREA_TYPE);
  return {
    source: '99acres',
    sourceUrl,
    title: str(row.ALT_TAG) ?? [propertyType, str(row.localityLabel)].filter(Boolean).join(' · '),
    point: lat != null && lng != null ? { lat, lng } : null,
    price: rowPrice(row),
    areaSqm: rowAreaSqm(row),
    areaBasis: isLand ? 'plot' : type ? (AREA_BASIS_BY_TYPE[type.toUpperCase()] ?? null) : null,
    bhk: isLand ? null : num(row.BEDROOM_NUM),
    subtype: propertyType,
    listedOn,
    isProjectAd: false,
  };
}

async function fetchPage(url: string): Promise<PageData | null> {
  try {
    const { status, body } = await unblockedFetch(url);
    if (status < 200 || status >= 300 || !body) return null;
    return readPageData(body);
  } catch (err) {
    // A vendor outage is not a 404: it marks the portal errored rather than empty.
    if (err instanceof AllVendorsUnavailable) throw err;
    return null;
  }
}

/** Up to `maxPages` of 99acres results near the subject. Never widens to the whole city to salvage a result. */
export async function fetch99Acres(query: ComparableQuery, maxPages = 2, opts: AdapterOpts = {}): Promise<RawListing[]> {
  const pairs = localityCityPairs(query);
  const attempts: Array<{ pair: LocalityCityPair; url: string }> = [];
  for (const pair of pairs) for (const url of seoUrlsFor(pair)) if (attempts.length < MAX_SEO_FETCHES) attempts.push({ pair, url });
  const resolved = (
    await Promise.all(
      attempts.map(async ({ pair, url }) => {
        const page = await fetchPage(url);
        if (!page || !page.cityId) return null;
        // An unresolved locality comes back as a city-wide page, not an error: a miss.
        if (!pair.cityLevel && !page.localityIds.length) return null;
        return { page, pair };
      }),
    )
  ).filter((r): r is NonNullable<typeof r> => r != null);
  opts.onPagesResolved?.(resolved.length);

  const out: RawListing[] = [];
  const seen = new Set<string>();
  let deepest: (typeof resolved)[number] | null = null;
  for (const r of resolved) {
    const key = r.page.localityIds.length ? r.page.localityIds.join(',') : `city:${r.page.cityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const row of r.page.properties) {
      const listing = mapRow(row);
      if (!listing) continue;
      // A town's page spans the town: only rows the radius can check come in from one.
      if (r.pair.cityLevel && !listing.isProjectAd && !listing.point) continue;
      out.push(listing);
    }
    if (!r.pair.cityLevel) deepest = r;
  }
  if (!deepest) return out;
  const resCom = query.subclass === 'commercial_plot' || query.subclass === 'commercial_building' ? 'C' : 'R';
  for (let page = 2; page <= maxPages; page++) {
    const next = await fetchPage(searchUrl(deepest.page.cityId!, deepest.page.localityIds, resCom, slugify(deepest.pair.locality), page));
    if (!next || !next.properties.length || !next.localityIds.length) break;
    for (const row of next.properties) {
      const listing = mapRow(row);
      if (listing) out.push(listing);
    }
  }
  return out;
}
