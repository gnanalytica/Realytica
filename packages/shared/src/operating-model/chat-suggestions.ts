/**
 * What waits as a suggestion, where it waits.
 *
 * Whatever the chat, a paper's reading or a model offers waits where it would
 * land, with Accept and Set aside beside it there: a value on its field, a
 * value for a check on the check's field, a finding, an action, a risk or a
 * decision as a suggested row of its register, a fact of the project record
 * beside that fact on Overview. Nothing waits in a list of its own.
 *
 * This reads them back by place: one line for each place, with how many wait
 * there and the page that holds them. A chat's reply says by it where its
 * message's suggestions went (`turnSuggested`); Overview's Needs you counts
 * by it, a place at a time (`suggestionPlaces`); and a chat lists its own
 * by the tag every suggestion carries (`ChatTag`), at the top of the chat,
 * with one button that accepts them all (`chatWaiting`).
 *
 * Cards that have no field or row to wait on (run a valuation, generate a
 * report, change the stage, start a due diligence) are not suggestions in
 * this sense: they wait as cards, where they always have. So does a change
 * to the record that Key facts has no line for (`waitsWhereItLands`).
 */

import { chatPlaceLabel, functionRank, openPlace, placeOfRecord, type ChatPlace, type PlaceOpen } from './chat-places';
import { fieldState } from './check-fields';
import { functionKey, withDepartment, workstreamOfCheck } from './departments';
import { fieldCatalogFor } from './firm-fields';
import { projectFactsWaiting } from './proposal-diff';
import { waitingFieldKeys } from './review';
import { chatSessions } from './sitting';
import { plural } from './text';
import type { ProjectCockpitPane } from './cockpit';
import type { ChatProposal, ChatProposalKind, ChatTag, CheckFieldValue, DdProject, FieldAddress } from './types';

/** The function whose page holds the milestones and their readings. */
const PROGRESS_FN = 'construction.progress';

/** What a suggestion is, as its line counts it. */
export type SuggestionKind = 'value' | 'finding' | 'action' | 'request' | 'risk' | 'decision' | 'change' | 'fact';

/** The cards that wait as a row of their own register, and the register. */
const ROW_CARDS: Partial<Record<ChatProposalKind, { kind: SuggestionKind; pane: ProjectCockpitPane; id: 'findingId' | 'actionId' | 'riskId' | 'item' }>> = {
  add_finding: { kind: 'finding', pane: 'findings', id: 'findingId' },
  add_action: { kind: 'action', pane: 'actions', id: 'actionId' },
  request_evidence: { kind: 'request', pane: 'actions', id: 'actionId' },
  add_risk: { kind: 'risk', pane: 'risks', id: 'riskId' },
  add_decision: { kind: 'decision', pane: 'decisions', id: 'item' },
};

/** A change to a row already on a register waits on that register, by the register its card names. */
const CHANGED_ROW: Record<string, { pane: ProjectCockpitPane; id: 'findingId' | 'actionId' | 'riskId' }> = {
  finding: { pane: 'findings', id: 'findingId' },
  action: { pane: 'actions', id: 'actionId' },
  risk: { pane: 'risks', id: 'riskId' },
};

/** Where a card waits as a row: the register, and what it counts as there. */
export function suggestedRowOf(card: Pick<ChatProposal, 'kind' | 'payload'>): { kind: SuggestionKind; pane: ProjectCockpitPane; id: string } | undefined {
  if (card.kind === 'patch_record') {
    const at = CHANGED_ROW[String(card.payload?.register)];
    return at ? { kind: 'change', ...at } : undefined;
  }
  return ROW_CARDS[card.kind];
}

/** The kinds of card that wait as a suggested row of a register, or as a change on one. */
export const ROW_CARD_KINDS: readonly ChatProposalKind[] = [...(Object.keys(ROW_CARDS) as ChatProposalKind[]), 'patch_record'];

/**
 * Whether a card waits on a field or as a row, and so is shown and decided
 * there: a check's values, a register's row, or a fact of the project record.
 * Any other card waits as a card.
 *
 * A change to the project record waits beside a fact only where Key facts
 * has a line for it (`projectFactsWaiting`). One that names no fact Key
 * facts shows, or would set every fact it names to what the record holds
 * already, has no line there, and so waits as a card where cards wait, with
 * Accept and Set aside: it is never counted where nothing can decide it.
 * With no project, a change to the record is taken to have its line.
 */
