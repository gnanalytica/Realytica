import { useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  rule8Summary,
  titleGraphFromProject,
  VALUATION_APPROACH_LABEL,
  VALUATION_BASIS_LABEL,
  VALUATION_PREMISE_LABEL,
  VALUATION_RUN_STATUS_LABEL,
  VALUATION_SIGN_OFF_LABEL,
  type ValuationSignOff,
  type CheckFieldWrite,
  matchProjectLocality,
  suggestValuationInputs,
  resolveStatePack,
  REFERENCE_DATA,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select, Tabs, Why, useToast } from '../../components/ui/kit';
import type { TabDef } from '../../components/ui/kit';
import { ScreenResultPanel } from '../../components/ScreenResultPanel';
import { ScheduleOfProperty } from '../../components/ScheduleOfProperty';
import { countryForCurrency } from '../../lib/units';
import { ValuationWorkingPanel } from '../../components/ValuationWorkingPanel';
import { ValuationInputSheet } from '../../components/ValuationInputSheet';
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

/**
 * Which slice of the working the reader is standing in.
 *
 * Deliberately a URL parameter rather than component state: a valuer who has
 * scrolled to a compliance blocker and wants a colleague to look at it sends a
 * link, and a link that reopens on the summary has not sent them anything. It
 * is also what makes the browser's back button behave — a tab strip that
 * swallows navigation is the single most common way an in-page tab set
 * frustrates somebody.
 */
type ValueView = 'inputs' | 'working' | 'market' | 'compliance' | 'costs' | 'evidence';

