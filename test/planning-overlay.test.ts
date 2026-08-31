/**
 * Pin vs kept master plan: flags and obtain cards, never a geometric overlay
 * and never an auto-filed extract.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkAdvise,
  compareProjectPlanning,
  fetchableReferenceWorks,
  handleChatSides,
  landUseSittingOf,
  lookupReferences,
  portalForCheck,
  seedDemoProject,
  serializePlanningOverlay,
  serializeReferenceHits,
  wantsPlanningOverlay,
  type ChatProposal,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

interface CustomTool {
  name: string;
  run: (args: never, context: never) => Promise<string> | string;
}

describe('planning overlay', () => {
  it('names the land-use sitting as BDA / LPA master plan, not building sanction', () => {
    const portal = portalForCheck({
      title: 'Proposed use matches permitted land use',
      purpose: 'A scheme on the wrong land-use designation cannot be sanctioned as drawn.',
      expectedEvidence: ['Master plan extract', 'Zoning certificate', 'Conversion order'],
    });
    assert.equal(portal?.key, 'bda_rmp');
    assert.match(portal?.route ?? '', /do not treat the withdrawn/i);
  });

  it('checkAdvise on a pending land-use check tells the person to obtain the sheet', () => {
    const project = seedDemoProject();
    const advise = checkAdvise(project, {
      id: 'chk_land_pending',
      title: 'Proposed use matches permitted land use',
      result: 'pending',
      expectedEvidence: ['Master plan extract', 'Zoning certificate'],
      evidenceIds: [],
    });
    assert.equal(advise.lean, 'cross');
    assert.match(advise.why, /do not scrape/i);
    assert.match(advise.why, /master plan|land use|zoning/i);
  });

  it('compare is pin vs kept plan, not a parcel intersection, and not evidence', () => {
    const project = seedDemoProject();
    const seated = landUseSittingOf(project);
    assert.ok(seated);
    const read = compareProjectPlanning(project, { sitting: { checkId: seated.check.id } });
    assert.equal(read.notGeometry, true);
    assert.equal(read.notEvidence, true);
    assert.equal(read.inForce.id, 'ref_rmp_2015');
    assert.ok(read.flags.some((f) => f.code === 'not_geometry'));
    assert.ok(read.flags.some((f) => f.code === 'pack_not_sheet'));
    assert.ok(read.flags.some((f) => f.code === 'conversion'));
    const text = serializePlanningOverlay(read);
    assert.match(text, /not a geometric intersection/i);
    assert.match(text, /not this project's evidence/i);
    assert.doesNotMatch(text, /intersected the parcel/i);
  });

  it('chat overlay proposes the obtain card and does not file evidence', () => {
    const project = seedDemoProject();
    const before = project.evidence.length;
    const findingsBefore = project.findings.length;
    assert.equal(wantsPlanningOverlay('Compare this to the master plan'), true);
    const side = handleChatSides(project, 'Compare this to the master plan', 'tester');
    assert.ok(side);
    assert.equal(project.evidence.length, before);
    assert.equal(project.findings.length, findingsBefore);
    assert.ok(side.proposals.some((p) => p.kind === 'open_connector' && /master plan/i.test(p.title)));
    assert.match(side.text, /not a geometric intersection/i);
    assert.match(side.text, /do not scrape|does not log in or scrape/i);
  });

  it('shelf catalogues RMP as not-fetchable and KTCP as an open official PDF', () => {
    const fetchable = fetchableReferenceWorks();
    assert.ok(fetchable.some((w) => w.id === 'ref_ktcp_1961'));
    assert.ok(!fetchable.some((w) => w.id === 'ref_rmp_2015'));
    assert.ok(!fetchable.some((w) => w.id === 'ref_rmp_2031_withdrawn'));
    assert.ok(!fetchable.some((w) => w.id === 'ref_dpplans_bengaluru'));
    const hits = lookupReferences('RMP master plan zoning');
    assert.ok(hits.some((h) => h.id === 'ref_rmp_2015'));
    assert.ok(hits.every((h) => h.notEvidence === true));
    assert.match(serializeReferenceHits(hits), /not this project's evidence/i);
    const withdrawn = lookupReferences('RMP 2031 withdrawn OpenCity');
    assert.ok(withdrawn.some((h) => h.id === 'ref_rmp_2031_withdrawn' && h.standing === 'withdrawn'));
  });

  it('compare_planning queues an obtain card without writing registers', async () => {
    const project = seedDemoProject();
    const before = project.evidence.length;
    const bag = { proposals: [] as ChatProposal[], navigations: [] as Array<{ target: string }>, toolCalls: [] as Array<{ name: string; summary: string }> };
    const tools = createProjectTools(project, 'tester', bag) as unknown as CustomTool[];
    const found = tools.find((t) => t.name === 'compare_planning');
    assert.ok(found);
    const raw = String(await found.run({} as never, {} as never));
    const parsed = JSON.parse(raw) as { notGeometry: boolean; notEvidence: boolean; overlay: string };
    assert.equal(parsed.notGeometry, true);
    assert.equal(parsed.notEvidence, true);
    assert.match(parsed.overlay, /RMP 2015/i);
    assert.equal(project.evidence.length, before);
    assert.ok(bag.proposals.some((p) => p.kind === 'open_connector'));
  });
});
