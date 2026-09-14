// The states Kshetra reads, and how each one names its land.
//
// Client-safe: no data, no network. Everything that differs between the two
// states — the hierarchy an owner remembers their land by, the words on the
// picker, where the state's GIS is authoritative — is declared here so the
// rest of the code can ask "which state" once and not sprinkle `if` on it.

import type { LatLng } from "./geo/measure";

export type StateKey = "TS" | "KA";

export type StateSpec = {
  key: StateKey;
  label: string;
  /** Shown beside the state name in the picker. */
  hint: string;
  /** The city the follow-up questions talk about. */
  city: string;
  /**
   * What the three picker levels are called. Telangana keys its record by
   * district / mandal / village; Karnataka by district / taluk / hobli /
   * village, and the hobli is folded into the village label.
   */
  levels: { district: string; mandal: string; village: string };
  /** The planning authority whose approval the layout question asks about. */
  approvals: { value: string; label: string }[];
  /** Generous box; the layers themselves decide precision. */
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

export const STATES: Record<StateKey, StateSpec> = {
  TS: {
    key: "TS",
    label: "Telangana",
    hint: "survey numbers in 15 districts",
    city: "Hyderabad",
    levels: { district: "District", mandal: "Mandal", village: "Village" },
    approvals: [
      { value: "hmda", label: "HMDA" },
      { value: "dtcp", label: "DTCP" },
    ],
    bounds: { minLat: 15.8, maxLat: 19.95, minLng: 77.2, maxLng: 81.4 },
  },
  KA: {
    key: "KA",
    label: "Karnataka",
    hint: "Bengaluru region",
    city: "Bengaluru",
    levels: { district: "District", mandal: "Taluk", village: "Village (hobli)" },
    approvals: [
      { value: "bda", label: "BDA" },
      { value: "bmrda", label: "BMRDA / BIAPPA" },
      { value: "bbmp", label: "BBMP" },
    ],
    // The Bengaluru Metropolitan Region and its ring: what the captured village
    // index and the BMRDA master-plan layer actually cover.
    bounds: { minLat: 12.3, maxLat: 13.7, minLng: 76.8, maxLng: 78.3 },
  },
};

export const STATE_KEYS = Object.keys(STATES) as StateKey[];

export function isStateKey(v: unknown): v is StateKey {
  return v === "TS" || v === "KA";
}

/** Which state a point falls in, or null when neither covers it. */
export function stateAt(point: LatLng): StateKey | null {
  for (const s of STATE_KEYS) {
    const b = STATES[s].bounds;
    if (
      point.lat >= b.minLat &&
      point.lat <= b.maxLat &&
      point.lng >= b.minLng &&
      point.lng <= b.maxLng
    ) {
      return s;
    }
  }
  return null;
}
