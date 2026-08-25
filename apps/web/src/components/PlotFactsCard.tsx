import { Compass, LandPlot } from 'lucide-react';
import type { LayoutApproval, PlotFacing, PropertyIdentity, PropertyType, ReferenceData } from '@valytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, KeyValue, type Tone } from './ui/kit';
import { SQM_PER_SQFT, formatArea } from '../lib/units';

/**
 * Land property types — a site is priced per sq ft of land, not per sq ft of
 * built-up area, so these are the two types that carry `PropertyIdentity.plot`
 * and get compared against a locality's land rate rather than its built-up
 * price. Kept here (rather than in `@valytica/shared`) because a parallel
 * agent owns `packages/shared/src/constants.ts` and this list may not exist
 * there yet — see the contract note in `packages/shared/src/types.ts`.
 */
export const LAND_PROPERTY_TYPES: PropertyType[] = ['residential_plot', 'land_parcel'];

export function isLandPropertyType(propertyType: PropertyType): boolean {
  return LAND_PROPERTY_TYPES.includes(propertyType);
}

export const FACING_LABEL: Record<PlotFacing, string> = {
  north: 'North',
  east: 'East',
  north_east: 'North-East',
  south: 'South',
  west: 'West',
  north_west: 'North-West',
  south_east: 'South-East',
  south_west: 'South-West',
  unknown: 'Unknown',
};

/** East and north facing sites command a measurable premium in this market. */
export const PREMIUM_FACINGS: PlotFacing[] = ['north', 'east', 'north_east'];

export const LAYOUT_APPROVAL_LABEL: Record<LayoutApproval, string> = {
  bda_approved: 'BDA-approved',
  bmrda_approved: 'BMRDA-approved',
  panchayat_approved: 'Panchayat-approved',
  private_approved: 'Private layout (approved)',
  revenue_layout: 'Revenue layout',
  unapproved: 'Unapproved',
  unknown: 'Unknown',
};

/** Status tone for a layout approval badge — reserved status colours, always shipped with the label above. */
export const LAYOUT_APPROVAL_TONE: Record<LayoutApproval, Tone> = {
  bda_approved: 'good',
  bmrda_approved: 'good',
  panchayat_approved: 'neutral',
  private_approved: 'neutral',
  revenue_layout: 'warning',
  unapproved: 'warning',
  unknown: 'neutral',
};

/** Layout statuses that are hard to finance and hard to resell — a material finding, not a formality. */
export const RISKY_LAYOUT_APPROVALS: LayoutApproval[] = ['revenue_layout', 'unapproved'];

/**
 * Resolves the locality benchmark rate that actually matches a subject's
 * property type: `medianLandRatePerSqm` (per sqm of plot area) for a land
 * subject, `medianPricePerSqm` (per sqm of built-up area) for everything else.
 *
 * Deliberately never falls back across bases — comparing a site's land rate
 * against a built-up benchmark (or vice versa) is exactly the mispricing this
 * feature exists to prevent, so an unresolved locality or a missing land-rate
 * figure returns `null` rather than silently substituting the wrong number.
 */
export function localityBenchmarkPerSqm(
  reference: ReferenceData | null | undefined,
  identity: Pick<PropertyIdentity, 'country' | 'city' | 'locality' | 'propertyType'>,
): number | null {
  const localityRef = reference?.localities.find(
    (l) =>
      l.country === identity.country &&
      l.locality.trim().toLowerCase() === identity.locality.trim().toLowerCase() &&
      l.city.trim().toLowerCase() === identity.city.trim().toLowerCase(),
  );
  if (!localityRef) return null;
  const rate = isLandPropertyType(identity.propertyType) ? localityRef.medianLandRatePerSqm : localityRef.medianPricePerSqm;
  return typeof rate === 'number' && !Number.isNaN(rate) ? rate : null;
}

/**
 * Compact site-facts card for a land property (`residential_plot` /
 * `land_parcel`) — dimensions, road width, corner/demarcation status, facing
 * and layout approval. Renders nothing at all when `identity.plot` is absent,
 * so it never takes up space on a built property or a land case captured
 * before this field existed.
 */
export function PlotFactsCard({ identity }: { identity: PropertyIdentity }) {
  const plot = identity.plot;
  if (!plot) return null;

  const dims = plot.dimensionsFt;
  const dimsAreaSqft = dims ? dims.width * dims.depth : null;
  const dimsAreaSqm = dimsAreaSqft !== null ? dimsAreaSqft * SQM_PER_SQFT : null;
  const isRiskyLayout = RISKY_LAYOUT_APPROVALS.includes(plot.layoutApproval);

  return (
    <Card>
      <CardHeader title="Site facts" subtitle="Land attributes that move a Bengaluru site's rate" icon={<LandPlot size={16} />} />
      <CardBody>
        <dl>
          {/* Dimensions gets its own row (not `KeyValue`) because its value —
              "30 × 40 ft" plus the implied area in two units — is too long for
              KeyValue's single-line `truncate` treatment at a narrow card width;
              this wraps onto its own line instead of clipping. */}
          <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-1.5">
            <dt className="shrink-0 text-xs text-ink-secondary">Dimensions</dt>
            <dd className="min-w-0 text-right text-[13px] font-medium text-ink">
              {dims ? (
                <>
                  <span>
                    {dims.width} × {dims.depth} ft
                  </span>
                  <span className="block text-xs font-normal text-ink-muted">
                    {Math.round(dimsAreaSqft ?? 0).toLocaleString('en-IN')} sq ft · {formatArea(dimsAreaSqm, 'sqm')}
                  </span>
                </>
              ) : (
                'Not recorded'
              )}
            </dd>
          </div>
          <KeyValue label="Road width" value={plot.roadWidthFt !== undefined ? `${plot.roadWidthFt} ft` : 'Not recorded'} />
          <KeyValue label="Corner site" value={plot.cornerSite === undefined ? 'Not recorded' : plot.cornerSite ? 'Yes' : 'No'} />
          <KeyValue
            label="Facing"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Compass size={12} className="shrink-0 text-ink-muted" />
                {FACING_LABEL[plot.facing]}
                {PREMIUM_FACINGS.includes(plot.facing) ? (
                  <Badge tone="good" title="East and north-facing sites command a measurable premium in this market">
                    Premium
                  </Badge>
                ) : null}
              </span>
            }
          />
          <KeyValue
            label="Layout approval"
            value={<Badge tone={LAYOUT_APPROVAL_TONE[plot.layoutApproval]}>{LAYOUT_APPROVAL_LABEL[plot.layoutApproval]}</Badge>}
          />
          <KeyValue
            label="Demarcated / possession"
            value={plot.demarcated === undefined ? 'Not recorded' : plot.demarcated ? 'Yes' : 'No'}
          />
        </dl>
        {isRiskyLayout ? (
          <div className="mt-3">
            <Callout tone="warning" title="This layout status is a material finding">
              {LAYOUT_APPROVAL_LABEL[plot.layoutApproval]} sites are hard to finance and hard to resell — Property Screen treats this as a
              risk to resolve, not a formality.
            </Callout>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
