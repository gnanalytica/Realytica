/**
 * A day's entry in progress, kept as it is typed.
 *
 * Site work gets interrupted — a call, a delivery, a phone that dies in the
 * heat — so the log form saves itself as you go and picks up where you left
 * off. A draft is one per project and belongs to the person who started it; a
 * different person pairing this phone does not inherit it.
 */
import type { LocalPhoto } from './outbox/engine';
import { deletePhotoFiles, photoFileExists } from './photos';
import { readJSON, removeKey, writeJSON } from './storage';
import type { IssueSeverity } from './types';

export interface DraftManpower {
  key: string;
  trade: string;
  count: number;
}

export interface DraftIssue {
  key: string;
  title: string;
  severity: IssueSeverity;
  note: string;
}

export interface LogDraft {
  owner: string;
  /** Fixed when the draft starts, so the entry keeps one id however often it is saved. */
  clientId: string;
  date: string;
  weather?: string;
  manpower: DraftManpower[];
  workDone: string;
  milestoneUpdates: { milestoneId: string; percent: number }[];
  issues: DraftIssue[];
  photos: LocalPhoto[];
  updatedAt: string;
}

const key = (projectId: string) => `realytica.draft.${projectId}`;

export async function loadDraft(projectId: string, owner: string): Promise<LogDraft | null> {
  const draft = await readJSON<LogDraft>(key(projectId));
  if (!draft) return null;
  if (draft.owner.toLowerCase() !== owner.toLowerCase()) {
    await discardDraft(projectId, draft);
    return null;
  }
  // A photo whose file has gone (the app was reinstalled, say) is dropped rather than shown broken.
  return { ...draft, photos: draft.photos.filter((p) => photoFileExists(p.uri)) };
}

export async function saveDraft(projectId: string, draft: LogDraft): Promise<void> {
  await writeJSON(key(projectId), draft);
}

/** The entry went to the outbox: the photos now belong to it, so their files stay. */
export async function clearDraft(projectId: string): Promise<void> {
  await removeKey(key(projectId));
}

/** Thrown away: the draft and its photo files. */
export async function discardDraft(projectId: string, draft?: LogDraft | null): Promise<void> {
  const held = draft ?? (await readJSON<LogDraft>(key(projectId)));
  if (held?.photos?.length) deletePhotoFiles(held.photos);
  await removeKey(key(projectId));
}

export function isEmptyDraft(d: Pick<LogDraft, 'weather' | 'manpower' | 'workDone' | 'milestoneUpdates' | 'issues' | 'photos'>): boolean {
  return !d.weather && !d.manpower.length && !d.workDone.trim() && !d.milestoneUpdates.length && !d.issues.length && !d.photos.length;
}
