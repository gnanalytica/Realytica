/**
 * The questions a person running a project asks the chat, answered by rule.
 *
 * With no model the chat answers what is pending from a party, what changed
 * in cost and why, what is late, what needs me, what is due this period and a
 * cost figure by name, each as a card of fields made from the function the
 * screen reads, so the two cannot disagree. A sentence that opens with a verb
 * of showing or a question word is a place or a question and never a change
 * to a record. What it cannot answer it says in one line, with the nearest
 * real things to open. With a model, the model picks the shape and the server
 * makes the same card.
 *
 * Every project, party, package and figure is invented. No model is called:
 * the one test with a model answers from a fake endpoint.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  CHAT_NOT_ANSWERED,
  CHAT_QUESTION,
  CHAT_QUESTION_SHAPES,
  PACK_MONTH,
  PAPER_STANDING_LABEL,
  RUNNING_PROMPTS,
  STATIONS_SET,
  addAction,
  addChecklistItems,
  addCostReportVariation,
  addFieldRecord,
  addMilestones,
  addWorkPackages,
  applyProjectChat,
  chatAnswerText,
  chatOpening,
  chatPrompts,
  chatQuestionAnswer,
  chatQuestionAsked,
  cockpitPath,
  costReportChanges,
  costReportOf,
  costReportTotals,
  createProject,
  daySaid,
  issueCostReport,
  largestCostMovements,
  milestonesFlagged,
  moneySaid,
  papersOwed,
  periodsDue,
  projectBrief,
  raiseChecklistRequests,
  scheduleWatch,
  setMilestonePercent,
  startCostReport,
  stationsDue,
  updateCostReportRow,
  wantsDeterministicProjectChat,
  type ChatAnswerCard,
  type ChatQuestionShape,
  type DdProject,
} from '@realytica/shared';

const LEAD = 'lead@builders.example';
/** A Tuesday in the middle of a month. */
const NOW = new Date('2026-10-13T06:30:00Z');

function bare(): DdProject {
  return createProject({ name: 'Canal Road flats', type: 'residential', location: 'Canal Road', city: 'Kadamba', currentStage: 'construction' }, 'RYT-CQ1', LEAD);
}

/**
 * A residential project under construction, as a project manager keeps it: a
 * list of papers by party with some asked for, two Cost Reports issued with a
 * variation, an award and a change nothing explains, a schedule with one
 * activity late and one behind, a station to photograph and an action past
 * its date.
 */
