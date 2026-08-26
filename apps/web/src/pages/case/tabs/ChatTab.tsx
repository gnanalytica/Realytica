import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Send, Sparkles, Workflow } from 'lucide-react';
import type { RunGraph } from '@realytica/shared';
import { api } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { Badge, Button, Callout, Input, Spinner, cn, useToast } from '../../../components/ui/kit';
import { money } from '../../../lib/format';
import { agentAvailable } from '../../../lib/agent-availability';
import type { TabProps } from '../tab-props';
import IntelligenceTab from './IntelligenceTab';
import FlowTab from './FlowTab';

/**
 * The case, as a conversation.
 *
 * This is where a case now opens. The five structured groups are still there
 * and still hold every panel, but the first thing in front of someone is a
 * question box rather than fourteen labelled destinations they have to choose
 * between before they know what they want.
 *
 * The two surfaces that used to be tabs live in here rather than in the group
 * bar, because both answer a question you ask *about* an answer rather than
 * being answers themselves: "what did the AI actually do" and "how was this
 * worked out". They open in place, under the conversation.
 */
export interface ChatTabProps extends TabProps {
  graph?: RunGraph | null;
  graphLoading?: boolean;
  graphError?: string | null;
  onNeedGraph?: () => void;
}

export default function ChatTab({ caseData, result, refresh, runScreen, running, goToTab, graph, graphLoading, graphError, onNeedGraph }: ChatTabProps) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [showWorking, setShowWorking] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: capability } = useAsync(() => api.agentCapability(), []);
  const turns = caseData.intelligence?.conversation ?? [];
  const runCount = caseData.intelligence?.runs.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, asking]);

  useEffect(() => {
    if (showWorking && !graph && !graphLoading) onNeedGraph?.();
  }, [showWorking, graph, graphLoading, onNeedGraph]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || asking) return;
      setAsking(true);
      setDraft('');
      try {
        await api.askCopilot(caseData.id, q);
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'That question did not get through.', 'critical');
        setDraft(q);
      } finally {
        setAsking(false);
      }
    },
    [caseData.id, refresh, toast, asking],
  );

  /**
   * Openers, drawn from the case rather than fixed.
   *
   * A blank box is the hardest thing to answer. These are the questions this
   * particular case actually raises — its worst open risk, its biggest gap —
   * so the first exchange is about the property rather than about learning
   * what the box accepts.
   */
  const openers = useMemo(() => {
    const out: string[] = [];
    const worstRisk = [...(result?.risks ?? [])]
      .filter((r) => r.status === 'open')
      .sort((a, b) => {
        const order = { critical: 0, serious: 1, warning: 2, info: 3 } as const;
        return order[a.severity] - order[b.severity];
      })[0];
    if (worstRisk) out.push(`What should I do about "${worstRisk.title}"?`);
    const missing = result?.completeness.missingCritical[0];
    if (missing) out.push(`Why does the ${missing.toLowerCase()} matter here?`);
    if (result) out.push('Is the asking price reasonable for this locality?');
    return out.slice(0, 3);
  }, [result]);

  /*
   * Whether the copilot's own route can run — not whether Anthropic
   * credentials exist. See `agentAvailable`; reading `capability.available`
   * here told a deployment routed at an OpenAI-compatible endpoint that its
   * answers were switched off while they worked.
   *
   * `undefined` while capability loads, so nothing flashes a switched-off
   * notice at someone whose model is fine.
   */
  const canAnswer = agentAvailable(capability, 'analyst_copilot');
  const agentsOff = canAnswer === false;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {!result ? (
        <Callout tone="warning" title="This case has not been screened yet">
          Run the screen and I can answer from its findings rather than guessing.
          <div className="mt-2">
            <Button size="sm" variant="primary" loading={running} onClick={runScreen}>
              Run screen
            </Button>
          </div>
        </Callout>
      ) : null}

      {agentsOff ? (
        <Callout tone="neutral" title="Answers are switched off on this deployment">
          No model is configured, so I cannot answer questions about this case. Everything in Overview, Value, Legal,
          Documents and Report is computed without one and works as normal.
        </Callout>
      ) : null}

      {turns.length === 0 ? (
        <div className="py-6">
          <p className="text-[15px] leading-relaxed text-ink">
            Ask me anything about {caseData.identity.label}.
          </p>
          {result ? (
            <p className="mt-1 text-[13px] text-ink-secondary">
              {result.recommendation.headline} Indicative range{' '}
              {money(result.indicativeValue.low, result.indicativeValue.currency, { compact: true })}–
              {money(result.indicativeValue.high, result.indicativeValue.currency, { compact: true })}.
            </p>
          ) : null}
          {openers.length > 0 && !agentsOff ? (
            <div className="mt-4 flex flex-col items-start gap-1.5">
              {openers.map((o) => (
                <button
                  key={o}
                  onClick={() => void ask(o)}
                  className="rounded-lg bg-sunken px-3 py-1.5 text-left text-[13px] text-ink-secondary transition-colors hover:text-ink"
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="case-chat">
          {turns.map((t) => (
            <div key={t.id} data-role={t.role} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[40rem] animate-rise-in rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  t.role === 'user'
                    ? 'bg-brand text-ink-inverse'
                    : 'bg-surface text-ink ring-1 ring-inset ring-[var(--ring)]',
                )}
              >
                <p className="whitespace-pre-wrap">{t.text}</p>
                {/*
                 * A refusal is marked rather than blended in. "The documents on
                 * file do not answer this" is a finding about the evidence, and
                 * it should not read like an ordinary answer that happens to be
                 * unhelpful.
                 */}
                {t.refusedForLackOfEvidence ? (
                  <Badge tone="warning" className="mt-2">Not answerable from the file</Badge>
                ) : null}
                {t.citedEvidenceIds.length > 0 ? (
                  <button
                    onClick={() => goToTab('documents?view=evidence')}
                    className="mt-2 block text-[11px] text-ink-secondary underline-offset-2 hover:underline"
                  >
                    {t.citedEvidenceIds.length} source{t.citedEvidenceIds.length === 1 ? '' : 's'} cited
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {asking ? (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Spinner size={13} /> Reading the case…
            </div>
          ) : null}
        </div>
      )}
      <div ref={endRef} />

      <div className="sticky bottom-0 flex items-center gap-2 bg-page/95 py-3 backdrop-blur">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          placeholder={agentsOff ? 'Answers are switched off on this deployment' : 'Ask about this case'}
          aria-label="Ask about this case"
          disabled={Boolean(agentsOff)}
          className="flex-1"
        />
        <Button variant="primary" icon={<Send size={15} />} loading={asking} disabled={!draft.trim() || Boolean(agentsOff)} onClick={() => void ask(draft)}>
          Ask
        </Button>
      </div>

      {/* The two former tabs, in place. */}
      <div className="flex flex-col gap-2">
        <Disclosure
          open={showWorking}
          onToggle={() => setShowWorking((v) => !v)}
          icon={<Workflow size={14} />}
          label="How this was worked out"
        >
          <FlowTab caseData={caseData} result={result} refresh={refresh} runScreen={runScreen} running={running} goToTab={goToTab} graph={graph} loading={graphLoading} error={graphError} />
        </Disclosure>
        <Disclosure
          open={showActivity}
          onToggle={() => setShowActivity((v) => !v)}
          icon={<Activity size={14} />}
          label="What the AI did"
          badge={runCount > 0 ? <Badge tone="neutral">{runCount}</Badge> : undefined}
        >
          <IntelligenceTab caseData={caseData} result={result} refresh={refresh} runScreen={runScreen} running={running} goToTab={goToTab} />
        </Disclosure>
      </div>
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  icon,
  label,
  badge,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {label}
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </button>
      {open ? <div className="animate-scale-in border-t border-hairline p-3">{children}</div> : null}
    </div>
  );
}
