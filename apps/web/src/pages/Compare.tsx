import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  Check,
  ClipboardCopy,
  GitCompare,
  Plus,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { CaseSummary, ComparisonResult, ComparisonRow, CurrencyCode, PropertyCase } from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { PROPERTY_TYPE_LABEL, money, num, perSqm, pct } from '../lib/format';
import { formatRate, useAreaUnit } from '../lib/units';
import type { AreaUnit } from '../lib/units';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Select,
  Skeleton,
  cn,
  useToast,
} from '../components/ui/kit';
import ValueRangeChart from '../components/charts/ValueRangeChart';

const MIN_COMPARE = 2;
const MAX_COMPARE = 4;

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function formatRowValue(
  row: ComparisonRow,
  value: number | string | null,
  currency: CurrencyCode,
  areaUnit: AreaUnit,
): string {
  if (value === null || value === undefined) return '—';
  if (row.format === 'text' || typeof value !== 'number') return String(value);
  switch (row.format) {
    case 'currency':
      return money(value, currency);
    case 'currency_per_sqm':
      return formatRate(value, areaUnit, currency);
    case 'number':
      return num(value);
    case 'percent':
      return pct(value, 1);
    case 'score':
      return num(value, 0);
    case 'days':
      return `${num(value, 0)} d`;
    default:
      return String(value);
  }
}

function winningCaseIds(row: ComparisonRow): Set<string> {
  if (row.better === 'none') return new Set();
  const numeric = row.values.filter((v): v is { caseId: string; value: number; note?: string } => typeof v.value === 'number');
  if (numeric.length < 2) return new Set();
  const best = row.better === 'higher' ? Math.max(...numeric.map((v) => v.value)) : Math.min(...numeric.map((v) => v.value));
  return new Set(numeric.filter((v) => v.value === best).map((v) => v.caseId));
}

function buildTsv(result: ComparisonResult, areaUnit: AreaUnit): string {
  const header = ['Metric', ...result.cases.map((c) => `${c.reference} — ${c.label}`)];
  const lines = [header.join('\t')];
  for (const row of result.rows) {
    const cells = result.cases.map((c) => {
      const v = row.values.find((x) => x.caseId === c.id)?.value ?? null;
      return formatRowValue(row, v, c.currency, areaUnit);
    });
    lines.push([row.label, ...cells].join('\t'));
  }
  return lines.join('\n');
}

