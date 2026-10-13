import type { DepartmentKey, LawChange, LawChangeFields, LawProposedAction, LawRuleRowOffer, LawSource, LawSourceInput, RuleRowGroup, RuleRowListed } from '@realytica/shared';
import { request } from './api';

/**
 * The calls for the firm's law and policy watch. Every change answers with
 * the watch as the record holds it afterwards, and what this person may do.
 */

export interface LawWaiting extends LawChange {
  /** The projects the source bears on, each with the departments this person may put an action under. */
  bearsOn: Array<{ id: string; name: string; departments: DepartmentKey[] }>;
  /** Whether this person may decide it now: a firm admin, or a lead while a project they lead still waits. */
  mayDecide: boolean;
}

export interface LawWatchShown {
  sources: LawSource[];
  waiting: LawWaiting[];
  decided: LawChange[];
  /** Rule rows confirmed changes offered, each unverified until a firm admin marks it verified. */
  offeredRows?: LawRuleRowOffer[];
  /** Whether a model is set up to fill a change's fields. */
  model: boolean;
  mayManage: boolean;
  mayReview: boolean;
  /** A line for the person, after a look. */
  said?: string;
}

/** Every rule row the firm's projects read, by the department whose fields read it. */
export interface RuleRowsShown {
  groups: RuleRowGroup[];
  total: number;
  verified: number;
  /** Whether this person may mark a row checked: a firm admin. */
  mayCheck: boolean;
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) });

export const lawWatchApi = {
  open: () => request<LawWatchShown>('/law-watch'),
  add: (input: LawSourceInput) => request<LawWatchShown>('/law-watch/sources', send('POST', input)),
  change: (sourceId: string, input: LawSourceInput & { paused?: boolean }) => request<LawWatchShown>(`/law-watch/sources/${sourceId}`, send('PUT', input)),
  remove: (sourceId: string) => request<LawWatchShown>(`/law-watch/sources/${sourceId}`, { method: 'DELETE' }),
  look: (sourceId: string) => request<LawWatchShown>(`/law-watch/sources/${sourceId}/look`, send('POST')),
  pages: (changeId: string) => request<{ before: string; after: string }>(`/law-watch/changes/${changeId}/pages`),
  confirm: (changeId: string, fields: LawChangeFields, projects: Array<{ projectId: string; actions: LawProposedAction[] }>) => request<LawWatchShown>(`/law-watch/changes/${changeId}/confirm`, send('POST', { fields, projects })),
  verifyRow: (offerId: string) => request<LawWatchShown>(`/law-watch/rule-rows/${offerId}/verify`, send('POST')),
  ruleRows: () => request<RuleRowsShown>('/law-watch/rule-rows'),
  /** Marks a row checked against its instrument: the clause the figure was read in and the day it was read. */
  checkRuleRow: (body: { row: RuleRowListed['ref']; clause: string; readOn: string }) => request<RuleRowsShown>('/law-watch/rule-rows/check', send('POST', body)),
  dismiss: (changeId: string, why?: string) => request<LawWatchShown>(`/law-watch/changes/${changeId}/dismiss`, send('POST', why ? { why } : {})),
};
