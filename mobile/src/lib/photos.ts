/**
 * Site photographs: taking them, shrinking them, keeping them until they are sent.
 *
 * Each photo is re-encoded on the phone to a JPEG no longer than 1600 px on its
 * long edge at quality 0.7 — typically 300–700 KB — so it is well under the
 * server's 4 MB limit and cheap to send over a weak connection. The copy is
 * kept in the app's documents folder, not the cache, because the operating
 * system may clear the cache while an entry is still waiting for signal.
 *
 * Location and time come from the photo's own EXIF when it has them. A photo
 * from the camera with no GPS in its EXIF is tagged with where the phone is;
 * a photo chosen from the library is never tagged with where the phone is
 * now, because that would be false evidence of where it was taken.
 */
import { format } from 'date-fns';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { ApiError } from './http';
import { newId } from './ids';
import { currentFix, isValidPoint } from './location';
import type { LocalPhoto } from './outbox/engine';
import type { GeoPoint } from './types';

const LONG_EDGE = 1600;
const QUALITY = 0.7;
/** Under the server's 4 MB per photo, with room to spare. */
const MAX_BYTES = 3.5 * 1024 * 1024;

export type PickResult =
  | { ok: true; photos: LocalPhoto[] }
  | { ok: false; reason: 'cancelled' | 'denied' | 'failed'; message?: string };

const isWeb = Platform.OS === 'web';

export async function takePhoto(): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return {
        ok: false,
        reason: 'denied',
        message: 'Camera access is turned off for Realytica Site. Turn it on in your phone’s Settings to take site photos.',
      };
    }
    // Look for a location fix while the camera is open, so the photo can be tagged with it. Never
    // ask here: a permission prompt landing on top of the opening camera can stop it presenting
    // on iOS. The log screen asks when it opens.
    const where = currentFix({ ask: false, timeoutMs: 15_000 });
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: true });
    if (result.canceled || !result.assets?.length) return { ok: false, reason: 'cancelled' };
    const fix = await where;
    const photo = await preparePhoto(result.assets[0], { fromCamera: true, here: fix.ok ? fix.point : undefined });
    return { ok: true, photos: [photo] };
  } catch (err) {
    return { ok: false, reason: 'failed', message: `Could not take the photo: ${(err as Error).message}` };
  }
}

export async function choosePhotos(limit: number): Promise<PickResult> {
  try {
    // The system photo picker needs no library permission on current iOS and Android.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, limit),
      orderedSelection: true,
      quality: 0.9,
      exif: true,
    });
    if (result.canceled || !result.assets?.length) return { ok: false, reason: 'cancelled' };
    const photos: LocalPhoto[] = [];
    for (const asset of result.assets.slice(0, limit)) {
      photos.push(await preparePhoto(asset, { fromCamera: false }));
    }
    return { ok: true, photos };
  } catch (err) {
    return { ok: false, reason: 'failed', message: `Could not add the photos: ${(err as Error).message}` };
  }
}

async function preparePhoto(asset: ImagePicker.ImagePickerAsset, opts: { fromCamera: boolean; here?: GeoPoint }): Promise<LocalPhoto> {
  const exif = asset.exif ?? null;
  const takenAt = exifTime(exif) ?? (opts.fromCamera ? new Date().toISOString() : undefined);
  const point = exifPoint(exif) ?? (opts.fromCamera ? opts.here : undefined);
  const id = newId();
  const shrunk = await shrink(asset.uri, asset.width, asset.height);
  const kept = await keep(shrunk.uri, id);
  const stamp = format(takenAt ? new Date(takenAt) : new Date(), 'yyyyMMdd-HHmmss');
  return {
    id,
    uri: kept.uri,
    // Unique, because the server echoes it back and that is how uploads are matched to storage keys.
    fileName: `site-${stamp}-${id.slice(0, 8)}.jpg`,
    mimeType: 'image/jpeg',
    size: kept.size,
    width: shrunk.width,
    height: shrunk.height,
    ...(takenAt ? { takenAt } : {}),
    ...(point ? { point } : {}),
  };
}

