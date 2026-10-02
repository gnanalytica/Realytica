import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { hydrateQueryCache } from '@/lib/cache';
import { loadOutbox } from '@/lib/outbox/store';
import { startSyncLoop } from '@/lib/outbox/sync';
import { listenForNotifications } from '@/lib/push';
import { queryClient, wireQueryLifecycle } from '@/lib/query';
import { loadSession, refreshMe, useSession } from '@/lib/session';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { colors, isDark } = useTheme();
  const [ready, setReady] = useState(false);
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
        setReady(true);
        SplashScreen.hideAsync().catch(() => {});
      }
    })();
  }, []);

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

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.page }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            {/* The splash screen stays up until this is ready, so nothing flashes. */}
            {ready ? (
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="pair" />
                <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="(site)" />
                <Stack.Screen
                  name="log/[projectId]"
                  // No swipe-to-dismiss: a half-written day's log should only close when the person says so.
                  options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }}
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
