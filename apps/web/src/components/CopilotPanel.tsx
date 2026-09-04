import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { AlertCircle, ArrowUp, CheckCircle2, Info, MessageCircle, Paperclip, SearchX, Sparkles, Trash2, X } from 'lucide-react';
import { groupActivity, splitThread } from '@realytica/shared';
import type { AgentStep, CopilotTurn, EvidenceItem, ProjectChatTurn, ScreenResult, VerificationSummary } from '@realytica/shared';
import { CriticFlagBanner, findFlaggedCriticFinding } from './VerificationPanel';
import { EvidenceLink } from './EvidenceLink';
import { Badge, Button, Textarea, cn } from './ui/kit';
import { AnswerBody } from './chat/AnswerBody';
import { TurnVisual } from './chat/TurnVisual';
import { relativeTime } from '../lib/format';

function AgentTag({ at }: { at: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1 text-micro text-ink-muted">
      <Sparkles size={9} /> Agent-generated · {relativeTime(at)}
    </div>
  );
}

function TurnBubble({
  turn,
  evidence,
  nodes,
  applied,
  screenResult,
  askingPrice,
  onPick,
  verification,
  onOpenNode,
  onOpenEvidence,
  onOpenDocument,
  extras,
}: {
  turn: CopilotTurn;
  evidence: EvidenceItem[];
  nodes?: Array<{ id: string; label: string }>;
  applied?: string[];
  screenResult?: ScreenResult;
  askingPrice?: number | null;
  /** Send a message on the person's behalf when they pick an offered choice. */
  onPick?: (text: string, sitting?: { ddId?: string; scopeId?: string; checkId?: string }) => void;
  verification?: VerificationSummary;
  onOpenNode?: (nodeId: string) => void;
  onOpenEvidence?: (id: string) => void;
  /** Open a cited document in the proof pane. */
  onOpenDocument?: (documentId: string) => void;
  extras?: ReactNode;
}) {
  // What the answer placed in the flow of a sentence, so the strips below can
  // show only what it did not.
  const inlineEvidence = new Set(Array.from(turn.text.matchAll(/\[ev:([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g), m => m[1]));
  const uncited = turn.citedEvidenceIds.filter(id => !inlineEvidence.has(id));
  const uncitedNodes = Array.from(new Set((turn.citedNodeIds ?? []).filter(id => !turn.text.includes(`[${id}]`))));
  const consulted = Array.from(new Set((turn.toolCalls ?? []).map(t => t.summary.trim()).filter(Boolean)));
  const nodeLabel = (id: string): string => {
    const found = (nodes ?? []).find(n => n.id === id);
    if (found) return found.label.length > 40 ? `${found.label.slice(0, 40)}…` : found.label;
    return id.length > 26 ? `${id.slice(0, 26)}…` : id;
  };
  // A critic flag has to travel with the claim it concerns. Surfacing it only
  // in the verification panel would let someone read an unsupported answer
  // cleanly here and never see the warning sitting on another screen.
  const flagged = findFlaggedCriticFinding(verification, 'copilot_answer', turn.id);
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end pl-8">
        {/*
          `whitespace-pre-wrap`, which the assistant side has always had and
          this side never did — so a pasted multi-line question collapsed into
          one run-on line and stopped resembling what the person typed.
        */}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-brand px-3 py-2 text-[13px] leading-relaxed text-[var(--brand-ink)]">
          {turn.text}
        </div>
      </div>
    );
  }

  // A refusal for lack of evidence is the product working as intended, not a
  // failure — it gets its own calm, informative treatment rather than the
  // error styling other panels use for a broken state.
  if (turn.refusedForLackOfEvidence) {
    return (
      <div className="flex gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
        >
          <SearchX size={12} />
        </span>
        <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-brand-soft px-3 py-2.5 ring-1 ring-inset ring-brand/25">
          <div className="mb-1 flex items-center gap-1.5 text-mini font-semibold text-brand">
            <SearchX size={12} /> No answer — the evidence doesn&rsquo;t support one
          </div>
          <p className="text-[13px] leading-relaxed text-ink">{turn.text}</p>
          <p className="mt-1 text-mini text-ink-secondary">
            That&rsquo;s a legitimate outcome, not an error — nothing on file backs a confident answer yet.
          </p>
          <AgentTag at={turn.at} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      {/*
        A face for the other side of the conversation.
        
        Every assistant turn rendered as an unlabelled slab the width of the
        column, so a long answer read as a document pane rather than as
        something said to you — and two consecutive answers ran together with
        nothing between them. The mark is small and constant; it is the
        cheapest thing that makes a column of text read as a dialogue.
      */}
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
      >
        <Sparkles size={12} />
      </span>
      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-sunken px-3 py-2.5 ring-1 ring-inset ring-[var(--ring)]">
        {turn.unanswered ? (
          /*
           * The question was not answered, and what follows is the standing
           * briefing rather than a reply.
           *
           * Without this the two are indistinguishable: a rate-limited copilot
           * fell through to "today on this project…", which rendered in the
           * same voice and the same place as a real answer. Somebody asking
           * what a buyer would pay read an unrelated open finding and had no
           * way to know their question had never been reached. Said before the
           * text, not after, because it changes how the text should be read.
           */
          <p className="mb-2 flex items-start gap-1.5 border-b border-[var(--ring)] pb-2 text-mini leading-snug text-ink-secondary">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              {turn.unanswered} Below is where the file stands, not a reply to what you asked.
            </span>
          </p>
        ) : null}
        <AnswerBody
          text={turn.text}
          evidence={evidence}
          nodes={nodes}
          onOpenEvidence={onOpenEvidence}
          onOpenNode={onOpenNode}
        />
        {/*
          Deduped. The agent loops up to eight times and routinely consults
          the same tool twice — the observed answer showed "Looking up get
          evidence by id" side by side with itself, which reads as a
          rendering fault rather than as work. What a reader wants from this
          row is WHICH sources were consulted, not how many round trips it
          took to consult them.
        */}
        {consulted.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {consulted.map(label => (
              <Badge key={label} tone="neutral">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
        {flagged ? (
          <div className="mt-2">
            <CriticFlagBanner finding={flagged} compact />
          </div>
        ) : null}
        {/*
          What the turn CHANGED, in the transcript.
          
          A command tool executes directly — that is deliberate, because a
          command the person gave in their own words has the person as its
          actor. But it was reported only by a toast, which vanishes, so the
          record of a risk being marked mitigated lived nowhere the reader
          could scroll back to. A conversation that mutates a case and keeps
          no account of it is the wrong shape for a diligence file.
        */}
        {screenResult && turn.toolCalls && turn.toolCalls.length > 0 ? (
          <TurnVisual
            toolNames={turn.toolCalls.map(t => t.name)}
            result={screenResult}
            askingPrice={askingPrice}
          />
        ) : null}
        {turn.metrics && turn.metrics.length > 0 ? (
          /*
           * What the turn changed, as figures.
           *
           * The one thing a receipt cannot say in a sentence without becoming
           * the paragraph this panel is trying to stop being. Three rows, no
           * prose column: how much evidence there is, how much of it is
           * attached to something, and whether the pack moved. The last two
           * are the pair that matters — documents on the register with nothing
           * to attach them to leave the pack where it was, and only these
           * numbers say so.
           */
          <dl className="mt-2 flex flex-col gap-0.5 rounded-lg bg-sunken px-2.5 py-1.5">
            {turn.metrics.map((m) => (
              <div key={m.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-mini text-ink-secondary">{m.label}</dt>
                <dd className="flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-[12px] font-medium text-ink">{m.value}</span>
                  {m.delta ? <span className="text-mini text-ink-muted">{m.delta}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {turn.unsupportedClaims && turn.unsupportedClaims.length > 0 ? (
          /*
           * Figures the file does not support, named beside the answer that
           * used them. A flag, not a block: the person decides what to make
           * of it, but an invented number must never render in the same
           * voice as a verified one.
           */
          <p className="mt-2 rounded-lg bg-warning/15 px-2.5 py-1.5 text-mini leading-snug text-ink ring-1 ring-inset ring-warning/45">
            Not on the file: {turn.unsupportedClaims.join(' · ')}. Nothing in the registers, the screen or the
            valuations carries {turn.unsupportedClaims.length === 1 ? 'this figure' : 'these figures'} — treat
            {turn.unsupportedClaims.length === 1 ? ' it' : ' them'} as unverified until evidence lands.
          </p>
        ) : null}
        {turn.choices && turn.choices.length > 0 && onPick ? (
          /*
           * Options offered because the message did not resolve to one thing.
           * Rendered as buttons rather than a list in the prose because the
           * point is that the person picks — a numbered list they have to
           * retype is the same dead end with better manners. Picking sends
           * the message they would have written, so nothing here writes on
           * its own.
           */
          <ul className="mt-2 flex flex-col gap-1.5">
            {turn.choices.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  onClick={() => onPick(choice.send, choice.sitting)}
                  className={cn(
                    'group flex w-full flex-col gap-0.5 rounded-lg bg-surface px-3 py-2 text-left',
                    'ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick',
                    'hover:bg-brand-soft hover:ring-brand/30 coarse:min-h-11',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[12.5px] text-ink group-hover:text-brand">{choice.label}</span>
                    {choice.kind ? (
                      <span className="shrink-0 text-mini uppercase tracking-wide text-ink-muted">{choice.kind}</span>
                    ) : null}
                  </span>
                  {choice.detail ? (
                    <span className="text-mini leading-snug text-ink-secondary">{choice.detail}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {applied && applied.length > 0 ? (
          <div className="mt-2 rounded-lg bg-good/10 px-2.5 py-2 ring-1 ring-inset ring-good/25">
            <div className="flex items-center gap-1.5 text-mini font-semibold text-good">
              <CheckCircle2 size={12} /> Applied to the case
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {applied.map((line, i) => (
                <li key={i} className="text-[12px] leading-snug text-ink">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/*
          Only what the answer did NOT place inline. A citation the model made
          mid-sentence is already rendered there, attached to its claim, and
          repeating it in a summary strip underneath offers the same source
          twice while implying they are different.
        */}
            {uncited.length > 0 ? (
          <div className="mt-1.5">
            <EvidenceLink ids={uncited} evidence={evidence} onOpen={(ids) => ids[0] && onOpenEvidence?.(ids[0])} onOpenDocument={onOpenDocument} />
          </div>
        ) : null}
        {onOpenNode && uncitedNodes.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {uncitedNodes.map((nodeId) => (
              <button
                key={nodeId}
                onClick={() => onOpenNode(nodeId)}
                className="rounded-full bg-surface px-2 py-0.5 text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:text-ink"
                title="Open this record"
              >
                {nodeLabel(nodeId)}
              </button>
            ))}
          </div>
        ) : null}
        <AgentTag at={turn.at} />
        {extras}
      </div>
    </div>
  );
}

/**
 * What the agent is doing, while it does it.
 *
 * Three dots covered a loop of up to eight tool iterations — reading a deed,
 * walking the graph, pulling the compliance checks — and a wait that long
 * with no account of itself is indistinguishable from a hang. The server has
 * always emitted these steps; nothing was listening.
 *
 * The dots stay for the gap before the first step arrives, and on a
 * deployment where the response is buffered rather than streamed, which is
 * the same thing from here.
 */
function TypingIndicator({ steps }: { steps: AgentStep[] }) {
  const current = steps[steps.length - 1];
  // Tool steps only. `message` and `plan` steps carry the model's own
  // narration, which is the answer being drafted — showing it here would
  // print a rough version of the reply above the reply.
  const done = steps.filter(s => s.kind === 'tool_result').length;

  return (
    <div className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
      >
        <Sparkles size={12} className="animate-pulse" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl rounded-tl-sm bg-sunken px-3 py-2.5 ring-1 ring-inset ring-[var(--ring)]">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:300ms]" />
          {current ? (
            <span className="ml-1 min-w-0 truncate text-[12px] text-ink-secondary">{current.label}</span>
          ) : null}
        </div>
        {done > 0 ? (
          <span className="text-mini text-ink-muted">
            {done} source{done === 1 ? '' : 's'} read
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionChip({ text, disabled, onClick }: { text: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full bg-sunken px-2.5 py-1 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]',
        'hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {text}
    </button>
  );
}

/**
 * Chat panel over the analyst copilot. An assistant turn shows its cited
 * evidence inline, and a turn where the agent declined for lack of evidence
 * reads as a good outcome rather than an error — Realytica's whole promise is
 * Evidence Before Assertion, so "the evidence doesn't support an answer" is a
 * correct, valuable response, not a dead end.
 */
export function CopilotPanel({
  conversation,
  evidence,
  suggestions,
  onAsk,
  onClear,
  busy,
  disabled,
  disabledReason,
  verification,
  onOpenNode,
  onOpenDocument,
  onOpenEvidence,
  fallback,
  fill,
  nodes,
  appliedByTurn,
  steps,
  onOpenCommands,
  onPickChoice,
  screenResult,
  askingPrice,
  emptyTitle,
  emptyHint,
  placeholder,
  allowAttach,
  renderTurnExtras,
  compact,
  onCancel,
  dock,
}: {
  conversation: CopilotTurn[];
  evidence: EvidenceItem[];
  suggestions: string[];
  onAsk: (question: string, files?: File[]) => Promise<void> | void;
  onClear?: () => void;
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  verification?: VerificationSummary;
  /** When set, graph-node citations render as chips that focus the explorer. */
  onOpenNode?: (nodeId: string) => void;
  /** Open a cited document in the proof pane. */
  onOpenDocument?: (documentId: string) => void;
  /** Open one evidence item — what an inline citation chip does when tapped. */
  onOpenEvidence?: (id: string) => void;
  /**
   * What this column shows when there is no copilot to talk to.
   *
   * Chat is the centre of the cockpit, so on a deployment with no model
   * configured the most prominent element on every case page was an apology.
   * A dead hero is worse than no hero: it makes a working product look
   * broken. The fallback is the case's own next steps — the thing the reader
   * would have asked the copilot for first.
   */
  fallback?: ReactNode;
  /** Take the height of the container rather than capping at 26rem. */
  fill?: boolean;
  /** The case's graph, so a cited node id can render as its label. */
  nodes?: Array<{ id: string; label: string }>;
  /**
   * What each turn changed on the case, keyed by turn id.
   *
   * Held by the caller rather than on the turn because it is a property of
   * the exchange, not of the stored conversation — the API returns it once,
   * with the response, and the case row is the record of the change itself.
   */
  appliedByTurn?: Record<string, string[]>;
  /** Live progress for the turn in flight, newest last. */
  steps?: AgentStep[];
  /** Open the command bar — bound to `/` on an empty composer. */
  onOpenCommands?: () => void;
  /**
   * The last screen on this file, so a turn can draw the chart behind its
   * answer.
   *
   * Passed rather than fetched: the chart has to be the same numbers the rest
   * of the surface is showing, and a second read could disagree with the first.
   */
  screenResult?: ScreenResult;
  askingPrice?: number | null;
  /**
   * Send an offered choice. Takes the pinned record with it, because two DDs
   * can carry checks with identical titles and the text alone cannot say
   * which one was on the button.
   */
  onPickChoice?: (text: string, sitting?: { ddId?: string; scopeId?: string; checkId?: string }) => void;
  emptyTitle?: string;
  emptyHint?: string;
  placeholder?: string;
  allowAttach?: boolean;
  renderTurnExtras?: (turn: CopilotTurn) => ReactNode;
  /** Phone cockpit: hide extra chips, icon-only send, tighter spacing. */
  compact?: boolean;
  /** Cancel the in-flight turn. Shown as Stop while busy. */
  onCancel?: () => void;
  /** Live sitting — the named field or scope, docked above the composer. */
  dock?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Re-measured on every change of the value, not just on typing: the box is
  // also cleared programmatically after a send, and a composer that stayed
  // six lines tall over an empty field would eat the conversation.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conversation.length, busy]);

  async function submit(question: string, attached = files): Promise<void> {
    const trimmed = question.trim();
    if (busy || disabled) return;
    if (!trimmed && attached.length === 0) return;
    setError(null);
    setText('');
    setFiles([]);
    try {
      await onAsk(trimmed, attached.length ? attached : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the copilot — please retry.');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    /*
     * `/` on an empty composer opens the command bar.
     *
     * Both surfaces are the person acting and they already share a
     * vocabulary; this is the convention every chat product has taught
     * people to expect, and without it the only way to reach the bar was a
     * keyboard shortcut with no discoverable affordance — and none at all on
     * a phone, which has no ⌘K.
     *
     * Only on an EMPTY composer. Mid-sentence a slash is a date, a ratio or
     * a survey number, and stealing it would make "plot 112/3" unaskable.
     */
    if (e.key === '/' && text.length === 0 && onOpenCommands) {
      e.preventDefault();
      onOpenCommands();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit(text);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    void submit(text);
  }

  /*
   * Two logs, shown as two tabs.
   *
   * The thread arrives holding both what somebody asked and what the file
   * recorded — every work-pane edit writes a synthetic turn and a one-word
   * reply. Measured on the seeded project that was twenty-four turns, all of
   * them echoes: a conversation panel replaying your own clicks.
   *
   * Split on the way in rather than at the source, so nothing has to be
   * migrated and a turn written before this lands in the right half by itself.
   */
  const { conversation: spoken, activity } = useMemo(
    () => splitThread(conversation as unknown as ProjectChatTurn[]),
    [conversation],
  );
  const [tab, setTab] = useState<'chat' | 'activity'>('chat');
  // Chat opens by default even when empty: it is what the composer below is
  // for, and landing on a log nobody asked for is how this started.
  const shown = (tab === 'chat' ? spoken : []) as unknown as CopilotTurn[];

  const showEmptyState = shown.length === 0 && tab === 'chat' && !busy;

  return (
    <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3', fill && 'h-full min-h-0')}>
      {/*
        The unavailable notice moved DOWN, to the composer.
        
        Chat is the centre of the cockpit, so a banner above the conversation
        made the most prominent element on every case page an apology for
        something the reader cannot fix and did not ask about. It belongs
        beside the box you would type in — which is where you find out, and
        the only place the answer changes what you do next.
      */}

      {/*
        The strip only appears once the file has a history to separate. On a
        fresh project there is one log and a tab bar over it would be chrome
        naming a distinction that does not exist yet.
      */}
      {activity.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-1 pb-1.5">
          {(['chat', 'activity'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={cn(
                'rounded-md px-2 py-1 text-[12px] capitalize transition-colors duration-quick',
                tab === key ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:text-ink',
              )}
            >
              {key}
              {key === 'activity' ? <span className="ml-1 tabular-nums opacity-70">{activity.length}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          'flex min-h-[9rem] flex-col gap-2.5 overflow-y-auto pr-1',
          fill ? 'min-h-0 flex-1' : 'max-h-[26rem]',
        )}
      >
        {showEmptyState && disabled && fallback ? (
          fallback
        ) : showEmptyState ? (
          /*
            An opening, not a placeholder.
            
            The suggestions were chips in a centred cluster, which reads as
            decoration beside a caption. Stacked as full-width rows they read
            as the first thing to do, and each one is drawn from what the case
            actually holds — so this is the shortest description of the file
            anybody gets, as well as the way in.
          */
          <div className={cn('flex flex-1 flex-col justify-center gap-3', compact ? 'py-3' : 'py-6')}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{emptyTitle ?? 'Ask about this case'}</p>
                <p className="text-xs leading-relaxed text-ink-secondary">
                  {emptyHint ?? 'Answers come from its own evidence, with the source attached.'}
                </p>
              </div>
            </div>
            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {(compact ? suggestions.slice(0, 3) : suggestions).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => void submit(s)}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-lg bg-surface px-3 py-2 text-left text-[12.5px] text-ink-secondary',
                      'ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick',
                      'hover:bg-brand-soft hover:text-brand hover:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50',
                      'coarse:min-h-11',
                    )}
                  >
                    <MessageCircle size={13} className="shrink-0 text-ink-muted group-hover:text-brand" />
                    <span className="min-w-0 flex-1">{s}</span>
                    <ArrowUp size={12} className="shrink-0 rotate-45 text-ink-muted group-hover:text-brand" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : tab === 'activity' ? (
          /*
            One line an event, not two bubbles.
            Each of these was a blue user bubble, a grey "Recorded." reply, a
            citation chip and an "Agent-generated" tag — four elements to say a
            field was saved. What a reader wants from a log is when and what,
            newest first, and the ability to stop reading.
          */
          <ol className="space-y-0.5">
            {[...groupActivity(activity)].reverse().map((entry) => (
              <li
                key={entry.turn.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 py-1 text-[12px]"
              >
                <span className="font-mono text-mini tabular-nums text-ink-muted">{relativeTime(entry.at)}</span>
                <span className="min-w-0 text-ink-secondary">
                  {entry.summary}
                  {entry.count > 1 ? (
                    <span className="ml-1 font-mono text-mini text-ink-muted">×{entry.count}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <>
            {shown.map((turn) => (
              /*
                `animate-rise-in` on each turn, which the design system
                already defines and reduced-motion already neutralises. A
                conversation where answers appear instantaneously reads as a
                page repainting; a small rise reads as something arriving.
              */
              <div key={turn.id} className="animate-rise-in">
              <TurnBubble
                verification={verification}
                turn={turn}
                evidence={evidence}
                nodes={nodes}
                applied={appliedByTurn?.[turn.id]}
                screenResult={screenResult}
                askingPrice={askingPrice}
                onPick={(text, sitting) => void onPickChoice?.(text, sitting)}
                onOpenNode={onOpenNode}
                onOpenEvidence={onOpenEvidence}
                onOpenDocument={onOpenDocument}
                extras={renderTurnExtras?.(turn)}
              />
              </div>
            ))}
            {busy ? <TypingIndicator steps={steps ?? []} /> : null}
          </>
        )}
      </div>

      {!compact && !showEmptyState && suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pt-2">
          {suggestions.map((s) => (
            <SuggestionChip key={s} text={s} disabled={disabled || busy} onClick={() => void submit(s)} />
          ))}
        </div>
      ) : null}

      {dock ? <div className="shrink-0">{dock}</div> : null}

      {disabled ? (
        <div className="flex items-start gap-2 rounded-lg bg-sunken px-2.5 py-2 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
          <Info size={13} className="mt-px shrink-0 text-ink-muted" />
          <span>
            {disabledReason ?? 'No model is configured for this deployment.'} Everything else on this case works.
          </span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span
                key={`${f.name}-${f.size}-${f.lastModified}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
              >
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="text-ink-muted hover:text-ink"
                  onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
        {allowAttach ? (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png,.xlsx,.xls"
              onChange={(e) => {
                const next = Array.from(e.target.files ?? []);
                if (next.length) setFiles((prev) => [...prev, ...next].slice(0, 10));
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Attach documents"
              title="Attach documents"
              disabled={disabled || busy}
              icon={<Paperclip size={14} />}
              onClick={() => fileRef.current?.click()}
            />
          </>
        ) : null}
        <Textarea
          aria-label="Ask the copilot"
          placeholder={disabled ? 'Copilot unavailable' : placeholder ?? (onOpenCommands ? 'Ask about this case, or / for commands' : 'Ask about this case…')}
          value={text}
          rows={1}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(
            'max-h-[9rem] min-h-0 flex-1 resize-none py-2',
            compact && 'min-h-11',
          )}
          ref={composerRef}
        />
        {busy && onCancel ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            aria-label="Stop"
          >
            Stop
          </Button>
        ) : (
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || busy || (!text.trim() && files.length === 0)}
          loading={busy}
          icon={<ArrowUp size={14} />}
          aria-label="Ask"
        >
          {compact ? null : 'Ask'}
        </Button>
        )}
        {onClear && conversation.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Clear conversation"
            title="Clear conversation"
            disabled={disabled || busy}
            icon={<Trash2 size={14} />}
            onClick={onClear}
          />
        ) : null}
        </div>
      </form>
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}
