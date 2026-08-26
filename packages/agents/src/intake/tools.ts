import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { CaseSummary, IntakeProvenance, ReferenceData } from '@valytica/shared';
import { INTAKE_FIELDS } from './fields';
import type { CaptureInput } from './fields';
import { resolveLocality } from './readout';

/**
 * The two tools the intake concierge gets, and the reason there are only two.
 *
 * Neither commits anything. `capture_particulars` accumulates into a buffer the
 * caller reads after the turn and folds in through `applyCapture`, which is
 * where the schema wall and the provenance precedence rules live. So a model
 * that captures nonsense produces a rejected capture, not a corrupt draft, and
 * the rejection is visible.
 *
 * There is deliberately no tool for creating a case, running a screen, or
 * marking the draft ready. Those are the user's decision and the deterministic
 * core's respectively, and handing either to a model would be handing it the
 * one thing this design keeps away from it.
 */

const PROVENANCE_VALUES: IntakeProvenance[] = ['stated', 'inferred'];

/** Described to the model with each field's own parse hint, so the schema teaches the parser. */
function capturePathDescription(): string {
  return INTAKE_FIELDS.map(f => {
    const opts = f.options ? ` One of: ${f.options.map(o => o.value).join(', ')}.` : '';
    const hint = f.parseHint ? ` ${f.parseHint}` : '';
    return `${f.path} (${f.label}, ${f.kind}).${opts}${hint}`;
  }).join('\n');
}

export interface IntakeToolBuffer {
  captures: CaptureInput[];
  localityLookups: { asked: string; resolved?: string; suggestions: string[] }[];
  /** Cases `find_cases` matched, in the order it found them. */
  matchedCaseIds: string[];
}

/**
 * The existing cases the concierge may look at.
 *
 * Injected rather than fetched, so this package keeps knowing nothing about
 * how the app stores anything — the same rule memory and the prompt registry
 * follow.
 */
export type CaseLookup = () => Promise<CaseSummary[]> | CaseSummary[];

export function createIntakeTools(refData: ReferenceData, buffer: IntakeToolBuffer, lookupCases?: CaseLookup) {
  const capture = betaTool({
    name: 'capture_particulars',
    description:
      'Record particulars the user has given you. Call this once per message with everything that message contained — ' +
      'not once per field. Mark each one `stated` if they said it, or `inferred` with a `basis` if you worked it out. ' +
      'Never infer a khata type, jurisdiction, land conversion status or survey number: those are matters of record and a ' +
      'plausible guess at one is worse than not knowing.\n\n' +
      `Paths you may use — anything else is rejected:\n${capturePathDescription()}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['particulars'],
      properties: {
        particulars: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'value', 'provenance'],
            properties: {
              path: { type: 'string', description: 'One of the declared paths.' },
              value: {
                type: ['string', 'number', 'boolean', 'null'],
                description: 'Numbers as numbers, already converted to the stored unit (square metres, rupees).',
              },
              provenance: {
                type: 'string',
                enum: PROVENANCE_VALUES,
                description: '`stated` if the user said it; `inferred` if you derived it, which requires a basis.',
              },
              basis: {
                type: ['string', 'null'],
                description: 'Required for `inferred`: what you derived it from, in one short phrase shown to the user.',
              },
              saidAs: {
                type: ['string', 'null'],
                description: 'What the user actually typed, when it differs from the stored value — e.g. "1200 sqft", "1.15 cr".',
              },
            },
          },
        },
      },
    } as const,
    run: async ({ particulars }) => {
      const accepted: string[] = [];
      const refused: string[] = [];
      for (const p of particulars) {
        // An inference with no basis is refused here rather than stored
        // unexplained: the basis is what the user is shown in order to correct
        // it, so an inference without one cannot be corrected.
        if (p.provenance === 'inferred' && !p.basis) {
          refused.push(`${p.path}: an inferred particular needs a basis`);
          continue;
        }
        buffer.captures.push({
          path: p.path,
          value: p.value,
          provenance: p.provenance as IntakeProvenance,
          basis: p.basis ?? undefined,
          saidAs: p.saidAs ?? undefined,
        });
        accepted.push(p.path);
      }
      return JSON.stringify({
        accepted,
        refused,
        note: 'Buffered. The app validates these against the field schema after this turn and shows the user what was captured.',
      });
    },
  });

  const locality = betaTool({
    name: 'resolve_locality',
    description:
      'Check a locality name against the reference list this app actually prices against. Call this before capturing a ' +
      'locality. If it does not resolve, do not capture it — tell the user and offer the suggestions.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string', description: 'The locality as the user gave it.' } },
    } as const,
    run: async ({ name }) => {
      const { match, near } = resolveLocality(name, refData);
      buffer.localityLookups.push({
        asked: name,
        resolved: match?.locality,
        suggestions: near.map(l => l.locality),
      });
      if (match) {
        return JSON.stringify({
          resolved: match.locality,
          medianPricePerSqm: match.medianPricePerSqm,
          zoning: match.zoning,
          note: 'Resolved. Safe to capture as `locality`.',
        });
      }
      return JSON.stringify({
        resolved: null,
        suggestions: near.map(l => l.locality),
        note:
          near.length > 0
            ? 'Not in the reference list. Offer these and ask which they meant. Do not capture the name as given.'
            : 'Not in the reference list and nothing close. Ask them to name the nearest well-known locality. Do not capture the name as given.',
      });
    },
  });

  /**
   * Find cases that already exist.
   *
   * This is what makes one conversation the whole front door: "I'm looking at
   * a flat in HSR" starts a new case, and "show me the Whitefield one" finds
   * the existing one, without the person having to know which of those two
   * things they are doing.
   *
   * It returns matches and never opens one. Opening is a navigation the person
   * performs by clicking a card — an agent that navigated on its own reading
   * of a sentence would be acting on an interpretation.
   */
  const findCases = betaTool({
    name: 'find_cases',
    description:
      'Search the cases that already exist. Use this whenever someone refers to a property they have looked at before — ' +
      'by locality, by reference like VPS-0003, by a name, or by a property they describe as already being on file. ' +
      'Report what you found in your own words and let them choose; you cannot open a case yourself.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'What to match on: a locality, a reference, part of a label, or empty for everything.',
        },
      },
    } as const,
    run: async ({ query }) => {
      if (!lookupCases) return JSON.stringify({ error: 'This conversation cannot see existing cases.' });
      const all = await lookupCases();
      const q = String(query ?? '').trim().toLowerCase();
      const matches = q
        ? all.filter(c =>
            c.reference.toLowerCase().includes(q) ||
            c.label.toLowerCase().includes(q) ||
            c.locality.toLowerCase().includes(q) ||
            c.city.toLowerCase().includes(q))
        : all;
      const top = matches.slice(0, 8);
      buffer.matchedCaseIds = top.map(c => c.id);
      return JSON.stringify({
        found: matches.length,
        showing: top.length,
        cases: top.map(c => ({
          reference: c.reference,
          label: c.label,
          locality: c.locality,
          status: c.status,
          verdict: c.verdict ?? null,
          openCriticalRisks: c.openCriticalRisks,
          documents: c.documentCount,
          // Named so the model reports a range rather than inventing one.
          indicative: c.indicativeLow && c.indicativeHigh ? `${c.indicativeLow}-${c.indicativeHigh} ${c.currency}` : null,
        })),
        note: 'These are shown to the user as cards they can open. Do not invent a case that is not in this list.',
      });
    },
  });

  return lookupCases ? [capture, locality, findCases] : [capture, locality];
}
