/**
 * Speech put into words: a voice note from site.
 *
 * Every other call here leaves in Anthropic's message format, which carries
 * text, images and PDFs and no sound. So a voice note goes to the gateway's
 * own speech-to-text endpoint instead, with the same key:
 *
 *   POST {REALYTICA_BASE_URL}/v1/audio/transcriptions
 *   { "model": "...", "input_audio": { "data": "<base64>", "format": "ogg" } }
 *   → { "text": "...", "usage": { "seconds": 48 } }
 *
 * That is OpenRouter's documented transcription API (read on 6 October 2026:
 * JSON with base64 audio; wav, mp3, flac, m4a, ogg, webm and aac; one request
 * is given about a minute upstream; no language named means it is detected,
 * which is what mixed Kannada, Hindi and English speech needs). A LiteLLM
 * proxy serves the same path for OpenAI-style clients.
 *
 * The model is named by one setting, REALYTICA_MODEL_TRANSCRIPTION, in the
 * gateway's own name for it. There is a default only where the gateway is
 * OpenRouter, whose documentation's own example names it. Without a gateway
 * (calls going straight to Anthropic) there is no transcriber: nothing is
 * sent anywhere, and the note says it was kept and not put into words.
 *
 * The sound is a person's voice. It is sent to this one endpoint and nowhere
 * else: not to the chat's model, not to the telemetry, not to the memory
 * graph. Only the words that come back are kept, as a file beside the note.
 */
import { apiKey, baseUrl } from './config';
import { readEnv } from './env';

/** OpenRouter's documented example model for its transcription endpoint. */
const OPENROUTER_DEFAULT = 'openai/whisper-1';

/** A recording past this is not sent: the gateway gives one request about a minute, and a body this size is already minutes of speech. */
export const TRANSCRIBE_AT_MOST_BYTES = 12 * 1024 * 1024;

/** How long one note may take to come back as words. */
const TRANSCRIBE_LIMIT_MS = 90_000;

export interface TranscriptionCapability {
  available: boolean;
  /** The model that puts speech into words, in the gateway's name for it. */
  model?: string;
  /** Where the sound is sent: the gateway's host, for the screen to say before the first note goes. */
  host?: string;
  /** Why there is none, in words for an operator. */
  reason?: string;
}

/** Whether this deployment can put speech into words, with what, and where the sound goes. */
export function transcriptionCapability(): TranscriptionCapability {
  if (readEnv('AGENTS_DISABLED') === '1') return { available: false, reason: 'The model layer is switched off (REALYTICA_AGENTS_DISABLED).' };
  const base = baseUrl();
  if (!base) return { available: false, reason: 'Speech needs a gateway that takes audio: set REALYTICA_BASE_URL and REALYTICA_MODEL_TRANSCRIPTION.' };
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return { available: false, reason: 'REALYTICA_BASE_URL is not an address.' };
  }
  const named = readEnv('MODEL_TRANSCRIPTION')?.trim();
  const model = named || (/(^|\.)openrouter\.ai$/i.test(host) ? OPENROUTER_DEFAULT : undefined);
  if (!model) return { available: false, host, reason: 'Name the model that puts speech into words in REALYTICA_MODEL_TRANSCRIPTION.' };
  return { available: true, model, host };
}

export type Transcribed =
  | { ok: true; text: string; seconds?: number; model: string }
  | { ok: false; why: 'no_transcriber' | 'too_long' | 'format' | 'failed'; said: string };

/**
 * Puts one voice note into words. Never throws: a note that could not be put
 * into words says why, and is kept as it is.
 *
 * `format` is the container the sound is in, as the endpoint names it. No
 * language is named, so the speech is taken in whichever languages it is in.
 */
export async function transcribeAudio(input: { bytes: Uint8Array; format: string | undefined; fetcher?: typeof fetch }): Promise<Transcribed> {
  const can = transcriptionCapability();
  if (!can.available || !can.model) return { ok: false, why: 'no_transcriber', said: 'no transcriber is set up here' };
  if (!input.format) return { ok: false, why: 'format', said: 'this kind of sound file is not one the transcriber takes' };
  if (input.bytes.length > TRANSCRIBE_AT_MOST_BYTES) return { ok: false, why: 'too_long', said: 'it is too long to send in one piece' };
  const key = apiKey();
  try {
    const res = await (input.fetcher ?? fetch)(`${baseUrl()!.replace(/\/+$/, '')}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: can.model, input_audio: { data: Buffer.from(input.bytes).toString('base64'), format: input.format } }),
      signal: AbortSignal.timeout(TRANSCRIBE_LIMIT_MS),
    });
    if (!res.ok) {
      // The status only: an error body can quote what was sent.
      console.warn(`[transcriber] ${can.model} answered ${res.status}`);
      return { ok: false, why: 'failed', said: res.status === 401 || res.status === 403 ? 'the transcriber refused the key' : res.status === 404 ? 'the gateway has no transcriber by that name' : 'the transcriber did not answer' };
    }
    const body = (await res.json()) as { text?: unknown; usage?: { seconds?: unknown }; duration?: unknown };
    const seconds = [body.usage?.seconds, body.duration].find((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    return { ok: true, text: typeof body.text === 'string' ? body.text.trim() : '', ...(seconds ? { seconds } : {}), model: can.model };
  } catch (err) {
    console.warn(`[transcriber] ${can.model} did not answer: ${err instanceof Error ? err.name : 'error'}`);
    return { ok: false, why: 'failed', said: 'the transcriber did not answer in time' };
  }
}
