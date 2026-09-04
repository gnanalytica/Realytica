/**
 * The current sitting on a DD file — one check, one pack item, the cards
 * for this turn. History dumps and the 292-row library are not context.
 */

import { CHECK_RESULT_LABEL, SCOPE_LABEL } from './catalogs';
import { portalForCheck, portalObtainLine } from './portals';
import type { ChatProposal, DdAssessment, DdProject, ProjectChatTurn, ScopeInstance } from './types';

const DUMP =
  /Wizard for |Evidence gaps \(\d{2,}\)|Request \d{2,} outstanding|292 outstanding|library completeness is a separate/i;

export function isDumpTurn(text: string): boolean {
  return DUMP.test(text) || (text.length > 1400 && /\b(scopes to add|cards in this turn)\b/i.test(text));
}

/** Last eight non-dump turns — what a model may reread. */
export function sittingChatHistory(turns: ProjectChatTurn[], limit = 8): ProjectChatTurn[] {
  return turns.filter((t) => !isDumpTurn(t.text)).slice(-limit);
}

export function lastAssistantTurn(project: DdProject): ProjectChatTurn | undefined {
  for (let i = project.conversation.length - 1; i >= 0; i -= 1) {
    if (project.conversation[i]?.role === 'assistant') return project.conversation[i];
  }
  return undefined;
}

/** Approve-all means this turn's cards, unless they said every/open. */
export function approveAllMeansEveryOpen(question: string): boolean {
  return /\b(every|entire|all open|every open)\b/i.test(question);
}

export function currentTurnProposals(project: DdProject): ChatProposal[] {
  const last = lastAssistantTurn(project);
  const ids = new Set(last?.proposalIds ?? []);
  const open = project.chatProposals.filter((p) => p.status === 'proposed');
  if (!ids.size) return open;
  const hit = open.filter((p) => ids.has(p.id));
  return hit.length ? hit : open;
}

export function citeLabel(project: DdProject, id: string): string {
  if (project.id === id) return project.name;
  const asset = project.assets.find((a) => a.id === id);
  if (asset) return asset.name;
  for (const a of project.assessments) {
    if (a.id === id) return a.name;
    for (const s of a.scopes) {
      if (s.id === id) return SCOPE_LABEL[s.scopeKey];
      const check = s.checks.find((c) => c.id === id);
      if (check) return `${SCOPE_LABEL[s.scopeKey]} · ${check.title}`;
    }
  }
  const finding = project.findings.find((f) => f.id === id);
  if (finding) return finding.title;
  const evidence = project.evidence.find((e) => e.id === id);
  if (evidence) return evidence.title;
  const risk = project.risks.find((r) => r.id === id);
  if (risk) return risk.title;
  const action = project.actions.find((a) => a.id === id);
  if (action) return action.title;
  const decision = project.decisions.find((d) => d.id === id);
  if (decision) return decision.title;
  const draft = project.aiDrafts.find((d) => d.id === id);
  if (draft) return draft.title;
  const proposal = project.chatProposals.find((p) => p.id === id);
  if (proposal) return proposal.title;
  return id;
}

export function graphNodeLabels(project: DdProject): Array<{ id: string; label: string }> {
  const rows: Array<{ id: string; label: string }> = [{ id: project.id, label: project.name }];
  for (const a of project.assets) rows.push({ id: a.id, label: a.name });
  for (const a of project.assessments) {
    rows.push({ id: a.id, label: a.name });
    for (const s of a.scopes) {
      rows.push({ id: s.id, label: SCOPE_LABEL[s.scopeKey] });
      for (const c of s.checks) rows.push({ id: c.id, label: c.title });
    }
  }
  for (const f of project.findings) rows.push({ id: f.id, label: f.title });
  for (const e of project.evidence) rows.push({ id: e.id, label: e.title });
  for (const r of project.risks) rows.push({ id: r.id, label: r.title });
  for (const a of project.actions) rows.push({ id: a.id, label: a.title });
  return rows;
}

