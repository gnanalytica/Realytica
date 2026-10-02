import { useMemo } from 'react';
import { CheckCircle2, CircleDashed, Clock, ShieldCheck, ShieldX, XCircle } from 'lucide-react';
import {
  APPROVAL_STATUS_LABEL,
  SUB_STAGE_LABEL,
  approvalsRegister,
  constructionGate,
  type ApprovalLine,
  type ApprovalStatus,
  type DdProject,
} from '@realytica/shared';
import { Badge, InfoTip, TONE_FILL, cn, toneChip, type Tone } from '../ui/kit';
import { EASE_ENTER, Stagger, StaggerItem, motion } from '../../lib/motion';

/** 2397 days → "6 years": a lapse reads in the unit it is felt in. */
function since(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${Math.floor(days / 365.25)} years`;
}

const STATUS_TONE: Record<ApprovalStatus, Tone> = {
  in_force: 'good',
  expiring: 'warning',
  expired: 'critical',
  // Orange rather than red: a lapsed approval and one never obtained are both
  // blockers, and the bar above has to tell them apart.
  missing: 'serious',
  not_yet_due: 'neutral',
  if_applicable: 'neutral',
};

const STATUS_ICON: Record<ApprovalStatus, typeof CheckCircle2> = {
  in_force: CheckCircle2,
  expiring: Clock,
  expired: XCircle,
  missing: XCircle,
  not_yet_due: CircleDashed,
  if_applicable: CircleDashed,
};

function day(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/**
 * How much of an approval's life is behind it, drawn.
 *
 * Issue on the left, expiry on the right, today as a tick: a lapsed NOC is a
 * bar run out, one with months left is a bar nearly full. Only drawn where
 * the document gives both dates — a validity nobody has read is said in
 * words, not sketched.
 */
function ValidityTrack({ line }: { line: ApprovalLine }) {
  const held = line.held.find((h) => h.issuedOn && h.validUntil);
  if (!held) {
    const until = line.held.map((h) => h.validUntil).find(Boolean);
    return <span className="font-mono text-[12px] text-ink-secondary">{until ? day(until) : line.held.length ? 'No expiry stated' : '—'}</span>;
  }
  const start = Date.parse(held.issuedOn!);
  const end = Date.parse(held.validUntil!);
  const now = Date.now();
  const span = Math.max(1, end - start);
  const elapsed = Math.max(0, Math.min(1, (now - start) / span));
  const lapsed = now > end;
  return (
    <div className="min-w-[8rem]">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]">
        <motion.span
          className={cn('absolute inset-y-0 left-0 rounded-full', lapsed ? 'bg-critical' : elapsed > 0.85 ? 'bg-warning' : 'bg-good')}
          initial={{ width: 0 }}
          animate={{ width: `${elapsed * 100}%` }}
          transition={{ duration: 0.7, ease: EASE_ENTER }}
        />
      </div>
      <div className="mt-1 flex justify-between gap-2 font-mono text-[11px] text-ink-muted">
        <span>{new Date(start).getFullYear()}</span>
        <span className={cn(lapsed && 'font-medium text-critical')}>{day(held.validUntil)}</span>
      </div>
    </div>
  );
}

/** The two things construction waits on, as two checkpoints with their state. */
function ConstructionGate({ lines }: { lines: ApprovalLine[] }) {
  const need = ['plan_sanction', 'commencement'].map((key) => lines.find((l) => l.kind.key === key)).filter((l): l is ApprovalLine => Boolean(l));
  const open = need.every((l) => l.status === 'in_force' || l.status === 'expiring');
  const Icon = open ? ShieldCheck : ShieldX;
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl p-4 shadow-card ring-1 ring-inset',
        open ? 'bg-surface ring-good/30' : 'bg-surface ring-critical/25',
      )}
    >
      <span aria-hidden className={cn('pointer-events-none absolute inset-0', open ? 'bg-grad-good' : 'bg-grad-critical')} />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3">
        <motion.span
          className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', toneChip(open ? 'good' : 'critical'))}
          initial={{ rotate: -12, scale: 0.7, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 20 }}
          aria-hidden
        >
          <Icon size={22} />
        </motion.span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[15px] font-semibold tracking-tight text-ink">{open ? 'Construction may proceed' : 'Construction is not cleared to start'}</p>
          <p className="text-[13px] text-ink-secondary">
            {open ? 'The plan sanction and the commencement certificate are on file.' : 'Work logged from site before both are in hand is flagged.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {need.map((l) => {
            const ok = l.status === 'in_force' || l.status === 'expiring';
            const Mark = ok ? CheckCircle2 : XCircle;
            return (
              <span key={l.kind.key} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium', toneChip(ok ? 'good' : 'critical'))}>
                <Mark size={13} aria-hidden />
                {l.kind.label}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Where the register stands, as one bar: what is in force, running out, lapsed, missing, not yet due. */
function Composition({ lines }: { lines: ApprovalLine[] }) {
  const parts: Array<{ key: string; label: string; n: number; tone: Tone }> = [
    { key: 'in_force', label: 'In force', n: lines.filter((l) => l.status === 'in_force').length, tone: 'good' },
    { key: 'expiring', label: 'Expiring', n: lines.filter((l) => l.status === 'expiring').length, tone: 'warning' },
    { key: 'expired', label: 'Lapsed', n: lines.filter((l) => l.status === 'expired').length, tone: 'critical' },
    { key: 'missing', label: 'Missing', n: lines.filter((l) => l.status === 'missing').length, tone: 'serious' },
    { key: 'later', label: 'Not yet due or if applicable', n: lines.filter((l) => l.status === 'not_yet_due' || l.status === 'if_applicable').length, tone: 'neutral' },
  ];
  const total = Math.max(1, lines.length);
  return (
    <div className="space-y-2 px-4 pt-3">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts
          .filter((p) => p.n > 0)
          .map((p, i) => (
            <motion.span
              key={p.key}
              className={cn('h-full origin-left rounded-full', TONE_FILL[p.tone])}
              style={{ width: `${(p.n / total) * 100}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.45, ease: EASE_ENTER, delay: 0.1 + i * 0.08 }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-secondary">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', TONE_FILL[p.tone])} aria-hidden />
              {p.label}
              <span className="font-mono font-medium text-ink">{p.n}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * Every sanction, clearance and NOC the project needs, in the order the
 * project needs them, with what is on file for each: who issued it, its
 * reference, when, and until when. Read from the documents in the vault — a
 * fire NOC filed is a fire NOC held — and from the stage the project is at,
 * which decides what should already be in hand.
 *
 * A table on a wide pane and a stack of cards on a narrow one, from the same
 * rows: the columns are a grid that collapses rather than a table that
 * scrolls sideways under a thumb.
 */
