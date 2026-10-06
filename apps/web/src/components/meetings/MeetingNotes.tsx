import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { NotebookText } from 'lucide-react';
import { meetingCalled, meetingDay, meetingOfRecord, type DdProject, type MeetingShown } from '@realytica/shared';
import { request } from '../../lib/api';
import { Modal, Spinner, cn } from '../ui/kit';

/**
 * A meeting's notes, opened from wherever something points at them: a line
 * of the chat that lists a meeting, or a decision or an action that came out
 * of one.
 *
 * Opened at an item, the notes are shown at the words that item rests on,
 * the way a value opens its paper at its page: the words are marked and
 * brought into view. The notes are read from where they are stored each time
 * they are opened. They are never part of the project the page already has.
 */

interface Opened {
  meeting: MeetingShown;
  text: string;
}

const KIND: Record<MeetingShown['items'][number]['kind'], string> = { decision: 'Decided', action: 'To do', open: 'Open' };
const STANDS: Record<MeetingShown['items'][number]['standing'], string> = { waiting: 'waiting on a card', recorded: 'on the record', set_aside: 'set aside' };

/** Letters and digits, lower case, one space between: the form words are compared in, whatever their spacing or marks. */
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether a line of the notes is among the words an item rests on. The item
 * keeps its words on one line, cut where they run long, so a line is one of
 * them when it holds the quoted words or the quoted words hold it.
 */
function restsOn(line: string, quote: string): boolean {
  const words = plain(line);
  const quoted = plain(quote.replace(/…$/, ''));
  if (!words || !quoted) return false;
  return words.includes(quoted) || (words.length >= 12 && quoted.includes(words));
}

export function MeetingNotesLink({
  meetingId,
  itemId,
  projectId: given,
  children,
  className,
}: {
  meetingId: string;
  /** The item of the notes to open them at. */
  itemId?: string;
  /** The project, where the page's own address does not say. */
  projectId?: string;
  /** What the link says. "notes" when left out. */
  children?: ReactNode;
  className?: string;
}) {
  const { projectId: fromAddress } = useParams<{ projectId: string }>();
  const projectId = given ?? fromAddress;
  const [open, setOpen] = useState(false);
  // No project to read them from: the mark is not a way to open anything here, and nothing is drawn for it.
  if (!projectId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open the notes of the meeting"
        className={cn(
          'mx-0.5 inline-flex translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink',
          className,
        )}
      >
        <NotebookText size={10} className="shrink-0" aria-hidden />
        <span>{children ?? 'notes'}</span>
      </button>
      {open ? <MeetingNotesDialog projectId={projectId} meetingId={meetingId} itemId={itemId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Beside a decision or an action that came out of a meeting: the meeting it
 * came from, as a way to open its notes at the words the record rests on.
 * Nothing for a record that came from anywhere else. `short` says only
 * "notes", for a row that already names the meeting.
 */
export function MeetingSource({ project, recordId, short }: { project: DdProject; recordId: string; short?: boolean }) {
  const from = meetingOfRecord(project, recordId);
  if (!from) return null;
  return (
    <MeetingNotesLink projectId={project.id} meetingId={from.meeting.id} itemId={from.item.id} className="mx-0">
      {short ? 'notes' : `From ${meetingCalled(from.meeting)}`}
    </MeetingNotesLink>
  );
}

function MeetingNotesDialog({ projectId, meetingId, itemId, onClose }: { projectId: string; meetingId: string; itemId?: string; onClose: () => void }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | undefined>(itemId);
  const marked = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    let gone = false;
    request<Opened>(`/projects/${projectId}/meetings/${meetingId}/notes`)
      .then((got) => {
        if (!gone) setOpened(got);
      })
      .catch((err: unknown) => {
        if (!gone) setFailed(err instanceof Error && /not found/i.test(err.message) ? 'These notes are no longer on the file.' : 'The notes could not be opened just now.');
      });
    return () => {
      gone = true;
    };
  }, [projectId, meetingId]);

  // The words the picked item rests on are brought into view, when the notes arrive and when another item is picked.
  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'center' });
  }, [opened, picked]);

  const meeting = opened?.meeting;
  const quote = meeting?.items.find((item) => item.id === picked)?.quote;
  const lines = (opened?.text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = quote ? lines.findIndex((line) => restsOn(line, quote)) : -1;

  return (
    <Modal open onClose={onClose} width="lg" title={meeting ? meeting.title : 'Notes of the meeting'}>
      {failed ? (
        <p className="text-[13px] text-ink-secondary">{failed}</p>
      ) : !meeting ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <Spinner size={14} /> Opening the notes
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {meeting.heldOn ? `Held ${meetingDay(meeting.heldOn)}` : 'The notes do not say when it was held'}
            {meeting.attendees.length ? ` · present: ${meeting.attendees.join(', ')}` : ''}
            {` · notes ${meeting.came}, kept ${meetingDay(meeting.keptAt)} by ${meeting.keptBy}`}
          </p>

          {meeting.items.length ? (
            <ul className="flex flex-col gap-1">
              {meeting.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(item.id)}
                    aria-pressed={item.id === picked}
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug ring-1 ring-inset',
                      item.id === picked ? 'bg-brand-soft text-ink ring-brand/40' : 'text-ink ring-transparent hover:bg-sunken',
                    )}
                  >
                    <span className="w-14 shrink-0 text-[12px] font-semibold text-ink-muted">{KIND[item.kind]}</span>
                    <span className="min-w-0 flex-1">
                      {item.text}
                      {item.kind === 'action' ? <span className="text-ink-secondary">{` · ${item.owner ?? 'nobody named'} · ${item.dueDate ? `due ${meetingDay(item.dueDate)}` : 'no date given'}`}</span> : null}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1 py-px text-[12px] ring-1 ring-inset',
                        item.standing === 'waiting' ? 'bg-provenance/10 text-provenance-ink ring-provenance/40' : 'text-ink-muted ring-[var(--ring)]',
                      )}
                    >
                      {STANDS[item.standing]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-secondary">Nothing in these notes was read as a decision, an action or an open point.</p>
          )}

          {opened.text.trim() ? (
            <div className="max-h-[46vh] overflow-y-auto rounded-lg bg-sunken px-3 py-2.5 ring-1 ring-inset ring-[var(--ring)]">
              {lines.map((line, at) => {
                const hit = Boolean(quote) && restsOn(line, quote!);
                return (
                  <p key={at} ref={at === first ? marked : undefined} className={cn('min-h-[1.25rem] whitespace-pre-wrap text-[13px] leading-relaxed text-ink', hit && 'rounded-[2px] bg-mark/45')}>
                    {line}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-ink-secondary">The words of these notes could not be read back from where they are kept.</p>
          )}
          {quote && first === -1 && opened.text.trim() ? <p className="text-[12px] text-ink-muted">The words this rests on: “{quote}”</p> : null}
        </div>
      )}
    </Modal>
  );
}
