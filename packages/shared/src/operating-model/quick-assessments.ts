/**
 * Quick assessments: a living estimate for every workstream.
 *
 * Built from the project's own findings and data, following the method a
 * professional would use for that kind of assessment, and re-read whenever
 * anything changes — a document filed, a value accepted, a certified report
 * uploaded, an entry from site. It is an estimate and says so; a certified
 * report from a named professional is the figure of record.
 *
 * ## Where an input comes from
 *
 * Every input names its source level. A higher level always overrides a
 * lower one, and a figure resting mostly on assumptions is shown as a rough
 * range, never a single number:
 *
 *   1 verified on the file          5 licensed transaction data
 *   2 the project's documents       6 portal listings (asking prices)
 *   3 government records and law    7 published sources
 *   4 regulatory standards          8 standard assumptions
 */

import type { DdProject } from './types';
import type { DepartmentKey } from './departments';
import { WORKSTREAMS, workstreamDefinition } from './departments';
import { workstreamChecks } from './engagements';
import { approvalsRegister, constructionGate } from './approvals';
import { progressSummary } from './progress';
import { valueInputRows, valueOffers, withValueOffers, type ValueOffer } from './value-inputs';
import { valueSummary } from './value-standing';
import { runValuationApproaches } from './valuation-run';
import { approachIsUsable } from './valuation-model';
import { CHECK_RESULT_LABEL } from './catalogs';

/* ==================================================================== */
/* Source levels                                                         */
/* ==================================================================== */

export type SourceTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  1: 'Verified on the file',
  2: 'Project documents',
  3: 'Government records and law',
  4: 'Regulatory standards',
  5: 'Licensed transaction data',
  6: 'Portal listings',
  7: 'Published sources',
  8: 'Standard assumption',
};

/** Past this share of a figure resting on assumptions, it is a rough range only. */
export const ROUGH_ABOVE = 0.5;

export interface QuickInput {
  label: string;
  value: string;
  tier: SourceTier;
  source: string;
}

export type QuickVerdict = 'clear' | 'conditions' | 'blockers' | 'insufficient';

export const QUICK_VERDICT_LABEL: Record<QuickVerdict, string> = {
  clear: 'Clear',
  conditions: 'Clear with conditions',
  blockers: 'Blockers',
  insufficient: 'Not enough on file',
};

export interface QuickPoint {
  tone: 'good' | 'warning' | 'critical' | 'neutral';
  text: string;
  source?: string;
}

export interface QuickAssessment {
  workstream: string;
  department: DepartmentKey;
  /** A figure (a value, a percentage) or a verdict. */
  kind: 'figure' | 'verdict';
  headline: string;
  figure?: { value: number; unit: 'INR' | '%'; low?: number; high?: number };
  verdict: QuickVerdict;
  /** What decides it, best and worst first. */
  points: QuickPoint[];
  inputs: QuickInput[];
  /** Share of the figure resting on standard assumptions, 0..1. */
  assumptionShare: number;
  rough: boolean;
  /** What would most firm it up. */
  gaps: string[];
  /** The method it follows. */
  method: string;
  at: string;
}

/** What a certified report and the history keep of an assessment. */
export interface QuickSnapshot {
  workstream: string;
  at: string;
  headline: string;
  verdict: QuickVerdict;
  figure?: { value: number; unit: 'INR' | '%' };
}

export function snapshotOf(a: QuickAssessment): QuickSnapshot {
  return { workstream: a.workstream, at: a.at, headline: a.headline, verdict: a.verdict, ...(a.figure ? { figure: { value: a.figure.value, unit: a.figure.unit } } : {}) };
}

function inr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/* ==================================================================== */
/* Finance › Valuation                                                   */
/* ==================================================================== */

