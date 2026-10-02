/**
 * The outbox engine: sends the site work the phone saved, oldest first.
 *
 * Everything a person saves goes into the outbox before it goes anywhere
 * else, so nothing written on site depends on there being signal at that
 * moment. This file decides how each item is sent and what a failure means;
 * it is plain TypeScript with every effect passed in (storage, fetch, how a
 * photo becomes a multipart part), so the same code runs on the phone and in
 * a Node script against a real server.
 *
 * A site entry goes in two steps:
 *   1. its photographs are uploaded in batches (at most 6 files, and small
 *      enough in bytes to clear a 4 MiB request limit), and the storage key
 *      the server returns for each one is saved straight away — so a retry
 *      after a dropped connection never uploads a photo twice;
 *   2. the entry itself is posted under the id the phone gave it. The server
 *      files an entry once per id, so posting again after a lost response is
 *      harmless: it answers 200 with `duplicate: true`.
 *
 * What a failure means decides what happens next:
 *   - no answer (no signal, timeout), 408/425/429 or 5xx: try later, in the
 *     same order. The run stops at the first one rather than burning battery
 *     on requests that will fail the same way.
 *   - 401: the phone has been unpaired. Stop; the caller ends the pairing.
 *   - any other 4xx (403 no construction role, 404 project gone, 400 invalid):
 *     retrying will not help, so the item is marked "needs attention" with the
 *     server's own sentence and skipped by automatic runs. The person can try
 *     again (after their role is fixed, say) or delete it.
 */
import { ApiError, call } from '../http';
import type { GeoPoint, IssueSeverity, ManpowerRow, SiteLogBody, SiteLogResponse, UploadedPhoto } from '../types';

export interface LocalPhoto {
  /** The phone's own id for the photo. */
  id: string;
  /** Where the compressed copy lives on the phone. */
  uri: string;
  /** Unique per photo; the server echoes it back, which is how uploads are matched to keys. */
  fileName: string;
  mimeType: string;
  /** Bytes, when known, so batches stay under the server's request limit. */
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
  takenAt?: string;
  point?: GeoPoint;
  /** Set once the server has stored it. */
  uploaded?: UploadedPhoto;
}

export interface SiteLogPayload {
  clientId: string;
  date: string;
  weather?: string;
  manpower?: ManpowerRow[];
  workDone?: string;
  milestoneUpdates?: { milestoneId: string; percent: number }[];
  issues?: { title: string; severity?: IssueSeverity; note?: string }[];
  point?: GeoPoint;
}

export interface MilestonePayload {
  milestoneId: string;
  /** Kept so the outbox can name the milestone while offline. */
  milestoneName: string;
  percent: number;
  /** What it stood at when the person changed it. */
  from?: number;
}

/** Whose work an item is. It is only sent while that person, on that server, is paired. */
export interface OutboxOwner {
  server: string;
  email: string;
}

interface ItemBase {
  id: string;
  projectId: string;
  projectName: string;
  owner: OutboxOwner;
  attempts: number;
  lastError?: string;
  /** The HTTP status of the last failure; 0 when the server was not reached. */
  lastStatus?: number;
  /** Which step the last failure happened in. */
  failedStep?: 'photos' | 'entry' | 'milestone';
  lastTriedAt?: string;
  /** Refused for a reason a retry will not fix; skipped until the person asks again. */
  needsAttention?: boolean;
  createdAt: string;
}

export type SiteLogItem = ItemBase & { kind: 'site-log'; payload: SiteLogPayload; localPhotos: LocalPhoto[] };
export type MilestoneItem = ItemBase & { kind: 'milestone'; payload: MilestonePayload };
export type OutboxItem = SiteLogItem | MilestoneItem;

export interface EnginePairing {
  server: string;
  token: string;
  email: string;
}

export interface EngineDeps {
  pairing(): EnginePairing | null;
  items(): readonly OutboxItem[];
  update(id: string, change: (item: OutboxItem) => OutboxItem): Promise<void>;
  /** Called once an item is safely on the server. */
  remove(id: string): Promise<void>;
  /** Builds the multipart body for one batch: one `photos` part per photo, named by its fileName. */
  photoForm(photos: LocalPhoto[]): Promise<FormData>;
  fetchImpl?: typeof fetch;
  onUnauthorized?(token: string): void;
  onSent?(item: OutboxItem, response: unknown): void;
  /** The item being sent now, or null when the run ends. */
  onProgress?(itemId: string | null): void;
  now?(): Date;
}