function running(): DdProject {
  const p = bare();
  addChecklistItems(
    p,
    'construction',
    [
      { title: 'Plumbing shaft drawings', owedBy: 'MEP consultant' },
      { title: 'Electrical load schedule', owedBy: 'MEP consultant' },
      { title: 'Fire pump room layout', owedBy: 'MEP consultant' },
      { title: 'Door and window schedule', owedBy: 'Architect' },
      { title: 'Facade elevations', owedBy: 'Architect' },
      { title: 'Soil report addendum' },
    ],
    LEAD,
  );
  const line = (title: string) => p.checklist!.find((item) => item.title === title)!.id;
  raiseChecklistRequests(p, { department: 'construction', itemIds: [line('Plumbing shaft drawings'), line('Electrical load schedule')], dueAt: '2026-10-05' }, LEAD);
  raiseChecklistRequests(p, { department: 'construction', itemIds: [line('Door and window schedule')], dueAt: '2026-10-20' }, LEAD);

  addWorkPackages(p, [{ code: 'A', name: 'Civil works', budget: 1_00_00_000 }, { code: 'B', name: 'Facade', budget: 50_00_000 }, { code: 'C', name: 'Lifts', budget: 20_00_000 }], LEAD);
  const august = startCostReport(p, { month: '2026-08-01' }, LEAD);
  for (const row of august.rows) updateCostReportRow(p, august.id, row.id, { anticipatedCost: row.budget, ...(row.name === 'Civil works' ? { poIssued: 90_00_000, amountPaid: 30_00_000 } : {}) }, LEAD);
  issueCostReport(p, august.id, LEAD);
  const september = startCostReport(p, { month: '2026-09-01' }, LEAD);
  const row = (name: string) => costReportOf(p, september.id).rows.find((held) => held.name === name)!;
  // Civil works: up 18 lakh, 6 of it a variation and 12 nothing explains. Facade: awarded 2 lakh over. Lifts: as it was.
  updateCostReportRow(p, september.id, row('Civil works').id, { poIssued: 90_00_000, amountPaid: 42_00_000, anticipatedCost: 1_18_00_000 }, LEAD);
  addCostReportVariation(p, september.id, { description: 'Extra piling at grid C', amount: 6_00_000, workPackageId: row('Civil works').workPackageId }, LEAD);
  updateCostReportRow(p, september.id, row('Facade').id, { poIssued: 52_00_000, anticipatedCost: 52_00_000 }, LEAD);
  updateCostReportRow(p, september.id, row('Lifts').id, { anticipatedCost: 20_00_000 }, LEAD);
  issueCostReport(p, september.id, LEAD);

  const [plinth, slab] = addMilestones(p, [{ name: 'Plinth', weight: 10, plannedFinish: '2026-10-01' }, { name: 'First floor slab', weight: 10, plannedFinish: '2026-10-20' }, { name: 'Finishes', weight: 10, plannedFinish: '2027-03-01' }], LEAD);
  plinth!.plannedStart = '2026-09-01';
  slab!.plannedStart = '2026-09-20';
  setMilestonePercent(p, plinth!.id, 40, LEAD, '2026-09-20T06:00:00.000Z');
  setMilestonePercent(p, plinth!.id, 60, LEAD, '2026-10-10T06:00:00.000Z');
  setMilestonePercent(p, slab!.id, 10, LEAD, '2026-09-28T06:00:00.000Z');
  setMilestonePercent(p, slab!.id, 30, LEAD, '2026-10-10T06:00:00.000Z');

  assert.deepEqual(addFieldRecord(p, STATIONS_SET, { label: 'Main gate', every: 'week' }, LEAD).rejected, []);
  addAction(p, { title: 'Chase the lift vendor', kind: 'clarification', owner: 'Anika Rao', priority: 'medium', dueDate: '2026-10-01' }, LEAD);
  return p;
}

const ask = (p: DdProject, question: string) => applyProjectChat(p, question, { now: NOW, actor: LEAD });
const cardOf = (p: DdProject, question: string): ChatAnswerCard => {
  const result = ask(p, question);
  assert.ok(result.assistantTurn.card, `${question}: answered as a card`);
  return result.assistantTurn.card;
};
const valueOf = (card: ChatAnswerCard, label: string): string => {
  const row = card.rows.find((held) => held.label === label);
  assert.ok(row, `a row “${label}” among: ${card.rows.map((held) => held.label).join(' | ')}`);
  return row.value;
};

/** Each shape, with the ways a project manager asks it. */
const ASKED: Record<ChatQuestionShape, string[]> = {
  papers_pending: ['What is pending from the MEP consultant?', 'what does the architect owe us', 'What have we not received?'],
  cost_changed: ['What changed in cost since last month?', 'Why did the forecast go up?'],
  schedule_late: ['Is anything running late?', 'Which milestones are behind?', 'When do we finish?'],
  needs_me: ['What is waiting on me?', 'What do I need to decide?'],
  due_this_period: ['What is due this month?', 'Which stations do we need to photograph?'],
  figure: ['What is the budget for civil works?', 'How much is certified?'],
};

/** What the chat must never say: the product's own shorthand, and the step of a file still at the land. */
const NOT_PLAIN = /priority pack|linked to a scope|\bDD\b|the reader knows|to diligence|Start the /i;

