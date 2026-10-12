import { useEffect, useSyncExternalStore } from 'react';
import { fieldCatalogFor, installFirmFields, type DdProject, type FieldCatalog, type FirmFieldPack } from '@realytica/shared';
import { api } from './api';
import { onAuthChange } from './auth';

/**
 * The firm's own fields, in force on this page.
 *
 * A sheet is drawn from the project in hand by the shared model, so the
 * firm's fields have to be in the model's catalog here as they are on the
 * server. The pack is read once, kept, and installed for whichever firm a
 * project names. A screen that draws fields asks `useFirmCatalog` for the
 * catalog, which changes when what is installed changes, and reads its sheet
 * again then.
 */
let pack: FirmFieldPack | null = null;
let inFlight: Promise<void> | null = null;
const firms = new Set<string | undefined>();
const listeners = new Set<() => void>();

function installFor(firm: string | undefined): void {
  if (!pack) return;
  firms.add(firm);
  installFirmFields(firm, pack);
}

/** Puts a pack in force for every firm a project has named so far, and tells the screens that read it. */
export function setFirmFields(next: FirmFieldPack): void {
  pack = next;
  for (const firm of firms) installFirmFields(firm, next);
  listeners.forEach((fn) => fn());
}

function load(): Promise<void> {
  inFlight ??= api
    .firmFields()
    .then((shown) => setFirmFields(shown.pack))
    // With no pack to read the built-in catalog stands, and every built-in field still draws.
    .catch(() => undefined);
  return inFlight;
}

onAuthChange(() => {
  for (const firm of firms) installFirmFields(firm, undefined);
  pack = null;
  inFlight = null;
  firms.clear();
  listeners.forEach((fn) => fn());
});

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/**
 * The catalog a project's fields are read by on this page: the built-in one
 * until the firm's fields have arrived, then the firm's. The same catalog is
 * handed back until what is installed changes, so it is safe to depend on.
 */
export function useFirmCatalog(project: Pick<DdProject, 'tenantId'>): FieldCatalog {
  const firm = project.tenantId;
  const catalog = useSyncExternalStore(subscribe, () => fieldCatalogFor({ tenantId: firm }));
  useEffect(() => {
    if (pack) {
      if (!firms.has(firm)) {
        installFor(firm);
        listeners.forEach((fn) => fn());
      }
      return;
    }
    void load().then(() => {
      installFor(firm);
      listeners.forEach((fn) => fn());
    });
  }, [firm]);
  return catalog;
}
