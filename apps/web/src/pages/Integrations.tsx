import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Copy, KeyRound, Plus, Send, Webhook } from 'lucide-react';
import {
  API_KEY_SCOPES,
  API_KEY_SCOPE_LABEL,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABEL,
  can,
  type ApiKeyScope,
  type WebhookEventType,
} from '@realytica/shared';
import { integrationsApi, type ApiKeyShown, type DeliveryShown, type EndpointShown } from '../lib/integrations-api';
import { useAsync } from '../lib/useAsync';
import { useMe } from '../lib/useMe';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Checkbox, Field, Input, Modal, Select, Skeleton, useToast, type Tone } from '../components/ui/kit';
import { formatWhen } from './projects/shared';

/**
 * The firm's connections to other systems: the keys they read with, and the
 * addresses they are told at.
 *
 * For an owner or a manager. The page is drawn from what the server answers,
 * and the server refuses everybody else whatever this page shows.
 */

const EXPIRY: Array<[string, number | null]> = [
  ['30 days', 30],
  ['90 days', 90],
  ['1 year', 365],
  ['Never', null],
];

const DELIVERY_TONE: Record<DeliveryShown['status'], Tone> = { delivered: 'good', pending: 'neutral', failed: 'warning', gave_up: 'critical' };
const DELIVERY_LABEL: Record<DeliveryShown['status'], string> = { delivered: 'Delivered', pending: 'Sending', failed: 'Failed', gave_up: 'Gave up' };

function toggled<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((held) => held !== item);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A secret shown once: the value, a way to copy it, and the one line that says it will not be shown again. */
function ShownOnce({ value, onClose, title }: { value: string | null; onClose: () => void; title: string }) {
  const toast = useToast();
  return (
    <Modal open={value !== null} onClose={onClose} title={title} width="md" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="text-[13px] text-ink-secondary">Copy it now. It is not shown again.</p>
      <div className="mt-3 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] text-ink">{value}</code>
        <Button
          icon={<Copy size={14} />}
          onClick={() => {
            void navigator.clipboard.writeText(value ?? '').then(
              () => toast('Copied', 'good'),
              () => toast('Could not copy. Select it and copy by hand.', 'critical'),
            );
          }}
        >
          Copy
        </Button>
      </div>
    </Modal>
  );
}

function keyState(key: ApiKeyShown): { label: string; tone: Tone } | null {
  if (key.revokedAt) return { label: 'Revoked', tone: 'neutral' };
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return { label: 'Expired', tone: 'warning' };
  return null;
}

