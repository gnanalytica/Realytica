import { useEffect, useMemo, useState } from 'react';
import { SiteEntryLines } from '../../../components/chat/SiteEntryLines';
import { ArrowRight, ChevronRight, FileText } from 'lucide-react';
import {
  proposalChanges,
  turnChips,
  waitsWhereItLands,
  type ChatProposalKind,
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
import { useLiveHighlight } from '../LiveRow';
import { tabHolding } from './rail';
import { waitingOnPane } from './waiting-here';
import { WAITING_CHIPS_SHOWN, visibleTurnChips } from './turn-waiting-chips';

export type Waiting = ReturnType<typeof waitingOnCanvas>;

/**
 * The ways on from a chat turn: where its suggestions went, then chips.
 *
 * A reply whose message left suggestions says where each went, a line for
 * each place ("Suggested 2 values on Legal › Title"), and each line opens
 * that page at the field or the row. Those places are not said again as
 * chips. A reply kept from before it said so keeps its chips as they were.
 *
 * The chat holds no buttons that decide anything: a reply that read a deed or
 * proposed a finding says so in words, and these point to where it happened.
 * What it left waiting comes first, a function at a time, with how many: a
 * function's documents open their review, its checks open its page at the
 * checks. After a drop, the functions its other papers went to, and the paper
 * in the graph. A waiting chip is gone once what it counts is decided.
 *
 * More than two waiting places fold behind "+N more places" — the lead that
 * lists everything still waiting from earlier must not become a wall of chips.
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
  const suggested = turn.suggested ?? [];
  // What waits on a field or as a row is said by the lines above: only what has nowhere else to wait is a chip.
  const rest = useMemo(
    () => (turn.suggested ? { ...waiting, entries: waiting.entries.filter((entry) => !(entry.proposalId && waitsWhereItLands({ kind: entry.kind as ChatProposalKind, id: entry.proposalId }, project))) } : waiting),
    [turn.suggested, waiting, project],
  );
  const chips = useMemo(() => turnChips(project, turn, rest, here), [project, turn, rest, here]);
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenWaiting } = useMemo(() => visibleTurnChips(chips, expanded), [chips, expanded]);
  if (!chips.length && !suggested.length) return null;
  return (
    <>
    {suggested.length ? (
      <ul className="mt-2 space-y-0.5" aria-label="Where the suggestions went">
        {suggested.map((line) => (
          <li key={line.words}>
            <button
              type="button"
              onClick={() => onGo({ key: `suggested|${line.words}`, kind: 'filed', words: line.words, open: line.open, ...(line.ids?.length ? { ids: line.ids } : {}) })}
              className="group inline-flex items-center gap-1.5 rounded-md text-left text-[13px] font-medium text-brand hover:underline coarse:min-h-11"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
              {line.words}
              <ArrowRight size={12} aria-hidden className="shrink-0 transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    ) : null}
    {chips.length ? (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((chip) => (
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
      {hiddenWaiting > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken coarse:min-h-11"
        >
          +{hiddenWaiting} more place{hiddenWaiting === 1 ? '' : 's'}
        </button>
      ) : null}
      {expanded && chips.filter((chip) => chip.kind === 'waiting').length > WAITING_CHIPS_SHOWN ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken coarse:min-h-11"
        >
          Show less
        </button>
      ) : null}
    </div>
    ) : null}
    </>
  );
}

/**
 * The papers a card rests on: each by its title and page, with that page's own
 * words under it where the card carries them. Never a reason somebody wrote.
 */
function ProposalPapers({ item, papers }: { item: ChatProposal; papers: Array<{ id: string; title: string }> }) {
  if (!papers.length) return null;
  const cites = item.cites ?? [];
  if (!cites.length) return <span className="block truncate text-[12px] text-ink-muted">From {papers.map((row) => row.title).join(', ')}</span>;
  return (
    <span className="block space-y-0.5 text-[12px] leading-snug text-ink-muted">
      {papers.map((row) => {
        const cite = cites.find((held) => held.evidenceId === row.id);
        return (
          <span key={row.id} className="block">
            From {row.title}
            {cite ? `, p. ${cite.page}` : ''}
            {cite?.quote ? <span className="block">“{cite.quote}”</span> : null}
          </span>
        );
      })}
    </span>
  );
}

/**
 * One proposal waiting where it would land: what it is, what it would change,
 * the papers it rests on, and the decision. The reason a model gave for it is
 * a model's sentence, and is not drawn: what a person reads here is the
 * record's own words and the paper.
 */
function WaitingCard({
  project,
  item,
  busy,
  highlightIds,
  onAccept,
  onSetAside,
}: {
  project: DdProject;
  item: ChatProposal;
  busy: boolean;
  highlightIds?: string[];
  onAccept: (id: string, payload?: Record<string, unknown>) => void;
  onSetAside: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const changes = useMemo(() => proposalChanges(project, item), [project, item]);
  const form = useMemo(() => specForProposal(item.kind), [item.kind]);
  const papers = useMemo(() => (item.citedEvidenceIds ?? []).flatMap((id) => project.evidence.find((row) => row.id === id) ?? []), [item.citedEvidenceIds, project.evidence]);
  // Lit as a row of a register is, when a chip in the chat names this card.
  const { ref, on } = useLiveHighlight<HTMLLIElement>(item.id, highlightIds);
  return (
    <li ref={ref} data-live={on ? 'true' : undefined} className={cn('flex flex-col gap-1 px-3 py-2', on && 'bg-brand-soft ring-2 ring-inset ring-brand/35')}>
      <div className="flex items-start gap-2.5">
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
        {item.kind === 'log_site_entry' ? (
          // A site entry's lines unfold under it. Nothing else has more to show than the card already says.
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-w-0 flex-1 text-left">
            <span className="block break-words text-[13px] font-medium text-ink">{item.title}</span>
          <ProposalPapers item={item} papers={papers} />
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <span className="block break-words text-[13px] font-medium text-ink">{item.title}</span>
          <ProposalPapers item={item} papers={papers} />
          </div>
        )}
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
 * What waits for a person in the pane they are looking at, that has no field
 * or row of its own to wait on.
 *
 * A suggestion waits where it lands: a value on its field (a sheet's, or a
 * check's), a finding, an action, a risk or a decision as a suggested row of
 * its register, a fact of the project record beside it on Overview. None of
 * those is listed here. What is left is what has nowhere else to wait: a
 * valuation to run, a report to make, a stage to change, a DD to start, and
 * on the documents, the papers with values to read on the desk. A long list
 * folds, so a busy file does not push the page itself off the screen.
 *
 * On a function's page it lists only what concerns that function. What waits
 * for another function, or for none, is not this page's to show: it is
 * counted on the bell, which walks to it.
 */
export function WaitingHere({
  project,
  pane,
  workstream,
  waiting,
  busy,
  highlightIds,
  onAccept,
  onSetAside,
  onGo,
}: {
  project: DdProject;
  pane: ProjectCockpitPane;
  /** The function whose page is on screen, where the pane is a function's. */
  workstream?: string;
  waiting: Waiting;
  busy: boolean;
  /** The records a chip in the chat lit. A card among them is lit here. */
  highlightIds?: string[];
  onAccept: (id: string, payload?: Record<string, unknown>) => void;
  onSetAside: (id: string) => void;
  onGo: (entry: WaitingEntry) => void;
}) {
  const here = waitingOnPane(waiting.entries, { pane, workstream, sameTab: (a, b) => tabHolding(a).tab.pane === tabHolding(b).tab.pane });
  const documents = here.filter((e) => e.kind === 'facts');
  // A check's values wait on the check's fields, and are decided there: none is listed here.
  const cards = here
    .filter((e) => e.kind !== 'facts' && e.pane !== 'scope' && e.proposalId && !waitsWhereItLands({ kind: e.kind as ChatProposalKind, id: e.proposalId }, project))
    .map((e) => project.chatProposals.find((p) => p.id === e.proposalId))
    .filter((p): p is ChatProposal => Boolean(p));
  const total = documents.length + cards.length;
  const [folded, setFolded] = useState(total > 4);
  useEffect(() => {
    if (total <= 4) setFolded(false);
  }, [total]);
  // A lit card inside a folded list would be lit out of sight: the list opens. It opens again each time the card is lit, so a chip pressed after the list was folded by hand shows it.
  const litCard = cards.find((item) => highlightIds?.includes(item.id))?.id;
  useEffect(() => {
    if (litCard) setFolded(false);
  }, [litCard, highlightIds]);
  if (!total) return null;

  const shown = documents.length + cards.length;

  return (
    <section aria-label="To accept" data-waiting-anchor="pane" className="mb-3 scroll-mt-3 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-ai/25">
      <button
        type="button"
        onClick={() => setFolded((v) => !v)}
        aria-expanded={!folded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-quick hover:bg-ai-soft/40 coarse:min-h-11"
      >
        <AiMark size="xs" />
        <span className="flex-1 text-[13px] font-semibold text-ink">
          To accept
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
          {cards.map((item) => (
            <WaitingCard key={item.id} project={project} item={item} busy={busy} highlightIds={highlightIds} onAccept={onAccept} onSetAside={onSetAside} />
          ))}
        </Stagger>
        </motion.div>
      )}
      </AnimatePresence>
    </section>
  );
}

