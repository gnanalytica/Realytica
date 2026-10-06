/**
 * Valuing a property from what its file already holds.
 *
 * The Value tab used to ask for every input by hand, beside a property screen
 * that answered a different question on a different button. These pin the
 * merged view's engine: what each input is offered from — the document and
 * its page, the state's revenue map, the surveyor's outline, a stated
 * convention — that nothing is offered the file does not hold, that the
 * figure moves with the offers before anybody accepts them, and that
 * accepting records each value exactly as typing it would: citing its
 * document, through the same proof rule.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptValueOffers,
  addEvidence,
  createProject,
  guidancePerSqm,
  parseDocumentText,
  runValuationApproaches,
  setAsideValueOffers,
  valueChecks,
  valueDrivers,
  valueInputRows,
  valueOffers,
  valueSummary,
  withValueOffers,
  type DdProject,
  type DocumentFact,
  type RevenueMapRead,
} from '@realytica/shared';

const NOW = new Date('2026-10-01T00:00:00Z');

function fact(key: string, value: string | number, page = 1, review?: DocumentFact['review']): DocumentFact {
  return { key, label: key, value, display: String(value), page, quote: `${key}: ${value}`, ...(review ? { review } : {}) };
}

/** A document on file that states these facts. */
function file(p: DdProject, title: string, documentType: string, facts: DocumentFact[]) {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  row.documentType = documentType;
  row.facts = facts;
  row.attachments = [{ id: `att_${title}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1000, storageKey: `s3://${title}`, uploadedAt: NOW.toISOString() } as never];
  return row;
}

function revenueMap(over: Partial<RevenueMapRead> = {}): RevenueMapRead {
  return {
    readAt: '2026-09-30T10:00:00Z',
    state: 'KA',
    parcelRef: 'kgis:2004030029:118/2',
    surveyNo: '118/2',
    village: 'White Field',
    mandal: 'Bangalore-East',
    district: 'Bengaluru (Urban)',
    sourceLabel: 'K-GIS cadastre',
    rings: [],
    centre: { lat: 12.97, lng: 77.75 },
    areaSqm: 1180,
    registerExtent: null,
    classification: null,
    prohibitedCategory: null,
    prohibitedRegisterUnjoined: false,
    features: [],
    factors: [],
    insights: [],
    anchor: { guidancePerUnit: 40000, unit: 'sqyd', locality: 'White Field', note: 'Kaveri guidance' },
    emptyLayers: [],
    unreadLayers: [],
    ...over,
  };
}

/** A bare plot: a recent sale deed, a khata, and the revenue map read. */
function plot(): DdProject {
  const p = createProject({ name: 'Whitefield plot', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-V1');
  file(p, 'Sale deed 2025', 'Sale deed', [
    fact('extent_title', 1200, 2),
    fact('consideration', 55000000, 3, 'proposed'),
    fact('registration_date', '2025-03-01', 1),
  ]);
  file(p, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 1180, 1)]);
  p.revenueMap = revenueMap();
  return p;
}

const best = (p: DdProject, input: string) => valueOffers(p, NOW).find((o) => o.input === input);

describe('what the file offers', () => {
  it('reads the plot area off the title first, and says where each other figure came from', () => {
    const offers = valueOffers(plot(), NOW).filter((o) => o.input === 'land_area');
    assert.deepEqual(offers.map((o) => [o.value, o.source.label]), [
      [1200, 'Sale deed'],
      [1180, 'Khata certificate and extract'],
      [1180, 'State revenue map'],
    ]);
    assert.equal(offers[0]!.source.page, 2);
    assert.match(offers[0]!.basis, /extent the title conveys/);
  });

  it('offers the parcel’s own recent sale as the comparable rate, and the guidance value as the land rate', () => {
    const p = plot();
    const rate = best(p, 'rate_per_sqm')!;
    assert.equal(Math.round(rate.value), 45833);
    assert.deepEqual(rate.with, { rate_basis: 'reported transactions', comparable_count: 1 });
    assert.equal(rate.source.page, 3, 'cites the page the consideration is on');

    const land = best(p, 'land_rate_per_sqm')!;
    assert.equal(land.source.kind, 'revenue_map');
    assert.equal(Math.round(land.value), Math.round(40000 / 0.83612736));
    assert.match(land.basis, /statutory floor, not a market rate/);
  });

  it('does not offer a sale too old to stand as a comparable', () => {
    const p = plot();
    const deed = p.evidence.find((e) => e.title === 'Sale deed 2025')!;
    deed.facts = deed.facts!.map((f) => (f.key === 'registration_date' ? { ...f, value: '2019-06-01' } : f));
    assert.equal(best(p, 'rate_per_sqm'), undefined);
  });

  it('offers nothing the file does not hold', () => {
    const p = plot();
    for (const input of ['cap_rate_pct', 'replacement_rate', 'achievable_rent', 'gdv', 'vacancy_pct']) {
      assert.equal(best(p, input), undefined, input);
    }
    const bare = createProject({ name: 'Nothing yet', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-V2');
    assert.deepEqual(valueOffers(bare, NOW), []);
  });

  it('reads a building’s age off its occupancy certificate, and its area off the sanctioned plan', () => {
    const p = createProject({ name: 'Office block', type: 'commercial', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-V3');
    file(p, 'Plan', 'Sanctioned building plan', [fact('sanctioned_area', 4200, 4)]);
    file(p, 'OC', 'Occupancy certificate', [fact('oc_date', '2014-10-01', 1)]);
    file(p, 'Lease', 'Lease deed', [fact('monthly_rent', 840000, 2), fact('leased_area', 1400, 1)]);
    const offers = valueOffers(p, NOW);
    const of = (input: string) => offers.find((o) => o.input === input);
    assert.equal(of('built_up_area')?.value, 4200);
    assert.equal(of('area_valued')?.value, 4200, 'a building is valued on its built-up area');
    assert.equal(of('effective_age_years')?.value, 12);
    assert.equal(of('expected_life_years')?.value, 60);
    assert.equal(of('expected_life_years')?.source.kind, 'convention');
    assert.equal(of('let_area')?.value, 1400);
    assert.equal(of('achievable_rent')?.value, 600, '₹8.4 lakh a month for 1,400 sqm');
    assert.equal(of('rate_per_sqm'), undefined, 'a deed for a building is not a land rate');
  });
});

describe('the figure before anything is accepted', () => {
  it('moves with the offers, and the file itself is untouched', () => {
    const p = plot();
    const rows = valueInputRows(p, valueOffers(p, NOW));
    const waiting = rows.flatMap((r) => (r.waiting ? [r.waiting] : []));
    const before = runValuationApproaches(p);
    assert.equal(before.reconciliation.outcome, 'no_approach_ran');

    const offered = runValuationApproaches(withValueOffers(p, waiting));
    assert.equal(offered.reconciliation.outcome, 'indicated');
    const comparable = offered.runs.find((r) => r.method === 'comparable_rate')!;
    assert.equal(Math.round(comparable.amount!), 55000000, '1,200 sqm at the deed’s own rate');
    assert.ok(offered.runs.find((r) => r.method === 'depreciated_replacement_cost')!.amount! > 0, 'land at the guidance rate');
    assert.equal(p.landAreaSqm, undefined, 'nothing was recorded');
    assert.equal(p.assessments.length, 0);
  });

  it('says when the file disagrees with itself', () => {
    const p = plot();
    const row = valueInputRows(p, valueOffers(p, NOW)).find((r) => r.key === 'land_area')!;
    assert.equal(row.disagree, false, '1,200 and 1,180 are within 2%');
    p.revenueMap = revenueMap({ areaSqm: 1000 });
    assert.equal(valueInputRows(p, valueOffers(p, NOW)).find((r) => r.key === 'land_area')!.disagree, true);
  });
});

describe('accepting what the file offers', () => {
  it('records each value citing where it came from, and starts the valuation DD to hold them', () => {
    const p = plot();
    const ids = ['land_area', 'area_valued', 'rate_per_sqm', 'land_rate_per_sqm'].map((k) => best(p, k)!.id);
    const out = acceptValueOffers(p, ids, 'tester');
    assert.deepEqual(out.refused, []);
    assert.equal(out.applied.length, 4);
    assert.ok(out.started, 'a valuation DD was started');
    assert.deepEqual(out.started!.scopes.map((s) => s.scopeKey), ['indicative_valuation'], 'only the valuation scope');
    assert.equal(p.landAreaSqm, 1200);
    const plotRow = valueInputRows(p, valueOffers(p, NOW)).find((r) => r.key === 'land_area')!;
    assert.equal(plotRow.recorded?.source, 'Sale deed p. 2', 'a project particular keeps the document it was taken from');

    const checks = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks));
    const comparable = checks.find((c) => c.definitionId === 'indicative_valuation.comparable_inputs')!;
    const deed = p.evidence.find((e) => e.title === 'Sale deed 2025')!;
    assert.equal(comparable.fields?.rate_per_sqm?.sourceEvidenceId, deed.id);
    assert.equal(comparable.fields?.rate_per_sqm?.page, 3);
    assert.equal(comparable.fields?.rate_basis?.value, 'reported transactions');
    assert.equal(comparable.fields?.comparable_count?.value, 1);

    const cost = checks.find((c) => c.definitionId === 'indicative_valuation.cost_inputs')!;
    const filed = p.evidence.find((e) => e.id === cost.fields?.land_rate_per_sqm?.sourceEvidenceId)!;
    assert.equal(filed.source, 'revenue_map', 'the map read was filed so the land rate can cite it');

    const consideration = deed.facts!.find((f) => f.key === 'consideration')!;
    assert.equal(consideration.review, 'accepted', 'the deed is accepted as stating the figure recorded from it');

    const working = runValuationApproaches(p);
    assert.equal(working.reconciliation.outcome, 'indicated');
  });

  it('refuses an offer the file no longer makes, and two values for one input', () => {
    const p = plot();
    const offers = valueOffers(p, NOW).filter((o) => o.input === 'land_area');
    const out = acceptValueOffers(p, ['land_area|document|ev_gone|extent_title|999', offers[0]!.id, offers[1]!.id], 'tester');
    assert.equal(out.applied.length, 1);
    assert.equal(out.refused.length, 2);
    assert.match(out.refused[0]!.error, /no longer what the file says/);
  });

  it('keeps a set-aside offer out until the file says something new', () => {
    const p = plot();
    const offer = best(p, 'land_area')!;
    assert.equal(setAsideValueOffers(p, [offer.id], 'tester'), 1);
    assert.notEqual(best(p, 'land_area')!.id, offer.id);
    const deed = p.evidence.find((e) => e.title === 'Sale deed 2025')!;
    deed.facts = deed.facts!.map((f) => (f.key === 'extent_title' ? { ...f, value: 1210 } : f));
    assert.equal(best(p, 'land_area')!.value, 1210, 'a corrected reading is a new offer');
  });
});

describe('a site bought to develop', () => {
  it('is a site, whatever its sanctioned plan says may be built', () => {
    const p = plot();
    file(p, 'Plan', 'Sanctioned building plan', [fact('sanctioned_area', 27000, 4)]);
    const offers = valueOffers(p, NOW);
    assert.equal(offers.find((o) => o.input === 'built_up_area'), undefined, 'the plan is what may stand, not what does');
    assert.equal(offers.find((o) => o.input === 'area_valued')?.value, 1200, 'valued on its extent');
    assert.equal(offers.find((o) => o.input === 'expected_life_years'), undefined);
  });
});

describe('what the figure stands on', () => {
  function valued() {
    const p = plot();
    const rows = valueInputRows(p, valueOffers(p, NOW));
    const working = runValuationApproaches(withValueOffers(p, rows.flatMap((r) => (r.waiting ? [r.waiting] : []))));
    return { p, working, summary: valueSummary(p, working) };
  }

  it('states fair market, realisable and distress values, and the guideline value beside them', () => {
    const { summary } = valued();
    assert.ok(summary.fairMarket! > 0);
    assert.equal(Math.round(summary.realisable!), Math.round(summary.fairMarket! * 0.9));
    assert.equal(Math.round(summary.distress!), Math.round(summary.fairMarket! * 0.75));
    assert.equal(Math.round(summary.guideline!.value), Math.round(guidancePerSqm({ guidancePerUnit: 40000, unit: 'sqyd', locality: null, note: '' }) * 1200));
    assert.match(summary.guideline!.published, /₹40,000 per sq yd, White Field/);
    assert.ok(summary.vsGuideline! < 0.1 && summary.vsGuideline! > -0.1);
  });

  it('checks what a lender checks, worst first', () => {
    const { p, working, summary } = valued();
    p.revenueMap = revenueMap({ areaSqm: 1000, prohibitedCategory: 'Government land' });
    const checks = valueChecks(p, working, summary);
    assert.equal(checks[0]!.verdict, 'blocker');
    const byKey = new Map(checks.map((c) => [c.key, c]));
    assert.equal(byKey.get('prohibited')!.verdict, 'blocker');
    assert.equal(byKey.get('extents_agree')!.verdict, 'blocker', '1,000 against 1,200 is past 15%');
    assert.match(byKey.get('extents_agree')!.detail, /1,200 sqm \(Sale deed p\. 2\)/);
    assert.ok(byKey.has('approaches_agree'));
  });

  it('names the drivers, and which of them the figure already carries', () => {
    const { p, working } = valued();
    p.karnataka = { jurisdiction: 'gram_panchayat', khataType: 'b_khata', eKhataIssued: false, landConversionStatus: 'converted', areaBasis: 'carpet' } as DdProject['karnataka'];
    p.revenueMap = revenueMap({ factors: [{ code: 'lake_buffer', label: 'Lake buffer', direction: 'down', severity: 'high', headline: 'Within 30 m of a lake.', detail: '', impactLowPct: -20, impactHighPct: -5, layerKey: 'water', source: 'K-GIS water bodies', distanceM: 30 }] });
    const drivers = valueDrivers(p, working);
    const byKey = new Map(drivers.map((d) => [d.key, d]));
    assert.deepEqual(byKey.get('map:lake_buffer')!.impact, { low: -20, high: -5 });
    assert.equal(byKey.get('map:lake_buffer')!.applied, false);
    assert.equal(byKey.get('b_khata')!.impact!.low, -12);
    assert.equal(byKey.get('gram_panchayat')!.direction, 'down');
  });
});

describe('reading a lease', () => {
  it('finds the rent, the area let and when it starts', () => {
    const read = parseDocumentText([
      'LEASE DEED\nThis Lease Deed is made between the Lessor and the Lessee.\nThe Lessor lets the premises admeasuring 15,070 sq ft on the third floor.\nThe Lessee shall pay a monthly rent of Rs. 9,04,200 commencing from 01/04/2025.',
    ], 'lease.pdf');
    assert.equal(read.type, 'lease');
    const byKey = new Map(read.facts.map((f) => [f.key, f]));
    assert.equal(byKey.get('monthly_rent')?.value, 904200);
    assert.equal(Math.round(Number(byKey.get('leased_area')?.value)), 1400);
    assert.equal(byKey.get('lease_start')?.value, '2025-04-01');
  });
});
