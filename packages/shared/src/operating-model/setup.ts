/**
 * Set up: everything that can be connected or scheduled, each with one line
 * saying whether it works.
 *
 * The parts were added one at a time and each said its own state on its own
 * page: the Drive folder on Documents, the report day on Reports, keys and
 * webhooks on Integrations, mail and WhatsApp as asides wherever something
 * could not be sent. This reads the same facts into one list. A row is
 * working, not set up (with what is needed, in a sentence a partner can act
 * on or forward, and the exact setting for whoever runs the deployment),
 * failing (with the last error), or not used yet.
 *
 * Pure: the server gathers the facts (`routes/setup.ts`) and this says them.
 */
import { connectorStanding, type ProjectConnector } from './connectors';
import type { LawSource } from './law-watch';
import type { OutsideChannel } from './outside-replies';
import { reportDaySaid, type ReportDaySetting } from './report-day';

export type SetupStanding = 'working' | 'not_set_up' | 'failing' | 'not_used';

export const SETUP_STANDING_LABEL: Record<SetupStanding, string> = {
  working: 'Working',
  not_set_up: 'Not set up',
  failing: 'Failing',
  not_used: 'Not used yet',
};

/** Where a row is configured: a page of the firm's, or a page of one project. */
export type SetupPlace = 'law' | 'integrations' | 'documents' | 'reports';

export interface SetupRow {
  key: string;
  label: string;
  standing: SetupStanding;
  /** What it does as it stands, in a line. */
  says: string;
  /** Not set up: what is needed, for a partner to act on or forward. */
  needs?: string;
  /** The exact settings whoever runs the deployment gives. */
  settings?: string[];
  /** Failing: the last error. */
  error?: string;
  open?: { place: SetupPlace; label: string };
}

export interface SetupProject {
  id: string;
  name: string;
  reference: string;
  rows: SetupRow[];
}

export interface SetupShown {
  firm: SetupRow[];
  projects: SetupProject[];
}

export interface SetupChannel {
  send: boolean;
  receive: boolean;
  /** The settings still to give, by their full names. */
  missing: string[];
}

export interface SetupFacts {
  /** Whether mail can leave for the firm's own people. */
  mail: boolean;
  channels: Record<OutsideChannel, SetupChannel>;
  folders: { configured: boolean; address?: string };
  /** Whether the timer that runs the daily and hourly work may call in. */
  timer: boolean;
  model: boolean;
  law: ReadonlyArray<Pick<LawSource, 'title' | 'paused' | 'lastError' | 'lastReadAt' | 'lastLookAt'>>;
  /** Keys and webhooks, for a firm admin. Absent for anybody else: the rows are left out. */
  integrations?: { keys: number; webhooks: boolean; endpoints: number; failing: ReadonlyArray<{ url: string; since: string }> };
  projects: ReadonlyArray<{ id: string; name: string; reference: string; connector?: ProjectConnector; reportDay?: ReportDaySetting }>;
  /** The settings by the names the deployment knows them by. */
  names: { mail: string; folders: string; timer: string; model: string; webhooks: string };
}