export function isoDaysFromNow(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sittingCheckOf(
  project: DdProject,
  extra?: { ddId?: string; scopeId?: string; checkId?: string },
) {
  if (!extra?.checkId) return undefined;
  for (const a of project.assessments) {
    if (extra.ddId && a.id !== extra.ddId) continue;
    for (const s of a.scopes) {
      if (extra.scopeId && s.id !== extra.scopeId) continue;
      const check = s.checks.find((c) => c.id === extra.checkId);
      if (check) return { assessment: a, scope: s, check };
    }
  }
  return undefined;
}

export type SittingCheck = NonNullable<ReturnType<typeof sittingCheckOf>>;

function evidenceHolds(status: string): boolean {
  return status === 'received' || status === 'validated' || status === 'used';
}

function evidenceOnCheck(project: DdProject, check: { id: string; evidenceIds: string[] }) {
  return project.evidence.filter((e) => check.evidenceIds.includes(e.id) || e.checkIds.includes(check.id));
}

function pickCheckOnScope(scope: ScopeInstance) {
  return (
    scope.checks.find((c) => c.result === 'pending')
    ?? scope.checks.find((c) => c.result === 'missing_evidence')
    ?? scope.checks[0]
  );
}

function pickFieldOnAssessment(assessment: DdAssessment): SittingCheck | undefined {
  for (const scope of assessment.scopes) {
    const check = scope.checks.find((c) => c.result === 'pending');
    if (check) return { assessment, scope, check };
  }
  for (const scope of assessment.scopes) {
    const check = scope.checks.find((c) => c.result === 'missing_evidence');
    if (check) return { assessment, scope, check };
  }
  for (const scope of assessment.scopes) {
    if (scope.checks[0]) return { assessment, scope, check: scope.checks[0] };
  }
  return undefined;
}

/** Next field to sit on for a named DD or scope — including completed assessments. */
export function fieldOnSitting(project: DdProject, talk: TalkSitting): SittingCheck | undefined {
  if (talk.kind === 'check') return sittingCheckOf(project, talk.extra);
  if (talk.kind === 'scope') {
    for (const assessment of project.assessments) {
      if (talk.extra.ddId && assessment.id !== talk.extra.ddId) continue;
      const scope = assessment.scopes.find((s) => s.id === talk.extra.scopeId);
      if (!scope) continue;
      const check = pickCheckOnScope(scope);
      if (check) return { assessment, scope, check };
    }
    return undefined;
  }
  if (talk.kind === 'dd') {
    const assessment = project.assessments.find((a) => a.id === talk.extra.ddId);
    return assessment ? pickFieldOnAssessment(assessment) : undefined;
  }
  if (talk.extra.checkId) return sittingCheckOf(project, talk.extra);
  return undefined;
}

/**
 * When chat names a DD or scope, still sit on a field so the right pane can
 * tick/cross. A named check is left as-is. Does not skip completed DDs.
 */
export function sittingWithField(project: DdProject, talk: TalkSitting | null): TalkSitting | null {
  if (!talk) return null;
  if (talk.kind === 'check') return talk;
  if (talk.kind !== 'scope' && talk.kind !== 'dd') return talk;
  const field = fieldOnSitting(project, talk);
  if (!field) return talk;
  return checkTalk(field.assessment, field.scope, field.check, talk.highlightIds);
}

export type CheckAdviseLean = 'tick' | 'cross' | 'none';

export interface CheckAdvise {
  lean: CheckAdviseLean;
  why: string;
}

/** Deterministic lean for a person — not a model verdict, not an auto-record. */
export function checkAdvise(project: DdProject, check: { id: string; title: string; result: string; expectedEvidence: string[]; evidenceIds: string[] }): CheckAdvise {
  if (check.result === 'not_applicable') {
    return { lean: 'none', why: 'This check is marked not applicable.' };
  }
  if (check.result === 'compliant') {
    return { lean: 'tick', why: 'Already recorded as compliant.' };
  }
  if (check.result !== 'pending') {
    return {
      lean: 'cross',
      why: `Recorded as ${CHECK_RESULT_LABEL[check.result as keyof typeof CHECK_RESULT_LABEL] ?? check.result}. Cross only if you are restating that proof is still missing.`,
    };
  }
  const quotes = quotesForCheck(project, check.id);
  const held = evidenceOnCheck(project, check).filter((e) => evidenceHolds(e.status));
  const expectedGap = check.expectedEvidence.filter((title) => {
    const n = fold(title);
    return !held.some((e) => {
      const t = fold(e.title);
      return t === n || t.includes(n) || n.includes(t);
    });
  });
  if (held.length && quotes.length) {
    return { lean: 'tick', why: 'A file and quotes are on this check. Tick if they hold.' };
  }
  if (held.length) {
    return { lean: 'tick', why: 'Evidence is on file for this check. Tick if it is enough to close as compliant.' };
  }
  if (quotes.length) {
    return { lean: 'tick', why: 'Quotes are pinned to this check. Tick if they hold; attach the file if it is not on the register yet.' };
  }
  if (expectedGap.length) {
    const portal = portalForCheck(check);
    const missing = `Expected proof is still missing: ${expectedGap.slice(0, 3).join(', ')}.`;
    if (portal) {
      return { lean: 'cross', why: `${missing} ${portalObtainLine(portal)}` };
    }
    return { lean: 'cross', why: missing };
  }
  return { lean: 'cross', why: 'No evidence is linked yet. Cross to record missing evidence, or attach a file in chat.' };
}

export function proposalsPinnedToCheck(project: DdProject, checkId: string): ChatProposal[] {
  return project.chatProposals.filter((p) => {
    if (p.status !== 'proposed') return false;
    const pl = p.payload as Record<string, unknown>;
    if (pl.checkId === checkId) return true;
    const checks = pl.checkIds;
    if (Array.isArray(checks) && checks.includes(checkId)) return true;
    return (p.citedNodeIds ?? []).includes(checkId);
  });
}

export function wantsCritic(question: string): boolean {
  return /\bcritic\b|\bunevidenced\b|\breview findings\b|\bchallenge (the )?findings?\b|\bfindings? without (proof|evidence)\b/i.test(
    question,
  );
}

export type SittingRef = { ddId?: string; scopeId?: string; checkId?: string };

/** Query extras the cockpit URL can carry so a named record is the thing on screen. */
export type CockpitPathExtra = SittingRef & {
  node?: string;
  evidenceId?: string;
  findingId?: string;
  riskId?: string;
  actionId?: string;
  assetId?: string;
  page?: string;
};

export type TalkKind = 'check' | 'scope' | 'dd' | 'evidence' | 'finding' | 'risk' | 'action' | 'asset';

export interface TalkSitting {
  kind: TalkKind;
  extra: CockpitPathExtra;
  highlightIds: string[];
  label: string;
}

export function paneForTalk(kind: TalkKind): 'scope' | 'dd' | 'evidence' | 'findings' | 'risks' | 'actions' | 'assets' {
  if (kind === 'check' || kind === 'scope') return 'scope';
  if (kind === 'dd') return 'dd';
  if (kind === 'evidence') return 'evidence';
  if (kind === 'finding') return 'findings';
  if (kind === 'risk') return 'risks';
  if (kind === 'action') return 'actions';
  return 'assets';
}

export function proposalQuotes(payload: Record<string, unknown> | undefined): Array<{ text: string; page?: number }> {
  const raw = payload?.quotes;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ text: string; page?: number }> = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const text = (row as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const page = (row as { page?: unknown }).page;
    out.push({ text: text.trim(), page: typeof page === 'number' ? page : undefined });
  }
  return out;
}

