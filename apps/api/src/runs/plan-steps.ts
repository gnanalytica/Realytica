/**
 * The steps of a plan: what each would touch, and how each is carried out.
 *
 * A step is one of a fixed list of kinds (`PLAN_STEP_KINDS`), and each kind
 * is carried out here by the very code that carries it out when a person
 * asks for it alone. Nothing is rebuilt:
 *
 *   read_filed       the reader's own reading of papers on the register
 *                    (`readOntoRegister`), a few papers at a go
 *   accept_raised    the chat's own acceptance of cards by their ids
 *   suggest_answers  the questionnaire's own suggestions from the file
 *   write_report     the chat's own sentence for a report or the status
 *   keep_meeting     the chat's own keeping of notes it was holding
 *   run_playbook     the review table's own run, paper by paper
 *
 * So a step changes the record exactly as far as that code does. What a
 * paper states still waits on its row, an answer still waits on its
 * question, a report that needs a card still gets a card. A step that
 * accepts takes the cards the plan named when it was made and no other, and
 * of those only the read values the person carrying it out may decide
 * (`PlanSetting.mayDecide`).
 *
 * A step that works through many records does a few, saves, says how far it
 * has got, and asks whether to go on (`mustEnd`): that is where a plan stops
 * when a person stops it, with what it did kept. How far it has got is said
 * to the ledger after each record and not only after each few, so a run that
 * is slow is never taken for one that died.
 */

import { agentCapability, reviewModelSetUp } from '@realytica/agents';
import {
  ADMIN_ONLY_PROPOSALS,
  CHOICE_SENTENCE,
  MEETING_IS_NOTES,
  REPORT_KIND_LABEL,
  applyProjectChat,
  cardSays,
  currentTurnProposals,
  documentWorkstream,
  functionDepartment,
  functionKey,
  keepReviewAnswers,
  meetingAskedNow,
  planPlaceOf,
  planStepLabel,
  plural,
  proposedFacts,
  reportKindRequested,
  reviewRows,
  reviewRunPlan,
  reviewTableOf,
  runReviewLibraryItem,
  startReviewRun,
  statusPeriodAsked,
  stopReviewRun,
  suggestFromFile,
  type ChatPlace,
  type ChatProposal,
  type ChatSitting,
  type DdProject,
  type EvidenceRecord,
  type MayDecide,
  type PlanStep,
  type PlanWant,
  type ProjectChatTurn,
  type ReviewLibraryItem,
  type ReviewQuestionColumn,
} from '@realytica/shared';
import { randomUUID } from 'node:crypto';
import { keepPageTexts } from '../documents/page-text';
import { readOntoRegister, type RegisterUpload } from '../documents/register-read';
import { rowsToRead } from '../documents/reread';
import { meetingTurn } from '../meetings';
import { answersFor, loadReviewLibrary } from '../routes/review-table';
import { wordStatusReport } from '../status-report';
import { storageAdapter } from '../storage';
import { store } from '../store';

/** Who is asking, and where: what a step is counted and carried out for. */
export interface PlanSetting {
  project: DdProject;
  actor: string;
  /**
   * Where that person leads or signs on this project. A step that accepts
   * takes the read values of those departments and leaves the rest waiting, as
   * the chat does when they ask it themselves. It is the person carrying the
   * plan out who is asked, so a plan a colleague laid out decides no more for
   * them than they may decide.
   */
  mayDecide: MayDecide;
  /** The workspace, whose saved playbooks a step may name. */
  tenantId: string;
  /** The chat it was asked in: "what the last reply raised" is that chat's last reply. */
  chat?: ChatSitting;
  /** The page the person is on. */
  place?: ChatPlace;
  now?: Date;
}

/** How many papers a reading step takes at one go, before it saves and asks whether to go on. */
export const PLAN_READ_AT_ONCE = 5;

/* ==================================================================== */
/* What a step would touch                                                */
/* ==================================================================== */

/** Whether a paper belongs to the page of the menu a step is narrowed to. A step that is not narrowed takes every paper. */
function inPlace(project: DdProject, row: EvidenceRecord, step: Pick<PlanStep, 'fn' | 'department'>): boolean {
  if (!step.fn && !step.department) return true;
  const workstream = documentWorkstream(project, row);
  const fn = workstream ? functionKey(workstream) : undefined;
  if (step.fn) return fn === step.fn;
  return fn !== undefined && functionDepartment(fn) === step.department;
}

