/**
 * The daily review of every project's file, for the daily timer.
 *
 * `fileSweep(now)` goes through the projects in work that have moved since
 * they were last reviewed. For each it runs the four rules code works out
 * by itself (`sweepRuleFindings`), then, where a model is set up, hands the
 * model a brief (`sweepBrief`) and takes its nominations: a kind and the
 * marks of the lines it read, kept only where every mark is a line of that
 * brief and code can work out what is claimed. What is new is stored as
 * suggestions for a lead or signer to accept or dismiss. No sentence of a
 * model's is stored. Nobody is told of a suggestion, and nothing is written
 * on a project: what the review keeps is a file of its own beside the
 * project's (`file-sweep.json`), read and written whole.
 *
 * Safe to call twice: a project reviewed today is not reviewed again today,
 * and a matter already open, accepted or dismissed is not raised again. One
 * project failing leaves the rest of the run to finish. With no model set
 * up the rules still run, and the counts say no model was asked.
 *
 * What it may spend is bounded three ways, each a named constant: tokens a
 * project a day, tokens a day over every project, and how long one run may
 * go on starting reviews. A review is charged before it is known to have
 * worked: a model that did not answer is charged what the call was taken to
 * cost, so a project that keeps failing stops being retried when its day's
 * tokens are gone. A project left out for any of the three is still due,
 * and the next run takes the one reviewed longest ago first.
 */

import { sweepBrief, sweepBriefText, sweepDue, sweepNominationsHeld, sweepRaise, sweepRuleFindings, sweepStateOf, sweepTokensOn, type DdProject, type FileSweepState } from '@realytica/shared';
import { crossCheckFileByModel, fileSweepModelSetUp, fileSweepTokensAhead } from '@realytica/agents';
import { store } from '../store';
import { storageAdapter } from '../storage';

/** The most tokens the review may spend on one project in a day, failed tries included. */
export const SWEEP_TOKENS_PER_PROJECT_PER_DAY = 40_000;

/** The most tokens the review may spend in a day, over every project. */
export const SWEEP_TOKENS_PER_DAY = 600_000;

/** How long one run goes on starting reviews. The timer's request has other work to do in the time the platform gives it. */
export const SWEEP_RUN_LIMIT_MS = 5 * 60_000;

/** Where a project keeps what the daily review raised, and when it last looked. */
export const SWEEP_KEY = 'file-sweep.json';

/** What the review keeps for a project. Nothing kept is a project never reviewed. Throws when storage did not answer. */
export async function readSweepState(projectId: string): Promise<FileSweepState> {
  const bytes = await storageAdapter.getDocument(projectId, SWEEP_KEY);
  if (!bytes) return sweepStateOf(undefined);
  try {
    return sweepStateOf(JSON.parse(bytes.toString('utf-8')));
  } catch {
    // Kept, and not readable: taking it for empty would forget every dismissal the next time it is written.
    throw new Error('what the daily review keeps could not be read');
  }
}

export async function writeSweepState(projectId: string, state: FileSweepState): Promise<void> {
  await storageAdapter.putDocument(projectId, SWEEP_KEY, Buffer.from(JSON.stringify(state)), 'application/json');
}

/** What a run reads projects from, keeps its suggestions in and asks: the store and a model, or stand-ins under test. */
export interface FileSweepSource {
  ids(): string[];
  /** The project as storage has it now. Throws when storage did not answer. */
  fresh(id: string): Promise<DdProject | undefined>;
  /** What the review keeps for the project. Throws when storage did not answer. */
  read(projectId: string): Promise<FileSweepState>;
  write(projectId: string, state: FileSweepState): Promise<void>;
  modelSetUp(): boolean;
  /** What asking about this brief is taken to cost, in tokens, before it is asked. */
  ahead(brief: string): number;
  /** The model's proposals and what the call used. Null when no model answered. */
  ask(input: { brief: string; caseId: string }): Promise<{ proposals: unknown[]; tokens: number } | null>;
  /** The clock a run's length is measured by. */
  clock(): number;
}

const fromStore: FileSweepSource = {
  ids: () => (store.data.projects ?? []).map((project) => project.id),
  fresh: async (id) => {
    await store.pullFresh(id);
    return store.data.projects?.find((project) => project.id === id);
  },
  read: readSweepState,
  write: writeSweepState,
  modelSetUp: fileSweepModelSetUp,
  ahead: fileSweepTokensAhead,
  ask: crossCheckFileByModel,
  clock: Date.now,
};

