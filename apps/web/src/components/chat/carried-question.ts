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

/** How many files one message takes. The server's upload takes no more. */
export const FILES_AT_MOST = 10;

/** The kinds of file the chat takes, as its file picker is given them: by the end of the name, and any picture or sound. */
export const FILE_KINDS = '.pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.ogg,.oga,.opus,.m4a,.mp3,.wav,.webm,.aac,.flac,audio/*,image/*';

/** Whether a file is of a kind the chat takes. One dropped or pasted has not been through the picker, so the picker's list is asked of it here. */
export function chatTakes(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return FILE_KINDS.split(',').some((kind) => (kind.startsWith('.') ? name.endsWith(kind) : type.startsWith(kind.slice(0, -1))));
}

/** What a file is known by before it is sent: its name, its size and when it was last changed. */
interface StagedFile {
  name: string;
  type: string;
  size?: number;
  lastModified?: number;
}

/**
 * Files added to the ones waiting to go.
 *
 * One message takes ten, whichever way they came: chosen, dropped, pasted,
 * photographed or recorded. Files that were dropped or pasted are also held
 * to the kinds the picker offers; `picked` says they came through it. A file
 * already waiting is not taken a second time: the same name, size and date
 * is the same file. `wrongKind` names the files left out for their kind,
 * `twice` those already waiting, and `over` counts those left out because
 * the message was full.
 */
export function stageFiles<T extends StagedFile>(staged: readonly T[], added: readonly T[], picked = false): { files: T[]; wrongKind: string[]; over: number; twice: string[] } {
  const taken: T[] = [];
  const twice: string[] = [];
  for (const file of picked ? added : added.filter(chatTakes)) {
    const waiting = [...staged, ...taken].some((held) => held.name === file.name && held.size === file.size && held.lastModified === file.lastModified);
    if (waiting) twice.push(file.name);
    else taken.push(file);
  }
  const all = [...staged, ...taken];
  return {
    files: all.slice(0, FILES_AT_MOST),
    wrongKind: picked ? [] : added.filter((file) => !chatTakes(file)).map((file) => file.name),
    over: Math.max(0, all.length - FILES_AT_MOST),
    twice,
  };
}

/** What was left out of the files just added, in a line for under the box. Null where all of them were taken. */
export function leftOutSaid(left: { wrongKind: readonly string[]; over: number; twice?: readonly string[] }): string | null {
  const lines: string[] = [];
  const twice = left.twice ?? [];
  if (twice.length === 1) lines.push(`${twice[0]} is already attached.`);
  if (twice.length > 1) lines.push(`${twice.length} of these files are already attached.`);
  if (left.wrongKind.length === 1) lines.push(`${left.wrongKind[0]} was left out. The chat does not take that kind of file.`);
  if (left.wrongKind.length > 1) lines.push(`${left.wrongKind.length} files were left out. The chat does not take their kind.`);
  if (left.over > 0) lines.push(`${left.over}${lines.length ? ' more' : ''} ${left.over === 1 ? 'file was' : 'files were'} left out. One message takes ${FILES_AT_MOST}.`);
  return lines.length ? lines.join(' ') : null;
}

/**
 * The message box once words are handed to it: a question carried in an
 * address, or a send that did not go. What the box holds is the person's own
 * and stays. Words handed back were said first, so they go over it, and the
 * same words are not put there twice.
 */
export function boxAfter(holds: string, handed: string): string {
  if (!holds.trim()) return handed;
  if (!handed.trim() || holds.startsWith(handed)) return holds;
  return `${handed}\n${holds}`;
}

/**
 * Whether a paste is files to attach, not words to type.
 *
 * A screenshot, a copied picture and a file copied from a folder are files.
 * Words copied from a document or a spreadsheet carry a picture of
 * themselves too, and they are still words: where the clipboard holds text
 * with its formatting, the text is what is pasted.
 */
export function pasteIsFiles(clip: { files: number; text: string; types: readonly string[] }): boolean {
  if (!clip.files) return false;
  const formatted = clip.types.includes('text/html') || clip.types.includes('text/rtf');
  return !(formatted && clip.text.trim());
}

/**
 * Whether a key press belongs to an input method that is composing. Enter
 * then picks a candidate, in Kannada, Hindi, Chinese or Japanese, and sends
 * nothing. Some browsers say so only by the key code 229.
 */
export function composing(key: { isComposing?: boolean; keyCode?: number }): boolean {
  return Boolean(key.isComposing) || key.keyCode === 229;
}
