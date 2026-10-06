import { useEffect, useMemo, useState } from 'react';
import { SiteEntryLines } from '../../../components/chat/SiteEntryLines';
import { ArrowRight, ChevronRight, FileText } from 'lucide-react';
import {
  proposalChanges,
  turnChips,
  type ChatPlace,
  type ChatProposal,
  type CopilotTurn,
  type DdProject,
  type ProjectCockpitPane,
  type TurnChip,
  type WaitingEntry,
  type waitingOnCanvas,
} from '@realytica/shared';
import { AiMark, cn } from '../../../components/ui/kit';
import { AnimatePresence, EASE_ENTER, Stagger, StaggerItem, motion } from '../../../lib/motion';
import { CreateWizard } from '../../../components/create/CreateWizard';
import { specForProposal } from '../../../components/create/specs';
import { DecideButtons } from '../../../components/review/Decide';
import { tabHolding } from './rail';

export type Waiting = ReturnType<typeof waitingOnCanvas>;

/**
 * The ways on from a chat turn, as chips under it.
 *
 * The chat holds no buttons that decide anything: a reply that read a deed or
 * proposed a finding says so in words, and these point to where it happened.
 * What it left waiting comes first, a function at a time, with how many: a
 * function's documents open their review, its checks open its page at the
 * checks. After a drop, the functions its other papers went to, and the paper
 * in the graph. A waiting chip is gone once what it counts is decided.
 */
export function TurnWaiting({
  project,
  turn,
  waiting,
  here,
  onGo,
}: {
  project: DdProject;
  turn: CopilotTurn;
  waiting: Waiting;
  /** The page on screen: a function's page opens at the stage being looked at when it shows there. */
  here: ChatPlace;
  onGo: (chip: TurnChip) => void;
}) {
  const chips = useMemo(() => turnChips(project, turn, waiting, here), [project, turn, waiting, here]);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onGo(chip)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-ink ring-1 ring-inset coarse:min-h-11',
            // Blue is for what waits on a person. A chip that only goes somewhere is plain.
            chip.kind === 'waiting' ? 'ring-provenance/40 hover:bg-provenance/10' : 'ring-[var(--ring)] hover:bg-sunken',
          )}
        >
          {chip.kind === 'waiting' ? (
            <>
              <span className="size-1.5 rounded-full bg-provenance" aria-hidden />
              <span className="tabular-nums font-medium">{chip.count}</span>
            </>
          ) : null}
          <span className="text-ink-secondary">{chip.words}</span>
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
      {open && item.kind === 'log_site_entry' ? (
        <SiteEntryLines projectId={project.id} proposalId={item.id} payload={item.payload} />
      ) : open ? (
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
    <section aria-label="Waiting for you" data-waiting-anchor="pane" className="mb-3 scroll-mt-3 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-ai/25">
      <button
        type="button"
        onClick={() => setFolded((v) => !v)}
        aria-expanded={!folded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-quick hover:bg-ai-soft/40 coarse:min-h-11"
      >
        <AiMark size="xs" />
        <span className="flex-1 text-[13px] font-semibold text-ink">
          Waiting for you
          <span className="ml-1.5 rounded-full bg-ai/12 px-1.5 font-mono text-micro font-medium text-ai-ink">{shown}</span>
        </span>
        <span className="hidden text-micro text-ink-muted sm:inline">{folded ? 'Show' : 'Accept or set aside each where it sits'}</span>
        <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-base ease-enter', !folded && 'rotate-90')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
      {folded ? null : (
        <motion.div
          key="list"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.26, ease: EASE_ENTER }}
          className="overflow-hidden"
        >
        <Stagger as="ul" className="divide-y divide-hairline border-t border-hairline">
          {documents.map((e) => (
            <StaggerItem as="li" key={e.evidenceId} className="flex items-center gap-2.5 px-3 py-2 transition-colors duration-quick hover:bg-sunken/50">
              <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{e.title}</span>
              <span className="shrink-0 text-[12px] text-ink-muted">
                {e.count} value{e.count === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => onGo(e)}
                className="group inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11"
              >
                Review
                <ArrowRight size={12} aria-hidden className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
              </button>
            </StaggerItem>
          ))}
          {[...byCheck.values()].map((g) => (
            <StaggerItem as="li" key={g.entry.proposalId ?? g.title} className="flex items-center gap-2.5 px-3 py-2 transition-colors duration-quick hover:bg-sunken/50">
              <span className="size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{g.title}</span>
              <span className="shrink-0 text-[12px] text-ink-muted">
                {g.count} value{g.count === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => onGo(g.entry)}
                className="group inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11"
              >
                Open
                <ArrowRight size={12} aria-hidden className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
              </button>
            </StaggerItem>
          ))}
          {cards.map((item) => (
            <WaitingCard key={item.id} project={project} item={item} busy={busy} onAccept={onAccept} onSetAside={onSetAside} />
          ))}
        </Stagger>
        </motion.div>
      )}
      </AnimatePresence>
    </section>
  );
}

