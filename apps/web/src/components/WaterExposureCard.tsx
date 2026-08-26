import { Droplets, Waves } from 'lucide-react';
import type { FloodExposure, WaterExposureReference } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader } from './ui/kit';
import type { Tone } from './ui/kit';

/**
 * Where this property sits in Bengaluru's drainage, and how exposed that
 * position is.
 *
 * The one thing this card must never let a reader take away is that it
 * describes their parcel. It describes a catchment: a site on high ground in
 * Bellandur does not flood because Bellandur floods, and a site on a filled
 * tank bed in low-exposure Jayanagar may flood every year. The caveat is
 * therefore not a footnote — it sits directly under the grade, before the
 * detail, because a reader who stops after the badge must still have read it.
 */

const EXPOSURE_TONE: Record<FloodExposure, Tone> = { low: 'good', moderate: 'warning', high: 'critical' };
const EXPOSURE_LABEL: Record<FloodExposure, string> = {
  low: 'Low exposure',
  moderate: 'Moderate exposure',
  high: 'High exposure',
};

const VALLEY_LABEL: Record<WaterExposureReference['valley'], string> = {
  vrishabhavathi: 'Vrishabhavathi valley',
  koramangala_challaghatta: 'Koramangala–Challaghatta valley',
  hebbal_nagavara: 'Hebbal–Nagavara valley',
};

export function WaterExposureCard({ water, locality }: { water: WaterExposureReference; locality: string }) {
  return (
    <Card>
      <CardHeader
        title="Water, drains and flooding"
        subtitle={`${locality} drains through the ${VALLEY_LABEL[water.valley]}`}
        icon={<Waves size={16} />}
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={EXPOSURE_TONE[water.floodExposure]}>{EXPOSURE_LABEL[water.floodExposure]}</Badge>
          <span className="text-[12px] text-ink-muted">{water.lakeChain}</span>
        </div>

        <Callout tone="info" title="This describes the locality, not this parcel">
          A site on high ground in a high-exposure locality does not flood, and a site on a filled tank bed in a
          low-exposure one may flood every year. Take the levels for this survey number against the nearest drain and
          ask the neighbours what the last two monsoons did — that is the only thing that answers it for this property.
        </Callout>

        <p className="m-0 text-[13px] leading-relaxed text-ink-secondary">{water.note}</p>

        {water.knownInundationPoints.length > 0 && (
          <div>
            <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <Droplets size={12} /> Reported inundation in this locality
            </h4>
            <p className="m-0 text-[13px] leading-relaxed text-ink-secondary">{water.knownInundationPoints.join(' · ')}</p>
          </div>
        )}

        <div className="rounded-lg bg-sunken p-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Where this comes from</p>
          <p className="m-0 mt-1 text-[12px] leading-relaxed text-ink-secondary">
            {water.source}. Carried as of {water.asOf}.
          </p>
          <p className="m-0 mt-1.5 text-[12px] leading-relaxed text-ink-secondary">{water.verifyNote}</p>
        </div>
      </CardBody>
    </Card>
  );
}
