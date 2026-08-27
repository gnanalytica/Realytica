import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileSearch } from 'lucide-react';
import type { PropertyCase } from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, Tile, cn } from './ui/kit';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';

/**
 * Fetching a statutory record instead of waiting for someone to upload it.
 *
 * Every record collapses to one line by default — label, status, the button
 * — because most of what this card knows (why there's no vendor, what each
 * record settles) is context a reader needs once, not every time they open
 * the case. It expands per record on request rather than staying open, so
 * the page states seven facts instead of explaining seven facts.
 *
 * A nil result stays visible without expanding: "the register holds nothing
 * against this parcel as at this date" is a finding, not an explanation, and
 * hiding it behind a click would throw away the one thing a reader opened
 * the row to see.
 */

type FetchState =
  | { status: 'idle' }
  | { status: 'nil'; retrievedAt: string; note?: string }
  | { status: 'document'; fileName: string }
  | { status: 'gap'; leavesUnknown: string; manualRoute: string; detail?: string };

export function RecordFetchCard({ caseData, onChanged }: { caseData: PropertyCase; onChanged: () => Promise<void> }) {
  const { data } = useAsync(() => api.recordCapability(caseData.id), [caseData.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, FetchState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (kind: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  if (!data) return null;
  const { provider, manualRoutes } = data;
  const searches = caseData.registerSearches ?? [];

  const run = async (kind: string) => {
    setBusy(kind);
    try {
      const out = await api.fetchRecord(caseData.id, { kind });
      if (out.ok) {
        setState((s) => ({
          ...s,
          [kind]: out.record.nilResult
            ? { status: 'nil', retrievedAt: out.record.retrievedAt, note: out.record.coverageNote }
            : { status: 'document', fileName: out.document?.fileName ?? 'record' },
        }));
        await onChanged();
      } else {
        setState((s) => ({ ...s, [kind]: { status: 'gap', ...out.gap } }));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Statutory records"
        subtitle={provider.configured ? `Fetched through ${provider.label}` : 'No vendor connected'}
        icon={<FileSearch size={16} />}
        action={<Badge tone={provider.configured ? 'good' : 'neutral'}>{provider.configured ? 'Vendor connected' : 'Manual only'}</Badge>}
      />
      <CardBody className="flex flex-col gap-2">
        {Object.entries(manualRoutes).map(([kind, route]) => {
          const canFetch = provider.configured && provider.capabilities.kinds.includes(kind);
          const search = searches.find((s) => s.kind === kind);
          const result = state[kind];
          const isOpen = expanded.has(kind);
          return (
            <Tile key={kind} tone={result?.status === 'nil' ? 'good' : result?.status === 'gap' ? 'warning' : 'neutral'} className="p-3">
              <button
                type="button"
                onClick={() => toggle(kind)}
                className="flex w-full flex-wrap items-center gap-2 text-left"
                aria-expanded={isOpen}
              >
                <ChevronDown size={13} className={cn('shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-180')} />
                <span className="text-[13px] font-semibold text-ink">{route.label}</span>
                {search && (
                  <Badge tone={search.nilResult ? 'good' : 'neutral'}>
                    {search.nilResult ? 'Nil as at' : 'Searched'} {relativeTime(search.retrievedAt)}
                  </Badge>
                )}
                {canFetch && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    icon={<Download size={13} />}
                    loading={busy === kind}
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(kind);
                    }}
                  >
                    {search ? 'Search again' : 'Fetch'}
                  </Button>
                )}
              </button>

              {result?.status === 'nil' && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" />
                  <span>Nothing registered as at {relativeTime(result.retrievedAt)}.{result.note ? ` ${result.note}` : ''}</span>
                </p>
              )}

              {result?.status === 'document' && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" />
                  <span>{result.fileName} added to the case.</span>
                </p>
              )}

              {result?.status === 'gap' && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
                  <span>{result.detail}</span>
                </p>
              )}

              {isOpen && (
                <div className="mt-2 flex flex-col gap-1.5 border-t border-hairline pt-2 text-[12.5px] leading-relaxed text-ink-secondary">
                  <p>
                    <span className="font-medium">Without it:</span> {route.leavesUnknown}
                  </p>
                  {!canFetch && <p className="text-ink-muted">{route.manualRoute}</p>}
                  {result?.status === 'gap' && result.manualRoute && <p className="text-ink-muted">{result.manualRoute}</p>}
                </div>
              )}
            </Tile>
          );
        })}
      </CardBody>
    </Card>
  );
}