function tierOfOffer(o: ValueOffer): SourceTier {
  switch (o.source.kind) {
    case 'project':
      return 1;
    case 'document':
      return 2;
    case 'revenue_map':
    case 'state_pack':
      return 3;
    case 'convention':
      return 4;
    case 'comparables':
      return o.with?.rate_basis === 'portal listings (asking prices)' ? 6 : o.with?.rate_basis === 'reported transactions' ? 3 : 1;
    case 'boundary':
      return 2;
    default:
      return 8;
  }
}

function valuation(project: DdProject, at: string): QuickAssessment {
  const offers = valueOffers(project);
  const rows = valueInputRows(project, offers);
  const waiting = rows.flatMap((r) => (r.waiting ? [r.waiting] : []));
  const working = runValuationApproaches(withValueOffers(project, waiting));
  const s = valueSummary(project, working);
  const inputs: QuickInput[] = [];
  for (const r of rows) {
    if (r.recorded) inputs.push({ label: r.label, value: r.recorded.display, tier: 1, source: r.recorded.source ?? 'This file' });
    else if (r.waiting) inputs.push({ label: r.label, value: r.waiting.display, tier: tierOfOffer(r.waiting), source: `${r.waiting.source.label}${r.waiting.source.detail ? ` · ${r.waiting.source.detail}` : ''}` });
  }
  const usable = working.runs.filter(approachIsUsable);
  // The share of the blend that rests on an approach whose rate is only an assumption or an asking price.
  const weightTotal = usable.reduce((n, r) => n + r.weight, 0) || 1;
  const soft = usable.filter((r) => r.method === 'comparable_rate' && inputs.some((i) => i.label === 'Rate applied' && i.tier >= 6));
  const assumptionShare = soft.reduce((n, r) => n + r.weight, 0) / weightTotal * 0.5;
  const points: QuickPoint[] = [];
  if (s.restsOnGuidance) points.push({ tone: 'warning', text: 'Rests on the guidance value alone — the statutory floor, not a market value.' });
  for (const a of s.approaches) {
    points.push(a.amount !== null ? { tone: 'neutral', text: `${a.label}: ${inr(a.amount)} (${Math.round(a.share * 100)}%)` } : { tone: 'neutral', text: `${a.label}: needs ${a.missing.slice(0, 2).join(', ').toLowerCase()}` });
  }
  if (s.vsGuideline !== null && s.vsGuideline < 0) points.push({ tone: 'warning', text: `${Math.round(Math.abs(s.vsGuideline) * 100)}% below the guideline value.` });
  const fair = s.fairMarket;
  const rough = assumptionShare > ROUGH_ABOVE;
  return {
    workstream: 'finance.valuation',
    department: 'finance',
    kind: 'figure',
    headline: fair === null ? (s.outcome === 'approaches_disagree' ? 'Approaches disagree' : 'No figure yet') : rough ? `${inr(s.low ?? fair)} – ${inr(s.high ?? fair)}` : inr(fair),
    ...(fair !== null ? { figure: { value: fair, unit: 'INR' as const, ...(s.low !== null ? { low: s.low } : {}), ...(s.high !== null ? { high: s.high } : {}) } } : {}),
    verdict: fair === null ? 'insufficient' : s.restsOnGuidance ? 'conditions' : 'clear',
    points,
    inputs,
    assumptionShare,
    rough,
    gaps: [...new Set(working.runs.filter((r) => r.method === 'comparable_rate' || r.method === 'depreciated_replacement_cost').flatMap((r) => r.missing))].slice(0, 4),
    method: 'IBBI valuation standards: comparable, cost, income and residual approaches, reconciled by weight.',
    at,
  };
}

/* ==================================================================== */
/* Legal › Title                                                         */
/* ==================================================================== */

const TITLE_STATE_CHECKS = ['khata_classification', 'e_khata_issuance', 'dc_conversion', 'ptcl_restriction', 'encumbrance_continuity', 'bda_bmrda_acquisition'];

