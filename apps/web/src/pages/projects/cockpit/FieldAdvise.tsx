import { Check, X } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  SCOPE_LABEL,
  portalForCheck,
  portalObtainLine,
  type CheckAdvise,
  type CheckInstance,
  type ScopeInstance,
} from '@realytica/shared';
import { Badge, Button, cn } from '../../../components/ui/kit';
import { checkTone } from '../shared';

export function FieldAdvise({
  check,
  scope,
  assessmentName,
  advise,
  quotes,
  pending,
  busy,
  onTick,
  onCross,
  onDetails,
}: {
  check: CheckInstance;
  scope: ScopeInstance;
  assessmentName: string;
  advise: CheckAdvise;
  quotes: Array<{ text: string; page?: number }>;
  pending?: boolean;
  busy?: boolean;
  onTick?: () => void;
  onCross?: () => void;
  onDetails?: () => void;
}) {
  const lean = advise.lean;
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[12px] text-ink-muted">
          {SCOPE_LABEL[scope.scopeKey]} · {assessmentName}
        </p>
        <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-ink">{check.title}</p>
        <div className="mt-1">
          <Badge tone={checkTone(check.result)}>{CHECK_RESULT_LABEL[check.result]}</Badge>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-secondary">{check.purpose}</p>
        {check.expectedEvidence.length ? (
          <p className="mt-1 text-[11.5px] text-ink-muted">Expected: {check.expectedEvidence.join(', ')}</p>
        ) : null}
      </div>
      {(() => {
        const portal = portalForCheck(check);
        if (!portal) return null;
        return (
          <div className="rounded-md bg-sunken px-2.5 py-2 ring-1 ring-inset ring-[var(--ring)]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Obtain on this sitting</p>
            {portal.url ? (
              <a
                href={portal.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block text-[12.5px] font-medium text-brand hover:underline"
              >
                {portal.label}
              </a>
            ) : (
              <p className="mt-0.5 text-[12.5px] font-medium text-ink">{portal.label}</p>
            )}
            <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{portalObtainLine(portal)}</p>
          </div>
        );
      })()}
      {quotes.length ? (
        <div className="space-y-1 rounded-md bg-sunken px-2 py-1.5">
          {quotes.slice(0, 3).map((q, i) => (
            <p key={i} className="text-[11.5px] leading-relaxed text-ink">
              “{q.text}”{q.page ? <span className="text-ink-muted"> · p.{q.page}</span> : null}
            </p>
          ))}
        </div>
      ) : null}
      <div
        className={cn(
          'rounded-lg px-2.5 py-2 ring-1 ring-inset',
          lean === 'tick' && 'bg-brand-soft/60 ring-brand/25',
          lean === 'cross' && 'bg-sunken ring-[var(--ring)]',
          lean === 'none' && 'bg-sunken ring-[var(--ring)]',
        )}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          {lean === 'tick' ? 'Lean tick' : lean === 'cross' ? 'Lean cross' : 'Advise'}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink">{advise.why}</p>
        <p className="mt-1 text-[11px] text-ink-muted">You close the check. This is not a model verdict.</p>
      </div>
      {pending && onTick && onCross ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={lean === 'tick' ? 'primary' : 'secondary'}
            disabled={busy}
            icon={<Check size={13} />}
            onClick={onTick}
            aria-label="Record compliant"
          >
            Tick
          </Button>
          <Button
            size="sm"
            variant={lean === 'cross' ? 'primary' : 'secondary'}
            disabled={busy}
            icon={<X size={13} />}
            onClick={onCross}
            aria-label="Record missing evidence"
          >
            Cross
          </Button>
          {onDetails ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDetails}>
              More
            </Button>
          ) : null}
        </div>
      ) : onDetails ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDetails}>
          Open the full field
        </Button>
      ) : null}
    </div>
  );
}

export function TickCrossButtons({
  lean,
  busy,
  onTick,
  onCross,
}: {
  lean?: CheckAdvise['lean'];
  busy?: boolean;
  onTick: () => void;
  onCross: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Record compliant"
        title="Tick — compliant"
        disabled={busy}
        onClick={onTick}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset hover:bg-sunken disabled:opacity-50',
          lean === 'tick' ? 'bg-brand-soft text-brand ring-brand/30' : 'text-ink-secondary ring-[var(--ring)]',
        )}
      >
        <Check size={13} />
      </button>
      <button
        type="button"
        aria-label="Record missing evidence"
        title="Cross — missing evidence"
        disabled={busy}
        onClick={onCross}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset hover:bg-sunken disabled:opacity-50',
          lean === 'cross' ? 'bg-sunken text-ink ring-[var(--ring)]' : 'text-ink-secondary ring-[var(--ring)]',
        )}
      >
        <X size={13} />
      </button>
    </div>
  );
}
