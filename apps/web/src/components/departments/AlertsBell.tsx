import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Info, X, XCircle } from 'lucide-react';
import { openAlerts, type DdProject, type ProjectAlert } from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { AnimatePresence, EASE_ENTER, Stagger, StaggerItem, motion } from '../../lib/motion';
import { Modal, cn, toneChip, useToast } from '../ui/kit';

const TONE: Record<ProjectAlert['severity'], 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

const ICON: Record<ProjectAlert['severity'], typeof Info> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * What someone on the project should hear about without looking: approvals
 * expiring or lapsed, certified reports to revisit, work logged before it is
 * allowed, late milestones, serious issues from site. Unread ones are counted
 * on the bell; opening one takes you to the workstream it is about.
 *
 * It also carries what waits for a decision (values read from documents, what
 * the copilot proposed), as one row at the head of the list with the way to
 * walk through them. That used to be a pill of its own in the project bar,
 * with a count that ran to the hundreds; here it is one more thing that needs
 * attention, in the place for things that do.
 */
export function AlertsBell({
  project,
  onChanged,
  onOpenWorkstream,
  review,
}: {
  project: DdProject;
  onChanged: (p: DdProject) => void;
  onOpenWorkstream: (workstream: string) => void;
  /** How many things wait for a decision, and the way to the next one. */
  review?: { count: number; onGo: () => void };
}) {
  const me = useMe();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const alerts = useMemo(() => openAlerts(project), [project]);
  const reader = me?.email?.toLowerCase() ?? '';
  const unread = alerts.filter((a) => !a.readBy.includes(reader));

  async function markRead(ids: string[] | 'all') {
    try {
      const res = await workspaceApi.readAlerts(project.id, ids);
      onChanged({ ...project, alerts: (project.alerts ?? []).map((a) => res.alerts.find((x) => x.id === a.id) ?? a) });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not mark them read', 'critical');
    }
  }

  const sheet = useMediaQuery('(max-width: 639px)');
  const toReview = review?.count ?? 0;

  const reviewRow =
    review && toReview > 0 ? (
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          review.onGo();
        }}
        className="group mb-1 flex w-full items-center gap-3 rounded-xl bg-ai/10 px-2.5 py-2.5 text-left ring-1 ring-inset ring-ai/25 transition-colors duration-quick hover:bg-ai/15 coarse:min-h-11"
      >
        <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-ai px-1.5 font-mono text-[11px] font-semibold tabular-nums text-white" aria-hidden>
          {toReview}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">{toReview === 1 ? 'One thing waits for your review' : `${toReview} things wait for your review`}</span>
          <span className="block text-[12px] leading-snug text-ink-secondary">Values read from documents, and what the copilot proposed.</span>
        </span>
        <ArrowRight size={14} aria-hidden className="shrink-0 text-ai-ink transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
      </button>
    ) : null;

  const list =
    alerts.length === 0 ? (
      reviewRow ? null : <p className="px-2 py-6 text-center text-[13px] text-ink-secondary">Nothing needs attention.</p>
    ) : (
      <Stagger as="ul" className="max-h-[60vh] space-y-0.5 overflow-y-auto">
        {alerts.map((a) => {
          const isUnread = !a.readBy.includes(reader);
          const Icon = ICON[a.severity];
          return (
            <StaggerItem as="li" key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (isUnread) void markRead([a.id]);
                  if (a.workstream) onOpenWorkstream(a.workstream);
                }}
                className="group flex w-full gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-quick hover:bg-sunken coarse:min-h-11"
              >
                <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', toneChip(TONE[a.severity]))} aria-hidden>
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('flex items-center gap-1.5 text-[13px] text-ink', isUnread && 'font-semibold')}>
                    {isUnread ? <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
                    {a.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-secondary">{a.detail}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-muted">{when(a.raisedAt)}</span>
              </button>
            </StaggerItem>
          );
        })}
      </Stagger>
    );

  const header = (
    <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
      {/* A sheet names itself in its own header; only the dropdown needs the word here. */}
      <p className="flex-1 text-[13px] font-semibold text-ink">
        {sheet ? null : 'Alerts'} {alerts.length ? <span className={cn('font-mono text-[11px] font-medium text-ink-muted', !sheet && 'ml-1')}>{alerts.length} open</span> : null}
      </p>
      {unread.length ? (
        <button type="button" onClick={() => void markRead('all')} className="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11">
          Mark all read
        </button>
      ) : null}
      {sheet ? null : (
        <button type="button" onClick={() => setOpen(false)} aria-label="Close alerts" className="rounded-md p-1 text-ink-muted hover:bg-sunken">
          <X size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={[unread.length ? `${unread.length} unread alerts` : 'Alerts', toReview ? `${toReview} to review` : ''].filter(Boolean).join(', ')}
        aria-expanded={open}
        className={cn(
          'relative grid size-8 place-items-center rounded-lg text-ink-secondary transition-colors duration-quick hover:bg-sunken hover:text-ink coarse:size-11',
          open && 'bg-sunken text-ink',
        )}
      >
        {/* A new alert rings the bell once; the count is a figure, not a siren. */}
        <motion.span
          key={unread.length}
          className="grid place-items-center"
          initial={unread.length ? { rotate: 0 } : false}
          animate={unread.length ? { rotate: [0, -14, 11, -7, 4, 0] } : { rotate: 0 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
          style={{ transformOrigin: '50% 10%' }}
        >
          <Bell size={16} />
        </motion.span>
        {unread.length ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-critical px-1 text-center font-mono text-[10px] font-semibold leading-[1.1rem] text-white ring-2 ring-surface tabular-nums">
            {unread.length}
          </span>
        ) : toReview ? (
          // Nothing unread, but something waits: the copilot's blue, as a dot and never a count.
          <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-ai ring-2 ring-surface" />
        ) : null}
      </button>
      {sheet ? (
        <Modal open={open} onClose={() => setOpen(false)} title="Alerts">
          <div className="-mx-2 -mt-2">
            {header}
            {reviewRow}
            {list}
          </div>
        </Modal>
      ) : (
        <AnimatePresence>
          {open ? (
            <>
              <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: EASE_ENTER }}
                className="absolute right-0 top-full z-40 mt-2 w-[min(26rem,92vw)] origin-top-right rounded-2xl bg-surface p-2 shadow-pop ring-1 ring-[var(--ring)]"
              >
                {header}
                {reviewRow}
                {list}
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      )}
    </div>
  );
}
