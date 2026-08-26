/**
 * Contradiction detection: the places where two documents about one property
 * cannot both be right.
 *
 * A contradiction is deliberately not a risk. A risk is a judgement about the
 * property ("this is a B-khata site and a bank will not lend on it"); a
 * contradiction is an observation about the paperwork ("the deed and the
 * khata describe two different extents"). Keeping them apart lets the engine
 * decide what a disagreement *means* while this module stays confined to
 * establishing that it exists, with both claims cited.
 *
 * The flagship check is `area_mismatch`, and the reason it is hard is that
 * five independent sources quote areas — the title deed's `extent`, the
 * mother deed's `extentConveyed`, the khata's `assessedArea`, the floor
 * plan's `drawnArea` and the Kadaster's `perceelOppervlakte` — in different
 * units, about different objects. Two of those three problems are traps:
 *
 * - **Units.** Comparing 2,400 (square feet) with 222.97 (square metres)
 *   produces a 90% "divergence" that is really a unit error. Everything is
 *   normalised through `areaToSqm` before any comparison, and a claim whose
 *   unit has no exact conversion is dropped rather than assumed.
 *
 * - **Objects.** A 145 sqm flat on a 55 sqm share of land is not a
 *   contradiction. Areas are only ever compared within one parcel node, and
 *   the builder has already separated the land parcel from the built unit, so
 *   the category error cannot be made here.
 *
 * The third — how large a difference is worth reporting — is a judgement, and
 * it is made explicitly below rather than by reporting every difference and
 * letting the user filter.
 */

import type {
  CaseDocument,
  ContradictionClaim,
  ContradictionKind,
  GraphContradiction,
  PropertyCase,
  RiskSeverity,
  TitleGraph,
  TitleNode,
} from '../types';
import { KHATA_TYPE_LABEL } from '../packs/karnataka';
import { AREA_CLAIM_FIELDS, COMPASS_SIDES, REMEDIES, mergeKeyFor, severityRank, stableDigest } from './ontology';
import { caseDocumentsForGraph } from './build';

/* ==================================================================== */
/* Thresholds                                                            */
/* ==================================================================== */

/**
 * Below this, an extent difference is drift, not a finding.
 *
 * Deeds round to the nearest square foot, khatas to the nearest square metre,
 * and OCR misreads a digit occasionally; a 1% spread across five sources is
 * what a correctly documented property looks like. Reporting it would train
 * users to ignore this check, which costs more than missing the odd 1.5%
 * genuine error.
 */
const AREA_DRIFT_FLOOR = 0.02;

/**
 * Severity by divergence, in the terms a Bengaluru transaction is actually
 * judged in.
 *
 * 2–5% is an explainable difference (a differently measured common area, a
 * rounding convention) but still has to be explained at registration, because
 * the sub-registrar compares the schedule against the khata. 5–12% is roughly
 * a full standard-site frontage on a 30x40 and will stop a bank valuation.
 * Above 12% the documents are not describing the same piece of land, and that
 * is not a discrepancy to reconcile but a defect to resolve.
 */
function areaSeverity(divergence: number): RiskSeverity {
  if (divergence >= 0.12) return 'critical';
  if (divergence >= 0.05) return 'serious';
  return 'warning';
}

/* ==================================================================== */
/* Helpers                                                               */
/* ==================================================================== */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeId(kind: ContradictionKind, caseId: string, discriminator: string): string {
  return `contradiction-${kind}-${stableDigest(`${caseId}|${kind}|${discriminator}`, 8)}`;
}

/**
 * How a claim reads in a sentence. Derived from the extraction field key so
 * the prose always names the actual source of the number — "the area assessed
 * on the khata", not "source 2".
 */
