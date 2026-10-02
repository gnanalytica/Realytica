/**
 * TanStack Query, set up for a phone on a building site.
 *
 * Queries run even when the phone believes it is offline (`networkMode:
 * 'always'`): each query function falls back to what the phone saved last
 * time (see lib/cache.ts), so "offline" means "show the saved copy", not
 * "show a spinner forever". Retries are few and quick for the same reason.
 */
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
      retryDelay: 1500,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
    mutations: { networkMode: 'always', retry: 0 },
  },
});

/** Tell TanStack when the app comes to the front and when the connection changes. Call once. */
export function wireQueryLifecycle(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)),
  );
  if (Platform.OS === 'web') return () => {};
  const sub = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
  return () => sub.remove();
}
