/**
 * Going where a person types.
 *
 * "Open Title", "show Legal at Land", "back to the live stage": a sentence
 * that names a page of the menu, a stage, or both, takes the person there.
 * The menu's own words are the vocabulary, so every function, department and
 * stage is asked for here by each name it has, on the seeded projects.
 *
 * Three things the reader must never do, each held below. Guess: two
 * functions are called Handover, so the word alone is a question back.
 * Invent: a name nothing answers to says so and moves nowhere. Change the
 * record: looking at a stage is not moving the project to it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEPARTMENT_SHORT,
  MENU_DEPARTMENTS,
  FIRM_ONLY_PANES,
  SHARED_PLACE_WORDS,
  STAGES,
  addSiteVisit,
  applyProjectChat,
  chatPlaceLabel,
  cockpitPath,
  departmentDefinition,
  menuAt,
  menuFunctions,
  placeFromText,
  placeOfRecord,
  placeOfWords,
  seedBdaReferenceProject,
  seedDemoProject,
  setProjectDepartments,
  stageInView,
  stageOf,
  wantsDeterministicProjectChat,
  type ChatPlace,
  type DdProject,
  type PlaceReading,
} from '@realytica/shared';

/** The seeded project that stands at Under construction, with every department on. */
const demo = (): DdProject => seedDemoProject();

function went(reading: PlaceReading | null): Extract<PlaceReading, { kind: 'go' }> {
  assert.ok(reading, 'the sentence was read as a place');
  assert.equal(reading.kind, 'go', reading.kind === 'go' ? '' : reading.text);
  return reading as Extract<PlaceReading, { kind: 'go' }>;
}

