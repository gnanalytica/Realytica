/**
 * What the Graph page's side panel says about one node.
 *
 * The panel is the place the graph is put into words: "rests on", "is held
 * by", which function, which way round. Words can be wrong while every node
 * and edge is right, and nothing on screen looks broken when they are, so the
 * part that chooses them is a plain function and is asked here.
 *
 * Four things it must get right. A relation reads from the side of the node
 * being looked at. A paper that has not come is still needed, not rested on.
 * A function is named with its department, because two of them are both
 * "Handover". And no link is left out because its kind has no place in the
 * order the page keeps by hand.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProjectGraph, createProject, ensureWorkstreamChecks, seedDemoProject, workstreamChecks, type ProjectGraphEdge, type ProjectGraphNode } from '@realytica/shared';
import { departmentWord, linksOf, nameBeside, secondLine } from '../apps/web/src/pages/projects/cockpit/graph-links';

type Kind = ProjectGraphNode['kind'];

/** The lanes in the order the page runs them, cut short: enough to order by, and deliberately missing kinds. */
const LANES: Kind[] = ['stage', 'department', 'workstream', 'project', 'check', 'evidence', 'finding'];

function panel(graph: { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] }, id: string, lanes: Kind[] = LANES) {
  return linksOf(id, graph.edges, new Map(graph.nodes.map((n) => [n.id, n])), lanes);
}

/** A panel as its lines: the heading's kind, then each "phrase → name". */
function lines(groups: ReturnType<typeof linksOf>): Array<[Kind, string[]]> {
  return groups.map((g) => [g.kind, g.links.map((l) => `${l.phrase} → ${l.label}`)]);
}

function node(id: string, kind: Kind, label: string, extra: Partial<ProjectGraphNode> = {}): ProjectGraphNode {
  const layer = kind === 'workstream' || kind === 'department' ? 'structure' : kind === 'evidence' ? 'evidence' : kind === 'thought' ? 'deliberation' : 'judgement';
  return { id, kind, layer, origin: 'derived', label, ...extra };
}

