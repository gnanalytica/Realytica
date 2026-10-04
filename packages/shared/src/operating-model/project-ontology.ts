/**
 * The closed ontology behind the project graph.
 *
 * This module exists because the project graph spent its first life without
 * one. Its relationship kind was `string`, so a typo became a new kind of
 * relationship and nothing said so; its node kinds were an inline union in
 * `types.ts` that could not be checked at runtime; and it had no rule about
 * which kinds an edge may join, so `has_check` from a report to a party was
 * a storable edge rather than a rejected one.
 *
 * The case graph (`graph/ontology.ts`) had all three from the start. Nothing
 * about the project graph made it a weaker candidate for them — it was simply
 * built later and faster, and it is the one the product actually persists. So
 * this is the same discipline, deliberately mirroring the case ontology's
 * vocabulary wherever the two describe the same thing: `conveyed_to` means
 * the same in both, and a person reading Cypher across the two label families
 * should not have to learn two words for one relation.
 *
 * Three properties are load-bearing:
 *
 * 1. **Closed kinds, checked at runtime.** A TypeScript union vanishes at the
 *    boundary. `isProjectNodeKind` survives to the moment an annotation
 *    arrives over HTTP, which is the only moment the check matters.
 *
 * 2. **Endpoint rules.** `encumbers` from a report to a decision is not a
 *    slightly-wrong edge, it is a meaningless one. The builder is trusted to
 *    be correct and the validator proves it in the tests; an authored edge is
 *    validated for real, because a person drawing a link by hand is exactly
 *    the case the ontology exists to constrain.
 *
 * 3. **Layers.** The case graph learned that WHAT A NODE IS (`layer`) and
 *    WHERE IT LIVES (`origin`) are different questions. The project graph now
 *    carries both for the same reason: the layer is what stops a chat thought
 *    being rendered beside a registered instrument as though the two were the
 *    same kind of claim.
 */

/* ==================================================================== */
/* Layers                                                                */
/* ==================================================================== */

/**
 * The case graph's five layers, and a sixth for how the work is organised.
 *
 * `structure` holds the four stages a project moves through, its departments
 * and their functions, the engagements clients commission, the people on it
 * and the milestones it is built to. None of these is evidence or a
 * conclusion; they are the frame every record sits in, and the graph is where
 * the frame and the records meet: "everything Legal holds", "what an expired
 * approval stops", "who signs for what this touches" are walks across the two.
 *
 * The frame is the one the menu shows, so a person finds in the graph the
 * same four stages, five departments and functions they move between: the
 * twelve finer steps stay on the record and are not nodes, and Design is one
 * function inside Engineering.
 *
 * `report` sits in `judgement` rather than getting a `deliverable` layer of
 * its own: a report is the assembled conclusion, and everything the layer is
 * used for — ordering, colour, the one-way deliberation rule — treats it
 * exactly as it treats a finding.
 */
export type ProjectGraphLayer = 'structure' | 'entity' | 'evidence' | 'claim' | 'judgement' | 'deliberation';

