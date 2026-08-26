import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Building2, Landmark, MapPin } from 'lucide-react';
import type { PlanningPosition } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { area, date, num, relativeTime, titleCase } from '../../../lib/format';
import { formatArea, useAreaUnitFor } from '../../../lib/units';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, KeyValue } from '../../../components/ui/kit';
import type { Tone } from '../../../components/ui/kit';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { SchematicYieldCard } from '../../../components/SchematicYieldCard';

type DevelopmentPotential = PlanningPosition['developmentPotential'];

const POTENTIAL_TONE: Record<DevelopmentPotential, Tone> = {
  none: 'neutral',
  limited: 'warning',
  moderate: 'info',
  significant: 'good',
};

const POTENTIAL_INTERPRETATION: Record<DevelopmentPotential, string> = {
  none: 'No meaningful headroom beyond the current use under current zoning — do not underwrite this deal on upside you cannot build.',
  limited: 'Some headroom exists, but constraints keep the upside modest — treat it as a bonus, not the thesis.',
  moderate: 'Clear headroom under current rules — worth investigating a redevelopment or extension angle before you finalise a view.',
  significant: 'Substantial undeveloped potential relative to the current use — this could materially change the investment case.',
};

const STALE_AFTER_DAYS = 180;

export default function PlanningTab({ caseData, result, runScreen, running, goToTab }: TabProps) {
  const navigate = useNavigate();
  const areaUnit = useAreaUnitFor(caseData.identity.country);

  if (!result) {
    return (
      <EmptyState
        icon={<Building2 size={28} />}
        title="Not screened yet"
        description="Run the screen to see zoning, permitted uses, FAR headroom and the indicative development potential for this property."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  const planning = result.planning;
  const potentialTone = POTENTIAL_TONE[planning.developmentPotential];
  const overUtilised = planning.farUsed > planning.farAllowed;
  const utilisationPct = planning.farAllowed > 0 ? Math.min(100, (planning.farUsed / planning.farAllowed) * 100) : 0;
  const headroomFar = planning.farAllowed - planning.farUsed;

  const daysSinceCheck = Math.floor((Date.now() - new Date(planning.lastCheckedAt).getTime()) / 86_400_000);
  const isStale = Number.isFinite(daysSinceCheck) && daysSinceCheck > STALE_AFTER_DAYS;

  const openEvidence = (ids: string[]) => {
    navigate(`/cases/${caseData.id}/evidence?evidence=${encodeURIComponent(ids.join(','))}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/*
        * The yield leads, where there is one.
        *
        * "Development potential: significant" is a judgement; the yield is
        * the arithmetic behind it, and it names the FAR that actually
        * applies. A reader who sees the judgement first has formed a view
        * before meeting the constraint that decides it.
        */}
      {result.yield && <SchematicYieldCard yieldResult={result.yield} country={caseData.identity.country} />}

      <Card>
        <CardHeader title="Development potential" icon={<Building2 size={16} />} />
        <CardBody className="flex flex-col gap-2">
          <Badge tone={potentialTone} className="w-fit !text-[13px] !px-2.5 !py-1">
            {titleCase(planning.developmentPotential)}
          </Badge>
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {POTENTIAL_INTERPRETATION[planning.developmentPotential]}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="FAR utilisation"
          subtitle="Floor Area Ratio used against what is allowed under current zoning"
          icon={<Landmark size={16} />}
        />
        <CardBody className="flex flex-col gap-3">
          {overUtilised ? (
            <>
              <Callout tone="critical" title="FAR exceeded">
                Built FAR of {num(planning.farUsed, 2)} is {num(planning.farUsed - planning.farAllowed, 2)} points above
                the {num(planning.farAllowed, 2)} allowed under current zoning. This can indicate unauthorised
                construction — verify with the municipality before proceeding.
              </Callout>
              <div
                role="img"
                aria-label={`FAR over-utilised: ${num(planning.farUsed, 2)} used against ${num(planning.farAllowed, 2)} allowed`}
                className="h-3 w-full overflow-hidden rounded-full bg-critical/15 ring-1 ring-inset ring-critical/30"
              >
                <div className="h-full w-full rounded-full bg-critical" />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink-secondary">FAR used</span>
                <span className="tabular font-medium text-ink">
                  {num(planning.farUsed, 2)} of {num(planning.farAllowed, 2)} allowed
                </span>
              </div>
              <div
                role="img"
                aria-label={`FAR utilised: ${num(planning.farUsed, 2)} of ${num(planning.farAllowed, 2)} allowed`}
                className="h-3 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]"
              >
                <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${utilisationPct}%` }} />
              </div>
              <p className="text-xs leading-relaxed text-ink-secondary">
                Headroom: <strong className="text-ink">{num(headroomFar, 2)} FAR points</strong> —{' '}
                {planning.buildablePotentialSqm > 0 ? (
                  <>
                    approximately <strong className="text-ink">{formatArea(planning.buildablePotentialSqm, areaUnit)}</strong> of
                    additional buildable area.
                  </>
                ) : (
                  <>no additional buildable area under the current FAR.</>
                )}
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Zoning & permitted uses" icon={<MapPin size={16} />} />
        <CardBody className="flex flex-col gap-3">
          <KeyValue label="Zoning" value={planning.zoning} />
          {planning.permittedUses.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {planning.permittedUses.map((use) => (
                <Badge key={use} tone="neutral">
                  {use}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">No permitted uses on record.</p>
          )}
          {planning.restrictions.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Restrictions</p>
              <ul className="flex flex-col gap-1.5">
                {planning.restrictions.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-ink-secondary">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Planning position notes" icon={<Landmark size={16} />} />
        <CardBody className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-ink-secondary">{planning.statusNote}</p>
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-3 sm:flex-row sm:items-center sm:justify-between">
            <KeyValue label="Source" value={planning.source} />
          </div>
          <KeyValue
            label="Last checked"
            value={`${date(planning.lastCheckedAt)} (${relativeTime(planning.lastCheckedAt)})`}
          />
          <Callout tone={isStale ? 'warning' : 'neutral'} title="Planning data ages">
            Planning positions are pulled from a municipality pack at a point in time — re-check with the local
            planning authority before making or finalising an offer, especially if this check is more than a few
            months old.
          </Callout>
          <div>
            <EvidenceLink ids={planning.evidenceIds} evidence={result.evidence} onOpen={openEvidence} />
          </div>
        </CardBody>
      </Card>

      <Callout tone="info" title="Indicative, not certified">
        This planning position is an indicative read from a municipality data pack, not a formal planning certificate
        and not a full project feasibility study — both are out of scope for Property Screen. Commission a formal
        planning check and, if pursuing development, a feasibility study before committing capital.
      </Callout>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => goToTab('actions')}>
          See what to resolve before proceeding
        </Button>
      </div>
    </div>
  );
}
