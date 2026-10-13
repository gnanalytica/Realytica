/**
 * A model's proposal as fields, worded by template.
 *
 * A model that proposes a card (a finding, a risk, an action, a check's
 * result) does not write its title, its reason or its description. It says
 * what kind of card, what the card is about (fields by address, records by
 * id), and picks a concern or a next step off a list. Code looks up what it
 * is about on the record and makes the words: the title from the pick and
 * the record's own names, the description from the record's values with
 * where each stands and its source, the severity and the next step from a
 * table. Any sentence a model puts in the card's payload is taken out.
 *
 * A card is still only a proposal: a person accepts it before anything is
 * on the project, and may change its words then as their own.
 *
 * Pure.
 */

import { chatAnswerCard, chatPicksFrom, CHAT_STANDING_LABEL, type ChatAnswerRow } from './chat-answer';
import type { ChatProposalKind, DdProject, FindingSeverity } from './types';

/** What a proposed finding or risk is concerned with. A fixed list, each with how grave it is taken to be and what to do next. */
export const PROPOSAL_CONCERNS = ['value_missing', 'values_disagree', 'paper_missing', 'approval_missing_or_lapsed', 'date_cannot_be_right', 'cost_unexplained', 'condition_seen_on_site', 'deadline_at_risk', 'not_as_the_rule_requires'] as const;
export type ProposalConcern = (typeof PROPOSAL_CONCERNS)[number];

export const PROPOSAL_CONCERN_TABLE: Record<ProposalConcern, { label: string; severity: FindingSeverity; next: string }> = {
  value_missing: { label: 'A value is missing', severity: 'medium', next: 'Fill the value from its paper.' },
  values_disagree: { label: 'Two values disagree', severity: 'high', next: 'Correct the value that is wrong.' },
  paper_missing: { label: 'A paper is missing', severity: 'medium', next: 'Ask for the paper.' },
  approval_missing_or_lapsed: { label: 'An approval is missing or lapsed', severity: 'high', next: 'Apply for the approval, or renew it.' },
  date_cannot_be_right: { label: 'A date cannot be right', severity: 'medium', next: 'Correct the date from its paper.' },
  cost_unexplained: { label: 'Cost moved without a reason', severity: 'medium', next: 'Record the reason against the package.' },
  condition_seen_on_site: { label: 'A condition seen on site', severity: 'medium', next: 'Inspect it on site.' },
  deadline_at_risk: { label: 'A deadline is at risk', severity: 'medium', next: 'Name who it is on and the day it is due.' },
  not_as_the_rule_requires: { label: 'Not as the rule requires', severity: 'high', next: 'Check the value against the rule.' },
};

/** What a proposed action asks somebody to do. A fixed list. */
export const PROPOSAL_NEXT = ['get_the_paper', 'fill_the_value', 'correct_the_value', 'inspect_on_site', 'renew_the_approval', 'record_the_reason', 'name_an_owner', 'decide', 'follow_up'] as const;
export type ProposalNext = (typeof PROPOSAL_NEXT)[number];
export const PROPOSAL_NEXT_LABEL: Record<ProposalNext, string> = {
  get_the_paper: 'Get the paper',
  fill_the_value: 'Fill the value',
  correct_the_value: 'Correct the value',
  inspect_on_site: 'Inspect on site',
  renew_the_approval: 'Renew the approval',
  record_the_reason: 'Record the reason',
  name_an_owner: 'Name who it is on',
  decide: 'Decide',
  follow_up: 'Follow up',
};

/** What a card of each kind does when a person accepts it, said once. */
const KIND_SAID: Partial<Record<ChatProposalKind, { label: string; impact: string }>> = {
  add_finding: { label: 'Finding', impact: 'A finding is added to the register when a person accepts this.' },
  add_risk: { label: 'Risk', impact: 'A risk is added to the register when a person accepts this.' },
  add_action: { label: 'Action', impact: 'An action is added when a person accepts this.' },
  add_decision: { label: 'Decision to make', impact: 'A decision is put on the register for a person to make.' },
  record_check: { label: 'Check result', impact: 'The check’s result is recorded when a person accepts this.' },
  record_check_fields: { label: 'Check values', impact: 'The values are recorded on the check when a person accepts this.' },
  request_evidence: { label: 'Paper to ask for', impact: 'A paper is put on the register as asked for.' },
  request_documents: { label: 'Papers to ask for', impact: 'The papers are put on the register as asked for.' },
};

/** The members of a payload that are sentences. A model's are taken out; code writes the ones a kind needs. */
export const PROPOSAL_SENTENCE_KEYS = ['description', 'cause', 'mitigation', 'comments', 'rationale', 'recommendation', 'text', 'conditions', 'notes', 'impact', 'why', 'reason', 'body', 'heading', 'summary'] as const;

/** The kinds whose title is the name of a thing to make (a paper to ask for, an asset, a report): a name, capped, and not a sentence. */
const NAMED_KINDS: readonly ChatProposalKind[] = ['request_evidence', 'request_documents', 'add_asset', 'add_scope', 'start_dd', 'generate_report', 'assign_document'];

export const PROPOSAL_NAME_MOST = 80;

