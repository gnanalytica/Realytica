/**
 * A firm's own fields, kept at firm level.
 *
 * One document for each firm, beside its law-watch list: the fields and
 * lists it has added to the built-in sets, and the built-in fields it folds
 * as expert (`firm-fields.ts` in the shared model says what a firm may do).
 * It is not kept on a project, so every project of the firm reads the same
 * catalog, and a project copied to another firm takes none of it along.
 *
 * The pack is installed into the shared model for the firm it belongs to,
 * and every reader of a project's fields then gets that firm's catalog
 * (`fieldCatalogFor`). A serverless instance reads it on its first request
 * for the firm and again after a short while, so a change saved on one
 * instance reaches the others without a deploy.
 */

import { EMPTY_FIRM_FIELDS, firmFieldsHeld, firmRuleRows, installFirmFields, installFirmRuleRows, type FirmFieldPack, type LawRuleRowOffer } from '@realytica/shared';
import type { NextFunction, Request, Response } from 'express';
import { loadLawWatch } from './law-watch';
import { storageAdapter } from './storage';
import { store } from './store';

const folder = (tenantId: string): string => `firm-fields-${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
const PACK_KEY = 'fields.json';
/** How long an instance trusts the pack it last read. */
const FRESH_MS = 60_000;

const read = new Map<string, number>();

/** The firm's pack as it is kept, or an empty one. */
export async function loadFirmFields(tenantId: string): Promise<FirmFieldPack> {
  const bytes = await storageAdapter.getDocument(folder(tenantId), PACK_KEY);
  if (!bytes) return EMPTY_FIRM_FIELDS;
  try {
    return firmFieldsHeld(JSON.parse(bytes.toString('utf-8')));
  } catch {
    return EMPTY_FIRM_FIELDS;
  }
}

/** Puts a firm's pack in force for its projects on this instance. A project that names no firm is the first firm's. */
function install(tenantId: string, pack: FirmFieldPack): void {
  installFirmFields(tenantId, pack);
  if (store.data.tenants?.[0]?.id === tenantId) installFirmFields(undefined, pack);
  read.set(tenantId, Date.now());
}

export async function saveFirmFields(tenantId: string, pack: FirmFieldPack): Promise<void> {
  await storageAdapter.putDocument(folder(tenantId), PACK_KEY, Buffer.from(JSON.stringify(pack)), 'application/json');
  install(tenantId, pack);
}

/**
 * Puts a firm's own rule rows in force for its projects on this instance:
 * the rows its law watch offered and a named person verified. With none
 * verified, the built-in table stands.
 */
export function installLawRuleRows(tenantId: string, offers: readonly LawRuleRowOffer[] | undefined): void {
  const rows = firmRuleRows(offers);
  installFirmRuleRows(tenantId, rows);
  if (store.data.tenants?.[0]?.id === tenantId) installFirmRuleRows(undefined, rows);
}

/** Makes sure the firm's pack and its rule rows are in force here, reading them again where they were last read a while ago. */
export async function ensureFirmFields(tenantId: string): Promise<void> {
  const at = read.get(tenantId);
  if (at !== undefined && Date.now() - at < FRESH_MS) return;
  const [pack, offers] = await Promise.all([loadFirmFields(tenantId), loadLawWatch(tenantId).then((state) => state.offeredRows ?? [], () => [])]);
  install(tenantId, pack);
  installLawRuleRows(tenantId, offers);
}

/**
 * Before any route that reads a project's fields: the caller's firm's pack is
 * in force. A request nobody is signed in on has no firm and passes through;
 * a pack that cannot be read leaves the built-in catalog in force and the
 * request still answers.
 */
export function withFirmFields(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = req.principal?.tenantId;
  if (!tenantId) {
    next();
    return;
  }
  ensureFirmFields(tenantId).then(
    () => next(),
    () => next(),
  );
}
