import { useEffect, useMemo, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { papersInHand, type DdProject } from '@realytica/shared';
import { forgetReading, readingProgress, readingRemembered, type ReadingRemembered } from '../../lib/reading-pending';
import { AiMark } from '../ui/kit';

/** How often the project is read again while papers are still on their way. */
const LOOK_AGAIN_MS = 4000;

/**
 * Papers still being read, said on the page that came back.
 *
 * A reload or a closed tab does not stop the server reading what was
 * dropped. This says so, with how many have landed, and lists each paper as
 * it arrives: the ones on file by their title, the ones still being read by
 * the file's name. It reads the project again every few seconds until the
 * last one lands, then says they are all read and can be closed.
 *
 * `live` is a reading this page is still listening to: the reading desk is
 * showing it, so this stays out of the way.
 */
export function ReadingContinues({ project, refresh, live, onOpenPaper }: { project: DdProject; refresh: () => Promise<unknown> | void; live: boolean; onOpenPaper: (evidenceId: string) => void }) {
  const [remembered, setRemembered] = useState<ReadingRemembered | null>(() => readingRemembered(project.id));
  // A drop made on this page is remembered as it is sent: the note is read again when the live reading starts or ends.
  useEffect(() => {
    setRemembered(readingRemembered(project.id));
  }, [project.id, live]);

  const progress = useMemo(() => (remembered ? readingProgress(remembered, project.evidence) : null), [remembered, project.evidence]);
  // What the record itself says is still on its way, whoever dropped it and from which machine: papers being read now,
  // and papers a reading left behind unread. This browser's own note of a drop says the same thing sooner, and wins.
  const inHand = useMemo(() => papersInHand(project), [project]);
  const others = remembered && progress && !progress.stale ? { reading: [], unread: [] } : inHand;
  const waiting = Boolean((progress && !progress.done && !progress.stale && !live) || (others.reading.length && !live));

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void refresh(), LOOK_AGAIN_MS);
    return () => window.clearInterval(timer);
  }, [waiting, refresh]);

  // Too long ago to still be on its way: the note is dropped, and the page says nothing of it.
  useEffect(() => {
    if (progress?.stale) {
      forgetReading(project.id);
      setRemembered(null);
    }
  }, [progress?.stale, project.id]);

  if (live) return null;
  if (!remembered || !progress || progress.stale) {
    if (!others.reading.length && !others.unread.length) return null;
    return (
      <section aria-label="Papers being read" aria-live="polite" className="mb-3 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-ai/25">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <AiMark size="xs" busy={others.reading.length > 0} />
          <p className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
            {others.reading.length ? 'Reading continues' : 'Not read yet'}
            <span className="ml-1.5 font-normal text-ink-secondary">
              {others.reading.length
                ? `${others.reading.length === 1 ? '1 paper is' : `${others.reading.length} papers are`} still being read. You can leave this page; each arrives as it is read.`
                : `${others.unread.length === 1 ? '1 paper was' : `${others.unread.length} papers were`} dropped and not read. Ask in the chat to read the filed documents.`}
            </span>
          </p>
        </div>
        <ul className="divide-y divide-hairline border-t border-hairline">
          {[...others.reading.map((paper) => ({ paper, said: 'being read' })), ...others.unread.map((paper) => ({ paper, said: 'not read yet' }))].map(({ paper, said }) => (
            <li key={paper.storageKey} className="flex items-center gap-2.5 px-3 py-2">
              <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{paper.fileName}</span>
              <span className="shrink-0 text-[12px] text-ink-muted">{said}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const close = () => {
    forgetReading(project.id);
    setRemembered(null);
  };
  return (
    <section aria-label="Papers being read" aria-live="polite" className="mb-3 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-ai/25">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <AiMark size="xs" busy={!progress.done} />
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {progress.done ? `All ${progress.total === 1 ? 'read' : `${progress.total} papers read`}` : 'Reading continues'}
          <span className="ml-1.5 font-normal text-ink-secondary">
            {progress.done ? 'Each is on file.' : `${progress.landed.length} of ${progress.total} on file. You can leave this page; the rest arrive as they are read.`}
          </span>
        </p>
        {progress.done ? (
          <button type="button" onClick={close} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink coarse:size-11">
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {progress.landed.map((paper) => (
          <li key={paper.evidenceId} className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{paper.title}</span>
            <button type="button" onClick={() => onOpenPaper(paper.evidenceId)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11">
              Open
            </button>
          </li>
        ))}
        {progress.reading.map((name, n) => (
          <li key={`${name}-${n}`} className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{name}</span>
            <span className="shrink-0 text-[12px] text-ink-muted">being read</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
