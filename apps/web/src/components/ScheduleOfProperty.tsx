import { useMemo } from 'react';
import { Compass } from 'lucide-react';
import type { TitleGraph } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader } from './ui/kit';

/**
 * The schedule of property, as each document states it.
 *
 * In Karnataka conveyancing the schedule — the four abutters and the two
 * dimensions — is how a parcel is *identified*, and it does work no survey
 * number can: numbers get subdivided and renumbered, neighbours do not change
 * when the numbering does. It is also the part of a deed a purchaser is least
 * likely to read, which is exactly why it earns a card of its own rather than
 * a row in a field table.
 *
 * Drawn as a compass rather than a list because that is what a schedule
 * describes — four sides of one piece of land — and because a disagreement
 * between two documents about the north side is instantly visible when both
 * are in the same box, and invisible when they are two rows forty pixels
 * apart.
 *
 * Read from the title graph rather than from the documents directly, so the
 * boundaries shown here are exactly the ones the contradiction detector ran
 * against. A card that read the fields itself could show four tidy boundaries
 * next to a `boundary_mismatch` finding about them.
 */

const SIDES = ['north', 'east', 'south', 'west'] as const;
type Side = (typeof SIDES)[number];

const SIDE_LABEL: Record<Side, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };

/**
 * The same normalisation the graph merges parcels with, so "Sy. No. 118/3"
 * and "Survey Number 118/3" group as one claim here too. Two documents shown
 * as disagreeing over punctuation would be a false alarm on the one card
 * whose whole job is raising a true one.
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\b(survey|sy|s\.y|no|nos|number|bearing)\b/g, '').replace(/[^a-z0-9/]/g, '');
}

/**
 * One thing claimed about one side, and every document that claims it.
 *
 * Grouped by the claim rather than by the document on purpose. Two deeds that
 * agree about the north boundary are one fact, and printing it twice — once
 * per deed — turns four boundaries into eight lines of near-identical text
 * that a reader skims past, which is exactly how the disagreement this card
 * exists to surface would get missed. Sources are named only when there is
 * more than one distinct claim to attribute.
 */
interface SideClaim {
  abutter: string;
  sources: string[];
}

export function ScheduleOfProperty({ graph }: { graph: TitleGraph }) {
  const { bySide, dimensions, disagreeing } = useMemo(() => {
    const bySide = new Map<Side, SideClaim[]>();
    for (const edge of graph.edges) {
      if (edge.kind !== 'describes_boundary') continue;
      const side = edge.attributes?.side;
      const abutter = edge.attributes?.abutter;
      if (typeof side !== 'string' || typeof abutter !== 'string') continue;
      if (!(SIDES as readonly string[]).includes(side)) continue;
      const key = side as Side;
      const sourceLabel = edge.assertedBy[0]?.sourceLabel ?? 'Unknown source';
      const claims = bySide.get(key) ?? [];
      const existing = claims.find(c => normalise(c.abutter) === normalise(abutter));
      if (existing) {
        if (!existing.sources.includes(sourceLabel)) existing.sources.push(sourceLabel);
      } else {
        claims.push({ abutter, sources: [sourceLabel] });
      }
      bySide.set(key, claims);
    }

    // Same grouping for the dimensions: two deeds stating 30 x 40 is one
    // statement about the site, not two.
    const dimensions: { stated: string; sqm?: number; sources: string[] }[] = [];
    for (const e of graph.edges) {
      if (e.kind !== 'asserts_area' || e.attributes?.fieldKey !== 'scheduleDimensions') continue;
      const stated = String(e.attributes?.statedValue ?? '');
      const sourceLabel = e.assertedBy[0]?.sourceLabel ?? 'Unknown source';
      const existing = dimensions.find(d => normalise(d.stated) === normalise(stated));
      if (existing) {
        if (!existing.sources.includes(sourceLabel)) existing.sources.push(sourceLabel);
      } else {
        dimensions.push({ stated, sqm: typeof e.attributes?.areaSqm === 'number' ? e.attributes.areaSqm : undefined, sources: [sourceLabel] });
      }
    }

    const disagreeing = new Set<Side>();
    for (const [side, claims] of bySide) {
      if (claims.length > 1) disagreeing.add(side);
    }

    return { bySide, dimensions, disagreeing };
  }, [graph]);

  if (bySide.size === 0 && dimensions.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Schedule of property"
        subtitle="What the deeds say this land is bounded by, and how big they say it is"
        icon={<Compass size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {SIDES.map(side => {
            const claims = bySide.get(side);
            const conflict = disagreeing.has(side);
            return (
              <div
                key={side}
                className={
                  'rounded-lg border px-3 py-2.5 ' +
                  (conflict ? 'border-serious/45 bg-serious/10' : 'border-hairline bg-sunken')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{SIDE_LABEL[side]}</span>
                  {conflict && <Badge tone="serious">Sources disagree</Badge>}
                </div>
                {claims === undefined ? (
                  <p className="m-0 mt-1 text-[13px] text-ink-muted">Not stated in any document on file.</p>
                ) : (
                  <ul className="m-0 mt-1 list-none space-y-1 p-0">
                    {claims.map(c => (
                      <li key={c.abutter} className="text-[13px] leading-snug text-ink">
                        {c.abutter}
                        {conflict && <span className="block text-[11px] text-ink-muted">per {c.sources.join(' and ')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {dimensions.length > 0 && (
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Dimensions stated</h4>
            <ul className="m-0 list-none space-y-1 p-0">
              {dimensions.map(d => (
                <li key={d.stated} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-ink">{d.stated}</span>
                  <span className="text-[12px] text-ink-muted">
                    {d.sqm !== undefined && <span className="tabular-nums">= {d.sqm.toFixed(1)} sqm </span>}
                    per {d.sources.length > 2 ? `${d.sources.length} documents` : d.sources.join(' and ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              The square-metre figure is this system multiplying the two lengths the deed states — it is a check on the
              deed's own arithmetic, not a separate measurement. Where it disagrees with the extent the deed also states,
              or with the khata, that appears under Contradictions. An extent is settled by a licensed surveyor's sketch,
              never by a map.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
