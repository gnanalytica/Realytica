/**
 * The report as a graph traversal.
 *
 * The design doc's rule: "the final report cannot contain a conclusion the
 * graph cannot explain." This module makes that true by construction — each
 * section is a domain's judgement nodes, and each judgement carries the
 * support its own derivation cone actually holds: the claims that back it,
 * the files those claims came from, and any contradiction touching the cone.
 * A judgement with nothing behind it is not hidden or padded; it is flagged,
 * because an unevidenced conclusion is a finding about the file.
 *
 * Actions are deliberately not report lines here. An action mitigates a risk
 * — its derivation runs outward, not downward — so it has no cone to print,
 * and the recommended-actions section already renders them with their risks.
 *
 * Each judgement also carries its RECORDED REASONING, kept strictly separate
 * from its support. Evidence is what a conclusion rests on and belongs in the
 * body; reasoning is how it was reached and belongs in an audit trail. Putting
 * a chat message in the same list as a registered deed is precisely what the
 * one-way rule exists to prevent, so `reasoning` is a different field and a
 * caller that prints them together is choosing to.
 */

import { DD_DOMAIN_KEYS, DD_DOMAIN_PROFILES } from '../dd-domains';
import type { DdDomain } from '../dd-domains';
import type { DdGraph, DdNode } from './dd-graph';
import { trace } from './dd-graph';
import { why } from './why';

export interface GraphReportJudgement {
  node: DdNode;
  /** Claim-layer facts in the derivation cone — what the evidence says. */
  claims: DdNode[];
  /** Evidence-layer files in the cone — the documents and photos themselves. */
  evidence: DdNode[];
  /** Contradictions touching the cone. Never dropped: a trace that hides a live disagreement is a clean-looking lie. */
  contradictions: DdNode[];
  /**
   * The recorded reasoning around this conclusion — never its support.
   *
   * Separate from `claims` and `evidence` on purpose. A reader must be able to
   * tell "this rests on the sale deed at page 3" from "we discussed this on
   * Tuesday", and a report that renders them as one list has quietly promoted
   * a conversation to evidence.
   */
  reasoning: DdNode[];
  /** True when nothing in the graph derives this conclusion. */
  unevidenced: boolean;
  /**
   * True when the conclusion is evidenced but nobody wrote down why it was
   * reached that way. Not a defect — most conclusions are mechanical — but it
   * is the difference between an audit trail that is empty and one that was
   * never asked for.
   */
  undiscussed: boolean;
}

export interface GraphReportSection {
  domain: DdDomain;
  label: string;
  question: string;
  judgements: GraphReportJudgement[];
}

export interface GraphReport {
  builtAt: string;
  /** Only domains that actually hold judgements — an empty section is not a section. */
  sections: GraphReportSection[];
  totals: { judgements: number; unevidenced: number; contradictions: number; discussed: number };
}

/** Kinds that state a conclusion about the property, in print order within equal severity. */
const REPORTED_KINDS = ['check', 'finding', 'risk'] as const;

const SEVERITY_ORDER: Record<string, number> = { critical: 0, serious: 1, warning: 2, info: 3 };

/** Lower prints first: blockers and criticals lead their section. */
function printWeight(node: DdNode): number {
  if (node.attributes.verdict === 'blocker') return 0;
  const severity = node.attributes.severity;
  if (typeof severity === 'string' && severity in SEVERITY_ORDER) return SEVERITY_ORDER[severity];
  if (node.attributes.verdict === 'attention') return 2;
  return 4;
}

export function buildGraphReport(graph: DdGraph): GraphReport {
  const byDomain = new Map<DdDomain, GraphReportJudgement[]>();
  const contradictionIds = new Set<string>();
  let unevidencedTotal = 0;

  for (const node of graph.nodes) {
    if (node.layer !== 'judgement' || !(REPORTED_KINDS as readonly string[]).includes(node.kind)) continue;
    const cone = trace(graph, node.id);
    const support = (cone?.nodes ?? []).filter(n => n.id !== node.id);
    const contradictions = support.filter(n => n.kind === 'contradiction');
    for (const c of contradictions) contradictionIds.add(c.id);
    const unevidenced = !graph.edges.some(
      e => e.toNodeId === node.id && (e.kind === 'evidences' || e.kind === 'produces'),
    );
    if (unevidenced) unevidencedTotal += 1;
    // Depth 1: what actually discussed this conclusion, not the whole thread
    // it sat in. A report is not a transcript, and following the conversation
    // outward would attach every unrelated turn to every finding.
    const discussion = why(graph, node.id, 1);
    const reasoning = discussion?.steps.map(step => step.node) ?? [];
    const judgement: GraphReportJudgement = {
      node,
      claims: support.filter(n => n.kind === 'fact'),
      evidence: support.filter(n => n.layer === 'evidence'),
      contradictions,
      reasoning,
      unevidenced,
      undiscussed: reasoning.length === 0,
    };
    const domain = node.domain ?? 'risk';
    const list = byDomain.get(domain);
    if (list) list.push(judgement);
    else byDomain.set(domain, [judgement]);
  }

  const sections: GraphReportSection[] = [];
  let total = 0;
  let discussedTotal = 0;
  for (const domain of DD_DOMAIN_KEYS) {
    const judgements = byDomain.get(domain);
    if (!judgements || judgements.length === 0) continue;
    judgements.sort(
      (a, b) =>
        printWeight(a.node) - printWeight(b.node) ||
        (REPORTED_KINDS as readonly string[]).indexOf(a.node.kind) - (REPORTED_KINDS as readonly string[]).indexOf(b.node.kind) ||
        a.node.label.localeCompare(b.node.label) ||
        a.node.id.localeCompare(b.node.id),
    );
    total += judgements.length;
    discussedTotal += judgements.filter(j => !j.undiscussed).length;
    const profile = DD_DOMAIN_PROFILES[domain];
    sections.push({ domain, label: profile.label, question: profile.question, judgements });
  }

  return {
    builtAt: graph.builtAt,
    sections,
    totals: {
      judgements: total,
      unevidenced: unevidencedTotal,
      contradictions: contradictionIds.size,
      discussed: discussedTotal,
    },
  };
}
