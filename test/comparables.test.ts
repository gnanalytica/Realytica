/**
 * Comparables: the evidence a market rate rests on.
 *
 * These pin the parts that are not network — what a price or an area on a
 * listing says, the CMA arithmetic, what a search keeps and ranks, how a
 * project becomes a search without its owner or survey number leaving the
 * file, why an empty search came back empty — and how the register feeds the
 * comparable approach: offered as a rate, recorded citing the schedule it was
 * drawn from, with asking prices said to be asking prices.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptValueOffers,
  addComparable,
  buildComparableQuery,
  comparableAdjustedRate,
  comparableSchedule,
  createProject,
  decideComparables,
  explainEmptySearch,
  mergeComparableSearch,
  normaliseListings,
  parseAreaSqm,
  parseIndianPrice,
  runValuationApproaches,
  scoreComparables,
  updateComparable,
  valueChecks,
  valueOffers,
  valueSummary,
  withValueOffers,
  type ComparableQuery,
  type ComparableSearchDiagnostics,
  type DdProject,
  type RawListing,
} from '@realytica/shared';

const SITE = { lat: 12.9698, lng: 77.75 };

function plot(): DdProject {
  const p = createProject({ name: 'Whitefield plot', type: 'residential', location: 'White Field, K R Pura Hobli', city: 'Bengaluru', siteAddress: 'Sy. No. 118/2, White Field, Bengaluru 560066' }, 'RYT-CMP');
  p.siteCoordinate = SITE;
  p.landAreaSqm = 1200;
  p.saleableAreaSqm = 1200;
  return p;
}

function listing(over: Partial<RawListing> = {}): RawListing {
  return {
    source: '99acres',
    sourceUrl: `https://www.99acres.com/plot-${Math.random().toString(36).slice(2)}`,
    title: 'Residential Plot · White Field',
    point: { lat: SITE.lat + 0.004, lng: SITE.lng },
    price: 60_000_000,
    areaSqm: 1100,
    areaBasis: 'plot',
    bhk: null,
    subtype: 'Residential Plot',
    listedOn: '2026-09-01',
    isProjectAd: false,
    ...over,
  };
}

describe('what a listing says', () => {
  it('reads Indian prices: crores, lakhs, ranges and grouped rupees', () => {
    assert.equal(parseIndianPrice('2.6 Cr'), 26_000_000);
    assert.equal(parseIndianPrice('2.6  - 2.72 Cr'), 26_600_000);
    assert.equal(parseIndianPrice('45 Lacs'), 4_500_000);
    assert.equal(parseIndianPrice('₹ 1,20,00,000'), 12_000_000);
    assert.equal(parseIndianPrice('nothing'), null);
  });

  it('reads areas in every unit a listing uses, into square metres', () => {
    assert.equal(Math.round(parseAreaSqm('1200 sqft')!), 111);
    assert.equal(Math.round(parseAreaSqm('150 sq.yd')!), 125);
    assert.equal(Math.round(parseAreaSqm(2, 'acres')!), 8094);
    assert.equal(Math.round(parseAreaSqm('2450-2560 sq.ft.')!), 233, 'a range is its midpoint');
  });
});

describe('the CMA arithmetic', () => {
  it('adjusts each comparable to the subject and weights the schedule', () => {
    const p = plot();
    const a = addComparable(p, { title: 'Plot, Sy. 120', price: 60_000_000, areaSqm: 1200, kind: 'transaction', adjustments: { time: 5 }, weight: 1 }, 'tester');
    addComparable(p, { title: 'Plot, Sy. 121', price: 55_000_000, areaSqm: 1100, kind: 'transaction', weight: 3 }, 'tester');
    assert.equal(comparableAdjustedRate(a), 52_500, '50,000 a sqm, five per cent on for time');
    const s = comparableSchedule(p)!;
    assert.equal(s.count, 2);
    assert.equal(Math.round(s.rawRate), 50_000);
    assert.equal(Math.round(s.adjustedRate), Math.round((52_500 + 50_000 * 3) / 4));
    assert.equal(s.basis, 'reported transactions');
  });

  it('names the portal a pasted link is from', () => {
    const p = plot();
    const c = addComparable(p, { title: 'Plot', price: 10_000_000, areaSqm: 100, kind: 'listing', sourceUrl: 'https://www.magicbricks.com/propertyDetails/abc' }, 'tester');
    assert.equal(c.source, 'magicbricks');
    assert.equal(addComparable(p, { title: 'Plot', price: 10_000_000, areaSqm: 100 }, 'tester').source, 'valuer');
  });

  it('refuses an adjustment past ±60%, and a comparable with no price', () => {
    const p = plot();
    assert.throws(() => addComparable(p, { title: 'x', price: 0, areaSqm: 100 }, 'tester'), /price/);
    const c = addComparable(p, { title: 'Plot', price: 1_000_000, areaSqm: 100 }, 'tester');
    assert.throws(() => updateComparable(p, c.id, { adjustments: { location: 75 } }, 'tester'), /not a comparable/);
  });
});

describe('a search', () => {
  it('drops builder adverts and duplicates, and keeps a mistyped area out of the rate', () => {
    const same = listing({ sourceUrl: 'https://www.99acres.com/a' });
    const pool = normaliseListings([
      same,
      { ...same, source: 'magicbricks', sourceUrl: 'https://www.magicbricks.com/a' },
      listing({ isProjectAd: true }),
      listing({ point: { lat: SITE.lat + 0.01, lng: SITE.lng } }),
      listing({ point: { lat: SITE.lat + 0.011, lng: SITE.lng } }),
      listing({ point: { lat: SITE.lat + 0.012, lng: SITE.lng } }),
      listing({ point: { lat: SITE.lat + 0.013, lng: SITE.lng }, areaSqm: 25 }),
    ]);
    assert.equal(pool.projectAdsDropped, 1);
    assert.equal(pool.duplicatesDropped, 1);
    assert.equal(pool.rateOutliersDropped, 1, 'a plot of 25 sqm at that price is a typo');
    assert.equal(pool.kept.length, 4);
  });

  it('ranks by distance, size and type, and keeps what is too far out', () => {
    const q: ComparableQuery = { subclass: 'residential_plot', point: SITE, city: 'Bangalore', localityCandidates: ['White Field'], cityCandidates: ['Bangalore'], bhk: null, targetAreaSqm: 1200, targetAreaBasis: 'plot', radiusKm: 3 };
    const near = listing({ sourceUrl: 'near', point: { lat: SITE.lat + 0.003, lng: SITE.lng } });
    const far = listing({ sourceUrl: 'far', point: { lat: SITE.lat + 0.2, lng: SITE.lng } });
    const flat = listing({ sourceUrl: 'flat', subtype: '3 BHK Flat', areaBasis: 'super_builtup', bhk: 3, areaSqm: 150, price: 15_000_000 });
    const ranked = scoreComparables(q, normaliseListings([far, flat, near]).kept, { nowMs: Date.parse('2026-10-02') });
    assert.deepEqual(ranked.map((r) => r.candidate.sourceUrl), ['near', 'flat'], '22 km out is not a comparable, and a flat ranks below a plot');
  });

  it('is built from the locality and city alone, and never names the survey number', () => {
    const built = buildComparableQuery(plot(), false);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.query.subclass, 'residential_plot');
    assert.deepEqual(built.query.localityCandidates, ['White Field', 'K R Pura']);
    assert.deepEqual(built.query.cityCandidates, ['Bangalore'], 'Bengaluru is filed as Bangalore');
    assert.ok(!JSON.stringify(built.query.localityCandidates).includes('118'), 'no survey number leaves the file');
    const nowhere = plot();
    nowhere.siteCoordinate = undefined;
    assert.equal(buildComparableQuery(nowhere, false).ok, false, 'no point, nothing to rank distance from');
  });

  it('says why it came back empty: the vendor, the locality, or the market', () => {
    const base: ComparableSearchDiagnostics = {
      bySource: { '99acres': { fetched: 0, error: false, pagesResolved: 1 }, magicbricks: { fetched: 0, error: false, pagesResolved: 1 } },
      projectAdsDropped: 0,
      duplicatesDropped: 0,
      rateOutliersDropped: 0,
      candidatesConsidered: 0,
      radiusKmUsed: 3,
      radiusWidened: false,
      nearestKm: null,
      resolvedLocalities: [],
      resolverUnavailable: false,
    };
    assert.match(explainEmptySearch(base), /quiet market/);
    assert.match(explainEmptySearch({ ...base, bySource: { ...base.bySource, magicbricks: { fetched: 0, error: true, pagesResolved: 0 } } }), /could not be reached.*nothing about the market/);
    assert.match(explainEmptySearch({ ...base, candidatesConsidered: 4, nearestKm: 6.2 }), /nearest is 6\.2 km/);
    assert.match(explainEmptySearch({ ...base, bySource: { '99acres': { fetched: 0, error: false, pagesResolved: 0 } } }), /recognised/);
  });

  it('lands as proposed, keeps what a person set aside, and drops what it no longer finds', () => {
    const p = plot();
    const q = buildComparableQuery(p, false);
    assert.ok(q.ok);
    if (!q.ok) return;
    const search = { at: '2026-10-02T10:00:00Z', by: 'tester', localities: ['White Field'], cities: ['Bangalore'], radiusKm: 3, subclass: q.query.subclass, found: 3, diagnostics: {} as ComparableSearchDiagnostics };
    // Three different plots: the same point, area and price would be one plot listed three times.
    const at = (n: number) => ({ lat: SITE.lat + 0.002 * n, lng: SITE.lng });
    const first = scoreComparables(q.query, normaliseListings([listing({ sourceUrl: 'a', point: at(1) }), listing({ sourceUrl: 'b', point: at(2) }), listing({ sourceUrl: 'c', point: at(3) })]).kept, { nowMs: Date.parse('2026-10-02') });
    mergeComparableSearch(p, first, search, 'tester');
    assert.equal(p.comparables!.length, 3);
    assert.ok(p.comparables!.every((c) => c.status === 'proposed' && c.kind === 'listing'));
    const b = p.comparables!.find((c) => c.sourceUrl === 'b')!;
    decideComparables(p, [b.id], 'reject', 'tester');
    const second = scoreComparables(q.query, normaliseListings([listing({ sourceUrl: 'b', point: at(2) }), listing({ sourceUrl: 'd', point: at(4) })]).kept, { nowMs: Date.parse('2026-10-02') });
    mergeComparableSearch(p, second, { ...search, found: 2 }, 'tester');
    assert.deepEqual(p.comparables!.map((c) => [c.sourceUrl, c.status]).sort(), [['b', 'rejected'], ['d', 'proposed']]);
  });
});

describe('the register in the valuation', () => {
  function listed(): DdProject {
    const p = plot();
    for (const [url, price] of [['a', 66_000_000], ['b', 60_000_000], ['c', 63_000_000]] as const) {
      addComparable(p, { source: '99acres', kind: 'listing', title: `Plot ${url}`, price, areaSqm: 1200, sourceUrl: `https://www.99acres.com/${url}` }, 'tester');
    }
    return p;
  }

  it('offers the schedule’s rate as the comparable rate, and says the listings are asking prices', () => {
    const p = listed();
    const offer = valueOffers(p).find((o) => o.input === 'rate_per_sqm')!;
    assert.equal(offer.source.kind, 'comparables');
    assert.equal(Math.round(offer.value), 52_500);
    assert.match(offer.basis, /All are asking prices with no listing discount set/);
    assert.equal(offer.with?.rate_basis, 'portal listings (asking prices)');
    const check = valueChecks(p, runValuationApproaches(p), valueSummary(p, runValuationApproaches(p))).find((c) => c.key === 'comparables')!;
    assert.equal(check.verdict, 'attention');
  });

  it('carries the listing discount into the figure, and records the rate citing the schedule', () => {
    const p = listed();
    for (const c of p.comparables!) updateComparable(p, c.id, { adjustments: { listing: -10 } }, 'tester');
    const offers = valueOffers(p);
    const rate = offers.find((o) => o.input === 'rate_per_sqm')!;
    const net = offers.find((o) => o.input === 'net_adjustment_pct')!;
    assert.equal(net.value, -10);
    const provisional = runValuationApproaches(withValueOffers(p, [rate]));
    assert.equal(Math.round(provisional.runs.find((r) => r.method === 'comparable_rate')!.amount!), Math.round(1200 * 52_500 * 0.9));

    const out = acceptValueOffers(p, [rate.id], 'tester');
    assert.deepEqual(out.refused, []);
    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'indicative_valuation.comparable_inputs')!;
    const filed = p.evidence.find((e) => e.id === check.fields?.rate_per_sqm?.sourceEvidenceId)!;
    assert.equal(filed.source, 'comparables');
    assert.match(filed.description ?? '', /https:\/\/www\.99acres\.com\/a/);
    assert.deepEqual(check.fields?.comparable_schedule?.value, [filed.id]);
    assert.equal(check.fields?.net_adjustment_pct?.value, -10);
    assert.equal(check.fields?.comparable_count?.value, 3);
    assert.ok(p.comparables!.every((c) => c.status === 'accepted'));
  });
});