export default function Valuation() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
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

  const screenResult = project.lastScreenResult;

  /*
   * Values the file could start from — the locality's own rates, the built-up
   * area already on the project, the acquisition percentage the state pack's
   * duty figures imply. Derived on read rather than stored: a suggestion is a
   * statement about what is currently known, and one frozen into the project
   * would outlive the data behind it.
   */
  const suggestions = useMemo(
    () =>
      suggestValuationInputs(
        project,
        matchProjectLocality(project),
        resolveStatePack({ country: countryForCurrency(project.currency), state: project.jurisdiction ?? '' }, REFERENCE_DATA.statePacks),
      ),
    [project],
  );

  /*
   * Only offer a tab that has something behind it.
   *
   * A file with no property screen has a working and nothing else, and five
   * tabs where four open onto an empty pane is a worse page than no tabs at
   * all — it implies the analysis exists and failed to load.
   */
  const views: (TabDef & { key: ValueView })[] = [
    /*
      Inputs first, because it is the tab a file needs before any of the
      others say anything. A new project reports "no approach had all of its
      inputs" four times over, and this is the only view that shows which
      cells are the reason.
    */
    { key: 'inputs', label: 'Inputs' },
    { key: 'working', label: 'Working' },
    ...(screenResult && (screenResult.comparables.length > 0 || screenResult.drivers.length > 0)
      ? [{ key: 'market' as const, label: 'Market' }]
      : []),
    ...(screenResult
      ? [
          {
            key: 'compliance' as const,
            label: 'Compliance',
            // The one count worth carrying on the tab itself: a blocker is a
            // stop-spending finding and should not need a click to discover.
            badge: blockerCount(screenResult) ? (
              <Badge tone="critical">{blockerCount(screenResult)}</Badge>
            ) : undefined,
          },
        ]
      : []),
    ...(screenResult?.transactionCosts ? [{ key: 'costs' as const, label: 'Costs' }] : []),
    ...(screenResult ? [{ key: 'evidence' as const, label: 'Evidence' }] : []),
  ];

  const requested = params.get('view') as ValueView | null;
  // A stale link to a tab this file no longer has falls back rather than
  // rendering nothing at all.
  const view: ValueView = views.some((v) => v.key === requested) ? requested! : 'working';

  /**
   * One field written back to its check.
   *
   * Returns the refusal rather than only toasting it: the sheet keeps a
   * rejected value in its cell and shows the reason beside it, because a
   * proof-required field declines until it cites a document and a value that
   * vanished on blur would be worse than one that will not save.
   */
  async function commitField(
    checkId: string,
    values: Record<string, CheckFieldWrite>,
    sourceEvidenceId?: string,
  ): Promise<string | null> {
    try {
      const out = await api.recordCheckFields(project.id, checkId, values, sourceEvidenceId);
      setProject(out.project);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save';
    }
  }
  const setView = (key: string) => {
    const next = new URLSearchParams(params);
    // 'working' is the default, so it stays out of the URL — otherwise every
    // link anybody copies from this page carries a redundant parameter.
    if (key === 'working') next.delete('view');
    else next.set('view', key);
    setParams(next, { replace: true });
  };

  /*
   * The figure pinned at the top, handed down so the screen's own range card
   * can reconcile itself against it instead of quietly printing a second one.
   */
  const headlineFigure =
    latest && (!latest.working || latest.working.reconciliation.outcome === 'indicated')
      ? { value: latest.indicatedValue, label: runMethod(latest) }
      : undefined;

  const screenPanel = (only: Parameters<typeof ScreenResultPanel>[0]['only']) =>
    screenResult ? (
      <ScreenResultPanel
        result={screenResult}
        only={only}
        headline={headlineFigure}
        askingPrice={project.budget}
        subjectAreaSqm={project.builtUpAreaSqm ?? project.landAreaSqm}
        country={countryForCurrency(project.currency)}
        locality={project.city}
      />
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The caveat is a standing condition, not news. It reads as a chip
            beside the figure rather than a sentence above the controls. */}
        <Badge tone="neutral" title="Not a certified value unless a registered valuer signs a professional report.">
          Indicative
        </Badge>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void screen()} disabled={busy}>Run property screen</Button>
          <Button onClick={() => void run()} disabled={busy}>Run indicative valuation</Button>
        </div>
      </div>

      {!latest ? (
        <EmptyState
          title="No valuation run yet"
          description="Record the land and built-up areas, then run a screen or a valuation."
        />
      ) : (
        <>
        {/*
          The answer, and it stays put.

          Everything below the tab strip is the working — measured, about
          eighteen screens of it in an eight-hundred-pixel pane. Splitting that
          into five views is what makes each one readable; pinning the figure
          above the strip is what stops the split from hiding the answer. A
          reader who tabs to Compliance is still looking at the number the
          compliance finding is about.
        */}
        <ValuationSummary run={latest} screen={screenResult} method={runMethod(latest)} />

        {/* A blocker outranks whichever tab you happen to be on. */}
        {screenPanel(['blockers'])}

        {views.length > 1 ? <Tabs tabs={views} active={view} onChange={setView} /> : null}

        {view === 'inputs' ? (
          <ValuationInputSheet
            project={project}
            suggestions={suggestions}
            onCommit={commitField}
            disabled={busy}
          />
        ) : null}

        {view === 'working' ? (
        <>
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
              {/*
                Stacked, not spread. `KeyValue` pushes its label and value to
                opposite edges, which is right in a full-width list and wrong
                in a third-width column — "Premise" ended up eighty pixels from
                "Residual / development" and the two read as separate items.
              */}
              <div>
                <p className="text-mini uppercase tracking-wider text-ink-muted">Premise</p>
                <p className="text-[13px] text-ink">{VALUATION_PREMISE_LABEL[latest.ibbi.premise]}</p>
              </div>
              <div>
                <p className="text-mini uppercase tracking-wider text-ink-muted">Basis</p>
                <p className="text-[13px] text-ink">{VALUATION_BASIS_LABEL[latest.ibbi.basis]}</p>
              </div>
              <FieldSignOff value={latest.signOff} onChange={(v) => void signOff(latest.id, v)} />
            </div>
            {/*
              Instruction and Subject are Rule 8(3) narrative: required in the
              signed report, and three hundred characters of standing preamble
              on a screen somebody opened to read a figure. They print in full.
            */}
            <Why label="Instruction and subject">
              <p>{latest.ibbi.instruction}</p>
              <p>{latest.ibbi.subject}</p>
            </Why>
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
                        {a.notes ? <Why>{a.notes}</Why> : null}
                      </span>
                      <span className="text-right font-mono tabular-nums text-ink">{money(a.amount, latest.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <Why label="Reconciliation">{latest.ibbi.reconciliation}</Why>
            <Why label={`Caveats · ${latest.ibbi.caveats.length}`}>
              <ul className="list-disc space-y-1 pl-4">
                {latest.ibbi.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Why>
            <Rule8Checklist sections={latest.ibbi} />

            <p className="font-mono text-[11px] text-ink-muted">
              Relied upon {latest.ibbi.evidenceReliedUponIds.length} · considered {latest.ibbi.evidenceConsideredIds.length} · gaps {latest.ibbi.evidenceGapIds.length}
            </p>
          </CardBody>
        </Card>

        {/* The screen's own blend of anchors — the second opinion on the same
            question, and the card that reconciles itself against the figure
            pinned at the top when the two methods disagree. */}
        {screenPanel(['range'])}
        </>
        ) : null}
        </>
      )}

      {view === 'working' && runs.length > 1 ? (
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
      {screenResult && view !== 'working' ? (
        <section className="space-y-4">
          {/* Which screen this is, on every view that renders one — a reader
              who tabbed straight to Compliance never saw the timestamp. */}
          <p className="text-[11px] text-ink-muted">
            Property screen · {formatWhen(screenResult.generatedAt)} · engine {screenResult.engineVersion}
          </p>

          {view === 'market' ? screenPanel(['market']) : null}
          {view === 'costs' ? screenPanel(['costs']) : null}
          {view === 'evidence' ? screenPanel(['evidence']) : null}

          {view === 'compliance' ? (
            <>
              {screenPanel(['compliance'])}
              {/* The title chain and the schedule of property belong with the
                  statutory checks, not below the market evidence: they are the
                  same question — is the title what the file says it is. */}
              {titleGraph.nodes.length > 0 ? (
                <>
                  <Card>
                    <CardHeader
                      title="Title structure"
                      subtitle="Every conveyance on file, and what it left unresolved."
                    />
                    <CardBody>
                      <TitleChainDiagram graph={titleGraph} summary={screenResult.titleGraph} />
                    </CardBody>
                  </Card>
                  {/* What the deeds say the land is bounded by — the schedule a
                      valuer reads before believing any extent on the file. */}
                  <ScheduleOfProperty graph={titleGraph} />
                </>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Blockers on a screen, for the count that rides on the Compliance tab. */
function blockerCount(result: { stateCompliance?: { checks: { verdict: string }[] } }): number {
  return (result.stateCompliance?.checks ?? []).filter((c) => c.verdict === 'blocker').length;
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
