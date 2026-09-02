/**
 * One index over everything on a project that a person might go looking for.
 *
 * Navigation answers "take me to the evidence register". This answers "take me
 * to the flood check" — which is the question people actually ask, and which
 * before this cost four clicks and a scan because nothing searched the records
 * themselves.
 *
 * Ranking is deliberately boring: every word of the query has to appear
 * somewhere, a match on the name beats a match on the surrounding detail, and
 * an item that is still open beats the same item once it is closed. Nothing
 * here is a model judgement — the order must be the same on every machine, and
 * a person must be able to see why a row is where it is.
 */

import {
  ACTION_STATUS_LABEL,
  ASSESSMENT_STATUS_LABEL,
  CHECK_RESULT_LABEL,
  DECISION_STATUS_LABEL,
  EVIDENCE_STATUS_LABEL,
  FINDING_STATUS_LABEL,
  RISK_STATUS_LABEL,
  SCOPE_LABEL,
} from './catalogs';
import type { CockpitPathExtra } from './sitting';
import type { DdProject } from './types';

export type SearchKind =
  | 'check'
  | 'evidence'
  | 'finding'
  | 'risk'
  | 'action'
  | 'decision'
  | 'asset'
  | 'assessment'
  | 'scope';

export interface ProjectSearchHit {
  /** The record's own id, so the caller can resolve and highlight it. */
  id: string;
  kind: SearchKind;
  /** What the record is called. */
  label: string;
  /** Where it lives and what state it is in. */
  detail: string;
  /** Where opening it should land. */
  extra: CockpitPathExtra;
  score: number;
}

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  check: 'Check',
  evidence: 'Evidence',
  finding: 'Finding',
  risk: 'Risk',
  action: 'Action',
  decision: 'Decision',
  asset: 'Asset',
  assessment: 'Assessment',
  scope: 'Scope',
};

/** The order two equally-matched records of different kinds come back in. */
const KIND_ORDER: Record<SearchKind, number> = {
  check: 0,
  finding: 1,
  evidence: 2,
  action: 3,
  risk: 4,
  decision: 5,
  scope: 6,
  assessment: 7,
  asset: 8,
};

function fold(s: string): string {
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * How well one candidate answers the query, or null if it does not.
 *
 * `label` and `detail` are scored separately because "flood" in a check's own
 * title means something different from "flood" in the name of the scope it
 * happens to sit in.
 */
function score(query: string, label: string, detail: string): number | null {
  const q = fold(query);
  if (!q) return null;
  const tokens = q.split(' ');
  const foldedLabel = fold(label);
  const foldedDetail = fold(detail);
  const hay = `${foldedLabel} ${foldedDetail}`;

  // Every word has to land somewhere. Typing more words should narrow, not widen.
  if (!tokens.every((t) => hay.includes(t))) return null;

  let n = 0;
  for (const t of tokens) {
    if (foldedLabel.startsWith(t)) n += 3;
    else if (foldedLabel.split(' ').some((w) => w.startsWith(t))) n += 2;
    else if (foldedLabel.includes(t)) n += 1;
    else n += 0.25;
  }
  // A whole-phrase hit on the name is what somebody typing a title means.
  if (foldedLabel.includes(q)) n += 2;
  if (foldedLabel === q) n += 4;
  return n;
}

/** Still-open work outranks the same record once it is finished. */
function openBonus(kind: SearchKind, state: string): number {
  if (kind === 'check') return state === 'pending' ? 0.75 : 0;
  if (kind === 'finding') return state === 'open' || state === 'under_review' ? 0.75 : 0;
  if (kind === 'action') return state === 'overdue' ? 1 : state === 'closed' ? 0 : 0.5;
  if (kind === 'risk') return state === 'closed' || state === 'accepted' ? 0 : 0.5;
  if (kind === 'evidence') return state === 'expected' || state === 'requested' ? 0.5 : 0;
  return 0;
}

interface Candidate {
  id: string;
  kind: SearchKind;
  label: string;
  detail: string;
  extra: CockpitPathExtra;
  state: string;
}

function candidates(project: DdProject): Candidate[] {
  const out: Candidate[] = [];

  for (const a of project.assessments) {
    out.push({
      id: a.id,
      kind: 'assessment',
      label: a.name,
      detail: ASSESSMENT_STATUS_LABEL[a.status],
      extra: { ddId: a.id },
      state: a.status,
    });
    for (const s of a.scopes) {
      const scopeName = SCOPE_LABEL[s.scopeKey];
      out.push({
        id: s.id,
        kind: 'scope',
        label: scopeName,
        detail: a.name,
        extra: { ddId: a.id, scopeId: s.id },
        state: 'open',
      });
      for (const c of s.checks) {
        out.push({
          id: c.id,
          kind: 'check',
          label: c.title,
          // The scope and DD are in the detail so "land flood" finds the flood
          // check inside Land & Site without either word being in its title.
          detail: `${scopeName} · ${a.name} · ${CHECK_RESULT_LABEL[c.result]}`,
          extra: { ddId: a.id, scopeId: s.id, checkId: c.id },
          state: c.result,
        });
      }
    }
  }

  for (const e of project.evidence) {
    out.push({
      id: e.id,
      kind: 'evidence',
      label: e.title,
      detail: EVIDENCE_STATUS_LABEL[e.status],
      extra: { evidenceId: e.id },
      state: e.status,
    });
  }
  for (const f of project.findings) {
    out.push({
      id: f.id,
      kind: 'finding',
      label: f.title,
      detail: `${f.severity} · ${FINDING_STATUS_LABEL[f.status]}`,
      extra: { findingId: f.id },
      state: f.status,
    });
  }
  for (const r of project.risks) {
    out.push({
      id: r.id,
      kind: 'risk',
      label: r.title,
      detail: `${r.materiality} · ${RISK_STATUS_LABEL[r.status]}`,
      extra: { riskId: r.id },
      state: r.status,
    });
  }
  for (const act of project.actions) {
    out.push({
      id: act.id,
      kind: 'action',
      label: act.title,
      detail: `${act.owner} · ${ACTION_STATUS_LABEL[act.status]}`,
      extra: { actionId: act.id },
      state: act.status,
    });
  }
  for (const d of project.decisions) {
    out.push({
      id: d.id,
      kind: 'decision',
      label: d.title,
      detail: `${d.decisionMaker} · ${DECISION_STATUS_LABEL[d.status]}`,
      extra: {},
      state: d.status,
    });
  }
  for (const asset of project.assets) {
    out.push({
      id: asset.id,
      kind: 'asset',
      label: asset.name,
      detail: asset.assetType.replaceAll('_', ' '),
      extra: { assetId: asset.id },
      state: 'open',
    });
  }

  return out;
}

export function searchProject(project: DdProject, query: string, limit = 8): ProjectSearchHit[] {
  const hits: ProjectSearchHit[] = [];
  for (const c of candidates(project)) {
    const base = score(query, c.label, c.detail);
    if (base === null) continue;
    hits.push({
      id: c.id,
      kind: c.kind,
      label: c.label,
      detail: c.detail,
      extra: c.extra,
      score: base + openBonus(c.kind, c.state),
    });
  }
  hits.sort(
    (a, b) => b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label),
  );
  return hits.slice(0, limit);
}