describe('a question read as one of the shapes', () => {
  it('reads each way of asking as its shape, with the party or the package it names', () => {
    for (const shape of CHAT_QUESTION_SHAPES) for (const question of ASKED[shape]) assert.equal(chatQuestionAsked(question)?.shape, shape, question);
    assert.equal(chatQuestionAsked('What is pending from the MEP consultant?')!.party, 'MEP consultant');
    assert.equal(chatQuestionAsked('what does the architect owe us')!.party, 'architect');
    assert.equal(chatQuestionAsked('What have we not received?')!.party, undefined);
    assert.deepEqual(chatQuestionAsked('What is the budget for civil works?'), { shape: 'figure', figure: 'budget', of: 'civil works' });
    assert.deepEqual(chatQuestionAsked('How much is certified?'), { shape: 'figure', figure: 'certified' });
  });

  it('reads no instruction, and no other question, as one', () => {
    for (const sentence of ['Set the budget to 5 crore', 'Add a note: the forecast went up', 'What actions are overdue?', 'How far back does the title go?', 'Generate the red flag report', 'Summarise this file', ''])
      assert.equal(chatQuestionAsked(sentence), undefined, sentence);
  });

  it('needs no model for any of them', () => {
    const p = running();
    for (const shape of CHAT_QUESTION_SHAPES) for (const question of ASKED[shape]) assert.equal(wantsDeterministicProjectChat(p, question), true, question);
    // A figure nothing here holds, and no other rule reads, is left to a model where there is one: it may be a field of a sheet.
    assert.equal(wantsDeterministicProjectChat(bare(), 'What is the budget for civil works?'), false);
  });
});

