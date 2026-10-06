/**
 * What a read document should put in front of a person.
 *
 * `document-parse` says what a document is and what it states. This decides
 * what that means for THIS file: which expected-evidence row it answers,
 * which blank check fields it can fill, and which of its statements are
 * findings. Every output is a card; nothing here writes a register.
 *
 * The rule throughout is that a document may only propose what it says. A
 * value it states fills a blank field, never overwrites one a person already
 * recorded; a flag it raises becomes a finding only when the same finding is
 * not already open.
 */

import { checkSchema } from './operations';
import { acceptedFacts, standingFacts, settled, waitingReadings } from './fact-review';
import { CHECK_DEFINITIONS, DD_TYPE_DEFINITIONS } from './libraries';
import { SCOPE_LABEL } from './catalogs';
import { formatFieldValue, isBlank } from './check-fields';
import { createChatProposal } from './wizard';
import { documentAnswers, type DocumentFact, type DocumentFlag } from './document-parse';
import { surveyPieces } from './revenue-map';
import type { ChatIngestFile, ChatProposal, CheckFieldDef, CheckInstance, DdProject, EvidenceRecord, FindingSeverity, ScopeKey } from './types';

/* ==================================================================== */
/* Which row                                                             */
/* ==================================================================== */

const OPEN = new Set(['expected', 'missing', 'requested']);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
}

/**
 * The open evidence row a read document answers, if any.
 *
 * Scored on what the document IS — its type's own vocabulary — rather than
 * its filename. "Sale deed (registered conveyance)" and "Mother deed / title
 * chain" both contain "deed"; the old filename matcher filed a 2019 sale deed
 * against the mother-deed row for exactly that reason. Here a sale deed's
 * hints are "sale deed", "registered conveyance", and the mother deed's are
 * "mother deed", "title chain", so the phrase decides and the shared word
 * does not.
 *
 * A row the screen raised names the document kind it is waiting for
 * (`gap:<kind>`); that is the strongest match of all, and it wins outright.
 */
export function matchReadToRow(project: DdProject, read: NonNullable<ChatIngestFile['read']>, documentKind?: string): EvidenceRecord | undefined {
  const gaps = project.evidence.filter((e) => OPEN.has(e.status));
  if (!gaps.length || read.type === 'other') return undefined;
  let best: EvidenceRecord | undefined;
  let bestScore = 0;
  for (const row of gaps) {
    const title = ` ${row.title.toLowerCase()} `;
    let score = 0;
    if (documentKind && row.screenCode === `gap:${documentKind}`) score += 100;
    for (const hint of read.rowHints) {
      const h = hint.toLowerCase().trim();
      if (!h) continue;
      if (title.includes(` ${h} `) || title.includes(` ${h}`) || title.includes(h)) score += 10 + h.length;
    }
    // A word-level overlap only counts once the phrase has said something.
    if (score > 0) {
      const rowWords = new Set(words(row.title));
      score += words(read.label).filter((w) => rowWords.has(w)).length;
    }
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 10 ? best : undefined;
}

/* ==================================================================== */
/* Which blank fields                                                    */
/* ==================================================================== */

interface SeatedCheck {
  check: CheckInstance;
  assessmentId: string;
  scopeId: string;
  scopeKey: ScopeKey;
}

function everyCheck(project: DdProject): SeatedCheck[] {
  const out: SeatedCheck[] = [];
  for (const assessment of project.assessments) {
    if (assessment.status === 'archived') continue;
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) out.push({ check, assessmentId: assessment.id, scopeId: scope.id, scopeKey: scope.scopeKey });
    }
  }
  return out;
}

/**
 * The same value already waits for this field. A DIFFERENT value is offered
 * beside it: two documents that disagree are a choice for a person, and
 * offering only whichever was read first would make it for them.
 *
 * "The same" is as `statesTheSame` reads it. Two papers that state one area a
 * rounding apart would otherwise both wait on a blank field, and the check
 * would ask a person to pick between them.
 */
