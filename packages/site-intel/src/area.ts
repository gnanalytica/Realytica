// Area units used across valuation, comparables and measurement capture.
// Conversions go through sqft as the canonical base so that comparable rates,
// land extents and measured room areas can all be normalised for comparison.

export const AREA_UNITS = ["sqft", "sqyd", "sqm", "cents", "acres"] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

// 1 unit = N square feet. sqyd = 9 sqft, sqm = 10.7639 sqft,
// cent = 1/100 acre = 435.6 sqft, acre = 43,560 sqft.
const TO_SQFT: Record<AreaUnit, number> = {
  sqft: 1,
  sqyd: 9,
  sqm: 10.7639,
  cents: 435.6,
  acres: 43560,
};

export function isAreaUnit(u: string | null | undefined): u is AreaUnit {
  return u != null && (AREA_UNITS as readonly string[]).includes(u);
}

export function toSqft(value: number, unit: string | null | undefined): number {
  const factor = isAreaUnit(unit) ? TO_SQFT[unit] : 1;
  return value * factor;
}

export function convertArea(value: number, from: string | null | undefined, to: AreaUnit): number {
  return toSqft(value, from) / TO_SQFT[to];
}

export function formatArea(value: number, unit: string): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("en-IN")} ${unit}`;
}

// RERA / IBA disclosures expect carpet < built-up < super-built-up. Returns a
// human-readable warning when the hierarchy is violated, else null. Compares in
// sqft (the areas are stored in sqft) but tolerates rounding noise.
export function validateAreaHierarchy(
  carpet: number | null,
  builtUp: number | null,
  superBuiltUp: number | null,
): string | null {
  const EPS = 0.5;
  if (carpet != null && builtUp != null && carpet > builtUp + EPS) {
    return "Carpet area exceeds built-up area — check the figures.";
  }
  if (builtUp != null && superBuiltUp != null && builtUp > superBuiltUp + EPS) {
    return "Built-up area exceeds super built-up area — check the figures.";
  }
  if (carpet != null && superBuiltUp != null && carpet > superBuiltUp + EPS) {
    return "Carpet area exceeds super built-up area — check the figures.";
  }
  return null;
}
