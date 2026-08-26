import type { CurrencyCode, ConfidenceBand, RiskSeverity, ScreenVerdict, PropertyType, DocumentKind, CaseStatus } from '@realytica/shared';

// English-language UI, so euro figures use an English euro locale (en-IE) rather
// than nl-NL — "€7.140/m²" in Dutch grouping reads as seven euros to everyone else.
const LOCALE: Record<CurrencyCode, string> = { INR: 'en-IN', EUR: 'en-IE' };

/** Compact money for headline figures: ₹2.4 Cr / €1.2M. */
export function money(value: number | null | undefined, currency: CurrencyCode, opts?: { compact?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const compact = opts?.compact ?? true;
  if (currency === 'INR' && compact) {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${trim(value / 1e7)} Cr`;
    if (abs >= 1e5) return `₹${trim(value / 1e5)} L`;
    if (abs >= 1e3) return `₹${trim(value / 1e3)}K`;
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }
  if (compact) {
    const abs = Math.abs(value);
    if (abs >= 1e6) return `€${trim(value / 1e6)}M`;
    if (abs >= 1e3) return `€${trim(value / 1e3)}K`;
    return `€${Math.round(value).toLocaleString(LOCALE.EUR)}`;
  }
  return new Intl.NumberFormat(LOCALE[currency], {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function trim(n: number): string {
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(r);
}

export function perSqm(value: number | null | undefined, currency: CurrencyCode): string {
  if (value === null || value === undefined) return '—';
  const symbol = currency === 'INR' ? '₹' : '€';
  return `${symbol}${Math.round(value).toLocaleString(LOCALE[currency])}/m²`;
}

/**
 * A rate already expressed in ₹/m² or €/m², shown per sq ft instead — never a
 * decimal on the rounded rate. For the general sq-ft/m² toggle used across the
 * app, prefer `formatRate` in `lib/units.ts`, which is unit-aware; this sibling
 * exists so callers that only ever want sq ft (e.g. a fixed India-only table)
 * don't need to pull in the unit-preference machinery.
 */
export function perSqft(perSqmValue: number | null | undefined, currency: CurrencyCode): string {
  if (perSqmValue === null || perSqmValue === undefined) return '—';
  const symbol = currency === 'INR' ? '₹' : '€';
  const SQM_PER_SQFT = 0.09290304;
  return `${symbol}${Math.round(perSqmValue * SQM_PER_SQFT).toLocaleString(LOCALE[currency])}/sq ft`;
}

/**
 * Full (non-compact) lakh/crore rendering for INR — `₹1.35 Cr`, `₹78.5 L`,
 * `₹42,000`. `money()` already does this compaction for INR; this just gives
 * it a name for call sites that only ever deal in rupees and want the intent
 * ("give me lakh/crore") to be obvious at the call site, and always compacts
 * regardless of the caller's default. Falls back to a plain grouped number for
 * EUR, since lakh/crore is an Indian numbering convention only.
 */
export function lakhCrore(value: number | null | undefined, currency: CurrencyCode = 'INR'): string {
  return money(value, currency, { compact: true });
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function area(sqm: number | null | undefined): string {
  if (!sqm) return '—';
  return `${Math.round(sqm).toLocaleString('en-US')} m²`;
}

export function date(iso: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', style === 'short'
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date(iso);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  residential_apartment: 'Residential apartment',
  residential_villa: 'Residential villa',
  residential_plot: 'Residential plot',
  commercial_office: 'Commercial office',
  retail_unit: 'Retail unit',
  industrial_warehouse: 'Industrial warehouse',
  land_parcel: 'Land parcel',
};

// The Karnataka / Bengaluru pack added document kinds to the shared `DocumentKind`
// union (packages/shared/src/types.ts). Their labels belong with the pack's own
// content (KHATA_TYPE_LABEL and friends in packages/shared/src/packs/karnataka.ts),
// but that pack may not exist on disk yet, and `DOCUMENT_KIND_LABEL` below must
// stay an exhaustive `Record<DocumentKind, string>` regardless — so the new kinds
// are labelled here. If the shared pack later exports its own document-kind
// labels, prefer merging those in rather than keeping two sources of truth.
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  title_deed: 'Title deed',
  sale_agreement: 'Sale agreement',
  encumbrance_certificate: 'Encumbrance certificate',
  property_tax_receipt: 'Property tax receipt',
  approved_building_plan: 'Approved building plan',
  occupancy_certificate: 'Occupancy certificate',
  khata_extract: 'Khata extract',
  rera_registration: 'RERA registration',
  mother_deed: 'Mother deed',
  conversion_certificate: 'Conversion certificate (DC conversion order)',
  commencement_certificate: 'Commencement certificate',
  betterment_charges_receipt: 'Betterment charges receipt',
  possession_certificate: 'Possession certificate',
  form_9_11: 'Form 9 & 11 (gram panchayat)',
  sanctioned_plan_bbmp: 'Sanctioned plan (BBMP)',
  joint_development_agreement: 'Joint development agreement',
  valuation_report: 'Valuation report',
  lease_agreement: 'Lease agreement',
  kadaster_extract: 'Kadaster extract',
  energy_label: 'Energy label',
  woz_assessment: 'WOZ assessment',
  floor_plan: 'Floor plan',
  photograph: 'Photograph',
  other: 'Other',
  unclassified: 'Unclassified',
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: 'Draft',
  collecting: 'Collecting evidence',
  analysing: 'Analysing',
  screened: 'Screened',
  archived: 'Archived',
};

export const VERDICT_LABEL: Record<ScreenVerdict, string> = {
  pursue: 'Pursue',
  pursue_with_conditions: 'Pursue with conditions',
  investigate_further: 'Investigate further',
  do_not_pursue: 'Do not pursue',
};

/** Status tone for a verdict — status colours are reserved and always ship with a label. */
export function verdictTone(v: ScreenVerdict): 'good' | 'warning' | 'serious' | 'critical' {
  switch (v) {
    case 'pursue': return 'good';
    case 'pursue_with_conditions': return 'warning';
    case 'investigate_further': return 'serious';
    case 'do_not_pursue': return 'critical';
    default: return 'serious';
  }
}

export function severityTone(s: RiskSeverity): 'info' | 'warning' | 'serious' | 'critical' {
  return s;
}

export function confidenceTone(band: ConfidenceBand): 'good' | 'warning' | 'critical' {
  return band === 'high' ? 'good' : band === 'moderate' ? 'warning' : 'critical';
}
