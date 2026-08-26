import type { EvidenceItem, EvidenceSourceType } from '@valytica/shared';
import { cn } from '../ui/kit';

export interface ProvenanceBarProps {
  evidence: EvidenceItem[];
  onSelect?: (source: EvidenceSourceType) => void;
  selected?: EvidenceSourceType | 'all';
}

/**
 * What this answer is standing on.
 *
 * Every other chart here is about the property. This one is about the
 * evidence, and it exists because the single most useful thing a reader can
 * know before trusting a valuation is how much of it came off paper and how
 * much a model worked out. The counts were already computed for the filter
 * chips; only the proportion was missing, and the proportion is the point —
 * "4 of 43 are inference" and "24 of 43 are inference" are the same list and
 * completely different answers.
 *
 * Ordered by how directly each source touches the property rather than by
 * size, so the bar reads left-to-right from hardest evidence to softest, and
 * a growing right-hand end is legible as a warning without anyone being told.
 */
const ORDER: EvidenceSourceType[] = ['document', 'external_dataset', 'comparable', 'user_input', 'model_inference'];

const LABEL: Record<EvidenceSourceType, string> = {
  document: 'Documents',
  external_dataset: 'Public records',
  comparable: 'Comparable sales',
  user_input: 'What you told us',
  model_inference: 'Model inference',
};

/**
 * `model_inference` takes the warning tone, and nothing else does.
 *
 * Not because inference is wrong — it is labelled, and the product is built to
 * carry it — but because it is the one band whose weight changes how the rest
 * should be read.
 */
const FILL: Record<EvidenceSourceType, string> = {
  document: 'var(--series-1)',
  external_dataset: 'var(--series-3)',
  comparable: 'var(--series-7)',
  user_input: 'var(--series-5)',
  model_inference: 'rgb(var(--status-warning-rgb))',
};

export default function ProvenanceBar({ evidence, onSelect, selected }: ProvenanceBarProps) {
  const counts = ORDER.map(s => ({ source: s, n: evidence.filter(e => e.sourceType === s).length })).filter(r => r.n > 0);
  const total = counts.reduce((sum, r) => sum + r.n, 0);
  if (total === 0) return null;

  const inferred = counts.find(r => r.source === 'model_inference')?.n ?? 0;

  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`${total} evidence items: ${counts.map(r => `${r.n} ${LABEL[r.source].toLowerCase()}`).join(', ')}`}
      >
        {counts.map(r => (
          <button
            key={r.source}
            type="button"
            onClick={onSelect ? () => onSelect(r.source) : undefined}
            title={`${r.n} ${LABEL[r.source].toLowerCase()}`}
            aria-label={`${r.n} ${LABEL[r.source].toLowerCase()}`}
            style={{ width: `${(r.n / total) * 100}%`, background: FILL[r.source] }}
            className={cn(
              'h-full transition-opacity',
              onSelect && 'cursor-pointer',
              selected && selected !== 'all' && selected !== r.source && 'opacity-35',
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {counts.map(r => (
          <span key={r.source} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: FILL[r.source] }} />
            {LABEL[r.source]} <span className="tabular text-ink">{r.n}</span>
          </span>
        ))}
      </div>
      {inferred > 0 ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary">
          {inferred} of {total} {inferred === 1 ? 'item is' : 'items are'} the model's own reasoning rather than
          something on file. Those are labelled wherever they appear and are the first thing to check against a source.
        </p>
      ) : null}
    </div>
  );
}