function title(project: DdProject, at: string): QuickAssessment {
  const points: QuickPoint[] = [];
  const inputs: QuickInput[] = [];
  const screen = project.lastScreenResult;
  const types = new Set((project.evidence ?? []).filter((e) => e.attachments.length > 0 || e.status === 'received' || e.status === 'used' || e.status === 'validated').map((e) => e.documentType ?? ''));
  const has = (label: string) => types.has(label);
  for (const doc of ['Sale deed', 'Mother deed', 'Encumbrance certificate', 'Khata certificate and extract', 'RTC (record of rights)', 'DC conversion order']) {
    inputs.push({ label: doc, value: has(doc) ? 'On file' : 'Not on file', tier: has(doc) ? 2 : 8, source: has(doc) ? 'Documents' : '—' });
  }
  let blockers = 0;
  let attention = 0;
  for (const c of screen?.stateCompliance?.checks ?? []) {
    if (!TITLE_STATE_CHECKS.includes(c.key)) continue;
    if (c.verdict === 'blocker') {
      blockers += 1;
      points.push({ tone: 'critical', text: `${c.label}: ${c.headline}`, source: c.statute });
    } else if (c.verdict === 'attention') {
      attention += 1;
      points.push({ tone: 'warning', text: `${c.label}: ${c.headline}`, source: c.statute });
    } else if (c.verdict === 'clear') {
      points.push({ tone: 'good', text: `${c.label}: ${c.headline}`, source: c.statute });
    }
  }
  const graph = screen?.titleGraph;
  if (graph) {
    inputs.push({ label: 'Title chain established', value: `${graph.integrityScore}/100`, tier: 2, source: 'Title graph from the deeds' });
    for (const contradiction of graph.contradictions.slice(0, 3)) {
      const serious = contradiction.severity === 'critical' || contradiction.severity === 'serious';
      if (serious) blockers += contradiction.severity === 'critical' ? 1 : 0;
      attention += serious ? 0 : 1;
      points.push({ tone: serious ? 'critical' : 'warning', text: contradiction.statement });
    }
  }
  for (const check of workstreamChecks(project, 'legal.title')) {
    if (check.result === 'non_compliant') {
      blockers += 1;
      points.push({ tone: 'critical', text: `${check.title}: ${CHECK_RESULT_LABEL[check.result]}` });
    } else if (check.result === 'partially_compliant' || check.result === 'requires_expert_review') {
      attention += 1;
      points.push({ tone: 'warning', text: `${check.title}: ${CHECK_RESULT_LABEL[check.result]}` });
    }
  }
  const openLegal = (project.findings ?? []).filter((f) => f.discipline === 'legal' && (f.status === 'open' || f.status === 'under_review'));
  for (const f of openLegal.filter((x) => x.severity === 'critical' || x.severity === 'high').slice(0, 3)) {
    blockers += f.severity === 'critical' ? 1 : 0;
    attention += f.severity === 'high' ? 1 : 0;
    points.push({ tone: f.severity === 'critical' ? 'critical' : 'warning', text: f.title });
  }
  const core = has('Sale deed') || has('Mother deed');
  const verdict: QuickVerdict = !core || !has('Encumbrance certificate') ? 'insufficient' : blockers ? 'blockers' : attention ? 'conditions' : 'clear';
  const gaps = [
    ...(!core ? ['the title deeds'] : []),
    ...(!has('Encumbrance certificate') ? ['a 30-year encumbrance certificate'] : []),
    ...(!has('Khata certificate and extract') ? ['the khata'] : []),
    ...(!screen ? ['a check against the state’s title rules (Value this property)'] : []),
  ];
  return {
    workstream: 'legal.title',
    department: 'legal',
    kind: 'verdict',
    headline: verdict === 'blockers' ? `${blockers} blocker${blockers === 1 ? '' : 's'} on title` : verdict === 'conditions' ? `Clear with ${attention} condition${attention === 1 ? '' : 's'}` : QUICK_VERDICT_LABEL[verdict],
    verdict,
    points: points.sort((a, b) => rank(a.tone) - rank(b.tone)).slice(0, 10),
    inputs,
    assumptionShare: 0,
    rough: false,
    gaps,
    method: 'A 30-year title search: the chain of conveyances, encumbrances, khata and conversion, against the Karnataka title rules.',
    at,
  };
}