describe('each shape, with data on file', () => {
  it('answers as a card of fields: a row a figure, each with the page that holds it, and never a paragraph', () => {
    const p = running();
    for (const shape of CHAT_QUESTION_SHAPES) {
      for (const question of ASKED[shape]) {
        if (question === 'How much is certified?') continue;
        const stood = () => JSON.stringify([p.owner, p.budget, p.chatProposals, p.costReports, p.milestones, p.checklist, p.requests, p.actions, p.decisions]);
        const before = stood();
        const result = ask(p, question);
        const card = result.assistantTurn.card;
        assert.ok(card?.rows.length, `${question}: rows`);
        assert.deepEqual((result.assistantTurn.toolCalls ?? []).map((call) => call.name), [CHAT_QUESTION], question);
        for (const row of card.rows) {
          assert.equal(row.kind, 'figure', `${question}: ${row.label}`);
          assert.ok(row.open?.path.startsWith(`/projects/${p.id}`) || row.open?.path === '/requests', `${question}: ${row.label} opens the page that holds it`);
          assert.ok(row.value.length <= 220, `${question}: ${row.label} is a figure, not a paragraph`);
        }
        const [lead, ...rest] = result.assistantTurn.text.split('\n');
        assert.ok(lead!.length <= 120, `${question}: one line leads the card`);
        assert.ok(rest.every((said) => said.startsWith('- ') || said === 'Also:'), `${question}: every other line is a row`);
        assert.equal(result.assistantTurn.text, chatAnswerText(card), 'the words kept are the card’s');
        assert.doesNotMatch(result.assistantTurn.text, NOT_PLAIN, question);
        // A question changes nothing and goes nowhere.
        assert.deepEqual([result.proposals.length, result.navigations.length, result.commands.length], [0, 0, 0], question);
        assert.equal(stood(), before, `${question}: the record is as it was`);
      }
    }
  });

  it('says what a named party owes by where each paper stands, with the oldest ask', () => {
    const p = running();
    const card = cardOf(p, 'What is pending from the MEP consultant?');
    assert.deepEqual(card.rows.map((row) => row.label), ['MEP consultant · owed', 'MEP consultant · Asked for', 'MEP consultant · Not asked']);
    const asked = papersOwed(p, { now: NOW.toISOString() }).parties.find((party) => party.party === 'MEP consultant')!.lines.find((line) => line.standing === 'asked')!;
    assert.equal(valueOf(card, 'MEP consultant · Asked for'), `2 · 2 overdue · oldest asked ${daySaid(asked.askedOn!.slice(0, 10))}`);
    assert.equal(valueOf(card, 'MEP consultant · Not asked'), '1');
    assert.equal(card.rows[0]!.open!.label, 'Papers owed');
    // A party named in other words, and one the lists do not name.
    assert.deepEqual(cardOf(p, 'what does the architect owe us').rows.map((row) => row.label), ['Architect · owed', 'Architect · Asked for', 'Architect · Not asked']);
    const nobody = cardOf(p, 'What is pending from the lift vendor?');
    assert.equal(nobody.said!.lead, 'Nobody on the papers owed lists goes by “lift vendor”. Who the lists name:');
    assert.deepEqual(nobody.rows.map((row) => row.label).sort(), ['All parties · owed', 'Architect · owed', 'MEP consultant · owed', 'Nobody named · owed'].sort());
  });

  it('says what changed in cost: forecast then and now, the three largest movements with their cause, the unexplained amount', () => {
    const card = cardOf(running(), 'What changed in cost since last month?');
    assert.deepEqual(card.rows.map((row) => row.label), ['Forecast then · August 2026', 'Forecast now · September 2026', 'Change in the forecast', 'A · Civil works', 'B · Facade', 'Unexplained']);
    assert.equal(valueOf(card, 'A · Civil works'), '+₹18 lakh, ₹1 Cr to ₹1.18 Cr · Variation: Extra piling at grid C +₹6 lakh · Unexplained +₹12 lakh');
    assert.equal(valueOf(card, 'B · Facade'), '+₹2 lakh, ₹50 lakh to ₹52 lakh · Awarded at ₹52 lakh +₹2 lakh');
    assert.equal(valueOf(card, 'Unexplained'), '+₹12 lakh on 1 package');
  });

  it('says what is late or about to be, with planned and projected dates', () => {
    const card = cardOf(running(), 'Which milestones are behind?');
    assert.equal(card.said!.lead, 'From the schedule: 1 late, 1 behind.');
    assert.match(valueOf(card, 'Plinth · Late'), /^planned 1 Oct 2026 · projected \d+ \w+ 20\d\d · 60% done · 12 days late$/);
    assert.match(valueOf(card, 'First floor slab · Behind'), /^planned 20 Oct 2026 · projected \d+ \w+ 20\d\d · 30% done, expected 77% · about \d+ days late at the current rate$/);
    assert.equal(valueOf(card, 'Planned completion'), '1 Mar 2027');
  });

  it('gives a figure by name off the Cost Report, of the whole report or of the package named', () => {
    const p = running();
    assert.deepEqual(cardOf(p, 'What is the budget for civil works?').rows.map((row) => [row.label, row.value]), [['Budget · A · Civil works · September 2026', '₹1 Cr']]);
    assert.deepEqual(cardOf(p, 'What is the forecast?').rows.map((row) => [row.label, row.value]), [['Anticipated cost · all packages · September 2026', '₹1.9 Cr']]);
    assert.deepEqual(cardOf(p, 'How much is paid on civil works?').rows.map((row) => [row.label, row.value]), [['Paid · A · Civil works · September 2026', '₹42 lakh']]);
    // No bill is certified on this project: it says so, and where the nearest figure is.
    const certified = cardOf(p, 'How much is certified?');
    assert.deepEqual([certified.said!.lead, certified.rows.length, certified.look.map((item) => item.label)], ['No bill is certified on the cost register, so nothing says how much is certified.', 0, ['Cost Report']]);
    const unknown = cardOf(p, 'What is the budget for landscaping?');
    assert.equal(unknown.said!.lead, 'No package on the Cost Report goes by “landscaping”. The whole report:');
    assert.equal(unknown.rows[0]!.value, '₹1.7 Cr');
  });
});

