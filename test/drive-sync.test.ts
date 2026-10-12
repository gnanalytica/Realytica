/**
 * A project's Google Drive folder, read against a stand-in for Drive.
 *
 * The stand-in (`fake-drive.ts`) answers the token grant and the Drive calls
 * in Google's shapes. Everything on this side of it is the real thing: the
 * connector signs its JWT and builds its queries, the sync walks the folder,
 * and each file goes down the path a dropped paper goes down, into the real
 * store on a scratch folder. So these say what a person would see on the
 * record: the paper, where it came from, and what was left out and why.
 *
 * The firm, the projects, the folders and the files are invented.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DD_TYPE_DEFINITIONS, connectFolder, connectorStanding, createAssessment, createProject, folderIdOf, originSaid, projectView, type DdProject, type EvidenceAttachment, type ProjectGrant } from '@realytica/shared';
import { DOC_TYPE, FORM_TYPE, fakeDrive, type FakeDrive } from './fake-drive';

let dataDir: string;
let n = 0;

type Sync = typeof import('../apps/api/src/connectors/sync');
type Cron = typeof import('../apps/api/src/cron/drive-sync');
type Drive = typeof import('../apps/api/src/connectors/google-drive');
let sync: Sync;
let cron: Cron;
let drive: Drive;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-drive-sync-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  const { initStore } = await import('../apps/api/src/store');
  await initStore();
  sync = await import('../apps/api/src/connectors/sync');
  cron = await import('../apps/api/src/cron/drive-sync');
  drive = await import('../apps/api/src/connectors/google-drive');
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.REALYTICA_DATA_DIR;
});

/** A project in the store, connected to the folder `root` of a stand-in Drive that holds it and has shared it. */
async function connected(name: string): Promise<{ id: string; root: string; fake: FakeDrive; provider: ReturnType<Drive['googleDrive']> }> {
  const { store } = await import('../apps/api/src/store');
  n += 1;
  const fake = fakeDrive();
  const root = `folder-root-${String(n).padStart(4, '0')}`;
  fake.folder(root, 'Project papers');
  fake.share(root);
  const project = createProject({ name, type: 'commercial', location: 'Canal Road', city: 'Kadamba' }, `RYT-DS${n}`);
  connectFolder(project, { kind: 'google_drive', folderId: root, folderName: 'Project papers' }, 'dev@builders.example');
  (store.data.projects ??= []).push(project);
  await store.save();
  return { id: project.id, root, fake, provider: drive.googleDrive({ fetch: fake.fetch, env: { GOOGLE_SERVICE_ACCOUNT_JSON: fake.json } }) };
}

async function held(id: string): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  return store.data.projects!.find((project) => project.id === id)!;
}

/** The files on the record that a folder brought, with the row each is on. */
function brought(project: DdProject): Array<EvidenceAttachment & { row: string }> {
  return project.evidence.flatMap((row) => row.attachments.filter((file) => file.origin).map((file) => ({ ...file, row: row.id })));
}

const T0 = new Date('2026-03-02T06:00:00.000Z');
const LETTER = 'To the project office.\nThe piling on grid C was completed on 14 February 2026.\nPlease release the hold on the pile caps.\n';

