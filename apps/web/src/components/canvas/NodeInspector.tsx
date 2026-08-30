import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Clock,
  Coins,
  ExternalLink,
  FileWarning,
  ListTree,
  ServerCog,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { AgentRun, AgentStep, ModelTier, PromptUsage, RunGraphNode } from '@realytica/shared';
import { Badge, KeyValue, SectionTitle, cn } from '../ui/kit';
import {
  GAP_CONSEQUENCE,
  GAP_LABEL,
  KIND_ICON,
  KIND_LABEL,
  brokenInvariants,
  isModelStep,
  ms,
  splitGaps,
  statusLabelFor,
  statusToneFor,
  usd,
} from './RunNode';

/**
 * What one node actually did.
 *
 * The canvas answers "what ran and in what order"; this panel answers the
 * questions that follow, in the order a reader asks them: is this result
 * trustworthy, what did it cost, and what did it produce. Trust comes first —
 * a broken prompt guardrail or a missing citation changes how everything below
 * it should be read, so it is stated above the cost and the outputs rather
 * than filed under a "details" heading further down.
 */

/**
 * Why a node ran on the model it ran on.
 *
 * The graph carries the tier but not the `RouteSource` that resolved it — that
 * lives on `AgentRoute`, which is a deployment-wide fact rather than a per-node
 * one. So the honest answer to "why this model" here is the tier's rationale,
 * with a pointer to the routing table for the override that produced the exact
 * model string. Inventing a source would be worse than naming where it lives.
 */
const TIER_RATIONALE: Record<ModelTier, string> = {
  extraction: 'Mechanical work — read a document, pull fields, normalise them. Quality is not the binding constraint here, so it runs on the cheapest capable model.',
  reasoning: 'Structured reasoning over facts supplied to it. A mid-tier model, because the hard part is the inputs rather than the inference.',
  judgment: 'Where being wrong is expensive — adversarial checking, title-chain reasoning, answers a user will act on. Routed to the strongest available model.',
};

/** Default deep link for a prompt version. Overridable once a prompts page exists. */
function defaultPromptHref(usage: PromptUsage): string {
  // Deep-links the prompt management page at the exact version this run used,
  // which is the whole point of recording a `PromptUsage`: "the extraction got
  // worse last Tuesday" is only answerable if the text behind that run is one
  // click away. `Prompts.tsx` reads both params.
  return `/prompts?key=${encodeURIComponent(usage.promptKey)}&version=${encodeURIComponent(usage.versionId)}`;
}

export interface NodeInspectorProps {
  node: RunGraphNode | null;
  /** The agent run behind the node, when the case carries one. Supplies the steps. */
  run?: AgentRun | null;
  /** Total wall clock for the whole graph, so a node's share can be stated. */
  totalDurationMs?: number;
  onClose: () => void;
  promptHref?: (usage: PromptUsage) => string;
}

