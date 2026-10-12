import { useEffect, useMemo, useRef, useState } from 'react';
import { Speech, Square } from 'lucide-react';
import { Button, INTERACTIVE, cn } from '../ui/kit';
import { readPref, writePref } from '../../lib/prefs';
import { useMe } from '../../lib/useMe';
import { SPEECH_NOTICE, chosenLanguage, dictationFrom, dictationStep, recogniserOf, speechLanguageKey, speechLanguages, speechRefused, type Dictation, type HeardResult, type Recogniser } from './speech';

const TOLD = 'speech.told';

/**
 * Asking by voice: a microphone and the language it listens in.
 *
 * The words appear in the message box as the browser recognises them and stay
 * there. Nothing is sent until the person sends it, so a wrong word is fixed
 * first. It listens for one stretch of speech and stops by itself. Drawn only
 * where the browser can do it.
 */
export function SpeakControls({ text, onText, disabled }: { text: string; onText: (next: string) => void; disabled?: boolean }) {
  const Recognition = useMemo(() => recogniserOf(typeof window === 'undefined' ? undefined : window), []);
  const me = useMe();
  const languages = useMemo(() => speechLanguages(typeof navigator === 'undefined' ? [] : navigator.languages), []);
  const key = speechLanguageKey(me?.subject);
  const [language, setLanguage] = useState(() => chosenLanguage(readPref(key), languages));
  // The choice is each person's own: it is read again once the server has said who this is.
  useEffect(() => setLanguage(chosenLanguage(readPref(key), languages)), [key, languages]);

  const [listening, setListening] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [told, setTold] = useState(false);
  const live = useRef<Recogniser | null>(null);
  const held = useRef<Dictation>(dictationFrom(''));
  const box = useRef(text);
  box.current = text;

  // The box emptied under the microphone is a message sent: what is heard after it belongs to no message.
  useEffect(() => {
    if (live.current && ((text === '' && held.current.wrote !== '') || disabled)) live.current.abort();
  }, [text, disabled]);
  // Leaving the chat lets the microphone go.
  useEffect(() => () => live.current?.abort(), []);

  if (!Recognition) return null;
  const label = languages.find((l) => l.tag === language)?.label ?? language;

  function listen(): void {
    if (live.current || !Recognition) return;
    setRefused(null);
    if (readPref(TOLD) !== '1') {
      setTold(true);
      writePref(TOLD, '1');
    }
    const rec = new Recognition();
    rec.lang = language;
    rec.continuous = false;
    rec.interimResults = true;
    held.current = dictationFrom(box.current);
    rec.onresult = (event) => {
      const results: HeardResult[] = Array.from(event.results, (result) => ({ transcript: result[0]?.transcript ?? '', final: result.isFinal }));
      held.current = dictationStep(held.current, box.current, results);
      if (held.current.wrote !== box.current) onText(held.current.wrote);
    };
    rec.onerror = (event) => setRefused(speechRefused(event.error, label));
    rec.onend = () => {
      live.current = null;
      setListening(false);
    };
    try {
      rec.start();
      live.current = rec;
      setListening(true);
    } catch {
      setRefused(speechRefused('', label));
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={listening ? 'Stop listening' : 'Speak your question'}
        title={listening ? 'Stop listening' : 'Speak your question'}
        aria-pressed={listening}
        disabled={disabled}
        className={listening ? 'text-critical hover:text-critical' : undefined}
        icon={listening ? <Square size={12} /> : <Speech size={15} />}
        onClick={() => (listening ? live.current?.stop() : listen())}
      />
      <select
        aria-label="Language to speak in"
        title="Language to speak in"
        value={language}
        disabled={disabled || listening}
        onChange={(e) => {
          setLanguage(e.target.value);
          writePref(key, e.target.value);
        }}
        className={cn(INTERACTIVE, 'h-7 max-w-[8rem] cursor-pointer truncate rounded-lg bg-transparent px-1 text-xs text-ink-secondary hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 coarse:min-h-11')}
      >
        {languages.map((l) => (
          <option key={l.tag} value={l.tag} lang={l.tag}>
            {l.label}
          </option>
        ))}
      </select>
      <span className="sr-only" role="status">
        {listening ? `Listening in ${label}` : ''}
      </span>
      {refused || told ? (
        <p className={cn('order-last basis-full px-2 pb-0.5 text-micro', refused ? 'text-[var(--status-warning-text)]' : 'text-ink-muted')} role={refused ? 'alert' : undefined}>
          {refused ?? SPEECH_NOTICE}
        </p>
      ) : null}
    </>
  );
}
