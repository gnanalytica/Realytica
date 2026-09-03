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
import { ScheduleOfProperty } from '../../components/ScheduleOfProperty';
import { countryForCurrency } from '../../lib/units';
import { ValuationWorkingPanel } from '../../components/ValuationWorkingPanel';
import { ValuationSummary } from '../../components/ValuationSummary';
import { TitleChainDiagram } from '../../components/charts';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

function money(n: number, currency: string) {
  if (currency === 'INR') return `₹${Math.round(n).toLocaleString('en-IN')}`;
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

/**
 * Which of the two buttons produced a run.
 *
 * The page offers a property screen and an indicative valuation, and they
 * answer different questions — one blends market anchors, the other runs the
 * four IBBI approaches over recorded inputs. They land in the same list, so a
 * row that does not say which it was leaves a reader comparing two numbers
 * with no idea why they differ.
 *
 * Read off the instruction the run wrote for itself rather than a stored kind,
 * so runs recorded before this distinction was drawn still describe themselves.
 */
function runMethod(run: { ibbi: { instruction: string }; working?: unknown }): string {
  if (run.ibbi.instruction.startsWith('Property screen')) return 'Property screen — blended market anchors';
  if (run.working) return 'Indicative valuation — IBBI approaches';
  return 'Indicative valuation';
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
        <EmptyState
          title="No valuation run yet"
          description="An indicative range needs the land and built-up areas on the project — record those and either button below will produce one. Without them every approach reports which input it is missing rather than guessing."
        />
      ) : (
        <>
        {/* The answer first. Everything below this card is the working, and it
            runs to roughly eighteen screens. */}
        <ValuationSummary run={latest} screen={project.lastScreenResult} method={runMethod(latest)} />
        <Card>
          {/*
            `indicatedValue` is 0 when there is no figure, and a headline of ₹0
            is the most misleading thing this page could show — it reads as a
            valuation of nothing rather than as no valuation. The outcome says
            which of the three situations this is, and the headline says it in
            words instead of printing a zero.
          */}
          {/*
            The figure moved to the summary above, so this card stops repeating
            it. It used to be the headline — and printing the same eleven digits
            twice, four hundred pixels apart, invites a reader to check whether
            they match rather than read on. What this card is FOR is the
            working, so that is what it announces.
          */}
          <CardHeader
            title="How this figure was reached"
            subtitle={
              !latest.working || latest.working.reconciliation.outcome === 'indicated'
                ? `${latest.localityLabel ?? 'no locality match'} · ${formatWhen(latest.createdAt)}`
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
                /*
                  A run written before the working model existed has no
                  per-input provenance to show, but it still has four figures
                  somebody needs to compare — and comparing eleven-digit
                  amounts with Indian grouping, floated right against ragged
                  prose, is a character-by-character diff. Same aligned columns
                  as the panel above, so the two paths read alike.
                */
                <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline">
                  {/* Keyed by name, not by family: a screen produces three
                      market-family approaches, so `a.approach` was the same
                      key three times over. */}
                  {latest.ibbi.approaches.map((a, i) => (
                    <li key={a.label ?? `${a.approach}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2 text-[13px]">
                      <span className="min-w-0">
                        {/*
                          The anchor's own name when it has one. A screen makes
                          three market-family approaches at once — comparable
                          sales, a guidance-value reference, a locality index
                          trend — and by family they were three rows all
                          reading "Market / comparable" with a threefold spread
                          between their figures. The family stays as the
                          qualifier, since IBBI asks in those terms.
                        */}
                        <span className="font-medium text-ink">{a.label ?? VALUATION_APPROACH_LABEL[a.approach]}</span>
                        {a.label ? (
                          <span className="ml-1.5 text-[11.5px] text-ink-muted">{VALUATION_APPROACH_LABEL[a.approach]}</span>
                        ) : null}
                        {a.notes ? <span className="block text-[12px] text-ink-secondary">{a.notes}</span> : null}
                      </span>
                      <span className="text-right font-mono tabular-nums text-ink">{money(a.amount, latest.currency)}</span>
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
        </>
      )}

      {runs.length > 1 ? (
        <Card>
          {/*
            "Prior runs" said these had been superseded. Two of the buttons on
            this page run different methods — the property screen blends
            anchors, the indicative valuation runs the four IBBI approaches —
            so an earlier figure is often not an older attempt at the same
            question but a different question's answer, demoted by nothing more
            than having been pressed first.
          */}
          <CardHeader
            title="Other runs on this file"
            info="Each row is a separate run. A run from a different method is not a superseded version of this one — compare the methods, not the timestamps."
          />
          <CardBody className="divide-y divide-hairline">
            {runs.slice(1).map((run) => (
              <div key={run.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="font-mono tabular-nums text-ink">{money(run.indicatedValue, run.currency)}</span>
                  <span className="ml-2 text-ink-secondary">{runMethod(run)}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                  {VALUATION_RUN_STATUS_LABEL[run.status]} · {formatWhen(run.createdAt)}
                </span>
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
          <ScreenResultPanel
            result={project.lastScreenResult}
            askingPrice={project.budget}
            country={countryForCurrency(project.currency)}
            locality={project.city}
          />
          {titleGraph.nodes.length > 0 ? (
            <>
              <Card>
                <CardHeader title="Title structure" />
                <CardBody>
                  <TitleChainDiagram graph={titleGraph} summary={project.lastScreenResult.titleGraph} />
                </CardBody>
              </Card>
              {/* What the deeds say the land is bounded by — the schedule a
                  valuer reads before believing any extent on the file. */}
              <ScheduleOfProperty graph={titleGraph} />
            </>
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
/** Rule 8(3) completeness in the app's own status vocabulary. */
const RULE8_LABEL = { stated: 'Stated', partial: 'Partial', missing: 'Missing' } as const;
const RULE8_TONE = { stated: 'good', partial: 'warning', missing: 'critical' } as const;

function Rule8Checklist({ sections }: { sections: Parameters<typeof rule8Summary>[0] }) {
  const summary = rule8Summary(sections, sections.rule8 ?? {});
  return (
    <section>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">IBBI Rule 8(3) report contents</h3>
      <p className="mt-1 text-[12px] text-ink-secondary">{summary.say}</p>
      {/*
        Each item wears its own status, in words.

        The header counts "4 stated, 5 partial, 3 missing" and the only way to
        tell which item was which was the colour of its clause number — so the
        summary could not be matched to the list without knowing that green
        meant stated, and a reader who cannot separate the hues had nothing at
        all. Every other status in this product pairs a colour with a label;
        the one place a valuer checks a statutory obligation against is not
        where to make an exception.

        Three aligned columns so the statuses read down the page as a column
        rather than being hunted for in prose.
      */}
      <ul className="mt-2 space-y-1">
        {summary.rows.map((row) => (
          <li key={row.item} className="grid grid-cols-[3.25rem_5.5rem_minmax(0,1fr)] items-baseline gap-2 text-[12px]">
            <span className="font-mono text-[10.5px] text-ink-muted">{row.clause}</span>
            <Badge tone={RULE8_TONE[row.status]}>{RULE8_LABEL[row.status]}</Badge>
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