/** The filed papers a reading step would read: the reader's own choice of them, narrowed where the step is. */
function papersToRead(project: DdProject, step: Pick<PlanStep, 'again' | 'fn' | 'department'>): EvidenceRecord[] {
  return rowsToRead(project, step.again === true, agentCapability().available).filter((row) => inPlace(project, row, step));
}

/** The questionnaires with a question nobody has answered and nothing has been suggested for. */
function questionnairesOpen(project: DdProject): Array<{ id: string; open: number }> {
  return (project.questionnaires ?? []).map((sheet) => ({ id: sheet.id, open: sheet.questions.filter((question) => !question.answer).length })).filter((sheet) => sheet.open > 0);
}

/** The playbook some words name: the one whose name has every word given, or the only one there is when none is named. */
function playbookNamed(items: readonly ReviewLibraryItem[], words: string | undefined): Extract<ReviewLibraryItem, { kind: 'playbook' }> | undefined {
  const playbooks = items.filter((item): item is Extract<ReviewLibraryItem, { kind: 'playbook' }> => item.kind === 'playbook');
  const said = (words ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!said.length) return playbooks.length === 1 ? playbooks[0] : undefined;
  const named = playbooks.filter((item) => said.every((word) => item.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(word)));
  return named.length === 1 ? named[0] : undefined;
}

/** The papers a playbook would be run on: its own kind of paper, narrowed where the step is. */
function papersForPlaybook(project: DdProject, item: { paper?: string }, step: Pick<PlanStep, 'fn' | 'department'>): EvidenceRecord[] {
  return reviewRows(project, item.paper ? { by: 'kind', kind: item.paper } : { by: 'all' }).filter((row) => inPlace(project, row, step));
}

/**
 * The steps some wants come to on this project: each with what it would
 * touch, counted now. A want that would touch nothing is no step, and is
 * given back with the reason (`nothing`), so a plan never shows a step that
 * would do nothing.
 */
export async function planStepsFor(setting: PlanSetting, wants: readonly PlanWant[]): Promise<{ steps: PlanStep[]; nothing: string[] }> {
  const { project } = setting;
  const steps: PlanStep[] = [];
  const nothing: string[] = [];
  const add = (step: Omit<PlanStep, 'id' | 'label' | 'state'>): void => {
    steps.push({ id: `stp_${randomUUID().slice(0, 8)}`, label: planStepLabel(step), state: 'to_do', ...step });
  };
  let library: readonly ReviewLibraryItem[] | undefined;

  for (const want of wants) {
    // Where a step is narrowed to a page of the menu, the words must name one: it is never narrowed by a guess, and never widened to everything.
    const place = want.only ? planPlaceOf(want.only) : {};
    if (!place) {
      nothing.push(`“${want.said}”: I could not tell which papers “${want.only}” are. Name a page of the menu, like “the title papers”.`);
      continue;
    }
    if (want.kind === 'read_filed') {
      const count = papersToRead(project, { ...place, again: want.again }).length;
      if (count) add({ kind: 'read_filed', count, ...place, ...(want.again ? { again: true } : {}) });
      else nothing.push(want.again ? 'No filed paper is there to read again.' : 'No filed paper is left to read.');
    } else if (want.kind === 'accept_raised') {
      const cards = (want.form === 'open' ? project.chatProposals.filter((card) => card.status === 'proposed') : currentTurnProposals(project, setting.chat)).filter((card) => !ADMIN_ONLY_PROPOSALS.has(card.kind));
      if (cards.length) add({ kind: 'accept_raised', count: cards.length, form: want.form ?? 'last', proposalIds: cards.map((card) => card.id) });
      else nothing.push(want.form === 'open' ? 'Nothing is waiting on a card.' : 'The last reply raised nothing that is still waiting.');
    } else if (want.kind === 'suggest_answers') {
      const open = questionnairesOpen(project);
      if (open.length) add({ kind: 'suggest_answers', count: open.reduce((sum, sheet) => sum + sheet.open, 0), questionnaireIds: open.map((sheet) => sheet.id) });
      else nothing.push((project.questionnaires ?? []).length ? 'No questionnaire has a question left open.' : 'No questionnaire is on this file.');
    } else if (want.kind === 'write_report') {
      if (want.report === 'status') {
        const asked = statusPeriodAsked(project, want.said, setting.now);
        add({ kind: 'write_report', count: 1, report: 'status', period: asked.period, ...(asked.audience ? { audience: asked.audience } : {}), sentence: want.said });
      } else {
        const report = want.report ?? 'executive_dd';
        // The sentence that asks for that report when typed alone: the person's own where it reads as that, else the plain one.
        const sentence = reportKindRequested(want.said) === report ? want.said : `Generate the ${REPORT_KIND_LABEL[report]}`;
        add({ kind: 'write_report', count: 1, report, sentence });
      }
    } else if (want.kind === 'keep_meeting') {
      const held = meetingAskedNow(project);
      if (held) add({ kind: 'keep_meeting', count: 1, meetingId: held.id });
      else nothing.push('The chat is holding no notes to keep. Paste a meeting’s notes, or drop them as a file.');
    } else {
      library ??= await loadReviewLibrary(setting.tenantId).then((kept) => kept.items).catch(() => []);
      const item = playbookNamed(library, want.playbook);
      if (!item) {
        nothing.push(want.playbook ? `No saved playbook is called “${want.playbook}”.` : 'Say which saved playbook to run, by its name.');
        continue;
      }
      const count = papersForPlaybook(project, item, place).length;
      if (count) add({ kind: 'run_playbook', count, ...place, playbookId: item.id, playbookName: item.name });
      else nothing.push(`No paper on the file is one the playbook “${item.name}” is for.`);
    }
  }
  return { steps, nothing };
}

