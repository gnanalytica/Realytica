import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Loading } from '@/components/ui';
import { belongsTo } from '@/lib/outbox/engine';
import { useOutbox } from '@/lib/outbox/store';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

/** Everything behind pairing: Projects, Outbox and Settings, as big bottom tabs. */
export default function SiteLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const outbox = useOutbox();

  if (session.status === 'loading') return <Loading />;
  if (session.status !== 'paired') return <Redirect href="/pair" />;

  const me = { server: session.pairing.server, email: session.pairing.person.email };
  const waiting = outbox.filter((i) => belongsTo(i, me)).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.hairline,
          // Taller than the default so a gloved thumb finds the tab.
          height: 66 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarBadgeStyle: { backgroundColor: colors.warning, color: '#0b0b0b', fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="projects"
        options={{ title: 'Projects', tabBarIcon: ({ color }) => <Icon name="business-outline" size={26} tone={String(color)} /> }}
      />
      <Tabs.Screen
        name="outbox"
        options={{
          title: 'Outbox',
          tabBarBadge: waiting > 0 ? waiting : undefined,
          tabBarAccessibilityLabel: waiting > 0 ? `Outbox, ${waiting} waiting to send` : 'Outbox',
          tabBarIcon: ({ color }) => <Icon name="cloud-upload-outline" size={26} tone={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <Icon name="person-circle-outline" size={26} tone={String(color)} /> }}
      />
    </Tabs>
  );
}
