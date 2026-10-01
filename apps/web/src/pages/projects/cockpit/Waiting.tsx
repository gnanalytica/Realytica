import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, FileText, Undo2, X } from 'lucide-react';
import {
  proposalChanges,
  type ChatProposal,
  type CopilotTurn,
  type DdProject,
  type ProjectCockpitPane,
  type WaitingEntry,
  type waitingOnCanvas,
} from '@realytica/shared';
import { cn } from '../../../components/ui/kit';
import { CreateWizard } from '../../../components/create/CreateWizard';
import { specForProposal } from '../../../components/create/specs';
import { DecideButtons } from '../../../components/review/Decide';
import { paneLabel, tabHolding } from './rail';

export type Waiting = ReturnType<typeof waitingOnCanvas>;

/** Where a group of waiting things is, in a few words. */
function placeOf(pane: ProjectCockpitPane): string {
  if (pane === 'evidence') return 'on the documents';
  if (pane === 'scope') return 'on the checks';
  return `under ${paneLabel(pane)}`;
}

/**
 * What a chat turn left waiting, as a way to it.
 *
 * The chat holds no buttons that decide anything: a reply that read a deed or
 * proposed a finding says so in words, and this is the pointer to where it
 * waits — one chip per place, with how many. Gone once they are decided.
 */
