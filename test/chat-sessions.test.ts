/**
 * A thread that runs forever is not history.
 *
 * Opening a file worked on for a week dropped you at the bottom of every
 * exchange anybody had ever had about it. The panel was never empty, the
 * scrollback had no floor, and the least visible part of it was the useful
 * part — what am I doing now.
 *
 * A session is one sitting. Opening the project starts a new one, so the
 * panel is empty and the past is somewhere you go. Turns written before the
 * field existed group by the silences between them, so a project that
 * predates this still gets a usable history rather than one blob.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatSessions, type ProjectChatTurn } from '@realytica/shared';

let n = 0;
const at = (iso: string): string => iso;
const turn = (
  role: 'user' | 'assistant',
  text: string,
  when: string,
  extra: Partial<ProjectChatTurn> = {},
): ProjectChatTurn =>
  ({ id: `t${(n += 1)}`, role, text, at: at(when), citedEvidenceIds: [], ...extra }) as ProjectChatTurn;

/** The pair a work-pane edit writes: never a conversation anybody had. */
const echo = (summary: string, when: string): ProjectChatTurn[] => [
  turn('user', summary, when),
  turn('assistant', 'Recorded.', when, { toolCalls: [{ name: 'pane_write', summary }] }),
];

describe('chatSessions', () => {
  it('groups by sessionId and returns newest first', () => {
    const sessions = chatSessions([
      turn('user', 'is the title clean?', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('assistant', 'Two encumbrances.', '2026-09-05T09:00:05.000Z', { sessionId: 'a' }),
      turn('user', 'what is the stamp duty?', '2026-09-05T14:00:00.000Z', { sessionId: 'b' }),
      turn('assistant', '5% plus cess.', '2026-09-05T14:00:04.000Z', { sessionId: 'b' }),
    ]);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0]!.id, 'b', 'the newest sitting is first');
    assert.equal(sessions[0]!.title, 'what is the stamp duty?');
    assert.equal(sessions[1]!.title, 'is the title clean?');
    assert.equal(sessions[1]!.turns.length, 2);
  });

  it('splits legacy turns on a long silence, not on every message', () => {
    const sessions = chatSessions([
      turn('user', 'morning question', '2026-09-05T09:00:00.000Z'),
      turn('assistant', 'answer', '2026-09-05T09:00:03.000Z'),
      turn('user', 'follow up', '2026-09-05T09:04:00.000Z'),
      turn('assistant', 'answer', '2026-09-05T09:04:03.000Z'),
      // Six hours later — a different piece of work.
      turn('user', 'evening question', '2026-09-05T15:30:00.000Z'),
      turn('assistant', 'answer', '2026-09-05T15:30:02.000Z'),
    ]);
    assert.equal(sessions.length, 2, 'one gap, two sittings');
    assert.equal(sessions[0]!.title, 'evening question');
    assert.equal(sessions[1]!.turns.length, 4, 'the morning exchange stays whole');
  });

  it('never lists a sitting made only of the work pane recording itself', () => {
    const sessions = chatSessions([
      ...echo('Recorded 1 value on “Replacement cost”.', '2026-09-05T09:00:00.000Z'),
      ...echo('Recorded 1 value on “Land rate”.', '2026-09-05T09:01:00.000Z'),
    ]);
    assert.deepEqual(sessions, [], 'clicking through a sheet is not a conversation');
  });

  it('titles a sitting by what the person opened with, not by the reply', () => {
    const sessions = chatSessions([
      turn('assistant', 'Read 6 files.', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('user', 'here are the NOCs', '2026-09-05T09:00:10.000Z', { sessionId: 'a' }),
      turn('assistant', 'Filed 6 cards.', '2026-09-05T09:00:20.000Z', { sessionId: 'a' }),
    ]);
    assert.equal(sessions[0]!.title, 'here are the NOCs');
  });

  it('trims a long opening line rather than letting it set the width', () => {
    const long = 'here are the RERA certificate, the environmental clearance, the four utility NOCs and the encumbrance certificates for the whole layout';
    const sessions = chatSessions([turn('user', long, '2026-09-05T09:00:00.000Z', { sessionId: 'a' })]);
    assert.ok(sessions[0]!.title.length <= 60, sessions[0]!.title);
    assert.ok(sessions[0]!.title.endsWith('…'));
  });

  it('holds a session together across a long pause once it has an id', () => {
    // A stored id is a statement of intent and beats the gap heuristic: somebody
    // who left a question open over lunch is still in the same sitting.
    const sessions = chatSessions([
      turn('user', 'is the title clean?', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('user', 'and the khata?', '2026-09-05T18:00:00.000Z', { sessionId: 'a' }),
    ]);
    assert.equal(sessions.length, 1);
  });

  it('returns nothing for an empty thread', () => {
    assert.deepEqual(chatSessions([]), []);
  });
});
