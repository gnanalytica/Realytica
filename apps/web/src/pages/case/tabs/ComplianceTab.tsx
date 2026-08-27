import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  Filter,
  HelpCircle,
  Landmark,
  Library,
  MapPinned,
  Receipt,
  ScrollText,
  XCircle,
} from 'lucide-react';
import { SITE_CONSTRAINT_KEYS } from '@realytica/shared';
import type { ComplianceCheck, ComplianceVerdict, EvidenceItem } from '@realytica/shared';
import { CostWaterfallChart } from '../../../components/charts';
import type { TabProps } from '../tab-props';
import { WaterExposureCard } from '../../../components/WaterExposureCard';
import { SiteConstraintsCard } from '../../../components/SiteConstraintsCard';
import { StatutoryProvenance } from '../../../components/StatutoryProvenance';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { Prose, SplitProse } from '../../../components/ui/prose';
import { PlaybookPanel } from '../../../components/PlaybookPanel';
import { money, pct } from '../../../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ProgressBar,
  Stat,
  TONE_ICON,
  Toggle,
  cn,
  toneChip,
  type Tone,
} from '../../../components/ui/kit';

/* ------------------------------------------------------------------ */
/* Verdict presentation                                                */
/* ------------------------------------------------------------------ */

const VERDICT_TONE: Record<ComplianceVerdict, Tone> = {
  clear: 'good',
  attention: 'warning',
  blocker: 'critical',
  unknown: 'neutral',
};

const VERDICT_TEXT: Record<ComplianceVerdict, string> = {
  clear: 'Clear',
  attention: 'Attention',
  blocker: 'Blocker',
  unknown: 'Unknown',
};

const VERDICT_RANK: Record<ComplianceVerdict, number> = { blocker: 0, attention: 1, unknown: 2, clear: 3 };

type RestFilter = 'all' | 'attention' | 'unknown' | 'clear';



function complianceBand(score: number, blockerCount: number): { label: string; tone: Tone } {
  if (blockerCount > 0) {
    return { label: `${blockerCount} blocker${blockerCount === 1 ? '' : 's'} — do not proceed yet`, tone: 'critical' };
  }
  if (score >= 85) return { label: 'Clear to proceed', tone: 'good' };
  if (score >= 60) return { label: 'Proceed with caution', tone: 'warning' };
  return { label: 'Material concerns', tone: 'serious' };
}

/** Small, dense two-column block used for Consequence / Next step inside a check card. */
function InfoBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-lg bg-sunken p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      <Prose size="sm">{children}</Prose>
    </div>
  );
}

/**
 * One check, with its finding always visible and its working behind a click.
 *
 * The finding is the answer and is never collapsed. The consequence, the next
 * step and the evidence trail are what a reader opens when this particular
 * check is the one they care about — and reading all of them for all fourteen
 * checks is not a thing anyone does, which is what made this view ten
 * thousand pixels long.
 *
 * A blocker ignores all of that and renders open. Somebody scrolling past a
 * collapsed blocker has been failed by the interface.
 */
