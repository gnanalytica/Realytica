import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ArrowUp, MessageCircle, Paperclip, SearchX, Sparkles, Trash2, X } from 'lucide-react';
import type { CopilotTurn, EvidenceItem, VerificationSummary } from '@realytica/shared';
import { CriticFlagBanner, findFlaggedCriticFinding } from './VerificationPanel';
import { EvidenceLink } from './EvidenceLink';
import { Badge, Button, Callout, Input, cn } from './ui/kit';
import { relativeTime } from '../lib/format';

function AgentTag({ at }: { at: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-muted">
      <Sparkles size={9} /> Agent-generated · {relativeTime(at)}
    </div>
  );
}

function TurnBubble({
  turn,
  evidence,
  verification,
  onOpenNode,
  onOpenDocument,
  extras,
}: {
  turn: CopilotTurn;
  evidence: EvidenceItem[];
  verification?: VerificationSummary;
  onOpenNode?: (nodeId: string) => void;
  /** Open a cited document in the proof pane. */
  onOpenDocument?: (documentId: string) => void;
  extras?: ReactNode;
}) {
  // A critic flag has to travel with the claim it concerns. Surfacing it only
  // in the verification panel would let someone read an unsupported answer
  // cleanly here and never see the warning sitting on another screen.
  const flagged = findFlaggedCriticFinding(verification, 'copilot_answer', turn.id);
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-brand px-3 py-2 text-[13px] leading-relaxed text-[var(--brand-ink)]">
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
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-brand-soft px-3 py-2.5 ring-1 ring-inset ring-brand/25">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand">
            <SearchX size={12} /> No answer — the evidence doesn&rsquo;t support one
          </div>
          <p className="text-[13px] leading-relaxed text-ink">{turn.text}</p>
          <p className="mt-1 text-[11px] text-ink-secondary">
            That&rsquo;s a legitimate outcome, not an error — nothing on file backs a confident answer yet.
          </p>
          <AgentTag at={turn.at} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-sunken px-3 py-2.5 ring-1 ring-inset ring-[var(--ring)]">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{turn.text}</p>
        {turn.toolCalls && turn.toolCalls.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {turn.toolCalls.map((t, i) => (
              <Badge key={i} tone="neutral">
                {t.summary}
              </Badge>
            ))}
          </div>
        ) : null}
        {flagged ? (
          <div className="mt-2">
            <CriticFlagBanner finding={flagged} compact />
          </div>
        ) : null}
        {turn.citedEvidenceIds.length > 0 ? (
          <div className="mt-1.5">
            <EvidenceLink ids={turn.citedEvidenceIds} evidence={evidence} onOpenDocument={onOpenDocument} />
          </div>
        ) : null}
        {onOpenNode && turn.citedNodeIds && turn.citedNodeIds.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {[...new Set(turn.citedNodeIds)].map((nodeId) => (
              <button
                key={nodeId}
                onClick={() => onOpenNode(nodeId)}
                className="rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:text-ink"
                title="Focus this node in the graph explorer"
              >
                {nodeId.length > 26 ? `${nodeId.slice(0, 26)}…` : nodeId}
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

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-xl rounded-tl-sm bg-sunken px-3 py-3 ring-1 ring-inset ring-[var(--ring)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:300ms]" />
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
        'rounded-full bg-sunken px-2.5 py-1 text-[11px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]',
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
  fallback,
  fill,
  emptyTitle,
  emptyHint,
  placeholder,
  allowAttach,
  renderTurnExtras,
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
  /** Fill the parent column instead of a capped message list. */
  fill?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  placeholder?: string;
  allowAttach?: boolean;
  renderTurnExtras?: (turn: CopilotTurn) => ReactNode;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
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
      {disabled ? (
        <Callout tone="neutral" title="Copilot needs Anthropic credentials" collapsible>
          {disabledReason ?? 'Configure agent credentials to ask questions about this case.'} The rest of Realytica works
          fully without it.
        </Callout>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          'flex flex-col gap-2.5 overflow-y-auto pr-1',
          fill ? 'min-h-0 flex-1' : 'max-h-[26rem] min-h-[9rem]',
        )}
      >
        {showEmptyState && disabled && fallback ? (
          fallback
        ) : showEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
            <MessageCircle size={22} className="text-ink-muted" aria-hidden="true" />
            <p className="text-[13px] font-medium text-ink">{emptyTitle ?? 'Ask the copilot about this case'}</p>
            <p className="max-w-xs text-xs leading-relaxed text-ink-secondary">
              {emptyHint ??
                'It answers from the case’s own evidence, and says so plainly when the evidence doesn’t support an answer.'}
            </p>
            {suggestions.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {suggestions.map((s) => (
                  <SuggestionChip key={s} text={s} disabled={disabled} onClick={() => void submit(s)} />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {conversation.map((turn) => (
              <TurnBubble
                verification={verification}
                key={turn.id}
                turn={turn}
                evidence={evidence}
                onOpenNode={onOpenNode}
                onOpenDocument={onOpenDocument}
                extras={turn.role === 'assistant' ? renderTurnExtras?.(turn) : undefined}
              />
            ))}
            {busy ? <TypingIndicator /> : null}
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

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span
                key={`${f.name}-${f.size}-${f.lastModified}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
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
        <div className="flex items-center gap-2">
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
          <Input
            aria-label="Ask the copilot"
            placeholder={disabled ? 'Copilot unavailable' : placeholder ?? 'Ask about this case…'}
            value={text}
            disabled={disabled || busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={disabled || busy || (!text.trim() && files.length === 0)}
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
        </div>
      </form>
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}
