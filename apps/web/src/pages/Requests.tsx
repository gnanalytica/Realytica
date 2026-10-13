import { useMemo, useState } from 'react';
import { requestStanding } from '@realytica/shared';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Button, Callout, Card, CardBody, CardHeader, PageHeader, Skeleton } from '../components/ui/kit';
import { NewRequestModal, RequestList } from '../components/project/RequestsPanel';
import { ToSortCard } from '../components/project/RequestOutside';

/**
 * Everything the firm is waiting on, across every file.
 *
 * The morning list: who owes what, since when, and what is overdue. A request
 * is made on a project and answers itself when its document is filed.
 */
const replied = (row: { request: Parameters<typeof requestStanding>[0] }): boolean => requestStanding(row.request) === 'replied';

export default function Requests() {
  const { data, error, loading, refresh } = useAsync(() => api.portfolio(), []);
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    const rows = data?.requests ?? [];
    return {
      // Answered and waiting for a person here: no longer waiting on them, so neither overdue nor open.
      toConfirm: rows.filter((r) => r.request.status === 'sent' && replied(r)),
      overdue: rows.filter((r) => r.request.status === 'sent' && r.overdue && !replied(r)),
      open: rows.filter((r) => r.request.status === 'sent' && !r.overdue && !replied(r)).sort((a, b) => b.ageDays - a.ageDays),
      drafts: rows.filter((r) => r.request.status === 'draft'),
      closed: rows.filter((r) => r.request.status === 'answered' || r.request.status === 'cancelled').slice(0, 20),
    };
  }, [data]);

  const projects = (data?.projects ?? []).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-4 pb-10">
      <PageHeader
        eyebrow="Workspace"
        title="Requests"
        subtitle="What the firm has asked others for, across every project"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)} disabled={projects.length === 0}>
            New request
          </Button>
        }
      />

      {error ? <Callout tone="critical" title="Could not load requests">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-64 w-full rounded-xl" /> : null}

      {data ? (
        <>
          {/* What waits for a person here comes first: a reply to confirm, then mail nobody could place. */}
          {groups.toConfirm.length ? (
            <Card>
              <CardHeader title="To confirm" subtitle={`${groups.toConfirm.length} answered, to confirm`} />
              <CardBody>
                <RequestList rows={groups.toConfirm} onChanged={refresh} showProject />
              </CardBody>
            </Card>
          ) : null}
          <ToSortCard projects={projects} requests={data.requests} onFiled={refresh} />
          {groups.overdue.length ? (
            <Card className="ring-2 ring-critical/30">
              <CardHeader title="Overdue" subtitle={`${groups.overdue.length} past their due date`} />
              <CardBody>
                <RequestList rows={groups.overdue} onChanged={refresh} showProject />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Asked for" subtitle={`${groups.open.length} waiting on others, oldest first`} />
            <CardBody>
              <RequestList
                rows={groups.open}
                onChanged={refresh}
                showProject
                empty="Nothing is waiting on others. Ask for a paper from a department’s Documents, or with New request."
              />
            </CardBody>
          </Card>
          {groups.drafts.length ? (
            <Card>
              <CardHeader title="Drafts" subtitle="Not yet sent" />
              <CardBody>
                <RequestList rows={groups.drafts} onChanged={refresh} showProject />
              </CardBody>
            </Card>
          ) : null}
          {groups.closed.length ? (
            <Card>
              <CardHeader title="Closed recently" />
              <CardBody>
                <RequestList rows={groups.closed} onChanged={refresh} showProject />
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}

      <NewRequestModal open={creating} onClose={() => setCreating(false)} projects={projects} onCreated={refresh} />
    </div>
  );
}
