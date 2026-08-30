import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, MapPin, MoreVertical } from 'lucide-react';
import type { CaseSummary } from '@realytica/shared';
import {
  CASE_STATUS_LABEL,
  PROPERTY_TYPE_LABEL,
  VERDICT_LABEL,
  confidenceTone,
  money,
  relativeTime,
  verdictTone,
} from '../lib/format';
import { api } from '../lib/api';
import { Badge, Button, Checkbox, Modal, ProgressBar, TONE_ICON, Tile, cn, useToast } from './ui/kit';
import { ParcelPlan, hashSeed } from './visuals';

/**
 * The plan's line colour, from the case id.
 *
 * Four identity hues, chosen by hash so a grid of cases is visibly a grid of
 * different things rather than one card repeated. It is explicitly *not* the
 * verdict: verdict lives in the tile's rail and wash, and these four carry no
 * verdict anywhere in the system, so a fuchsia plan can never be read as
 * "worse" than an indigo one.
 */
const PLAN_HUES = ['brand', 'violet', 'cyan', 'accent'] as const;

export interface CaseCardProps {
  data: CaseSummary;
  selected: boolean;
  onToggleSelect: (id: string, next: boolean) => void;
  /** Fired after the case has actually been deleted on the server. */
  onDeleted: (id: string) => void;
}

/**
 * One case in the dashboard grid. The summary carries the full low/mid/high
 * band, so the card leads with the range rather than a single figure — a mid
 * on its own would read as more precise than the screen actually is.
 */