export type ProjectGraphNodeKind =
  /* --- structure: how the work is organised ---------------------- */
  /** One of the four stages: Land, Pre-construction, Under construction or Completed. */
  | 'stage'
  /** One of the menu's five departments: Legal, Finance, Engineering, Commercial or Procurement. */
  | 'department'
  /**
   * A function: one ongoing piece of work inside a department, as the menu
   * names it (Title, Approvals, Valuation…). The kind keeps the record's word
   * because the stored graph is labelled by it. Every workstream is a function
   * by itself, except Design's four, which are the one function Design.
   */
  | 'workstream'
  /** A piece of work a client commissioned, drawing on functions. */
  | 'engagement'
  /** A person on the project, with a role in each department they reach. */
  | 'member'
  /** A planned piece of the build, with how far along it is. */
  | 'milestone'
  /* --- entities: what exists ------------------------------------- */
  | 'project'
  | 'asset'
  /** The land itself. Survey number, extent, tenure — the thing being bought. */
  | 'parcel'
  /** A person or organisation: a title party, or a stakeholder on the file. */
  | 'party'
  /** A registered conveyance — sale deed, gift deed, partition, grant. */
  | 'instrument'
  /** A body that issues, records or governs: BBMP, BDA, the sub-registrar. */
  | 'authority'
  /** A registered charge over the title: mortgage, lien, lis pendens. */
  | 'encumbrance'
  /** A sanction or permission: layout approval, DC conversion, RERA, OC. */
  | 'approval'
  /* --- evidence: what we hold ------------------------------------ */
  | 'evidence'
  /**
   * An occasion of LOOKING, as against a document received.
   *
   * In the evidence layer rather than the judgement one, and the limitations
   * are why: a visit is where evidence came from, and what could not be seen
   * on it bounds every conclusion drawn from it. Traversing "what is this
   * finding resting on" has to reach the visit and find "the roof was not
   * inspected", or the traversal has answered the wrong question.
   */
  | 'site_visit'
  /** A plan sheet placed on the ground from control points. */
  | 'sheet'
  /** A day's entry in the site log: manpower, work done, photographs, issues. */
  | 'site_entry'
  /** A list of questions put about the property, as the client or lender sent it. */
  | 'questionnaire'
  /* --- claims: what the evidence says ---------------------------- */
  /** Two sources disagreeing about the same subject, kept as its own node. */
  | 'contradiction'
  /** One question on a questionnaire with the answer given to it: what a source says, and what proves it. */
  | 'answer'
  /* --- judgements: what we concluded ----------------------------- */
  | 'assessment'
  | 'scope'
  | 'check'
  | 'finding'
  | 'risk'
  | 'action'
  | 'decision'
  | 'report'
  /** A function's living estimate, re-read whenever the file changes. */
  | 'quick_assessment'
  /** A report a named professional signed: the figure of record. */
  | 'certified_report'
  /* --- deliberation: how we got there ---------------------------- */
  | 'question'
  | 'thought'
  | 'proposal';

export const PROJECT_NODE_KINDS: readonly ProjectGraphNodeKind[] = [
  'stage',
  'department',
  'workstream',
  'engagement',
  'member',
  'milestone',
  'project',
  'asset',
  'parcel',
  'party',
  'instrument',
  'authority',
  'encumbrance',
  'approval',
  'evidence',
  'site_visit',
  'sheet',
  'site_entry',
  'questionnaire',
  'contradiction',
  'answer',
  'assessment',
  'scope',
  'check',
  'finding',
  'risk',
  'action',
  'decision',
  'report',
  'quick_assessment',
  'certified_report',
  'question',
  'thought',
  'proposal',
] as const;

const LAYER_BY_KIND: Record<ProjectGraphNodeKind, ProjectGraphLayer> = {
  stage: 'structure',
  department: 'structure',
  workstream: 'structure',
  engagement: 'structure',
  member: 'structure',
  milestone: 'structure',
  project: 'entity',
  asset: 'entity',
  parcel: 'entity',
  party: 'entity',
  instrument: 'entity',
  authority: 'entity',
  encumbrance: 'entity',
  approval: 'entity',
  evidence: 'evidence',
  site_visit: 'evidence',
  sheet: 'evidence',
  // An entry is an occasion of looking, like a visit: what it could not see
  // bounds what rests on it.
  site_entry: 'evidence',
  // The sheet is something received, like a document; each answer on it is a
  // claim, because it is what somebody said and may or may not be proven.
  questionnaire: 'evidence',
  contradiction: 'claim',
  answer: 'claim',
  // An assessment and a scope are containers for judgement rather than
  // judgements themselves, but they carry a status that IS a conclusion
  // ("this DD is complete"), and every traversal that walks conclusions wants
  // them in the same layer as what they hold.
  assessment: 'judgement',
  scope: 'judgement',
  check: 'judgement',
  finding: 'judgement',
  risk: 'judgement',
  action: 'judgement',
  decision: 'judgement',
  report: 'judgement',
  quick_assessment: 'judgement',
  certified_report: 'judgement',
  question: 'deliberation',
  thought: 'deliberation',
  proposal: 'deliberation',
};

