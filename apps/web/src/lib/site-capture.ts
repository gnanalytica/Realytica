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

import { DRAWN_AT, TooLargeToSend, mustFitOneMessage, pictureShare, type SendLimits } from './send-limits';
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
  /** For a picture: how much of it is one flat tone, 0 to 1. A sheet of paper is mostly its paper; a view of a site is not. */
  view?: number;
  /** For a picture made smaller before sending: its long side now, in pixels. */
  shrunkTo?: number;
}

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

/** A photograph drawn again with its longest side no more than `side`, as a JPEG, and the long side it came to. Null where the browser cannot draw it. */
async function drawnAt(file: File, side: number, quality: number): Promise<{ blob: Blob; longSide: number } | null> {
  try {
    const picture = await createImageBitmap(file);
    const scale = Math.min(1, side / Math.max(picture.width, picture.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.width * scale));
    canvas.height = Math.max(1, Math.round(picture.height * scale));
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height);
    picture.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ? { blob, longSide: Math.max(canvas.width, canvas.height) } : null;
  } catch {
    return null;
  }
}

/**
 * How much of a picture is one flat tone, 0 to 1: the share of it within a
 * little of its middle colour. A photographed page is mostly its paper,
 * whatever the light; a view of a site is sky, ground and building. Measured
 * on a small copy, and sent beside the picture so that one with no words read
 * off it is filed as a view only when it plainly is one. Undefined where the
 * browser cannot draw the picture.
 */
async function flatTone(file: File): Promise<number | undefined> {
  try {
    const side = 48;
    const picture = await createImageBitmap(file, { resizeWidth: side, resizeHeight: side, resizeQuality: 'low' });
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const pen = canvas.getContext('2d');
    if (!pen) return undefined;
    pen.drawImage(picture, 0, 0, side, side);
    picture.close();
    const { data } = pen.getImageData(0, 0, side, side);
    const middle = [0, 1, 2].map((channel) => {
      const values: number[] = [];
      for (let i = channel; i < data.length; i += 4) values.push(data[i]!);
      return values.sort((a, b) => a - b)[values.length >> 1]!;
    });
    let near = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(Math.abs(data[i]! - middle[0]!), Math.abs(data[i + 1]! - middle[1]!), Math.abs(data[i + 2]! - middle[2]!)) <= 36) near += 1;
    }
    return Math.round((near / (side * side)) * 100) / 100;
  } catch {
    return undefined;
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
 * So a large one is drawn smaller, towards an even share of the room, but
 * never under what a reader needs of a photographed page: the browser cannot
 * tell a paper from a view, and the copy sent is the only one kept. Pictures
 * that will not fit together at that size are refused in words and sent in
 * smaller groups (`mustFitOneMessage`). A photograph the browser cannot draw
 * goes as it is.
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
    } else if (isPicture(file)) {
      const view = await flatTone(file);
      if (view !== undefined) about.view = view;
      if (file.size > each) {
        // Read off the original first: the smaller copy carries none of what the camera wrote.
        const takenAt = exifTakenAt(await file.slice(0, 256 * 1024).arrayBuffer());
        let best: { blob: Blob; longSide: number } | null = null;
        // Never under what a reader needs of a photographed page (`PAPER_LONG_SIDE`): the copy sent is the only one kept.
        for (const [side, quality] of DRAWN_AT) {
          const smaller = await drawnAt(file, side, quality);
          if (!smaller) break;
          if (!best || smaller.blob.size < best.blob.size) best = smaller;
          if (smaller.blob.size <= each) break;
        }
        if (best && best.blob.size < file.size) {
          sent = new File([best.blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
          if (takenAt) about.takenAt = takenAt;
          about.shrunkTo = best.longSide;
          shrunk += 1;
        }
      }
    }
    out.push(sent);
    captured.push(about);
  }
  return { files: out, captured, shrunk };
}