export function ApprovalsRegister({ project, onOpenDocument }: { project: DdProject; onOpenDocument: (evidenceId: string) => void }) {
  const lines = useMemo(() => approvalsRegister(project), [project]);
  const held = lines.filter((l) => l.held.length).length;
  const attention = lines.filter((l) => l.status === 'missing' || l.status === 'expired' || l.status === 'expiring').length;
  const row = '[@container(min-width:46rem)]:grid [@container(min-width:46rem)]:grid-cols-[minmax(0,1.3fr)_8.5rem_minmax(0,1.5fr)_9rem_6.5rem] [@container(min-width:46rem)]:items-start [@container(min-width:46rem)]:gap-3';

  return (
    <div className="space-y-4">
      <ConstructionGate lines={lines} />
      <section className="overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-[var(--ring)]">
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[13px] font-semibold text-ink">Approvals register</h2>
                <InfoTip label="What each approval needs is read from its document: the issuing authority, the reference, the date and the validity. An approval is expected once the project reaches the step it is needed by." />
              </div>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {held} of {lines.length} on file{attention ? ` · ${attention} need attention` : ''}
              </p>
            </div>
          </div>
        </header>
        <Composition lines={lines} />
        <div className={cn('mt-3 hidden border-y border-hairline bg-sunken/50 px-4 py-2 text-[11px] font-medium text-ink-muted', '[@container(min-width:46rem)]:grid', row.replace(/\[@container\(min-width:46rem\)\]:grid /, ''))}>
          <span>Approval</span>
          <span>Status</span>
          <span>On file</span>
          <span>Validity</span>
          <span>Needed by</span>
        </div>
        <Stagger as="ul" className="divide-y divide-hairline">
          {lines.map((line) => {
            const tone = STATUS_TONE[line.status];
            const Icon = STATUS_ICON[line.status];
            const quiet = line.status === 'if_applicable' && !line.held.length;
            return (
              <StaggerItem as="li" key={line.kind.key} className={cn('px-4 py-3 transition-colors duration-quick hover:bg-sunken/40', row, quiet && 'opacity-70')}>
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg', toneChip(tone))} aria-hidden>
                    <Icon size={13} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{line.kind.label}</p>
                    <p className="text-micro text-ink-muted">{line.kind.authority}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-[2.125rem] [@container(min-width:46rem)]:mt-0 [@container(min-width:46rem)]:block [@container(min-width:46rem)]:pl-0">
                  <Badge tone={tone}>{APPROVAL_STATUS_LABEL[line.status]}</Badge>
                  {line.daysLeft !== null && line.status !== 'in_force' ? (
                    <p className="text-micro text-ink-muted [@container(min-width:46rem)]:mt-1">{line.daysLeft < 0 ? `${since(-line.daysLeft)} ago` : `${line.daysLeft} days left`}</p>
                  ) : null}
                </div>
                <div className="mt-2 min-w-0 pl-[2.125rem] text-[13px] [@container(min-width:46rem)]:mt-0 [@container(min-width:46rem)]:pl-0">
                  {line.held.length ? (
                    <ul className="space-y-1">
                      {line.held.map((h) => (
                        <li key={h.evidenceId} className="min-w-0">
                          <button type="button" onClick={() => onOpenDocument(h.evidenceId)} className="max-w-full truncate text-left font-medium text-brand hover:underline">
                            {h.document}
                          </button>
                          <span className="block text-micro text-ink-secondary">
                            {[h.issuedBy, h.reference, h.issuedOn ? `issued ${day(h.issuedOn)}` : null].filter(Boolean).join(' · ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-secondary">{line.say}</span>
                  )}
                </div>
                <div className="mt-2 pl-[2.125rem] [@container(min-width:46rem)]:mt-0 [@container(min-width:46rem)]:pl-0">
                  <ValidityTrack line={line} />
                </div>
                <div className="mt-1 pl-[2.125rem] text-[12px] text-ink-secondary [@container(min-width:46rem)]:mt-0 [@container(min-width:46rem)]:pl-0">
                  <span className="[@container(min-width:46rem)]:hidden">Needed by </span>
                  {SUB_STAGE_LABEL[line.kind.neededBy]}
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>
    </div>
  );
}
