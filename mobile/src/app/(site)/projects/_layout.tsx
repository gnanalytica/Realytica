import { Stack } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { face, useTheme } from '@/theme';

// A project opened from a notification or a link still has the list beneath it to go back to.
export const unstable_settings = { initialRouteName: 'index' };

export default function ProjectsLayout() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        // The header sits on the page itself, so the project reads as one sheet of paper.
        headerStyle: { backgroundColor: colors.page },
        headerTintColor: colors.brandStrong,
        headerTitleStyle: { ...face('600'), color: colors.text, fontSize: 18 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.page },
        // iOS's own push; on Android the same slide, with the list easing back underneath.
        animation: reduced ? 'fade' : 'ios_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[projectId]/index" options={{ title: '' }} />
    </Stack>
  );
}