describe('the first read of a folder', () => {
  it('takes in every file, those in folders inside it and a Google Doc as a PDF, each saying where it came from', async () => {
    const { id, root, fake, provider } = await connected('Canal Road offices');
    fake.file('file-letter-0001', 'Piling letter.txt', root, LETTER);
    fake.folder('folder-site-0001', 'Site', root);
    fake.folder('folder-week-0001', 'Week 9', 'folder-site-0001');
    fake.file('file-diary-0001', 'Site diary.txt', 'folder-week-0001', 'Site diary for week 9.\nConcrete poured to the level 2 slab on 20 February 2026.\n');
    fake.file('file-doc-0001', 'Minutes of the design meeting', root, '%PDF-1.4 not a real page\n', { mimeType: DOC_TYPE });

    const run = await sync.syncFolder(id, { now: T0, provider });
    assert.deepEqual(run, { takenIn: 3, changed: 0, skipped: 0, waiting: 0, failed: 0 });

    const project = await held(id);
    const files = brought(project);
    assert.deepEqual(files.map((file) => file.origin!.path).sort(), ['Minutes of the design meeting.pdf', 'Piling letter.txt', 'Site / Week 9 / Site diary.txt']);
    const diary = files.find((file) => file.origin!.fileId === 'file-diary-0001')!;
    assert.equal(originSaid(diary.origin!), 'Google Drive · Site / Week 9 / Site diary.txt');
    assert.equal(diary.origin!.link, 'https://drive.google.com/open?id=file-diary-0001');
    assert.match(diary.origin!.checksum, /^[0-9a-f]{32}$/);
    // The Google Doc was asked for as a PDF, and is filed under a name that says so.
    const minutes = files.find((file) => file.origin!.fileId === 'file-doc-0001')!;
    assert.equal(minutes.fileName, 'Minutes of the design meeting.pdf');
    assert.equal(minutes.mimeType, 'application/pdf');
    assert.ok(fake.calls.some((call) => call.includes('/file-doc-0001/export') && call.includes('mimeType=application%2Fpdf')));

    // Its bytes are in the project's own storage, and what it says was read.
    const { storageAdapter } = await import('../apps/api/src/storage');
    assert.equal((await storageAdapter.getDocument(id, files.find((file) => file.origin!.fileId === 'file-letter-0001')!.storageKey))?.toString('utf-8'), LETTER);
    assert.ok(diary.reading, 'how much of the file was read is kept with it');

    // The trail names the folder, not a person who dropped nothing.
    assert.ok(project.audit.some((line) => line.actor === 'Google Drive folder'));
    assert.equal(project.connector!.counts.takenIn, 3);
    assert.equal(project.connector!.lastSyncAt, T0.toISOString());
    assert.equal(project.connector!.cursor, '2026-03-02T05:55:00.000Z');
    assert.equal(connectorStanding(project.connector!), 'read');
    // One token, asked for with a JWT the stand-in checked, served every call.
    assert.equal(fake.calls.filter((call) => call.startsWith('POST /token')).length, 1);
  });

  it('is not shown to somebody working from a grant: neither the folder nor what was left out', async () => {
    const { id, root, fake, provider } = await connected('Mill Lane flats');
    fake.file('file-clip-0001', 'Walkthrough.mp4', root, 'not a film', { mimeType: 'video/mp4' });
    await sync.syncFolder(id, { now: T0, provider });
    const project = await held(id);
    assert.equal(project.connector!.skipped.length, 1);
    const grant: ProjectGrant = { id: 'grant-1', tenantId: 't', projectId: id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: T0.toISOString(), createdBy: 'dev@builders.example' };
    assert.equal(projectView(project, { kind: 'granted', grant, email: 'sam@site.example' }).project.connector, undefined);
  });

  it('hands that person a paper the folder brought without its path or its link there', async () => {
    const { id, root, fake, provider } = await connected('Weir Road flats');
    fake.folder('folder-private-0001', 'Board papers, not for site', root);
    fake.file('file-letter-0009', 'Letter.txt', 'folder-private-0001', LETTER);
    await sync.syncFolder(id, { now: T0, provider });
    const project = await held(id);
    const dd = DD_TYPE_DEFINITIONS.find((d) => d.key !== 'custom')!;
    const assessment = createAssessment(project, { ddType: dd.key, owner: 'dev@builders.example', targetType: 'project', name: dd.label }, 'dev@builders.example');
    const row = project.evidence.find((held) => held.attachments.some((file) => file.origin))!;
    row.assessmentIds = [assessment.id];
    assert.equal(row.attachments[0]!.origin!.path, 'Board papers, not for site / Letter.txt');
    const grant: ProjectGrant = { id: 'grant-2', tenantId: 't', projectId: id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: T0.toISOString(), createdBy: 'dev@builders.example' };
    const copy = projectView(project, { kind: 'granted', grant, email: 'sam@site.example' }).project;
    const theirs = copy.evidence.find((held) => held.id === row.id)!;
    assert.equal(theirs.attachments[0]!.fileName, 'Letter.txt', 'the paper itself is theirs to read');
    assert.equal(theirs.attachments[0]!.origin, undefined);
    assert.ok(!JSON.stringify(copy).includes('Board papers'), 'and nothing else in their copy names the folder');
    assert.equal(row.attachments[0]!.origin!.path, 'Board papers, not for site / Letter.txt', 'the firm’s own record keeps it');
    assert.equal(projectView(project, { kind: 'full' }).project.evidence.find((held) => held.id === row.id)!.attachments[0]!.origin!.path, 'Board papers, not for site / Letter.txt');
  });
});

