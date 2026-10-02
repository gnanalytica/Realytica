/**
 * MagicBricks. Results are server-rendered into `window.SERVER_PRELOADED_STATE_`:
 *
 *   searchResult  — the rows, thirty a page
 *   searchBean    — what MagicBricks actually searched; an empty `locality`
 *                   means it widened to the whole city, which is a miss
 *
 * Builder marketing lives in a branch never read here. `caCompNameD` is the
 * poster's own name and is never mapped, stored or passed on.
 *
 * Ported from Valytica, verified there against live pages.
 */

import { parseAreaSqm, toSqm, type ComparableAreaBasis, type ComparableAreaUnit, type ComparableQuery, type RawListing } from '@realytica/shared';
import { AllVendorsUnavailable, unblockedFetch } from './unblocker';
import { extractAssignedObject, localityCityPairs, num, slugify, str, type AdapterOpts } from './ladder';

const ORIGIN = 'https://www.magicbricks.com';

type Row = Record<string, unknown>;

interface PageData {
  rows: Row[];
  localityIds: string[];
  cityId: string | null;
}

export function readPageData(html: string): PageData | null {
  const state = extractAssignedObject(html, /window\.SERVER_PRELOADED_STATE_\s*=/) as Record<string, unknown> | null;
  if (!state || typeof state !== 'object' || !Array.isArray(state.searchResult)) return null;
  const bean = (state.searchBean ?? {}) as Record<string, unknown>;
  const raw = bean.locality;
  const localityIds = Array.isArray(raw) ? raw.map(str).filter((v): v is string => !!v) : [str(raw)].filter((v): v is string => !!v);
  return { rows: state.searchResult as Row[], localityIds, cityId: str(bean.city) };
}

function isLand(subclass: ComparableQuery['subclass']): boolean {
  return subclass === 'residential_plot' || subclass === 'commercial_plot' || subclass === 'agricultural';
}

/*
 * The SEO listing URLs are property-type specific, probed one by one: the old
 * land slug 404'd on every locality, which failed safe and looked like a
 * portal with no plots. The grammar is not uniform — only flats put the kind
 * before the place.
 */
const KIND: Record<ComparableQuery['subclass'], string> = {
  residential_flat: 'flats',
  independent_house: 'independent-house',
  residential_plot: 'residential-plots-land',
  agricultural: 'residential-plots-land',
  commercial_plot: 'commercial-land',
  commercial_building: 'commercial-property',
};

export function seoUrl(locality: string, city: string, subclass: ComparableQuery['subclass'], cityLevel = false): string {
  const kind = KIND[subclass];
  const where = cityLevel ? slugify(city) : `${slugify(locality)}-${slugify(city)}`;
  return kind === 'flats' ? `${ORIGIN}/flats-in-${where}-for-sale-pppfs` : `${ORIGIN}/${kind}-for-sale-in-${where}-pppfs`;
}

/*
 * A plot row carries no area field: the extent is in the URL slug
 * ("500-Sq-yrd-Residential-Plot-…"), and otherwise only in price over the
 * portal's own per-sq-ft rate. `landAreaUnitD` is NOT the area's unit — it is
 * the rate's — and trusting it understated a 500 sq yd plot ninefold.
 */
const SLUG_AREA = /^(\d+(?:\.\d+)?)-(sq-yrd|sq-ft|sq-m|acre|cent)s?\b/i;
const SLUG_UNIT: Record<string, ComparableAreaUnit> = { 'sq-yrd': 'sqyd', 'sq-ft': 'sqft', 'sq-m': 'sqm', acre: 'acres', cent: 'cents' };

function plotAreaSqm(row: Row): number | null {
  const m = str(row.url)?.match(SLUG_AREA);
  if (m) {
    const unit = SLUG_UNIT[m[2]!.toLowerCase()];
    if (unit) return toSqm(Number(m[1]), unit);
  }
  const price = num(row.price);
  const rate = num(row.sqFtPrice);
  return price != null && rate != null && rate > 0 ? toSqm(Math.round(price / rate), 'sqft') : null;
}

