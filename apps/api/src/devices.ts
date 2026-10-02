/**
 * Phones paired to a person, for the site app.
 *
 * The site app never sees a Google sign-in. A signed-in person asks the web
 * app for a pairing code, the phone claims it once, and the phone is handed a
 * long random token of its own. The token is stored only as a hash, belongs
 * to that person in that workspace, reaches only the site routes, and stops
 * working the moment the person is removed or the phone is revoked.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Principal } from '@realytica/shared';
import { store } from './store';

export interface PairCode {
  code: string;
  tenantId: string;
  email: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export interface DeviceRecord {
  id: string;
  tenantId: string;
  email: string;
  subject: string;
  /** What the phone called itself: "Ravi's Pixel 8". */
  name: string;
  platform?: 'ios' | 'android' | 'web';
  /** sha256 of the token. The token itself is never stored. */
  tokenHash: string;
  /** Expo push token, when the phone allowed notifications. */
  pushToken?: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

/** Long enough to type off a screen, short-lived enough not to matter if seen. */
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
export const DEVICE_TOKEN_PREFIX = 'rdt_';

function codes(): PairCode[] {
  if (!store.data.pairCodes) store.data.pairCodes = [];
  return store.data.pairCodes;
}

function devices(): DeviceRecord[] {
  if (!store.data.devices) store.data.devices = [];
  return store.data.devices;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh code for this person; any earlier unused code of theirs stops working. */
export function issuePairCode(principal: Principal, now = new Date()): PairCode {
  const live = codes().filter((c) => !c.usedAt && Date.parse(c.expiresAt) > now.getTime() && !(c.tenantId === principal.tenantId && c.email === principal.email));
  let code = '';
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (live.some((c) => c.code === code));
  const issued: PairCode = {
    code,
    tenantId: principal.tenantId,
    email: principal.email,
    subject: principal.subject,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PAIR_CODE_TTL_MS).toISOString(),
  };
  store.data.pairCodes = [...live, issued];
  return issued;
}

/** Codes are typed by hand: ignore case, spaces and dashes. */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type ClaimResult = { ok: true; token: string; device: DeviceRecord } | { ok: false; reason: string };

/** Turn a code into a device token. One claim per code. */
export function claimPairCode(raw: string, phone: { name?: string; platform?: DeviceRecord['platform'] }, now = new Date()): ClaimResult {
  const code = normaliseCode(raw);
  const held = codes().find((c) => c.code === code);
  if (!held || held.usedAt || Date.parse(held.expiresAt) <= now.getTime()) {
    return { ok: false, reason: 'That code has expired or was already used. Ask for a new one in the web app.' };
  }
  const member = (store.data.memberships ?? []).find((m) => m.tenantId === held.tenantId && m.email.toLowerCase() === held.email.toLowerCase());
  if (!member) return { ok: false, reason: 'That person is no longer in the workspace.' };
  held.usedAt = now.toISOString();
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const device: DeviceRecord = {
    id: `dev_${randomBytes(6).toString('hex')}`,
    tenantId: held.tenantId,
    email: held.email,
    subject: held.subject,
    name: (phone.name ?? '').trim().slice(0, 80) || 'Phone',
    ...(phone.platform ? { platform: phone.platform } : {}),
    tokenHash: hashDeviceToken(token),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
  };
  devices().push(device);
  return { ok: true, token, device };
}

/** The live device a token belongs to. */
export function deviceForToken(token: string): DeviceRecord | undefined {
  if (!token.startsWith(DEVICE_TOKEN_PREFIX)) return undefined;
  const hash = hashDeviceToken(token);
  return devices().find((d) => d.tokenHash === hash && !d.revokedAt);
}

/** The principal a device acts as: its person, as the workspace knows them now. */
export function devicePrincipal(device: DeviceRecord): Principal | undefined {
  const member = (store.data.memberships ?? []).find((m) => m.tenantId === device.tenantId && m.email.toLowerCase() === device.email.toLowerCase());
  if (!member) return undefined;
  return { subject: member.subject ?? device.subject, email: member.email, ...(member.name ? { name: member.name } : {}), tenantId: member.tenantId, role: member.role };
}

/** Note the phone was seen, at most once an hour so it does not write on every call. */
export function touchDevice(device: DeviceRecord, now = new Date()): boolean {
  if (device.lastSeenAt && now.getTime() - Date.parse(device.lastSeenAt) < 60 * 60 * 1000) return false;
  device.lastSeenAt = now.toISOString();
  return true;
}

export function devicesOf(tenantId: string, email: string): DeviceRecord[] {
  return devices().filter((d) => d.tenantId === tenantId && d.email.toLowerCase() === email.toLowerCase() && !d.revokedAt);
}

export function revokeDevice(tenantId: string, id: string, now = new Date()): DeviceRecord | undefined {
  const device = devices().find((d) => d.tenantId === tenantId && d.id === id && !d.revokedAt);
  if (device) device.revokedAt = now.toISOString();
  return device;
}

/** What is safe to send back about a device. */
export function publicDevice(d: DeviceRecord) {
  return { id: d.id, name: d.name, platform: d.platform, email: d.email, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, push: Boolean(d.pushToken) };
}