function claimPhrase(fieldKey: string, source?: string): string {
  const qualifier = source ? ` in ${source}` : '';
  if (fieldKey === 'identity.plotAreaSqm') return 'the plot area recorded on the case';
  if (fieldKey === 'identity.builtUpAreaSqm') return 'the built-up area recorded on the case';
  return `the ${AREA_CLAIM_FIELDS[fieldKey]?.what ?? fieldKey}${qualifier}`;
}

function attrString(node: TitleNode, key: string): string | undefined {
  const value = node.attributes[key];
  return typeof value === 'string' ? value : undefined;
}

function attrNumber(node: TitleNode, key: string): number | undefined {
  const value = node.attributes[key];
  return typeof value === 'number' ? value : undefined;
}

/** A claim with the normalised figure kept alongside it, so the prose can quote the original. */
interface AreaClaim extends ContradictionClaim {
  sqm: number;
}

/* ==================================================================== */
/* detectContradictions                                                  */
/* ==================================================================== */

/**
 * Finds every pair of sources on this case that cannot both be right.
 *
 * Takes the case as well as the graph because two checks need what the graph
 * deliberately does not carry: which *kind* of document an assertion came
 * from (a register naming a holder is a different finding from a deed naming
 * one), and the raw status fields — khata classification, conversion status —
 * that describe the property rather than relate its parts.
 *
 * The clock comes from `graph.builtAt`, not from a call to the system clock,
 * so "dated in the future" means later than the analysis the user is looking
 * at rather than later than whenever this happens to run.
 */
