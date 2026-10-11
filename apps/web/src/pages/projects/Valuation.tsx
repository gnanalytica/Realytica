import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Landmark, Sparkles } from 'lucide-react';
import {
  computeIndicativeValuation,
  parcelLabels,
  revenueReads,
  rule8Summary,
  runValuationApproaches,
  surveyNumbersLabel,
  valueChecks,
  valueDrivers,
  valueInputCheckId,
  valueInputRows,
  valueOffers,
  valueReadingsWaiting,
  valueSummary,
  withValueOffers,
  VALUATION_RUN_STATUS_LABEL,
  VALUATION_SIGN_OFF_LABEL,
  type DdProject,
  type ValuationPremise,
  type ValuationSignOff,
  type ValueInputRow,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Disclosure, useToast } from '../../components/ui/kit';
import { ScreenResultPanel } from '../../components/ScreenResultPanel';
import { ValuationWorkingPanel } from '../../components/ValuationWorkingPanel';
import { ValueHeadline, type ValueStatus } from '../../components/value/ValueHeadline';
import { ValueChecks } from '../../components/value/ValueChecks';
import { ValueDrivers } from '../../components/value/ValueDrivers';
import { ValueApproaches, describeSources } from '../../components/value/ValueApproaches';
import { ValueReading, type ReadingStep } from '../../components/value/ValueReading';
import { useValueFill } from '../../components/value/useValueFill';
import { ComparablesRegister } from '../../components/value/ComparablesRegister';
import { settleItems, ValueMustSettle, type SettleTarget } from '../../components/value/ValueMustSettle';
import { ValueRule8 } from '../../components/value/ValueRule8';
import { useAsync } from '../../lib/useAsync';
import { countryForCurrency } from '../../lib/units';
import { money } from '../../lib/format';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';
import { WorkstreamFrame } from './departments/WorkstreamPage';

/** Basis of value from the latest run, else the stage’s default premise. */
function premiseOf(project: DdProject, runPremise?: ValuationPremise): ValuationPremise {
  if (runPremise) return runPremise;
  if (project.currentStage === 'opportunity_site' || project.currentStage === 'feasibility' || project.currentStage === 'acquisition') {
    return 'residual';
  }
  if (project.currentStage === 'operations' || project.currentStage === 'handover' || project.currentStage === 'completion') {
    return 'as_is';
  }
  return 'as_completed';
}