export function proposalExtractionNotes(payload: Record<string, unknown> | undefined): string | undefined {
  const notes = payload?.extractionNotes;
  return typeof notes === 'string' && notes.trim() ? notes.trim() : undefined;
}

export function mergeQuoteLists(
  a: Array<{ text: string; page?: number }> | undefined,
  b: Array<{ text: string; page?: number }> | undefined,
): Array<{ text: string; page?: number }> {
  const out: Array<{ text: string; page?: number }> = [];
  const seen = new Set<string>();
  for (const row of [...(a ?? []), ...(b ?? [])]) {
    const text = row.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, page: row.page });
  }
  return out;
}

function pushQuote(
  out: Array<{ text: string; page?: number; from: string }>,
  seen: Set<string>,
  q: { text: string; page?: number },
  from: string,
) {
  if (seen.has(q.text)) return;
  seen.add(q.text);
  out.push({ ...q, from });
}

/** Quotes on the evidence row plus any ingest cards still pinned to this check. */
export function quotesForCheck(project: DdProject, checkId: string): Array<{ text: string; page?: number; from: string }> {
  const out: Array<{ text: string; page?: number; from: string }> = [];
  const seen = new Set<string>();
  const linkedIds = new Set<string>();
  for (const a of project.assessments) {
    for (const s of a.scopes) {
      const check = s.checks.find((c) => c.id === checkId);
      if (check) for (const id of check.evidenceIds) linkedIds.add(id);
    }
  }
  for (const e of project.evidence) {
    if (!e.checkIds.includes(checkId) && !linkedIds.has(e.id)) continue;
    for (const q of e.quotes ?? []) pushQuote(out, seen, q, e.title);
  }
  for (const p of project.chatProposals) {
    if (p.kind !== 'file_evidence') continue;
    const pl = p.payload;
    const ids = [
      typeof pl.checkId === 'string' ? pl.checkId : undefined,
      ...(Array.isArray(pl.checkIds) ? pl.checkIds.filter((id): id is string => typeof id === 'string') : []),
    ];
    if (!ids.includes(checkId) && !(p.citedNodeIds ?? []).includes(checkId)) continue;
    for (const q of proposalQuotes(pl)) pushQuote(out, seen, q, p.title);
  }
  return out;
}