/**
 * A step counted again and narrowed to a page of the menu, or nothing when
 * the step is not one that works through papers. Used when a person narrows
 * a plan that is shown.
 */
export async function planStepNarrowed(setting: PlanSetting, step: PlanStep, place: { fn?: string; department?: string }): Promise<PlanStep | undefined> {
  if (step.kind !== 'read_filed' && step.kind !== 'run_playbook') return undefined;
  const { fn: _fn, department: _department, ...rest } = step;
  const next = { ...rest, ...place };
  const count =
    step.kind === 'read_filed'
      ? papersToRead(setting.project, next).length
      : await loadReviewLibrary(setting.tenantId)
          .then((kept) => kept.items.find((item) => item.id === step.playbookId))
          .then((item) => (item?.kind === 'playbook' ? papersForPlaybook(setting.project, item, next).length : 0))
          .catch(() => 0);
  return { ...next, count, label: planStepLabel({ ...next, count }) };
}

/* ==================================================================== */
/* Carrying a step out                                                    */
/* ==================================================================== */

export interface StepRun extends PlanSetting {
  step: PlanStep;
  /** True once a person has asked the plan to stop, or its time for one go is spent. A step ends after what it has in hand. */
  mustEnd: () => Promise<boolean>;
  /** How far the step has got: kept as it goes, so a run that is cut short says so. */
  progress: (did: number) => Promise<void>;
  /** The turns a step leaves in the thread, to be marked as the plan's. */
  wrote: (turns: readonly ProjectChatTurn[]) => void;
}

export interface StepDone {
  /** What it did, in one line. */
  said: string;
  /** How many records it got through. */
  did: number;
  /** False when it ended early because it was told to: the rest of it is left. */
  complete: boolean;
}

/** A paper saved the moment it is read, as the reader saves one: its pages beside its file, and its row on the record. */
async function savedAsRead(project: DdProject, file: Parameters<typeof keepPageTexts>[1][number]): Promise<void> {
  await keepPageTexts(project.id, [file]);
  project.updatedAt = new Date().toISOString();
  await store.save();
}

/**
 * One card a value. The reader raises a card for what each paper it reads
 * states, and a paper read again states what it stated before. A card this
 * go raised that says what one already waiting says is taken off again, and
 * the reading's own line lists the one that waits in its place.
 */
function oneCardAValue(project: DdProject, waiting: readonly ChatProposal[], said: readonly ProjectChatTurn[]): void {
  const held = new Map(waiting.map((card) => [cardSays(card), card.id]));
  const before = new Set(held.values());
  const twice = new Map(project.chatProposals.filter((card) => card.status === 'proposed' && !before.has(card.id) && held.has(cardSays(card))).map((card) => [card.id, held.get(cardSays(card))!]));
  if (!twice.size) return;
  project.chatProposals = project.chatProposals.filter((card) => !twice.has(card.id));
  for (const turn of said) if (turn.proposalIds) turn.proposalIds = [...new Set(turn.proposalIds.map((id) => twice.get(id) ?? id))];
}

