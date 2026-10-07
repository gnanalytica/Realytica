/**
 * What the chat's message box takes, and what becomes of a message that did
 * not go.
 *
 * A file reaches the box by the paperclip, the camera, the microphone, a drop
 * on the chat or a paste. One message takes ten, and a file that was dropped
 * or pasted is held to the kinds the paperclip offers. Whatever is left out
 * is said, so nothing goes missing without a word. A send that failed or was
 * stopped is looked for in the thread before its words are handed back, and
 * the read that looks for it is not laid over a later copy of the project.
 *
 * And three rules of the thread over the box: when it is followed to its
 * foot, which reply a plan is drawn under, and which messages a plan's steps
 * said and no person typed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLAN_SAID, PLAN_STEP } from '@realytica/shared';
import { FILES_AT_MOST, FILE_KINDS, boxAfter, chatTakes, composing, leftOutSaid, pasteIsFiles, stageFiles } from '../apps/web/src/components/chat/carried-question';
import { followsThread, laidOver, planDrawnUnder, planStepAsks, saysPlanCancelled, turnKept } from '../apps/web/src/components/chat/chat-list';

const file = (name: string, type = ''): { name: string; type: string } => ({ name, type });
const pdfs = (n: number, from = 1): Array<{ name: string; type: string }> => Array.from({ length: n }, (_, i) => file(`paper-${from + i}.pdf`, 'application/pdf'));

describe('the kinds of file the chat takes', () => {
  it('takes what the paperclip offers, by the end of the name or by being a picture or sound', () => {
    assert.ok(chatTakes(file('Sale_Deed.PDF', 'application/pdf')), 'capitals in a name change nothing');
    assert.ok(chatTakes(file('khata.xlsx')), 'a name is enough where the browser gives no type');
    assert.ok(chatTakes(file('image', 'image/png')), 'a pasted screenshot is a picture whatever it is called');
    assert.ok(chatTakes(file('IMG_2041.HEIC', 'image/heic')), 'any picture');
    assert.ok(chatTakes(file('note', 'audio/amr')), 'any sound');
  });

  it('does not take the rest', () => {
    assert.equal(chatTakes(file('bundle.zip', 'application/zip')), false);
    assert.equal(chatTakes(file('Title papers')), false, 'a folder has no kind');
    assert.equal(chatTakes(file('walkthrough.mp4', 'video/mp4')), false);
    assert.equal(chatTakes(file('pdf')), false, 'the name has to end in the kind, dot and all');
  });

  it('is the list the picker is given', () => {
    for (const kind of FILE_KINDS.split(',').filter((k) => k.startsWith('.'))) assert.ok(chatTakes(file(`x${kind}`)), kind);
  });
});

describe('files added to the ones waiting to go', () => {
  it('stages what fits and counts what did not', () => {
    const took = stageFiles(pdfs(4), pdfs(9, 5));
    assert.equal(took.files.length, FILES_AT_MOST);
    assert.equal(took.files[0]!.name, 'paper-1.pdf', 'what was already waiting stays first');
    assert.equal(took.files.at(-1)!.name, 'paper-10.pdf', 'and the new ones follow in the order they came');
    assert.equal(took.over, 3);
    assert.deepEqual(took.wrongKind, []);
  });

  it('leaves out a dropped file of a kind the paperclip does not offer, and names it', () => {
    const took = stageFiles([], [file('bundle.zip', 'application/zip'), file('deed.pdf', 'application/pdf')]);
    assert.deepEqual(took.files.map((f) => f.name), ['deed.pdf']);
    assert.deepEqual(took.wrongKind, ['bundle.zip']);
    assert.equal(took.over, 0);
  });

  it('does not count a file of the wrong kind against the ten', () => {
    const took = stageFiles(pdfs(9), [file('bundle.zip'), file('deed.pdf')]);
    assert.equal(took.files.length, 10);
    assert.equal(took.over, 0);
  });

  it('takes what the picker gave as it is, and still keeps to ten', () => {
    const took = stageFiles(pdfs(9), [file('slides.pptx'), file('more.pptx')], true);
    assert.equal(took.files.at(-1)!.name, 'slides.pptx', 'the picker has already let the person choose');
    assert.deepEqual(took.wrongKind, []);
    assert.equal(took.over, 1);
  });

  it('changes neither list it was given', () => {
    const staged = pdfs(2);
    const added = pdfs(2, 3);
    stageFiles(staged, added);
    assert.equal(staged.length, 2);
    assert.equal(added.length, 2);
  });

  it('does not take a file that is already waiting, and names it', () => {
    const site = { name: 'site.png', type: 'image/png', size: 4096, lastModified: 1_700_000_000_000 };
    const deed = { name: 'deed.pdf', type: 'application/pdf', size: 9000, lastModified: 1_700_000_001_000 };
    const took = stageFiles([deed, site], [{ ...site }]);
    assert.deepEqual(took.files, [deed, site], 'the same name, size and date is the same file');
    assert.deepEqual(took.twice, ['site.png']);
    assert.equal(took.over, 0, 'it is not counted against the ten');
    assert.deepEqual(stageFiles([site], [{ ...site }], true).twice, ['site.png'], 'chosen through the picker too');
  });

  it('takes a file of the same name that is another file', () => {
    const site = { name: 'site.png', type: 'image/png', size: 4096, lastModified: 1_700_000_000_000 };
    assert.equal(stageFiles([site], [{ ...site, size: 5000 }]).files.length, 2, 'another size');
    assert.equal(stageFiles([site], [{ ...site, lastModified: 1_700_000_009_000 }]).files.length, 2, 'another date');
  });

  it('takes one of two the same that came together', () => {
    const site = { name: 'site.png', type: 'image/png', size: 4096, lastModified: 1_700_000_000_000 };
    const took = stageFiles([], [site, { ...site }]);
    assert.equal(took.files.length, 1);
    assert.deepEqual(took.twice, ['site.png']);
  });
});

describe('what was left out, said under the box', () => {
  it('says nothing when everything was taken', () => {
    assert.equal(leftOutSaid({ wrongKind: [], over: 0 }), null);
  });

  it('says how many did not fit', () => {
    assert.equal(leftOutSaid({ wrongKind: [], over: 1 }), '1 file was left out. One message takes 10.');
    assert.equal(leftOutSaid({ wrongKind: [], over: 3 }), '3 files were left out. One message takes 10.');
  });

  it('names one file of the wrong kind, and counts several', () => {
    assert.equal(leftOutSaid({ wrongKind: ['bundle.zip'], over: 0 }), 'bundle.zip was left out. The chat does not take that kind of file.');
    assert.equal(leftOutSaid({ wrongKind: ['a.zip', 'b.zip'], over: 0 }), '2 files were left out. The chat does not take their kind.');
  });

  it('says both when both happened', () => {
    assert.equal(leftOutSaid({ wrongKind: ['bundle.zip'], over: 2 }), 'bundle.zip was left out. The chat does not take that kind of file. 2 more files were left out. One message takes 10.');
  });

  it('says a file is already attached, by name for one and by count for several', () => {
    assert.equal(leftOutSaid({ wrongKind: [], over: 0, twice: ['site.png'] }), 'site.png is already attached.');
    assert.equal(leftOutSaid({ wrongKind: [], over: 0, twice: ['site.png', 'deed.pdf'] }), '2 of these files are already attached.');
    assert.equal(leftOutSaid({ wrongKind: ['bundle.zip'], over: 0, twice: ['site.png'] }), 'site.png is already attached. bundle.zip was left out. The chat does not take that kind of file.');
  });
});

describe('words handed to the box', () => {
  it('go in as they are when the box is empty', () => {
    assert.equal(boxAfter('', 'What is the extent?'), 'What is the extent?');
    assert.equal(boxAfter('  \n', 'What is the extent?'), 'What is the extent?');
  });

  it('go over what was typed since, and neither is lost', () => {
    assert.equal(boxAfter('and the khata number', 'What is the extent?'), 'What is the extent?\nand the khata number');
  });

  it('are not put there twice', () => {
    assert.equal(boxAfter('What is the extent?', 'What is the extent?'), 'What is the extent?');
    assert.equal(boxAfter('What is the extent?\nand more', 'What is the extent?'), 'What is the extent?\nand more');
  });

  it('leave the box alone when there are none', () => {
    assert.equal(boxAfter('typed', ''), 'typed', 'a send handed back with files only');
  });
});

describe('a paste into the box', () => {
  it('is a file when the clipboard holds one and no formatted words', () => {
    assert.ok(pasteIsFiles({ files: 1, text: '', types: ['Files'] }), 'a screenshot');
    assert.ok(pasteIsFiles({ files: 1, text: '', types: ['text/html', 'Files'] }), 'a picture copied from a page: markup, and no words');
    assert.ok(pasteIsFiles({ files: 1, text: 'Sale_Deed.pdf', types: ['text/plain', 'Files'] }), 'a file copied from a folder, with its name');
  });

  it('is words when it is formatted text with a picture of itself', () => {
    assert.equal(pasteIsFiles({ files: 1, text: 'Sy. No. 118/2', types: ['text/plain', 'text/html', 'Files'] }), false);
    assert.equal(pasteIsFiles({ files: 1, text: '11,850 sqm', types: ['text/plain', 'text/rtf', 'Files'] }), false);
  });

  it('is words when there is no file', () => {
    assert.equal(pasteIsFiles({ files: 0, text: 'What is the extent?', types: ['text/plain'] }), false);
  });
});

describe('a key pressed while an input method is composing', () => {
  it('belongs to the input method', () => {
    assert.ok(composing({ isComposing: true, keyCode: 13 }));
    assert.ok(composing({ isComposing: false, keyCode: 229 }), 'some browsers say it only by the key code');
  });

  it('is the person’s own otherwise', () => {
    assert.equal(composing({ isComposing: false, keyCode: 13 }), false);
    assert.equal(composing({}), false);
  });
});

describe('a send that failed or was stopped', () => {
  const had = new Set(['t1', 't2']);
  const before = [
    { id: 't1', role: 'user', sessionId: 'ses_a' },
    { id: 't2', role: 'assistant', sessionId: 'ses_a' },
  ];

  it('was not kept when the thread holds nothing new of this sitting', () => {
    assert.equal(turnKept(before, had, 'ses_a'), undefined);
    assert.equal(turnKept([...before, { id: 't3', role: 'user', sessionId: 'ses_other' }], had, 'ses_a'), undefined, 'a colleague’s message is not this one');
    assert.equal(turnKept([...before, { id: 't3', role: 'assistant', sessionId: 'ses_a' }], had, 'ses_a'), undefined, 'a note the server wrote is not the message');
    assert.equal(turnKept([...before, { id: 't3', role: 'user' }], had, 'ses_a'), undefined, 'a turn of no sitting is not this one');
  });

  it('was kept when the person’s own new turn is there', () => {
    assert.equal(turnKept([...before, { id: 't3', role: 'user', sessionId: 'ses_a' }], had, 'ses_a')?.id, 't3');
  });

  it('is found under the id the server made from the one the page sent', () => {
    assert.equal(turnKept([...before, { id: 't3', role: 'user', sessionId: 'ses_a~1f2e3d4c' }], had, 'ses_a')?.id, 't3');
    assert.equal(turnKept([...before, { id: 't3', role: 'user', sessionId: 'ses_ab' }], had, 'ses_a'), undefined, 'an id that only begins the same way is another sitting');
  });
});

describe('the read made after a send was stopped', () => {
  const thread = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  const read = { updatedAt: '2026-10-07T10:00:02.000Z', conversation: thread, settled: 0 };

  it('is laid over the page’s copy when the page’s is no later', () => {
    const held = { updatedAt: '2026-10-07T10:00:00.000Z', conversation: thread.slice(0, 2), settled: 0 };
    assert.equal(laidOver(held, read, 't3'), read);
    assert.equal(laidOver({ ...read, conversation: thread.slice(0, 2) }, read, 't3'), read, 'made at the same moment, the read is the one with the message');
  });

  it('is not laid over a later copy: a value decided since Stop stays decided', () => {
    const held = { updatedAt: '2026-10-07T10:00:03.000Z', conversation: thread, settled: 1 };
    assert.equal(laidOver(held, read, 't3'), held);
  });

  it('gives a later copy its thread when that copy does not hold the message', () => {
    const held = { updatedAt: '2026-10-07T10:00:03.000Z', conversation: thread.slice(0, 2), settled: 1 };
    assert.deepEqual(laidOver(held, read, 't3'), { ...held, conversation: thread });
    const none = { updatedAt: '2026-10-07T10:00:03.000Z', settled: 1 };
    assert.deepEqual(laidOver<{ updatedAt: string; conversation?: Array<{ id: string }>; settled: number }>(none, read, 't3'), { ...none, conversation: thread }, 'a copy with no thread at all');
  });
});

describe('the thread followed to its foot', () => {
  it('is followed while the person is at the foot', () => {
    assert.equal(followsThread(false, { top: 600, lastTop: 580, fromFoot: 0 }), true);
    assert.equal(followsThread(true, { top: 590, lastTop: 600, fromFoot: 10 }), true, 'a few pixels short is still the foot');
  });

  it('stops when the person scrolls up to read', () => {
    assert.equal(followsThread(true, { top: 300, lastTop: 600, fromFoot: 300 }), false);
  });

  it('stays as it was while the thread moves down', () => {
    assert.equal(followsThread(true, { top: 400, lastTop: 300, fromFoot: 200 }), true, 'on its way to the foot');
    assert.equal(followsThread(false, { top: 400, lastTop: 300, fromFoot: 200 }), false, 'the person coming part of the way back');
  });
});

describe('the reply a plan is drawn under', () => {
  const said = (id: string, text: string, planId?: string): { id: string; role: string; text: string; planId?: string } => ({ id, role: 'assistant', text, ...(planId ? { planId } : {}) });
  const shown = said('a1', 'That is 2 steps, so nothing has started. The plan:\n1. Write the status.\n2. Write the report.', 'run_1');

  it('is the last one on screen that names it', () => {
    const started = said('a2', 'Running the plan: 2 steps.', 'run_1');
    const done = said('a3', 'The plan is done: 2 of 2 steps done.', 'run_1');
    assert.deepEqual([...planDrawnUnder([shown, { id: 'u1', role: 'user', text: 'Run the plan' }, started, said('a9', 'A reply about something else.'), done])], [['a3', 'run_1']]);
  });

  it('is the reply that showed it when the last one only says it was cancelled', () => {
    const cancelled = said('a2', 'The plan is cancelled. Nothing was done.', 'run_1');
    assert.deepEqual([...planDrawnUnder([shown, { id: 'u1', role: 'user', text: 'Cancel the plan' }, cancelled])], [['a1', 'run_1']]);
    const lastStepOut = said('a2', 'That was its only step, so the plan is cancelled. Nothing was done.', 'run_1');
    assert.deepEqual([...planDrawnUnder([shown, lastStepOut])], [['a1', 'run_1']]);
  });

  it('is the cancelling reply when no other on screen names the plan', () => {
    const cancelled = said('a2', 'The plan is cancelled. Nothing was done.', 'run_1');
    assert.deepEqual([...planDrawnUnder([cancelled])], [['a2', 'run_1']], 'the card under it then draws nothing: the reply says so');
  });

  it('keeps each plan apart, and leaves one that had run under the reply that lists what it did', () => {
    const other = said('b1', 'That touches a lot, so nothing has started. The plan:\n1. Read 14 filed papers.', 'run_2');
    const left = said('a4', 'The plan was cancelled: 1 of 2 steps done. What was done stays done.\n1. Write the status. Done: written.\n2. Write the report. Not run.', 'run_1');
    assert.deepEqual([...planDrawnUnder([shown, other, left])].sort(), [['a4', 'run_1'], ['b1', 'run_2']]);
  });

  it('reads a cancelled plan from the reply’s own words', () => {
    assert.ok(saysPlanCancelled('The plan is cancelled. Nothing was done.'));
    assert.ok(saysPlanCancelled('That was its only step, so the plan is cancelled. Nothing was done.'));
    assert.equal(saysPlanCancelled('The plan was cancelled: 1 of 2 steps done. What was done stays done.'), false);
    assert.equal(saysPlanCancelled('The plan has not started.'), false);
  });
});

describe('the messages a plan’s steps said', () => {
  type Turn = { id: string; role: string; text: string; toolCalls?: { name: string }[] };
  const person = (id: string, text: string): Turn => ({ id, role: 'user', text });
  const reply = (id: string, text: string, tool?: string): Turn => ({ id, role: 'assistant', text, ...(tool ? { toolCalls: [{ name: tool }] } : {}) });
  const run: Turn[] = [
    person('u1', 'Run the plan'),
    reply('a1', 'Running the plan: 2 steps.', PLAN_SAID),
    person('u2', 'Write the status for September 2026'),
    reply('a2', 'Nothing changed in the period, so no report was written.', 'status_report'),
    reply('a3', 'Step 1 of 2 done. Write the status for September 2026: nothing changed.', PLAN_STEP),
    person('u3', 'generate the red flag report'),
    reply('a4', 'Ready to generate the red flag report.'),
    reply('a5', 'Step 2 of 2 done. Put the red flag report on a card.', PLAN_STEP),
    reply('a6', 'The plan is done: 2 of 2 steps done.', PLAN_SAID),
  ];

  it('are the ones followed by their reply and then the line that ticks the step off', () => {
    assert.deepEqual([...planStepAsks(run)], [['u2', { step: 1, of: 2 }], ['u3', { step: 2, of: 2 }]]);
  });

  it('are not the person’s own: the press that ran the plan, or a question asked after it', () => {
    const asks = planStepAsks([...run, person('u4', 'What is the extent?'), reply('a7', '12,000 square metres.')]);
    assert.equal(asks.has('u1'), false);
    assert.equal(asks.has('u4'), false);
  });

  it('are not a small job done at once, whose reply is the plan’s own line', () => {
    assert.equal(planStepAsks([person('u1', 'Read the filed title papers'), reply('a1', 'Read 3 papers.', PLAN_STEP)]).size, 0);
  });

  it('are not a question whose reply came before a step that said nothing to the chat was ticked off', () => {
    const reading = [person('u1', 'What is the extent?'), reply('a1', '12,000 square metres.'), reply('n1', 'Read the khata.'), reply('a2', 'Step 1 of 2 done. Read 14 filed papers: 14 read.', PLAN_STEP)];
    assert.equal(planStepAsks(reading).size, 0, 'the tick does not follow the reply directly');
  });
});
