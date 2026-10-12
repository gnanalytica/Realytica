import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';
import { cockpitPath, type TellLine } from '@realytica/shared';
import { relativeTime } from '../lib/format';
import { tellApi } from '../lib/tell-api';
import { useAsync } from '../lib/useAsync';
import { AiMark, Button, Callout, Card, CardHeader, Dot, cn } from './ui/kit';

/**
 * What I have been told: a paper filed, a value accepted or changed, a
 * checklist line or a request answered, each with the one thing to do.
 *
 * Above the list of work, because it is why some of that work exists. A row
 * opens the paper at its page. A value a reader read and nobody accepted is
 * never written here: it is counted, under the AI mark, as waiting.
 */

/** The rows shown before the rest are asked for: the newest, which is what a person came for. */
const SHOWN = 6;

/** Where a notice opens: the paper, at the page its value is on. */
/** Where a notice opens: the paper it is about, or Papers owed when a request or a line of the list was answered. */
const OWED_KINDS: ReadonlySet<TellLine['kind']> = new Set(['request_answered', 'request_replied', 'line_answered']);

function linkFor(line: TellLine): string {
  if (line.evidenceId && !OWED_KINDS.has(line.kind)) return cockpitPath(line.projectId, 'evidence', { evidenceId: line.evidenceId, ...(line.page ? { page: String(line.page) } : {}) });
  return cockpitPath(line.projectId, OWED_KINDS.has(line.kind) ? 'papers' : 'overview');
}

export function TellCard() {
  const { data, error, refresh } = useAsync(() => tellApi.open(), []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  if (error) return <Callout tone="critical" title="Could not load your notices">{error}</Callout>;
  if (!data) return null;

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    try {
      await run();
      await refresh();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const quieted = new Set(data.quiet.map((held) => held.projectId));
  // Every project there is something to quiet or to stop quieting: those told of, and those already quiet.
  const projects = new Map<string, string>();
  for (const line of data.notices) projects.set(line.projectId, line.projectName);
  for (const held of data.quiet) projects.set(held.projectId, held.projectName);

  const said = [
    data.notices.length === 0 ? 'Nothing yet' : data.unread > 0 ? `${data.unread} unread of ${data.notices.length}` : `${data.notices.length} read`,
    // Said plainly where nothing can leave the app, so nobody waits for a mail that will not come.
    data.channels.email ? 'emailed together, ten minutes after the first' : 'shown here only, email is not set up',
    ...(data.channels.push ? ['sent to your phone'] : []),
  ].join(' · ');

  return (
    <Card>
      <CardHeader
        icon={<Bell />}
        title="Notices"
        subtitle={said}
        action={
          data.unread > 0 ? (
            <Button size="sm" loading={busy} onClick={() => void act(() => tellApi.read('all'))}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      {failed ? <p className="px-4 pt-3 text-[12px] text-critical">{failed}</p> : null}
      {data.notices.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-ink-secondary">No notices. A paper filed or a reply that concerns you is listed here.</p>
      ) : (
        <div className="divide-y divide-hairline">
          {(all ? data.notices : data.notices.slice(0, SHOWN)).map((line) => (
            <Link key={line.id} to={linkFor(line)} onClick={() => (line.read ? undefined : void tellApi.read([line.id]).catch(() => undefined))} className="flex items-start gap-3 px-4 py-3 hover:bg-sunken">
              <Dot tone={line.read ? 'neutral' : 'brand'} className={cn('mt-1.5', line.read && 'opacity-0')} />
              <div className="min-w-0 flex-1">
                <p className={cn('text-[13px] text-ink', line.read ? 'font-medium' : 'font-semibold')}>{line.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  <span className="font-mono">{line.projectReference}</span> · {line.projectName} · {relativeTime(line.at)} · {line.by}
                </p>
                {line.detail ? (
                  <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-ink-secondary">
                    {line.waiting ? <AiMark size="xs" className="mt-px" /> : null}
                    <span className="min-w-0">{line.detail}</span>
                  </p>
                ) : null}
                <p className="mt-0.5 text-[12px] font-medium text-ink">{line.action}</p>
              </div>
            </Link>
          ))}
          {!all && data.notices.length > SHOWN ? (
            <button type="button" onClick={() => setAll(true)} className="w-full px-4 py-2.5 text-left text-[12px] font-medium text-brand hover:bg-sunken coarse:min-h-11">
              Show {data.notices.length - SHOWN} more
            </button>
          ) : null}
        </div>
      )}
      {projects.size > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline px-4 py-3">
          <span className="text-[12px] text-ink-muted">Quiet a project</span>
          {[...projects].map(([projectId, name]) => {
            const on = quieted.has(projectId);
            return (
              <button
                key={projectId}
                type="button"
                disabled={busy}
                aria-pressed={on}
                title={on ? 'Quiet: nothing about it is mailed or sent to your phone. It still lists here.' : 'Mail and phone are on for this project.'}
                onClick={() => void act(() => tellApi.quiet(projectId, !on))}
                className={cn(
                  'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] coarse:min-h-11',
                  on ? 'bg-brand-soft font-semibold text-brand' : 'bg-sunken text-ink-secondary hover:text-ink',
                )}
              >
                {on ? <BellOff size={13} /> : null}
                <span className="truncate">{name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
