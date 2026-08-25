import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, Landmark } from 'lucide-react';
import type {
  CountryCode,
  CreateCaseRequest,
  CurrencyCode,
  LocalityReference,
  PersonaKey,
  PropertyIdentity,
  PropertyType,
  ReferenceData,
  Tenure,
} from '@valytica/shared';
import { COUNTRY_PACKS_META, PERSONAS, PROPERTY_TYPES } from '@valytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { PROPERTY_TYPE_LABEL, area, money, perSqm, pct } from '../lib/format';
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, KeyValue, Select, Textarea, cn, useToast } from '../components/ui/kit';

const STEP_LABELS = ['Market & intent', 'Property identification', 'Review & create'] as const;

const TENURE_OPTIONS: { value: Tenure; label: string }[] = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'unknown', label: 'Unknown' },
];

const CURRENCY_BY_COUNTRY: Record<CountryCode, CurrencyCode> = { IN: 'INR', NL: 'EUR' };

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
  builtUpAreaSqm: string;
  plotAreaSqm: string;
  yearBuilt: string;
  floor: string;
  totalFloors: string;
  askingPrice: string;
  notes: string;
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
    builtUpAreaSqm: '',
    plotAreaSqm: '',
    yearBuilt: '',
    floor: '',
    totalFloors: '',
    askingPrice: '',
    notes: '',
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
        className={props.suffix ? 'pr-10' : undefined}
      />
      {props.suffix ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-muted">{props.suffix}</span>
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex items-center">
      {STEP_LABELS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={label} className={cn('flex items-center', i < STEP_LABELS.length - 1 && 'flex-1')}>
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
            {i < STEP_LABELS.length - 1 ? (
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

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const countryPack = reference?.countryPacks.find((p) => p.country === form.country);
  const currency = countryPack?.currency ?? CURRENCY_BY_COUNTRY[form.country];
  const parcelIdLabel = countryPack?.parcelIdLabel ?? 'Parcel / survey ID';

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

      const builtUp = form.builtUpAreaSqm.trim();
      const plot = form.plotAreaSqm.trim();
      if (builtUp === '') e.builtUpAreaSqm = 'Enter the built-up area (0 if not applicable).';
      else if (Number(builtUp) < 0) e.builtUpAreaSqm = 'Area cannot be negative.';
      if (plot === '') e.plotAreaSqm = 'Enter the plot area (0 if not applicable).';
      else if (Number(plot) < 0) e.plotAreaSqm = 'Area cannot be negative.';
      if (builtUp !== '' && plot !== '' && Number(builtUp) === 0 && Number(plot) === 0) {
        e.builtUpAreaSqm = 'At least one of built-up or plot area must be greater than zero.';
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
    return e;
  }

  function attemptNext() {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleCreate() {
    if (!form.persona) return;
    setCreating(true);
    try {
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
        builtUpAreaSqm: Number(form.builtUpAreaSqm) || 0,
        plotAreaSqm: Number(form.plotAreaSqm) || 0,
        yearBuilt: form.yearBuilt.trim() ? Number(form.yearBuilt) : undefined,
        floor: form.floor.trim() ? Number(form.floor) : undefined,
        totalFloors: form.totalFloors.trim() ? Number(form.totalFloors) : undefined,
        askingPrice: form.askingPrice.trim() ? Number(form.askingPrice) : undefined,
        currency,
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

  const impliedPricePerSqm =
    form.askingPrice.trim() && Number(form.builtUpAreaSqm) > 0 ? Number(form.askingPrice) / Number(form.builtUpAreaSqm) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Stepper current={step} />

      {step === 0 ? (
        <Card>
          <CardHeader title="Market & intent" subtitle="Which country pack applies, who this screen is for, and who owns the case." />
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
          <CardHeader title="Property identification" subtitle="What the property is and where it sits." icon={<Building2 size={16} />} />
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
                  ? `Median: ${perSqm(selectedLocality.medianPricePerSqm, selectedLocality.currency)} · Statutory rate: ${perSqm(
                      selectedLocality.statutoryRatePerSqm,
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
              <Field label="Built-up area" required error={errors.builtUpAreaSqm} htmlFor="builtUpAreaSqm">
                <NumberField id="builtUpAreaSqm" value={form.builtUpAreaSqm} onChange={(v) => set('builtUpAreaSqm', v)} suffix="m²" />
              </Field>
              <Field label="Plot area" required error={errors.plotAreaSqm} htmlFor="plotAreaSqm">
                <NumberField id="plotAreaSqm" value={form.plotAreaSqm} onChange={(v) => set('plotAreaSqm', v)} suffix="m²" />
              </Field>
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
              hint="Optional — Valytica screens fine without one. When given, it is treated as a claim to test against the evidence, not as evidence itself."
            >
              <NumberField id="askingPrice" value={form.askingPrice} onChange={(v) => set('askingPrice', v)} />
            </Field>

            {selectedLocality || impliedPricePerSqm ? (
              <Callout tone="info" title="Live sanity check">
                {selectedLocality ? (
                  <p>
                    Locality median: <span className="font-medium text-ink">{perSqm(selectedLocality.medianPricePerSqm, currency)}</span>
                  </p>
                ) : null}
                {impliedPricePerSqm ? (
                  <p className="mt-0.5">
                    Your asking price implies <span className="font-medium text-ink">{perSqm(impliedPricePerSqm, currency)}</span>
                    {selectedLocality
                      ? ` — ${pct(
                          ((impliedPricePerSqm - selectedLocality.medianPricePerSqm) / selectedLocality.medianPricePerSqm) * 100,
                          0,
                          true,
                        )} vs the locality median.`
                      : '.'}
                  </p>
                ) : null}
              </Callout>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Review" subtitle="Check the details before creating the case." />
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
                <KeyValue label="Built-up area" value={area(Number(form.builtUpAreaSqm) || 0)} />
                <KeyValue label="Plot area" value={area(Number(form.plotAreaSqm) || 0)} />
                {form.yearBuilt ? <KeyValue label="Year built" value={form.yearBuilt} /> : null}
                {form.floor || form.totalFloors ? (
                  <KeyValue label="Floor" value={`${form.floor || '—'} / ${form.totalFloors || '—'}`} />
                ) : null}
                <KeyValue
                  label="Asking price"
                  value={form.askingPrice ? money(Number(form.askingPrice), currency) : 'Not provided — screened as a claim, not evidence'}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notes" subtitle="Optional — anything you already know that should inform the screen." />
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
        {step < STEP_LABELS.length - 1 ? (
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
