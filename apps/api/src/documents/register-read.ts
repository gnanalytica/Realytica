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
 *
 * A file this server could not read well is read by the model too, as one
 * dropped in the chat is: the same router decides (`routeReading`), and the
 * same merge lays the model's reading over this server's.
 *
 * What a model alone says a paper IS, is an offer. Nobody chose it, so it
 * names nothing on the register and answers no waiting row until a person
 * confirms it (`confirmProposedType`), says what the paper is instead
 * (`correctProposedType`) or sets the offer aside (`setAsideProposedType`).
 * Its values wait on the row like any other, and nothing is offered to a
 * check on their strength: to the checks go the values that stand
 * (`standingAsRead`), never a model's nor one two readers differ on.
 */

import { randomUUID } from 'node:crypto';
import { agentCapability, enrichIngestWithDocumentIntelligence } from '@realytica/agents';
import type { ChatIngestFile, ChatProposal, DdProject, ProjectChatTurn } from '@realytica/shared';
import {
  absorbAnsweredGaps,
  ddForDocumentsProposal,
  DOCUMENT_WORKSTREAM,
  documentTypeOfKind,
  factFillProposals,
  flagFindingProposals,
  keepReadings,
  MODEL_READER_VERSION,
  placeProposalsFromIngest,
  plural,
  proofOf,
  proposeOnRow,
  recordAuditEvent,
  setAsideOffPaper,
  readingSaid,
  standingAsRead,
  standingFacts,
  waitingAsRead,
} from '@realytica/shared';
import { mergeModelReading, needsModelReading, readIngestLocally } from './intake';

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

/**
 * How long the model reader has for a batch, once this server has read it.
 * The request that filed the papers is waiting, so this is a stop and not a
 * hope: no call to the model runs past it, a file whose call is cut keeps the
 * reading it has and says a model has not read it, and "Read the filed
 * documents" in the chat carries on from there. So does a file the model read
 * whose values a second model had no time left to read: the reading says the
 * checks were cut (`modelChecksCut`), which makes it one to read again.
 */
export const MODEL_READ_BUDGET_MS = 120_000;
/** No new file is sent with less than this left: a reading cut off at once reads nothing. */
const MODEL_START_MARGIN_MS = 15_000;

const article = (type: string): string => `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${/^[A-Z][a-z]/.test(type) ? type.charAt(0).toLowerCase() + type.slice(1) : type}`;

/**
 * A person says the paper is what a model took it for: the offer becomes the
 * row's type, and the row now answers whatever was waiting for that paper.
 * False when the row has no offer to confirm.
 */
export function confirmProposedType(project: DdProject, evidenceId: string, actor = 'operator'): boolean {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence?.proposedDocumentType) return false;
  evidence.documentType = evidence.proposedDocumentType;
  delete evidence.proposedDocumentType;
  evidence.updatedAt = new Date().toISOString();
  recordAuditEvent(project, { actor, action: 'type_confirmed', entityType: 'evidence', entityId: evidence.id, newValue: evidence.documentType });
  setAsideOffPaper(evidence, actor);
  absorbAnsweredGaps(project, evidence);
  return true;
}

/**
 * A person says the paper is not what a model took it for. The offer goes
 * and is remembered as refused, so the next reading does not make it again;
 * the row keeps whatever type it had. What the model read as values of that
 * kind of paper is set aside with it: a nil-encumbrance answer is no reading
 * of a paper that is not an encumbrance certificate. False when there is no
 * offer.
 */
export function setAsideProposedType(project: DdProject, evidenceId: string, actor = 'operator'): boolean {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence?.proposedDocumentType) return false;
  evidence.refusedDocumentType = evidence.proposedDocumentType;
  delete evidence.proposedDocumentType;
  evidence.updatedAt = new Date().toISOString();
  recordAuditEvent(project, { actor, action: 'type_refused', entityType: 'evidence', entityId: evidence.id, newValue: evidence.refusedDocumentType });
  setAsideOffPaper(evidence, actor);
  return true;
}

/** The types a person can say a paper is: the ones the register files a paper under. */
export const DOCUMENT_TYPES: readonly string[] = Object.keys(DOCUMENT_WORKSTREAM);

/**
 * A person says what the paper is, in place of what a model took it for.
 * Their word is the row's type, and the row answers whatever was waiting for
 * that paper. What the model read as values of the kind it took the paper
 * for, and the paper as now named does not carry, is set aside. False when
 * there is no offer to correct, or the type is not one the register knows.
 */