function jumpTo(target: SettleTarget) {
  const id =
    target === 'approaches' || target === 'comparables' || target === 'property'
      ? 'value-approaches'
      : target === 'compliance'
        ? 'value-compliance'
        : 'value-rule8';
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The Value tab: one view of what the property is worth, what that figure
 * stands on, and what moves it.
 *
 * There were two buttons here — a property screen and an indicative
 * valuation — answering two halves of one question on two pages of output,
 * and neither filled anything in: the screen checked the title and gave no
 * value, the valuation gave a value from inputs somebody had typed. Now there
 * is one action. "Value this property" checks the title against the state's
 * rules and a lender's, then fills every input the file holds — the extent
 * off the deed, the built-up area off the plan, the guidance rate off the
 * state's map, the building's age off its occupancy certificate — one at a
 * time, each with the document and page it came from, and the figure moves
 * as each approach gets what it needs. Nothing is recorded until a person
 * accepts it; what the file does not hold waits for a valuer, and says so.
 */
export default function Valuation() {
  const { project, setProject, onOpenCited, onReviewDocument } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const fill = useValueFill();
  const [busy, setBusy] = useState(false);
  // Which part of the check is running, for the steps strip.
  const [stage, setStage] = useState<'title' | 'portals' | null>(null);
  const [searching, setSearching] = useState(false);
  const comparablesStatus = useAsync(() => api.comparables(project.id), [project.id]);
  const portalsConfigured = comparablesStatus.data ? comparablesStatus.data.configured : comparablesStatus.error ? false : null;

  const offers = useMemo(() => valueOffers(project), [project]);
  // What a model read, or two readers read differently, that an input here would have been offered from. It is offered to none.
  const readingsWaiting = useMemo(() => valueReadingsWaiting(project), [project]);
  const rows = useMemo(() => valueInputRows(project, offers), [project, offers]);
  const waiting = useMemo(() => rows.flatMap((r) => (r.waiting ? [r.waiting] : [])), [rows]);
  // While the page fills, the figure counts only what has landed so far.
  const counted = useMemo(() => (fill.revealed ? waiting.filter((o) => fill.revealed!.has(o.input)) : waiting), [waiting, fill.revealed]);
  const shownProject = useMemo(() => withValueOffers(project, counted), [project, counted]);
  const working = useMemo(() => runValuationApproaches(shownProject), [shownProject]);
  const summary = useMemo(() => valueSummary(project, working), [project, working]);
  const screen = project.lastScreenResult;
  const checks = useMemo(() => valueChecks(project, working, summary, screen), [project, working, summary, screen]);
  const drivers = useMemo(() => valueDrivers(project, working, screen), [project, working, screen]);

  const runs = useMemo(() => [...(project.valuationRuns ?? [])].reverse(), [project.valuationRuns]);
  const latest = runs.find((r) => r.status !== 'superseded');
  const rule8 = useMemo(() => {
    if (shownProject !== project) {
      const provisional = computeIndicativeValuation(shownProject);
      return rule8Summary(provisional.ibbi, provisional.ibbi.rule8 ?? {});
    }
    return latest ? rule8Summary(latest.ibbi, latest.ibbi.rule8 ?? {}) : null;
  }, [shownProject, project, latest]);

  const recordedFigure = latest && (!latest.working || latest.working.reconciliation.outcome === 'indicated') && latest.indicatedValue > 0 ? latest.indicatedValue : null;
  const filling = fill.phase === 'checking' || fill.phase === 'filling';
  const status: ValueStatus =
    counted.length > 0
      ? 'provisional'
      : summary.fairMarket === null
        ? 'none'
        : recordedFigure !== null && Math.abs(summary.fairMarket - recordedFigure) / summary.fairMarket < 0.005
          ? 'recorded'
          : 'unrecorded';

  /* ---- actions -------------------------------------------------------- */

  async function valueProperty() {
    try {
      await fill.start(async () => {
        setStage('title');
        const out = await api.valueProperty(project.id);
        let next = out.project;
        setProject(next);
        // The portals, when they can be searched and have not been this week.
        if (out.comparableSearch === 'due') {
          setStage('portals');
          try {
            next = (await api.searchComparables(project.id)).project;
            setProject(next);
          } catch {
            // The register says why; the rest of the fill goes on without it.
          }
        }
        setStage(null);
        return valueInputRows(next).filter((r) => r.waiting).map((r) => r.key);
      });
    } catch (e) {
      setStage(null);
      toast(e instanceof Error ? e.message : 'Could not value the property', 'critical');
    }
  }

  async function searchPortals() {
    setSearching(true);
    try {
      const out = await api.searchComparables(project.id);
      setProject(out.project);
      toast(out.found ? `Found ${out.found} comparable${out.found === 1 ? '' : 's'} on the portals` : (out.empty ?? 'No comparables found'), out.found ? 'good' : 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not search the portals', 'critical');
    } finally {
      setSearching(false);
    }
  }

  async function saveComparable(work: () => Promise<{ project: typeof project }>): Promise<string | null> {
    try {
      setProject((await work()).project);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save';
    }
  }

  async function accept(ids: string[], record = false) {
    if (!ids.length) return;
    setBusy(true);
    try {
      const out = await api.acceptValueOffers(project.id, ids, record);
      setProject(out.project);
      if (out.refused.length) toast(out.refused[0]!.error, 'warning');
      else if (out.runId) {
        toast(`Recorded ${out.applied.length} input${out.applied.length === 1 ? '' : 's'} and the valuation`, 'good');
        // What the strip said was filled is now recorded; it has nothing left to say.
        fill.reset();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record those values', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function setAside(ids: string[]) {
    setBusy(true);
    try {
      setProject((await api.setAsideValueOffers(project.id, ids)).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set that aside', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function commit(row: ValueInputRow, value: number | string | null, cite?: string): Promise<string | null> {
    try {
      if (row.target.kind === 'project') {
        if (typeof value === 'string') return 'That field only takes a number.';
        setProject(await api.patchProject(project.id, { [row.target.field]: value ?? undefined }));
        return null;
      }
      const checkId = valueInputCheckId(project, row.target);
      if (!checkId) return 'Press “Value this property” first — it starts the valuation DD these are recorded on.';
      const out = await api.recordCheckFields(project.id, checkId, { [row.target.key]: value }, cite);
      setProject(out.project);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save';
    }
  }

  async function record() {
    setBusy(true);
    try {
      await api.runValuation(project.id);
      setProject(await api.getProject(project.id));
      toast('Valuation recorded', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record the valuation', 'critical');
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

  async function saveValuer(body: {
    valuer: { name: string; registrationNumber?: string; registeredFor?: string; firm?: string };
    declaredConflict: boolean;
    interests?: string[];
    appointedOn?: string;
  }) {
    if (!latest) throw new Error('Record a valuation first.');
    setBusy(true);
    try {
      await api.setValuationValuer(project.id, latest.id, body);
      setProject(await api.getProject(project.id));
      toast('Valuer and conflict recorded', 'good');
    } finally {
      setBusy(false);
    }
  }

  const openSource = (evidenceId: string, focus?: { key?: string; page?: number }) => {
    if (onReviewDocument) {
      onReviewDocument(evidenceId, focus);
      return;
    }
    onOpenCited?.(evidenceId);
  };

  /* ---- the reading ---------------------------------------------------- */

  const documentsRead = project.evidence.filter((e) => (e.facts ?? []).length > 0 && e.status !== 'superseded' && e.status !== 'rejected').length;
  const stateName = screen?.stateCompliance?.state ?? project.jurisdiction?.split('/')[0]?.trim() ?? 'state';
  // Every parcel read goes into the figure, so the step names them all, or the first few and how many more.
  const onMap = [...parcelLabels(revenueReads(project)).values()];
  const steps: ReadingStep[] = [
    { label: `Read ${documentsRead} document${documentsRead === 1 ? '' : 's'}`, state: 'done' },
    { label: `Title against the ${stateName} rules`, state: fill.phase === 'checking' && stage === 'title' ? 'active' : 'done' },
    ...(portalsConfigured
      ? [{ label: 'Comparables · 99acres, MagicBricks', state: stage === 'portals' ? ('active' as const) : stage === 'title' ? ('waiting' as const) : ('done' as const) }]
      : []),
    ...(onMap.length ? [{ label: `Revenue map · ${surveyNumbersLabel(onMap, 3)}`, state: fill.phase === 'checking' ? ('waiting' as const) : ('done' as const) }] : []),
    {
      label: fill.phase === 'filling' ? `Filling ${fill.progress.done} of ${fill.progress.total} inputs` : 'Fill the inputs',
      state: fill.phase === 'filling' ? 'active' : 'waiting',
    },
    { label: 'Weigh the approaches', state: 'waiting' },
  ];
  const filled = offers.filter((o) => waiting.some((w) => w.id === o.id));
  // What the market approaches still lack once the file has given what it holds.
  const forValuer = [
    ...new Set(working.runs.filter((r) => r.method === 'comparable_rate' || r.method === 'depreciated_replacement_cost').flatMap((r) => r.missing)),
  ];
  const readingSummary =
    fill.progress.total === 0
      ? waiting.length === 0 && rows.some((r) => r.recorded)
        ? 'Title checked · inputs already recorded'
        : 'Title checked · nothing to fill yet'
      : `Filled ${fill.progress.total} from ${describeSources(filled)}${
          forValuer.length ? ` · ${forValuer.slice(0, 2).join(', ').toLowerCase()} for valuer` : ''
        }`;

  // During the fill, the checks and drivers arrive with the inputs.
  const share = fill.phase === 'checking' ? 0 : fill.phase === 'filling' ? fill.progress.done / Math.max(1, fill.progress.total) : null;
  const premise = premiseOf(project, latest?.ibbi.premise);
  const mustSettle = settleItems(checks, summary, working);
  // Development budget on the project is not a land asking price.
  const developmentBudget =
    project.currentStage !== 'opportunity_site' &&
    project.currentStage !== 'feasibility' &&
    project.currentStage !== 'acquisition';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-ink shadow-card ring-1 ring-[var(--ring)]" aria-hidden>
            <Landmark size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-ink-muted">Finance &amp; Investment</p>
            <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">Valuation</h2>
          </div>
        </div>
        <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => void valueProperty()} loading={fill.phase === 'checking'} disabled={filling || busy}>
          Value this property
        </Button>
      </div>

      <ValueHeadline
        summary={summary}
        status={status}
        run={latest}
        premise={premise}
        busy={busy}
        spreadBasis={working.reconciliation.spreadBasis}
        onRecord={() => void record()}
        onSignOff={latest ? (value) => void signOff(latest.id, value) : undefined}
      />

      <ValueMustSettle items={mustSettle} onJump={jumpTo} />

      {fill.phase !== 'idle' ? <ValueReading phase={fill.phase} steps={steps} summary={readingSummary} onDismiss={fill.reset} /> : null}

      {readingsWaiting.length ? (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-provenance-ink">
          <span className="font-medium">
            {readingsWaiting.length} document {readingsWaiting.length === 1 ? 'reading' : 'readings'} waiting
          </span>
          <button type="button" onClick={() => openSource(readingsWaiting[0]!.evidence.id)} className="font-medium text-brand underline-offset-2 hover:underline">
            Review
          </button>
        </p>
      ) : null}

      <ValueApproaches
        project={project}
        rows={rows}
        working={working}
        revealed={fill.revealed}
        current={fill.current}
        busy={busy || filling}
        canRecordChecks={project.assessments.some((a) => a.scopes.some((s) => s.checks.some((c) => c.definitionId.startsWith('indicative_valuation.'))))}
        actions={{ onAccept: (ids) => void accept(ids), onSetAside: (ids) => void setAside(ids), onCommit: commit, onOpenSource: openSource }}
        comparables={
          <ComparablesRegister
            project={project}
            configured={portalsConfigured}
            searching={searching || stage === 'portals'}
            busy={busy || filling}
            actions={{
              onSearch: () => void searchPortals(),
              onAdd: (input) => saveComparable(() => api.addComparable(project.id, input)),
              onUpdate: (id, patch) => saveComparable(() => api.updateComparable(project.id, id, patch)),
              onDecide: (ids, decision) => void saveComparable(() => api.decideComparables(project.id, ids, decision)),
              onOpenSource: openSource,
            }}
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 [@container(min-width:52rem)]:grid-cols-2">
        <ValueChecks
          checks={checks}
          revealed={share === null ? null : Math.floor(share * checks.length)}
          screenedAt={screen?.generatedAt}
          state={screen?.stateCompliance?.state}
        />
        <ValueDrivers drivers={drivers} revealed={share === null ? null : Math.floor(share * drivers.length)} />
      </div>

      <ValueRule8
        projectId={project.id}
        rule8={rule8}
        run={latest}
        busy={busy}
        onSaveValuer={saveValuer}
      />

      <div className="space-y-2">
        <Disclosure title="The working, line by line">
          <ValuationWorkingPanel working={working} currency={project.currency} />
        </Disclosure>
        <Disclosure title="Certified report and engagements">
          <WorkstreamFrame project={project} workstream="finance.valuation" setProject={setProject} compact />
        </Disclosure>
        {screen ? (
          <Disclosure title="Evidence and confidence">
            <ScreenResultPanel result={screen} only={['evidence']} askingPrice={project.budget} country={countryForCurrency(project.currency)} locality={project.city} />
          </Disclosure>
        ) : null}
        {screen?.transactionCosts ? (
          <Disclosure title={developmentBudget ? 'Transaction costs (not project budget)' : 'Acquisition costs'}>
            <ScreenResultPanel result={screen} only={['costs']} askingPrice={project.budget} country={countryForCurrency(project.currency)} locality={project.city} />
          </Disclosure>
        ) : null}
        {runs.length > 0 ? (
          <Disclosure title="Recorded valuations" count={runs.length}>
            <ul className="divide-y divide-hairline">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="font-mono tabular-nums text-ink">{run.indicatedValue > 0 ? money(run.indicatedValue, run.currency) : 'No figure'}</span>
                    <span className="ml-2 text-ink-secondary">{VALUATION_RUN_STATUS_LABEL[run.status]}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-muted">{formatWhen(run.createdAt)}</span>
                  </span>
                  <span className="text-[12px] text-ink-muted">{VALUATION_SIGN_OFF_LABEL[run.signOff]}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </div>
  );
}