describe('a sentence read as a place', () => {
  it('knows every function by its one word and by its name in full', () => {
    const p = demo();
    for (const menu of MENU_DEPARTMENTS) {
      for (const fn of menuFunctions(menu)) {
        // Its name in full is its own. Its one word may be shared, and is then said with the department.
        const shared = MENU_DEPARTMENTS.flatMap((m) => menuFunctions(m)).filter((other) => other.label === fn.label).length > 1;
        for (const said of [fn.name, shared ? `${DEPARTMENT_SHORT[menu]} ${fn.label}` : fn.label]) {
          const reading = went(placeFromText(p, `open ${said}`));
          assert.equal(reading.place.fn, fn.key, `“open ${said}”`);
          assert.equal(reading.place.department, menu, `“open ${said}” sits under ${menu}`);
        }
      }
    }
  });

  it('knows the five departments by their word and their name in full, and Design as a function of Engineering', () => {
    const p = demo();
    for (const menu of MENU_DEPARTMENTS) {
      for (const said of [DEPARTMENT_SHORT[menu], departmentDefinition(menu).label]) {
        const reading = went(placeFromText(p, `show ${said}`));
        assert.deepEqual([reading.place.department, reading.place.fn], [menu, undefined], `“show ${said}”`);
        assert.equal(reading.open.pane, 'department');
      }
    }
    // "Commercial & Operations" is the department. "Commercial › Operations" is its function of that word: the sign says which.
    assert.equal(went(placeFromText(p, 'open Commercial & Operations')).place.fn, undefined);
    assert.equal(went(placeFromText(p, 'open Commercial › Operations')).place.fn, 'commercial.operations');
    for (const said of ['Design', 'Design & Architecture', 'the Design function']) {
      const design = went(placeFromText(p, `open ${said}`));
      assert.deepEqual([design.place.department, design.place.fn], ['construction', 'design'], said);
      // Design's page is its department's on the record, reached under Engineering in the menu.
      assert.deepEqual(design.open, { pane: 'department', extra: { department: 'design', stage: stageOf(p.currentStage) } });
    }
  });

  it('knows the places the whole project shares, and the words people already use for them', () => {
    const p = demo();
    const shared: Array<[string, string]> = [
      ['open Overview', 'overview'],
      ['open Documents', 'evidence'],
      ['open the evidence register', 'evidence'],
      ['show Registers', 'dd'],
      ['show the checks', 'dd'],
      ['open Reports', 'reports'],
      ['open People', 'people'],
      ['show me the graph', 'graph'],
      ['open findings', 'findings'],
      ['show risks', 'risks'],
      ['show actions', 'actions'],
      ['go to decisions', 'decisions'],
    ];
    for (const [said, pane] of shared) {
      const reading = went(placeFromText(p, said));
      assert.equal(reading.open.pane, pane, said);
      assert.equal(reading.place.department, undefined, `${said} belongs to no department`);
      assert.equal(reading.open.extra.stage, undefined, `${said} belongs to no stage`);
    }
    // The two that were panes before they were functions keep their panes.
    assert.equal(went(placeFromText(p, 'open valuation')).open.pane, 'valuation');
    assert.equal(went(placeFromText(p, 'open valuation')).place.fn, 'finance.valuation');
    assert.equal(went(placeFromText(p, 'open the site')).open.pane, 'visits');
    assert.equal(went(placeFromText(p, 'open the site')).place.fn, 'construction.site');
  });

  it('reads each of the four stages, and keeps the page a person is on', () => {
    const p = demo();
    const onTitle: ChatPlace = { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: stageOf(p.currentStage) };
    for (const stage of STAGES) {
      for (const said of [`show the ${stage.label} stage`, `show ${stage.label}`, `go to ${stage.label}`]) {
        const reading = went(placeFromText(p, said, onTitle));
        assert.equal(reading.place.stage, stage.key, said);
        assert.equal(reading.stageOnly, true, `${said} names a stage and no page`);
        // Title has work at all four, so the page stays.
        assert.equal(reading.place.fn, 'legal.title', `${said} keeps Title on screen`);
      }
    }
    // A function with no work at the stage gives way to its department's Summary, as it does when the track is pressed.
    const onProgress: ChatPlace = { pane: 'workstream', department: 'construction', fn: 'construction.progress', stage: 'construction' };
    const land = went(placeFromText(p, 'show the Land stage', onProgress));
    assert.deepEqual([land.place.department, land.place.fn, land.place.stage], ['construction', undefined, 'pre_development']);
    // A shared place belongs to no stage and stays where it is.
    const onFindings = went(placeFromText(p, 'show Land', { pane: 'findings', stage: 'construction' }));
    assert.deepEqual(onFindings.open, { pane: 'findings', extra: { stage: 'pre_development' } });
  });

  it('reads the stage the project is at, however it is said', () => {
    const p = demo();
    const own = stageOf(p.currentStage);
    const looking: ChatPlace = { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'pre_development' };
    for (const said of ['back to the live stage', 'go to the stage we are at', 'show the current stage', 'take me back to the live stage', 'return to where the project is', 'go back to where we are']) {
      const reading = went(placeFromText(p, said, looking));
      assert.equal(reading.place.stage, own, said);
      assert.equal(reading.place.fn, 'legal.title', said);
    }
  });

  it('takes “where the project is” for the live stage only as somewhere to go back to', () => {
    const p = demo();
    const looking: ChatPlace = { pane: 'overview', stage: 'pre_development' };
    // Asked to be shown where the project is, a person wants the map.
    for (const said of ['show me where the project is', 'show where we are', 'open where the project stands']) assert.equal(placeFromText(p, said, looking), null, said);
    const out = applyProjectChat(p, 'show me where the project is', { place: looking });
    assert.deepEqual(out.navigations.at(-1), { target: 'overview' });
    assert.ok(!/Back at/.test(out.assistantTurn.text), out.assistantTurn.text);
  });

  it('reads a page and a stage together', () => {
    const p = demo();
    const approvals = went(placeFromText(p, 'open Approvals at Pre-construction'));
    assert.deepEqual([approvals.place.fn, approvals.place.stage], ['legal.approvals', 'design_tender']);
    const legal = went(placeFromText(p, 'show Legal at Land'));
    assert.deepEqual([legal.place.department, legal.place.fn, legal.place.stage], ['legal', undefined, 'pre_development']);
    const title = went(placeFromText(p, 'open Title in the Completed stage'));
    assert.deepEqual([title.place.fn, title.place.stage], ['legal.title', 'operations']);
    const live = went(placeFromText(p, 'show Legal at the live stage'));
    assert.equal(live.place.stage, stageOf(p.currentStage));
    // "The project at Land" names the stage and no page.
    const project = went(placeFromText(p, 'show the project at Land', { pane: 'overview' }));
    assert.deepEqual([project.stageOnly, project.place.stage, project.open.pane], [true, 'pre_development', 'overview']);
  });

  it('reads a part of a function’s page', () => {
    const p = demo();
    assert.equal(went(placeFromText(p, 'open Title documents')).open.extra.section, 'documents');
    assert.equal(went(placeFromText(p, 'show the Approvals checks')).open.extra.section, 'checks');
    assert.deepEqual(
      [went(placeFromText(p, 'show the chain of title')).place.fn, went(placeFromText(p, 'show the chain of title')).open.extra.section],
      ['legal.title', 'chain'],
    );
    assert.deepEqual(
      [went(placeFromText(p, 'show milestones')).place.fn, went(placeFromText(p, 'show milestones')).open.extra.section],
      ['construction.progress', 'progress'],
    );
    // A page that is not laid out in parts has none to land on: the words name nothing.
    assert.equal(placeFromText(p, 'open Valuation documents'), null);
  });

  it('reads a page named after a register or a part as the page, and never as a stage', () => {
    const p = demo();
    const own = stageOf(p.currentStage);
    const here: ChatPlace = { pane: 'overview', stage: own };
    // Approvals and Title are functions. Their part is said part first.
    for (const [said, fn, section] of [
      ['show me the checks for approvals', 'legal.approvals', 'checks'],
      ['open the documents for title', 'legal.title', 'documents'],
      ['show the papers in approvals', 'legal.approvals', 'documents'],
    ] as const) {
      const reading = went(placeFromText(p, said, here));
      assert.deepEqual([reading.place.fn, reading.section, reading.place.stage], [fn, section, own], said);
    }
    // Procurement, Design and Handover are pages too. A register asked for "for" one of them is not that register at another stage.
    for (const said of ['show the documents for procurement', 'show findings in design', 'show risks for handover']) {
      assert.equal(placeFromText(p, said, here), null, said);
      const out = applyProjectChat(demo(), said, { place: here });
      assert.ok(out.navigations.every((nav) => !nav.stage || nav.stage === own), `${said}: the stage in view stays`);
    }
    // Said to be a stage, it is one. After a function or a department it still is.
    assert.equal(went(placeFromText(p, 'show the checks at the approvals stage', here)).place.stage, 'design_tender');
    assert.equal(went(placeFromText(p, 'open Title at Handover', here)).place.stage, 'operations');
    assert.equal(went(placeFromText(p, 'show Legal at Design', here)).place.stage, 'design_tender');
  });

  it('takes a name in quotes for the record of that title before the page', () => {
    const p = demo();
    const row = p.evidence.find((e) => e.title === 'NOCs');
    assert.ok(row, 'the seeded project expects a paper titled NOCs');
    assert.equal(went(placeFromText(p, 'open NOCs')).place.fn, 'legal.approvals', 'unquoted, it is the page people call that');
    for (const said of ['Open "NOCs"', 'open “NOCs”', 'show me "nocs"']) assert.equal(placeFromText(p, said), null, said);
    const out = applyProjectChat(p, 'Open "NOCs"');
    assert.notEqual(out.navigations.at(-1)?.workstream, 'legal.approvals', 'the Approvals page did not take the name');
    // A name in quotes that no record has is still the page.
    assert.equal(went(placeFromText(p, 'open "Approvals"')).place.fn, 'legal.approvals');
  });

  it('opens a function named alone at a stage it shows at, preferring the one being looked at and then the project’s own', () => {
    const p = demo();
    const own = stageOf(p.currentStage);
    // Looked at in Land: Title shows there and stays there.
    assert.equal(went(placeFromText(p, 'open Title', { pane: 'overview', stage: 'pre_development' })).place.stage, 'pre_development');
    // Progress has no work at Land, so it opens at the project's own stage, where it has.
    const progress = went(placeFromText(p, 'open Progress', { pane: 'overview', stage: 'pre_development' }));
    assert.equal(progress.place.stage, own);
    assert.equal(progress.place.stage, stageInView(p, { carried: 'pre_development', fn: 'construction.progress' }), 'the rule every link to a function follows');
  });

  it('asks which, when two pages share a name', () => {
    const p = demo();
    const reading = placeFromText(p, 'open Handover');
    assert.ok(reading && reading.kind === 'ask', 'two functions are called Handover');
    assert.deepEqual(reading.choices.map((c) => c.label), ['Legal › Handover', 'Commercial › Handover']);
    // Each choice is a sentence the same reader takes to one page.
    assert.deepEqual(reading.choices.map((c) => went(placeFromText(p, c.send)).place.fn), ['legal.handover', 'commercial.handover']);
    // Named in full, or with its department, it is one page.
    assert.equal(went(placeFromText(p, 'open Handover & society')).place.fn, 'legal.handover');
    assert.equal(went(placeFromText(p, 'open Handover and defects')).place.fn, 'commercial.handover');
    assert.equal(went(placeFromText(p, 'open Commercial › Handover')).place.fn, 'commercial.handover');
  });

  it('takes the one that is switched on, when only one is', () => {
    const p = demo();
    setProjectDepartments(p, ['legal', 'finance', 'construction'], 'tester');
    assert.equal(went(placeFromText(p, 'open Handover')).place.fn, 'legal.handover', 'Commercial is off, so there is one Handover');
    const off = placeFromText(p, 'open Tenders');
    assert.ok(off && off.kind === 'refuse');
    assert.match(off.text, /Tenders is switched off on this project/);
    const department = placeFromText(p, 'show Procurement');
    assert.ok(department && department.kind === 'refuse');
  });

  it('says so when a page has no work at the stage asked for, and offers the stages it has', () => {
    const p = demo();
    const reading = placeFromText(p, 'open Progress at Land');
    assert.ok(reading && reading.kind === 'ask');
    assert.match(reading.text, /Progress has no work at Land/);
    const shows = STAGES.map((s) => s.key).filter((stage) => menuFunctions('construction', menuAt(p, stage)).some((fn) => fn.key === 'construction.progress'));
    assert.deepEqual(reading.choices.map((c) => went(placeFromText(p, c.send)).place.stage), shows);
    const department = placeFromText(p, 'show Procurement at Land');
    assert.ok(department && department.kind === 'ask');
    assert.match(department.text, /Procurement has no work at Land/);
  });

  it('leaves alone a sentence that names a record, asks a question, or names nothing it knows', () => {
    const p = demo();
    for (const said of ['open the title deed', 'open the fire NOC', 'show me who owns it', 'what is missing?', 'Title', 'open Zorblax', 'open']) {
      assert.equal(placeFromText(p, said), null, said);
    }
  });
});

