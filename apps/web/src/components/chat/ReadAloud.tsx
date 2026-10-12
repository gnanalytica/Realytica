import { useEffect, useRef, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { INTERACTIVE, cn } from '../ui/kit';
import { canReadAloud, noVoiceSaid, pickVoice, speechChunks, spokenAnswer } from './speech';
import type { TagPlaces } from './answer-blocks';

/**
 * Read one answer aloud, and stop.
 *
 * Nothing is read until this is pressed. The browser speaks, in a voice for
 * the language the answer is written in when the device has one; citations
 * are counted, not read. Starting a second answer stops the first, since the
 * browser has one voice. Drawn only where the browser can speak.
 */
export function ReadAloud({ text, nodes, rests }: { text: string; nodes?: Array<{ id: string; label: string }>; rests?: TagPlaces }) {
  const [reading, setReading] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  /** Which reading the browser's events belong to: one that was stopped still reports its end. */
  const run = useRef(0);
  // Leaving the answer behind stops its reading.
  useEffect(
    () => () => {
      if (run.current) window.speechSynthesis?.cancel();
    },
    [],
  );
  if (typeof window === 'undefined' || !canReadAloud(window)) return null;

  function stop(): void {
    run.current = 0;
    window.speechSynthesis.cancel();
    setReading(false);
  }

  function read(): void {
    const synth = window.speechSynthesis;
    const label = new Map((nodes ?? []).map((node) => [node.id, node.label]));
    const spoken = spokenAnswer(text, { nodeName: (id) => label.get(id), places: rests });
    const chunks = speechChunks(spoken.lines);
    if (!chunks.length) return;
    const voices = synth.getVoices();
    const voice = pickVoice(voices, spoken.language);
    // A device that lists voices and has none for this language would read it as noise. One that lists none yet is left to choose by the language.
    if (voices.length && !voice) {
      setSaid(noVoiceSaid(spoken.language));
      return;
    }
    setSaid(null);
    // Whatever else was being read stops here: its own button hears of it from the browser.
    synth.cancel();
    const mine = Date.now();
    run.current = mine;
    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = voice?.lang ?? spoken.language;
      if (voice) utterance.voice = voice;
      const over = (): void => {
        if (run.current !== mine) return;
        run.current = 0;
        setReading(false);
      };
      if (i === chunks.length - 1) utterance.onend = over;
      utterance.onerror = over;
      synth.speak(utterance);
    });
    setReading(true);
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2">
      <button
        type="button"
        aria-pressed={reading}
        onClick={reading ? stop : read}
        className={cn(INTERACTIVE, 'inline-flex items-center gap-1 rounded-md text-micro text-ink-muted hover:text-ink coarse:min-h-11')}
      >
        {reading ? <Square size={10} aria-hidden /> : <Volume2 size={12} aria-hidden />}
        {reading ? 'Stop reading' : 'Read aloud'}
      </button>
      {said ? (
        <span className="text-micro text-ink-muted" role="status">
          {said}
        </span>
      ) : null}
    </span>
  );
}
