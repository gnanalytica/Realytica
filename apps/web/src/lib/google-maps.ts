/**
 * Google's map, in the browser, when a browser key is configured.
 *
 * The server's Maps key stays on the server: it is unrestricted by origin and
 * pays for geocoding and places. Drawing Google's basemap needs a key the
 * browser can see, so it is a separate one, restricted to this site's
 * addresses and to the Maps JavaScript API. Without it the map draws the
 * imagery it always has; nothing else on it depends on which.
 */

export function googleMapsKey(): string | undefined {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  return key?.trim() || undefined;
}

type GoogleWindow = Window & {
  google?: {
    maps?: {
      Map?: unknown;
      importLibrary?: (name: string) => Promise<unknown>;
      event?: { trigger(instance: object, eventName: string): void };
    };
  };
  __realyticaGoogleMapsReady?: () => void;
  gm_authFailure?: () => void;
};

/*
 * The part of Google's street-level library this app calls, typed by hand.
 * The API ships no types of its own and its type package is not installed;
 * these are the names and shapes in Google's reference, and nothing it does
 * not use.
 */
export interface StreetViewPanoramaData {
  location?: { pano: string; latLng?: { lat(): number; lng(): number } | null } | null;
  /** When the photograph was taken, as YYYY-MM. */
  imageDate?: string;
}

export interface StreetViewLibrary {
  StreetViewService: new () => {
    getPanorama(
      request: { location: { lat: number; lng: number }; radius: number; preference: string; sources: string[] },
      callback: (data: StreetViewPanoramaData | null, status: string) => void,
    ): Promise<{ data: StreetViewPanoramaData }>;
  };
  StreetViewPanorama: new (
    container: HTMLElement,
    options: { pano: string; pov: { heading: number; pitch: number }; motionTracking: boolean },
  ) => { setVisible(visible: boolean): void };
  StreetViewPreference: { NEAREST: string };
  StreetViewSource: { OUTDOOR: string };
  StreetViewStatus: { ZERO_RESULTS: string; UNKNOWN_ERROR: string };
}

let loading: Promise<void> | null = null;

/*
 * Google turns a key away once for a page, and from then on draws nothing
 * worth showing on it however many maps are made. So the refusal is kept
 * here, and not by whichever map happened to be on screen when it came: a
 * map made afterwards is refused at once, keeps its own imagery, and offers
 * the street view as a link.
 */
let refused = false;
let whenRefused: (() => void) | undefined;

/** Whether Google has turned this site's key away since the page was loaded. */
export function googleMapsRefused(): boolean {
  return refused;
}

/** Load the Maps JavaScript API once, however many maps ask. */
export function loadGoogleMaps(onRefused?: () => void): Promise<void> {
  const key = googleMapsKey();
  if (!key) return Promise.reject(new Error('No Google Maps browser key is configured.'));
  if (refused) return Promise.reject(new Error('Google has turned this key away for this site.'));
  const w = window as GoogleWindow;
  // Google calls this when the key is rejected for this site. The map on
  // screen is told, and falls back to its own imagery; a caller with nothing
  // to fall back to leaves the map's handler where it is.
  if (onRefused) whenRefused = onRefused;
  w.gm_authFailure = () => {
    refused = true;
    whenRefused?.();
  };
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    if (w.google?.maps?.Map) {
      resolve();
      return;
    }
    w.__realyticaGoogleMapsReady = () => resolve();
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__realyticaGoogleMapsReady`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('Google Maps could not be loaded.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Google's street-level library, fetched the first time somebody asks for a
 * street view and not before: the basemap does not need it.
 */
export async function loadStreetView(): Promise<StreetViewLibrary> {
  await loadGoogleMaps();
  const maps = (window as GoogleWindow).google?.maps;
  if (!maps?.importLibrary) throw new Error('Google Maps could not be loaded.');
  return (await maps.importLibrary('streetView')) as StreetViewLibrary;
}

/**
 * Tell a panorama that its box has changed size.
 *
 * Google redraws a panorama when the window is resized and asks to be told,
 * with this event, when only the box is: a column dragged wider, the map
 * going full screen.
 */
export function panoramaResized(panorama: object): void {
  (window as GoogleWindow).google?.maps?.event?.trigger(panorama, 'resize');
}

/**
 * Google Maps' own street view at a point, for a browser with no key to draw
 * one here. This is the address Google documents for it, and it opens on
 * Google's site.
 */
export function streetViewUrl(point: { lat: number; lng: number }): string {
  const query = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: `${point.lat},${point.lng}` });
  return `https://www.google.com/maps/@?${query.toString()}`;
}