export function projectLayerFor(kind: ProjectGraphNodeKind): ProjectGraphLayer {
  return LAYER_BY_KIND[kind];
}

export function isProjectNodeKind(value: unknown): value is ProjectGraphNodeKind {
  return typeof value === 'string' && (PROJECT_NODE_KINDS as readonly string[]).includes(value);
}

/* ==================================================================== */
/* Edge kinds                                                            */
/* ==================================================================== */

/**
 * Every relation the project graph may draw, and no others.
 *
 * Two collapses happened when this became a closed set, both of them removing
 * a second word for one relation:
 *
 * - `uses_evidence` and `supported_by` both meant "this rests on that paper".
 *   A check using evidence and a finding supported by it are the same edge in
 *   every traversal that walks a conclusion down to its proof, and keeping two
 *   names meant every such traversal had to remember both. `supported_by`
 *   survives.
 *
 * - `mitigates` pointed risk -> action here and action -> risk in the case
 *   graph. One of them was backwards, and the name only reads correctly in
 *   the direction this graph does not use. The project graph's convention is
 *   that support flows toward what it supports, so a risk requiring work is
 *   `requires`, the same edge a finding requiring work already drew.
 */
export type ProjectGraphEdgeKind =
  /* --- how the work is organised --------------------------------- */
  /** project -> the stage it is at now. */
  | 'at_stage'
  /** stage -> the stage after it. */
  | 'precedes'
  /** a record -> the stage the project was at when it arrived. */
  | 'in_stage'
  /** project -> a department of the menu switched on for it. */
  | 'has_department'
  /** department -> one of its functions. */
  | 'has_workstream'
  /** function -> a record it holds: a check, a document, an approval, a milestone. */
  | 'holds'
  /** quick assessment -> the function it estimates. */
  | 'assesses'
  /** certified report -> the function it is the figure of record for. */
  | 'certifies'
  /** engagement -> a function its deliverable draws on. */
  | 'draws_on'
  /** engagement -> the report it delivers. */
  | 'delivers'
  /** approval | function -> the function that may not go ahead without it. */
  | 'gates'
  /** function -> a function whose estimate it moves. */
  | 'feeds'
  /** member -> a department they run. */
  | 'leads'
  /** member -> a department they add to. */
  | 'contributes_to'
  /** member -> a department whose reports they certify. */
  | 'signs_for'
  /** member -> a department they may read. */
  | 'views'
  /** site entry -> a milestone it moved. */
  | 'advances'
  /** Two records a person said belong together. */
  | 'relates'
  /* --- the registers --------------------------------------------- */
  | 'has_asset'
  | 'contains'
  | 'assessed_by'
  /**
   * assessment | site visit -> an asset it is about.
   *
   * A visit, like an assessment, can be about particular assets: a walk of
   * Tower A looked at Tower A, and what could not be seen on it bounds what
   * is said about that tower and no other.
   */
  | 'targets'
  | 'has_scope'
  | 'has_check'
  | 'reported_in'
  | 'has_risk'
  /** The file's own record of an occasion of looking. */
  | 'has_visit'
  /** A sheet somebody has placed on the map. */
  | 'has_sheet'
  /**
   * project -> a record on its registers that nothing else places.
   *
   * Drawn only for a record no other edge joins to the project: an action
   * with no finding, risk, document or check behind it, a document nothing
   * cites and no function holds, an approval or a milestone whose function is
   * switched off, a parcel only a title chain names. Being cited in the chat
   * is not being placed, so talk about a record never takes this edge away.
   * A record placed anywhere else never gets one, so the edge also says
   * something true about the record: the project has it, and it is tied to
   * nothing yet.
   *
   * The record may be a paper the file does not hold: a missing approval, a
   * document still expected. The edge is the same and its words are not. It
   * reads "has on file" of what is in hand and "still needs" of what is not.
   */
  | 'has_record'
  /**
   * Seen on that visit.
   *
   * From a photograph or a finding to the visit it came off, which is what
   * makes the visit's limitations reachable from anything that rests on it.
   */
  | 'observed_on'
  /* --- the property itself --------------------------------------- */
  /** project | asset -> the parcel it stands on. */
  | 'sited_at'
  /** project -> a party engaged on the file (architect, lender, counsel). */
  | 'engaged_on'
  /** instrument -> the party it conveyed the parcel FROM. */
  | 'conveyed_by'
  /** instrument -> the party it conveyed the parcel TO. */
  | 'conveyed_to'
  /** instrument | approval | encumbrance -> the parcel it operates on. */
  | 'affects'
  /** instrument -> the instrument it takes title from; parcel -> parent parcel. */
  | 'derives_from'
  /** encumbrance -> the parcel it charges. */
  | 'encumbers'
  /** approval | encumbrance | instrument -> the body that issued it. */
  | 'issued_by'
  /** parcel | project -> the authority whose rules bind it. */
  | 'governed_by'
  /* --- evidence and claims --------------------------------------- */
  /** check | finding | risk | action | report -> the evidence it rests on. */
  | 'supported_by'
  /** contradiction -> each node caught in the disagreement. */
  | 'contradicts'
  /** check | finding | risk -> the parcel or asset it is about. */
  | 'about'
  | 'answers'
  /* --- judgement flow -------------------------------------------- */
  | 'produces'
  | 'found'
  | 'raises'
  | 'requires'
  | 'informs'
  /* --- deliberation ---------------------------------------------- */
  /**
   * question | thought | proposal -> the file it was raised on.
   *
   * Drawn from the deliberation node toward the project rather than the other
   * way about, which is what keeps it legal under the one-way rule below. It
   * replaces four edge kinds — `asked`, `thought`, `proposes`, `committed` —
   * that differed only in what they attached and what state it was in, both
   * of which the node itself already carries.
   */
  | 'raised_on'
  | 'cites'
  /** proposal -> the register record it was committed as. */
  | 'became';

