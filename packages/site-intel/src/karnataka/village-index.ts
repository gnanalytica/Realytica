// The Karnataka village index: district → taluk → village (hobli) → the
// K-GIS village id that the parcel service is keyed on.
//
// K-GIS has no call that lists villages under a taluk, and no call that lists
// survey numbers under a village. What it has is a radius search around a
// point and a code-to-hierarchy lookup, so `scripts/capture-ka-villages.mjs`
// sweeps a grid across the Bengaluru Metropolitan Region and resolves every
// village code it meets. That sweep IS the picker's list; there is no live
// version of it to fall back to or be superseded by.
//
// Some villages carry two K-GIS ids for one revenue code (Anekal is 21158 and
// 21159; one of them holds the parcels). The index keeps both and the fetch
// tries each.
//
// NOT marked `server-only`, so the pure test can import it; it must stay
// server-side by discipline — the JSON is 590 KB and belongs nowhere near a
// bundle. Its only callers are `kgis.ts` and the cadastre route.

import index from "./ka-villages.json";

export type KaVillage = {
  /** Ten-digit revenue village code: district(2) taluk(2) hobli(2) village(4). */
  code: string;
  /** K-GIS village ids, in the order to try. */
  ids: string[];
  village: string;
  hobli: string;
  taluk: string;
  district: string;
};

const RAW = index as { capturedOn: string; villages: KaVillage[] };

export const KA_INDEX_CAPTURED_ON = RAW.capturedOn;

const ALL: KaVillage[] = RAW.villages ?? [];

const byCode = new Map<string, KaVillage>(ALL.map((v) => [v.code, v]));

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function kaDistricts(): string[] {
  return unique(ALL.map((v) => v.district));
}

export function kaTaluks(district: string): string[] {
  return unique(ALL.filter((v) => v.district === district).map((v) => v.taluk));
}

/**
 * The label a person picks: "White Field (K R Pura-3)". The hobli is what
 * separates the many Kodigehallis of one taluk, so it is always shown. When
 * two revenue codes still share a label, the code's last four digits are
 * appended — rare, and better than silently dropping one.
 */
export function kaVillageLabel(v: KaVillage, disambiguate = false): string {
  const base = `${v.village} (${v.hobli})`;
  return disambiguate ? `${base} · ${v.code.slice(-4)}` : base;
}

function villagesIn(district: string, taluk: string): { label: string; entry: KaVillage }[] {
  const rows = ALL.filter((v) => v.district === district && v.taluk === taluk);
  const counts = new Map<string, number>();
  for (const v of rows) {
    const l = kaVillageLabel(v);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return rows
    .map((entry) => ({
      label: kaVillageLabel(entry, (counts.get(kaVillageLabel(entry)) ?? 0) > 1),
      entry,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function kaVillageLabels(district: string, taluk: string): string[] {
  return villagesIn(district, taluk).map((r) => r.label);
}

export function kaVillageByLabel(district: string, taluk: string, label: string): KaVillage | null {
  return villagesIn(district, taluk).find((r) => r.label === label)?.entry ?? null;
}

export function kaVillageByCode(code: string): KaVillage | null {
  return byCode.get(code) ?? null;
}

export function kaVillageCount(): number {
  return ALL.length;
}
