/**
 * Papers read onto the register raise one card a value.
 *
 * A paper filed on the register and read there raises the cards its reading
 * brings: values for the checks they answer, the parcel and the address it
 * names. A second copy of the paper says the same things. Each used to be
 * raised again, so the parcel waited twice, and accepting one left the other
 * to be accepted or set aside by itself. A card that says what one already
 * waiting says is not raised, and the reading's own line lists the one that
 * waits in its place.
 *
 * The sample sale deed, read by this server's rules. No model, no network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, attachEvidenceFile, cardSays, createAssessment, createProject, type ChatProposal, type DdProject } from '@realytica/shared';

const DEED = readFileSync(path.join(__dirname, 'fixtures/documents/Sale_Deed_2019_Sy_118-2_Whitefield.pdf'));
const realFetch = globalThis.fetch;
let dataDir: string;

before(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-register-read-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  globalThis.fetch = (async () => {
    throw new Error('this test has no network');
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  const { releaseOcr } = await import('../apps/api/src/documents/read-text');
  await releaseOcr();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.REALYTICA_DATA_DIR;
});

/** File a copy of the deed on the register and read it there. */
async function readACopy(project: DdProject, fileName: string): Promise<number> {
  const { readOntoRegister } = await import('../apps/api/src/documents/register-read');
  const row = addEvidence(project, { title: fileName, kind: 'document', status: 'received' });
  attachEvidenceFile(project, row.id, { fileName, mimeType: 'application/pdf', sizeBytes: DEED.length, storageKey: `k-${fileName}`, capture: {} }, 'tester');
  return (await readOntoRegister(project, [{ evidenceId: row.id, buffer: DEED, fileName, mimeType: 'application/pdf', sizeBytes: DEED.length, storageKey: `k-${fileName}` }], 'tester')).read;
}

describe('papers read onto the register', () => {
  it('raise no card that says what a waiting card already says, and list the one that waits', async () => {
    const project = createProject({ name: 'Whitefield plot', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-R1');
    createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const waiting = (): ChatProposal[] => project.chatProposals.filter((card) => card.status === 'proposed');

    assert.equal(await readACopy(project, 'deed.pdf'), 1);
    const first = waiting();
    const raised = project.conversation.at(-1)!.proposalIds ?? [];
    assert.ok(first.some((card) => card.title.startsWith('Record the parcel as ')) && first.some((card) => card.kind === 'record_check_fields'), 'the reading raises the parcel it names and values for the checks');
    assert.deepEqual([...raised].sort(), first.map((card) => card.id).sort(), 'and its line lists them');

    // A second copy of the same deed says the same things.
    assert.equal(await readACopy(project, 'deed-copy.pdf'), 1);
    const said = waiting().map(cardSays);
    assert.equal(new Set(said).size, said.length, 'no two waiting cards say the same thing');
    assert.deepEqual(waiting().map((card) => card.id), first.map((card) => card.id), 'nothing new waits');
    const listed = project.conversation.at(-1)!.proposalIds ?? [];
    assert.ok(listed.length > 0 && listed.every((id) => first.some((card) => card.id === id)), 'and the second reading lists the cards that already wait');

    // One of them accepted or set aside is no longer waiting, so what it said can be raised again.
    const parcel = first.find((card) => card.title.startsWith('Record the parcel as '))!;
    parcel.status = 'rejected';
    assert.equal(await readACopy(project, 'deed-again.pdf'), 1);
    assert.equal(waiting().filter((card) => card.title === parcel.title).length, 1, 'a card set aside does not stand in for a new one');
    assert.ok(project.conversation.at(-1)!.proposalIds?.some((id) => id !== parcel.id && project.chatProposals.find((card) => card.id === id)?.title === parcel.title));
  });
});