export const PROJECT_EDGE_KINDS: readonly ProjectGraphEdgeKind[] = [
  'at_stage',
  'precedes',
  'in_stage',
  'has_department',
  'has_workstream',
  'holds',
  'assesses',
  'certifies',
  'draws_on',
  'delivers',
  'gates',
  'feeds',
  'leads',
  'contributes_to',
  'signs_for',
  'views',
  'advances',
  'relates',
  'has_asset',
  'contains',
  'assessed_by',
  'targets',
  'has_scope',
  'has_check',
  'reported_in',
  'has_risk',
  'has_visit',
  'has_sheet',
  'has_record',
  'observed_on',
  'sited_at',
  'engaged_on',
  'conveyed_by',
  'conveyed_to',
  'affects',
  'derives_from',
  'encumbers',
  'issued_by',
  'governed_by',
  'supported_by',
  'contradicts',
  'about',
  'answers',
  'produces',
  'found',
  'raises',
  'requires',
  'informs',
  'raised_on',
  'cites',
  'became',
] as const;

export function isProjectEdgeKind(value: unknown): value is ProjectGraphEdgeKind {
  return typeof value === 'string' && (PROJECT_EDGE_KINDS as readonly string[]).includes(value);
}

/**
 * Which node kinds each edge may join, in the direction it is drawn.
 *
 * `undefined` on a side means any kind, and it is used sparingly:
 * `contradicts` and `cites` genuinely may reach anything, because a
 * disagreement and a citation are about whatever they are about.
 */
export const PROJECT_EDGE_ENDPOINT_RULES: Record<
  ProjectGraphEdgeKind,
  { from?: readonly ProjectGraphNodeKind[]; to?: readonly ProjectGraphNodeKind[] }