async function readFiled(run: StepRun): Promise<StepDone> {
  const { project, step, actor } = run;
  /** The papers this step has read, in this go and any before it. */
  const read = new Set<string>(step.readIds ?? []);
  /** The papers handed to the reader in this go, and those read before it. Each is handed once: one it could not read is left for the next go, not read twice. */
  const handed = new Set<string>(read);
  let unread = 0;
  const said = (complete: boolean): StepDone => {
    const waiting = project.evidence.filter((row) => read.has(row.id)).reduce((sum, row) => sum + proposedFacts(row).length, 0);
    return {
      said: `Read ${plural(read.size, 'filed paper')}${unread > 0 ? `; ${unread} could not be read` : ''}. ${waiting ? `${plural(waiting, 'value')} ${waiting === 1 ? 'waits' : 'wait'} on ${read.size === 1 ? 'it' : 'them'} to be accepted.` : 'Nothing they state is waiting.'}`,
      did: read.size,
      complete,
    };
  };
  for (;;) {
    // The file may have moved while a batch was read: the next batch is chosen from it as it stands.
    await store.syncProject(project.id, { force: true });
    const rows = papersToRead(project, step).filter((row) => !handed.has(row.id));
    if (!rows.length) return said(true);
    if (await run.mustEnd()) return said(false);
    const uploads: RegisterUpload[] = [];
    for (const row of rows.slice(0, PLAN_READ_AT_ONCE)) {
      handed.add(row.id);
      const file = row.attachments[row.attachments.length - 1]!;
      const buffer = await storageAdapter.getDocument(project.id, file.storageKey).catch(() => null);
      if (buffer) uploads.push({ evidenceId: row.id, buffer, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes || buffer.length, storageKey: file.storageKey });
      else unread += 1;
    }
    if (uploads.length) {
      const before = project.conversation.length;
      const waiting = project.chatProposals.filter((card) => card.status === 'proposed');
      let landed = 0;
      await readOntoRegister(project, uploads, actor, {
        landed: async (file) => {
          await savedAsRead(project, file);
          // Said to the ledger as each paper lands, so a batch of slow papers is not taken for a run that died.
          landed += 1;
          await run.progress(read.size + landed);
        },
      }).catch(() => undefined);
      oneCardAValue(project, waiting, project.conversation.slice(before));
      run.wrote(project.conversation.slice(before));
      // Read means the reader put a reading on its row: it is no longer among the papers nothing has been read off.
      const still = new Set(rowsToRead(project, false).map((row) => row.id));
      for (const upload of uploads) {
        if (still.has(upload.evidenceId)) unread += 1;
        else read.add(upload.evidenceId);
      }
      project.updatedAt = new Date().toISOString();
      await store.save();
    }
    // Kept on the step as it goes, so a go that is stopped or cut short is taken up from here.
    step.readIds = [...read];
    await run.progress(read.size);
  }
}

function acceptRaised(run: StepRun): StepDone {
  const { project, step, actor } = run;
  // Only the cards the plan named, and of those only what still waits: nothing a step before this one raised is among them.
  const ids = (step.proposalIds ?? []).filter((id) => project.chatProposals.some((card) => card.id === id && card.status === 'proposed'));
  if (!ids.length) return { said: 'Nothing it named is still waiting, so nothing was accepted.', did: 0, complete: true };
  const result = applyProjectChat(project, CHOICE_SENTENCE.all, { actor, mayDecide: run.mayDecide, chat: run.chat, place: run.place, sitting: { decision: 'accept', proposalIds: ids } });
  run.wrote([result.userTurn, result.assistantTurn]);
  const accepted = ids.filter((id) => project.chatProposals.some((card) => card.id === id && card.status === 'committed')).length;
  return { said: `Accepted ${accepted} of the ${plural(ids.length, 'thing')} it named.${accepted < ids.length ? ' The rest could not be accepted here and still wait.' : ''}`, did: accepted, complete: true };
}

function suggestAnswers(run: StepRun): StepDone {
  const { project, step, actor } = run;
  let suggested = 0;
  for (const id of step.questionnaireIds ?? []) {
    try {
      suggested += suggestFromFile(project, id, actor);
    } catch {
      // A questionnaire taken off the file since the plan was made has nothing to suggest for.
    }
  }
  const open = questionnairesOpen(project).reduce((sum, sheet) => sum + sheet.open, 0);
  return {
    said: `Suggested answers to ${plural(suggested, 'question')} from what stands on the file. ${suggested ? 'Each waits on its question for you. ' : ''}${open ? `${plural(open, 'question')} ${open === 1 ? 'is' : 'are'} still open.` : 'No question is left open.'}`,
    did: suggested,
    complete: true,
  };
}

