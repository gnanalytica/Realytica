/**
 * The schematic yield.
 *
 * The assertions that matter here are about honesty, not arithmetic: that the
 * road width caps the FAR when it should, that an absent road width is
 * flagged rather than assumed away, and that a project with nothing to build
 * gets no yield at all rather than a zeroed one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildBoundary } from '@realytica/shared';
import type { ProjectBrief, ProjectKind } from '@realytica/shared';
import { NOW, screenSeed } from './fixtures';

const SITE = 'Site No. 42';
const APARTMENT = '3BHK — Prestige Lakeside';

function brief(kind: ProjectKind): ProjectBrief {
  return {
    kind,
    source: 'user',
    intent: 'buy_and_build',
    inference: { kind, confidence: 1, basis: ['stated'], alternatives: [] },
    decidedAt: NOW,
  };
}

/** A site big enough to carry a scheme, with a stated road width. */
function scheme(roadWidthFt?: number, plotAreaSqm = 4000) {
  const seed = screenSeed(SITE, {
    project: brief('apartment_project'),
    identity: {
      plotAreaSqm,
      // A complete PlotAttributes, not a partial one. `facing` and
      // `layoutApproval` are required, and the typecheck this suite now runs
      // under is what caught the first version of this fixture supplying
      // neither — which crashed the screen rather than failing an assertion.
      plot:
        roadWidthFt === undefined
          ? undefined
          : { roadWidthFt, facing: 'east' as const, layoutApproval: 'bda_approved' as const },
    },
  });
  return seed.result.yield;
}

describe('what FAR actually applies', () => {
  it('caps the zoning FAR at what the abutting road permits', () => {
    // A 30ft road is 9.14m, which sits in the 9-12m band.
    const y = scheme(30);
    assert.ok(y);
    assert.equal(y.bindingConstraint, 'road_width');
    assert.ok(y.farFromRoadWidth !== undefined && y.farFromRoadWidth < y.farFromZoning);
    assert.equal(y.farApplied, y.farFromRoadWidth);
  });

  it('lets the zoning bind when the road is wide enough', () => {
    // 120ft is 36.6m — the topmost band, above any residential zoning FAR here.
    const y = scheme(120);
    assert.ok(y);
    assert.equal(y.bindingConstraint, 'zoning');
    assert.equal(y.farApplied, y.farFromZoning);
  });

  it('says so, loudly, when the road width is unknown', () => {
    const y = scheme(undefined);
    assert.ok(y);
    assert.equal(y.bindingConstraint, 'unknown');
    assert.equal(y.farFromRoadWidth, undefined);
    // The optimistic reading is used — and named as the single most valuable
    // thing to supply, rather than left as a silent assumption.
    assert.equal(y.farApplied, y.farFromZoning);
    assert.ok(y.gaps.some(g => /abutting road width is not on file/.test(g)));
    assert.ok(y.gaps.some(g => /highest-value thing you can add/.test(g)));
  });

  it('moves the achievable area materially between the two', () => {
    const narrow = scheme(30)!;
    const wide = scheme(120)!;
    assert.ok(
      wide.permittedFarAreaSqm > narrow.permittedFarAreaSqm * 1.2,
      `road width should move the permitted area materially: ${narrow.permittedFarAreaSqm} vs ${wide.permittedFarAreaSqm}`,
    );
  });
});

describe('coverage, setbacks and what survives them', () => {
  it('never exceeds the ground-coverage footprint', () => {
    const y = scheme(120)!;
    assert.ok(y.footprintSqm <= y.coverageFootprintSqm);
  });

  it('takes the smaller of coverage and setback footprints', () => {
    const y = scheme(120)!;
    assert.equal(y.footprintSqm, Math.min(y.coverageFootprintSqm, y.setbackFootprintSqm));
  });

  it('flags the square-plot assumption when no dimensions are on file', () => {
    const y = scheme(undefined)!;
    assert.ok(y.gaps.some(g => /assumes a square site/.test(g)));
  });

  it('reaches a setback band consistent with the height it computed', () => {
    const y = scheme(120)!;
    assert.ok(y.heightM > 0);
    assert.ok(y.setbackAllRoundM >= 3, 'the smallest band in the pack is 3m');
  });
});

describe('units and parking', () => {
  it('counts units and states the average it assumed', () => {
    const y = scheme(120)!;
    assert.ok(y.unitsIndicative !== undefined && y.unitsIndicative > 0);
    assert.ok(y.avgUnitSaleableSqm);
    assert.ok(y.gaps.some(g => /real mix is a decision you make/.test(g)));
  });

});

