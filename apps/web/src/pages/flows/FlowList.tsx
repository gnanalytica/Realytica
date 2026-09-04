import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Workflow } from 'lucide-react';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Callout, Card, CardBody, EmptyState, Field, Input, Skeleton, Spinner, useToast } from '../../components/ui/kit';
import { formatWhen } from '../projects/shared';
import { CredentialsCard } from './Credentials';

/**
 * Every flow in this workspace, and the credentials they authenticate with.
 *
 * Credentials sit on this page rather than behind their own nav item because
 * they exist only for flows: a key with nothing pointing at it is a key
 * somebody pasted and forgot, and putting the two lists on one screen makes
 * that visible instead of tidy.
 */
export default function FlowList() {
  const me = useMe();
  const toast = useToast();
  const { data, error, loading, refresh } = useAsync(() => api.listFlows(), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const mayEdit = me ? me.role === 'owner' || me.role === 'manager' : false;

  async function create() {
    setBusy(true);
    try {
      await api.createFlow(name.trim() || 'Untitled flow');
      setName('');
      await refresh();
      toast('Flow created', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create it', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Automations</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">
          What the agents do, drawn rather than deployed. A flow proposes; a person accepts.
        </p>
      </div>

      {error ? <Callout tone="critical" title="Could not load your flows">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-32 w-full" /> : null}

      {mayEdit ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="min-w-[16rem] flex-grow">
                <Input value={name} placeholder="Evidence gap sweep" onChange={(e) => setName(e.target.value)} />
              </Field>
              {/* The create takes a couple of seconds; without saying so the only
                  feedback is a button that has stopped responding, which reads
                  as a dead click rather than a busy one. */}
              <Button
                icon={busy ? <Spinner size={14} /> : <Plus size={14} />}
                disabled={busy}
                onClick={() => void create()}
              >
                {busy ? 'Creating…' : 'New flow'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {data && data.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Workflow size={18} />}
              title="No flows yet"
              description="Start with one that finds outstanding documents."
            />
          </CardBody>
        </Card>
      ) : null}

      {data && data.length > 0 ? (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {data.map((flow) => (
              <Link key={flow.id} to={`/flows/${flow.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-sunken">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{flow.name}</p>
                  <p className="text-[12px] text-ink-muted">
                    {flow.nodeCount} node(s) · changed {formatWhen(flow.updatedAt)} by {flow.updatedBy}
                  </p>
                  {flow.lastRun ? (
                    <p className="text-[12px] text-ink-muted">
                      last ran {formatWhen(flow.lastRun.startedAt)}
                      {flow.lastRun.dryRun ? ' as a rehearsal' : ''} ·{' '}
                      {flow.lastRun.status === 'ok'
                        ? `${flow.lastRun.stepCount} step(s)`
                        : flow.lastRun.status.replace('_', ' ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* A flow that is on and failing is the one thing this list
                      must not make you open it to discover. */}
                  {flow.lastRun && flow.lastRun.status !== 'ok' ? (
                    <Badge tone={flow.lastRun.status === 'failed' ? 'critical' : 'warning'}>
                      Last run {flow.lastRun.status.replace('_', ' ')}
                    </Badge>
                  ) : null}
                  {flow.canRun ? null : <Badge tone="critical">Needs fixing</Badge>}
                  <Badge tone={flow.enabled ? 'good' : 'neutral'}>{flow.enabled ? 'Enabled' : 'Off'}</Badge>
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {mayEdit ? <CredentialsCard /> : null}
    </div>
  );
}
