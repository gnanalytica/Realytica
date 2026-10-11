import { useEffect, useState, type ReactNode } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import {
  VALUE_APPROACH_LABEL,
  ownSales,
  propertySurveyLine,
  type DdProject,
  type ValuationApproachRun,
  type ValuationMethodKey,
  type ValuationWorking,
  type ValueApproachKey,
  type ValueInputRow,
  type ValueOffer,
} from '@realytica/shared';
import { Button, Card, CardBody, CardHeader, Select, Tooltip, cn } from '../ui/kit';
import { money } from '../../lib/format';
import { useTyped } from '../reading/FactRow';

/** Where on a paper to open the reading desk. */
export type ValueSourceFocus = { key?: string; page?: number };

const METHOD: Partial<Record<ValueApproachKey, ValuationMethodKey>> = {
  comparable: 'comparable_rate',
  cost: 'depreciated_replacement_cost',
  income: 'investment_income',
  residual: 'residual_land',
};

const FORMULA: Record<ValueApproachKey, (building: boolean) => string> = {
  property: () => 'Measured once; every approach reads it',
  comparable: () => 'Area × rate × (1 + net adjustment)',
  cost: (building) => (building ? 'Plot × land rate + built area × replacement cost × (1 − age ÷ life)' : 'Plot area × land rate'),
  income: () => 'Rent × area × 12 × (1 − vacancy) × (1 − outgoings) ÷ cap rate',
  residual: () => 'Development value less costs and profit, discounted to today',
};

/** The inputs a bare site has no use for. */
const BUILDING_ONLY = new Set(['built_up_area', 'carpet_area', 'replacement_rate', 'effective_age_years', 'expected_life_years']);

export interface ValueApproachActions {
  onAccept: (ids: string[]) => void;
  onSetAside: (ids: string[]) => void;
  /** Record a value a person typed or chose; resolves to why it would not save, or null. */
  onCommit: (row: ValueInputRow, value: number | string | null, citeEvidenceId?: string) => Promise<string | null>;
  /** Open the paper; pass key/page so the desk points at that value alone. */
  onOpenSource: (evidenceId: string, focus?: ValueSourceFocus) => void;
}

/**
 * The approaches, each with the inputs it runs on.
 *
 * Each input is an always-editable field. A value somebody recorded sits in
 * the field (ink). A value the file still offers sits beside it in ochre,
 * with accept / set-aside. An eye opens the paper on the page that stated it.
 */
export function ValueApproaches({
  project,
  rows,
  working,
  revealed,
  current,
  busy,
  canRecordChecks,
  actions,
  comparables,
}: {
  project: DdProject;
  /** The comparables register, rendered inside the Comparables card. */
  comparables?: ReactNode;
  rows: ValueInputRow[];
  working: ValuationWorking;
  /** The inputs filled so far, while the page is filling. Null: all of them. */
  revealed: ReadonlySet<string> | null;
  /** The input landing right now. */
  current: string | null;
  busy: boolean;
  /** False until there is a valuation DD to record check inputs on. */
  canRecordChecks: boolean;
  actions: ValueApproachActions;
}) {
  const building = rows.some((r) => r.key === 'built_up_area' && (r.recorded || r.offers.length)) || (project.builtUpAreaSqm ?? 0) > 0;
  // Residual is the development bridge — open on early / build stages even
  // before GDV is typed, so the desk does not hide the approach that matters.
  const residualOpenByStage = [
    'opportunity_site',
    'feasibility',
    'acquisition',
    'design',
    'approvals',
    'procurement',
    'pre_construction',
    'construction',
  ].includes(project.currentStage);
  const approaches: ValueApproachKey[] = ['property', 'comparable', 'cost', 'income', 'residual'];
  return (
    <div id="value-approaches" className="space-y-3 scroll-mt-3">
      {approaches.map((key) => {
        const own = rows.filter((r) => r.approach === key && (building || !BUILDING_ONLY.has(r.key) || r.recorded || r.offers.length));
        const run = METHOD[key] ? working.runs.find((r) => r.method === METHOD[key]) : undefined;
        const used = own.some((r) => r.recorded || r.offers.length);
        // Income stays folded until used. Residual opens on development stages.
        const folded = key === 'income' ? !used : key === 'residual' ? !used && !residualOpenByStage : false;
        // An older sale of the parcel is history, not a rate: said here so the
        // valuer who wants it can adjust it for time and type it in. Only for
        // a bare site — a building's price over the land's extent is a rate
        // for nothing.
        const history =
          key === 'comparable' && !building
            ? ownSales(project)
                .filter((sale) => !sale.recent)
                .map(
                  (sale) =>
                    `This parcel sold on ${new Date(sale.registeredOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} for ${money(sale.price, 'INR')} — ₹${Math.round(sale.ratePerSqm).toLocaleString('en-IN')}/sqm, ${sale.ageYears.toFixed(1)} years ago (${sale.document}). Too old to stand as the rate without a time adjustment, so it is not offered as one.`,
                )
            : [];
        return (
          <ApproachCard
            key={key}
            approach={key}
            rows={own}
            run={run}
            area={key === 'property' ? working.area : undefined}
            formula={FORMULA[key](building)}
            foldedAtFirst={folded}
            notes={history}
            extra={key === 'comparable' ? comparables : undefined}
            revealed={revealed}
            current={current}
            busy={busy}
            canRecordChecks={canRecordChecks}
            actions={actions}
            evidence={project.evidence}
            survey={key === 'property' ? propertySurveyLine(project) : null}
          />
        );
      })}
    </div>
  );
}

