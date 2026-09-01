import type {
  AgentKind,
  AgentUsage,
  CapabilityGap,
  EvalCase,
  EvalComparison,
  EvalRunResult,
  EvalTaskKind,
  ModelTier,
  ProviderId,
} from '@realytica/shared';
import { AGENT_CAPABILITY_NEEDS } from '../routing';
import { rankEvalResults } from './rank';
import { scoreEvalCase, type EvalAnswer } from './score';

/**
 * Running one task across several routes.
 *
 * --- Why `execute` is injected ----------------------------------------
 *
 * This module never calls a provider. It is handed a callback that takes a
 * case and a route and returns what came back, and that single decision is
 * what makes the harness usable: it runs with no credentials, no network and
 * no cost in a test; it runs against the real agents in production by passing
 * a different callback; and it can replay a recorded transcript to re-score
 * old answers against a corrected corpus without spending anything. The
 * alternative — a runner that knows how to call Anthropic — would be
 * untestable precisely where correctness matters most, and every fix to the
 * scoring rules would cost another full run of real calls to verify.
 *
 * The callback also supplies `durationMs` and `usage`. Timing here would mean
 * reading the clock, and a harness whose output differs between two identical
 * runs cannot settle an argument about which route to ship.
 *
 * --- Why a failed call is not a zero -----------------------------------
 *
 * A crashed call is not a wrong answer. A 529 from a provider, a socket reset
 * or a malformed tool response says something about the transport, not about
 * whether the model can read a khata extract — and scoring it zero would move
 * a route's mean by an amount that has nothing to do with its accuracy, in the
 * direction that looks like inaccuracy. So a failed run records its error, is
 * excluded from that route's mean, and stays in `results` where it is
 * countable. What it does *not* get excused from is its cost: the tokens were
 * billed, so the spend still lands in the ranking, and a route that fails
 * often and bills for it correctly reads as poor value.
 *
 * --- Why nothing is dropped silently -----------------------------------
 *
 * A case that could not be run at all goes in `skipped` with a reason. An eval
 * that quietly runs 34 of 41 cases and reports a mean over the 34 is worse
 * than one that fails, because the number it produces looks exactly like the
 * number it should have produced.
 */

/** One provider/model pair under test, with the tier the comparison is deciding for. */
export interface EvalRoute {
  provider: ProviderId;
  model: string;
  /**
   * The tier this route is a candidate for.
   *
   * Carried because the question is never "is this model good" but "is this
   * model good enough for extraction / reasoning / judgment", and the answer
   * differs by tier for the same model at the same score.
   */
  tier: ModelTier;
}

/** What the injected executor is asked. */
export interface EvalExecutionRequest {
  evalCase: EvalCase;
  route: EvalRoute;
}

/**
 * What the injected executor returns.
 *
 * `error` and `answer` are both optional and both may be present: a call that
 * degraded, returned partial fields and then failed has said something worth
 * recording. When `error` is set the run is treated as failed regardless of
 * what else came back — a partial answer scored as if complete would be a
 * quiet zero on every field the call never reached.
 */
export interface EvalExecution {
  answer?: EvalAnswer;
  usage?: AgentUsage;
  durationMs?: number;
  capabilityGaps?: CapabilityGap[];
  error?: string;
}

export type EvalExecutor = (request: EvalExecutionRequest) => Promise<EvalExecution> | EvalExecution;

export interface RunEvalComparisonParams {
  taskKind: EvalTaskKind;
  routes: EvalRoute[];
  cases: EvalCase[];
  execute: EvalExecutor;
  /** ISO timestamp for `startedAt`. Injected, like everywhere else in this codebase. */
  now: string;
  /** Comparison id. Defaults to a deterministic one derived from the task and timestamp. */
  id?: string;
  /**
   * How many times to run each (route, case) pair. Default 1 — the historical
   * behaviour, and the cheap one.
   *
   * More than one attempt is how flakiness becomes measurable. A route can
   * pass half the corpus at one attempt and look identical to a route that
   * passes the same half every single time; τ-bench measured exactly this
   * (pass ~50% once, ~25% at pass^8). Attempts multiply spend — routes ×
   * cases × attempts — so the CLI's dry-run reports the product before a
   * token moves.
   */
  attempts?: number;
}

const ZERO_USAGE: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };

/**
 * Which agent each task kind stands in for.
 *
 * Used to report what a route on this task would be asked for
 * (`capabilityNeedsFor`), so a comparison can be sanity-checked against a
 * provider's declared capabilities before a token is spent — pitting a
 * citation-less provider against a citation-carrying one on document
 * extraction is a fair comparison of two products but a misleading one of two
 * models, and the gap belongs in the record either way.
 */
