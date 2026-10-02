import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { hydrateQueryCache } from '@/lib/cache';
import { loadOutbox } from '@/lib/outbox/store';
import { startSyncLoop } from '@/lib/outbox/sync';
import { listenForNotifications } from '@/lib/push';
import { queryClient, wireQueryLifecycle } from '@/lib/query';
import { loadSession, refreshMe, useSession } from '@/lib/session';
import { FONT, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
// Fade the splash away rather than cutting to the first screen (iOS; Android has its own exit).
SplashScreen.setOptions({ fade: true, duration: 300 });

/** The typefaces, by the family name each weight is registered under (see face() in src/theme). */
const FONT_FILES = {
  [FONT.regular]: SchibstedGrotesk_400Regular,
  [FONT.medium]: SchibstedGrotesk_500Medium,
  [FONT.semibold]: SchibstedGrotesk_600SemiBold,
  [FONT.bold]: SchibstedGrotesk_700Bold,
  [FONT.mono]: DMMono_400Regular,
  [FONT.monoMedium]: DMMono_500Medium,
};

export default function RootLayout() {
  const { colors, isDark } = useTheme();
  const reduced = useReducedMotion();
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const [loaded, setLoaded] = useState(false);
  // The fonts are bundled with the app, so an error here is near impossible; if one happens
  // the app goes on in the system face rather than sitting on the splash screen.
  const ready = loaded && (fontsLoaded || !!fontError);
  const session = useSession();
  const token = session.status === 'paired' ? session.pairing.token : null;

  useEffect(() => wireQueryLifecycle(), []);

  // Before the first screen: the pairing, the saved copies of project data, and the outbox.
  useEffect(() => {
    void (async () => {
      try {
        const s = await loadSession();
        if (s.status === 'paired') await hydrateQueryCache(queryClient);
        await loadOutbox();
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // While paired: keep the outbox moving, check the pairing still holds, and open projects from notifications.
  useEffect(() => {
    if (!ready || !token) return;
    const stopSync = startSyncLoop();
    void refreshMe();
    let stopListening = () => {};
    let cancelled = false;
    void listenForNotifications((projectId) => router.push(`/projects/${projectId}`)).then((stop) => {
      if (cancelled) stop();
      else stopListening = stop;
    });
    return () => {
      cancelled = true;
      stopSync();
      stopListening();
    };
  }, [ready, token]);

  // Moving between pairing and the projects cross-fades; the log and the scanner rise from the
  // bottom as their own full-screen task; a photo fades up. With Reduce Motion, everything fades.
  const rise = reduced ? 'fade' : 'slide_from_bottom';

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.page }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            {/* The splash screen stays up until this is ready, so nothing flashes. */}
            {ready ? (
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page }, animation: 'fade' }}>
                <Stack.Screen name="index" options={{ animation: 'none' }} />
                <Stack.Screen name="pair" />
                <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: rise }} />
                <Stack.Screen name="(site)" />
                <Stack.Screen
                  name="log/[projectId]"
                  // No swipe-to-dismiss: a half-written day's log should only close when the person says so.
                  options={{ presentation: 'fullScreenModal', animation: rise, gestureEnabled: false }}
                />
                <Stack.Screen name="photo" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
              </Stack>
            ) : null}
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