function alreadyProposed(project: DdProject, checkId: string, def: CheckFieldDef, value: unknown, pending: ChatProposal[]): boolean {
  const key = def.key;
  return [...project.chatProposals, ...pending].some(
    (p) =>
      p.kind === 'record_check_fields'
      && p.status === 'proposed'
      && p.payload.checkId === checkId
      && typeof p.payload.values === 'object'
      && p.payload.values !== null
      && key in (p.payload.values as Record<string, unknown>)
      && !((p.payload.decided as Record<string, string> | undefined)?.[key])
      && statesTheSame(key, (p.payload.values as Record<string, unknown>)[key], value, isMeasure(def)),
  );
}

/**
 * A person has already decided this value for this field: accepted it, set it
 * aside, or kept what the check held in its place. It is not asked again.
 */
function alreadyDecided(project: DdProject, checkId: string, key: string, value: unknown): boolean {
  return project.chatProposals.some(
    (p) =>
      p.kind === 'record_check_fields'
      && p.payload.checkId === checkId
      && Boolean((p.payload.decided as Record<string, string> | undefined)?.[key])
      && String(((p.payload.values ?? {}) as Record<string, unknown>)[key]) === String(value),
  );
}

/**
 * How close two measures have to be to be one measure rounded twice: within
 * one unit of each other, and within half a percent of the larger. The unit
 * is what a paper rounds an area to. The share keeps a road nine metres wide
 * apart from one nine and a half. Two khatas that state 11,850 and 11,900 are
 * fifty apart, and that is two figures for a person to choose between.
 */
export const SAME_MEASURE_UNIT = 1;
export const SAME_MEASURE_SHARE = 0.005;

/** The units a length is written in. An area is its own kind of field. */
const LENGTH_UNITS = new Set(['m', 'ft', 'km', 'mm', 'cm', 'sqm', 'sq ft', 'sqft', 'acres', 'guntas']);

/**
 * Whether a check's field holds a measure: an area, or a number with a unit
 * of length. Only a measure is rounded differently from one paper to the
 * next. A budget, a ratio, a count of units, a year and a khata number read as
 * a number are exact, and one off is another value.
 */
export function isMeasure(def: Pick<CheckFieldDef, 'kind' | 'unit'>): boolean {
  return def.kind === 'area' || LENGTH_UNITS.has((def.unit ?? '').toLowerCase());
}

/**
 * The survey numbers a value names, as written and without their spaces:
 * "Sy. Nos. 41/1 & 42" names 41/1 and 42, and 41A is not 41B. Read as a list
 * of survey numbers is read everywhere else (`surveyPieces`), so a piece that
 * is not one number names none. Nor does a run of five digits or more: that
 * is a pin code in an address, not a parcel.
 */
export function surveyNumbersIn(value: unknown): string[] {
  return surveyPieces(String(value ?? '')).flatMap((piece) => (piece.unreadable || /^\d{5,}$/.test(piece.surveyNo) ? [] : [piece.surveyNo.toUpperCase()]));
}

/**
 * Whether a value a document states says what is already held for it.
 *
 * Read as a person would read the two side by side. Words are the same
 * whatever their case, spacing or punctuation: an enum is recorded as the
 * check spells it and stated as the document does, and "K. Ramaiah" is "K
 * Ramaiah". Survey numbers are the same land when every number the document
 * names is among those held: a deed for one parcel of three agrees with the
 * list that names all three, and a paper that names a parcel the list does
 * not have does not.
 *
 * `measure` says the two are measures (see `isMeasure`). Two measures are the
 * same when they are within a unit and half a percent of each other: a khata
 * in square feet and a deed in square metres round one area twice. Any other
 * number is the same only when it is the same number.
 */
export function statesTheSame(key: string, held: unknown, stated: unknown, measure = false): boolean {
  if (key === 'survey_numbers') {
    const theirs = surveyNumbersIn(held);
    const ours = surveyNumbersIn(stated);
    if (theirs.length && ours.length) return ours.every((n) => theirs.includes(n));
  }
  if (measure && typeof held === 'number' && typeof stated === 'number') {
    const apart = Math.abs(held - stated);
    return apart < SAME_MEASURE_UNIT && apart <= SAME_MEASURE_SHARE * Math.max(Math.abs(held), Math.abs(stated));
  }
  // A full stop is part of a number and of nothing else.
  const plain = (value: unknown) => String(value).toLowerCase().replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/[^\p{L}\p{N}.]+/gu, ' ').trim();
  return plain(held) === plain(stated);
}

