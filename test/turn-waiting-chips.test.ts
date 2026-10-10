import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TurnChip } from '@realytica/shared';
import { WAITING_CHIPS_SHOWN, visibleTurnChips } from '../apps/web/src/pages/projects/cockpit/turn-waiting-chips';

function waiting(key: string, count: number, words = key): TurnChip {
  return { key, kind: 'waiting', count, words };
}

describe('visibleTurnChips', () => {
  it('shows every waiting chip when there are at most two', () => {
    const chips = [waiting('a', 3), waiting('b', 1)];
    assert.deepEqual(visibleTurnChips(chips, false), { shown: chips, hiddenWaiting: 0 });
    assert.equal(WAITING_CHIPS_SHOWN, 2);
  });

  it('folds to the top two by count and reports how many places hide', () => {
    const chips = [
      waiting('tax', 15),
      waiting('title', 130),
      waiting('approvals', 68),
      waiting('checks', 2),
    ];
    const { shown, hiddenWaiting } = visibleTurnChips(chips, false);
    assert.deepEqual(
      shown.map((chip) => [chip.key, chip.count]),
      [
        ['title', 130],
        ['approvals', 68],
      ],
    );
    assert.equal(hiddenWaiting, 2);
  });

  it('expands to every waiting place, still ranked by count', () => {
    const chips = [waiting('tax', 15), waiting('title', 130), waiting('approvals', 68)];
    const { shown, hiddenWaiting } = visibleTurnChips(chips, true);
    assert.deepEqual(
      shown.map((chip) => chip.key),
      ['title', 'approvals', 'tax'],
    );
    assert.equal(hiddenWaiting, 0);
  });

  it('keeps filed and graph chips after the waiting ones when folded', () => {
    const chips: TurnChip[] = [
      waiting('title', 10),
      waiting('approvals', 5),
      waiting('tax', 3),
      { key: 'filed|title', kind: 'filed', words: 'Title documents' },
      { key: 'graph', kind: 'graph', words: 'In the graph' },
    ];
    const { shown, hiddenWaiting } = visibleTurnChips(chips, false);
    assert.deepEqual(
      shown.map((chip) => chip.key),
      ['title', 'approvals', 'filed|title', 'graph'],
    );
    assert.equal(hiddenWaiting, 1);
  });
});
