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
 * The same five layers as the case graph, and deliberately not a sixth.
 *
 * `report` sits in `judgement` rather than getting a `deliverable` layer of
 * its own: a report is the assembled conclusion, and everything the layer is
 * used for — ordering, colour, the one-way deliberation rule — treats it
 * exactly as it treats a finding.
 */
export type ProjectGraphLayer = 'entity' | 'evidence' | 'claim' | 'judgement' | 'deliberation';

export type ProjectGraphNodeKind =
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
  /* --- claims: what the evidence says ---------------------------- */
  /** Two sources disagreeing about the same subject, kept as its own node. */
  | 'contradiction'
  /* --- judgements: what we concluded ----------------------------- */
  | 'assessment'
  | 'scope'
  | 'check'
  | 'finding'
  | 'risk'
  | 'action'
  | 'decision'
  | 'report'
  /* --- deliberation: how we got there ---------------------------- */
  | 'question'
  | 'thought'
  | 'proposal';

export const PROJECT_NODE_KINDS: readonly ProjectGraphNodeKind[] = [
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
  'contradiction',
  'assessment',
  'scope',
  'check',
  'finding',
  'risk',
  'action',
  'decision',
  'report',
  'question',
  'thought',
  'proposal',
] as const;

const LAYER_BY_KIND: Record<ProjectGraphNodeKind, ProjectGraphLayer> = {
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
  contradiction: 'claim',
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
  /* --- structure ------------------------------------------------- */
  | 'has_asset'
  | 'contains'
  | 'assessed_by'
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
  has_asset: { from: ['project'], to: ['asset'] },
  contains: { from: ['asset'], to: ['asset'] },
  assessed_by: { from: ['project'], to: ['assessment'] },
  targets: { from: ['assessment'], to: ['asset'] },
  has_scope: { from: ['assessment'], to: ['scope'] },
  has_check: { from: ['scope'], to: ['check'] },
  reported_in: { from: ['project'], to: ['report'] },
  has_risk: { from: ['project'], to: ['risk'] },
  has_visit: { from: ['project'], to: ['site_visit'] },
  has_sheet: { from: ['project'], to: ['sheet'] },
  observed_on: { from: ['evidence', 'finding'], to: ['site_visit'] },

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

  supported_by: { from: ['check', 'finding', 'risk', 'action', 'report', 'assessment'], to: ['evidence'] },
  contradicts: { from: ['contradiction'] },
  about: { from: ['check', 'finding', 'risk', 'action'], to: ['parcel', 'asset'] },

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
