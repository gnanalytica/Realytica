import { useState } from 'react';
import { Check, FileText, Map as MapIcon, Pencil, Sparkles, X } from 'lucide-react';
import {
  VALUE_APPROACH_LABEL,
  ownSales,
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
const BUILDING_ONLY = new Set(['built_up_area', 'replacement_rate', 'effective_age_years', 'expected_life_years']);

export interface ValueApproachActions {
  onAccept: (ids: string[]) => void;
  onSetAside: (ids: string[]) => void;
  /** Record a value a person typed; resolves to why it would not save, or null. */
  onCommit: (row: ValueInputRow, value: number | null, citeEvidenceId?: string) => Promise<string | null>;
  onOpenSource: (evidenceId: string) => void;
}

/**
 * The approaches, each with the inputs it runs on.
 *
 * An input shows one of three things and never confuses them: a value
 * somebody recorded (ink, with a tick), a value the file offers (ochre, with
 * where it came from — the document and page, the map read, the convention),
 * or nothing (a dash, and an invitation to type it). The approach's own
 * result sits in its header, and says which input it is still waiting on.
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
}: {
  project: DdProject;
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
  const approaches: ValueApproachKey[] = ['property', 'comparable', 'cost', 'income', 'residual'];
  return (
    <div className="space-y-3">
      {approaches.map((key) => {
        const own = rows.filter((r) => r.approach === key && (building || !BUILDING_ONLY.has(r.key) || r.recorded || r.offers.length));
        const run = METHOD[key] ? working.runs.find((r) => r.method === METHOD[key]) : undefined;
        const used = own.some((r) => r.recorded || r.offers.length);
        // Income and residual are for a property that earns or a site that is
        // developed; folded until the file says either.
        const folded = (key === 'income' || key === 'residual') && !used;
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
            revealed={revealed}
            current={current}
            busy={busy}
            canRecordChecks={canRecordChecks}
            actions={actions}
            evidence={project.evidence}
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
  revealed,
  current,
  busy,
  canRecordChecks,
  actions,
  evidence,
}: {
  approach: ValueApproachKey;
  notes: string[];
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
        </CardBody>
      ) : null}
    </Card>
  );
}

function SourceChip({ offer, onOpen }: { offer: ValueOffer; onOpen: (id: string) => void }) {
  const Icon = offer.source.kind === 'document' ? FileText : offer.source.kind === 'revenue_map' ? MapIcon : Sparkles;
  const text = `${offer.source.label}${offer.source.detail ? ` · ${offer.source.detail}` : ''}`;
  const tip = (
    <span className="block max-w-[34ch] space-y-1">
      <span className="block">{offer.basis}</span>
      {offer.source.quote ? <span className="block italic text-ink-muted">“{offer.source.quote}”</span> : null}
    </span>
  );
  const body = (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Icon size={11} className="shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
  return (
    <Tooltip label={tip}>
      {offer.source.evidenceId ? (
        <button type="button" onClick={() => onOpen(offer.source.evidenceId!)} className="min-w-0 max-w-full text-left text-mini text-provenance-ink hover:underline">
          {body}
        </button>
      ) : (
        <span className="min-w-0 max-w-full cursor-help text-mini text-provenance-ink">{body}</span>
      )}
    </Tooltip>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [cite, setCite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const offer = row.waiting;
  const typed = useTyped(offer?.display ?? '', 0, landing);
  // Only what says something different: a second document agreeing with the
  // figure shown is corroboration, not an alternative.
  const shownValue = row.recorded?.value ?? offer?.value;
  const alternatives = row.offers.filter((o) => o.id !== offer?.id && (shownValue === undefined || Math.abs(o.value - shownValue) / Math.max(o.value, shownValue, 1) > 0.02));

  async function save() {
    const text = draft.trim();
    const n = text === '' ? null : Number(text.replace(/[,\s₹]/g, ''));
    if (n !== null && !Number.isFinite(n)) {
      setError('That is not a number.');
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
      setEditing(false);
      setError(null);
    }
  }

  const state: 'recorded' | 'offered' | 'missing' = row.recorded ? 'recorded' : offer && !hidden ? 'offered' : 'missing';

  return (
    <li className={cn('relative px-4 py-2', landing && 'animate-fade-in')}>
      {landing ? <span className="pointer-events-none absolute inset-0 animate-flash-provenance" aria-hidden /> : null}
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px]">
            <span
              className={cn(
                'shrink-0',
                state === 'recorded' ? 'text-[var(--status-good-text)]' : state === 'offered' ? 'text-provenance-ink' : row.required ? 'text-[var(--status-warning-text)]' : 'text-ink-muted',
              )}
              aria-label={state === 'recorded' ? 'Recorded' : state === 'offered' ? 'Offered by the file' : 'Not on file'}
            >
              {state === 'recorded' ? <Check size={12} /> : state === 'offered' ? <Sparkles size={12} /> : <span className="inline-block w-3 text-center">–</span>}
            </span>
            <span className="truncate text-ink">{row.label}</span>
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
          <div className="mt-0.5 min-h-[1rem] pl-[1.125rem]">
            {state === 'offered' && offer ? (
              <SourceChip offer={offer} onOpen={actions.onOpenSource} />
            ) : state === 'recorded' ? (
              <span className="text-mini text-ink-muted">{row.recorded!.source ? `Recorded · ${row.recorded!.source}` : 'Recorded'}</span>
            ) : pending ? (
              <span className="text-mini text-ink-muted">Reading…</span>
            ) : (
              <span className="text-mini text-ink-muted">{row.required ? 'Nothing on file — a valuer’s figure' : 'Optional'}</span>
            )}
            {alternatives.length && !hidden ? (
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-mini text-ink-muted">
                <span>The file also says</span>
                {alternatives.slice(0, 3).map((alt) => (
                  <Tooltip key={alt.id} label={alt.basis}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => actions.onAccept([alt.id])}
                      className="font-mono tabular-nums text-ink-secondary underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-50"
                    >
                      {alt.display} ({alt.source.label})
                    </button>
                  </Tooltip>
                ))}
              </span>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-[1.125rem]">
              <input
                autoFocus
                inputMode="decimal"
                aria-label={row.label}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                  if (e.key === 'Escape') setEditing(false);
                }}
                placeholder={row.unit}
                className="h-8 w-36 rounded-md bg-sunken px-2 text-right font-mono text-[13px] tabular-nums text-ink ring-1 ring-inset ring-[var(--ring)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <span className="text-mini text-ink-muted">{row.unit}</span>
              {row.proof ? (
                <Select aria-label={`Document ${row.label.toLowerCase()} is read from`} value={cite} onChange={(e) => setCite(e.target.value)} className="h-8 max-w-[16rem] text-[12px]">
                  <option value="">Read from…</option>
                  {evidence.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Button size="sm" variant="primary" onClick={() => void save()} loading={saving}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {error ? <p className="basis-full text-mini text-critical">{error}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1 pt-px">
          {pending ? (
            <span className="relative block h-4 w-24 overflow-hidden rounded bg-sunken" aria-hidden>
              <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-provenance/10 to-transparent" />
            </span>
          ) : state === 'recorded' ? (
            <span className="font-mono text-[13px] tabular-nums text-ink">{row.recorded!.display}</span>
          ) : state === 'offered' && offer ? (
            <span className="font-mono text-[13px] font-medium tabular-nums text-provenance-ink">{landing ? typed : offer.display}</span>
          ) : (
            <span className="font-mono text-[13px] text-ink-muted">—</span>
          )}
          {state === 'offered' && offer && !pending ? (
            <>
              <Tooltip label="Accept — record it, citing where it came from">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => actions.onAccept([offer.id])}
                  aria-label={`Accept ${row.label.toLowerCase()} ${offer.display}`}
                  className="ml-1 rounded-md p-1 text-[var(--status-good-text)] hover:bg-good/15 disabled:opacity-40"
                >
                  <Check size={14} />
                </button>
              </Tooltip>
              <Tooltip label="Set aside — it stays out until the file says something new">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => actions.onSetAside([offer.id])}
                  aria-label={`Set aside ${row.label.toLowerCase()} ${offer.display}`}
                  className="rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
                >
                  <X size={14} />
                </button>
              </Tooltip>
            </>
          ) : null}
          {!pending && !editing && editable ? (
            <Tooltip label={state === 'missing' ? 'Type it' : 'Type a different figure'}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(row.recorded ? String(row.recorded.value) : '');
                  setCite(row.recorded?.evidenceId ?? '');
                  setError(null);
                  setEditing(true);
                }}
                aria-label={`Type ${row.label.toLowerCase()}`}
                className="rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                <Pencil size={13} />
              </button>
            </Tooltip>
          ) : null}
        </div>
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
  if (offers.some((o) => o.source.kind === 'boundary')) parts.push('the surveyor’s outline');
  if (offers.some((o) => o.source.kind === 'project')) parts.push('this file');
  if (offers.some((o) => o.source.kind === 'state_pack')) parts.push('the state pack');
  if (offers.some((o) => o.source.kind === 'convention')) parts.push('a convention');
  if (parts.length <= 1) return parts[0] ?? 'the file';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