export function detectContradictions(graph: TitleGraph, propertyCase: PropertyCase): GraphContradiction[] {
  const found: GraphContradiction[] = [];
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const documents = caseDocumentsForGraph(propertyCase);
  const documentById = new Map<string, CaseDocument>(documents.map(doc => [doc.id, doc]));
  const identity = propertyCase.identity;
  const isIndia = identity.country === 'IN';

  /* ------------------------------------------------------------------ */
  /* area_mismatch                                                       */
  /* ------------------------------------------------------------------ */

  for (const parcel of graph.nodes) {
    if (parcel.kind !== 'parcel') continue;

    const claims: AreaClaim[] = [];

    // The case record's own figure is a claim like any other: if the user
    // says 220 sqm and every document says 200, that is a finding, and it is
    // frequently the first one a buyer wants to know about.
    const stated = attrNumber(parcel, 'statedAreaSqm');
    if (stated !== undefined && stated > 0) {
      const fieldKey = parcel.attributes.subject === 'built' ? 'identity.builtUpAreaSqm' : 'identity.plotAreaSqm';
      const assertion = parcel.assertedBy.find(a => a.fieldKey === fieldKey) ?? parcel.assertedBy[0];
      claims.push({
        sourceRef: 'identity',
        sourceLabel: 'Case record (user-supplied identity)',
        fieldKey,
        value: String(stated),
        unit: 'sqm',
        confidence: assertion?.confidence ?? 0.9,
        sqm: stated,
      });
    }

    for (const edge of graph.edges) {
      if (edge.kind !== 'asserts_area' || edge.toNodeId !== parcel.id) continue;
      const sqm = typeof edge.attributes?.areaSqm === 'number' ? edge.attributes.areaSqm : undefined;
      const fieldKey = typeof edge.attributes?.fieldKey === 'string' ? edge.attributes.fieldKey : undefined;
      if (sqm === undefined || fieldKey === undefined) continue;
      const assertion = edge.assertedBy[0];
      claims.push({
        sourceRef: assertion?.sourceRef ?? edge.fromNodeId,
        sourceLabel: assertion?.sourceLabel ?? nodeById.get(edge.fromNodeId)?.label ?? 'Unknown source',
        fieldKey,
        value: typeof edge.attributes?.statedValue === 'string' ? edge.attributes.statedValue : String(sqm),
        unit: typeof edge.attributes?.statedUnit === 'string' ? edge.attributes.statedUnit : 'sqm',
        confidence: edge.confidence,
        sqm,
      });
    }

    if (claims.length < 2) continue;

    // Ordered so the prose always names the same two sources for the same
    // data, and so the two extremes are the ones quoted.
    claims.sort((a, b) => (a.sqm !== b.sqm ? b.sqm - a.sqm : a.sourceRef < b.sourceRef ? -1 : 1));
    const largest = claims[0];
    const smallest = claims[claims.length - 1];
    // Spread over the largest value: the question a lawyer asks is "how much
    // of the land the biggest document describes is missing from the
    // smallest", and that denominator is the one that answers it.
    const divergence = (largest.sqm - smallest.sqm) / largest.sqm;
    if (divergence < AREA_DRIFT_FLOOR) continue;

    const sameField = largest.fieldKey === smallest.fieldKey;
    const isBuilt = parcel.attributes.subject === 'built';
    const subject = `${isBuilt ? 'Built-up area' : 'Extent'} of ${parcel.label}`;
    const pct = round1(divergence * 100);
    const khataOnFile = documents.some(d => d.kind === 'khata_extract');
    const resolvedBy: string[] = [REMEDIES.surveyorSketch.obtain, REMEDIES.certifiedRegisteredCopies.obtain];
    if (isIndia && !khataOnFile) resolvedBy.push(REMEDIES.khataExtract.obtain);

    found.push({
      id: makeId('area_mismatch', graph.caseId, parcel.id),
      kind: 'area_mismatch',
      subject,
      statement:
        // When the two extremes came from the same kind of field — two deeds
        // each stating their own schedule, say — the field phrase alone reads
        // as the same source twice ("the extent in the schedule is X but the
        // extent in the schedule is Y"), and the reader cannot tell which
        // document to go and look at. Naming the source disambiguates them,
        // and only then, so the common case stays short.
        `${capitalise(claimPhrase(largest.fieldKey, sameField ? largest.sourceLabel : undefined))} is ${round2(largest.sqm)} sqm but ` +
        `${claimPhrase(smallest.fieldKey, sameField ? smallest.sourceLabel : undefined)} is ` +
        `${round2(smallest.sqm)} sqm — a ${pct}% difference across ${claims.length} sources describing ${parcel.label}.`,
      claims: claims.map(({ sqm: _sqm, ...claim }) => claim),
      divergence: Math.round(divergence * 10000) / 10000,
      severity: areaSeverity(divergence),
      resolvedBy,
    });
  }

  /* ------------------------------------------------------------------ */
  /* boundary_mismatch                                                   */
  /* ------------------------------------------------------------------ */

  // The schedule of property identifies a parcel by what it abuts. Survey
  // numbers get subdivided and renumbered; the neighbours do not change when
  // the numbering does, which is exactly why Karnataka conveyancing leans on
  // the schedule at all. Two instruments describing different abutters on the
  // same side of the same parcel are describing either an undocumented
  // subdivision or two different pieces of land, and the difference between
  // those two answers is the whole transaction.
  //
  // Comparison is on the normalised abutter text, so "Sy. No. 118/3" and
  // "Survey Number 118/3" are one neighbour — the same normalisation the
  // builder merges parcels with, for the same reason: a mismatch reported on
  // punctuation would be noise, and noise here trains a user to skip the one
  // check that catches a wrong-parcel purchase.
  {
    interface BoundaryClaim {
      abutter: string;
      normalised: string;
      sourceRef: string;
      sourceLabel: string;
      fieldKey: string;
      confidence: number;
    }
    const bySideByParcel = new Map<string, Map<string, BoundaryClaim[]>>();
    for (const edge of graph.edges) {
      if (edge.kind !== 'describes_boundary') continue;
      const side = typeof edge.attributes?.side === 'string' ? edge.attributes.side : undefined;
      const abutter = typeof edge.attributes?.abutter === 'string' ? edge.attributes.abutter : undefined;
      if (!side || !abutter) continue;
      const assertion = edge.assertedBy[0];
      const perParcel = bySideByParcel.get(edge.toNodeId) ?? new Map<string, BoundaryClaim[]>();
      const claims = perParcel.get(side) ?? [];
      claims.push({
        abutter,
        normalised: mergeKeyFor('parcel', abutter),
        sourceRef: assertion?.sourceRef ?? edge.fromNodeId,
        sourceLabel: assertion?.sourceLabel ?? nodeById.get(edge.fromNodeId)?.label ?? 'Unknown source',
        fieldKey: typeof edge.attributes?.fieldKey === 'string' ? edge.attributes.fieldKey : `boundary_${side}`,
        confidence: edge.confidence,
      });
      perParcel.set(side, claims);
      bySideByParcel.set(edge.toNodeId, perParcel);
    }

    for (const [parcelId, perSide] of bySideByParcel) {
      const parcel = nodeById.get(parcelId);
      if (!parcel) continue;
      for (const side of COMPASS_SIDES) {
        const claims = perSide.get(side);
        if (!claims || claims.length < 2) continue;
        const distinct = new Set(claims.map(c => c.normalised).filter(n => n.length > 0));
        if (distinct.size < 2) continue;

        // Ordered so the same case always names the same two sources in the
        // same order, whatever order the documents were uploaded in.
        claims.sort((a, b) => (a.sourceLabel < b.sourceLabel ? -1 : a.sourceLabel > b.sourceLabel ? 1 : a.normalised < b.normalised ? -1 : 1));
        const [first, second] = claims;
        found.push({
          id: makeId('boundary_mismatch', graph.caseId, `${parcelId}:${side}`),
          kind: 'boundary_mismatch',
          subject: `${capitalise(side)} boundary of ${parcel.label}`,
          statement:
            `${first.sourceLabel} describes the ${side} boundary of ${parcel.label} as "${first.abutter}", but ` +
            `${second.sourceLabel} describes it as "${second.abutter}". The schedule of property is how this parcel is ` +
            'identified when survey numbers have been subdivided, so two schedules that disagree are describing either an ' +
            'undocumented subdivision or two different pieces of land.',
          claims: claims.map(c => ({ sourceRef: c.sourceRef, sourceLabel: c.sourceLabel, fieldKey: c.fieldKey, value: c.abutter, confidence: c.confidence })),
          severity: 'serious',
          resolvedBy: [REMEDIES.surveyorSketch.obtain, REMEDIES.certifiedRegisteredCopies.obtain],
        });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* party_mismatch                                                      */
  /* ------------------------------------------------------------------ */

  // A register entry is not a title. The khata, the tax assessment and Form
  // 9/11 record who the authority bills; only a deed records who owns. A name
  // that appears on the register and in no conveyance is either an
  // unregistered transfer, a namesake, or a stale mutation — all three matter,
  // and none of them is visible without the graph.
  const deedParties = graph.nodes.filter(n => n.kind === 'party' && n.attributes.namedByConveyance === true);
  const registerOnlyParties = graph.nodes.filter(
    n => n.kind === 'party' && n.attributes.namedByRegister === true && n.attributes.namedByConveyance !== true && n.attributes.tenant !== true,
  );

  if (deedParties.length > 0) {
    for (const holder of registerOnlyParties) {
      const registerAssertion =
        holder.assertedBy.find(a => {
          const doc = a.sourceRef === 'identity' ? undefined : documentById.get(a.sourceRef);
          return doc !== undefined && isRegisterKind(doc);
        }) ?? holder.assertedBy[0];
      const registerDoc = registerAssertion ? documentById.get(registerAssertion.sourceRef) : undefined;

      const claims: ContradictionClaim[] = [
        {
          sourceRef: registerAssertion?.sourceRef ?? holder.id,
          sourceLabel: registerAssertion?.sourceLabel ?? 'Register record',
          fieldKey: registerAssertion?.fieldKey ?? 'holderName',
          value: holder.label,
          confidence: registerAssertion?.confidence ?? 0.7,
        },
      ];
      for (const party of deedParties.slice(0, 3)) {
        const deedAssertion = party.assertedBy[0];
        claims.push({
          sourceRef: deedAssertion?.sourceRef ?? party.id,
          sourceLabel: deedAssertion?.sourceLabel ?? 'Instrument',
          fieldKey: deedAssertion?.fieldKey ?? 'ownerName',
          value: party.label,
          confidence: deedAssertion?.confidence ?? 0.7,
        });
      }

      const deedNames = deedParties.map(p => p.label).join(', ');
      found.push({
        id: makeId('party_mismatch', graph.caseId, holder.id),
        kind: 'party_mismatch',
        subject: `Recorded holder of ${identity.parcelId || identity.label}`,
        statement:
          `${registerDoc ? registerDoc.fileName : 'A register record'} names ${holder.label} as the recorded holder, ` +
          `but no instrument on file conveys to ${holder.label} — the deeds name ${deedNames}.`,
        claims,
        severity: 'serious',
        resolvedBy: [REMEDIES.khataMutation.obtain, REMEDIES.registeredConveyance.obtain],
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* date_impossible                                                     */
  /* ------------------------------------------------------------------ */

  // 1. A deed cannot predate the instrument it takes title through.
  for (const edge of graph.edges) {
    if (edge.kind !== 'derives_from') continue;
    const child = nodeById.get(edge.fromNodeId);
    const parent = nodeById.get(edge.toNodeId);
    if (!child || !parent || child.kind !== 'instrument' || parent.kind !== 'instrument') continue;
    const childAt = attrString(child, 'instrumentDate');
    const parentAt = attrString(parent, 'instrumentDate');
    if (!childAt || !parentAt || childAt >= parentAt) continue;

    found.push({
      id: makeId('date_impossible', graph.caseId, edge.id),
      kind: 'date_impossible',
      subject: `Sequence of ${child.label} and ${parent.label}`,
      statement:
        `${child.label} is dated ${childAt}, before ${parent.label} of ${parentAt} that it derives from — ` +
        'an instrument cannot precede the one it takes title through.',
      claims: [
        claimFromNode(child, 'instrumentDate', childAt),
        claimFromNode(parent, 'instrumentDate', parentAt),
      ],
      severity: 'critical',
      resolvedBy: [REMEDIES.certifiedRegisteredCopies.obtain, REMEDIES.motherDeed.obtain],
    });
  }

  // 2. An occupancy certificate cannot precede the commencement certificate.
  //    Only the year is recoverable from a CC reference such as `CC/4821/2019`
  //    — the extractor gives the certificate no date field of its own — so the
  //    comparison is deliberately made at year granularity rather than
  //    inventing a day the document does not carry.
  const occupancy = graph.nodes.find(n => n.kind === 'approval' && n.attributes.documentKind === 'occupancy_certificate');
  const commencement = graph.nodes.find(n => n.kind === 'approval' && n.attributes.documentKind === 'commencement_certificate');
  if (occupancy && commencement) {
    const ocDate = attrString(occupancy, 'approvalDate');
    const ccReference = attrString(commencement, 'reference');
    const ccYear = ccReference ? /(\d{4})\s*$/.exec(ccReference)?.[1] : undefined;
    if (ocDate && ccYear && ocDate.slice(0, 4) < ccYear) {
      found.push({
        id: makeId('date_impossible', graph.caseId, `${occupancy.id}|${commencement.id}`),
        kind: 'date_impossible',
        subject: 'Sequence of the commencement and occupancy certificates',
        statement:
          `The occupancy certificate is dated ${ocDate}, before the commencement certificate ${ccReference} issued in ${ccYear} — ` +
          'a building cannot be certified fit for occupation before work on it was permitted to start.',
        claims: [
          claimFromNode(occupancy, 'ocIssueDate', ocDate),
          claimFromNode(commencement, 'ccNumber', ccReference ?? ccYear),
        ],
        severity: 'serious',
        resolvedBy: [REMEDIES.commencementCertificate.obtain, REMEDIES.occupancyCertificate.obtain],
      });
    }
  }

  // 3. Nothing on this case can be dated after the analysis that reads it.
  const horizon = graph.builtAt.slice(0, 10);
  for (const node of graph.nodes) {
    if (node.kind !== 'instrument' && node.kind !== 'approval') continue;
    const at = attrString(node, 'instrumentDate') ?? attrString(node, 'approvalDate');
    if (!at || at <= horizon) continue;
    found.push({
      id: makeId('date_impossible', graph.caseId, `future|${node.id}`),
      kind: 'date_impossible',
      subject: `Date of ${node.label}`,
      statement: `${node.label} is dated ${at}, after the date of this analysis (${horizon}) — a document cannot be dated in the future.`,
      claims: [claimFromNode(node, 'instrumentDate', at)],
      severity: 'serious',
      resolvedBy: [REMEDIES.certifiedRegisteredCopies.obtain],
    });
  }

  /* ------------------------------------------------------------------ */
  /* identifier_mismatch                                                 */
  /* ------------------------------------------------------------------ */

  // An `identifies` edge is the builder saying "these two references are, on
  // balance, the same parcel". That judgement is worth acting on, but it is
  // also worth surfacing: a survey number that does not normalise to the one
  // on the case record is how a buyer ends up diligencing the wrong plot.
  for (const edge of graph.edges) {
    if (edge.kind !== 'identifies') continue;
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from || !to || from.kind !== 'parcel' || to.kind !== 'parcel') continue;
    const assertion = edge.assertedBy[0];
    found.push({
      id: makeId('identifier_mismatch', graph.caseId, edge.id),
      kind: 'identifier_mismatch',
      subject: `Parcel identifier for ${to.label}`,
      statement:
        `${assertion?.sourceLabel ?? 'A document on file'} describes the parcel as "${from.label}" while the case record describes it as ` +
        `"${to.label}"; the two references do not resolve to the same parcel and have been linked on the builder's judgement alone.`,
      claims: [
        {
          sourceRef: assertion?.sourceRef ?? edge.fromNodeId,
          sourceLabel: assertion?.sourceLabel ?? 'Document',
          fieldKey: assertion?.fieldKey ?? 'surveyNumber',
          value: from.label,
          confidence: edge.confidence,
        },
        {
          sourceRef: 'identity',
          sourceLabel: 'Case record (user-supplied identity)',
          fieldKey: 'identity.parcelId',
          value: to.label,
          confidence: to.assertedBy[0]?.confidence ?? 0.95,
        },
      ],
      severity: 'serious',
      resolvedBy: [REMEDIES.surveyorSketch.obtain, REMEDIES.khataExtract.obtain],
    });
  }

  /* ------------------------------------------------------------------ */
  /* status_conflict                                                     */
  /* ------------------------------------------------------------------ */

  const karnataka = identity.karnataka;
  if (karnataka) {
    // The A/B khata distinction decides whether a bank will lend, so the case
    // record and the extract disagreeing about it is not a clerical detail.
    const khataDoc = documents.find(d => d.kind === 'khata_extract');
    const classification = khataDoc?.extracted.find(f => f.key === 'khataClassification');
    const expected = expectedKhataClassification(karnataka.khataType);
    if (khataDoc && classification && expected && classification.value !== expected) {
      found.push({
        id: makeId('status_conflict', graph.caseId, `khata|${khataDoc.id}`),
        kind: 'status_conflict',
        subject: 'Khata classification',
        statement:
          `The khata extract classifies the property as "${classification.value}" while the case records it as ` +
          `${KHATA_TYPE_LABEL[karnataka.khataType]} — the two cannot both be right, and the distinction decides whether a bank will lend.`,
        claims: [
          {
            sourceRef: khataDoc.id,
            sourceLabel: khataDoc.fileName,
            fieldKey: 'khataClassification',
            value: classification.value,
            confidence: classification.confidence,
          },
          {
            sourceRef: 'identity',
            sourceLabel: 'Case record (user-supplied identity)',
            fieldKey: 'identity.karnataka.khataType',
            value: KHATA_TYPE_LABEL[karnataka.khataType],
            confidence: 0.8,
          },
        ],
        severity: 'serious',
        resolvedBy: [REMEDIES.khataExtract.obtain],
      });
    }

    // A conversion order on file for land the case still records as
    // agricultural means one of the two is stale — and which one it is
    // changes whether the property may lawfully be built on at all.
    const conversionDoc = documents.find(d => d.kind === 'conversion_certificate');
    if (conversionDoc && karnataka.landConversionStatus === 'agricultural') {
      const orderNumber = conversionDoc.extracted.find(f => f.key === 'conversionOrderNumber');
      found.push({
        id: makeId('status_conflict', graph.caseId, `conversion|${conversionDoc.id}`),
        kind: 'status_conflict',
        subject: 'Land conversion status',
        statement:
          `The case records the land as still agricultural, but a deputy commissioner conversion order` +
          `${orderNumber ? ` (${orderNumber.value})` : ''} is on file — one of the two is out of date.`,
        claims: [
          {
            sourceRef: conversionDoc.id,
            sourceLabel: conversionDoc.fileName,
            fieldKey: 'conversionOrderNumber',
            value: orderNumber?.value ?? 'conversion order on file',
            confidence: orderNumber?.confidence ?? conversionDoc.classificationConfidence,
          },
          {
            sourceRef: 'identity',
            sourceLabel: 'Case record (user-supplied identity)',
            fieldKey: 'identity.karnataka.landConversionStatus',
            value: 'agricultural',
            confidence: 0.8,
          },
        ],
        severity: 'serious',
        resolvedBy: [REMEDIES.conversionOrder.obtain],
      });
    }
  }

  /* ------------------------------------------------------------------ */

  return found.sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/* ==================================================================== */
/* Local helpers                                                         */
/* ==================================================================== */

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** Whether a document is an authority's record *about* the property rather than an instrument between parties. */
function isRegisterKind(doc: CaseDocument): boolean {
  return (
    doc.kind === 'khata_extract' ||
    doc.kind === 'property_tax_receipt' ||
    doc.kind === 'form_9_11' ||
    doc.kind === 'kadaster_extract' ||
    doc.kind === 'woz_assessment' ||
    doc.kind === 'encumbrance_certificate'
  );
}

/** Turns a node's own provenance back into a citable claim, so a date finding names its document. */
function claimFromNode(node: TitleNode, fieldKey: string, value: string): ContradictionClaim {
  const assertion = node.assertedBy.find(a => a.fieldKey === fieldKey) ?? node.assertedBy[0];
  return {
    sourceRef: assertion?.sourceRef ?? node.id,
    sourceLabel: assertion?.sourceLabel ?? node.label,
    fieldKey: assertion?.fieldKey ?? fieldKey,
    value,
    confidence: assertion?.confidence ?? 0.7,
  };
}

/**
 * What a khata extract should say for a given recorded khata type.
 *
 * Mirrors the classification `extractFields` derives, and returns `undefined`
 * where the recorded type does not determine an expected value — an e-khata,
 * "none" or "unknown" all read as unclassified on the extract, so a mismatch
 * there would be an artefact of the mapping rather than a real conflict.
 */
function expectedKhataClassification(khataType: string): string | undefined {
  switch (khataType) {
    case 'a_khata':
      return 'A';
    case 'b_khata':
      return 'B';
    case 'gram_panchayat_form_9_11':
      return 'Form 9/11 (Gram Panchayat)';
    default:
      return undefined;
  }
}
