import { Redirect, Tabs } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { SiteTabBar } from '@/components/site/tab-bar';
import { Icon, Loading } from '@/components/ui';
import { belongsTo } from '@/lib/outbox/engine';
import { useOutbox } from '@/lib/outbox/store';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

/** Everything behind pairing: Projects, Outbox and Settings, as big bottom tabs. */
export default function SiteLayout() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const session = useSession();
  const outbox = useOutbox();

  if (session.status === 'loading') return <Loading />;
  if (session.status !== 'paired') return <Redirect href="/pair" />;

  const me = { server: session.pairing.server, email: session.pairing.person.email };
  const waiting = outbox.filter((i) => belongsTo(i, me)).length;

  return (
    <Tabs
      tabBar={(props) => <SiteTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.page },
        // Tabs shift a little sideways as they change, so it is clear which way you went.
        animation: reduced ? 'none' : 'shift',
      }}
    >
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'business' : 'business-outline'} size={26} tone={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="outbox"
        options={{
          title: 'Outbox',
          tabBarBadge: waiting > 0 ? waiting : undefined,
          tabBarAccessibilityLabel: waiting > 0 ? `Outbox, ${waiting} waiting to send` : 'Outbox',
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'cloud-upload' : 'cloud-upload-outline'} size={26} tone={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'person-circle' : 'person-circle-outline'} size={26} tone={String(color)} />,
        }}
      />
    </Tabs>
  );
}
