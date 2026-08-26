import type { CSSProperties } from 'react';
import { forwardRef } from 'react';
import {
  Boxes,
  Bot,
  Cog,
  Compass,
  FileWarning,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import type {
  AgentRun,
  AgentRunStatus,
  CapabilityGap,
  ProviderId,
  RunGraphNode,
  RunGraphNodeKind,
} from '@realytica/shared';
import { Badge, cn, type Tone } from '../ui/kit';
import type { PositionedNode } from './layout';

/**
 * One node on the run canvas, plus the display vocabulary the inspector shares
 * with it.
 *
 * The vocabulary lives here rather than in a fourth module because it is the
 * *node's* vocabulary — what a status is called, what a capability gap costs
 * you — and the inspector is a larger rendering of the same node. It is
 * deliberately kept identical to `pages/Observability.tsx`: a gap that reads
 * "No verified citations" on the model-ops page must not read as something else
 * here, or the two views stop being about the same fact.
 *
 * Nodes are HTML, not SVG, and sit in the same transformed layer as the SVG
 * edge sheet. The trade-off is deliberate: SVG would give crisper text at low
 * zoom, but it costs manual truncation, manual focus rings, and a second
 * styling vocabulary parallel to the design system. HTML nodes get `Badge`,
 * `text-ink`, real `<button>` semantics and a real focus-visible outline for
 * free, and browsers re-rasterise transformed text at the composited scale, so
 * the crispness gap is small. Legibility at low zoom is solved instead by
 * dropping detail (`detail="compact"`), which is what the reader needs anyway.
 */

/* ------------------------------------------------------------------ */
/* Shared vocabulary                                                   */
/* ------------------------------------------------------------------ */

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai_compatible: 'OpenAI-compatible',
};

export const GAP_LABEL: Record<CapabilityGap, string> = {
  citations_unavailable: 'No verified citations',
  prompt_caching_unavailable: 'No prompt caching',
  adaptive_thinking_unavailable: 'No adaptive thinking',
  server_web_search_unavailable: 'No server web search',
  refusal_fallback_unavailable: 'No refusal fallback',
  pdf_input_unavailable: 'No native PDF input',
  strict_tools_unavailable: 'No strict tool schemas',
};

/**
 * What each gap actually did to this node's output.
 *
 * Written as a consequence rather than a capability, because "adaptive
 * thinking unavailable" tells a valuer nothing and "the model could not spend
 * longer on the harder parts" tells them what to distrust.
 */
export const GAP_CONSEQUENCE: Record<CapabilityGap, string> = {
  citations_unavailable:
    'Page references on anything this node produced are self-reported by the model, not checked against the document.',
  prompt_caching_unavailable: 'Repeated context was re-sent and re-billed. Costs more; changes nothing about the answer.',
  adaptive_thinking_unavailable: 'The model could not spend extra effort on the harder parts of the task.',
  server_web_search_unavailable: 'Any external lookup was done by this app, not by the provider, so results depend on what it could reach.',
  refusal_fallback_unavailable: 'A safety decline could not be retried server-side, so one refusal ends the step.',
  pdf_input_unavailable:
    'The PDF was rasterised or text-extracted locally before the model saw it, so layout, stamps and marginalia may be lost.',
  strict_tools_unavailable: 'Tool arguments were not schema-guaranteed, so a malformed call is possible.',
};

/**
 * Gaps that change what a result *means*, as opposed to what it costs.
 *
 * The same two-element set as the model-ops page, and the distinction the whole
 * degradation story rests on: a missing prompt cache is an invoice problem, a
 * missing citation is an evidence problem.
 */
export const GROUNDING_GAPS = new Set<CapabilityGap>(['citations_unavailable', 'pdf_input_unavailable']);

export type NodeStatus = AgentRunStatus | 'ok';

