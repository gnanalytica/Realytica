import { Handshake } from 'lucide-react';
import type { JdSplitAssessment, JdSplitVerdict } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, StatTile } from './ui/kit';
import type { Tone } from './ui/kit';
import { money, pct } from '../lib/format';
import { EvidenceLink } from './EvidenceLink';
import type { EvidenceItem } from '@realytica/shared';

/**
 * The JDA's ratio, read as the land price it implies.
 *
 * The verdict tones deliberately do not map good/bad onto the parties: a
 * below-band ratio is amber for whoever reads it, because which side of the
 * table the reader sits on is not something this card knows. What it must
 * never do is congratulate a developer on the same fact it warns a
 * landowner about.
 */
const VERDICT_META: Record<JdSplitVerdict, { label: string; tone: Tone }> = {
  developer_favoured: { label: 'Below the land-value band', tone: 'warning' },
  balanced: { label: 'Consistent with the land value', tone: 'good' },
  landowner_favoured: { label: 'Above the land-value band', tone: 'warning' },
};

export function JdSplitCard({ split, evidence }: { split: JdSplitAssessment; evidence: EvidenceItem[] }) {
  const meta = VERDICT_META[split.verdict];
  return (
    <Card>
      <CardHeader
        title="The sharing ratio, as a land price"
        subtitle="Arithmetic on the screen's own figures — the scheme's gross realisation and the land-rate band. Not a new opinion of value."
        icon={<Handshake size={16} />}
        action={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Landowner's share" value={pct(split.offeredOwnerSharePct, 1)} hint="As the JDA states it" tone="brand" />
          <StatTile label="That share is worth" value={money(split.offeredShareValue, split.currency)} hint="Of the scheme's gross realisation" />
          <StatTile
            label="Land-value band"
            value={`${pct(split.fairSharePctLow, 1)}–${pct(split.fairSharePctHigh, 1)}`}
            hint="The share the land's own value would justify"
          />
          <StatTile label="Scheme gross" value={money(split.schemeGrossValue, split.currency)} hint="From the residual's own arithmetic" />
        </div>
        <div className="flex flex-col gap-2 text-xs leading-relaxed text-ink-secondary">
          {split.statements.map((line, i) => (
            <p key={i}>
              {line}
              {i === 0 && split.evidenceIds.length > 0 ? <EvidenceLink evidence={evidence} ids={split.evidenceIds} /> : null}
            </p>
          ))}
        </div>
        <Callout tone="info" title="What this arithmetic does not price" collapsible>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {split.caveats.map((caveat, i) => (
              <li key={i}>{caveat}</li>
            ))}
          </ul>
        </Callout>
      </CardBody>
    </Card>
  );
}
