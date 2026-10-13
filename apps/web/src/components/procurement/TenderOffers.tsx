/**
 * Awarded values, and approved variations, waiting on Finance.
 *
 * An approved variation is Procurement's to record and Finance's to take: it
 * moves PO issued and the anticipated cost on the package's row only when a
 * lead or signer in Finance accepts it here, or PO issued alone where the
 * forecast already carries it.
 *
 * A letter of acceptance offers its value to the package's row on the Cost
 * Report as PO issued. It is written there when a lead or a signer in Finance
 * accepts it here, and the row says what it holds now, so the person sees
 * what accepting changes. Shown on Tenders and on Budget. Nothing is drawn
 * where nothing waits.
 */

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { departmentRole, moneySaid, roleCanDecide, tenderOffersWaiting, variationOffersWaiting, type DdProject } from '@realytica/shared';
import { procurementApi } from '../../lib/procurement-api';
import { useMe } from '../../lib/useMe';
import { Button, Card, CardBody, CardHeader, Input, useToast } from '../ui/kit';
import { daySaid } from '@realytica/shared';

export function TenderOffers({ project, onChanged }: { project: DdProject; onChanged: (p: DdProject) => void }) {
  const toast = useToast();
  const me = useMe();
  const mayAccept = roleCanDecide(me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, 'finance') : undefined);
  const waiting = tenderOffersWaiting(project);
  const variations = variationOffersWaiting(project);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (!waiting.length && !variations.length) return null;

  async function run(fallback: string, work: () => Promise<{ project: DdProject }>) {
    setBusy(true);
    try {
      onChanged((await work()).project);
      setDeclining(null);
      setReason('');
    } catch (e) {
      toast(e instanceof Error ? e.message : fallback, 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Waiting on Finance"
        subtitle={[waiting.length ? `${waiting.length} awarded, to accept as PO issued` : '', variations.length ? `${variations.length} approved ${variations.length === 1 ? 'variation' : 'variations'}, to take onto the Cost Report` : ''].filter(Boolean).join(' · ')}
      />
      <CardBody className="space-y-3">
        {variations.map((offer) => (
          <div key={offer.variationId} className="space-y-2 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 text-[13px] font-medium text-ink">
                Variation {offer.ref}
                <span className="font-normal text-ink-secondary"> · {offer.packageName}</span>
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-ink">
                {offer.onto ? <span className="text-ink-muted">{moneySaid(offer.onto.poIssued, project.currency)}</span> : null}
                {offer.onto ? <ArrowRight size={12} aria-hidden className="text-ink-muted" /> : null}
                {moneySaid((offer.onto?.poIssued ?? 0) + offer.amount, project.currency)}
              </p>
            </div>
            <p className="text-xs text-ink-secondary">
              {offer.onto
                ? `Approved for ${moneySaid(offer.amount, project.currency)}${offer.approvedOn ? ` on ${daySaid(offer.approvedOn)}` : ''}. Taken, it adds that to PO issued and to the anticipated cost on ${offer.onto.label}.`
                : `Approved for ${moneySaid(offer.amount, project.currency)}. No draft Cost Report holds this package. Start one to take it.`}
            </p>
            {mayAccept ? (
              declining === offer.variationId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Why it is declined" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" className="min-w-[12rem] flex-1" />
                  <Button size="sm" variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run('Could not decline it', () => procurementApi.declineVariation(project.id, offer.variationId, reason.trim()))}>
                    Decline
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" loading={busy} disabled={!offer.onto} onClick={() => void run('Could not take it', () => procurementApi.acceptVariation(project.id, offer.variationId))}>
                    Accept
                  </Button>
                  <Button size="sm" variant="secondary" loading={busy} disabled={!offer.onto} onClick={() => void run('Could not take it', () => procurementApi.acceptVariation(project.id, offer.variationId, 'already_in'))}>
                    The forecast already carries it
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeclining(offer.variationId)}>
                    Decline
                  </Button>
                </div>
              )
            ) : (
              <p className="text-xs text-ink-muted">A lead or signer in Finance takes it.</p>
            )}
          </div>
        ))}
        {waiting.map(({ tender, offer, packageName, bidderName, onto }) => (
          <div key={offer.id} className="space-y-2 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 text-[13px] font-medium text-ink">
                {packageName}
                <span className="font-normal text-ink-secondary"> · {bidderName}</span>
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-ink">
                {onto ? <span className="text-ink-muted">{moneySaid(onto.poIssued, project.currency)}</span> : null}
                {onto ? <ArrowRight size={12} aria-hidden className="text-ink-muted" /> : null}
                {moneySaid(offer.amount, project.currency)}
              </p>
            </div>
            <p className="text-xs text-ink-secondary">
              {onto ? `PO issued on ${onto.label}, from the letter of ${daySaid(tender.award?.letterOn)}.` : 'No draft Cost Report holds this package. Start one to accept it.'}
            </p>
            {mayAccept ? (
              declining === tender.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Why it is declined" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" className="min-w-[12rem] flex-1" />
                  <Button size="sm" variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run('Could not decline it', () => procurementApi.declineOffer(project.id, tender.id, reason.trim()))}>
                    Decline
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" loading={busy} disabled={!onto} onClick={() => void run('Could not accept it', () => procurementApi.acceptOffer(project.id, tender.id))}>
                    Accept
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeclining(tender.id)}>
                    Decline
                  </Button>
                </div>
              )
            ) : (
              <p className="text-xs text-ink-muted">A lead or signer in Finance accepts it.</p>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
