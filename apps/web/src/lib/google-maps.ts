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
  google?: { maps?: { Map?: unknown } };
  __realyticaGoogleMapsReady?: () => void;
  gm_authFailure?: () => void;
};

let loading: Promise<void> | null = null;
let refused = false;

/** Whether Google refused the key — wrong site, API not enabled — after it loaded. */
export function googleMapsRefused(): boolean {
  return refused;
}

/** Load the Maps JavaScript API once, however many maps ask. */
export function loadGoogleMaps(onRefused?: () => void): Promise<void> {
  const key = googleMapsKey();
  if (!key) return Promise.reject(new Error('No Google Maps browser key is configured.'));
  const w = window as GoogleWindow;
  // Google calls this when the key is rejected for this site; the map falls back to its own imagery.
  w.gm_authFailure = () => {
    refused = true;
    onRefused?.();
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