> = {
  at_stage: { from: ['project'], to: ['stage'] },
  precedes: { from: ['stage'], to: ['stage'] },
  in_stage: {
    from: ['evidence', 'check', 'finding', 'risk', 'decision', 'report', 'site_visit', 'site_entry', 'certified_report', 'engagement', 'questionnaire'],
    to: ['stage'],
  },
  has_department: { from: ['project'], to: ['department'] },
  has_workstream: { from: ['department'], to: ['workstream'] },
  holds: { from: ['workstream'], to: ['check', 'evidence', 'approval', 'milestone', 'site_visit', 'site_entry', 'finding', 'encumbrance', 'instrument', 'questionnaire'] },
  assesses: { from: ['quick_assessment'], to: ['workstream'] },
  certifies: { from: ['certified_report'], to: ['workstream'] },
  draws_on: { from: ['engagement'], to: ['workstream'] },
  delivers: { from: ['engagement'], to: ['report'] },
  gates: { from: ['approval', 'workstream'], to: ['workstream'] },
  feeds: { from: ['workstream'], to: ['workstream'] },
  leads: { from: ['member'], to: ['department'] },
  contributes_to: { from: ['member'], to: ['department'] },
  signs_for: { from: ['member'], to: ['department'] },
  views: { from: ['member'], to: ['department'] },
  advances: { from: ['site_entry'], to: ['milestone'] },
  relates: {},
  has_asset: { from: ['project'], to: ['asset'] },
  contains: { from: ['asset'], to: ['asset'] },
  assessed_by: { from: ['project'], to: ['assessment'] },
  targets: { from: ['assessment', 'site_visit'], to: ['asset'] },
  has_scope: { from: ['assessment'], to: ['scope'] },
  has_check: { from: ['scope'], to: ['check'] },
  reported_in: { from: ['project'], to: ['report'] },
  has_risk: { from: ['project'], to: ['risk'] },
  has_visit: { from: ['project'], to: ['site_visit'] },
  has_sheet: { from: ['project'], to: ['sheet'] },
  // Every kind of record with no relation of its own from the project and no
  // parent that always carries it. An asset, a risk or a report has its own
  // word for being the project's; a check always has its scope and an answer
  // its questionnaire. These are the kinds that can be left with nothing.
  //
  // A parcel and a party are here for the title chain. When a screen has read
  // deeds on a file that declares no land of its own, the chain's parcels and
  // parties are joined to nothing the project reaches. `sited_at` would say
  // the project stands on that parcel and `engaged_on` that it engaged that
  // party, and the chain claims neither: it says the deeds name them.
  has_record: {
    from: ['project'],
    to: ['evidence', 'finding', 'action', 'decision', 'approval', 'milestone', 'site_entry', 'questionnaire', 'certified_report', 'engagement', 'member', 'contradiction', 'parcel', 'party'],
  },
  observed_on: { from: ['evidence', 'finding'], to: ['site_visit', 'site_entry'] },

  sited_at: { from: ['project', 'asset'], to: ['parcel'] },
  engaged_on: { from: ['project'], to: ['party'] },
  conveyed_by: { from: ['instrument'], to: ['party'] },
  conveyed_to: { from: ['instrument'], to: ['party'] },
  affects: { from: ['instrument', 'approval', 'encumbrance'], to: ['parcel'] },
  // Instrument-to-instrument is the chain of title; parcel-to-parcel is a
  // subdivision or amalgamation.
  derives_from: { from: ['instrument', 'parcel'], to: ['instrument', 'parcel'] },
  encumbers: { from: ['encumbrance'], to: ['parcel'] },
  issued_by: { from: ['approval', 'encumbrance', 'instrument'], to: ['authority'] },
  governed_by: { from: ['parcel', 'project'], to: ['authority'] },

  supported_by: { from: ['check', 'finding', 'risk', 'action', 'report', 'assessment', 'quick_assessment', 'certified_report', 'approval', 'answer'], to: ['evidence'] },
  contradicts: { from: ['contradiction'] },
  about: { from: ['check', 'finding', 'risk', 'action'], to: ['parcel', 'asset'] },
  answers: { from: ['answer'], to: ['questionnaire'] },

  produces: { from: ['check'], to: ['finding'] },
  found: { from: ['assessment'], to: ['finding'] },
  raises: { from: ['finding'], to: ['risk'] },
  requires: { from: ['finding', 'check', 'risk'], to: ['action'] },
  informs: { from: ['finding', 'risk'], to: ['decision'] },

  raised_on: { from: ['question', 'thought', 'proposal'], to: ['project'] },
  cites: { from: ['question', 'thought', 'proposal'] },
  became: { from: ['proposal'] },
};

