import type { AgentKind, PropertyCase, ReferenceData, RetrievalSection, RetrievalSelection, TitleGraph } from '@realytica/shared';
import { segmentCase, type Segment } from './segments';
import { selectSegments } from './select';

export * from './segments';
export * from './select';

/**
 * Graph-backed retrieval: what actually goes in front of a model.
 *
 * The alternative — rendering the whole case into every prompt — has a ceiling
 * that real diligence passes immediately, and it pays that cost once per agent
 * per run. Measured on the seeded cases: ~10,000 tokens of context, times
 * eight agent calls, is ~80,000 input tokens per case before a single document
 * is read closely.
 *
 * Retrieval keeps the cache-stable prefix intact (see `segments.ts` for why
 * trimming it would cost more than it saves), then spends a token budget on
 * the parts that vary — selecting them by adjacency in the title graph where
 * one exists, and by term match where it does not. Everything it drops is
 * recorded in `RetrievalSelection.omitted` and travels back to the caller on
 * `AgentRun.retrieval`, so a thin answer can be traced to a thin context
 * rather than being mistaken for a confident one.
 */

/** Default budget. Above the floor of a seeded Karnataka case, so a small case is unaffected and a large one is bounded. */
export const DEFAULT_RETRIEVAL_BUDGET_TOKENS = 8_000;

/**
 * Cap on corrective re-render passes.
 *
 * Each pass drops the single lowest-ranked droppable section, so the loop
 * terminates on its own once nothing droppable is left. The cap is a
 * backstop against a pathological case, not the mechanism.
 */
const MAX_TRIM_PASSES = 40;

export interface RetrieveParams {
  caseData: PropertyCase;
  refData: ReferenceData;
  agent: AgentKind;
  graph?: TitleGraph;
  /** Free-text focus: the user's question, a risk code, a survey number. */
  focus?: string[];
  focusNodeIds?: string[];
  budgetTokens?: number;
}

export interface RetrievedContext {
  /** The prompt body, in selection order. */
  text: string;
  selection: RetrievalSelection;
}

/** True for sections that may be dropped to meet a budget. */
function isDroppable(section: RetrievalSection): boolean {
  return section.reason !== 'cache-stable prefix'
    && section.reason !== 'required by every agent'
    && !section.reason.startsWith('required by ');
}

function renderBody(kept: Segment[], note: unknown): string {
  // Evidence and documents arrive as one segment each, which is what makes
  // them individually selectable; they are regrouped here so the model sees
  // the familiar `documents: [...]` / `evidence: [...]` shape rather than
  // several hundred sibling keys.
  const body: Record<string, unknown> = {};
  const documents: unknown[] = [];
  const evidence: unknown[] = [];
  for (const seg of kept) {
    if (seg.key.startsWith('document:')) documents.push(seg.value);
    else if (seg.key.startsWith('evidence:')) evidence.push(seg.value);
    else body[seg.key] = seg.value;
  }
  if (documents.length > 0) body.documents = documents;
  if (evidence.length > 0) body.evidence = evidence;
  if (note) body.contextNote = note;
  return JSON.stringify(body, null, 1);
}

/**
 * The note telling the model its context was trimmed.
 *
 * Counts by kind, not a list of labels. An evidence label is a full sentence,
 * so naming every omitted item cost more tokens than some of the sections it
 * was apologising for — the note has to be cheaper than the thing it
 * describes, or it defeats the budget it is reporting on.
 *
 * Stated in the prompt, not merely returned to the caller. A model that can
 * see its own context was trimmed can say "the documents I was given do not
 * answer this", which is principle 4, Uncertainty Must Be Visible. One that
 * cannot will answer from the gap.
 */
function buildNote(omitted: RetrievalSection[], approxTokens: number, budgetTokens: number): unknown {
  if (omitted.length === 0) return null;
  const byKind = new Map<string, number>();
  for (const o of omitted) {
    const kind = o.key.includes(':') ? `${o.key.split(':')[0]}s` : o.key;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  return {
    retrieved: true,
    approxTokens,
    budgetTokens,
    omitted: Object.fromEntries(byKind),
    guidance:
      'This case was summarised to fit a context budget. The counts in `omitted` are sections you were NOT shown. '
      + 'If answering would require one of them, say so rather than inferring it.',
  };
}

export function retrieveCaseContext(params: RetrieveParams): RetrievedContext {
  const { caseData, refData, agent, graph, focus, focusNodeIds } = params;
  const budgetTokens = params.budgetTokens ?? DEFAULT_RETRIEVAL_BUDGET_TOKENS;

  const segments = segmentCase({ caseData, refData, graph });
  const initial = selectSegments({ segments, agent, focus, focusNodeIds, graph, budgetTokens });

  let kept = initial.segments;
  let included = initial.selection.included;
  let omitted = initial.selection.omitted;

  /*
   * Render, measure, trim, repeat.
   *
   * Selection has to work from per-segment estimates, because the text does
   * not exist until selection is finished. Those estimates miss what the
   * assembly itself costs — the body's own keys, the JSON wrapper, the
   * omission note — and a fixed allowance for that is a guess that was
   * measured overshooting by 23 tokens at one budget and under-spending at
   * another. Measuring the real thing and correcting is exact, and it
   * converges in a handful of passes because each one drops exactly one
   * section, lowest-ranked first.
   */
  let text = renderBody(kept, buildNote(omitted, 0, budgetTokens));
  for (let pass = 0; pass < MAX_TRIM_PASSES; pass += 1) {
    const rendered = Math.ceil(text.length / 4);
    if (rendered <= budgetTokens) break;
    // `included` is in selection order, so the last droppable entry is the
    // lowest-ranked thing still in the prompt.
    const dropIndex = included.map(isDroppable).lastIndexOf(true);
    // Nothing left that may be dropped: the irreducible content alone exceeds
    // the budget. Stop and report honestly rather than cutting the verdict out
    // of the prompt to hit a number.
    if (dropIndex === -1) break;
    const dropped = included[dropIndex];
    included = included.filter((_, i) => i !== dropIndex);
    omitted = [...omitted, { ...dropped, reason: 'dropped for budget after measuring the rendered prompt' }];
    kept = kept.filter(s => s.key !== dropped.key);
    text = renderBody(kept, buildNote(omitted, 0, budgetTokens));
  }

  const approxTokens = Math.ceil(text.length / 4);
  // Re-render once with the true figure in the note, so what the model is told
  // about its own context matches what it was actually given.
  text = renderBody(kept, buildNote(omitted, approxTokens, budgetTokens));

  return {
    text,
    selection: {
      ...initial.selection,
      included,
      omitted,
      approxTokens: Math.ceil(text.length / 4),
      budgetTokens,
    },
  };
}

/**
 * The smallest context this agent can be given for this case.
 *
 * Cache-stable, essential and agent-required sections are never dropped, so a
 * budget below their combined size is not achievable and `retrieveCaseContext`
 * will exceed it rather than cut the verdict out of the prompt. Exported so a
 * caller can set a budget it can actually meet, or explain why it cannot. On a
 * Karnataka case this floor is dominated by the state pack, which is
 * deliberately kept whole — see `segments.ts`.
 */
export function retrievalFloorTokens(params: Omit<RetrieveParams, 'budgetTokens' | 'focus' | 'focusNodeIds'>): number {
  const { caseData, refData, agent, graph } = params;
  const segments = segmentCase({ caseData, refData, graph });
  const floor = selectSegments({ segments, agent, graph, budgetTokens: 0 });
  return Math.ceil(renderBody(floor.segments, buildNote(floor.selection.omitted, 0, 0)).length / 4);
}
