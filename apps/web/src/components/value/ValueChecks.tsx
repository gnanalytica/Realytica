import { useState } from 'react';
import type { ComplianceVerdict, ValueCheck } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, Why, type Tone } from '../ui/kit';

const VERDICT_WORD: Record<ComplianceVerdict, string> = { blocker: 'Blocker', attention: 'Look at', unknown: 'Not known', clear: 'Clear' };
const VERDICT_TONE: Record<ComplianceVerdict, Tone> = { blocker: 'critical', attention: 'warning', unknown: 'neutral', clear: 'good' };

/**
 * State title rules and a lender’s checks on the figure.
 *
 * IBBI Rule 8 lives in ValueRule8 — kept apart so compliance stays scannable.
 */
export function ValueChecks({
  checks,
  revealed,
  screenedAt,
  state,
}: {
  checks: ValueCheck[];
  /** How many rows have arrived, while the page is filling. Null: all of them. */
  revealed: number | null;
  /** When the state's title checks last ran. */
  screenedAt?: string;
  state?: string;
}) {
  const open = checks.filter((c) => c.verdict === 'blocker' || c.verdict === 'attention');
  const unknown = checks.filter((c) => c.verdict === 'unknown');
  const clear = checks.filter((c) => c.verdict === 'clear');
  const count = (v: ComplianceVerdict) => checks.filter((c) => c.verdict === v).length;
  const visible = (i: number) => revealed === null || i < revealed;

  return (
    <div id="value-compliance" className="scroll-mt-3">
    <Card>
      <CardHeader
        title="Compliance"
        subtitle={
          screenedAt
            ? `${state ?? 'State'} · ${new Date(screenedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
            : 'State + lender'
        }
        action={
          <div className="flex flex-wrap items-center gap-1">
            {count('blocker') ? <Badge tone="critical">{count('blocker')}</Badge> : null}
            {count('attention') ? <Badge tone="warning">{count('attention')}</Badge> : null}
            {count('unknown') ? <Badge tone="neutral">{count('unknown')}</Badge> : null}
            {clear.length ? <Badge tone="good">{clear.length}</Badge> : null}
          </div>
        }
      />
      <CardBody className="space-y-3 p-0">
        {checks.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-muted">Run Value this property.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {open.map((c, i) => (visible(i) ? <CheckRow key={c.key} check={c} /> : <PendingRow key={c.key} />))}
            {revealed === null || revealed >= open.length ? (
              <>
                <Folded checks={unknown} say="not established" />
                <Folded checks={clear} say="clear" />
              </>
            ) : null}
          </ul>
        )}
      </CardBody>
    </Card>
    </div>
  );
}

function Folded({ checks, say }: { checks: ValueCheck[]; say: string }) {
  const [open, setOpen] = useState(false);
  if (!checks.length) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-2 px-4 py-2 text-left text-[12px] text-ink-secondary hover:bg-sunken"
      >
        <span className="min-w-0">
          <span className="font-medium text-ink">
            {checks.length} {say}
          </span>
          {': '}
          {checks.slice(0, 3).map((c) => c.label.toLowerCase()).join(', ')}
          {checks.length > 3 ? ` and ${checks.length - 3} more` : ''}
        </span>
        <span className="shrink-0 text-brand">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {checks.map((c) => (
            <CheckRow key={c.key} check={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CheckRow({ check }: { check: ValueCheck }) {
  return (
    <li className="animate-fade-in px-4 py-2">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2">
        <Badge tone={VERDICT_TONE[check.verdict]} className="justify-center">
          {VERDICT_WORD[check.verdict]}
        </Badge>
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
            <span className="min-w-0 font-medium text-ink">{check.label}</span>
            <span className="text-[12px] text-ink-secondary">{check.headline}</span>
          </p>
          <Why label={check.group === 'state' ? 'The rule' : 'What was read'}>
            <p>{check.detail}</p>
            <p className="text-micro text-ink-muted">{check.source}</p>
          </Why>
        </div>
      </div>
    </li>
  );
}

function PendingRow() {
  return (
    <li className="px-4 py-2.5" aria-hidden>
      <div className="relative h-3 w-2/3 overflow-hidden rounded bg-sunken">
        <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-provenance/10 to-transparent" />
      </div>
    </li>
  );
}