describe('a second read', () => {
  it('takes nothing twice, and a copy of a file already taken is left out as the same file', async () => {
    const { id, root, fake, provider } = await connected('Quarry Hill sheds');
    fake.file('file-letter-0002', 'Piling letter.txt', root, LETTER);
    await sync.syncFolder(id, { now: T0, provider });
    const first = brought(await held(id)).length;
    assert.equal(first, 1);

    // Read whole again, as a person's press does: the file is listed, and passed over.
    const again = await sync.syncFolder(id, { now: new Date(T0.getTime() + 60_000), provider, full: true });
    assert.deepEqual(again, { takenIn: 0, changed: 0, skipped: 0, waiting: 0, failed: 0 });
    assert.equal(brought(await held(id)).length, first);
    assert.equal(fake.downloads().length, 1);

    // The same letter, copied into a folder inside it under another name.
    fake.folder('folder-copy-0002', 'Copies', root);
    fake.file('file-copy-0002', 'Piling letter (1).txt', 'folder-copy-0002', LETTER, { at: '2026-03-02T07:00:00.000Z' });
    const third = await sync.syncFolder(id, { now: new Date(T0.getTime() + 2 * 3_600_000), provider });
    assert.equal(third.takenIn, 0);
    assert.equal(third.skipped, 1);
    const project = await held(id);
    assert.equal(brought(project).length, 1);
    assert.deepEqual(project.connector!.skipped.map(({ path, reason }) => ({ path, reason })), [{ path: 'Copies / Piling letter (1).txt', reason: 'The same file as Piling letter.txt, which is on the record.' }]);
    assert.equal(fake.downloads().length, 1, 'a copy is known by its checksum, and never downloaded');
  });

  it('takes nothing twice when the ledger is lost: the record’s own files say what was taken', async () => {
    const { id, root, fake, provider } = await connected('Ferry Street yard');
    fake.file('file-letter-0003', 'Piling letter.txt', root, LETTER);
    await sync.syncFolder(id, { now: T0, provider });
    await sync.forgetLedger(id);
    const again = await sync.syncFolder(id, { now: new Date(T0.getTime() + 60_000), provider, full: true });
    assert.equal(again.takenIn, 0);
    assert.equal(brought(await held(id)).length, 1);
  });

  it('asks only for what was made or changed since the last full read, and takes that', async () => {
    const { id, root, fake, provider } = await connected('Orchard Row houses');
    fake.file('file-old-0004', 'Soil report.txt', root, 'Soil investigation report.\nSafe bearing capacity 180 kN per square metre.\n');
    await sync.syncFolder(id, { now: T0, provider });
    assert.ok(!fake.queries[0]!.includes('modifiedTime'), 'the first read asks for everything');

    // Put there the next morning: made after the cursor, though last changed on somebody’s disk a year before.
    fake.file('file-new-0004', 'Structural drawings list.txt', root, 'Drawing list.\nS-101 Foundation plan\nS-102 Column schedule\n', { at: '2026-03-03T04:00:00.000Z' });
    const before = fake.queries.length;
    const run = await sync.syncFolder(id, { now: new Date('2026-03-03T06:00:00.000Z'), provider });
    assert.deepEqual(run, { takenIn: 1, changed: 0, skipped: 0, waiting: 0, failed: 0 });
    const asked = fake.queries[before]!;
    assert.match(asked, /^'folder-root-\d+' in parents and trashed = false and \(mimeType = 'application\/vnd\.google-apps\.folder' or modifiedTime > '2026-03-02T05:55:00\.000Z' or createdTime > '2026-03-02T05:55:00\.000Z'\)$/);
    const project = await held(id);
    assert.deepEqual(brought(project).map((file) => file.origin!.fileId).sort(), ['file-new-0004', 'file-old-0004']);
    assert.equal(project.connector!.cursor, '2026-03-03T05:55:00.000Z');
  });
});

