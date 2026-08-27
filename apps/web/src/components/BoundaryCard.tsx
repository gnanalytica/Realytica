import { useRef, useState } from 'react';
import { AlertTriangle, MapPinned, Ruler, Upload } from 'lucide-react';
import type { PropertyCase } from '@realytica/shared';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Tile } from './ui/kit';
import { api } from '../lib/api';
import { formatArea, useAreaUnitFor } from '../lib/units';
import { relativeTime } from '../lib/format';
import { AreaReconcileChart } from './charts';

/**
 * The parcel outline.
 *
 * There is no "detect boundary" button and there will not be one. A geocoded
 * pin is not a parcel — `SiteContext` says so at length — and a polygon this
 * product drew for itself would carry the authority of a survey and the
 * accuracy of a guess. The outline is something somebody supplies, and the
 * card is honest about what each source is worth.
 *
 * What it buys is stated up front, because otherwise "upload a KML" is a
 * chore with no visible reward: the setback footprint stops being a
 * square-plot assumption, and the extent it measures gets compared against
 * the extent on record — a comparison nothing else on the case can make.
 */
export function BoundaryCard({ caseData, onChanged }: { caseData: PropertyCase; onChanged: () => Promise<void> }) {
  const unit = useAreaUnitFor(caseData.identity.country);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boundary = caseData.identity.boundary;
  const stated = caseData.identity.plotAreaSqm;
  const diffPct = boundary && stated > 0 ? ((boundary.computedAreaSqm - stated) / stated) * 100 : null;
  const material = diffPct !== null && Math.abs(diffPct) >= 5;

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await api.setBoundary(caseData.id, { fileText: await file.text(), note: file.name });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read as a parcel outline.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader
        title="Parcel outline"
        subtitle={boundary ? `Supplied ${relativeTime(boundary.suppliedAt)} — ${boundary.source.replace(/_/g, ' ')}` : 'Not on file'}
        icon={<MapPinned size={16} />}
        action={
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".kml,.json,.geojson,application/json,application/vnd.google-earth.kml+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button variant="secondary" size="sm" icon={<Upload size={13} />} loading={busy} onClick={() => inputRef.current?.click()}>
              {boundary ? 'Replace' : 'Upload KML or GeoJSON'}
            </Button>
          </>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {error && (
          <Callout tone="warning" title="That file could not be used">
            {error}
          </Callout>
        )}

        {!boundary && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              Without an outline the screen assumes a square plot when it works out what fits inside the setbacks. A
              square maximises area for a given perimeter, so that assumption is an upper bound — a long or irregular
              site loses materially more, and a narrow one can lose most of it.
            </p>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              Supplying the outline replaces the assumption with a measurement, and lets the screen compare the land it
              encloses against the extent on record. That comparison is the one finding nothing else on this case can
              produce.
            </p>
            <Callout tone="neutral" title="There is no “detect boundary” button, on purpose">
              A geocoded pin locates a property; it does not describe a parcel. An outline this product drew for itself
              would carry the authority of a survey and the accuracy of a guess.
            </Callout>
          </>
        )}

        {boundary && (
          <>
            {/*
              * Measured against on-record, drawn rather than listed.
              *
              * These were two stat tiles and a sentence giving the
              * percentage, which reads as two facts when what it is is one
              * disagreement — and the quantity in dispute, not the
              * percentage, is what gets paid for per square foot.
              */}
            {stated > 0 ? (
              <AreaReconcileChart
                measuredSqm={boundary.computedAreaSqm}
                statedSqm={stated}
                formatArea={(sqm) => formatArea(sqm, unit)}
              />
            ) : (
              <Fact label="Measured" value={formatArea(boundary.computedAreaSqm, unit)} />
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Fact label="Frontage (longest edge)" value={`${boundary.longestEdgeM} m`} />
              <Fact label="Shortest edge" value={`${boundary.shortestEdgeM} m`} />
              <Fact label="Perimeter" value={`${Math.round(boundary.perimeterM)} m`} />
            </div>

            {diffPct !== null && (
              <Tile tone={material ? 'warning' : 'good'} rail className="p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Ruler size={14} className="text-ink-muted" />
                  <span className="text-[13px] font-medium text-ink">
                    The outline encloses {Math.abs(diffPct).toFixed(1)}% {diffPct < 0 ? 'less' : 'more'} than the recorded extent
                  </span>
                  <Badge tone={material ? 'warning' : 'good'}>{material ? 'Material' : 'Within tracing tolerance'}</Badge>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                  {material
                    ? 'Both figures are kept as they are. The disagreement is the finding, and reconciling it here would erase it — it belongs to a surveyor.'
                    : 'Close enough that a hand-traced outline explains it. Neither figure has been changed.'}
                </p>
              </Tile>
            )}

            <div className="flex flex-wrap gap-2">
              {!boundary.convex && (
                <Badge tone="warning" icon={<AlertTriangle size={11} />}>
                  Re-entrant — footprint is an upper bound
                </Badge>
              )}
              {boundary.elongation > 2.5 && <Badge tone="warning">{boundary.elongation.toFixed(1)}x as long as wide</Badge>}
              {boundary.source !== 'surveyed' && <Badge tone="neutral">Supplied, not surveyed</Badge>}
              <Badge tone="neutral">{boundary.ring.length} points</Badge>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-muted">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-ink">{value}</div>
    </div>
  );
}
