import { useEffect, useState } from 'react';
import { Inbox, Paperclip } from 'lucide-react';
import {
  OUTSIDE_CHANNEL_LABEL,
  TRAY_REASON_LABEL,
  replyWaits,
  type OutsideChannel,
  type ProjectRequest,
  type ReplyAttachment,
  type ReplySkipped,
  type RequestReply,
  type TrayItem,
} from '@realytica/shared';
import { evidenceFileUrl } from '../../lib/api';
import { outsideApi, saveFile, type OutsideStatus } from '../../lib/outsideApi';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select, useToast } from '../ui/kit';
import { Avatar, dayMonth } from './ProjectPanels';

const said = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

/** A channel in the middle of a sentence. */
const by = (channel: OutsideChannel): string => (channel === 'email' ? 'email' : OUTSIDE_CHANNEL_LABEL[channel]);

const sizeOf = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The papers a message carried, each saved on a press, and the ones left out with why. */
function Papers({ attachments, skipped, save }: { attachments: ReplyAttachment[]; skipped?: ReplySkipped[]; save: (attachment: ReplyAttachment) => Promise<void> }) {
  const toast = useToast();
  if (!attachments.length && !skipped?.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <button
            type="button"
            onClick={() => void save(attachment).catch((e) => toast(said(e, 'Could not open that paper'), 'critical'))}
            className="inline-flex max-w-full items-center gap-1.5 text-left text-[12px] text-brand hover:underline coarse:min-h-11"
          >
            <Paperclip size={12} className="shrink-0" />
            <span className="truncate">{attachment.fileName}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-muted">{sizeOf(attachment.sizeBytes)}</span>
          </button>
        </li>
      ))}
      {(skipped ?? []).map((left, n) => (
        <li key={`${left.fileName}-${n}`} className="text-[12px] text-ink-muted">
          Left out: {left.fileName} ({left.reason})
        </li>
      ))}
    </ul>
  );
}

/**
 * What came back to a request, under its row: who replied, when, their words
 * and papers. A reply waits until a person confirms it answers the request
 * or sets it aside.
 */
