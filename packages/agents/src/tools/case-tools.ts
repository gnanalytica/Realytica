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
 */

import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Comparable, LocalityReference, PropertyCase, ReferenceData } from '@valytica/shared';

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

  const listEvidence = betaZodTool({
    name: 'list_evidence',
    description:
      "List every evidence item on this case's ledger — id, statement, source type, source label and confidence. " +
      'Call this first when you need to know what evidence ids actually exist before citing one; never cite an id you have not seen here.',
    inputSchema: z.object({
      sourceType: z.enum(EVIDENCE_SOURCE_TYPES).optional().describe('Restrict to one evidence source type.'),
    }),
    run: async ({ sourceType }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const items = result.evidence.filter(e => !sourceType || e.sourceType === sourceType);
      return JSON.stringify(
        items.map(e => ({ id: e.id, statement: e.statement, sourceType: e.sourceType, sourceLabel: e.sourceLabel, confidence: e.confidence })),
      );
    },
  });

  const getEvidenceById = betaZodTool({
    name: 'get_evidence_by_id',
    description: 'Fetch one evidence item in full by its id, including its source reference and when it was captured.',
    inputSchema: z.object({ id: z.string().describe('Evidence id, as returned by list_evidence.') }),
    run: async ({ id }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const item = result.evidence.find(e => e.id === id);
      if (!item) return JSON.stringify({ error: `No evidence item with id "${id}". Use list_evidence to see valid ids.` });
      return JSON.stringify(item);
    },
  });

  const listComparables = betaZodTool({
    name: 'list_comparables',
    description: "List the comparable transactions the screen's valuation drew on, with their adjustments and similarity score.",
    inputSchema: z.object({
      minSimilarity: z.number().min(0).max(1).optional().describe('Only return comparables at or above this similarity (0..1).'),
    }),
    run: async ({ minSimilarity }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const items: Comparable[] = result.comparables.filter(c => minSimilarity === undefined || c.similarity >= minSimilarity);
      return JSON.stringify(items);
    },
  });

  const getComplianceChecks = betaZodTool({
    name: 'get_compliance_checks',
    description:
      'Fetch the state-pack compliance checks for this case (e.g. khata classification, buffer distances), optionally filtered by verdict.',
    inputSchema: z.object({
      verdict: z.enum(COMPLIANCE_VERDICTS).optional().describe('Restrict to checks with this verdict.'),
    }),
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

  const getRisks = betaZodTool({
    name: 'get_risks',
    description: 'Fetch the risk flags on this case, optionally filtered by severity and/or status.',
    inputSchema: z.object({
      severity: z.enum(RISK_SEVERITIES).optional().describe('Restrict to this severity.'),
      status: z.enum(RISK_STATUSES).optional().describe('Restrict to this status.'),
    }),
    run: async ({ severity, status }) => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      const risks = result.risks.filter(r => (!severity || r.severity === severity) && (!status || r.status === status));
      return JSON.stringify(risks);
    },
  });

  const getAnchors = betaZodTool({
    name: 'get_anchors',
    description:
      'Fetch the value anchors that feed the blended indicative value — each with its low/mid/high, weight, confidence and rationale — ' +
      'plus the overall blended indicative value. This is read-only: it reports the arithmetic the deterministic engine already did, it never redoes it.',
    inputSchema: z.object({}),
    run: async () => {
      if (!result) return JSON.stringify({ error: NO_SCREEN_MESSAGE });
      return JSON.stringify({ indicativeValue: result.indicativeValue, anchors: result.anchors });
    },
  });

  const getDocumentFields = betaZodTool({
    name: 'get_document_fields',
    description:
      'Fetch extracted fields for one document by id, or list all documents (id, file name, kind, confidence) when no id is given.',
    inputSchema: z.object({
      documentId: z.string().optional().describe('A document id from the case. Omit to list all documents instead.'),
    }),
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

  const getLocalityReference = betaZodTool({
    name: 'get_locality_reference',
    description:
      "Fetch the reference-data row for this case's own locality: median price/land rate, statutory rate, yield, liquidity, zoning and FAR.",
    inputSchema: z.object({}),
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