function rowArea(row: Row, subclass: ComparableQuery['subclass']): { sqm: number | null; basis: ComparableAreaBasis | null } {
  if (isLand(subclass)) return { sqm: plotAreaSqm(row), basis: 'plot' };
  // `caSqFt` is the area the portal's own rate is on: price ÷ caSqFt is sqFtPrice exactly.
  const cover = num(row.caSqFt) ?? num(row.ca);
  if (cover != null && cover > 0) return { sqm: parseAreaSqm(cover, str(row.coverAreaUnitD) ?? 'sqft'), basis: 'super_builtup' };
  const carpet = num(row.carpetArea);
  if (carpet != null && carpet > 0) return { sqm: parseAreaSqm(carpet, str(row.carpAreaUnit) ?? 'sqft'), basis: 'carpet' };
  const plot = plotAreaSqm(row);
  return { sqm: plot, basis: plot != null ? 'plot' : null };
}

function rowPrice(row: Row): number | null {
  const price = num(row.price);
  if (price != null && price > 0) return price;
  const min = num(row.minPrice);
  const max = num(row.maxPrice);
  if (min != null && max != null && max > 0) return (min + max) / 2;
  return min ?? max;
}

/* pmtLat/pmtLong read 0, not absent, on an unpinned row; (0,0) is in the Atlantic. */
function rowPoint(row: Row): { lat: number; lng: number } | null {
  const lat = num(row.pmtLat);
  const lng = num(row.pmtLong);
  if (lat && lng) return { lat, lng };
  const parts = str(row.ltcoordGeo)?.split(',') ?? [];
  if (parts.length === 2) {
    const glat = num(parts[0]);
    const glng = num(parts[1]);
    if (glat && glng) return { lat: glat, lng: glng };
  }
  return null;
}

function rowListedOn(row: Row): string | null {
  const iso = str(row.postDateT);
  if (iso && Number.isFinite(Date.parse(iso))) return new Date(Date.parse(iso)).toISOString().slice(0, 10);
  const epoch = num(row.pd);
  return epoch && epoch > 0 ? new Date(epoch).toISOString().slice(0, 10) : null;
}

export function mapRow(row: Row, subclass: ComparableQuery['subclass']): RawListing | null {
  const path = str(row.url);
  const id = str(row.id) ?? str(row.encId);
  if (!path && !id) return null;
  const land = isLand(subclass);
  // The bedroom count is only reliable in the URL slug: "3-BHK-1575-…".
  const bhkMatch = path?.match(/(?:^|\/)(\d+)-BHK/i);
  const bhk = land || !bhkMatch ? null : Number(bhkMatch[1]);
  const locality = str(row.locSeoName) ?? str(row.lmtDName);
  const { sqm, basis } = rowArea(row, subclass);
  return {
    source: 'magicbricks',
    sourceUrl: path ? `${ORIGIN}/propertyDetails/${path}` : `${ORIGIN}/propertyDetails/?id=${id}`,
    // From structured fields, not the marketing paragraph that can name the poster.
    title: [bhk ? `${bhk} BHK` : land ? 'Plot' : 'Property', locality].filter(Boolean).join(' · '),
    point: rowPoint(row),
    price: rowPrice(row),
    areaSqm: sqm,
    areaBasis: land ? 'plot' : basis,
    bhk,
    subtype: land ? 'Residential Land' : bhk ? `${bhk} BHK` : null,
    listedOn: rowListedOn(row),
    isProjectAd: false,
  };
}

async function fetchPage(url: string): Promise<PageData | null> {
  try {
    const { status, body } = await unblockedFetch(url);
    if (status < 200 || status >= 300 || !body) return null;
    return readPageData(body);
  } catch (err) {
    if (err instanceof AllVendorsUnavailable) throw err;
    return null;
  }
}

/** One page of MagicBricks results near the subject. An unresolved locality is a miss, never the whole city. */
export async function fetchMagicBricks(query: ComparableQuery, opts: AdapterOpts = {}): Promise<RawListing[]> {
  const pairs = localityCityPairs(query);
  const settled = await Promise.all(
    pairs.map(async (pair) => {
      const page = await fetchPage(seoUrl(pair.locality, pair.city, query.subclass, pair.cityLevel));
      if (!page) return null;
      if (!pair.cityLevel && !page.localityIds.length) return null;
      if (pair.cityLevel && !page.cityId) return null;
      return { page, cityLevel: !!pair.cityLevel };
    }),
  );
  opts.onPagesResolved?.(settled.filter(Boolean).length);
  const out: RawListing[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (!r) continue;
    const key = r.page.localityIds.length ? r.page.localityIds.join(',') : `city:${r.page.cityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const row of r.page.rows) {
      const listing = mapRow(row, query.subclass);
      if (!listing) continue;
      if (r.cityLevel && !listing.point) continue;
      out.push(listing);
    }
  }
  return out;
}
