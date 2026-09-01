/**
 * Starting work that outlives the request that asked for it.
 *
 * Until now every long operation had to be watched: the orchestrator and the
 * screen ran inside the HTTP request, streaming steps to whoever was holding
 * the connection, and closing the tab ended the work. That is the wrong shape
 * for a diligence file — a screen that takes ninety seconds should be
 * something you start and come back to, not something you supervise.
 *
 * The design is the one the ambient-agent literature settles on, minus the
 * queue infrastructure this product does not need yet: **accept, checkpoint,
 * poll**. The request returns `202` with a run id the moment the work is
 * durably recorded as started; the work then proceeds detached, checkpointing
 * each step into the run journal; the client polls that journal. There is no
 * broker and no worker pool, because there is exactly one process doing the
 * work and the journal is already the shared state.
 *
 * --- Where this genuinely runs, and where it degrades -------------------
 *
 * On a long-lived server — `pnpm start`, `pnpm dev`, a container, the
 * documented single-process deployment — this is simply true: the process
 * keeps running and the run finishes.
 *
 * On serverless the platform may freeze the instance once the response is
 * sent. Where the platform offers a way to say "this work is still mine"
 * (Vercel's `waitUntil`), it is used, and the run finishes normally. Where it
 * does not, the frozen run stops checkpointing and the ledger reads it back
 * as `interrupted` — which is the honest outcome and the reason the ledger
 * derives that state from staleness rather than storing it. The failure is
 * visible, and the person is told to re-issue rather than left waiting on
 * something that will never land.
 *
 * That last property is why background execution was worth building on the
 * ledger rather than before it: without a durable record, a backgrounded run
 * that died would be indistinguishable from one that was never started.
 */

import { beginRun, type RunJournalHandle } from './journal';
import type { DurableRunKind } from '@realytica/shared';

/**
 * The platform's "keep this instance alive" hook, when there is one.
 *
 * Read from the request context Vercel exposes on `globalThis` rather than
 * taken as a dependency: the package that wraps it is a runtime-only concern,
 * and a missing hook must degrade to plain detached execution rather than
 * fail to build. Everything here is defensive — an unexpected shape means no
 * hook, never a throw on a path that is meant to be invisible.
 */
type WaitUntil = (promise: Promise<unknown>) => void;

function platformWaitUntil(): WaitUntil | null {
  try {
    const holder = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')];
    if (!holder || typeof holder !== 'object') return null;
    const get = (holder as { get?: () => unknown }).get;
    if (typeof get !== 'function') return null;
    const context = get.call(holder);
    if (!context || typeof context !== 'object') return null;
    const waitUntil = (context as { waitUntil?: unknown }).waitUntil;
    return typeof waitUntil === 'function' ? (waitUntil as WaitUntil) : null;
  } catch {
    return null;
  }
}

export interface BackgroundStart {
  runId: string;
  /** True when the platform accepted responsibility for the detached work. */
  keptAlive: boolean;
}

/**
 * Begin work in the background and return as soon as it is recorded.
 *
 * `work` receives the journal handle so it can checkpoint its own steps; it
 * must not assume anyone is watching. Its rejection is caught and written to
 * the ledger as a failure — an unhandled rejection in detached work would
 * otherwise take the whole process down and lose every other run with it.
 */
export async function startBackgroundRun(
  projectId: string,
  kind: DurableRunKind,
  meta: { question?: string; actor?: string },
  work: (journal: RunJournalHandle) => Promise<string>,
): Promise<BackgroundStart> {
  // Durable BEFORE the response goes out. If the instance dies one line
  // later, the ledger still shows that this run was asked for.
  const journal = await beginRun(projectId, kind, meta);

  const task = (async () => {
    try {
      const outcome = await work(journal);
      await journal.finish(outcome);
    } catch (err) {
      await journal.fail(err instanceof Error ? err.message : String(err));
    }
  })();

  const waitUntil = platformWaitUntil();
  if (waitUntil) {
    waitUntil(task);
  } else {
    // Nothing is awaiting this promise; swallow so a failure inside it can
    // never surface as an unhandled rejection. The ledger already has it.
    void task.catch(() => undefined);
  }

  return { runId: journal.runId, keptAlive: waitUntil !== null };
}