export function projectEdgeEndpointsValid(
  kind: ProjectGraphEdgeKind,
  fromKind: ProjectGraphNodeKind,
  toKind: ProjectGraphNodeKind,
): boolean {
  const rule = PROJECT_EDGE_ENDPOINT_RULES[kind];
  if (rule.from && !rule.from.includes(fromKind)) return false;
  if (rule.to && !rule.to.includes(toKind)) return false;
  return true;
}

/* ==================================================================== */
/* Relations in plain words                                              */
/* ==================================================================== */

/**
 * How each relation reads to a person, from either end.
 *
 * A relation's key is written for Cypher: `supported_by`, `has_workstream`.
 * Shown as it stands it asks the reader to translate, and the reader of a
 * diligence file is a lawyer or an engineer, not whoever wrote the query. So
 * every kind carries two short phrases. Whichever node is being read is the
 * subject: `forward` is said of the node the edge leaves ("this check rests
 * on that deed") and `backward` of the node it reaches ("this deed supports
 * that check").
 *
 * A phrase has to stay true whatever state the thing at either end is in,
 * because the edge is drawn in every state. An approval that is missing is
 * still joined to the work it gates, so `gates` reads "is needed before" and
 * not "allows". A superseded report is still joined to its function, a
 * suggested answer to its sheet, an abandoned visit to the tower it was for,
 * a lapsed registration to its parcel, a released charge to the land it was
 * on: each of those is said in words that claim no more than the edge does.
 *
 * A `Record` over the kind, so a relation cannot be added without its words.
 */
export const PROJECT_EDGE_LABEL: Record<ProjectGraphEdgeKind, { forward: string; backward: string }> = {
  at_stage: { forward: 'is at', backward: 'is the current stage of' },
  precedes: { forward: 'comes before', backward: 'comes after' },
  in_stage: { forward: 'arrived in', backward: 'took in' },
  has_department: { forward: 'has the department', backward: 'is a department of' },
  has_workstream: { forward: 'has the function', backward: 'is a function of' },
  holds: { forward: 'holds', backward: 'is held by' },
  assesses: { forward: 'is the estimate for', backward: 'has the estimate' },
  certifies: { forward: 'is a certified report on', backward: 'has the certified report' },
  draws_on: { forward: 'draws on', backward: 'is drawn on by' },
  delivers: { forward: 'delivers', backward: 'is delivered by' },
  gates: { forward: 'is needed before', backward: 'cannot go ahead without' },
  feeds: { forward: 'feeds', backward: 'is fed by' },
  leads: { forward: 'leads', backward: 'is led by' },
  contributes_to: { forward: 'contributes to', backward: 'has the contributor' },
  signs_for: { forward: 'signs for', backward: 'has the signer' },
  views: { forward: 'may read', backward: 'may be read by' },
  advances: { forward: 'updated', backward: 'was updated by' },
  relates: { forward: 'belongs with', backward: 'belongs with' },
  has_asset: { forward: 'has the asset', backward: 'is an asset of' },
  contains: { forward: 'contains', backward: 'is part of' },
  assessed_by: { forward: 'has the assessment', backward: 'is an assessment of' },
  targets: { forward: 'is about', backward: 'is the subject of' },
  has_scope: { forward: 'has the scope', backward: 'is a scope of' },
  has_check: { forward: 'has the check', backward: 'is a check of' },
  reported_in: { forward: 'is reported in', backward: 'reports on' },
  has_risk: { forward: 'has the risk', backward: 'is a risk to' },
  has_visit: { forward: 'has the site visit', backward: 'is a site visit to' },
  has_sheet: { forward: 'has the sheet', backward: 'is a sheet of' },
  has_record: { forward: 'has on file', backward: 'is on file with' },
  observed_on: { forward: 'was seen on', backward: 'saw' },
  sited_at: { forward: 'stands on', backward: 'is the land under' },
  engaged_on: { forward: 'has engaged', backward: 'is engaged on' },
  conveyed_by: { forward: 'passed the land from', backward: 'gave up the land by' },
  conveyed_to: { forward: 'passed the land to', backward: 'received the land by' },
  affects: { forward: 'deals with', backward: 'is dealt with by' },
  derives_from: { forward: 'comes from', backward: 'leads to' },
  encumbers: { forward: 'is recorded against', backward: 'has recorded against it' },
  issued_by: { forward: 'was issued by', backward: 'issued' },
  governed_by: { forward: 'is governed by', backward: 'governs' },
  supported_by: { forward: 'rests on', backward: 'supports' },
  contradicts: { forward: 'puts in doubt', backward: 'is put in doubt by' },
  about: { forward: 'is about', backward: 'is the subject of' },
  answers: { forward: 'is asked on', backward: 'asks' },
  produces: { forward: 'led to', backward: 'came out of' },
  found: { forward: 'found', backward: 'was found by' },
  raises: { forward: 'raises', backward: 'is raised by' },
  requires: { forward: 'calls for', backward: 'is called for by' },
  informs: { forward: 'informs', backward: 'is informed by' },
  raised_on: { forward: 'was raised on', backward: 'was discussed in' },
  cites: { forward: 'refers to', backward: 'is referred to by' },
  became: { forward: 'became', backward: 'began as' },
};

