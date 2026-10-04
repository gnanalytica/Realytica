import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { radius, space, useTheme, type Palette } from '@/theme';
import { arrive, leave } from '@/theme/motion';
import { Icon, type IconName } from './icon';
import { Spin, StatusDot } from './status';
import { Text } from './text';
import { Touchable } from './touchable';

/**
 * `info` is teal; `ai` (blue) marks something waiting on the person's own
 * decision — an item the server refused, which only they can retry or drop.
 */
export type Tone = 'info' | 'good' | 'warning' | 'serious' | 'critical' | 'ai';

const LOOK: Record<Tone, { icon: IconName; fill: keyof Palette; ink: keyof Palette; dot: keyof Palette }> = {
  info: { icon: 'information-circle', fill: 'brandSoft', ink: 'brandStrong', dot: 'brand' },
  good: { icon: 'checkmark-circle', fill: 'goodSoft', ink: 'goodText', dot: 'good' },
  warning: { icon: 'warning', fill: 'warningSoft', ink: 'warningText', dot: 'warning' },
  serious: { icon: 'alert-circle', fill: 'seriousSoft', ink: 'seriousText', dot: 'serious' },
  critical: { icon: 'alert-circle', fill: 'criticalSoft', ink: 'criticalText', dot: 'critical' },
  ai: { icon: 'hand-left', fill: 'aiSoft', ink: 'aiText', dot: 'ai' },
};

interface BannerProps {
  tone: Tone;
  title: string;
  children?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
}

/** A tinted panel that says one thing that matters now. Colour is never the only signal: there is always an icon and words. */
export function Banner({ tone, title, children, icon, onPress }: BannerProps) {
  const { colors } = useTheme();
  const look = LOOK[tone];
  const box: ViewStyle = {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors[look.fill],
  };
  const content = (
    <>
      <Icon name={icon ?? look.icon} size={24} tone={look.ink} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" tone={tone === 'info' ? 'text' : look.ink}>
          {title}
        </Text>
        {typeof children === 'string' ? (
          <Text variant="label" tone="text">
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
      {onPress ? <Icon name="chevron-forward" size={20} tone="textMuted" /> : null}
    </>
  );
  return (
    <Animated.View entering={arrive()} exiting={leave}>
      {onPress ? (
        <Touchable accessibilityRole="button" onPress={onPress} pressScale={0.98} style={box}>
          {content}
        </Touchable>
      ) : (
        <View style={box}>{content}</View>
      )}
    </Animated.View>
  );
}

interface PillProps {
  label: string;
  tone?: Tone | 'neutral';
  icon?: IconName;
  /** A breathing dot before the label: this is happening now. */
  live?: boolean;
  /** Turn the icon: something is on its way. */
  spin?: boolean;
}

/** A small status chip on a soft fill: "Waiting to send", "On track", "High". */
export function Pill({ label, tone = 'info', icon, live, spin }: PillProps) {
  const { colors } = useTheme();
  const look =
    tone === 'neutral'
      ? { fill: colors.sunken, ink: 'textSecondary' as const, dot: colors.textMuted }
      : { fill: colors[LOOK[tone].fill], ink: LOOK[tone].ink, dot: colors[LOOK[tone].dot] };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        // In a narrow row it gives way and wraps, rather than pushing past the edge.
        flexShrink: 1,
        maxWidth: '100%',
        paddingHorizontal: space.sm + 2,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: look.fill,
      }}
    >
      {icon ? (
        <Spin active={!!spin}>
          <Icon name={icon} size={14} tone={look.ink} />
        </Spin>
      ) : live != null ? (
        <StatusDot color={look.dot} size={7} pulse={live} />
      ) : null}
      <Text variant="caption" tone={look.ink} style={{ fontWeight: '600', flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}
