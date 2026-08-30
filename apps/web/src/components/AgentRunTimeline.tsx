import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Loader2,
  MessageSquare,
  PackageCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { AgentRun, AgentRunStatus, AgentStep, AgentUsage } from '@realytica/shared';
import { Badge, Card, EmptyState, cn, type Tone } from './ui/kit';
import { titleCase } from '../lib/format';

const STATUS_TONE: Record<AgentRunStatus, Tone> = {
  queued: 'neutral',
  running: 'brand',
  succeeded: 'good',
  failed: 'critical',
  cancelled: 'warning',
};

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STEP_ICON: Record<AgentStep['kind'], typeof Wrench> = {
  plan: Compass,
  tool_call: Wrench,
  tool_result: PackageCheck,
  message: MessageSquare,
  error: AlertTriangle,
};

/** Small-amount-aware $ formatting — agent calls are usually cents, not dollars. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatDuration(startedAt: string, finishedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${String(rem).padStart(2, '0')}s`;
}

function StepRow({ step, pulse }: { step: AgentStep; pulse?: boolean }) {
  const Icon = STEP_ICON[step.kind];
  return (
    <li className="flex items-start gap-2 py-1.5">
      <Icon
        size={12}
        className={cn('mt-0.5 shrink-0', step.kind === 'error' ? 'text-critical' : 'text-ink-muted', pulse && 'animate-pulse')}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-xs leading-snug text-ink', step.kind === 'error' && 'text-critical')}>
          {step.label}
          {step.toolName ? (
            <span className="ml-1.5 rounded bg-sunken px-1 py-0.5 font-mono text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
              {step.toolName}
            </span>
          ) : null}
        </p>
        {step.detail ? <p className="mt-0.5 text-mini leading-snug text-ink-secondary">{step.detail}</p> : null}
      </div>
    </li>
  );
}

function RunUsage({ usage }: { usage?: AgentUsage }) {
  if (!usage) return <span className="text-ink-muted">—</span>;
  const tokens = usage.inputTokens + usage.outputTokens;
  return (
    <span className="tabular">
      {tokens.toLocaleString('en-US')} tok · {formatUsd(usage.estimatedCostUsd)}
    </span>
  );
}

function RunCard({ run, defaultOpen }: { run: AgentRun; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const tone = STATUS_TONE[run.status];
  return (
    <Card className="!shadow-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-ink-muted" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-ink-muted" aria-hidden="true" />
        )}
        <Bot size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{titleCase(run.agent)}</span>
        <Badge tone={tone}>{STATUS_LABEL[run.status]}</Badge>
        <span className="hidden shrink-0 items-center gap-1 text-mini text-ink-muted sm:flex">
          <Clock size={11} /> {formatDuration(run.startedAt, run.finishedAt)}
        </span>
        <span className="hidden shrink-0 text-mini text-ink-muted md:inline">
          <RunUsage usage={run.usage} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-hairline px-3 py-2.5">
          {run.summary ? <p className="mb-2 text-xs leading-relaxed text-ink-secondary">{run.summary}</p> : null}
          {run.error ? (
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-critical">
              <XCircle size={12} /> {run.error}
            </p>
          ) : null}
          {run.steps.length > 0 ? (
            <ul className="divide-y divide-hairline">
              {run.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-muted">No recorded steps.</p>
          )}
          {run.producedEvidenceIds.length > 0 ? (
            <p className="mt-2 text-mini text-ink-muted">
              Contributed {run.producedEvidenceIds.length} evidence item{run.producedEvidenceIds.length === 1 ? '' : 's'} to
              the case ledger.
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-mini text-ink-muted sm:hidden">
            <span className="flex items-center gap-1">
              <Clock size={11} /> {formatDuration(run.startedAt, run.finishedAt)}
            </span>
            <RunUsage usage={run.usage} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Compact vertical timeline of agent activity for one case — one row per
 * `AgentRun`, expandable to its steps, plus a live block at the bottom while
 * a run is streaming in. Everything here is model output, not a documented
 * fact — kept visually distinct (its own icon, muted tone, explicit labels)
 * so it never reads as ground truth from the deterministic screen.
 */
export function AgentRunTimeline({ runs, live }: { runs: AgentRun[]; live?: AgentStep[] }) {
  const sorted = [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const isLive = live !== undefined;

  if (sorted.length === 0 && !isLive) {
    return (
      <EmptyState
        icon={<Bot size={24} />}
        title="No agent runs yet"
        description="Run the agents to see their activity here — what each one looked at, what it found, and what it cost."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {isLive ? (
        <Card className="!shadow-none ring-1 ring-brand/30">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Loader2 size={14} className="shrink-0 animate-spin text-brand" aria-hidden="true" />
            <span className="text-[13px] font-medium text-ink">Agent run in progress…</span>
          </div>
          {live.length > 0 ? (
            <ul className="divide-y divide-hairline border-t border-hairline px-3">
              {live.map((step, i) => (
                <StepRow key={step.id} step={step} pulse={i === live.length - 1} />
              ))}
            </ul>
          ) : (
            <p className="border-t border-hairline px-3 py-2 text-xs text-ink-muted">Waiting for the first step…</p>
          )}
        </Card>
      ) : null}
      {sorted.map((run, i) => (
        <RunCard key={run.id} run={run} defaultOpen={i === 0 && !isLive} />
      ))}
    </div>
  );
}
