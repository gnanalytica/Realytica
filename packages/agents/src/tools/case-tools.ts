/**
 * Read-only tools over a single case, bound at construction time.
 *
 * Every tool here answers a question about the case as it already stands —
 * evidence, comparables, compliance checks, risks, anchors, extracted fields,
 * the locality reference row. None of them recompute anything the
 * deterministic engine already produced, and none of them can mutate the
 * case: there is no `update_*` / `set_*` tool in this file, on purpose. The
 * copilot's job is to read and explain what is already on record, never to
 * re-derive or overwrite it (see `AgentKind` in `packages/shared/src/types.ts`).
 *
 * `createCaseTools(caseData, refData)` returns a fresh set of tools closed
 * over that one case, so a run never accidentally reaches another case's
 * data and the tools need no case id argument from the model.
 *
 * These are built with `betaTool()` (raw JSON Schema) rather than
 * `betaZodTool()` (Zod schema): the SDK's `betaZodTool` calls `z.toJSONSchema`
 * internally, which is a Zod v4 API, and this workspace is pinned to Zod v3
 * (`^3.24.1`) — with it, `betaZodTool` throws `z.toJSONSchema is not a
 * function` at tool-construction time, verified against the installed
 * versions in this repo. `betaTool()` has no Zod dependency at all, so it
 * works with the Zod actually installed here. `betaTool()` does not expose a
 * `strict` option, so — unlike the API-enforced schema on a `strict: true`
 * tool — a malformed model input can still reach `run()` here; each `run()`
 * below guards its optional/enum inputs defensively rather than trusting the
 * declared schema at runtime.
 */

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { Comparable, LocalityReference, PropertyCase, ReferenceData } from '@valytica/shared';

/**
 * Tools are declared with `betaTool` and raw JSON Schema rather than
 * `betaZodTool`.
 *
 * `betaZodTool` calls `z.toJSONSchema`, which is a Zod 4 API; this workspace is
 * on Zod 3, so it throws at tool-construction time — before any request is
 * made, and with an error that points at the SDK rather than at the version
 * mismatch. Raw JSON Schema sidesteps it entirely and costs nothing here, since
 * these schemas are small and hand-written anyway. Zod is still used elsewhere
 * in this package for `safeParse` on model output, which does not touch
 * `toJSONSchema`.
 */

const NO_SCREEN_MESSAGE = 'This case has not been screened yet, so there is no screen result to read from.';

/** Mirrors `LocalityReference` matching in context.ts — kept local since this file must stay tool-only. */
function findLocality(caseData: PropertyCase, refData: ReferenceData): LocalityReference | undefined {
  const { identity } = caseData;
  return refData.localities.find(
    l => l.country === identity.country && l.locality.toLowerCase() === identity.locality.toLowerCase(),
  );
}

const EVIDENCE_SOURCE_TYPES = ['document', 'external_dataset', 'comparable', 'user_input', 'model_inference'] as const;
const RISK_SEVERITIES = ['info', 'warning', 'serious', 'critical'] as const;
const RISK_STATUSES = ['open', 'mitigated', 'accepted'] as const;
const COMPLIANCE_VERDICTS = ['clear', 'attention', 'blocker', 'unknown'] as const;

