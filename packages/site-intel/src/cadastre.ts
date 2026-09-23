// The survey-number map, made pure.
//
// Telangana publishes its ULB cadastre as an ArcGIS layer whose rows are one
// parcel each: survey number (`Parcel_num`), the village/mandal/district it
// sits in, the land classification, and — where the parcel is on the Section
// 22-A register — the prohibitory category. That is enough to let someone pick
// their own plot by survey number instead of dropping a pin and hoping.
//
// Everything here is string and geometry work with no network, so the query
// building, the number sorting and the attribute shaping are all testable
// offline. The fetching lives in `parcels.ts`.

import type { LatLng } from "./geo/measure";
import { polygonAreaSqMeters } from "./geo/measure";
import type { Ring } from "./geometry";
import { ringsCentroid } from "./geometry";
import { TGRAC_ROOT } from "./layers";
import type { StateKey } from "./states";

/**
 * Telangana publishes its parcel map as two disjoint layers, and neither alone
 * is "the cadastre".
 *
 * `ulb` is the municipal one: 244k parcels across the ten pre-2016 districts,
 * and the only one joined to the Section 22-A prohibited-property register.
 * `rural` is the 30 cm survey: 910k parcels across seven of the southern
 * districts, with no register join.
 *
 * Together they cover about 1.15 million survey numbers. Neither covers the
 * whole state, which is the coverage limit users have to be told about rather
 * than left to infer from an empty result.
 */
export type CadastreSourceKey = "ulb" | "rural" | "kgis";

/** The Telangana layers `acrossSources` spans. Karnataka's `kgis` is read by its own module. */
export type TelanganaSourceKey = "ulb" | "rural";

export type CadastreSource = {
  key: TelanganaSourceKey;
  label: string;
  path: string;
  source: string;
  /** Column names, which differ between the two layers. */
  fields: {
    id: string;
    parcelNo: string;
    village: string;
    mandal: string;
    district: string;
    classification: string | null;
    prohibited: string | null;
    extent: string | null;
    remarks: string | null;
  };
};

export const CADASTRE_SOURCES: CadastreSource[] = [
  {
    key: "ulb",
    label: "Municipal cadastre",
    path: "Bhunaksha/Bhunaksha/MapServer/0",
    source: "Telangana GIS — Bhunaksha ULB cadastre (Section 22-A register joined)",
    fields: {
      id: "OBJECTID_12",
      parcelNo: "Parcel_num",
      village: "V_Name",
      mandal: "M_Name",
      district: "D_Name",
      classification: "Classification_code",
      prohibited: "CATEGORY_OF_PROHIBITORY_LAND",
      extent: "EXTENT",
      remarks: "Remarks",
    },
  },
  {
    key: "rural",
    label: "Rural 30 cm survey",
    path: "Bhunaksha/Bhunaksha/MapServer/3",
    source: "Telangana GIS — Bhunaksha rural cadastre (30 cm survey)",
    fields: {
      id: "OBJECTID",
      parcelNo: "Base_Syno",
      village: "Village",
      mandal: "Mandal",
      district: "District",
      // `LandUse_Fr` is the nearest thing to a classification, but most of its
      // 585 distinct values are bare survey numbers rather than a land use, so
      // it is not read as one. `Descriptio` says only whether the parcel was
      // surveyed, which is worth showing.
      classification: "Descriptio",
      prohibited: null,
      extent: null,
      remarks: "Remarks",
    },
  },
];

export const CADASTRE_BY_KEY: Record<TelanganaSourceKey, CadastreSource> = Object.fromEntries(
  CADASTRE_SOURCES.map((s) => [s.key, s]),
) as Record<TelanganaSourceKey, CadastreSource>;

export function outFieldsFor(source: CadastreSource): string[] {
  const f = source.fields;
  return [
    f.id,
    f.parcelNo,
    f.village,
    f.mandal,
    f.district,
    f.classification,
    f.prohibited,
    f.extent,
    f.remarks,
  ].filter((v): v is string => typeof v === "string");
}