/** Re-encode as JPEG, long edge ≤ 1600 px; step down further in the rare case that is still too big. */
async function shrink(uri: string, width: number, height: number): Promise<{ uri: string; width: number; height: number }> {
  let w = width;
  let h = height;
  if (!w || !h) {
    // The picker could not say how big it is; decode once to find out.
    const probeCtx = ImageManipulator.manipulate(uri);
    const probe = await probeCtx.renderAsync();
    w = probe.width;
    h = probe.height;
    probe.release();
    probeCtx.release();
  }
  let edge = LONG_EDGE;
  let quality = QUALITY;
  for (let attempt = 0; ; attempt++) {
    const ctx = ImageManipulator.manipulate(uri);
    if (Math.max(w, h) > edge) ctx.resize(w >= h ? { width: edge } : { height: edge });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG, base64: isWeb });
    image.release();
    ctx.release();
    // On the web the result is a blob: URL that dies with the page; a data: URL survives a reload.
    const out = isWeb && saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
    const size = await sizeOf(out);
    if (size === undefined || size <= MAX_BYTES || attempt >= 2) return { uri: out, width: saved.width, height: saved.height };
    edge = Math.round(edge * 0.75);
    quality = Math.max(0.45, quality - 0.15);
  }
}

function photosDir(): Directory {
  const dir = new Directory(Paths.document, 'site-photos');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Move the compressed copy out of the cache into the app's own documents folder. */
async function keep(uri: string, id: string): Promise<{ uri: string; size?: number }> {
  if (isWeb) return { uri, size: await sizeOf(uri) };
  const file = new File(uri);
  const target = new File(photosDir(), `${id}.jpg`);
  await file.move(target);
  // `move` repoints the File at its new home.
  return { uri: file.uri, size: await sizeOf(file.uri) };
}

async function sizeOf(uri: string): Promise<number | undefined> {
  try {
    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',');
      return Math.floor(((uri.length - comma - 1) * 3) / 4);
    }
    if (isWeb) return (await (await fetch(uri)).blob()).size;
    const file = new File(uri);
    return file.exists ? file.size : undefined;
  } catch {
    return undefined;
  }
}

/** Delete the phone's copies once they are on the server, or when a draft is thrown away. */
export function deletePhotoFiles(photos: readonly Pick<LocalPhoto, 'uri'>[]): void {
  if (isWeb) return;
  for (const p of photos) {
    try {
      const f = new File(p.uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

/** Whether the phone still has a photo's file — a draft restored after an update may not. */
export function photoFileExists(uri: string): boolean {
  if (isWeb) return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * One multipart body for an upload: a `photos` part per photo. React Native
 * streams a part straight from a file given { uri, name, type }; a browser
 * needs a real Blob.
 */
export async function photoForm(photos: readonly LocalPhoto[]): Promise<FormData> {
  // A file that has gone would otherwise fail like a dropped connection and be retried for ever.
  // Saying so as a refusal lets the outbox offer to send the entry without it.
  const missing = photos.filter((p) => !photoFileExists(p.uri)).length;
  if (missing) {
    throw new ApiError(
      `${missing === 1 ? 'A photo is' : `${missing} photos are`} no longer on this phone. Send the entry without ${missing === 1 ? 'it' : 'them'}, or delete it.`,
      400,
      'http',
    );
  }
  const form = new FormData();
  for (const p of photos) {
    if (isWeb) {
      const blob = await (await fetch(p.uri)).blob();
      form.append('photos', blob, p.fileName);
    } else {
      form.append('photos', { uri: p.uri, name: p.fileName, type: p.mimeType } as unknown as Blob);
    }
  }
  return form;
}

/* ------------------------------------------------------------------ */
/* EXIF                                                                */
/* ------------------------------------------------------------------ */

type Exif = Record<string, unknown> | null;

/**
 * "2026:10:02 14:31:05" (plus OffsetTimeOriginal "+05:30" when the camera
 * wrote one) → ISO 8601. Without an offset the time is the phone's local time.
 */
export function exifTime(exif: Exif): string | undefined {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.DateTime;
  if (typeof raw !== 'string') return undefined;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const offset = exif?.OffsetTimeOriginal ?? exif?.OffsetTime;
  let date: Date;
  if (typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`);
  } else {
    date = new Date(y, mo - 1, d, h, mi, s);
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * GPS from EXIF. iOS gives unsigned degrees plus N/S, E/W references; Android
 * gives signed decimal degrees (and the references too). Both read right here.
 */
export function exifPoint(exif: Exif): GeoPoint | undefined {
  let lat = Number(exif?.GPSLatitude);
  let lng = Number(exif?.GPSLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (exif?.GPSLatitudeRef === 'S' && lat > 0) lat = -lat;
  if (exif?.GPSLongitudeRef === 'W' && lng > 0) lng = -lng;
  const point = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  return isValidPoint(point) ? point : undefined;
}