export interface SyncOptions {
  /** Also send items marked "needs attention". */
  includeHeld?: boolean;
  /** Only these items (a "Try again" on one). */
  only?: string[];
}

export interface SyncReport {
  sent: number;
  /** Refused by the server this run; now marked "needs attention". */
  refused: number;
  /** Left for a later run because the server could not be reached or was busy. */
  waiting: number;
  stoppedBy?: 'unreachable' | 'server' | 'unpaired';
  lastError?: string;
}

/** The API takes at most 6 files per upload. */
export const PHOTOS_PER_UPLOAD = 6;
/**
 * On Vercel the whole request must stay under 4 MiB (see apps/api/src/uploads.ts);
 * 3.5 MiB of photos leaves room for the multipart framing.
 */
export const UPLOAD_BYTES_BUDGET = 3.5 * 1024 * 1024;
/** Assumed size of a compressed photo whose size the phone could not read. */
const TYPICAL_PHOTO_BYTES = 700 * 1024;

function sameServer(a: string, b: string): boolean {
  return a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
}

export function belongsTo(item: OutboxItem, pairing: { server: string; email: string } | null): boolean {
  return !!pairing && sameServer(item.owner.server, pairing.server) && item.owner.email.toLowerCase() === pairing.email.toLowerCase();
}