describe('each shape, with nothing on file', () => {
  it('says so in one line and offers where it would be held, and never the first step of a file at the land', () => {
    const lead: Record<ChatQuestionShape, string> = {
      papers_pending: 'No list of papers is loaded and nothing has been asked for.',
      cost_changed: 'No Cost Report is issued yet, so nothing says what changed.',
      schedule_late: 'No schedule is on file, so nothing says what is late.',
      needs_me: 'Nothing waits for you.',
      due_this_period: 'Nothing kept by period is due, and no station waits to be photographed.',
      figure: 'No Cost Report is on file, so nothing holds that figure.',
    };
    const certified = 'No bill is certified on the cost register, so nothing says how much is certified.';
    for (const shape of CHAT_QUESTION_SHAPES) {
      for (const question of ASKED[shape]) {
        const p = bare();
        const result = ask(p, question);
        const card = result.assistantTurn.card!;
        assert.ok(card, question);
        assert.equal(card.said!.lead, question === 'How much is certified?' ? certified : lead[shape], question);
        assert.deepEqual(card.rows, [], question);
        assert.ok(card.look.length >= 1 && card.look.every((item) => item.open?.path.startsWith(`/projects/${p.id}`)), `${question}: the nearest real things, each a link`);
        assert.deepEqual([result.proposals.length, result.navigations.length, p.chatProposals.length], [0, 0, 0], `${question}: nothing is proposed and nothing moves`);
        assert.doesNotMatch(result.assistantTurn.text, NOT_PLAIN, question);
      }
    }
  });

  it('answers a builder asked directly the same way', () => {
    for (const shape of CHAT_QUESTION_SHAPES) assert.deepEqual(chatQuestionAnswer(bare(), { shape, figure: 'budget' }, { now: NOW }).card.rows, [], shape);
  });
});

describe('the chat against the screens', () => {
  it('states the figures the screen functions state, for one project', () => {
    const p = running();
    const money = (amount: number) => moneySaid(amount, p.currency);

    // Papers owed: the list as the Documents part and Overview read it.
    const owed = papersOwed(p, { now: NOW.toISOString() });
    const everyone = cardOf(p, 'What have we not received?');
    for (const party of owed.parties) {
      const said = valueOf(everyone, `${party.party ?? 'Nobody named'} · owed`);
      for (const [standing, n] of [['asked', party.asked], ['not_asked', party.notAsked], ['answered', party.answered], ['partial', party.partial]] as const) {
        const part = `${n} ${PAPER_STANDING_LABEL[standing].toLowerCase()}`;
        assert.equal(said.split(' · ').includes(part), n > 0, `${party.party}: ${part} in “${said}”`);
      }
      assert.equal(said.includes(`${party.overdue} overdue`), party.overdue > 0, `${party.party}: overdue`);
    }
    assert.ok(valueOf(everyone, 'All parties · owed').includes(`${owed.overdue} overdue`), 'the whole list’s overdue count is the list’s own');
    assert.equal(owed.overdue, 2);

    // Cost: the Cost Report's "Since last report".
    const last = p.costReports!.filter((report) => report.status === 'issued').at(-1)!;
    const comparison = costReportChanges(p, last.id)!;
    const cost = cardOf(p, 'Why did the forecast go up?');
    assert.equal(valueOf(cost, `Forecast then · ${comparison.previous.label}`), money(comparison.totals.figures.anticipatedCost.previous));
    assert.equal(valueOf(cost, `Forecast now · ${comparison.current.label}`), money(comparison.totals.figures.anticipatedCost.current));
    assert.equal(valueOf(cost, 'Change in the forecast'), `+${money(comparison.totals.figures.anticipatedCost.change)}`);
    for (const change of largestCostMovements(comparison, 3)) {
      const said = valueOf(cost, `${change.code} · ${change.name}`);
      assert.ok(said.startsWith(`+${money(change.figures.anticipatedCost.change)}, `), `${change.name}: its movement`);
      for (const cause of change.causes) assert.ok(said.includes(`+${money(cause.amount)}`), `${change.name}: what its cause accounts for`);
      assert.equal(said.includes('Unexplained'), change.unexplained !== 0, `${change.name}: unexplained`);
    }
    assert.ok(valueOf(cost, 'Unexplained').startsWith(`+${money(comparison.totals.unexplained)} `));

    // The schedule: the board's own warnings. The rehearsal's chat said none was late while the board flagged two.
    const watch = scheduleWatch(p, NOW);
    const flagged = milestonesFlagged(watch);
    assert.equal(flagged.length, 2, 'the board flags two');
    const late = cardOf(p, 'Is anything running late?');
    assert.deepEqual(
      late.rows.filter((row) => / · (?:Late|Behind|Late at the current rate)$/.test(row.label)).map((row) => row.label.split(' · ')[0]),
      flagged.map((milestone) => milestone.name),
    );
    for (const milestone of flagged) {
      const said = late.rows.find((row) => row.label.startsWith(`${milestone.name} · `))!.value;
      assert.ok(said.includes(`planned ${daySaid(milestone.plannedFinish!)}`) && said.includes(`projected ${daySaid(milestone.projectedFinish!)}`), `${milestone.name}: planned and projected, as the board has them`);
    }
    assert.equal(valueOf(late, 'Planned completion'), daySaid(watch.plannedCompletion!));
    // And Overview's line counts the same milestones.
    const slipping = projectBrief(p, NOW).find((line) => line.key === 'slipping')!;
    assert.deepEqual(slipping.parts.slice(0, 2).map((part) => part.text), ['1 late', '1 behind']);

    // What needs a person: Overview's own line, part for part.
    const needs = projectBrief(p, NOW).find((line) => line.key === 'needs')!;
    assert.ok(needs.parts.length >= 1);
    assert.deepEqual(cardOf(p, 'What is waiting on me?').rows.map((row) => row.value), needs.parts.map((part) => part.text));

    // What is due: the lines whoever issues is told of, and the stations the site app is told to shoot.
    const due = cardOf(p, 'What is due this month?');
    for (const line of periodsDue(p, NOW)) assert.equal(valueOf(due, line.title), line.said);
    const stations = stationsDue(p, NOW);
    assert.equal(stations.length, 1);
    assert.equal(valueOf(due, 'Stations to photograph'), `1: ${stations[0]!.label}`);

    // A figure by name: the Cost Report's own totals and rows.
    const totals = costReportTotals(last);
    assert.equal(cardOf(p, 'What is the budget?').rows[0]!.value, money(totals.budget));
    assert.equal(cardOf(p, 'What is the budget for civil works?').rows[0]!.value, money(last.rows.find((row) => row.name === 'Civil works')!.budget));
    assert.equal(cardOf(p, 'How much is paid?').rows[0]!.value, money(totals.amountPaid));
  });
});

