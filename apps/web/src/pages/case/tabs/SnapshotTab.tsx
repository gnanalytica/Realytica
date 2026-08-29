import { useState } from 'react';
import { AlertTriangle, Minus, Pencil } from 'lucide-react';
import type {
  CountryCode,
  CurrencyCode,
  LayoutApproval,
  MarketContext,
  PlotFacing,
  PropertyIdentity,
  PropertyType,
  ReferenceData,
  RiskSeverity,
  ScreenResult,
  Tenure,
} from '@realytica/shared';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Modal,
  Select,
  SectionTitle,
  Stat,
  useToast,
  type Tone,
} from '../../../components/ui/kit';
import { CompletenessRing, ConfidenceGauge, MarketTrendChart, ValueRangeChart } from '../../../components/charts';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { StalenessPanel } from '../../../components/StalenessPanel';
import {
  FACING_LABEL,
  LAYOUT_APPROVAL_LABEL,
  PlotFactsCard,
  RISKY_LAYOUT_APPROVALS,
  isLandPropertyType,
  localityBenchmarkPerSqm,
} from '../../../components/PlotFactsCard';
import { api } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { PROPERTY_TYPE_LABEL, area, money, num, perSqm, pct, titleCase } from '../../../lib/format';
import { SQM_PER_SQFT, formatArea, formatRate, sqmToSqft, useAreaUnitFor } from '../../../lib/units';
import type { TabProps } from '../tab-props';
import { Prose } from '../../../components/ui/prose';
import { emphasise } from '@realytica/shared';

const COUNTRY_LABEL: Record<CountryCode, string> = { IN: 'India', NL: 'Netherlands' };
const COUNTRIES: CountryCode[] = ['IN', 'NL'];
const TENURES: Tenure[] = ['freehold', 'leasehold', 'unknown'];
const CURRENCIES: CurrencyCode[] = ['INR', 'EUR'];

