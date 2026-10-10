import { useState } from 'react';
import { Check, ExternalLink, FileText, Pencil, Plus, Search, X } from 'lucide-react';
import {
  ADJUSTMENT_KEYS,
  ADJUSTMENT_LABEL,
  COMPARABLE_AREA_BASIS_LABEL,
  COMPARABLE_SOURCE_LABEL,
  comparableAdjustedRate,
  comparableNetAdjustmentPct,
  comparableRate,
  comparableSchedule,
  parseIndianPrice,
  toSqm,
  type AddComparableInput,
  type ComparableAdjustments,
  type ComparableAreaBasis,
  type ComparableAreaUnit,
  type ComparablePatch,
  type ComparableRecord,
  type DdProject,
} from '@realytica/shared';
import { Button, Select, Tooltip, cn } from '../ui/kit';
import { money } from '../../lib/format';

export interface ComparablesActions {
  onSearch: () => void;
  onAdd: (input: AddComparableInput) => Promise<string | null>;
  onUpdate: (id: string, patch: ComparablePatch) => Promise<string | null>;
  onDecide: (ids: string[], decision: 'accept' | 'reject') => void;
  onOpenSource: (evidenceId: string, focus?: { key?: string; page?: number }) => void;
}

function rate(n: number | null): string {
  return n === null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}/sqm`;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}%`;
}

/**
 * The comparables the market rate is drawn from.
 *
 * Found listings arrive proposed (ochre), with the link to check them against;
 * accepting the rate they give, or each one here, makes them the valuer's.
 * Asking prices are said to be asking prices, and the one figure a valuer
 * nearly always has to supply — the listing discount — can be set for every
 * listing at once rather than five times over.
 */