describe('a place, never a change', () => {
  it('opens the owner pack for the month a sentence names', () => {
    const p = running();
    const owner = p.owner;
    const result = ask(p, 'Open the owner pack for September 2026');
    assert.deepEqual(result.navigations, [{ target: 'reports', item: `${PACK_MONTH}2026-09` }]);
    assert.equal(cockpitPath(p.id, 'reports', result.navigations[0]), `/projects/${p.id}/reports?report=${encodeURIComponent(`${PACK_MONTH}2026-09`)}`);
    assert.equal(result.assistantTurn.text, 'Reports is open with September 2026 picked for the owner pack. No pack is kept for that month yet: open it there to read and issue it.');
    assert.deepEqual(result.commands, ['Opened the owner pack for September 2026']);
    assert.deepEqual([result.proposals.length, p.chatProposals.length, p.owner], [0, 0, owner], 'the project’s owner is not offered a change');
    assert.equal(wantsDeterministicProjectChat(p, 'Open the owner pack for September 2026'), true);
    // Other ways of naming the month, and none.
    assert.deepEqual(ask(p, 'show me the owner pack for Aug 2026').navigations, [{ target: 'reports', item: `${PACK_MONTH}2026-08` }]);
    assert.deepEqual(ask(p, 'Open the owner pack for last month').navigations, [{ target: 'reports', item: `${PACK_MONTH}2026-09` }]);
    assert.deepEqual(ask(p, 'Open the owner pack').navigations.at(-1), { target: 'reports' });
  });

  it('offers no change to a record from a sentence that opens with open, show, go to or a question word', () => {
    const misses = [
      'Open the owner file for Asha Menon',
      'Show the developer agreement for Hill Builders',
      'Go to the city survey records',
      'When is the owner pack for September due',
      'Where is the site address written on the sale deed',
      'Open the budget sheet for 2026',
      'Show me the land area 5 acres drawing',
    ];
    for (const sentence of misses) {
      const p = running();
      const stood = JSON.stringify([p.owner, p.developer, p.city, p.siteAddress, p.budget, p.landAreaSqm, p.assets]);
      const result = ask(p, sentence);
      assert.deepEqual(result.proposals.filter((card) => card.kind.startsWith('patch_') || card.kind === 'add_asset' || card.kind === 'change_stage'), [], sentence);
      assert.deepEqual(p.chatProposals.filter((card) => card.kind.startsWith('patch_')), [], sentence);
      assert.equal(JSON.stringify([p.owner, p.developer, p.city, p.siteAddress, p.budget, p.landAreaSqm, p.assets]), stood, sentence);
      assert.doesNotMatch(result.assistantTurn.text, /I can apply|Update owner|→/, sentence);
    }
  });

  it('proposes a change only from a verb of change and a field the sentence names, or the field stated outright', () => {
    const offered = (sentence: string) => {
      const p = running();
      ask(p, sentence);
      return [...p.chatProposals.map((card) => (card.payload as { owner?: string } | undefined)?.owner), p.owner].filter(Boolean);
    };
    assert.ok(offered('Set owner to Priya Shah').includes('Priya Shah'));
    assert.ok(offered('The owner is Asha Menon').includes('Asha Menon'));
    for (const sentence of ['The owner pack is late again', 'The owner is asking about the cost report', 'Owner pack for September 2026']) {
      assert.deepEqual(offered(sentence).filter((name) => name !== LEAD && name !== running().owner), [], sentence);
    }
  });
});

