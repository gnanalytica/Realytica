import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, ExternalLink, MapPin, Navigation, RefreshCw } from 'lucide-react';
import type { AmenityKind, NearbyAmenity, SiteContext } from '@valytica/shared';
import type { TabProps } from '../tab-props';
import { api } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton } from '../../../components/ui/kit';

/**
 * Where the property is, and what surrounds it.
 *
 * The governing rule of this view is that a map pin is the most persuasive
 * thing this product can put on a screen and is frequently not the property.
 * A Bengaluru survey number is a legal description, not a postal address; ask
 * a geocoder for one and it returns the centre of the village, confidently.
 * So the precision the geocoder reported travels with the pin everywhere it
 * is drawn, and a pin that landed on a locality centre is captioned as a
 * locality centre — in the heading, on the image, and against every distance
 * measured from it.
 *
 * Two things this view deliberately does not offer, both of which would be
 * easy to add and both of which are argued out in `SiteContext`: a tool to
 * draw the boundary and read off an area, and a distance from the pin to a
 * rajakaluve or lake edge.
 */

const KIND_LABEL: Record<AmenityKind, string> = {
  transit: 'Metro & rail',
  school: 'Schools',
  hospital: 'Hospitals',
  market: 'Shops & markets',
  employment: 'Employment',
  airport: 'Airport',
};

/** The order kinds are listed in. Matches the order the builder searches them. */
const KIND_ORDER: AmenityKind[] = ['transit', 'school', 'hospital', 'market', 'airport', 'employment'];

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

