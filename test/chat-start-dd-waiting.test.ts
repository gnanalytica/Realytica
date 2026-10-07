/**
 * A due diligence asked for in the chat while its own card already waits.
 *
 * The chat raises a card to start a DD and takes it at once. When a card that
 * says the same was already waiting, the new one is not added, and taking it
 * by its own id threw: "Proposal not found". Nothing in the route caught that,
 * so one message took the server down.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProjectChat, createProject, startDdFromQuestion, type DdProject } from '@realytica/shared';

const project = (): DdProject => createProject({ name: 'Whitefield plot', type: 'commercial', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-S1');

describe('starting a due diligence whose card already waits', () => {
  it('starts it from the card that waits, and does not throw', () => {
    const p = project();
    const waiting = startDdFromQuestion(p, 'Start a technical DD', 'asha@firm.in');
    assert.ok(waiting, 'the sentence names a due diligence to start');
    p.chatProposals.push(waiting);
    const before = p.assessments.length;

    const result = applyProjectChat(p, 'Start a technical DD', { actor: 'asha@firm.in' });

    assert.equal(p.assessments.length, before + 1, 'one due diligence was started');
    assert.match(result.assistantTurn.text, /is now on the project/);
    assert.equal(p.chatProposals.filter((card) => card.kind === 'start_dd' && card.status === 'proposed').length, 0, 'no card to start it is left waiting');
    assert.equal(p.chatProposals.find((card) => card.id === waiting.id)?.status, 'committed', 'the card that waited is the one taken');
  });
});
