/**
 * Looking at a project one stage at a time.
 *
 * Pressing a stage on a project's track switches the workspace to it: the
 * selector lists the departments with work at that stage, the tabs list the
 * functions, the address carries the stage, and a page with nothing at that
 * stage gives way to one that has. The screens draw what these rules say and
 * decide nothing themselves. Each rule is a plain function of the project,
 * the page and the stage, so each is asked here on a project built in the
 * test.
 *
 * Two of them lean on something else. Which stages a function has work in is
 * the example project's design, so the shared model is held against the
 * example's own files. And a function that already holds the project's
 * records keeps its place at the stage the project stands at, where "holds"
 * has to mean what the graph means by it, or the menu would leave out work
 * the graph draws. That one is held against the graph's own edges, on the
 * seeded projects.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  DEPARTMENT_KEYS,
  MENU_DEPARTMENTS,
  STAGES,
  STAGE_WORD,
  WORKSTREAMS,
  addBill,
  addContract,
  addEvidence,
  addMilestones,
  addQuestionnaire,
  addSiteVisit,
  addWorkPackages,
  buildProjectGraph,
  createProject,
  ensureWorkstreamChecks,
  fileCertifiedReport,
  functionsHoldingRecords,
  logSiteEntry,
  menuAt,
  menuDepartmentsOf,
  menuFunctions,
  placeAtStage,
  projectDepartments,
  recordCheckResult,
  seedBdaReferenceProject,
  seedDemoProject,
  setProjectDepartments,
  stageInAddress,
  stageInView,
  stageOf,
  stageOfWord,
  workstreamChecks,
  workstreamDefinition,
  type DdProject,
  type DepartmentKey,
  type StageKey,
} from '@realytica/shared';
import type { ExampleStage } from '../apps/web/src/pages/example/paths';

/** A bare project with every department on. It stands at Completed unless a step is given. */
function project(step: DdProject['currentStage'] = 'handover'): DdProject {
  return createProject({ name: 'Stage test', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: step }, 'RYT-S1');
}

/** The words on a department's tabs at a stage of a project, after Summary: the list the menu draws. */
function tabs(p: DdProject, menu: DepartmentKey, stage: StageKey): string[] {
  const enabled = projectDepartments(p);
  return menuFunctions(menu, menuAt(p, stage))
    .filter((fn) => enabled.includes(fn.department))
    .map((fn) => fn.label);
}

/** The departments the selector lists at a stage of a project. */
function departments(p: DdProject, stage: StageKey): DepartmentKey[] {
  return menuDepartmentsOf(projectDepartments(p), menuAt(p, stage));
}

/** The example project's file for each department of the menu. It calls Engineering by its menu word. */
const EXAMPLE_FILE: Record<string, string> = { legal: 'legal', finance: 'finance', construction: 'engineering', commercial: 'commercial', procurement: 'procurement' };

/** A department's functions as the example project's file lists them: the word on the tab and the stages it has work in. */
function exampleFunctions(menu: DepartmentKey): Array<{ name: string; stages: string[] }> {
  const file = new URL(`../apps/web/src/pages/example/spec/${EXAMPLE_FILE[menu]}.json`, import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { functions: Array<{ name: string; stages: string[] }> }).functions;
}