function formatDrive(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/**
 * How the capture date reads to someone deciding whether to trust the photo.
 *
 * Google's coverage of the Bengaluru peripheries — Sarjapur, Hennur,
 * Devanahalli — is routinely years old, and those are exactly the corridors
 * being sold on infrastructure that has arrived since. A four-year-old
 * photograph of an empty approach road is not neutral; it either flatters or
 * damns the property, and which one depends entirely on facts the image
 * cannot show. So the age is stated, and past three years it is stated as a
 * warning rather than a footnote.
 */
function imageAge(capturedAt: string): { text: string; stale: boolean } {
  const match = /^(\d{4})(?:-(\d{2}))?/.exec(capturedAt);
  if (!match) return { text: `Captured ${capturedAt}`, stale: false };
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 6;
  const monthsOld = (new Date().getFullYear() - year) * 12 + (new Date().getMonth() + 1 - month);
  const years = Math.floor(monthsOld / 12);
  const stale = years >= 3;
  const label = new Date(year, month - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (years < 1) return { text: `Captured ${label}`, stale };
  return { text: `Captured ${label} — about ${years} year${years === 1 ? '' : 's'} ago`, stale };
}

function PrecisionBadge({ context }: { context: SiteContext }) {
  const precision = context.location?.precision;
  if (!precision) return null;
  const exact = precision === 'rooftop' || precision === 'interpolated';
  return (
    <Badge tone={exact ? 'good' : 'warning'} className="w-fit">
      {exact ? 'Located to this address' : 'Located to the area only'}
    </Badge>
  );
}

function AmenityRow({ amenity }: { amenity: NearbyAmenity }) {
  const driving = amenity.drivingMetres !== undefined;
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-0">
      <span className="text-[13px] text-ink">{amenity.name}</span>
      <span className="shrink-0 text-right text-[12px] tabular-nums text-ink-secondary">
        {driving ? (
          <>
            {formatDistance(amenity.drivingMetres!)} by road
            {amenity.drivingSeconds !== undefined && <span className="text-ink-muted"> · {formatDrive(amenity.drivingSeconds)}</span>}
          </>
        ) : (
          <>{formatDistance(amenity.straightLineMetres)} in a straight line</>
        )}
      </span>
    </li>
  );
}

export default function LocationTab({ caseData }: TabProps) {
  const { data, loading, error, setData } = useAsync<SiteContext>(() => api.siteContext(caseData.id), [caseData.id]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byKind = new Map<AmenityKind, NearbyAmenity[]>();
    for (const a of data?.amenities ?? []) {
      byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
    }
    return KIND_ORDER.filter(k => byKind.has(k)).map(k => ({ kind: k, items: byKind.get(k)! }));
  }, [data]);

  const rebuild = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      setData(await api.refreshSiteContext(caseData.id));
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return <Callout tone="critical" title="Could not load the location">{error}</Callout>;
  }

  const location = data?.location ?? null;
  const unconfigured = data?.provider === 'unconfigured' || (data?.gaps ?? []).some(g => g.code === 'no_provider_key');

  if (!location) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<MapPin size={28} />}
          title={unconfigured ? 'No map for this deployment' : 'This address could not be placed on a map'}
          description={
            (data?.gaps ?? [])[0]?.consequence ??
            'Nothing is known about where this property sits or what surrounds it.'
          }
          action={
            unconfigured ? undefined : (
              <Button variant="secondary" icon={<RefreshCw size={14} />} loading={refreshing} onClick={() => void rebuild()}>
                Try again
              </Button>
            )
          }
        />
        {refreshError && <Callout tone="critical" title="Retry failed">{refreshError}</Callout>}
        {(data?.gaps ?? []).length > 1 && <GapList gaps={data!.gaps} />}
      </div>
    );
  }

  const approximate = location.precision !== 'rooftop' && location.precision !== 'interpolated';
  const streetView = data?.streetView ?? null;
  const age = streetView ? imageAge(streetView.capturedAt) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="On the map"
          subtitle={location.resolvedAddress}
          icon={<MapPin size={16} />}
          action={
            <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} loading={refreshing} onClick={() => void rebuild()}>
              Rebuild
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <PrecisionBadge context={data!} />
          <div className="overflow-hidden rounded-lg border border-hairline">
            <img
              src={`/api/cases/${caseData.id}/site-context/map?w=640&h=340&zoom=${approximate ? 13 : 16}`}
              alt={
                `Map centred on ${location.resolvedAddress}. ` +
                (approximate
                  ? 'The marker is the centre of this area, not the property itself.'
                  : 'The marker is the address on file; it is not a surveyed parcel boundary.')
              }
              width={640}
              height={340}
              className="w-full bg-sunken object-cover"
              loading="lazy"
            />
          </div>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{location.caveat}</p>
          <a
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
            href={`https://www.google.com/maps/search/?api=1&query=${location.point.lat},${location.point.lng}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Google Maps <ExternalLink size={13} />
          </a>
        </CardBody>
      </Card>

      {streetView && age && (
        <Card>
          <CardHeader
            title="From the street"
            subtitle={`Camera stood about ${Math.round(streetView.offsetMetres)} m away, looking towards the site`}
            icon={<Camera size={16} />}
          />
          <CardBody className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg border border-hairline">
              <img
                src={streetView.url}
                alt={`Street-level view towards ${location.resolvedAddress}, captured ${streetView.capturedAt}.`}
                width={640}
                height={400}
                className="w-full bg-sunken object-cover"
                loading="lazy"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={age.stale ? 'warning' : 'neutral'}>{age.text}</Badge>
              {age.stale && (
                <span className="text-[12px] text-ink-secondary">
                  Old enough that roads, construction and access may have changed since. Treat it as a starting point for a site visit, not a substitute for one.
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {grouped.length > 0 && (
        <Card>
          <CardHeader
            title="What is nearby"
            subtitle={approximate ? 'Measured from the centre of the area, not from the property' : 'Measured from the located address'}
            icon={<Navigation size={16} />}
          />
          <CardBody className="flex flex-col gap-4">
            {approximate && (
              <Callout tone="warning" title="These are neighbourhood distances">
                The address on file did not resolve to a specific building, so every distance below is measured from the
                centre of {location.resolvedAddress}. Add a street address or project name to the case and rebuild to
                measure from the property itself.
              </Callout>
            )}
            {grouped.map(group => (
              <div key={group.kind}>
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{KIND_LABEL[group.kind]}</h4>
                <ul className="m-0 list-none p-0">
                  {group.items.map(a => (
                    <AmenityRow key={a.id} amenity={a} />
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-[12px] leading-relaxed text-ink-muted">
              Places and distances come from {data!.provider === 'google' ? 'Google Maps' : data!.provider}. They describe
              the surroundings — they say nothing about this property's boundaries, its extent, or how far it must stand
              back from a drain or lake edge. Those are surveyor and authority questions.
            </p>
          </CardBody>
        </Card>
      )}

      {(data?.gaps ?? []).length > 0 && <GapList gaps={data!.gaps} />}
      {refreshError && <Callout tone="critical" title="Rebuild failed">{refreshError}</Callout>}
    </div>
  );
}

/**
 * Everything the lookup could not establish.
 *
 * Rendered rather than swallowed, because an empty amenity list and a failed
 * amenity lookup look identical on screen and mean opposite things.
 */
function GapList({ gaps }: { gaps: SiteContext['gaps'] }) {
  return (
    <Card>
      <CardHeader title="What could not be established" icon={<AlertTriangle size={16} />} />
      <CardBody>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {gaps.map(gap => (
            <li key={gap.code} className="border-b border-hairline pb-3 last:border-0 last:pb-0">
              <p className="m-0 text-[13px] font-medium text-ink">{gap.attempted}</p>
              <p className="m-0 mt-0.5 text-[13px] leading-relaxed text-ink-secondary">{gap.consequence}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