export function ComparablesRegister({
  project,
  configured,
  searching,
  busy,
  actions,
}: {
  project: DdProject;
  /** Whether portal search is set up on the API. Null while unknown. */
  configured: boolean | null;
  searching: boolean;
  busy: boolean;
  actions: ComparablesActions;
}) {
  const [adding, setAdding] = useState(false);
  const [discount, setDiscount] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [showSetAside, setShowSetAside] = useState(false);
  const rows = project.comparables ?? [];
  const live = rows.filter((c) => c.status !== 'rejected');
  const setAside = rows.filter((c) => c.status === 'rejected');
  const schedule = comparableSchedule(project);
  const search = project.comparableSearch;
  const proposed = live.filter((c) => c.status === 'proposed');

  async function applyDiscount() {
    const n = Number(discount.replace(/[%\s−-]/g, ''));
    if (!Number.isFinite(n) || n <= 0 || n > 60) {
      setDiscountError('A listing discount between 1 and 60%.');
      return;
    }
    setDiscountError(null);
    for (const c of live.filter((x) => x.kind === 'listing' && !(x.adjustments.listing && x.adjustments.listing < 0))) {
      const refused = await actions.onUpdate(c.id, { adjustments: { listing: -n } });
      if (refused) {
        setDiscountError(refused);
        return;
      }
    }
    setDiscount('');
  }

  return (
    <div className="border-t border-hairline">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">Comparables</p>
          <p className="text-mini text-ink-secondary">
            {schedule
              ? `${schedule.count} in play · ${rate(schedule.rawRate)} weighted, ${rate(schedule.adjustedRate)} adjusted (${signed(schedule.netAdjustmentPct)})`
              : 'None yet. Search the portals, or add a sale or listing you hold.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip
            label={
              configured === false
                ? 'Portal search needs a scraping service account (Zyte, Bright Data or Oxylabs) set on the API: UNBLOCKER_PROVIDER and UNBLOCKER_API_KEY.'
                : 'Searches 99acres and MagicBricks near the site — about twenty paid requests to the scraping service.'
            }
          >
            <span>
              <Button size="sm" icon={<Search size={13} />} onClick={actions.onSearch} loading={searching} disabled={busy || configured !== true}>
                {search ? 'Search again' : 'Search portals'}
              </Button>
            </span>
          </Tooltip>
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding((v) => !v)} disabled={busy}>
            Add one
          </Button>
        </div>
      </div>

      {configured === false ? (
        <p className="px-4 pb-2 text-mini leading-relaxed text-ink-muted">
          Portal search is off: it needs a scraping service account on the API. Comparables you add by hand count the same.
        </p>
      ) : null}

      {search ? (
        <p className="px-4 pb-2 text-mini leading-relaxed text-ink-muted">
          Searched {new Date(search.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} near {search.localities.join(' / ')}
          {search.cities.length ? ` (${search.cities[0]})` : ''} within {search.radiusKm} km
          {search.diagnostics.radiusWidened ? ', widened because nearer listings were thin' : ''}: {search.found} found.
          {search.empty ? <span className="block text-ink-secondary">{search.empty}</span> : null}
        </p>
      ) : null}

      {schedule && schedule.undiscountedListings > 0 ? (
        <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] ring-1 ring-inset ring-warning/30">
          <span className="min-w-0 flex-1 text-ink">
            {schedule.undiscountedListings === schedule.listings ? 'These are asking prices' : `${schedule.undiscountedListings} are asking prices`} with no listing discount. Most property sells below its asking price — set what you would take off.
          </span>
          <span className="flex items-center gap-1">
            <input
              inputMode="decimal"
              aria-label="Listing discount for every listing, in percent"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyDiscount();
              }}
              placeholder="10"
              className="h-7 w-14 rounded-md bg-surface px-2 text-right font-mono text-[12px] tabular-nums text-ink ring-1 ring-inset ring-[var(--ring)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <span className="text-ink-secondary">% off</span>
            <Button size="sm" onClick={() => void applyDiscount()} disabled={busy || !discount.trim()}>
              Apply to listings
            </Button>
          </span>
          {discountError ? <span className="basis-full text-mini text-critical">{discountError}</span> : null}
        </div>
      ) : null}

      {adding ? <AddForm evidence={project.evidence} busy={busy} onCancel={() => setAdding(false)} onAdd={async (input) => {
        const refused = await actions.onAdd(input);
        if (!refused) setAdding(false);
        return refused;
      }} /> : null}

      {live.length ? (
        <>
          {proposed.length > 1 ? (
            <div className="flex justify-end px-4 pb-1">
              <Button size="sm" variant="ghost" icon={<Check size={13} />} disabled={busy} onClick={() => actions.onDecide(proposed.map((c) => c.id), 'accept')}>
                Accept {proposed.length} found
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-hairline border-t border-hairline">
            {live.map((c) => (
              <ComparableRow key={c.id} comparable={c} busy={busy} actions={actions} />
            ))}
          </ul>
        </>
      ) : null}

      {setAside.length ? (
        <div className="border-t border-hairline px-4 py-2">
          <button type="button" onClick={() => setShowSetAside((v) => !v)} className="text-mini text-ink-muted hover:text-ink">
            {setAside.length} set aside · {showSetAside ? 'hide' : 'show'}
          </button>
          {showSetAside ? (
            <ul className="mt-1 space-y-1">
              {setAside.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-2 text-mini text-ink-muted">
                  <span className="min-w-0 truncate">{c.title}</span>
                  <button type="button" disabled={busy} onClick={() => actions.onDecide([c.id], 'accept')} className="shrink-0 text-brand hover:underline">
                    Use it after all
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ComparableRow({ comparable: c, busy, actions }: { comparable: ComparableRecord; busy: boolean; actions: ComparablesActions }) {
  const [editing, setEditing] = useState(false);
  const net = comparableNetAdjustmentPct(c);
  const proposed = c.status === 'proposed';
  const meta = [
    c.distanceKm !== undefined ? `${c.distanceKm < 1 ? `${Math.round(c.distanceKm * 1000)} m` : `${c.distanceKm.toFixed(1)} km`}` : null,
    `${Math.round(c.areaSqm).toLocaleString('en-IN')} sqm${c.areaBasis ? ` ${COMPARABLE_AREA_BASIS_LABEL[c.areaBasis]}` : ''}`,
    `${money(c.price, 'INR')} ${c.kind === 'listing' ? 'asking' : 'paid'}`,
    c.date ? `${c.kind === 'listing' ? 'listed' : 'sold'} ${new Date(c.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}` : null,
    net ? `adjusted ${signed(net)}` : null,
    `weight ${Math.round(Math.max(c.weight || 1, 0.1) * 100) / 100}`,
  ].filter(Boolean);
  return (
    <li className={cn('px-4 py-2', proposed && 'bg-provenance/5')}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-[13px]">
            {c.sourceUrl ? (
              <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-mini font-medium text-brand ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken" title="Open the listing">
                {COMPARABLE_SOURCE_LABEL[c.source]}
                <ExternalLink size={10} aria-hidden />
              </a>
            ) : c.evidenceId ? (
              <button type="button" onClick={() => actions.onOpenSource(c.evidenceId!)} className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-mini font-medium text-brand ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken">
                <FileText size={10} aria-hidden />
                {COMPARABLE_SOURCE_LABEL[c.source]}
              </button>
            ) : (
              <span className="shrink-0 rounded px-1 text-mini font-medium text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">{COMPARABLE_SOURCE_LABEL[c.source]}</span>
            )}
            <span className={cn('truncate', proposed ? 'text-provenance-ink' : 'text-ink')} title={c.title}>
              {c.title}
            </span>
          </p>
          <p className="mt-0.5 text-mini text-ink-muted">{meta.join(' · ')}</p>
          {c.match ? (
            <p className="text-micro text-ink-muted" title="How well it matched: distance, size, type, area basis and how recent">
              match {Math.round(c.match.score * 100)}% — distance {Math.round(c.match.distance * 100)}, size {Math.round(c.match.size * 100)}, type {Math.round(c.match.type * 100)}, basis {Math.round(c.match.areaBasis * 100)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-[13px] tabular-nums text-ink" title={`${rate(comparableRate(c))} before adjustment`}>
            {rate(comparableAdjustedRate(c))}
          </span>
          <span className="flex items-center gap-0.5">
            {proposed ? (
              <Tooltip label="Accept — use it">
                <button type="button" disabled={busy} onClick={() => actions.onDecide([c.id], 'accept')} aria-label={`Accept ${c.title}`} className="rounded-md p-1 text-[var(--status-good-text)] hover:bg-good/15 disabled:opacity-40">
                  <Check size={14} />
                </button>
              </Tooltip>
            ) : null}
            <Tooltip label="Adjust it to the subject">
              <button type="button" disabled={busy} onClick={() => setEditing((v) => !v)} aria-label={`Adjust ${c.title}`} className="rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40">
                <Pencil size={13} />
              </button>
            </Tooltip>
            <Tooltip label="Set aside — not comparable">
              <button type="button" disabled={busy} onClick={() => actions.onDecide([c.id], 'reject')} aria-label={`Set aside ${c.title}`} className="rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40">
                <X size={14} />
              </button>
            </Tooltip>
          </span>
        </div>
      </div>
      {editing ? <AdjustForm comparable={c} busy={busy} onDone={() => setEditing(false)} onUpdate={actions.onUpdate} /> : null}
    </li>
  );
}

function AdjustForm({ comparable: c, busy, onDone, onUpdate }: { comparable: ComparableRecord; busy: boolean; onDone: () => void; onUpdate: ComparablesActions['onUpdate'] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...ADJUSTMENT_KEYS.map((k) => [k, c.adjustments[k] !== undefined ? String(c.adjustments[k]) : '']), ['weight', String(c.weight ?? 1)]]),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    const adjustments: ComparableAdjustments = {};
    for (const k of ADJUSTMENT_KEYS) {
      const raw = values[k]?.trim() ?? '';
      const n = raw === '' ? 0 : Number(raw.replace(/[%\s]/g, '').replace('−', '-'));
      if (!Number.isFinite(n)) {
        setError(`${ADJUSTMENT_LABEL[k]} is not a number.`);
        return;
      }
      adjustments[k] = n;
    }
    const weight = Number(values.weight);
    setSaving(true);
    const refused = await onUpdate(c.id, { adjustments, ...(Number.isFinite(weight) ? { weight } : {}) });
    setSaving(false);
    if (refused) setError(refused);
    else onDone();
  }
  return (
    <div className="mt-2 rounded-lg bg-sunken/60 p-2 ring-1 ring-inset ring-[var(--ring)]">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr))]">
        {[...ADJUSTMENT_KEYS, 'weight' as const].map((k) => (
          <label key={k} className="flex flex-col gap-0.5 text-micro text-ink-muted">
            {k === 'weight' ? 'Weight' : `${ADJUSTMENT_LABEL[k]} %`}
            <input
              inputMode="decimal"
              value={values[k] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') onDone();
              }}
              placeholder={k === 'listing' ? '−10' : '0'}
              className="h-7 rounded-md bg-surface px-2 text-right font-mono text-[12px] tabular-nums text-ink ring-1 ring-inset ring-[var(--ring)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-micro leading-relaxed text-ink-muted">Signed: negative when the comparable is better than the subject. A listing discount is negative — what an asking price would likely sell at.</p>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {error ? <span className="text-mini text-critical">{error}</span> : null}
      </div>
    </div>
  );
}

const UNITS: Array<{ key: ComparableAreaUnit; label: string }> = [
  { key: 'sqft', label: 'sq ft' },
  { key: 'sqm', label: 'sqm' },
  { key: 'sqyd', label: 'sq yd' },
  { key: 'guntas', label: 'guntas' },
  { key: 'acres', label: 'acres' },
];

function AddForm({ evidence, busy, onAdd, onCancel }: { evidence: DdProject['evidence']; busy: boolean; onAdd: (input: AddComparableInput) => Promise<string | null>; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [area, setArea] = useState('');
  const [unit, setUnit] = useState<ComparableAreaUnit>('sqft');
  const [basis, setBasis] = useState<ComparableAreaBasis | ''>('');
  const [kind, setKind] = useState<'transaction' | 'listing'>('transaction');
  const [date, setDate] = useState('');
  const [link, setLink] = useState('');
  const [doc, setDoc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = 'h-8 rounded-md bg-surface px-2 text-[12px] text-ink ring-1 ring-inset ring-[var(--ring)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

  async function save() {
    const rupees = parseIndianPrice(price);
    const amount = Number(area.replace(/[,\s]/g, ''));
    if (!title.trim()) return setError('Say what it is — a locality, a building, a survey number.');
    if (!rupees) return setError('The price — “6.2 Cr”, “85 L” or the figure in rupees.');
    if (!Number.isFinite(amount) || amount <= 0) return setError('The area, as a number.');
    setSaving(true);
    const refused = await onAdd({
      title: title.trim(),
      price: rupees,
      areaSqm: Math.round(toSqm(amount, unit) * 100) / 100,
      kind,
      ...(basis ? { areaBasis: basis } : {}),
      ...(date ? { date } : {}),
      ...(link.trim() ? { sourceUrl: link.trim() } : {}),
      ...(doc ? { evidenceId: doc } : {}),
    });
    setSaving(false);
    setError(refused);
  }

  return (
    <div className="mx-4 mb-3 rounded-lg bg-sunken/60 p-3 ring-1 ring-inset ring-[var(--ring)]">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))]">
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted [grid-column:1/-1]">
          What it is
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Plot, Sy. 121/4, White Field" className={field} />
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          {kind === 'listing' ? 'Asking price' : 'Price paid'}
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="6.2 Cr" className={cn(field, 'font-mono')} />
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          Area
          <span className="flex gap-1">
            <input inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="12000" className={cn(field, 'w-full font-mono')} />
            <Select value={unit} onChange={(e) => setUnit(e.target.value as ComparableAreaUnit)} className="h-8 w-24 text-[12px]" aria-label="Area unit">
              {UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </Select>
          </span>
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          Measured on
          <Select value={basis} onChange={(e) => setBasis(e.target.value as ComparableAreaBasis | '')} className="h-8 text-[12px]">
            <option value="">Not stated</option>
            {(Object.keys(COMPARABLE_AREA_BASIS_LABEL) as ComparableAreaBasis[]).map((b) => (
              <option key={b} value={b}>
                {COMPARABLE_AREA_BASIS_LABEL[b]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          A sale or a listing
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'transaction' | 'listing')} className="h-8 text-[12px]">
            <option value="transaction">Registered sale</option>
            <option value="listing">Listing (asking price)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          {kind === 'listing' ? 'Listed on' : 'Registered on'}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          Link
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className={field} />
        </label>
        <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
          Or the document on file
          <Select value={doc} onChange={(e) => setDoc(e.target.value)} className="h-8 text-[12px]">
            <option value="">None</option>
            {evidence
              .filter((e) => e.attachments.length > 0)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </Select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={busy}>
          Add comparable
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {error ? <span className="text-mini text-critical">{error}</span> : null}
      </div>
    </div>
  );
}
