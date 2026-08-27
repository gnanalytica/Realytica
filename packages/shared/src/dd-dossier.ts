/**
 * A department's dossier: what we know, what we hold, what is still owed.
 *
 * The cockpit's right pane, computed. Like every other read surface in this
 * package it is a deterministic projection over the case's own stores — no
 * new store, nothing persisted, same inputs always the same dossier.
 *
 * The one rule that shapes the whole module: **a fact appears only with the
 * document and page that prove it.** An extracted field already carries
 * `sourceDocumentId` and `sourcePage`; a field whose document is no longer on
 * the case is dropped rather than shown unsourced, because a fact the reader
 * cannot open is exactly the thing this product exists not to produce.
 *
 * Departments are not a property of a field — they are a property of the
 * DOCUMENT it came from (`domainsForDocumentKind`). That keeps one routing
 * map for evidence, dossiers and the graph alike, so a document filed into
 * Approvals cannot have its facts turn up somewhere else.
 */

import type { CaseDocument, PropertyCase, ReferenceData } from './types';
import { domainsForDocumentKind } from './dd-domains';
import type { DdDomain } from './dd-domains';
import { DD_DOMAIN_PROFILES } from './dd-domains';
import { connectorsForDomain, ddWatcherAlerts } from './dd-connectors';
import type { DdConnector, DdWatcherAlert } from './dd-connectors';
import { technicalDocumentGaps, TECHNICAL_SYSTEM_LABEL } from './technical-diligence';
import { domainForSystem } from './dd-domains';

/** One document's word on a fact — always resolvable on this case. */
export interface FactSource {
  documentId: string;
  documentName: string;
  /** 1-based page, when the extractor recorded one. */
  page?: number;
  confidence: number;
}

/**
 * One extracted fact, with every document that speaks to it.
 *
 * Grouped by field rather than listed per document, because the same fact
 * stated twice is not a repetition — it is corroboration, and it should read
 * as one line carrying two proofs.
 *
 * When the documents state DIFFERENT values the fact is marked `varies` and
 * every version is kept, never flattened to whichever was extracted last. It
 * is deliberately called `varies` and not "disputed": a mother deed and the
 * current sale deed recite different considerations because they are
 * different conveyances decades apart, and calling that a contradiction would
 * be this module inventing a finding it is not equipped to judge. Deciding
 * whether a difference is a CONTRADICTION belongs to `detectContradictions`
 * in the title graph, which knows which fields may legitimately differ and
 * carries a severity. Two detectors with two vocabularies is precisely the
 * mistake this codebase has already paid for once.
 */
export interface DossierFact {
  key: string;
  label: string;
  /** The best-corroborated version. */
  value: string;
  unit?: string;
  confidence: number;
  /** Every document that states this fact. */
  sources: FactSource[];
  /** Set when the documents state different values; `values` holds each. */
  varies: boolean;
  values?: { value: string; sources: FactSource[] }[];
}

/** A document in this department, and how it got here. */
export interface DossierDocument {
  id: string;
  fileName: string;
  kind: CaseDocument['kind'];
  uploadedAt: string;
  /** How many facts in this dossier rest on it. */
  factCount: number;
}

export interface DossierGap {
  id: string;
  label: string;
  /** Why it is owed, in the reader's terms. */
  note: string;
}

export interface DepartmentDossier {
  domain: DdDomain;
  label: string;
  question: string;
  facts: DossierFact[];
  documents: DossierDocument[];
  gaps: DossierGap[];
  connectors: DdConnector[];
  /** Empty when no reference data was supplied — staleness needs the state pack. */
  watchers: DdWatcherAlert[];
  counts: { facts: number; documents: number; gaps: number; watchers: number };
}

/**
 * Which departments a document's facts belong to. An unclassified or `other`
 * document routes nowhere: it is on the case and visible in Evidence, but it
 * does not put unattributed facts on a department's board.
 */
function documentDomains(doc: CaseDocument): DdDomain[] {
  return domainsForDocumentKind(doc.kind);
}

