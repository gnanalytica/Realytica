/**
 * A model's reading of a voice note's words as a site entry.
 *
 * The rules sort English sentences into work, issues, manpower and weather.
 * A note from site is as often in Kannada or Hindi, or in all three at once,
 * and a sentence in another language takes a reader. So where a model is set
 * up it is given the words (never the sound) and asked for the lines of a
 * site entry in plain English, each with the note's own words beside it.
 *
 * Nothing it says is believed on its word. The caller holds every line to the
 * note (`voiceNoteHeld` in the shared package): a line whose quoted words are
 * not in the note is dropped, a count the quoted words do not carry is not
 * kept as a count, and a date is kept only where the quoted words state it.
 * What comes through is still a proposal on a card, for a person to accept.
 *
 * Never throws. A model that cannot be reached or answers something else has
 * read nothing, and the rules' own reading stands.
 */

import type { VoiceNoteSaidByModel } from '@realytica/shared';
import { agentCapability } from '../client';
import { capabilityBlocksRoute, resolveRoute, toolUseOf } from '../providers';
import type { LlmSchemaTool } from '../providers';

export const VOICE_NOTE_TOOL = 'record_site_note';

const VOICE_NOTE_LIMIT_MS = 45_000;
const VOICE_NOTE_READ = 12_000;

const SYSTEM = `You are given the words of a voice note recorded on a construction site, as a transcriber wrote them. They may be in English, Kannada, Hindi or a mix, and the transcriber may have misheard a word. Record what the note says for the day's site entry.

Rules:
1. Record only what the note says. Never add a line the note does not state. A quantity, a name or a date the note does not say is left out, never estimated.
2. Every item carries "quote": the exact words of the note it comes from, copied character for character in the note's own language and script, one sentence or clause, no more. An item you cannot quote is not an item.
3. "text" is the item in one plain line of English, under 160 characters, saying no more than the quoted words do.
4. "kind" is "work" for work done or under way, "issue" for a problem, a delay, a shortage, a defect or anything unsafe, "manpower" for how many of a trade were on site, "weather" for the weather.
5. For "manpower", "trade" is the trade in English (masons, carpenters, helpers) and "count" is the number, only where the quoted words say the number. Otherwise both are null.
6. "day": "said" is "today" or "yesterday" where the note says so in any language, "date" where it names a calendar date in full, else null. With "date", give it as YYYY-MM-DD. "quote" is the words that say the day. Never work a date out from anything else.
7. Talk that says nothing for the entry (greetings, who the note is for) is not an item.
Call ${VOICE_NOTE_TOOL} once with everything.`;

function tool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: VOICE_NOTE_TOOL,
    description: 'Record what a voice note from site says for the day’s site entry.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['day', 'items'],
      properties: {
        day: {
          type: 'object',
          additionalProperties: false,
          required: ['said', 'date', 'quote'],
          properties: {
            said: { type: ['string', 'null'], enum: ['today', 'yesterday', 'date', null] },
            date: { type: ['string', 'null'], description: 'YYYY-MM-DD, only with said "date".' },
            quote: { type: ['string', 'null'], description: 'The exact words of the note that say the day.' },
          },
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'text', 'quote', 'trade', 'count'],
            properties: {
              kind: { type: 'string', enum: ['work', 'issue', 'manpower', 'weather'] },
              text: { type: 'string', description: 'The item in one plain line of English.' },
              quote: { type: 'string', description: 'The exact words of the note this comes from, in the note’s own script.' },
              trade: { type: ['string', 'null'] },
              count: { type: ['number', 'null'] },
            },
          },
        },
      },
    },
  };
}

/** What a model reads out of a note's words, or null when no model read them. `caseId` is the project, for what it spent. */
export async function readVoiceNoteByModel(input: { words: string; caseId?: string; timeoutMs?: number }): Promise<VoiceNoteSaidByModel | null> {
  const words = input.words.trim().slice(0, VOICE_NOTE_READ);
  if (!words) return null;
  try {
    const { route, provider, descriptor } = resolveRoute('document_intelligence');
    if (capabilityBlocksRoute(route, agentCapability()) || !descriptor.configured) return null;
    const result = await provider.complete({
      agent: 'document_intelligence',
      ...(input.caseId ? { caseId: input.caseId } : {}),
      model: route.model,
      maxTokens: 2500,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools: [tool()],
      toolChoice: { type: 'tool', name: VOICE_NOTE_TOOL },
      messages: [{ role: 'user', content: `The words of the note:\n\n${words}` }],
      timeoutMs: input.timeoutMs ?? VOICE_NOTE_LIMIT_MS,
    });
    const said = toolUseOf(result, VOICE_NOTE_TOOL)?.input as { day?: unknown; items?: unknown } | undefined;
    if (!said || !Array.isArray(said.items)) return null;
    return { day: (said.day ?? null) as VoiceNoteSaidByModel['day'], items: said.items as VoiceNoteSaidByModel['items'] };
  } catch (err) {
    console.warn(`[voice note] a model did not read the words: ${err instanceof Error ? err.name : 'error'}`);
    return null;
  }
}
