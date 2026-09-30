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
import { CHECK_DEFINITIONS, DD_TYPE_DEFINITIONS } from './libraries';
import { SCOPE_LABEL } from './catalogs';
import { isBlank } from './check-fields';
import { createChatProposal } from './wizard';
import { documentAnswers, type DocumentFact, type DocumentFlag } from './document-parse';
import type { ChatIngestFile, ChatProposal, CheckInstance, DdProject, EvidenceRecord, FindingSeverity, ScopeKey } from './types';

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

function alreadyProposed(project: DdProject, checkId: string, key: string, pending: ChatProposal[]): boolean {
  return [...project.chatProposals, ...pending].some(
    (p) =>
      p.kind === 'record_check_fields'
      && p.status === 'proposed'
      && p.payload.checkId === checkId
      && typeof p.payload.values === 'object'
      && p.payload.values !== null
      && key in (p.payload.values as Record<string, unknown>),
  );
}

/**
 * Cards that fill blank check fields with what a document states.
 *
 * One card per check, carrying every value this document has for it, with
 * the page and words behind each. A field somebody already recorded is left
 * alone even when the document disagrees — the disagreement is for a person,
 * and the engine will compute it the moment both values are on the check.
 */
export function factFillProposals(
  project: DdProject,
  facts: readonly DocumentFact[],
  source: { fileName: string; evidenceId?: string; storageKey?: string; documentLabel?: string },
  actor = 'operator',
  pending: ChatProposal[] = [],
): ChatProposal[] {
  if (!facts.length) return [];
  const out: ChatProposal[] = [];
  for (const seated of everyCheck(project)) {
    const { fields } = checkSchema(seated.check);
    if (!fields.length) continue;
    const values: Record<string, string | number | boolean> = {};
    const citations: Record<string, { page: number; quote: string; value: string | number | boolean }> = {};
    const lines: string[] = [];
    for (const fact of facts) {
      const def = fields.find((f) => f.key === fact.key);
      if (!def || def.kind === 'computed') continue;
      if (!isBlank(seated.check.fields?.[fact.key])) continue;
      if (alreadyProposed(project, seated.check.id, fact.key, [...pending, ...out])) continue;
      // An enum only takes one of its own options; a value the document
      // phrases differently is quoted, not forced.
      if (def.kind === 'enum' && def.options?.length && !def.options.some((o) => o.toLowerCase() === String(fact.value).toLowerCase())) continue;
      values[fact.key] = fact.value;
      citations[fact.key] = { page: fact.page, quote: fact.quote, value: fact.value };
      lines.push(`${def.label}: ${fact.display} — “${fact.quote}” (p.${fact.page})`);
    }
    const keys = Object.keys(values);
    if (!keys.length) continue;
    out.push(
      createChatProposal(
        'record_check_fields',
        `Record ${keys.length === 1 ? fields.find((f) => f.key === keys[0])!.label.toLowerCase() : `${keys.length} values`} on “${seated.check.title}”`,
        `Read off ${source.documentLabel ? `the ${source.documentLabel.toLowerCase()}` : source.fileName}. ${lines.join(' ')}`,
        'Writes these values onto the check, citing the document. The check result is not changed — whether it passes is still a person’s call.',
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
 * Every fact on the register, newest document first.
 *
 * What a chat answer reads, and what a newly started DD is offered: the
 * extent a deed stated in week one is still true when the parcel check is
 * instantiated in week two.
 */
export function factsOnFile(project: DdProject): Array<{ fact: DocumentFact; evidence: EvidenceRecord }> {
  const out: Array<{ fact: DocumentFact; evidence: EvidenceRecord }> = [];
  const rows = [...project.evidence].filter((e) => (e.facts ?? []).length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const evidence of rows) for (const fact of evidence.facts ?? []) out.push({ fact, evidence });
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
  const rows = project.evidence.filter((e) => (e.facts ?? []).length);
  for (const evidence of rows) {
    out.push(
      ...factFillProposals(
        project,
        evidence.facts ?? [],
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
  facts: readonly DocumentFact[],
  actor = 'operator',
  pending: ChatProposal[] = [],
): ChatProposal | undefined {
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
