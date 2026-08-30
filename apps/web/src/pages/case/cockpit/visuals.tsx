import { useMemo } from 'react';
import { openTechnicalFindingCounts, totalOpenEstimatedCost, domainForRiskCategory, domainForSystem, buildDepartmentDossier } from '@realytica/shared';
import type { DdDomain, PropertyCase, RiskSeverity, TechnicalSystem } from '@realytica/shared';
import { TECHNICAL_SYSTEM_LABEL } from '@realytica/shared';
import { money } from '../../../lib/format';
import { Card, CardBody, CardHeader, cn } from '../../../components/ui/kit';

/**
 * A department's own picture.
 *
 * One rule governs everything here: **a chart is drawn only from data the
 * case actually holds.** No chart renders a placeholder, a zero series, or a
 * "sample" — a department with nothing to plot gets no plot, which is itself
 * a true statement about the file. That is why every component below returns
 * `null` on empty input rather than an empty axis.
 *
 * The forms follow from each department's question, not from variety: the
 * technical question is what it costs to put right, so it draws exposure; the
 * risk question is where the trouble sits, so it draws a counted matrix; the
 * legal question is whether the chain connects, so it draws the chain.
 *
 * Colours come from Realytica's own fixed series order (blue first) and the
 * reserved status tokens, which always ship with a text label beside them.
 */

const SERIES_1 = '#2a78d6';
const AXIS = 'var(--axis)';

/* ==================================================================== */
/* Technical / Financial — costed exposure by system                     */
/* ==================================================================== */

