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
import { CHAT_NAME_MAX, DROPPED_WITHOUT_WORDS, applyProjectChat, chatSessions, renameChatSession, seedBdaReferenceProject, type ProjectChatTurn, type WaitingEntry } from '@realytica/shared';
import { carriedQuestion } from '../apps/web/src/components/chat/carried-question';
import { SEARCH_CHATS_PAST, chatDay, chatRows, liveChatId, liveTurns, mayDeleteChats, mintSitting, searchChats, sittingKept, waitingElsewhere } from '../apps/web/src/components/chat/chat-list';

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

/**
 * Earlier chats are somewhere to go, so they have to be findable.
 *
 * A chat is named by its first question until a person names it, it says the
 * page it began on, and it can be picked up again. Each of those is a field
 * added to a turn, read by this code and skipped by code that does not know
 * it: the id of a sitting still means one opening of the project.
 */
describe('finding an earlier chat', () => {
  const title = { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'pre_development' };

  it('joins a sitting that carries on an earlier chat to the end of that chat', () => {
    const sessions = chatSessions([
      turn('user', 'is the title clean?', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('assistant', 'Two encumbrances.', '2026-09-05T09:00:05.000Z', { sessionId: 'a' }),
      turn('user', 'what is the stamp duty?', '2026-09-06T09:00:00.000Z', { sessionId: 'b' }),
      turn('user', 'and the second encumbrance?', '2026-09-08T10:00:00.000Z', { sessionId: 'c', continues: 'a' }),
      turn('assistant', 'A mortgage of 2014.', '2026-09-08T10:00:04.000Z', { sessionId: 'c', continues: 'a' }),
    ]);
    assert.deepEqual(sessions.map((x) => x.id), ['a', 'b'], 'the chat last spoken in is first, under its own id');
    assert.deepEqual(sessions[0]!.turns.map((t) => t.text), ['is the title clean?', 'Two encumbrances.', 'and the second encumbrance?', 'A mortgage of 2014.']);
    assert.equal(sessions[0]!.title, 'is the title clean?', 'it keeps the question it opened with');
    assert.equal(sessions[0]!.startedAt, '2026-09-05T09:00:00.000Z');
    assert.equal(sessions[0]!.lastAt, '2026-09-08T10:00:04.000Z');
  });

  it('follows a chat carried on more than once, and one that began before sittings had ids', () => {
    const sessions = chatSessions([
      turn('user', 'morning question', '2026-09-05T09:00:00.000Z'),
      turn('user', 'picked up', '2026-09-06T09:00:00.000Z', { sessionId: 'b', continues: 'ses:2026-09-05T09:00:00.000Z' }),
      turn('user', 'and again', '2026-09-07T09:00:00.000Z', { sessionId: 'c', continues: 'b' }),
    ]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.id, 'ses:2026-09-05T09:00:00.000Z');
    assert.equal(sessions[0]!.turns.length, 3);
  });

  it('reads a sitting whose turns are not side by side as one chat', () => {
    // Two people on one project at once: their turns interleave in the thread.
    const sessions = chatSessions([
      turn('user', 'mine', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('user', 'theirs', '2026-09-05T09:00:30.000Z', { sessionId: 'b' }),
      turn('user', 'mine again', '2026-09-05T09:01:00.000Z', { sessionId: 'a' }),
    ]);
    assert.deepEqual(sessions.map((x) => [x.id, x.turns.length]), [['a', 2], ['b', 1]]);
  });

  it('does not loop on a chat that carries on itself', () => {
    const sessions = chatSessions([
      turn('user', 'one', '2026-09-05T09:00:00.000Z', { sessionId: 'a', continues: 'b' }),
      turn('user', 'two', '2026-09-05T09:01:00.000Z', { sessionId: 'b', continues: 'a' }),
    ]);
    assert.equal(sessions.reduce((n, x) => n + x.turns.length, 0), 2, 'every turn is in a chat, once');
  });

  it('keeps the page a chat began on', () => {
    const sessions = chatSessions([
      turn('user', 'is the title clean?', '2026-09-05T09:00:00.000Z', { sessionId: 'a', place: title }),
      turn('user', 'and the approvals?', '2026-09-05T09:05:00.000Z', { sessionId: 'a', place: { ...title, fn: 'legal.approvals' } }),
      turn('user', 'from before the chat knew', '2026-09-06T09:00:00.000Z', { sessionId: 'b' }),
    ]);
    assert.deepEqual(sessions.find((x) => x.id === 'a')!.place, title);
    assert.equal(sessions.find((x) => x.id === 'b')!.place, undefined);
  });

  it('names a chat on its first turn, and hands it back to its first question', () => {
    const turns = [
      turn('user', 'is the title clean?', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('assistant', 'Two encumbrances.', '2026-09-05T09:00:05.000Z', { sessionId: 'a' }),
      turn('user', 'what is the stamp duty?', '2026-09-06T09:00:00.000Z', { sessionId: 'b' }),
    ];
    const named = renameChatSession(turns, 'a', '  Title   questions for the advocate ');
    assert.equal(named?.name, 'Title questions for the advocate');
    assert.equal(turns[0]!.sessionName, 'Title questions for the advocate', 'on the first turn of the chat');
    assert.equal(turns.filter((t) => t.sessionName).length, 1, 'and nowhere else');
    assert.equal(chatSessions(turns).find((x) => x.id === 'a')!.name, 'Title questions for the advocate');
    assert.equal(chatSessions(turns).find((x) => x.id === 'a')!.title, 'is the title clean?', 'the first question is still there');
    assert.equal(chatSessions(turns).find((x) => x.id === 'b')!.name, undefined);
    // Named again, the new name replaces the old; an empty one takes the name off.
    assert.equal(renameChatSession(turns, 'a', 'x'.repeat(200))?.name?.length, CHAT_NAME_MAX);
    assert.equal(renameChatSession(turns, 'a', '   ')?.name, undefined);
    assert.equal(turns.some((t) => 'sessionName' in t && t.sessionName), false);
    assert.equal(renameChatSession(turns, 'nobody', 'x'), undefined, 'a chat that is not in the thread is not named');
  });

  it('names only a chat the person can see', () => {
    // A collaborator's thread holds their own turns. A chat that is not in it is not theirs to name.
    const mine = [turn('user', 'mine', '2026-09-05T09:00:00.000Z', { sessionId: 'a', actor: 'sam@site.in' })];
    const all = [...mine, turn('user', 'the developer’s', '2026-09-05T10:00:00.000Z', { sessionId: 'b', actor: 'dev@firm.in' })];
    assert.equal(renameChatSession(mine, 'b', 'renamed by a contractor'), undefined);
    assert.equal(all[1]!.sessionName, undefined);
    assert.equal(renameChatSession(mine, 'a', 'Site questions')?.name, 'Site questions');
  });
});

describe('the list of chats', () => {
  const thread = [
    turn('user', 'is the title clean?', '2026-09-05T09:00:00.000Z', { sessionId: 'a', place: { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'pre_development' } }),
    turn('assistant', 'Two encumbrances.', '2026-09-05T09:00:05.000Z', { sessionId: 'a' }),
    turn('user', 'what is the stamp duty?', '2026-09-06T09:00:00.000Z', { sessionId: 'b', sessionName: 'Stamp duty' }),
    turn('assistant', 'Read the deed.', '2026-09-07T09:00:00.000Z'),
    turn('user', 'and now?', '2026-09-07T09:01:00.000Z', { sessionId: 'c' }),
  ];
  const sessions = chatSessions(thread);

  it('shows this sitting’s turns, with what the file wrote during it', () => {
    const live = liveTurns(thread, sessions, { sessionId: 'c', startedAt: '2026-09-07T08:59:00.000Z' });
    assert.deepEqual(live.map((t) => t.text), ['Read the deed.', 'and now?'], 'a turn that names no sitting belongs to the chat open when it was written');
    assert.deepEqual(liveTurns(thread, sessions, { sessionId: 'new', startedAt: '2026-09-08T00:00:00.000Z' }), [], 'a new chat opens empty');
    assert.equal(liveTurns(thread, sessions, {}).length, thread.length, 'a caller that mints no sitting sees the whole thread');
  });

  it('shows the earlier chat a sitting carries on, with what is added to it', () => {
    const carried = [...thread, turn('user', 'and the second one?', '2026-09-08T09:00:00.000Z', { sessionId: 'd', continues: 'a' })];
    const live = liveTurns(carried, chatSessions(carried), { sessionId: 'd', startedAt: '2026-09-08T08:59:00.000Z', continues: 'a' });
    assert.deepEqual(live.map((t) => t.text), ['is the title clean?', 'Two encumbrances.', 'and the second one?']);
    // Before anything is added, the chat carried on is already the one on screen.
    assert.equal(liveTurns(thread, sessions, { sessionId: 'd', startedAt: '2026-09-08T08:59:00.000Z', continues: 'a' }).length, 2);
  });

  it('lists the chat on screen first, then the earlier ones by when they were last spoken in', () => {
    const live = liveTurns(thread, sessions, { sessionId: 'c', startedAt: '2026-09-07T08:59:00.000Z' });
    const rows = chatRows(sessions, live, 'c');
    assert.deepEqual(rows.map((r) => [r.id, r.current]), [['c', true], ['b', false], ['a', false]]);
    assert.deepEqual(rows.map((r) => r.title), ['and now?', 'Stamp duty', 'is the title clean?']);
    assert.deepEqual(rows.map((r) => r.named), [false, true, false]);
    assert.equal(rows[2]!.place, 'Title · Land', 'the page it began on, with the stage it was looked at in');
    assert.equal(rows[1]!.place, undefined, 'a chat from before the chat knew says none');
    // The note the file wrote during this sitting is on screen already, and is not offered as a chat to go back to.
    assert.equal(rows.some((r) => r.id.startsWith('ses:')), false);
    // A new chat with nothing in it has no row of its own.
    assert.equal(chatRows(sessions, [], 'new').some((r) => r.current), false);
  });

  it('finds a chat by its name, the page it began on, or its day', () => {
    const rows = chatRows(sessions, [], 'new');
    const now = new Date('2026-10-05T00:00:00.000Z');
    assert.deepEqual(searchChats(rows, 'stamp', now).map((r) => r.id), ['b']);
    assert.deepEqual(searchChats(rows, 'TITLE land', now).map((r) => r.id), ['a'], 'every word typed, in any order of case');
    assert.deepEqual(searchChats(rows, '5 sep', now).map((r) => r.id), ['a']);
    assert.equal(searchChats(rows, 'nothing like it', now).length, 0);
    assert.equal(searchChats(rows, '  ', now).length, rows.length);
    assert.ok(SEARCH_CHATS_PAST >= 8, 'the search waits until there are more chats than fit at a glance');
  });

  it('still shows what is said after the chat it carried on is gone', () => {
    // The thread was cleared while the sitting carried on chat "a". The server joins nothing to a chat it cannot find.
    const after = [
      turn('user', 'what is next?', '2026-09-09T09:00:00.000Z', { sessionId: 'd' }),
      turn('assistant', 'The encumbrance certificate.', '2026-09-09T09:00:05.000Z', { sessionId: 'd' }),
    ];
    const sitting = { sessionId: 'd', startedAt: '2026-09-08T08:59:00.000Z', continues: 'a' };
    const cleared = chatSessions(after);
    assert.deepEqual(liveTurns(after, cleared, sitting).map((t) => t.text), ['what is next?', 'The encumbrance certificate.']);
    assert.equal(liveChatId(cleared, sitting), 'd', 'the chat on screen is the sitting itself');
    assert.deepEqual(chatRows(cleared, liveTurns(after, cleared, sitting), liveChatId(cleared, sitting)).map((r) => [r.id, r.current]), [['d', true]], 'and it is not listed as some other chat');
    // While the chat carried on is there, it is the one on screen.
    assert.equal(liveChatId(sessions, sitting), 'a');
  });

  it('counts as waiting from earlier only what the chat on screen does not show', () => {
    const entries = [
      { kind: 'card', pane: 'scope', count: 2, proposalId: 'p-old' },
      { kind: 'facts', pane: 'evidence', count: 3, evidenceId: 'ev-old' },
      { kind: 'card', pane: 'scope', count: 1, proposalId: 'p-new' },
    ] as unknown as WaitingEntry[];
    const carried = [
      turn('user', 'here is the khata', '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('assistant', 'Read the khata.', '2026-09-05T09:00:05.000Z', { sessionId: 'a', proposalIds: ['p-old'], citedEvidenceIds: ['ev-old'] }),
      turn('user', 'and this one', '2026-09-08T09:00:00.000Z', { sessionId: 'd', continues: 'a' }),
      turn('assistant', 'Read it.', '2026-09-08T09:00:05.000Z', { sessionId: 'd', continues: 'a', proposalIds: ['p-new'] }),
    ];
    const all = chatSessions(carried);
    // Carrying the earlier chat on, its cards are on screen with it.
    assert.deepEqual(waitingElsewhere(entries, liveTurns(carried, all, { sessionId: 'd', startedAt: '2026-09-08T08:59:00.000Z', continues: 'a' })), []);
    // In a new chat they are what is still waiting from earlier.
    assert.deepEqual(waitingElsewhere(entries, liveTurns(carried, all, { sessionId: 'e', startedAt: '2026-09-09T00:00:00.000Z' })).map((e) => e.count), [2, 3, 1]);
  });

  it('names a chat that opens with papers dropped in by what was read', () => {
    const p = seedBdaReferenceProject();
    applyProjectChat(p, '', { ingest: [{ fileName: 'Minutes.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 's3://minutes' }] });
    assert.equal(p.conversation[0]!.text, DROPPED_WITHOUT_WORDS, 'the turn is kept as it always was');
    assert.equal(chatSessions(p.conversation)[0]!.title, 'Read 1 file');

    const read = chatSessions([
      turn('user', DROPPED_WITHOUT_WORDS, '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('assistant', 'Read the DC conversion order.\nFiled under Legal › Approvals, at the Land stage.', '2026-09-05T09:00:05.000Z', { sessionId: 'a', toolCalls: [{ name: 'ingest', summary: 'Filed 1 file' }] }),
    ]);
    assert.equal(read[0]!.title, 'Read the DC conversion order');
    // A reply that opens on why nothing was read is no name, and neither is a reply to something else.
    const unread = chatSessions([
      turn('user', DROPPED_WITHOUT_WORDS, '2026-09-05T09:00:00.000Z', { sessionId: 'a' }),
      turn('assistant', 'The file could not be read. Approving still files it on the register, unread.', '2026-09-05T09:00:05.000Z', { sessionId: 'a', toolCalls: [{ name: 'ingest', summary: 'Filed 1 file' }] }),
    ]);
    assert.equal(unread[0]!.title, 'Documents dropped in');
    // Typed by a person, the same words are their own.
    const typed = chatSessions([turn('user', `${DROPPED_WITHOUT_WORDS} yesterday`, '2026-09-05T09:00:00.000Z', { sessionId: 'a' })]);
    assert.equal(typed[0]!.title, `${DROPPED_WITHOUT_WORDS} yesterday`);
  });

  it('says a chat’s day, with the year once it is another one', () => {
    // "Sep" or "Sept": the month's short name is the runtime's own.
    assert.match(chatDay('2026-09-05T09:00:00.000Z', new Date('2026-10-05T00:00:00.000Z')), /^5 Sept?$/);
    assert.match(chatDay('2025-09-05T09:00:00.000Z', new Date('2026-10-05T00:00:00.000Z')), /2025/);
    assert.equal(chatDay('not a date'), '');
  });
});

describe('a question carried in an address', () => {
  it('waits in the message box, and leaves the address without it', () => {
    const carried = carriedQuestion(new URLSearchParams('stage=land&ask=What%20is%20missing%3F&part=documents'));
    assert.equal(carried?.text, 'What is missing?');
    assert.equal(carried?.rest.toString(), 'stage=land&part=documents', 'the rest of the address stays');
    assert.equal(carriedQuestion(new URLSearchParams('stage=land')), null);
    assert.equal(carriedQuestion(new URLSearchParams('ask=%20%20')), null, 'nothing but spaces is no question');
    assert.equal(carriedQuestion(new URLSearchParams(`ask=${'a'.repeat(5000)}`))?.text.length, 4000, 'cut to what a message holds');
  });
});

describe('a sitting', () => {
  it('is minted with an id no other page mints in the same moment', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintSitting('prj_example_1').id));
    assert.equal(ids.size, 200, 'two hundred in one tick, each its own');
    const sitting = mintSitting('prj_example_1', 'ses_earlier');
    assert.match(sitting.id, /^ses_mple_1_[a-z0-9]+$/);
    assert.deepEqual([sitting.project, sitting.continues], ['prj_example_1', 'ses_earlier']);
    assert.equal(mintSitting('prj_example_1').continues, undefined);
  });

  it('takes the id the server kept its turns under, so what was said stays on screen', () => {
    const sitting = { project: 'p', id: 'ses_a', startedAt: '2026-09-08T08:59:00.000Z' };
    // The id sent was already somebody else's: the reply's turn carries the one this person's turns were kept under.
    const kept = sittingKept(sitting, { userTurn: { sessionId: 'ses_a~1f2e3d4c' } });
    assert.equal(kept.id, 'ses_a~1f2e3d4c');
    const thread = [
      turn('user', 'theirs', '2026-09-08T09:00:00.000Z', { sessionId: 'ses_a', actor: 'one@example.test' }),
      turn('user', 'mine', '2026-09-08T09:01:00.000Z', { sessionId: 'ses_a~1f2e3d4c', actor: 'two@example.test' }),
    ];
    const mine = thread.filter((t) => t.actor === 'two@example.test');
    assert.deepEqual(liveTurns(mine, chatSessions(mine), { sessionId: kept.id, startedAt: kept.startedAt }).map((t) => t.text), ['mine']);
    assert.deepEqual(liveTurns(mine, chatSessions(mine), { sessionId: sitting.id, startedAt: sitting.startedAt }), [], 'under the id it sent, none of it showed');

    // Kept as sent, or a reply to a sitting since left: nothing changes.
    assert.equal(sittingKept(sitting, { userTurn: { sessionId: 'ses_a' } }), sitting);
    assert.equal(sittingKept(sitting, { userTurn: {} }), sitting);
    assert.equal(sittingKept(sitting, { userTurn: { sessionId: 'ses_older~1f2e3d4c' } }), sitting);
  });
});

describe('deleting every chat', () => {
  it('is offered to the firm’s own people who can change things, and to nobody else', () => {
    assert.deepEqual(
      (['owner', 'manager', 'staff', 'viewer', 'collaborator'] as const).map((role) => mayDeleteChats(role)),
      [true, true, true, false, false],
    );
    assert.equal(mayDeleteChats(undefined), false, 'not before it is known who is signed in');
  });
});
