import { useState } from 'react';
import { Check, ShieldQuestion, X } from 'lucide-react';
import { DD_DOMAIN_PROFILES, TECHNICAL_SYSTEM_LABEL, domainForSystem, proposedTechnicalFindings } from '@realytica/shared';
import type { PropertyCase } from '@realytica/shared';
import { api } from '../../../lib/api';
import { Badge, Button, EmptyState, cn, useToast } from '../../../components/ui/kit';
import { money, severityTone } from '../../../lib/format';

/**
 * Everything the model has asserted and nobody has ruled on yet, in one place.
 *
 * The authorship law — a person acts, a model proposes — was real but invisible:
 * a proposal sat inside whichever department produced it, so the only way to
 * know what was outstanding was to visit eight rails and look. A discipline
 * you have to go hunting for is one people stop practising, and the failure
 * mode is the bad one: a proposal quietly treated as fact because nobody
 * noticed it was still a proposal.
 *
 * Accept and reject are the same two calls the technical view already makes;
 * this is a different way in, not a second write path.
 */
export function ReviewQueue({ caseData, onChanged }: { caseData: PropertyCase; onChanged: () => Promise<unknown> | void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const proposed = proposedTechnicalFindings(caseData.technicalFindings ?? []);

  const rule = async (findingId: string, reviewState: 'accepted' | 'rejected') => {
    setBusy(findingId);
    try {
      await api.reviewTechnicalFinding(caseData.id, findingId, reviewState);
      await onChanged();
      toast(reviewState === 'accepted' ? 'Accepted — it is part of the case now.' : 'Rejected — it is not part of the case.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'critical');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-hairline bg-surface-2 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Review</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">
          What the model proposed and nobody has ruled on. Nothing here is part of the case until you say so.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {proposed.length === 0 ? (
          <EmptyState
            icon={<ShieldQuestion size={20} />}
            title="Nothing is waiting on you"
            description="Findings the model proposes land here for a decision before they become part of the case."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {proposed.map(f => {
              const domain = domainForSystem(f.system);
              return (
                <li key={f.id} className="rounded-lg bg-brand-soft/40 p-3 ring-1 ring-inset ring-brand/30">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                    <span className="text-[11px] text-ink-muted">
                      {DD_DOMAIN_PROFILES[domain].label} · {TECHNICAL_SYSTEM_LABEL[f.system]}
                    </span>
                    {f.zone ? <span className="text-[11px] text-ink-muted">· {f.zone}</span> : null}
                    {f.estimatedCost ? (
                      <span className="tabular ml-auto text-[11.5px] text-ink-secondary">
                        {money(f.estimatedCost, caseData.identity.currency, { compact: true })}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[13px] font-medium text-ink">{f.observation}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{f.recommendation}</p>
                  {/* The code citation is carried verbatim so a reviewer can
                      look it up — it is most of what makes a finding rulable
                      rather than merely plausible. */}
                  {f.codeCitation ? (
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">{f.codeCitation}</p>
                  ) : null}
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" onClick={() => void rule(f.id, 'accepted')} loading={busy === f.id}>
                      <Check size={13} /> Accept
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void rule(f.id, 'rejected')} disabled={busy === f.id}>
                      <X size={13} /> Reject
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** How many decisions are outstanding — the rail's badge. */
export function pendingReviewCount(caseData: PropertyCase): number {
  return proposedTechnicalFindings(caseData.technicalFindings ?? []).length;
}

export const REVIEW_PANE = 'review';
export { cn };
