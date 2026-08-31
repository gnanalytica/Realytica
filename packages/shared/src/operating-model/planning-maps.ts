/**
 * Planning and civic map sources a Bengaluru sitting may open.
 *
 * Official viewers and WMS we may overlay. Commercial and withdrawn maps we
 * name so a person is not sent there as if they were the plan in force.
 * Nothing here is this file's evidence until a person files the extract.
 */

import { DD_CONNECTORS } from '../dd-connectors';
import { matchProjectLocality } from './capabilities';
import type { PlanningOverlayPin } from './planning-overlay';
import type { DdProject } from './types';

export type PlanningMapStanding =
  | 'official_viewer'
  | 'official_wms'
  | 'withdrawn'
  | 'commercial'
  | 'unofficial';

export type PlanningRealm = 'bbmp' | 'bmrda' | 'bda' | 'unknown';

export interface PlanningMapWms {
  url: string;
  layers: string;
  attribution: string;
}

export interface PlanningMapSource {
  key: string;
  label: string;
  issuer: string;
  url: string;
  standing: PlanningMapStanding;
  /** What this map actually shows. */
  shows: string;
  caveat: string;
  /** Overlay this live under the pin — never a commercial or withdrawn layer. */
  wms?: PlanningMapWms;
  connectorKey?: string;
}

/** Rough BBMP/GBA core — Harohalli / Kanakapura sit south of this. */
export const BBMP_PIN_BOUNDS = { south: 12.82, north: 13.16, west: 77.45, east: 77.78 };

export const PLANNING_MAP_SOURCES: PlanningMapSource[] = [
  {
    key: 'bbmp_gis',
    label: 'BBMP GIS viewer',
    issuer: 'Bruhat Bengaluru Mahanagara Palike',
    url: 'https://bbmp.gov.in/gisviewer/',
    standing: 'official_viewer',
    shows: 'Wards, corporation/zone boundaries, lakes and parks inside BBMP/GBA limits. Not RMP land use.',
    caveat: 'Civic geography for sites inside BBMP. It is not the BDA master-plan hatch and it does not cover Kanakapura / Harohalli.',
    connectorKey: 'bbmp_gis',
    wms: {
      url: 'https://gisapp.bbmpgov.in/arcgis/services/BBMP_services/BBMP_Services/MapServer/WMSServer',
      layers: '1,0',
      attribution: 'BBMP GIS (lakes, parks) — civic, not RMP',
    },
  },
  {
    key: 'bmrda_maps',
    label: 'BMRDA maps',
    issuer: 'Bangalore Metropolitan Region Development Authority',
    url: 'https://bmrda.karnataka.gov.in/10/maps/en',
    standing: 'official_viewer',
    shows: 'LPA / BMRDA published maps for the metropolitan region outside BBMP core — the right counter for Harohalli / Kanakapura.',
    caveat: 'Open the sheet covering this village. Still not a per-parcel API; file the extract on the land-use check.',
    connectorKey: 'bmrda_maps',
  },
  {
    key: 'bda_rmp',
    label: 'BDA / LPA master plan (plan in force)',
    issuer: 'Bangalore Development Authority',
    url: 'https://kbda.karnataka.gov.in',
    standing: 'official_viewer',
    shows: 'RMP 2015 as extended — land-use sheets and zoning regulations. Plan in force until a successor is notified.',
    caveat: 'Published as map sheets, not a queryable GIS layer. Do not treat DPPlans, GISMaps or the withdrawn RMP-2031 draft as this sheet.',
    connectorKey: 'bda_rmp',
  },
  {
    key: 'opencity_rmp_2015',
    label: 'RMP 2015 land-use sheets (OpenCity archive)',
    issuer: 'Bangalore Development Authority (civic archive)',
    url: 'https://data.opencity.in/dataset/bda-revised-master-plan-2015',
    standing: 'official_viewer',
    shows: 'Scanned RMP 2015 proposed land-use maps by planning district, plus zoning regulations. Plan in force, as PDFs — not a parcel API.',
    caveat: 'Open the planning district that covers this pin. Koramangala is PD 207 & 208. File that sheet or a zoning certificate on the land-use check; a screenshot is not the certificate.',
  },
  {
    key: 'dpplans_bengaluru',
    label: 'DPPlans Bengaluru DP overlay',
    issuer: 'DPPlans (commercial)',
    url: 'https://dpplans.com/bengaluru-dp-plan/',
    standing: 'commercial',
    shows: 'A paid third-party overlay they describe as RMP, including draft 2031 material, georeferenced on satellite. They state the download is not the planning authority’s sanctioned document.',
    caveat: 'Do not overlay, scrape or file this as the master-plan extract. High zoom is paywalled. Search the pin on their site if you want a second look; for a certified sheet, go to BDA / BMRDA / LPA.',
  },
  {
    key: 'gismaps_bbmp_ward',
    label: 'GISMaps.in BBMP ward map',
    issuer: 'GISMaps.in (third party)',
    url: 'https://www.gismaps.in/Karnataka%20Ward%20Maps/BBMP_WardMap_Karnataka.html',
    standing: 'unofficial',
    shows: 'An unofficial ward cartography site. Not BBMP GIS and not a land-use plan.',
    caveat: 'Do not treat this as the ward layer of record. This product overlays OpenCity’s GBA 2025 ward KML instead (civic context, not RMP).',
  },
  {
    key: 'opencity_rmp_2031',
    label: 'OpenCity archive — BDA RMP 2031 (withdrawn)',
    issuer: 'OpenCity / BDA draft (withdrawn)',
    url: 'https://data.opencity.in/dataset/bda-revised-master-plan-2031',
    standing: 'withdrawn',
    shows: 'Civic archive of the draft RMP 2031 PDFs (vision, zoning, land-use sheets). BDA withdrew that draft in 2020. RMP 2015 remains in force.',
    caveat: 'Never overlay or file as the plan in force. Useful only to see what was proposed and withdrawn.',
  },
];

