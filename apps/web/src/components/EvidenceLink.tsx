import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Database, FileText, Link2, MapPinned, Sparkles, User } from 'lucide-react';
import type { EvidenceItem, EvidenceSourceType } from '@realytica/shared';
import { Badge, Card, EmptyState, Modal, ProgressBar, Tooltip, cn } from './ui/kit';
import { date as fmtDate } from '../lib/format';

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

function confidenceTone(c: number): 'good' | 'warning' | 'critical' {
  if (c >= 0.75) return 'good';
  if (c >= 0.5) return 'warning';
  return 'critical';
}

/**
 * The traceability primitive used across every number the app shows.
 * Renders a small "N sources" chip. Hovering previews the underlying evidence
 * statements; clicking either delegates to `onOpen` (typically routing to the
 * Evidence tab filtered to these ids) or opens a self-contained modal.
 */
export function EvidenceLink({
  ids,
  evidence,
  onOpen,
  onOpenDocument,
  compact,
}: {
  ids: string[];
  evidence: EvidenceItem[];
  onOpen?: (ids: string[]) => void;
  /**
   * Open the document a piece of evidence came out of, at its own page.
   *
   * This is what turns a citation from a claim about a source into the
   * source. Offered only for `sourceType: 'document'`, where `sourceRef` is
   * the document id — an external dataset or a comparable has no page in this
   * case to open, and a button that opened "something" would teach a reader
   * that the others are broken rather than different.
   */
  onOpenDocument?: (documentId: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const matched = useMemo(() => {
    const byId = new Map(evidence.map((e) => [e.id, e]));
    return ids.map((id) => byId.get(id)).filter((e): e is EvidenceItem => Boolean(e));
  }, [ids, evidence]);

  // Nothing cited is not the same as citing something that cannot be resolved.
  // A statement with no evidence ids simply has nothing to show; a statement
  // whose ids miss the ledger is a real traceability gap and must say so.
  if (ids.length === 0) return null;

  if (matched.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-mini italic text-ink-muted">
        source unavailable
      </span>
    );
  }

  const count = matched.length;
  const chipLabel = compact ? String(count) : `${count} source${count === 1 ? '' : 's'}`;

  const tooltip: ReactNode = (
    <div className="flex flex-col gap-1.5 text-left">
      {matched.slice(0, 3).map((e) => (
        <div key={e.id}>
          <div className="font-medium">{e.statement}</div>
          <div className="text-micro opacity-75">
            {e.sourceLabel} · {Math.round(e.confidence * 100)}% confidence
          </div>
        </div>
      ))}
      {matched.length > 3 ? <div className="text-micro opacity-75">+{matched.length - 3} more</div> : null}
    </div>
  );

  const handleClick = () => {
    if (onOpen) onOpen(ids);
    else setOpen(true);
  };

  return (
    <>
      <Tooltip label={tooltip}>
        <button
          type="button"
          onClick={handleClick}
          aria-label={`View ${chipLabel} of evidence`}
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-mini font-medium text-brand',
            'ring-1 ring-inset ring-brand/25 transition-colors hover:bg-brand/15',
          )}
        >
          <Link2 size={10} />
          {chipLabel}
        </button>
      </Tooltip>
      {!onOpen ? (
        <Modal open={open} onClose={() => setOpen(false)} title={`Evidence (${matched.length})`} width="md">
          <div className="flex flex-col gap-3">
            {matched.map((e) => {
              const Icon = SOURCE_ICON[e.sourceType];
              return (
                <Card key={e.id} className="!shadow-none">
                  <div className="flex flex-col gap-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="neutral" icon={<Icon size={11} />}>
                        {SOURCE_LABEL[e.sourceType]}
                      </Badge>
                      <span className="text-mini text-ink-muted">{fmtDate(e.capturedAt)}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-ink">{e.statement}</p>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">{e.sourceLabel}</span>
                      {onOpenDocument && e.sourceType === 'document' && e.sourceRef ? (
                        <button
                          type="button"
                          onClick={() => onOpenDocument(e.sourceRef)}
                          className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-mini font-medium text-brand"
                        >
                          Open the document
                        </button>
                      ) : null}
                    </div>
                    <ProgressBar
                      value={e.confidence * 100}
                      tone={confidenceTone(e.confidence)}
                      label="Confidence"
                    />
                  </div>
                </Card>
              );
            })}
            {matched.length === 0 ? (
              <EmptyState title="No evidence found" description="The referenced evidence ids do not resolve to a source." />
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
