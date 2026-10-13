/**
 * Correcting the project's parties: a name put right, two records that are
 * one party made one, and a party taken off the list.
 *
 * A party is a shared record (`shared.parties`), and other things point at
 * it two ways. A field that links to a party holds the record's id. A paper
 * owed and a Cost Report's row name who they mean in words, picked from the
 * same list. So a name put right is put right in those words too, and a
 * merge moves every link and every name from the duplicate to the party
 * that is kept. Nothing is rewritten on a Cost Report that was issued: it is
 * the paper as it was sent.
 *
 * A party is removed only while nothing refers to it. Where something does,
 * the refusal says what, so the person can merge it into the right party or
 * take the reference off first.
 */

import { fieldStands } from './check-fields';
import { costReportsOf } from './cost-report';
import { SHARED_RECORD_SETS } from './field-sets/shared-records';
import { FieldRefused, removeFieldRecord, setFieldValues, type FieldWriteOptions } from './field-sheets';
import { fieldCatalogFor } from './firm-fields';
import type { FieldCatalog } from './field-registry';
import { recordAuditEvent } from './operations';
import type { CheckFieldValue, DdProject, FieldRecord } from './types';

const PARTIES = SHARED_RECORD_SETS.party;
const fold = (text: string | undefined): string => (text ?? '').normalize('NFD').replace(/\p{M}+/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

function partyRecord(project: DdProject, partyId: string): FieldRecord {
  const record = project.fieldSheets?.[PARTIES]?.records?.find((held) => held.id === partyId && !held.removed);
  if (!record) throw new FieldRefused('That party is not on this project.');
  return record;
}

const nameOf = (record: FieldRecord): string => {
  const value = record.values.name;
  return value && fieldStands(value) && typeof value.value === 'string' ? value.value.replace(/\s+/g, ' ').trim() : '';
};

/** Every value on the project's sheets and records, with the set it is on, but for one record of the parties themselves. */
function* valuesOf(project: DdProject, butRecord: string): Generator<{ set: string; value: CheckFieldValue }> {
  for (const [set, sheet] of Object.entries(project.fieldSheets ?? {})) {
    for (const value of Object.values(sheet.values ?? {})) yield { set, value };
    for (const record of sheet.records ?? []) {
      if (record.removed || (set === PARTIES && record.id === butRecord)) continue;
      for (const value of Object.values(record.values)) yield { set, value };
    }
  }
}

const linksTo = (value: CheckFieldValue, partyId: string): boolean => value.value === partyId || (Array.isArray(value.value) && (value.value as unknown[]).includes(partyId));

/** What refers to a party, a line to a kind of thing, each with how many: links from fields by the sheet they are on, papers owed that name it, rows of a Cost Report awarded to it. */
export function partyReferences(project: DdProject, partyId: string, catalog: FieldCatalog = fieldCatalogFor(project)): Array<{ what: string; count: number }> {
  const record = partyRecord(project, partyId);
  const name = fold(nameOf(record));
  const out = new Map<string, number>();
  const add = (what: string): void => void out.set(what, (out.get(what) ?? 0) + 1);
  for (const { set, value } of valuesOf(project, partyId)) if (linksTo(value, partyId)) add(`a link from ${catalog.sets.get(set)?.title ?? 'a sheet'}`);
  if (name) {
    for (const item of project.checklist ?? []) if (fold(item.owedBy) === name) add('a paper owed that names it');
    for (const report of costReportsOf(project)) for (const row of report.rows) if (fold(row.awardedTo) === name) add(`a row of the ${report.label} Cost Report awarded to it`);
  }
  return [...out].map(([what, count]) => ({ what, count }));
}

/** The references in words: "3 papers owed that name it, and a link from Tender terms". */
function referencesSaid(refs: ReadonlyArray<{ what: string; count: number }>): string {
  const parts = refs.map((ref) => (ref.count === 1 ? ref.what : `${ref.count} ${ref.what.replace(/^a (link|paper|row)/, (_, word: string) => `${word}s`).replace('papers owed that names it', 'papers owed that name it')}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** The name carried into the words that name a party: papers owed, and the rows of Cost Reports still in draft. */
function renameInWords(project: DdProject, was: string, now: string): number {
  if (!fold(was) || was === now) return 0;
  let moved = 0;
  for (const item of project.checklist ?? []) {
    if (fold(item.owedBy) !== fold(was)) continue;
    item.owedBy = now;
    moved += 1;
  }
  for (const report of costReportsOf(project)) {
    if (report.status !== 'draft') continue;
    for (const row of report.rows) {
      if (fold(row.awardedTo) !== fold(was)) continue;
      row.awardedTo = now;
      moved += 1;
    }
  }
  return moved;
}

/**
 * Put a party's name right. The record keeps its id, so every field that
 * links to it follows; the papers owed and draft Cost Report rows that name
 * it in words are given the new name. Refused where another party already
 * has that name: those two are one party, and are merged.
 */
export function renameParty(project: DdProject, partyId: string, name: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): { name: string; moved: number } {
  const record = partyRecord(project, partyId);
  const next = name.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!next) throw new FieldRefused('A party needs a name.');
  const was = nameOf(record);
  if (was === next) return { name: next, moved: 0 };
  const twin = (project.fieldSheets?.[PARTIES]?.records ?? []).find((held) => held.id !== partyId && !held.removed && fold(nameOf(held)) === fold(next));
  if (twin) throw new FieldRefused(`Another party is already called ${nameOf(twin)}. If they are the same party, merge the two.`);
  const out = setFieldValues(project, { set: PARTIES, record: partyId }, { name: next }, actor, options, catalog);
  if (out.rejected.length) throw new FieldRefused(out.rejected.map((held) => held.error).join(' '));
  // A name that was accepted from a paper is not typed over: the two stand side by side until a lead or signer keeps one.
  if (nameOf(partyRecord(project, partyId)) !== next) throw new FieldRefused('This name was accepted from a paper, so the new one waits beside it. A lead or signer keeps one of the two on the party’s record.');
  const moved = renameInWords(project, was, next);
  recordAuditEvent(project, { actor, action: 'rename_party', entityType: 'field_set', entityId: `${PARTIES}::${partyId}`, oldValue: was, newValue: next });
  return { name: next, moved };
}

/**
 * Make two party records one: every link and every name that pointed at the
 * duplicate points at the party kept, the roles of both are the kept
 * party's, and the duplicate is taken off the list. For a lead or signer,
 * since it takes a record off.
 */
export function mergeParties(project: DdProject, keepId: string, duplicateId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): { name: string; moved: number } {
  if (keepId === duplicateId) throw new FieldRefused('Pick the other party to merge it with.');
  const keep = partyRecord(project, keepId);
  const duplicate = partyRecord(project, duplicateId);
  const [name, was] = [nameOf(keep), nameOf(duplicate)];
  if (!name) throw new FieldRefused('The party kept needs a name that stands.');
  let moved = 0;
  for (const { value } of valuesOf(project, duplicateId)) {
    if (value.value === duplicateId) {
      value.value = keepId;
      moved += 1;
    } else if (Array.isArray(value.value) && (value.value as unknown[]).includes(duplicateId)) {
      value.value = [...new Set((value.value as string[]).map((held) => (held === duplicateId ? keepId : held)))];
      moved += 1;
    }
  }
  moved += renameInWords(project, was, name);
  const roles = (record: FieldRecord): string[] => (Array.isArray(record.values.roles?.value) ? (record.values.roles!.value as unknown[]).filter((role): role is string => typeof role === 'string') : []);
  const both = [...new Set([...roles(keep), ...roles(duplicate)])];
  if (both.length > roles(keep).length) {
    const out = setFieldValues(project, { set: PARTIES, record: keepId }, { roles: both }, actor, options, catalog);
    if (out.rejected.length) throw new FieldRefused(out.rejected.map((held) => held.error).join(' '));
  }
  removeFieldRecord(project, PARTIES, duplicateId, actor, options, catalog);
  recordAuditEvent(project, { actor, action: 'merge_parties', entityType: 'field_set', entityId: `${PARTIES}::${keepId}`, oldValue: was, newValue: name });
  return { name, moved };
}

/** Take a party off the list. Refused, with what refers to it, while anything does. */
export function removeParty(project: DdProject, partyId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): void {
  const record = partyRecord(project, partyId);
  const refs = partyReferences(project, partyId, catalog);
  if (refs.length) throw new FieldRefused(`${nameOf(record) || 'This party'} cannot be removed while ${referencesSaid(refs)} ${refs.length === 1 && refs[0]!.count === 1 ? 'refers' : 'refer'} to it. Merge it into the right party, or take ${refs.length === 1 && refs[0]!.count === 1 ? 'that' : 'those'} off first.`);
  removeFieldRecord(project, PARTIES, partyId, actor, options, catalog);
}