export default function NodeInspector({
  node,
  run,
  totalDurationMs,
  onClose,
  promptHref = defaultPromptHref,
}: NodeInspectorProps) {
  /*
   * Escape closes the panel from anywhere, not just from the canvas.
   * The canvas has its own Escape handler, but once focus has moved into this
   * panel — which it will, since the prompt links are tabbable — that handler
   * is out of the event path. Same pattern as `Modal` in the UI kit.
   * Declared above the early return so the hook order never changes.
   */
  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, onClose]);

  if (!node) return null;

  const Icon = KIND_ICON[node.kind];
  const { grounding, cost } = splitGaps(node.capabilityGaps);
  const broken = brokenInvariants(node);
  const money = usd(node.costUsd);
  const share =
    node.durationMs !== undefined && totalDurationMs && totalDurationMs > 0
      ? Math.round((node.durationMs / totalDurationMs) * 100)
      : null;

  return (
    <>
      {/*
        * Below `lg` the panel is a sheet over the page rather than a column
        * beside it: at 380px wide there is no room for a canvas and a panel
        * side by side, and squeezing both produces two unusable halves.
        */}
      <div
        className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="complementary"
        aria-label={`Details for ${node.label}`}
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex max-h-[78vh] flex-col rounded-t-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]',
          'lg:static lg:z-auto lg:max-h-none lg:w-[360px] lg:shrink-0 lg:rounded-xl lg:shadow-card',
          'animate-fade-in',
        )}
      >
        <header className="flex shrink-0 items-start gap-2.5 border-b border-hairline px-4 py-3">
          <Icon size={15} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold leading-tight tracking-tight text-ink">{node.label}</h2>
            <p className="mt-0.5 text-mini text-ink-muted">{KIND_LABEL[node.kind]}</p>
          </div>
          <Badge tone={statusToneFor(node, run)}>{statusLabelFor(node, run)}</Badge>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="-mr-1 shrink-0 rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          {node.detail ? <p className="mb-3.5 text-xs leading-relaxed text-ink-secondary">{node.detail}</p> : null}

          {/* Trust first: everything below is read differently if these are set. */}
          {broken.length > 0 ? <GuardrailAlert broken={broken} /> : null}
          {grounding.length > 0 ? <GroundingAlert gaps={grounding} /> : null}

          {node.provider || node.model || node.tier ? (
            <section className="mb-4">
              <SectionTitle hint={<Link to="/observability" className="text-brand hover:underline">Routing table</Link>}>
                Route
              </SectionTitle>
              <dl>
                <KeyValue label="Model" value={node.model ?? <span className="text-ink-muted">not recorded</span>} mono />
                {node.tier ? <KeyValue label="Tier" value={<Badge tone="neutral">{node.tier}</Badge>} /> : null}
              </dl>
              {node.tier ? (
                <p className="mt-2 flex gap-1.5 text-mini leading-relaxed text-ink-secondary">
                  <ServerCog size={12} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                  {TIER_RATIONALE[node.tier]}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="mb-4">
            <SectionTitle>Timing and cost</SectionTitle>
            <dl>
              <KeyValue
                label={
                  <span className="inline-flex items-center gap-1">
                    <Clock size={11} /> Duration
                  </span>
                }
                value={ms(node.durationMs)}
                mono
              />
              {share !== null ? <KeyValue label="Share of run" value={`${share}%`} mono /> : null}
              <KeyValue
                label={
                  <span className="inline-flex items-center gap-1">
                    <Coins size={11} /> Cost
                  </span>
                }
                value={
                  money ?? (
                    /*
                     * Never `$0`. An unpriced route and a free step are
                     * different facts, and a reader who adds up a column of
                     * zeroes will believe a run was free when it was merely
                     * unmeasured.
                     */
                    <span className={isModelStep(node) ? 'text-warning' : 'text-ink-muted'}>
                      {isModelStep(node) ? 'not priced' : 'no model cost'}
                    </span>
                  )
                }
                mono
              />
              {run?.usage ? (
                <KeyValue
                  label="Tokens"
                  value={`${run.usage.inputTokens.toLocaleString('en-GB')} in · ${run.usage.outputTokens.toLocaleString('en-GB')} out`}
                  mono
                />
              ) : null}
            </dl>
            {money === null && isModelStep(node) ? (
              <p className="mt-1.5 text-mini leading-relaxed text-ink-muted">
                This deployment has no published rates for this route, so the call is excluded from every total rather
                than counted as free.
              </p>
            ) : null}
          </section>

          {cost.length > 0 ? (
            <section className="mb-4">
              <SectionTitle hint="cost only">Degraded capabilities</SectionTitle>
              <ul className="space-y-2">
                {cost.map((gap) => (
                  <li key={gap} className="rounded-lg bg-sunken p-2.5">
                    <Badge tone="warning">{GAP_LABEL[gap]}</Badge>
                    <p className="mt-1 text-mini leading-relaxed text-ink-secondary">{GAP_CONSEQUENCE[gap]}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {node.prompts && node.prompts.length > 0 ? (
            <section className="mb-4">
              <SectionTitle>Prompt versions used</SectionTitle>
              <ul className="space-y-1.5">
                {node.prompts.map((usage) => (
                  <li
                    key={`${usage.promptKey}-${usage.versionId}`}
                    className={cn(
                      'rounded-lg p-2.5 ring-1 ring-inset',
                      usage.invariantsBroken.length > 0
                        ? 'bg-critical/10 ring-critical/40'
                        : 'bg-sunken ring-[var(--ring)]',
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-mini text-ink">{usage.promptKey}</span>
                      <Badge tone={usage.invariantsBroken.length > 0 ? 'critical' : 'neutral'}>v{usage.version}</Badge>
                      <Link
                        to={promptHref(usage)}
                        className="inline-flex shrink-0 items-center gap-0.5 text-mini font-medium text-brand hover:underline"
                      >
                        Open <ArrowUpRight size={11} />
                      </Link>
                    </div>
                    <p className="mt-1 truncate font-mono text-micro text-ink-muted" title={usage.contentHash}>
                      {usage.contentHash}
                    </p>
                    {usage.invariantsBroken.length > 0 ? (
                      <p className="mt-1.5 text-mini leading-relaxed text-critical">
                        Failed {usage.invariantsBroken.length} guardrail check
                        {usage.invariantsBroken.length === 1 ? '' : 's'}:{' '}
                        {usage.invariantsBroken.join(', ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mb-4">
            <SectionTitle hint={node.outputs.length > 0 ? `${node.outputs.length}` : undefined}>Produced</SectionTitle>
            {node.outputs.length === 0 ? (
              <p className="text-mini leading-relaxed text-ink-muted">
                {node.status === 'failed'
                  ? 'Nothing — this step failed before it produced anything.'
                  : 'This step carried nothing forward of its own.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {node.outputs.map((output) => (
                  <li key={output.key} className="rounded-lg bg-sunken p-2.5">
                    <div className="flex items-baseline gap-2">
                      <Boxes size={12} className="shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-xs font-medium text-ink">{output.label}</span>
                      {output.count !== undefined ? (
                        <span className="tabular shrink-0 text-mini font-semibold text-ink-secondary">{output.count}</span>
                      ) : null}
                    </div>
                    {output.summary ? (
                      <p className="mt-1 pl-[18px] text-mini leading-relaxed text-ink-secondary">{output.summary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {run ? <RunSteps run={run} /> : null}

          {node.runId && !run ? (
            <p className="text-mini leading-relaxed text-ink-muted">
              Step-by-step detail for run <span className="font-mono">{node.runId}</span> is not loaded on this case.
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Trust alerts                                                        */
/* ------------------------------------------------------------------ */

/**
 * A run produced under weakened anti-fabrication rules.
 *
 * This is the loudest thing the panel can say, and deliberately so. The shared
 * preamble is the text that forbids inventing a document, a statute or a survey
 * number; a version that dropped one of those checks did not merely change
 * style. Editing prompts is allowed — editing them invisibly is not, and this
 * is where that promise is kept.
 */
function GuardrailAlert({ broken }: { broken: string[] }) {
  return (
    <div className="mb-3 flex gap-2.5 rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40">
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-critical" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-critical">Produced under weakened guardrails</p>
        <p className="mt-1 text-mini leading-relaxed text-ink-secondary">
          The prompt version this step ran on failed {broken.length} guardrail check
          {broken.length === 1 ? '' : 's'} ({broken.join(', ')}). Those checks are what forbid inventing a document, a
          statute or a figure, so anything below should be verified against the source before it is relied on.
        </p>
      </div>
    </div>
  );
}

/** A gap that changes what the output means, not what it costs. */
function GroundingAlert({ gaps }: { gaps: NonNullable<RunGraphNode['capabilityGaps']> }) {
  return (
    <div className="mb-3 flex gap-2.5 rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40">
      <FileWarning size={15} className="mt-0.5 shrink-0 text-critical" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-critical">Ran without full grounding</p>
        <ul className="mt-1 space-y-1.5">
          {gaps.map((gap) => (
            <li key={gap} className="text-mini leading-relaxed text-ink-secondary">
              <span className="font-medium text-ink">{GAP_LABEL[gap]}.</span> {GAP_CONSEQUENCE[gap]}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-mini leading-relaxed text-ink-secondary">
          This changes what the output means, not just what it costs.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const STEP_TONE: Record<AgentStep['kind'], string> = {
  plan: 'text-ink-muted',
  tool_call: 'text-ink-muted',
  tool_result: 'text-ink-muted',
  message: 'text-ink-muted',
  error: 'text-critical',
};

function RunSteps({ run }: { run: AgentRun }) {
  if (run.steps.length === 0 && !run.error) return null;
  return (
    <section>
      <SectionTitle hint={run.steps.length > 0 ? `${run.steps.length}` : undefined}>
        <span className="inline-flex items-center gap-1">
          <ListTree size={11} /> Steps
        </span>
      </SectionTitle>
      {run.error ? (
        <p className="mb-2 flex gap-1.5 rounded-lg bg-critical/10 p-2.5 text-mini leading-relaxed text-critical ring-1 ring-inset ring-critical/40">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          {run.error}
        </p>
      ) : null}
      <ol className="space-y-1">
        {run.steps.map((step) => (
          <li key={step.id} className="flex gap-2 border-b border-hairline py-1.5 last:border-0">
            <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current', STEP_TONE[step.kind])} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={cn('text-mini leading-snug', step.kind === 'error' ? 'text-critical' : 'text-ink')}>
                {step.label}
                {step.toolName ? (
                  <span className="ml-1.5 rounded bg-sunken px-1 py-0.5 font-mono text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                    {step.toolName}
                  </span>
                ) : null}
              </p>
              {step.detail ? <p className="mt-0.5 text-micro leading-snug text-ink-muted">{step.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {run.producedEvidenceIds.length > 0 ? (
        <p className="mt-2 flex items-center gap-1 text-mini text-ink-muted">
          <ExternalLink size={11} aria-hidden="true" />
          Contributed {run.producedEvidenceIds.length} item{run.producedEvidenceIds.length === 1 ? '' : 's'} to the
          evidence ledger.
        </p>
      ) : null}
    </section>
  );
}