export function quotesForEvidence(project: DdProject, evidenceId: string): Array<{ text: string; page?: number }> {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  const fromCards: Array<{ text: string; page?: number }> = [];
  for (const p of project.chatProposals) {
    const pl = p.payload;
    const ids = [
      typeof pl.evidenceId === 'string' ? pl.evidenceId : undefined,
      ...(Array.isArray(pl.evidenceIds) ? pl.evidenceIds.filter((id): id is string => typeof id === 'string') : []),
      p.committedRecordId,
    ];
    if (!ids.includes(evidenceId)) continue;
    fromCards.push(...proposalQuotes(pl));
  }
  return mergeQuoteLists(evidence?.quotes, fromCards);
}

function paneTurn(role: ProjectChatTurn['role'], text: string, extra: Partial<ProjectChatTurn> = {}): ProjectChatTurn {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `cht_${uuid}`,
    role,
    text,
    at: new Date().toISOString(),
    citedEvidenceIds: extra.citedEvidenceIds ?? [],
    citedNodeIds: extra.citedNodeIds,
    toolCalls: extra.toolCalls,
    proposalIds: extra.proposalIds,
  };
}

/** A work-pane write belongs in the same thread the copilot reads. */
export function noteProjectEdit(
  project: DdProject,
  summary: string,
  extra?: { citedNodeIds?: string[]; citedEvidenceIds?: string[] },
): void {
  const text = summary.trim();
  if (!text) return;
  const cited = extra?.citedNodeIds ?? [];
  const evidenceIds = extra?.citedEvidenceIds ?? [];
  const user = paneTurn('user', text, { citedNodeIds: cited, citedEvidenceIds: evidenceIds });
  const assistant = paneTurn(
    'assistant',
    // One word. The citation chips and the tool-call row below it already say
    // where this landed; repeating that on every pane edit fills the thread
    // with the same three lines and buries the edits themselves.
    'Recorded.',
    {
      citedNodeIds: cited,
      citedEvidenceIds: evidenceIds,
      toolCalls: [{ name: 'pane_write', summary: text }],
    },
  );
  project.conversation.push(user, assistant);
  project.updatedAt = assistant.at;
}