export default function Integrations() {
  const me = useMe();
  const mayAdmin = me ? can(me.role, 'admin') : false;
  const { data, error, loading, refresh } = useAsync(() => (mayAdmin ? integrationsApi.open() : Promise.resolve(null)), [mayAdmin]);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([...API_KEY_SCOPES]);
  const [everyProject, setEveryProject] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('90 days');
  const [shownKey, setShownKey] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([...WEBHOOK_EVENTS]);
  const [shownSecret, setShownSecret] = useState<string | null>(null);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    try {
      const said = await fn();
      await refresh();
      if (said) toast(said, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not go through', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const live = (data?.keys ?? []).filter((key) => !keyState(key));
  // The keys that work first; the revoked and the expired under them.
  const keys = [...live, ...(data?.keys ?? []).filter((key) => keyState(key))];
  const endpointName = (id: string) => hostOf(data?.endpoints.find((endpoint) => endpoint.id === id)?.url ?? 'removed');

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] font-medium text-ink-muted">Workspace</p>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">Integrations</h1>
        <p className="mt-0.5 text-[13px] text-ink-secondary">Other systems read with a key and are told at an address.</p>
      </div>

      {me && !mayAdmin ? <Callout tone="info">Integrations are set up by an owner or a manager.</Callout> : null}
      {error ? <Callout tone="critical" title="Could not load integrations">{error}</Callout> : null}
      {mayAdmin && loading && !data ? <Skeleton className="h-40 w-full" /> : null}

      {data ? (
        <>
          <Card>
            <CardHeader
              icon={<KeyRound />}
              title="API keys"
              subtitle={`${live.length} live · read-only`}
              action={<Button icon={<Plus size={14} />} disabled={busy} onClick={() => setMaking(true)}>New key</Button>}
            />
            <div className="divide-y divide-hairline">
              {data.keys.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-muted">No keys yet.</p> : null}
              {keys.map((key) => {
                const state = keyState(key);
                return (
                  <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink">
                        {key.name} <span className="font-mono text-[12px] font-normal text-ink-muted">{key.prefix}…</span>
                      </p>
                      <p className="text-[12px] text-ink-muted">
                        {key.scopes.map((scope) => API_KEY_SCOPE_LABEL[scope]).join(', ')}
                        {' · '}
                        {key.projectIds ? `${key.projectIds.length} ${key.projectIds.length === 1 ? 'project' : 'projects'}` : 'every project'}
                        {' · '}
                        {key.lastUsedAt ? `last used ${formatWhen(key.lastUsedAt)}` : 'never used'}
                        {key.expiresAt && !state ? ` · expires ${formatWhen(key.expiresAt)}` : ''}
                      </p>
                    </div>
                    {state ? (
                      <Badge tone={state.tone}>{state.label}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(`Revoke ${key.name}? Whatever uses it stops working at once.`)) return;
                          void run(async () => {
                            await integrationsApi.revokeKey(key.id);
                            return `Revoked ${key.name}`;
                          });
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Webhook />} title="Webhooks" subtitle={`${data.endpoints.length} ${data.endpoints.length === 1 ? 'endpoint' : 'endpoints'} · signed`} />
            {data.webhooks.available ? (
              <CardBody>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Address" className="min-w-[16rem] flex-grow">
                    <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
                  </Field>
                  <Button
                    icon={<Plus size={14} />}
                    disabled={busy || !url.trim() || events.length === 0}
                    onClick={() =>
                      void run(async () => {
                        const made = await integrationsApi.addEndpoint({ url: url.trim(), events });
                        setShownSecret(made.secret);
                        setUrl('');
                      })
                    }
                  >
                    Add
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {WEBHOOK_EVENTS.map((event) => (
                    <Checkbox key={event} checked={events.includes(event)} onChange={(on) => setEvents(toggled(events, event, on))} label={WEBHOOK_EVENT_LABEL[event]} />
                  ))}
                </div>
              </CardBody>
            ) : (
              <CardBody>
                <Callout tone="warning" title="Webhooks are not set up">
                  A key to keep signing secrets safely is needed first.{' '}
                  <Link to="/setup" className="font-medium text-brand hover:underline">
                    See Set up
                  </Link>
                </Callout>
              </CardBody>
            )}
            {data.endpoints.length ? (
              <div className="divide-y divide-hairline border-t border-hairline">
                {data.endpoints.map((endpoint: EndpointShown) => (
                  <div key={endpoint.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-[12px] text-ink">{endpoint.url}</p>
                      <p className="text-[12px] text-ink-muted">{endpoint.events.map((event) => WEBHOOK_EVENT_LABEL[event]).join(', ')}</p>
                    </div>
                    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                      {endpoint.failingSince ? <Badge tone="critical" title={`Nothing is sent until a test goes through. Failing since ${formatWhen(endpoint.failingSince)}.`}>Failing</Badge> : null}
                      <Button
                        size="sm"
                        icon={<Send size={13} />}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const { delivery } = await integrationsApi.testEndpoint(endpoint.id);
                            if (delivery.status !== 'delivered') throw new Error(`Test failed: ${delivery.lastError ?? `it answered ${delivery.lastStatus}`}`);
                            return 'Test delivered';
                          })
                        }
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(`Remove ${hostOf(endpoint.url)}?`)) return;
                          void run(async () => {
                            await integrationsApi.removeEndpoint(endpoint.id);
                            return 'Removed';
                          });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Recent deliveries" subtitle={`${data.deliveries.length} shown`} />
            <div className="divide-y divide-hairline">
              {data.deliveries.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-muted">Nothing sent yet.</p> : null}
              {data.deliveries.map((delivery) => (
                <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">
                      <span className="font-mono text-[12px]">{delivery.type}</span> <span className="text-ink-muted">to {endpointName(delivery.endpointId)}</span>
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {formatWhen(delivery.lastAttemptAt ?? delivery.createdAt)}
                      {delivery.attempts > 1 ? ` · ${delivery.attempts} attempts` : ''}
                      {delivery.lastStatus ? ` · answered ${delivery.lastStatus}` : ''}
                      {delivery.lastError ? ` · ${delivery.lastError}` : ''}
                      {delivery.nextAttemptAt ? ` · next try ${formatWhen(delivery.nextAttemptAt)}` : ''}
                    </p>
                  </div>
                  <Badge tone={DELIVERY_TONE[delivery.status]}>{DELIVERY_LABEL[delivery.status]}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Modal
            open={making}
            onClose={() => setMaking(false)}
            title="New key"
            width="md"
            footer={
              <>
                <Button variant="ghost" onClick={() => setMaking(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={busy || !name.trim() || scopes.length === 0 || (!everyProject && projectIds.length === 0)}
                  onClick={() =>
                    void run(async () => {
                      const made = await integrationsApi.createKey({
                        name: name.trim(),
                        scopes,
                        ...(everyProject ? {} : { projectIds }),
                        expiresInDays: EXPIRY.find(([label]) => label === expiry)?.[1] ?? null,
                      });
                      setMaking(false);
                      setName('');
                      setShownKey(made.token);
                    })
                  }
                >
                  Create
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What will use it" maxLength={80} />
              </Field>
              <Field label="May read">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {API_KEY_SCOPES.map((scope) => (
                    <Checkbox key={scope} checked={scopes.includes(scope)} onChange={(on) => setScopes(toggled(scopes, scope, on))} label={API_KEY_SCOPE_LABEL[scope]} />
                  ))}
                </div>
              </Field>
              <Field label="Projects">
                <Checkbox checked={everyProject} onChange={setEveryProject} label="Every project" />
                {everyProject ? null : (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-sunken px-3 py-1.5">
                    {data.projects.length === 0 ? <p className="py-1 text-[12px] text-ink-muted">No projects yet.</p> : null}
                    {data.projects.map((project) => (
                      <div key={project.id}>
                        <Checkbox checked={projectIds.includes(project.id)} onChange={(on) => setProjectIds(toggled(projectIds, project.id, on))} label={`${project.name} · ${project.reference}`} />
                      </div>
                    ))}
                  </div>
                )}
              </Field>
              <Field label="Expires">
                <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-40">
                  {EXPIRY.map(([label]) => (
                    <option key={label} value={label}>{label}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Modal>
          <ShownOnce value={shownKey} onClose={() => setShownKey(null)} title="Your new key" />
          <ShownOnce value={shownSecret} onClose={() => setShownSecret(null)} title="Signing secret" />
        </>
      ) : null}
    </div>
  );
}
