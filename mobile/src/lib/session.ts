/**
 * The phone's pairing: which server, which person, and the device token.
 *
 * Held in a small module-level store rather than React context so the API
 * client and the outbox — which run outside React — read the same token the
 * screens do. Screens subscribe with `useSession()`.
 *
 * A pairing ends three ways: the person signs out, the server answers 401
 * (the phone was revoked, or its person removed from the workspace), or the
 * phone is paired afresh. In every case the token and the saved copies of
 * project data are wiped. The outbox is NOT wiped: unsent site work belongs to
 * the person who wrote it and is sent when that person pairs this phone again.
 */
import * as Device from 'expo-device';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { clearSavedCopies } from './cache';
import { ApiError, call } from './http';
import { queryClient } from './query';
import { deleteSecret, readJSON, readSecret, writeJSON, writeSecret } from './storage';
import type { ClaimResponse, MeResponse, Person, PublicDevice, Workspace } from './types';

const KEY = 'realytica.pairing.v1';
/** The server last paired with, kept after sign-out so pairing again does not mean retyping it. */
const LAST_SERVER_KEY = 'realytica.lastServer';

export async function lastServer(): Promise<string | null> {
  return readJSON<string>(LAST_SERVER_KEY);
}

export interface Pairing {
  server: string;
  token: string;
  device: PublicDevice;
  person: Person;
  workspace: Workspace;
  pairedAt: string;
  /** When the server last confirmed the pairing. */
  checkedAt?: string;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'unpaired'; notice?: string }
  | { status: 'paired'; pairing: Pairing };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: SessionState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function getSession(): SessionState {
  return state;
}

export function currentPairing(): Pairing | null {
  return state.status === 'paired' ? state.pairing : null;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

/** The pairing, for screens that only render while paired (the layout guards that). */
export function usePairing(): Pairing | null {
  const s = useSession();
  return s.status === 'paired' ? s.pairing : null;
}

export async function loadSession(): Promise<SessionState> {
  try {
    const raw = await readSecret(KEY);
    const pairing = raw ? (JSON.parse(raw) as Pairing) : null;
    set(pairing?.token && pairing.server ? { status: 'paired', pairing } : { status: 'unpaired' });
  } catch {
    set({ status: 'unpaired' });
  }
  return state;
}

/** What the phone calls itself on the People page: "Ravi's Pixel 8", or the model. */
export function defaultPhoneName(): string {
  const fallback = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web browser';
  return (Device.deviceName || Device.modelName || fallback).slice(0, 80);
}

/** Trade a pairing code for this phone's own token. Throws ApiError with the server's sentence. */
export async function pairPhone(input: { server: string; code: string; name: string }): Promise<Pairing> {
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : undefined;
  const res = await call<ClaimResponse>({
    server: input.server,
    path: '/devices/claim',
    method: 'POST',
    json: { code: input.code, name: input.name.trim() || defaultPhoneName(), ...(platform ? { platform } : {}) },
  });
  const pairing: Pairing = {
    server: input.server,
    token: res.token,
    device: res.device,
    person: res.person,
    workspace: res.workspace,
    pairedAt: new Date().toISOString(),
  };
  // A fresh pairing starts clean: nothing cached from an earlier person or server.
  await wipeProjectData();
  await writeSecret(KEY, JSON.stringify(pairing));
  await writeJSON(LAST_SERVER_KEY, input.server).catch(() => {});
  set({ status: 'paired', pairing });
  return pairing;
}

export async function updatePairing(patch: Partial<Pick<Pairing, 'device' | 'person' | 'workspace' | 'checkedAt'>>): Promise<void> {
  const current = currentPairing();
  if (!current) return;
  const next = { ...current, ...patch };
  await writeSecret(KEY, JSON.stringify(next));
  set({ status: 'paired', pairing: next });
}

async function wipeProjectData(): Promise<void> {
  queryClient.clear();
  await clearSavedCopies().catch(() => {});
}

/** End the pairing on this phone. `notice` is shown on the pairing screen. */
export async function forget(notice?: string): Promise<void> {
  await deleteSecret(KEY).catch(() => {});
  await wipeProjectData();
  set({ status: 'unpaired', notice });
}

/**
 * The server answered 401: it no longer accepts this token. Only acted on when
 * it is still the token the phone holds, so a slow request from a pairing that
 * has already been replaced cannot sign out the new one.
 */
export function handleUnauthorized(token: string | null | undefined): void {
  const current = currentPairing();
  if (!current || (token && current.token !== token)) return;
  void forget('This phone is no longer paired. Ask for a new code in the web app (People › Pair a phone) and pair it again.');
}

/**
 * Ask the server who this phone is. Refreshes the person's name and role.
 *
 * Only a 401 ends the pairing. Anything else — no signal, or a development
 * server running with sign-in switched off, which answers 400 because it does
 * not look at device tokens at all — keeps the pairing as it is.
 */
export async function refreshMe(): Promise<'ok' | 'unpaired' | 'unknown'> {
  const p = currentPairing();
  if (!p) return 'unpaired';
  try {
    const me = await call<MeResponse>({ server: p.server, path: '/devices/me', token: p.token, timeoutMs: 12_000 });
    await updatePairing({ device: me.device, person: me.person, workspace: me.workspace, checkedAt: new Date().toISOString() });
    return 'ok';
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      handleUnauthorized(p.token);
      return 'unpaired';
    }
    return 'unknown';
  }
}

/**
 * Sign out: tell the server to revoke this phone's token, then forget it here.
 * The local half always happens — a person signing out of a phone they are
 * handing back must not be stopped by a missing signal. If the server could not
 * be told, the phone still appears on the People page and can be removed there.
 */
export async function signOut(): Promise<{ revoked: boolean; message?: string }> {
  const p = currentPairing();
  if (!p) return { revoked: true };
  let revoked = true;
  let message: string | undefined;
  try {
    await call<void>({ server: p.server, path: '/devices/me', method: 'DELETE', token: p.token, timeoutMs: 10_000 });
  } catch (err) {
    // 401: the server had already forgotten this phone, which is what signing out wants.
    if (!(err instanceof ApiError && err.status === 401)) {
      revoked = false;
      message = err instanceof Error ? err.message : undefined;
    }
  }
  await forget();
  return { revoked, message };
}