/** Every tool this factory returns is a `BetaRunnableTool` — safe to hand straight to `toolRunner`. */
export function createCaseTools(caseData: PropertyCase, refData: ReferenceData) {
  const result = caseData.result;

  const listEvidence = betaTool({
    name: 'list_evidence',
    description:
      "List every evidence item on this case's ledger — id, statement, source type, source label and confidence. " +
      'Call this first when you need to know what evidence ids actually exist before citing one; never cite an id you have not seen here.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceType'],
      properties: {
        sourceType: {
          type: ['string', 'null'],
          enum: [...EVIDENCE_SOURCE_TYPES, null],
          description: 'Restrict to one evidence source type, or null for all.',
        },
      },
    } as const,
    run: async ({ sourceType }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const items = result.evidence.filter(e => !sourceType || e.sourceType === sourceType);
      return JSON.stringify(
        items.map(e => ({ id: e.id, statement: e.statement, sourceType: e.sourceType, sourceLabel: e.sourceLabel, confidence: e.confidence })),
      );
    },
  });

  const getEvidenceById = betaTool({
    name: 'get_evidence_by_id',
    description: 'Fetch one evidence item in full by its id, including its source reference and when it was captured.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string', description: 'Evidence id, as returned by list_evidence.' } },
    } as const,
    run: async ({ id }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const item = result.evidence.find(e => e.id === id);
      if (!item) return JSON.stringify({ error: `No evidence item with id "${id}". Use list_evidence to see valid ids.` });
      return JSON.stringify(item);
    },
  });

  const listComparables = betaTool({
    name: 'list_comparables',
    description: "List the comparable transactions the screen's valuation drew on, with their adjustments and similarity score.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['minSimilarity'],
      properties: {
        minSimilarity: {
          type: ['number', 'null'],
          minimum: 0,
          maximum: 1,
          description: 'Only return comparables at or above this similarity (0..1), or null for all.',
        },
      },
    } as const,
    run: async ({ minSimilarity }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const threshold = typeof minSimilarity === 'number' ? minSimilarity : undefined;
      const items: Comparable[] = result.comparables.filter(c => threshold === undefined || c.similarity >= threshold);
      return JSON.stringify(items);
    },
  });

  const getComplianceChecks = betaTool({
    name: 'get_compliance_checks',
    description:
      'Fetch the state-pack compliance checks for this case (e.g. khata classification, buffer distances), optionally filtered by verdict.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict'],
      properties: {
        verdict: {
          type: ['string', 'null'],
          enum: [...COMPLIANCE_VERDICTS, null],
          description: 'Restrict to checks with this verdict, or null for all.',
        },
      },
    } as const,
    run: async ({ verdict }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      if (!result.stateCompliance) {
        return JSON.stringify({ error: 'No state-pack compliance data is available for this case (its state/city may be outside covered packs).' });
      }
      const checks = result.stateCompliance.checks.filter(c => !verdict || c.verdict === verdict);
      return JSON.stringify({
        state: result.stateCompliance.state,
        score: result.stateCompliance.score,
        rulesAsOf: result.stateCompliance.rulesAsOf,
        verifyNote: result.stateCompliance.verifyNote,
        unresolved: result.stateCompliance.unresolved,
        checks,
      });
    },
  });

  const getRisks = betaTool({
    name: 'get_risks',
    description: 'Fetch the risk flags on this case, optionally filtered by severity and/or status.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['severity', 'status'],
      properties: {
        severity: { type: ['string', 'null'], enum: [...RISK_SEVERITIES, null], description: 'Restrict to this severity, or null for all.' },
        status: { type: ['string', 'null'], enum: [...RISK_STATUSES, null], description: 'Restrict to this status, or null for all.' },
      },
    } as const,
    run: async ({ severity, status }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const risks = result.risks.filter(r => (!severity || r.severity === severity) && (!status || r.status === status));
      return JSON.stringify(risks);
    },
  });

  const getAnchors = betaTool({
    name: 'get_anchors',
    description:
      'Fetch the value anchors that feed the blended indicative value — each with its low/mid/high, weight, confidence and rationale — ' +
      'plus the overall blended indicative value. This is read-only: it reports the arithmetic the deterministic engine already did, it never redoes it.',
    inputSchema: { type: 'object', additionalProperties: false, required: [], properties: {} } as const,
    run: async () => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      return JSON.stringify({ indicativeValue: result.indicativeValue, anchors: result.anchors });
    },
  });

  const getDocumentFields = betaTool({
    name: 'get_document_fields',
    description:
      'Fetch extracted fields for one document by id, or list all documents (id, file name, kind, confidence) when no id is given (pass null).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId'],
      properties: {
        documentId: { type: ['string', 'null'], description: 'A document id from the case, or null to list all documents instead.' },
      },
    } as const,
    run: async ({ documentId }) => {
      if (!documentId) {
        return JSON.stringify(
          caseData.documents.map(d => ({
            id: d.id,
            fileName: d.fileName,
            kind: d.kind,
            classificationConfidence: d.classificationConfidence,
            ocrStatus: d.ocrStatus,
            fieldCount: d.extracted.length,
          })),
        );
      }
      const doc = caseData.documents.find(d => d.id === documentId);
      if (!doc) return JSON.stringify({ error: `No document with id "${documentId}" on this case.` });
      return JSON.stringify({
        id: doc.id,
        fileName: doc.fileName,
        kind: doc.kind,
        ocrStatus: doc.ocrStatus,
        extracted: doc.extracted,
        notes: doc.notes,
      });
    },
  });

  const getLocalityReference = betaTool({
    name: 'get_locality_reference',
    description:
      "Fetch the reference-data row for this case's own locality: median price/land rate, statutory rate, yield, liquidity, zoning and FAR.",
    inputSchema: { type: 'object', additionalProperties: false, required: [], properties: {} } as const,
    run: async () => {
      const locality = findLocality(caseData, refData);
      if (!locality) {
        return JSON.stringify({
          error: `No locality reference row for "${caseData.identity.locality}, ${caseData.identity.city}" — reference data does not cover it yet.`,
        });
      }
      return JSON.stringify(locality);
    },
  });

  return [
    listEvidence,
    getEvidenceById,
    listComparables,
    getComplianceChecks,
    getRisks,
    getAnchors,
    getDocumentFields,
    getLocalityReference,
  ];
}