export function correctProposedType(project: DdProject, evidenceId: string, documentType: string, actor = 'operator'): boolean {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence?.proposedDocumentType || !DOCUMENT_TYPES.includes(documentType)) return false;
  if (documentType !== evidence.proposedDocumentType) evidence.refusedDocumentType = evidence.proposedDocumentType;
  evidence.documentType = documentType;
  delete evidence.proposedDocumentType;
  evidence.updatedAt = new Date().toISOString();
  recordAuditEvent(project, { actor, action: 'type_corrected', entityType: 'evidence', entityId: evidence.id, newValue: evidence.documentType });
  setAsideOffPaper(evidence, actor);
  absorbAnsweredGaps(project, evidence);
  return true;
}

export async function readOntoRegister(
  project: DdProject,
  uploads: RegisterUpload[],
  actor: string,
  opts: {
    /** Stop starting new OCR pages after this instant; what was read stands, and the rest can be read again later. */
    deadline?: number;
    /** How long the model reader has for the batch, in place of `MODEL_READ_BUDGET_MS`. */
    modelBudgetMs?: number;
  } = {},
): Promise<{ read: number; files: ChatIngestFile[] }> {
  const cards: ChatProposal[] = [];
  const labels: string[] = [];
  const flagged: string[] = [];
  const cited: string[] = [];
  /** What a model took an unrecognised paper for: said, and left for a person to confirm. */
  const proposedTypes: string[] = [];
  let scans = 0;

  const read: Array<{ upload: RegisterUpload; file: ChatIngestFile; pages?: string[] }> = [];
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
    const entry: (typeof read)[number] = { upload, file: row };
    entry.file = await readIngestLocally(row, upload.buffer, undefined, { deadline: opts.deadline, onPages: (pages) => (entry.pages = pages) });
    if (entry.file.read?.method && entry.file.read.method !== 'text') scans += 1;
    read.push(entry);
  }

  // The model reads afterwards, and only what the router sends it: see `routeReading`.
  let spend: ProjectChatTurn['spend'];
  const forModel = read.filter(({ file }) => needsModelReading(file));
  if (forModel.length && agentCapability().available) {
    const stopAt = Date.now() + (opts.modelBudgetMs ?? MODEL_READ_BUDGET_MS);
    try {
      const modelRead = await enrichIngestWithDocumentIntelligence({
        project,
        files: forModel.map(({ file }) => ({ ...file, read: undefined })),
        buffers: forModel.map(({ upload }) => upload.buffer),
        // What this server already read, so a quote found in its page's own words is placed there without another call.
        pageTexts: forModel.map(({ pages }) => pages),
        deadline: stopAt - MODEL_START_MARGIN_MS,
        stopAt,
        onSpend: (cost) => (spend = { usd: (spend?.usd ?? 0) + cost.usd, exact: (spend?.exact ?? true) && cost.exact }),
      });
      forModel.forEach((entry, n) => (entry.file = mergeModelReading(entry.file, modelRead[n])));
    } catch {
      /* this server's reading stands */
    }
  }

  // How much of each file was read, kept on the file: a paper read in part must not look like one read whole.
  keepReadings(project, read.map(({ file }) => file));
  const partly: string[] = [];

  // Without a model reader, "ask to read the filed documents" would read the same pages to the same end.
  const modelReader = agentCapability().available;
  for (const { upload, file } of read) {
    const doc = file.read;
    const said = readingSaid(file.reading, modelReader);
    if (said) partly.push(`${upload.fileName}: ${said}`);
    // A paper only the model made sense of has no type from the rules, and its values were each found on their page.
    const known = doc && doc.type !== 'other';
    // The whole reading goes onto the row, each value proposed. That is filing what was read, not acting on it.
    const facts = !doc ? [] : known ? doc.facts : waitingAsRead(doc).filter((f) => f.source === 'model');
    if (!doc || (!known && !facts.length)) continue;

    const evidence = project.evidence.find((e) => e.id === upload.evidenceId);
    if (!evidence) continue;
    // Named for what the rules read it as. What a model alone took it for is offered, and names nothing until a person confirms it.
    const offered = known ? undefined : documentTypeOfKind(file.kindHint);
    const label = known ? doc.label : (evidence.documentType ?? 'document');
    if (known) {
      evidence.documentType = doc.label;
      delete evidence.proposedDocumentType;
    } else if (offered && offered !== evidence.documentType && offered !== evidence.refusedDocumentType) {
      // Not an offer a person has already refused for this paper.
      evidence.proposedDocumentType = offered;
      proposedTypes.push(offered);
    }
    // What it states waits on the row, value by value, for a person to accept: put there once the row says what the paper is, so
    // a value its kind does not carry never waits.
    evidence.facts = proposeOnRow(evidence, facts);
    // Written down as an event of its own, so a paper read again is told as read again.
    recordAuditEvent(project, { actor, action: 'read', entityType: 'evidence', entityId: evidence.id, newValue: `${facts.length} value(s)` });
    evidence.readMethod = doc.method;
    // The row's quotes are words found in the page's own text: never a model's wording only a second model stands behind.
    evidence.quotes = facts
      .filter((f) => !f.key.startsWith('boundary_') && (f.source !== 'model' || proofOf(f) === 'page_text'))
      .slice(0, 6)
      .map((f) => ({ text: `${f.label}: ${f.quote}`.slice(0, 240), page: f.page }));
    if (!evidence.extractionNotes) evidence.extractionNotes = known ? doc.summary : (file.extractionNotes ?? doc.summary);
    if (file.modelRead) {
      evidence.modelReadAt = new Date().toISOString();
      evidence.modelReadVersion = MODEL_READER_VERSION;
    }
    evidence.updatedAt = new Date().toISOString();
    // A waiting row is answered by a paper somebody, or the rules, said is that paper. Never on a model's word alone.
    if (known) absorbAnsweredGaps(project, evidence);

    if (known) {
      const source = { fileName: upload.fileName, evidenceId: evidence.id, storageKey: upload.storageKey, documentLabel: doc.label };
      // To the checks go the values that stand. A model's, and one two readers differ on, wait on the row until a person decides them there.
      cards.push(...factFillProposals(project, standingAsRead(doc), source, actor, cards));
      cards.push(...flagFindingProposals(project, doc.flags, source, actor, cards));
    }
    cards.push(...placeProposalsFromIngest(project, [file], actor).filter((p) => !cards.some((c) => c.title === p.title)));
    labels.push(/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);
    flagged.push(...doc.flags.map((f) => f.title));
    cited.push(evidence.id);
  }

  const files = read.map(({ file }) => file);
  if (!labels.length) {
    // Nothing to put on a row, and still something to say: a paper read in part, or one a model was to read and did not.
    if (partly.length) {
      project.conversation.push({
        id: `cht_${randomUUID()}`,
        role: 'assistant',
        text: partly.join('\n'),
        at: new Date().toISOString(),
        actor,
        citedEvidenceIds: [...new Set(read.map(({ upload }) => upload.evidenceId))],
        toolCalls: [{ name: 'ingest', summary: `Read ${plural(read.length, 'document')} filed on the register in part` }],
        ...(spend ? { spend } : {}),
      });
    }
    return { read: 0, files };
  }

  const startDd = ddForDocumentsProposal(project, project.evidence.flatMap((e) => standingFacts(e)), actor, cards);
  if (startDd) cards.push(startDd);

  project.chatProposals.push(...cards);
  const fills = new Set(cards.filter((c) => c.kind === 'record_check_fields').map((c) => String(c.payload.checkId))).size;
  const text = [
    `Read the ${labels.length === 1 ? labels[0] : labels.join(', ')} you filed on the register.`,
    fills ? `${plural(fills, 'check')} can take values from ${labels.length === 1 ? 'it' : 'them'}.` : '',
    startDd ? `${labels.length === 1 ? 'It answers' : 'They answer'} checks in the ${startDd.title.replace(/^Start /, '')}.` : '',
    flagged.length ? `\n⚑ ${[...new Set(flagged)].join('; ')}.` : '',
    proposedTypes.length
      ? `\nA model takes ${proposedTypes.length === 1 ? `it for ${article(proposedTypes[0]!)}` : `them for ${proposedTypes.map(article).join(', ')}`}. That is an offer: confirm it on the row, and until then it answers no waiting row.`
      : '',
    partly.length ? `\n${partly.join('\n')}` : '',
    '\nWhat it states is waiting on the row, value by value. Accept each where it sits.',
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
    ...(spend ? { spend } : {}),
  };
  project.conversation.push(turn);
  return { read: labels.length, files };
}
