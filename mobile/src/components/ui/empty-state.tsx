import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { BrandMark } from '@/components/brand-mark';
import { radius, space, useTheme } from '@/theme';
import { arrive, pop } from '@/theme/motion';
import { Button } from './button';
import { Icon, type IconName } from './icon';
import { Text } from './text';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon = 'file-tray-outline', title, body, action }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={arrive()} style={{ alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.lg, gap: space.md }}>
      <Animated.View
        entering={pop(2)}
        style={{
          width: 76,
          height: 76,
          borderRadius: radius.pill,
          backgroundColor: colors.sunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={36} tone="textMuted" />
      </Animated.View>
      <Text variant="heading" center>
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="textSecondary" center style={{ maxWidth: 340 }}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: space.sm, alignSelf: 'stretch' }}>
          <Button title={action.label} variant="outline" onPress={action.onPress} />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** A full-screen wait: the brand mark breathing gently. Still, with Reduce Motion on. */
export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    breath.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(breath);
  }, [breath, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * breath.get(), transform: [{ scale: 0.96 + 0.04 * breath.get() }] }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, backgroundColor: colors.page, padding: space.xxl }}
    >
      <Animated.View style={style}>
        <BrandMark size={52} />
      </Animated.View>
      {label ? <Text variant="label">{label}</Text> : null}
    </View>
  );
}
