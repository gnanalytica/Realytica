import { useState } from 'react';
import { Globe, Search } from 'lucide-react';
import type { DisclosureLevel } from '@realytica/shared';
import { DISCLOSURE_LEVELS, resolveDisclosure } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { DisclosureCard } from '../../../components/DisclosureCard';
import { Card, CardBody, CardHeader, EmptyState } from '../../../components/ui/kit';
import { api } from '../../../lib/api';

/**
 * What Realytica has looked for outside itself, and what it is allowed to.
 *
 * The two belong on one page because they are one decision. A reader looking
 * at an empty findings list needs to know whether that means nothing was
 * found or nothing was looked for — and at the default disclosure level the
 * answer is the second, since anything recorded against this specific parcel
 * can only be found by searching for the parcel.
 */
export default function ResearchTab({ caseData, refresh }: TabProps) {
  const [busy, setBusy] = useState(false);
  const level = resolveDisclosure(caseData.disclosure);

  const setDisclosure = async (next: DisclosureLevel) => {
    setBusy(true);
    try {
      await api.setDisclosure(caseData.id, next);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <DisclosureCard level={caseData.disclosure} onChange={setDisclosure} busy={busy} />

      <Card>
        <CardHeader
          title="What has been found"
          subtitle="Public records and reporting about this property, from outside Realytica"
          icon={<Globe size={16} />}
        />
        <CardBody>
          <EmptyState
            icon={<Search size={26} />}
            title="Nothing has been searched for yet"
            description={
              level === 'locality_only'
                ? `At ${DISCLOSURE_LEVELS[level].label.toLowerCase()}, nothing identifying this parcel leaves Realytica — so a search cannot find its RERA registration, a de-notification naming its survey number, or a case listing it. Widen the level above if you want those looked for.`
                : `The level is set to ${DISCLOSURE_LEVELS[level].label.toLowerCase()}, so a search can look for this parcel by its identifiers. Nothing has been run against it yet.`
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}
