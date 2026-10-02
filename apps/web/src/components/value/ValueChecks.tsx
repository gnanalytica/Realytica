import { useState } from 'react';
import type { ComplianceVerdict, Rule8Summary, ValueCheck } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, Why, cn } from '../ui/kit';
import type { Tone } from '../ui/kit';

const VERDICT_WORD: Record<ComplianceVerdict, string> = { blocker: 'Blocker', attention: 'Look at', unknown: 'Not known', clear: 'Clear' };
const VERDICT_TONE: Record<ComplianceVerdict, Tone> = { blocker: 'critical', attention: 'warning', unknown: 'neutral', clear: 'good' };
const RULE8_TONE = { stated: 'good', partial: 'warning', missing: 'critical' } as const;
const RULE8_WORD = { stated: 'Stated', partial: 'Partial', missing: 'Missing' } as const;

/**
 * The checks on the figure: the state's own title rules, and the ones a lender
 * adds before it lends against a valuation — then IBBI's report contents.
 *
 * What needs a person comes first and stays open; what came back clear folds
 * into one line, because nine green rows above the one amber one is how the
 * amber one gets missed.
 */
export function ValueChecks({
  checks,
  rule8,
  revealed,
  screenedAt,
  state,
}: {
  checks: ValueCheck[];
  rule8: Rule8Summary | null;
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
    <Card>
      <CardHeader
        title="Compliance"
        subtitle={
          screenedAt
            ? `${state ?? 'State'} title rules, checked ${new Date(screenedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}, and a lender’s own checks`
            : 'A lender’s own checks. The state’s title rules run with “Value this property”.'
        }
        action={
          <div className="flex flex-wrap items-center gap-1">
            {count('blocker') ? <Badge tone="critical">{count('blocker')} blocker{count('blocker') === 1 ? '' : 's'}</Badge> : null}
            {count('attention') ? <Badge tone="warning">{count('attention')} to look at</Badge> : null}
            {count('unknown') ? <Badge tone="neutral">{count('unknown')} not known</Badge> : null}
            {clear.length ? <Badge tone="good">{clear.length} clear</Badge> : null}
          </div>
        }
      />
      <CardBody className="space-y-3 p-0">
        {checks.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-secondary">Nothing to check yet: no documents, no map read, no figure.</p>
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

        <div className="border-t border-hairline px-4 pb-3 pt-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-ink">IBBI Rule 8(3) report contents</p>
            {rule8 ? (
              <span className="font-mono text-mini tabular-nums text-ink-secondary">
                {rule8.stated} of {rule8.total} stated
                {rule8.partial ? ` · ${rule8.partial} partial` : ''}
                {rule8.missing ? ` · ${rule8.missing} missing` : ''}
              </span>
            ) : (
              <span className="text-mini text-ink-muted">With the valuation</span>
            )}
          </div>
          {rule8 ? (
            <>
              <div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden>
                {rule8.rows.map((row) => (
                  <span key={row.item} className={cn('h-full flex-1', row.status === 'stated' ? 'bg-good' : row.status === 'partial' ? 'bg-warning' : 'bg-critical/60')} />
                ))}
              </div>
              <Why label="Item by item">
                <p>{rule8.say}</p>
                <ul className="mt-1 space-y-1">
                  {rule8.rows.map((row) => (
                    <li key={row.item} className="grid grid-cols-[3rem_4.75rem_minmax(0,1fr)] items-baseline gap-2">
                      <span className="font-mono text-micro text-ink-muted">{row.clause}</span>
                      <Badge tone={RULE8_TONE[row.status]}>{RULE8_WORD[row.status]}</Badge>
                      <span className="min-w-0">
                        <span className={row.status === 'missing' ? 'text-ink-muted' : 'text-ink'}>{row.says}</span>
                        {row.note ? <span className="block text-micro text-ink-muted">{row.note}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </Why>
            </>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Checks folded into one line: the ones nothing on the file could answer, and
 * the ones that came back clear. Both matter and neither needs a person right
 * now, and a column of either above the one that does is how it gets missed.
 */
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
