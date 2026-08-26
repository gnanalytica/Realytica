/**
 * Display-unit layer for area.
 *
 * The domain model (`PropertyIdentity.builtUpAreaSqm`, `plotAreaSqm`,
 * `LocalityReference.medianPricePerSqm`, …) stores and always will store square
 * metres — that is the one unit every country pack agrees on. Bengaluru buyers
 * think and quote in square feet, though, so this module is purely a
 * presentation concern: convert m² to sq ft (and back) at the edges, keep the
 * canonical number in m² everywhere else.
 */

import type { CountryCode } from '@realytica/shared';
import { readPref, writePref } from './prefs';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** 1 sq ft in m² — the exact conversion factor (1 ft = 0.3048 m, squared). */
export const SQM_PER_SQFT = 0.09290304;
export const SQFT_PER_SQM = 1 / SQM_PER_SQFT;

export function sqmToSqft(sqm: number): number {
  return sqm / SQM_PER_SQFT;
}

export function sqftToSqm(sqft: number): number {
  return sqft * SQM_PER_SQFT;
}

export type AreaUnit = 'sqft' | 'sqm';

/** Default display unit for a country, absent any user override. */
export function defaultAreaUnit(country: CountryCode): AreaUnit {
  return country === 'IN' ? 'sqft' : 'sqm';
}

/* ------------------------------------------------------------------ */
/* Preference store                                                    */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'areaUnit';

function readStoredUnit(): AreaUnit | null {
  const v = readPref(STORAGE_KEY);
  if (v === 'sqft' || v === 'sqm') return v;
  return null;
}

function writeStoredUnit(unit: AreaUnit): void {
  writePref(STORAGE_KEY, unit);
}

interface AreaUnitContextValue {
  unit: AreaUnit;
  setUnit: (next: AreaUnit) => void;
  /** True once the user has explicitly chosen a unit (vs. riding the country default). */
  isOverridden: boolean;
}

const AreaUnitContext = createContext<AreaUnitContextValue | null>(null);

/**
 * Mounts the shared area-unit preference. Wrap the app shell in this so every
 * screen agrees on sq ft vs m². Reads a persisted choice from localStorage if
 * present, otherwise falls back to `defaultAreaUnit(initialCountry)`.
 */
export function AreaUnitProvider({
  children,
  initialCountry = 'IN',
}: {
  children: ReactNode;
  initialCountry?: CountryCode;
}) {
  const stored = readStoredUnit();
  const [unit, setUnitState] = useState<AreaUnit>(stored ?? defaultAreaUnit(initialCountry));
  const [isOverridden, setIsOverridden] = useState(stored !== null);

  const setUnit = useCallback((next: AreaUnit) => {
    setUnitState(next);
    setIsOverridden(true);
    writeStoredUnit(next);
  }, []);

  const value = useMemo<AreaUnitContextValue>(() => ({ unit, setUnit, isOverridden }), [unit, setUnit, isOverridden]);

  return createElement(AreaUnitContext.Provider, { value }, children);
}

/**
 * Reads/sets the shared area unit. Works even when no `AreaUnitProvider` is
 * mounted — falls back to a local, component-scoped default (`sqft`, since
 * India is the only live country pack) so components built against this hook
 * never crash while the provider isn't wired in yet.
 */
