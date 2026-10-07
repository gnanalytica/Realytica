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
 * So is what this server's own rules read off a file put on a row that
 * already has a kind: a reading names a row that has no kind, and never
 * renames one that has (`kindAsRead`).
 * Its values wait on the row like any other, and nothing is offered to a
 * check on their strength: to the checks go the values that stand
 * (`standingAsRead`), never a model's nor one two readers differ on.
 */

import { randomUUID } from 'node:crypto';
import { agentCapability, enrichIngestWithDocumentIntelligence } from '@realytica/agents';
import type { ChatIngestFile, ChatProposal, DdProject, EvidenceRecord, MayDecide, ProjectChatTurn } from '@realytica/shared';
import {
  absorbAnsweredGaps,
  ddForDocumentsProposal,
  decisionRefused,
  departmentOfPaper,
  DOCUMENT_WORKSTREAM,
  documentTypeOfKind,
  documentWorkstream,
  factFillProposals,
  flagFindingProposals,
  holdsADecision,
  keepReadings,
  kindAsRead,
  mayDecidePaper,
  MODEL_READER_VERSION,
  moveDocument,
  placeProposalsFromIngest,
  plural,
  proofOf,
  proposeOnRow,
  recordAuditEvent,
  setAsideOffPaper,
  readingSaid,
  standingAmongRead,
  standingFacts,
  waitingAsRead,
} from '@realytica/shared';
import { mergeModelReading, needsModelReading, readIngestLocally } from './intake';
import { PAPERS_AT_ONCE, together } from './together';

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
 * What a paper's kind is, is for anybody to say who may write on its row.
 * What that sets aside on the row is not: setting a read value aside is a
 * decision, and a lead's or a signer's of the department that holds the paper
 * (`mayDecide`, where a person is asking). Said by anybody else, the kind is
 * taken and the values it does not carry stay where they wait. Nobody can
 * accept one meanwhile and nothing acts on it (`paperCarries`), so they wait
 * for whoever may set them aside.
 */
function setAsideWhatItDoesNotCarry(project: DdProject, evidence: EvidenceRecord, actor: string, mayDecide: MayDecide | undefined): void {
  if (!mayDecide || mayDecidePaper(project, evidence, mayDecide)) setAsideOffPaper(evidence, actor);
}

/**
 * Give a row its type. A paper is held by the function its kind belongs to
 * unless something closer says whose it is, so naming the kind of a paper a
 * function already holds can move it to another. That is held to the rule for
 * a move (`moveDocument`): with `mayDecide`, it takes a lead or a signer of
 * the department that holds the paper now, anybody else is refused before
 * anything changes, and the move is written on the trail. A paper no function
 * holds yet is given its first home by whoever says what it is, unless a
 * value on it has already been decided.
 */
function nameThePaper(project: DdProject, evidence: EvidenceRecord, documentType: string, actor: string, mayDecide: MayDecide | undefined, change: () => void): void {
  /*
   * A row that holds a value somebody decided. What the row is called says
   * which of its values stand, so calling it something else takes accepted
   * values out of force, or puts them back, even where the paper stays in the
   * function it is in. That is a decision on the paper: its department's lead
   * or signer makes it, and nobody else.
   */
  if (mayDecide && documentType !== evidence.documentType && holdsADecision(evidence) && !mayDecidePaper(project, evidence, mayDecide)) {
    throw decisionRefused('Saying what a paper is once a value on it has been decided', departmentOfPaper(project, evidence, mayDecide), mayDecide);
  }
  moveDocument(project, evidence, (record) => documentWorkstream(record, { ...evidence, documentType }), actor, mayDecide, change);
}

/**
 * A person says the paper is what a model took it for: the offer becomes the
 * row's type, and the row now answers whatever was waiting for that paper.
 * False when the row has no offer to confirm. Where that moves a paper a
 * function already holds, see `nameThePaper`.
 */
export function confirmProposedType(project: DdProject, evidenceId: string, actor = 'operator', options: { mayDecide?: MayDecide } = {}): boolean {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  const offered = evidence?.proposedDocumentType;
  if (!evidence || !offered) return false;
  nameThePaper(project, evidence, offered, actor, options.mayDecide, () => {
    evidence.documentType = offered;
    delete evidence.proposedDocumentType;
    evidence.updatedAt = new Date().toISOString();
  });
  recordAuditEvent(project, { actor, action: 'type_confirmed', entityType: 'evidence', entityId: evidence.id, newValue: evidence.documentType });
  setAsideWhatItDoesNotCarry(project, evidence, actor, options.mayDecide);
  absorbAnsweredGaps(project, evidence);
  return true;
}

/**
 * A person says the paper is not what a model took it for. The offer goes
 * and is remembered as refused, so the next reading does not make it again;
 * the row keeps whatever type it had. What the model read as values of that
 * kind of paper is set aside with it: a nil-encumbrance answer is no reading
 * of a paper that is not an encumbrance certificate. Where the person saying
 * so may not decide the paper, those values wait instead
 * (`setAsideWhatItDoesNotCarry`). False when there is no offer.
 */