export function waitsWhereItLands(card: Pick<ChatProposal, 'kind'> & { id?: string }, project?: DdProject): boolean {
  if (card.kind === 'patch_project') return !project || !card.id || factCardsShown(project).has(card.id);
  return card.kind === 'record_check_fields' || card.kind === 'patch_record' || card.kind in ROW_CARDS;
}

/** The changes to the project record that Key facts shows a line for, by card. */
function factCardsShown(project: DdProject): Set<string> {
  return new Set(projectFactsWaiting(project).map((row) => row.card.id));
}

/** One suggestion: what it is, how many decisions it holds, and where it waits. */
export interface Suggestion {
  kind: SuggestionKind;
  /** The place, as `SuggestionPlace.key`. */
  at: string;
  label: string;
  open: PlaceOpen;
  /** The card it waits on, or the field (`set::record::field`) for a sheet's value. */
  id: string;
  count: number;
  chat?: ChatTag;
  /** The function it waits in, where it is a value. */
  fn?: string;
  /** On a change to the project record: the facts it changes, as Key facts names them ("Owner"). */
  keyFacts?: string[];
}

/** The suggestions waiting in one place. */
export interface SuggestionPlace {
  key: string;
  /** "Legal › Title", "Findings", "the project record". */
  label: string;
  count: number;
  kinds: Partial<Record<SuggestionKind, number>>;
  open: PlaceOpen;
  /** What to light on the page it opens: the cards, by their ids. */
  ids: string[];
  /** On the project record: the facts the changes waiting there change, each once. */
  keyFacts?: string[];
}

/**
 * A chat as its suggestions are told by: the messages it holds, and the
 * sittings they were said in. A chat carried on later is one chat across
 * more than one sitting.
 */
export interface ChatHeld {
  turnIds: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
}

/** Which suggestions are asked for: those of one chat message, of one sitting, of one chat, or all of them. */
export interface SuggestionsOf {
  turnId?: string;
  sessionId?: string;
  chat?: ChatHeld;
}

const tagged = (of: SuggestionsOf | undefined, tag: ChatTag | undefined): boolean =>
  !of
  || (Boolean(tag)
    && (!of.turnId || tag!.turnId === of.turnId)
    && (!of.sessionId || tag!.sessionId === of.sessionId)
    && (!of.chat || of.chat.turnIds.has(tag!.turnId) || (tag!.sessionId !== undefined && of.chat.sessionIds.has(tag!.sessionId))));

/** A function's name with its department, as a line names a place: "Legal › Title". */
export function functionLabel(fn: string): string {
  const label = chatPlaceLabel({ fn });
  return label.includes('›') ? label : withDepartment(fn, label);
}

/** A sheet's place, as the sheets' own links name it. */
function sheetItem(set: string, record: string | undefined, field: string): string {
  return [set, record ?? '', field].join('::');
}

/**
 * How many suggestions wait on one field: the value offered on an empty
 * field, and each offered beside the value held. Two in dispute are a
 * dispute, not a suggestion.
 */
function waitingOn(value: CheckFieldValue | undefined, of: SuggestionsOf | undefined): number {
  if (!value) return 0;
  const state = fieldState(value);
  const own = state === 'proposed' && tagged(of, value.chat) ? 1 : 0;
  const beside = state === 'disputed' ? 0 : (value.other ?? []).filter((other) => tagged(of, other.chat)).length;
  return own + beside;
}

/**
 * Every suggestion waiting on the project, or those `of` one chat message or
 * one chat. A sheet's values are read off the sheets as stored, a check's off
 * its cards, and a register's rows and the project record's facts off theirs.
 */
