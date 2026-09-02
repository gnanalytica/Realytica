import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  rule8Summary,
  titleGraphFromProject,
  VALUATION_APPROACH_LABEL,
  VALUATION_BASIS_LABEL,
  VALUATION_PREMISE_LABEL,
  VALUATION_RUN_STATUS_LABEL,
  VALUATION_SIGN_OFF_LABEL,
  type ValuationSignOff,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select, useToast } from '../../components/ui/kit';
import { ScreenResultPanel } from '../../components/ScreenResultPanel';
import { ValuationWorkingPanel } from '../../components/ValuationWorkingPanel';
import { TitleChainDiagram } from '../../components/charts';
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
  // Read from the project graph, which holds the title entities the screen
  // works out — rather than from the full TitleGraph, which runScreen builds
  // and discards.
  const titleGraph = titleGraphFromProject(project);
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

  async function screen() {
    setBusy(true);
    try {
      await api.runProjectScreen(project.id);
      setProject(await api.getProject(project.id));
      toast('Property screen wrote findings, risks and an indicative valuation', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not run property screen', 'critical');
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
        <p className="text-[13px] text-ink-secondary">
          Indicative. Not a certified value unless a registered valuer signs a professional report.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void screen()} disabled={busy}>Run property screen</Button>
          <Button onClick={() => void run()} disabled={busy}>Run indicative valuation</Button>
        </div>
      </div>

      {!latest ? (
        <EmptyState title="No valuation run yet" description="Uses land and built-up areas plus locality medians. Record areas on the project for a usable range." />
      ) : (
        <Card>
          {/*
            `indicatedValue` is 0 when there is no figure, and a headline of ₹0
            is the most misleading thing this page could show — it reads as a
            valuation of nothing rather than as no valuation. The outcome says
            which of the three situations this is, and the headline says it in
            words instead of printing a zero.
          */}
          <CardHeader
            title={
              !latest.working || latest.working.reconciliation.outcome === 'indicated'
                ? money(latest.indicatedValue, latest.currency)
                : latest.working.reconciliation.outcome === 'approaches_disagree'
                  ? 'No figure — the approaches disagree'
                  : 'No figure — nothing could be run'
            }
            subtitle={
              !latest.working || latest.working.reconciliation.outcome === 'indicated'
                ? `${money(latest.low, latest.currency)} – ${money(latest.high, latest.currency)} · ${latest.localityLabel ?? 'no locality match'} · ${formatWhen(latest.createdAt)}`
                : `${latest.working.reconciliation.spreadBasis} · ${formatWhen(latest.createdAt)}`
            }
            action={<Badge tone={!latest.working || latest.working.reconciliation.outcome === 'indicated' ? 'neutral' : 'warning'}>{VALUATION_RUN_STATUS_LABEL[latest.status]}</Badge>}
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
              {/* The working when the run carries it. Runs written before the
                  formula model exists fall back to the summary line, which is
                  all they ever had. */}
              {latest.working ? (
                <div className="mt-2">
                  <ValuationWorkingPanel working={latest.working} currency={latest.currency} />
                </div>
              ) : (
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
              )}
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
            <Rule8Checklist sections={latest.ibbi} />

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

      {/*
        The screen's own working, below the valuation it produced. The engine
        computes anchors, comparables, drivers, the state compliance checks and
        the transaction costs on every run; until this was rendered, all of it
        was discarded and the reader got a verdict with nothing behind it.
      */}
      {project.lastScreenResult ? (
        <section className="space-y-4 pt-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">
            Property screen
            <span className="ml-2 font-normal text-ink-muted">
              {formatWhen(project.lastScreenResult.generatedAt)} · engine {project.lastScreenResult.engineVersion}
            </span>
          </h2>
          <ScreenResultPanel result={project.lastScreenResult} askingPrice={project.budget} />
          {titleGraph.nodes.length > 0 ? (
            <Card>
              <CardHeader
                title="Title structure"
              />
              <CardBody>
                <TitleChainDiagram graph={titleGraph} summary={project.lastScreenResult.titleGraph} />
              </CardBody>
            </Card>
          ) : null}
        </section>
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

/**
 * Which of the twelve Rule 8(3) items this report answers.
 *
 * Computed rather than asserted, because a report that quietly omits the
 * conflict disclosure looks exactly like one that had nothing to disclose. The
 * notes read as instructions rather than diagnoses — the only useful thing a
 * completeness readout can do is tell somebody what to go and do.
 *
 * The summary line is deliberately never congratulatory: twelve of twelve is a
 * complete STRUCTURE, and a structure is not a certificate.
 */
function Rule8Checklist({ sections }: { sections: Parameters<typeof rule8Summary>[0] }) {
  const summary = rule8Summary(sections, sections.rule8 ?? {});
  return (
    <section>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">IBBI Rule 8(3) report contents</h3>
      <p className="mt-1 text-[12px] text-ink-secondary">{summary.say}</p>
      <ul className="mt-2 space-y-1">
        {summary.rows.map((row) => (
          <li key={row.item} className="flex items-baseline gap-2 text-[12px]">
            <span
              className={
                row.status === 'stated'
                  ? 'w-14 shrink-0 font-mono text-[10.5px] text-status-good-text'
                  : row.status === 'partial'
                    ? 'w-14 shrink-0 font-mono text-[10.5px] text-status-warning'
                    : 'w-14 shrink-0 font-mono text-[10.5px] text-status-critical'
              }
            >
              {row.clause}
            </span>
            <span className="min-w-0">
              <span className={row.status === 'missing' ? 'text-ink-muted' : 'text-ink'}>{row.says}</span>
              {row.note ? <span className="block text-[11px] text-ink-muted">{row.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
