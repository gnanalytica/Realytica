/**
 * Pin vs kept master plan — a planning overlay that does not pretend to be GIS.
 *
 * RMP 2015 is still the plan in force; map sheets are not a per-parcel API.
 * This read uses the locality pack, the geocoded pin, and what is already on
 * this file. It never intersects a polygon with a sheet, and it never files
 * a circular or a pack note as the master-plan extract.
 */

import { DD_CONNECTORS } from '../dd-connectors';
import { matchProjectLocality } from './capabilities';
import { portalForCheck } from './portals';
import { sittingCheckOf, type SittingRef } from './sitting';
import type { ChatPlacesPull, DdProject } from './types';
import type { GeoPoint, SiteLocation } from '../types';

const PLAN_IN_FORCE = {
  id: 'ref_rmp_2015',
  title: 'Revised Master Plan 2015 for Bengaluru (as extended)',
  issuer: 'Bangalore Development Authority',
  asOf: '2015-01-01',
  url: 'https://kbda.karnataka.gov.in',
  note:
    'RMP 2015 remains the plan in force until a successor is notified. The RMP-2031 draft was withdrawn. GBA (core) and BDA (periphery) successor plans are being drafted, not the law. Sheets are published as maps and zoning regulations — not a queryable parcel layer.',
};

export interface PlanningOverlayPin {
  lat: number;
  lng: number;
  precision?: string;
  resolvedAddress?: string;
  caveat: string;
  query?: string;
  source: 'site_context' | 'places' | 'none';
}

export interface PlanningOverlayFlag {
  code: 'not_geometry' | 'plan_in_force' | 'no_pin' | 'missing_extract' | 'missing_certificate' | 'conversion' | 'pack_not_sheet';
  severity: 'info' | 'flag';
  text: string;
}

export interface PlanningOverlayRead {
  notGeometry: true;
  notEvidence: true;
  inForce: typeof PLAN_IN_FORCE;
  pin: PlanningOverlayPin | null;
  locality?: {
    id: string;
    locality: string;
    city: string;
    zoning: string;
    farAllowed: number;
    permittedUses: string[];
    planningNote: string;
  };
  thisFile: {
    checkId?: string;
    checkTitle?: string;
    checkResult?: string;
    hasMasterPlanExtract: boolean;
    hasZoningCertificate: boolean;
    conversionFindingIds: string[];
  };
  flags: PlanningOverlayFlag[];
}

function heldEvidence(project: DdProject, test: RegExp): boolean {
  return project.evidence.some(
    (e) =>
      test.test(e.title)
      && (e.status === 'received' || e.status === 'validated' || e.status === 'used'),
  );
}

export function landUseSittingOf(project: DdProject, prefer?: SittingRef) {
  const seated = sittingCheckOf(project, prefer);
  if (seated && (seated.check.definitionId.endsWith('land_use') || portalForCheck(seated.check)?.key === 'bda_rmp')) {
    return seated;
  }
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (check.definitionId.endsWith('land_use') || portalForCheck(check)?.key === 'bda_rmp') {
          return { assessment, scope, check };
        }
      }
    }
  }
  return seated;
}

export function planningPinOf(
  project: DdProject,
  places?: ChatPlacesPull,
): PlanningOverlayPin | null {
  const loc = project.siteContext?.location as SiteLocation | undefined;
  if (loc?.point) {
    return {
      lat: loc.point.lat,
      lng: loc.point.lng,
      precision: loc.precision,
      resolvedAddress: loc.resolvedAddress,
      caveat: loc.caveat,
      query: loc.queried,
      source: 'site_context',
    };
  }
  const point = places?.point as GeoPoint | undefined;
  if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
    return {
      lat: point.lat,
      lng: point.lng,
      precision: places?.precision,
      resolvedAddress: places?.resolvedAddress,
      caveat: places?.caveat || 'Geocoded pin for the overlay — not a surveyed parcel boundary.',
      query: places?.query,
      source: 'places',
    };
  }
  return null;
}

