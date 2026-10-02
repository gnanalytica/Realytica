/**
 * The outbox on the phone: one JSON list in AsyncStorage.
 *
 * Every change replaces the in-memory list (so screens re-render through
 * useSyncExternalStore) and is written to disk before the change's promise
 * resolves. Writes are chained, so two quick changes can never land on disk
 * in the wrong order.
 */
import { useSyncExternalStore } from 'react';

import { deletePhotoFiles, photoFileExists } from '../photos';
import { readJSON, writeJSON } from '../storage';
import type { LocalPhoto, MilestoneItem, OutboxItem, OutboxOwner, SiteLogItem } from './engine';

const KEY = 'realytica.outbox.v1';

let items: readonly OutboxItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let writing: Promise<void> = Promise.resolve();

function emit(): void {
  listeners.forEach((l) => l());
}

function persist(): Promise<void> {
  const snapshot = items;
  const next = writing.then(() => writeJSON(KEY, snapshot));
  // The chain itself must survive a failed write; the caller still hears about it.
  writing = next.catch(() => {});
  return next;
}

export async function loadOutbox(): Promise<void> {
  if (loaded) return;
  const saved = await readJSON<OutboxItem[]>(KEY);
  items = Array.isArray(saved) ? saved : [];
  loaded = true;
  emit();
}

export function outboxItems(): readonly OutboxItem[] {
  return items;
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOutbox(): readonly OutboxItem[] {
  return useSyncExternalStore(subscribeOutbox, outboxItems, outboxItems);
}

export async function enqueue(item: OutboxItem): Promise<void> {
  items = [...items, item];
  emit();
  try {
    await persist();
  } catch (err) {
    // Not on disk, so not in the outbox: the caller keeps the draft and says so.
    items = items.filter((i) => i.id !== item.id);
    emit();
    throw err;
  }
}

export async function updateItem(id: string, change: (item: OutboxItem) => OutboxItem): Promise<void> {
  if (!items.some((i) => i.id === id)) return;
  items = items.map((i) => (i.id === id ? change(i) : i));
  emit();
  await persist();
}

/** Take an item out. Its photo files go too, unless they are still needed elsewhere. */
export async function removeItem(id: string, opts: { keepFiles?: boolean } = {}): Promise<void> {
  const gone = items.find((i) => i.id === id);
  if (!gone) return;
  items = items.filter((i) => i.id !== id);
  emit();
  await persist();
  if (gone.kind === 'site-log' && !opts.keepFiles) deletePhotoFiles(gone.localPhotos);
}

/** Make a refused item eligible for automatic sending again. */
export async function clearAttention(id: string): Promise<void> {
  await updateItem(id, (i) => ({ ...i, needsAttention: false }));
}

/**
 * The photos an entry would go without if sent now: those whose file has gone
 * from the phone if there are any, otherwise every photo the server has not
 * yet taken (it refused them).
 */
export function photosToDrop(item: OutboxItem): LocalPhoto[] {
  if (item.kind !== 'site-log') return [];
  const unsent = item.localPhotos.filter((p) => !p.uploaded);
  const gone = unsent.filter((p) => !photoFileExists(p.uri));
  return gone.length ? gone : unsent;
}

/** For an entry whose photos could not be sent: send the rest without them. */
export async function dropUnsentPhotos(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  if (!item || item.kind !== 'site-log') return;
  const dropped = new Set(photosToDrop(item).map((p) => p.id));
  await updateItem(id, (i) =>
    i.kind === 'site-log'
      ? { ...i, localPhotos: i.localPhotos.filter((p) => !dropped.has(p.id)), needsAttention: false, lastError: undefined, failedStep: undefined }
      : i,
  );
  deletePhotoFiles(item.localPhotos.filter((p) => dropped.has(p.id)));
}

/**
 * Queue a milestone's new percentage. If an earlier change to the same
 * milestone is still waiting, it is replaced rather than sent twice — unless
 * that one is on its way to the server right now (`sendingId`), in which case
 * replacing it would lose the new value when the old one is removed as sent.
 */
export async function queueMilestone(input: {
  projectId: string;
  projectName: string;
  owner: OutboxOwner;
  milestoneId: string;
  milestoneName: string;
  percent: number;
  from?: number;
  newId: () => string;
  sendingId?: string | null;
}): Promise<void> {
  const waiting = items.find(
    (i): i is MilestoneItem =>
      i.kind === 'milestone' &&
      i.projectId === input.projectId &&
      i.payload.milestoneId === input.milestoneId &&
      !i.needsAttention &&
      i.id !== input.sendingId,
  );
  if (waiting) {
    await updateItem(waiting.id, (i) =>
      i.kind === 'milestone' ? { ...i, payload: { ...i.payload, percent: input.percent }, attempts: 0, lastError: undefined } : i,
    );
    return;
  }
  const item: MilestoneItem = {
    id: input.newId(),
    kind: 'milestone',
    projectId: input.projectId,
    projectName: input.projectName,
    owner: input.owner,
    payload: { milestoneId: input.milestoneId, milestoneName: input.milestoneName, percent: input.percent, from: input.from },
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  await enqueue(item);
}

/** What is waiting for one project, for showing on its screen before it is sent. */
export function pendingFor(list: readonly OutboxItem[], projectId: string): { entries: SiteLogItem[]; milestones: Map<string, MilestoneItem> } {
  const entries: SiteLogItem[] = [];
  const milestones = new Map<string, MilestoneItem>();
  for (const i of list) {
    if (i.projectId !== projectId) continue;
    if (i.kind === 'site-log') entries.push(i);
    else milestones.set(i.payload.milestoneId, i);
  }
  return { entries, milestones };
}