export function cadastreUrl(source: CadastreSource): string {
  return `${TGRAC_ROOT}/${source.path}/query`;
}

/**
 * A parcel's address across both layers. Object ids collide between them, so
 * the source key travels with the id everywhere — including through the API,
 * where a bare number would silently resolve to the wrong survey number.
 */
export function parcelRef(source: TelanganaSourceKey, id: number): string {
  return `${source}:${id}`;
}

/**
 * Karnataka refs are `kgis:<village code>:<survey number>` — the survey number
 * itself, because K-GIS has no object id to hand out.
 */
export type ParsedRef =
  | { source: TelanganaSourceKey; id: number }
  | { source: "kgis"; code: string; surveyNo: string };

export const PARCEL_REF_PATTERN = /^((ulb|rural):\d{1,12}|kgis:\d{10}:[0-9]{1,5}([/-][0-9A-Za-z]{1,6}){0,3})$/;

export function parseParcelRef(ref: string): ParsedRef | null {
  if (!PARCEL_REF_PATTERN.test(ref)) return null;
  const [key, ...rest] = ref.split(":");
  if (key === "kgis") return { source: "kgis", code: rest[0], surveyNo: rest.slice(1).join(":") };
  if (key !== "ulb" && key !== "rural") return null;
  const id = Number(rest[0]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { source: key, id };
}

/**
 * Escape a value for an ArcGIS `where` clause. The service takes SQL, and the
 * district/village names arrive from the client, so this is the only thing
 * standing between a picker and an injected predicate. Quotes are doubled and
 * everything outside the character set a Telangana place name or survey number
 * can contain is dropped rather than escaped — a name that needs a semicolon is
 * a name we do not have.
 */
export function sqlLiteral(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9 ._/&()-]/g, "").trim().slice(0, 80);
  return `'${cleaned.replace(/'/g, "''")}'`;
}

/**
 * A prefix literal for a LIKE clause. Built separately from `sqlLiteral` so the
 * trailing wildcard is one we appended, never one the caller smuggled in: a `%`
 * arriving inside a survey number would otherwise turn a narrow prefix search
 * into a scan of the whole village.
 */
export function likePrefixLiteral(prefix: string): string | null {
  const cleaned = prefix.replace(/[^A-Za-z0-9/-]/g, "").slice(0, 24);
  if (!cleaned) return null;
  return `'${cleaned}%'`;
}

export type CadastreFilter = {
  district?: string | null;
  mandal?: string | null;
  village?: string | null;
  /** Matched as a prefix, so typing "33" offers 33, 33/1, 330. */
  parcelPrefix?: string | null;
};

export function buildCadastreWhere(source: CadastreSource, filter: CadastreFilter): string {
  const f = source.fields;
  const parts: string[] = [];
  if (filter.district) parts.push(`${f.district}=${sqlLiteral(filter.district)}`);
  if (filter.mandal) parts.push(`${f.mandal}=${sqlLiteral(filter.mandal)}`);
  if (filter.village) parts.push(`${f.village}=${sqlLiteral(filter.village)}`);
  if (filter.parcelPrefix) {
    const literal = likePrefixLiteral(filter.parcelPrefix);
    if (literal) parts.push(`${f.parcelNo} LIKE ${literal}`);
  }
  return parts.length ? parts.join(" AND ") : "1=1";
}

/**
 * Classification arrives as "574171-Habited Village: Listed in Other Wards" —
 * a numeric code, a hyphen, then the description. Split rather than parse; the
 * description is what a person needs and the code is what a tahsildar needs.
 */
export function decodeClassification(raw: string | null | undefined): {
  code: string | null;
  label: string | null;
} {
  const s = (raw ?? "").trim();
  if (!s) return { code: null, label: null };
  const m = /^(\d+)\s*-\s*(.+)$/.exec(s);
  if (!m) return { code: null, label: s };
  return { code: m[1], label: m[2].trim() };
}

