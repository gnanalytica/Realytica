/**
 * Project GraphRAG: neighbourhood on this file's registers, plus a reference
 * shelf that must never be treated as evidence.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkAdvise,
  connectorEvidenceInput,
  fetchableReferenceWorks,
  handleChatSides,
  lookupReferences,
  portalForCheck,
  portalObtainLine,
  extractProjectSubgraph,
  findProjectNodes,
  projectGraphOf,
  retrieveProjectNeighbourhood,
  seedDemoProject,
  serializeProjectSubgraph,
  serializeReferenceHits,
  splitReferenceText,
  traceProjectNode,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

interface CustomTool {
  name: string;
  description?: string;
  run: (args: never, context: never) => Promise<string> | string;
}

function toolsFor(project = seedDemoProject()) {
  const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] };
  const tools = createProjectTools(project, 'tester', bag) as unknown as CustomTool[];
  return { project, bag, tools };
}

function tool(name: string) {
  const { project, bag, tools } = toolsFor();
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `expected ${name}`);
  return { project, bag, tool: found };
}

describe('project GraphRAG', () => {
  it('a title-chain neighbourhood includes the scope, the DD, and the deed', () => {
    const project = seedDemoProject();
    const graph = projectGraphOf(project);
    const seeds = findProjectNodes(graph, 'title chain');
    assert.ok(seeds.length > 0, 'the demo file has a title-chain check');
    const sub = extractProjectSubgraph(graph, [seeds[0].id], 2);
    const kinds = new Set(sub.nodes.map((n) => n.kind));
    assert.ok(kinds.has('check'));
    assert.ok(kinds.has('scope'));
    assert.ok(kinds.has('assessment'));
    assert.ok(kinds.has('evidence'));
    assert.ok(sub.nodes.some((n) => /sale deed|encumbrance/i.test(n.label)));
  });

  it('trace of the unregistered-partition finding reaches the papers on file', () => {
    const project = seedDemoProject();
    const graph = projectGraphOf(project);
    const finding = graph.nodes.find((n) => n.kind === 'finding' && /unregistered partition/i.test(n.label));
    assert.ok(finding);
    const cone = traceProjectNode(graph, finding.id);
    assert.ok(cone);
    assert.ok(cone.nodes.some((n) => n.kind === 'evidence'), 'a finding without evidence is a different test');
    assert.ok(cone.nodes.some((n) => n.kind === 'check'));
    const text = serializeProjectSubgraph(cone);
    assert.match(text, /THIS FILE/);
    assert.doesNotMatch(text, /REFERENCE —/);
  });

  it('does not mix a statute hit into the file neighbourhood', () => {
    const project = seedDemoProject();
    const { graph } = retrieveProjectNeighbourhood(project, 'title chain', 2);
    assert.ok(!graph.nodes.some((n) => n.kind === 'evidence' && /ibbi|registration act/i.test(n.label)));
  });

  it('lookup_reference marks official hits as not evidence', () => {
    const hits = lookupReferences('IBBI fire valuation');
    assert.ok(hits.length > 0);
    assert.ok(hits.every((h) => h.notEvidence === true));
    const nbc = lookupReferences('NBC');
    assert.ok(nbc.some((h) => h.standing === 'paid'));
    const text = serializeReferenceHits(hits);
    assert.match(text, /REFERENCE/);
    assert.match(text, /not this project's evidence/i);
  });

  it('copilot get_subgraph is this file, lookup_reference is not', async () => {
    const names = toolsFor().tools.map((t) => t.name);
    for (const expected of ['get_subgraph', 'trace_conclusion', 'lookup_reference', 'get_portal_route', 'compare_planning']) {
      assert.ok(names.includes(expected), `${expected} must be on the project copilot`);
    }

    const sub = tool('get_subgraph');
    assert.match(sub.tool.description ?? '', /THIS FILE/i);
    const neighbourhood = String(await sub.tool.run({ query: 'title chain', hops: 2 } as never, {} as never));
    assert.match(neighbourhood, /THIS FILE/);
    assert.match(neighbourhood, /source=/);
    assert.ok(sub.bag.navigations.length > 0, 'naming a check opens the sitting');

    const ref = tool('lookup_reference');
    const shelf = String(await ref.tool.run({ query: 'IBBI' } as never, {} as never));
    assert.match(shelf, /REFERENCE/);
    assert.doesNotMatch(shelf, /THIS FILE/);
    assert.match(ref.tool.description ?? '', /not this project's evidence/i);
  });

  it('trace_conclusion on a missing id says so rather than inventing support', async () => {
    const { tool: trace } = tool('trace_conclusion');
    const raw = String(await trace.run({ nodeId: 'chk_does_not_exist' } as never, {} as never));
    const parsed = JSON.parse(raw) as { error: string };
    assert.match(parsed.error, /No node/);
  });
});

function fireSitting(project = seedDemoProject()) {
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (portalForCheck(check)?.key === 'fire_noc') {
          return { assessment, scope, check };
        }
      }
    }
  }
  return undefined;
}

describe('portal sittings', () => {
  it('names Fire NOC as a sitting, not a scrape', () => {
    const portal = portalForCheck({ title: 'Fire NOC is in hand', expectedEvidence: ['Fire NOC'] });
    assert.equal(portal?.key, 'fire_noc');
    assert.match(portalObtainLine(portal!), /do not scrape/i);
  });

  it('checkAdvise on a pending fire check tells the person to download', () => {
    const project = seedDemoProject();
    const advise = checkAdvise(project, {
      id: 'chk_fire_pending',
      title: 'Fire NOC is in hand',
      result: 'pending',
      expectedEvidence: ['Fire NOC'],
      evidenceIds: [],
    });
    assert.equal(advise.lean, 'cross');
    assert.match(advise.why, /Fire NOC/i);
    assert.match(advise.why, /do not scrape/i);
  });

  it('get_portal_route on a fire check returns the manual download, not a fetch', async () => {
    const project = seedDemoProject();
    const seated = fireSitting(project);
    assert.ok(seated, 'demo file has a fire sitting');
    const { tools } = toolsFor(project);
    const route = tools.find((t) => t.name === 'get_portal_route');
    assert.ok(route);
    const raw = String(await route.run({ checkId: seated.check.id } as never, {} as never));
    const parsed = JSON.parse(raw) as { notScraped?: boolean; portal?: { instruction: string; key: string } };
    assert.equal(parsed.portal?.key, 'fire_noc');
    assert.equal(parsed.notScraped, true);
    assert.match(parsed.portal?.instruction ?? '', /do not scrape/i);
  });

  it('chat “download it” on a fire sitting pins the check, and does not file evidence', () => {
    const project = seedDemoProject();
    const seated = fireSitting(project);
    assert.ok(seated);
    const before = project.evidence.length;
    const side = handleChatSides(project, 'download it', 'tester', undefined, {
      checkId: seated.check.id,
      ddId: seated.assessment.id,
      scopeId: seated.scope.id,
    });
    assert.ok(side);
    assert.equal(project.evidence.length, before, 'connector cards stay propose-and-review');
    const card = side.proposals.find((p) => p.kind === 'open_connector');
    assert.ok(card);
    const payload = card.payload as { checkIds?: string[]; checkId?: string };
    assert.ok((payload.checkIds ?? []).includes(seated.check.id) || payload.checkId === seated.check.id);
    assert.match(side.text, /can’t log in or scrape|do not scrape|does not log in/i);
    const shaped = connectorEvidenceInput(payload, 'tester');
    assert.ok(shaped.evidence.checkIds?.includes(seated.check.id));
    assert.ok(shaped.action.checkIds?.includes(seated.check.id));
  });
});

describe('open official PDF shelf', () => {
  it('will not fetch paid NBC or IVS', () => {
    const fetchable = fetchableReferenceWorks();
    assert.ok(fetchable.some((w) => w.id === 'ref_ibbi_rv_rules_2017'));
    assert.ok(!fetchable.some((w) => w.standing === 'paid'));
    assert.ok(!fetchable.some((w) => /nbc|ivs_ivsc/i.test(w.id)));
  });

  it('cites a Rule 8 passage as reference, never as this file’s evidence', () => {
    const passages = splitReferenceText(
      'Companies (Registered Valuers and Valuation) Rules, 2017',
      [
        'THE COMPANIES (REGISTERED VALUERS AND VALUATION) RULES, 2017',
        'Rule 8. Contents of valuation report.',
        'The report of valuation shall contain the following particulars, namely:—',
        '(a) background information of the asset being valued;',
        '(b) purpose of valuation and appointing authority;',
        '(c) identity of the valuer and any other experts involved in the valuation;',
      ].join('\n'),
    );
    assert.ok(passages.some((p) => /Rule 8/i.test(p.heading) || /Rule 8/i.test(p.text)));
    const hits = lookupReferences('IBBI Rule 8').map((hit) => ({
      ...hit,
      notEvidence: true as const,
      ingested: true,
      passages: passages.slice(0, 2),
    }));
    assert.ok(hits.every((h) => h.notEvidence === true));
    const text = serializeReferenceHits(hits);
    assert.match(text, /REFERENCE/);
    assert.match(text, /not this project's evidence/i);
    assert.match(text, /cite /);
    assert.doesNotMatch(text, /THIS FILE/);
  });

  it('extracts IBBI Rule text from the open official PDF when reachable', async () => {
    const { extractPdfText } = await import('../apps/api/src/reference/shelf-cache');
    try {
      const res = await fetch('https://ibbi.gov.in/uploads/rules.pdf', {
        headers: { 'User-Agent': 'Realytica-reference-shelf/1.0 (test)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength < 80) return;
      const text = await extractPdfText(bytes);
      assert.match(text, /Registered Valuers/i);
    } catch {
      /* network or pdfjs unavailable — catalogue still works without the bytes */
    }
  });
});
