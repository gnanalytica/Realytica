/**
 * Deterministic construction of a property's title graph from the documents
 * on file and the case record.
 *
 * The builder is the only thing allowed to put an edge in the graph. A model
 * may propose one (`applyEdgeProposals`), but it enters through the same
 * validation as everything here, because a wrong edge in a chain of title is
 * a liability rather than a bad guess.
 *
 * Three rules shape every decision below.
 *
 * **Nothing is invented.** Every node and every edge carries at least one
 * `TitleAssertion` naming the document, dataset or case field it came from.
 * Where the builder infers a relationship from a document's *kind* rather
 * than from its text — a mother deed being, by definition, the antecedent of
 * the deed it links to — the assertion says `model_inference` and carries a
 * lower confidence, so the inference is visible rather than laundered into a
 * fact.
 *
 * **Bi-temporal throughout.** `validFrom`/`validTo` on an edge is world time,
 * taken from the instrument itself; `assertedAt` on an assertion is knowledge
 * time, taken from the document's `uploadedAt`. They are never mixed. A deed
 * executed in 2004 and uploaded in 2026 is one fact with two dates, and only
 * keeping both lets the product say which of two disagreeing documents is the
 * later *knowledge* even when it describes the earlier *world*.
 *
 * **Byte-identical output.** No clock, no PRNG, no dependence on the order
 * documents happen to arrive in: documents are sorted before processing, ids
 * derive from merge keys rather than from position, and the finished arrays
 * are put in a total order. `now` is a parameter for the same reason it is in
 * `runScreen` — the caller owns the clock.
 */

import type {
  CaseDocument,
  ExtractedField,
  PropertyCase,
  PropertyIdentity,
  TitleAssertion,
  TitleEdge,
  TitleEdgeKind,
  TitleGraph,
  TitleNode,
  TitleNodeKind,
} from '../types';
import { extractFields } from '../engine';
import { JURISDICTION_LABEL } from '../packs/karnataka';
import {
  AREA_CLAIM_FIELDS,
  DOCUMENT_GRAPH_ROLE,
  PARTY_NAME_FIELDS,
  areaToSqm,
  builtUnitMergeKey,
  compareEdges,
  compareNodes,
  mergeKeyFor,
  slugify,
  titleEdgeId,
  titleNodeId,
} from './ontology';

/* ==================================================================== */
/* Jurisdictional constants                                              */
/* ==================================================================== */

/**
 * Karnataka conveyancing practice examines a 30-year chain of title, which is
 * also the period a Form 15/16 encumbrance certificate is ordinarily taken
 * for. It is a practice standard rather than a statutory one, which is
 * exactly why it is named here with its reasoning instead of appearing as a
 * bare `30` in a scoring expression.
 *
 * No equivalent is asserted for the Netherlands: the Kadaster is a positive
 * register of ownership, so a Dutch title is proved by the register extract
 * rather than by reconstructing three decades of deeds, and inventing a
 * "expected years" figure there would manufacture a finding out of a
 * difference in legal system.
 */
const KARNATAKA_CHAIN_YEARS_EXPECTED = 30;

/**
 * Confidence attached to a relationship the builder derives from a document's
 * classification rather than from anything written in the document — the
 * mother-deed-to-title-deed derivation being the main one. Well below a
 * parsed field, well above nothing, and visible in the graph so a reviewer
 * can tell the difference.
 */
const KIND_INFERENCE_CONFIDENCE = 0.7;

/** Extraction keys that date an instrument, in the order they are trusted. */
const INSTRUMENT_DATE_FIELD_KEYS = ['deedDate', 'executionDate', 'registrationDate', 'agreementDate', 'instrumentDate'];

/** Extraction keys that date an approval, in the order they are trusted. */
const APPROVAL_DATE_FIELD_KEYS = ['ocIssueDate', 'conversionOrderDate', 'possessionDate', 'approvalDate', 'sanctionDate', 'issueDate'];

