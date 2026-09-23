// Karnataka guidance values, read from the Kaveri capture.
//
// Kaveri publishes a value per ROAD — a locality, a layout, a stretch of
// highway — inside a registration "village", in rupees per square metre. A
// plot's road is not something any map layer tells us, so the anchor is the
// village's typical rate: the median of its "other roads" entries when it has
// them (that is what the sub-registrar applies to an unnamed road), else the
// median of every priced road. When the owner names the road in a follow-up,
// that road's own rate replaces the median.
//
// Kaveri villages are matched to K-GIS villages by name inside the same
// Bhoomi district. The two systems share the district code and nothing else;
// hobli names differ and Kaveri's taluks are registration taluks. A name
// match inside the district is the best join available, and a village that
// does not match is reported as unpriced rather than guessed.
//
// NOT `server-only`, so the pure test can import it; server-side by
// discipline — the JSON is megabytes.

import data from "./kaveri-rates.json";
import flatData from "./kaveri-flats.json";

export type KaveriRoad = {
  /** Kaveri's road code; dropped from the shipped table to keep it small. */
  code?: number;
  name: string;
  /** Vacant residential land, INR per sq m. */
  res?: number;
  com?: number;
  ind?: number;
  /** Agricultural classes, INR per acre. */
  agri?: [string, number][];
};

export type KaveriVillage = {
  code: number;
  name: string;
  hobli: string;
  taluk: string;
  /** Registration district — "Jayanagar", not "Bengaluru (Urban)". */
  district: string;
  bhoomiDistrict: string;
  urban: boolean;
  roads: KaveriRoad[];
};

type Raw = { capturedOn: string; villages: KaveriVillage[] };
const RAW = data as unknown as Raw;

export const KAVERI_CAPTURED_ON = RAW.capturedOn;

const SQM_PER_SQYD = 0.83612736;
const SQYD_PER_ACRE = 4840;

/**
 * How far traded prices in the Bengaluru region run above the guidance
 * value. Karnataka revised its values in October 2023 by 25–30% and they sit
 * closer to the market than Telangana's, but a gap remains and widens in the
 * outer taluks where the revision lagged. These are working assumptions, not
 * measurements, and the anchor's note says so.
 */
const MARKET_MULTIPLE_URBAN = 1.4;
const MARKET_MULTIPLE_RURAL = 1.3;

/** "White Field", "Whitefield" and "WHITE-FIELD" are one name. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The same village spelt two ways: "Katthinagenahalli" on the revenue map,
 * "Kattinagenahalli" in Kaveri; "Hebburu" and "Hebbur"; "Mavatthura" and
 * "Mavathuru". Kannada names have no fixed English spelling, so a second key
 * collapses the usual variants — doubled letters, aspirates, long vowels, a
 * trailing vowel — and is used only when it points at exactly one name in
 * the district. It lifted coverage from 49% to 61% of the K-GIS index.
 */
export function looseName(s: string | null | undefined): string {
  return normName(s)
    .replace(/(.)\1+/g, "$1")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/aa/g, "a")
    .replace(/[tdbgkp]h/g, (m) => m[0])
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/[aeiou]+$/, "")
    .replace(/hal[iy]$/, "hali")
    .replace(/pur[aeiou]?$/, "pur")
    .replace(/pal[iy]a?$/, "pali")
    .replace(/sandra?$/, "sandr");
}

const BY_KEY = new Map<string, KaveriVillage[]>();
/** Loose key → the exact keys it stands for. Ambiguous when more than one. */
const BY_LOOSE = new Map<string, Set<string>>();
for (const v of RAW.villages ?? []) {
  const key = `${v.bhoomiDistrict}|${normName(v.name)}`;
  const list = BY_KEY.get(key) ?? [];
  list.push(v);
  BY_KEY.set(key, list);
  const loose = `${v.bhoomiDistrict}|${looseName(v.name)}`;
  const set = BY_LOOSE.get(loose) ?? new Set<string>();
  set.add(key);
  BY_LOOSE.set(loose, set);
}

