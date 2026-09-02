import { useState } from 'react';
import { KeyRound, PlugZap } from 'lucide-react';
import { CREDENTIAL_KINDS, type CredentialKind } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select, useToast } from '../../components/ui/kit';
import { formatWhen } from '../projects/shared';

/**
 * Keys a flow node authenticates with.
 *
 * Write-only: the value goes in and the server never gives it back, so this
 * screen shows a label, a kind, the last four characters and what happened the
 * last time something used it. That last column is the useful one — "this
 * stopped working on Tuesday" is the question a credentials list exists to
 * answer, and a list of names cannot.
 *
 * The form says out loud where the secret ends up. Storing these widens what a
 * backup of this deployment contains, and a screen that took a key without
 * mentioning that would be hiding the cost of its own convenience.
 */

const KIND_LABEL: Record<CredentialKind, string> = {
  api_key: 'API key',
  bearer_token: 'Bearer token',
  basic_auth: 'Username and password',
  header: 'Custom header',
  mcp_server: 'MCP server',
};

const TARGET_LABEL: Partial<Record<CredentialKind, string>> = {
  api_key: 'Header name',
  header: 'Header name',
  mcp_server: 'Server URL',
};

export function CredentialsCard() {
  const toast = useToast();
  const { data, refresh } = useAsync(() => api.flowCatalogue(), []);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CredentialKind>('bearer_token');
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Two separate pieces of state, because they answer different questions.
   *
   * `runningId` is which row is spinning — an MCP credential is tested with no
   * dialog at all, so tying the spinner to the dialog's state would leave the
   * one case that needs no dialog with no feedback.
   */
  const [runningId, setRunningId] = useState<string | null>(null);
  const [askUrlFor, setAskUrlFor] = useState<{ id: string; label: string } | null>(null);
  const [testUrl, setTestUrl] = useState('');

  /**
   * Run the test and let the row speak for itself afterwards.
   *
   * The outcome is written on the credential server-side, so refreshing is
   * what updates the badge — there is no second copy of the truth here to keep
   * in step. The toast carries the sentence, because "refused" alone does not
   * tell an operator whether to rotate the key or fix the URL.
   */
  async function runTest(id: string, url?: string) {
    setRunningId(id);
    try {
      const result = await api.testCredential(id, url);
      await refresh();
      toast(result.detail, result.outcome === 'ok' ? 'good' : result.outcome === 'refused' ? 'critical' : 'warning');
      setAskUrlFor(null);
      setTestUrl('');
    } catch (e) {
      // The dialog stays open on a failure: the URL is probably what needs
      // fixing, and closing it would make them type it again.
      toast(e instanceof Error ? e.message : 'Could not test it', 'critical');
    } finally {
      setRunningId(null);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveCredential({ label: label.trim(), kind, secret, username: username || undefined, target: target || undefined });
      setLabel('');
      setSecret('');
      setUsername('');
      setTarget('');
      setOpen(false);
      await refresh();
      toast('Stored', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not store it', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.credentials ?? [];

  return (
    <Card>
      <CardHeader
        title="Credentials"
        subtitle={`${rows.length} stored`}
        info="Held on the server and never sent back to a browser. A backup of this deployment contains them, which is the cost of not needing a deploy to wire a connector."
        action={<Button size="sm" variant="secondary" icon={<KeyRound size={13} />} onClick={() => setOpen((v) => !v)}>{open ? 'Cancel' : 'Add'}</Button>}
      />
      <CardBody className="space-y-3">
        {open ? (
          <div className="space-y-2 rounded-lg border border-hairline bg-sunken p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="min-w-[12rem] flex-grow">
                <Input value={label} placeholder="Kaveri portal" onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label="Kind">
                <Select value={kind} className="w-52" onChange={(e) => setKind(e.target.value as CredentialKind)}>
                  {CREDENTIAL_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              </Field>
            </div>
            {TARGET_LABEL[kind] ? (
              <Field label={TARGET_LABEL[kind]!}>
                <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === 'mcp_server' ? 'https://tools.example.com/mcp' : 'x-api-key'} />
              </Field>
            ) : null}
            {kind === 'basic_auth' ? (
              <Field label="Username">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Secret" hint="Stored once. It is never shown again — not to you either.">
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </Field>
            <Button disabled={busy || !label.trim() || !secret} onClick={() => void save()}>Store it</Button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Nothing stored. A connector, MCP or HTTP node that needs one will say so.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {rows.map((cred) => (
              <div key={cred.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{cred.label}</p>
                  <p className="text-[12px] text-ink-muted">
                    {KIND_LABEL[cred.kind]} · ••••{cred.hint}
                    {cred.lastUsedAt ? ` · last used ${formatWhen(cred.lastUsedAt)}` : ' · never used'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {cred.lastResult ? (
                    <Badge tone={cred.lastResult === 'ok' ? 'good' : cred.lastResult === 'refused' ? 'critical' : 'warning'}>
                      {cred.lastResult}
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<PlugZap size={13} />}
                    loading={runningId === cred.id}
                    title="Send it somewhere and see what comes back"
                    onClick={() => {
                      // An MCP credential carries its own server, so it can be
                      // tested straight away. Every other kind is a header
                      // applied to whatever a node calls, so it needs a URL —
                      // asking is honest; guessing an endpoint and blaming the
                      // key for its answer would not be.
                      if (cred.kind === 'mcp_server') {
                        void runTest(cred.id);
                        return;
                      }
                      setAskUrlFor({ id: cred.id, label: cred.label });
                      setTestUrl('');
                    }}
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!confirm(`Delete “${cred.label}”? Any node using it will stop working.`)) return;
                      void api
                        .deleteCredential(cred.id)
                        .then(refresh)
                        .then(() => toast('Deleted', 'good'))
                        .catch(() => toast('Could not delete it', 'critical'));
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>

      <Modal open={askUrlFor !== null} onClose={() => setAskUrlFor(null)} title={`Test “${askUrlFor?.label ?? ''}”`}>
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-secondary">
            This kind of credential is a header sent to whatever a node calls, so there is nothing to try it against
            on its own. Give an endpoint and it will be sent there once, and the answer reported. A 401 or 403 means
            the credential was rejected; anything else means it was accepted.
          </p>
          <Field label="URL to try it on">
            <Input
              value={testUrl}
              placeholder="https://api.example.com/v1/me"
              onChange={(e) => setTestUrl(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAskUrlFor(null)}>Cancel</Button>
            <Button
              loading={runningId !== null}
              disabled={!testUrl.trim()}
              onClick={() => askUrlFor && void runTest(askUrlFor.id, testUrl.trim())}
            >
              Send it
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