/** A step the chat carries out by a sentence: said to the chat's own rules, which do the rest. */
async function bySentence(run: StepRun, sentence: string): Promise<StepDone> {
  const { project, step, actor } = run;
  const result = applyProjectChat(project, sentence, { actor, mayDecide: run.mayDecide, chat: run.chat, place: run.place, modelReader: agentCapability().available });
  run.wrote([result.userTurn, result.assistantTurn]);
  // A status report just written is put in plainer words where a model is set up, as it is when asked for alone.
  const wrote = result.commands.includes('Wrote a status report') ? result.navigations.find((go) => go.target === 'reports')?.item : undefined;
  if (wrote && agentCapability().available) await wordStatusReport(project, wrote);
  return { said: result.assistantTurn.text.split('\n')[0]!.replace(/\s*\[[^\]]+\]\s*$/, '').replace(/:$/, '.'), did: step.count, complete: true };
}

async function keepMeeting(run: StepRun): Promise<StepDone> {
  const { project, actor } = run;
  const held = meetingAskedNow(project);
  if (!held || held.id !== run.step.meetingId) return { said: 'The notes the chat was holding are no longer held, so none were kept.', did: 0, complete: true };
  const turn = await meetingTurn(project, MEETING_IS_NOTES, { kind: 'answer', said: 'notes', asked: held });
  const result = applyProjectChat(project, turn.question, { actor, mayDecide: run.mayDecide, chat: run.chat, place: run.place, meeting: turn.given, modelReader: agentCapability().available });
  run.wrote([result.userTurn, result.assistantTurn]);
  return { said: result.assistantTurn.text.split('\n')[0]!.replace(/\s*\[[^\]]+\]/g, ''), did: 1, complete: true };
}

async function runPlaybook(run: StepRun): Promise<StepDone> {
  const { project, step, actor } = run;
  const item = await loadReviewLibrary(run.tenantId).then((kept) => kept.items.find((held) => held.id === step.playbookId));
  if (!item || item.kind !== 'playbook') return { said: 'That playbook is no longer saved, so it was not run.', did: 0, complete: true };
  const model = reviewModelSetUp();
  const tried = new Set<string>();
  let answered = 0;
  let failed = 0;
  const said = (complete: boolean): StepDone => ({
    said: `Asked the playbook “${item.name}” of ${plural(answered, 'paper')}${failed ? `; ${failed} could not be answered` : ''}. The answers are in the review table and on no paper’s own row.`,
    did: answered,
    complete,
  });
  // Its columns go on the table, as they do when it is run from the table's own page.
  await store.syncProject(project.id, { force: true });
  runReviewLibraryItem(project, item, {});
  await store.save();
  for (;;) {
    const rows = papersForPlaybook(project, item, step).map((row) => row.id);
    const todo = reviewRunPlan(project, rows, { model }).papers.filter((paper) => !tried.has(paper.evidenceId));
    if (!todo.length) return said(true);
    if (await run.mustEnd()) return said(false);
    const round = startReviewRun(project, todo.map((paper) => paper.evidenceId), actor, { model });
    await store.save();
    for (const paper of round.papers) {
      if (await run.mustEnd()) {
        stopReviewRun(project, round.id, actor);
        await store.save();
        return said(false);
      }
      tried.add(paper.evidenceId);
      const columns = reviewTableOf(project).columns;
      const questions = paper.columnIds.flatMap((id) => columns.filter((column): column is ReviewQuestionColumn => column.id === id && column.kind === 'question'));
      const out = await answersFor(project, round.with, paper.evidenceId, questions);
      // A model can take a while, and the file may have moved under it: take it as storage has it now, then write.
      await store.syncProject(project.id, { force: true });
      if ('failed' in out) failed += 1;
      else {
        try {
          keepReviewAnswers(project, round.id, paper.evidenceId, out.answers);
          answered += 1;
        } catch {
          failed += 1;
        }
      }
      await store.save();
      await run.progress(answered);
    }
  }
}

/** Carry out one step, by the code that carries its kind out when asked for alone. */
export async function runPlanStep(run: StepRun): Promise<StepDone> {
  switch (run.step.kind) {
    case 'read_filed':
      return readFiled(run);
    case 'accept_raised':
      return acceptRaised(run);
    case 'suggest_answers':
      return suggestAnswers(run);
    case 'write_report':
      return bySentence(run, run.step.sentence ?? 'Write this week’s status');
    case 'keep_meeting':
      return keepMeeting(run);
    case 'run_playbook':
      return runPlaybook(run);
  }
}
