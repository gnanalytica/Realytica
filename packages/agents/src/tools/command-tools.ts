/**
 * User commands, issued through chat.
 *
 * The cockpit's authorship law: a command the PERSON gives through chat
 * ("mark the soil report received", "close that risk", "open compliance")
 * executes directly — chat is an input method and the actor is the person —
 * while a conclusion the MODEL authors always goes through propose-and-review
 * (propose-tools.ts). These tools are the acting half of that law, and the
 * system prompt binds them to it: a command tool may only be called for an
 * action the person explicitly asked for in their own words, never because
 * the model thinks the action would be a good idea.
 *
 * Same collector discipline as propose-tools: `run()` validates against the
 * case and pushes a typed command onto an array the caller owns — the agents
 * package still touches no store. The API route applies the collected
 * commands and saves. Validation is complete at collection time (every id is
 * checked against the case handed to this turn), so application cannot fail;
 * the command vocabulary is a closed set of small, reversible mutations —
 * status toggles, checklist marks, a reclassification — never a delete and
 * never money.
 */

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { DD_DOMAIN_KEYS, DOCUMENT_KINDS, technicalDocumentItem } from '@realytica/shared';
import type { DocumentKind, PropertyCase, RiskStatus, TechnicalFindingReviewState } from '@realytica/shared';

export type CopilotCommand =
  | { kind: 'mark_technical_document'; itemId: string; provided: boolean }
  | { kind: 'set_risk_status'; riskId: string; status: RiskStatus }
  | { kind: 'set_action_done'; actionId: string; done: boolean }
  | { kind: 'review_technical_finding'; findingId: string; decision: Exclude<TechnicalFindingReviewState, 'proposed'> }
  | { kind: 'set_document_kind'; documentId: string; docKind: DocumentKind };

export interface CopilotNavigation {
  /** A key `goToTab` understands — group, or group?view=view. Closed set below. */
  target: string;
}

const RISK_STATUSES = ['open', 'mitigated', 'accepted'] as const;

/**
 * Every place chat can send the reader. A closed list rather than free text,
 * because a navigation target is rendered into the app's own URL space.
 */
const VIEW_TARGETS = [
  'chat',
  'overview',
  'overview?view=risks',
  'overview?view=technical',
  'diligence',
  ...DD_DOMAIN_KEYS.map(d => `diligence?view=${d}`),
  'diligence?view=graph',
  'value',
  'value?view=offer',
  'legal',
  'legal?view=compliance',
  'legal?view=constraints',
  'documents',
  'documents?view=evidence',
  'report',
  'report?view=actions',
] as const;