/**
 * Whether a person has actually said anything here.
 *
 * Not the same question as "is the thread empty", and the difference is worth
 * three hundred pixels on every pane. `noteProjectEdit` writes a synthetic
 * user turn and a one-word reply for every work-pane edit, so a file where
 * nobody has ever opened the copilot still has a conversation in it — on the
 * seeded project, two turns reading "Ran the project screen." and "Recorded."
 *
 * The cockpit gives an empty thread less room, correctly, and then gave the
 * full width to a thread containing nothing but its own bookkeeping. The
 * `pane_write` tool call on the reply is what marks a pair as an echo rather
 * than an exchange.
 */
export function hasSpokenConversation(project: DdProject): boolean {
  const turns = project.conversation ?? [];
  return turns.some((turn, i) => {
    if (turn.role !== 'user') return false;
    const reply = turns[i + 1];
    const isEcho =
      reply?.role === 'assistant' && (reply.toolCalls ?? []).some((call) => call.name === 'pane_write');
    return !isEcho;
  });
}

function fold(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const TALK_SKIP =
  /^(guide me|what'?s next|what should we do( next)?|hello|hi|hey|help|brief(ing)?|approve( all)?|skip|reject|yes|ok|okay)([.! ]|$)/i;

const TALK_STOP = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'been',
  'were',
  'does',
  'into',
  'open',
  'show',
  'tell',
  'about',
  'what',
  'when',
  'status',
  'check',
  'scope',
  'evidence',
  'finding',
  'tracked',
  'required',
  'current',
  'please',
  'where',
  'which',
  'should',
]);

function tokenHits(haystack: string, needle: string): number {
  const tokens = fold(haystack)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !TALK_STOP.has(t));
  const q = fold(needle);
  return tokens.filter((t) => q.includes(t)).length;
}

/**
 * A crude English stem — enough to stop a plural missing its singular.
 *
 * "boundary" did not reach "Physical boundaries match the sanctioned plan",
 * and "litigation" did not reach "Litigation and disputes are disclosed",
 * because matching was exact-token. Deliberately shallow: this decides
 * whether something becomes a CANDIDATE to offer, never whether it is acted
 * on, so being generous costs a suggestion and being clever costs trust.
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && (token.endsWith('ses') || token.endsWith('ches') || token.endsWith('shes'))) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function meaningfulTokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !TALK_STOP.has(t))
    .map(stem);
}

/**
 * How well a title matches, on the loose reading used to build candidates.
 *
 * `titleScore` answers "is this certainly the thing they named". This answers
 * "could they have meant this", and returns a deliberately small score so a
 * loose hit can never outrank a confident one — it exists to be offered, not
 * to be chosen.
 */
function looseScore(title: string, question: string): number {
  const t = meaningfulTokens(title);
  const q = meaningfulTokens(question);
  if (!t.length || !q.length) return 0;
  const shared = t.filter((token) => q.includes(token));
  if (!shared.length) return 0;
  // Longest shared token carries the signal: one distinctive word ("khata",
  // "rajakaluve") means more than two generic ones.
  const longest = Math.max(...shared.map((x) => x.length));
  return Math.min(6, shared.length * 2 + Math.floor(longest / 4));
}

function titleScore(title: string, question: string, minLen = 5): number {
  const t = fold(title);
  const q = fold(question);
  if (t.length >= minLen && q.includes(t)) return t.length;
  const quoted = question.match(/["“]([^"”]+)["”]/);
  if (quoted) {
    const n = fold(quoted[1]);
    if (n.length >= 4 && t.includes(n)) return n.length;
  }
  const hits = tokenHits(title, question);
  const tokens = fold(title)
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length >= 4 && !TALK_STOP.has(x));
  if (hits >= 2 || (hits === 1 && tokens.length === 1)) return hits * 8;
  return 0;
}

function checkTalk(assessment: DdAssessment, scope: ScopeInstance, check: { id: string; title: string }, extraIds: string[] = []): TalkSitting {
  return {
    kind: 'check',
    extra: { ddId: assessment.id, scopeId: scope.id, checkId: check.id },
    highlightIds: [...new Set([check.id, scope.id, assessment.id, ...extraIds])],
    label: `${SCOPE_LABEL[scope.scopeKey]} · ${check.title}`,
  };
}