/**
 * Survey numbers sort like "2, 12, 33, 33/1, 33/10, 33/2" only if compared
 * segment by segment as numbers. Plain string sort puts 12 before 2 and 33/10
 * before 33/2, which reads as a broken list to anyone who knows their own
 * survey number.
 */
export function compareParcelNumbers(a: string, b: string): number {
  const segs = (s: string) => s.split("/").map((p) => p.trim());
  const as = segs(a);
  const bs = segs(b);
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** A row in the survey-number picker. No geometry — the list stays cheap. */
export type ParcelSummary = {
  /** `<source>:<objectId>`. Object ids repeat across the two layers. */
  ref: string;
  source: CadastreSourceKey;
  state: StateKey;
  parcelNo: string;
  village: string | null;
  mandal: string | null;
  district: string | null;
  classification: string | null;
  /** Present only when the parcel is on the Section 22-A prohibited register. */
  prohibitedCategory: string | null;
  /**
   * Whether a published rate is held for this village. Set for Karnataka,
   * where the client cannot tell from the district alone; Telangana's
   * coverage is answered client-side by district.
   */
  guidanceKnown?: boolean;
};

/** One parcel, resolved: its boundary, its centre, and how big it actually is. */
export type ParcelRecord = ParcelSummary & {
  /** Which published layer this came from, for provenance on screen. */
  sourceLabel: string;
  rings: Ring[];
  centroid: LatLng;
  areaSqm: number;
  areaSqyd: number;
  areaAcres: number;
  classificationCode: string | null;
  /** The extent the register itself records, verbatim. Often absent. */
  registerExtent: string | null;
  remarks: string | null;
};

const SQM_PER_SQYD = 0.83612736;
const SQM_PER_ACRE = 4046.8564224;

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

function field(
  attributes: Record<string, unknown>,
  name: string | null,
): string | null {
  return name ? text(attributes[name]) : null;
}

export function shapeSummary(
  source: CadastreSource,
  attributes: Record<string, unknown>,
): ParcelSummary | null {
  const f = source.fields;
  const id = Number(attributes[f.id]);
  const parcelNo = field(attributes, f.parcelNo);
  if (!Number.isInteger(id) || id <= 0 || !parcelNo) return null;
  return {
    ref: parcelRef(source.key, id),
    source: source.key,
    state: "TS",
    parcelNo,
    village: field(attributes, f.village),
    mandal: field(attributes, f.mandal),
    district: field(attributes, f.district),
    classification: decodeClassification(field(attributes, f.classification)).label,
    prohibitedCategory: field(attributes, f.prohibited),
  };
}

/**
 * Measured extent from the boundary, not from the register. The register's
 * `EXTENT` is free text and frequently blank; the polygon is always there, and
 * a measured area that disagrees with the deed is itself a finding worth
 * showing rather than hiding.
 */
export function parcelExtent(rings: Ring[]): { sqm: number; sqyd: number; acres: number } {
  const outer = rings[0] ?? [];
  const sqm = polygonAreaSqMeters(outer.map(([lng, lat]) => ({ lat, lng })));
  return {
    sqm,
    sqyd: sqm / SQM_PER_SQYD,
    acres: sqm / SQM_PER_ACRE,
  };
}

export function shapeParcel(
  source: CadastreSource,
  attributes: Record<string, unknown>,
  rings: Ring[],
): ParcelRecord | null {
  const summary = shapeSummary(source, attributes);
  if (!summary) return null;
  const centroid = ringsCentroid(rings);
  if (!centroid) return null;
  const extent = parcelExtent(rings);
  return {
    ...summary,
    sourceLabel: source.label,
    rings,
    centroid,
    areaSqm: extent.sqm,
    areaSqyd: extent.sqyd,
    areaAcres: extent.acres,
    classificationCode: decodeClassification(field(attributes, source.fields.classification)).code,
    registerExtent: field(attributes, source.fields.extent),
    remarks: field(attributes, source.fields.remarks),
  };
}