describe('the menu at a stage', () => {
  it('gives every function the stages the example project gives it', () => {
    // The example is the agreed design for what is worked on when, and a real
    // project's menu reads the shared model. The two lists are held together
    // here: change one without the other and this fails.
    for (const menu of MENU_DEPARTMENTS) {
      const there = exampleFunctions(menu);
      const here = menuFunctions(menu);
      assert.deepEqual(here.map((fn) => fn.label), there.map((fn) => fn.name), `${menu}: the same functions, in the same order`);
      for (const fn of here) {
        const stages = there.find((f) => f.name === fn.label)!.stages;
        // Each workstream the function stands for. Design stands for four, and each carries the one list the example gives Design.
        for (const key of fn.workstreams) {
          assert.deepEqual(workstreamDefinition(key)!.stages.map((stage) => STAGE_WORD[stage]), stages, `${key} against the example’s ${fn.label}`);
        }
      }
    }
    const compared = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu)).flatMap((fn) => fn.workstreams);
    assert.deepEqual([...compared].sort(), WORKSTREAMS.map((w) => w.key).sort(), 'and no workstream is left out of the comparison');
  });

  it('shows a function at the stages it has work in, and at no other', () => {
    const worksAt = (workstream: string, stage: StageKey) => workstreamDefinition(workstream)!.stages.includes(stage);
    for (const stage of STAGES) {
      for (const menu of MENU_DEPARTMENTS) {
        const working = menuFunctions(menu).filter((fn) => fn.workstreams.some((key) => worksAt(key, stage.key)));
        assert.deepEqual(
          menuFunctions(menu, { stage: stage.key }).map((fn) => fn.key),
          working.map((fn) => fn.key),
          `${menu} at ${stage.label}`,
        );
      }
    }
    for (const w of WORKSTREAMS) {
      // Somewhere, so a link that names its function always has a stage to open it at.
      assert.ok(w.stages.length > 0, `${w.key} has work at no stage`);
      assert.deepEqual(w.stages, STAGES.map((s) => s.key).filter((key) => w.stages.includes(key)), `${w.key}: its stages in order, each once`);
    }
  });

  it('has work at every stage it delivers something at, and at more', () => {
    // What a workstream produces is narrower than what it works on, never
    // wider: a deliverable at a stage its function did not show at would be
    // one nobody could reach from the menu.
    for (const w of WORKSTREAMS) {
      for (const d of w.deliverables) assert.ok(w.stages.includes(d.stage), `${w.key} delivers “${d.title}” at a stage it has no work in`);
    }
    // Title is worked on in all four stages and hands something over in two. The menu follows the first.
    const title = workstreamDefinition('legal.title')!;
    assert.deepEqual(title.deliverables.map((d) => d.stage), ['pre_development', 'operations']);
    assert.deepEqual(STAGES.map((s) => menuFunctions('legal', { stage: s.key }).some((fn) => fn.key === 'legal.title')), [true, true, true, true]);
  });

  it('lists Procurement in the two middle stages only, and the other four departments in all four', () => {
    const listed = (stage: StageKey) => menuDepartmentsOf(DEPARTMENT_KEYS, { stage });
    const others: DepartmentKey[] = ['legal', 'finance', 'construction', 'commercial'];
    assert.deepEqual(STAGES.map((s) => listed(s.key)), [others, [...MENU_DEPARTMENTS], [...MENU_DEPARTMENTS], others]);
    assert.deepEqual(menuFunctions('procurement', { stage: 'design_tender' }).map((fn) => fn.label), ['Tenders', 'Orders', 'Vendors']);
    assert.deepEqual(menuFunctions('procurement', { stage: 'construction' }).map((fn) => fn.label), ['Tenders', 'Orders', 'Vendors', 'Deliveries']);
  });

  it('keeps Design inside Engineering, at the stages its four workstreams have work in', () => {
    assert.deepEqual(
      STAGES.map((s) => menuFunctions('construction', { stage: s.key }).map((fn) => fn.label)),
      [['Design', 'Technical', 'Site'], ['Design', 'Progress', 'Site'], ['Design', 'Progress', 'Technical', 'Site', 'Safety'], ['Technical', 'Site']],
    );
    // With only Design switched on, Engineering is listed where Design shows and nowhere else.
    assert.deepEqual(STAGES.map((s) => menuDepartmentsOf(['design'], { stage: s.key })), [['construction'], ['construction'], ['construction'], []]);
    // With Design switched off, Engineering is listed for its own functions and Design has no tab.
    const p = project('design');
    setProjectDepartments(p, ['legal', 'construction'], 'tester');
    assert.deepEqual(departments(p, 'design_tender'), ['legal', 'construction']);
    assert.deepEqual(tabs(p, 'construction', 'design_tender'), ['Progress', 'Site']);
    setProjectDepartments(p, ['legal', 'design'], 'tester');
    assert.deepEqual(tabs(p, 'construction', 'design_tender'), ['Design'], 'and with Engineering itself off, Design alone, as the graph draws it');
  });

  it('answers as it always did when no stage is asked', () => {
    // The graph asks without one: it draws every function of a department
    // that is switched on, whatever stages the function has work in.
    assert.deepEqual(menuDepartmentsOf(DEPARTMENT_KEYS), [...MENU_DEPARTMENTS]);
    assert.deepEqual(menuDepartmentsOf(['procurement']), ['procurement'], 'Procurement is drawn though it has work in two stages only');
    assert.deepEqual(
      MENU_DEPARTMENTS.map((menu) => menuFunctions(menu).map((fn) => fn.label)),
      [
        ['Title', 'Approvals', 'RERA', 'Contracts', 'Handover'],
        ['Valuation', 'Feasibility', 'Budget', 'Funding', 'Tax'],
        ['Design', 'Progress', 'Technical', 'Site', 'Safety'],
        ['Market', 'Sales', 'Collections', 'Handover', 'Operations'],
        ['Tenders', 'Orders', 'Vendors', 'Deliveries'],
      ],
    );
  });
});

