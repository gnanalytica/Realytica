import { router, type Href } from 'expo-router';

/**
 * Go back, or to `fallback` when there is nothing to go back to — a screen
 * opened from a notification, a link, or a reload on the web has no history.
 */
export function goBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
