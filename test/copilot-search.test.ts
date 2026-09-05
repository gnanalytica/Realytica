/**
 * The copilot had thirty-three tools and none of them looked anything up.
 *
 * Search existed twice over — in the explorer agent, and behind a keyword
 * intent on the deterministic path — so "what is the going rate in Balagere"
 * reached it only if the sentence happened to trip a regex, and never as
 * something the model could decide to do halfway through an answer.
 *
 * What is pinned here is the shape of the answer rather than the search. A
 * market rate off a listing site is a commercial signal, not a record on this
 * file, and the difference has to survive the trip through chat: hits arrive
 * as cards somebody approves, never as prose the model can quote a figure out
 * of. A figure that reaches an answer without passing through a card is one
 * the attribution checker will rightly flag as unsupported.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProject, webSignalCards, type ChatWebPull, type DdProject } from '@realytica/shared';

const project = (): DdProject =>
  createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');

const pull = (hits: ChatWebPull['hits']): ChatWebPull => ({ enabled: true, query: 'rates — Balagere, Bengaluru', hits });

describe('web hits become cards, not claims', () => {
  it('files a hit as a low commercial finding a person must approve', () => {
    const cards = webSignalCards(
      project(),
      pull([{ title: 'Balagere rates up 8%', claim: 'Listings average ₹7,400/sqft.', url: 'https://example.com/x' }] as never),
      'operator',
    );
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.kind, 'add_finding');
    assert.equal(cards[0]!.status, 'proposed', 'nothing lands without approval');
    assert.equal(cards[0]!.payload.severity, 'low');
    assert.equal(cards[0]!.payload.discipline, 'commercial_market');
  });

  it('keeps the source on the card so the claim can be checked', () => {
    const cards = webSignalCards(
      project(),
      pull([{ title: 'Metro phase 2', claim: 'Line opens 2027.', url: 'https://example.com/metro' }] as never),
      'operator',
    );
    assert.match(String(cards[0]!.payload.description), /https:\/\/example\.com\/metro/);
    assert.match(String(cards[0]!.payload.description), /Search: rates/, 'the query that found it is part of the record');
  });

  it('marks a hit with no URL as unverified rather than dropping it', () => {
    const cards = webSignalCards(project(), pull([{ title: 'Absorption', claim: 'Six months of stock.' }] as never), 'operator');
    assert.match(cards[0]!.rationale, /unverified/i);
    assert.match(String(cards[0]!.payload.description), /No source URL/i);
  });

  it('never claims a web signal is a statutory record', () => {
    const cards = webSignalCards(project(), pull([{ title: 'Rates', claim: '₹7,400/sqft.', url: 'https://x.test' }] as never), 'operator');
    assert.match(cards[0]!.impact, /not a statutory record/i);
  });

  it('caps what one search can queue', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Hit ${i}`, claim: 'x', url: 'https://x.test' }));
    assert.equal(webSignalCards(project(), pull(many as never), 'operator').length, 4, 'a search is not a bulk import');
  });
});
