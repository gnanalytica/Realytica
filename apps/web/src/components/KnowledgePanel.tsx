import { useState } from 'react';
import { Brain, CircleSlash, Database, GraduationCap, Lock, ScanSearch, Upload } from 'lucide-react';
import type { DataSourceDescriptor, IngestionReport, MemoryRecall, SourceAccess } from '@valytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, cn, type Tone } from './ui/kit';
import { relativeTime } from '../lib/format';

/**
 * What this case knows from outside itself: external sources, and what earlier
 * cases established.
 *
 * The unreachable sources are the point of the top half. A diligence tool that
 * lists only what it managed to check tells the user the work was more
 * complete than it was, so a blocked register is shown with what it would have
 * answered and how to get it by hand — the absence is the finding.
 *
 * The bottom half is deliberately styled as context rather than evidence.
 * Memory is loose and allowed to be wrong; presenting it beside the evidence
 * ledger with the same weight is exactly the confusion that makes AI output
 * unusable in a diligence context.
 */

const ACCESS_TONE: Record<SourceAccess, Tone> = {
  open: 'good',
  file_upload: 'brand',
  auth_required: 'warning',
  captcha: 'warning',
  offline_only: 'neutral',
};

const ACCESS_LABEL: Record<SourceAccess, string> = {
  open: 'Open',
  file_upload: 'Supply a file',
  auth_required: 'Login required',
  captcha: 'CAPTCHA',
  offline_only: 'Counter only',
};

