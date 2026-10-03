import type { CurrencyCode, ConfidenceBand, DocumentKind } from '@realytica/shared';

// English-language UI, so euro figures use an English euro locale (en-IE) rather
// than nl-NL — "€7.140/m²" in Dutch grouping reads as seven euros to everyone else.
const LOCALE: Record<CurrencyCode, string> = { INR: 'en-IN', EUR: 'en-IE' };

/** Compact money for headline figures: ₹2.4 Cr / €1.2M. */
export function money(value: number | null | undefined, currency: CurrencyCode, opts?: { compact?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const compact = opts?.compact ?? true;
  /*
   * The sign comes out before the symbol goes on. Formatting the signed value
   * directly produced "₹-59 Cr" — the minus stranded between the currency and
   * the digits, where it reads as a stray dash rather than as a subtraction.
   * A true minus (U+2212) rather than a hyphen, because these sit in tabular
   * columns beside positive figures and a hyphen sits too low and too short
   * to line up with them.
   */
  const sign = value < 0 ? '\u2212' : '';
  const abs = Math.abs(value);
  if (currency === 'INR' && compact) {
    if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
    if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
    if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
    return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
  }
  if (compact) {
    if (abs >= 1e6) return `${sign}€${trim(abs / 1e6)}M`;
    if (abs >= 1e3) return `${sign}€${trim(abs / 1e3)}K`;
    return `${sign}€${Math.round(abs).toLocaleString(LOCALE.EUR)}`;
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

export function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function area(sqm: number | null | undefined): string {
  if (!sqm) return '—';
  return `${Math.round(sqm).toLocaleString('en-US')} m²`;
}

/**
 * Epoch zero is not a date, it is the absence of one.
 *
 * A built-in prompt version is stamped `1970-01-01T00:00:00.000Z` on purpose:
 * its identity is its content, and a `createdAt` that moved with every deploy
 * would make the version list look like it had changed when nothing had. That
 * reasoning is sound and stays. What was wrong is that the formatters believed
 * it, so the shipped version of every prompt announced "01 Jan 1970" — a date
 * that reads as a bug in the product rather than as "this came with the build".
 *
 * Caught here rather than at each call site so a formatter can never be the
 * thing that surfaces it.
 */
const EPOCH_ZERO = 0;

function isAbsentTimestamp(ms: number): boolean {
  return ms === EPOCH_ZERO;
}

export function date(iso: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (isAbsentTimestamp(d.getTime())) return 'Shipped with the build';
  return d.toLocaleDateString('en-GB', style === 'short'
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  // "56 years ago" is the same untruth as "01 Jan 1970", told differently.
  if (isAbsentTimestamp(then)) return 'Built in';
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

export function titleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

export function confidenceTone(band: ConfidenceBand): 'good' | 'warning' | 'critical' {
  return band === 'high' ? 'good' : band === 'moderate' ? 'warning' : 'critical';
}