function ExposureBySystem({ caseData }: { caseData: PropertyCase }) {
  const rows = useMemo(() => {
    const open = (caseData.technicalFindings ?? []).filter(
      f => f.reviewState === 'accepted' && f.status === 'open' && typeof f.estimatedCost === 'number',
    );
    const bySystem = new Map<TechnicalSystem, number>();
    for (const f of open) bySystem.set(f.system, (bySystem.get(f.system) ?? 0) + (f.estimatedCost as number));
    return [...bySystem.entries()].map(([system, total]) => ({ system, total })).sort((a, b) => b.total - a.total);
  }, [caseData]);

  const uncosted = useMemo(
    () =>
      (caseData.technicalFindings ?? []).filter(
        f => f.reviewState === 'accepted' && f.status === 'open' && typeof f.estimatedCost !== 'number',
      ).length,
    [caseData],
  );

  if (rows.length === 0) return null;
  const max = Math.max(...rows.map(r => r.total));
  const currency = caseData.identity.currency;
  const rowH = 30;

  return (
    <Card>
      <CardHeader title="Costed exposure by system" subtitle="Open findings that carry an estimate" />
      <CardBody>
        <svg
          width="100%"
          viewBox={`0 0 420 ${rows.length * rowH + 26}`}
          role="img"
          aria-label={`Costed exposure by system. ${rows.map(r => `${TECHNICAL_SYSTEM_LABEL[r.system]} ${money(r.total, currency)}`).join('; ')}.`}
        >
          <line x1="128" y1="4" x2="128" y2={rows.length * rowH} stroke={AXIS} strokeWidth="1" />
          {rows.map((r, i) => {
            const y = i * rowH + 6;
            const w = Math.max(3, Math.round((r.total / max) * 210));
            return (
              <g key={r.system}>
                <text x="120" y={y + 12} textAnchor="end" fontSize="11" fill="var(--text-secondary)">
                  {TECHNICAL_SYSTEM_LABEL[r.system]}
                </text>
                <rect x="128" y={y + 1} width={w} height="14" rx="4" fill={SERIES_1} />
                <text x={128 + w + 8} y={y + 12} fontSize="11" fill="var(--text-secondary)" className="tabular">
                  {money(r.total, currency, { compact: true })}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="mt-1 text-mini leading-relaxed text-ink-muted">
          Estimates, not quotations.
          {uncosted > 0 ? ` ${uncosted} open finding${uncosted === 1 ? '' : 's'} carr${uncosted === 1 ? 'ies' : 'y'} no figure yet.` : ''}
        </p>
      </CardBody>
    </Card>
  );
}

/* ==================================================================== */
/* Risk — open items by department and severity                          */
/* ==================================================================== */

const SEVERITIES = ['critical', 'serious', 'warning', 'info'] as const;
const DOMAIN_ROWS: DdDomain[] = ['land', 'legal', 'approvals', 'compliance', 'technical', 'financial', 'project_ops'];
const DOMAIN_SHORT: Record<DdDomain, string> = {
  land: 'Land',
  legal: 'Legal',
  approvals: 'Approvals',
  compliance: 'Compliance',
  technical: 'Technical',
  financial: 'Financial',
  project_ops: 'Project / Ops',
  risk: 'Risk',
};
/** One hue, light to dark — a count is a magnitude, so the ramp is sequential. */
const RAMP = ['#e8f1fd', '#dceafa', '#bcd7f5', '#7fb0e8', '#2a78d6'];

function SeverityMatrix({ caseData }: { caseData: PropertyCase }) {
  const grid = useMemo(() => {
    const cells = new Map<string, number>();
    let total = 0;
    for (const r of caseData.result?.risks ?? []) {
      if (r.status !== 'open') continue;
      const key = `${domainForRiskCategory(r.category)}:${r.severity}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
      total += 1;
    }
    for (const f of caseData.technicalFindings ?? []) {
      if (f.reviewState !== 'accepted' || f.status !== 'open') continue;
      const key = `${domainForSystem(f.system)}:${f.severity}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
      total += 1;
    }
    return { cells, total };
  }, [caseData]);

  if (grid.total === 0) return null;
  const max = Math.max(...grid.cells.values());
  const shade = (n: number) => (n === 0 ? 'var(--surface-3)' : RAMP[Math.min(RAMP.length - 1, Math.ceil((n / max) * (RAMP.length - 1)))]);

  return (
    <Card>
      <CardHeader title="Open items by department and severity" subtitle="Counts from the file — nothing was scored on a scale" />
      <CardBody>
        <div className="grid grid-cols-[104px_repeat(4,minmax(0,1fr))] gap-1">
          <div />
          {SEVERITIES.map(s => (
            <div key={s} className="pb-1 text-center text-micro capitalize text-ink-muted">
              {s}
            </div>
          ))}
          {DOMAIN_ROWS.map(domain => (
            <div key={domain} className="contents">
              <div className="pr-2 text-right text-mini leading-[28px] text-ink-secondary">{DOMAIN_SHORT[domain]}</div>
              {SEVERITIES.map(severity => {
                const n = grid.cells.get(`${domain}:${severity}`) ?? 0;
                return (
                  <div
                    key={severity}
                    className="tabular flex h-7 items-center justify-center rounded-[5px] text-[12px] text-ink"
                    style={{ background: shade(n) }}
                    title={`${DOMAIN_SHORT[domain]} · ${severity}: ${n}`}
                  >
                    {n === 0 ? <span className="text-ink-muted">–</span> : n}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-micro text-ink-muted">Fewer</span>
          {RAMP.slice(1).map(c => (
            <span key={c} className="h-2.5 w-6 rounded-[3px]" style={{ background: c }} />
          ))}
          <span className="text-micro text-ink-muted">More</span>
        </div>
      </CardBody>
    </Card>
  );
}

/* ==================================================================== */
/* Legal — the chain, and where it fails to connect                      */
/* ==================================================================== */

function ChainOfCustody({ caseData }: { caseData: PropertyCase }) {
  const chain = caseData.result?.titleGraph?.chains?.[0];
  const dated = useMemo(
    () => (chain?.links ?? []).filter(l => l.at && Number.isFinite(Date.parse(l.at))).sort((a, b) => Date.parse(a.at as string) - Date.parse(b.at as string)),
    [chain],
  );
  if (!chain || dated.length < 2) return null;

  const first = Date.parse(dated[0].at as string);
  const last = Date.parse(dated[dated.length - 1].at as string);
  const span = Math.max(1, last - first);
  const x = (iso: string) => 20 + ((Date.parse(iso) - first) / span) * 380;
  const breaks = chain.breaks.length;

  return (
    <Card>
      <CardHeader
        title="Chain of custody"
        subtitle={`${dated.length} dated instrument${dated.length === 1 ? '' : 's'}${chain.yearsEstablished ? ` · ${chain.yearsEstablished} years established` : ''}`}
      />
      <CardBody>
        <svg
          width="100%"
          viewBox="0 0 420 96"
          role="img"
          aria-label={`Chain of custody across ${dated.length} instruments${breaks > 0 ? `, with ${breaks} break${breaks === 1 ? '' : 's'}` : ' with no breaks'}.`}
        >
          <line x1="20" y1="44" x2="400" y2="44" stroke={AXIS} strokeWidth="1.5" />
          {dated.map((link, i) => {
            const cx = x(link.at as string);
            const year = new Date(link.at as string).getUTCFullYear();
            return (
              <g key={link.id}>
                <circle cx={cx} cy="44" r="6" fill={i === 0 ? 'var(--surface-2)' : SERIES_1} stroke={SERIES_1} strokeWidth="2" />
                <text x={cx} y="28" textAnchor="middle" fontSize="10" fill="var(--text-primary)">
                  {year}
                </text>
                <text x={cx} y="66" textAnchor="middle" fontSize="9.5" fill="var(--text-muted)">
                  {link.label.length > 14 ? `${link.label.slice(0, 14)}…` : link.label}
                </text>
              </g>
            );
          })}
        </svg>
        {breaks > 0 ? (
          <p className="mt-1 text-mini leading-relaxed text-critical">
            {breaks} break{breaks === 1 ? '' : 's'} in this chain — {chain.breaks[0].statement}
          </p>
        ) : (
          <p className="mt-1 text-mini text-ink-muted">No break detected between the instruments on file.</p>
        )}
      </CardBody>
    </Card>
  );
}


/* ==================================================================== */
/* Financial — value by method (the football field)                      */
/* ==================================================================== */

/**
 * Every method's range on one axis, against the asking price.
 *
 * Drawn from `result.anchors`, which the engine already computes per
 * valuation method — no new data and no opinion of ours. One hue, because
 * the methods are one series seen four ways rather than four identities; the
 * asking price is a reference line, not a fifth bar.
 */
function ValueByMethod({ caseData }: { caseData: PropertyCase }) {
  const anchors = caseData.result?.anchors ?? [];
  const asking = caseData.identity.askingPrice;
  const indicative = caseData.result?.indicativeValue;
  if (anchors.length === 0) return null;

  const lows = anchors.map(a => a.low);
  const highs = anchors.map(a => a.high);
  if (asking) { lows.push(asking); highs.push(asking); }
  if (indicative) { lows.push(indicative.low); highs.push(indicative.high); }
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(1, max - min);
  const L = 150;
  const W = 250;
  const x = (v: number) => L + ((v - min) / span) * W;
  const currency = caseData.identity.currency;
  const rowH = 26;
  const rows = anchors.length + (indicative ? 1 : 0);

  return (
    <Card>
      <CardHeader title="Value by method" subtitle="What each approach supports, against the asking price" />
      <CardBody>
        <svg
          width="100%"
          viewBox={`0 0 420 ${rows * rowH + 30}`}
          role="img"
          aria-label={`Value by method. ${anchors.map(a => `${a.label} ${money(a.low, currency)} to ${money(a.high, currency)}`).join('; ')}.`}
        >
          {anchors.map((a, i) => {
            const y = i * rowH + 6;
            const x1 = x(a.low);
            const w = Math.max(4, x(a.high) - x1);
            return (
              <g key={a.id}>
                <text x={L - 8} y={y + 12} textAnchor="end" fontSize="11" fill="var(--text-secondary)">
                  {a.label.length > 22 ? `${a.label.slice(0, 22)}…` : a.label}
                </text>
                <rect x={x1} y={y + 2} width={w} height="13" rx="4" fill={SERIES_1} opacity={0.35 + a.confidence * 0.6} />
              </g>
            );
          })}
          {indicative ? (
            <g>
              <text x={L - 8} y={anchors.length * rowH + 18} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--text-primary)">
                Indicative
              </text>
              <rect
                x={x(indicative.low)}
                y={anchors.length * rowH + 8}
                width={Math.max(4, x(indicative.high) - x(indicative.low))}
                height="13"
                rx="4"
                fill="var(--status-good)"
              />
            </g>
          ) : null}
          {asking ? (
            <g>
              <line x1={x(asking)} y1="2" x2={x(asking)} y2={rows * rowH + 8} stroke="var(--status-critical)" strokeWidth="2" />
              <text x={x(asking)} y={rows * rowH + 22} textAnchor="middle" fontSize="10" fill="var(--status-critical)">
                asking {money(asking, currency, { compact: true })}
              </text>
            </g>
          ) : null}
        </svg>
        {asking && indicative && asking > indicative.high ? (
          <p className="mt-1 text-mini leading-relaxed text-ink-secondary">
            The asking price sits above the indicative range — a gap to explain or negotiate, not a number to argue with.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ==================================================================== */
/* Land — the parcel outline, and what each record says its extent is    */
/* ==================================================================== */

/**
 * The supplied boundary drawn to scale, beside the extents the documents
 * state. Nothing is inferred: the ring is whatever was supplied and its area
 * is computed from that ring, while the document figures come from the
 * dossier's own grouped facts. Where they disagree the drawing says so and
 * stops — reconciling them is the valuer's judgement, not a chart's.
 */
function BoundaryAndExtent({ caseData }: { caseData: PropertyCase }) {
  const boundary = caseData.identity.boundary;
  const stated = useMemo(() => {
    const dossier = buildDepartmentDossier(caseData, 'land');
    return dossier.facts.filter(f => /extent|area/i.test(f.label) && /[0-9]/.test(f.value));
  }, [caseData]);

  if (!boundary && stated.length === 0) return null;

  // Fit the ring into a 200×150 box, preserving shape.
  let path = '';
  if (boundary && boundary.ring.length >= 3) {
    const lats = boundary.ring.map(p => p.lat);
    const lngs = boundary.ring.map(p => p.lng);
    const latSpan = Math.max(1e-9, Math.max(...lats) - Math.min(...lats));
    const lngSpan = Math.max(1e-9, Math.max(...lngs) - Math.min(...lngs));
    const scale = Math.min(200 / lngSpan, 150 / latSpan);
    path =
      boundary.ring
        .map((p, i) => {
          const px = 20 + (p.lng - Math.min(...lngs)) * scale;
          // Latitude increases northward; SVG y increases downward.
          const py = 20 + (Math.max(...lats) - p.lat) * scale;
          return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
        })
        .join(' ') + ' Z';
  }

  return (
    <Card>
      <CardHeader
        title="Boundary and extent"
        subtitle={boundary ? `Outline supplied ${boundary.source.replace(/_/g, ' ')}` : 'What the records state'}
      />
      <CardBody className="flex flex-col gap-3">
        {path ? (
          <svg width="100%" viewBox="0 0 250 190" role="img" aria-label="The supplied parcel outline, drawn to scale.">
            <path d={path} fill="rgba(42,120,214,0.10)" stroke={SERIES_1} strokeWidth="2" />
            <text x="20" y="180" fontSize="10" fill="var(--text-muted)">
              {Math.round(boundary!.computedAreaSqm)} sqm from the supplied outline
              {boundary!.elongation > 2 ? ' · elongated, not a square plot' : ''}
            </text>
          </svg>
        ) : null}
        {stated.length > 0 ? (
          <div>
            <div className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
              What the documents state
            </div>
            <ul className="flex flex-col gap-1">
              {stated.map(f => (
                <li key={f.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-ink-secondary">{f.label}</span>
                  <span className="font-medium text-ink">
                    {f.value}
                    {f.unit ? ` ${f.unit}` : ''}
                  </span>
                  {f.varies ? (
                    <span className="ml-auto rounded-full bg-warning/25 px-2 py-0.5 text-micro text-ink">
                      {f.values?.length} versions
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {boundary ? (
              <p className="mt-2 text-mini leading-relaxed text-ink-muted">
                The outline&rsquo;s own area is stated above it. Where it and a document disagree, that difference is the
                finding — reconciling them is a survey question, not an arithmetic one.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ==================================================================== */
/* Registry                                                              */
/* ==================================================================== */

/**
 * What each department draws. A domain absent from this map draws nothing —
 * which is the correct default, not an omission to be filled in later with a
 * chart that has no question behind it.
 */
export function DepartmentVisuals({ caseData, domain }: { caseData: PropertyCase; domain: DdDomain }) {
  const counts = openTechnicalFindingCounts(caseData.technicalFindings ?? []);
  const exposure = totalOpenEstimatedCost(caseData.technicalFindings ?? []);

  return (
    <div className="flex flex-col gap-3">
      {domain === 'technical' && counts.open > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Critical" value={counts.openCritical} tone={counts.openCritical > 0 ? 'critical' : undefined} />
          <Stat label="Open" value={counts.open} />
          <Stat label="Costed" value={exposure === undefined ? '—' : money(exposure, caseData.identity.currency, { compact: true })} />
          <Stat label="Documents" value={caseData.documents.length} />
        </div>
      ) : null}

      {(domain === 'technical' || domain === 'financial') && <ExposureBySystem caseData={caseData} />}
      {domain === 'financial' && <ValueByMethod caseData={caseData} />}
      {domain === 'risk' && <SeverityMatrix caseData={caseData} />}
      {domain === 'legal' && <ChainOfCustody caseData={caseData} />}
      {domain === 'land' && <BoundaryAndExtent caseData={caseData} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'critical' }) {
  return (
    <div className="rounded-xl border border-[var(--ring)] bg-surface px-3 py-2.5">
      <div className="text-micro uppercase tracking-[0.05em] text-ink-muted">{label}</div>
      <div className={`tabular mt-0.5 text-[19px] font-semibold ${tone === 'critical' ? 'text-critical' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

/* ==================================================================== */
/* Every department — what is open here, at a glance                     */
/* ==================================================================== */

/**
 * This department's open items as one bar, by severity.
 *
 * The workboard listed them: one row per item, a severity badge, a department
 * badge, a title — which is a table of contents for work, not a picture of
 * it. Reading "how bad is this department" off it meant counting badges. A
 * bar answers that before it is read, and each band is a control, so the
 * count is also the way in.
 *
 * Drawn only from what the file holds, like everything else here: a
 * department with nothing open renders nothing rather than an empty axis,
 * because an empty department is a coverage fact and drawing a zeroed chart
 * would dress it up as a clean bill.
 */
export function SeveritySpread({
  counts,
  onSelect,
  selected,
}: {
  counts: { severity: RiskSeverity; n: number }[];
  onSelect?: (severity: RiskSeverity | null) => void;
  selected?: RiskSeverity | null;
}) {
  const present = counts.filter(c => c.n > 0);
  const total = present.reduce((sum, c) => sum + c.n, 0);
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={ariaFor(present, total)}>
        {present.map(c => (
          <span
            key={c.severity}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(c.n / total) * 100}%`, background: SEVERITY_FILL[c.severity] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {present.map(c => {
          const on = selected === c.severity;
          return (
            <button
              key={c.severity}
              type="button"
              onClick={() => onSelect?.(on ? null : c.severity)}
              disabled={!onSelect}
              aria-pressed={onSelect ? on : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-mini ring-1 ring-inset coarse:min-h-11',
                on ? 'bg-brand-soft text-brand ring-brand/30' : 'bg-surface text-ink-secondary ring-[var(--ring)]',
                onSelect && !on && 'hover:text-ink',
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_FILL[c.severity] }} />
              <span className="capitalize">{c.severity}</span>
              <span className="tabular font-semibold text-ink">{c.n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SEVERITY_FILL: Record<RiskSeverity, string> = {
  critical: 'rgb(var(--status-critical-rgb))',
  serious: 'rgb(var(--status-serious-rgb))',
  warning: 'rgb(var(--status-warning-rgb))',
  info: 'rgb(var(--brand-rgb))',
};

function ariaFor(present: { severity: RiskSeverity; n: number }[], total: number): string {
  return `${total} open item${total === 1 ? '' : 's'}: ${present.map(c => `${c.n} ${c.severity}`).join(', ')}`;
}

/**
 * How much of what this department needs is actually on file.
 *
 * A count of documents held, beside a count still required, is two numbers a
 * reader has to divide. This is the division — and it names the shortfall
 * rather than only the proportion, because "7 of 11" is what somebody chases
 * and "64%" is not.
 */
export function CoverageMeter({ held, required }: { held: number; required: number }) {
  const total = held + required;
  if (total === 0) return null;
  const pct = Math.round((held / total) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-mini text-ink-secondary">
          <span className="tabular font-semibold text-ink">{held}</span> of {total} on file
        </span>
        <span className={cn('text-mini', required > 0 ? 'text-warning' : 'text-good')}>
          {required > 0 ? `${required} still to obtain` : 'Nothing outstanding'}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <span
          className="block h-full rounded-full bg-brand transition-[width] duration-base ease-state"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