export function createCommandTools(
  caseData: PropertyCase,
  commands: CopilotCommand[],
  navigations: CopilotNavigation[],
) {
  const markTechnicalDocument = betaTool({
    name: 'mark_technical_document',
    description:
      'USER COMMAND — call only when the analyst explicitly asked to mark a technical DD checklist document as received or not received ' +
      '(e.g. "mark the soil report received"). Executes directly: the analyst is the actor, you are the input method. Item ids come from ' +
      'get_technical_document_status. Never call this on your own initiative.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['itemId', 'provided'],
      properties: {
        itemId: { type: 'string', description: 'The checklist item id, from get_technical_document_status.' },
        provided: { type: 'boolean', description: 'true = received/on file, false = not received.' },
      },
    } as const,
    run: async ({ itemId, provided }) => {
      const item = technicalDocumentItem(itemId);
      if (!item) return JSON.stringify({ error: `"${itemId}" is not a checklist item id. Check get_technical_document_status.` });
      commands.push({ kind: 'mark_technical_document', itemId, provided });
      return JSON.stringify({ done: true, item: item.label, provided });
    },
  });

  const setRiskStatus = betaTool({
    name: 'set_risk_status',
    description:
      'USER COMMAND — call only when the analyst explicitly asked to change a risk\'s status (e.g. "mark the flood risk mitigated"). ' +
      'Executes directly. Risk ids come from the case context or get_subgraph. Never call this on your own initiative — if YOU think a ' +
      'risk should change status, say so in your answer and let the person decide.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['riskId', 'status'],
      properties: {
        riskId: { type: 'string' },
        status: { type: 'string', enum: [...RISK_STATUSES] },
      },
    } as const,
    run: async ({ riskId, status }) => {
      const risk = (caseData.result?.risks ?? []).find(r => r.id === riskId);
      if (!risk) return JSON.stringify({ error: `"${riskId}" is not a risk id on this case.` });
      if (!(RISK_STATUSES as readonly string[]).includes(status)) {
        return JSON.stringify({ error: `"${status}" is not a recognised status.` });
      }
      commands.push({ kind: 'set_risk_status', riskId, status: status as RiskStatus });
      return JSON.stringify({ done: true, risk: risk.title, status });
    },
  });

  const setActionDone = betaTool({
    name: 'set_action_done',
    description:
      'USER COMMAND — call only when the analyst explicitly said a recommended action is done (or should be reopened). Executes directly. ' +
      'Never call this on your own initiative.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['actionId', 'done'],
      properties: {
        actionId: { type: 'string' },
        done: { type: 'boolean' },
      },
    } as const,
    run: async ({ actionId, done }) => {
      const action = (caseData.result?.actions ?? []).find(a => a.id === actionId);
      if (!action) return JSON.stringify({ error: `"${actionId}" is not an action id on this case.` });
      commands.push({ kind: 'set_action_done', actionId, done });
      return JSON.stringify({ done: true, action: action.title, marked: done ? 'done' : 'open' });
    },
  });

  const reviewTechnicalFinding = betaTool({
    name: 'review_technical_finding',
    description:
      'USER COMMAND — call only when the analyst explicitly accepted or rejected a PROPOSED technical finding by name (e.g. "accept the ' +
      'busduct finding"). Executes directly: accepting is the person\'s review act, spoken instead of clicked. Only findings whose ' +
      'reviewState is "proposed" can be reviewed — check get_technical_findings. NEVER accept a finding you yourself proposed this turn.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['findingId', 'decision'],
      properties: {
        findingId: { type: 'string' },
        decision: { type: 'string', enum: ['accepted', 'rejected'] },
      },
    } as const,
    run: async ({ findingId, decision }) => {
      const finding = (caseData.technicalFindings ?? []).find(f => f.id === findingId);
      if (!finding) return JSON.stringify({ error: `"${findingId}" is not a finding id on this case.` });
      if (finding.reviewState !== 'proposed') {
        return JSON.stringify({ error: `That finding is already ${finding.reviewState}, not awaiting review.` });
      }
      if (decision !== 'accepted' && decision !== 'rejected') {
        return JSON.stringify({ error: `"${decision}" is not a recognised decision.` });
      }
      commands.push({ kind: 'review_technical_finding', findingId, decision });
      return JSON.stringify({ done: true, observation: finding.observation, decision });
    },
  });

  const setDocumentKind = betaTool({
    name: 'set_document_kind',
    description:
      'USER COMMAND — call only when the analyst explicitly asked to reclassify a document (e.g. "that file is actually the mother deed"). ' +
      'Executes directly; reclassifying also re-routes the document to the departments its new kind feeds and re-extracts its fields. ' +
      'Document ids come from get_document_fields. Never call this on your own initiative — if a classification looks wrong to you, say so.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId', 'documentKind'],
      properties: {
        documentId: { type: 'string' },
        documentKind: { type: 'string', enum: [...DOCUMENT_KINDS] },
      },
    } as const,
    run: async ({ documentId, documentKind }) => {
      const doc = caseData.documents.find(d => d.id === documentId);
      if (!doc) return JSON.stringify({ error: `"${documentId}" is not a document id on this case.` });
      if (!(DOCUMENT_KINDS as readonly string[]).includes(documentKind)) {
        return JSON.stringify({ error: `"${documentKind}" is not a recognised document kind.` });
      }
      commands.push({ kind: 'set_document_kind', documentId, docKind: documentKind as DocumentKind });
      return JSON.stringify({ done: true, file: doc.fileName, kind: documentKind });
    },
  });

  const openView = betaTool({
    name: 'open_view',
    description:
      'USER COMMAND — call only when the analyst asked to go somewhere ("open compliance", "show me the graph", "take me to the ' +
      'documents"). Navigation only; changes nothing on the case. The app opens the view after your answer.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: {
        target: { type: 'string', enum: [...VIEW_TARGETS], description: 'Where to send the reader.' },
      },
    } as const,
    run: async ({ target }) => {
      if (!(VIEW_TARGETS as readonly string[]).includes(target)) {
        return JSON.stringify({ error: `"${target}" is not a view this app has.` });
      }
      navigations.push({ target });
      return JSON.stringify({ done: true, opening: target });
    },
  });

  return [markTechnicalDocument, setRiskStatus, setActionDone, reviewTechnicalFinding, setDocumentKind, openView];
}