export function suggestionsOn(project: DdProject, of?: SuggestionsOf, here: ChatPlace = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const catalog = fieldCatalogFor(project);
  for (const [setId, sheet] of Object.entries(project.fieldSheets ?? {})) {
    const set = catalog.sets.get(setId);
    if (!set || catalog.checks.has(setId) || !sheet) continue;
    const holders = [{ record: undefined as string | undefined, values: sheet.values ?? {} }, ...(sheet.records ?? []).filter((record) => !record.removed && !record.issued).map((record) => ({ record: record.id as string | undefined, values: record.values ?? {} }))];
    const page = openPlace(project, { fn: set.fn, section: 'sheet' }, undefined, here);
    for (const holder of holders) {
      for (const [key, value] of Object.entries(holder.values)) {
        const count = waitingOn(value, of);
        if (!count) continue;
        const item = sheetItem(setId, holder.record, key);
        const open: PlaceOpen = page.kind === 'go' ? { pane: page.open.pane, extra: { ...page.open.extra, ...(page.section ? { item } : {}) } } : { pane: 'overview', extra: {} };
        const chat = value.chat ?? value.other?.find((other) => other.chat)?.chat;
        out.push({ kind: 'value', at: `fn:${set.fn}`, label: functionLabel(set.fn), open, id: item, count, fn: set.fn, ...(chat ? { chat } : {}) });
      }
    }
  }
  const checks = new Map(project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => [c.id, c] as const))));
  let facts: ReturnType<typeof projectFactsWaiting> | undefined;
  for (const card of project.chatProposals ?? []) {
    if (card.status !== 'proposed' || !tagged(of, card.chat)) continue;
    const chat = card.chat ? { chat: card.chat } : {};
    if (card.kind === 'record_check_fields') {
      const check = checks.get(String(card.payload.checkId));
      const count = waitingFieldKeys(card).length;
      if (!check || !count) continue;
      const fn = functionKey(workstreamOfCheck(check.definitionId));
      const open = placeOfRecord(project, check.id, here)?.open ?? { pane: 'scope' as const, extra: { checkId: check.id } };
      out.push({ kind: 'value', at: `fn:${fn}`, label: functionLabel(fn), open, id: card.id, count, fn, ...chat });
      continue;
    }
    // A milestone's reading, said in the chat, is a value of the progress board: it waits on Progress, on the milestone's row, and a link opens there.
    if (card.kind === 'patch_record' && card.payload?.register === 'milestone') {
      const page = openPlace(project, { fn: PROGRESS_FN, section: 'progress' }, undefined, here);
      const open: PlaceOpen = page.kind === 'go' ? { pane: page.open.pane, extra: { ...page.open.extra, ...(page.section ? { item: String(card.payload.recordId) } : {}) } } : { pane: 'overview', extra: {} };
      out.push({ kind: 'value', at: `fn:${PROGRESS_FN}`, label: functionLabel(PROGRESS_FN), open, id: card.id, count: 1, fn: PROGRESS_FN, ...chat });
      continue;
    }
    // A change to the record is a suggestion where Key facts shows it, and counted as Key facts shows it. One it has no line for waits as a card.
    if (card.kind === 'patch_project') {
      facts ??= projectFactsWaiting(project);
      const changes = facts.filter((row) => row.card.id === card.id).map((row) => row.label);
      if (changes.length) out.push({ kind: 'fact', at: 'record', label: 'the project record', open: { pane: 'overview', extra: {} }, id: card.id, count: 1, keyFacts: [...new Set(changes)], ...chat });
      continue;
    }
    const row = suggestedRowOf(card);
    if (!row) continue;
    out.push({ kind: row.kind, at: `pane:${row.pane}`, label: chatPlaceLabel({ pane: row.pane }), open: { pane: row.pane, extra: { [row.id]: card.id } }, id: card.id, count: 1, ...chat });
  }
  return out;
}

/** A reading of a milestone waiting to be accepted on its row of Progress: what it reads, and the day it is for. */
export interface WaitingReading {
  card: ChatProposal;
  percent: number;
  on: string;
}

