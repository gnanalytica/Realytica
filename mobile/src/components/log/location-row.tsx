import { ActivityIndicator, Platform, View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { describeDistance, distanceMetres, type Fix } from '@/lib/location';
import { openPhoneSettings } from '@/lib/push';
import type { GeoPoint } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

/** Where the phone is, recorded with the entry — or why it is not. */
export function LocationRow({ fix, site, onRetry }: { fix: Fix | 'finding'; site: GeoPoint | null; onRetry: () => void }) {
  const { colors } = useTheme();
  const box = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hairline };

  if (fix === 'finding') {
    return (
      <View style={box}>
        <ActivityIndicator color={colors.brand} />
        <Text variant="body" style={{ flex: 1 }}>
          Finding your location…
        </Text>
      </View>
    );
  }

  if (fix.ok) {
    const away = site ? distanceMetres(site, fix.point) : null;
    const far = away != null && away > 1000;
    return (
      <View style={box}>
        <Icon name="location" size={26} tone={far ? 'warningText' : 'goodText'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Location recorded</Text>
          <Text variant="caption">
            {fix.accuracy != null ? `Within about ${Math.max(5, Math.round(fix.accuracy))} m` : 'Accuracy unknown'}
            {away != null ? ` · ${describeDistance(away)} from the site` : ''}
          </Text>
          {far ? (
            <Text variant="caption" tone="warningText">
              You seem to be away from the site. That is fine if you are logging later.
            </Text>
          ) : null}
        </View>
        <Button title="Again" variant="ghost" block={false} onPress={onRetry} />
      </View>
    );
  }

  const message =
    fix.reason === 'denied'
      ? 'Location is not allowed for Realytica Site. The entry will save without it.'
      : fix.reason === 'off'
        ? 'Location is switched off on this phone. The entry will save without it.'
        : 'Could not get a location fix. The entry will save without it.';
  return (
    <View style={{ gap: space.sm }}>
      <View style={box}>
        <Icon name="location-outline" size={26} tone="textMuted" />
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
    </View>
  );
}