export function compareProjectPlanning(
  project: DdProject,
  extra?: { sitting?: SittingRef; places?: ChatPlacesPull },
): PlanningOverlayRead {
  const seated = landUseSittingOf(project, extra?.sitting);
  const locality = matchProjectLocality(project);
  const pin = planningPinOf(project, extra?.places);
  const conversionFindingIds = project.findings
    .filter((f) => f.status !== 'closed' && f.status !== 'rejected' && /convert|agricultur|s\.?\s*95|land use|zoning/i.test(`${f.title} ${f.description}`))
    .map((f) => f.id);
  const hasMasterPlanExtract = heldEvidence(project, /master plan/i);
  const hasZoningCertificate = heldEvidence(project, /zoning certificate|land-?use (certificate|confirmation)/i);

  const flags: PlanningOverlayFlag[] = [
    {
      code: 'not_geometry',
      severity: 'info',
      text: 'No geometric overlay: this product does not intersect a parcel polygon with RMP map sheets. A mouse-drawn shape is not a survey. A pin only says which sheet to open.',
    },
    {
      code: 'plan_in_force',
      severity: 'info',
      text: PLAN_IN_FORCE.note,
    },
    {
      code: 'pack_not_sheet',
      severity: 'info',
      text: 'The locality pack zoning string is a market dataset for this corridor. It is not the land-use hatch on the sheet for this survey number.',
    },
  ];

  if (!pin) {
    flags.push({
      code: 'no_pin',
      severity: 'flag',
      text: 'No geocoded pin on this project. Maps can place the address for which sheet to read; it still is not a boundary.',
    });
  }
  if (!hasMasterPlanExtract) {
    flags.push({
      code: 'missing_extract',
      severity: 'flag',
      text: 'Master plan extract is not held on this file. Obtain the RMP / LPA sheet covering the village (or a certified extract) and attach it on the land-use check.',
    });
  }
  if (!hasZoningCertificate) {
    flags.push({
      code: 'missing_certificate',
      severity: 'flag',
      text: 'No zoning / land-use certificate is on file. That is what a lender will ask for — not a corridor note.',
    });
  }
  if (conversionFindingIds.length || seated?.check.result === 'non_compliant' || /agricultur/i.test(seated?.check.comments ?? '')) {
    flags.push({
      code: 'conversion',
      severity: 'flag',
      text: 'This file already records an agricultural / conversion issue. A master-plan overlay does not cure s.95 conversion. File the sheet and the conversion order separately.',
    });
  }

  return {
    notGeometry: true,
    notEvidence: true,
    inForce: PLAN_IN_FORCE,
    pin,
    locality: locality
      ? {
          id: locality.id,
          locality: locality.locality,
          city: locality.city,
          zoning: locality.zoning,
          farAllowed: locality.farAllowed,
          permittedUses: locality.permittedUses,
          planningNote: locality.planningNote,
        }
      : undefined,
    thisFile: {
      checkId: seated?.check.id,
      checkTitle: seated?.check.title,
      checkResult: seated?.check.result,
      hasMasterPlanExtract,
      hasZoningCertificate,
      conversionFindingIds,
    },
    flags,
  };
}

export function serializePlanningOverlay(read: PlanningOverlayRead): string {
  const lines = [
    'PLANNING OVERLAY — pin vs the kept plan. Not a geometric intersection. Not this project\'s evidence until a person files the sheet or zoning certificate.',
    `In force: ${read.inForce.title} (${read.inForce.issuer}, asOf ${read.inForce.asOf}) ${read.inForce.url}`,
    read.inForce.note,
  ];
  if (read.pin) {
    const prec = read.pin.precision ? `, ${read.pin.precision}` : '';
    lines.push(
      `Pin: ${read.pin.lat.toFixed(5)}, ${read.pin.lng.toFixed(5)}${prec}${read.pin.resolvedAddress ? ` — ${read.pin.resolvedAddress}` : ''}. ${read.pin.caveat}`,
    );
  } else {
    lines.push('Pin: none on this file.');
  }
  if (read.locality) {
    lines.push(
      `Locality pack (${read.locality.locality}, ${read.locality.city}): zoning “${read.locality.zoning}”; FAR ${read.locality.farAllowed}; permitted ${read.locality.permittedUses.join(', ') || 'unlisted'}.`,
      read.locality.planningNote,
    );
  }
  const file = read.thisFile;
  lines.push(
    `This file: ${file.checkTitle ?? 'no land-use sitting'} (${file.checkResult ?? 'n/a'}). Master plan extract ${file.hasMasterPlanExtract ? 'held' : 'not held'}. Zoning certificate ${file.hasZoningCertificate ? 'held' : 'not held'}.`,
  );
  if (file.conversionFindingIds.length) {
    lines.push(`Conversion / land-use findings already on this file: ${file.conversionFindingIds.join(', ')}.`);
  }
  for (const flag of read.flags) {
    lines.push(`• [${flag.severity}] ${flag.text}`);
  }
  const portal = DD_CONNECTORS.find((c) => c.key === 'bda_rmp');
  if (portal) {
    lines.push(`Obtain: ${portal.label}${portal.url ? ` (${portal.url})` : ''}. ${portal.route} We do not scrape this portal.`);
  }
  lines.push(
    'The GIS context map on Overview can overlay OpenStreetMap water and landuse around the pin, and a supplied survey sketch if one is on file. That overlay is not a geometric intersection with the RMP sheet.',
  );
  return lines.join('\n');
}

export function wantsPlanningOverlay(question: string): boolean {
  const q = question.trim();
  return (
    /\b(master plan|town plan|rmp|land-?use (map|zone|zoning|overlay)|zoning (map|overlay|certificate|consistency)|planning overlay)\b/i.test(q)
    || /\b(compare|overlay|intersect|overlap).{0,40}\b(plan|zone|rmp|sheet)\b/i.test(q)
    || /\bwhat (zone|zoning|land use)\b/i.test(q)
    || /\b(plan sheet|rmp sheet)\b/i.test(q)
  );
}