function ApproachCard({
  approach,
  rows,
  run,
  area,
  formula,
  foldedAtFirst,
  notes,
  extra,
  revealed,
  current,
  busy,
  canRecordChecks,
  actions,
  evidence,
  survey,
}: {
  approach: ValueApproachKey;
  notes: string[];
  extra?: ReactNode;
  rows: ValueInputRow[];
  run?: ValuationApproachRun;
  area?: ValuationWorking['area'];
  formula: string;
  foldedAtFirst: boolean;
  revealed: ReadonlySet<string> | null;
  current: string | null;
  busy: boolean;
  canRecordChecks: boolean;
  actions: ValueApproachActions;
  evidence: DdProject['evidence'];
  survey?: ReturnType<typeof propertySurveyLine>;
}) {
  const [open, setOpen] = useState(!foldedAtFirst);
  const waiting = rows.filter((r) => r.waiting && (revealed === null || revealed.has(r.key)));
  const result =
    approach === 'property' ? (
      area?.value ? (
        <span className="font-mono text-[13px] tabular-nums text-ink">Valued on {Math.round(area.value).toLocaleString('en-IN')} sqm</span>
      ) : (
        <span className="text-[12px] text-[var(--status-warning-text)]">No area yet</span>
      )
    ) : run?.amount != null ? (
      <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">{money(run.amount, 'INR')}</span>
    ) : (
      <span className="text-[12px] text-ink-muted">{run?.missing.length ? `Needs ${run.missing.slice(0, 2).join(', ').toLowerCase()}` : 'Not run'}</span>
    );

  return (
    <Card>
      <CardHeader
        title={VALUE_APPROACH_LABEL[approach]}
        subtitle={formula}
        action={
          <div className="flex items-center gap-2">
            {waiting.length > 1 ? (
              <Button size="sm" variant="ghost" icon={<Check size={13} />} disabled={busy} onClick={() => actions.onAccept(waiting.map((r) => r.waiting!.id))}>
                Accept {waiting.length}
              </Button>
            ) : null}
            {result}
            {foldedAtFirst ? (
              <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {open ? 'Hide' : 'Show'}
              </Button>
            ) : null}
          </div>
        }
      />
      {open ? (
        <CardBody className="p-0">
          {survey ? <PropertySurveyStrip survey={survey} actions={actions} busy={busy} /> : null}
          <ul className="divide-y divide-hairline">
            {rows.map((row) => (
              <InputRow
                key={row.key}
                row={row}
                pending={revealed !== null && !revealed.has(row.key) && row.waiting !== null}
                hidden={revealed !== null && !revealed.has(row.key)}
                landing={current === row.key}
                busy={busy}
                editable={row.target.kind === 'project' || canRecordChecks}
                actions={actions}
                evidence={evidence}
              />
            ))}
          </ul>
          {notes.map((note) => (
            <p key={note} className="border-t border-hairline px-4 py-2 text-mini leading-relaxed text-ink-secondary">
              {note}
            </p>
          ))}
          {run?.amount != null && run.weightBasis ? <p className="border-t border-hairline px-4 py-2 text-mini leading-relaxed text-ink-muted">{run.weightBasis}</p> : null}
          {extra}
        </CardBody>
      ) : null}
    </Card>
  );
}