export default function SnapshotTab({ caseData, result, refresh, runScreen, running, goToTab }: TabProps) {
  const { identity } = caseData;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {result ? (
        <>
          {/*
            * The answer first.
            *
            * This page used to open with the case notes — free text the user
            * typed — then a staleness warning, and only then the verdict. A
            * reader hitting the front door of a case got two things they did
            * not ask for before the one they did, which is most of what made
            * it feel like notes rather than a conclusion.
            *
            * The order now: what we concluded, then what is wrong with it,
            * then the working, then the notes.
            */}
          <Card>
            <CardBody>
              <p className="font-display text-[17px] leading-snug text-ink">
                {emphasise(result.snapshot.headline).map((span, i) =>
                  span.quantity ? (
                    <span key={i} className="font-semibold tabular-nums">
                      {span.text}
                    </span>
                  ) : (
                    <span key={i}>{span.text}</span>
                  ),
                )}
              </p>
              {result.snapshot.bullets.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {result.snapshot.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                      <Prose className="m-0">{b}</Prose>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          {/*
            * The interruption, immediately after the verdict rather than
            * before it. A reader who has taken the conclusion on board and
            * then learns the screen is eight months old re-reads it; one who
            * meets the warning first has not yet got anything to apply it to.
            */}
          <StalenessPanel caseId={caseData.id} />

          <TitleFindingStrip result={result} goToTab={goToTab} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr,1fr]">
            <Card>
              <CardHeader title="Indicative value range" subtitle="Blended across all value anchors — a range, not a single figure" />
              <CardBody>
                <ValueRangeChart
                  low={result.indicativeValue.low}
                  mid={result.indicativeValue.mid}
                  high={result.indicativeValue.high}
                  currency={result.indicativeValue.currency}
                  askingPrice={identity.askingPrice ?? null}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">± {pct(result.indicativeValue.spreadPct, 1)} spread</Badge>
                  <span className="text-xs text-ink-secondary">
                    Half-width of the range relative to the mid value — uncertainty is stated explicitly, not hidden.
                  </span>
                </div>
                <div className="mt-3">
                  <AskingVsMid
                    valuePct={result.indicativeValue.askingVsMidPct}
                    currency={result.indicativeValue.currency}
                    askingPrice={identity.askingPrice}
                  />
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Confidence & completeness" />
              <CardBody className="flex items-center justify-around gap-4">
                <ConfidenceGauge score={result.confidence.score} band={result.confidence.band} label="Confidence" />
                <CompletenessRing score={result.completeness.score} label="Completeness" />
              </CardBody>
            </Card>
          </div>

          {result.snapshot.keyFacts.length > 0 ? (
            <Card>
              <CardHeader title="Key facts" />
              <CardBody>
                <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                  {result.snapshot.keyFacts.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 border-b border-hairline py-1.5 text-[13px] last:border-0">
                      <dt className="text-ink-secondary">{f.label}</dt>
                      <dd className="flex items-center gap-1.5 font-medium text-ink">
                        <span>{f.value}</span>
                        {f.sourceEvidenceId ? <EvidenceLink ids={[f.sourceEvidenceId]} evidence={result.evidence} compact /> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="Snapshot builds once you run the screen"
          description="Property identification below is always editable. The plain-language headline, indicative value, confidence and market context appear here once the screen has run."
          action={
            <Button variant="primary" loading={running} onClick={runScreen}>
              Run screen
            </Button>
          }
        />
      )}

      <IdentityCard caseData={caseData} refresh={refresh} runScreen={runScreen} running={running} />

      {/* What the person typed, at the end, where a note belongs. */}
      <CaseNotes notes={caseData.notes} />

      {isLandPropertyType(identity.propertyType) ? <PlotFactsCard identity={identity} /> : null}

      <MissingCard result={result} goToTab={goToTab} />

      {result ? <MarketStrip market={result.marketContext} currency={result.indicativeValue.currency} identity={identity} /> : null}
    </div>
  );
}

function AskingVsMid({
  valuePct,
  currency,
  askingPrice,
}: {
  valuePct: number | null;
  currency: CurrencyCode;
  askingPrice: number | undefined;
}) {
  if (valuePct === null || askingPrice === undefined) {
    return (
      <Callout tone="neutral" title="No asking price on record">
        Add an asking price to see how it compares against the indicative mid value.
      </Callout>
    );
  }
  const tone = valuePct > 0.5 ? 'warning' : valuePct < -0.5 ? 'good' : 'neutral';
  const direction = valuePct > 0.5 ? 'above' : valuePct < -0.5 ? 'below' : 'in line with';
  return (
    <Callout tone={tone} title={`Asking price ${money(askingPrice, currency)} is ${pct(Math.abs(valuePct), 1)} ${direction} the indicative mid`}>
      {valuePct > 0.5
        ? 'The asking price sits above the indicative mid — pursuing it needs a specific reason beyond "priced at market".'
        : valuePct < -0.5
          ? 'The asking price sits below the indicative mid — worth understanding why before assuming it is a bargain.'
          : 'The asking price roughly matches the indicative mid value.'}
    </Callout>
  );
}

function IdentityCard({
  caseData,
  refresh,
  runScreen,
  running,
}: Pick<TabProps, 'caseData' | 'refresh' | 'runScreen' | 'running'>) {
  const { identity } = caseData;
  const areaUnit = useAreaUnitFor(identity.country);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PropertyIdentity>(identity);
  // Plot dimensions are a compound { width, depth } value — kept as separate
  // draft strings (like the wizard) rather than collapsing into `form.plot`
  // directly, so typing one side doesn't wipe the other while incomplete.
  const [plotWidthFt, setPlotWidthFt] = useState('');
  const [plotDepthFt, setPlotDepthFt] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const toast = useToast();

  const isLand = isLandPropertyType(form.propertyType);

  const openEdit = () => {
    setForm(identity);
    setPlotWidthFt(identity.plot?.dimensionsFt ? String(identity.plot.dimensionsFt.width) : '');
    setPlotDepthFt(identity.plot?.dimensionsFt ? String(identity.plot.dimensionsFt.depth) : '');
    setEditing(true);
  };

  const numOrUndefined = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));

  function setPlotField<K extends 'roadWidthFt' | 'cornerSite' | 'facing' | 'layoutApproval' | 'demarcated'>(
    key: K,
    value: NonNullable<PropertyIdentity['plot']>[K],
  ) {
    setForm((f) => ({
      ...f,
      plot: { ...(f.plot ?? { facing: 'unknown', layoutApproval: 'unknown' }), [key]: value },
    }));
  }

  // Dimensions-vs-plot-area sanity check, mirroring the wizard's Site details
  // step — dimensions are captured natively in feet, so the comparison is done
  // in sq ft regardless of the wizard-wide display unit.
  const dimsWidthNum = Number(plotWidthFt);
  const dimsDepthNum = Number(plotDepthFt);
  const hasDims = plotWidthFt.trim() !== '' && plotDepthFt.trim() !== '' && dimsWidthNum > 0 && dimsDepthNum > 0;
  const dimsAreaSqft = hasDims ? dimsWidthNum * dimsDepthNum : null;
  const dimsAreaSqm = dimsAreaSqft !== null ? dimsAreaSqft * SQM_PER_SQFT : null;
  const plotAreaSqftOnRecord = form.plotAreaSqm > 0 ? sqmToSqft(form.plotAreaSqm) : null;
  const areaMismatchPct =
    dimsAreaSqft !== null && plotAreaSqftOnRecord !== null && plotAreaSqftOnRecord > 0
      ? ((dimsAreaSqft - plotAreaSqftOnRecord) / plotAreaSqftOnRecord) * 100
      : null;
  const areaMismatch = areaMismatchPct !== null && Math.abs(areaMismatchPct) > 5;

  const save = async () => {
    setSaving(true);
    try {
      const width = plotWidthFt.trim() === '' ? undefined : Number(plotWidthFt);
      const depth = plotDepthFt.trim() === '' ? undefined : Number(plotDepthFt);
      const dimensionsFt = width !== undefined && depth !== undefined && width > 0 && depth > 0 ? { width, depth } : undefined;
      const payload: PropertyIdentity = {
        ...form,
        plot: isLandPropertyType(form.propertyType)
          ? {
              facing: form.plot?.facing ?? 'unknown',
              layoutApproval: form.plot?.layoutApproval ?? 'unknown',
              roadWidthFt: form.plot?.roadWidthFt,
              cornerSite: form.plot?.cornerSite,
              demarcated: form.plot?.demarcated,
              dimensionsFt,
            }
          : undefined,
      };
      await api.updateCase(caseData.id, { identity: payload });
      await refresh();
      setEditing(false);
      setJustSaved(true);
      toast('Property identification updated.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update the case.', 'critical');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Property identification"
        subtitle={identity.addressLine}
        action={
          <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={openEdit} aria-label="Edit property identification">
            Edit
          </Button>
        }
      />
      <CardBody>
        {justSaved ? (
          <Callout tone="info" title="Details updated">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Re-run the screen so valuation, drivers and risks reflect the new details.</span>
              <Button
                size="sm"
                variant="primary"
                loading={running}
                onClick={() => {
                  void runScreen();
                  setJustSaved(false);
                }}
              >
                Re-run screen
              </Button>
            </div>
          </Callout>
        ) : null}
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          <KeyValue label="Label" value={identity.label} />
          <KeyValue label="Country" value={COUNTRY_LABEL[identity.country]} />
          <KeyValue label="State" value={identity.state} />
          <KeyValue label="City" value={identity.city} />
          <KeyValue label="Locality" value={identity.locality} />
          <KeyValue label="Address" value={identity.addressLine} />
          <KeyValue label="Postal code" value={identity.postalCode} mono />
          <KeyValue label="Parcel ID" value={identity.parcelId} mono />
          <KeyValue label="Property type" value={PROPERTY_TYPE_LABEL[identity.propertyType]} />
          <KeyValue label="Tenure" value={titleCase(identity.tenure)} />
          <KeyValue label="Built-up area" value={formatArea(identity.builtUpAreaSqm, areaUnit)} />
          <KeyValue label="Plot area" value={formatArea(identity.plotAreaSqm, areaUnit)} />
          {identity.yearBuilt ? <KeyValue label="Year built" value={identity.yearBuilt} /> : null}
          {identity.floor !== undefined ? (
            <KeyValue label="Floor" value={identity.totalFloors ? `${identity.floor} / ${identity.totalFloors}` : identity.floor} />
          ) : null}
          <KeyValue
            label="Asking price"
            value={identity.askingPrice !== undefined ? money(identity.askingPrice, identity.currency, { compact: false }) : 'Not set'}
          />
        </dl>
      </CardBody>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit property identification"
        width="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Label" className="sm:col-span-2">
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label="Country">
            <Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value as CountryCode })}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {COUNTRY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as CurrencyCode })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="Locality">
            <Input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} />
          </Field>
          <Field label="Postal code">
            <Input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} />
          </Field>
          <Field label="Parcel ID">
            <Input value={form.parcelId} onChange={(e) => setForm({ ...form, parcelId: e.target.value })} />
          </Field>
          <Field label="Property type">
            <Select value={form.propertyType} onChange={(e) => setForm({ ...form, propertyType: e.target.value as PropertyType })}>
              {(Object.keys(PROPERTY_TYPE_LABEL) as PropertyType[]).map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenure">
            <Select value={form.tenure} onChange={(e) => setForm({ ...form, tenure: e.target.value as Tenure })}>
              {TENURES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Built-up area (m²)">
            <Input
              type="number"
              value={form.builtUpAreaSqm}
              onChange={(e) => setForm({ ...form, builtUpAreaSqm: Number(e.target.value) })}
            />
          </Field>
          <Field label="Plot area (m²)">
            <Input type="number" value={form.plotAreaSqm} onChange={(e) => setForm({ ...form, plotAreaSqm: Number(e.target.value) })} />
          </Field>

          {isLand ? (
            <>
              <div className="sm:col-span-2">
                <SectionTitle hint="Priced per sq ft of land, not built-up area">Site details</SectionTitle>
              </div>
              <Field label="Plot width (ft)" hint="Optional">
                <Input type="number" value={plotWidthFt} onChange={(e) => setPlotWidthFt(e.target.value)} />
              </Field>
              <Field label="Plot depth (ft)" hint="Optional">
                <Input type="number" value={plotDepthFt} onChange={(e) => setPlotDepthFt(e.target.value)} />
              </Field>
              {hasDims ? (
                <p className="-mt-1 text-xs text-ink-secondary sm:col-span-2">
                  Implied area: <span className="font-medium text-ink">{Math.round(dimsAreaSqft ?? 0).toLocaleString('en-IN')} sq ft</span>{' '}
                  <span className="text-ink-muted">({formatArea(dimsAreaSqm, 'sqm')})</span>
                </p>
              ) : null}
              {areaMismatch ? (
                <div className="sm:col-span-2">
                  <Callout tone="warning" title="Dimensions don't match the plot area on record">
                    {plotWidthFt} × {plotDepthFt} ft implies{' '}
                    <span className="font-medium text-ink">{Math.round(dimsAreaSqft ?? 0).toLocaleString('en-IN')} sq ft</span> —{' '}
                    {pct(Math.abs(areaMismatchPct ?? 0), 0)} {(areaMismatchPct ?? 0) > 0 ? 'higher than' : 'lower than'} the{' '}
                    {Math.round(plotAreaSqftOnRecord ?? 0).toLocaleString('en-IN')} sq ft plot area above. Worth double-checking.
                  </Callout>
                </div>
              ) : null}
              <Field label="Road width (ft)" hint="Affects both the achievable rate and permissible FAR.">
                <Input
                  type="number"
                  value={form.plot?.roadWidthFt ?? ''}
                  onChange={(e) => setPlotField('roadWidthFt', e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </Field>
              <Field label="Facing" hint="East/north-facing sites carry a measurable premium here.">
                <Select value={form.plot?.facing ?? 'unknown'} onChange={(e) => setPlotField('facing', e.target.value as PlotFacing)}>
                  {(Object.keys(FACING_LABEL) as PlotFacing[]).map((f) => (
                    <option key={f} value={f}>
                      {FACING_LABEL[f]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Layout approval" className="sm:col-span-2">
                <Select
                  value={form.plot?.layoutApproval ?? 'unknown'}
                  onChange={(e) => setPlotField('layoutApproval', e.target.value as LayoutApproval)}
                >
                  {(Object.keys(LAYOUT_APPROVAL_LABEL) as LayoutApproval[]).map((l) => (
                    <option key={l} value={l}>
                      {LAYOUT_APPROVAL_LABEL[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.plot && RISKY_LAYOUT_APPROVALS.includes(form.plot.layoutApproval) ? (
                <div className="sm:col-span-2">
                  <Callout tone="warning" title="This layout status is a material finding">
                    {LAYOUT_APPROVAL_LABEL[form.plot.layoutApproval]} sites are hard to finance and hard to resell.
                  </Callout>
                </div>
              ) : null}
              <Field label="Corner site">
                <Checkbox
                  checked={form.plot?.cornerSite ?? false}
                  onChange={(v) => setPlotField('cornerSite', v)}
                  label="This is a corner site"
                />
              </Field>
              <Field label="Demarcated / possession">
                <Checkbox
                  checked={form.plot?.demarcated ?? false}
                  onChange={(v) => setPlotField('demarcated', v)}
                  label="Fenced and in undisputed possession"
                />
              </Field>
            </>
          ) : null}

          <Field label="Year built" hint="Optional">
            <Input
              type="number"
              value={form.yearBuilt ?? ''}
              onChange={(e) => setForm({ ...form, yearBuilt: numOrUndefined(e.target.value) })}
            />
          </Field>
          <Field label="Floor" hint="Optional">
            <Input type="number" value={form.floor ?? ''} onChange={(e) => setForm({ ...form, floor: numOrUndefined(e.target.value) })} />
          </Field>
          <Field label="Total floors" hint="Optional">
            <Input
              type="number"
              value={form.totalFloors ?? ''}
              onChange={(e) => setForm({ ...form, totalFloors: numOrUndefined(e.target.value) })}
            />
          </Field>
          <Field label="Asking price" hint="Optional">
            <Input
              type="number"
              value={form.askingPrice ?? ''}
              onChange={(e) => setForm({ ...form, askingPrice: numOrUndefined(e.target.value) })}
            />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

function MissingCard({ result, goToTab }: { result: ScreenResult | null; goToTab: (key: string) => void }) {
  if (!result) {
    return (
      <Card>
        <CardHeader title="What we could not verify" icon={<AlertTriangle size={14} />} />
        <CardBody>
          <Callout tone="neutral" title="Not yet known">
            Run the screen after uploading documents to see exactly what evidence is missing.
          </Callout>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => goToTab('documents')}>
              Go to Documents
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const dataRisks = result.risks.filter((r) => r.category === 'data');
  const nothingMissing = result.completeness.missingCritical.length === 0 && dataRisks.length === 0;

  return (
    <Card>
      <CardHeader
        title="What we could not verify"
        subtitle="Uncertainty must be visible — surfaced here, not buried."
        icon={<AlertTriangle size={14} />}
        action={
          <Button size="sm" variant="secondary" onClick={() => goToTab('documents')}>
            Go to Documents
          </Button>
        }
      />
      <CardBody>
        {nothingMissing ? (
          <Callout tone="good" title="Nothing critical is missing">
            All critical evidence expected for this screen was present.
          </Callout>
        ) : (
          <div className="flex flex-col gap-3">
            {result.completeness.missingCritical.length > 0 ? (
              <div>
                <SectionTitle>Missing critical documents / facts</SectionTitle>
                <ul className="flex flex-col gap-1">
                  {result.completeness.missingCritical.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-ink">
                      <Minus size={12} className="mt-1 shrink-0 text-critical" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {dataRisks.length > 0 ? (
              <Badge tone="warning">
                {dataRisks.length} data-quality risk{dataRisks.length === 1 ? '' : 's'} flagged
              </Badge>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The title graph's single worst finding, on the first screen a user sees.
 *
 * A chain break or an area contradiction is not a footnote — it is usually the
 * most consequential thing known about the property, and leaving it two tabs
 * away means a user forms a view from the value range before they learn the
 * ownership does not join up. This strip is deliberately one line and a link
 * rather than a summary: it exists to redirect attention, not to replace the
 * tab that explains it.
 */
function TitleFindingStrip({ result, goToTab }: { result: ScreenResult; goToTab: (key: string) => void }) {
  const graph = result.titleGraph;
  if (!graph) return null;

  const breaks = graph.chains.flatMap((c) => c.breaks);
  const worstSeverity: RiskSeverity | null = (['critical', 'serious', 'warning', 'info'] as RiskSeverity[]).find(
    (sev) => graph.contradictions.some((c) => c.severity === sev) || breaks.some((b) => b.severity === sev),
  ) ?? null;
  if (!worstSeverity) return null;

  // The specific finding, not a count. "1 contradiction" tells a user nothing;
  // the sentence naming the two figures that disagree is the whole value.
  const worst =
    graph.contradictions.find((c) => c.severity === worstSeverity)?.statement
    ?? breaks.find((b) => b.severity === worstSeverity)?.statement;
  if (!worst) return null;

  const tone: Tone = worstSeverity === 'critical' ? 'critical' : worstSeverity === 'serious' ? 'serious' : 'warning';
  const total = graph.contradictions.length + breaks.length;

  return (
    <Callout tone={tone} title="Title finding">
      {worst}
      <button
        type="button"
        onClick={() => goToTab('title')}
        className="ml-1 font-medium underline underline-offset-2 hover:no-underline"
      >
        {total > 1 ? `See all ${total} title findings` : 'See the chain'}
      </button>
    </Callout>
  );
}

function MarketStrip({ market, currency, identity }: { market: MarketContext; currency: CurrencyCode; identity: PropertyIdentity }) {
  const areaUnit = useAreaUnitFor(identity.country);
  const unitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';
  const isLand = isLandPropertyType(identity.propertyType);
  // Independently resolved from the reference data rather than trusted
  // wholesale from `market.medianPricePerSqm` — a site's rate must never be
  // benchmarked against a built-up price basis, so a land subject without a
  // resolvable land-rate figure shows "—" rather than the wrong number.
  const { data: reference } = useAsync<ReferenceData>(() => api.reference(), []);
  const localityRate = localityBenchmarkPerSqm(reference, identity);
  const rateToShow = isLand ? localityRate : (localityRate ?? market.medianPricePerSqm);

  return (
    <Card>
      <CardHeader title="Market context" subtitle={market.source} />
      <CardBody>
        {isLand ? (
          <div className="mb-3">
            <Callout tone="info" title="Land-rate basis" collapsible>
              This locality figure is the median <span className="font-medium text-ink">land rate</span> per {unitLabel} of plot area —
              not the built-up price basis used for apartments and villas.
            </Callout>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label={`${isLand ? 'Median land rate' : 'Median price'} / ${unitLabel}`}
            value={formatRate(rateToShow, areaUnit, currency)}
          />
          <Stat
            label="YoY change"
            value={pct(market.yoyChangePct, 1, true)}
            tone={market.yoyChangePct >= 0 ? 'good' : 'critical'}
          />
          <Stat label="Liquidity" value={`${num(market.liquidityDays)}d`} sub="Median days on market" />
          <Stat label="Sample size" value={num(market.sampleSize)} sub="Transactions observed" />
        </div>
        <div className="mt-4">
          <MarketTrendChart trend={market.trend} currency={currency} />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * The case's own notes, which nothing rendered until now.
 *
 * They were captured by the new-case form and written by the intake on commit,
 * and displayed nowhere — so a case built from a conversation carried a record
 * of exactly which particulars nobody had confirmed, and no screen showed it.
 * That is the failure this product is least able to afford: an inference that
 * cannot be seen is indistinguishable from a fact to whoever reads the case a
 * week later.
 *
 * Rendered with a warning tone when it names unconfirmed particulars, and
 * plainly otherwise, because most notes are just notes.
 */
function CaseNotes({ notes }: { notes?: string }) {
  const text = notes?.trim();
  if (!text) return null;
  const hasUnconfirmed = /not confirmed by the user/i.test(text);
  return (
    <Callout tone={hasUnconfirmed ? 'warning' : 'neutral'} title={hasUnconfirmed ? 'Some particulars here were inferred, not stated' : 'Case notes'}>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{text}</p>
      {hasUnconfirmed ? (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
          These fed the screen above. Confirm or correct them on the case before relying on the figures.
        </p>
      ) : null}
    </Callout>
  );
}