describe('work already done stays on show', () => {
  it('shows a function holding records at the stage the project stands at, and only there', () => {
    const p = project('handover');
    assert.deepEqual(tabs(p, 'construction', 'operations'), ['Technical', 'Site'], 'Progress has no work at Completed');
    addMilestones(p, [{ name: 'Frame', weight: 1 }], 'tester');
    assert.deepEqual(tabs(p, 'construction', 'operations'), ['Progress', 'Technical', 'Site'], 'its milestones keep it on the screen a person lands on');
    assert.deepEqual(tabs(p, 'construction', 'pre_development'), ['Design', 'Technical', 'Site'], 'looking back at Land, only what has work there');
    assert.deepEqual(tabs(p, 'construction', 'design_tender'), ['Design', 'Progress', 'Site'], 'and at Pre-construction it shows for the work it has there');
  });

  it('brings a department back with it', () => {
    // Procurement has no work at Completed. An order checked there is work done all the same.
    const p = project('handover');
    assert.ok(!departments(p, 'operations').includes('procurement'));
    ensureWorkstreamChecks(p, ['procurement.orders'], 'tester');
    assert.ok(!departments(p, 'operations').includes('procurement'), 'a check nobody has answered is not work done');
    recordCheckResult(p, workstreamChecks(p, 'procurement.orders')[0]!.id, { result: 'compliant' }, 'tester');
    assert.ok(departments(p, 'operations').includes('procurement'));
    assert.deepEqual(tabs(p, 'procurement', 'operations'), ['Orders']);
    setProjectDepartments(p, ['legal', 'finance'], 'tester');
    assert.ok(!departments(p, 'operations').includes('procurement'), 'unless the department is switched off');
  });

  it('counts a record once it is in hand, whichever kind it is', () => {
    const p = project('handover');
    assert.deepEqual([...functionsHoldingRecords(p)], [], 'a new project holds nothing');

    const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'expected' }, 'tester');
    deed.documentType = 'Sale deed';
    assert.ok(!functionsHoldingRecords(p).has('legal.title'), 'a document still expected has not come');
    deed.status = 'received';
    assert.ok(functionsHoldingRecords(p).has('legal.title'));
    for (const aside of ['rejected', 'superseded', 'missing', 'requested'] as const) {
      deed.status = aside;
      assert.ok(!functionsHoldingRecords(p).has('legal.title'), `a ${aside} document is not one the function stands on`);
    }

    ensureWorkstreamChecks(p, ['design.drawings'], 'tester');
    assert.ok(!functionsHoldingRecords(p).has('design'));
    recordCheckResult(p, workstreamChecks(p, 'design.drawings')[0]!.id, { result: 'compliant' }, 'tester');
    assert.ok(functionsHoldingRecords(p).has('design'), 'a design workstream’s check is held by the one function Design');

    const each: Array<[string, (q: DdProject) => void]> = [
      ['construction.progress', (q) => addMilestones(q, [{ name: 'Frame', weight: 1 }], 'tester')],
      ['construction.progress', (q) => logSiteEntry(q, { clientId: 'phone-1', date: '2026-10-01', workDone: 'Raft poured' }, 'site')],
      ['construction.site', (q) => addSiteVisit(q, { title: 'Condition walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'A surveyor' })],
      ['construction.quality', (q) => addQuestionnaire(q, { title: 'Building sheet', parsed: { header: [], questions: [{ text: 'How many chillers?' }] } }, 'tester')],
      [
        'legal.approvals',
        (q) => {
          addEvidence(q, { title: 'Sanctioned building plan', kind: 'approval', status: 'received' }, 'tester').documentType = 'Sanctioned building plan';
        },
      ],
      [
        'finance.budget',
        (q) => {
          const paper = addEvidence(q, { title: 'Cost report', kind: 'certificate' }, 'tester');
          fileCertifiedReport(q, { workstream: 'finance.budget', title: 'Cost report', evidenceId: paper.id, signer: { name: 'A surveyor', profession: 'Quantity Surveyor' }, verdict: 'clear' }, 'tester');
        },
      ],
      // The cost register is Budget's: a package of the budget, or a contract awarded before the budget is split.
      ['finance.budget', (q) => addWorkPackages(q, [{ name: 'Structure' }], 'tester')],
      ['finance.budget', (q) => addContract(q, { contractor: 'Sharma Constructions', title: 'Civil works', value: 4_500_000 }, 'tester')],
    ];
    for (const [fn, add] of each) {
      const q = project('handover');
      assert.ok(!functionsHoldingRecords(q).has(fn));
      add(q);
      assert.ok(functionsHoldingRecords(q).has(fn), `${fn} holds what was just added`);
    }
  });

  it('agrees with the graph: a function holds records where the graph joins it to one in hand', () => {
    // A file with one of each kind of record, beside the two seeded ones.
    const filled = project('handover');
    addMilestones(filled, [{ name: 'Frame', weight: 1 }], 'tester');
    logSiteEntry(filled, { clientId: 'phone-1', date: '2026-10-01', workDone: 'Raft poured' }, 'site');
    addSiteVisit(filled, { title: 'Condition walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'A surveyor' });
    addQuestionnaire(filled, { title: 'Building sheet', parsed: { header: [], questions: [{ text: 'How many chillers?' }] } }, 'tester');
    addEvidence(filled, { title: 'Sanctioned building plan', kind: 'approval', status: 'received' }, 'tester').documentType = 'Sanctioned building plan';
    addEvidence(filled, { title: 'Valuation report', kind: 'document', status: 'expected' }, 'tester').documentType = 'Valuation report';
    const opinion = addEvidence(filled, { title: 'Legal opinion', kind: 'certificate' }, 'tester');
    fileCertifiedReport(filled, { workstream: 'legal.title', title: 'Legal opinion', evidenceId: opinion.id, signer: { name: 'An advocate', profession: 'Advocate' }, verdict: 'clear' }, 'tester');
    ensureWorkstreamChecks(filled, ['design.drawings', 'procurement.orders'], 'tester');
    recordCheckResult(filled, workstreamChecks(filled, 'design.drawings')[0]!.id, { result: 'compliant' }, 'tester');
    const [pack] = addWorkPackages(filled, [{ name: 'Structure', budget: 5_000_000 }], 'tester');
    const contract = addContract(filled, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: [pack!.id], value: 4_500_000 }, 'tester');
    addBill(filled, { contractId: contract.id, number: 'RA-1', date: '2026-10-01', lines: [{ description: 'Raft concrete', workPackageId: pack!.id, amount: 600_000, readBy: 'person' }] }, 'tester');

    for (const p of [seedDemoProject(), seedBdaReferenceProject(), filled]) {
      const graph = buildProjectGraph(p);
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      // In hand, as the node itself says: a paper that has come and is still
      // relied on, an approval with a paper behind it, a check somebody has
      // answered. Whatever else a function holds is in hand by being there.
      const inHand = (id: string) => {
        const node = byId.get(id)!;
        if (node.kind === 'evidence') return node.status === 'received' || node.status === 'validated' || node.status === 'used';
        if (node.kind === 'approval') return node.status !== 'missing';
        if (node.kind === 'check') return node.detail !== 'pending';
        return true;
      };
      const holding = functionsHoldingRecords(p);
      const functions = graph.nodes.filter((n) => n.kind === 'workstream');
      assert.equal(functions.length, 24, 'every function is drawn on these files');
      for (const fn of functions) {
        const joined = graph.edges.some(
          (e) =>
            (e.rel === 'holds' && e.from === fn.id && inHand(e.to)) ||
            (e.rel === 'certifies' && e.to === fn.id) ||
            (e.rel === 'assesses' && e.to === fn.id && byId.get(e.from)!.status !== 'insufficient'),
        );
        assert.equal(holding.has(fn.key!), joined, `${p.name}: ${fn.key}`);
      }
      // Neither everything nor nothing, or the comparison would say little.
      assert.ok(holding.size > 0 && holding.size < functions.length, `${p.name} holds records in ${holding.size} functions`);
    }
    assert.deepEqual([...functionsHoldingRecords(filled)].sort(), ['construction.progress', 'construction.quality', 'construction.site', 'design', 'finance.budget', 'legal.approvals', 'legal.title']);
  });
});

describe('the stage in the address', () => {
  it('says each stage by the example project’s word, and reads it back', () => {
    const words: ExampleStage[] = ['land', 'pre', 'build', 'done'];
    assert.deepEqual(STAGES.map((s) => STAGE_WORD[s.key]), words);
    for (const stage of STAGES) assert.equal(stageOfWord(STAGE_WORD[stage.key]), stage.key);
    for (const unknown of ['Land', 'construction', 'operations', '', null, undefined]) assert.equal(stageOfWord(unknown), undefined, `"${unknown}" names no stage`);
  });

  it('leaves out the project’s own stage, and ignores a word it does not know', () => {
    const p = project('handover');
    assert.equal(stageOf(p.currentStage), 'operations');
    assert.deepEqual(STAGES.map((s) => stageInAddress(p, s.key)), ['land', 'pre', 'build', undefined]);
    assert.equal(stageInView(p, {}), 'operations', 'an address that says nothing is the project’s own stage');
    assert.equal(stageInView(p, { word: 'nowhere' }), 'operations');
    for (const stage of STAGES) assert.equal(stageInView(p, { word: stageInAddress(p, stage.key) }), stage.key, `${stage.label} survives the address`);
    // The word for the project's own stage still reads as that stage. Pressing it on the track says it that way.
    assert.equal(stageInView(p, { word: 'done', carried: 'pre_development' }), 'operations');
  });

  it('carries the stage to a page whose link names none', () => {
    const p = project('handover');
    assert.equal(stageInView(p, { carried: 'pre_development' }), 'pre_development');
    assert.equal(stageInView(p, { word: 'build', carried: 'pre_development' }), 'construction', 'a word in the address wins');

    // A walk the way the workspace makes it: each page is read with the word
    // its address carries and the stage carried from the page before, and
    // what it reads is what the next page is handed.
    let carried: StageKey | undefined;
    const open = (page: { word?: string; fn?: string; back?: boolean }) => {
      const stage = stageInView(p, { word: page.word, carried: page.back ? undefined : carried, fn: page.fn });
      carried = stageInAddress(p, stage) ? stage : undefined;
      return stage;
    };
    assert.equal(open({}), 'operations');
    assert.equal(open({ word: 'land' }), 'pre_development', 'Land is pressed on the track');
    assert.equal(open({}), 'pre_development', 'a link to another page names no stage, and Land holds');
    assert.equal(open({ fn: 'legal.title' }), 'pre_development', 'Title shows at Land');
    assert.equal(open({ fn: 'legal.rera' }), 'operations', 'RERA does not: it opens at the project’s own stage');
    assert.equal(open({}), 'operations', 'and the workspace stays there');
    assert.equal(open({ word: 'pre' }), 'design_tender');
    assert.equal(open({ back: true }), 'operations', 'going back to an address with no word carries nothing');
  });
});

describe('a page when another stage is picked', () => {
  it('keeps a function that shows at the stage, and sends one that does not to its department’s Summary', () => {
    const p = project('handover');
    const rera = { department: 'legal' as const, fn: 'legal.rera' };
    assert.deepEqual(placeAtStage(p, rera, 'design_tender'), rera, 'RERA has work at Pre-construction');
    assert.deepEqual(placeAtStage(p, rera, 'pre_development'), { department: 'legal' }, 'not at Land, where Legal has Title, Approvals and Contracts');
    assert.deepEqual(placeAtStage(p, { department: 'legal' }, 'pre_development'), { department: 'legal' }, 'a Summary stays while its department has work there');
    // Design's page is the function Design, under Engineering.
    const design = { department: 'construction' as const, fn: 'design' };
    assert.deepEqual(placeAtStage(p, design, 'construction'), design);
    assert.deepEqual(placeAtStage(p, design, 'operations'), { department: 'construction' }, 'Design has no work at Completed, and Engineering has');
  });

  it('sends a department with nothing at the stage to Overview', () => {
    const p = project('handover');
    assert.deepEqual(placeAtStage(p, { department: 'procurement', fn: 'procurement.boq' }, 'pre_development'), {});
    assert.deepEqual(placeAtStage(p, { department: 'procurement' }, 'pre_development'), {});
    assert.deepEqual(placeAtStage(p, { department: 'procurement' }, 'design_tender'), { department: 'procurement' });
    // What a department has is what its switched-on functions have: with only Design on, Engineering has nothing at Completed.
    setProjectDepartments(p, ['legal', 'design'], 'tester');
    const design = { department: 'construction' as const, fn: 'design' };
    assert.deepEqual(placeAtStage(p, design, 'operations'), {});
    assert.deepEqual(placeAtStage(p, design, 'design_tender'), design);
  });

  it('keeps a function at the project’s own stage for the records it holds', () => {
    const p = project('handover');
    addMilestones(p, [{ name: 'Frame', weight: 1 }], 'tester');
    const progress = { department: 'construction' as const, fn: 'construction.progress' };
    assert.deepEqual(placeAtStage(p, progress, 'operations'), progress);
    assert.deepEqual(placeAtStage(p, progress, 'pre_development'), { department: 'construction' });
  });

  it('leaves Overview and the shared places where they are', () => {
    const p = project('handover');
    for (const stage of STAGES) assert.deepEqual(placeAtStage(p, {}, stage.key), {});
  });
});

describe('a function named by a link', () => {
  it('opens at the stage being looked at when it shows there', () => {
    const p = project('handover');
    assert.equal(stageInView(p, { carried: 'pre_development', fn: 'legal.title' }), 'pre_development');
    assert.equal(stageInView(p, { word: 'build', fn: 'design' }), 'construction');
  });

  it('otherwise at the project’s own stage, for the work it has there or the records it holds', () => {
    const p = project('handover');
    assert.equal(stageInView(p, { carried: 'pre_development', fn: 'legal.rera' }), 'operations', 'RERA has no work at Land and has at Completed');
    assert.equal(stageInView(p, { word: 'land', fn: 'legal.rera' }), 'operations', 'whatever stage the address named');
    addMilestones(p, [{ name: 'Frame', weight: 1 }], 'tester');
    assert.equal(stageInView(p, { carried: 'pre_development', fn: 'construction.progress' }), 'operations', 'Progress holds milestones');
  });

  it('otherwise at the first stage it has work in', () => {
    const p = project('handover');
    assert.equal(stageInView(p, { carried: 'pre_development', fn: 'construction.progress' }), 'design_tender');
    assert.equal(stageInView(p, { fn: 'design' }), 'pre_development');
    assert.equal(stageInView(p, { fn: 'procurement.orders' }), 'design_tender');
    assert.equal(stageInView(p, { fn: 'construction.safety' }), 'construction');
    // Every function, from every stage a person could be looking at: the page always opens where its function shows.
    for (const fn of MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu))) {
      for (const from of STAGES) {
        const stage = stageInView(p, { carried: from.key, fn: fn.key });
        assert.ok(menuFunctions(fn.department, menuAt(p, stage)).some((f) => f.key === fn.key), `${fn.key} from ${from.label} opened at ${stage}`);
      }
    }
  });

  it('leaves the stage alone for a page that is no function’s', () => {
    const p = project('handover');
    assert.equal(stageInView(p, { carried: 'pre_development', fn: 'not.a.function' }), 'pre_development');
  });
});