describe('a question it cannot answer', () => {
  it('says so in one plain line and offers the nearest real things, and goes nowhere', () => {
    for (const make of [bare, running]) {
      const p = make();
      const result = ask(p, 'What did the structural consultant say about the retaining wall?');
      const card = result.assistantTurn.card!;
      assert.equal(card.said!.lead, 'I cannot answer that from what this project holds.');
      assert.deepEqual(card.rows, []);
      assert.deepEqual(card.look.map((item) => item.label), ['Papers owed (the list)', 'Cost Report (the report)', 'Progress board (the schedule)']);
      assert.ok(card.look.every((item) => item.open?.path.startsWith(`/projects/${p.id}`)));
      assert.deepEqual((result.assistantTurn.toolCalls ?? []).map((call) => call.name), [CHAT_NOT_ANSWERED]);
      assert.deepEqual([result.proposals.length, result.navigations.length, p.chatProposals.length], [0, 0, 0], 'no card is raised and no page is opened');
      assert.doesNotMatch(result.assistantTurn.text, NOT_PLAIN);
    }
  });

  it('puts the nearest thing first, and adds the sheet of the page the person is on', () => {
    const p = running();
    const card = applyProjectChat(p, 'How does the monthly pack reach the bank?', { now: NOW, place: { pane: 'workstream', fn: 'finance.budget' } }).assistantTurn.card!;
    assert.deepEqual(card.look.map((item) => item.label), ['Reports (the owner pack)', 'Papers owed (the list)', 'Cost Report (the report)', 'This page’s field sheet (the sheet)']);
  });

  it('still gives the next step to somebody who asks for it', () => {
    const result = ask(running(), 'What’s next?');
    assert.deepEqual((result.assistantTurn.toolCalls ?? []).map((call) => call.name), ['next_step']);
  });
});

