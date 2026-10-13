import { useEffect, useMemo, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { papersInHand, type DdProject, type PaperInHand } from '@realytica/shared';
import { forgetReading, readingBanner, readingProgress, readingRemembered, type ReadingRemembered } from '../../lib/reading-pending';
import { workspaceApi } from '../../lib/workspace-api';
import { AiMark, useToast } from '../ui/kit';

/** How often the project is read again while papers are still on their way. */
const LOOK_AGAIN_MS = 4000;

/** The two answers to "what is it?", as the sentences the chat reads back. */
export function droppedAnswers(paper: PaperInHand): Array<{ label: string; send: string }> {
  return [
    paper.asked === 'photo' ? { label: 'A site photograph', send: `File “${paper.fileName}” as a site photograph` } : { label: 'A questionnaire', send: `Take in “${paper.fileName}” as a questionnaire` },
    { label: 'A paper to file', send: `File “${paper.fileName}” as a paper` },
  ];
}

const quiet = 'shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11';

/**
 * Papers dropped and not yet on the register, said on the page that came back.
 *
 * A reload or a closed tab does not stop the server reading what was
 * dropped. This says so, with how many have landed, and lists each paper as
 * it arrives. It reads the project again every few seconds while a paper is
 * being read, and only then.
 *
 * It says a paper is being read only while it is. A file the chat asked about
 * (a questionnaire, or a paper to file?) is shown with the two answers to
 * press, and one a reading left behind with what can be done about it. Either
 * can be set aside: it is then kept as a paper to file, said in Documents and
 * nowhere else, and this notice goes. Where everything of a drop has landed it
 * says so and can be closed.
 *
 * `live` is a reading this page is still listening to: the reading desk is
 * showing it, so this stays out of the way.
 */
export function ReadingContinues({
  project,
  refresh,
  live,
  onOpenPaper,
  onSay,
  onChanged,
}: {
  project: DdProject;
  refresh: () => Promise<unknown> | void;
  live: boolean;
  onOpenPaper: (evidenceId: string) => void;
  /** Sends a sentence to the chat: an answer to what a dropped file is. */
  onSay: (sentence: string) => void;
  onChanged: (project: DdProject) => void;
}) {
  const toast = useToast();
  const [remembered, setRemembered] = useState<ReadingRemembered | null>(() => readingRemembered(project.id));
  // A drop made on this page is remembered as it is sent: the note is read again when the live reading starts or ends.
  useEffect(() => {
    setRemembered(readingRemembered(project.id));
  }, [project.id, live]);

  const inHand = useMemo(() => papersInHand(project), [project]);
  const banner = useMemo(() => readingBanner({ remembered, evidence: project.evidence, inHand, live }), [remembered, project.evidence, inHand, live]);
  const stale = useMemo(() => Boolean(remembered && readingProgress(remembered, project.evidence).stale), [remembered, project.evidence]);

  useEffect(() => {
    if (!banner?.poll) return;
    const timer = window.setInterval(() => void refresh(), LOOK_AGAIN_MS);
    return () => window.clearInterval(timer);
  }, [banner?.poll, refresh]);

  // Too long ago to still be on its way: the note is dropped.
  useEffect(() => {
    if (stale) {
      forgetReading(project.id);
      setRemembered(null);
    }
  }, [stale, project.id]);

  if (!banner) return null;
  const close = () => {
    forgetReading(project.id);
    setRemembered(null);
  };
  const setAside = async (paper: PaperInHand) => {
    try {
      onChanged((await workspaceApi.setDroppedAside(project.id, paper.storageKey)).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set it aside', 'critical');
    }
  };
  const total = banner.landed.length + banner.reading.length;
  const said: Record<typeof banner.head, [string, string]> = {
    reading: ['Reading continues', banner.landed.length ? `${banner.landed.length} of ${total} on file. You can leave this page; the rest arrive as they are read.` : `${banner.reading.length === 1 ? '1 paper is' : `${banner.reading.length} papers are`} still being read. You can leave this page; each arrives as it is read.`],
    asked: ['Waiting for your answer', `${banner.asked.length === 1 ? 'One file was' : `${banner.asked.length} files were`} not read, because it was not clear what ${banner.asked.length === 1 ? 'it is' : 'they are'}. Say which, or set ${banner.asked.length === 1 ? 'it' : 'them'} aside to decide later in Documents.`],
    unread: ['Not read yet', `${banner.unread.length === 1 ? '1 paper was' : `${banner.unread.length} papers were`} dropped and not read.`],
    done: [banner.landed.length === 1 ? 'Read' : `All ${banner.landed.length} papers read`, 'Each is on file.'],
  };
  return (
    <section aria-label="Papers dropped" aria-live="polite" className="mb-3 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-ai/25">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <AiMark size="xs" busy={banner.head === 'reading'} />
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {said[banner.head][0]}
          <span className="ml-1.5 font-normal text-ink-secondary">{said[banner.head][1]}</span>
        </p>
        {banner.head === 'done' ? (
          <button type="button" onClick={close} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink coarse:size-11">
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {banner.landed.map((paper) => (
          <li key={paper.evidenceId} className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{paper.title}</span>
            <button type="button" onClick={() => onOpenPaper(paper.evidenceId)} className={quiet}>
              Open
            </button>
          </li>
        ))}
        {banner.reading.map((name, n) => (
          <li key={`${name}-${n}`} className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{name}</span>
            <span className="shrink-0 text-[12px] text-ink-muted">being read</span>
          </li>
        ))}
        {banner.asked.map((paper) => (
          <li key={paper.storageKey} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{paper.fileName}</span>
            {droppedAnswers(paper).map((answer) => (
              <button key={answer.send} type="button" onClick={() => onSay(answer.send)} className={quiet}>
                {answer.label}
              </button>
            ))}
            <button type="button" onClick={() => void setAside(paper)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink-secondary hover:bg-sunken coarse:min-h-11">
              Later
            </button>
          </li>
        ))}
        {banner.unread.map((paper) => (
          <li key={paper.storageKey} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{paper.fileName}</span>
            <button type="button" onClick={() => onSay('Read the filed documents')} className={quiet}>
              Read it
            </button>
            <button type="button" onClick={() => void setAside(paper)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink-secondary hover:bg-sunken coarse:min-h-11">
              Set aside
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Dropped files that are on no row and that nothing is being done with: a
 * question nobody answered in time, or a paper a person set aside. Said where
 * the papers are, with what each can still be made: this is where a question
 * about a dropped file is answered later.
 */
export function DroppedHeld({ project, onSay }: { project: DdProject; onSay: (sentence: string) => void }) {
  const held = useMemo(() => papersInHand(project).held, [project]);
  if (!held.length) return null;
  return (
    <section aria-label="Dropped and not filed" className="mb-3 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-[var(--ring)]">
      <p className="px-3 py-2.5 text-[13px] font-semibold text-ink">
        Dropped, not filed
        <span className="ml-1.5 font-normal text-ink-secondary">
          {held.length === 1 ? 'This file is' : `These ${held.length} files are`} kept and on no row yet. Say what {held.length === 1 ? 'it is' : 'each is'} to file it.
        </span>
      </p>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {held.map((paper) => (
          <li key={paper.storageKey} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{paper.fileName}</span>
            {(paper.asked ? droppedAnswers(paper) : [{ label: 'File and read it', send: `File “${paper.fileName}” as a paper` }]).map((answer) => (
              <button key={answer.send} type="button" onClick={() => onSay(answer.send)} className={quiet}>
                {answer.label}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
