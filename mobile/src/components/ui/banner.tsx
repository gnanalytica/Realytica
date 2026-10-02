import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { radius, space, useTheme, type Palette } from '@/theme';
import { Icon, type IconName } from './icon';
import { Text } from './text';

export type Tone = 'info' | 'good' | 'warning' | 'critical';

const LOOK: Record<Tone, { icon: IconName; fill: keyof Palette; edge: keyof Palette; ink: keyof Palette }> = {
  info: { icon: 'information-circle', fill: 'brandSoft', edge: 'brand', ink: 'brandStrong' },
  good: { icon: 'checkmark-circle', fill: 'goodSoft', edge: 'good', ink: 'goodText' },
  warning: { icon: 'warning', fill: 'warningSoft', edge: 'warning', ink: 'warningText' },
  critical: { icon: 'alert-circle', fill: 'criticalSoft', edge: 'critical', ink: 'criticalText' },
};

interface BannerProps {
  tone: Tone;
  title: string;
  children?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
}

/** A coloured strip that says one thing that matters now. Colour is never the only signal: there is always an icon and words. */
export function Banner({ tone, title, children, icon, onPress }: BannerProps) {
  const { colors } = useTheme();
  const look = LOOK[tone];
  const body = (
    <View
      style={{
        flexDirection: 'row',
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        backgroundColor: colors[look.fill],
        borderLeftWidth: 5,
        borderLeftColor: colors[look.edge],
      }}
    >
      <Icon name={icon ?? look.icon} size={26} tone={look.ink} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" tone={tone === 'info' ? 'text' : look.ink}>
          {title}
        </Text>
        {typeof children === 'string' ? <Text variant="label" tone="text">{children}</Text> : children}
      </View>
      {onPress ? <Icon name="chevron-forward" size={22} tone="textMuted" /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      {body}
    </Pressable>
  );
}

/** A small status tag: "Waiting to send", "High". */
export function Pill({ label, tone = 'info', icon }: { label: string; tone?: Tone | 'neutral'; icon?: IconName }) {
  const { colors } = useTheme();
  const look =
    tone === 'neutral'
      ? { fill: colors.sunken, ink: 'textSecondary' as const }
      : { fill: colors[LOOK[tone].fill], ink: LOOK[tone].ink };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        paddingHorizontal: space.sm + 2,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: look.fill,
      }}
    >
      {icon ? <Icon name={icon} size={14} tone={look.ink} /> : null}
      <Text variant="caption" tone={look.ink} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}
