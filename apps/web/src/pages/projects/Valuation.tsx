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
  type ValuationSignOff,
  type ValueInputRow,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Disclosure, Select, useToast } from '../../components/ui/kit';
import { ScreenResultPanel } from '../../components/ScreenResultPanel';
import { ValuationWorkingPanel } from '../../components/ValuationWorkingPanel';
import { ValueHeadline, type ValueStatus } from '../../components/value/ValueHeadline';
import { ValueChecks } from '../../components/value/ValueChecks';
import { ValueDrivers } from '../../components/value/ValueDrivers';
import { ValueApproaches, describeSources } from '../../components/value/ValueApproaches';
import { ValueReading, type ReadingStep } from '../../components/value/ValueReading';
import { useValueFill } from '../../components/value/useValueFill';
import { ComparablesRegister } from '../../components/value/ComparablesRegister';
import { useAsync } from '../../lib/useAsync';
import { countryForCurrency } from '../../lib/units';
import { money } from '../../lib/format';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';
import { WorkstreamFrame } from './departments/WorkstreamPage';

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

  async function commit(row: ValueInputRow, value: number | null, cite?: string): Promise<string | null> {
    try {
      if (row.target.kind === 'project') {
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

  const openSource = (evidenceId: string) => (onReviewDocument ?? onOpenCited)?.(evidenceId);

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
        ? 'Checked the title. Every value the file holds is already recorded.'
        : 'Checked the title. The file holds nothing these inputs can be read from yet — file the sale deed, the khata, the plan or a lease, or read the revenue map on the Overview.'
      : `Filled ${fill.progress.total} input${fill.progress.total === 1 ? '' : 's'} from ${describeSources(filled)}.${
          forValuer.length ? ` ${forValuer.join(', ')} ${forValuer.length === 1 ? 'waits' : 'wait'} for a valuer.` : ''
        } Nothing is recorded until you accept.`;

  // During the fill, the checks and drivers arrive with the inputs.
  const share = fill.phase === 'checking' ? 0 : fill.phase === 'filling' ? fill.progress.done / Math.max(1, fill.progress.total) : null;

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
            <p className="mt-0.5 max-w-[70ch] text-[13px] text-ink-secondary">
              Compliance, value and what moves it, from what the file holds — the site, the whole project as is or as completed, or a phase. Indicative until a registered valuer certifies it.
            </p>
          </div>
        </div>
        <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => void valueProperty()} loading={fill.phase === 'checking'} disabled={filling || busy}>
          Value this property
        </Button>
      </div>

      <WorkstreamFrame project={project} workstream="finance.valuation" setProject={setProject} compact />

      {fill.phase !== 'idle' ? <ValueReading phase={fill.phase} steps={steps} summary={readingSummary} onDismiss={fill.reset} /> : null}

      <ValueHeadline
        summary={summary}
        status={status}
        run={latest}
        waiting={filling ? counted.length : waiting.length}
        sources={describeSources(filling ? counted : waiting)}
        busy={busy}
        spreadBasis={working.reconciliation.spreadBasis}
        onAcceptAll={() => void accept(waiting.map((o) => o.id), true)}
        onRecord={() => void record()}
      />

      {readingsWaiting.length ? (
        <p className="text-[12px] text-provenance-ink">
          {readingsWaiting.length === 1
            ? `A reading of ${readingsWaiting[0]!.fact.label.toLowerCase()} is waiting to be accepted on ${readingsWaiting[0]!.evidence.documentType ?? readingsWaiting[0]!.evidence.title}. Until then it is offered to no input here.`
            : `${readingsWaiting.length} readings are waiting to be accepted on the documents. Until then they are offered to no input here.`}
          <button type="button" onClick={() => openSource(readingsWaiting[0]!.evidence.id)} className="ml-1.5 font-medium text-brand underline-offset-2 hover:underline">
            Review
          </button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 [@container(min-width:52rem)]:grid-cols-2">
        <ValueChecks
          checks={checks}
          rule8={rule8}
          revealed={share === null ? null : Math.floor(share * checks.length)}
          screenedAt={screen?.generatedAt}
          state={screen?.stateCompliance?.state}
        />
        <ValueDrivers drivers={drivers} revealed={share === null ? null : Math.floor(share * drivers.length)} />
      </div>

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

      <div className="space-y-2">
        <Disclosure title="The working, line by line">
          <ValuationWorkingPanel working={working} currency={project.currency} />
        </Disclosure>
        {screen ? (
          <Disclosure title="Evidence and confidence">
            <ScreenResultPanel result={screen} only={['evidence']} askingPrice={project.budget} country={countryForCurrency(project.currency)} locality={project.city} />
          </Disclosure>
        ) : null}
        {screen?.transactionCosts ? (
          <Disclosure title="Acquisition costs">
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
                  {run.id === latest?.id ? (
                    <Select aria-label="Sign-off" value={run.signOff} onChange={(e) => void signOff(run.id, e.target.value as ValuationSignOff)} className="h-8 w-auto text-[12px]">
                      {(Object.keys(VALUATION_SIGN_OFF_LABEL) as ValuationSignOff[]).map((k) => (
                        <option key={k} value={k}>
                          {VALUATION_SIGN_OFF_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[12px] text-ink-muted">{VALUATION_SIGN_OFF_LABEL[run.signOff]}</span>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </div>
  );
}