/**
 * Whether a person has already decided this value of this paper's, on some
 * check: accepted it, set it aside, or kept what the check held in its place.
 * Such a value is settled for that paper, and is not called out again each
 * time the paper is read. It is settled for no other paper: one khata's
 * parcel set aside says nothing of the deed that states the same parcel next.
 */
export function decidedOnACheck(project: DdProject, key: string, value: unknown, evidence: Pick<EvidenceRecord, 'id' | 'attachments'>): boolean {
  // A card knows its paper by the row's id, or by the file's key where the card was made before the row was.
  const files = new Set(evidence.attachments.map((a) => a.storageKey));
  return project.chatProposals.some(
    (p) =>
      p.kind === 'record_check_fields'
      && (p.payload.sourceEvidenceId === evidence.id || (typeof p.payload.sourceStorageKey === 'string' && files.has(p.payload.sourceStorageKey)))
      && Boolean((p.payload.decided as Record<string, string> | undefined)?.[key])
      && String(((p.payload.values ?? {}) as Record<string, unknown>)[key]) === String(value),
  );
}

/** Whether a check's field can hold a value: an enum takes only one of its own options, and a value the document phrases differently is quoted, not forced. */
function fieldTakes(def: CheckFieldDef, value: unknown): boolean {
  return !(def.kind === 'enum' && def.options?.length && !def.options.some((o) => o.toLowerCase() === String(value).toLowerCase()));
}

/**
 * Whether a value a document states is put to a check that already holds
 * another for the field: the two differ, the field can hold the new one, and
 * a person has not already decided this value for this field.
 *
 * The card that offers such a value and the line that calls it out both ask
 * this, so a line is never said with no card behind it, and a value a person
 * set aside is not raised again each time the paper is read.
 */
export function differsOnCheck(project: DdProject, check: CheckInstance, def: CheckFieldDef, fact: DocumentFact): boolean {
  const held = check.fields?.[fact.key];
  if (isBlank(held) || Array.isArray(held!.value) || def.kind === 'computed') return false;
  if (statesTheSame(fact.key, held!.value, fact.value, isMeasure(def)) || !fieldTakes(def, fact.value)) return false;
  // On a site of several parcels the check may hold one parcel's number and the paper state another's. Where both are the
  // project's own parcels they do not differ. A check that holds a number the project does not have is still put right.
  const ownLand = (value: unknown) => statesTheSame(fact.key, project.parcelId, value);
  if (fact.key === 'survey_numbers' && surveyNumbersIn(project.parcelId).length && ownLand(fact.value) && ownLand(held!.value)) return false;
  return !alreadyDecided(project, check.id, fact.key, fact.value);
}

/**
 * Cards that fill blank check fields with what a document states.
 *
 * One card per check, carrying every value this document has for it, with
 * the page and words behind each. A field somebody already recorded is never
 * overwritten.
 *
 * With `differences`, a value that disagrees with the one recorded is offered
 * too, and the card says what is recorded and where that came from. It then
 * waits on the check beside the recorded value, where a person keeps one or
 * the other: accepting the card does not choose between them. That is for a
 * document as it is read, once. Without it a recorded field is left alone, as
 * it is when the checks are refilled from documents already on file, where
 * the same disagreement would be raised again on every pass.
 *
 * Whatever it is handed, a value that waits is offered to no check: a model's
 * reading nobody has accepted, or one two readers differ on (`stands`). A
 * caller hands it a paper's standing values; this is the second lock.
 */