describe('a paper the record has lost', () => {
  it('is taken again: a save from an older copy of the project took the row out, and the ledger alone does not keep it out', async () => {
    const { store } = await import('../apps/api/src/store');
    const { id, root, fake, provider } = await connected('Quarry Road sheds');
    fake.file('file-letter-0010', 'Piling letter.txt', root, LETTER);
    assert.equal((await sync.syncFolder(id, { now: T0, provider })).takenIn, 1);
    // Another instance saves the project as it read it before the folder was read.
    const project = await held(id);
    project.evidence = project.evidence.filter((row) => !row.attachments.some((file) => file.origin));
    project.updatedAt = new Date().toISOString();
    await store.save();
    assert.equal(brought(await held(id)).length, 0);

    const again = await sync.syncFolder(id, { now: new Date(T0.getTime() + 3_600_000), provider, full: true });
    assert.deepEqual([again.takenIn, again.changed, again.failed], [1, 0, 0]);
    assert.deepEqual(brought(await held(id)).map((file) => file.origin!.path), ['Piling letter.txt']);
    // And once it is on the record, a third read passes over it.
    assert.equal((await sync.syncFolder(id, { now: new Date(T0.getTime() + 7_200_000), provider, full: true })).takenIn, 0);
  });
});

describe('a file changed in the folder', () => {
  it('is taken in again as a paper dropped a second time is, and counted as changed', async () => {
    const { id, root, fake, provider } = await connected('Tannery Wharf');
    fake.file('file-prog-0005', 'Programme.txt', root, 'Construction programme, revision A.\nPractical completion 30 November 2026.\n');
    await sync.syncFolder(id, { now: T0, provider });

    fake.change('file-prog-0005', 'Construction programme, revision B.\nPractical completion 15 January 2027.\n', '2026-03-04T10:00:00.000Z');
    const run = await sync.syncFolder(id, { now: new Date('2026-03-05T06:00:00.000Z'), provider });
    assert.deepEqual(run, { takenIn: 1, changed: 1, skipped: 0, waiting: 0, failed: 0 });

    const project = await held(id);
    const states = brought(project).filter((file) => file.origin!.fileId === 'file-prog-0005');
    assert.equal(states.length, 2, 'both states of the file are on the record');
    assert.notEqual(states[0]!.origin!.checksum, states[1]!.origin!.checksum);
    assert.notEqual(states[0]!.storageKey, states[1]!.storageKey);
    assert.equal(states.find((file) => file.origin!.modifiedAt === '2026-03-04T10:00:00.000Z')!.origin!.takenAt, '2026-03-05T06:00:00.000Z');
    assert.deepEqual(project.connector!.counts, { takenIn: 2, changed: 1, skipped: 0, waiting: 0 });
  });
});

describe('a folder of more files than a page or a run holds', () => {
  it('follows every page of a listing', async () => {
    const { id, root, fake } = await connected('Granary Square');
    for (let i = 1; i <= 5; i += 1) fake.file(`file-page-${i}-0006`, `Inspection note ${i}.txt`, root, `Inspection note ${i}.\nRebar checked at grid ${i}.\n`);
    const provider = drive.googleDrive({ fetch: fake.fetch, env: { GOOGLE_SERVICE_ACCOUNT_JSON: fake.json }, pageSize: 2 });
    const run = await sync.syncFolder(id, { now: T0, provider });
    assert.equal(run.takenIn, 5);
    const lists = fake.calls.filter((call) => call.startsWith('GET /drive/v3/files?'));
    assert.equal(lists.length, 3);
    assert.deepEqual(lists.map((call) => new URLSearchParams(call.split('?')[1]).get('pageToken')), [null, '2', '4']);
  });

  it('stops at its limit, counts what waits, leaves the cursor, and the next read takes the rest', async () => {
    const { id, root, fake, provider } = await connected('Lime Kiln Lane');
    for (let i = 1; i <= 5; i += 1) fake.file(`file-cap-${i}-0007`, `Delivery note ${i}.txt`, root, `Delivery note ${i}.\nCement, ${i * 40} bags.\n`);
    const first = await sync.syncFolder(id, { now: T0, provider, maxFiles: 2 });
    assert.deepEqual(first, { takenIn: 2, changed: 0, skipped: 0, waiting: 3, failed: 0 });
    let project = await held(id);
    assert.equal(project.connector!.counts.waiting, 3);
    assert.equal(project.connector!.cursor, undefined);
    assert.equal(connectorStanding(project.connector!), 'waiting');

    const second = await sync.syncFolder(id, { now: new Date(T0.getTime() + 60_000), provider });
    assert.deepEqual(second, { takenIn: 3, changed: 0, skipped: 0, waiting: 0, failed: 0 });
    project = await held(id);
    assert.equal(brought(project).length, 5);
    assert.equal(project.connector!.counts.waiting, 0);
    assert.ok(project.connector!.cursor);
  });
});

