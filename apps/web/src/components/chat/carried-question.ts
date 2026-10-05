/**
 * A question carried in an address: `?ask=…`.
 *
 * It waits in the message box for the person to read and send. This gives the
 * words, and the address without them so the same words are not put in the
 * box a second time. Longer than a message can be, it is cut to what one
 * holds.
 */
export function carriedQuestion(search: URLSearchParams): { text: string; rest: URLSearchParams } | null {
  const text = (search.get('ask') ?? '').trim().slice(0, MESSAGE_MAX);
  if (!text) return null;
  const rest = new URLSearchParams(search);
  rest.delete('ask');
  return { text, rest };
}

/** The longest message the chat takes. */
export const MESSAGE_MAX = 4000;