function day(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function channelRow(key: string, label: string, channel: SetupChannel, needs: string): SetupRow {
  if (channel.send && channel.receive) return { key, label, standing: 'working', says: 'Requests go out, and replies come back onto the request for a person to confirm.' };
  return {
    key,
    label,
    standing: 'not_set_up',
    says: channel.send ? 'Requests go out, but a reply cannot come back onto its request.' : 'Nothing is sent from here. A request is recorded, and sent by hand.',
    needs,
    settings: channel.missing,
  };
}

function lawRow(law: SetupFacts['law']): SetupRow {
  const open = { place: 'law' as const, label: 'Law and policy' };
  const watched = law.filter((source) => !source.paused);
  const failed = watched.filter((source) => source.lastError);
  if (!watched.length) return { key: 'law', label: 'Law and policy sources', standing: 'not_used', says: law.length ? 'Every page on the list is paused.' : 'No official pages are watched.', open };
  if (failed.length) {
    const first = failed[0]!;
    return { key: 'law', label: 'Law and policy sources', standing: 'failing', says: `${plural(watched.length, 'page')} watched, ${failed.length} could not be read.`, error: `${first.title}: ${first.lastError}`, open };
  }
  const read = watched.map((source) => source.lastReadAt).filter((at): at is string => Boolean(at)).sort().at(-1);
  if (!read) return { key: 'law', label: 'Law and policy sources', standing: 'not_used', says: `${plural(watched.length, 'page')} listed, none read yet.`, open };
  return { key: 'law', label: 'Law and policy sources', standing: 'working', says: `${plural(watched.length, 'page')} watched, last read ${day(read)}.`, open };
}

function folderRow(connector: ProjectConnector | undefined, folders: SetupFacts['folders']): SetupRow {
  const base = { key: 'folder', label: 'Google Drive folder', open: { place: 'documents' as const, label: 'Documents' } };
  if (!connector) {
    return folders.configured
      ? { ...base, standing: 'not_used', says: 'No folder connected. Papers are dropped in by hand.' }
      : { ...base, standing: 'not_set_up', says: 'No folder connected.', needs: 'Google Drive is not set up for the firm yet: see the row above.' };
  }
  const name = connector.folderName ?? 'The folder';
  const standing = connectorStanding(connector);
  if (standing === 'failed' || standing === 'revoked') {
    return { ...base, standing: 'failing', says: standing === 'revoked' ? `${name} is no longer shared with the firm’s Drive address.` : `${name} could not be read.`, error: `${connector.lastError!.message} (${day(connector.lastError!.at)})` };
  }
  return { ...base, standing: 'working', says: connector.lastSyncAt ? `${name}, last read ${day(connector.lastSyncAt)}. ${plural(connector.counts.takenIn, 'paper')} taken in.` : `${name} is connected and not read yet.` };
}

function reportDayRow(setting: ReportDaySetting | undefined, timer: boolean): SetupRow {
  const base = { key: 'report_day', label: 'Report day', open: { place: 'reports' as const, label: 'Reports' } };
  if (!setting) return { ...base, standing: 'not_used', says: 'No report day set. A report is prepared when somebody asks for it.' };
  if (!timer) return { ...base, standing: 'not_set_up', says: `${reportDaySaid(setting)}. Nothing is prepared on the day.`, needs: 'The timer is not set up for the firm yet: see the row above.' };
  return { ...base, standing: 'working', says: `${reportDaySaid(setting)}. Prepared on the day, issued by a person.` };
}

/** Everything that can be connected or scheduled, as it stands. */
export function setupShown(facts: SetupFacts): SetupShown {
  const firm: SetupRow[] = [
    facts.mail
      ? { key: 'mail', label: 'Email to your people', standing: 'working', says: 'Notices, alerts and prepared reports are emailed to the people they concern.' }
      : {
          key: 'mail',
          label: 'Email to your people',
          standing: 'not_set_up',
          says: 'Notices, alerts and prepared reports are shown in the app and emailed to nobody.',
          needs: 'An account with the mail service Resend, and its sending key given to whoever runs the deployment.',
          settings: [facts.names.mail],
        },
    channelRow('request_email', 'Requests by email', facts.channels.email, 'The same Resend account, a mail domain for replies to come back to, and the two secrets that prove a reply is genuine.'),
    channelRow('request_whatsapp', 'Requests by WhatsApp', facts.channels.whatsapp, 'A WhatsApp Business number on Meta’s Cloud API, with a message template Meta has approved.'),
    facts.folders.configured
      ? { key: 'folders', label: 'Google Drive', standing: 'working', says: `Share a folder with ${facts.folders.address ?? 'the firm’s Drive address'} as a viewer, then connect it on the project’s Documents.` }
      : {
          key: 'folders',
          label: 'Google Drive',
          standing: 'not_set_up',
          says: 'No project can connect a folder.',
          needs: 'A Google service account for the firm, and its key file given to whoever runs the deployment.',
          settings: [facts.names.folders],
        },
    facts.timer
      ? { key: 'timer', label: 'Timer', standing: 'working', says: 'Alerts are brought up to date each morning; report days, folders, notices and law sources run on time.' }
      : {
          key: 'timer',
          label: 'Timer',
          standing: 'not_set_up',
          says: 'Nothing runs by itself: alerts change when a project is saved, and no report is prepared on its day.',
          needs: 'A secret for the timer, set by whoever runs the deployment.',
          settings: [facts.names.timer],
        },
    facts.model
      ? { key: 'model', label: 'AI model', standing: 'working', says: 'The chat reads and writes with a model, and the daily review and law summaries run.' }
      : {
          key: 'model',
          label: 'AI model',
          standing: 'not_set_up',
          says: 'The chat answers by its rules. The daily review and law summaries do not run.',
          needs: 'A key for a language model, given to whoever runs the deployment.',
          settings: [facts.names.model],
        },
    lawRow(facts.law),
  ];
  if (facts.integrations) {
    const { keys, webhooks, endpoints, failing } = facts.integrations;
    const open = { place: 'integrations' as const, label: 'Integrations' };
    firm.push(
      keys ? { key: 'keys', label: 'API keys', standing: 'working', says: `${plural(keys, 'key')} in use: another system can read projects, alerts, issued reports and papers owed.`, open } : { key: 'keys', label: 'API keys', standing: 'not_used', says: 'No other system reads from here.', open },
    );
    firm.push(
      !webhooks
        ? { key: 'webhooks', label: 'Webhooks', standing: 'not_set_up', says: 'No other system can be told when something changes.', needs: 'A key to keep signing secrets safely, set by whoever runs the deployment.', settings: [facts.names.webhooks], open }
        : failing.length
          ? { key: 'webhooks', label: 'Webhooks', standing: 'failing', says: `${plural(endpoints, 'address', 'addresses')} told of changes, ${failing.length} failing.`, error: `${failing[0]!.url} has not answered since ${day(failing[0]!.since)}. Nothing is sent to it until a test delivery goes through.`, open }
          : endpoints
            ? { key: 'webhooks', label: 'Webhooks', standing: 'working', says: `${plural(endpoints, 'address', 'addresses')} told when a paper is filed, a value accepted, an alert raised or a report issued.`, open }
            : { key: 'webhooks', label: 'Webhooks', standing: 'not_used', says: 'No address is told of changes.', open },
    );
  }
  return {
    firm,
    projects: facts.projects.map((project) => ({ id: project.id, name: project.name, reference: project.reference, rows: [folderRow(project.connector, facts.folders), reportDayRow(project.reportDay, facts.timer)] })),
  };
}

/** How many rows stand each way, for a subtitle: "4 working · 3 not set up · 1 failing". */
export function setupSaid(shown: SetupShown): string {
  const rows = [...shown.firm, ...shown.projects.flatMap((project) => project.rows)];
  const count = (standing: SetupStanding) => rows.filter((row) => row.standing === standing).length;
  return [count('failing') ? `${count('failing')} failing` : '', `${count('working')} working`, count('not_set_up') ? `${count('not_set_up')} not set up` : '', count('not_used') ? `${count('not_used')} not used yet` : ''].filter(Boolean).join(' · ');
}