export default function CaseCard({ data, selected, onToggleSelect, onDeleted }: CaseCardProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function openCase() {
    navigate(`/cases/${data.id}`);
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.deleteCase(data.id);
      toast(`${data.reference} deleted`, 'good');
      setConfirmOpen(false);
      onDeleted(data.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete the case', 'critical');
    } finally {
      setDeleting(false);
    }
  }

  const screened = typeof data.indicativeMid === 'number';
  const VerdictIcon = data.verdict ? TONE_ICON[verdictTone(data.verdict)] : null;
  // Neutral until the case has actually been screened — an unscreened case
  // wearing a colour would be a verdict nobody reached.
  const cardTone = data.verdict ? verdictTone(data.verdict) : 'neutral';

  return (
    <>
      {/*
        * A tile keyed to the case's own verdict, with an accent rail.
        *
        * In a grid of a dozen cases the verdict is the thing a reader is
        * scanning for, and it used to be findable only by reading a badge in
        * each card. The rail and the wash make the grid sortable by eye
        * before a single word is read — and an unscreened case stays neutral,
        * because "no verdict yet" must not look like a verdict.
        */}
      <Tile
        tone={cardTone}
        rail
        interactive
        className={cn('relative flex flex-col', selected && 'ring-2 ring-brand')}
      >
        {/*
          * The plot, drawn from the case id.
          *
          * A dashboard of a dozen cases used to be a dozen identically-shaped
          * cards distinguished only by a line of text, so finding the one you
          * worked on yesterday meant reading all of them. A drawing is
          * recognised rather than read — you find your case the way you find
          * your car in a car park — and this one is stable, because the
          * geometry comes from the id and never changes for a given case.
          *
          * It is decoration derived from an identifier and is not survey data.
          * Where a real boundary exists, the cockpit's dossier draws that.
          */}
        <div className="relative h-[116px] shrink-0 overflow-hidden rounded-t-xl border-b border-hairline bg-tile-sunken">
          <ParcelPlan
            seed={data.id}
            detail="mark"
            hue={PLAN_HUES[hashSeed(data.id) % PLAN_HUES.length]}
            className="h-full w-full"
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface/70 to-transparent" />
          <span className="absolute left-2.5 top-2.5 rounded bg-surface/85 p-1 ring-1 ring-inset ring-[var(--ring)]">
            <Checkbox
              checked={selected}
              onChange={(next) => onToggleSelect(data.id, next)}
              label={<span className="sr-only">Select {data.reference} for comparison</span>}
            />
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
        <button type="button" onClick={openCase} className="min-w-0 text-left">
          <div className="truncate font-mono text-mini text-ink-muted">{data.reference}</div>
          <div className="truncate text-[13px] font-semibold text-ink">{data.label}</div>
        </button>

        <div className="absolute right-2.5 top-2.5 z-10">
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={`Actions for ${data.reference}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-md bg-surface/85 p-1 text-ink-muted ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink"
            >
              <MoreVertical size={15} />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-pop"
              >
                <button
                  role="menuitem"
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-ink hover:bg-sunken"
                  onClick={() => {
                    onToggleSelect(data.id, !selected);
                    setMenuOpen(false);
                  }}
                >
                  {selected ? 'Remove from comparison' : 'Add to comparison'}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-critical hover:bg-critical/10"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmOpen(true);
                  }}
                >
                  Delete case
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <button type="button" onClick={openCase} className="flex flex-1 flex-col gap-3 text-left">
          <div className="flex items-center gap-1 text-xs text-ink-secondary">
            <MapPin size={12} className="shrink-0 text-ink-muted" />
            <span className="truncate">
              {data.locality}, {data.city}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">{PROPERTY_TYPE_LABEL[data.propertyType]}</Badge>
            <Badge tone="neutral">{CASE_STATUS_LABEL[data.status]}</Badge>
            {data.verdict ? (
              <Badge tone={verdictTone(data.verdict)} icon={VerdictIcon ? <VerdictIcon size={11} /> : null}>
                {VERDICT_LABEL[data.verdict]}
              </Badge>
            ) : null}
            {data.openCriticalRisks > 0 ? (
              <Badge tone="critical" icon={<AlertOctagon size={11} />}>
                {data.openCriticalRisks} critical
              </Badge>
            ) : null}
          </div>

          <div>
            <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">Indicative value</div>
            {screened ? (
              <>
                <div className="tabular mt-0.5 text-[15px] font-semibold text-ink">
                  {typeof data.indicativeLow === 'number' && typeof data.indicativeHigh === 'number'
                    ? `${money(data.indicativeLow, data.currency)} – ${money(data.indicativeHigh, data.currency)}`
                    : `~ ${money(data.indicativeMid, data.currency)}`}
                </div>
                {typeof data.indicativeMid === 'number' ? (
                  <div className="tabular text-mini text-ink-muted">mid {money(data.indicativeMid, data.currency)}</div>
                ) : null}
              </>
            ) : (
              <div className="mt-0.5 text-[13px] text-ink-muted">Not yet screened</div>
            )}
          </div>

          <div className="mt-auto grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <ProgressBar
              value={data.confidenceScore ?? 0}
              tone={data.confidenceBand ? confidenceTone(data.confidenceBand) : 'neutral'}
              label={data.confidenceBand ? `Confidence · ${data.confidenceBand}` : 'Confidence'}
              showValue={typeof data.confidenceScore === 'number'}
            />
            <ProgressBar
              value={data.completenessScore ?? 0}
              tone="brand"
              label="Completeness"
              showValue={typeof data.completenessScore === 'number'}
            />
          </div>
        </button>

        <div className="flex items-center justify-between border-t border-hairline pt-2 text-mini text-ink-muted">
          <span>
            {data.documentCount} document{data.documentCount === 1 ? '' : 's'}
          </span>
          <span>Updated {relativeTime(data.updatedAt)}</span>
        </div>
        </div>
      </Tile>

      <Modal
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        title="Delete this case?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} loading={deleting}>
              {deleting ? 'Deleting…' : 'Delete case'}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          <span className="font-medium text-ink">
            {data.reference} — {data.label}
          </span>{' '}
          and all of its documents and screening results will be permanently removed. This cannot be undone.
        </p>
      </Modal>
    </>
  );
}
