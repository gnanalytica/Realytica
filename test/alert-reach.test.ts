/**
 * Who an alert reaches.
 *
 * An alert is written from the whole file: one about an action past its date
 * says what the action is and the meeting it came from. These hold that it
 * reaches nobody the action is withheld from. Not in the copy of the project
 * somebody working from a grant is sent, where an alert stays only if that
 * copy's own records raise it, in that copy's words. And not by mail or push,
 * where a name on an alert is a person only among those who could read the
 * alert in the app.
 *
 * Every name, firm and line of notes here is invented.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { commitChatProposal, createProject, createProjectGrant, keepMeeting, markAlertsRead, projectView, syncAlerts, type DdProject, type ProjectAlert, type ProjectGrant } from '@realytica/shared';

const LEAD = 'lata@firm.test';
const SUMA = 'suma@soil-lab.test';
const TENANT = 'tnt_reach';

/**
 * A project whose meeting gave two actions, both long past their date: one on
 * "Ramesh", by name, and one on an outside soil lab, by its address. The lab
 * works from a grant that reaches no assessment, so of the two actions its
 * copy of the project holds its own and not the other.
 */
function plot(): { project: DdProject; grant: ProjectGrant; onRamesh: ProjectAlert; onSuma: ProjectAlert } {
  const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0061');
  project.tenantId = TENANT;
  const { cards } = keepMeeting(
    project,
    {
      file: { storageKey: 'notes.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 1 },
      came: 'pasted',
      reading: {
        heldOn: '2020-01-02',
        attendees: ['Lata Halemane', 'Ramesh Tunga'],
        items: [
          { kind: 'action', text: 'Ramesh to settle the dispute with the neighbour over the encroachment', owner: 'Ramesh', dueDate: '2020-01-10', quote: 'Action: Ramesh to settle the dispute with the neighbour over the encroachment by 10 January', readBy: 'rules' },
          { kind: 'action', text: 'Send the soil report', owner: SUMA, dueDate: '2020-01-12', quote: 'Action: the soil lab to send the soil report by 12 January', readBy: 'rules' },
        ],
      },
    },
    LEAD,
  );
  project.chatProposals.push(...cards);
  for (const card of cards) commitChatProposal(project, card.id, LEAD);
  const raised = syncAlerts(project).filter((alert) => alert.key.startsWith('action:'));
  const of = (words: string) => raised.find((alert) => alert.title.includes(words))!;
  const grant = createProjectGrant({ email: SUMA }, { id: 'grt_1', tenantId: TENANT, projectId: project.id, createdBy: LEAD });
  return { project, grant, onRamesh: of('Ramesh to settle'), onSuma: of('soil report') };
}

let dataDir: string;

before(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-alert-reach-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
});

after(() => {
  delete process.env.REALYTICA_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('an alert about an action past its date', () => {
  it('is in a grant reader’s copy only where that copy holds the action, and says nothing of what was withheld', () => {
    const { project, grant, onRamesh, onSuma } = plot();
    assert.match(onRamesh.detail, /on Ramesh\. From the meeting of 2 Jan 2020\.$/, 'as the firm reads it: the action, who it is on and the meeting it came from');
    markAlertsRead(project, 'all', LEAD);

    const copy = projectView(project, { kind: 'granted', grant, email: SUMA }).project;
    assert.deepEqual([copy.meetings, copy.chatProposals, copy.actions.map((action) => action.title)], [[], [], ['Send the soil report']]);
    const told = (copy.alerts ?? []).filter((alert) => alert.key.startsWith('action:'));
    assert.deepEqual(told.map((alert) => [alert.key, alert.title, alert.detail, alert.readBy]), [[onSuma.key, 'Overdue: Send the soil report', `Due 12 Jan 2020, on ${SUMA}.`, []]], 'her own action, with no meeting named and nobody else’s reading of it');
    assert.doesNotMatch(JSON.stringify(copy.alerts), /Ramesh|encroachment|meeting of|lata@firm/);
    assert.ok((project.alerts ?? []).some((alert) => alert.key === onRamesh.key && alert.detail.includes('From the meeting')), 'and the file itself is as it was');
  });

  it('is mailed by name only to somebody who could read it in the app, and to nobody where two go by the name', async () => {
    const { store } = await import('../apps/api/src/store');
    const { alertNamed, alertRecipients, mayHear } = await import('../apps/api/src/notify');
    const { project, grant, onRamesh, onSuma } = plot();
    const member = (email: string, name: string, role: 'owner' | 'staff' | 'collaborator') => ({ tenantId: TENANT, email, name, role, createdAt: '2020-01-01T00:00:00.000Z' });
    store.data.tenants = [{ id: TENANT, name: 'Firm', createdAt: '2020-01-01T00:00:00.000Z' }];
    store.data.grants = [grant];
    // A Ramesh from outside, in the workspace for another project: no grant on this one and not on its team.
    store.data.memberships = [member(LEAD, 'Lata Halemane', 'owner'), member('ramesh@other-firm.test', 'Ramesh Kallusanka', 'collaborator'), member(SUMA, 'Suma Belliappa', 'collaborator')];

    assert.deepEqual(alertNamed(project, onRamesh), [], 'he is not who an action on this project is on');
    assert.equal(mayHear(project, onRamesh, 'ramesh@other-firm.test'), false);

    // The firm's own Ramesh is.
    store.data.memberships.push(member('ramesh@firm.test', 'Ramesh Tunga', 'staff'));
    assert.deepEqual(alertNamed(project, onRamesh), ['ramesh@firm.test']);

    // Two of the firm's own go by the name: nobody is sent it by name, and the department's lead still is.
    store.data.memberships.push(member('ramesh.i@firm.test', 'Ramesh Iyengar', 'staff'));
    assert.deepEqual(alertNamed(project, onRamesh), []);
    assert.deepEqual(alertRecipients(project, onRamesh.department), [LEAD]);

    // Somebody outside is told of the action their grant reaches, and of no other.
    assert.deepEqual(alertNamed(project, onSuma), [SUMA]);
    assert.deepEqual([mayHear(project, onSuma, SUMA), mayHear(project, onRamesh, SUMA)], [true, false]);
  });
});