describe('a file that cannot be taken in', () => {
  it('is listed as left out with the reason, is never downloaded, and is not listed twice', async () => {
    const { id, root, fake, provider } = await connected('Station Yard');
    fake.file('file-film-0008', 'Walkthrough.mp4', root, 'not a film', { mimeType: 'video/mp4' });
    fake.file('file-big-0008', 'Full drawing set.pdf', root, '%PDF-1.4', { mimeType: 'application/pdf', claimedSize: 30 * 1024 * 1024 });
    fake.file('file-form-0008', 'Snag form', root, '', { mimeType: FORM_TYPE });
    fake.file('file-none-0008', 'Blank.txt', root, '');
    fake.file('file-ok-0008', 'Cube test results.txt', root, 'Cube test results.\n28 day strength 32 N per square millimetre.\n');

    const run = await sync.syncFolder(id, { now: T0, provider });
    assert.deepEqual(run, { takenIn: 1, changed: 0, skipped: 4, waiting: 0, failed: 0 });
    let project = await held(id);
    const reasons = Object.fromEntries(project.connector!.skipped.map((skipped) => [skipped.path, skipped.reason]));
    assert.deepEqual(reasons, {
      'Walkthrough.mp4': 'A .mp4 file cannot be read here. PDFs, images, text, Word and Excel files can.',
      'Full drawing set.pdf': 'Larger than 25 MB, the most one file can be.',
      'Snag form': 'A Google Form cannot be taken in as a file.',
      'Blank.txt': 'The file is empty.',
    });
    assert.deepEqual(fake.downloads().map((call) => /files\/([^?/]+)/.exec(call)![1]), ['file-ok-0008']);
    assert.equal(brought(project).length, 1);

    await sync.syncFolder(id, { now: new Date(T0.getTime() + 60_000), provider, full: true });
    project = await held(id);
    assert.equal(project.connector!.skipped.length, 4);
    assert.equal(project.connector!.counts.skipped, 4);
  });
});

describe('a folder that is no longer shared', () => {
  it('fails that read with the address to share with, keeps what was taken, and reads again once shared', async () => {
    const { id, root, fake, provider } = await connected('Weir Cottage');
    fake.file('file-letter-0009', 'Piling letter.txt', root, LETTER);
    await sync.syncFolder(id, { now: T0, provider });

    fake.unshare(root);
    const run = await sync.syncFolder(id, { now: new Date('2026-03-03T06:00:00.000Z'), provider });
    assert.equal(run.error, `The folder is no longer shared with ${fake.address}. Share it again, or disconnect it.`);
    let project = await held(id);
    assert.deepEqual(project.connector!.lastError, { message: run.error, at: '2026-03-03T06:00:00.000Z', revoked: true });
    assert.equal(connectorStanding(project.connector!), 'revoked');
    assert.equal(project.connector!.lastSyncAt, T0.toISOString(), 'the last read that went through is still the last');
    assert.equal(brought(project).length, 1);

    fake.share(root);
    const back = await sync.syncFolder(id, { now: new Date('2026-03-04T06:00:00.000Z'), provider });
    assert.equal(back.error, undefined);
    project = await held(id);
    assert.equal(project.connector!.lastError, undefined);
    assert.equal(connectorStanding(project.connector!), 'read');
  });
});

describe('two reads of one folder at once', () => {
  it('the second finds the first at work and does nothing', async () => {
    const { id, root, fake, provider } = await connected('Rope Walk');
    fake.file('file-letter-0010', 'Piling letter.txt', root, LETTER);
    const [a, b] = await Promise.all([sync.syncFolder(id, { now: T0, provider }), new Promise<Awaited<ReturnType<Sync['syncFolder']>>>((resolve) => setTimeout(() => void sync.syncFolder(id, { now: T0, provider }).then(resolve), 5))]);
    assert.equal(a.takenIn + b.takenIn, 1);
    assert.ok(a.busy || b.busy);
    assert.equal(brought(await held(id)).length, 1);
    // The mark is gone with the run that left it.
    assert.equal((await sync.syncFolder(id, { now: new Date(T0.getTime() + 60_000), provider, full: true })).busy, undefined);
  });
});

