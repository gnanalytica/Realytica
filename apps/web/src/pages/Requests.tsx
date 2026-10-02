import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Button, Callout, Card, CardBody, CardHeader, PageHeader, Skeleton } from '../components/ui/kit';
import { NewRequestModal, RequestList } from '../components/project/RequestsPanel';

/**
 * Everything the firm is waiting on, across every file.
 *
 * The morning list: who owes what, since when, and what is overdue. A request
 * is made on a project and answers itself when its document is filed.
 */
export default function Requests() {
  const { data, error, loading, refresh } = useAsync(() => api.portfolio(), []);
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    const rows = data?.requests ?? [];
    return {
      overdue: rows.filter((r) => r.request.status === 'sent' && r.overdue),
      open: rows.filter((r) => r.request.status === 'sent' && !r.overdue).sort((a, b) => b.ageDays - a.ageDays),
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
        subtitle="What the firm is waiting on from others, across every engagement"
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
          {groups.overdue.length ? (
            <Card className="ring-2 ring-critical/30">
              <CardHeader title="Overdue" subtitle={`${groups.overdue.length} past their due date`} />
              <CardBody>
                <RequestList rows={groups.overdue} onChanged={refresh} showProject />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Waiting on others" subtitle={`${groups.open.length} open, oldest first`} />
            <CardBody>
              <RequestList
                rows={groups.open}
                onChanged={refresh}
                showProject
                empty="Nothing outstanding. Record a request when you ask someone for a document or an answer."
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
