import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Compass,
  CornerUpRight,
  Fence,
  LandPlot,
  Landmark,
  MapPin,
  Scale,
  Sprout,
  Waves,
} from 'lucide-react';
import type {
  AreaBasis,
  CountryCode,
  CreateCaseRequest,
  CurrencyCode,
  KarnatakaAttributes,
  KarnatakaJurisdiction,
  KhataType,
  LandConversionStatus,
  LayoutApproval,
  LocalityReference,
  PersonaKey,
  PlotAttributes,
  PlotFacing,
  PropertyIdentity,
  PropertyType,
  ReferenceData,
  Tenure,
} from '@realytica/shared';
import { COUNTRY_PACKS_META, PERSONAS, PROPERTY_TYPES } from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { PROPERTY_TYPE_LABEL, money, pct } from '../lib/format';
import { defaultAreaUnit, describeAreaBasis, formatArea, formatRate, sqftToSqm, sqmToSqft, type AreaUnit } from '../lib/units';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  KeyValue,
  Select,
  Textarea,
  cn,
  useToast,
} from '../components/ui/kit';
import { UnitToggle } from '../components/UnitToggle';
import {
  FACING_LABEL,
  LAYOUT_APPROVAL_LABEL,
  PREMIUM_FACINGS,
  RISKY_LAYOUT_APPROVALS,
  isLandPropertyType,
} from '../components/PlotFactsCard';

const TENURE_OPTIONS: { value: Tenure; label: string }[] = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'unknown', label: 'Unknown' },
];

const CURRENCY_BY_COUNTRY: Record<CountryCode, CurrencyCode> = { IN: 'INR', NL: 'EUR' };

/* ------------------------------------------------------------------ */
/* Karnataka option content                                            */
/*                                                                      */
/* Labels/notes are defined locally rather than imported from           */
/* `@realytica/shared`: a parallel agent owns `packages/shared/src/`     */
/* label maps (KHATA_TYPE_LABEL, JURISDICTION_LABEL, …) and they may     */
/* not exist on disk yet. The *types* (`KhataType`, `KarnatakaJurisdiction`,   */
/* etc.) are already in the shared contract, so this file only supplies */
/* its own UI copy against those types — safe to keep even after the    */
/* shared label maps land, since the copy here is wizard-specific       */
/* (a one-line "what this means" note per option, not just a label).    */
/* ------------------------------------------------------------------ */

const JURISDICTION_OPTIONS: { value: KarnatakaJurisdiction; label: string; note: string }[] = [
  { value: 'BBMP', label: 'BBMP', note: 'Bengaluru municipal corporation — plan sanction and property tax run through BBMP directly.' },
  { value: 'BDA', label: 'BDA', note: 'Bangalore Development Authority — for BDA-formed layouts and sites; approvals run through BDA.' },
  { value: 'BMRDA', label: 'BMRDA', note: 'Metropolitan region authority for peripheral areas outside BBMP/BDA — approvals are typically slower.' },
  { value: 'BIAAPA', label: 'BIAAPA', note: 'Airport-influence-area authority — extra height and land-use restrictions can apply.' },
  { value: 'gram_panchayat', label: 'Gram panchayat', note: "Village-level local body — outside urban planning jurisdiction; recorded via Form 9 & 11, not a khata." },
  { value: 'unknown', label: 'Unknown', note: 'Not yet confirmed — the applicable authority determines which approvals and records are valid.' },
];

const KHATA_OPTIONS: { value: KhataType; label: string; note: string }[] = [
  { value: 'a_khata', label: 'A-khata', note: 'Fully compliant with BBMP bye-laws — eligible for plan sanction, bank loans and clean resale.' },
  { value: 'b_khata', label: 'B-khata', note: 'Recorded for tax purposes only, not fully compliant — restricts lending, plan sanction and resale.' },
  { value: 'e_khata', label: 'e-Khata', note: "Digitised BBMP khata record — confirm it reflects current ownership before relying on it." },
  { value: 'gram_panchayat_form_9_11', label: 'Gram panchayat (Form 9 & 11)', note: "Village-panchayat property record, not a BBMP khata." },
  { value: 'none', label: 'None', note: 'No khata on record — a significant gap; financing and resale are typically blocked until resolved.' },
  { value: 'unknown', label: 'Unknown', note: 'Not yet confirmed — this is the single most consequential field for a Bengaluru property.' },
];

const LAND_CONVERSION_OPTIONS: { value: LandConversionStatus; label: string; note: string }[] = [
  { value: 'converted', label: 'Converted', note: 'DC conversion order obtained — cleared for non-agricultural (residential/commercial) use.' },
  { value: 'agricultural', label: 'Agricultural', note: 'Still agricultural revenue land — needs a DC conversion order before non-agricultural use.' },
  { value: 'not_applicable', label: 'Not applicable', note: 'Conversion does not apply, e.g. already inside an approved urban layout.' },
  { value: 'unknown', label: 'Unknown', note: 'Not yet confirmed — needed to know before assuming residential/commercial use is lawful.' },
];

const AREA_BASIS_OPTIONS: { value: AreaBasis; label: string }[] = [
  { value: 'carpet', label: 'Carpet area' },
  { value: 'built_up', label: 'Built-up area' },
  { value: 'super_built_up', label: 'Super built-up area' },
  { value: 'unknown', label: 'Unknown' },
];