/** The readings waiting on one milestone, the earliest day first: each is accepted or set aside on the milestone's row, as Accept all would. */
export function milestoneReadingsWaiting(project: DdProject, milestoneId: string): WaitingReading[] {
  return (project.chatProposals ?? [])
    .filter((card) => card.status === 'proposed' && card.kind === 'patch_record' && card.payload?.register === 'milestone' && card.payload.recordId === milestoneId && typeof card.payload.percent === 'number' && typeof card.payload.on === 'string')
    .map((card) => ({ card, percent: card.payload.percent as number, on: card.payload.on as string }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/** The order places are said in: the functions as the menu has them, then the registers, then the project record. */
function placeRank(place: Pick<SuggestionPlace, 'key'>): number {
  if (place.key.startsWith('fn:')) return functionRank(place.key.slice(3));
  return place.key === 'record' ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1;
}

/** Suggestions put together by the place they wait in, in the menu's order. A place opens where its first one is. */
export function suggestionPlaces(suggestions: readonly Suggestion[]): SuggestionPlace[] {
  const places = new Map<string, SuggestionPlace>();
  for (const one of suggestions) {
    const held = places.get(one.at);
    if (held) {
      held.count += one.count;
      held.kinds[one.kind] = (held.kinds[one.kind] ?? 0) + one.count;
      if (!one.id.includes('::')) held.ids.push(one.id);
      if (one.keyFacts) held.keyFacts = [...new Set([...(held.keyFacts ?? []), ...one.keyFacts])];
      continue;
    }
    places.set(one.at, { key: one.at, label: one.label, count: one.count, kinds: { [one.kind]: one.count }, open: one.open, ids: one.id.includes('::') ? [] : [one.id], ...(one.keyFacts ? { keyFacts: [...one.keyFacts] } : {}) });
  }
  return [...places.values()].sort((a, b) => placeRank(a) - placeRank(b));
}

const KIND_WORD: Record<SuggestionKind, [string, string]> = {
  value: ['a value', 'values'],
  finding: ['a finding', 'findings'],
  action: ['an action', 'actions'],
  request: ['a request', 'requests'],
  risk: ['a risk', 'risks'],
  decision: ['a decision', 'decisions'],
  change: ['a change', 'changes'],
  fact: ['a change', 'changes'],
};

const KIND_ORDER: SuggestionKind[] = ['value', 'finding', 'risk', 'action', 'request', 'decision', 'change', 'fact'];

/** "a value", "2 findings and a risk". */
function kindsSaid(kinds: SuggestionPlace['kinds']): string {
  const parts = KIND_ORDER.filter((kind) => kinds[kind]).map((kind) => (kinds[kind] === 1 ? KIND_WORD[kind][0] : `${kinds[kind]} ${KIND_WORD[kind][1]}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** Where a change to the project record waits, as a line names the place: beside the fact, on Overview. */
export const KEY_FACTS_PLACE = 'Overview › Key facts';

/** "the owner", "the owner and the city": the facts a change to the record names, as a line says them. */
function factsSaid(facts: readonly string[]): string {
  // "Owner" is "the owner"; a name that opens on capitals, "PIN code", keeps them.
  const named = facts.map((label) => `the ${/^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}`);
  return named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0]!;
}

/** What a reply says of one place its message's suggestions went to: "Suggested 2 values on Legal › Title", "Suggested the owner on Overview › Key facts". */
export function suggestedLine(place: Pick<SuggestionPlace, 'kinds' | 'label' | 'key' | 'keyFacts'>): string {
  if (place.key === 'record') return `Suggested ${place.keyFacts?.length ? factsSaid(place.keyFacts) : kindsSaid(place.kinds)} on ${KEY_FACTS_PLACE}`;
  return `Suggested ${kindsSaid(place.kinds)} on ${place.label}`;
}

/** What Needs you says of one place: "Legal › Title: 3 suggestions". */
export function placeCountSaid(place: Pick<SuggestionPlace, 'label' | 'count' | 'key'>): string {
  return `${place.key === 'record' ? 'The project record' : place.label}: ${plural(place.count, 'suggestion')}`;
}

/** One line under a chat reply: where its message's suggestions went, and the page that opens there. */
export interface TurnSuggested {
  words: string;
  count: number;
  open: PlaceOpen;
  /** The cards to light on that page. */
  ids?: string[];
}

/**
 * Where one chat message's suggestions went, a line for each place, as its
 * reply keeps them. Kept on the reply when it is made, so the reply goes on
 * saying where they went once they are decided; each line still opens the
 * page that holds them.
 */
export function turnSuggested(project: DdProject, tag: ChatTag | undefined, here: ChatPlace = {}, opts: { outside?: boolean } = {}): TurnSuggested[] {
  if (!tag) return [];
  const own = suggestionsOn(project, { turnId: tag.turnId }, here);
  // An outside collaborator is told where only what waits on a sheet in their reach went: a card is the firm's, and their reply says it was sent there.
  return suggestionPlaces(opts.outside ? outsideOwn(own) : own).map((place) => ({
    words: suggestedLine(place),
    count: place.count,
    open: place.open,
    ...(place.ids.length ? { ids: place.ids } : {}),
  }));
}

/** Of a collaborator's suggestions, those on a sheet in their reach: every card they raise is the firm's to accept, on its own registers. */
export function outsideOwn(suggestions: readonly Suggestion[]): Suggestion[] {
  return suggestions.filter((one) => one.id.includes('::'));
}

/**
 * A chat by its id, as the list of chats knows it or as the page sent its
 * sitting: the messages it holds and the sittings they were said in. A
 * sitting nothing has been said in yet is a chat of no messages. Undefined
 * for no id.
 */
export function chatHeld(project: Pick<DdProject, 'conversation'>, chatId: string | undefined): ChatHeld | undefined {
  if (!chatId) return undefined;
  const chat = chatSessions(project.conversation ?? []).find((session) => session.id === chatId || session.turns.some((turn) => turn.sessionId === chatId));
  const turns = chat?.turns ?? [];
  return { turnIds: new Set(turns.map((turn) => turn.id)), sessionIds: new Set([chatId, ...turns.flatMap((turn) => (turn.sessionId ? [turn.sessionId] : []))]) };
}

/** What one chat suggested that still waits: each by itself, by place, and what accepting it takes. */
export interface ChatWaiting {
  suggestions: Suggestion[];
  places: SuggestionPlace[];
  /** The cards it raised that wait on a field or as a row: a check's values, a register's row or change, a fact of the record. */
  cards: string[];
  /** The fields of the sheets where a value it suggested waits on its own. */
  fields: Array<FieldAddress & { fn: string }>;
  /** Its values that wait beside a value a field already holds: a choice between the two, made on the field. */
  beside: number;
}

/**
 * Everything one chat suggested that still waits where it lands: the values
 * on the sheets and on the checks' fields, the facts beside Key facts, the
 * suggested rows and the changes to rows. It is what the top of that chat
 * lists, what its Accept all accepts, and what "approve all" typed in it
 * takes with what the last reply offered: one reading for all three.
 */
export function chatWaiting(project: DdProject, chatId: string | undefined, here: ChatPlace = {}, opts: { outside?: boolean } = {}): ChatWaiting {
  const chat = chatHeld(project, chatId);
  const all = chat ? suggestionsOn(project, { chat }, here) : [];
  const suggestions = opts.outside ? outsideOwn(all) : all;
  const fields: ChatWaiting['fields'] = [];
  const cards: string[] = [];
  let beside = 0;
  for (const one of suggestions) {
    if (!one.id.includes('::')) {
      cards.push(one.id);
      continue;
    }
    const [set, record, field] = one.id.split('::') as [string, string, string];
    const sheet = project.fieldSheets?.[set];
    const value = record ? sheet?.records?.find((held) => held.id === record)?.values?.[field] : sheet?.values?.[field];
    const own = Boolean(value && fieldState(value) === 'proposed' && tagged({ chat }, value.chat));
    if (own && one.fn) fields.push({ fn: one.fn, set, field, ...(record ? { record } : {}) });
    beside += one.count - (own ? 1 : 0);
  }
  return { suggestions, places: suggestionPlaces(suggestions), cards, fields, beside };
}

/** "Legal › Title · 2 values", "Findings · 1 finding and 1 change": a place as the top of a chat lists it. */
export function waitingPlaceLine(place: Pick<SuggestionPlace, 'label' | 'kinds' | 'key'>): string {
  const parts = KIND_ORDER.filter((kind) => place.kinds[kind]).map((kind) => plural(place.kinds[kind]!, KIND_WORD[kind][1].replace(/s$/, ''), KIND_WORD[kind][1]));
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  return `${place.key === 'record' ? 'Key facts' : place.label} · ${said}`;
}

/** What a chat's Accept all did, by kind, and what it left and why. */
export interface ChatAccepted {
  accepted: Partial<Record<SuggestionKind, number>>;
  /** What was not this person's to accept, with the reasons, each once. */
  left: number;
  why: string[];
  /** Values that wait beside a value held: a choice made on the field, and not by Accept all. */
  beside: number;
}

/**
 * The one line the top of a chat says once its Accept all is done: "Accepted
 * 2 values, 1 finding and 1 change." with what was left and why, or "Nothing
 * was accepted." with the reason.
 */
export function chatAcceptedSaid(done: ChatAccepted): string {
  const parts = KIND_ORDER.filter((kind) => done.accepted[kind]).map((kind) => plural(done.accepted[kind]!, KIND_WORD[kind][1].replace(/s$/, ''), KIND_WORD[kind][1]));
  const taken = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return [
    taken ? `Accepted ${taken}.` : 'Nothing was accepted.',
    done.left ? `${done.left === 1 ? 'One is' : `${done.left} are`} left waiting: ${done.why.join(' ')}` : '',
    done.beside ? `${done.beside === 1 ? 'One value waits' : `${done.beside} values wait`} beside the value a field holds, for you to choose on the field.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
