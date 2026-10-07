import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { bearingDegrees, haversineMetres } from '@realytica/shared';
import { loadStreetView, panoramaResized, type StreetViewLibrary, type StreetViewPanoramaData } from '../../lib/google-maps';
import { Button } from '../ui/kit';
import type { SitePoint } from './frame';

/** A panorama found near the site, ready to be shown. */
export interface StreetScene {
  library: StreetViewLibrary;
  pano: string;
  /** Degrees clockwise from north: from where the camera stood, towards the site. */
  heading: number;
  /**
   * Where the opening view was taken from, and when. Worded about the opening
   * so that it stays true once the reader walks on down the road.
   */
  opened: string;
}

/** A distance the way a reader says it: metres up to a kilometre, then kilometres. */
function metres(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "2023-05", as Google gives it, to "May 2023". Anything else is shown as it came. */
function monthOf(imageDate: string): string {
  const [year, month] = imageDate.split('-').map(Number);
  return year && month ? new Date(year, month - 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : imageDate;
}

/**
 * The line for a site with none. It names the distance that was searched,
 * which from the middle of an outline is further than from a pin.
 */
export function noStreetView(site: SitePoint): string {
  return `No street view within ${metres(site.reachM)} of ${site.name}.`;
}

/**
 * The nearest outdoor panorama within the site's reach, or null when there is
 * none.
 *
 * Outdoor only. In a built-up street the nearest panorama to a pin is often
 * the inside of a shop, which shows nothing of the site. And the view opens
 * facing the site, for the same reason the still photograph does: the camera
 * stood on the road, and the road is not what the reader came to see.
 */
export async function findStreetScene(site: SitePoint): Promise<StreetScene | null> {
  const library = await loadStreetView();
  const none = library.StreetViewStatus.ZERO_RESULTS;
  let status = library.StreetViewStatus.UNKNOWN_ERROR;
  let found: StreetViewPanoramaData;
  try {
    ({ data: found } = await new library.StreetViewService().getPanorama(
      {
        location: { lat: site.lat, lng: site.lng },
        radius: site.reachM,
        preference: library.StreetViewPreference.NEAREST,
        sources: [library.StreetViewSource.OUTDOOR],
      },
      (_data, answered) => {
        status = answered;
      },
    ));
  } catch (error) {
    // "None here" arrives as a failure too. Google says which it was twice
    // over, in the status it hands the callback and in the code on the error,
    // and either is taken at its word.
    if (status === none || (error as { code?: unknown } | null)?.code === none) return null;
    throw error;
  }
  const pano = found.location?.pano;
  if (!pano) return null;
  const stood = found.location?.latLng;
  const camera = stood ? { lat: stood.lat(), lng: stood.lng() } : null;
  return {
    library,
    pano,
    heading: camera ? bearingDegrees(camera, site) : 0,
    opened: [
      camera ? `Opened ${metres(haversineMetres(camera, site))} from ${site.name}` : null,
      found.imageDate ? `${monthOf(found.imageDate)} imagery` : 'capture date not stated',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/**
 * The street view, in the map's box, with a way back to the map.
 *
 * The bar above the picture is ours and the picture is Google's. Google puts
 * its own controls in the picture's corners, so a way back laid over the
 * picture would sit under one of them on some screen; a bar of its own cannot.
 */
export function StreetViewPane({ scene, onBack }: { scene: StreetScene; onBack: () => void }) {
  const picture = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = picture.current;
    if (!el) return undefined;
    const panorama = new scene.library.StreetViewPanorama(el, {
      pano: scene.pano,
      pov: { heading: scene.heading, pitch: 0 },
      // The view stays where it is pointed. On a phone it would otherwise swing about with the handset.
      motionTracking: false,
    });
    // The box changes size without the window doing so: the conversation
    // beside it is dragged wider, the map goes full screen. Google only
    // watches the window, so it is told.
    const resized = new ResizeObserver(() => panoramaResized(panorama));
    resized.observe(el);
    return () => {
      resized.disconnect();
      panorama.setVisible(false);
      el.replaceChildren();
    };
  }, [scene]);

  return (
    <div role="region" aria-label="Street view" className="absolute inset-0 z-10 flex flex-col bg-surface">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Button size="sm" autoFocus icon={<ArrowLeft size={13} />} onClick={onBack} className="shrink-0 whitespace-nowrap">
          Back to map
        </Button>
        {/* Wraps rather than cuts off: on a phone the end of this line is the date of the photograph. */}
        <p className="min-w-0 text-[12px] leading-snug text-ink-muted">{scene.opened}</p>
      </div>
      <div ref={picture} className="min-h-0 flex-1" />
    </div>
  );
}
