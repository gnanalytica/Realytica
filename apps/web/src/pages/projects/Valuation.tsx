import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  VALUATION_APPROACH_LABEL,
  VALUATION_BASIS_LABEL,
  VALUATION_PREMISE_LABEL,
  VALUATION_RUN_STATUS_LABEL,
  VALUATION_SIGN_OFF_LABEL,
  type ValuationSignOff,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Select, useToast } from '../../components/ui/kit';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

function money(n: number, currency: string) {
  if (currency === 'INR') return `₹${Math.round(n).toLocaleString('en-IN')}`;
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

export default function Valuation() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const runs = [...(project.valuationRuns ?? [])].slice().reverse();
  const latest = runs[0];

  async function run() {
    setBusy(true);
    try {
      await api.runValuation(project.id);
      setProject(await api.getProject(project.id));
      toast('Indicative valuation computed from project registers', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not run valuation', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function signOff(runId: string, value: ValuationSignOff) {
    try {
      await api.patchValuation(project.id, runId, value);
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update sign-off', 'critical');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-ink-secondary">
          IBBI-structured indicative valuation. Decision support only — not a certified value unless a registered valuer signs a separate professional report.
        </p>
        <Button onClick={() => void run()} disabled={busy}>Run indicative valuation</Button>
      </div>

      <Callout tone="warning" title="Not a certified valuation">
        Sign-off on this screen records workflow state (unsigned / internal review / valuer required). It does not issue an IBBI certificate.
      </Callout>

      {!latest ? (
        <EmptyState title="No valuation run yet" description="Uses land and built-up areas plus locality medians. Record areas on the project for a usable range." />
      ) : (
        <Card>
          <CardHeader
            title={money(latest.indicatedValue, latest.currency)}
            subtitle={`${money(latest.low, latest.currency)} – ${money(latest.high, latest.currency)} · ${latest.localityLabel ?? 'no locality match'} · ${formatWhen(latest.createdAt)}`}
            action={<Badge>{VALUATION_RUN_STATUS_LABEL[latest.status]}</Badge>}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <p className="text-[13px] text-ink-secondary">Premise: {VALUATION_PREMISE_LABEL[latest.ibbi.premise]}</p>
              <p className="text-[13px] text-ink-secondary">Basis: {VALUATION_BASIS_LABEL[latest.ibbi.basis]}</p>
              <FieldSignOff value={latest.signOff} onChange={(v) => void signOff(latest.id, v)} />
            </div>
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Instruction</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">{latest.ibbi.instruction}</p>
            </section>
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Subject</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">{latest.ibbi.subject}</p>
            </section>
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Approaches</h3>
              <ul className="mt-2 space-y-2">
                {latest.ibbi.approaches.map((a) => (
                  <li key={a.approach} className="flex items-start justify-between gap-3 text-[13px]">
                    <span>
                      <span className="font-medium text-ink">{VALUATION_APPROACH_LABEL[a.approach]}</span>
                      <span className="block text-ink-secondary">{a.notes}</span>
                    </span>
                    <span className="shrink-0 font-mono text-ink">{money(a.amount, latest.currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Reconciliation</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">{latest.ibbi.reconciliation}</p>
            </section>
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Caveats</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-ink-secondary">
                {latest.ibbi.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
            <p className="font-mono text-[11px] text-ink-muted">
              Relied upon {latest.ibbi.evidenceReliedUponIds.length} · considered {latest.ibbi.evidenceConsideredIds.length} · gaps {latest.ibbi.evidenceGapIds.length}
            </p>
          </CardBody>
        </Card>
      )}

      {runs.length > 1 ? (
        <Card>
          <CardHeader title="Prior runs" />
          <CardBody className="divide-y divide-hairline">
            {runs.slice(1).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                <span>{money(run.indicatedValue, run.currency)} · {VALUATION_RUN_STATUS_LABEL[run.status]}</span>
                <span className="font-mono text-[11px] text-ink-muted">{formatWhen(run.createdAt)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function FieldSignOff({ value, onChange }: { value: ValuationSignOff; onChange: (v: ValuationSignOff) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as ValuationSignOff)}>
      {(Object.keys(VALUATION_SIGN_OFF_LABEL) as ValuationSignOff[]).map((k) => (
        <option key={k} value={k}>{VALUATION_SIGN_OFF_LABEL[k]}</option>
      ))}
    </Select>
  );
}