export const EVAL_TASK_AGENT: Record<EvalTaskKind, AgentKind> = {
  document_extraction: 'document_intelligence',
  grounding: 'critic',
  proof_routing: 'proof_pathways',
  title_reasoning: 'title_graph',
};

/** Capabilities a route will be asked for on this task kind. */
export function capabilityNeedsFor(taskKind: EvalTaskKind): CapabilityGap[] {
  return AGENT_CAPABILITY_NEEDS[EVAL_TASK_AGENT[taskKind]] ?? [];
}

/**
 * A route from a model name. Passed through verbatim, slashes and colons
 * included, because a proxy's model names are its own — `llama3.3:70b` and
 * `anthropic/claude-sonnet-4.5:beta` are both single names, not structure.
 */
export function parseEvalRoute(spec: string, tier: ModelTier): EvalRoute | null {
  const model = spec.trim();
  return model ? { provider: 'anthropic', model, tier } : null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * The comparison's end timestamp, reconstructed from the work it did.
 *
 * This module has no clock by construction, so it cannot observe when it
 * finished. The sum of the durations it was told about is exact for a
 * sequential run, which is what this is, and it keeps `finishedAt` honest
 * rather than copying `startedAt` and implying the comparison took no time.
 */
function reconstructFinishedAt(startedAt: string, totalDurationMs: number): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return startedAt;
  return new Date(started + totalDurationMs).toISOString();
}

/**
 * Run every case against every route.
 *
 * Sequential, deliberately. A concurrency-limited fan-out would make the order
 * of `results` depend on scheduling, and two runs of the same comparison would
 * differ in a diff without differing in substance — which is exactly the kind
 * of noise that makes people stop trusting a harness. Routes are the outer
 * loop so results group by route in the order the caller listed them.
 */
export async function runEvalComparison(params: RunEvalComparisonParams): Promise<EvalComparison> {
  const { taskKind, routes, cases, execute, now } = params;
  const attempts = Math.max(1, Math.floor(params.attempts ?? 1));

  const skipped: { evalCaseId: string; reason: string }[] = [];
  const runnable: EvalCase[] = [];
  const seenIds = new Set<string>();

  for (const evalCase of cases) {
    if (evalCase.kind !== taskKind) {
      skipped.push({ evalCaseId: evalCase.id, reason: `Case is a ${evalCase.kind} case; this comparison measures ${taskKind}.` });
      continue;
    }
    if (evalCase.expectations.length === 0) {
      skipped.push({ evalCaseId: evalCase.id, reason: 'Case declares no expectations, so nothing about it could be right or wrong.' });
      continue;
    }
    if (seenIds.has(evalCase.id)) {
      // Two cases under one id would silently overwrite each other in any
      // per-case view, and the second one's score would be attributed to the
      // first one's document.
      skipped.push({ evalCaseId: evalCase.id, reason: 'Duplicate case id in the supplied corpus; only the first occurrence was run.' });
      continue;
    }
    seenIds.add(evalCase.id);
    runnable.push(evalCase);
  }

  if (routes.length === 0) {
    for (const evalCase of runnable) {
      skipped.push({ evalCaseId: evalCase.id, reason: 'No routes were supplied to compare.' });
    }
  }

  const results: EvalRunResult[] = [];

  for (const route of routes) {
    for (const evalCase of runnable) {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let execution: EvalExecution;
      try {
        execution = await execute({ evalCase, route });
      } catch (error) {
        // A throw and a returned `error` are the same event as far as the
        // record is concerned; catching here means one bad case cannot end
        // the comparison and lose every result already gathered.
        execution = { error: describeError(error) };
      }

      const usage = execution.usage ?? ZERO_USAGE;
      const durationMs = execution.durationMs ?? 0;
      const capabilityGaps = execution.capabilityGaps ?? [];

      if (execution.error) {
        results.push({
          evalCaseId: evalCase.id,
          provider: route.provider,
          model: route.model,
          tier: route.tier,
          usage,
          durationMs,
          capabilityGaps,
          error: execution.error,
          attempt,
        });
        continue;
      }

      results.push({
        evalCaseId: evalCase.id,
        provider: route.provider,
        model: route.model,
        tier: route.tier,
        score: scoreEvalCase(evalCase, execution.answer ?? {}),
        usage,
        durationMs,
        capabilityGaps,
        attempt,
      });
      }
    }
  }

  const totalDurationMs = results.reduce((total, result) => total + result.durationMs, 0);

  return {
    id: params.id ?? `eval:${taskKind}:${now}`,
    taskKind,
    startedAt: now,
    finishedAt: reconstructFinishedAt(now, totalDurationMs),
    routes: routes.map(route => ({ provider: route.provider, model: route.model })),
    results,
    ranking: rankEvalResults(results),
    skipped,
  };
}
