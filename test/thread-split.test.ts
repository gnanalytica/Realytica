/**
 * Two logs, not one.
 *
 * Every work-pane edit writes a synthetic user turn and a one-word reply, so
 * the conversation panel was showing the file's own edit history as though
 * somebody had said it. Measured on the seeded project: twenty-four turns,
 * twenty-four of them echoes, nothing anybody typed — a quarter of the screen
 * replaying your own clicks.
 *
 * The rule canvas-style tools follow and this did not: editing the document
 * does not post a message. What is pinned here is the partition itself — an
 * echo never reaches the chat, a real exchange never gets filed as activity,
 * and the pair collapses to one entry rather than two bubbles.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupActivity, splitThread, hasSpokenConversation, type DdProject, type ProjectChatTurn } from '@realytica/shared';

let n = 0;
const turn = (role: 'user' | 'assistant', text: string, toolCalls?: { name: string; summary: string }[]): ProjectChatTurn =>
  ({ id: `t${(n += 1)}`, role, text, at: `2026-09-04T10:0${n}:00.000Z`, ...(toolCalls ? { toolCalls } : {}) }) as ProjectChatTurn;

/** The pair `noteProjectEdit` writes for one work-pane edit. */
const paneWrite = (summary: string): ProjectChatTurn[] => [
  turn('user', summary),
  turn('assistant', 'Recorded.', [{ name: 'pane_write', summary }]),
];

describe('splitThread', () => {
  it('files a pane-write pair as one activity entry, not two bubbles', () => {
    const { conversation, activity } = splitThread(paneWrite('Recorded 1 value on “Replacement cost”.'));
    assert.equal(conversation.length, 0, 'an echo is not conversation');
    assert.equal(activity.length, 1, 'the pair collapses to one entry');
    assert.match(activity[0].summary, /Replacement cost/);
    // The summary is the half that says what changed. "Recorded." is not it.
    assert.notEqual(activity[0].summary, 'Recorded.');
  });

  it('keeps a real exchange in the conversation', () => {
    const asked = [turn('user', 'What is the khata status?'), turn('assistant', 'B-khata, per the extract on file.')];
    const { conversation, activity } = splitThread(asked);
    assert.equal(conversation.length, 2);
    assert.equal(activity.length, 0);
  });

  it('separates them when both are present, in order', () => {
    const turns = [
      ...paneWrite('Recorded 1 value on “Finance rate”.'),
      turn('user', 'Why is the band so wide?'),
      turn('assistant', 'Only one approach ran.'),
      ...paneWrite('Recorded 1 value on “Build period”.'),
    ];
    const { conversation, activity } = splitThread(turns);
    assert.deepEqual(conversation.map((t) => t.text), ['Why is the band so wide?', 'Only one approach ran.']);
    assert.deepEqual(activity.map((a) => a.summary), [
      'Recorded 1 value on “Finance rate”.',
      'Recorded 1 value on “Build period”.',
    ]);
  });

  it('does not swallow a user turn whose reply merely mentions a tool', () => {
    // Only `pane_write` marks an echo. An answer that used a retrieval tool is
    // still an answer, and losing it out of the chat would be the worse bug.
    const turns = [
      turn('user', 'Find the sale deed.'),
      turn('assistant', 'Here it is.', [{ name: 'retrieve', summary: 'searched evidence' }]),
    ];
    const { conversation, activity } = splitThread(turns);
    assert.equal(conversation.length, 2);
    assert.equal(activity.length, 0);
  });

  it('leaves a trailing user turn in the conversation', () => {
    // A question in flight has no reply yet, and must not be mistaken for the
    // first half of an echo.
    const { conversation } = splitThread([turn('user', 'Is this B-khata?')]);
    assert.equal(conversation.length, 1);
  });

  it('handles an empty thread', () => {
    assert.deepEqual(splitThread([]), { conversation: [], activity: [] });
  });
});

describe('hasSpokenConversation', () => {
  it('agrees with the split, so the rail and the chat cannot disagree', () => {
    const echoes = { conversation: paneWrite('Recorded 1 value.') } as unknown as DdProject;
    assert.equal(hasSpokenConversation(echoes), false);

    const spoken = {
      conversation: [...paneWrite('Recorded 1 value.'), turn('user', 'Why?')],
    } as unknown as DdProject;
    assert.equal(hasSpokenConversation(spoken), true);
  });
});

describe('groupActivity', () => {
  it('says a repeated entry once, with a count', () => {
    // Filling one card of the input sheet writes a turn per field, so the log
    // carried the same sentence eight times in a row.
    const { activity } = splitThread([
      ...paneWrite('Recorded 1 value on “Residual inputs”.'),
      ...paneWrite('Recorded 1 value on “Residual inputs”.'),
      ...paneWrite('Recorded 1 value on “Residual inputs”.'),
    ]);
    const grouped = groupActivity(activity);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].count, 3);
  });

  it('stamps a run with its most recent member', () => {
    const { activity } = splitThread([...paneWrite('Recorded.'), ...paneWrite('Recorded.')]);
    const grouped = groupActivity(activity);
    assert.equal(grouped[0].at, activity[activity.length - 1].at, 'a log answers "what happened last"');
  });

  it('does not merge across an intervening entry', () => {
    // Two edits to the same check either side of another are two occasions,
    // and merging them would misreport the order somebody worked in.
    const { activity } = splitThread([
      ...paneWrite('Recorded on A.'),
      ...paneWrite('Recorded on B.'),
      ...paneWrite('Recorded on A.'),
    ]);
    assert.deepEqual(groupActivity(activity).map((g) => [g.summary, g.count]), [
      ['Recorded on A.', 1],
      ['Recorded on B.', 1],
      ['Recorded on A.', 1],
    ]);
  });
});
