import { daySaid, formatMoney, formatMoneyIn, formatMoneyInFull, looksLikeDay, moneyUnitFor, percentSaid, personSaid, type CurrencyCode, type ConfidenceBand, type DdProject, type DocumentKind, type FieldCurrency, type MoneyUnit } from '@realytica/shared';

// English-language UI, so euro figures use an English euro locale (en-IE) rather
// than nl-NL — "€7.140/m²" in Dutch grouping reads as seven euros to everyone else.
const LOCALE: Record<CurrencyCode, string> = { INR: 'en-IN', EUR: 'en-IE' };

/**
 * Money for a page. Rupees are written in the Indian system, in lakh and
 * crore, by the one formatter every field, report and chat answer uses
 * (`formatMoney`): ₹2.4 Cr, ₹45 lakh, ₹12,500. `compact: false` gives the
 * figure in full, for a table where each rupee matters and for a hover.
 */
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
  if (currency === 'INR' && compact) return formatMoney(Math.round(value), 'INR');
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

/** The currencies the one formatter writes. Anything else is written in full with its code before it. */
const WRITTEN: readonly string[] = ['INR', 'EUR', 'USD', 'AED'];

/**
 * A price, a rate or a total in words, in whatever currency a record names.
 * The one rupee formatter writes it (`formatMoney`): to the rupee below a
 * lakh, in lakh and crore to two places above. No page builds an amount out
 * of a sign and `toLocaleString` for itself; `test/format-lint.test.ts` fails
 * on one that does.
 */
export function amount(value: number | null | undefined, currency: string = 'INR'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (WRITTEN.includes(currency)) return formatMoney(Math.round(value), currency as FieldCurrency, currency === 'INR' ? 2 : 0);
  return `${value < 0 ? '\u2212' : ''}${currency} ${grouped(Math.abs(Math.round(value)))}`;
}

/** A whole figure with its thousands marked, where no unit of money is meant: an area, a count. */
export function grouped(value: number, places = 0): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: places });
}

/**
 * A column of money: the unit every row of it is written in, chosen once
 * from all its amounts (its total among them), and each cell's words with
 * the figure in full for its title. Crore and lakh are to two places.
 */
export function moneyColumn(amounts: ReadonlyArray<number | null | undefined>, currency: string = 'INR'): { unit: MoneyUnit; cell: (value: number | null | undefined) => { text: string; title: string } } {
  const written = WRITTEN.includes(currency) ? (currency as FieldCurrency) : undefined;
  const unit = written ? moneyUnitFor(amounts, written) : 'rupees';
  return {
    unit,
    cell: (value) => {
      if (value === null || value === undefined || Number.isNaN(value)) return { text: '—', title: '' };
      if (!written) return { text: amount(value, currency), title: amount(value, currency) };
      return { text: formatMoneyIn(value, unit, written), title: formatMoneyInFull(value, written) };
    },
  };
}

/** "Oct 2026": the month a day is in, written as every day is. */
export function monthYear(when: string | Date | null | undefined): string {
  const said = when instanceof Date || when ? daySaid(when) : '';
  const parts = said.split(' ');
  return parts.length === 3 ? `${parts[1]} ${parts[2]}` : said;
}

/** "13 Oct": a day with its year left off, where the year is plain from the page. */
export function dayMonth(when: string | Date | null | undefined): string {
  const said = when instanceof Date || when ? daySaid(when) : '';
  const parts = said.split(' ');
  return parts.length === 3 ? `${parts[0]} ${parts[1]}` : said;
}

/** "13 Oct 2026, 14:05": a moment, as the day is written everywhere, with the time it was in India. */
export function dayTime(when: string | Date | null | undefined): string {
  if (!when) return '—';
  const at = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(at.getTime())) return String(when);
  if (isAbsentTimestamp(at.getTime())) return 'Shipped with the build';
  const local = new Date(at.getTime() + 330 * 60_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${daySaid(at)}, ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The day of the week a day falls on, as a word. A day written as a day (`2026-10-13`) is that day wherever it is read. */
export function weekday(when: string | Date): string {
  const at = when instanceof Date ? new Date(when.getTime() + 330 * 60_000) : new Date(`${when.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : WEEKDAYS[at.getUTCDay()]!;
}

function trim(n: number): string {
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(r);
}

export function perSqm(value: number | null | undefined, currency: CurrencyCode): string {
  if (value === null || value === undefined) return '—';
  return `${amount(value, currency)}/m²`;
}

/** A percentage: at most two decimals, and its sign against the figure. */
export function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${percentSaid(value, Math.min(digits, 2))}`;
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
  // One way to write a day, wherever it is read: 13 Oct 2026.
  void style;
  return daySaid(d);
}

/**
 * A value as a paper's reading wrote it, said the way every figure is.
 *
 * A reader hands back what it read with a display of its own making:
 * "1215000 INR", "2026-10-09", "6070 sqm". Those are the same amounts, days
 * and areas the fields print, so they are written the same way here: rupees
 * in lakh and crore, a day as 9 Oct 2026, a figure grouped with its unit.
 * Anything else is given back as it came, word for word.
 */
export function readingSaid(display: string): string {
  const text = display.trim();
  const figure = (digits: string) => Number(digits.replace(/,/g, ''));
  const rupees = /^(?:INR|Rs\.?|₹)\s*(-?[\d,]+(?:\.\d+)?)$|^(-?[\d,]+(?:\.\d+)?)\s*(?:INR|Rs\.?|rupees)$/i.exec(text);
  if (rupees) return formatMoney(figure(rupees[1] ?? rupees[2]!), 'INR');
  if (looksLikeDay(text)) return daySaid(text);
  const share = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (share) return percentSaid(Number(share[1]));
  const measured = /^(\d{4,}(?:\.\d+)?)\s+([a-z][a-z .]*)$/i.exec(text);
  if (measured) return `${figure(measured[1]!).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${measured[2]}`;
  return display;
}

/**
 * Who did something, as a page says it. With sign-in off every request is
 * the machine's own operator, whose address is not a person's and is not
 * printed: whoever is at the machine did it, so it reads "you".
 */
export function person(who: string | null | undefined): string {
  if (!who) return '';
  return /@localhost$/i.test(who.trim()) ? 'you' : who;
}

/**
 * Who typed, accepted, issued or took something, as a line names them: the
 * name the project's team gives them, else the name part of their address.
 * No line prints an address.
 */
export function personNamed(project: Pick<DdProject, 'team'> | undefined, who: string | null | undefined): string {
  return person(personSaid(project, who ?? undefined));
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
