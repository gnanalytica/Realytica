import { useMemo } from 'react';
import { openTechnicalFindingCounts, totalOpenEstimatedCost, domainForRiskCategory, domainForSystem } from '@realytica/shared';
import type { DdDomain, PropertyCase, TechnicalSystem } from '@realytica/shared';
import { TECHNICAL_SYSTEM_LABEL } from '@realytica/shared';
import { money } from '../../../lib/format';
import { Card, CardBody, CardHeader } from '../../../components/ui/kit';

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
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
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
            <div key={s} className="pb-1 text-center text-[10px] capitalize text-ink-muted">
              {s}
            </div>
          ))}
          {DOMAIN_ROWS.map(domain => (
            <div key={domain} className="contents">
              <div className="pr-2 text-right text-[11.5px] leading-[28px] text-ink-secondary">{DOMAIN_SHORT[domain]}</div>
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
          <span className="text-[10.5px] text-ink-muted">Fewer</span>
          {RAMP.slice(1).map(c => (
            <span key={c} className="h-2.5 w-6 rounded-[3px]" style={{ background: c }} />
          ))}
          <span className="text-[10.5px] text-ink-muted">More</span>
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
          <p className="mt-1 text-[11.5px] leading-relaxed text-critical">
            {breaks} break{breaks === 1 ? '' : 's'} in this chain — {chain.breaks[0].statement}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-ink-muted">No break detected between the instruments on file.</p>
        )}
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
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Critical" value={counts.openCritical} tone={counts.openCritical > 0 ? 'critical' : undefined} />
          <Stat label="Open" value={counts.open} />
          <Stat label="Costed" value={exposure === undefined ? '—' : money(exposure, caseData.identity.currency, { compact: true })} />
          <Stat label="Documents" value={caseData.documents.length} />
        </div>
      ) : null}

      {(domain === 'technical' || domain === 'financial') && <ExposureBySystem caseData={caseData} />}
      {domain === 'risk' && <SeverityMatrix caseData={caseData} />}
      {domain === 'legal' && <ChainOfCustody caseData={caseData} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'critical' }) {
  return (
    <div className="rounded-xl border border-[var(--ring)] bg-surface px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.05em] text-ink-muted">{label}</div>
      <div className={`tabular mt-0.5 text-[19px] font-semibold ${tone === 'critical' ? 'text-critical' : 'text-ink'}`}>{value}</div>
    </div>
  );
}
