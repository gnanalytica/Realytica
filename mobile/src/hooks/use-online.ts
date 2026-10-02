import { useNetInfo } from '@react-native-community/netinfo';

/**
 * Whether the phone has a usable connection: false only when NetInfo is sure
 * it has none, null while it is still finding out. Treating "unknown" as
 * online keeps the app from claiming there is no signal at every launch.
 */
export function useOnline(): boolean | null {
  const s = useNetInfo();
  if (s.isConnected === false || s.isInternetReachable === false) return false;
  if (s.isConnected === null) return null;
  return true;
}