/** Split photos into uploads of at most `maxFiles` files and `maxBytes` bytes (a lone oversized photo goes alone). */
export function photoBatches(photos: readonly LocalPhoto[], maxFiles = PHOTOS_PER_UPLOAD, maxBytes = UPLOAD_BYTES_BUDGET): LocalPhoto[][] {
  const batches: LocalPhoto[][] = [];
  let batch: LocalPhoto[] = [];
  let bytes = 0;
  for (const photo of photos) {
    const size = photo.size ?? TYPICAL_PHOTO_BYTES;
    if (batch.length && (batch.length >= maxFiles || bytes + size > maxBytes)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(photo);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** "Try later" rather than "this will never work as it is". */
export function isTransient(err: ApiError): boolean {
  return err.unreachable || err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
}

/** The body for POST /site-log, once every photo has a storage key. */
export function siteLogBody(item: SiteLogItem): SiteLogBody {
  const photos = item.localPhotos.map((p) => {
    if (!p.uploaded) throw new ApiError(`The photo ${p.fileName} has not been uploaded yet.`, 0, 'network');
    return {
      ...p.uploaded,
      ...(p.takenAt ? { takenAt: p.takenAt } : {}),
      ...(p.point ? { point: p.point } : {}),
      ...(p.caption?.trim() ? { caption: p.caption.trim().slice(0, 400) } : {}),
    };
  });
  return { ...item.payload, ...(photos.length ? { photos } : {}) };
}

/**
 * Send what is waiting. Network and server failures never throw: the outcome
 * is in the report and on each item. Only the outbox's own storage failing can
 * reject the promise.
 */
export async function runSync(deps: EngineDeps, opts: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, refused: 0, waiting: 0 };
  const pairing = deps.pairing();
  if (!pairing) return { ...report, stoppedBy: 'unpaired' };
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();

  const queue = deps
    .items()
    .filter((i) => belongsTo(i, pairing))
    .filter((i) => (opts.only ? opts.only.includes(i.id) : opts.includeHeld || !i.needsAttention))
    .map((i) => i.id);

  try {
    for (let n = 0; n < queue.length; n++) {
      const id = queue[n];
      // Read afresh each time: an earlier run may have saved storage keys, or the person deleted it.
      const item = deps.items().find((i) => i.id === id);
      if (!item) continue;
      deps.onProgress?.(id);
      try {
        const response = await send(item, pairing, deps);
        if (response === DELETED) continue;
        await deps.remove(id);
        report.sent++;
        deps.onSent?.(item, response);
      } catch (raw) {
        const failedStep = raw instanceof StepFailure ? raw.step : undefined;
        const cause = raw instanceof StepFailure ? raw.cause : raw;
        const err =
          cause instanceof ApiError ? cause : new ApiError(cause instanceof Error ? cause.message : 'Something went wrong while sending.', 0, 'network');
        report.lastError = err.message;
        const noted = (i: OutboxItem): OutboxItem => ({
          ...i,
          attempts: i.attempts + 1,
          lastTriedAt: nowIso(),
          lastError: err.message,
          lastStatus: err.status,
          failedStep,
        });
        if (err.status === 401) {
          await deps.update(id, noted);
          deps.onUnauthorized?.(pairing.token);
          report.waiting = queue.length - n;
          report.stoppedBy = 'unpaired';
          return report;
        }
        const transient = isTransient(err);
        await deps.update(id, (i) => ({ ...noted(i), needsAttention: !transient }));
        if (transient) {
          report.waiting = queue.length - n;
          report.stoppedBy = err.unreachable ? 'unreachable' : 'server';
          return report;
        }
        report.refused++;
      }
    }
    return report;
  } finally {
    deps.onProgress?.(null);
  }
}

const DELETED = Symbol('deleted');

/** A failure, labelled with the step it happened in, so the outbox can offer the right way out. */
class StepFailure extends Error {
  constructor(
    readonly step: 'photos' | 'entry' | 'milestone',
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

async function step<T>(name: StepFailure['step'], work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw new StepFailure(name, err);
  }
}

async function send(item: OutboxItem, pairing: EnginePairing, deps: EngineDeps): Promise<unknown> {
  const base = { server: pairing.server, token: pairing.token, fetchImpl: deps.fetchImpl };
  const project = encodeURIComponent(item.projectId);

  if (item.kind === 'milestone') {
    const { milestoneId, percent } = item.payload;
    return step('milestone', () =>
      call({ ...base, method: 'PATCH', path: `/projects/${project}/milestones/${encodeURIComponent(milestoneId)}`, json: { percent } }),
    );
  }

  // 1. The photographs.
  for (const batch of photoBatches(item.localPhotos.filter((p) => !p.uploaded))) {
    await step('photos', async () => {
      const form = await deps.photoForm(batch);
      const res = await call<{ photos?: UploadedPhoto[] }>({
        ...base,
        method: 'POST',
        path: `/projects/${project}/site-log/photos`,
        form,
        timeoutMs: 120_000,
      });
      const stored = matchUploads(batch, res?.photos ?? []);
      // Saved before anything else can fail, so these photos are never sent again.
      await deps.update(item.id, (i) =>
        i.kind === 'site-log' ? { ...i, localPhotos: i.localPhotos.map((p) => (stored.has(p.id) ? { ...p, uploaded: stored.get(p.id) } : p)) } : i,
      );
      if (stored.size < batch.length) {
        // The server quietly drops files it will not take (a type it does not accept), so a short answer is a refusal.
        const missing = batch.length - stored.size;
        throw new ApiError(
          `The server would not take ${missing} of the photos (it accepts JPEG, PNG or WebP up to 4 MB each). Send the entry without ${missing === 1 ? 'it' : 'them'}, or delete it.`,
          400,
          'http',
        );
      }
    });
  }

  // 2. The entry.
  const fresh = deps.items().find((i) => i.id === item.id);
  if (!fresh) return DELETED;
  if (fresh.kind !== 'site-log') throw new ApiError('This item changed while it was being sent.', 0, 'network');
  return step('entry', () => call<SiteLogResponse>({ ...base, method: 'POST', path: `/projects/${project}/site-log`, json: siteLogBody(fresh) }));
}

/** Pair each photo sent with the key the server stored it under, by file name. */
function matchUploads(batch: readonly LocalPhoto[], returned: readonly UploadedPhoto[]): Map<string, UploadedPhoto> {
  const left = [...returned];
  const out = new Map<string, UploadedPhoto>();
  for (const photo of batch) {
    const at = left.findIndex((r) => r.fileName === photo.fileName);
    if (at >= 0) {
      out.set(photo.id, left[at]);
      left.splice(at, 1);
    }
  }
  return out;
}