function SourceRow({ source }: { source: DataSourceDescriptor }) {
  const [open, setOpen] = useState(false);
  const blocked = source.access !== 'open' && source.access !== 'file_upload';
  return (
    <div className="border-b border-hairline py-2.5 last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 text-left">
        {blocked ? (
          <Lock size={13} className="mt-0.5 shrink-0 text-warning" />
        ) : source.access === 'open' ? (
          <Database size={13} className="mt-0.5 shrink-0 text-good" />
        ) : (
          <Upload size={13} className="mt-0.5 shrink-0 text-brand" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ink">{source.label}</span>
            <Badge tone={ACCESS_TONE[source.access]}>{ACCESS_LABEL[source.access]}</Badge>
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-secondary">{source.authority}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-[23px]">
          <p className="text-[11px] leading-relaxed text-ink-secondary">
            <span className="font-semibold uppercase tracking-wide text-ink-muted">Would answer</span>{' '}
            {source.whatItWouldHaveAnswered}
          </p>
          {source.manualRoute && (
            <p className="text-[11px] leading-relaxed text-ink-muted">
              <span className="font-semibold uppercase tracking-wide">By hand</span> {source.manualRoute}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SourcesCard({
  sources,
  ingestions,
  onIngest,
  ingesting,
}: {
  sources: DataSourceDescriptor[];
  ingestions: IngestionReport[];
  onIngest?: () => void;
  ingesting?: boolean;
}) {
  const blocked = sources.filter((s) => s.access !== 'open' && s.access !== 'file_upload');
  const latest = ingestions[ingestions.length - 1];
  return (
    <Card>
      <CardHeader
        title="External sources"
        subtitle={`${sources.length} bear on this property — ${blocked.length} cannot be reached automatically`}
        icon={<ScanSearch size={16} />}
        action={
          onIngest ? (
            <Button size="sm" icon={<Database size={13} />} loading={ingesting} onClick={onIngest}>
              Check sources
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {blocked.length > 0 && (
          <p className="mb-3 rounded-lg bg-sunken p-3 text-xs leading-relaxed text-ink-secondary">
            {blocked.length} of these are behind a login, a CAPTCHA, or a counter. They are listed rather than
            omitted: a source that was never checked is a gap in the diligence, not an absence of risk.
          </p>
        )}
        {sources.map((s) => (
          <SourceRow key={s.id} source={s} />
        ))}
        {latest && (
          <p className="mt-3 text-[11px] text-ink-muted">
            Last checked {relativeTime(latest.startedAt)} — {latest.records.length} record(s) ingested,{' '}
            {latest.attempted.filter((a) => a.outcome === 'unreachable').length} source(s) unreachable.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export interface MemoryCardProps {
  recall: MemoryRecall;
  /**
   * Teach memory what this case establishes.
   *
   * Offered rather than automatic, and that is deliberate: memory carries
   * party names across case boundaries, which for a diligence tool is a
   * confidentiality decision and not a convenience. What was wrong until now
   * was that it was offered nowhere at all, so the store stayed empty forever
   * while every copilot turn and every orchestration consulted it.
   */
  onTeach?: () => void;
  teaching?: boolean;
}

export function MemoryCard({ recall, onTeach, teaching }: MemoryCardProps) {
  const byScope = new Map<string, typeof recall.facts>();
  for (const f of recall.facts) byScope.set(f.scope, [...(byScope.get(f.scope) ?? []), f]);

  /*
   * `storedFactCount` is optional on the contract, for recalls recorded before
   * it existed. Absent is treated as "cannot tell", which falls to the
   * ordinary empty state rather than claiming the store is empty — the same
   * rule as everywhere else here: never assert the stronger statement from
   * missing data.
   */
  const nothingEverTaught = recall.storedFactCount === 0;

  return (
    <Card>
      <CardHeader
        title="From earlier cases"
        subtitle="Context, not evidence — never citable against this property"
        icon={<Brain size={16} />}
        action={<Badge tone="neutral">{recall.facts.length}</Badge>}
      />
      <CardBody>
        {recall.facts.length === 0 ? (
          /*
           * Two different empty states, because they mean different things.
           *
           * An empty store is a fact about the deployment: nothing has ever
           * been taught, so this will be empty for every case until something
           * is. "Looked and found nothing" is a finding about this property.
           * Reporting the first as the second tells the reader this property
           * has a clean history when nobody has ever checked one.
           */
          nothingEverTaught ? (
            <EmptyState
              icon={<Brain size={22} />}
              title="Memory is empty"
              description="Nothing has been taught to cross-case memory yet, so there is nothing to recall — for this property or any other. This is not a finding about this property."
              action={
                onTeach ? (
                  <Button variant="secondary" size="sm" icon={<GraduationCap size={13} />} loading={teaching} onClick={onTeach}>
                    Teach from this case
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={<CircleSlash size={22} />}
              title="No earlier history"
              description={`Looked up ${recall.consultedSubjects.length} subject(s) — ${recall.consultedSubjects.join(', ')} — against ${recall.storedFactCount} remembered fact(s) and found nothing from previous cases. Treat these as unknown, not as clean.`}
            />
          )
        ) : (
          <>
            {[...byScope].map(([scope, facts]) => (
              <div key={scope} className="mb-3 last:mb-0">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {scope.replace(/_/g, ' ')}
                </p>
                {facts.map((f) => (
                  <div key={f.id} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 last:border-0">
                    <span className="min-w-0 flex-1 text-xs text-ink">
                      <span className="font-medium">{f.subjectLabel}</span>{' '}
                      <span className="text-ink-secondary">{f.predicate.replace(/_/g, ' ')}</span>{' '}
                      <span className="text-ink">{f.object}</span>
                    </span>
                    <span className={cn('tabular shrink-0 text-[11px]', f.confidence >= 0.8 ? 'text-ink-muted' : 'text-warning')}>
                      {(f.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {onTeach ? (
              <Button variant="ghost" size="sm" icon={<GraduationCap size={13} />} loading={teaching} onClick={onTeach} className="mt-2">
                Teach from this case
              </Button>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
              Consulted {recall.consultedSubjects.length} subject(s).
              {recall.excludedCount > 0 &&
                ` ${recall.excludedCount} further item(s) were held back as superseded by a later correction, or outside their validity window.`}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
