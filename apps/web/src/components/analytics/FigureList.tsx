import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cockpitPath, type AnalyticsFigure, type AnalyticsRow } from '@realytica/shared';
import { Badge, Modal, cn, toneText } from '../ui/kit';

/**
 * A figure and the list behind it.
 *
 * No number in the analytics stands alone: each is a count of rows, and
 * pressing it opens them. A row says the record it is read from and opens
 * that record on its project.
 */

const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

function FigureRow({ row, showProject }: { row: AnalyticsRow; showProject: boolean }) {
  return (
    <li>
      <Link to={cockpitPath(row.projectId, row.pane, row.extra)} className="flex items-start justify-between gap-3 py-2 hover:bg-sunken">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{row.title}</p>
          {row.detail ? <p className="text-[12px] text-ink-secondary">{row.detail}</p> : null}
          <p className="text-[11px] text-ink-muted">
            {showProject ? `${row.projectName} · ` : ''}From {row.source}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {row.overdue ? <Badge tone="critical">Overdue</Badge> : null}
          {row.ageDays !== undefined ? <Badge>{days(row.ageDays)}</Badge> : null}
        </div>
      </Link>
    </li>
  );
}

export function FigureModal({ title, figure, open, onClose, showProject = true }: { title: ReactNode; figure: AnalyticsFigure; open: boolean; onClose: () => void; showProject?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="lg">
      {figure.rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {figure.rows.map((row, i) => (
            <FigureRow key={`${row.projectId}:${row.title}:${i}`} row={row} showProject={showProject} />
          ))}
        </ul>
      )}
      {figure.more ? <p className="mt-3 text-[11px] text-ink-muted">{figure.more} more not shown.</p> : null}
    </Modal>
  );
}

/**
 * A figure as something to press: its number, its label, and whatever else
 * the caller puts beside them. With nothing behind it, it is plain text.
 */
export function FigureButton({
  label,
  figure,
  value,
  tone,
  title,
  showProject = true,
  className,
  children,
}: {
  label: ReactNode;
  figure: AnalyticsFigure;
  /** What to show in place of the count: a figure that is not a count of its rows. */
  value?: ReactNode;
  tone?: 'critical' | 'warning';
  /** The list's heading, when the label alone would not say what it is. */
  title?: ReactNode;
  showProject?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const empty = figure.rows.length === 0;
  const body = (
    <>
      <span className={cn('font-mono tabular-nums', empty ? 'text-ink-muted' : tone ? toneText(tone) : 'text-ink')}>{value ?? figure.count}</span>
      <span className="text-ink-secondary">{label}</span>
      {children}
    </>
  );
  if (empty) return <span className={cn('inline-flex items-baseline gap-1.5 px-2 py-1 text-[12px]', className)}>{body}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-baseline gap-1.5 rounded-lg bg-surface px-2 py-1 text-left text-[12px] ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick ease-state hover:bg-sunken coarse:min-h-11 coarse:items-center',
          className,
        )}
      >
        {body}
      </button>
      <FigureModal title={title ?? label} figure={figure} open={open} onClose={() => setOpen(false)} showProject={showProject} />
    </>
  );
}
