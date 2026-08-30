import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ArrowUp, CheckCircle2, Info, MessageCircle, SearchX, Sparkles, Trash2 } from 'lucide-react';
import type { AgentStep, CopilotTurn, DdNode, EvidenceItem, PropertyCase, VerificationSummary } from '@realytica/shared';
import { CriticFlagBanner, findFlaggedCriticFinding } from './VerificationPanel';
import { EvidenceLink } from './EvidenceLink';
import { Badge, Button, Callout, Textarea, cn } from './ui/kit';
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
  caseData,
  verification,
  onOpenNode,
  onOpenEvidence,
  onOpenDocument,
}: {
  turn: CopilotTurn;
  evidence: EvidenceItem[];
  nodes?: DdNode[];
  applied?: string[];
  caseData?: PropertyCase;
  verification?: VerificationSummary;
  onOpenNode?: (nodeId: string) => void;
  onOpenEvidence?: (id: string) => void;
  /** Open a cited document in the proof pane. */
  onOpenDocument?: (documentId: string) => void;
}) {
  // What the answer placed in the flow of a sentence, so the strips below can
  // show only what it did not.
  const inlineEvidence = new Set(Array.from(turn.text.matchAll(/\[ev:([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g), m => m[1]));
  const uncited = turn.citedEvidenceIds.filter(id => !inlineEvidence.has(id));
  const uncitedNodes = (turn.citedNodeIds ?? []).filter(id => !turn.text.includes(`[${id}]`));
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
        {/* The identity ramp on your own turns, matching the intake chat, so
            a transcript reads as a conversation with something rather than a
            log of alternating blocks. White is set explicitly: the fill is the
            same gradient in both themes, so a token that flips with the theme
            would be unreadable in one of them. */}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-ramp px-3 py-2 text-[13px] leading-relaxed text-white shadow-glow">
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
        {caseData && turn.toolCalls && turn.toolCalls.length > 0 ? (
          <TurnVisual toolNames={turn.toolCalls.map(t => t.name)} caseData={caseData} />
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
            <EvidenceLink ids={uncited} evidence={evidence} onOpenDocument={onOpenDocument} />
          </div>
        ) : null}
        {onOpenNode && uncitedNodes.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {uncitedNodes.map((nodeId) => (
              <button
                key={nodeId}
                onClick={() => onOpenNode(nodeId)}
                className="rounded-full bg-surface px-2 py-0.5 text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:text-ink"
                title="Focus this node in the graph explorer"
              >
                {nodeLabel(nodeId)}
              </button>
            ))}
          </div>
        ) : null}
        <AgentTag at={turn.at} />
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
          <span className="text-mini text-ink-faint">
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
  caseData,
}: {
  conversation: CopilotTurn[];
  evidence: EvidenceItem[];
  suggestions: string[];
  onAsk: (question: string) => Promise<void> | void;
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
  nodes?: DdNode[];
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
   * The case, so a turn can draw the chart behind its answer.
   *
   * Passed rather than fetched: the chart has to be the same numbers the rest
   * of the screen is showing, and a second read could disagree with the first.
   */
  caseData?: PropertyCase;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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

  async function submit(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || busy || disabled) return;
    setError(null);
    setText('');
    try {
      await onAsk(trimmed);
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

  const showEmptyState = conversation.length === 0 && !busy;

  return (
    <div className={cn('flex flex-col gap-3', fill && 'h-full min-h-0')}>
      {/*
        The unavailable notice moved DOWN, to the composer.
        
        Chat is the centre of the cockpit, so a banner above the conversation
        made the most prominent element on every case page an apology for
        something the reader cannot fix and did not ask about. It belongs
        beside the box you would type in — which is where you find out, and
        the only place the answer changes what you do next.
      */}

      <div
        ref={scrollRef}
        className={cn(
          'flex min-h-[9rem] flex-col gap-2.5 overflow-y-auto pr-1',
          // `fill` is for the cockpit, where chat IS the column and a 26rem
          // cap left the conversation floating in a half-empty pane with the
          // composer stranded under it. The dock and the Intelligence card
          // are boxes inside a scrolling page and still want the cap.
          fill ? 'flex-1' : 'max-h-[26rem]',
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
          <div className="flex flex-1 flex-col justify-center gap-3 py-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">Ask about this case</p>
                <p className="text-xs leading-relaxed text-ink-secondary">
                  Answers come from its own evidence, with the source attached.
                </p>
              </div>
            </div>
            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
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
                    <ArrowUp size={12} className="shrink-0 rotate-45 text-ink-faint group-hover:text-brand" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {conversation.map((turn) => (
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
                caseData={caseData}
                onOpenNode={onOpenNode}
                onOpenEvidence={onOpenEvidence}
                onOpenDocument={onOpenDocument}
              />
              </div>
            ))}
            {busy ? <TypingIndicator steps={steps ?? []} /> : null}
          </>
        )}
      </div>

      {!showEmptyState && suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pt-2">
          {suggestions.map((s) => (
            <SuggestionChip key={s} text={s} disabled={disabled || busy} onClick={() => void submit(s)} />
          ))}
        </div>
      ) : null}

      {disabled ? (
        <div className="flex items-start gap-2 rounded-lg bg-sunken px-2.5 py-2 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
          <Info size={13} className="mt-px shrink-0 text-ink-muted" />
          <span>
            {disabledReason ?? 'No model is configured for this deployment.'} Everything else on this case works.
          </span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        {/*
          A textarea, because Shift+Enter was already being handled and an
          `<input>` has no second line to fall through to — so the guard read
          as deliberate multi-line support that silently did nothing. It grows
          to the text and stops at six lines, which is far enough to see a
          pasted paragraph and near enough to leave the conversation visible.
        */}
        <Textarea
          aria-label="Ask the copilot"
          placeholder={disabled ? 'Copilot unavailable' : onOpenCommands ? 'Ask about this case, or / for commands' : 'Ask about this case…'}
          value={text}
          rows={1}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="max-h-[9rem] min-h-0 resize-none py-2"
          ref={composerRef}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || busy || !text.trim()}
          loading={busy}
          icon={<ArrowUp size={14} />}
        >
          Ask
        </Button>
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
      </form>
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}