export interface FileSweepRun extends Record<string, number> {
  projects: number;
  /** In work, moved since their last review, and not reviewed today. */
  due: number;
  /** Reviewed in this run: by the rules, and by a model where one is set up and the day's tokens allow. */
  swept: number;
  /** New suggestions the rules raised, among `raised`. */
  byRule: number;
  /** New suggestions stored. */
  raised: number;
  /** Proposals thrown away: a line cited that is not in the brief, or no line at all. */
  dropped: number;
  /** Proposals about a matter already open, accepted or dismissed. */
  repeats: number;
  /** Projects left for another day because a token ceiling would be passed. */
  overCeiling: number;
  /** Projects left for the next run because this one had gone on long enough. */
  deferred: number;
  failed: number;
  tokens: number;
  /** 1 when no model is set up: the rules ran, and no model was asked. */
  noModel: number;
}

/** Review every project that is due, as of `now`. */
export async function fileSweep(now: Date, source: FileSweepSource = fromStore): Promise<FileSweepRun> {
  const out: FileSweepRun = { projects: 0, due: 0, swept: 0, byRule: 0, raised: 0, dropped: 0, repeats: 0, overCeiling: 0, deferred: 0, failed: 0, tokens: 0, noModel: 0 };
  const ids = source.ids();
  out.projects = ids.length;
  const model = source.modelSetUp();
  if (!model) out.noModel = 1;
  const at = now.toISOString();
  const today = at.slice(0, 10);
  const began = source.clock();

  // First what is due, and what today has cost already: a second run on one day counts the first run's tokens.
  const due: Array<{ project: DdProject; state: FileSweepState }> = [];
  let spent = 0;
  for (const id of ids) {
    try {
      const project = await source.fresh(id);
      if (!project) continue;
      const state = await source.read(id);
      spent += sweepTokensOn(state, today);
      if (sweepDue(project, state, now)) due.push({ project, state });
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] daily review could not read ${id}: ${(err as Error).message}`);
    }
  }
  out.due = due.length;
  // The one reviewed longest ago first, and one never reviewed before any: a run that stops early starves nobody.
  due.sort((a, b) => (a.state.sweptAt ?? '').localeCompare(b.state.sweptAt ?? ''));

  for (const { project, state } of due) {
    if (source.clock() - began > SWEEP_RUN_LIMIT_MS) {
      out.deferred += 1;
      continue;
    }
    try {
      const through = project.updatedAt;
      // The rules first: they cost nothing, need no model, and a model's nomination of the same matter is then a repeat.
      const ruled = sweepRuleFindings(project, now);
      const brief = sweepBrief(project, { now, ...(state.sweptAt ? { since: state.sweptAt } : {}) });
      const text = sweepBriefText(brief);
      const ahead = source.ahead(text);
      const over = model && (sweepTokensOn(state, today) + ahead > SWEEP_TOKENS_PER_PROJECT_PER_DAY || spent + ahead > SWEEP_TOKENS_PER_DAY);
      const said = model && !over ? await source.ask({ brief: text, caseId: project.id }) : null;
      const used = model && !over ? (said?.tokens ?? ahead) : 0;
      spent += used;
      out.tokens += used;
      // Read again: a model takes a while, and a person may have accepted or dismissed something meanwhile.
      const kept = await source.read(project.id);
      if (used) {
        kept.tokens = sweepTokensOn(kept, today) + used;
        kept.day = today;
      }
      const rules = sweepRaise(kept, ruled, at);
      out.byRule += rules.raised.length;
      out.raised += rules.raised.length;
      out.repeats += rules.repeats + rules.dismissedBefore;
      if (over || (model && !said)) {
        // The rules' part is kept. The project stays due, so a model is asked on a later run.
        await source.write(project.id, kept);
        if (over) out.overCeiling += 1;
        else out.failed += 1;
        continue;
      }
      const held = sweepNominationsHeld(project, brief, said?.proposals ?? []);
      const raised = sweepRaise(kept, held.kept, at);
      kept.sweptAt = at;
      kept.sweptThrough = through;
      await source.write(project.id, kept);
      out.swept += 1;
      out.raised += raised.raised.length;
      out.dropped += held.dropped;
      out.repeats += raised.repeats + raised.dismissedBefore;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] daily review of ${project.id}: ${(err as Error).message}`);
    }
  }
  return out;
}