const BBMP_TAX_ZONE_OPTIONS: ('A' | 'B' | 'C' | 'D' | 'E' | 'F')[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Warning tint for the B-khata treatments. Plain Tailwind alpha utilities,
 * which compile correctly now that the tone tokens are declared as RGB channel
 * triplets in index.css.
 */
const WARNING_TINT_BG = 'bg-warning/15';
const WARNING_TINT_RING = 'ring-warning/45';

function jurisdictionLabel(v: KarnatakaJurisdiction): string {
  return JURISDICTION_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
function khataLabel(v: KhataType): string {
  return KHATA_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
function landConversionLabel(v: LandConversionStatus): string {
  return LAND_CONVERSION_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
function areaBasisLabel(v: AreaBasis): string {
  return AREA_BASIS_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

/* ------------------------------------------------------------------ */
/* Site (plot) option content                                          */
/*                                                                      */
/* Base labels (FACING_LABEL, LAYOUT_APPROVAL_LABEL, …) come from        */
/* PlotFactsCard.tsx — a file this agent also owns — so the wizard and   */
/* the read-only facts card never drift apart. The one-line "what this   */
/* means" notes are wizard-specific and defined only here, same as the   */
/* Karnataka options above.                                              */
/* ------------------------------------------------------------------ */

const LAYOUT_APPROVAL_NOTES: Record<LayoutApproval, string> = {
  bda_approved: 'Approved by the Bangalore Development Authority — the strongest layout status; financing and resale are straightforward.',
  bmrda_approved: 'Approved by the metropolitan regional authority — generally financeable, though less liquid than a BDA layout.',
  panchayat_approved: 'Approved by the local gram panchayat — financing is possible, but lenders scrutinise these more closely.',
  private_approved: 'A private developer layout with plan sanction — usually financeable if the sanction is genuine and verifiable.',
  revenue_layout: 'Formed on revenue (agricultural) land without a layout conversion — hard to finance and hard to resell.',
  unapproved: 'No layout approval on record — expect financing to be refused and resale to be difficult.',
  unknown: 'Not yet confirmed — Property Screen will report this as an unresolved title/planning question.',
};

const LAYOUT_APPROVAL_OPTIONS: { value: LayoutApproval; label: string; note: string }[] = (
  Object.keys(LAYOUT_APPROVAL_LABEL) as LayoutApproval[]
).map((value) => ({ value, label: LAYOUT_APPROVAL_LABEL[value], note: LAYOUT_APPROVAL_NOTES[value] }));

/** 3×3 grid position for each compass direction; the centre cell doubles as "Unknown". */
const COMPASS_CELLS: { value: PlotFacing; label: string; col: number; row: number }[] = [
  { value: 'north_west', label: 'NW', col: 1, row: 1 },
  { value: 'north', label: 'N', col: 2, row: 1 },
  { value: 'north_east', label: 'NE', col: 3, row: 1 },
  { value: 'west', label: 'W', col: 1, row: 2 },
  { value: 'unknown', label: '?', col: 2, row: 2 },
  { value: 'east', label: 'E', col: 3, row: 2 },
  { value: 'south_west', label: 'SW', col: 1, row: 3 },
  { value: 'south', label: 'S', col: 2, row: 3 },
  { value: 'south_east', label: 'SE', col: 3, row: 3 },
];

/** Compact compass selector for `PlotFacing` — every cell is a real, labelled button. */
function CompassPicker({ value, onChange }: { value: PlotFacing; onChange: (v: PlotFacing) => void }) {
  return (
    <div role="group" aria-label="Plot facing" className="grid w-max grid-cols-3 grid-rows-3 gap-1.5">
      {COMPASS_CELLS.map((cell) => {
        const active = value === cell.value;
        const premium = PREMIUM_FACINGS.includes(cell.value);
        return (
          <button
            key={cell.value}
            type="button"
            onClick={() => onChange(cell.value)}
            style={{ gridColumn: cell.col, gridRow: cell.row }}
            aria-label={`${FACING_LABEL[cell.value]}${premium ? ' — premium facing in this market' : ''}`}
            aria-pressed={active}
            title={FACING_LABEL[cell.value]}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset transition-colors',
              active ? 'bg-brand-soft text-brand ring-2 ring-brand' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:bg-sunken',
              cell.value === 'unknown' && 'text-[10px]',
            )}
          >
            {cell.label}
            {premium ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Review-step area cell: leads with whatever unit the wizard is currently
 * showing (respecting the country default / the user's in-wizard override),
 * with the sqm equivalent alongside only when that's not already the primary
 * — mirrors the "show the converted m² underneath" treatment used on the
 * identification step, without flipping an NL case to a sq ft-first display.
 */
function reviewAreaValue(sqm: number, unit: AreaUnit) {
  if (unit === 'sqm') return formatArea(sqm, 'sqm');
  return (
    <span>
      {formatArea(sqm, 'sqft')}
      <span className="ml-1.5 text-ink-muted">({formatArea(sqm, 'sqm')})</span>
    </span>
  );
}

function isKarnatakaState(country: CountryCode, state: string): boolean {
  return country === 'IN' && state.trim().toLowerCase() === 'karnataka';
}

/** Builds the `PlotAttributes` payload from the wizard's text-field draft state. */
function buildPlotAttributes(p: PlotFormState): PlotAttributes {
  const width = Number(p.dimensionsWidthFt);
  const depth = Number(p.dimensionsDepthFt);
  const hasDimensions = p.dimensionsWidthFt.trim() !== '' && p.dimensionsDepthFt.trim() !== '' && width > 0 && depth > 0;
  const roadWidth = Number(p.roadWidthFt);
  const hasRoadWidth = p.roadWidthFt.trim() !== '' && !Number.isNaN(roadWidth) && roadWidth >= 0;
  return {
    roadWidthFt: hasRoadWidth ? roadWidth : undefined,
    cornerSite: p.cornerSite,
    facing: p.facing,
    dimensionsFt: hasDimensions ? { width, depth } : undefined,
    layoutApproval: p.layoutApproval,
    demarcated: p.demarcated,
  };
}

/* ------------------------------------------------------------------ */
/* Form state                                                          */
/* ------------------------------------------------------------------ */

interface KarnatakaFormState {
  jurisdiction: KarnatakaJurisdiction;
  khataType: KhataType;
  eKhataIssued: boolean;
  landConversionStatus: LandConversionStatus;
  areaBasis: AreaBasis;
  bbmpTaxZone: '' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  kreraNumber: string;
  nearRajakaluve: boolean;
  nearLake: boolean;
  grantedLandPtcl: boolean;
}

function initialKarnataka(): KarnatakaFormState {
  return {
    jurisdiction: 'unknown',
    khataType: 'unknown',
    eKhataIssued: false,
    landConversionStatus: 'unknown',
    // Bengaluru listings default to quoting super built-up area — see describeAreaBasis().
    areaBasis: 'super_built_up',
    bbmpTaxZone: '',
    kreraNumber: '',
    nearRajakaluve: false,
    nearLake: false,
    grantedLandPtcl: false,
  };
}

interface PlotFormState {
  /** Text, in feet — the wizard's own number-field convention (parsed only at submit time). */
  roadWidthFt: string;
  cornerSite: boolean;
  facing: PlotFacing;
  dimensionsWidthFt: string;
  dimensionsDepthFt: string;
  layoutApproval: LayoutApproval;
  demarcated: boolean;
}

function initialPlot(): PlotFormState {
  return {
    roadWidthFt: '',
    cornerSite: false,
    facing: 'unknown',
    dimensionsWidthFt: '',
    dimensionsDepthFt: '',
    layoutApproval: 'unknown',
    demarcated: false,
  };
}

interface FormState {
  country: CountryCode;
  persona: PersonaKey | null;
  ownerName: string;
  label: string;
  state: string;
  city: string;
  locality: string;
  addressLine: string;
  postalCode: string;
  parcelId: string;
  propertyType: PropertyType;
  tenure: Tenure;
  /** Numeric text, expressed in whatever `areaUnit` currently is — converted to sqm only at submit/toggle time. */
  builtUpArea: string;
  plotArea: string;
  yearBuilt: string;
  floor: string;
  totalFloors: string;
  askingPrice: string;
  notes: string;
  karnataka: KarnatakaFormState;
  plot: PlotFormState;
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');
}

function initialForm(): FormState {
  return {
    country: 'IN',
    persona: null,
    ownerName: nameFromEmail('sandeep@gnanalytica.com'),
    label: '',
    state: '',
    city: '',
    locality: '',
    addressLine: '',
    postalCode: '',
    parcelId: '',
    propertyType: 'residential_apartment',
    tenure: 'freehold',
    builtUpArea: '',
    plotArea: '',
    yearBuilt: '',
    floor: '',
    totalFloors: '',
    askingPrice: '',
    notes: '',
    karnataka: initialKarnataka(),
    plot: initialPlot(),
  };
}

/** A non-negative number field: rejects "-" at the input level and blank/negative on validation. */
function NumberField(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  id?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={props.id}
        inputMode="decimal"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || /^\d*\.?\d*$/.test(v)) props.onChange(v);
        }}
        className={props.suffix ? (props.suffix.length > 2 ? 'pr-12' : 'pr-10') : undefined}
      />
      {props.suffix ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-muted">{props.suffix}</span>
      ) : null}
    </div>
  );
}

function Stepper({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="mb-6 flex items-center">
      {labels.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={label} className={cn('flex items-center', i < labels.length - 1 && 'flex-1')}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                  state === 'done' && 'bg-brand text-brand-ink',
                  state === 'active' && 'bg-brand-soft text-brand ring-2 ring-brand',
                  state === 'todo' && 'bg-sunken text-ink-muted',
                )}
              >
                {state === 'done' ? <Check size={13} /> : i + 1}
              </div>
              <span className={cn('hidden text-[13px] font-medium sm:inline', state === 'todo' ? 'text-ink-muted' : 'text-ink')}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 ? (
              <div className={cn('mx-3 h-px flex-1', state === 'done' ? 'bg-brand' : 'bg-hairline')} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function NewCase() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: reference, error: referenceError } = useAsync<ReferenceData>(() => api.reference(), []);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // The area unit is a wizard-local, transient choice (not the persisted
  // dashboard-wide preference from lib/units.ts) — it defaults from the
  // country being entered and resets when the country changes, unless the
  // user has explicitly overridden it for this case.
  const [areaUnit, setAreaUnitState] = useState<AreaUnit>(() => defaultAreaUnit(initialForm().country));
  const [areaUnitTouched, setAreaUnitTouched] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setKarnataka<K extends keyof KarnatakaFormState>(key: K, value: KarnatakaFormState[K]) {
    setForm((f) => ({ ...f, karnataka: { ...f.karnataka, [key]: value } }));
  }

  function setPlot<K extends keyof PlotFormState>(key: K, value: PlotFormState[K]) {
    setForm((f) => ({ ...f, plot: { ...f.plot, [key]: value } }));
  }

  const countryPack = reference?.countryPacks.find((p) => p.country === form.country);
  const currency = countryPack?.currency ?? CURRENCY_BY_COUNTRY[form.country];
  const parcelIdLabel = countryPack?.parcelIdLabel ?? 'Parcel / survey ID';

  const isKarnataka = isKarnatakaState(form.country, form.state);
  // Land is priced per sq ft of land, not built-up area — residential_plot and
  // land_parcel are the two types that carry site-level attributes.
  const isLandType = isLandPropertyType(form.propertyType);

  const stepLabels = useMemo(() => {
    const labels = ['Market & intent', 'Property identification'];
    if (isLandType) labels.push('Site details');
    if (isKarnataka) labels.push('Karnataka details');
    labels.push('Review & create');
    return labels;
  }, [isLandType, isKarnataka]);
  const siteStepIndex = isLandType ? 2 : -1;
  const karnatakaStepIndex = isKarnataka ? (isLandType ? 3 : 2) : -1;
  const reviewStepIndex = stepLabels.length - 1;

  // Reset the wizard's area unit to the country default whenever the country
  // changes, unless the user has deliberately switched it — mirrors the
  // "sq ft for India, m² for NL" default without fighting a manual choice.
  useEffect(() => {
    if (!areaUnitTouched) setAreaUnitState(defaultAreaUnit(form.country));
  }, [form.country, areaUnitTouched]);

  function setAreaUnit(next: AreaUnit) {
    if (next === areaUnit) return;
    setAreaUnitTouched(true);
    setForm((f) => {
      const convert = (text: string): string => {
        const trimmed = text.trim();
        if (trimmed === '') return text;
        const n = Number(trimmed);
        if (Number.isNaN(n)) return text;
        const sqm = areaUnit === 'sqft' ? sqftToSqm(n) : n;
        if (next === 'sqft') return String(Math.round(sqm / 0.09290304));
        return String(Math.round(sqm * 10) / 10);
      };
      return { ...f, builtUpArea: convert(f.builtUpArea), plotArea: convert(f.plotArea) };
    });
    setAreaUnitState(next);
  }

  /** The value currently sitting in a text field, converted to canonical sqm. NaN-safe. */
  function toSqm(text: string): number {
    const n = Number(text.trim());
    if (text.trim() === '' || Number.isNaN(n)) return NaN;
    return areaUnit === 'sqft' ? sqftToSqm(n) : n;
  }

  const localities = useMemo(
    () => (reference?.localities ?? []).filter((l) => l.country === form.country),
    [reference, form.country],
  );

  const selectedLocality: LocalityReference | undefined = useMemo(
    () => localities.find((l) => l.locality.trim().toLowerCase() === form.locality.trim().toLowerCase()),
    [localities, form.locality],
  );

  function onLocalityChange(value: string) {
    set('locality', value);
    const match = localities.find((l) => l.locality.trim().toLowerCase() === value.trim().toLowerCase());
    if (match) {
      setForm((f) => ({ ...f, locality: value, state: match.state, city: match.city }));
    }
  }

  function onCountryChange(next: CountryCode) {
    setForm((f) => ({ ...f, country: next, state: '', city: '', locality: '' }));
  }

  function validateStep(index: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (index === 0) {
      if (!form.persona) e.persona = 'Choose the persona this case is being screened for.';
      if (!form.ownerName.trim()) e.ownerName = 'Enter the name of the case owner.';
    }
    if (index === 1) {
      if (!form.label.trim()) e.label = 'Give this case a short label.';
      if (!form.state.trim()) e.state = 'State is required.';
      if (!form.city.trim()) e.city = 'City is required.';
      if (!form.locality.trim()) e.locality = 'Locality is required.';
      if (!form.addressLine.trim()) e.addressLine = 'Address line is required.';
      if (!form.postalCode.trim()) e.postalCode = 'Postal code is required.';
      if (!form.parcelId.trim()) e.parcelId = `${parcelIdLabel} is required.`;

      const builtUp = form.builtUpArea.trim();
      const plot = form.plotArea.trim();
      const areaUnitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';
      if (builtUp === '') e.builtUpArea = `Enter the built-up area in ${areaUnitLabel} (0 if not applicable).`;
      else if (Number(builtUp) < 0) e.builtUpArea = 'Area cannot be negative.';
      if (plot === '') e.plotArea = `Enter the plot area in ${areaUnitLabel} (0 if not applicable).`;
      else if (Number(plot) < 0) e.plotArea = 'Area cannot be negative.';
      if (builtUp !== '' && plot !== '' && Number(builtUp) === 0 && Number(plot) === 0) {
        e.builtUpArea = 'At least one of built-up or plot area must be greater than zero.';
      }

      if (form.yearBuilt.trim()) {
        const y = Number(form.yearBuilt);
        const maxYear = new Date().getFullYear() + 1;
        if (!Number.isInteger(y) || y < 1800 || y > maxYear) e.yearBuilt = `Enter a year between 1800 and ${maxYear}.`;
      }
      if (form.floor.trim() && Number(form.floor) < 0) e.floor = 'Floor cannot be negative.';
      if (form.totalFloors.trim() && Number(form.totalFloors) < 0) e.totalFloors = 'Total floors cannot be negative.';
      if (form.floor.trim() && form.totalFloors.trim() && Number(form.floor) > Number(form.totalFloors)) {
        e.floor = 'Floor cannot exceed total floors.';
      }
      if (form.askingPrice.trim() && Number(form.askingPrice) <= 0) {
        e.askingPrice = 'Asking price must be greater than zero, or left blank.';
      }
    }
    // Site details step (index === siteStepIndex when present) and Karnataka step
    // (index === karnatakaStepIndex when present): every field is optional — a
    // user who knows none of it can still proceed, and the engine will report
    // those checks as unresolved rather than blocking case creation. Facing and
    // layout approval always carry a value (defaulted to "unknown"), so there is
    // nothing to require there either.
    return e;
  }

  function attemptNext() {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, stepLabels.length - 1));
  }

  function goBack() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleCreate() {
    if (!form.persona) return;
    setCreating(true);
    try {
      // Convert once, from the authoritative text the user last typed, using the
      // exact ft->m factor — never round-tripped through an already-rounded
      // intermediate, so the sqm figure sent to the API is as precise as the
      // input allows. Rounded to 2 decimals only for a clean payload value
      // (well below any real survey tolerance).
      const builtUpAreaSqm = Math.round((toSqm(form.builtUpArea) || 0) * 100) / 100;
      const plotAreaSqm = Math.round((toSqm(form.plotArea) || 0) * 100) / 100;

      const plot: PlotAttributes | undefined = isLandType ? buildPlotAttributes(form.plot) : undefined;

      const karnataka: KarnatakaAttributes | undefined = isKarnataka
        ? {
            jurisdiction: form.karnataka.jurisdiction,
            khataType: form.karnataka.khataType,
            eKhataIssued: form.karnataka.eKhataIssued,
            landConversionStatus: form.karnataka.landConversionStatus,
            areaBasis: form.karnataka.areaBasis,
            bbmpTaxZone: form.karnataka.bbmpTaxZone || undefined,
            kreraNumber: form.karnataka.kreraNumber.trim() || undefined,
            nearRajakaluve: form.karnataka.nearRajakaluve,
            nearLake: form.karnataka.nearLake,
            grantedLandPtcl: form.karnataka.grantedLandPtcl,
          }
        : undefined;

      const identity: PropertyIdentity = {
        label: form.label.trim(),
        country: form.country,
        state: form.state.trim(),
        city: form.city.trim(),
        locality: form.locality.trim(),
        addressLine: form.addressLine.trim(),
        postalCode: form.postalCode.trim(),
        parcelId: form.parcelId.trim(),
        propertyType: form.propertyType,
        tenure: form.tenure,
        builtUpAreaSqm,
        plotAreaSqm,
        yearBuilt: form.yearBuilt.trim() ? Number(form.yearBuilt) : undefined,
        floor: form.floor.trim() ? Number(form.floor) : undefined,
        totalFloors: form.totalFloors.trim() ? Number(form.totalFloors) : undefined,
        askingPrice: form.askingPrice.trim() ? Number(form.askingPrice) : undefined,
        currency,
        plot,
        karnataka,
      };
      const body: CreateCaseRequest = {
        identity,
        ownerName: form.ownerName.trim(),
        persona: form.persona,
        notes: form.notes.trim() || undefined,
      };
      const created = await api.createCase(body);
      toast(`Case ${created.reference} created`, 'good');
      navigate(`/cases/${created.id}/documents`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the case', 'critical');
    } finally {
      setCreating(false);
    }
  }

  const builtUpSqmLive = toSqm(form.builtUpArea);
  const plotAreaSqmEntered = toSqm(form.plotArea);
  // A plot is priced on land area, not built-up area (which may legitimately be
  // zero) — the live sanity check and the review step's implied rate both key
  // off whichever area actually prices this property type.
  const areaForImpliedRate = isLandType ? plotAreaSqmEntered : builtUpSqmLive;
  const impliedPricePerSqm =
    form.askingPrice.trim() && areaForImpliedRate > 0 ? Number(form.askingPrice) / areaForImpliedRate : null;

  // Dimensions-vs-plot-area sanity check — dimensions are captured natively in
  // feet (a "30×40 site" is already feet), so the implied area is computed in
  // sq ft and the entered plot area is converted to sq ft for a like-for-like
  // comparison, whatever unit the wizard is currently displaying.
  const dimsWidthNum = Number(form.plot.dimensionsWidthFt);
  const dimsDepthNum = Number(form.plot.dimensionsDepthFt);
  const hasDims =
    form.plot.dimensionsWidthFt.trim() !== '' && form.plot.dimensionsDepthFt.trim() !== '' && dimsWidthNum > 0 && dimsDepthNum > 0;
  const dimsAreaSqft = hasDims ? dimsWidthNum * dimsDepthNum : null;
  const dimsAreaSqm = dimsAreaSqft !== null ? sqftToSqm(dimsAreaSqft) : null;
  const plotAreaSqftEntered = Number.isNaN(plotAreaSqmEntered) ? null : sqmToSqft(plotAreaSqmEntered);
  const areaMismatchPct =
    dimsAreaSqft !== null && plotAreaSqftEntered !== null && plotAreaSqftEntered > 0
      ? ((dimsAreaSqft - plotAreaSqftEntered) / plotAreaSqftEntered) * 100
      : null;
  // "A few percent" — flag anything beyond ordinary rounding/survey slack.
  const areaMismatch = areaMismatchPct !== null && Math.abs(areaMismatchPct) > 5;

  const builtUpAreaField = (
    <Field
      key="builtUpArea"
      label="Built-up area"
      required
      error={errors.builtUpArea}
      htmlFor="builtUpAreaSqm"
      hint={
        isLandType
          ? 'Usually 0 for a plot — value comes from land area, not built-up area.'
          : areaUnit === 'sqft' && !errors.builtUpArea && form.builtUpArea.trim() !== ''
            ? `≈ ${formatArea(toSqm(form.builtUpArea) || 0, 'sqm')}`
            : undefined
      }
    >
      <NumberField
        id="builtUpAreaSqm"
        value={form.builtUpArea}
        onChange={(v) => set('builtUpArea', v)}
        suffix={areaUnit === 'sqft' ? 'sq ft' : 'm²'}
      />
    </Field>
  );

  const plotAreaField = (
    <Field
      key="plotArea"
      label="Plot area"
      required
      error={errors.plotArea}
      htmlFor="plotAreaSqm"
      hint={
        isLandType
          ? 'Primary area for this property — used directly in its land-rate valuation.'
          : areaUnit === 'sqft' && !errors.plotArea && form.plotArea.trim() !== ''
            ? `≈ ${formatArea(toSqm(form.plotArea) || 0, 'sqm')}`
            : undefined
      }
    >
      <NumberField
        id="plotAreaSqm"
        value={form.plotArea}
        onChange={(v) => set('plotArea', v)}
        suffix={areaUnit === 'sqft' ? 'sq ft' : 'm²'}
      />
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Stepper current={step} labels={stepLabels} />

      {step === 0 ? (
        <Card>
          <CardHeader title="Market & intent" />
          <CardBody className="space-y-5">
            <Field label="Country" required>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {COUNTRY_PACKS_META.map((c) => (
                  <button
                    key={c.country}
                    type="button"
                    onClick={() => onCountryChange(c.country)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg p-3 text-left ring-1 ring-inset transition-colors',
                      form.country === c.country ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
                    )}
                  >
                    <Landmark size={16} className="mt-0.5 shrink-0 text-ink-muted" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{c.countryName}</span>
                      <span className="block text-xs text-ink-secondary">
                        {CURRENCY_BY_COUNTRY[c.country]} · {c.phase}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Persona" required error={errors.persona} hint="Drives which value anchors and risk lenses the screen leads with.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PERSONAS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => set('persona', p.key)}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg p-3 text-left ring-1 ring-inset transition-colors',
                      form.persona === p.key ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
                    )}
                  >
                    <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                    <span className="text-xs leading-snug text-ink-secondary">{p.description}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Your name" required error={errors.ownerName} htmlFor="ownerName" hint="Recorded as the case owner.">
              <Input id="ownerName" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder="e.g. Sandeep" />
            </Field>
          </CardBody>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader
            title="Property identification"

            icon={<Building2 size={16} />}
            action={<UnitToggle value={areaUnit} onChange={setAreaUnit} />}
          />
          <CardBody className="space-y-5">
            {referenceError ? (
              <Callout tone="warning" title="Reference data unavailable">
                Locality suggestions and median-price context are disabled, but you can still fill this in by hand: {referenceError}
              </Callout>
            ) : null}

            <Field label="Label" required error={errors.label} htmlFor="label" hint="A short human name, e.g. “3BHK — Prestige Lakeside”.">
              <Input id="label" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Case label" />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="State / province" required error={errors.state} htmlFor="state">
                <Input id="state" value={form.state} onChange={(e) => set('state', e.target.value)} />
              </Field>
              <Field label="City" required error={errors.city} htmlFor="city">
                <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
            </div>

            <Field
              label="Locality"
              required
              error={errors.locality}
              htmlFor="locality"
              hint={
                selectedLocality
                  ? isLandType
                    ? `Land rate: ${formatRate(selectedLocality.medianLandRatePerSqm, areaUnit, selectedLocality.currency)} · Statutory land rate: ${formatRate(
                        selectedLocality.statutoryLandRatePerSqm,
                        areaUnit,
                        selectedLocality.currency,
                      )} — per unit of plot area, not built-up area.`
                    : `Median: ${formatRate(selectedLocality.medianPricePerSqm, areaUnit, selectedLocality.currency)} · Statutory rate: ${formatRate(
                        selectedLocality.statutoryRatePerSqm,
                        areaUnit,
                        selectedLocality.currency,
                      )}`
                  : 'Pick from suggestions to prefill state/city and see market context.'
              }
            >
              <Input
                id="locality"
                list="locality-suggestions"
                value={form.locality}
                onChange={(e) => onLocalityChange(e.target.value)}
                placeholder="Start typing a locality…"
              />
              <datalist id="locality-suggestions">
                {localities.map((l) => (
                  <option key={l.id} value={l.locality} />
                ))}
              </datalist>
            </Field>

            <Field label="Address line" required error={errors.addressLine} htmlFor="addressLine">
              <Input id="addressLine" value={form.addressLine} onChange={(e) => set('addressLine', e.target.value)} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Postal code" required error={errors.postalCode} htmlFor="postalCode">
                <Input id="postalCode" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
              </Field>
              <Field label={parcelIdLabel} required error={errors.parcelId} htmlFor="parcelId">
                <Input id="parcelId" value={form.parcelId} onChange={(e) => set('parcelId', e.target.value)} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Property type" required htmlFor="propertyType">
                <Select
                  id="propertyType"
                  value={form.propertyType}
                  onChange={(e) => set('propertyType', e.target.value as PropertyType)}
                >
                  {PROPERTY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PROPERTY_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tenure" required htmlFor="tenure">
                <Select id="tenure" value={form.tenure} onChange={(e) => set('tenure', e.target.value as Tenure)}>
                  {TENURE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {isLandType ? (
                <>
                  {plotAreaField}
                  {builtUpAreaField}
                </>
              ) : (
                <>
                  {builtUpAreaField}
                  {plotAreaField}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Year built" error={errors.yearBuilt} htmlFor="yearBuilt" hint="Optional">
                <NumberField id="yearBuilt" value={form.yearBuilt} onChange={(v) => set('yearBuilt', v)} placeholder="e.g. 2015" />
              </Field>
              <Field label="Floor" error={errors.floor} htmlFor="floor" hint="Optional">
                <NumberField id="floor" value={form.floor} onChange={(v) => set('floor', v)} />
              </Field>
              <Field label="Total floors" error={errors.totalFloors} htmlFor="totalFloors" hint="Optional">
                <NumberField id="totalFloors" value={form.totalFloors} onChange={(v) => set('totalFloors', v)} />
              </Field>
            </div>

            <Field
              label={`Asking price (${currency})`}
              error={errors.askingPrice}
              htmlFor="askingPrice"
              hint="Optional — Realytica screens fine without one. When given, it is treated as a claim to test against the evidence, not as evidence itself."
            >
              <NumberField id="askingPrice" value={form.askingPrice} onChange={(v) => set('askingPrice', v)} />
            </Field>

            {selectedLocality || impliedPricePerSqm ? (
              <Callout tone="info" title="Live sanity check">
                {selectedLocality ? (
                  <p>
                    {isLandType ? 'Locality land rate' : 'Locality median'}:{' '}
                    <span className="font-medium text-ink">
                      {formatRate(
                        isLandType ? selectedLocality.medianLandRatePerSqm : selectedLocality.medianPricePerSqm,
                        areaUnit,
                        currency,
                      )}
                    </span>
                  </p>
                ) : null}
                {impliedPricePerSqm ? (
                  <p className="mt-0.5">
                    Your asking price implies{' '}
                    <span className="font-medium text-ink">{formatRate(impliedPricePerSqm, areaUnit, currency)}</span>
                    {isLandType ? ' per unit of plot area' : ''}
                    {selectedLocality
                      ? (() => {
                          const benchmark = isLandType ? selectedLocality.medianLandRatePerSqm : selectedLocality.medianPricePerSqm;
                          return ` — ${pct(((impliedPricePerSqm - benchmark) / benchmark) * 100, 0, true)} vs the locality ${
                            isLandType ? 'land rate' : 'median'
                          }.`;
                        })()
                      : '.'}
                  </p>
                ) : null}
              </Callout>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {isLandType && step === siteStepIndex ? (
        <Card>
          <CardHeader
            title="Site details"

            icon={<LandPlot size={16} />}
          />
          <CardBody className="space-y-6">
            <Callout tone="neutral" title="Everything here is optional">
              Facing and layout approval default to "Unknown" so the case can still be created — Property Screen will report the rest as
              unresolved rather than block case creation. But the more you can confirm now, the sharper the screen.
            </Callout>

            <Field label="Plot dimensions" hint="In feet — a “30×40 site” is already feet, captured natively and never converted.">
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  id="plotWidthFt"
                  value={form.plot.dimensionsWidthFt}
                  onChange={(v) => setPlot('dimensionsWidthFt', v)}
                  placeholder="Width"
                  suffix="ft"
                />
                <NumberField
                  id="plotDepthFt"
                  value={form.plot.dimensionsDepthFt}
                  onChange={(v) => setPlot('dimensionsDepthFt', v)}
                  placeholder="Depth"
                  suffix="ft"
                />
              </div>
              {hasDims ? (
                <p className="mt-1.5 text-xs text-ink-secondary">
                  Implied area:{' '}
                  <span className="font-medium text-ink">{Math.round(dimsAreaSqft ?? 0).toLocaleString('en-IN')} sq ft</span>
                  <span className="text-ink-muted"> ({formatArea(dimsAreaSqm, 'sqm')})</span> — compare against the plot area entered on
                  the previous step.
                </p>
              ) : null}
            </Field>

            {areaMismatch ? (
              <Callout tone="warning" title="Dimensions don't match the plot area you entered">
                {form.plot.dimensionsWidthFt} × {form.plot.dimensionsDepthFt} ft implies{' '}
                <span className="font-medium text-ink">{Math.round(dimsAreaSqft ?? 0).toLocaleString('en-IN')} sq ft</span> —{' '}
                <span className="font-medium text-ink">{pct(Math.abs(areaMismatchPct ?? 0), 0)}</span>{' '}
                {(areaMismatchPct ?? 0) > 0 ? 'higher than' : 'lower than'} the{' '}
                {Math.round(plotAreaSqftEntered ?? 0).toLocaleString('en-IN')} sq ft plot area entered earlier. Worth double-checking — a
                gap this size is a real data-quality signal, not a rounding error.
              </Callout>
            ) : null}

            <Field label="Road width" hint="Affects both the achievable rate and the permissible FAR (floor area ratio).">
              <NumberField id="roadWidthFt" value={form.plot.roadWidthFt} onChange={(v) => setPlot('roadWidthFt', v)} suffix="ft" />
            </Field>

            <Field label="Site status" hint="Optional flags — confirm on survey, not from a listing.">
              <div className="space-y-2.5 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-[var(--ring)]">
                <Checkbox
                  checked={form.plot.cornerSite}
                  onChange={(v) => setPlot('cornerSite', v)}
                  label={
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        <CornerUpRight size={13} className="text-ink-muted" /> Corner site
                      </span>
                      <span className="text-xs text-ink-secondary">Corner sites carry a premium for frontage and access.</span>
                    </span>
                  }
                />
                <Checkbox
                  checked={form.plot.demarcated}
                  onChange={(v) => setPlot('demarcated', v)}
                  label={
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        <Fence size={13} className="text-ink-muted" /> Demarcated / in possession
                      </span>
                      <span className="text-xs text-ink-secondary">
                        Fenced and in undisputed possession — an unresolved boundary or possession dispute is a title risk.
                      </span>
                    </span>
                  }
                />
              </div>
            </Field>

            <Field
              label="Facing"
              hint="East and north-facing sites carry a measurable premium in this market — that's why it's asked."
            >
              <div className="flex flex-wrap items-start gap-4">
                <CompassPicker value={form.plot.facing} onChange={(v) => setPlot('facing', v)} />
                <p className="max-w-[15rem] text-xs leading-relaxed text-ink-secondary">
                  Currently: <span className="font-medium text-ink">{FACING_LABEL[form.plot.facing]}</span>
                  {PREMIUM_FACINGS.includes(form.plot.facing) ? (
                    <Badge tone="good" className="ml-1.5">
                      Premium
                    </Badge>
                  ) : null}
                  <br />
                  North, north-east and east (marked •) typically sell at a premium to other facings.
                </p>
              </div>
            </Field>

            <Field label="Layout approval" hint="Who approved the layout the site sits in — this drives both value and financeability.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {LAYOUT_APPROVAL_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setPlot('layoutApproval', o.value)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg p-2.5 text-left ring-1 ring-inset transition-colors',
                      form.plot.layoutApproval === o.value
                        ? RISKY_LAYOUT_APPROVALS.includes(o.value)
                          ? cn(WARNING_TINT_BG, 'ring-2 ring-warning')
                          : 'bg-brand-soft ring-2 ring-brand'
                        : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
                    )}
                  >
                    <span className="text-[13px] font-semibold text-ink">{o.label}</span>
                    <span className="text-xs leading-snug text-ink-secondary">{o.note}</span>
                  </button>
                ))}
              </div>
            </Field>

            {RISKY_LAYOUT_APPROVALS.includes(form.plot.layoutApproval) ? (
              <Callout tone="warning" title="This layout status is a material finding">
                {LAYOUT_APPROVAL_LABEL[form.plot.layoutApproval]} sites are <span className="font-medium text-ink">hard to finance</span>{' '}
                and <span className="font-medium text-ink">hard to resell</span>. Property Screen will treat this as a risk that needs
                resolving before the case can score well.
              </Callout>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {isKarnataka && step === karnatakaStepIndex ? (
        <Card>
          <CardHeader
            title="Karnataka details"

            icon={<Scale size={16} />}
          />
          <CardBody className="space-y-6">
            <Callout tone="neutral" title="Everything here is optional">
              Leave anything you don't know as "Unknown" — Property Screen will report those checks as unresolved rather than block case
              creation. But the more you can confirm now, the sharper the screen.
            </Callout>

            <Field label="Jurisdiction" hint="Which body's building and revenue rules the property actually falls under.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {JURISDICTION_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setKarnataka('jurisdiction', o.value)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg p-2.5 text-left ring-1 ring-inset transition-colors',
                      form.karnataka.jurisdiction === o.value
                        ? 'bg-brand-soft ring-2 ring-brand'
                        : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
                    )}
                  >
                    <span className="text-[13px] font-semibold text-ink">{o.label}</span>
                    <span className="text-xs leading-snug text-ink-secondary">{o.note}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Khata type"
              hint="The BBMP property-register entry. A vs B is the single biggest binary in a Bengaluru title screen."
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {KHATA_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setKarnataka('khataType', o.value)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg p-2.5 text-left ring-1 ring-inset transition-colors',
                      form.karnataka.khataType === o.value
                        ? o.value === 'b_khata'
                          ? cn(WARNING_TINT_BG, 'ring-2 ring-warning')
                          : 'bg-brand-soft ring-2 ring-brand'
                        : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
                    )}
                  >
                    <span className="text-[13px] font-semibold text-ink">{o.label}</span>
                    <span className="text-xs leading-snug text-ink-secondary">{o.note}</span>
                  </button>
                ))}
              </div>
            </Field>

            {form.karnataka.khataType === 'b_khata' ? (
              <Callout tone="warning" title="B-khata is a material finding">
                B-khata properties are recorded but not fully compliant. This restricts{' '}
                <span className="font-medium text-ink">bank lending</span>, <span className="font-medium text-ink">building plan sanction</span>{' '}
                and <span className="font-medium text-ink">resale</span>. Property Screen will treat this as a material title finding that
                needs resolving before the case can score well.
              </Callout>
            ) : null}

            <Field label="e-Khata issued" hint="The digitised BBMP record. A property without one can be blocked at registration.">
              <Checkbox
                checked={form.karnataka.eKhataIssued}
                onChange={(v) => setKarnataka('eKhataIssued', v)}
                label="An e-khata has been issued for this property"
              />
            </Field>

            <Field
              label="Land conversion status"
              hint="Agricultural land needs a DC conversion order before non-agricultural use."
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {LAND_CONVERSION_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setKarnataka('landConversionStatus', o.value)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg p-2.5 text-left ring-1 ring-inset transition-colors',
                      form.karnataka.landConversionStatus === o.value
                        ? 'bg-brand-soft ring-2 ring-brand'
                        : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      {o.value === 'agricultural' ? <Sprout size={13} className="text-ink-muted" /> : null}
                      {o.label}
                    </span>
                    <span className="text-xs leading-snug text-ink-secondary">{o.note}</span>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Area basis" htmlFor="areaBasis" hint={describeAreaBasis(form.karnataka.areaBasis)}>
                <Select
                  id="areaBasis"
                  value={form.karnataka.areaBasis}
                  onChange={(e) => setKarnataka('areaBasis', e.target.value as AreaBasis)}
                >
                  {AREA_BASIS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="BBMP tax zone" htmlFor="bbmpTaxZone" hint="Optional — sets the unit area value for property tax.">
                <Select
                  id="bbmpTaxZone"
                  value={form.karnataka.bbmpTaxZone}
                  onChange={(e) => setKarnataka('bbmpTaxZone', e.target.value as KarnatakaFormState['bbmpTaxZone'])}
                >
                  <option value="">Not known</option>
                  {BBMP_TAX_ZONE_OPTIONS.map((z) => (
                    <option key={z} value={z}>
                      Zone {z}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="K-RERA number" htmlFor="kreraNumber" hint="Optional — Karnataka RERA registration number, where the project is registered.">
              <Input
                id="kreraNumber"
                value={form.karnataka.kreraNumber}
                onChange={(e) => setKarnataka('kreraNumber', e.target.value)}
                placeholder="e.g. PRM/KA/RERA/1251/…"
              />
            </Field>

            <Field label="Site conditions" hint="Optional flags — each must be confirmed on survey, not assumed from a listing.">
              <div className="space-y-2.5 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-[var(--ring)]">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={form.karnataka.nearRajakaluve}
                    onChange={(v) => setKarnataka('nearRajakaluve', v)}
                    label={
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          <Waves size={13} className="text-ink-muted" /> Near a rajakaluve (storm-water drain)
                        </span>
                        <span className="text-xs text-ink-secondary">
                          Construction within the buffer is restricted and subject to demolition drives — confirm the buffer distance on
                          survey.
                        </span>
                      </span>
                    }
                  />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={form.karnataka.nearLake}
                    onChange={(v) => setKarnataka('nearLake', v)}
                    label={
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          <MapPin size={13} className="text-ink-muted" /> Near a lake boundary
                        </span>
                        <span className="text-xs text-ink-secondary">
                          Lake-buffer zones carry construction restrictions — confirm against the surveyed boundary, not what looks close on
                          a map.
                        </span>
                      </span>
                    }
                  />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={form.karnataka.grantedLandPtcl}
                    onChange={(v) => setKarnataka('grantedLandPtcl', v)}
                    label={
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          <Scale size={13} className="text-ink-muted" /> Granted land under the PTCL Act
                        </span>
                        <span className="text-xs text-ink-secondary">
                          Land originally granted to an SC/ST grantee carries transfer restrictions that can void a later sale — confirm the
                          grant history.
                        </span>
                      </span>
                    }
                  />
                </div>
              </div>
            </Field>
          </CardBody>
        </Card>
      ) : null}

      {step === reviewStepIndex ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Review" />
            <CardBody>
              <dl>
                <KeyValue label="Country" value={form.country === 'IN' ? 'India' : 'Netherlands'} />
                <KeyValue label="Persona" value={PERSONAS.find((p) => p.key === form.persona)?.label ?? '—'} />
                <KeyValue label="Owner" value={form.ownerName || '—'} />
                <KeyValue label="Label" value={form.label || '—'} />
                <KeyValue
                  label="Address"
                  value={[form.addressLine, form.locality, form.city, form.state, form.postalCode].filter(Boolean).join(', ') || '—'}
                />
                <KeyValue label={parcelIdLabel} value={form.parcelId || '—'} mono />
                <KeyValue label="Property type" value={PROPERTY_TYPE_LABEL[form.propertyType]} />
                <KeyValue label="Tenure" value={TENURE_OPTIONS.find((t) => t.value === form.tenure)?.label ?? '—'} />
                <KeyValue label="Built-up area" value={reviewAreaValue(toSqm(form.builtUpArea) || 0, areaUnit)} />
                <KeyValue label="Plot area" value={reviewAreaValue(toSqm(form.plotArea) || 0, areaUnit)} />
                {form.yearBuilt ? <KeyValue label="Year built" value={form.yearBuilt} /> : null}
                {form.floor || form.totalFloors ? (
                  <KeyValue label="Floor" value={`${form.floor || '—'} / ${form.totalFloors || '—'}`} />
                ) : null}
                <KeyValue
                  label="Asking price"
                  value={form.askingPrice ? money(Number(form.askingPrice), currency) : 'Not provided — screened as a claim, not evidence'}
                />
                {form.askingPrice && areaForImpliedRate > 0 ? (
                  <KeyValue
                    label={isLandType ? 'Implied land rate' : 'Implied rate'}
                    value={formatRate(Number(form.askingPrice) / areaForImpliedRate, areaUnit, currency)}
                  />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          {isLandType ? (
            <Card>
              <CardHeader title="Site details" icon={<LandPlot size={16} />} />
              <CardBody>
                <dl>
                  <KeyValue
                    label="Dimensions"
                    value={
                      hasDims
                        ? `${form.plot.dimensionsWidthFt} × ${form.plot.dimensionsDepthFt} ft (${Math.round(dimsAreaSqft ?? 0).toLocaleString('en-IN')} sq ft)`
                        : 'Not provided'
                    }
                  />
                  <KeyValue label="Road width" value={form.plot.roadWidthFt.trim() ? `${form.plot.roadWidthFt} ft` : 'Not provided'} />
                  <KeyValue label="Corner site" value={form.plot.cornerSite ? 'Yes' : 'No'} />
                  <KeyValue
                    label="Facing"
                    value={
                      PREMIUM_FACINGS.includes(form.plot.facing) ? (
                        <span className="inline-flex items-center gap-1.5">
                          {FACING_LABEL[form.plot.facing]} <Badge tone="good">Premium</Badge>
                        </span>
                      ) : (
                        FACING_LABEL[form.plot.facing]
                      )
                    }
                  />
                  <KeyValue
                    label="Layout approval"
                    value={
                      RISKY_LAYOUT_APPROVALS.includes(form.plot.layoutApproval) ? (
                        <Badge tone="warning">{LAYOUT_APPROVAL_LABEL[form.plot.layoutApproval]}</Badge>
                      ) : (
                        LAYOUT_APPROVAL_LABEL[form.plot.layoutApproval]
                      )
                    }
                  />
                  <KeyValue label="Demarcated / possession" value={form.plot.demarcated ? 'Yes' : 'No / unconfirmed'} />
                </dl>
                {RISKY_LAYOUT_APPROVALS.includes(form.plot.layoutApproval) ? (
                  <div className="mt-3">
                    <Callout tone="warning" title="Carried forward as a material finding">
                      {LAYOUT_APPROVAL_LABEL[form.plot.layoutApproval]} status will be reported as a risk restricting financing and
                      resale.
                    </Callout>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {isKarnataka ? (
            <Card>
              <CardHeader title="Karnataka details" icon={<Scale size={16} />} />
              <CardBody>
                <dl>
                  <KeyValue label="Jurisdiction" value={jurisdictionLabel(form.karnataka.jurisdiction)} />
                  <KeyValue
                    label="Khata type"
                    value={
                      form.karnataka.khataType === 'b_khata' ? (
                        <Badge tone="warning">{khataLabel(form.karnataka.khataType)}</Badge>
                      ) : (
                        khataLabel(form.karnataka.khataType)
                      )
                    }
                  />
                  <KeyValue label="e-Khata issued" value={form.karnataka.eKhataIssued ? 'Yes' : 'No / unknown'} />
                  <KeyValue label="Land conversion" value={landConversionLabel(form.karnataka.landConversionStatus)} />
                  <KeyValue label="Area basis" value={areaBasisLabel(form.karnataka.areaBasis)} />
                  <KeyValue label="BBMP tax zone" value={form.karnataka.bbmpTaxZone ? `Zone ${form.karnataka.bbmpTaxZone}` : 'Not provided'} />
                  <KeyValue label="K-RERA number" value={form.karnataka.kreraNumber || 'Not provided'} mono />
                  <KeyValue
                    label="Site conditions"
                    value={
                      [
                        form.karnataka.nearRajakaluve && 'Near rajakaluve',
                        form.karnataka.nearLake && 'Near lake',
                        form.karnataka.grantedLandPtcl && 'PTCL granted land',
                      ]
                        .filter(Boolean)
                        .join(', ') || 'None flagged'
                    }
                  />
                </dl>
                {form.karnataka.khataType === 'b_khata' ? (
                  <div className="mt-3">
                    <Callout tone="warning" title="Carried forward as a material finding">
                      B-khata will be reported as a title risk restricting lending, plan sanction and resale.
                    </Callout>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Notes" />
            <CardBody>
              <Textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="e.g. seller mentioned an ongoing tenancy dispute…"
                aria-label="Case notes"
              />
            </CardBody>
          </Card>

          <Callout tone="neutral" title="What Property Screen is — and isn't">
            Property Screen gives you an evidence-based read on whether this property is worth pursuing: an indicative value range, the
            drivers behind it, material risks and what's missing. It is <span className="font-medium text-ink">not</span> a certified
            valuation, a legal title certificate, or an engineering inspection — treat it as the first, structured look before you commit
            professional effort or money.
          </Callout>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between">
        <Button variant="secondary" icon={<ArrowLeft size={14} />} onClick={goBack} disabled={step === 0}>
          Back
        </Button>
        {step < stepLabels.length - 1 ? (
          <Button variant="primary" onClick={attemptNext} icon={<ArrowRight size={14} />}>
            Next
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void handleCreate()} loading={creating} icon={creating ? undefined : <Check size={14} />}>
            {creating ? 'Creating…' : 'Create case'}
          </Button>
        )}
      </div>
    </div>
  );
}
