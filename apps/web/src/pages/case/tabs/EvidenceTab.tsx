import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, FileText, Link2, MapPinned, Search, Sparkles, User, X } from 'lucide-react';
import type { ConfidenceBand, EvidenceItem, EvidenceSourceType } from '@realytica/shared';
import { ProvenanceBar } from '../../../components/charts';
import type { TabProps } from '../tab-props';
import { confidenceTone, date } from '../../../lib/format';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, ProgressBar, Select, cn } from '../../../components/ui/kit';

const SOURCE_TYPES: EvidenceSourceType[] = ['document', 'external_dataset', 'comparable', 'user_input', 'model_inference'];

const SOURCE_ICON: Record<EvidenceSourceType, typeof FileText> = {
  document: FileText,
  external_dataset: Database,
  comparable: MapPinned,
  user_input: User,
  model_inference: Sparkles,
};

const SOURCE_LABEL: Record<EvidenceSourceType, string> = {
  document: 'Document',
  external_dataset: 'External dataset',
  comparable: 'Comparable',
  user_input: 'User input',
  model_inference: 'Model inference',
};

const BANDS: ConfidenceBand[] = ['high', 'moderate', 'low'];

function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.5) return 'moderate';
  return 'low';
}

type SortMode = 'newest' | 'confidence_asc';