describe('what the chat opens with', () => {
  it('follows the stage and what is on file: a project being built opens on what Overview opens on', () => {
    const p = running();
    const opening = chatOpening(p, NOW)!;
    const brief = projectBrief(p, NOW);
    assert.equal(opening.title, `Needs you: ${brief[0]!.parts.map((part) => part.text).join(' · ')}`);
    assert.equal(opening.hint.split('\n').length, brief.length - 1);
    assert.match(opening.hint, /^Slipping: 1 late · 1 behind/);
    assert.doesNotMatch(`${opening.title}\n${opening.hint}`, /land parcel|to diligence/i);
    assert.deepEqual(chatPrompts(p, { pane: 'overview' }), [...RUNNING_PROMPTS]);
    for (const prompt of RUNNING_PROMPTS) assert.ok(ask(p, prompt).assistantTurn.card?.rows.length, `${prompt}: one of the questions it offers is one it answers`);
  });

  it('is not the land’s first step on a project under construction with nothing else on file', () => {
    const p = bare();
    assert.equal(chatOpening(p, NOW)!.title, 'Needs you: Nothing waits for you.');
    assert.doesNotMatch(chatPrompts(p, { pane: 'overview' }).join(' '), /Land parcel/i);
  });

  it('leaves a project still at the land to its next step', () => {
    const land = createProject({ name: 'Greenfield', type: 'residential', location: 'Ring Road', city: 'Kadamba' }, 'RYT-CQ2', LEAD);
    assert.equal(chatOpening(land, NOW), undefined);
  });
});

describe('with a model', () => {
  const BASE = 'http://questions.test';
  const MODEL = 'senior/model';
  const realFetch = globalThis.fetch;
  let said: unknown[] = [];
  let runProjectChat: typeof import('../packages/agents/src/agents/project-copilot').runProjectChat;
  let instruction = '';

  before(async () => {
    process.env.REALYTICA_BASE_URL = BASE;
    process.env.REALYTICA_API_KEY = 'test-key';
    process.env.REALYTICA_MODEL_JUDGMENT = MODEL;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(BASE)) throw new Error(`a test reached for ${url}`);
      const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}');
      const body = JSON.parse(raw) as { messages: Array<{ content: unknown }> };
      const answered = body.messages.some((message) => Array.isArray(message.content) && (message.content as Array<{ type?: string }>).some((block) => block.type === 'tool_result'));
      const content = answered ? [{ type: 'text', text: '' }] : said;
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, content, stop_reason: answered ? 'end_turn' : 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const copilot = await import('../packages/agents/src/agents/project-copilot');
    runProjectChat = copilot.runProjectChat;
    instruction = copilot.PROJECT_COPILOT_INSTRUCTION;
  });

  after(() => {
    globalThis.fetch = realFetch;
    for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT']) delete process.env[name];
  });

  it('the model picks the shape and the party, and the server makes the card: a figure it writes is thrown away', async () => {
    const p = running();
    said = [
      { type: 'text', text: 'The forecast rose by ₹99 Cr because of steel.' },
      { type: 'tool_use', id: 'tu_1', name: 'answer_question', input: { shape: 'cost_changed' } },
    ];
    const cost = await runProjectChat({ project: p, question: 'Has our spend picture shifted lately?' });
    assert.equal(cost.text, chatAnswerText(chatQuestionAnswer(p, { shape: 'cost_changed' }).card));
    assert.doesNotMatch(cost.text, /99 Cr|steel/);
    assert.deepEqual(cost.card!.rows.map((row) => row.kind), ['figure', 'figure', 'figure', 'figure', 'figure', 'figure']);

    said = [{ type: 'tool_use', id: 'tu_2', name: 'answer_question', input: { shape: 'papers_pending', party: 'the MEP people' } }];
    const papers = await runProjectChat({ project: p, question: 'Anything the services designers are sitting on?' });
    assert.deepEqual(papers.card!.rows.map((row) => row.label), ['MEP consultant · owed', 'MEP consultant · Asked for', 'MEP consultant · Not asked']);

    // Somebody working from a grant is not told the firm's papers owed, whatever the model picks.
    const outside = await runProjectChat({ project: p, question: 'Anything the services designers are sitting on?', outside: true });
    assert.deepEqual(outside.card!.rows, []);
  });

  it('is told these questions are answered only that way', () => {
    assert.match(instruction, /call answer_question with the shape/);
    assert.match(instruction, /It is the only way to answer these/);
  });
});
