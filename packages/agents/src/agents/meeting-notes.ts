/**
 * A model's reading of a meeting's notes: what was decided, what is to be
 * done, and what was left open.
 *
 * The rules read the lines notes mark for themselves ("Decision:", "Action:").
 * Most notes are sentences, and a sentence takes a reader. So where a model
 * is set up it is asked for the three kinds of thing, each with the words of
 * the notes it came from.
 *
 * Nothing it says is believed here or anywhere on its word. The caller holds
 * every item to the notes (`meetingItemsHeld` in the shared package): an item
 * whose quoted words are not in the notes is dropped, a name the quoted words
 * do not have is dropped, and a date is read from the quoted words by rule,
 * which is why the model is not asked for one. What comes through is still a
 * proposal on a card, for a person to accept.
 *
 * Never throws. A model that cannot be reached, runs out of time or answers
 * something else has read nothing, and the rules' own reading stands.
 */

import type { MeetingSaidByModel } from '@realytica/shared';
import { agentCapability } from '../client';
import { capabilityBlocksRoute, resolveRoute, toolUseOf } from '../providers';
import type { LlmSchemaTool } from '../providers';

export const MEETING_NOTES_TOOL = 'record_meeting_notes';

/** How long one reading of notes may take before the rules' reading stands alone. */
export const MEETING_NOTES_LIMIT_MS = 45_000;

/** How much of some notes is sent to be read. Notes longer than this are read to here. */
export const MEETING_NOTES_READ = 20_000;

const SYSTEM = `You read the notes of a meeting about a property project and record three kinds of thing from them: what was decided, what is to be done, and what was left open.

Rules:
1. Record only what the notes say. Never add an item the notes do not state, and never join two sentences into something neither says.
2. Every item carries "quote": the exact words of the notes it comes from, copied character for character, one sentence or one line, no more. An item you cannot quote is not recorded.
3. "text" is the item in one plain line of your own, under 160 characters.
4. "kind" is "decision" for something settled at the meeting, "action" for something somebody is to do, "open" for a question raised and not settled.
5. For an action, "owner" is the person or party the notes say it is on, exactly as the notes name them, and only when the quoted words name them. Otherwise null. Never choose an owner the notes do not give.
6. Do not give dates. A date is read from your quote, so quote the words that say by when.
7. Talk that settles nothing and asks nothing is not an item. Notes with no decision, action or open point give an empty list.
Call ${MEETING_NOTES_TOOL} once with everything.`;

function tool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: MEETING_NOTES_TOOL,
    description: 'Record what the notes of the meeting say was decided, is to be done, and was left open.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'text', 'owner', 'quote'],
            properties: {
              kind: { type: 'string', enum: ['decision', 'action', 'open'] },
              text: { type: 'string', description: 'The item in one plain line.' },
              owner: { type: ['string', 'null'], description: 'For an action: who it is on, as the notes name them. Null when the notes do not say.' },
              quote: { type: 'string', description: 'The exact words of the notes this comes from.' },
            },
          },
        },
      },
    },
  };
}

/**
 * What a model reads out of some notes, or null when no model read them.
 * `caseId` is the project, for the telemetry that counts what a project spent.
 */
export async function readMeetingNotesByModel(input: { notes: string; caseId?: string; timeoutMs?: number }): Promise<MeetingSaidByModel | null> {
  const notes = input.notes.trim().slice(0, MEETING_NOTES_READ);
  if (!notes) return null;
  try {
    const { route, provider, descriptor } = resolveRoute('document_intelligence');
    if (capabilityBlocksRoute(route, agentCapability()) || !descriptor.configured) return null;
    const result = await provider.complete({
      agent: 'document_intelligence',
      ...(input.caseId ? { caseId: input.caseId } : {}),
      model: route.model,
      maxTokens: 3000,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools: [tool()],
      toolChoice: { type: 'tool', name: MEETING_NOTES_TOOL },
      messages: [{ role: 'user', content: `The notes:\n\n${notes}` }],
      timeoutMs: input.timeoutMs ?? MEETING_NOTES_LIMIT_MS,
    });
    const call = toolUseOf(result, MEETING_NOTES_TOOL);
    const said = call?.input as { items?: unknown } | undefined;
    return said && Array.isArray(said.items) ? { items: said.items as NonNullable<MeetingSaidByModel['items']> } : null;
  } catch (err) {
    console.warn(`[meeting notes] a model did not read the notes: ${err instanceof Error ? err.name : 'error'}`);
    return null;
  }
}