export function factFillProposals(
  project: DdProject,
  read: readonly DocumentFact[],
  source: { fileName: string; evidenceId?: string; storageKey?: string; documentLabel?: string },
  actor = 'operator',
  pending: ChatProposal[] = [],
  options: { differences?: boolean } = {},
): ChatProposal[] {
  const facts = read.filter(settled);
  if (!facts.length) return [];
  const out: ChatProposal[] = [];
  for (const seated of everyCheck(project)) {
    const { fields } = checkSchema(seated.check);
    if (!fields.length) continue;
    const values: Record<string, string | number | boolean> = {};
    const citations: Record<string, { page: number; quote: string; value: string | number | boolean }> = {};
    const lines: string[] = [];
    const against: string[] = [];
    for (const fact of facts) {
      const def = fields.find((f) => f.key === fact.key);
      if (!def || def.kind === 'computed') continue;
      const held = seated.check.fields?.[fact.key];
      if (!isBlank(held) && !(options.differences && differsOnCheck(project, seated.check, def, fact))) continue;
      if (alreadyProposed(project, seated.check.id, def, fact.value, [...pending, ...out])) continue;
      if (!fieldTakes(def, fact.value)) continue;
      values[fact.key] = fact.value;
      citations[fact.key] = { page: fact.page, quote: fact.quote, value: fact.value };
      lines.push(`${def.label}: ${fact.display} — “${fact.quote}” (p.${fact.page})`);
      if (!isBlank(held)) {
        const from = held!.sourceEvidenceId ? project.evidence.find((e) => e.id === held!.sourceEvidenceId) : undefined;
        against.push(`${def.label} is ${formatFieldValue(def, held)} on the check${from ? `, from ${from.documentType ?? from.title}${held!.page ? ` p.${held!.page}` : ''}` : `, recorded by ${held!.by}`}`);
      }
    }
    const keys = Object.keys(values);
    if (!keys.length) continue;
    out.push(
      createChatProposal(
        'record_check_fields',
        `Record ${keys.length === 1 ? fields.find((f) => f.key === keys[0])!.label.toLowerCase() : `${keys.length} values`} on “${seated.check.title}”`,
        `Read off ${source.documentLabel ? `the ${source.documentLabel.toLowerCase()}` : source.fileName}. ${lines.join(' ')}${against.length ? ` Differs from what is recorded: ${against.join('; ')}.` : ''}`,
        against.length
          ? 'Writes these values onto the check, citing the document. A value that differs from the one recorded waits beside it on the check until a person keeps one. The check result is not changed.'
          : 'Writes these values onto the check, citing the document. The check result is not changed — whether it passes is still a person’s call.',
        {
          checkId: seated.check.id,
          values,
          citations,
          sourceEvidenceId: source.evidenceId,
          sourceStorageKey: source.storageKey,
          sourceFileName: source.fileName,
        },
        actor,
        { citedNodeIds: [seated.check.id, seated.assessmentId], citedEvidenceIds: source.evidenceId ? [source.evidenceId] : undefined },
      ),
    );
  }
  return out;
}

/* ==================================================================== */
/* Which findings                                                        */
/* ==================================================================== */

const DISCIPLINE_FOR_FLAG: Array<[RegExp, ScopeKey]> = [
  [/\b(?:EC|encumbrance|mortgage|charge|title|deed)\b/i, 'legal'],
  [/\b(?:conversion|zoning|sanction|FAR|plan)\b/i, 'regulatory'],
  [/\b(?:extent|survey|boundary)\b/i, 'land_site'],
];

/**
 * A card for each red flag a document raises, once.
 *
 * "Once" across the file: the same subsisting mortgage read off the EC and
 * off a scan of the same EC is one finding, not two.
 */
