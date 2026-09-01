/**
 * A report is half alive, and the half that is alive is not yours to write.
 *
 * The whole design turns on one refusal: a block that reads the registers
 * says what the registers say, and no amount of typing — by a person, by a
 * model, through chat, through the API — changes that without an explicit
 * detach that the document then admits to. Everything else here is in service
 * of that: the freeze on issue, the drift report, the migration.
 *
 * These run against the real seeds and the real operations rather than a
 * fixture, because the property under test is what the product actually does
 * when somebody sets a check three panes away.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addFinding,
  applyProjectChat,
  detachReportBlock,
  editReportBlock,
  ensureProjectShape,
  generateReport,
  insertReportBlock,
  isLiveBlock,
  issueReport,
  moveReportBlock,
  reattachReportBlock,
  removeReportBlock,
  reportDrift,
  resolveReportBlock,
  retuneReportBlock,
  seedDemoProject,
  type DdProject,
  type GeneratedReport,
} from '@realytica/shared';

function withReport(): { project: DdProject; report: GeneratedReport } {
  const project = seedDemoProject();
  const report = generateReport(project, { kind: 'executive_dd', generatedBy: 'Lead' });
  return { project, report };
}

const findingsBlock = (report: GeneratedReport) => report.body.blocks.find((b) => b.source?.kind === 'findings')!;
const proseBlock = (report: GeneratedReport) => report.body.blocks.find((b) => b.origin === 'authored')!;

describe('a live section reads the registers', () => {
  it('updates when the file does, without the report being touched', () => {
    const { project, report } = withReport();
    const block = findingsBlock(report);
    const before = resolveReportBlock(project, block).lines.length;

    addFinding(project, {
      title: 'Rajakaluve setback unresolved',
      description: 'Storm-water drain buffer not demonstrated.',
      severity: 'critical',
      discipline: 'legal',
    });

    const after = resolveReportBlock(project, block).lines;
    assert.equal(after.length, before + 1, 'the section grew because the register did');
    assert.ok(after.some((l) => l.includes('Rajakaluve')));
  });

  it('refuses to have its words written, and says why', () => {
    // The refusal the whole feature turns on. Accepting the text and quietly
    // ceasing to be live would be the same lie by a quieter route.
    const { project, report } = withReport();
    assert.throws(
      () => editReportBlock(project, report.id, findingsBlock(report).id, { text: '3 findings, all fine.' }),
      /not yours to write/,
    );
  });

  it('takes a heading edit, because a heading is not a claim about the registers', () => {
    const { project, report } = withReport();
    const block = editReportBlock(project, report.id, findingsBlock(report).id, { heading: 'What we found' });
    assert.equal(block.heading, 'What we found');
    assert.ok(isLiveBlock(block), 'and it is still live');
  });

  it('can be retuned to ask for something else', () => {
    const { project, report } = withReport();
    const block = retuneReportBlock(project, report.id, findingsBlock(report).id, { kind: 'risks', materialOnly: true });
    assert.equal(block.source?.kind, 'risks');
    assert.ok(isLiveBlock(block));
  });
});

describe('detaching is explicit, and the document admits to it', () => {
  it('keeps what the section said and records that it stopped updating', () => {
    const { project, report } = withReport();
    const live = findingsBlock(report);
    const said = resolveReportBlock(project, live).lines;

    const block = detachReportBlock(project, report.id, live.id);
    assert.equal(block.origin, 'authored');
    assert.equal(block.detachedFrom, 'findings');
    assert.ok(block.detachedAt, 'and when');
    assert.equal(block.text, said.join('\n'), 'keeping exactly what it said');
    assert.ok(!isLiveBlock(block));

    // The point of detaching: it no longer follows the register.
    addFinding(project, { title: 'Later finding', description: 'x', severity: 'high', discipline: 'legal' });
    assert.ok(!resolveReportBlock(project, block).lines.some((l) => l.includes('Later finding')));
  });

  it('takes an edit once detached', () => {
    const { project, report } = withReport();
    // Held by id, because detaching removes the `source` the helper looks up.
    const id = findingsBlock(report).id;
    detachReportBlock(project, report.id, id);
    const block = editReportBlock(project, report.id, id, { text: 'Our own reading of the findings.' });
    assert.equal(block.text, 'Our own reading of the findings.');
  });

  it('goes back on the registers when asked, discarding what was typed', () => {
    const { project, report } = withReport();
    const id = findingsBlock(report).id;
    detachReportBlock(project, report.id, id);
    editReportBlock(project, report.id, id, { text: 'something a person wrote' });
    const block = reattachReportBlock(project, report.id, id);
    assert.ok(isLiveBlock(block));
    assert.equal(block.text, undefined);
    assert.equal(block.detachedAt, undefined);
  });

  it('refuses to reattach a block that was never bound', () => {
    const { project, report } = withReport();
    assert.throws(() => reattachReportBlock(project, report.id, proseBlock(report).id), /written from scratch/);
  });
});

describe('a prose section is nobody else’s to rewrite', () => {
  it('survives everything the registers do', () => {
    const { project, report } = withReport();
    const opinion = editReportBlock(project, report.id, proseBlock(report).id, {
      text: 'Proceed subject to the DC conversion order being produced before completion.',
    });
    addFinding(project, { title: 'Anything', description: 'x', severity: 'critical', discipline: 'legal' });
    assert.equal(resolveReportBlock(project, opinion).lines.join(' '), 'Proceed subject to the DC conversion order being produced before completion.');
  });

  it('can be inserted anywhere and moved', () => {
    const { project, report } = withReport();
    const first = report.body.blocks[0]!.id;
    const added = insertReportBlock(project, report.id, { heading: 'Caveat', text: 'Indicative only.', afterBlockId: first });
    assert.equal(report.body.blocks[1]!.id, added.id);
    moveReportBlock(project, report.id, added.id, 0);
    assert.equal(report.body.blocks[0]!.id, added.id);
    removeReportBlock(project, report.id, added.id);
    assert.ok(!report.body.blocks.some((b) => b.id === added.id));
  });
});

describe('issuing stops the document moving', () => {
  it('freezes every live section at what it said', () => {
    const { project, report } = withReport();
    const block = findingsBlock(report);
    const said = resolveReportBlock(project, block).lines;

    issueReport(project, report.id, 'Lead');
    assert.equal(report.status, 'issued');
    assert.deepEqual(block.frozen, said);

    addFinding(project, { title: 'Arrived after issue', description: 'x', severity: 'critical', discipline: 'legal' });
    assert.ok(!block.frozen!.some((l) => l.includes('Arrived after issue')), 'the issued document does not move');
  });

  it('refuses every edit afterwards, and names the way forward', () => {
    const { project, report } = withReport();
    issueReport(project, report.id, 'Lead');
    for (const attempt of [
      () => editReportBlock(project, report.id, proseBlock(report).id, { text: 'reworded' }),
      () => insertReportBlock(project, report.id, { text: 'late addition' }),
      () => removeReportBlock(project, report.id, proseBlock(report).id),
      () => detachReportBlock(project, report.id, findingsBlock(report).id),
    ]) {
      assert.throws(attempt, /can no longer be edited/);
    }
  });

  it('reports what the registers have done since — the question people actually ask', () => {
    const { project, report } = withReport();
    issueReport(project, report.id, 'Lead');
    assert.deepEqual(reportDrift(project, report.body.blocks), [], 'nothing has moved yet');

    addFinding(project, { title: 'Encroachment on the north boundary', description: 'x', severity: 'critical', discipline: 'legal' });
    const drift = reportDrift(project, report.body.blocks);
    assert.ok(drift.length > 0);
    const row = drift.find((r) => r.added.some((l) => l.includes('Encroachment')));
    assert.ok(row, 'the new finding shows as added');
    assert.equal(row.nowCount, row.wasCount + 1);
  });
});

describe('reports written before blocks existed still open', () => {
  it('migrates a frozen body into prose rather than guessing what it read', () => {
    // Conservative on purpose: guessing which register each old section used
    // would risk a paragraph silently changing under a report somebody
    // already sent.
    const project = seedDemoProject();
    const legacy = {
      id: 'rpt_legacy',
      kind: 'executive_dd' as const,
      title: 'Old report',
      status: 'generated' as const,
      assessmentIds: [],
      scopeInstanceIds: [],
      body: { summary: 'old summary', sections: [{ heading: 'Key findings', paragraphs: ['One', 'Two'] }] },
      generatedAt: '2026-01-01T00:00:00.000Z',
      generatedBy: 'Lead',
    };
    project.reports.push(legacy as unknown as GeneratedReport);
    ensureProjectShape(project);

    const migrated = project.reports.find((r) => r.id === 'rpt_legacy')!;
    assert.equal(migrated.body.blocks.length, 1);
    assert.equal(migrated.body.blocks[0]!.origin, 'authored');
    assert.equal(migrated.body.blocks[0]!.heading, 'Key findings');
    assert.equal(migrated.body.blocks[0]!.text, 'One\nTwo');
    assert.equal(migrated.body.sections, undefined, 'and the old shape is gone');
  });
});

describe('chat edits the report, under the same authorship law', () => {
  it('executes a person’s note rather than paraphrasing it', () => {
    const { project, report } = withReport();
    const before = report.body.blocks.length;
    const result = applyProjectChat(project, 'add a note to the report: the rajakaluve setback is unresolved');
    assert.equal(report.body.blocks.length, before + 1, 'it wrote, rather than proposing');
    const added = report.body.blocks[report.body.blocks.length - 1]!;
    assert.equal(added.origin, 'authored');
    assert.match(added.text ?? '', /rajakaluve setback is unresolved/);
    assert.match(result.assistantTurn.text, /Added/i);
  });

  it('will not invent the paragraph when the person did not supply one', () => {
    const { project } = withReport();
    const result = applyProjectChat(project, 'add a paragraph to the report about the boundary');
    assert.match(result.assistantTurn.text, /after a colon/i);
    assert.match(result.assistantTurn.text, /will not write the paragraph for you/i);
  });

  it('detaches a named section on the person’s instruction', () => {
    const { project, report } = withReport();
    applyProjectChat(project, 'detach the Risks section of the report so I can edit it');
    const risks = report.body.blocks.find((b) => b.detachedFrom === 'risks');
    assert.ok(risks, 'the risks block came off the registers');
    assert.ok(risks.detachedAt);
  });

  it('offers the candidates instead of guessing which section was meant', () => {
    const { project, report } = withReport();
    insertReportBlock(project, report.id, { heading: 'Risk appetite', text: '' });
    const result = applyProjectChat(project, 'remove the risk section from the report');
    assert.ok((result.assistantTurn.choices ?? []).length >= 2, 'two sections could be meant, so both are offered');
    assert.match(result.assistantTurn.text, /Nothing has changed/i);
  });

  it('issues on instruction, and says the document has stopped moving', () => {
    const { project, report } = withReport();
    const result = applyProjectChat(project, 'issue the report');
    assert.equal(report.status, 'issued');
    assert.match(result.assistantTurn.text, /frozen/i);
  });
});
