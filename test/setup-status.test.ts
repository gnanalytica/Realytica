/**
 * Set up as it stands, and the firm's menu as each person is shown it.
 *
 * Both are pure: the server gathers what is connected and this says each row
 * (working, not set up with what is needed, failing with the last error, or
 * not used yet); and one list says which places of the sidebar a role may
 * use. Every firm, folder and address is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORKSPACE_PLACES, mayOpenWorkspacePlace, setupSaid, setupShown, workspacePlaces, type SetupFacts, type SetupRow, type WorkspaceRole } from '@realytica/shared';

const NAMES = { mail: 'REALYTICA_RESEND_API_KEY', folders: 'GOOGLE_SERVICE_ACCOUNT_JSON', timer: 'CRON_SECRET', model: 'REALYTICA_API_KEY', webhooks: 'REALYTICA_CREDENTIAL_KEY' };
const OFF = { send: false, receive: false, missing: ['REALYTICA_RESEND_API_KEY', 'REALYTICA_OUTSIDE_SECRET'] };
const ON = { send: true, receive: true, missing: [] };

/** A deployment with nothing given to it, and one project. */
function bare(): SetupFacts {
  return { mail: false, channels: { email: OFF, whatsapp: OFF }, folders: { configured: false }, timer: false, model: false, law: [], projects: [{ id: 'prj_1', name: 'Canal Street block', reference: 'RYT-S1' }], names: NAMES };
}

/** A deployment with everything given. */
function full(): SetupFacts {
  return {
    ...bare(),
    mail: true,
    channels: { email: ON, whatsapp: ON },
    folders: { configured: true, address: 'reader@firm-drive.example' },
    timer: true,
    model: true,
    law: [{ title: 'Environment notifications', lastReadAt: '2026-10-12T01:30:00.000Z', lastLookAt: '2026-10-12T01:30:00.000Z' }],
    integrations: { keys: 2, webhooks: true, endpoints: 1, failing: [] },
  };
}

const row = (rows: readonly SetupRow[], key: string): SetupRow => {
  const found = rows.find((held) => held.key === key);
  assert.ok(found, `a row for ${key}`);
  return found;
};