export function useAreaUnit(): AreaUnitContextValue {
  const ctx = useContext(AreaUnitContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fallback = useStandaloneAreaUnit();
  return ctx ?? fallback;
}

/**
 * The unit a given case should display in.
 *
 * Until the user explicitly picks one, each case follows its own country's
 * convention — sq ft for India, m² for the Netherlands — so a Dutch property
 * never renders in square feet just because the last case viewed was Indian.
 * Once the user chooses, that choice wins everywhere.
 */
export function useAreaUnitFor(country: CountryCode): AreaUnit {
  const { unit, isOverridden } = useAreaUnit();
  return isOverridden ? unit : defaultAreaUnit(country);
}

/**
 * The unit for a figure known only by its currency — charts receive `currency`
 * but not `country`, and the two map one-to-one across the live country packs.
 * Same rule as `useAreaUnitFor`: follow the market until the user chooses.
 */
export function useAreaUnitForCurrency(currency: 'INR' | 'EUR'): AreaUnit {
  return useAreaUnitFor(currency === 'EUR' ? 'NL' : 'IN');
}

/** Local fallback store used only when no provider is mounted. */
function useStandaloneAreaUnit(): AreaUnitContextValue {
  const [unit, setUnitState] = useState<AreaUnit>(() => readStoredUnit() ?? 'sqft');
  const [isOverridden, setIsOverridden] = useState<boolean>(() => readStoredUnit() !== null);

  useEffect(() => {
    writeStoredUnit(unit);
  }, [unit]);

  const setUnit = useCallback((next: AreaUnit) => {
    setUnitState(next);
    setIsOverridden(true);
  }, []);

  return useMemo(() => ({ unit, setUnit, isOverridden }), [unit, setUnit, isOverridden]);
}

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

/** `1,561 sq ft` / `145 m²`. Sq ft always whole numbers; m² whole for anything sizeable. */
export function formatArea(sqm: number | null | undefined, unit: AreaUnit): string {
  if (sqm === null || sqm === undefined || Number.isNaN(sqm)) return '—';
  if (unit === 'sqft') {
    return `${Math.round(sqmToSqft(sqm)).toLocaleString('en-IN')} sq ft`;
  }
  return `${Math.round(sqm).toLocaleString('en-US')} m²`;
}

/** `₹8,548/sq ft` / `₹92,000/m²` — never a decimal on a rate. */
export function formatRate(perSqmValue: number | null | undefined, unit: AreaUnit, currency: 'INR' | 'EUR'): string {
  if (perSqmValue === null || perSqmValue === undefined || Number.isNaN(perSqmValue)) return '—';
  const symbol = currency === 'INR' ? '₹' : '€';
  if (unit === 'sqft') {
    const perSqft = perSqmValue * SQM_PER_SQFT;
    return `${symbol}${Math.round(perSqft).toLocaleString('en-IN')}/sq ft`;
  }
  return `${symbol}${Math.round(perSqmValue).toLocaleString('en-IN')}/m²`;
}

/** Convert a value already expressed per-sq-ft back to per-sqm, for feeding into the m²-native engine. */
export function ratePerSqftToPerSqm(perSqft: number): number {
  return perSqft / SQM_PER_SQFT;
}

/* ------------------------------------------------------------------ */
/* Area basis                                                          */
/* ------------------------------------------------------------------ */

/**
 * Local copy of `AreaBasis` shaped to match `@realytica/shared`'s type so this
 * module has no hard dependency on the Karnataka pack landing first — see the
 * contract note in `packages/shared/src/types.ts`. Structurally identical to
 * the shared `AreaBasis` union, so it is a drop-in whichever lands.
 */
export type LocalAreaBasis = 'carpet' | 'built_up' | 'super_built_up' | 'unknown';

/** One-line explanation of carpet vs built-up vs super built-up, for help text. */
export function describeAreaBasis(basis: LocalAreaBasis): string {
  switch (basis) {
    case 'carpet':
      return 'Carpet area — the usable floor area inside the walls; this is what RERA requires developers to quote.';
    case 'built_up':
      return 'Built-up area — carpet area plus wall thickness and balconies, typically 10–15% more than carpet.';
    case 'super_built_up':
      return 'Super built-up area — built-up area plus a share of common areas (lobby, lifts, stairwells); this is what Bengaluru listings usually quote, and it typically runs 25–35% above carpet area for the same unit.';
    case 'unknown':
    default:
      return "Area basis not confirmed — Bengaluru listings usually quote super built-up, while RERA mandates carpet area, and the two can differ by 25–35% for the same unit. Confirm which one you're looking at before comparing prices.";
  }
}
