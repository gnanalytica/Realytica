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
  runEvalComparison,
  summariseRanking,
  tierFor,
} from '@realytica/agents';
import type { EvalCase, EvalTaskKind } from '@realytica/shared';

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

    for (const line of summariseRanking(rankEvalResults(comparison.results))) console.log(`  ${line}`);
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
}

main().catch(e => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