export function TurnWaiting({
  turn,
  waiting,
  onGo,
}: {
  turn: CopilotTurn;
  waiting: Waiting;
  onGo: (entry: WaitingEntry) => void;
}) {
  const groups = useMemo(() => {
    const ids = new Set(turn.proposalIds ?? []);
    const cited = new Set(turn.citedEvidenceIds ?? []);
    const mine = waiting.entries.filter((e) => (e.proposalId && ids.has(e.proposalId)) || (e.kind === 'facts' && e.evidenceId && cited.has(e.evidenceId)));
    const byPane = new Map<ProjectCockpitPane, { count: number; first: WaitingEntry }>();
    for (const e of mine) {
      const g = byPane.get(e.pane);
      if (g) g.count += e.count;
      else byPane.set(e.pane, { count: e.count, first: e });
    }
    return [...byPane.entries()];
  }, [turn, waiting]);
  if (!groups.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {groups.map(([pane, g]) => (
        <button
          key={pane}
          type="button"
          onClick={() => onGo(g.first)}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-ink ring-1 ring-inset ring-provenance/40 hover:bg-provenance/10 coarse:min-h-11"
        >
          <span className="size-1.5 rounded-full bg-provenance" aria-hidden />
          <span className="tabular-nums font-medium">{g.count}</span>
          <span className="text-ink-secondary">waiting {placeOf(pane)}</span>
          <ArrowRight size={12} className="text-ink-muted" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** One proposal waiting where it would land: what it is, what it would change, and the decision. */
function WaitingCard({
  project,
  item,
  busy,
  onAccept,
  onSetAside,
}: {
  project: DdProject;
  item: ChatProposal;
  busy: boolean;
  onAccept: (id: string, payload?: Record<string, unknown>) => void;
  onSetAside: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const changes = useMemo(() => proposalChanges(project, item), [project, item]);
  const form = useMemo(() => specForProposal(item.kind), [item.kind]);
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block break-words text-[13px] font-medium text-ink">{item.title}</span>
          {!open && item.rationale ? <span className="block truncate text-[12px] text-ink-muted">{item.rationale}</span> : null}
        </button>
        <DecideButtons
          label={item.title}
          busy={busy}
          size="sm"
          onEdit={form ? () => setEditing(true) : undefined}
          onAccept={() => onAccept(item.id)}
          onSetAside={() => onSetAside(item.id)}
        />
      </div>
      {changes.length ? (
        <dl className="ml-4 flex flex-col gap-0.5 rounded-md bg-sunken px-2 py-1.5">
          {changes.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate text-mini text-ink-secondary">{row.label}</dt>
              <dd className="flex shrink-0 items-baseline gap-1 text-[12px] tabular-nums">
                {row.from === undefined ? <span className="text-ink-muted">not set</span> : <span className="text-ink-muted line-through">{row.from}</span>}
                <ArrowRight size={10} className="shrink-0 text-ink-muted" aria-hidden />
                <span className="font-medium text-ink">{row.to}</span>
                {row.unit ? <span className="text-mini text-ink-muted">{row.unit}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {open ? (
        <div className="ml-4 space-y-1">
          <p className="text-[12px] leading-relaxed text-ink-secondary">{item.rationale}</p>
          <p className="text-[11px] text-ink-muted">{item.impact}</p>
        </div>
      ) : null}
      {form ? (
        <CreateWizard
          kind={form.kind}
          project={project}
          open={editing}
          proposed={item.payload}
          busy={busy}
          onClose={() => setEditing(false)}
          onSubmit={(draft) => {
            setEditing(false);
            onAccept(item.id, draft);
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * What waits for a person in the pane they are looking at.
 *
 * Proposals used to wait in the chat, as cards to approve there. Now each
 * waits in the register it would change, at the top of it: a finding among
 * the findings, a request among the actions, a DD under Technical DD. On the
 * documents, the documents with values to review; on the checks, the other
 * checks with values waiting. A long list folds, so a busy file does not
 * push the register itself off the screen.
 */
export function WaitingHere({
  project,
  pane,
  waiting,
  sittingCheckId,
  busy,
  onAccept,
  onSetAside,
  onGo,
}: {
  project: DdProject;
  pane: ProjectCockpitPane;
  waiting: Waiting;
  /** The check already open on the scope — its values are decided there, not listed here. */
  sittingCheckId?: string | null;
  busy: boolean;
  onAccept: (id: string, payload?: Record<string, unknown>) => void;
  onSetAside: (id: string) => void;
  onGo: (entry: WaitingEntry) => void;
}) {
  const tab = tabHolding(pane).tab.pane;
  const here = waiting.entries.filter((e) => tabHolding(e.pane).tab.pane === tab || (pane === 'dd' && e.pane === 'scope'));
  const documents = here.filter((e) => e.kind === 'facts');
  const checks = here.filter((e) => e.pane === 'scope' && e.extra?.checkId !== sittingCheckId);
  const cards = here
    .filter((e) => e.kind !== 'facts' && e.pane !== 'scope' && e.proposalId)
    .map((e) => project.chatProposals.find((p) => p.id === e.proposalId))
    .filter((p): p is ChatProposal => Boolean(p));
  const total = documents.length + checks.length + cards.length;
  const [folded, setFolded] = useState(total > 4);
  useEffect(() => {
    if (total <= 4) setFolded(false);
  }, [total]);
  if (!total) return null;

  // Checks are grouped: three values on one check are one place to go.
  const byCheck = new Map<string, { entry: WaitingEntry; count: number; title: string }>();
  for (const e of checks) {
    const id = e.extra?.checkId ?? e.proposalId ?? e.title;
    const title = project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.id === e.extra?.checkId)?.title ?? e.title;
    const g = byCheck.get(id);
    if (g) g.count += e.count;
    else byCheck.set(id, { entry: e, count: e.count, title });
  }
  const shown = documents.length + byCheck.size + cards.length;

  return (
    <section aria-label="Waiting for you" data-waiting-anchor="pane" className="mb-3 scroll-mt-3 overflow-hidden rounded-xl bg-surface ring-1 ring-inset ring-provenance/30">
      <button
        type="button"
        onClick={() => setFolded((v) => !v)}
        aria-expanded={!folded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken/60"
      >
        <ChevronRight size={13} className={cn('shrink-0 text-ink-muted transition-transform duration-quick', !folded && 'rotate-90')} aria-hidden />
        <span className="flex-1 text-[12px] font-semibold text-ink">
          Waiting for you
          <span className="ml-1.5 rounded-full bg-provenance/15 px-1.5 font-mono text-micro text-provenance-ink">{shown}</span>
        </span>
        <span className="text-micro text-ink-muted">{folded ? 'Show' : 'Accept or set aside each where it sits'}</span>
      </button>
      {folded ? null : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {documents.map((e) => (
            <li key={e.evidenceId} className="flex items-center gap-2.5 px-3 py-2">
              <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{e.title}</span>
              <span className="shrink-0 text-[12px] text-ink-muted">
                {e.count} value{e.count === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => onGo(e)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11"
              >
                Review
                <ArrowRight size={12} aria-hidden />
              </button>
            </li>
          ))}
          {[...byCheck.values()].map((g) => (
            <li key={g.entry.proposalId ?? g.title} className="flex items-center gap-2.5 px-3 py-2">
              <span className="size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{g.title}</span>
              <span className="shrink-0 text-[12px] text-ink-muted">
                {g.count} value{g.count === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => onGo(g.entry)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11"
              >
                Open
                <ArrowRight size={12} aria-hidden />
              </button>
            </li>
          ))}
          {cards.map((item) => (
            <WaitingCard key={item.id} project={project} item={item} busy={busy} onAccept={onAccept} onSetAside={onSetAside} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The way back from an instruction.
 *
 * Something the person told the chat to do runs at once — it is their
 * decision — so instead of asking first, the canvas offers to take it back
 * for a few seconds after.
 */
export function UndoBar({ label, busy, onUndo, onDismiss }: { label: string; busy: boolean; onUndo: () => void; onDismiss: () => void }) {
  // Centred by a full-width row rather than a translate: the rise-in animation owns `transform`.
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
    <div
      role="status"
      className="pointer-events-auto flex min-w-0 max-w-full animate-rise-in items-center gap-2 rounded-full bg-ink py-1.5 pl-4 pr-1.5 text-[13px] text-ink-inverse shadow-pop"
    >
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-semibold hover:bg-white/15 disabled:opacity-60 coarse:min-h-11"
      >
        <Undo2 size={13} aria-hidden />
        Undo
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-full p-1 opacity-70 hover:opacity-100 coarse:min-h-11 coarse:min-w-11">
        <X size={13} aria-hidden />
      </button>
    </div>
    </div>
  );
}