export function flagFindingProposals(
  project: DdProject,
  flags: readonly DocumentFlag[],
  source: { fileName: string; evidenceId?: string; storageKey?: string; documentLabel?: string },
  actor = 'operator',
  pending: ChatProposal[] = [],
): ChatProposal[] {
  const out: ChatProposal[] = [];
  const open = project.findings.filter((f) => !['closed', 'rejected', 'duplicate', 'superseded'].includes(f.status));
  for (const flag of flags) {
    const key = flag.title.toLowerCase();
    if (open.some((f) => f.title.toLowerCase() === key)) continue;
    if ([...project.chatProposals, ...pending, ...out].some((p) => p.kind === 'add_finding' && p.status === 'proposed' && String(p.payload.title).toLowerCase() === key)) continue;
    const discipline = DISCIPLINE_FOR_FLAG.find(([re]) => re.test(`${flag.title} ${flag.description}`))?.[1] ?? 'legal';
    out.push(
      createChatProposal(
        'add_finding',
        `${severityWord(flag.severity)}: ${flag.title}`,
        `${flag.description} “${flag.quote}” (${source.documentLabel ?? source.fileName}, p.${flag.page})`,
        `Raises a ${flag.severity} ${SCOPE_LABEL[discipline]} finding, linked to the document.`,
        {
          title: flag.title,
          description: `${flag.description} Source: ${source.documentLabel ?? source.fileName}, page ${flag.page} — “${flag.quote}”`,
          severity: flag.severity,
          discipline,
          evidenceIds: source.evidenceId ? [source.evidenceId] : [],
          sourceStorageKey: source.storageKey,
        },
        actor,
        { citedEvidenceIds: source.evidenceId ? [source.evidenceId] : undefined },
      ),
    );
  }
  return out;
}

function severityWord(severity: FindingSeverity): string {
  return severity === 'critical' ? 'Critical' : severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low';
}

/* ==================================================================== */
/* Facts already on file                                                 */
/* ==================================================================== */

/**
 * Every fact on the register that stands, newest document first.
 *
 * What a chat answer reads, and what a newly started DD is offered: the
 * extent a deed stated in week one is still true when the parcel check is
 * instantiated in week two. A model's reading nobody has accepted, and a
 * value two readers differ on, are not on file: they wait
 * (`readingsWaitingOnFile`), and an answer says so.
 */
export function factsOnFile(project: DdProject): Array<{ fact: DocumentFact; evidence: EvidenceRecord }> {
  const out: Array<{ fact: DocumentFact; evidence: EvidenceRecord }> = [];
  const rows = [...project.evidence].filter((e) => standingFacts(e).length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const evidence of rows) for (const fact of standingFacts(evidence)) out.push({ fact, evidence });
  return out;
}

/** Every reading that waits on a paper still relied on and acts on nothing, newest document first. */
export function readingsWaitingOnFile(project: DdProject): Array<{ fact: DocumentFact; evidence: EvidenceRecord }> {
  const out: Array<{ fact: DocumentFact; evidence: EvidenceRecord }> = [];
  const rows = [...project.evidence].filter((e) => e.status !== 'superseded' && e.status !== 'rejected').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const evidence of rows) for (const fact of waitingReadings(evidence)) out.push({ fact, evidence });
  return out;
}

/**
 * Cards filling blank fields from documents already filed.
 *
 * Offered when a DD starts, or when somebody asks to fill the checks from
 * the documents. Per document, so each card cites one source.
 */
export function pendingFactProposals(project: DdProject, actor = 'operator', pending: ChatProposal[] = []): ChatProposal[] {
  const out: ChatProposal[] = [];
  // Only what a person accepted the document as stating fills a check.
  const rows = project.evidence.filter((e) => acceptedFacts(e).length);
  for (const evidence of rows) {
    out.push(
      ...factFillProposals(
        project,
        acceptedFacts(evidence),
        {
          fileName: evidence.attachments[0]?.fileName ?? evidence.title,
          evidenceId: evidence.id,
          documentLabel: evidence.documentType ?? evidence.title,
        },
        actor,
        [...pending, ...out],
      ),
    );
  }
  return out;
}

/* ==================================================================== */
/* Which DD                                                              */
/* ==================================================================== */

/**
 * The DD these documents are evidence for, when none is running yet.
 *
 * A new file gets its deed, EC and khata before anybody has decided which
 * diligence to run, so the values they state have no check to land on and
 * the documents sit filed and inert. This offers the DD whose checks would
 * ask for those values — recommended for the project's stage first — with
 * the count of values already waiting for it. Approving it instantiates the
 * checks, and the same approval offers the values.
 */