/** Extraction keys that carry an instrument's or approval's own reference number. */
const REFERENCE_FIELD_KEYS = [
  'registrationNumber',
  'ocNumber',
  'ccNumber',
  'conversionOrderNumber',
  'sanctionNumber',
  'reraNumber',
  'formReference',
  'khataNumber',
  'sasApplicationNumber',
];

/* ==================================================================== */
/* The accumulator                                                       */
/* ==================================================================== */

/**
 * Collects nodes and edges while the builder walks the case, merging by key
 * as it goes.
 *
 * Kept as a class for the same reason `EvidenceBuilder` is one in the engine:
 * ids are assigned in exactly one place, so nothing downstream can mint an id
 * the graph does not recognise.
 */
class TitleGraphAccumulator {
  private readonly nodes = new Map<string, TitleNode>();
  private readonly edges = new Map<string, TitleEdge>();

  /**
   * Creates the node for (kind, merge key) or merges into the existing one.
   *
   * Attributes are first-writer-wins rather than last: the first document to
   * describe a thing is processed in a deterministic order, and letting a
   * later, vaguer document overwrite a precise earlier value would make the
   * graph depend on upload order in exactly the way it must not.
   */
  upsertNode(input: {
    kind: TitleNodeKind;
    /** Raw, human-readable identifier — normalised into the merge key here. */
    identifier: string;
    label: string;
    attributes?: Record<string, string | number | boolean>;
    assertion: TitleAssertion;
  }): TitleNode {
    const mergeKey = mergeKeyFor(input.kind, input.identifier) || slugify(input.identifier) || 'unnamed';
    const id = titleNodeId(input.kind, mergeKey);
    const existing = this.nodes.get(id);
    if (existing) {
      for (const [key, value] of Object.entries(input.attributes ?? {})) {
        if (existing.attributes[key] === undefined) existing.attributes[key] = value;
      }
      existing.assertedBy.push(input.assertion);
      return existing;
    }
    const node: TitleNode = {
      id,
      kind: input.kind,
      label: input.label,
      mergeKey,
      attributes: { ...(input.attributes ?? {}) },
      assertedBy: [input.assertion],
    };
    this.nodes.set(id, node);
    return node;
  }

  /** Sets a boolean attribute to true without ever unsetting it — used for role flags that accumulate across documents. */
  flagNode(nodeId: string, key: string): void {
    const node = this.nodes.get(nodeId);
    if (node) node.attributes[key] = true;
  }

  /**
   * Adds an edge, or folds another assertion into the identical edge.
   *
   * `discriminator` exists because several distinct claims legitimately share
   * a kind and a pair of endpoints — two documents each asserting an extent
   * for one parcel is the case the whole area-conflict check depends on, and
   * collapsing them would delete the disagreement.
   */
  addEdge(input: {
    kind: TitleEdgeKind;
    from: string;
    to: string;
    label: string;
    validFrom?: string;
    validTo?: string;
    discriminator?: string;
    attributes?: Record<string, string | number | boolean>;
    assertion: TitleAssertion;
  }): TitleEdge {
    const id = titleEdgeId(input.kind, input.from, input.to, input.discriminator);
    const existing = this.edges.get(id);
    if (existing) {
      existing.assertedBy.push(input.assertion);
      existing.confidence = Math.max(existing.confidence, input.assertion.confidence);
      return existing;
    }
    const edge: TitleEdge = {
      id,
      kind: input.kind,
      fromNodeId: input.from,
      toNodeId: input.to,
      label: input.label,
      validFrom: input.validFrom,
      validTo: input.validTo,
      assertedBy: [input.assertion],
      confidence: input.assertion.confidence,
      attributes: input.attributes,
    };
    this.edges.set(id, edge);
    return edge;
  }

