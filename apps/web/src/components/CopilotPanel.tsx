import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ArrowUp, MessageCircle, SearchX, Sparkles, Trash2 } from 'lucide-react';
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
}: {
  turn: CopilotTurn;
  evidence: EvidenceItem[];
  verification?: VerificationSummary;
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
            <EvidenceLink ids={turn.citedEvidenceIds} evidence={evidence} />
          </div>
        ) : null}
        <AgentTag at={turn.at} />
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
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    <div className="flex flex-col gap-3">
      {disabled ? (
        <Callout tone="neutral" title="Copilot needs Anthropic credentials">
          {disabledReason ?? 'Configure agent credentials to ask questions about this case.'} The rest of Realytica works
          fully without it.
        </Callout>
      ) : null}

      <div ref={scrollRef} className="flex max-h-[26rem] min-h-[9rem] flex-col gap-2.5 overflow-y-auto pr-1">
        {showEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
            <MessageCircle size={22} className="text-ink-muted" aria-hidden="true" />
            <p className="text-[13px] font-medium text-ink">Ask the copilot about this case</p>
            <p className="max-w-xs text-xs leading-relaxed text-ink-secondary">
              It answers from the case&rsquo;s own evidence, and says so plainly when the evidence doesn&rsquo;t support an
              answer.
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
              <TurnBubble verification={verification} key={turn.id} turn={turn} evidence={evidence} />
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

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          aria-label="Ask the copilot"
          placeholder={disabled ? 'Copilot unavailable' : 'Ask about this case…'}
          value={text}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
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