export default function EvidenceTab({ caseData, result, runScreen, running, goToTab }: TabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<EvidenceSourceType | 'all'>('all');
  const [bandFilter, setBandFilter] = useState<ConfidenceBand | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const evidenceParam = searchParams.get('evidence');
  const referencedIds = useMemo(
    () => (evidenceParam ? evidenceParam.split(',').map((s) => s.trim()).filter(Boolean) : []),
    [evidenceParam],
  );
  const referencedSet = useMemo(() => new Set(referencedIds), [referencedIds]);

  useEffect(() => {
    if (referencedIds.length === 0) return;
    const el = rowRefs.current[referencedIds[0]];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceParam]);

  function clearReferencedFilter(): void {
    const next = new URLSearchParams(searchParams);
    next.delete('evidence');
    setSearchParams(next);
  }

  const bySource = useMemo(() => {
    const counts: Record<EvidenceSourceType, number> = {
      document: 0,
      external_dataset: 0,
      comparable: 0,
      user_input: 0,
      model_inference: 0,
    };
    for (const e of result?.evidence ?? []) counts[e.sourceType] += 1;
    return counts;
  }, [result]);

  const filtered = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    let list = result.evidence.slice();
    if (referencedSet.size > 0) list = list.filter((e) => referencedSet.has(e.id));
    if (sourceFilter !== 'all') list = list.filter((e) => e.sourceType === sourceFilter);
    if (bandFilter !== 'all') list = list.filter((e) => bandOf(e.confidence) === bandFilter);
    if (q) list = list.filter((e) => e.statement.toLowerCase().includes(q) || e.sourceLabel.toLowerCase().includes(q));
    list.sort((a, b) => {
      if (sortMode === 'newest') return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
      return a.confidence - b.confidence;
    });
    return list;
  }, [result, referencedSet, sourceFilter, bandFilter, query, sortMode]);

  if (!result) {
    return (
      <EmptyState
        icon={<Link2 size={28} />}
        title="Not screened yet"
        description="Run the screen to build the evidence ledger — every statement, its source, and how confident the engine is in it."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  const total = result.evidence.length;
  const modelInferenceShare = total > 0 ? Math.round((bySource.model_inference / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Evidence ledger" subtitle={`${total} sourced statement${total === 1 ? '' : 's'} behind this screen`} icon={<Link2 size={16} />} />
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_TYPES.map((t) => {
              const Icon = SOURCE_ICON[t];
              return (
                <Badge key={t} tone="neutral" icon={<Icon size={11} />}>
                  {bySource[t]} {SOURCE_LABEL[t]}
                  {bySource[t] === 1 ? '' : 's'}
                </Badge>
              );
            })}
          </div>
          <Callout tone="warning" title="Model inference is the weakest link">
            {bySource.model_inference} of {total} facts ({modelInferenceShare}%) are model inferences rather than
            sourced documents or external datasets. Treat these as a starting hypothesis and verify them before
            relying on them for a decision.
          </Callout>
        </CardBody>
      </Card>

      {referencedIds.length > 0 ? (
        <Callout tone="info" title={`Filtered to ${referencedIds.length} referenced source${referencedIds.length === 1 ? '' : 's'}`}>
          <div className="flex items-center justify-between gap-3">
            <span>Showing only the evidence linked from where you came from.</span>
            <Button variant="ghost" size="sm" icon={<X size={13} />} onClick={clearReferencedFilter}>
              Clear
            </Button>
          </div>
        </Callout>
      ) : null}

      {/*
          * What the ledger is standing on, before anyone starts browsing it.
          *
          * The counts already existed for the filter below; the proportion did
          * not, and the proportion is the point — four inferences out of
          * forty-three and twenty-four out of forty-three are the same list
          * and completely different answers.
          */}
        <ProvenanceBar
          evidence={result?.evidence ?? []}
          selected={sourceFilter}
          onSelect={(sourceType) => setSourceFilter(sourceType === sourceFilter ? 'all' : sourceType)}
        />
        <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-xs">
          <Input
            aria-label="Search evidence"
            placeholder="Search statements or sources…"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            aria-label="Filter by source type"
            value={sourceFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSourceFilter(e.target.value as EvidenceSourceType | 'all')}
          >
            <option value="all">All source types</option>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select
            aria-label="Filter by confidence band"
            value={bandFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setBandFilter(e.target.value as ConfidenceBand | 'all')}
          >
            <option value="all">All confidence</option>
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {b.charAt(0).toUpperCase() + b.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            aria-label="Sort evidence"
            value={sortMode}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSortMode(e.target.value as SortMode)}
          >
            <option value="newest">Newest first</option>
            <option value="confidence_asc">Shakiest first</option>
          </Select>
        </div>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Search size={24} />}
            title="No evidence matches"
            description="Try a different search term, or widen the source-type and confidence filters."
          />
        ) : (
          <ul>
            {filtered.map((e) => (
              <EvidenceRow
                key={e.id}
                evidence={e}
                highlighted={referencedSet.has(e.id)}
                onOpenDocuments={e.sourceType === 'document' ? () => goToTab('documents') : undefined}
                registerRef={(el) => {
                  rowRefs.current[e.id] = el;
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EvidenceRow({
  evidence,
  highlighted,
  onOpenDocuments,
  registerRef,
}: {
  evidence: EvidenceItem;
  highlighted: boolean;
  onOpenDocuments?: () => void;
  registerRef: (el: HTMLLIElement | null) => void;
}) {
  const Icon = SOURCE_ICON[evidence.sourceType];
  const band = bandOf(evidence.confidence);
  return (
    <li
      ref={registerRef}
      className={cn(
        'flex flex-col gap-2 border-b border-hairline px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        highlighted && 'bg-brand-soft/60',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon size={14} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{SOURCE_LABEL[evidence.sourceType]}</Badge>
            {onOpenDocuments ? (
              <button type="button" onClick={onOpenDocuments} className="text-[11px] text-brand hover:underline">
                Open in Documents
              </button>
            ) : null}
          </div>
          <p className="text-[13px] leading-relaxed text-ink">{evidence.statement}</p>
          <p className="mt-0.5 text-xs text-ink-secondary">
            {evidence.sourceLabel} · {date(evidence.capturedAt)}
          </p>
        </div>
      </div>
      <div className="w-full shrink-0 sm:w-40">
        <ProgressBar value={evidence.confidence * 100} tone={confidenceTone(band)} label="Confidence" />
      </div>
    </li>
  );
}