export function setAsideProposedType(project: DdProject, evidenceId: string, actor = 'operator', options: { mayDecide?: MayDecide } = {}): boolean {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence?.proposedDocumentType) return false;
  evidence.refusedDocumentType = evidence.proposedDocumentType;
  delete evidence.proposedDocumentType;
  evidence.updatedAt = new Date().toISOString();
  recordAuditEvent(project, { actor, action: 'type_refused', entityType: 'evidence', entityId: evidence.id, newValue: evidence.refusedDocumentType });
  setAsideWhatItDoesNotCarry(project, evidence, actor, options.mayDecide);
  return true;
}

/** The types a person can say a paper is: the ones the register files a paper under. */
export const DOCUMENT_TYPES: readonly string[] = Object.keys(DOCUMENT_WORKSTREAM);

/**
 * A person says what the paper is, in place of what a model took it for.
 * Their word is the row's type, and the row answers whatever was waiting for
 * that paper. What the model read as values of the kind it took the paper
 * for, and the paper as now named does not carry, is set aside, where the
 * person may decide the paper as now named. False when there is no offer to
 * correct, or the type is not one the register knows. Where that moves a
 * paper a function already holds, see `nameThePaper`.
 */
export function correctProposedType(project: DdProject, evidenceId: string, documentType: string, actor = 'operator', options: { mayDecide?: MayDecide } = {}): boolean {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  const offered = evidence?.proposedDocumentType;
  if (!evidence || !offered || !DOCUMENT_TYPES.includes(documentType)) return false;
  nameThePaper(project, evidence, documentType, actor, options.mayDecide, () => {
    if (documentType !== offered) evidence.refusedDocumentType = offered;
    evidence.documentType = documentType;
    delete evidence.proposedDocumentType;
    evidence.updatedAt = new Date().toISOString();
  });
  recordAuditEvent(project, { actor, action: 'type_corrected', entityType: 'evidence', entityId: evidence.id, newValue: evidence.documentType });
  setAsideWhatItDoesNotCarry(project, evidence, actor, options.mayDecide);
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
    /**
     * Called as each paper's reading is put on its row, in the order they
     * finish, for whoever keeps the record to save it there and then. A paper
     * read is then on the file whatever becomes of the request and of the
     * papers still being read.
     */
    landed?: (file: ChatIngestFile) => Promise<void>;
  } = {},
): Promise<{ read: number; files: ChatIngestFile[] }> {
  const cards: ChatProposal[] = [];
  const labels: string[] = [];
  const flagged: string[] = [];
  const cited: string[] = [];
  /** What a model took an unrecognised paper for: said, and left for a person to confirm. */
  const proposedTypes: string[] = [];
  /** Rows that kept their kind though the file put on them reads as another: said, and left for a person to confirm or correct. */
  const keptKinds: Array<{ file: string; is: string; readAs: string }> = [];
  let scans = 0;
  let spend: ProjectChatTurn['spend'];
  // Without a model reader, "ask to read the filed documents" would read the same pages to the same end.
  const modelReader = agentCapability().available;
  /** When the model reader's time for the batch ends: counted from the first paper handed to it. */
  let modelStop: number | undefined;
  /** One paper is put on its row, and saved, at a time. */
  let landing: Promise<void> = Promise.resolve();

  /** What one paper's reading put on its row, kept for the note that reports the batch. */
  interface Landed {
    upload: RegisterUpload;
    file: ChatIngestFile;
    known: boolean;
    label: string;
    /** What a model took the paper for, left on the row as an offer. */
    offered?: string;
    /** What the rules read the file as, where the row already had another kind and kept it. */
    readAs?: string;
  }

  /**
   * One paper's reading put on the row it was filed on: what it states, each
   * value waiting, and what it is. The cards it raises are the batch's, and
   * are raised with its note.
   */
  const putOnRow = (upload: RegisterUpload, file: ChatIngestFile): Landed | undefined => {
    // How much of the file was read, kept on the file: a paper read in part must not look like one read whole.
    keepReadings(project, [file]);
    const doc = file.read;
    // A paper only the model made sense of has no type from the rules, and its values were each found on their page.
    const known = Boolean(doc && doc.type !== 'other');
    // The whole reading goes onto the row, each value proposed. That is filing what was read, not acting on it.
    const facts = !doc ? [] : known ? doc.facts : waitingAsRead(doc).filter((f) => f.source === 'model');
    if (!doc || (!known && !facts.length)) return undefined;

    const evidence = project.evidence.find((e) => e.id === upload.evidenceId);
    if (!evidence) return undefined;
    // A row with no kind is named for what the rules read it as. What a model alone took it for is offered, and names nothing until a
    // person confirms it. So is what the rules read where the row already has another kind: a reading never renames a paper.
    const label = known ? doc.label : (evidence.documentType ?? 'document');
    const offer = kindAsRead(evidence, known ? { known: doc.label } : { offered: documentTypeOfKind(file.kindHint) });
    /** The row is the kind the rules read: it was named so just now, or already was. */
    const named = known && evidence.documentType === doc.label;
    // What it states waits on the row, value by value, for a person to accept: put there once the row says what the paper is, so
    // a value its kind does not carry never waits.
    evidence.facts = proposeOnRow(evidence, facts);
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
    // A waiting row is answered by a paper somebody, or the rules, said is that paper. Never on a model's word alone, and never by
    // a reading its own row does not go by.
    if (named) absorbAnsweredGaps(project, evidence);
    return { upload, file, known, label, ...(offer ? (known ? { readAs: offer } : { offered: offer }) : {}) };
  };

  /*
   * The papers are read a few at a time, each down its own lane: read here,
   * read by a model where the router sends it (`routeReading`), and put on
   * its row the moment it is read. One paper failing is that paper's.
   */
  const lanes = await together(uploads, PAPERS_AT_ONCE, async (upload): Promise<{ file: ChatIngestFile; landed?: Landed } | undefined> => {
    if (upload.sitePhoto) return undefined;
    const isImage = upload.mimeType.startsWith('image/');
    if (isImage && scans >= MAX_SCANS_PER_BATCH) return undefined;
    const row: ChatIngestFile = {
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      storageKey: upload.storageKey,
    };
    let pages: string[] | undefined;
    let file = await readIngestLocally(row, upload.buffer, undefined, { deadline: opts.deadline, onPages: (read) => (pages = read) });
    if (file.read?.method && file.read.method !== 'text') scans += 1;

    // The model reads afterwards, and only what the router sends it.
    if (modelReader && needsModelReading(file)) {
      modelStop ??= Date.now() + (opts.modelBudgetMs ?? MODEL_READ_BUDGET_MS);
      try {
        const [answer] = await enrichIngestWithDocumentIntelligence({
          project,
          files: [{ ...file, read: undefined }],
          buffers: [upload.buffer],
          // What this server already read, so a quote found in its page's own words is placed there without another call.
          pageTexts: [pages],
          deadline: modelStop - MODEL_START_MARGIN_MS,
          stopAt: modelStop,
          onSpend: (cost) => (spend = { usd: (spend?.usd ?? 0) + cost.usd, exact: (spend?.exact ?? true) && cost.exact }),
        });
        file = mergeModelReading(file, answer);
      } catch {
        /* this server's reading stands */
      }
    }

    let landed: Landed | undefined;
    const read = file;
    const mine = (landing = landing.then(async () => {
      landed = putOnRow(upload, read);
      await opts.landed?.(read)?.catch((err: unknown) => console.warn(`[reading] could not save ${upload.fileName} as it was read: ${(err as Error).message}`));
    }));
    await mine;
    return { file, ...(landed ? { landed } : {}) };
  });
  await landing;

  // Said and raised in the order the papers were filed, whichever was read first.
  const read = lanes.flatMap((lane, n) => (lane.status === 'fulfilled' && lane.value ? [{ upload: uploads[n]!, ...lane.value }] : []));
  const partly: string[] = [];
  for (const { upload, file, landed } of read) {
    const said = readingSaid(file.reading, modelReader);
    if (said) partly.push(`${upload.fileName}: ${said}`);
    if (!landed) continue;
    const doc = file.read!;
    const evidence = project.evidence.find((e) => e.id === upload.evidenceId);
    if (!evidence) continue;
    if (landed.offered) proposedTypes.push(landed.offered);
    if (landed.readAs) keptKinds.push({ file: upload.fileName, is: evidence.documentType ?? 'document', readAs: landed.readAs });
    if (landed.known) {
      const source = { fileName: upload.fileName, evidenceId: evidence.id, storageKey: upload.storageKey, documentLabel: evidence.documentType ?? doc.label };
      /*
       * To the checks go the values that stand on the row now, among those
       * this reading brought. Never the reading as it was read: the row may
       * hold a person's decision about one of them. A value they set aside
       * there is offered to no check, a model's and one two readers differ on
       * wait on the row, and a value the row's own kind does not carry is no
       * reading of its paper.
       */
      cards.push(...factFillProposals(project, standingAmongRead(evidence, doc), source, actor, cards));
      cards.push(...flagFindingProposals(project, doc.flags, source, actor, cards));
    }
    cards.push(...placeProposalsFromIngest(project, [file], actor).filter((p) => !cards.some((c) => c.title === p.title)));
    labels.push(/^[A-Z][a-z]/.test(landed.label) ? landed.label.charAt(0).toLowerCase() + landed.label.slice(1) : landed.label);
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
    ...keptKinds.map((kept) => `\n${kept.file} reads as ${article(kept.readAs)}, and its row says ${article(kept.is)}. The row keeps its kind until somebody confirms or corrects it there, and what only the other kind carries waits meanwhile.`),
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