describe('set up, row by row', () => {
  it('says what is needed for everything not set up, with the exact setting for whoever runs the deployment', () => {
    const shown = setupShown(bare());
    assert.deepEqual(shown.firm.map((held) => [held.key, held.standing]), [
      ['mail', 'not_set_up'],
      ['request_email', 'not_set_up'],
      ['request_whatsapp', 'not_set_up'],
      ['folders', 'not_set_up'],
      ['timer', 'not_set_up'],
      ['model', 'not_set_up'],
      ['law', 'not_used'],
    ]);
    for (const held of shown.firm.filter((line) => line.standing === 'not_set_up')) {
      assert.ok(held.needs && held.needs.length > 20, `${held.key} says what is needed`);
      assert.ok(held.settings?.length, `${held.key} names its settings`);
      // The sentence a partner reads names no setting; the settings are their own line.
      assert.doesNotMatch(`${held.says} ${held.needs}`, /[A-Z]{3,}_[A-Z_]+/, held.key);
    }
    assert.deepEqual(row(shown.firm, 'mail').settings, ['REALYTICA_RESEND_API_KEY']);
    assert.deepEqual(row(shown.firm, 'timer').settings, ['CRON_SECRET']);
    assert.deepEqual(row(shown.firm, 'request_email').settings, OFF.missing);
  });

  it('says everything is working where it is, and where each is changed', () => {
    const shown = setupShown(full());
    assert.ok(shown.firm.every((held) => held.standing === 'working'), JSON.stringify(shown.firm.filter((held) => held.standing !== 'working')));
    assert.match(row(shown.firm, 'folders').says, /^Share a folder with reader@firm-drive\.example as a viewer/);
    assert.deepEqual(row(shown.firm, 'law').open, { place: 'law', label: 'Law and policy' });
    assert.deepEqual(row(shown.firm, 'keys').open, { place: 'integrations', label: 'Integrations' });
    assert.ok(shown.firm.every((held) => !held.needs && !held.settings && !held.error));
  });

  it('says a request channel that sends and cannot receive is not set up, and says which half', () => {
    const facts = bare();
    facts.channels.email = { send: true, receive: false, missing: ['REALYTICA_RESEND_WEBHOOK_SECRET'] };
    const email = row(setupShown(facts).firm, 'request_email');
    assert.equal(email.standing, 'not_set_up');
    assert.equal(email.says, 'Requests go out, but a reply cannot come back onto its request.');
    assert.deepEqual(email.settings, ['REALYTICA_RESEND_WEBHOOK_SECRET']);
  });

  it('is failing with the last error when a law source cannot be read or a webhook address stops answering', () => {
    const facts = full();
    facts.law = [
      { title: 'Environment notifications', lastReadAt: '2026-10-12T01:30:00.000Z' },
      { title: 'Eco-sensitive zones', lastError: 'The page did not answer.' },
      { title: 'A paused page', paused: true, lastError: 'Refused.' },
    ];
    facts.integrations = { keys: 0, webhooks: true, endpoints: 2, failing: [{ url: 'https://erp.firm.example/hook', since: '2026-10-09T10:00:00.000Z' }] };
    const shown = setupShown(facts);
    const law = row(shown.firm, 'law');
    assert.deepEqual([law.standing, law.says, law.error], ['failing', '2 pages watched, 1 could not be read.', 'Eco-sensitive zones: The page did not answer.']);
    const hooks = row(shown.firm, 'webhooks');
    assert.equal(hooks.standing, 'failing');
    assert.match(hooks.error!, /^https:\/\/erp\.firm\.example\/hook has not answered since 9 Oct 2026\./);
    assert.equal(row(shown.firm, 'keys').standing, 'not_used');
    assert.equal(setupSaid(shown).split(' · ')[0], '2 failing');
  });

  it('leaves keys and webhooks out for anybody who is not a firm admin', () => {
    const facts = full();
    delete facts.integrations;
    const keys = setupShown(facts).firm.map((held) => held.key);
    assert.ok(!keys.includes('keys') && !keys.includes('webhooks'));
    const off = full();
    off.integrations = { keys: 1, webhooks: false, endpoints: 0, failing: [] };
    const hooks = row(setupShown(off).firm, 'webhooks');
    assert.deepEqual([hooks.standing, hooks.settings], ['not_set_up', ['REALYTICA_CREDENTIAL_KEY']]);
  });

  it('lists each project’s folder and report day, each saying how it stands', () => {
    const none = setupShown(bare()).projects[0]!;
    assert.deepEqual(none.rows.map((held) => [held.key, held.standing, held.open?.place]), [['folder', 'not_set_up', 'documents'], ['report_day', 'not_used', 'reports']]);
    assert.equal(row(none.rows, 'folder').needs, 'Google Drive is not set up for the firm yet: see the row above.');

    const facts = full();
    const setting = { day: 5, reports: ['owner_pack' as const], every: 'month' as const, tell: ['a@firm.example'], setAt: '2026-09-01T00:00:00.000Z', setBy: 'a@firm.example' };
    const counts = { takenIn: 12, changed: 0, skipped: 1, waiting: 0 };
    const connector = { kind: 'google_drive' as const, folderId: 'f1', folderName: 'Canal Street papers', connectedBy: 'a@firm.example', connectedAt: '2026-10-01T00:00:00.000Z', counts, skipped: [] };
    facts.projects = [
      { id: 'prj_1', name: 'Canal Street block', reference: 'RYT-S1', connector: { ...connector, lastSyncAt: '2026-10-12T04:00:00.000Z' }, reportDay: setting },
      { id: 'prj_2', name: 'Hill Road offices', reference: 'RYT-S2', connector: { ...connector, lastError: { message: 'The folder is no longer shared.', at: '2026-10-11T04:00:00.000Z', revoked: true } } },
      { id: 'prj_3', name: 'Lake plot', reference: 'RYT-S3' },
    ];
    const [working, failing, unused] = setupShown(facts).projects;
    assert.deepEqual([row(working!.rows, 'folder').standing, row(working!.rows, 'folder').says], ['working', 'Canal Street papers, last read 12 Oct 2026. 12 papers taken in.']);
    assert.equal(row(working!.rows, 'report_day').standing, 'working');
    assert.match(row(working!.rows, 'report_day').says, /Prepared on the day, issued by a person\.$/);
    assert.deepEqual([row(failing!.rows, 'folder').standing, row(failing!.rows, 'folder').error], ['failing', 'The folder is no longer shared. (11 Oct 2026)']);
    assert.deepEqual([row(unused!.rows, 'folder').standing, row(unused!.rows, 'report_day').standing], ['not_used', 'not_used']);

    // A report day with no timer is set and does nothing: said, with what it waits for.
    const noTimer = { ...facts, timer: false };
    const day = row(setupShown(noTimer).projects[0]!.rows, 'report_day');
    assert.deepEqual([day.standing, day.needs], ['not_set_up', 'The timer is not set up for the firm yet: see the row above.']);
  });
});

describe('the firm’s menu', () => {
  const shownTo = (role: WorkspaceRole | undefined) => workspacePlaces(role).map((place) => place.key);

  it('lists for each person only the places they can use', () => {
    const everybody = ['portfolio', 'work', 'requests', 'members', 'libraries', 'about'];
    assert.deepEqual(shownTo('collaborator'), everybody);
    assert.deepEqual(shownTo(undefined), everybody, 'until the server has said who this is');
    for (const role of ['staff', 'viewer'] as const) assert.deepEqual(shownTo(role), ['portfolio', 'work', 'requests', 'members', 'law', 'libraries', 'setup', 'about'], role);
    for (const role of ['owner', 'manager'] as const) assert.deepEqual(shownTo(role), WORKSPACE_PLACES.map((place) => place.key), role);
  });

  it('keeps Law and policy and Set up to the firm’s own people, and Integrations to its owner and managers', () => {
    assert.equal(mayOpenWorkspacePlace('collaborator', 'law'), false);
    assert.equal(mayOpenWorkspacePlace('collaborator', 'setup'), false);
    assert.equal(mayOpenWorkspacePlace('staff', 'law'), true);
    assert.equal(mayOpenWorkspacePlace('staff', 'integrations'), false);
    assert.equal(mayOpenWorkspacePlace('viewer', 'integrations'), false);
    assert.equal(mayOpenWorkspacePlace('manager', 'integrations'), true);
  });

  it('names each place once, by one address', () => {
    assert.equal(new Set(WORKSPACE_PLACES.map((place) => place.to)).size, WORKSPACE_PLACES.length);
    assert.equal(new Set(WORKSPACE_PLACES.map((place) => place.label)).size, WORKSPACE_PLACES.length);
    assert.deepEqual(WORKSPACE_PLACES.filter((place) => place.group === 'work').map((place) => place.label), ['Portfolio', 'My work', 'Requests', 'People']);
  });
});