function ComplianceCheckCard({
  check,
  emphasize,
  evidence,
  onOpenEvidence,
  onJumpToRisks,
}: {
  check: ComplianceCheck;
  emphasize?: boolean;
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  onJumpToRisks: () => void;
}) {
  const tone = VERDICT_TONE[check.verdict];
  const Icon = TONE_ICON[tone];
  const alwaysOpen = check.verdict === 'blocker';
  const [open, setOpen] = useState(alwaysOpen);
  const expanded = alwaysOpen || open;
  return (
    <Card className={cn(emphasize && 'ring-2 ring-critical/50')}>
      <CardBody className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={tone} icon={<Icon size={11} />}>
            {VERDICT_TEXT[check.verdict]}
          </Badge>
          <span className="text-[13px] font-semibold text-ink">{check.label}</span>
          <span
            className="ml-auto rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
            title="Governing statute / rule"
          >
            {check.statute}
          </span>
        </div>
        {/*
          * The finding is a claim, not a paragraph.
          *
          * `SplitProse` takes its first sentence as the scannable line and
          * folds the rest. Fourteen checks used to be fourteen paragraphs;
          * they are now fourteen claims, and a reader opens the two they care
          * about. A blocker renders open, because scrolling past a folded
          * blocker would be this interface's fault.
          */}
        <SplitProse text={check.finding} tone={alwaysOpen ? 'critical' : undefined} alwaysOpen={alwaysOpen} />

        {expanded ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <InfoBlock title="Consequence">{check.consequence}</InfoBlock>
              <InfoBlock title="Next step">{check.nextStep}</InfoBlock>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5">
              <EvidenceLink ids={check.evidenceIds} evidence={evidence} onOpen={onOpenEvidence} />
              {check.relatedRiskIds.length > 0 ? (
                <Button variant="ghost" size="sm" icon={<ArrowRight size={13} />} onClick={onJumpToRisks}>
                  {check.relatedRiskIds.length} related risk{check.relatedRiskIds.length === 1 ? '' : 's'}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        {!alwaysOpen && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 self-start text-[12px] font-medium text-brand hover:underline"
          >
            {open ? 'Less' : 'Consequence, next step and evidence'}
            <ChevronDown size={12} className={cn('transition-transform duration-base', open && 'rotate-180')} />
          </button>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export default function ComplianceTab({ caseData, result, refresh, runScreen, running, goToTab }: TabProps) {
  const navigate = useNavigate();
  const [restFilter, setRestFilter] = useState<RestFilter>('all');
  const [hideClear, setHideClear] = useState(false);

  const openEvidence = (ids: string[]) => {
    navigate(`/cases/${caseData.id}/evidence?evidence=${encodeURIComponent(ids.join(','))}`);
  };

  const compliance = result?.stateCompliance ?? null;
  const costs = result?.transactionCosts ?? null;

  const counts = useMemo(() => {
    const c: Record<ComplianceVerdict, number> = { clear: 0, attention: 0, blocker: 0, unknown: 0 };
    if (!compliance) return c;
    for (const check of compliance.checks) c[check.verdict] += 1;
    return c;
  }, [compliance]);

  const blockers = useMemo(
    () => (compliance ? compliance.checks.filter((c) => c.verdict === 'blocker') : []),
    [compliance],
  );

  // Blockers always render in their own group above and are never hidden by the
  // filters below — a filter is a convenience for browsing routine checks, not
  // a way to make a blocking title issue disappear.
  const rest = useMemo(() => {
    if (!compliance) return [];
    return compliance.checks
      .filter((c) => c.verdict !== 'blocker')
      .filter((c) => restFilter === 'all' || c.verdict === restFilter)
      .filter((c) => !(hideClear && c.verdict === 'clear'))
      .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
  }, [compliance, restFilter, hideClear]);

  const unresolved = useMemo(() => {
    if (!compliance) return [];
    return compliance.unresolved.map((keyOrLabel) => {
      const match = compliance.checks.find((c) => c.key === keyOrLabel || c.label === keyOrLabel);
      return { text: match ? match.label : keyOrLabel, check: match ?? null };
    });
  }, [compliance]);

  if (!result) {
    return (
      <EmptyState
        icon={<ScrollText size={28} />}
        title="Not screened yet"
        description="Run the screen to surface state-specific title compliance — khata classification, land conversion, buffer distances and RERA registration — each with a plain-language finding, consequence and next step."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  if (!compliance) {
    const stateName = caseData.identity.state || 'this property’s state';
    return (
      <Card>
        <CardHeader title="Compliance" icon={<ScrollText size={16} />} />
        <CardBody>
          <EmptyState
            icon={<MapPinned size={28} />}
            title={`No State Pack covers ${stateName} yet`}
            description={
              <>
                Realytica&rsquo;s state-specific title and compliance checks — khata classification, land conversion,
                buffer distances, stamp duty — are built state by state. <strong className="text-ink">Karnataka /
                Bengaluru</strong> is the covered State / Municipality Pack in this release; {stateName} does not yet
                have one. The general risk, valuation, planning and completeness checks in the other tabs still apply
                to this case.
              </>
            }
          />
        </CardBody>
      </Card>
    );
  }

  const band = complianceBand(compliance.score, blockers.length);
  const filtersActive = restFilter !== 'all' || hideClear;
  // Playbooks sit above the individual checks. A check answers "is this one
  // thing in order"; a playbook answers "where am I in the procedure, and what
  // can I not yet ask" — which is what a user opening this tab actually wants
  // to know first.
  const playbooks = result.playbooks ?? [];
  // Site constraints live in their own view now; the count of unanswered ones
  // still belongs here, because this is where a reader meets the findings
  // that answering them would resolve.
  const unansweredConstraints = compliance.checks.filter(
    (c) => c.verdict === 'unknown' && (SITE_CONSTRAINT_KEYS as string[]).includes(c.key),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card>
        <CardHeader
          title={`${compliance.state} title & compliance screen`}
          subtitle="A documentary title screen, not a legal opinion or certified title report"
          icon={<ScrollText size={16} />}
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm flex-1">
              <ProgressBar value={compliance.score} tone={band.tone} label="Compliance score" />
              <Badge tone={band.tone} className="mt-2">
                {band.label}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Clear" value={counts.clear} tone="good" />
              <Stat label="Attention" value={counts.attention} tone="warning" />
              <Stat label="Blocker" value={counts.blocker} tone="critical" />
              <Stat label="Unknown" value={counts.unknown} tone="neutral" />
            </div>
          </div>
          <StatutoryProvenance
            asOf={compliance.rulesAsOf}
            source={`${compliance.state} State Pack — ${compliance.statePackId}`}
            verifyNote={compliance.verifyNote}
          />

          {/*
            * The registries these checks are written against.
            *
            * This list existed on the State Pack from the start and reached
            * only the agent layer — the one audience it was written for, the
            * person deciding whether to trust the output, never saw it. It
            * earns its place by what it excludes as much as by what it names:
            * a reader who knows the checks are written against Kaveri, Bhoomi
            * and the BBMP roll also knows what is not in them.
            */}
          {compliance.datasets && compliance.datasets.length > 0 && (
            /*
              * Folded. This list earns its place — a reader who knows the
              * checks are written against Kaveri, Bhoomi and the BBMP roll
              * also knows what is *not* in them — but it is context, and it
              * was sitting above every finding on the page demanding to be
              * read first.
              */
            <details className="rounded-lg bg-sunken p-3 print-open group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <Library size={12} /> Registries these checks are written against
                <span className="font-normal normal-case tracking-normal text-ink-faint">({compliance.datasets.length})</span>
                <ChevronDown size={11} className="ml-auto transition-transform duration-base group-open:rotate-180" />
              </summary>
              <ul className="m-0 mt-1.5 grid list-none gap-x-4 gap-y-1 p-0 sm:grid-cols-2">
                {compliance.datasets.map((dataset) => (
                  <li key={dataset} className="text-[12px] leading-snug text-ink-secondary">
                    {dataset}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-2 text-[12px] leading-relaxed text-ink-muted">
                These are the records the checks above are written against, not records this screen has queried live. A
                check reported as clear is clear on what you supplied — it is not the result of a search of these
                registries.
              </p>
            </details>
          )}
        </CardBody>
      </Card>

      {/*
        * The declaration form moved to its own view. A reader who has just
        * met five findings saying "nobody has looked at this" is exactly the
        * person who can answer them, so the link stays here and stays loud —
        * a form nobody can find is a form nobody fills in.
        */}
      {unansweredConstraints > 0 && (
        <Callout tone="warning" title={`${unansweredConstraints} site constraint${unansweredConstraints === 1 ? '' : 's'} nobody has answered`}>
          <p>
            Drain and lake buffers, tank beds, high-tension lines, heritage and aerodrome height are not in any deed.
            Until someone answers them they are reported as unknown, which is what they are — not as clear.
          </p>
          <Button variant="secondary" size="sm" className="mt-2" icon={<ArrowRight size={13} />} onClick={() => goToTab('legal?view=constraints')}>
            Answer them
          </Button>
        </Callout>
      )}

      {playbooks.length > 0 && <PlaybookPanel runs={playbooks} />}

      {/* Blockers first — never sorted below routine checks */}
      {blockers.length > 0 ? (
        <Card className="ring-2 ring-critical/50">
          <CardHeader
            title={`${blockers.length} blocker${blockers.length === 1 ? '' : 's'} found`}
            subtitle="Resolve these before spending on lawyers, a survey or a loan application"
            icon={<XCircle size={16} className="text-critical" />}
          />
          <CardBody className="flex flex-col gap-3">
            <Callout tone="critical" title="These stop a clean transaction under current Karnataka rules" collapsible>
              A blocker is a finding severe enough to jeopardise financing, resale or registration outright — for
              example a B-khata classification or unconverted agricultural land. Get professional advice on each one
              before committing further time or money.
            </Callout>
            {blockers.map((check) => (
              <ComplianceCheckCard
                key={check.key}
                check={check}
                emphasize
                evidence={result.evidence}
                onOpenEvidence={openEvidence}
                onJumpToRisks={() => goToTab('risks')}
              />
            ))}
          </CardBody>
        </Card>
      ) : (
        <Callout tone="good" title="No blockers found">
          None of the applicable Karnataka title checks came back as a hard blocker. Review the checks below — an
          &ldquo;attention&rdquo; or &ldquo;unknown&rdquo; verdict can still be material.
        </Callout>
      )}

      {/* Unresolved checks — uncertainty must be visible, not buried */}
      <Card>
        <CardHeader
          title="Unresolved checks"
          subtitle="What the screen could not answer from what has been supplied so far"
          icon={<HelpCircle size={16} />}
        />
        <CardBody>
          {unresolved.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">Every applicable Karnataka check could be resolved one way or another.</p>
          ) : (
            <>
            <ul className="flex flex-col gap-2">
              {unresolved.map((u, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-2 rounded-lg bg-sunken p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{u.text}</p>
                    {/*
                      * The headline, not the finding. Five of these checks
                      * share one word-identical sentence — "Nothing on file
                      * says either way, and nothing in the title documents
                      * ever will" — so printing the finding here restated the
                      * same thing five times over. It is said once, in the
                      * note below the list, and each row keeps only what is
                      * true of it alone.
                      */}
                    {u.check ? <p className="mt-0.5 text-xs text-ink-secondary">{u.check.headline}</p> : null}
                  </div>
                  {/*
                    * The action has to match what would actually resolve the
                    * check. Every row used to offer "Supply documents",
                    * including the six statutory constraints that no document
                    * in the seller's possession can answer — a button that
                    * sends the reader to upload a file which does not exist.
                    * Those rows name the authority search instead.
                    */}
                  {u.check && (SITE_CONSTRAINT_KEYS as string[]).includes(u.check.key) ? (
                    <Badge tone="neutral" icon={<Landmark size={11} />} className="shrink-0">
                      Needs an authority search
                    </Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      icon={<ArrowRight size={13} />}
                      onClick={() => goToTab('documents')}
                    >
                      Supply documents
                    </Button>
                  )}
                </li>
              ))}
            </ul>
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                Most of these are not gaps in the paperwork. A transmission corridor, a highway building line, a railway
                setback, a burial ground and a quarrying lease are recorded by their own authorities and appear in no
                deed — no document the seller can hand over will answer them.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      {/* Filters + remaining checks — hidden entirely when every check is already a blocker above */}
      {compliance.checks.length > blockers.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              * The distribution and the filter are the same control.
              *
              * A dropdown reading "All verdicts" shows nothing — the reader
              * still has to count the rows to learn that ten of seventeen
              * checks are clear and five were never searched. A proportional
              * bar says that at a glance and filters on click, so one line of
              * chrome does the work the dropdown and a summary would have
              * needed two for.
              */}
            <VerdictBar counts={counts} active={restFilter} onSelect={setRestFilter} />
            <Toggle checked={hideClear} onChange={setHideClear} label="Hide clear checks" size="sm" />
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRestFilter('all');
                  setHideClear(false);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          {rest.length === 0 ? (
            <EmptyState
              icon={<Filter size={24} />}
              title="No checks match these filters"
              description="Try widening the verdict filter or turning off “hide clear checks”."
            />
          ) : (
            /*
              * A table, not fourteen cards.
              *
              * Fourteen checks rendered as fourteen cards was three quarters
              * of this view's word count and the thing that made it read like
              * somebody's notes: every check demanded a paragraph of
              * attention whether or not it had anything wrong with it. Ten of
              * them are clear.
              *
              * A row per check — verdict, name, statute, one line — scans in
              * seconds, and the one you care about opens in place with the
              * consequence, the next step and the evidence trail intact.
              * Nothing was removed; the reading order was.
              */
            <CheckTable
              checks={rest}
              evidence={result.evidence}
              onOpenEvidence={openEvidence}
              onJumpToRisks={() => goToTab('risks')}
            />
          )}
        </>
      ) : null}

    </div>
  );
}

/**
 * The check list as a scannable table.
 *
 * One row per check, sorted worst-first by the caller. The finding's first
 * sentence is the row's own text — enough to know whether this is the check
 * you came for — and the row expands in place to the full card rather than
 * navigating anywhere.
 *
 * Verdict is a chip *and* a word, never colour alone.
 */
function CheckTable({
  checks,
  evidence,
  onOpenEvidence,
  onJumpToRisks,
}: {
  checks: ComplianceCheck[];
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  onJumpToRisks: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-[var(--ring)]">
      {checks.map((check) => {
        const tone = VERDICT_TONE[check.verdict];
        const Icon = TONE_ICON[tone];
        const open = openKey === check.key;
        return (
          <div key={check.key} className="border-b border-hairline last:border-0">
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : check.key)}
              className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-sunken/60"
            >
              <Badge tone={tone} icon={<Icon size={11} />} className="mt-px shrink-0">
                {VERDICT_TEXT[check.verdict]}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{check.label}</span>
                {/*
                  * One line, written as one line.
                  *
                  * This used to clamp the finding's first sentence to two
                  * rows, which is a cut sentence rather than a short one. The
                  * engine now states the answer in under eight words —
                  * "A-khata", "Not searched", "Super built-up — rate
                  * optimistic 25-35%" — and for most checks that is the whole
                  * of what a reader needs.
                  */}
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{check.headline}</span>
              </span>
              {/*
                * Bounded and truncated. Some statutes cite three Acts —
                * "Karnataka Town and Country Planning Act 1961, ss.17 & 32;
                * Bangalore Development Authority Act 1976; …" — and an
                * unbounded `shrink-0` chip took the whole row, squeezing the
                * check's own label into a one-word column and running off the
                * card. The full citation is on hover and in the expanded body.
                */}
              <span
                className="hidden max-w-[210px] shrink-0 truncate rounded bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-secondary sm:inline"
                title={check.statute}
              >
                {check.statute}
              </span>
              <ChevronDown
                size={14}
                className={cn('mt-1 shrink-0 text-ink-faint transition-transform duration-base', open && 'rotate-180')}
              />
            </button>
            {open && (
              <div className="border-t border-hairline bg-sunken/40 px-3.5 py-3">
                {/* The full finding — the row header carries only the
                    headline now, so nothing here repeats it. */}
                <SplitProse text={check.finding} alwaysOpen />
                {/* The citation in full — the row's chip truncates it, and a
                    tooltip is not where a statutory reference should live. */}
                <p className="m-0 mt-1.5 font-mono text-[10.5px] leading-relaxed text-ink-muted">{check.statute}</p>
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  <InfoBlock title="Consequence">{check.consequence}</InfoBlock>
                  <InfoBlock title="Next step">{check.nextStep}</InfoBlock>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5">
                  <EvidenceLink ids={check.evidenceIds} evidence={evidence} onOpen={onOpenEvidence} />
                  {check.relatedRiskIds.length > 0 ? (
                    <Button variant="ghost" size="sm" icon={<ArrowRight size={13} />} onClick={onJumpToRisks}>
                      {check.relatedRiskIds.length} related risk{check.relatedRiskIds.length === 1 ? '' : 's'}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


/** Verdict order, worst first — fixed, so a segment never moves between cases. */
const VERDICT_ORDER: ComplianceVerdict[] = ['blocker', 'attention', 'unknown', 'clear'];
const VERDICT_LABEL: Record<ComplianceVerdict, string> = {
  blocker: 'Blocker',
  attention: 'Attention',
  unknown: 'Unknown',
  clear: 'Clear',
};

/**
 * How the checks came out, as a bar you can click.
 *
 * Status colour is doing real work here — a verdict *means* good or bad — so
 * this is one of the few places the palette's status tokens belong. It never
 * carries the meaning alone: every segment shows its count and its word, and
 * the selected one is marked by a ring rather than by a change of hue.
 *
 * Segments keep a fixed worst-first order and a minimum width, so a single
 * blocker among sixteen clear checks is still a target you can hit rather
 * than a two-pixel sliver.
 */
function VerdictBar({
  counts,
  active,
  onSelect,
}: {
  counts: Record<ComplianceVerdict, number>;
  active: RestFilter;
  onSelect: (v: RestFilter) => void;
}) {
  const present = VERDICT_ORDER.filter((v) => counts[v] > 0);
  const total = present.reduce((sum, v) => sum + counts[v], 0);
  if (total === 0) return null;

  return (
    <div className="flex min-w-[280px] flex-1 flex-wrap gap-0.5" role="group" aria-label="Filter by verdict">
      {present.map((v) => {
        const Icon = TONE_ICON[VERDICT_TONE[v]];
        const share = counts[v] / total;
        const body = (
          <>
            <Icon size={12} className="shrink-0" aria-hidden="true" />
            <span className="font-mono text-[13px] tabular-nums">{counts[v]}</span>
            <span className="whitespace-nowrap">{VERDICT_LABEL[v]}</span>
          </>
        );
        const shape = cn(
          'flex min-w-[124px] basis-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors',
          toneChip(VERDICT_TONE[v]),
        );
        const grow = { flexGrow: Math.max(share, 0.12) };

        // Blockers are not a filter. They render in their own group above and
        // are deliberately exempt from every filter on this view — offering a
        // control that appears to hide them would be the one filter this
        // screen must not have.
        if (v === 'blocker') {
          return (
            <span key={v} style={grow} className={shape} title="Blockers always show in their own group above">
              {body}
            </span>
          );
        }
        const on = active === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onSelect(on ? 'all' : v)}
            aria-pressed={on}
            title={`${counts[v]} ${VERDICT_LABEL[v].toLowerCase()} — click to ${on ? 'clear the filter' : 'show only these'}`}
            style={grow}
            className={cn(shape, on ? 'ring-2 ring-[var(--focus)]' : 'hover:brightness-[0.97]')}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