/** Fact key/page an offer carries, for pointing the reading desk. */
function offerFocus(offer: ValueOffer): ValueSourceFocus | undefined {
  const key = offer.facts?.[0]?.key;
  const page = offer.source.page;
  if (key === undefined && page === undefined) return undefined;
  return { ...(key !== undefined ? { key } : {}), ...(page !== undefined ? { page } : {}) };
}

/** Focus for a recorded figure: the document fact it was read from, not the whole paper. */
function recordedFocus(row: ValueInputRow): ValueSourceFocus | undefined {
  const recorded = row.recorded;
  if (!recorded) return undefined;
  if (recorded.factKey || recorded.page !== undefined) {
    return {
      ...(recorded.factKey ? { key: recorded.factKey } : {}),
      ...(recorded.page !== undefined ? { page: recorded.page } : {}),
    };
  }
  // Still-offered figure on the same paper: it names the fact key.
  const matched = row.offers.find(
    (o) =>
      o.source.evidenceId === recorded.evidenceId ||
      o.facts?.some((f) => f.evidenceId === recorded.evidenceId),
  );
  return matched ? offerFocus(matched) : undefined;
}

/** A paper the eye can open: document-backed offer, or a recorded citation. */
function eyeTarget(row: ValueInputRow, offer: ValueOffer | null): { evidenceId: string; focus?: ValueSourceFocus } | null {
  if (offer?.source.evidenceId && offer.source.kind === 'document') {
    return { evidenceId: offer.source.evidenceId, focus: offerFocus(offer) };
  }
  if (offer?.facts?.[0]?.evidenceId) {
    const fact = offer.facts[0]!;
    return { evidenceId: fact.evidenceId, focus: { key: fact.key, ...(offer.source.page !== undefined ? { page: offer.source.page } : {}) } };
  }
  if (row.recorded?.evidenceId) {
    return { evidenceId: row.recorded.evidenceId, focus: recordedFocus(row) };
  }
  return null;
}

function draftFromRecorded(row: ValueInputRow): string {
  return row.recorded ? String(row.recorded.value) : '';
}

