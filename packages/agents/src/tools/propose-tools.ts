/**
 * The one tool in this package that can put something new on a case — and
 * even this one does not write anywhere. `run()` validates the draft and
 * pushes it onto `collector`, an array the caller owns; the agents package
 * still touches no store (see `case-tools.ts`'s own header for why that
 * boundary matters, and `runCopilot`'s `proposedFindings` on its result).
 * Persisting a collected draft — with a `proposed` review state that a
 * person must accept before it counts — is the API route's job, the same
 * split `runCopilot` already draws between computing an answer and saving it.
 *
 * Kept out of `case-tools.ts` on purpose: that file's own header states its
 * contract as no mutating tool, ever, and this tool reads as exactly that
 * kind of tool even though its `run()` has no side effect on the case.
 * Separating the file makes the boundary visible in the source tree, not
 * just in a comment someone has to find.
 */

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { PropertyCase, TechnicalFindingDraft } from '@realytica/shared';

const RISK_SEVERITIES = ['info', 'warning', 'serious', 'critical'] as const;
const TECHNICAL_SYSTEMS = ['architectural', 'structural', 'mep_hvac', 'mep_phe', 'mep_fire', 'mep_electrical', 'mep_ibms', 'statutory', 'ehs'] as const;

/**
 * `collector` is mutated by `run()` — every accepted-shape draft is pushed
 * onto it, in call order. The caller reads it back after the agent loop
 * finishes; nothing here is returned to the model beyond a confirmation.
 */
export function createProposeTools(caseData: PropertyCase, collector: TechnicalFindingDraft[]) {
  const proposeTechnicalFinding = betaTool({
    name: 'propose_technical_finding',
    description:
      "Draft a technical/construction due-diligence finding for a person to review — a defect observed in the building's structure, MEP " +
      'plant, fire/life-safety systems, or statutory position. This does NOT save anything to the case: it queues a proposal that a person ' +
      'must explicitly accept before it counts as a finding, exactly like every other AI suggestion in this product. Call it once per ' +
      'distinct defect, never to restate a finding already on the case (check get_technical_findings first). Every field is required except ' +
      'codeCitation and evidenceDocumentIds — a finding you cannot ground in the case documents should not be proposed at all.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['system', 'zone', 'observation', 'severity', 'recommendation', 'codeCitation', 'evidenceDocumentIds'],
      properties: {
        system: { type: 'string', enum: [...TECHNICAL_SYSTEMS], description: 'Which discipline this defect belongs to.' },
        zone: { type: 'string', description: 'Where on the property this was observed — a floor, a room, a system run.' },
        observation: { type: 'string', description: 'What was actually observed. State it as a fact, not an opinion.' },
        severity: { type: 'string', enum: [...RISK_SEVERITIES], description: 'How serious this is, on the same scale the rest of the screen uses.' },
        recommendation: { type: 'string', description: 'What should be done about it.' },
        codeCitation: {
          type: ['string', 'null'],
          description: 'The exact code clause behind the recommendation (e.g. "NBC 2005, Part 4, Clause 4.16.7"), or null if none applies.',
        },
        evidenceDocumentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of photographs already on this case (from get_document_fields) that show this defect. Empty array if none.',
        },
      },
    } as const,
    run: async ({ system, zone, observation, severity, recommendation, codeCitation, evidenceDocumentIds }) => {
      const ids = Array.isArray(evidenceDocumentIds) ? evidenceDocumentIds.filter((id): id is string => typeof id === 'string') : [];
      const unknownDoc = ids.find(id => !caseData.documents.some(d => d.id === id));
      if (unknownDoc) {
        return JSON.stringify({ error: `"${unknownDoc}" is not a document id on this case. Check get_document_fields first.` });
      }
      if (!(TECHNICAL_SYSTEMS as readonly string[]).includes(system)) {
        return JSON.stringify({ error: `"${system}" is not a recognised system.` });
      }
      if (!(RISK_SEVERITIES as readonly string[]).includes(severity)) {
        return JSON.stringify({ error: `"${severity}" is not a recognised severity.` });
      }
      collector.push({
        system: system as TechnicalFindingDraft['system'],
        zone,
        observation,
        severity: severity as TechnicalFindingDraft['severity'],
        recommendation,
        codeCitation: codeCitation ?? undefined,
        evidenceDocumentIds: ids,
      });
      return JSON.stringify({ queued: true, note: 'Drafted — a person must accept this before it becomes a finding on the case.' });
    },
  });

  return [proposeTechnicalFinding];
}