export function ddForDocumentsProposal(
  project: DdProject,
  read: readonly DocumentFact[],
  actor = 'operator',
  pending: ChatProposal[] = [],
): ChatProposal | undefined {
  // A value that waits is not counted as waiting for a check: see `factFillProposals`.
  const facts = read.filter(settled);
  if (!facts.length) return undefined;
  if (project.assessments.some((a) => a.status !== 'archived')) return undefined;
  if ([...project.chatProposals, ...pending].some((p) => p.kind === 'start_dd' && p.status === 'proposed')) return undefined;
  const keys = new Set(facts.map((f) => f.key));
  const stage = project.currentStage;
  const candidates = [...DD_TYPE_DEFINITIONS]
    .filter((d) => d.key !== 'custom')
    .sort((a, b) => Number(b.typicalStages.includes(stage)) - Number(a.typicalStages.includes(stage)));
  let best: { def: (typeof DD_TYPE_DEFINITIONS)[number]; answered: number } | undefined;
  for (const def of candidates) {
    const scopes = new Set(def.defaultScopes);
    const answered = new Set<string>();
    for (const check of CHECK_DEFINITIONS) {
      if (!scopes.has(check.scopeKey)) continue;
      for (const field of check.fields ?? []) if (keys.has(field.key)) answered.add(field.key);
    }
    if (answered.size && (!best || answered.size > best.answered)) best = { def, answered: answered.size };
  }
  if (!best) return undefined;
  return createChatProposal(
    'start_dd',
    `Start ${best.def.label}`,
    `${best.answered} value${best.answered === 1 ? '' : 's'} read from your documents ${best.answered === 1 ? 'is' : 'are'} waiting for this DD's checks. ${best.def.purpose}`,
    `Instantiates ${best.def.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ')}, then offers the values your documents state for its checks.`,
    { ddType: best.def.key, owner: project.owner || actor, targetType: 'project', name: best.def.label },
    actor,
  );
}

/**
 * Let one filed document answer every open row that is waiting for it.
 *
 * The Karnataka pack expects "Sale deed (registered conveyance)"; the
 * acquisition DD's parcel check expects "Title extract". A registered sale
 * deed is both. Filing it against one left the other reporting the proof
 * missing, so the check stayed red with the deed on file. Each other open row
 * this document answers is folded into it: its checks, scopes and DD link to
 * the filed row, and the empty row is marked superseded by it — kept, with
 * the pointer, rather than deleted, so the register still shows what was
 * asked for and what answered it.
 */
export function absorbAnsweredGaps(project: DdProject, filed: EvidenceRecord, at = new Date().toISOString()): EvidenceRecord[] {
  if (!filed.documentType || !filed.attachments.length) return [];
  const absorbed: EvidenceRecord[] = [];
  for (const gap of project.evidence) {
    if (gap.id === filed.id || !OPEN.has(gap.status) || gap.attachments.length) continue;
    if (!documentAnswers(filed.documentType, gap.title)) continue;
    for (const id of gap.assessmentIds) if (!filed.assessmentIds.includes(id)) filed.assessmentIds.push(id);
    for (const id of gap.scopeInstanceIds) if (!filed.scopeInstanceIds.includes(id)) filed.scopeInstanceIds.push(id);
    for (const id of gap.checkIds) if (!filed.checkIds.includes(id)) filed.checkIds.push(id);
    for (const assessment of project.assessments) {
      for (const scope of assessment.scopes) {
        for (const check of scope.checks) {
          if (!gap.checkIds.includes(check.id) && !check.evidenceIds.includes(gap.id)) continue;
          check.evidenceIds = check.evidenceIds.filter((e) => e !== gap.id);
          if (!check.evidenceIds.includes(filed.id)) check.evidenceIds.push(filed.id);
        }
      }
    }
    gap.status = 'superseded';
    gap.supersededById = filed.id;
    gap.updatedAt = at;
    absorbed.push(gap);
  }
  if (absorbed.length) filed.updatedAt = at;
  return absorbed;
}
