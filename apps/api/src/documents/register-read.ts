/**
 * Reading documents filed straight onto the evidence register.
 *
 * The register's Upload link and its bulk "Add documents" used to store the
 * file and nothing else: a deed filed there was never read, so the same
 * document produced facts when dropped into the chat and none when filed on
 * the row it belonged to. Now both read it.
 *
 * The split of authority follows who chose what. The person chose the ROW,
 * so what the document says — its facts, quotes and type — is written onto
 * that row directly. What the document would CHANGE — a check's values, a
 * finding, the parcel on the project — is still a card a person approves,
 * posted into the chat with a one-line note so reading results always turn
 * up in the same place, whichever door the file came in by.
 */

import { randomUUID } from 'node:crypto';
import type { ChatIngestFile, ChatProposal, DdProject, ProjectChatTurn } from '@realytica/shared';
import {
  absorbAnsweredGaps,
  ddForDocumentsProposal,
  factFillProposals,
  flagFindingProposals,
  placeProposalsFromIngest,
  plural,
} from '@realytica/shared';
import { readIngestLocally } from './intake';

export interface RegisterUpload {
  evidenceId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  /**
   * A site photograph filed with a capture purpose. Not read: OCR on a photo
   * of a boundary wall finds nothing and costs a second a picture.
   */
  sitePhoto?: boolean;
}

/** Scans are the slow part; a big batch reads its text layers and at most this many scans. */
const MAX_SCANS_PER_BATCH = 6;

export async function readOntoRegister(project: DdProject, uploads: RegisterUpload[], actor: string): Promise<{ read: number }> {
  const cards: ChatProposal[] = [];
  const labels: string[] = [];
  const flagged: string[] = [];
  const cited: string[] = [];
  let scans = 0;

  for (const upload of uploads) {
    if (upload.sitePhoto) continue;
    const isImage = upload.mimeType.startsWith('image/');
    if (isImage && scans >= MAX_SCANS_PER_BATCH) continue;
    const row: ChatIngestFile = {
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      storageKey: upload.storageKey,
    };
    const read = await readIngestLocally(row, upload.buffer);
    if (read.read?.method && read.read.method !== 'text') scans += 1;
    const doc = read.read;
    if (!doc || doc.type === 'other') continue;

    const evidence = project.evidence.find((e) => e.id === upload.evidenceId);
    if (!evidence) continue;
    const kept = (evidence.facts ?? []).filter((f) => !doc.facts.some((n) => n.key === f.key));
    evidence.facts = [...kept, ...doc.facts];
    evidence.documentType = doc.label;
    evidence.readMethod = doc.method;
    evidence.quotes = doc.facts
      .filter((f) => !f.key.startsWith('boundary_'))
      .slice(0, 6)
      .map((f) => ({ text: `${f.label}: ${f.quote}`.slice(0, 240), page: f.page }));
    if (!evidence.extractionNotes) evidence.extractionNotes = doc.summary;
    evidence.updatedAt = new Date().toISOString();
    absorbAnsweredGaps(project, evidence);

    const source = { fileName: upload.fileName, evidenceId: evidence.id, storageKey: upload.storageKey, documentLabel: doc.label };
    cards.push(...factFillProposals(project, doc.facts, source, actor, cards));
    cards.push(...flagFindingProposals(project, doc.flags, source, actor, cards));
    cards.push(...placeProposalsFromIngest(project, [read], actor).filter((p) => !cards.some((c) => c.title === p.title)));
    labels.push(/^[A-Z][a-z]/.test(doc.label) ? doc.label.charAt(0).toLowerCase() + doc.label.slice(1) : doc.label);
    flagged.push(...doc.flags.map((f) => f.title));
    cited.push(evidence.id);
  }

  if (!labels.length) return { read: 0 };

  const startDd = ddForDocumentsProposal(project, project.evidence.flatMap((e) => e.facts ?? []), actor, cards);
  if (startDd) cards.push(startDd);

  project.chatProposals.push(...cards);
  const fills = cards.filter((c) => c.kind === 'record_check_fields').length;
  const text = [
    `Read the ${labels.length === 1 ? labels[0] : labels.join(', ')} you filed on the register.`,
    fills ? `${plural(fills, 'check')} can take values from ${labels.length === 1 ? 'it' : 'them'}.` : '',
    startDd ? `They answer checks in the ${startDd.title.replace(/^Start /, '')}.` : '',
    flagged.length ? `\n⚑ ${[...new Set(flagged)].join('; ')}.` : '',
    cards.length ? '\nApprove below, or say “approve all”.' : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/ \n/g, '\n');
  const turn: ProjectChatTurn = {
    id: `cht_${randomUUID()}`,
    role: 'assistant',
    text,
    at: new Date().toISOString(),
    actor,
    citedEvidenceIds: cited,
    toolCalls: [{ name: 'ingest', summary: `Read ${plural(labels.length, 'document')} filed on the register` }],
    proposalIds: cards.map((c) => c.id),
  };
  project.conversation.push(turn);
  return { read: labels.length };
}
