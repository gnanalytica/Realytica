import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSearch, Info } from 'lucide-react';
import type { PropertyCase } from '@realytica/shared';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Tile } from './ui/kit';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';

/**
 * Fetching a statutory record instead of waiting for someone to upload it.
 *
 * Shown whether or not a vendor is configured, because the answer has the
 * same shape either way: what each record settles, and either a button to
 * fetch it or the route to get it by hand. A panel that only appeared when a
 * key was set would be invisible on exactly the deployment where the manual
 * route is the only route — which for Karnataka is every deployment, since
 * Kaveri and Bhoomi have no machine interface to hold a key against.
 *
 * A nil result gets its own treatment and its own colour. "The register holds
 * nothing against this parcel as at this date" is one of the most valuable
 * answers an encumbrance search returns, and rendering it as an absent
 * document would throw away both halves of it.
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
        subtitle={provider.configured ? `Fetched through ${provider.label}` : 'No vendor connected — the manual route for each is below'}
        icon={<FileSearch size={16} />}
        action={<Badge tone={provider.configured ? 'good' : 'neutral'}>{provider.configured ? 'Vendor connected' : 'Manual only'}</Badge>}
      />
      <CardBody className="flex flex-col gap-3">
        <Callout tone="info" title={provider.configured ? 'What a fetched copy is worth' : 'Why there is no fetch button'}>
          {provider.standing}
        </Callout>

        {Object.entries(manualRoutes).map(([kind, route]) => {
          const canFetch = provider.configured && provider.capabilities.kinds.includes(kind);
          const search = searches.find((s) => s.kind === kind);
          const result = state[kind];
          return (
            <Tile key={kind} tone={result?.status === 'nil' ? 'good' : result?.status === 'gap' ? 'warning' : 'neutral'} className="p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">{route.label}</span>
                {search && (
                  <Badge tone={search.nilResult ? 'good' : 'neutral'}>
                    {search.nilResult ? 'Nil as at' : 'Searched'} {relativeTime(search.retrievedAt)}
                    {search.authority === 'secondary' ? ' · secondary copy' : ''}
                  </Badge>
                )}
                {canFetch && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    icon={<Download size={13} />}
                    loading={busy === kind}
                    onClick={() => void run(kind)}
                  >
                    {search ? 'Search again' : 'Fetch'}
                  </Button>
                )}
              </div>

              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                <span className="font-medium text-ink-secondary">Without it:</span> {route.leavesUnknown}
              </p>

              {result?.status === 'nil' && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" />
                  <span>
                    The register holds nothing against this parcel as at {relativeTime(result.retrievedAt)}. That is a
                    finding, and it has a date on it — anything registered since does not appear in it.
                    {result.note ? ` ${result.note}` : ''}
                  </span>
                </p>
              )}

              {result?.status === 'document' && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" />
                  <span>{result.fileName} is now on the case and has been read into the evidence ledger.</span>
                </p>
              )}

              {result?.status === 'gap' && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
                  <span>
                    {result.detail} {result.manualRoute}
                  </span>
                </p>
              )}

              {!canFetch && !result && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-muted">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  {route.manualRoute}
                </p>
              )}
            </Tile>
          );
        })}
      </CardBody>
    </Card>
  );
}
