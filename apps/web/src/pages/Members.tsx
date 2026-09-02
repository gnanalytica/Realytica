import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { WORKSPACE_ROLES, WORKSPACE_ROLE_HINT, WORKSPACE_ROLE_LABEL, can, type WorkspaceRole } from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { signOut } from '../lib/auth';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from '../components/ui/kit';
import { formatWhen } from './projects/shared';

/**
 * Who is in this workspace.
 *
 * Every control here is drawn from the role the *server* reported, not from a
 * claim read out of the token — the token says who you are, and only the
 * server says what that entitles you to. Hiding a button a viewer cannot use
 * is a courtesy; the refusal that matters happens in `needs()`.
 */
export default function Members() {
  const { data, error, loading, refresh } = useAsync(() => api.members(), []);
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);

  const me = data?.me;
  const mayAdmin = me ? can(me.role, 'admin') : false;
  const mayOwn = me ? can(me.role, 'owner') : false;

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast(what, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not go through', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{data?.tenant?.name ?? 'Workspace'}</h1>
          {me ? (
            <p className="mt-0.5 text-[12.5px] text-ink-secondary">
              Signed in as {me.email} · {WORKSPACE_ROLE_LABEL[me.role]}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
      </div>

      {error ? <Callout tone="critical" title="Could not load the workspace">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-40 w-full" /> : null}

      {mayAdmin ? (
        <Card>
          <CardHeader title="Invite somebody" />
          <CardBody>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Email" className="min-w-[16rem] flex-grow">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@firm.in"
                />
              </Field>
              <Field label="Role" hint={WORKSPACE_ROLE_HINT[role]}>
                <Select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} className="w-40">
                  {WORKSPACE_ROLES.filter((r) => r !== 'owner' || mayOwn).map((r) => (
                    <option key={r} value={r}>{WORKSPACE_ROLE_LABEL[r]}</option>
                  ))}
                </Select>
              </Field>
              <Button
                icon={<UserPlus size={14} />}
                disabled={busy || !email.trim()}
                onClick={() =>
                  void run(`Invited ${email.trim()}`, async () => {
                    await api.inviteMember(email.trim(), role);
                    setEmail('');
                  })
                }
              >
                Invite
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-muted">
              No email is sent. They get in by signing in with that address.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {data ? (
        <Card>
          <CardHeader title="Members" subtitle={`${data.members.length} in this workspace`} />
          <CardBody className="divide-y divide-hairline p-0">
            {data.members.map((m) => (
              <div key={m.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{m.name ?? m.email}</p>
                  <p className="text-[12px] text-ink-muted">
                    {m.name ? `${m.email} · ` : ''}
                    {m.signedIn
                      ? m.lastSeenAt
                        ? `last seen ${formatWhen(m.lastSeenAt)}`
                        : 'signed in'
                      : `invited${m.invitedBy ? ` by ${m.invitedBy}` : ''}, not yet signed in`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {mayAdmin && !(m.role === 'owner' && !mayOwn) ? (
                    <Select
                      value={m.role}
                      aria-label={`Role for ${m.email}`}
                      disabled={busy}
                      className="w-36"
                      onChange={(e) =>
                        void run(
                          `${m.email} is now a ${WORKSPACE_ROLE_LABEL[e.target.value as WorkspaceRole].toLowerCase()}`,
                          () => api.setMemberRole(m.email, e.target.value as WorkspaceRole),
                        )
                      }
                    >
                      {WORKSPACE_ROLES.filter((r) => r !== 'owner' || mayOwn).map((r) => (
                        <option key={r} value={r}>{WORKSPACE_ROLE_LABEL[r]}</option>
                      ))}
                    </Select>
                  ) : (
                    <Badge>{WORKSPACE_ROLE_LABEL[m.role]}</Badge>
                  )}
                  {mayAdmin && m.email !== me?.email && !(m.role === 'owner' && !mayOwn) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`Remove ${m.email} from this workspace?`)) return;
                        void run(`Removed ${m.email}`, () => api.removeMember(m.email));
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {mayOwn && data?.tenant ? (
        <Card>
          <CardHeader
            title="Joining without an invite"
            info="Anybody signing in with an address at this domain becomes a member. Never an admin — joining is not the same as being trusted to run the place."
          />
          <CardBody>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Domain" className="min-w-[16rem]">
                <Input
                  defaultValue={data.tenant.autoJoinDomain ?? ''}
                  placeholder="firm.in"
                  id="auto-join-domain"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const value = (document.getElementById('auto-join-domain') as HTMLInputElement | null)?.value.trim();
                  void run(value ? `Anyone at ${value} can join` : 'Domain joining is off', () =>
                    api.setAutoJoinDomain(value || null),
                  );
                }}
              >
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