export const STATUS_TONE: Record<NodeStatus, Tone> = {
  queued: 'neutral',
  running: 'brand',
  succeeded: 'good',
  ok: 'good',
  failed: 'critical',
  cancelled: 'warning',
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  ok: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** The CSS colour token behind each status — used for the SVG-free status spine. */
export const STATUS_COLOUR: Record<NodeStatus, string> = {
  queued: 'var(--axis)',
  running: 'var(--brand)',
  succeeded: 'var(--status-good)',
  ok: 'var(--status-good)',
  failed: 'var(--status-critical)',
  cancelled: 'var(--status-warning)',
};

export const KIND_ICON: Record<RunGraphNodeKind, typeof Bot> = {
  plan: Compass,
  agent: Bot,
  engine: Cog,
  output: Boxes,
};

export const KIND_LABEL: Record<RunGraphNodeKind, string> = {
  plan: 'Plan',
  agent: 'Agent run',
  engine: 'Deterministic step',
  output: 'Produced output',
};

/**
 * A provider refusal is not a failure, but the frozen contract cannot say so.
 *
 * `AgentRunStatus` has no `refused` member — refusal lives on
 * `LlmCallRecord.outcome`, which the run graph does not carry. Colouring every
 * decline critical-red overstates it: a refusal returned a policy decision, not
 * a broken pipeline, and the operator's next move is different. So a failed
 * node whose own prose says it was declined is shown as a refusal. This reads
 * text the orchestrator wrote for a human, which is a display refinement over a
 * real signal, and it degrades to plain "Failed" whenever the wording does not
 * match — never the other way round.
 */
export function isRefusal(node: RunGraphNode, run?: AgentRun | null): boolean {
  if (node.status !== 'failed') return false;
  const prose = `${node.detail ?? ''} ${run?.error ?? ''}`;
  return /\brefus|\bdeclin/i.test(prose);
}

export function statusLabelFor(node: RunGraphNode, run?: AgentRun | null): string {
  return isRefusal(node, run) ? 'Refused' : STATUS_LABEL[node.status];
}

export function statusToneFor(node: RunGraphNode, run?: AgentRun | null): Tone {
  return isRefusal(node, run) ? 'warning' : STATUS_TONE[node.status];
}

export function statusColourFor(node: RunGraphNode, run?: AgentRun | null): string {
  return isRefusal(node, run) ? 'var(--status-warning)' : STATUS_COLOUR[node.status];
}

/* ------------------------------------------------------------------ */
/* Formatters — same rules as the model-ops page                       */
/* ------------------------------------------------------------------ */

/**
 * Money, or nothing.
 *
 * `costUsd` is optional on the contract specifically so an unpriced route is
 * distinguishable from a free one, and rendering `undefined` as `$0` would
 * throw that away — a reader would sum a column of zeroes and believe the run
 * was free. Unpriced returns null so every call site has to decide what to say.
 */
export function usd(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function ms(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 60_000) {
    const m = Math.floor(value / 60_000);
    const s = Math.round((value % 60_000) / 1000);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}s`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

/**
 * Did this node make a model call at all?
 *
 * The distinction the cost line turns on. A deterministic step has no cost
 * because there was nothing to bill; a model step with no cost is a route this
 * deployment has no rates for. Keying on `kind` would get the plan node wrong,
 * which does call a model.
 */
export function isModelStep(node: RunGraphNode): boolean {
  return Boolean(node.provider || node.model);
}

export function routeLabel(node: RunGraphNode): string | null {
  if (!node.provider && !node.model) return null;
  const provider = node.provider ? PROVIDER_LABEL[node.provider] : 'unknown provider';
  return node.model ? `${provider} · ${node.model}` : provider;
}

/** Gaps split into the two kinds that matter, preserving contract order. */
export function splitGaps(gaps: CapabilityGap[] | undefined): { grounding: CapabilityGap[]; cost: CapabilityGap[] } {
  const grounding: CapabilityGap[] = [];
  const cost: CapabilityGap[] = [];
  for (const gap of gaps ?? []) (GROUNDING_GAPS.has(gap) ? grounding : cost).push(gap);
  return { grounding, cost };
}

/** Ids of guardrails the prompt versions this node ran under did not satisfy. */
export function brokenInvariants(node: RunGraphNode): string[] {
  const out: string[] = [];
  for (const usage of node.prompts ?? []) out.push(...usage.invariantsBroken);
  return out;
}

/* ------------------------------------------------------------------ */
/* The node                                                            */
/* ------------------------------------------------------------------ */

export interface RunNodeProps {
  placed: PositionedNode;
  selected: boolean;
  /** Linked run, when the case has one — only used to sharpen the status wording. */
  run?: AgentRun | null;
  /**
   * Below roughly half scale the secondary lines are unreadable anyway, so they
   * are dropped rather than rendered as grey mush. This is the thing that keeps
   * a forty-node fan-out navigable when zoomed out to fit.
   */
  detail: 'full' | 'compact';
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}

export const RunNode = forwardRef<HTMLButtonElement, RunNodeProps>(function RunNode(
  { placed, selected, run, detail, onSelect, onFocus },
  ref,
) {
  const node = placed.node;
  const Icon = KIND_ICON[node.kind];
  const tone = statusToneFor(node, run);
  const statusText = statusLabelFor(node, run);
  const spine = statusColourFor(node, run);
  const { grounding, cost } = splitGaps(node.capabilityGaps);
  const broken = brokenInvariants(node);
  const route = routeLabel(node);
  const money = usd(node.costUsd);
  const outputCount = node.outputs.reduce((n, o) => n + (o.count ?? 0), 0);

  const style: CSSProperties = {
    left: placed.x,
    top: placed.y,
    width: placed.width,
    height: placed.height,
  };

  /*
   * The accessible name carries everything the card shows visually, in the same
   * order, so a screen-reader user gets the glanceable summary rather than
   * having to open the inspector for every node just to triage the graph.
   */
  const ariaParts = [
    node.label,
    KIND_LABEL[node.kind],
    statusText,
    route ?? undefined,
    node.durationMs !== undefined ? ms(node.durationMs) : undefined,
    money ?? (isModelStep(node) ? 'cost not priced' : undefined),
    broken.length > 0 ? 'prompt guardrail dropped' : undefined,
    grounding.length > 0 ? 'grounding degraded' : undefined,
    cost.length > 0 && grounding.length === 0 ? 'degraded, cost only' : undefined,
  ].filter(Boolean);

  return (
    <button
      ref={ref}
      type="button"
      data-node-id={node.id}
      // `aria-current`, not `aria-pressed`: this is the item currently being
      // inspected, not a toggle. Clicking an already-selected node keeps the
      // panel open, so a pressed-state announcement would be a lie.
      aria-current={selected || undefined}
      aria-label={ariaParts.join(', ')}
      title={node.detail ?? node.label}
      onClick={() => onSelect(node.id)}
      onFocus={() => onFocus(node.id)}
      // Keep a pointer-down on a node from also starting a canvas pan.
      onPointerDown={(e) => e.stopPropagation()}
      style={style}
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-xl bg-surface pl-3.5 pr-2.5 text-left shadow-card transition-shadow',
        'ring-1 ring-[var(--ring)] hover:shadow-pop',
        detail === 'full' ? 'py-2.5' : 'justify-center py-2',
        selected && 'ring-2 ring-brand',
        /*
         * The one treatment reserved for a run produced under weakened
         * anti-fabrication rules. It is an *outline*, not a ring, precisely so
         * it survives selection: the brand ring and the critical outline are
         * different properties and can both be on at once, which means the
         * flag can never be hidden by the act of clicking the node.
         */
        broken.length > 0 && 'outline outline-offset-2 outline-critical',
        // An outline is drawn in CSS pixels and then scaled with the layer, so
        // a 2px flag fades to a hairline at low zoom. Thickening it in compact
        // mode keeps "this ran under weakened rules" visible at fit-to-view,
        // which is exactly when a reader is scanning for it.
        broken.length > 0 && (detail === 'compact' ? 'outline-4' : 'outline-2'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1.5', node.status === 'running' && 'animate-pulse')}
        style={{ background: spine }}
      />

      <div className="flex min-w-0 items-start gap-1.5">
        <Icon size={13} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight tracking-tight text-ink">
          {node.label}
        </span>
        {node.status === 'running' ? (
          <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-brand" aria-hidden="true" />
        ) : null}
      </div>

      {detail === 'compact' ? (
        <div className="mt-1 flex items-center gap-1.5 pl-[19px]">
          <Badge tone={tone}>{statusText}</Badge>
          {broken.length > 0 ? (
            <ShieldAlert size={13} className="shrink-0 text-critical" aria-hidden="true" />
          ) : grounding.length > 0 ? (
            <FileWarning size={13} className="shrink-0 text-critical" aria-hidden="true" />
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-0.5 truncate pl-[19px] font-mono text-[10px] leading-4 text-ink-muted">
            {route ?? KIND_LABEL[node.kind]}
          </p>

          <div className="mt-auto flex items-baseline gap-1.5 pl-[19px] text-[11px] leading-4">
            <Badge tone={tone}>{statusText}</Badge>
            <span className="tabular truncate text-ink-secondary">
              {ms(node.durationMs)}
              {/*
               * Unpriced is stated, never shown as zero — but only where a
               * price could have existed. A deterministic step has no cost
               * segment at all, because "no model cost" on every engine node is
               * noise that crowds out the duration beside it.
               */}
              {money !== null ? (
                <>{' · '}{money}</>
              ) : isModelStep(node) ? (
                <>
                  {' · '}
                  <span className="text-warning">unpriced</span>
                </>
              ) : null}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 pl-[19px]">
            {broken.length > 0 ? (
              <Badge tone="critical" icon={<ShieldAlert size={10} />} title="This run used a prompt version that failed a guardrail check">
                Guardrail dropped
              </Badge>
            ) : null}
            {grounding.length > 0 ? (
              <Badge tone="critical" icon={<FileWarning size={10} />} title={grounding.map((g) => GAP_LABEL[g]).join('; ')}>
                Grounding
              </Badge>
            ) : null}
            {cost.length > 0 ? (
              <Badge tone="warning" title={cost.map((g) => GAP_LABEL[g]).join('; ')}>
                {grounding.length > 0 ? `+${cost.length}` : `Degraded · cost`}
              </Badge>
            ) : null}
            {broken.length === 0 && grounding.length === 0 && cost.length === 0 && node.outputs.length > 0 ? (
              <span className="truncate text-[10px] text-ink-muted">
                {node.outputs.length} output{node.outputs.length === 1 ? '' : 's'}
                {outputCount > 0 ? ` · ${outputCount} item${outputCount === 1 ? '' : 's'}` : ''}
              </span>
            ) : null}
          </div>
        </>
      )}
    </button>
  );
});