/**
 * Kaveri villages matching a K-GIS village. The K-GIS village code starts
 * with the Bhoomi district code, which is the same code Kaveri carries. An
 * exact name match first; failing that, the loose spelling when it is
 * unambiguous; failing that, nothing — never a guess.
 */
export function kaveriVillagesFor(
  kgisVillageCode: string,
  villageName: string,
  hobli?: string | null,
): KaveriVillage[] {
  const district = String(Number(kgisVillageCode.slice(0, 2)));
  // Kaveri writes a taluk headquarters as "Anekal Kasaba" or "Devanahalli
  // Town" where the revenue map says "Anekal" in Kasaba hobli, so the name
  // is tried with its hobli and the usual suffixes appended, in that order.
  const names = [
    villageName,
    ...(hobli ? [`${villageName} ${hobli}`] : []),
    `${villageName} Kasaba`,
    `${villageName} Town`,
  ];
  for (const name of names) {
    const exact = BY_KEY.get(`${district}|${normName(name)}`);
    if (exact?.length) return exact;
  }
  for (const name of names) {
    const candidates = BY_LOOSE.get(`${district}|${looseName(name)}`);
    if (candidates?.size === 1) return BY_KEY.get([...candidates][0]) ?? [];
  }
  return [];
}

export function kaveriVillageCount(): number {
  return RAW.villages?.length ?? 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** The roads Kaveri prices in these villages, for the "which road" question. */
export function kaveriRoads(villages: KaveriVillage[]): { name: string; resPerSqM: number }[] {
  const seen = new Set<string>();
  const out: { name: string; resPerSqM: number }[] = [];
  for (const r of pricedRoads(villages)) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({ name: r.name, resPerSqM: r.res as number });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const OTHER_ROAD = /\bothers?\b/i;

/**
 * Kaveri's table has a few entries that can only be typos — a road at
 * ₹14.8 crore per square metre. The highest genuine value in the state is a
 * few lakh per square metre on M.G. Road, so anything above ten lakh is
 * treated as not a value at all rather than passed through to a band.
 */
const MAX_PLAUSIBLE_PER_SQM = 1_000_000;

/** Genuinely agricultural classes — not "NA dry land", which is converted land. */
const AGRICULTURAL_CLASS = (type: string) => !/^na\b/i.test(type.trim());

function pricedRoads(villages: KaveriVillage[]): KaveriRoad[] {
  return villages
    .flatMap((v) => v.roads)
    .filter((r) => (r.res ?? 0) > 0 && (r.res as number) <= MAX_PLAUSIBLE_PER_SQM);
}

export type KaveriRate = {
  /** Vacant residential land, INR per sq yd, straight from the table. */
  landPerSqYd: number;
  /** The same figure as Kaveri prints it. */
  landPerSqM: number;
  /** Agricultural land, INR per sq yd, when the village prices any. */
  agriPerSqYd: number | null;
  basis: "road" | "village_other_roads" | "village_median";
  /** What the figure is for: the road, or the village and how many roads. */
  locality: string;
  roadCount: number;
  marketMultiple: number;
};

/**
 * The rate to anchor a plot on. With a road name, that road's value; without,
 * the village's typical value as described above.
 */
export function kaveriRateFor(villages: KaveriVillage[], roadName?: string | null): KaveriRate | null {
  if (!villages.length) return null;
  const village = villages[0];
  const roads = villages.flatMap((v) => v.roads);
  const priced = pricedRoads(villages);
  const multiple = village.urban || village.bhoomiDistrict === "20" ? MARKET_MULTIPLE_URBAN : MARKET_MULTIPLE_RURAL;
  const agri = median(
    roads.flatMap((r) => (r.agri ?? []).filter(([type]) => AGRICULTURAL_CLASS(type)).map(([, rate]) => rate)),
  );
  const agriPerSqYd = agri ? agri / SQYD_PER_ACRE : null;

  if (roadName) {
    const road = priced.find((r) => r.name === roadName);
    if (road?.res) {
      return {
        landPerSqYd: road.res * SQM_PER_SQYD,
        landPerSqM: road.res,
        agriPerSqYd,
        basis: "road",
        locality: `${road.name}, ${village.name}`,
        roadCount: priced.length,
        marketMultiple: multiple,
      };
    }
  }

  const others = priced.filter((r) => OTHER_ROAD.test(r.name));
  const pool = others.length ? others : priced;
  const perSqM = median(pool.map((r) => r.res as number));
  if (!perSqM) return null;
  return {
    landPerSqYd: perSqM * SQM_PER_SQYD,
    landPerSqM: perSqM,
    agriPerSqYd,
    basis: others.length ? "village_other_roads" : "village_median",
    locality: village.name,
    roadCount: priced.length,
    marketMultiple: multiple,
  };
}

// ---------------------------------------------------------------- flats

/** Per road: the Flat/Apartment rate and the commercial ground-floor reckoner, INR per sq m. */
type FlatVillage = {
  code: number;
  name: string;
  bhoomiDistrict: string;
  roads: { name: string; flat?: number; com?: number }[];
};
const FLATS = flatData as unknown as { capturedOn: string; villages: FlatVillage[] };

/** Null until `pnpm capture:kaveri-flats` has run. */
export const KAVERI_FLATS_CAPTURED_ON =
  FLATS.capturedOn && FLATS.capturedOn !== "pending" ? FLATS.capturedOn : null;

const FLATS_BY_VILLAGE = new Map<number, FlatVillage>(
  (KAVERI_FLATS_CAPTURED_ON ? FLATS.villages : []).map((v) => [v.code, v]),
);

const SQFT_PER_SQM = 10.7639;

export type KaveriFlatRate = {
  /** Built-up area, INR per sq ft. */
  builtPerSqft: number;
  perSqM: number;
  basis: "apartment" | "village_apartments" | "land_rate";
  locality: string;
  /** Named apartment complexes Kaveri prices in the village. */
  apartmentCount: number;
  marketMultiple: number;
};

function apartmentRows(v: FlatVillage | undefined): { name: string; rate: number }[] {
  if (!v) return [];
  const out: { name: string; rate: number }[] = [];
  for (const r of v.roads) {
    if (!r.flat || r.flat <= 0 || r.flat > MAX_PLAUSIBLE_PER_SQM) continue;
    out.push({ name: r.name, rate: r.flat });
  }
  return out;
}

/**
 * A flat's rate. Kaveri prices named apartment complexes individually (each
 * is a "road"); a flat in one of those takes its own value, a flat in an
 * unnamed building takes the median of the village's named ones, and a
 * village with none falls back to its vacant-land rate, which is what the
 * sub-registrar applies to built-up area there. The basis is returned so the
 * note can say which.
 */
export function kaveriFlatRateFor(villages: KaveriVillage[], roadName?: string | null): KaveriFlatRate | null {
  if (!villages.length) return null;
  const village = villages[0];
  const multiple = village.urban || village.bhoomiDistrict === "20" ? MARKET_MULTIPLE_URBAN : MARKET_MULTIPLE_RURAL;
  const rows = villages.flatMap((v) => apartmentRows(FLATS_BY_VILLAGE.get(v.code)));

  if (roadName) {
    const own = rows.find((r) => r.name === roadName);
    if (own) {
      return {
        builtPerSqft: own.rate / SQFT_PER_SQM,
        perSqM: own.rate,
        basis: "apartment",
        locality: `${own.name}, ${village.name}`,
        apartmentCount: rows.length,
        marketMultiple: multiple,
      };
    }
  }
  const med = median(rows.map((r) => r.rate));
  if (med) {
    return {
      builtPerSqft: med / SQFT_PER_SQM,
      perSqM: med,
      basis: "village_apartments",
      locality: village.name,
      apartmentCount: rows.length,
      marketMultiple: multiple,
    };
  }
  const land = kaveriRateFor(villages, roadName);
  if (!land) return null;
  return {
    builtPerSqft: land.landPerSqM / SQFT_PER_SQM,
    perSqM: land.landPerSqM,
    basis: "land_rate",
    locality: land.locality,
    apartmentCount: 0,
    marketMultiple: multiple,
  };
}