describe('when there is nothing to size', () => {
  it('produces no yield for a finished flat', () => {
    const { result } = screenSeed(APARTMENT);
    assert.equal(result.project?.kind, 'built_asset_purchase');
    assert.equal(result.yield, undefined, 'a yield of nothing is a different statement from a yield of zero');
  });

  it('produces no yield for a land purchase with no scheme decided', () => {
    const { result } = screenSeed(SITE);
    assert.equal(result.project?.kind, 'land_acquisition');
    assert.equal(
      result.yield,
      undefined,
      'sizing a scheme here would pick one of the three the inference explicitly refused to pick',
    );
  });

  it('produces one as soon as a scheme is stated', () => {
    const { result } = screenSeed(SITE, { project: brief('apartment_project') });
    assert.ok(result.yield, 'stating what you are building is what makes a yield meaningful');
  });
});

describe('parking is sized off what is built, not what is bought', () => {
  it('sizes apartment parking on a bare land parcel', () => {
    // The regression this guards: parking norms were keyed on
    // `PropertyType`, which on every development site is `land_parcel` or
    // `residential_plot`. Nothing ever matched, and the yield reported zero
    // spaces required for a 114-unit scheme.
    const y = screenSeed(SITE, {
      project: brief('apartment_project'),
      identity: { plotAreaSqm: 4000, propertyType: 'land_parcel', plot: { roadWidthFt: 120, facing: 'east', layoutApproval: 'bda_approved' } },
    }).result.yield;
    assert.ok(y);
    assert.ok(y.parkingSpacesRequired > 0, 'an apartment scheme needs parking whatever the land is currently classed as');
    assert.ok(y.basementLevelsNeeded >= 1);
  });

  it('says why a plotted layout has no scheme parking, rather than reporting zero', () => {
    const y = screenSeed(SITE, {
      project: brief('plotted_development'),
      identity: { plotAreaSqm: 20000, plot: { roadWidthFt: 60, facing: 'east', layoutApproval: 'bda_approved' } },
    }).result.yield;
    assert.ok(y);
    assert.equal(y.parkingSpacesRequired, 0);
    assert.ok(
      y.gaps.some(g => /each buyer parks on their own plot/.test(g)),
      'zero with no explanation reads as an oversight; zero with a reason reads as an answer',
    );
  });

  it('requires more spaces than FAR area alone implies', () => {
    const y = screenSeed(SITE, {
      project: brief('apartment_project'),
      identity: { plotAreaSqm: 4000, plot: { roadWidthFt: 120, facing: 'east', layoutApproval: 'bda_approved' } },
    }).result.yield;
    assert.ok(y);
    // Parking is sized on constructed area, which exceeds FAR area.
    assert.ok(y.parkingSpacesRequired > Math.ceil(y.achievableFarAreaSqm / 100));
  });
});

describe('refusing to present arithmetic as a building', () => {
  it('marks the floor plate unviable when setbacks eat the site', () => {
    // The 220 sqm seed site under an apartment scheme: coverage gives 165 sqm,
    // setbacks for the height the FAR implies leave about 21 sqm, and the
    // arithmetic cheerfully answers "nine floors". It is correct and it
    // describes nothing anyone can build.
    const y = screenSeed(SITE, { project: brief('apartment_project') }).result.yield;
    assert.ok(y);
    assert.equal(y.floorPlateViable, false);
    // Two ways a site fails this, and both must say so in words: a plate too
    // small to plan on, or setbacks that leave no plate at all. On this seed
    // the setbacks consume the whole 220 sqm.
    assert.ok(
      y.gaps.some(g => /That is arithmetic, not a building/.test(g) || /consume the entire plot/.test(g)),
      `expected a gap explaining the unviable plate, got: ${y.gaps.join(' | ')}`,
    );
  });

  it('reports zero rather than a fictional plate when setbacks take everything', () => {
    const y = screenSeed(SITE, { project: brief('apartment_project') }).result.yield;
    assert.ok(y);
    assert.equal(y.footprintSqm, 0);
    assert.equal(y.floorsImplied, 0, 'no footprint means no floors, not infinite ones');
    assert.equal(y.achievableFarAreaSqm, 0);
  });

  it('is viable on a site with room for a real plate', () => {
    const y = screenSeed(SITE, {
      project: brief('apartment_project'),
      identity: { plotAreaSqm: 4000, plot: { roadWidthFt: 120, facing: 'east', layoutApproval: 'bda_approved' } },
    }).result.yield;
    assert.ok(y);
    assert.equal(y.floorPlateViable, true);
  });
});

