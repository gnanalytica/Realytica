import { Stack } from 'expo-router';

import { useTheme } from '@/theme';

// A project opened from a notification or a link still has the list beneath it to go back to.
export const unstable_settings = { initialRouteName: 'index' };

export default function ProjectsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.brandStrong,
        headerTitleStyle: { color: colors.text, fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.page },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[projectId]/index" options={{ title: '' }} />
    </Stack>
  );
}
