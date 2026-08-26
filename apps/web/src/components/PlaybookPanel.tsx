import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Lock, MinusCircle, TriangleAlert } from 'lucide-react';
import type { ComplianceVerdict, PlaybookRun, PlaybookStepResult, PlaybookStepState } from '@valytica/shared';
import { DOCUMENT_KIND_LABEL } from '../lib/format';
import { Badge, Card, CardBody, CardHeader, ProgressBar, cn, type Tone } from './ui/kit';
import { PlaybookTrack } from './charts';

/**
 * A diligence procedure, shown as the practitioner walks it.
 *
 * The gate is the point. A generic checklist renders every item as
 * independently answerable, which is exactly what a real procedure is not:
 * reconciling areas against a chain of title you have not established
 * produces a number with no meaning. So a blocked step renders as blocked,
 * naming what blocks it, rather than as a red cross that reads like a
 * finding. The distinction matters — "we could not check this yet" and "we
 * checked this and it failed" lead to different next actions, and conflating
 * them is how a checklist misleads.
 */

const STATE_TONE: Record<PlaybookStepState, Tone> = {
  clear: 'good',
  attention: 'warning',
  blocked: 'neutral',
  not_started: 'neutral',
  not_applicable: 'neutral',
};

const STATE_LABEL: Record<PlaybookStepState, string> = {
  clear: 'Clear',
  attention: 'Attention',
  blocked: 'Blocked',
  not_started: 'Not started',
  not_applicable: 'N/A',
};

const STATE_ICON: Record<PlaybookStepState, typeof CheckCircle2> = {
  clear: CheckCircle2,
  attention: TriangleAlert,
  blocked: Lock,
  not_started: CircleDashed,
  not_applicable: MinusCircle,
};

const VERDICT_TONE: Record<ComplianceVerdict, Tone> = {
  clear: 'good',
  attention: 'warning',
  blocker: 'critical',
  unknown: 'neutral',
};

function StepRow({
  step,
  stepsByKey,
  isNext,
}: {
  step: PlaybookStepResult;
  stepsByKey: Map<string, PlaybookStepResult>;
  isNext: boolean;
}) {
  const [open, setOpen] = useState(isNext);
  const Icon = STATE_ICON[step.state];
  const tone = STATE_TONE[step.state];
  const hasDetail = step.needs.length > 0 || Boolean(step.citation) || (step.blockedBy?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        'border-b border-hairline py-2.5 last:border-0',
        isNext && '-mx-3 rounded-lg bg-brand-soft px-3',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2.5 text-left"
        aria-expanded={open}
      >
        <Icon
          size={14}
          className={cn(
            'mt-0.5 shrink-0',
            tone === 'good' && 'text-good',
            tone === 'warning' && 'text-warning',
            tone === 'neutral' && 'text-ink-muted',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ink">{step.label}</span>
            <Badge tone={tone}>{STATE_LABEL[step.state]}</Badge>
            {isNext && <Badge tone="brand">Next</Badge>}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-secondary">{step.finding}</span>
        </span>
        {hasDetail &&
          (open ? (
            <ChevronDown size={13} className="mt-1 shrink-0 text-ink-muted" />
          ) : (
            <ChevronRight size={13} className="mt-1 shrink-0 text-ink-muted" />
          ))}
      </button>

      {open && hasDetail && (
        <div className="mt-2 space-y-2 pl-[26px]">
          <p className="text-[11px] italic leading-relaxed text-ink-muted">{step.question}</p>
          {step.blockedBy && step.blockedBy.length > 0 && (
            <p className="text-[11px] leading-relaxed text-ink-secondary">
              <span className="font-semibold uppercase tracking-wide text-ink-muted">Waiting on</span>{' '}
              {step.blockedBy.map((k) => stepsByKey.get(k)?.label ?? k).join(', ')}
            </p>
          )}
          {step.needs.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
              <span className="font-semibold uppercase tracking-wide">Needs</span>
              {step.needs.map((k) => (
                <Badge key={k} tone="neutral">
                  {DOCUMENT_KIND_LABEL[k]}
                </Badge>
              ))}
            </p>
          )}
          {step.citation && (
            <p className="text-[11px] leading-relaxed text-ink-muted">
              <span className="font-semibold uppercase tracking-wide">Tested against</span> {step.citation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PlaybookCard({ run }: { run: PlaybookRun }) {
  const stepsByKey = new Map(run.steps.map((s) => [s.key, s]));
  const blocked = run.steps.filter((s) => s.state === 'blocked').length;
  const evaluable = run.steps.filter((s) => s.state !== 'not_applicable' && s.state !== 'blocked').length;

  return (
    <Card>
      <CardHeader
        title={run.label}
        subtitle={run.authorityContext}
        action={<Badge tone={VERDICT_TONE[run.verdict]}>{run.verdict}</Badge>}
      />
      <CardBody>
        <div className="mb-3 flex items-center gap-3">
          <ProgressBar value={Math.round(run.progressPct)} tone={VERDICT_TONE[run.verdict]} className="flex-1" />
          <span className="tabular shrink-0 text-[11px] text-ink-muted">
            {Math.round(run.progressPct)}% of {evaluable} checkable step{evaluable === 1 ? '' : 's'}
            {blocked > 0 && ` · ${blocked} gated`}
          </span>
        </div>
        {/*
         * The sequence before the detail.
         *
         * A percentage says how far through; it does not say where it stopped
         * or why the four steps after that are empty. The track shows the
         * gate — which is the part of this product that is actually hard to
         * copy — and the rows below stay for the finding on each step.
         */}
        <div className="mb-3">
          <PlaybookTrack run={run} />
        </div>
        {run.steps.map((s) => (
          <StepRow key={s.key} step={s} stepsByKey={stepsByKey} isNext={s.key === run.nextStepKey} />
        ))}
      </CardBody>
    </Card>
  );
}

export function PlaybookPanel({ runs }: { runs: PlaybookRun[] }) {
  if (runs.length === 0) return null;
  const gated = runs.reduce((n, r) => n + r.steps.filter((s) => s.state === 'blocked').length, 0);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Diligence procedures</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">
          The sequence a practitioner actually follows here, with its gates enforced.
          {gated > 0 && (
            <>
              {' '}
              {gated} step{gated === 1 ? ' is' : 's are'} gated — not failed, but not answerable until an
              earlier step clears.
            </>
          )}
        </p>
      </div>
      {runs.map((r) => (
        <PlaybookCard key={r.playbookId} run={r} />
      ))}
    </div>
  );
}
