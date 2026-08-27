import { Waves } from 'lucide-react';
import { SITE_CONSTRAINT_KEYS } from '@realytica/shared';
import type { ComplianceCheck } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { WaterExposureCard } from '../../../components/WaterExposureCard';
import { SiteConstraintsCard } from '../../../components/SiteConstraintsCard';
import { Button, Callout, EmptyState } from '../../../components/ui/kit';

/**
 * What restricts this site beyond anything a deed will say.
 *
 * Split out of the compliance view. Two things had been stacked there that
 * are not the same activity: reading findings, and answering the questions
 * that produce them. The declaration form is long — it asks about drain
 * buffers, lake proximity, tank beds, high-tension lines, heritage and
 * aerodrome height — and sitting it in the middle of the check list meant a
 * reader browsing findings had to scroll through a form, and a reader filling
 * in the form had to scroll through findings to reach the rest of it.
 *
 * Water sits here rather than with the checks for the same reason it used to
 * sit above them: the buffer question asks whether this parcel abuts a drain
 * or a lake, and the exposure question asks what happens to the water once it
 * does. They are one question at two scales, and separating them would let a
 * reader clear the first without ever meeting the second.
 */

/**
 * Checks produced by a constraint declaration, so this view can show its own
 * output. Matched against the exact key list rather than a prefix: the checks
 * are keyed by the pack rule's key, and a prefix match would be a guess that
 * silently stops working the day a pack adds a rule.
 */
function isConstraintCheck(check: ComplianceCheck): boolean {
  return (SITE_CONSTRAINT_KEYS as string[]).includes(check.key);
}

export default function ConstraintsTab({ caseData, result, refresh, runScreen, running }: TabProps) {
  const compliance = result?.stateCompliance ?? null;

  if (!result) {
    return (
      <EmptyState
        icon={<Waves size={28} />}
        title="Not screened yet"
        description="Run the screen to see what restricts this site beyond title — drain and lake buffers, tank beds, high-tension lines, heritage precincts and aerodrome height limits."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  if (!compliance) {
    return (
      <EmptyState
        icon={<Waves size={28} />}
        title="No State Pack covers this property's state yet"
        description="Statutory site constraints — buffer distances, tank beds, height limits — are defined per state. Karnataka / Bengaluru is the covered pack in this release."
      />
    );
  }

  const answered = compliance.checks.filter(isConstraintCheck);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {result.waterExposure ? (
        <WaterExposureCard water={result.waterExposure} locality={caseData.identity.locality} />
      ) : (
        /* An unassessed locality and a safe one must not read the same — the
           engine records this gap as evidence, and this is where a reader
           looking for flooding actually looks. */
        <Callout tone="neutral" title="Water, drains and flooding — not assessed">
          No flood or lake-catchment classification is carried for {caseData.identity.locality} yet, so this property's exposure to the
          storm-water network has not been looked at. That is a gap in this product's coverage, not a finding that the site is clear —
          check the locality's flooding history and the revenue map's drain alignments before pricing it as unexposed.
        </Callout>
      )}

      <SiteConstraintsCard caseData={caseData} checks={compliance.checks} refresh={refresh} />

      {answered.length === 0 && (
        <Callout tone="neutral" title="Nothing declared yet">
          None of these constraints has been answered for this site. That is not the same as none of them applying —
          an unanswered constraint is an unknown, and it is reported as one on the compliance checks rather than
          treated as clear.
        </Callout>
      )}
    </div>
  );
}
