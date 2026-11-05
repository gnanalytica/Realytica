import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import {
  STAGES,
  askingSaid,
  chatAskingOpen,
  chatPeriod,
  chatPlaceFrom,
  chatPlaceLabel,
  chatWaiting,
  periodLabel,
  plural,
  waitingPlaceLine,
  type ChatPlace,
  type ChatTurnPlace,
  type ChoicePin,
  type DdProject,
  type ProjectChatTurn,
  type TurnChip,
} from '@realytica/shared';
import { api } from '../../../lib/api';
import { cn } from '../../../components/ui/kit';

/** More places than this and the list folds to one line, opened on a press. */
const PLACES_SHOWN = 3;

/**
 * The top of a chat, kept in place while its thread scrolls.
 *
 * One line says where the chat is: the project, the page, the stage in view
 * and the month in play, where one is (the pack the Reports page has open,
 * or else the last month the chat asked about). Under it, what this chat
 * suggested that still waits, a line for each place as the replies say them
 * ("Legal › Title · 2 values"), each opening where it waits; and one button
 * that accepts all of it. The server reads what that is from the chat's id
 * and accepts each as accepting it where it waits would, so what is not this
 * person's to accept stays waiting and the line after says so.
 *
 * An earlier chat opened to read shows its own: where it was held, and what
 * it left waiting. Nothing waits, and only the first line shows.
 *
 * While the chat is asking for what is missing, a question at a time, the
 * strip says how far it has got ("Asking: 3 of 7") with Stop beside it.
 *
 * An outside collaborator's suggestions are the firm's to accept. Their
 * strip lists what they suggested on the sheets in their reach and says the
 * firm accepts it: there is no button that would claim they can.
 */
export function ChatStrip({
  project,
  chatId,
  turns,
  here,
  heldAt,
  reading,
  outside = false,
  busy: sending = false,
  onGo,
  onProject,
  onSay,
}: {
  project: DdProject;
  /** The chat on screen by the id the list of chats knows it by. */
  chatId?: string;
  turns: readonly ProjectChatTurn[];
  /** The page on screen. */
  here: ChatPlace;
  /** Where an earlier chat was held, for one being read. */
  heldAt?: ChatTurnPlace;
  reading: boolean;
  /** The person is an outside collaborator: what they suggest is the firm's to accept. */
  outside?: boolean;
  /** A message is on its way, so Stop waits for it. */
  busy?: boolean;
  onGo: (chip: TurnChip) => void;
  onProject: (next: DdProject) => void;
  /** Send a message to this chat as a pressed button sends one. */
  onSay?: (text: string, pin: ChoicePin) => void;
}) {
  const place = useMemo<ChatPlace>(() => (reading ? (chatPlaceFrom(heldAt) ?? {}) : here), [reading, heldAt, here]);
  const waiting = useMemo(() => chatWaiting(project, chatId, here, { outside }), [project, chatId, here, outside]);
  // The run of questions this chat is on, while one is open. Not in an earlier chat being read: that run is over.
  const askingNow = reading ? undefined : chatAskingOpen(turns);
  // An earlier chat's month is the one it asked about: the page on screen now is not where it was held.
  const period = chatPeriod(reading ? undefined : here, turns);
  const stage = STAGES.find((s) => s.key === place.stage)?.label;
  const scope = [project.name, chatPlaceLabel(place), stage, period ? periodLabel(period) : undefined].filter(Boolean).join(' · ');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the last Accept all said, for the chat it was pressed in.
  const [said, setSaid] = useState<{ chat?: string; text: string } | null>(null);
  useEffect(() => {
    setOpen(false);
    setSaid(null);
  }, [chatId]);

  const count = waiting.places.reduce((n, at) => n + at.count, 0);
  const folded = waiting.places.length > PLACES_SHOWN && !open;

  async function acceptAll(): Promise<void> {
    if (!chatId || busy) return;
    setBusy(true);
    try {
      const done = await api.acceptChatSuggestions(project.id, chatId);
      onProject(done.project);
      setSaid({ chat: chatId, text: done.said });
    } catch (e) {
      setSaid({ chat: chatId, text: e instanceof Error ? e.message : 'Nothing could be accepted.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 rounded-lg bg-sunken px-2.5 py-1.5" aria-label="This chat">
      <p className="truncate text-mini text-ink-secondary" title={scope}>
        {scope}
      </p>
      {askingNow ? (
        <div className="mt-1 flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" role="status">
            {askingSaid(askingNow)}
          </p>
          {onSay ? (
            <button
              type="button"
              onClick={() => onSay('Stop asking', { ask: { act: 'stop', run: askingNow.run, at: askingNow.at } })}
              disabled={sending}
              className={cn(
                'shrink-0 rounded-md bg-surface px-2 py-0.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken coarse:min-h-11',
                sending && 'cursor-wait opacity-60',
              )}
            >
              Stop
            </button>
          ) : null}
        </div>
      ) : null}
      {count ? (
        <div className="mt-1 flex flex-wrap items-start gap-x-3 gap-y-1">
          {folded ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={false}
              className="inline-flex min-w-0 items-center gap-1.5 text-left text-[12px] font-medium text-brand hover:underline coarse:min-h-11"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
              {plural(count, 'suggestion')} from this chat wait in {plural(waiting.places.length, 'place')}
              <ChevronDown size={12} aria-hidden className="shrink-0" />
            </button>
          ) : (
            <ul className="min-w-0 flex-1 space-y-0.5" aria-label="What this chat suggested that still waits">
              {waiting.places.map((at) => {
                const words = waitingPlaceLine(at);
                return (
                  <li key={at.key}>
                    <button
                      type="button"
                      onClick={() => onGo({ key: `strip|${at.key}`, kind: 'filed', words, open: at.open, ...(at.ids.length ? { ids: at.ids } : {}) })}
                      className="group inline-flex max-w-full items-center gap-1.5 text-left text-[12px] font-medium text-brand hover:underline coarse:min-h-11"
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-provenance" aria-hidden />
                      <span className="truncate">{words}</span>
                      <ArrowRight size={12} aria-hidden className="shrink-0 transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {outside ? (
            <p className="ml-auto shrink-0 text-mini text-ink-secondary">The firm accepts these</p>
          ) : chatId ? (
            <button
              type="button"
              onClick={() => void acceptAll()}
              disabled={busy}
              className={cn(
                'ml-auto shrink-0 rounded-md bg-surface px-2 py-0.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken coarse:min-h-11',
                busy && 'cursor-wait opacity-60',
              )}
            >
              {busy ? 'Accepting…' : 'Accept all for this chat'}
            </button>
          ) : null}
        </div>
      ) : null}
      {said && said.chat === chatId ? (
        <p className="mt-1 text-mini text-ink-secondary" role="status">
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