/** Survey numbers named on the papers — identity, not an editable rate. */
function PropertySurveyStrip({
  survey,
  actions,
  busy,
}: {
  survey: NonNullable<ReturnType<typeof propertySurveyLine>>;
  actions: ValueApproachActions;
  busy: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 border-b border-hairline px-3 py-1.5">
      <div className="w-[8.5rem] shrink-0 sm:w-[10rem]">
        <p className="text-[12px] font-medium text-ink">Survey no.</p>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate font-mono text-[12px] tabular-nums text-ink">{survey.display}</p>
        <Tooltip label="Show where this was found">
          <button
            type="button"
            disabled={busy}
            onClick={() => actions.onOpenSource(survey.evidenceId, { key: survey.key, ...(survey.page !== undefined ? { page: survey.page } : {}) })}
            aria-label="Show where the survey number was found"
            className="shrink-0 rounded-md p-0.5 text-provenance-ink hover:bg-provenance/15 disabled:opacity-40"
          >
            <Sparkles size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function InputRow({
  row,
  pending,
  hidden,
  landing,
  busy,
  editable,
  actions,
  evidence,
}: {
  row: ValueInputRow;
  /** It will fill shortly. */
  pending: boolean;
  /** Not reached by the fill yet. */
  hidden: boolean;
  /** Landing now. */
  landing: boolean;
  busy: boolean;
  editable: boolean;
  actions: ValueApproachActions;
  evidence: DdProject['evidence'];
}) {
  const [draft, setDraft] = useState(() => draftFromRecorded(row));
  const [cite, setCite] = useState(row.recorded?.evidenceId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const offer = !hidden ? row.waiting : null;
  const typed = useTyped(offer?.display ?? '', 0, landing);
  const eye = eyeTarget(row, offer);
  const recordedKey = row.recorded ? `${row.recorded.value}|${row.recorded.evidenceId ?? ''}` : '';
  // Valytica: the AI figure is the field until accepted — dashed box, not a side chip.
  const suggest = Boolean(offer && !row.recorded && !pending);

  // When the file records a figure (accept or save), the field follows it.
  useEffect(() => {
    setDraft(draftFromRecorded(row));
    setCite(row.recorded?.evidenceId ?? '');
    setDirty(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the recorded figure changes
  }, [recordedKey]);

  async function save() {
    if (!editable) return;
    const text = draft.trim();
    const n = text === '' ? null : Number(text.replace(/[,\s₹]/g, ''));
    if (n !== null && !Number.isFinite(n)) {
      setError('That is not a number.');
      return;
    }
    const recorded = row.recorded?.value ?? null;
    if (n === recorded && (n === null || !row.proof || cite === (row.recorded?.evidenceId ?? ''))) {
      setError(null);
      setDirty(false);
      return;
    }
    if (row.proof && n !== null && !cite) {
      setError(`Choose the document it is read from — ${row.label.toLowerCase()} has to cite one.`);
      return;
    }
    setSaving(true);
    const refused = await actions.onCommit(row, n, cite || undefined);
    setSaving(false);
    if (refused) setError(refused);
    else {
      setError(null);
      setDirty(false);
    }
  }


  return (
    <li className={cn('relative px-3 py-1.5', landing && 'animate-fade-in')}>
      {landing ? <span className="pointer-events-none absolute inset-0 animate-flash-provenance" aria-hidden /> : null}
      <div className="relative space-y-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="w-[8.5rem] shrink-0 sm:w-[10rem]">
            <p className="flex flex-wrap items-center gap-1 text-[12px] leading-snug">
              <span className="font-medium text-ink">{row.label}</span>
              {row.proof ? (
                <span className="shrink-0 rounded px-1 text-micro text-ink-muted ring-1 ring-inset ring-[var(--ring)]" title="Has to cite a document on the register">
                  cites
                </span>
              ) : null}
              {row.disagree && !hidden ? (
                <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-micro font-medium text-[var(--status-warning-text)]" title="The file states different figures for this">
                  papers differ
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex min-w-0 flex-1 items-stretch gap-1.5">
            {pending ? (
              <span className="relative block h-8 min-w-0 flex-1 overflow-hidden rounded-lg bg-sunken" aria-hidden>
                <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-provenance/10 to-transparent" />
              </span>
            ) : suggest && offer ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-dashed border-provenance/50 bg-provenance/10 px-2.5 py-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium tabular-nums text-ink">
                  {landing ? typed : offer.display}
                </span>
                <Tooltip label={eye ? 'Show where this was found' : offer.basis}>
                  <button
                    type="button"
                    disabled={busy || !eye}
                    onClick={() => eye && actions.onOpenSource(eye.evidenceId, eye.focus)}
                    aria-label={`Show where ${row.label.toLowerCase()} was found`}
                    className="shrink-0 rounded-md p-0.5 text-provenance-ink hover:bg-provenance/20 disabled:opacity-40"
                  >
                    <Sparkles size={14} />
                  </button>
                </Tooltip>
                <Tooltip label="Accept — record it, citing where it came from">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => actions.onAccept([offer.id])}
                    aria-label={`Accept ${row.label.toLowerCase()} ${offer.display}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-good-text)] text-white hover:opacity-90 disabled:opacity-40"
                  >
                    <Check size={13} strokeWidth={2.5} />
                  </button>
                </Tooltip>
                <Tooltip label="Set aside — it stays out until the file says something new">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => actions.onSetAside([offer.id])}
                    aria-label={`Set aside ${row.label.toLowerCase()} ${offer.display}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink disabled:opacity-40"
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {row.options ? (
                  <Select
                    aria-label={row.label}
                    disabled={!editable || busy || saving}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setDirty(true);
                      setError(null);
                      void (async () => {
                        const next = e.target.value;
                        setSaving(true);
                        const refused = await actions.onCommit(row, next === '' ? null : next, cite || undefined);
                        setSaving(false);
                        if (refused) setError(refused);
                        else {
                          setError(null);
                          setDirty(false);
                        }
                      })();
                    }}
                    className="h-8 min-w-[7rem] flex-1 text-[12px]"
                  >
                    <option value="">Choose…</option>
                    {row.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input
                    inputMode="decimal"
                    aria-label={row.label}
                    disabled={!editable || busy || saving}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setDirty(true);
                      setError(null);
                    }}
                    onBlur={() => {
                      if (dirty) void save();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void save();
                      }
                      if (e.key === 'Escape') {
                        setDraft(draftFromRecorded(row));
                        setCite(row.recorded?.evidenceId ?? '');
                        setDirty(false);
                        setError(null);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder={row.unit}
                    className="h-8 min-w-[7rem] flex-1 rounded-lg bg-sunken px-2.5 text-left font-mono text-[12px] tabular-nums text-ink ring-1 ring-inset ring-[var(--ring)] placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                  />
                )}
                {/* Accepted from the file: keep the AI mark; click opens that field on the paper. */}
                {eye ? (
                  <Tooltip label="Show where this was found">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => actions.onOpenSource(eye.evidenceId, eye.focus)}
                      aria-label={`Show where ${row.label.toLowerCase()} was found`}
                      className="shrink-0 rounded-md p-0.5 text-provenance-ink hover:bg-provenance/15 disabled:opacity-40"
                    >
                      <Sparkles size={14} />
                    </button>
                  </Tooltip>
                ) : null}
                {offer && row.recorded ? (
                  <div className="inline-flex items-center gap-1 rounded-lg border border-dashed border-provenance/50 bg-provenance/10 px-1.5 py-0.5">
                    <span className="font-mono text-[11px] font-medium tabular-nums text-ink">{offer.display}</span>
                    <Tooltip label={offerFocus(offer) || offer.source.evidenceId ? 'Show where this was found' : offer.basis}>
                      <button
                        type="button"
                        disabled={busy || !offer.source.evidenceId}
                        onClick={() =>
                          offer.source.evidenceId && actions.onOpenSource(offer.source.evidenceId, offerFocus(offer))
                        }
                        aria-label={`Show where ${row.label.toLowerCase()} was found`}
                        className="rounded p-0.5 text-provenance-ink hover:bg-provenance/20 disabled:opacity-40"
                      >
                        <Sparkles size={12} />
                      </button>
                    </Tooltip>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => actions.onAccept([offer.id])}
                      aria-label={`Accept ${row.label.toLowerCase()} ${offer.display}`}
                      className="flex size-6 items-center justify-center rounded-md bg-[var(--status-good-text)] text-white hover:opacity-90 disabled:opacity-40"
                    >
                      <Check size={12} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => actions.onSetAside([offer.id])}
                      aria-label={`Set aside ${row.label.toLowerCase()} ${offer.display}`}
                      className="flex size-6 items-center justify-center rounded-md bg-surface text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken disabled:opacity-40"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {row.proof && dirty && draft.trim() !== '' ? (
          <Select
            aria-label={`Document ${row.label.toLowerCase()} is read from`}
            value={cite}
            onChange={(e) => {
              setCite(e.target.value);
              setDirty(true);
            }}
            className="h-7 max-w-[16rem] text-[12px] sm:ml-[calc(10rem+0.625rem)]"
          >
            <option value="">Read from…</option>
            {evidence.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </Select>
        ) : null}
        {error ? <p className="text-mini text-critical sm:pl-[calc(10rem+0.625rem)]">{error}</p> : null}
      </div>
    </li>
  );
}

/** For the summary line: "3 documents, the revenue map and a convention". */
export function describeSources(offers: readonly ValueOffer[]): string {
  const docs = new Set(offers.filter((o) => o.source.kind === 'document').map((o) => o.source.evidenceId));
  const parts: string[] = [];
  if (docs.size) parts.push(`${docs.size} document${docs.size === 1 ? '' : 's'}`);
  if (offers.some((o) => o.source.kind === 'revenue_map')) parts.push('the revenue map');
  if (offers.some((o) => o.source.kind === 'comparables')) parts.push('the comparables');
  if (offers.some((o) => o.source.kind === 'boundary')) parts.push('the surveyor’s outline');
  if (offers.some((o) => o.source.kind === 'project')) parts.push('this file');
  if (offers.some((o) => o.source.kind === 'state_pack')) parts.push('the state pack');
  if (offers.some((o) => o.source.kind === 'convention')) parts.push('a convention');
  if (parts.length <= 1) return parts[0] ?? 'the file';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

