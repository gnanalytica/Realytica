/**
 * Awarded values waiting on Finance.
 *
 * A letter of acceptance offers its value to the package's row on the Cost
 * Report as PO issued. It is written there when a lead or a signer in Finance
 * accepts it here, and the row says what it holds now, so the person sees
 * what accepting changes. Shown on Tenders and on Budget. Nothing is drawn
 * where nothing waits.
 */

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { departmentRole, moneySaid, roleCanDecide, tenderOffersWaiting, type DdProject } from '@realytica/shared';
import { procurementApi } from '../../lib/procurement-api';
import { useMe } from '../../lib/useMe';
import { Button, Card, CardBody, CardHeader, Input, useToast } from '../ui/kit';
import { daySaid } from '@realytica/shared';

export function TenderOffers({ project, onChanged }: { project: DdProject; onChanged: (p: DdProject) => void }) {
  const toast = useToast();
  const me = useMe();
  const mayAccept = roleCanDecide(me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, 'finance') : undefined);
  const waiting = tenderOffersWaiting(project);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (!waiting.length) return null;

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
      <CardHeader title="Awarded, waiting on Finance" subtitle={`${waiting.length} to accept as PO issued`} />
      <CardBody className="space-y-3">
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
