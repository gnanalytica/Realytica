/**
 * The line a model may not cross, tested as a line rather than as a feature.
 *
 * A photograph is the input a model reads most confidently and a defect is the
 * conclusion a buyer acts on hardest. Everything below is about keeping those
 * two apart: an observation is filed, a defect is proposed, and nothing a model
 * saw ever reaches a register without somebody accepting it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PHOTO_OBSERVATION_RULES,
  addEvidence,
  attachEvidenceFile,
  addSheet,
  commitAiDraft,
  createProject,
  describeObservation,
  emptyObservation,
  observationIsUseful,
  projectGraphOf,
  recordPhotoObservation,
  retrieveProjectNeighbourhood,
  unreadPhotographs,
  type DdProject,
  type PhotoObservation,
} from '@realytica/shared';
import { runPhotoIntelligence } from '../packages/agents/src/agents/photo-intelligence';

function file(): DdProject {
  return createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-P1');
}

function observation(over: Partial<PhotoObservation> = {}): PhotoObservation {
  return {
    subject: 'property',
    description: 'North elevation of a four-storey RCC frame, scaffolding still in place at the top two floors.',
    elements: ['north elevation', 'RCC frame', 'scaffolding'],
    notes: [{ text: 'Dark staining below the parapet, roughly two metres wide', confidence: 0.7, wouldSettle: 'A moisture meter reading at the base of the wall' }],
    suggestedFindings: [],
    model: 'claude-test',
    at: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function photo(project: DdProject, name = 'IMG_0001.jpg') {
  const evidence = addEvidence(project, { title: 'Site photographs', kind: 'photograph' });
  const attachment = attachEvidenceFile(project, evidence.id, { fileName: name, mimeType: 'image/jpeg', sizeBytes: 1024, storageKey: 'k' });
  return { evidence, attachment };
}

describe('a reading is filed, a defect is proposed', () => {
  it('puts the observation on the attachment and nothing in the registers', () => {
    const project = file();
    const { evidence, attachment } = photo(project);
    const { drafts } = recordPhotoObservation(project, evidence.id, attachment.id, observation());
    assert.equal(attachment.observation?.description.startsWith('North elevation'), true);
    assert.deepEqual(drafts, []);
    assert.deepEqual(project.findings, [], 'an observation is not a finding');
  });

  it('turns a suggested defect into a card, never a finding', () => {
    const project = file();
    const { evidence, attachment } = photo(project);
    const { drafts } = recordPhotoObservation(
      project,
      evidence.id,
      attachment.id,
      observation({
        suggestedFindings: [
          {
            title: 'Staining below the parapet, north elevation',
            observed: 'Dark staining roughly two metres wide below the parapet',
            whyItMayMatter: 'Staining in this position often accompanies a failed upstand, which would be a roof repair rather than a redecoration',
            suggestedSeverity: 'medium',
            confidence: 0.6,
          },
        ],
      }),
    );

    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.kind, 'finding');
    assert.equal(drafts[0]!.source, 'model', 'and it is marked as a model’s, not a rule’s');
    assert.deepEqual(project.findings, [], 'still nothing on the register');
  });

  it('keeps the observation and the reasoning in separate sentences on the card', () => {
    // Merged, they read as one confident statement and the reviewer loses the
    // only thing that lets them agree with half of it.
    const project = file();
    const { evidence, attachment } = photo(project);
    const { drafts } = recordPhotoObservation(
      project,
      evidence.id,
      attachment.id,
      observation({
        limits: 'Only the north elevation is in frame.',
        suggestedFindings: [
          { title: 'Staining', observed: 'Dark staining below the parapet', whyItMayMatter: 'May indicate a failed upstand', suggestedSeverity: 'medium', confidence: 0.6 },
        ],
      }),
    );
    const body = drafts[0]!.body;
    assert.match(body, /Seen in IMG_0001\.jpg: Dark staining below the parapet/);
    assert.match(body, /the model's reasoning, not a finding/);
    assert.match(body, /Only the north elevation is in frame/, 'and what the photograph does not show travels with it');
  });

  it('reaches the register only when a person commits the card', () => {
    const project = file();
    const { evidence, attachment } = photo(project);
    const { drafts } = recordPhotoObservation(
      project,
      evidence.id,
      attachment.id,
      observation({
        suggestedFindings: [
          { title: 'Staining below the parapet', observed: 'Dark staining', whyItMayMatter: 'May indicate a failed upstand', suggestedSeverity: 'medium', confidence: 0.6 },
        ],
      }),
    );
    const committed = commitAiDraft(project, drafts[0]!.id, 'R. Iyer');
    assert.equal(project.findings.length, 1);
    assert.equal(project.findings[0]!.id, committed.recordId);
    assert.deepEqual(project.findings[0]!.evidenceIds, [evidence.id], 'and it carries the photograph it came off');
  });

  it('files a photographed document with no notes at all', () => {
    // "The stamp appears faded" about a khata extract would sit on the file
    // looking exactly like an observation about the property.
    const project = file();
    const { evidence, attachment } = photo(project, 'khata.jpg');
    recordPhotoObservation(project, evidence.id, attachment.id, {
      subject: 'document',
      description: 'A photographed khata extract.',
      elements: [],
      notes: [],
      suggestedFindings: [],
      limits: 'A photographed document. Read through the extraction path rather than described here.',
      model: 'claude-test',
      at: '2026-09-01T00:00:00.000Z',
    });
    assert.deepEqual(attachment.observation!.notes, []);
    assert.match(attachment.observation!.limits!, /extraction path/);
  });
});

describe('a reading always says who made it', () => {
  it('puts the model in front of every rendering of it', () => {
    // The cheapest possible guard against a description acquiring the file's
    // own voice, and it has to hold on every surface.
    assert.match(describeObservation(observation()), /^Read by claude-test:/);
  });

  it('says nothing at all for an empty reading', () => {
    assert.equal(describeObservation(emptyObservation('m', 'now', 'too dark')), '');
    assert.equal(observationIsUseful(emptyObservation('m', 'now', 'too dark')), false);
  });

  it('keeps a failed read apart from a photograph nobody looked at', () => {
    // Both look blank; only one of them has been tried, and a batch that
    // silently left twenty unannotated would erase the difference.
    const project = file();
    const { evidence, attachment } = photo(project);
    assert.equal(unreadPhotographs(project).length, 1);
    recordPhotoObservation(project, evidence.id, attachment.id, emptyObservation('claude-test', 'now', 'The photograph is too dark to read.'));
    assert.equal(unreadPhotographs(project).length, 0, 'it has been tried');
    assert.equal(observationIsUseful(attachment.observation), false, 'and it said nothing');
    assert.match(attachment.observation!.limits!, /too dark/);
  });
});

describe('reading four hundred photographs is only worth it if you can find them', () => {
  it('indexes the description into the graph, attributed', () => {
    const project = file();
    const { evidence, attachment } = photo(project);
    recordPhotoObservation(project, evidence.id, attachment.id, observation());
    const node = projectGraphOf(project).nodes.find((n) => n.id === evidence.id);
    assert.match(node!.detail!, /Read by claude-test/);
  });

  it('finds a photograph by what is in it, not by its filename', () => {
    // "Site photographs, tower A" will never match "scaffolding". That is the
    // whole return on reading them.
    const project = file();
    const { evidence, attachment } = photo(project);
    recordPhotoObservation(project, evidence.id, attachment.id, observation());
    const hit = retrieveProjectNeighbourhood(project, 'scaffolding', 1);
    assert.ok(hit.graph.nodes.some((n) => n.id === evidence.id), 'found by a word only the reading contains');
  });
});

describe('what counts as an unread photograph', () => {
  it('leaves plans and documents alone', () => {
    const project = file();
    const gis = addEvidence(project, { title: 'RMP sheet', kind: 'gis' });
    attachEvidenceFile(project, gis.id, { fileName: 'rmp.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'a' });
    const deed = addEvidence(project, { title: 'Sale deed', kind: 'document' });
    attachEvidenceFile(project, deed.id, { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'b' });
    assert.deepEqual(unreadPhotographs(project), []);
  });

  it('leaves a scan some sheet has claimed', () => {
    const project = file();
    const { evidence, attachment } = photo(project, 'layout.jpg');
    assert.equal(unreadPhotographs(project).length, 1);
    addSheet(project, { title: 'Layout', kind: 'layout_plan', evidenceId: evidence.id, attachmentId: attachment.id });
    assert.deepEqual(unreadPhotographs(project), []);
  });
});

describe('the rules are data, so something can check them', () => {
  it('states the observation-not-diagnosis rule first', () => {
    // A rule that exists only inside a system prompt is a rule nothing can
    // check, and this is the one the whole agent turns on.
    assert.match(PHOTO_OBSERVATION_RULES[0]!, /Describe what is visible/);
    assert.match(PHOTO_OBSERVATION_RULES[0]!, /Never state a cause/);
  });

  it('covers scale, people and photographed documents', () => {
    const all = PHOTO_OBSERVATION_RULES.join(' ');
    assert.match(all, /unless a known object gives it scale/);
    assert.match(all, /Never identify a person/);
    assert.match(all, /photograph of a document is not a photograph of the property/);
  });
});

describe('the agent refuses before it spends anything', () => {
  /*
   * Every one of these returns before a token is sent, and each returns a
   * reason a person can act on rather than an exception. The ORDER is the
   * claim: the input is judged before the credentials, because "that is a PDF"
   * is true whether or not a key is configured and it tells somebody what to
   * do — where a missing-key error would send them to a deployment setting
   * that was never the problem.
   */
  const identity = {
    label: 'Harohalli',
    addressLine: 'Kanakapura Road',
    locality: 'Harohalli',
    city: 'Bengaluru',
    state: 'Karnataka',
    parcelId: 'Sy. 42',
  } as Parameters<typeof runPhotoIntelligence>[0]['identity'];

  const base = {
    projectId: 'prj_1',
    evidenceId: 'ev_1',
    attachmentId: 'file_1',
    fileName: 'x.jpg',
    mimeType: 'image/jpeg',
    identity,
  };

  it('says a PDF is not an image, whatever the deployment looks like', async () => {
    const out = await runPhotoIntelligence({ ...base, fileName: 'deed.pdf', mimeType: 'application/pdf', fileBytes: Buffer.from('x') });
    assert.equal(out.run.status, 'cancelled');
    assert.match(out.run.error!, /application\/pdf is not an image/);
    assert.equal(out.isDocument, false, 'and it is not the photographed-document branch either');
  });

  it('says the file could not be read rather than sending nothing', async () => {
    const out = await runPhotoIntelligence({ ...base, fileBytes: null });
    assert.equal(out.run.status, 'cancelled');
    assert.match(out.run.error!, /could not be read/);
  });

  it('names the size when a photograph is too large, and what to do', async () => {
    // A batch of forty phone photographs is the normal case; one 20MB frame
    // through would cost more than the diligence.
    const out = await runPhotoIntelligence({ ...base, fileBytes: Buffer.alloc(6 * 1024 * 1024) });
    assert.equal(out.run.status, 'cancelled');
    assert.match(out.run.error!, /6\.0MB, over the 5MB/);
    assert.match(out.run.error!, /Attach a smaller copy/);
  });

  it('returns an observation carrying the reason, never a bare failure', async () => {
    // A batch must never end up half-annotated with no record of why.
    const out = await runPhotoIntelligence({ ...base, fileName: 'deed.pdf', mimeType: 'application/pdf', fileBytes: Buffer.from('x') });
    assert.equal(out.observation.subject, 'unclear');
    assert.equal(observationIsUseful(out.observation), false);
    assert.match(out.observation.limits!, /not an image/);
    assert.equal(out.run.agent, 'photo_intelligence');
  });
});
