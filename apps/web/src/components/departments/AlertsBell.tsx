import { useMemo, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { openAlerts, type DdProject, type ProjectAlert } from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { cn, useToast } from '../ui/kit';

const TONE: Record<ProjectAlert['severity'], string> = {
  critical: 'bg-critical',
  warning: 'bg-warning',
  info: 'bg-brand',
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread.length ? `${unread.length} unread alerts` : 'Alerts'}
        aria-expanded={open}
        className="relative rounded-lg p-1.5 text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink coarse:min-h-11 coarse:min-w-11"
      >
        <Bell size={15} />
        {unread.length ? (
          <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-critical px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white tabular-nums">
            {unread.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-[min(26rem,92vw)] rounded-xl bg-surface p-2 shadow-pop ring-1 ring-[var(--ring)]">
            <div className="flex items-center gap-2 px-2 py-1">
              <p className="flex-1 text-[13px] font-semibold text-ink">Alerts</p>
              {unread.length ? (
                <button type="button" onClick={() => void markRead('all')} className="text-[12px] text-brand hover:underline">
                  Mark all read
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close alerts" className="rounded-md p-1 text-ink-muted hover:bg-sunken">
                <X size={14} />
              </button>
            </div>
            {alerts.length === 0 ? (
              <p className="px-2 py-4 text-[13px] text-ink-secondary">Nothing needs attention. Approvals, revisits, late milestones and issues from site show here.</p>
            ) : (
              <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
                {alerts.map((a) => {
                  const isUnread = !a.readBy.includes(reader);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          if (isUnread) void markRead([a.id]);
                          if (a.workstream) onOpenWorkstream(a.workstream);
                        }}
                        className="flex w-full gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sunken"
                      >
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE[a.severity])} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-[13px] text-ink', isUnread && 'font-semibold')}>{a.title}</span>
                          <span className="block text-[12px] text-ink-secondary">{a.detail}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-muted">{when(a.raisedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
