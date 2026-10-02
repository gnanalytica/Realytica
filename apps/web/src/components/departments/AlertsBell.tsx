import { useMemo, useState } from 'react';
import { AlertTriangle, Bell, Info, X, XCircle } from 'lucide-react';
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
 */
export function AlertsBell({ project, onChanged, onOpenWorkstream }: { project: DdProject; onChanged: (p: DdProject) => void; onOpenWorkstream: (workstream: string) => void }) {
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

  const list =
    alerts.length === 0 ? (
      <p className="px-2 py-6 text-center text-[13px] text-ink-secondary">Nothing needs attention. Approvals, revisits, late milestones and issues from site show here.</p>
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
      <p className="flex-1 text-[13px] font-semibold text-ink">
        Alerts {alerts.length ? <span className="ml-1 font-mono text-[11px] font-medium text-ink-muted">{alerts.length}</span> : null}
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
        aria-label={unread.length ? `${unread.length} unread alerts` : 'Alerts'}
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
        ) : null}
      </button>
      {sheet ? (
        <Modal open={open} onClose={() => setOpen(false)} title="Alerts">
          <div className="-mx-2 -mt-2">
            {header}
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
                {list}
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      )}
    </div>
  );
}
