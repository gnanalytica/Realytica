import { useEffect, useState } from 'react';
import { Copy, ExternalLink, FolderSync, RefreshCw } from 'lucide-react';
import { CONNECTOR_KIND_LABEL, connectorStanding, plural, type DdProject, type ProjectConnector } from '@realytica/shared';
import { connectorApi, type ConnectorShown } from '../../lib/connector-api';
import { relativeTime } from '../../lib/format';
import { Badge, Button, Callout, Field, Input, Modal, Skeleton, useToast, type Tone } from '../ui/kit';

/**
 * A project's connected folder: the button on Documents, and the dialog it
 * opens.
 *
 * Not connected, the dialog gives the address to share a folder with and a
 * field for the folder's link. Connected, it says how the folder stands:
 * when it was last read, how many files were taken in, which were left out
 * and why. Where the firm has not set this up it says so and offers nothing.
 *
 * What was taken in is on Documents like any other paper, each file saying
 * the folder it came from; nothing here files or accepts anything.
 */

const STANDING: Record<ReturnType<typeof connectorStanding>, { label: string; tone: Tone }> = {
  not_read: { label: 'Not read yet', tone: 'neutral' },
  read: { label: 'Up to date', tone: 'good' },
  waiting: { label: 'More to read', tone: 'warning' },
  failed: { label: 'Could not be read', tone: 'critical' },
  revoked: { label: 'No longer shared', tone: 'critical' },
};

/** What the folder has come to, in one line: "12 taken in · 2 changed · 3 left out". */
function countsSaid(connector: ProjectConnector): string {
  const { takenIn, changed, skipped, waiting } = connector.counts;
  return [`${takenIn} taken in`, ...(changed ? [`${changed} changed`] : []), ...(skipped ? [`${skipped} left out`] : []), ...(waiting ? [`${waiting} waiting`] : [])].join(' · ');
}

export function FolderConnect({ project, onTaken }: { project: DdProject; onTaken: () => void | Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<ConnectorShown | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(null);
    connectorApi
      .open(project.id)
      .then((next) => live && setShown(next))
      .catch((err: unknown) => live && setFailed(err instanceof Error ? err.message : 'Could not open the folder'));
    return () => {
      live = false;
    };
  }, [open, project.id]);

  /** Read the folder now, and say what came of it. */
  async function sync() {
    setBusy('sync');
    try {
      const next = await connectorApi.sync(project.id);
      setShown(next);
      const run = next.run;
      if (run?.error) toast(run.error, 'critical');
      else if (run) toast(run.takenIn ? `${plural(run.takenIn, 'file')} taken in${run.waiting ? `, ${run.waiting} waiting` : ''}` : run.waiting ? `${run.waiting} waiting` : 'Nothing new in the folder', run.takenIn ? 'good' : 'info');
      await onTaken();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read the folder', 'critical');
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy('connect');
    setRefused(null);
    try {
      setShown(await connectorApi.connect(project.id, link.trim()));
      setLink('');
      await onTaken();
    } catch (err) {
      setRefused(err instanceof Error ? err.message : 'Could not connect the folder');
      setBusy(null);
      return;
    }
    // A folder just connected is read at once: nobody connects one to look at an empty count.
    await sync();
  }

  async function disconnect() {
    setBusy('disconnect');
    try {
      setShown(await connectorApi.disconnect(project.id));
      await onTaken();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not disconnect the folder', 'critical');
    } finally {
      setBusy(null);
    }
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      toast('Address copied', 'good');
    } catch {
      toast('Could not copy. Select the address instead.', 'warning');
    }
  }

  // The button says how things stand from the project itself, before anything is asked of the server.
  const connector = shown ? shown.connector : project.connector;
  const standing = connector ? STANDING[connectorStanding(connector)] : undefined;

  return (
    <>
      <Button className="whitespace-nowrap" icon={<FolderSync size={14} />} onClick={() => setOpen(true)}>
        {project.connector ? `${CONNECTOR_KIND_LABEL[project.connector.kind]} folder` : 'Connect a folder'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={connector ? `${CONNECTOR_KIND_LABEL[connector.kind]} folder` : 'Connect a folder'}
        width="md"
        footer={
          shown?.configured && shown.mayChange ? (
            connector ? (
              <>
                <Button variant="ghost" className="mr-auto" loading={busy === 'disconnect'} disabled={busy !== null} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
                <Button variant="primary" icon={<RefreshCw size={14} />} loading={busy === 'sync'} disabled={busy !== null} onClick={() => void sync()}>
                  Sync now
                </Button>
              </>
            ) : (
              <Button variant="primary" loading={busy !== null} disabled={!link.trim()} onClick={() => void connect()}>
                Connect
              </Button>
            )
          ) : undefined
        }
      >
        {failed ? (
          <Callout tone="critical">{failed}</Callout>
        ) : !shown ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !shown.configured ? (
          <p className="text-[13px] text-ink-secondary">Google Drive is not set up for the firm yet. Set up, in the sidebar, says what is needed.</p>
        ) : connector && standing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {connector.folderLink ? (
                <a href={connector.folderLink} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[14px] font-semibold text-ink hover:text-brand">
                  <span className="truncate">{connector.folderName ?? 'Folder'}</span>
                  <ExternalLink size={13} className="shrink-0 text-ink-muted" />
                </a>
              ) : (
                <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{connector.folderName ?? 'Folder'}</span>
              )}
              <Badge tone={standing.tone}>{standing.label}</Badge>
            </div>
            <p className="text-xs text-ink-secondary">
              <span className="font-mono">{countsSaid(connector)}</span>
              {connector.lastSyncAt ? ` · read ${relativeTime(connector.lastSyncAt)}` : ''}
            </p>
            {connector.lastError ? <Callout tone="critical">{connector.lastError.message}</Callout> : null}
            {connector.skipped.length ? (
              <details className="rounded-lg bg-sunken px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-ink-secondary">
                  Left out <span className="font-mono">{connector.counts.skipped}</span>
                </summary>
                <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {connector.skipped.map((skipped) => (
                    <li key={skipped.fileId} className="min-w-0">
                      <p className="break-words text-xs font-medium text-ink">{skipped.path}</p>
                      <p className="text-xs text-ink-muted">{skipped.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-xs text-ink-muted">
              Connected by {connector.connectedBy}. Shared with <span className="break-all font-mono">{shown.address}</span>
            </p>
          </div>
        ) : shown.mayChange ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-secondary">Share the folder with</p>
              <div className="flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-1.5">
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{shown.address}</span>
                <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copyAddress(shown.address ?? '')}>
                  Copy
                </Button>
              </div>
            </div>
            <Field label="Folder link" error={refused}>
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && link.trim() && busy === null) void connect();
                }}
                placeholder="https://drive.google.com/drive/folders/…"
                inputMode="url"
                autoComplete="off"
                maxLength={400}
              />
            </Field>
          </div>
        ) : (
          <p className="text-[13px] text-ink-secondary">No folder is connected.</p>
        )}
      </Modal>
    </>
  );
}
