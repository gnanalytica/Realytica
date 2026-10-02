import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, Icon, StatusDot, Text } from '@/components/ui';
import { describeDistance, distanceMetres, type Fix } from '@/lib/location';
import { openPhoneSettings } from '@/lib/push';
import type { GeoPoint } from '@/lib/types';
import { radius, space, useTheme, type Palette } from '@/theme';
import { appear, pop } from '@/theme/motion';

/** Where the phone is, recorded with the entry — or why it is not. A pulse while it looks; a pin that drops in when it has a fix. */
export function LocationRow({ fix, site, onRetry }: { fix: Fix | 'finding'; site: GeoPoint | null; onRetry: () => void }) {
  const { colors, shadow } = useTheme();
  const box = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.card,
  };
  const tile = (fill: keyof Palette) => ({
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors[fill],
  });

  if (fix === 'finding') {
    return (
      <Animated.View entering={appear} style={box}>
        <View style={tile('brandSoft')}>
          <StatusDot color={colors.brand} size={12} pulse />
        </View>
        <Text variant="body" style={{ flex: 1 }}>
          Finding your location…
        </Text>
      </Animated.View>
    );
  }

  if (fix.ok) {
    const away = site ? distanceMetres(site, fix.point) : null;
    const far = away != null && away > 1000;
    return (
      <Animated.View entering={appear} style={box}>
        <Animated.View entering={pop()} style={tile(far ? 'warningSoft' : 'goodSoft')}>
          <Icon name="location" size={24} tone={far ? 'warningText' : 'goodText'} />
        </Animated.View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Location recorded</Text>
          <Text variant="caption">
            {fix.accuracy != null ? (
              <>
                Within about{' '}
                <Text variant="caption" mono>
                  {Math.max(5, Math.round(fix.accuracy))} m
                </Text>
              </>
            ) : (
              'Accuracy unknown'
            )}
            {away != null ? ` · ${describeDistance(away)} from the site` : ''}
          </Text>
          {far ? (
            <Text variant="caption" tone="warningText">
              You seem to be away from the site. That is fine if you are logging later.
            </Text>
          ) : null}
        </View>
        <Button title="Again" variant="ghost" block={false} onPress={onRetry} />
      </Animated.View>
    );
  }

  const message =
    fix.reason === 'denied'
      ? 'Location is not allowed for Realytica Site. The entry will save without it.'
      : fix.reason === 'off'
        ? 'Location is switched off on this phone. The entry will save without it.'
        : 'Could not get a location fix. The entry will save without it.';
  return (
    <Animated.View entering={appear} style={{ gap: space.sm }}>
      <View style={box}>
        <View style={tile('sunken')}>
          <Icon name="location-outline" size={24} tone="textMuted" />
        </View>
        <Text variant="label" tone="text" style={{ flex: 1 }}>
          {message}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Try again" variant="outline" block={false} onPress={onRetry} />
        {fix.reason !== 'unavailable' && Platform.OS !== 'web' ? (
          <Button title="Open Settings" variant="ghost" block={false} onPress={openPhoneSettings} />
        ) : null}
      </View>
    </Animated.View>
  );
}
