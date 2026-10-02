/**
 * Phone notifications for construction alerts.
 *
 * The server sends alerts worth interrupting someone for (a serious issue from
 * site, work logged before the approvals allow it, a late milestone) to the
 * Expo push tokens of the people they concern. This file gets that token and
 * hands it to the server, and opens the right project when a notification is
 * tapped.
 *
 * Push needs a real phone running a proper build of the app: not the web, not
 * a simulator, and not Expo Go (which dropped remote notifications on Android
 * in SDK 53). expo-notifications is loaded lazily so that merely opening the
 * app in Expo Go does not trip its warnings.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { isRunningInExpoGo } from 'expo';
import { Linking, Platform } from 'react-native';

import { api } from './api';
import { updatePairing } from './session';

export type PushAvailability = { ok: true } | { ok: false; reason: string };

export function pushAvailability(): PushAvailability {
  if (Platform.OS === 'web') return { ok: false, reason: 'Notifications are only available in the phone app.' };
  if (!Device.isDevice) return { ok: false, reason: 'Notifications need a real phone; a simulator cannot receive them.' };
  if (isRunningInExpoGo()) return { ok: false, reason: 'Notifications need the installed Realytica Site app; they do not work inside Expo Go.' };
  if (!easProjectId()) return { ok: false, reason: 'This build of the app is not linked to a push service yet (run `eas init`, then rebuild).' };
  return { ok: true };
}

function easProjectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}

export type EnableResult = { ok: true } | { ok: false; message: string; openSettings?: boolean };

/** Ask permission, get the Expo push token, and give it to the server. */
export async function enablePush(): Promise<EnableResult> {
  const available = pushAvailability();
  if (!available.ok) return { ok: false, message: available.reason };
  try {
    const Notifications = await import('expo-notifications');
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Site alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && canAskAgain) ({ status, canAskAgain } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') {
      return { ok: false, message: 'Notifications are turned off for Realytica Site in your phone’s Settings.', openSettings: true };
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() });
    const { device } = await api.setPushToken(token);
    // The server's answer is the record of whether this phone gets alerts.
    await updatePairing({ device });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message || 'Could not turn on notifications.' };
  }
}

/** Tell the server to stop sending to this phone. */
export async function disablePush(): Promise<EnableResult> {
  try {
    const { device } = await api.setPushToken(null);
    await updatePairing({ device });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function openPhoneSettings(): void {
  void Linking.openSettings();
}

/**
 * Show notifications that arrive while the app is open, and open the project
 * when one is tapped. Returns a function that stops listening.
 */
export async function listenForNotifications(open: (projectId: string) => void): Promise<() => void> {
  if (!pushAvailability().ok) return () => {};
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  const route = (data: unknown) => {
    const projectId = (data as { projectId?: unknown } | null)?.projectId;
    if (typeof projectId === 'string' && projectId) open(projectId);
  };
  // A tap that launched the app from cold.
  const last = await Notifications.getLastNotificationResponseAsync();
  if (last) {
    route(last.notification.request.content.data);
    await Notifications.clearLastNotificationResponseAsync();
  }
  const sub = Notifications.addNotificationResponseReceivedListener((r) => route(r.notification.request.content.data));
  return () => sub.remove();
}
