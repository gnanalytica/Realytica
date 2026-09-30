import { useEffect, useState } from 'react';
import { fetchWithAuth } from './api';

/**
 * An API resource as a URL an `<img>` or a map layer can load.
 *
 * The browser sends no Authorization header when an element loads a `src` or
 * a link is followed, and the API reads the session from that header alone.
 * Pointing an element straight at an API path therefore works locally, where
 * sign-in is off, and fails with a 401 wherever it is on. This fetches the
 * bytes with the session's token and hands back an object URL for them,
 * released when the path changes or the component goes.
 *
 * `url` stays empty until the bytes arrive, and `failed` says they will not,
 * so a caller can leave the element out rather than draw a broken image.
 */
export function useAuthedUrl(path: string | undefined): { url?: string; failed: boolean } {
  const [state, setState] = useState<{ url?: string; failed: boolean }>({ failed: false });

  useEffect(() => {
    setState({ failed: false });
    if (!path) return undefined;
    let cancelled = false;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const res = await fetchWithAuth(path);
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, failed: false });
      } catch {
        if (!cancelled) setState({ failed: true });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return state;
}