describe('a real parcel outline replaces the square assumption', () => {
  /** A w x h rectangle in metres near the seed locality. */
  function rect(widthM: number, heightM: number, lat = 12.97, lng = 77.59) {
    const dLat = heightM / 111_320;
    const dLng = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
    return [
      { lat, lng },
      { lat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng },
      { lat: lat + dLat, lng },
      { lat, lng },
    ];
  }

  function withBoundary(widthM: number, heightM: number, statedAreaSqm: number) {
    const boundary = buildBoundary(rect(widthM, heightM), 'surveyed', NOW, 'test');
    assert.ok(boundary);
    return screenSeed(SITE, {
      project: brief('apartment_project'),
      identity: {
        plotAreaSqm: statedAreaSqm,
        boundary,
        plot: { roadWidthFt: 120, facing: 'east', layoutApproval: 'bda_approved' },
      },
    });
  }

  it('drops the square-plot caveat once an outline is on file', () => {
    const y = withBoundary(63, 63, 3969).result.yield;
    assert.ok(y);
    assert.ok(!y.gaps.some(g => /assumes a square site/.test(g)));
  });

  it('costs a narrow site more footprint than a square of the same area', () => {
    // 4,000 sqm as a 63x63 square and as a 20x200 strip. The square-plot
    // assumption said they were identical; setbacks say otherwise, and on the
    // strip they eat most of it.
    const square = withBoundary(63.2, 63.2, 4000).result.yield;
    const strip = withBoundary(20, 200, 4000).result.yield;
    assert.ok(square && strip);
    assert.ok(
      strip.footprintSqm < square.footprintSqm,
      `a 20x200 strip must lose more to setbacks than a 63x63 square: ${strip.footprintSqm} vs ${square.footprintSqm}`,
    );
    assert.ok(strip.gaps.some(g => /times as long as it is wide/.test(g)));
  });

  it('warns that a re-entrant parcel overstates its footprint', () => {
    const lat = 12.97;
    const lng = 77.59;
    const dLat = (m: number) => m / 111_320;
    const dLng = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
    const L = buildBoundary(
      [
        { lat, lng },
        { lat, lng: lng + dLng(80) },
        { lat: lat + dLat(30), lng: lng + dLng(80) },
        { lat: lat + dLat(30), lng: lng + dLng(30) },
        { lat: lat + dLat(80), lng: lng + dLng(30) },
        { lat: lat + dLat(80), lng },
        { lat, lng },
      ],
      'surveyed',
      NOW,
      'L-shaped',
    );
    assert.ok(L);
    assert.equal(L.convex, false);
    const y = screenSeed(SITE, {
      project: brief('apartment_project'),
      identity: { plotAreaSqm: L.computedAreaSqm, boundary: L, plot: { roadWidthFt: 120, facing: 'east', layoutApproval: 'bda_approved' } },
    }).result.yield;
    assert.ok(y);
    assert.ok(y.gaps.some(g => /re-entrant/.test(g)));
  });
});

describe('the outline against the extent on record', () => {
  function rect(widthM: number, heightM: number, lat = 12.97, lng = 77.59) {
    const dLat = heightM / 111_320;
    const dLng = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
    return [
      { lat, lng },
      { lat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng },
      { lat: lat + dLat, lng },
      { lat, lng },
    ];
  }

  const screenWith = (widthM: number, heightM: number, statedAreaSqm: number) => {
    const boundary = buildBoundary(rect(widthM, heightM), 'surveyed', NOW, 'test');
    assert.ok(boundary);
    return screenSeed(SITE, { identity: { plotAreaSqm: statedAreaSqm, boundary } }).result;
  };

  it('says nothing when the two agree', () => {
    const result = screenWith(20, 30, 600);
    assert.equal(result.risks.find(r => r.code === 'boundary_area_mismatch'), undefined);
  });

  it('flags an outline enclosing materially less than the deed recites', () => {
    // 600 sqm measured against 750 recorded — 20% of the land is not inside
    // the boundary being sold.
    const result = screenWith(20, 30, 750);
    const risk = result.risks.find(r => r.code === 'boundary_area_mismatch');
    assert.ok(risk, 'a 20% shortfall is a finding');
    assert.equal(risk.severity, 'serious');
    assert.match(risk.impact, /direct overpayment/);
  });

  it('flags an outline enclosing more than the deed conveys', () => {
    const result = screenWith(20, 30, 500);
    const risk = result.risks.find(r => r.code === 'boundary_area_mismatch');
    assert.ok(risk);
    assert.match(risk.impact, /somebody else’s title/);
  });

  it('leaves both numbers alone rather than reconciling them', () => {
    // The disagreement is the finding. Overwriting either number would erase it.
    const boundary = buildBoundary(rect(20, 30), 'surveyed', NOW, 'test');
    assert.ok(boundary);
    const { identity } = screenSeed(SITE, { identity: { plotAreaSqm: 750, boundary } });
    assert.equal(identity.plotAreaSqm, 750, 'the recorded extent is untouched');
    assert.ok(Math.abs(identity.boundary!.computedAreaSqm - 600) < 15, 'and so is the measurement');
  });
});