/** Checkbox list of every case, used both for the first-time picker and the "edit selection" panel. */
function CasePicker({
  cases,
  selected,
  onToggle,
}: {
  cases: CaseSummary[];
  selected: string[];
  onToggle: (id: string, next: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {cases.map((c) => {
        const checked = selected.includes(c.id);
        const disabled = !checked && selected.length >= MAX_COMPARE;
        return (
          <label
            key={c.id}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border border-hairline p-2.5 text-left transition-colors',
              checked ? 'bg-brand-soft ring-1 ring-inset ring-brand/30' : 'hover:bg-sunken',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <Checkbox checked={checked} disabled={disabled} onChange={(next) => onToggle(c.id, next)} />
            <div className="min-w-0">
              <div className="truncate font-mono text-micro text-ink-muted">{c.reference}</div>
              <div className="truncate text-[13px] font-medium text-ink">{c.label}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-mini text-ink-secondary">
                <span>{c.city}</span>
                <span className="text-ink-muted">·</span>
                <span>{PROPERTY_TYPE_LABEL[c.propertyType]}</span>
                <span className="text-ink-muted">·</span>
                <span>{c.currency}</span>
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function PickerScreen({ preselected }: { preselected: string[] }) {
  const [, setSearchParams] = useSearchParams();
  const { data: cases, error, loading, refresh } = useAsync(() => api.listCases(), []);
  const [selected, setSelected] = useState<string[]>(preselected);

  function toggle(id: string, next: boolean) {
    setSelected((prev) => {
      if (!next) return prev.filter((x) => x !== id);
      if (prev.includes(id) || prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
          <GitCompare size={18} className="text-ink-muted" /> Compare properties
        </h1>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Choose between 2 and {MAX_COMPARE} cases to compare their value, confidence, risk and completeness side by side.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Select cases"
          subtitle={`${selected.length} selected · pick ${MIN_COMPARE}–${MAX_COMPARE}`}
        />
        <CardBody>
          {loading && !cases ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <Callout tone="critical" title="Couldn't load cases">
              <p>{error}</p>
              <Button variant="secondary" size="sm" className="mt-2" icon={<RotateCw size={13} />} onClick={() => void refresh()}>
                Retry
              </Button>
            </Callout>
          ) : !cases || cases.length === 0 ? (
            <EmptyState
              title="No cases to compare"
              description="Create at least two property cases before comparing them."
              action={
                <Link to="/cases/new">
                  <Button variant="primary" size="sm">
                    Create a case
                  </Button>
                </Link>
              }
            />
          ) : (
            <CasePicker cases={cases} selected={selected} onToggle={toggle} />
          )}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={<GitCompare size={14} />}
          disabled={selected.length < MIN_COMPARE}
          onClick={() => setSearchParams({ cases: selected.join(',') })}
        >
          Compare {selected.length > 0 ? `${selected.length} case${selected.length === 1 ? '' : 's'}` : ''}
        </Button>
      </div>
    </div>
  );
}

function CompareScreen({ caseIds }: { caseIds: string[] }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  // Comparison spans cases that may differ in country, so the shared
  // preference decides rather than any one case's default.
  const { unit: areaUnit } = useAreaUnit();
  const [editing, setEditing] = useState(false);
  const [draftSelected, setDraftSelected] = useState<string[]>(caseIds);
  const [addPick, setAddPick] = useState('');

  const key = caseIds.join(',');
  const { data: allCases } = useAsync(() => api.listCases(), []);
  const {
    data: result,
    error,
    loading,
    refresh,
  } = useAsync(() => api.compare(caseIds), [key]);
  const { data: fullCases } = useAsync(() => Promise.all(caseIds.map((id) => api.getCase(id))), [key]);

  const currencySet = useMemo(() => {
    if (!fullCases) return new Set<CurrencyCode>();
    return new Set(fullCases.map((c) => c.identity.currency));
  }, [fullCases]);
  const sameCurrency = currencySet.size <= 1;

  function applySelection(ids: string[]) {
    if (ids.length < MIN_COMPARE) {
      toast(`Select at least ${MIN_COMPARE} cases to compare`, 'warning');
      return;
    }
    setSearchParams({ cases: ids.join(',') });
    setEditing(false);
  }

  function removeCase(id: string) {
    const next = caseIds.filter((x) => x !== id);
    if (next.length < MIN_COMPARE) {
      toast(`At least ${MIN_COMPARE} cases are needed to compare`, 'warning');
      return;
    }
    setSearchParams({ cases: next.join(',') });
  }

  function addCase(id: string) {
    if (!id || caseIds.includes(id) || caseIds.length >= MAX_COMPARE) return;
    setSearchParams({ cases: [...caseIds, id].join(',') });
    setAddPick('');
  }

  async function copyTsv() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildTsv(result, areaUnit));
      toast('Comparison copied to clipboard as a table', 'good');
    } catch {
      toast('Could not copy — clipboard unavailable', 'critical');
    }
  }

  const addableCases = (allCases ?? []).filter((c) => !caseIds.includes(c.id));

  const chipCases: { id: string; reference: string; label: string }[] =
    result?.cases ??
    caseIds.map((id) => {
      const summary = allCases?.find((c) => c.id === id);
      return { id, reference: summary?.reference ?? id, label: summary?.label ?? '' };
    });

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
            <GitCompare size={18} className="text-ink-muted" /> Compare properties
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {result ? `${result.cases.length} cases · generated ${new Date(result.generatedAt).toLocaleString()}` : 'Loading comparison…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowLeftRight size={13} />}
            onClick={() => {
              if (!editing) setDraftSelected(caseIds);
              setEditing((v) => !v);
            }}
          >
            {editing ? 'Close' : 'Edit selection'}
          </Button>
          <Button variant="secondary" size="sm" icon={<ClipboardCopy size={13} />} disabled={!result} onClick={() => void copyTsv()}>
            Copy as table
          </Button>
        </div>
      </div>

      {/* selected case chips + add case */}
      <div className="flex flex-wrap items-center gap-2">
        {chipCases.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pl-3 pr-1.5 text-xs ring-1 ring-inset ring-[var(--ring)]">
            <span className="font-mono text-micro text-ink-muted">{c.reference}</span>
            <span className="font-medium text-ink">{c.label}</span>
            <button
              type="button"
              aria-label={`Remove ${c.reference} from comparison`}
              onClick={() => removeCase(c.id)}
              className="rounded-full p-0.5 text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {caseIds.length < MAX_COMPARE ? (
          <div className="w-56">
            <Select aria-label="Add a case to compare" value={addPick} onChange={(e) => addCase(e.target.value)}>
              <option value="">
                + Add case ({caseIds.length}/{MAX_COMPARE})
              </option>
              {addableCases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reference} — {c.label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <Badge tone="neutral">Max {MAX_COMPARE} reached</Badge>
        )}
      </div>

      {editing && allCases ? (
        <Card>
          <CardHeader title="Change selection" subtitle={`${draftSelected.length} selected · pick ${MIN_COMPARE}–${MAX_COMPARE}`} />
          <CardBody className="space-y-3">
            <CasePicker
              cases={allCases}
              selected={draftSelected}
              onToggle={(id, next) =>
                setDraftSelected((prev) => {
                  if (!next) return prev.filter((x) => x !== id);
                  if (prev.includes(id) || prev.length >= MAX_COMPARE) return prev;
                  return [...prev, id];
                })
              }
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => applySelection(draftSelected)}>
                Update comparison
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {loading && !result ? (
        <Card>
          <CardBody className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-40 w-full" />
          </CardBody>
        </Card>
      ) : error ? (
        <Callout tone="critical" title="Couldn't compare these cases">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-2" icon={<RotateCw size={13} />} onClick={() => void refresh()}>
            Retry
          </Button>
        </Callout>
      ) : !result || result.rows.length === 0 ? (
        <Card>
          <EmptyState title="No comparable data" description="The comparison engine returned no metrics for these cases." />
        </Card>
      ) : (
        <>
          {/* shortlist recommendation */}
          {result.shortlist ? (
            <Card className="border-l-4 !border-l-brand">
              <CardBody className="flex items-start gap-3">
                <Sparkles size={18} className="mt-0.5 shrink-0 text-brand" />
                <div className="min-w-0">
                  <div className="text-mini font-semibold uppercase tracking-[0.06em] text-ink-muted">Recommended shortlist</div>
                  <div className="mt-0.5 text-[15px] font-semibold text-ink">
                    {result.cases.find((c) => c.id === result.shortlist?.caseId)?.reference ?? result.shortlist.caseId} —{' '}
                    {result.cases.find((c) => c.id === result.shortlist?.caseId)?.label}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{result.shortlist.reason}</p>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Callout tone="neutral" title="No clear shortlist">
              The comparison did not produce a single recommended case — review the matrix and caveats below before deciding.
            </Callout>
          )}

          {/* caveats */}
          {!sameCurrency ? (
            <Callout tone="critical" title="Currencies differ across these cases">
              {Array.from(currencySet).join(' and ')} figures are shown as-is and are <strong>not directly commensurate</strong> — do
              not compare currency values across these cases without converting them yourself.
            </Callout>
          ) : null}
          {result.caveats.map((c, i) => (
            <Callout key={i} tone="warning" title="Comparison caveat">
              {c}
            </Callout>
          ))}

          {/* mini value-range charts, only when currencies match and cases are screened */}
          {sameCurrency && fullCases && fullCases.some((c) => c.result) ? (
            <Card>
              <CardHeader title="Indicative value ranges" />
              <CardBody className="overflow-x-auto">
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${result.cases.length}, minmax(180px, 1fr))` }}>
                  {result.cases.map((c) => {
                    const full: PropertyCase | undefined = fullCases.find((f) => f.id === c.id);
                    const rv = full?.result;
                    return (
                      <div key={c.id} className="min-w-0">
                        <div className="truncate text-xs font-medium text-ink-secondary">{c.reference}</div>
                        {rv ? (
                          <ValueRangeChart
                            low={rv.indicativeValue.low}
                            mid={rv.indicativeValue.mid}
                            high={rv.indicativeValue.high}
                            currency={rv.indicativeValue.currency}
                            askingPrice={full?.identity.askingPrice ?? null}
                            height={72}
                          />
                        ) : null}
                        {rv ? (
                          // Each mini band is drawn on its own scale, so the
                          // endpoints are labelled — otherwise two very different
                          // magnitudes read as comparable bar lengths.
                          <div className="tabular flex items-baseline justify-between gap-2 text-mini text-ink-muted">
                            <span>{money(rv.indicativeValue.low, rv.indicativeValue.currency)}</span>
                            <span className="font-medium text-ink-secondary">
                              mid {money(rv.indicativeValue.mid, rv.indicativeValue.currency)}
                            </span>
                            <span>{money(rv.indicativeValue.high, rv.indicativeValue.currency)}</span>
                          </div>
                        ) : (
                          <div className="flex h-[72px] items-center justify-center text-mini text-ink-muted">Not yet screened</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/* comparison matrix */}
          <Card>
            <CardHeader
              title="Comparison matrix"
              subtitle="Highlighted cells mark the best value in each row — never colour alone"
            />
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 min-w-[180px] border-b border-r border-hairline bg-surface px-3 py-2 text-left text-mini font-semibold uppercase tracking-[0.05em] text-ink-muted">
                      Metric
                    </th>
                    {result.cases.map((c) => (
                      <th
                        key={c.id}
                        className="sticky top-0 z-10 min-w-[140px] border-b border-hairline bg-surface px-3 py-2 text-left align-top"
                      >
                        <div className="truncate font-mono text-micro text-ink-muted">{c.reference}</div>
                        <div className="truncate text-[13px] font-semibold text-ink">{c.label}</div>
                        <div className="text-mini text-ink-muted">{c.currency}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => {
                    const best = winningCaseIds(row);
                    return (
                      <tr key={row.key} className="group">
                        <td className="sticky left-0 z-10 border-b border-r border-hairline bg-surface px-3 py-2 text-[13px] font-medium text-ink">
                          {row.label}
                        </td>
                        {result.cases.map((c) => {
                          const cell = row.values.find((v) => v.caseId === c.id);
                          const value = cell?.value ?? null;
                          const isBest = best.has(c.id);
                          return (
                            <td
                              key={c.id}
                              className={cn(
                                'border-b border-hairline px-3 py-2 tabular align-top',
                                isBest && 'bg-good/10',
                              )}
                              title={cell?.note}
                            >
                              <div className="flex items-center gap-1.5">
                                {isBest ? <Check size={12} className="shrink-0 text-[var(--status-good-text)]" /> : null}
                                <span className={cn('truncate', isBest ? 'font-semibold text-ink' : 'text-ink-secondary')}>
                                  {formatRowValue(row, value, c.currency, areaUnit)}
                                </span>
                              </div>
                              {cell?.note ? <div className="mt-0.5 text-mini text-ink-muted">{cell.note}</div> : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function Compare() {
  const [searchParams] = useSearchParams();
  const caseIds = useMemo(() => parseIds(searchParams.get('cases')).slice(0, MAX_COMPARE), [searchParams]);

  if (caseIds.length < MIN_COMPARE) {
    return <PickerScreen preselected={caseIds} />;
  }

  return <CompareScreen caseIds={caseIds} />;
}
