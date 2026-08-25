import { useState } from 'react';
import { AlertTriangle, Minus, Pencil } from 'lucide-react';
import type {
  CountryCode,
  CurrencyCode,
  MarketContext,
  PropertyIdentity,
  PropertyType,
  ScreenResult,
  Tenure,
} from '@valytica/shared';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Modal,
  Select,
  SectionTitle,
  Stat,
  useToast,
} from '../../../components/ui/kit';
import { CompletenessRing, ConfidenceGauge, MarketTrendChart, ValueRangeChart } from '../../../components/charts';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { api } from '../../../lib/api';
import { PROPERTY_TYPE_LABEL, area, money, num, perSqm, pct, titleCase } from '../../../lib/format';
import { formatArea, formatRate, useAreaUnitFor } from '../../../lib/units';
import type { TabProps } from '../tab-props';

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
          <Card>
            <CardBody>
              <p className="text-[15px] leading-relaxed text-ink">{result.snapshot.headline}</p>
              {result.snapshot.bullets.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {result.snapshot.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-secondary">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                      {b}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

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

      <MissingCard result={result} goToTab={goToTab} />

      {result ? <MarketStrip market={result.marketContext} currency={result.indicativeValue.currency} country={caseData.identity.country} /> : null}
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
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const toast = useToast();

  const openEdit = () => {
    setForm(identity);
    setEditing(true);
  };

  const numOrUndefined = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateCase(caseData.id, { identity: form });
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

function MarketStrip({ market, currency, country }: { market: MarketContext; currency: CurrencyCode; country: CountryCode }) {
  const areaUnit = useAreaUnitFor(country);
  const unitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';

  return (
    <Card>
      <CardHeader title="Market context" subtitle={market.source} />
      <CardBody>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={`Median price / ${unitLabel}`} value={formatRate(market.medianPricePerSqm, areaUnit, currency)} />
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
