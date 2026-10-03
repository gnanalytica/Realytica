/**
 * Observations and mitigations, and the photographs that prove them.
 *
 * An observation is a finding with three more things an engineer's table
 * carries — where, what to do, and against which code. The cases here are the
 * table going out in the order it is read, a site-log photograph becoming
 * citable once and only once, and the chat proposing an observation in the
 * same shape a person records one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RISK_LABEL,
  addEvidence,
  addObservation,
  addQuestionnaire,
  answerQuestion,
  commitChatProposal,
  createChatProposal,
  createProject,
  ensureWorkstreamChecks,
  fileSiteLogPhoto,
  generateReport,
  issueReport,
  logSiteEntry,
  observationSummary,
  observations,
  observationsCsv,
  observationsText,
  patchObservation,
  readReportBlock,
  reportTemplate,
  resolveReportBlock,
  suggestAnswers,
  unusedPhotos,
  type DdProject,
} from '@realytica/shared';

function project(): DdProject {
  return createProject({ name: 'Observation test', type: 'commercial', location: 'CBD', city: 'Bengaluru', currentStage: 'operations' }, 'RYT-O1');
}

function photo(p: DdProject, title: string) {
  const row = addEvidence(p, { title, kind: 'photograph', status: 'received' }, 'tester');
  row.attachments.push({ id: `att_${row.id}`, fileName: `${title}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10, storageKey: `${row.id}.jpg`, uploadedAt: '2026-10-01T10:00:00.000Z' });
  return row;
}

describe('an observation', () => {
  it('is a finding with where, what to do and against which code', () => {
    const p = project();
    const shot = photo(p, 'Pump room');
    const o = addObservation(
      p,
      { area: 'Pump room', description: 'The pump room has one fire pump and no standby. A duty and a standby pump are required.', severity: 'high', mitigation: 'Install a standby pump.', standardRef: 'NBC 2016 Part 4', evidenceIds: [shot.id] },
      'engineer',
    );
    assert.equal(p.findings.length, 1, 'no second register');
    assert.equal(o.title, 'The pump room has one fire pump and no standby.');
    assert.equal(o.discipline, 'technical');
    assert.deepEqual([o.area, o.mitigation, o.standardRef], ['Pump room', 'Install a standby pump.', 'NBC 2016 Part 4']);
    assert.deepEqual(o.evidenceIds, [shot.id]);
  });

  it('refuses proof that is not on the file, and an empty description', () => {
    const p = project();
    assert.throws(() => addObservation(p, { description: 'Seen', severity: 'low', evidenceIds: ['ev_none'] }, 'engineer'), /No document or photograph/);
    assert.throws(() => addObservation(p, { description: '   ', severity: 'low' }, 'engineer'), /what was observed/);
  });

  it('is edited in place; its title follows the description until someone names it', () => {
    const p = project();
    const o = addObservation(p, { description: 'Roof tiles are loose.', severity: 'medium' }, 'engineer');
    patchObservation(p, o.id, { description: 'Roof tiles are loose along the parapet.', mitigation: 'Refix them.', area: 'Terrace', severity: 'high' }, 'engineer');
    assert.equal(o.title, 'Roof tiles are loose along the parapet.');
    assert.equal(o.severity, 'high');
    patchObservation(p, o.id, { title: 'Loose roof tiles', mitigation: null }, 'engineer');
    patchObservation(p, o.id, { description: 'Roof tiles are loose and two are missing.' }, 'engineer');
    assert.equal(o.title, 'Loose roof tiles', 'a title someone chose is kept');
    assert.equal(o.mitigation, undefined);
  });

  it('is read area by area in the order the areas were first written, worst first within each', () => {
    const p = project();
    addObservation(p, { area: 'Basement', description: 'Exit signage is missing.', severity: 'medium' }, 'engineer');
    addObservation(p, { area: 'Pump room', description: 'No standby pump.', severity: 'high' }, 'engineer');
    addObservation(p, { area: 'basement', description: 'Ponding at the ramp.', severity: 'critical' }, 'engineer');
    addObservation(p, { description: 'Title defect.', severity: 'critical', discipline: 'legal' }, 'engineer');
    const rows = observations(p, 'construction');
    assert.deepEqual(rows.map((f) => f.description), ['Ponding at the ramp.', 'Exit signage is missing.', 'No standby pump.']);
    const s = observationSummary(p, rows);
    assert.deepEqual([s.total, s.byRisk.critical, s.byRisk.high, s.byRisk.medium], [3, 1, 1, 1]);
    assert.deepEqual(s.areas, ['Basement', 'Pump room']);
  });

  it('goes out as the engineer’s table', () => {
    const p = project();
    const shot = photo(p, 'Machine room');
    addObservation(p, { area: 'Lift core', description: 'The machine room has no ventilation, so the drive may overheat.', severity: 'high', mitigation: 'Add an exhaust fan.', evidenceIds: [shot.id] }, 'engineer');
    addObservation(p, { area: 'Terrace', description: 'The terrace drain is blocked.', severity: 'medium' }, 'engineer');
    const rows = observations(p);
    const csv = observationsCsv(p, rows).trim().split('\n');
    assert.equal(csv[0], 'S. No,Area,Description,Risk category,Mitigation,Reference,Discipline,Photographs and documents');
    assert.ok(csv[1]!.startsWith('1,Lift core,"The machine room has no ventilation, so the drive may overheat.",High risk,Add an exhaust fan.'));
    assert.ok(csv[1]!.endsWith('Machine room'));
    assert.ok(csv[2]!.includes(RISK_LABEL.medium));
    const text = observationsText(rows);
    assert.ok(text.startsWith('OBSERVATIONS AND MITIGATIONS'));
    assert.ok(text.includes('Mitigation: Add an exhaust fan.'));
    assert.equal(observationSummary(p, rows).withPhoto, 1);
  });
});

describe('photographs waiting to be used', () => {
  it('are the ones no observation and no answer cites', () => {
    const p = project();
    const a = photo(p, 'Pump room');
    const b = photo(p, 'Lift lobby');
    const c = photo(p, 'Chiller plate');
    assert.equal(unusedPhotos(p).length, 3);
    addObservation(p, { description: 'No second exit.', severity: 'critical', evidenceIds: [a.id] }, 'engineer');
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: { header: [], questions: [{ text: 'How many lifts?' }] } }, 'engineer');
    answerQuestion(p, q.id, q.questions[0]!.id, { answer: 'Five', source: 'site', proof: [{ evidenceId: b.id }] }, 'engineer');
    assert.deepEqual(unusedPhotos(p).map((x) => x.evidenceId), [c.id]);
  });

  it('carry what a model saw and suggested, for a person to take or leave', () => {
    const p = project();
    const shot = photo(p, 'Electrical room');
    shot.attachments[0]!.capture = { zone: 'Electrical room', takenAt: '2026-10-02T09:00:00.000Z' };
    shot.attachments[0]!.observation = {
      subject: 'property',
      description: 'Bundled cables hanging below an open tray.',
      elements: ['cables', 'cable tray'],
      notes: [],
      suggestedFindings: [{ title: 'Loose cabling in the electrical room', observed: 'Cables run outside the tray.', whyItMayMatter: 'Unsupported cables can be damaged.', suggestedSeverity: 'high', confidence: 0.7 }],
      model: 'test',
      at: '2026-10-02T09:01:00.000Z',
    };
    const [candidate] = unusedPhotos(p);
    assert.equal(candidate!.area, 'Electrical room');
    assert.equal(candidate!.seen, 'Bundled cables hanging below an open tray.');
    assert.deepEqual(candidate!.suggestions, [{ title: 'Loose cabling in the electrical room', description: 'Cables run outside the tray. Unsupported cables can be damaged.', severity: 'high' }]);
  });

  it('include the phone’s site-log photographs, filed onto the register once when first used', () => {
    const p = project();
    logSiteEntry(
      p,
      { clientId: 'c1', date: '2026-10-02', workDone: 'Walked the basements.', manpower: [], milestoneUpdates: [], issues: [], photos: [{ storageKey: 'site_1.jpg', fileName: 'basement.jpg', mimeType: 'image/jpeg', caption: 'Ponding at the ramp', takenAt: '2026-10-02T08:00:00.000Z', point: { lat: 12.98, lng: 77.59 } }] },
      'site engineer',
    );
    const [candidate] = unusedPhotos(p);
    assert.ok(candidate!.siteLog, 'still only in the site log');
    assert.equal(candidate!.title, 'Ponding at the ramp');
    const row = fileSiteLogPhoto(p, candidate!.siteLog!.entryId, candidate!.siteLog!.index, 'engineer');
    assert.equal(row.kind, 'photograph');
    assert.equal(row.attachments[0]!.storageKey, 'site_1.jpg');
    assert.equal(row.attachments[0]!.capture?.lat, 12.98);
    assert.equal(fileSiteLogPhoto(p, candidate!.siteLog!.entryId, 0, 'engineer').id, row.id, 'filing it twice files it once');
    assert.equal(p.evidence.filter((e) => e.kind === 'photograph').length, 1);
    assert.deepEqual(unusedPhotos(p).map((x) => x.evidenceId), [row.id], 'now on the register, and still unused');
    assert.throws(() => fileSiteLogPhoto(p, 'nope', 0, 'engineer'), /No site photograph/);
  });
});

describe('the chat proposing an observation', () => {
  it('lands with its area, mitigation and reference', () => {
    const p = project();
    const shot = photo(p, 'Transformer yard');
    const card = createChatProposal(
      'add_finding',
      'No fence around the transformer yard',
      'Seen in the photograph',
      'An observation is added',
      { title: 'No fence around the transformer yard', description: 'The transformer yard is open on two sides.', severity: 'medium', discipline: 'technical', evidenceIds: [shot.id], area: 'Transformer yard', mitigation: 'Fence it.', standardRef: 'NBC 2016 Part 4' },
      'copilot',
    );
    p.chatProposals.push(card);
    commitChatProposal(p, card.id, 'engineer');
    const [o] = observations(p);
    assert.deepEqual([o!.area, o!.mitigation, o!.standardRef], ['Transformer yard', 'Fence it.', 'NBC 2016 Part 4']);
    assert.deepEqual(o!.evidenceIds, [shot.id]);
  });
});

describe('the technical due diligence report', () => {
  it('opens with the engineer’s sections, and prints the observations as a table', () => {
    const p = project();
    const shot = photo(p, 'Machine room');
    addObservation(p, { area: 'Lift core', description: 'The machine room has no ventilation.', severity: 'high', mitigation: 'Add an exhaust fan.', standardRef: 'NBC 2016 Part 8', evidenceIds: [shot.id] }, 'engineer');
    addObservation(p, { area: 'Terrace', description: 'The terrace drain is blocked.', severity: 'medium' }, 'engineer');
    const headings = reportTemplate('technical_dd').map((b) => b.heading);
    assert.deepEqual(headings, ['The property', 'Scope and basis', 'Building information', 'Observations and mitigations', 'Remedial cost by band', 'Inspection record', 'Documents reviewed and outstanding', 'Limitations', 'Opinion']);
    const block = { id: 'b1', origin: 'derived' as const, heading: 'Observations and mitigations', source: { kind: 'observations' as const } };
    const resolved = resolveReportBlock(p, block);
    assert.deepEqual(resolved.table!.columns, ['S. No', 'Area', 'Description', 'Risk category', 'Mitigation', 'Reference']);
    assert.deepEqual(resolved.table!.rows[0]!.cells, ['1', 'Lift core', 'The machine room has no ventilation.', 'High risk', 'Add an exhaust fan.', 'NBC 2016 Part 8']);
    assert.deepEqual(resolved.table!.rows[0]!.evidenceIds, [shot.id]);
    assert.equal(resolved.lines.length, 2, 'the same content as text, for anything that cannot draw a table');
    assert.match(resolved.note ?? '', /1 observation has no mitigation/);
  });

  it('prints only confirmed answers, and says what rests on the seller’s word', () => {
    const p = project();
    const doc = photo(p, 'Lift licence');
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: { header: [{ label: 'City', value: 'Bengaluru' }], questions: [{ text: 'How many lifts?', answer: 'Five' }, { text: 'Lift speed?' }, { text: 'Clear height?' }] } }, 'engineer');
    suggestAnswers(p, q.id, [{ questionId: q.questions[1]!.id, answer: '2.5 m/s', proof: [{ evidenceId: doc.id, page: 1 }] }], 'copilot');
    const resolved = resolveReportBlock(p, { id: 'b2', origin: 'derived', heading: 'Building information', source: { kind: 'questionnaire' } });
    const cells = resolved.table!.rows.map((r) => r.cells);
    assert.deepEqual(cells[0], ['', 'City', 'Bengaluru', '']);
    assert.deepEqual(cells[1], ['1', 'How many lifts?', 'Five', 'Seller said']);
    assert.deepEqual(cells[2], ['2', 'Lift speed?', 'Not answered', ''], 'a suggestion nobody confirmed is not an answer');
    assert.match(resolved.note ?? '', /2 questions are not answered/);
    assert.match(resolved.note ?? '', /1 answer rests on the seller/);
  });

  it('lists the documents by discipline with what was not received, and keeps its tables when issued', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'engineer');
    addObservation(p, { description: 'Exit signage is missing.', severity: 'medium' }, 'engineer');
    const sheet = resolveReportBlock(p, { id: 'b3', origin: 'derived', heading: 'Documents', source: { kind: 'requirement_sheet' } });
    assert.deepEqual(sheet.table!.columns, ['Discipline', 'Document', 'Status']);
    assert.ok(sheet.table!.rows.every((r) => r.cells[2] === 'Not received'));
    assert.match(sheet.note ?? '', /^0 of \d+ received/);

    const report = generateReport(p, { kind: 'technical_dd', generatedBy: 'engineer' });
    issueReport(p, report.id, 'engineer');
    addObservation(p, { description: 'Added after issue.', severity: 'low' }, 'engineer');
    const issued = p.reports.find((r) => r.id === report.id)!;
    const obs = issued.body.blocks.find((b) => b.source?.kind === 'observations')!;
    const frozen = readReportBlock(p, obs, true);
    assert.equal(frozen.table!.rows.length, 1, 'an issued report does not change when the file does');
  });
});