function rank(tone: QuickPoint['tone']): number {
  return { critical: 0, warning: 1, neutral: 2, good: 3 }[tone];
}

/* ==================================================================== */
/* Legal › Approvals                                                     */
/* ==================================================================== */

function approvals(project: DdProject, at: string): QuickAssessment {
  const register = approvalsRegister(project);
  const points: QuickPoint[] = [];
  const inputs: QuickInput[] = [];
  let blockers = 0;
  let attention = 0;
  for (const line of register) {
    inputs.push({ label: line.kind.label, value: line.held.length ? `${line.held.length} on file` : '—', tier: line.held.length ? 2 : 8, source: line.held[0]?.document ?? 'Not on file' });
    if (line.status === 'expired' || line.status === 'missing') {
      blockers += 1;
      points.push({ tone: 'critical', text: `${line.kind.label}: ${line.say}` });
    } else if (line.status === 'expiring') {
      attention += 1;
      points.push({ tone: 'warning', text: `${line.kind.label}: ${line.say}` });
    } else if (line.status === 'in_force') {
      points.push({ tone: 'good', text: `${line.kind.label}: ${line.say}` });
    }
  }
  const held = register.filter((l) => l.held.length).length;
  const verdict: QuickVerdict = held === 0 ? 'insufficient' : blockers ? 'blockers' : attention ? 'conditions' : 'clear';
  return {
    workstream: 'legal.approvals',
    department: 'legal',
    kind: 'verdict',
    headline: verdict === 'insufficient' ? QUICK_VERDICT_LABEL.insufficient : `${held} of ${register.filter((l) => l.status !== 'if_applicable' || l.held.length).length} in hand${blockers ? ` · ${blockers} missing or lapsed` : attention ? ` · ${attention} expiring` : ''}`,
    verdict,
    points: points.sort((a, b) => rank(a.tone) - rank(b.tone)),
    inputs,
    assumptionShare: 0,
    rough: false,
    gaps: register.filter((l) => l.status === 'missing').map((l) => l.kind.label),
    method: 'The approvals a development needs at each stage under Karnataka planning law, read from the documents on file with their validity.',
    at,
  };
}

/* ==================================================================== */
/* Construction                                                          */
/* ==================================================================== */

function progress(project: DdProject, at: string): QuickAssessment {
  const p = progressSummary(project);
  const gate = constructionGate(project);
  const points: QuickPoint[] = [];
  if (!gate.open && ((project.siteLog ?? []).length > 0 || (p.percent ?? 0) > 0)) {
    points.push({ tone: 'critical', text: `Work is logged without ${gate.missing.join(' and ').toLowerCase()} on file.` });
  }
  for (const late of p.late.slice(0, 4)) points.push({ tone: 'warning', text: `${late.name}: due ${late.plannedFinish}, at ${late.percent}%.` });
  if (p.lastEntry) points.push({ tone: 'neutral', text: `Last site entry ${p.lastEntry.date} by ${p.lastEntry.author}: ${p.lastEntry.manpower} on site.` });
  const verdict: QuickVerdict = p.percent === null ? 'insufficient' : points.some((x) => x.tone === 'critical') ? 'blockers' : p.late.length ? 'conditions' : 'clear';
  return {
    workstream: 'construction.progress',
    department: 'construction',
    kind: 'figure',
    headline: p.percent === null ? 'No milestones yet' : `${p.percent}% complete`,
    ...(p.percent !== null ? { figure: { value: p.percent, unit: '%' as const } } : {}),
    verdict,
    points,
    inputs: (project.milestones ?? []).map((m) => ({ label: m.name, value: `${m.percent}%`, tier: 1 as SourceTier, source: `Updated ${m.updatedAt.slice(0, 10)} by ${m.updatedBy}` })),
    assumptionShare: 0,
    rough: false,
    gaps: p.milestones === 0 ? ['milestones for the work'] : p.lastEntry ? [] : ['a site log entry'],
    method: 'Weighted completion of the work milestones, as the site log reports them.',
    at,
  };
}

