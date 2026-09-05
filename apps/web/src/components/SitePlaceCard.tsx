import { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import type { AmenityKind, DdProject, SiteContext } from '@realytica/shared';
import { api } from '../lib/api';
import { Badge, Button, Card, CardBody, Spinner, useToast } from './ui/kit';

/**
 * Where this property actually is, and what stands around it.
 *
 * Every piece of this has been served by the API since the mapping provider
 * was written — `/site-context` for the pin and the nearby list, `/street-view`
 * and `/map` as image proxies so the Maps key never reaches a browser — and
 * nothing in the web app has ever called any of it. A due-diligence file on a
 * Bengaluru site could tell you the encumbrance position and not show you the
 * road it fronts.
 *
 * Three honesty constraints are carried from the model rather than invented
 * here, and each is the reason a line of this component exists:
 *
 * **A pin is not a boundary.** `SiteLocation.caveat` is written by the
 * provider that produced the location precisely so that a pin can never be
 * drawn without the sentence qualifying it. It renders unconditionally.
 *
 * **The camera is not the property.** `StreetViewImage.point` is where the car
 * stood, which can be a different plot, the far side of a wall, or a road that
 * has since been widened. The capture date is shown for the same reason: a
 * 2019 panorama of a construction site is a photograph of the past.
 *
 * **A straight line is not a journey.** `straightLineMetres` is always there
 * and `drivingMetres` only sometimes, so the two are labelled differently
 * rather than blended into one "distance" that flatters whichever is shorter.
 */
const AMENITY_LABEL: Record<AmenityKind, string> = {
  transit: 'Transit',
  school: 'School',
  hospital: 'Hospital',
  market: 'Market',
  employment: 'Employment',
  airport: 'Airport',
};

function metres(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function SitePlaceCard({ project }: { project: DdProject }) {
  const [context, setContext] = useState<SiteContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContext(await api.projectSiteContext(project.id));
    } catch {
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      setContext(await api.refreshProjectSiteContext(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reach the mapping provider', 'warning');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardBody className="flex items-center gap-2 text-mini text-ink-muted">
          <Spinner /> Locating the site…
        </CardBody>
      </Card>
    );
  }

  const location = context?.location ?? null;
  const streetView = context?.streetView ?? null;
  const amenities = context?.amenities ?? [];

  return (
    <Card>
      <CardBody className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <MapPin size={13} className="shrink-0 text-ink-muted" aria-hidden />
            <h3 className="truncate text-[13px] font-semibold text-ink">On the ground</h3>
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={11} /> {busy ? 'Locating…' : 'Refresh'}
          </Button>
        </div>

        {/*
          Every gap the provider reported, in its own words. `SiteContextGap`
          carries what was attempted and what is not known as a result —
          deliberately never the word "unavailable" — so an unconfigured
          deployment says what it cannot tell you rather than showing an empty
          card that looks like an absence of features.
        */}
        {(context?.gaps ?? []).map((gap) => (
          <p key={gap.code} className="rounded-lg bg-sunken px-2.5 py-1.5 text-mini leading-snug text-ink-secondary">
            {gap.consequence}
          </p>
        ))}

        {location ? (
          <>
            <div className="space-y-1">
              <p className="text-[12.5px] text-ink">{location.resolvedAddress}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{location.precision.replace(/_/g, ' ')}</Badge>
                <span className="text-mini tabular-nums text-ink-muted">
                  {location.point.lat.toFixed(5)}, {location.point.lng.toFixed(5)}
                </span>
              </div>
              {/* Never a pin without its caveat — see the note at the top. */}
              <p className="text-mini leading-snug text-ink-muted">{location.caveat}</p>
            </div>

            <img
              src={`/api/projects/${project.id}/site-context/map?zoom=16&w=640&h=300`}
              alt={`Map of ${location.resolvedAddress}, with the site pin and any nearby places numbered`}
              className="w-full rounded-lg ring-1 ring-inset ring-[var(--ring)]"
              loading="lazy"
            />
          </>
        ) : null}

        {streetView ? (
          <div className="space-y-1">
            <img
              src={`/api/projects/${project.id}/site-context/street-view?pano=${encodeURIComponent(streetView.panoramaId)}&w=640&h=320`}
              alt="Street-level view from the nearest road the provider has imagery for"
              className="w-full rounded-lg ring-1 ring-inset ring-[var(--ring)]"
              loading="lazy"
            />
            <p className="text-mini text-ink-muted">
              Captured {streetView.capturedAt}. This is where the camera stood, not the property boundary.
            </p>
          </div>
        ) : null}

        {amenities.length > 0 ? (
          <dl className="flex flex-col gap-0.5">
            {amenities.slice(0, 8).map((a, i) => (
              <div key={a.id} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 truncate text-mini text-ink-secondary">
                  <span className="mr-1 tabular-nums text-ink-muted">{i + 1}</span>
                  {a.name}
                  <span className="ml-1 text-ink-muted">· {AMENITY_LABEL[a.kind]}</span>
                </dt>
                <dd className="shrink-0 text-mini tabular-nums text-ink">
                  {a.drivingMetres !== undefined ? (
                    <>
                      {metres(a.drivingMetres)} <span className="text-ink-muted">by road</span>
                    </>
                  ) : (
                    <>
                      {metres(a.straightLineMetres)} <span className="text-ink-muted">straight line</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </CardBody>
    </Card>
  );
}