export function sittingFromCitedId(project: DdProject, id: string): TalkSitting | null {
  if (!id) return null;
  for (const a of project.assessments) {
    if (a.id === id) {
      return { kind: 'dd', extra: { ddId: a.id }, highlightIds: [a.id], label: a.name };
    }
    for (const s of a.scopes) {
      if (s.id === id) {
        return { kind: 'scope', extra: { ddId: a.id, scopeId: s.id }, highlightIds: [s.id, a.id], label: SCOPE_LABEL[s.scopeKey] };
      }
      const check = s.checks.find((c) => c.id === id);
      if (check) return checkTalk(a, s, check);
    }
  }
  const evidence = project.evidence.find((e) => e.id === id);
  if (evidence) {
    const extra: CockpitPathExtra = { evidenceId: evidence.id };
    const linked = sittingCheckOf(project, { checkId: evidence.checkIds[0] });
    if (linked) {
      extra.ddId = linked.assessment.id;
      extra.scopeId = linked.scope.id;
      extra.checkId = linked.check.id;
    }
    return { kind: 'evidence', extra, highlightIds: [evidence.id], label: evidence.title };
  }
  const finding = project.findings.find((f) => f.id === id);
  if (finding) {
    return { kind: 'finding', extra: { findingId: finding.id }, highlightIds: [finding.id], label: finding.title };
  }
  const risk = project.risks.find((r) => r.id === id);
  if (risk) return { kind: 'risk', extra: { riskId: risk.id }, highlightIds: [risk.id], label: risk.title };
  const action = project.actions.find((a) => a.id === id);
  if (action) return { kind: 'action', extra: { actionId: action.id }, highlightIds: [action.id], label: action.title };
  const asset = project.assets.find((a) => a.id === id);
  if (asset) return { kind: 'asset', extra: { assetId: asset.id }, highlightIds: [asset.id], label: asset.name };
  const proposal = project.chatProposals.find((p) => p.id === id);
  if (proposal?.committedRecordId && proposal.committedRecordId !== id) {
    return sittingFromCitedId(project, proposal.committedRecordId);
  }
  return null;
}

const KIND_RANK: Record<TalkKind, number> = {
  check: 80,
  evidence: 70,
  finding: 60,
  scope: 50,
  dd: 40,
  risk: 30,
  action: 25,
  asset: 20,
};

export function sittingFromCitedIds(project: DdProject, ids: string[]): TalkSitting | null {
  let best: TalkSitting | null = null;
  let bestRank = -1;
  for (const id of ids) {
    const hit = sittingFromCitedId(project, id);
    if (!hit) continue;
    const rank = KIND_RANK[hit.kind];
    if (rank > bestRank) {
      best = hit;
      bestRank = rank;
    }
  }
  return best;
}

/** A chat turn that opened a named sitting — the field the peek should show. */
export function sittingFromTurn(project: DdProject, turn: ProjectChatTurn): TalkSitting | null {
  if (turn.role !== 'assistant') return null;
  const fromIds = sittingFromCitedIds(project, turn.citedNodeIds ?? []);
  const opened = turn.toolCalls?.some((t) => t.name === 'open_sitting' || t.name === 'navigate');
  const raw = opened
    ? fromIds
    : fromIds && (fromIds.kind === 'check' || fromIds.kind === 'scope' || fromIds.kind === 'dd')
      ? fromIds
      : null;
  return sittingWithField(project, raw);
}

/**
 * When chat names a DD, scope, check (field), evidence row, or register title,
 * return the sitting that should open on the right.
 */
/**
 * A subject the text might mean, with how strongly it matched.
 *
 * `confident` is the old behaviour: the whole title appeared, or a quoted
 * phrase, or two distinctive words. `loose` is a near-miss — one stemmed word
 * in common — and exists so that "boundary" produces something to OFFER
 * rather than nothing to say. A loose candidate is never acted on by itself.
 */