/**
 * What a relation reads as while the record it reaches is not in hand.
 *
 * Three relations are drawn to a paper whether or not it has arrived. A check
 * is joined to every document it expects, a function to every approval the
 * project needs, the project to a record nothing else places. No one phrase
 * is true of both states: "rests on" is the point when the deed is on file
 * and false when it is only expected, and on a new file most papers are only
 * expected. So these three have a second pair of words, for the edge whose
 * far end is still awaited. They are the approvals register's own: what the
 * project holds, and what it still needs.
 */
export const PROJECT_EDGE_LABEL_AWAITED: Partial<Record<ProjectGraphEdgeKind, { forward: string; backward: string }>> = {
  holds: { forward: 'still needs', backward: 'is still needed by' },
  has_record: { forward: 'still needs', backward: 'is still needed by' },
  supported_by: { forward: 'still needs', backward: 'is still needed by' },
};

/**
 * Whether a node stands for something the file does not have in hand: a
 * document expected, asked for, missing or refused, or an approval with
 * nothing on file for it.
 */
export function projectNodeAwaited(node: { kind: ProjectGraphNodeKind; status?: string }): boolean {
  if (node.kind === 'evidence') return node.status === 'expected' || node.status === 'requested' || node.status === 'missing' || node.status === 'rejected';
  if (node.kind === 'approval') return node.status === 'missing';
  return false;
}

/**
 * A relation in plain words, said of one end of one edge.
 *
 * `forward` is said of the node the edge leaves and `backward` of the node it
 * reaches. `to` is the node it reaches, whichever end is being read: when
 * that is still awaited, the words for an awaited record are the ones used.
 */
export function projectEdgePhrase(
  kind: ProjectGraphEdgeKind,
  direction: 'forward' | 'backward',
  to: { kind: ProjectGraphNodeKind; status?: string },
): string {
  const words = (projectNodeAwaited(to) ? PROJECT_EDGE_LABEL_AWAITED[kind] : undefined) ?? PROJECT_EDGE_LABEL[kind];
  return words[direction];
}

/**
 * The one-way rule, carried over from the case graph.
 *
 * A deliberation node may cite a claim. No claim, judgement or entity may
 * ever rest on one — a chat thought is a record of our own process, not
 * evidence, and an edge that let a finding lean on one would launder a
 * model's musing into case truth. Enforced rather than documented.
 */
export function projectEdgeDirectionValid(fromLayer: ProjectGraphLayer, toLayer: ProjectGraphLayer): boolean {
  return !(toLayer === 'deliberation' && fromLayer !== 'deliberation');
}
