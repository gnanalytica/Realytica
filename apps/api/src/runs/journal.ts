/**
 * Persistence for the durable run ledger — the API half of `run-ledger.ts`.
 *
 * One small document per project (`run-journal.json`, last 20 runs, a few KB)
 * through the same storage adapter as everything else — filesystem locally,
 * Blob on Vercel. Deliberately NOT part of the case store: the store rewrites
 * whole on every mutation, and a checkpoint that re-serialized 700KB per step
 * would make the ledger too expensive to write at the very moments it exists
 * for. Riding the document path also means a deleted project takes its
 * journal with it, through the delete that already exists.
 *
 * Every write is awaited (a fire-and-forget checkpoint is a checkpoint that
 * may not exist — the serverless rule this codebase already lives by) and
 * every failure is swallowed with one warning: the journal records the work,
 * it must never be the reason the work fails. Last-writer-wins on the
 * journal document is accepted for the same reason it is tolerable nowhere
 * else — losing a step record costs an audit line, not case truth.
 */

import { randomUUID } from 'node:crypto';
import {
  upsertRun,
  type DurableRun,
  type DurableRunKind,
  type DurableRunStep,
} from '@realytica/shared';
import { storageAdapter } from '../storage';

const JOURNAL_KEY = 'run-journal.json';

async function readLedger(projectId: string): Promise<DurableRun[]> {
  try {
    const bytes = await storageAdapter.getDocument(projectId, JOURNAL_KEY);
    if (!bytes) return [];
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return Array.isArray(parsed) ? (parsed as DurableRun[]) : [];
  } catch (err) {
    console.warn(`[runs] could not read journal for ${projectId}: ${(err as Error).message}`);
    return [];
  }
}

async function writeLedger(projectId: string, ledger: DurableRun[]): Promise<void> {
  try {
    await storageAdapter.putDocument(projectId, JOURNAL_KEY, Buffer.from(JSON.stringify(ledger, null, 1)), 'application/json');
  } catch (err) {
    console.warn(`[runs] could not write journal for ${projectId}: ${(err as Error).message}`);
  }
}

export interface RunJournalHandle {
  readonly runId: string;
  /** Checkpoint one step. Durable by the time it resolves; never throws. */
  step(kind: string, label: string): Promise<void>;
  finish(outcome: string): Promise<void>;
  fail(outcome: string): Promise<void>;
}

/**
 * Open a run in the journal and return the handle its owner checkpoints
 * through. The `running` record is durable before this resolves — that is
 * the point: a process that dies one step later has still left the evidence
 * that it started.
 */
export async function beginRun(
  projectId: string,
  kind: DurableRunKind,
  meta: { question?: string; actor?: string } = {},
): Promise<RunJournalHandle> {
  const run: DurableRun = {
    id: `run_${randomUUID()}`,
    projectId,
    kind,
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    question: meta.question?.slice(0, 200),
    actor: meta.actor,
    steps: [],
  };

  const persist = async (): Promise<void> => {
    const ledger = await readLedger(projectId);
    await writeLedger(projectId, upsertRun(ledger, run));
  };
  await persist();

  const checkpoint = async (mutate: () => void): Promise<void> => {
    mutate();
    run.updatedAt = new Date().toISOString();
    await persist();
  };

  return {
    runId: run.id,
    step: (stepKind: string, label: string) =>
      checkpoint(() => {
        const step: DurableRunStep = { at: new Date().toISOString(), kind: stepKind, label: label.slice(0, 200) };
        run.steps.push(step);
      }),
    finish: (outcome: string) =>
      checkpoint(() => {
        run.status = 'finished';
        run.outcome = outcome.slice(0, 300);
      }),
    fail: (outcome: string) =>
      checkpoint(() => {
        run.status = 'failed';
        run.outcome = outcome.slice(0, 300);
      }),
  };
}

/** The ledger, newest first. Interrupted state is derived by the caller via `runState`. */
export async function listRuns(projectId: string): Promise<DurableRun[]> {
  return readLedger(projectId);
}