export function buildDepartmentDossier(
  propertyCase: PropertyCase,
  domain: DdDomain,
  options: { refData?: ReferenceData; now?: string } = {},
): DepartmentDossier {
  const profile = DD_DOMAIN_PROFILES[domain];
  const byId = new Map(propertyCase.documents.map(d => [d.id, d]));

  const inDomain = propertyCase.documents.filter(d => documentDomains(d).includes(domain));
  const inDomainIds = new Set(inDomain.map(d => d.id));

  /* -- Facts: every extracted field whose document sits in this department -- */

  interface Raw { label: string; unit?: string; value: string; source: FactSource }
  const byKey = new Map<string, Raw[]>();
  const factsPerDocument = new Map<string, number>();
  for (const doc of inDomain) {
    for (const field of doc.extracted) {
      // The field records its own source, which is normally this document but
      // is checked rather than assumed — a field copied between documents must
      // still open the one it actually came from.
      const source = byId.get(field.sourceDocumentId);
      if (!source) continue;
      if (!inDomainIds.has(source.id)) continue;
      const raw: Raw = {
        label: field.label,
        unit: field.unit,
        value: field.value,
        source: { documentId: source.id, documentName: source.fileName, page: field.sourcePage, confidence: field.confidence },
      };
      const list = byKey.get(field.key);
      if (list) list.push(raw);
      else byKey.set(field.key, [raw]);
      factsPerDocument.set(source.id, (factsPerDocument.get(source.id) ?? 0) + 1);
    }
  }

  /** Two documents mean the same thing when the text matches once case and spacing are set aside. */
  const same = (a: string, b: string): boolean =>
    a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

  const facts: DossierFact[] = [];
  for (const [key, raws] of byKey) {
    const groups: { value: string; sources: FactSource[] }[] = [];
    for (const raw of raws) {
      const hit = groups.find(g => same(g.value, raw.value));
      if (hit) hit.sources.push(raw.source);
      else groups.push({ value: raw.value, sources: [raw.source] });
    }
    for (const g of groups) g.sources.sort((a, b) => b.confidence - a.confidence || a.documentId.localeCompare(b.documentId));
    // Best-corroborated version leads, then the most confident — two documents
    // agreeing outrank one document sounding sure.
    groups.sort(
      (a, b) =>
        b.sources.length - a.sources.length ||
        (b.sources[0]?.confidence ?? 0) - (a.sources[0]?.confidence ?? 0) ||
        a.value.localeCompare(b.value),
    );
    const lead = groups[0];
    facts.push({
      key,
      label: raws[0].label,
      value: lead.value,
      unit: raws[0].unit,
      confidence: lead.sources[0].confidence,
      sources: groups.flatMap(g => g.sources),
      varies: groups.length > 1,
      ...(groups.length > 1 ? { values: groups } : {}),
    });
  }
  // A fact with more than one version leads — whether or not it is a
  // contradiction, it is the one the reader has to look at.
  facts.sort((a, b) => Number(b.varies) - Number(a.varies) || b.confidence - a.confidence || a.key.localeCompare(b.key));

  const documents: DossierDocument[] = inDomain
    .map(d => ({
      id: d.id,
      fileName: d.fileName,
      kind: d.kind,
      uploadedAt: d.uploadedAt,
      factCount: factsPerDocument.get(d.id) ?? 0,
    }))
    .sort((a, b) => b.factCount - a.factCount || a.fileName.localeCompare(b.fileName));

  /* -- Gaps: what this department is still owed --------------------------- */

  const gaps: DossierGap[] = [];
  for (const phase of ['built', 'proposed'] as const) {
    for (const item of technicalDocumentGaps(phase, propertyCase.technicalDocumentsProvided)) {
      if (domainForSystem(item.system) !== domain) continue;
      gaps.push({
        id: item.id,
        label: item.label,
        note: `Not marked received · ${TECHNICAL_SYSTEM_LABEL[item.system]}`,
      });
    }
  }
  for (const item of propertyCase.result?.completeness.items ?? []) {
    if (item.present || !item.required) continue;
    const domains = domainsForDocumentKind(item.satisfiedBy[0] ?? 'other');
    if (!domains.includes(domain)) continue;
    gaps.push({ id: item.key, label: item.label, note: 'Required for this property and state; not on file' });
  }

  const watchers = options.refData
    ? ddWatcherAlerts(propertyCase, options.refData, options.now ?? propertyCase.updatedAt).filter(a => a.domain === domain)
    : [];

  return {
    domain,
    label: profile.label,
    question: profile.question,
    facts,
    documents,
    gaps,
    connectors: connectorsForDomain(domain),
    watchers,
    counts: { facts: facts.length, documents: documents.length, gaps: gaps.length, watchers: watchers.length },
  };
}
