/**
 * Looking at a project one stage at a time.
 *
 * A project stands at one stage and can be looked at in any of the four. The
 * track in its bar picks the stage in view, and the menu shows what belongs
 * to that stage. `departments.ts` says which functions have work at a stage.
 * This says what only the project can: which functions already hold its
 * records, the stage a page is looked at in, and where a page goes when the
 * stage under it changes.
 */

import type { DdProject, EvidenceRecord } from './types';
import {
  STAGES,
  STAGE_WORD,
  WORKSTREAMS,
  departmentHomeWorkstream,
  functionDepartment,
  functionKey,
  functionShows,
  menuFunctions,
  stageOf,
  stageOfWord,
  workstreamOfCheck,
  type DepartmentKey,
  type MenuStage,
  type StageKey,
} from './departments';
import { approvalsRegister } from './approvals';
import { allChecks } from './engagements';
import { questionnaireDepartment } from './questionnaire';
import { quickAssessment } from './quick-assessments';
import { projectDepartments } from './team';
import { documentWorkstream } from './vault';

/** A document that has come and is still relied on. One expected has not come; one rejected or superseded is on file and stood on by nobody. */
function inHand(evidence: EvidenceRecord): boolean {
  return evidence.status === 'received' || evidence.status === 'validated' || evidence.status === 'used';
}

/**
 * The functions that already hold records of this project.
 *
 * These are the records the graph draws a function's `holds`, `certifies`
 * and `assesses` edges from, counted once they are in hand: an answered
 * check, a document that has come, an approval with a paper behind it, a
 * milestone, a site entry, a site visit, a questionnaire, a work package, a
 * contract, a bill, a certified report, and an estimate with enough on file
 * to say something. A check nobody has answered and a document still expected
 * are on the file and are not work done, so they hold nothing here.
 */
export function functionsHoldingRecords(project: DdProject): Set<string> {
  const holding = new Set<string>();
  const holds = (workstream: string | undefined) => {
    if (workstream) holding.add(functionKey(workstream));
  };
  for (const check of allChecks(project)) {
    if (check.result !== 'pending') holds(workstreamOfCheck(check.definitionId));
  }
  for (const evidence of project.evidence) {
    if (inHand(evidence)) holds(documentWorkstream(project, evidence));
  }
  if (approvalsRegister(project).some((line) => line.held.length > 0)) holds('legal.approvals');
  if (project.milestones?.length || project.siteLog?.length) holds('construction.progress');
  if (project.siteVisits?.length) holds('construction.site');
  for (const sheet of project.questionnaires ?? []) holds(departmentHomeWorkstream(questionnaireDepartment(sheet)));
  if (project.cost?.workPackages.length || project.cost?.contracts.length || project.cost?.bills.length) holds('finance.budget');
  for (const report of project.certifiedReports ?? []) holds(report.workstream);
  // The estimate last, and only where nothing above already answered: it is the one that costs something to work out.
  for (const workstream of WORKSTREAMS) {
    if (workstream.status !== 'live' || holding.has(functionKey(workstream.key))) continue;
    if (quickAssessment(project, workstream.key).verdict !== 'insufficient') holds(workstream.key);
  }
  return holding;
}

/**
 * A project's menu at a stage.
 *
 * At the stage the project stands at, a function that already holds its
 * records shows even where the frame gives it no work. That is the screen a
 * person lands on, and work already done must not be missing from it. Looked
 * at in any other stage, the menu shows only what has work there.
 */
export function menuAt(project: DdProject, stage: StageKey): MenuStage {
  return stage === stageOf(project.currentStage) ? { stage, holding: functionsHoldingRecords(project) } : { stage };
}

/**
 * The stage a function's page opens at.
 *
 * A link names a function and no stage: one from the chat, an alert, a card.
 * Its page is looked at in the stage asked for when the function shows there,
 * otherwise in the project's own, otherwise in the first it has work in.
 */
function stageOfFunction(project: DdProject, key: string, asked: StageKey): StageKey {
  const menu = functionDepartment(key);
  const fn = menu ? menuFunctions(menu).find((f) => f.key === functionKey(key)) : undefined;
  if (!fn) return asked;
  const order = new Set([asked, stageOf(project.currentStage), ...STAGES.map((s) => s.key)]);
  return [...order].find((stage) => functionShows(fn, menuAt(project, stage))) ?? asked;
}

/**
 * The stage a page of a project is looked at in.
 *
 * The address says it, by one of the four words. An address that says none
 * is looked at in the stage carried from the page before it, and with nothing
 * carried, in the project's own. A page that is one function's then opens at
 * a stage that function shows at.
 */
export function stageInView(project: DdProject, page: { word?: string | null; carried?: StageKey; fn?: string }): StageKey {
  const asked = stageOfWord(page.word) ?? page.carried ?? stageOf(project.currentStage);
  return page.fn ? stageOfFunction(project, page.fn, asked) : asked;
}

/** The word an address carries for the stage in view: none while that is the project's own. */
export function stageInAddress(project: DdProject, stage: StageKey): string | undefined {
  return stage === stageOf(project.currentStage) ? undefined : STAGE_WORD[stage];
}

/**
 * A page of a project as the menu has it: its department, and its function
 * when it is one function's page. Neither on Overview and the places the
 * whole project shares.
 */
export interface MenuPlace {
  department?: DepartmentKey;
  fn?: string;
}

/**
 * Where a page goes when another stage is picked.
 *
 * A function that shows at the stage keeps its page. One that does not gives
 * way to its department's Summary, and a department with nothing at the
 * stage gives way to Overview. Overview and the shared places belong to no
 * stage, so they stay.
 */
export function placeAtStage(project: DdProject, place: MenuPlace, stage: StageKey): MenuPlace {
  if (!place.department) return place;
  const enabled = projectDepartments(project);
  const shown = menuFunctions(place.department, menuAt(project, stage)).filter((fn) => enabled.includes(fn.department));
  if (!shown.length) return {};
  return place.fn && !shown.some((fn) => fn.key === place.fn) ? { department: place.department } : place;
}
