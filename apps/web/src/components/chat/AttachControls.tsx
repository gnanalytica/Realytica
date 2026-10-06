import { useEffect, useRef, useState } from 'react';
import { Camera, Mic, Paperclip, Square, Trash2 } from 'lucide-react';
import { Button, cn } from '../ui/kit';
import { isSound, noteRecorded } from '../../lib/site-capture';

/** Whether a voice note can be put into words here, and where its sound is sent. */
export interface VoiceInfo {
  available: boolean;
  model?: string;
  host?: string;
}

/** What a voice note is sent to, said before the first one goes. */
export function voiceNotice(voice: VoiceInfo | undefined): string {
  if (!voice) return '';
  return voice.available
    ? `A voice note is kept on this project and sent to ${voice.model} at ${voice.host} to be put into words. The sound goes nowhere else. Its words are then read by this project’s reading model, to sort them into the entry.`
    : 'A voice note is kept on this project. No transcriber is set up here, so it is not put into words and is sent nowhere.';
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** The sound a browser can record, in the order tried: Ogg where it will, else WebM, else what an iPhone gives. */
const KINDS: Array<[string, string]> = [
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/mp4', 'm4a'],
];

/**
 * How a file gets into the chat: chosen, taken with the camera, or spoken.
 *
 * The camera and the microphone are offered beside the paperclip, since site
 * staff send a photograph and a voice note, not a document. A recording can
 * be stopped and thrown away before anything is sent: it joins the files
 * waiting to go, and leaves them the way any of them does.
 */
export function AttachControls({
  disabled,
  voice,
  staged,
  onAdd,
}: {
  disabled: boolean;
  /** Absent where this chat takes no voice notes. */
  voice?: VoiceInfo;
  /** The files waiting to be sent, so the notice shows when one of them is sound. */
  staged: File[];
  onAdd: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(true);
  const [recording, setRecording] = useState<number | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const live = recording !== null;
  useEffect(() => {
    if (!live) return undefined;
    const t = window.setInterval(() => setRecording((s) => (s === null ? s : s + 1)), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  // Leaving the page with the microphone open lets it go.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), []);

  const take = (list: FileList | null, input: HTMLInputElement) => {
    const next = Array.from(list ?? []);
    if (next.length) onAdd(next);
    input.value = '';
  };

  async function record(): Promise<void> {
    setRefused(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRefused('This browser cannot record here. Attach the voice note as a file.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const [type, ext] = KINDS.find(([kind]) => MediaRecorder.isTypeSupported(kind)) ?? ['', 'webm'];
      // Speech needs few bits: at this rate a quarter of an hour fits in one request.
      const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
      const parts: Blob[] = [];
      const began = Date.now();
      keep.current = true;
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setRecording(null);
        if (!keep.current || !parts.length) return;
        const at = new Date();
        const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}-${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}`;
        const file = new File(parts, `voice-note-${stamp}.${ext}`, { type: (rec.mimeType || type || 'audio/webm').split(';')[0], lastModified: at.getTime() });
        noteRecorded(file, (Date.now() - began) / 1000);
        onAdd([file]);
      };
      recorder.current = rec;
      rec.start();
      setRecording(0);
    } catch {
      setRefused('The microphone was not allowed. Allow it for this site, or attach the voice note as a file.');
    }
  }

  const stop = (kept: boolean) => {
    keep.current = kept;
    recorder.current?.stop();
  };

  const sound = recording !== null || staged.some(isSound);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.ogg,.oga,.opus,.m4a,.mp3,.wav,.webm,.aac,.flac,audio/*,image/*"
        onChange={(e) => take(e.target.files, e.target)}
      />
      {/* On a phone this opens the camera; elsewhere, the pictures on the machine. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => take(e.target.files, e.target)} />
      {recording === null ? (
        <>
          <Button type="button" variant="ghost" size="sm" aria-label="Attach documents" title="Attach documents" disabled={disabled} icon={<Paperclip size={15} />} onClick={() => fileRef.current?.click()} />
          <Button type="button" variant="ghost" size="sm" aria-label="Take a photograph" title="Take a photograph" disabled={disabled} icon={<Camera size={15} />} onClick={() => cameraRef.current?.click()} />
          {voice ? (
            <Button type="button" variant="ghost" size="sm" aria-label="Record a voice note" title="Record a voice note" disabled={disabled} icon={<Mic size={15} />} onClick={() => void record()} />
          ) : null}
        </>
      ) : (
        <span className="flex items-center gap-1.5 pl-1.5" role="status" aria-live="polite">
          <span className="size-2 animate-pulse rounded-full bg-critical" aria-hidden />
          <span className="font-mono text-[12px] tabular-nums text-ink">Recording {clock(recording)}</span>
          <Button type="button" variant="secondary" size="sm" icon={<Square size={12} />} onClick={() => stop(true)}>
            Stop
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Discard the recording" title="Discard the recording" icon={<Trash2 size={14} />} onClick={() => stop(false)} />
        </span>
      )}
      {(sound && voice) || refused ? (
        <p className={cn('order-last basis-full px-2 pb-0.5 text-micro', refused ? 'text-[var(--status-warning-text)]' : 'text-ink-muted')}>{refused ?? voiceNotice(voice)}</p>
      ) : null}
    </>
  );
}