function checksVerdict(project: DdProject, workstream: string, at: string, method: string): QuickAssessment {
  const def = workstreamDefinition(workstream)!;
  const checks = workstreamChecks(project, workstream);
  const answered = checks.filter((c) => c.result !== 'pending');
  const bad = answered.filter((c) => c.result === 'non_compliant');
  const partial = answered.filter((c) => c.result === 'partially_compliant' || c.result === 'requires_expert_review' || c.result === 'missing_evidence' || c.result === 'unable_to_verify');
  const issues = workstream === 'construction.quality' ? (project.siteLog ?? []).flatMap((e) => e.issues.filter((i) => i.severity === 'high')) : [];
  const points: QuickPoint[] = [
    ...bad.map((c) => ({ tone: 'critical' as const, text: `${c.title}: ${CHECK_RESULT_LABEL[c.result]}` })),
    ...issues.slice(0, 3).map((i) => ({ tone: 'critical' as const, text: `From site: ${i.title}` })),
    ...partial.map((c) => ({ tone: 'warning' as const, text: `${c.title}: ${CHECK_RESULT_LABEL[c.result]}` })),
  ];
  const verdict: QuickVerdict = answered.length === 0 && !issues.length ? 'insufficient' : bad.length || issues.length ? 'blockers' : partial.length ? 'conditions' : 'clear';
  return {
    workstream,
    department: def.department,
    kind: 'verdict',
    headline: verdict === 'insufficient' ? QUICK_VERDICT_LABEL.insufficient : `${answered.length} of ${checks.length} checks answered${bad.length ? ` · ${bad.length} failing` : ''}`,
    verdict,
    points: points.slice(0, 10),
    inputs: answered.map((c) => ({ label: c.title, value: CHECK_RESULT_LABEL[c.result], tier: c.evidenceIds.length ? (2 as SourceTier) : (1 as SourceTier), source: c.evidenceIds.length ? `${c.evidenceIds.length} document${c.evidenceIds.length === 1 ? '' : 's'}` : 'Recorded' })),
    assumptionShare: 0,
    rough: false,
    gaps: checks.filter((c) => c.result === 'pending').slice(0, 4).map((c) => c.title),
    method,
    at,
  };
}

/* ==================================================================== */
/* All of them                                                           */
/* ==================================================================== */

export function quickAssessment(project: DdProject, workstream: string, now = new Date()): QuickAssessment {
  const at = now.toISOString();
  switch (workstream) {
    case 'finance.valuation':
      return valuation(project, at);
    case 'legal.title':
      return title(project, at);
    case 'legal.approvals':
      return approvals(project, at);
    case 'construction.progress':
      return progress(project, at);
    case 'construction.quality':
      return checksVerdict(project, workstream, at, 'Inspections, tests and defects against the specification, and what the site reports.');
    case 'construction.site':
      return checksVerdict(project, workstream, at, 'What the site is next to, its drainage and services, as surveyed and seen on visits.');
    default:
      return checksVerdict(project, workstream, at, 'The workstream’s checks, answered against the evidence on file.');
  }
}

/** A quick assessment for every workstream in the departments this project uses. */
export function quickAssessments(project: DdProject, departments: readonly DepartmentKey[], now = new Date()): QuickAssessment[] {
  return WORKSTREAMS.filter((w) => departments.includes(w.department)).map((w) => quickAssessment(project, w.key, now));
}
