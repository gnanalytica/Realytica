import { Link } from 'react-router-dom';
import type { CaseSummary } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, LIFT, cn } from '../ui/kit';
import { money, relativeTime } from '../../lib/format';

const VERDICT_TONE: Record<string, 'good' | 'warning' | 'critical' | 'neutral'> = {
  pursue: 'good',
  proceed_with_caution: 'warning',
  hold: 'warning',
  do_not_pursue: 'critical',
};

/**
 * The cases you already have, beside the conversation.
 *
 * Reopening yesterday's case is the most common thing anyone does here, and
 * making that a sentence someone has to compose would be slower than the
 * dashboard it replaced. So the rail carries them until the conversation
 * starts building one, at which point it becomes the draft instead.
 */
export function CaseRail({ cases, highlight }: { cases: CaseSummary[]; highlight?: string[] }) {
  const marked = new Set(highlight ?? []);
  const ordered = marked.size > 0 ? [...cases].sort((a, b) => Number(marked.has(b.id)) - Number(marked.has(a.id))) : cases;

  return (
    <Card>
      <CardHeader title="Your cases" action={<Badge tone="neutral">{cases.length}</Badge>} />
      <CardBody className="flex flex-col gap-1.5">
        {cases.length === 0 ? (
          <p className="text-xs text-ink-muted">Nothing yet. Describe a property and I will build the first one.</p>
        ) : (
          ordered.map((c) => (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              data-case={c.reference}
              className={cn(
                'block rounded-lg p-2.5 ring-1 ring-inset',
                LIFT,
                marked.has(c.id) ? 'bg-brand-soft ring-brand/40' : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="tabular text-mini font-medium text-ink-muted">{c.reference}</span>
                {c.verdict ? (
                  <Badge tone={VERDICT_TONE[c.verdict] ?? 'neutral'} className="ml-auto">
                    {c.verdict.replace(/_/g, ' ')}
                  </Badge>
                ) : (
                  <Badge tone="neutral" className="ml-auto">{c.status}</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] font-medium text-ink">{c.label}</p>
              <p className="text-mini text-ink-secondary">
                {c.locality}
                {typeof c.indicativeLow === 'number' && typeof c.indicativeHigh === 'number'
                  ? ` · ${money(c.indicativeLow, c.currency, { compact: true })}–${money(c.indicativeHigh, c.currency, { compact: true })}`
                  : ''}
                {c.openCriticalRisks > 0 ? ` · ${c.openCriticalRisks} critical` : ''}
              </p>
              <p className="mt-0.5 text-micro text-ink-muted">{relativeTime(c.updatedAt)}</p>
            </Link>
          ))
        )}
      </CardBody>
    </Card>
  );
}
