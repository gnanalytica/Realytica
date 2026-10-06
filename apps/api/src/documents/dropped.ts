/**
 * Papers dropped in the chat and not read yet.
 *
 * A drop is read three papers at a time and each is put on the file as it is
 * read. Until then a paper is in storage and nowhere a person can see. So it
 * is noted on the record the moment it is stored, as a file to be filed
 * unread, and the note goes as the paper lands on its row. A request that
 * ends before a paper is read (the platform's limit, a restart) leaves its
 * note behind: the paper can be filed as it is, and "Read the filed
 * documents" reads it.
 */
import { createChatProposal, type ChatIngestFile, type ChatProposal, type DdProject } from '@realytica/shared';

/** What a file dropped in the chat is filed as, unread, while it waits to be read. Told from any other file card by this. */
const NOT_READ_YET = 'Not read yet. Say “Read the filed documents” to read it, or file it as it is.';

/**
 * A dropped file noted on the record before it is read: a file to be filed,
 * unread. It is taken off as the paper lands on its row. Left behind only by
 * a request that ended before the paper was read, where it says what was
 * dropped and is what "Read the filed documents" reads.
 */
export function notReadYetCard(file: ChatIngestFile, actor: string): ChatProposal {
  return createChatProposal(
    'file_evidence',
    file.fileName,
    NOT_READ_YET,
    'Files the document on the evidence register.',
    {
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storageKey: file.storageKey,
      kind: 'document',
      title: file.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      readFailure: NOT_READ_YET,
    },
    actor,
  );
}

export function isNotReadYetCard(card: ChatProposal): boolean {
  return card.kind === 'file_evidence' && card.status === 'proposed' && card.payload.readFailure === NOT_READ_YET;
}

/** The stored files of a project that were dropped and never read, and are on no row: what a request cut short left behind. */
export function droppedUnread(project: DdProject): Array<{ fileName: string; mimeType: string; sizeBytes: number; storageKey: string }> {
  const filed = new Set(project.evidence.flatMap((e) => e.attachments.map((a) => a.storageKey)));
  return (project.chatProposals ?? [])
    .filter(isNotReadYetCard)
    .map((card) => card.payload as { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown; storageKey?: unknown })
    .filter((file) => typeof file.storageKey === 'string' && !filed.has(file.storageKey))
    .map((file) => ({ fileName: String(file.fileName ?? 'document'), mimeType: String(file.mimeType ?? 'application/octet-stream'), sizeBytes: Number(file.sizeBytes ?? 0), storageKey: String(file.storageKey) }));
}