export function RequestReplies({ projectId, request, onChanged }: { projectId: string; request: ProjectRequest; onChanged: () => void | Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const sent = request.dispatches?.at(-1);
  const replies = request.replies ?? [];
  if (!sent && !replies.length) return null;

  async function decide(reply: RequestReply, how: 'confirm' | 'setAside') {
    setBusy(reply.id);
    try {
      await outsideApi[how](projectId, request.id, reply.id);
      await onChanged();
    } catch (e) {
      toast(said(e, 'Could not do that'), 'critical');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="basis-full space-y-2 pl-11">
      {sent ? (
        <p className="text-[12px] text-ink-muted">
          Sent by {by(sent.channel)} to {sent.to} · {dayMonth(sent.at)}
        </p>
      ) : null}
      {replies.map((reply) => (
        <div key={reply.id} className="rounded-lg bg-sunken px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-[12px] text-ink-secondary">
              <span className="font-medium text-ink">{reply.fromName ?? reply.from}</span> replied by {by(reply.channel)} · {dayMonth(reply.receivedAt)}
            </p>
            {reply.confirmedAt ? <Badge tone="good">Confirmed</Badge> : reply.setAsideAt ? <Badge tone="neutral">Set aside</Badge> : <Badge tone="info">To confirm</Badge>}
          </div>
          {reply.text ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-ink">{reply.text}</p> : null}
          <Papers
            attachments={reply.attachments}
            skipped={reply.skipped}
            save={(attachment) => (attachment.evidenceId ? saveFile(evidenceFileUrl(projectId, attachment.evidenceId, attachment.id), attachment.fileName) : Promise.resolve())}
          />
          {replyWaits(reply) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" loading={busy === reply.id} onClick={() => void decide(reply, 'confirm')}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === reply.id} onClick={() => void decide(reply, 'setAside')}>
                Set aside
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Send a request to the outside party by email or WhatsApp. A channel that is not set up says so and sends nothing. */
export function SendRequestModal({ projectId, request, onClose, onSent }: { projectId: string; request: ProjectRequest | null; onClose: () => void; onSent: () => void | Promise<void> }) {
  const toast = useToast();
  const [status, setStatus] = useState<OutsideStatus | null>(null);
  const [channel, setChannel] = useState<OutsideChannel>('email');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    setChannel('email');
    setTo(request.recipientEmail ?? (request.recipient.includes('@') ? request.recipient : ''));
    void outsideApi.status().then(setStatus, () => setStatus(null));
  }, [request]);

  function pick(next: OutsideChannel) {
    setChannel(next);
    setTo(next === 'email' ? (request?.recipientEmail ?? (request?.recipient.includes('@') ? request.recipient : '')) : (request?.recipientPhone ?? ''));
  }

  async function send() {
    if (!request) return;
    setBusy(true);
    try {
      await outsideApi.send(projectId, request.id, { channel, to: to.trim() });
      toast(`Sent to ${to.trim()}`, 'good');
      await onSent();
      onClose();
    } catch (e) {
      toast(said(e, 'Could not send the request'), 'critical');
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.[channel].send ?? false;
  return (
    <Modal
      open={Boolean(request)}
      onClose={onClose}
      title="Send request"
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready || !to.trim()} onClick={() => void send()}>Send</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] font-medium text-ink">{request?.title}</p>
        <Field label="Send by">
          <Select value={channel} onChange={(e) => pick(e.target.value as OutsideChannel)}>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </Select>
        </Field>
        <Field label={channel === 'email' ? 'Their email' : 'Their number, with country code'} required>
          <Input value={to} onChange={(e) => setTo(e.target.value)} type={channel === 'email' ? 'email' : 'tel'} placeholder={channel === 'email' ? 'name@firm.example' : '+91 90000 00000'} />
        </Field>
        <p className="text-[12px] text-ink-muted">
          {status && !ready ? `${OUTSIDE_CHANNEL_LABEL[channel]} is not set up yet. Set up says what is needed.` : 'Their reply comes back here and waits for you to confirm it.'}
        </p>
      </div>
    </Modal>
  );
}

/**
 * Mail and messages that could not be placed on a request: no reference, an
 * old or unknown one, or a sender the project does not know. Nothing here is
 * on a project until a person files it.
 */
export function ToSortCard({ projects, requests, onFiled }: { projects: Array<{ id: string; name: string }>; requests: Array<{ projectId: string; request: ProjectRequest }>; onFiled: () => void | Promise<void> }) {
  const toast = useToast();
  const { data, setData } = useAsync(() => outsideApi.tray(), []);
  const status = useAsync(() => outsideApi.status(), []).data;
  const [busy, setBusy] = useState<string | null>(null);
  const [filing, setFiling] = useState<TrayItem | null>(null);
  const [projectId, setProjectId] = useState('');
  const [requestId, setRequestId] = useState('');
  const items = data?.items ?? [];

  function open(item: TrayItem) {
    setFiling(item);
    setProjectId(item.projectId && projects.some((p) => p.id === item.projectId) ? item.projectId : (projects[0]?.id ?? ''));
    setRequestId('');
  }

  async function act(item: TrayItem, run: () => Promise<{ items: TrayItem[] }>, done: string) {
    setBusy(item.id);
    try {
      setData(await run());
      toast(done, 'good');
      setFiling(null);
      await onFiled();
    } catch (e) {
      toast(said(e, 'Could not do that'), 'critical');
    } finally {
      setBusy(null);
    }
  }

  const openRequests = requests.filter((row) => row.projectId === projectId && (row.request.status === 'sent' || row.request.status === 'draft'));
  const listening = status ? status.email.receive || status.whatsapp.receive : true;
  return (
    <Card>
      <CardHeader
        icon={<Inbox size={15} className="text-brand" />}
        title="To sort"
        subtitle={items.length ? `${items.length} unsorted` : 'Nothing to sort'}
        info="Mail and messages that named no open request, or came from someone the project does not know. Nothing here is on a project until you file it."
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="py-2 text-[13px] text-ink-muted">{listening ? 'Replies that cannot be placed wait here.' : 'Replies by email and WhatsApp are not set up, so nothing arrives here. Set up says what is needed.'}</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-3 py-2.5">
                <Avatar name={item.fromName ?? item.from} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{item.subject ?? item.text?.split('\n')[0] ?? 'No words'}</p>
                  <p className="text-[12px] text-ink-secondary">
                    {item.fromName ? `${item.fromName} · ` : ''}
                    {item.from} · {OUTSIDE_CHANNEL_LABEL[item.channel]} · {dayMonth(item.receivedAt)}
                  </p>
                  {item.subject && item.text ? <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[12px] text-ink-secondary">{item.text}</p> : null}
                  <Papers attachments={item.attachments} skipped={item.skipped} save={(attachment) => outsideApi.savePaper(item.id, attachment.id, attachment.fileName)} />
                </div>
                <Badge tone="warning">{TRAY_REASON_LABEL[item.reason]}</Badge>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" disabled={busy === item.id || projects.length === 0} onClick={() => open(item)}>
                    File to project
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy === item.id} onClick={() => void act(item, () => outsideApi.discard(item.id), 'Discarded')}>
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Modal
        open={Boolean(filing)}
        onClose={() => setFiling(null)}
        title="File to project"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFiling(null)}>Cancel</Button>
            <Button variant="primary" loading={Boolean(filing && busy === filing.id)} disabled={!projectId} onClick={() => filing && void act(filing, () => outsideApi.file(filing.id, { projectId, ...(requestId ? { requestId } : {}) }), 'Filed')}>
              File
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Project" required>
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setRequestId(''); }}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Answers the request" hint="Filing it for a request confirms it as the answer.">
            <Select value={requestId} onChange={(e) => setRequestId(e.target.value)}>
              <option value="">None</option>
              {openRequests.map((row) => (
                <option key={row.request.id} value={row.request.id}>{row.request.title} · {row.request.recipient}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