export interface TalkCandidate {
  score: number;
  confident: boolean;
  sitting: TalkSitting;
}

/**
 * Everything the text could plausibly mean, best first.
 *
 * This ranking was always computed and all but the winner thrown away, which
 * is why a near-miss became silence and silence became an answer about
 * something else. Callers that want the old single answer still get it from
 * `talkSittingFromText`; callers that need to ask the person which one they
 * meant use this.
 */
export function rankTalkSittings(project: DdProject, text: string, limit = 5): TalkCandidate[] {
  const q = fold(text);
  if (!q || TALK_SKIP.test(q)) return [];
  type Cand = { score: number; confident: boolean; sitting: TalkSitting };
  const cands: Cand[] = [];
  const push = (score: number, sitting: TalkSitting, confident = true) => {
    if (score <= 0) return;
    cands.push({ score: score + KIND_RANK[sitting.kind] / 100, confident, sitting });
  };

  for (const a of project.assessments) {
    for (const s of a.scopes) {
      for (const c of s.checks) {
        const byTitle = titleScore(c.title, text, 5);
        const ev = project.evidence.find((e) => c.expectedEvidence.some((t) => fold(e.title) === fold(t)) || c.evidenceIds.includes(e.id));
        if (byTitle) {
          push(byTitle + 20, checkTalk(a, s, c, ev ? [ev.id] : []));
        } else {
          const loose = looseScore(c.title, text);
          if (loose) push(loose, checkTalk(a, s, c, ev ? [ev.id] : []), false);
        }
        for (const expected of c.expectedEvidence) {
          const n = fold(expected);
          if (n.length >= 5 && q.includes(n)) {
            const ev = project.evidence.find((e) => fold(e.title) === n);
            push(n.length + 18, checkTalk(a, s, c, ev ? [ev.id] : []));
          }
        }
      }
      const sl = SCOPE_LABEL[s.scopeKey];
      const folded = fold(sl);
      const short = folded.length < 8;
      const named =
        q.includes(folded) ||
        (!short && /\bscope\b/.test(q) && folded.split(/[^a-z0-9]+/).some((t) => t.length >= 6 && q.includes(t)));
      if (named && (!short || /\bscope\b|\bchecks?\b/.test(q))) {
        push(Math.max(folded.length, 8) + 10, {
          kind: 'scope',
          extra: { ddId: a.id, scopeId: s.id },
          highlightIds: [s.id, a.id],
          label: sl,
        });
      }
    }
    const nameScore = titleScore(a.name, text, 6);
    if (nameScore) {
      push(nameScore + 8, { kind: 'dd', extra: { ddId: a.id }, highlightIds: [a.id], label: a.name });
    } else {
      const stripped = fold(a.name).replace(/\s+dd(\s+#?\d+.*)?$/, '').trim();
      if (stripped.length >= 6 && q.includes(stripped)) {
        push(stripped.length + 8, { kind: 'dd', extra: { ddId: a.id }, highlightIds: [a.id], label: a.name });
      }
    }
  }

  for (const e of project.evidence) {
    const score = titleScore(e.title, text, 5);
    if (score) {
      const extra: CockpitPathExtra = { evidenceId: e.id };
      const linked = sittingCheckOf(project, { checkId: e.checkIds[0] });
      if (linked) {
        extra.ddId = linked.assessment.id;
        extra.scopeId = linked.scope.id;
        extra.checkId = linked.check.id;
      }
      push(score + 12, { kind: 'evidence', extra, highlightIds: [e.id], label: e.title });
    }
  }
  for (const f of project.findings) {
    const score = titleScore(f.title, text, 6);
    if (score) push(score + 6, { kind: 'finding', extra: { findingId: f.id }, highlightIds: [f.id], label: f.title });
  }
  for (const r of project.risks) {
    const score = titleScore(r.title, text, 6);
    if (score) push(score + 4, { kind: 'risk', extra: { riskId: r.id }, highlightIds: [r.id], label: r.title });
  }
  for (const a of project.actions) {
    const score = titleScore(a.title, text, 6);
    if (score) push(score + 4, { kind: 'action', extra: { actionId: a.id }, highlightIds: [a.id], label: a.title });
  }
  for (const a of project.assets) {
    const score = titleScore(a.name, text, 5);
    if (score) push(score + 3, { kind: 'asset', extra: { assetId: a.id }, highlightIds: [a.id], label: a.name });
  }

  if (!cands.length) return [];
  cands.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: TalkCandidate[] = [];
  for (const row of cands) {
    const key = `${row.sitting.kind}:${JSON.stringify(row.sitting.extra)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The single best CONFIDENT reading, or nothing.
 *
 * Unchanged in behaviour, deliberately: every existing caller acts on what
 * this returns, and a loose candidate is a guess. A guess is something to
 * offer, not something to act on, so loose hits never come out of here — they
 * come out of `rankTalkSittings` and are put to the person by `resolveSubject`.
 */
export function talkSittingFromText(project: DdProject, text: string): TalkSitting | null {
  return rankTalkSittings(project, text, 8).find((row) => row.confident)?.sitting ?? null;
}

export function sittingBrief(project: DdProject, talk: TalkSitting): string {
  if (talk.kind === 'check') {
    const hit = sittingCheckOf(project, talk.extra);
    if (!hit) return `Opened ${talk.label}.`;
    return [
      `${SCOPE_LABEL[hit.scope.scopeKey]} · ${hit.check.title} — ${CHECK_RESULT_LABEL[hit.check.result]}.`,
      hit.check.purpose,
      hit.check.expectedEvidence.length ? `Expected: ${hit.check.expectedEvidence.join(', ')}.` : null,
      'Tick or cross on the right. You close the check — the model does not.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (talk.kind === 'scope') {
    for (const a of project.assessments) {
      const s = a.scopes.find((row) => row.id === talk.extra.scopeId);
      if (!s) continue;
      const pending = s.checks.filter((c) => c.result === 'pending').length;
      return `${SCOPE_LABEL[s.scopeKey]} on ${a.name} is open on the right. ${pending} check(s) still pending.`;
    }
  }
  if (talk.kind === 'dd') {
    const a = project.assessments.find((row) => row.id === talk.extra.ddId);
    if (a) {
      return `${a.name} is open on the right. ${a.scopes.length} scope(s). Open a scope to record a check.`;
    }
  }
  if (talk.kind === 'evidence') {
    const e = project.evidence.find((row) => row.id === talk.extra.evidenceId);
    if (e) {
      const files = e.attachments.length;
      return `Evidence “${e.title}” (${e.status}${files ? `, ${files} file(s)` : ', no file yet'}) is highlighted on the right.`;
    }
  }
  if (talk.kind === 'finding') {
    const f = project.findings.find((row) => row.id === talk.extra.findingId);
    if (f) {
      return `Finding “${f.title}” [${f.severity}] is highlighted. ${f.evidenceIds.length ? `${f.evidenceIds.length} evidence linked.` : 'No evidence linked yet.'}`;
    }
  }
  return `${talk.label} is open on the right.`;
}

function extraHasFocus(extra?: CockpitPathExtra): boolean {
  if (!extra) return false;
  return Boolean(extra.checkId || extra.evidenceId || extra.findingId || extra.riskId || extra.actionId || extra.assetId || (extra.ddId && extra.scopeId));
}

/** Keep an already-specific sitting (Guide me). Fill a generic pane from talk/cites. */
export function withTalkNavigation(
  project: DdProject,
  navigations: Array<{ target: string } & CockpitPathExtra>,
  talk: TalkSitting | null,
): Array<{ target: string } & CockpitPathExtra> {
  const sitting = sittingWithField(project, talk);
  if (!sitting) return navigations;
  const pane = paneForTalk(sitting.kind);
  const opened = { target: pane, ...sitting.extra };
  const last = navigations.at(-1);
  if (!last) return [opened];
  if (extraHasFocus(last) && last.target !== 'overview') return navigations;
  return [...navigations.slice(0, -1), { ...last, ...opened, target: pane }];
}