describe('a node’s links, in words', () => {
  it('says each relation from the side of the node being read', () => {
    const graph = {
      nodes: [node('c1', 'check', 'Title chain'), node('e1', 'evidence', 'Sale deed 2019', { status: 'used' }), node('w1', 'workstream', 'Title', { key: 'legal.title' })],
      edges: [
        { id: 'a', from: 'c1', to: 'e1', rel: 'supported_by' as const },
        { id: 'b', from: 'w1', to: 'c1', rel: 'holds' as const },
      ],
    };
    assert.deepEqual(lines(panel(graph, 'c1')), [
      ['evidence', ['rests on → Sale deed 2019']],
      ['workstream', ['is held by → Legal › Title']],
    ]);
    assert.deepEqual(lines(panel(graph, 'e1')), [['check', ['supports → Title chain']]]);
    assert.deepEqual(lines(panel(graph, 'w1')), [['check', ['holds → Title chain']]]);
    assert.deepEqual(panel(graph, 'c1')[0]!.links[0], { edgeId: 'a', otherId: 'e1', label: 'Sale deed 2019', phrase: 'rests on' });
    assert.deepEqual(panel(graph, 'not-a-node'), []);
  });

  it('never prints a relation’s key', () => {
    const project = seedDemoProject();
    const graph = buildProjectGraph(project);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    let read = 0;
    for (const n of graph.nodes.filter((x) => x.kind !== 'evidence')) {
      for (const group of linksOf(n.id, graph.edges, byId, LANES)) {
        for (const link of group.links) {
          read += 1;
          assert.match(link.phrase, /^[a-z]+( [a-z]+)*$/, `${n.label}: "${link.phrase}"`);
        }
      }
    }
    assert.ok(read > 1000);
  });

  it('says a paper is still needed while the file is waiting for it', () => {
    // The seeded file's checks are joined to every document they expect, and
    // almost none has come. "Rests on" would be false of each.
    const project = seedDemoProject();
    const graph = buildProjectGraph(project);
    const waiting = project.evidence.find((e) => e.status === 'expected' && e.checkIds.length > 0)!;
    const check = waiting.checkIds[0]!;
    const fromCheck = panel(graph, check).find((g) => g.kind === 'evidence')!.links.find((l) => l.otherId === waiting.id)!;
    assert.equal(fromCheck.phrase, 'still needs');
    const fromPaper = panel(graph, waiting.id).flatMap((g) => g.links).find((l) => l.otherId === check)!;
    assert.equal(fromPaper.phrase, 'is still needed by');

    const filed = project.evidence.find((e) => e.status === 'used' && e.checkIds.length > 0)!;
    assert.equal(panel(graph, filed.checkIds[0]!).flatMap((g) => g.links).find((l) => l.otherId === filed.id)!.phrase, 'rests on');

    // The approvals the project needs and does not hold sit in Approvals all the same.
    const approvals = panel(graph, `${project.id}::ws::legal.approvals`).find((g) => g.kind === 'approval')!;
    assert.ok(approvals.links.length > 0);
    assert.ok(approvals.links.every((l) => l.phrase === 'still needs'), 'every approval on this file is missing');
    const gate = panel(graph, `${project.id}::approval::commencement`).flatMap((g) => g.links).find((l) => l.otherId === `${project.id}::ws::construction.progress`)!;
    assert.equal(`${gate.phrase} → ${gate.label}`, 'is needed before → Engineering › Progress');
  });

  it('says a paper that was superseded or rejected was cited, and is kept on file', () => {
    // On file and no longer relied on: it is not needed, and nothing rests on it.
    const graph = {
      nodes: [
        node('c1', 'check', 'Title chain'),
        node('w1', 'workstream', 'Title', { key: 'legal.title' }),
        node('old', 'evidence', 'Sale deed, first copy', { status: 'superseded' }),
        node('bad', 'evidence', 'Sale deed, illegible scan', { status: 'rejected' }),
        node('good', 'evidence', 'Sale deed, certified copy', { status: 'received' }),
      ],
      edges: [
        { id: '1', from: 'c1', to: 'old', rel: 'supported_by' as const },
        { id: '2', from: 'c1', to: 'bad', rel: 'supported_by' as const },
        { id: '3', from: 'c1', to: 'good', rel: 'supported_by' as const },
        { id: '4', from: 'w1', to: 'old', rel: 'holds' as const },
        { id: '5', from: 'w1', to: 'good', rel: 'holds' as const },
      ],
    };
    assert.deepEqual(lines(panel(graph, 'c1')), [
      ['evidence', ['cited → Sale deed, first copy', 'cited → Sale deed, illegible scan', 'rests on → Sale deed, certified copy']],
    ]);
    assert.deepEqual(lines(panel(graph, 'old')), [
      ['workstream', ['is kept on file by → Legal › Title']],
      ['check', ['was cited by → Title chain']],
    ]);
    assert.deepEqual(lines(panel(graph, 'w1')), [['evidence', ['keeps on file → Sale deed, first copy', 'holds → Sale deed, certified copy']]]);
  });

  it('puts the sources first, then the lanes’ order, and drops no link whose kind the order leaves out', () => {
    const graph = {
      nodes: [
        node('f1', 'finding', 'Crack in the slab'),
        node('r1', 'risk', 'Structural risk'),
        node('a1', 'action', 'Repair the slab'),
        node('c1', 'check', 'Structural condition'),
        node('e1', 'evidence', 'Photograph', { status: 'received' }),
        node('v1', 'site_visit', 'Condition walk'),
        node('t1', 'thought', 'Insight'),
      ],
      edges: [
        { id: '1', from: 'f1', to: 'r1', rel: 'raises' as const },
        { id: '2', from: 'f1', to: 'a1', rel: 'requires' as const },
        { id: '3', from: 'c1', to: 'f1', rel: 'produces' as const },
        { id: '4', from: 'f1', to: 'v1', rel: 'observed_on' as const },
        { id: '5', from: 'f1', to: 'e1', rel: 'supported_by' as const },
        { id: '6', from: 't1', to: 'f1', rel: 'cites' as const },
      ],
    };
    // `risk`, `action` and `thought` are in no lane given here. They come
    // after the lanes, in the order they were met, and all six links are read.
    assert.deepEqual(lines(panel(graph, 'f1')), [
      ['evidence', ['rests on → Photograph']],
      ['site_visit', ['was seen on → Condition walk']],
      ['check', ['came out of → Structural condition']],
      ['risk', ['raises → Structural risk']],
      ['action', ['calls for → Repair the slab']],
      ['thought', ['is referred to by → Insight']],
    ]);
    assert.equal(panel(graph, 'f1', []).flatMap((g) => g.links).length, 6, 'with no lane order at all, nothing is lost');

    // On a real file: every edge at a node is one line in its panel.
    const project = seedDemoProject();
    const seeded = buildProjectGraph(project);
    const byId = new Map(seeded.nodes.map((n) => [n.id, n]));
    for (const n of seeded.nodes.filter((x) => x.kind !== 'evidence')) {
      const touching = seeded.edges.filter((e) => e.from === n.id || e.to === n.id).length;
      assert.equal(linksOf(n.id, seeded.edges, byId, LANES).flatMap((g) => g.links).length, touching, n.label);
    }
  });

  it('names a function with its department, because two are both Handover', () => {
    const project = createProject({ name: 'Names', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-N1');
    ensureWorkstreamChecks(project, ['design.drawings'], 'tester');
    const graph = buildProjectGraph(project);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const legal = byId.get(`${project.id}::ws::legal.handover`)!;
    const commercial = byId.get(`${project.id}::ws::commercial.handover`)!;
    assert.deepEqual([legal.label, commercial.label], ['Handover', 'Handover'], 'the one word is the same');
    assert.deepEqual([nameBeside(legal), nameBeside(commercial)], ['Legal › Handover', 'Commercial › Handover']);
    assert.deepEqual([departmentWord(legal), departmentWord(commercial)], ['Legal', 'Commercial']);
    assert.match(secondLine(legal, 'Functions'), /^Functions · Legal · Handover & society · /);
    assert.match(secondLine(commercial, 'Functions'), /^Functions · Commercial · Handover & defects · /);

    // In a department's links, and in a record's.
    const functions = (id: string) => panel(graph, id).find((g) => g.kind === 'workstream')!.links.map((l) => l.label);
    assert.ok(functions(`${project.id}::dept::legal`).includes('Legal › Handover'));
    assert.ok(functions(`${project.id}::dept::commercial`).includes('Commercial › Handover'));
    const check = workstreamChecks(project, 'design.drawings')[0]!;
    assert.deepEqual(functions(check.id), ['Engineering › Design']);
    const all = graph.nodes.filter((n) => n.kind === 'workstream').map(nameBeside);
    assert.equal(new Set(all).size, all.length, 'beside each other, every function has a name of its own');

    // Nothing but a function is given a department.
    const stage = byId.get(`${project.id}::stage::construction`)!;
    assert.equal(departmentWord(stage), undefined);
    assert.equal(nameBeside(stage), 'Under construction');
    assert.equal(secondLine(stage, 'Stages'), `Stages · ${stage.detail}`);
    assert.equal(secondLine(node('x', 'action', 'Repair'), 'Actions'), 'Actions');
  });
});