export function pinLooksInsideBbmp(pin: { lat: number; lng: number } | null | undefined): boolean {
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return false;
  const b = BBMP_PIN_BOUNDS;
  return pin.lat >= b.south && pin.lat <= b.north && pin.lng >= b.west && pin.lng <= b.east;
}

export function planningRealmOf(project: DdProject, pin?: PlanningOverlayPin | null): PlanningRealm {
  const hay = [project.jurisdiction, project.location, project.city, project.siteAddress, project.name, matchProjectLocality(project)?.planningNote]
    .filter(Boolean)
    .join(' ');
  if (/\bbmrda\b|\bbiaapa\b|\bkanakapura\b|\bharohalli\b|\bramanagar|\bramnagar|\bgram panchayat\b/i.test(hay)) {
    return 'bmrda';
  }
  if (/\bbbmp\b|\bgba\b|\bgreater bengaluru\b/i.test(hay) || pinLooksInsideBbmp(pin)) {
    return 'bbmp';
  }
  if (/bengaluru|bangalore/i.test(hay)) return 'bda';
  return 'unknown';
}

function sourceByKey(key: string): PlanningMapSource | undefined {
  return PLANNING_MAP_SOURCES.find((s) => s.key === key);
}

/**
 * Maps this sitting should open. Commercial and withdrawn sources are never
 * selected for overlay; they stay in the catalogue so we can refuse them.
 */
export function planningMapsFor(
  project: DdProject,
  pin?: PlanningOverlayPin | null,
): { realm: PlanningRealm; sittings: PlanningMapSource[]; liveOverlays: PlanningMapSource[]; refused: PlanningMapSource[] } {
  const realm = planningRealmOf(project, pin);
  const sittings: PlanningMapSource[] = [];
  const liveOverlays: PlanningMapSource[] = [];

  const rmp = sourceByKey('bda_rmp');
  if (rmp) sittings.push(rmp);

  if (realm === 'bmrda') {
    const bmrda = sourceByKey('bmrda_maps');
    if (bmrda) sittings.push(bmrda);
  } else if (realm === 'bbmp') {
    const sheets = sourceByKey('opencity_rmp_2015');
    if (sheets) sittings.push(sheets);
    const bbmp = sourceByKey('bbmp_gis');
    if (bbmp) {
      sittings.push(bbmp);
      if (bbmp.wms && pinLooksInsideBbmp(pin)) liveOverlays.push(bbmp);
    }
  } else {
    const sheets = sourceByKey('opencity_rmp_2015');
    if (sheets) sittings.push(sheets);
    const bbmp = sourceByKey('bbmp_gis');
    const bmrda = sourceByKey('bmrda_maps');
    if (bbmp) sittings.push(bbmp);
    if (bmrda) sittings.push(bmrda);
    if (bbmp?.wms && pinLooksInsideBbmp(pin)) liveOverlays.push(bbmp);
  }

  const refused = PLANNING_MAP_SOURCES.filter((s) => s.standing === 'commercial' || s.standing === 'unofficial' || s.standing === 'withdrawn');
  return { realm, sittings, liveOverlays, refused };
}

export function connectorForMapSource(source: PlanningMapSource) {
  if (!source.connectorKey) return undefined;
  return DD_CONNECTORS.find((c) => c.key === source.connectorKey);
}
