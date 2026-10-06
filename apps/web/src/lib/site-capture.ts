/**
 * What the browser does to a voice note or a photograph before it is sent.
 *
 * One request to the deployed site may carry about four megabytes. A phone's
 * photograph is larger than that, so a large one is made smaller here first.
 * Making it smaller draws it again, and the copy carries none of what the
 * camera wrote in the original, so the moment it was taken is read off the
 * original first and sent beside it. A recording's length is measured here
 * too: the server gets the bytes, and bytes do not say how long they run.
 */

import { TooLargeToSend, mustFitOneMessage, pictureShare, type SendLimits } from './send-limits';
import { exifTakenAt, localDay } from './taken-at';

export { TooLargeToSend, exifTakenAt, localDay, mustFitOneMessage };
export type { SendLimits };

/** What is sent beside each file, in the order of the files. */
export interface Captured {
  /** The day on the file by this person's own clock, YYYY-MM-DD. */
  day?: string;
  /** For a photograph made smaller: the moment the camera wrote in the original, as it wrote it. */
  takenAt?: string;
  /** For sound: how long it runs. */
  seconds?: number;
}

/** The longest side it is drawn at, largest first, and how hard it is pressed: enough to read a signboard, a fraction of the bytes. */
const DRAWN: ReadonlyArray<[side: number, quality: number]> = [
  [2400, 0.85],
  [1600, 0.85],
  [1100, 0.82],
  [800, 0.72],
];

/** How long recordings made here run, kept beside the file: a fresh recording has no length an `<audio>` can read. */
const RECORDED = new WeakMap<File, number>();

export function noteRecorded(file: File, seconds: number): void {
  RECORDED.set(file, seconds);
}

export function isSound(file: File): boolean {
  return file.type.startsWith('audio/') || (!file.type.startsWith('video/') && /\.(?:ogg|oga|opus|m4a|mp3|wav|webm|aac|flac|amr|3gp)$/i.test(file.name));
}

export function isPicture(file: File): boolean {
  return file.type.startsWith('image/') || /\.(?:jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

/** A photograph drawn again with its longest side no more than `side`, as a JPEG. Null where the browser cannot draw it. */
async function drawnAt(file: File, side: number, quality: number): Promise<Blob | null> {
  try {
    const picture = await createImageBitmap(file);
    const scale = Math.min(1, side / Math.max(picture.width, picture.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.width * scale));
    canvas.height = Math.max(1, Math.round(picture.height * scale));
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height);
    picture.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch {
    return null;
  }
}

/** How long a sound file runs, as the browser reads it. Undefined where it cannot. */
function soundLength(file: File): Promise<number | undefined> {
  const known = RECORDED.get(file);
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (seconds?: number) => {
      URL.revokeObjectURL(url);
      resolve(seconds && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done();
    window.setTimeout(() => done(), 4000);
    audio.src = url;
  });
}

/**
 * The files as they are sent, and what is sent beside each.
 *
 * Photographs sent together share one message, and one message has a size.
 * So each is made small enough for all of them to go in it: three share the
 * room three ways, ten share it ten ways. A photograph the browser cannot
 * draw goes as it is.
 */
export async function readyToSend(files: File[], limits: SendLimits): Promise<{ files: File[]; captured: Captured[]; shrunk: number }> {
  const each = pictureShare(limits, files.filter(isPicture).length, files.filter((f) => !isPicture(f) && f.size < limits.maxFileBytes).reduce((sum, f) => sum + f.size, 0));
  const out: File[] = [];
  const captured: Captured[] = [];
  let shrunk = 0;
  for (const file of files) {
    const about: Captured = { day: localDay(file.lastModified || Date.now()) };
    let sent = file;
    if (isSound(file)) {
      const seconds = await soundLength(file);
      if (seconds) about.seconds = Math.round(seconds * 10) / 10;
    } else if (isPicture(file) && file.size > each) {
      // Read off the original first: the smaller copy carries none of what the camera wrote.
      const takenAt = exifTakenAt(await file.slice(0, 256 * 1024).arrayBuffer());
      let best: Blob | null = null;
      for (const [side, quality] of DRAWN) {
        const smaller = await drawnAt(file, side, quality);
        if (!smaller) break;
        if (!best || smaller.size < best.size) best = smaller;
        if (smaller.size <= each) break;
      }
      if (best && best.size < file.size) {
        sent = new File([best], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
        if (takenAt) about.takenAt = takenAt;
        shrunk += 1;
      }
    }
    out.push(sent);
    captured.push(about);
  }
  return { files: out, captured, shrunk };
}
