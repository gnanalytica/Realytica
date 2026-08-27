/**
 * Run the evaluation corpus against one or more routes.
 *
 * The harness has always been able to score an answer and, until the executor
 * existed, had no way to obtain one — so this is the entry point the 43 cases
 * never had. It is a CLI rather than an API route on purpose: a sweep spends
 * real money proportional to routes x cases, and that is not something a web
 * button should let anyone start.
 *
 *   pnpm eval --routes anthropic:claude-haiku-4-5-20251001,anthropic:claude-sonnet-5
 *   pnpm eval --routes openai_compatible:llama-3.3-70b --task document_extraction
 *   pnpm eval --routes anthropic:claude-haiku-4-5-20251001 --limit 5 --dry-run
 *
 * `--dry-run` assembles the corpus, resolves the routes and reports what a
 * real run would cost in calls, without spending anything. Use it first.
 */
import {
  EVAL_TASK_AGENT,
  buildEvalCases,
  capabilityNeedsFor,
  createProviderEvalExecutor,
  parseEvalRoute,
  rankEvalResults,
  readEnv,
  runEvalComparison,
  summariseRanking,
  tierFor,
} from '@realytica/agents';
import type { EvalCase, EvalRanking, EvalTaskKind } from '@realytica/shared';

const TASKS: EvalTaskKind[] = ['document_extraction', 'grounding', 'proof_routing', 'title_reasoning'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const routeSpecs = (arg('routes') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (routeSpecs.length === 0) {
    console.error('Usage: pnpm eval --routes <provider:model>[,<provider:model>...] [--task <kind>] [--limit N] [--dry-run]');
    console.error(`Tasks: ${TASKS.join(', ')}`);
    process.exit(2);
  }

  const taskArg = arg('task') as EvalTaskKind | undefined;
  if (taskArg && !TASKS.includes(taskArg)) {
    console.error(`Unknown task "${taskArg}". One of: ${TASKS.join(', ')}`);
    process.exit(2);
  }
  const tasks = taskArg ? [taskArg] : TASKS;
  const limit = Number(arg('limit') ?? '0') || undefined;

  // The corpus is built against a fixed date, not the clock, so two runs a
  // week apart compare the same documents. Same reason every other module here
  // injects `now`.
  const corpusAt = arg('corpus-at') ?? '2025-06-01T00:00:00.000Z';
  const all = buildEvalCases({ now: corpusAt });

  const routes = routeSpecs.map(spec => {
    // The tier is only used to report what the route would be asked for, so
    // the agent's own tier for this task is the honest default.
    const route = parseEvalRoute(spec, 'reasoning');
    if (!route) {
      console.error(`Could not parse route "${spec}" — expected provider:model, e.g. anthropic:claude-sonnet-5`);
      process.exit(2);
    }
    return route;
  });

  let totalCalls = 0;
  const byTask: { task: EvalTaskKind; cases: EvalCase[] }[] = tasks.map(task => {
    const cases = all.filter(c => c.kind === task).slice(0, limit ?? undefined);
    totalCalls += cases.length * routes.length;
    return { task, cases };
  });

  console.log(`Corpus built at ${corpusAt}: ${all.length} case(s) total\n`);
  for (const { task, cases } of byTask) {
    const agent = EVAL_TASK_AGENT[task];
    console.log(`  ${task.padEnd(20)} ${String(cases.length).padStart(3)} case(s)  · stands in for ${agent} (tier ${tierFor(agent)})`);
    const needs = capabilityNeedsFor(task);
    if (needs.length > 0) console.log(`  ${''.padEnd(20)} asks for: ${needs.join(', ')}`);
  }
  console.log(`\nRoutes: ${routes.map(r => `${r.provider}:${r.model}`).join(', ')}`);
  console.log(`Model calls a real run would make: ${totalCalls}\n`);

  if (flag('dry-run')) {
    console.log('--dry-run: nothing was spent. Drop the flag to run it.');
    return;
  }

  /*
   * The gate.
   *
   * Until this existed the harness printed a ranking and exited 0 whatever
   * the models scored, which makes it a report rather than a check: a prompt
   * change that halved extraction accuracy passed CI exactly as loudly as one
   * that improved it. A threshold turns the golden set into something a merge
   * can be blocked on.
   *
   * The default is deliberately not 1.0. These cases score partial credit per
   * expectation, and a route that declines to answer where the evidence is
   * absent is behaving correctly while scoring below full marks — a perfect
   * bar would select for confident guessing, which is the opposite of what
   * this product wants.
   */
  const threshold = Number(readEnv('EVAL_THRESHOLD') ?? '0.75');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error(`REALYTICA_EVAL_THRESHOLD must be a number between 0 and 1 — got "${readEnv('EVAL_THRESHOLD')}".`);
    process.exit(2);
  }
  /** Best mean score any route reached on each task, and what dragged it down. */
  const taskBest = new Map<string, { model: string; meanScore: number; fabrications: number }>();

  const execute = createProviderEvalExecutor();
  for (const { task, cases } of byTask) {
    if (cases.length === 0) continue;
    console.log(`\n${'='.repeat(64)}\n${task} — ${cases.length} case(s) x ${routes.length} route(s)\n${'='.repeat(64)}`);
    const comparison = await runEvalComparison({
      taskKind: task,
      routes,
      cases,
      execute,
      now: new Date().toISOString(),
    });

    const ranking = rankEvalResults(comparison.results);
    for (const line of summariseRanking(ranking)) console.log(`  ${line}`);
    // The best route on this task is what the gate judges. A comparison run
    // deliberately includes weak routes; failing the build because a
    // known-cheap model scored badly against a known-good one would make the
    // comparison itself unrunnable in CI.
    const best = ranking.reduce<EvalRanking | null>((a, b) => (a === null || b.meanScore > a.meanScore ? b : a), null);
    if (best) taskBest.set(task, { model: `${best.provider}:${best.model}`, meanScore: best.meanScore, fabrications: best.fabrications });
    if (comparison.skipped.length > 0) {
      // Never silently dropped: a case that could not run is not a case that passed.
      console.log(`\n  ${comparison.skipped.length} case(s) skipped:`);
      for (const s of comparison.skipped) console.log(`    - ${s.evalCaseId}: ${s.reason}`);
    }
    const failures = comparison.results.filter(r => r.error);
    if (failures.length > 0) {
      console.log(`\n  ${failures.length} run(s) errored:`);
      for (const f of failures.slice(0, 5)) console.log(`    - ${f.evalCaseId} on ${f.model}: ${f.error}`);
    }
  }

  if (taskBest.size === 0) {
    console.log('\nNo task produced a ranking — nothing to judge.');
    return;
  }

  console.log(`\n${'='.repeat(64)}\nGate — best route per task against a ${threshold.toFixed(2)} threshold\n${'='.repeat(64)}`);
  const below: string[] = [];
  let fabricationTotal = 0;
  for (const [task, best] of taskBest) {
    const pass = best.meanScore >= threshold;
    fabricationTotal += best.fabrications;
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${task.padEnd(22)} ${best.meanScore.toFixed(3)}  ${best.model}` +
        (best.fabrications > 0 ? `  (${best.fabrications} fabrication${best.fabrications === 1 ? '' : 's'})` : ''),
    );
    if (!pass) below.push(`${task} scored ${best.meanScore.toFixed(3)} on its best route (${best.model})`);
  }

  /*
   * Fabrications are reported loudly but do not fail the run on their own.
   *
   * They are already scored — `scoreEvalCase` treats an invented value as
   * worse than an absent one — so failing separately would double-count. The
   * count is printed because a route that reaches the threshold *while*
   * inventing values is a different problem from one that simply scores low,
   * and the person reading the output needs to be able to tell them apart.
   */
  if (fabricationTotal > 0) {
    console.log(`\n  ${fabricationTotal} fabricated value(s) across the best routes — already reflected in the scores above.`);
  }

  if (below.length > 0) {
    console.error(`\nEval gate failed:\n${below.map(b => `  - ${b}`).join('\n')}`);
    console.error(`\nRaise the routes, or set REALYTICA_EVAL_THRESHOLD deliberately if the bar has moved.`);
    process.exit(1);
  }
  console.log('\nEval gate passed.');
}

main().catch(e => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