describe('the place a tool names', () => {
  it('reads a department, a function and a stage as a person would write them', () => {
    const p = demo();
    assert.equal(went(placeOfWords(p, { fn: 'legal.title' })).place.fn, 'legal.title');
    assert.equal(went(placeOfWords(p, { fn: 'Title', stage: 'land' })).place.stage, 'pre_development');
    assert.equal(went(placeOfWords(p, { department: 'construction' })).place.department, 'construction');
    assert.equal(went(placeOfWords(p, { department: 'Engineering', stage: 'build' })).place.stage, 'construction');
    assert.equal(went(placeOfWords(p, { fn: 'Handover', department: 'commercial' })).place.fn, 'commercial.handover');
    assert.equal(went(placeOfWords(p, { stage: 'live' }, { pane: 'findings' })).place.stage, stageOf(p.currentStage));
    assert.equal(went(placeOfWords(p, { fn: 'legal.title', section: 'documents' })).open.extra.section, 'documents');
    assert.equal(placeOfWords(p, { fn: 'Handover' }).kind, 'ask');
    assert.equal(placeOfWords(p, { fn: 'Zorblax' }).kind, 'refuse');
    assert.equal(placeOfWords(p, { stage: 'someday' }).kind, 'refuse');
    assert.equal(placeOfWords(p, {}).kind, 'refuse');
  });
});