const rowSaid = (row: ChatAnswerRow): string => `${row.label}: ${row.value} (${[CHAT_STANDING_LABEL[row.standing], row.source ? `${row.source.label}${row.source.page ? `, page ${row.source.page}` : ''}` : ''].filter(Boolean).join('; ')})`;

export interface ProposalPicks {
  kind: ChatProposalKind;
  about: unknown;
  concern?: unknown;
  next?: unknown;
}

export interface StructuredProposal {
  title: string;
  rationale: string;
  impact: string;
  payload: Record<string, unknown>;
}

/**
 * The card a model's picks make. `payload` is what the model sent for the
 * kind: its keys and values are kept (an id, an enum, a figure, a field's
 * value), and every sentence in it is taken out and, where the kind needs
 * one, written here. Returns an error where the picks name nothing on the
 * record for a kind that has to be about something.
 */
export function structuredProposal(project: DdProject, picks: ProposalPicks, payload: Record<string, unknown>): StructuredProposal | { error: string } {
  const about = (picks.about && typeof picks.about === 'object' ? picks.about : {}) as { fields?: unknown; records?: unknown };
  const card = chatAnswerCard(project, chatPicksFrom({ outcome: 'answered', fields: about.fields, records: about.records, facts: [], passages: [], look_at: { fields: about.fields } }));
  const names = [...card.rows.map((row) => (row.kind === 'record' ? row.value.split(' · ')[0]! : row.label)), ...card.look.map((item) => item.label)];
  const rests = [...card.rows.map(rowSaid), ...card.look.map((item) => `${item.label}: not filled`)];
  const subject = names.slice(0, 3).join('; ');
  const said = KIND_SAID[picks.kind] ?? { label: picks.kind.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase()), impact: 'It is done when a person accepts this.' };
  const clean: Record<string, unknown> = Object.fromEntries(Object.entries(payload).filter(([key, value]) => !(PROPOSAL_SENTENCE_KEYS as readonly string[]).includes(key) && !(typeof value === 'string' && /[.!?]\s+\S/.test(value))));
  const rationale = rests.length ? `Rests on: ${rests.join('; ')}.` : 'Rests on nothing named on the record.';

  if (picks.kind === 'add_finding' || picks.kind === 'add_risk') {
    const concern = PROPOSAL_CONCERNS.find((known) => known === picks.concern);
    if (!concern) return { error: `Give a concern off the list: ${PROPOSAL_CONCERNS.join(', ')}.` };
    if (!names.length) return { error: 'Say what it is about: the address of a field from get_fields, or the id of a record. A finding about nothing on the record is not proposed.' };
    const row = PROPOSAL_CONCERN_TABLE[concern];
    const title = `${row.label}: ${subject}`;
    return {
      title,
      rationale,
      impact: said.impact,
      payload: {
        ...clean,
        title,
        ...(picks.kind === 'add_risk' ? { cause: rationale, materiality: row.severity, mitigation: row.next } : { description: rationale, severity: row.severity }),
        structured: { kind: picks.kind === 'add_risk' ? 'risk' : 'finding', concern, entries: [...card.rows.flatMap((item) => item.recordId ?? (item.address ? `${item.address.set}::${item.address.field}` : [])), ...card.look.flatMap((item) => (item.address ? `${item.address.set}::${item.address.field}` : []))], severity: row.severity, next: row.next },
      },
    };
  }
  if (picks.kind === 'add_action' || picks.kind === 'add_decision') {
    const next = PROPOSAL_NEXT.find((known) => known === picks.next) ?? (picks.kind === 'add_decision' ? 'decide' : undefined);
    if (!next) return { error: `Give a next step off the list: ${PROPOSAL_NEXT.join(', ')}.` };
    if (!names.length) return { error: 'Say what it is about: the address of a field from get_fields, or the id of a record.' };
    const title = `${PROPOSAL_NEXT_LABEL[next]}: ${subject}`;
    return { title, rationale, impact: said.impact, payload: { ...clean, title, ...(picks.kind === 'add_action' ? { description: rationale } : { rationale }), structured: { kind: picks.kind === 'add_action' ? 'action' : 'decision', next } } };
  }
  if (picks.kind === 'record_check') {
    // What supports a result is the record's own lines, never a model's account of them.
    return { title: `${said.label}${subject ? `: ${subject}` : ''}`, rationale, impact: said.impact, payload: { ...clean, comments: rationale, structured: { kind: 'check_comment' } } };
  }
  if (picks.kind === 'edit_report' && ('text' in payload || 'heading' in payload)) return { error: 'A report’s words are a person’s or are read from the registers. Propose a change of what a section reads (source), not text.' };
  // A thing to make by its name: the name is kept, capped, where it is a name and not a sentence.
  const name = typeof payload.title === 'string' ? payload.title.replace(/\s+/g, ' ').trim() : '';
  const named = NAMED_KINDS.includes(picks.kind) && name && name.length <= PROPOSAL_NAME_MOST && !/[.!?]\s+\S/.test(name) ? name : '';
  return { title: `${said.label}${named ? `: ${named}` : subject ? `: ${subject}` : ''}`, rationale, impact: said.impact, payload: { ...clean, ...(named ? { title: named } : {}) } };
}