describe('the timed read of every project', () => {
  it('goes on past a project whose folder fails and one storage does not answer for, and counts them', async () => {
    const good = await connected('Brick Field one');
    const broken = await connected('Brick Field two');
    const unread = await connected('Brick Field three');
    const also = await connected('Brick Field four');
    // One Drive for all four, as a deployment has: the others' folders are put on the first's.
    const { fake, provider } = good;
    for (const other of [broken, unread, also]) {
      fake.folder(other.root, 'Project papers');
      fake.share(other.root);
    }
    fake.file('file-a-0011', 'Notice one.txt', good.root, 'Notice of delay.\nSeven days claimed.\n');
    fake.file('file-b-0011', 'Notice two.txt', broken.root, 'Notice of delay.\nNine days claimed.\n');
    fake.file('file-c-0011', 'Notice three.txt', unread.root, 'Notice of delay.\nEleven days claimed.\n');
    fake.file('file-d-0011', 'Notice four.txt', also.root, 'Notice of delay.\nThirteen days claimed.\n');
    fake.breakList(broken.root);

    const mine = new Set([good.id, broken.id, unread.id, also.id]);
    const { store } = await import('../apps/api/src/store');
    const source: import('../apps/api/src/connectors/sync').SyncSource = {
      fresh: async (id) => {
        if (id === unread.id) throw new Error('storage did not answer');
        return sync.fromStore.fresh(id);
      },
      save: sync.fromStore.save,
    };
    const out = await cron.driveSync(T0, { provider, source, projects: () => store.data.projects!.filter((project) => mine.has(project.id)) });
    assert.deepEqual(out, { projects: 4, read: 2, takenIn: 2, changed: 0, skipped: 0, waiting: 0, failed: 2, busy: 0, notReached: 0, notSetUp: 0 });
    assert.equal(brought(await held(good.id)).length, 1);
    assert.equal(brought(await held(also.id)).length, 1);
    assert.match((await held(broken.id)).connector!.lastError!.message, /^The folder could not be read: Google Drive did not list the folder: Backend Error/);
    assert.equal((await held(broken.id)).connector!.lastError!.revoked, undefined);

    // Called again the same day: nothing is taken twice, and the folder that failed is read.
    const again = await cron.driveSync(new Date(T0.getTime() + 3_600_000), { provider, projects: () => store.data.projects!.filter((project) => mine.has(project.id)) });
    assert.deepEqual(again, { projects: 4, read: 4, takenIn: 2, changed: 0, skipped: 0, waiting: 0, failed: 0, busy: 0, notReached: 0, notSetUp: 0 });
    for (const each of [good, broken, unread, also]) assert.equal(brought(await held(each.id)).length, 1);
  });

  it('reads nothing and calls nobody where the deployment holds no service account', async () => {
    const { id, fake } = await connected('Salt Marsh');
    const { store } = await import('../apps/api/src/store');
    const provider = drive.googleDrive({ fetch: fake.fetch, env: {} });
    const out = await cron.driveSync(T0, { provider, projects: () => store.data.projects!.filter((project) => project.id === id) });
    assert.equal(out.notSetUp, 1);
    assert.equal(out.read, 0);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(await sync.syncFolder(id, { now: T0, provider }), { takenIn: 0, changed: 0, skipped: 0, waiting: 0, failed: 0, error: 'The firm has not set this up.' });
  });
});

describe('what a deployment and a person give it', () => {
  it('reads the service account as JSON or base64, and nothing from anything else', () => {
    const fake = fakeDrive();
    assert.equal(drive.serviceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: fake.json })?.client_email, fake.address);
    assert.equal(drive.serviceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(fake.json).toString('base64') })?.client_email, fake.address);
    assert.equal(drive.serviceAccount({}), undefined);
    assert.equal(drive.serviceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not a key file' }), undefined);
    assert.equal(drive.serviceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"someone@example.test"}' }), undefined);
  });

  it('finds the folder in a pasted link, and none in anything else', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    assert.equal(folderIdOf('google_drive', `https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
    assert.equal(folderIdOf('google_drive', `https://drive.google.com/drive/u/0/folders/${id}`), id);
    assert.equal(folderIdOf('google_drive', `https://drive.google.com/open?id=${id}`), id);
    assert.equal(folderIdOf('google_drive', `  ${id}  `), id);
    assert.equal(folderIdOf('google_drive', `https://files.example.test/drive/folders/${id}`), undefined);
    assert.equal(folderIdOf('google_drive', `http://drive.google.com/drive/folders/${id}`), undefined);
    assert.equal(folderIdOf('google_drive', "x' or name contains '"), undefined);
    assert.equal(folderIdOf('google_drive', ''), undefined);
  });
});