describe('the chat goes there', () => {
  it('opens a function with one line and the figure that matters, and needs no model', () => {
    const p = demo();
    assert.equal(wantsDeterministicProjectChat(p, 'open Title'), true);
    const out = applyProjectChat(p, 'open Title', { place: { pane: 'overview', stage: stageOf(p.currentStage) } });
    assert.deepEqual(out.navigations.at(-1), { target: 'workstream', workstream: 'legal.title', stage: stageOf(p.currentStage) });
    assert.equal(out.assistantTurn.text.split('\n').length, 1, out.assistantTurn.text);
    assert.match(out.assistantTurn.text, /^Title is open — /);
    assert.deepEqual(out.assistantTurn.toolCalls?.map((t) => t.name), ['navigate']);
    assert.equal(out.proposals.length, 0, 'going somewhere proposes nothing');
  });

  it('carries the stage in the navigation, and the address carries its word', () => {
    const p = demo();
    const out = applyProjectChat(p, 'open Approvals at Pre-construction');
    const nav = out.navigations.at(-1)!;
    assert.deepEqual(nav, { target: 'workstream', workstream: 'legal.approvals', stage: 'design_tender' });
    assert.equal(cockpitPath(p.id, 'workstream', nav), `/projects/${p.id}/w/legal.approvals?stage=pre`);
    assert.match(out.assistantTurn.text, /^Approvals is open at Pre-construction — /);
    // A part and a record travel the same way.
    assert.equal(
      cockpitPath(p.id, 'workstream', { workstream: 'legal.title', stage: 'pre_development', section: 'documents', evidenceId: 'ev_1', page: '3' }),
      `/projects/${p.id}/w/legal.title?stage=land&part=documents&evidence=ev_1&page=3`,
    );
    assert.equal(cockpitPath(p.id, 'scope', { ddId: 'dd_1', scopeId: 'scp_1', checkId: 'chk_1', stage: 'operations' }), `/projects/${p.id}/dd/dd_1/scopes/scp_1?check=chk_1&stage=done`);
    assert.equal(cockpitPath(p.id, 'findings'), `/projects/${p.id}/findings`, 'a link that names no stage carries none');
  });

  it('looks at a stage from the page a person is on, and says where the project is', () => {
    const p = demo();
    const here: ChatPlace = { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: stageOf(p.currentStage) };
    const out = applyProjectChat(p, 'show the Land stage', { place: here });
    assert.deepEqual(out.navigations.at(-1), { target: 'workstream', workstream: 'legal.title', stage: 'pre_development' });
    assert.equal(out.assistantTurn.text, 'Looking at Land, on Title. The project is at Under construction.');
    const back = applyProjectChat(p, 'back to the live stage', { place: { ...here, stage: 'pre_development' } });
    assert.equal(back.navigations.at(-1)?.stage, stageOf(p.currentStage));
    assert.match(back.assistantTurn.text, /^Back at Under construction, the stage the project is at/);
    assert.equal(wantsDeterministicProjectChat(p, 'back to the live stage'), true);
  });

  it('opens a shared place with the line it always had', () => {
    const p = demo();
    const out = applyProjectChat(p, 'open findings');
    assert.deepEqual(out.navigations.at(-1), { target: 'findings' });
    assert.match(out.assistantTurn.text, /^Findings are open — \d+ open finding/);
  });

  it('says the stage when a shared place was asked for at another one', () => {
    const p = demo();
    const here: ChatPlace = { pane: 'overview', stage: stageOf(p.currentStage) };
    const out = applyProjectChat(p, 'open Documents at Land', { place: here });
    assert.equal(out.navigations.at(-1)?.stage, 'pre_development');
    assert.match(out.assistantTurn.text, /^Documents are open — \d+ filed, \d+ outstanding\. Looking at Land\. The project is at Under construction\.$/);
    // Asked for at the stage already in view, the line is the register's alone.
    const same = applyProjectChat(demo(), 'open Documents at Under construction', { place: here });
    assert.match(same.assistantTurn.text, /^Documents are open — \d+ filed, \d+ outstanding\.$/);
    // And back at the project's own stage from another one, it says that.
    const back = applyProjectChat(demo(), 'open Findings at Under construction', { place: { pane: 'overview', stage: 'pre_development' } });
    assert.match(back.assistantTurn.text, /Back at Under construction, the stage the project is at\.$/);
  });

  it('puts two Handovers to the person, and moves nowhere', () => {
    const p = demo();
    const out = applyProjectChat(p, 'open Handover');
    assert.equal(out.navigations.length, 0);
    assert.equal(out.commands.length, 0);
    assert.equal(out.assistantTurn.text, 'Two pages are called Handover. Which one?');
    assert.deepEqual(out.assistantTurn.choices?.map((c) => c.send), ['Open Legal › Handover', 'Open Commercial › Handover']);
    const picked = applyProjectChat(p, out.assistantTurn.choices![1]!.send);
    assert.equal(picked.navigations.at(-1)?.workstream, 'commercial.handover');
  });

  it('says a name it does not know in one line, and moves nowhere', () => {
    const p = demo();
    assert.equal(wantsDeterministicProjectChat(p, 'open Zorblax'), true, 'answered here, with no model');
    const out = applyProjectChat(p, 'open Zorblax');
    assert.equal(out.navigations.length, 0, 'nothing opened');
    assert.equal(out.assistantTurn.text, 'Nothing on this project is called “Zorblax”. Nothing moved.');
    // A sentence that asks a question is not a name, and is answered as it was.
    const asked = applyProjectChat(p, 'show me where we stand');
    assert.equal(asked.navigations.at(-1)?.target, 'overview');
  });

  it('never moves the project because somebody asked to look at a stage', () => {
    for (const said of [
      'show Land',
      'show the Land stage',
      'show the project at Land',
      'show me the Land stage of the project',
      'go to Completed',
      'open Title at Land',
      // However the asking opens, and whatever follows the stage.
      'can you show me the Land stage of the project',
      'jump to the Land stage of the project',
      'bring up the Land stage for this project',
      'now show me the Completed stage',
      'could you take me back to the Land stage please',
      'ok open up the Land stage and tell me what was done',
      'look at the project at Land',
      'let me see the Land stage',
      'I want to see the project at Land',
      'I’d like to look at the Completed stage',
      'can I see the Land stage',
      'take a look at the Land stage of the project',
    ]) {
      const p = demo();
      const was = p.currentStage;
      const here: ChatPlace = { pane: 'overview', stage: stageOf(was) };
      const out = applyProjectChat(p, said, { place: here });
      assert.equal(p.currentStage, was, `${said}: the project stays where it is`);
      assert.equal(out.proposals.filter((card) => card.kind === 'change_stage').length, 0, `${said}: no card to move it either`);
      assert.equal(p.chatProposals.filter((card) => card.kind === 'change_stage').length, 0, said);
      // With no card raised, a word of assent after it has nothing to accept.
      applyProjectChat(p, 'ok', { place: here });
      assert.equal(p.currentStage, was, `${said}, then “ok”: still where it was`);
    }
  });

  it('looks at the stage a longer asking names', () => {
    const p = demo();
    const here: ChatPlace = { pane: 'overview', stage: stageOf(p.currentStage) };
    for (const said of [
      'can you show me the Land stage of the project',
      'jump to the Land stage of the project',
      'bring up the Land stage for this project',
      'look at the project at Land',
      'let me see the Land stage',
      'I want to see the project at Land',
      'show the project at Land please',
      'show me the Land stage, thanks',
    ]) {
      const out = applyProjectChat(demo(), said, { place: here });
      assert.equal(out.assistantTurn.text, 'Looking at Land. The project is at Under construction.', said);
      assert.equal(went(placeFromText(p, said, here)).place.stage, 'pre_development');
    }
  });

  it('reads a part of a page said part first, with the stage it is asked for at', () => {
    const p = demo();
    const here: ChatPlace = { pane: 'overview', stage: stageOf(p.currentStage) };
    for (const [said, fn, section, stage] of [
      ['show documents for Title at Land', 'legal.title', 'documents', 'pre_development'],
      ['open the checks for Approvals at Pre-construction', 'legal.approvals', 'checks', 'design_tender'],
      ['show the Title documents at Land', 'legal.title', 'documents', 'pre_development'],
    ] as const) {
      const reading = went(placeFromText(p, said, here));
      assert.deepEqual([reading.place.fn, reading.section, reading.place.stage], [fn, section, stage], said);
    }
    const out = applyProjectChat(p, 'show documents for Title at Land', { place: here });
    assert.match(out.assistantTurn.text, /^Title is open at Land — /);
    assert.deepEqual([out.navigations.at(-1)?.workstream, out.navigations.at(-1)?.section], ['legal.title', 'documents']);
  });

  it('still moves the project when a person says to move it', () => {
    const p = seedBdaReferenceProject();
    const was = p.currentStage;
    applyProjectChat(p, 'move the project to Under construction');
    assert.notEqual(p.currentStage, was, 'a person’s own instruction to move it still runs');
    assert.equal(stageOf(p.currentStage), 'construction');
  });

  it('answers to the word on every tab, and says that word in the reply, the chip and the toast', () => {
    for (const [pane, word] of SHARED_PLACE_WORDS) {
      const p = demo();
      const reading = went(placeFromText(p, `open ${word}`));
      // Checks holds the scopes and Risks and actions holds both registers: two panes, one tab.
      assert.equal(chatPlaceLabel(reading.place), word, `“open ${word}” opens the tab called ${word}, asked for ${pane}`);
      const out = applyProjectChat(p, `open ${word}`);
      assert.match(out.assistantTurn.text.toLowerCase(), new RegExp(`^(the )?${word.toLowerCase()} (is|are) open`), out.assistantTurn.text);
      assert.deepEqual(out.assistantTurn.toolCalls, [{ name: 'navigate', summary: word }]);
      assert.deepEqual(out.commands, [`Opened ${word}`]);
    }
    // The three that were not understood, or were said by the key the code knows them by.
    assert.equal(applyProjectChat(demo(), 'open Review').assistantTurn.text, 'Review is open.');
    assert.equal(applyProjectChat(demo(), 'open Auto-run').assistantTurn.text, 'Auto-run is open.');
    assert.match(applyProjectChat(demo(), 'open AI drafts').assistantTurn.text, /^AI drafts are open/);
  });

  it('calls the list of due diligences Checks, as its tab does, however it was asked for', () => {
    for (const said of ['go to registers', 'open Checks', 'show the due diligence', 'open dd']) {
      const out = applyProjectChat(demo(), said);
      assert.match(out.assistantTurn.text, /^Checks are open — \d+ due diligences?\.$/, said);
      assert.deepEqual(out.assistantTurn.toolCalls, [{ name: 'navigate', summary: 'Checks' }], said);
      assert.deepEqual(out.commands, ['Opened Checks'], said);
      assert.doesNotMatch(out.assistantTurn.text, /\bDDs?\b/, said);
    }
  });

  it('tells a collaborator that a page is the firm’s own, and moves nothing', () => {
    for (const pane of FIRM_ONLY_PANES) {
      const word = chatPlaceLabel({ pane });
      const p = demo();
      const out = applyProjectChat(p, `open ${word}`, { outside: true });
      assert.equal(out.assistantTurn.text, `${word} is the firm’s own page. Nothing moved.`);
      assert.deepEqual(out.navigations, [], word);
      assert.deepEqual(out.commands, [], word);
      // The firm's own people are taken there.
      assert.equal(applyProjectChat(demo(), `open ${word}`).navigations.at(-1)?.target, pane);
    }
    // A page that is everybody's opens for a collaborator as it always did.
    assert.equal(applyProjectChat(demo(), 'open Documents', { outside: true }).navigations.at(-1)?.target, 'evidence');
    assert.equal(applyProjectChat(demo(), 'open Title', { outside: true }).navigations.at(-1)?.workstream, 'legal.title');
  });

  it('links a site visit to its own row on the Site page', () => {
    const p = demo();
    const visit = addSiteVisit(p, { title: 'First visit', purpose: 'inspection', visitedOn: '2026-09-01', surveyor: 'tester' } as never);
    const at = placeOfRecord(p, visit.id)!;
    // Was: the page with no row named, so the Site page had nothing to light.
    assert.deepEqual([at.open.pane, at.open.extra.item], ['visits', visit.id]);
    assert.match(cockpitPath(p.id, at.open.pane, at.open.extra), new RegExp(`^/projects/${p.id}/visits\\?item=${visit.id}(?:&stage=\\w+)?$`));
    assert.equal(cockpitPath(p.id, 'visits'), `/projects/${p.id}/visits`, 'the page asked for alone names no row');
  });

  it('names a place the way the menu does', () => {
    assert.equal(chatPlaceLabel({ pane: 'workstream', department: 'legal', fn: 'legal.title' }), 'Title');
    assert.equal(chatPlaceLabel({ fn: 'commercial.handover' }), 'Commercial › Handover', 'a word two functions share carries its department');
    assert.equal(chatPlaceLabel({ pane: 'department', department: 'construction' }), 'Engineering');
    assert.equal(chatPlaceLabel({ pane: 'evidence' }), 'Documents');
    assert.equal(chatPlaceLabel({ pane: 'valuation' }), 'Valuation');
    assert.equal(chatPlaceLabel(undefined), 'Overview');
    // A function nothing knows any more reads as its department, never as a page that is not there.
    assert.equal(chatPlaceLabel({ department: 'legal', fn: 'legal.gone' }), 'Legal');
  });
});
