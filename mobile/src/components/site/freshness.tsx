import { ActivityIndicator, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import type { Cached } from '@/lib/cache';
import { ago } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';

/**
 * How fresh the screen is. Live data gets a quiet line; the phone's saved copy
 * gets an unmissable one, because a site lead acting on yesterday's milestone
 * figures needs to know that is what they are.
 */
export function Freshness({ data, fetching, online }: { data: Cached<unknown> | undefined; fetching: boolean; online: boolean | null }) {
  const { colors } = useTheme();
  if (!data) return null;

  // Live data, or the saved copy while a refresh is still under way: a quiet line, not a warning.
  // (Every launch starts from the saved copy, and a warning that flashes for half a second is noise.)
  if (data.live || (fetching && online !== false)) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {fetching ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text variant="caption">
          {fetching ? `Checking for changes… (last updated ${ago(data.savedAt)})` : `Updated ${ago(data.savedAt)}`}
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.warningSoft,
      }}
    >
      <Icon name={online === false ? 'cloud-offline-outline' : 'time-outline'} size={22} tone="warningText" />
      <View style={{ flex: 1 }}>
        <Text variant="label" tone="text" style={{ fontWeight: '600' }}>
          Last updated {ago(data.savedAt)}
        </Text>
        <Text variant="caption" tone="textSecondary">
          {online === false
            ? 'No connection. This is what the phone saved; it refreshes when you are back online.'
            : 'Could not reach the server. Pull down to try again.'}
        </Text>
      </View>
    </View>
  );
}

/** A slim strip when there is no connection: work is still saved, just not sent yet. */
export function OfflineStrip({ online }: { online: boolean | null }) {
  const { colors } = useTheme();
  if (online !== false) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        backgroundColor: colors.text,
      }}
    >
      <Icon name="cloud-offline" size={18} tone={colors.page} />
      <Text variant="label" style={{ color: colors.page, flex: 1 }}>
        No signal. Anything you save stays on this phone and sends itself later.
      </Text>
    </View>
  );
}