  /**
   * Freezes the accumulator into the contract shape: assertions deduplicated
   * and ordered, then nodes and edges put in a total order that does not
   * depend on how they were discovered.
   */
  finish(caseId: string, builtAt: string): TitleGraph {
    const nodes = [...this.nodes.values()].map(node => ({ ...node, assertedBy: tidyAssertions(node.assertedBy) }));
    const edges = [...this.edges.values()].map(edge => ({ ...edge, assertedBy: tidyAssertions(edge.assertedBy) }));
    nodes.sort(compareNodes);
    edges.sort(compareEdges);
    return { caseId, builtAt, nodes, edges };
  }
}

/**
 * One source may only say a thing once. Where the same (source, field) pair
 * appears twice — the same document read for two purposes — the higher
 * confidence survives, because the duplicate is the same claim, not
 * corroboration, and counting it twice would make a single document look like
 * two agreeing sources.
 */
function tidyAssertions(assertions: TitleAssertion[]): TitleAssertion[] {
  const best = new Map<string, TitleAssertion>();
  for (const assertion of assertions) {
    const key = `${assertion.sourceRef}|${assertion.fieldKey ?? ''}`;
    const existing = best.get(key);
    if (!existing || assertion.confidence > existing.confidence) best.set(key, assertion);
  }
  return [...best.values()].sort((a, b) => {
    if (a.assertedAt !== b.assertedAt) return a.assertedAt < b.assertedAt ? -1 : 1;
    if (a.sourceRef !== b.sourceRef) return a.sourceRef < b.sourceRef ? -1 : 1;
    const aKey = a.fieldKey ?? '';
    const bKey = b.fieldKey ?? '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

/* ==================================================================== */
/* Small readers over extracted fields                                   */
/* ==================================================================== */

function field(doc: CaseDocument, key: string): ExtractedField | undefined {
  return doc.extracted.find(f => f.key === key);
}

function firstField(doc: CaseDocument, keys: string[]): ExtractedField | undefined {
  for (const key of keys) {
    const found = field(doc, key);
    if (found) return found;
  }
  return undefined;
}

/** ISO date (YYYY-MM-DD) if the value looks like one, else undefined — a half-parsed date is worse than none. */
function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? match[0] : undefined;
}

/* ==================================================================== */
/* Authorities                                                           */
/* ==================================================================== */

/**
 * Which body a document comes from.
 *
 * Register records (khata, tax, kadaster, WOZ, EC) have no node kind of their
 * own in the closed ontology, so they enter the graph as the authority that
 * issued them, with the document itself carried on the assertion. That keeps
 * "BBMP says the assessed area is 145 sqm" representable without inventing a
 * `record` kind the contract does not have.
 *
 * Where the case records a Karnataka jurisdiction, that label is preferred
 * over the extracted `approvalAuthority` string: the document says "Municipal
 * planning authority", the case says the property is in BBMP, and BBMP *is*
 * the municipal planning authority here — using the specific name merges the
 * plan, the khata and the tax record onto one authority instead of three.
 */
function authorityFor(doc: CaseDocument, identity: PropertyIdentity): { identifier: string; label: string } | undefined {
  const jurisdiction = identity.karnataka?.jurisdiction;
  const municipal =
    jurisdiction && jurisdiction !== 'unknown'
      ? { identifier: jurisdiction, label: JURISDICTION_LABEL[jurisdiction] }
      : identity.country === 'IN'
        ? { identifier: `municipal ${identity.city}`, label: `Municipal authority, ${identity.city}` }
        : { identifier: `gemeente ${identity.city}`, label: `Gemeente ${identity.city}` };

  switch (doc.kind) {
    case 'khata_extract':
    case 'property_tax_receipt':
    case 'betterment_charges_receipt':
    case 'approved_building_plan':
    case 'sanctioned_plan_bbmp':
    case 'occupancy_certificate':
    case 'commencement_certificate':
    case 'floor_plan':
      return municipal;
    case 'possession_certificate':
      return municipal;
    case 'form_9_11':
      return { identifier: 'gram_panchayat', label: JURISDICTION_LABEL.gram_panchayat };
    case 'conversion_certificate':
      return { identifier: `dc revenue ${identity.city}`, label: `Deputy Commissioner (revenue), ${identity.city}` };
    case 'rera_registration':
      return identity.state.toLowerCase() === 'karnataka'
        ? { identifier: 'k-rera', label: 'K-RERA — Karnataka Real Estate Regulatory Authority' }
        : { identifier: 'rera', label: 'Real Estate Regulatory Authority' };
    case 'kadaster_extract':
      return { identifier: 'kadaster', label: 'Kadaster — Netherlands land registry' };
    case 'woz_assessment':
      return { identifier: `gemeente ${identity.city}`, label: `Gemeente ${identity.city}` };
    case 'encumbrance_certificate':
    case 'title_deed':
    case 'mother_deed':
      return { identifier: `sub-registrar ${identity.city}`, label: `Sub-Registrar, ${identity.city}` };
    default:
      return undefined;
  }
}

/* ==================================================================== */
/* Document preparation                                                  */
/* ==================================================================== */

/**
 * The document set every part of the title graph reads from.
 *
 * Extraction is backfilled exactly as `runScreen` does it, so a case whose
 * documents were uploaded but never extracted still produces the same graph
 * as one where extraction ran first. The sort then removes the last
 * dependence on the order the caller happened to store documents in — upload
 * order is an accident of the user's afternoon, not a property of the title.
 *
 * Exported because `detectContradictions` has to read the same extracted
 * values the builder read; two independent backfills could disagree, and a
 * contradiction detector disagreeing with the graph it is checking would be
 * the worst possible bug in this module.
 */
export function caseDocumentsForGraph(propertyCase: PropertyCase): CaseDocument[] {
  return propertyCase.documents
    .map(doc =>
      doc.extracted.length === 0 && doc.ocrStatus === 'complete' && doc.kind !== 'unclassified' && doc.kind !== 'photograph'
        ? { ...doc, extracted: extractFields(doc, propertyCase.identity, propertyCase.id) }
        : doc,
    )
    .sort((a, b) => {
      if (a.uploadedAt !== b.uploadedAt) return a.uploadedAt < b.uploadedAt ? -1 : 1;
      if (a.fileName !== b.fileName) return a.fileName < b.fileName ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/* ==================================================================== */
/* buildTitleGraph                                                       */
/* ==================================================================== */

/**
 * Builds the title graph for one case.
 *
 * `now` is the knowledge-time stamp for the build itself (`graph.builtAt`) and
 * nothing else — no fact's world time is ever taken from it. Passing it in
 * rather than reading a clock is what makes the graph reproducible, and
 * `detectContradictions` uses it as the boundary past which a document date
 * is impossible rather than merely surprising.
 */
export function buildTitleGraph(propertyCase: PropertyCase, now: string): TitleGraph {
  const { identity } = propertyCase;
  const graph = new TitleGraphAccumulator();

  /* --- Documents, in a fixed order ---------------------------------- */

  const documents = caseDocumentsForGraph(propertyCase);

  /* --- Assertion helpers -------------------------------------------- */

  /**
   * The case record asserting something about itself. `assertedAt` is the
   * case's creation time — when the user told us — not the build time, so
   * re-running the build never changes when a fact became known.
   */
  const fromIdentity = (fieldKey: string, confidence: number): TitleAssertion => ({
    sourceRef: 'identity',
    sourceLabel: 'Case record (user-supplied identity)',
    sourceType: 'user_input',
    assertedAt: propertyCase.createdAt,
    confidence,
    fieldKey,
  });

  /** A document asserting something. Knowledge time is the upload, never the build. */
  const fromDocument = (doc: CaseDocument, extracted?: ExtractedField): TitleAssertion => ({
    sourceRef: doc.id,
    sourceLabel: doc.fileName,
    sourceType: 'document',
    assertedAt: doc.uploadedAt,
    confidence: extracted?.confidence ?? doc.classificationConfidence,
    fieldKey: extracted?.key,
  });

  /** The builder drawing a conclusion from what a document *is* rather than from what it says. */
  const fromInference = (doc: CaseDocument, fieldKey: string): TitleAssertion => ({
    sourceRef: doc.id,
    sourceLabel: doc.fileName,
    sourceType: 'model_inference',
    assertedAt: doc.uploadedAt,
    confidence: KIND_INFERENCE_CONFIDENCE,
    fieldKey,
  });

  /* --- The land parcel ---------------------------------------------- */

  const isKarnataka = identity.country === 'IN' && identity.state.toLowerCase() === 'karnataka';
  const parcelIdentifier = identity.parcelId.trim() || identity.addressLine.trim() || identity.label;

  const landParcel = graph.upsertNode({
    kind: 'parcel',
    identifier: parcelIdentifier,
    label: identity.parcelId.trim() || identity.addressLine.trim() || identity.label,
    attributes: {
      subject: 'land',
      country: identity.country,
      state: identity.state,
      city: identity.city,
      locality: identity.locality,
      propertyType: identity.propertyType,
      tenure: identity.tenure,
      // Read by `reconstructChains` — the graph has to carry the jurisdiction's
      // expectation, because a chain is only "too short" relative to one.
      ...(isKarnataka ? { chainYearsExpected: KARNATAKA_CHAIN_YEARS_EXPECTED } : {}),
      ...(identity.plotAreaSqm > 0 ? { statedAreaSqm: identity.plotAreaSqm } : {}),
    },
    assertion: fromIdentity('identity.parcelId', 0.95),
  });
  if (identity.plotAreaSqm > 0) {
    // A second assertion on the same node: the case record states an extent as
    // well as an identifier, and the extent is one of the competing area
    // claims `detectContradictions` weighs.
    graph.upsertNode({
      kind: 'parcel',
      identifier: parcelIdentifier,
      label: landParcel.label,
      assertion: fromIdentity('identity.plotAreaSqm', 0.9),
    });
  }

  /**
   * A flat, an office floor or a house is not the land it stands on, and its
   * area is not comparable with the land's. Modelled as a parcel carved out of
   * the land parcel (`derives_from` is the contract's subdivision edge) so
   * that area claims about the building and area claims about the land can
   * never be compared with each other by accident.
   */
  const builtUnit: TitleNode | undefined =
    identity.builtUpAreaSqm > 0
      ? graph.upsertNode({
          kind: 'parcel',
          identifier: builtUnitMergeKey(landParcel.mergeKey),
          label: `Built unit at ${landParcel.label}`,
          attributes: {
            subject: 'built',
            country: identity.country,
            propertyType: identity.propertyType,
            statedAreaSqm: identity.builtUpAreaSqm,
            ...(identity.karnataka?.areaBasis ? { areaBasis: identity.karnataka.areaBasis } : {}),
          },
          assertion: fromIdentity('identity.builtUpAreaSqm', 0.9),
        })
      : undefined;

  if (builtUnit) {
    graph.addEdge({
      kind: 'derives_from',
      from: builtUnit.id,
      to: landParcel.id,
      label: `Built unit carved out of ${landParcel.label}`,
      assertion: fromIdentity('identity.builtUpAreaSqm', 0.85),
    });
  }

  /** Where an area claim about `subject` should be attached. */
  const parcelForSubject = (subject: 'land' | 'built'): TitleNode => (subject === 'built' && builtUnit ? builtUnit : landParcel);

  /**
   * The node each document speaks through, kept so the derivation pass below
   * can join two instruments without re-deriving their ids from their merge
   * keys — one place that mints ids, as everywhere else in the builder.
   */
  const speakerByDocumentId = new Map<string, TitleNode>();

  /* --- One pass per document ---------------------------------------- */

  for (const doc of documents) {
    const spec = DOCUMENT_GRAPH_ROLE[doc.kind];
    const reference = firstField(doc, REFERENCE_FIELD_KEYS);
    const authority = authorityFor(doc, identity);

    // The authority node, where the document has an issuer. Created before the
    // document's own node so `issued_by` always has a target.
    const authorityNode = authority
      ? graph.upsertNode({
          kind: 'authority',
          identifier: authority.identifier,
          label: authority.label,
          attributes: { country: identity.country },
          assertion: fromDocument(doc),
        })
      : undefined;

    /* -- The node that speaks for this document --------------------- */

    let speaker: TitleNode | undefined;

    if (spec.role === 'instrument') {
      const dateField = firstField(doc, INSTRUMENT_DATE_FIELD_KEYS);
      const at = isoDate(dateField?.value);
      const identifierSource = reference ? `${doc.kind} ${reference.value}` : `${doc.kind} doc ${doc.id}`;
      const label = [spec.label, reference?.value, at ? `(${at.slice(0, 4)})` : undefined].filter(Boolean).join(' ');
      speaker = graph.upsertNode({
        kind: 'instrument',
        identifier: identifierSource,
        label,
        attributes: {
          documentId: doc.id,
          documentKind: doc.kind,
          fileName: doc.fileName,
          // Read by `reconstructChains`: an agreement to sell and a lease are
          // instruments, but neither conveys title, so neither may sit in the
          // chain as if it did.
          conveysOwnership: spec.conveysOwnership,
          ...(at ? { instrumentDate: at } : {}),
          ...(reference ? { reference: reference.value } : {}),
        },
        assertion: fromDocument(doc, dateField ?? reference),
      });

      graph.addEdge({
        kind: 'affects',
        from: speaker.id,
        to: landParcel.id,
        label: `${spec.label} affects ${landParcel.label}`,
        validFrom: at,
        assertion: fromDocument(doc, dateField),
      });

      // Registration is what makes an instrument enforceable against third
      // parties in India, so a registration number is recorded as the
      // Sub-Registrar having issued it rather than left as a bare string.
      if (authorityNode && reference?.key === 'registrationNumber') {
        graph.addEdge({
          kind: 'issued_by',
          from: speaker.id,
          to: authorityNode.id,
          label: `Registered with ${authorityNode.label} as ${reference.value}`,
          validFrom: at,
          assertion: fromDocument(doc, reference),
        });
      }
    } else if (spec.role === 'approval') {
      const dateField = firstField(doc, APPROVAL_DATE_FIELD_KEYS);
      const at = isoDate(dateField?.value);
      const identifierSource = reference ? `${doc.kind} ${reference.value}` : `${doc.kind} doc ${doc.id}`;
      speaker = graph.upsertNode({
        kind: 'approval',
        identifier: identifierSource,
        label: [spec.label, reference?.value].filter(Boolean).join(' '),
        attributes: {
          documentId: doc.id,
          documentKind: doc.kind,
          fileName: doc.fileName,
          // A floor plan grants nothing. It enters as an `approval` because the
          // closed ontology has no kind for a drawing and the plan family is
          // where it belongs, but the distinction is recorded rather than lost.
          grantsPermission: doc.kind !== 'floor_plan',
          ...(at ? { approvalDate: at } : {}),
          ...(reference ? { reference: reference.value } : {}),
        },
        assertion: fromDocument(doc, dateField ?? reference),
      });

      graph.addEdge({
        kind: 'affects',
        from: speaker.id,
        to: landParcel.id,
        label: `${spec.label} affects ${landParcel.label}`,
        validFrom: at,
        assertion: fromDocument(doc, dateField),
      });

      if (authorityNode) {
        graph.addEdge({
          kind: 'issued_by',
          from: speaker.id,
          to: authorityNode.id,
          label: `Issued by ${authorityNode.label}`,
          validFrom: at,
          assertion: fromDocument(doc, reference),
        });
      }
    } else if (spec.role === 'register') {
      // The authority is the speaker: the register record has no node of its
      // own, so everything it claims is asserted by the body that keeps it.
      speaker = authorityNode;
    }

    /* -- Parcels the document names --------------------------------- */

    const parcelField = firstField(doc, ['surveyNumber', 'kadastraalAanduiding', 'parcelId']);
    if (parcelField && parcelField.value.trim() !== '') {
      const named = graph.upsertNode({
        kind: 'parcel',
        identifier: parcelField.value,
        label: parcelField.value,
        attributes: { subject: 'land', namedByDocument: true },
        assertion: fromDocument(doc, parcelField),
      });
      // When the merge key differs, the two references did not resolve to one
      // parcel. The builder still judges them the same thing — it is the only
      // parcel this case is about — but records that judgement as an explicit,
      // lower-confidence `identifies` edge rather than silently merging two
      // different survey numbers. `detectContradictions` raises the mismatch.
      if (named.id !== landParcel.id) {
        graph.addEdge({
          kind: 'identifies',
          from: named.id,
          to: landParcel.id,
          label: `${parcelField.value} taken to be the same parcel as ${landParcel.label}`,
          discriminator: doc.id,
          assertion: fromInference(doc, parcelField.key),
        });
      }
    }

    /* -- Parties the document names --------------------------------- */

    for (const extracted of doc.extracted) {
      const partySpec = PARTY_NAME_FIELDS[extracted.key];
      if (!partySpec || extracted.value.trim() === '') continue;

      const party = graph.upsertNode({
        kind: 'party',
        identifier: extracted.value,
        label: extracted.value.trim(),
        attributes: { role: partySpec.role },
        assertion: fromDocument(doc, extracted),
      });

      // Role flags accumulate rather than overwrite: the same person can be
      // named as grantee by a deed and as holder by the khata, and
      // `party_mismatch` turns entirely on whether a register-named holder is
      // ever named by a deed.
      if (spec.conveysOwnership) graph.flagNode(party.id, 'namedByConveyance');
      if (spec.role === 'register') graph.flagNode(party.id, 'namedByRegister');
      if (partySpec.role === 'tenant') graph.flagNode(party.id, 'tenant');

      if (speaker && speaker.kind === 'instrument' && (partySpec.role === 'grantee' || partySpec.role === 'grantor' || partySpec.role === 'tenant')) {
        const instrumentDate = typeof speaker.attributes.instrumentDate === 'string' ? speaker.attributes.instrumentDate : undefined;
        graph.addEdge({
          kind: partySpec.role === 'grantor' ? 'conveyed_by' : 'conveyed_to',
          from: speaker.id,
          to: party.id,
          label:
            partySpec.role === 'grantor'
              ? `${speaker.label} conveyed by ${party.label}`
              : partySpec.role === 'tenant'
                ? `${speaker.label} demised to ${party.label}`
                : `${speaker.label} conveyed to ${party.label}`,
          // World time: the interest vests when the instrument was executed,
          // not when we read it.
          validFrom: instrumentDate,
          assertion: fromDocument(doc, extracted),
        });
      }
    }

    /* -- Area claims ------------------------------------------------- */

    for (const extracted of doc.extracted) {
      const areaSpec = AREA_CLAIM_FIELDS[extracted.key];
      if (!areaSpec) continue;
      const sqm = areaToSqm(extracted.value, extracted.unit);
      // A zero or unparseable extent is an absence, not a claim. The khata
      // extract for a vacant site reports a built-up area of zero, and reading
      // that as "the khata says nought square metres" would manufacture a
      // contradiction out of a blank field.
      if (sqm === undefined) continue;

      // A khata assesses the site itself where nothing is built on it, and the
      // building where something is. Getting this wrong either invents an
      // extent conflict or hides one.
      const treatAsLand = areaSpec.landWhenSiteOnly === true && identity.builtUpAreaSqm <= 0;
      const subject: 'land' | 'built' = treatAsLand ? 'land' : areaSpec.subject;
      const target = parcelForSubject(subject);
      const source = speaker ?? authorityNode;
      if (!source) continue;

      graph.addEdge({
        kind: 'asserts_area',
        from: source.id,
        to: target.id,
        label: `${source.label} states the ${areaSpec.what} as ${extracted.value}${extracted.unit ? ` ${extracted.unit}` : ''}`,
        discriminator: `${doc.id}:${extracted.key}`,
        attributes: {
          areaSqm: Math.round(sqm * 100) / 100,
          statedValue: extracted.value,
          statedUnit: extracted.unit ?? 'sqm',
          fieldKey: extracted.key,
          fieldLabel: extracted.label,
          subject,
          documentId: doc.id,
          documentKind: doc.kind,
        },
        assertion: fromDocument(doc, extracted),
      });
    }

    /* -- Encumbrances ------------------------------------------------ */

    if (doc.kind === 'encumbrance_certificate') {
      const countField = field(doc, 'encumbranceCount');
      const periodField = field(doc, 'ecPeriod');
      const count = Number(countField?.value ?? '0');
      if (Number.isFinite(count) && count > 0) {
        const encumbrance = graph.upsertNode({
          kind: 'encumbrance',
          identifier: `ec ${doc.id}`,
          label: `${count} registered encumbrance${count === 1 ? '' : 's'}${periodField ? ` (EC ${periodField.value})` : ''}`,
          attributes: { documentId: doc.id, count, ...(periodField ? { period: periodField.value } : {}) },
          assertion: fromDocument(doc, countField),
        });
        graph.addEdge({
          kind: 'encumbers',
          from: encumbrance.id,
          to: landParcel.id,
          label: `Encumbrance registered against ${landParcel.label}`,
          assertion: fromDocument(doc, countField),
        });
        if (authorityNode) {
          graph.addEdge({
            kind: 'issued_by',
            from: encumbrance.id,
            to: authorityNode.id,
            label: `Certified by ${authorityNode.label}`,
            assertion: fromDocument(doc, periodField),
          });
        }
      }
    }

    // A lease is both an instrument and a burden on the freehold. Recording
    // only the instrument would leave the graph unable to say that the parcel
    // is encumbered, which is the fact a buyer actually needs.
    if (doc.kind === 'lease_agreement' && speaker) {
      const tenantField = field(doc, 'tenantName');
      const expiryField = field(doc, 'leaseExpiry');
      const encumbrance = graph.upsertNode({
        kind: 'encumbrance',
        identifier: `lease ${doc.id}`,
        label: tenantField ? `Lease in favour of ${tenantField.value}` : 'Lease on file',
        attributes: {
          documentId: doc.id,
          interest: 'leasehold',
          ...(expiryField ? { expiry: expiryField.value } : {}),
        },
        assertion: fromDocument(doc, tenantField),
      });
      graph.addEdge({
        kind: 'encumbers',
        from: encumbrance.id,
        to: landParcel.id,
        label: `Leasehold interest over ${landParcel.label}`,
        // World time again: the lease burdens the land until it expires.
        validTo: isoDate(expiryField?.value),
        assertion: fromDocument(doc, expiryField ?? tenantField),
      });
    }

    if (speaker) speakerByDocumentId.set(doc.id, speaker);
  }

  /* --- Derivation between instruments -------------------------------- */

  /**
   * A mother deed is, by definition of the document kind, the antecedent of
   * the deed that links to it. That is an inference from classification rather
   * than from a recital in the text, so it is asserted as `model_inference` at
   * a reduced confidence — visible to a reviewer, and weak enough that a
   * contradicting recital would beat it.
   */
  const motherDeeds = documents.filter(d => d.kind === 'mother_deed');
  const titleDeeds = documents.filter(d => d.kind === 'title_deed');
  for (const child of titleDeeds) {
    const childNode = speakerByDocumentId.get(child.id);
    if (!childNode) continue;
    for (const parent of motherDeeds) {
      const parentNode = speakerByDocumentId.get(parent.id);
      if (!parentNode || parentNode.id === childNode.id) continue;
      graph.addEdge({
        kind: 'derives_from',
        from: childNode.id,
        to: parentNode.id,
        label: 'Title deed derives from the mother deed on file',
        assertion: fromInference(child, 'documentKind'),
      });
    }
  }

  return graph.finish(propertyCase.id, now);
}
