import { AlertTriangle, Building2, Car, Layers, Ruler } from 'lucide-react';
import type { SchematicYield } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, StatTile, Tile } from './ui/kit';
import { StatutoryProvenance } from './StatutoryProvenance';
import { formatArea, useAreaUnitFor } from '../lib/units';
import type { CountryCode } from '@realytica/shared';
import { SplitProse } from './ui/prose';

/**
 * What this site can hold, at a first pass.
 *
 * The headline is the FAR comparison, and it is the headline because it is
 * the number that moves a deal most and gets checked least. A developer who
 * reads 3.25 off the zoning table, buys, and then finds the plot abuts a 9m
 * road capped at 2.25 has lost a third of the scheme between exchange and
 * sanction.
 *
 * Everything below it is arithmetic on published norms, and the card says so
 * twice — once in the gap list, once in the provenance banner. This is not a
 * site plan and must never be mistaken for one: there is no geometry here,
 * and the footprint assumes a square plot, which no plot is.
 */
export function SchematicYieldCard({ yieldResult, country }: { yieldResult: SchematicYield; country: CountryCode }) {
  const y = yieldResult;
  const unit = useAreaUnitFor(country);
  const area = (sqm: number) => formatArea(sqm, unit);

  const capped = y.bindingConstraint === 'road_width';
  const unknown = y.bindingConstraint === 'unknown';
  const lossPct = capped && y.farFromZoning > 0 ? Math.round((1 - y.farApplied / y.farFromZoning) * 100) : 0;

  return (
    <Card>
      <CardHeader
        title="What this site can hold"
        subtitle="A first-pass sizing against published norms — not a site plan, and not a sanctioned scheme"
        icon={<Building2 size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        <Tile tone={capped ? 'warning' : unknown ? 'neutral' : 'good'} rail className="p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">Zoning allows</div>
              <div className="font-mono text-[22px] font-semibold tabular-nums text-ink">{y.farFromZoning}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">Road width allows</div>
              <div className="font-mono text-[22px] font-semibold tabular-nums text-ink">{y.farFromRoadWidth ?? '—'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">Applied</div>
              <div className="font-mono text-[22px] font-semibold tabular-nums text-ink">{y.farApplied}</div>
            </div>
            <Badge tone={capped ? 'warning' : unknown ? 'neutral' : 'good'} className="self-center">
              {capped
                ? `Road width binds — ${lossPct}% below the zoning FAR`
                : unknown
                  ? 'Road width unknown — zoning FAR assumed'
                  : 'Zoning binds'}
            </Badge>
          </div>
        </Tile>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Buildable" value={area(y.achievableFarAreaSqm)} icon={<Layers size={14} />} tone="brand" />
          <StatTile label="Saleable" value={area(y.saleableAreaSqm)} icon={<Ruler size={14} />} />
          <StatTile
            label="Units"
            value={y.unitsIndicative !== undefined ? String(y.unitsIndicative) : '—'}
            hint={y.avgUnitSaleableSqm ? `at ${area(y.avgUnitSaleableSqm)} average` : undefined}
            icon={<Building2 size={14} />}
          />
          <StatTile
            label="Car spaces"
            value={y.parkingSpacesRequired > 0 ? String(y.parkingSpacesRequired) : '—'}
            hint={y.basementLevelsNeeded > 0 ? `${y.basementLevelsNeeded} basement level${y.basementLevelsNeeded === 1 ? '' : 's'}` : undefined}
            icon={<Car size={14} />}
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-hairline pt-3 sm:grid-cols-3">
          <Row label="Ground coverage" value={`${y.groundCoveragePct}%`} />
          <Row label="Footprint" value={area(y.footprintSqm)} />
          <Row label="Setback all round" value={`${y.setbackAllRoundM} m`} />
          <Row label="Floors implied" value={String(y.floorsImplied)} />
          <Row label="Height" value={`${y.heightM} m`} />
          <Row label="Permitted before limits" value={area(y.permittedFarAreaSqm)} />
        </dl>

        {!y.floorPlateViable && (
          <Callout tone="critical" title="This site cannot carry this scheme">
            After setbacks the floor plate is {area(y.footprintSqm)} across {y.floorsImplied} floors. The figures above
            are arithmetic, not a building — there is no usable plan on a plate that size. Size this against a real plot
            shape and a real setback ruling before acting on any of it.
          </Callout>
        )}

        {y.coverageBound && y.floorPlateViable && (
          <Callout tone="warning" title="Coverage binds before FAR does">
            The setbacks leave less footprint than the ground-coverage rule allows, so this site cannot carry its full
            permitted area without going taller than assumed here. The headline FAR overstates what is achievable.
          </Callout>
        )}

        {y.gaps.length > 0 && (
          <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-[var(--ring)]">
            <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <AlertTriangle size={12} /> What this assumed, and what would replace it
            </p>
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {y.gaps.map((gap) => (
                <li key={gap}>
                  <SplitProse text={gap} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <StatutoryProvenance asOf={y.asOf} source={y.source} verifyNote={y.verifyNote} />
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-muted">{label}</dt>
      <dd className="m-0 font-mono text-[13px] tabular-nums text-ink">{value}</dd>
    </div>
  );
}
