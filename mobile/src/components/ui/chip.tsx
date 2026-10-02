import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { radius, space, TOUCH, useTheme } from '@/theme';
import { Icon } from './icon';
import { Text } from './text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Drawn before the label; a weather glyph, say. */
  leading?: ReactNode;
  accessibilityHint?: string;
}

/** A big, pill-shaped toggle. Selected chips carry a tick as well as colour. */
export function Chip({ label, selected, onPress, leading, accessibilityHint }: ChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH,
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? colors.brand : colors.hairline,
        backgroundColor: selected ? colors.brandSoft : colors.surfaceRaised,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {selected ? <Icon name="checkmark" size={20} tone="brandStrong" /> : leading}
      <Text variant="bodyStrong" tone={selected ? 'brandStrong' : 'text'} style={{ fontSize: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; tone?: 'good' | 'warning' | 'critical' }[];
  onChange: (value: T) => void;
}

/** One choice out of a few, as equal-width buttons: severity, for instance. */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', gap: space.xs, backgroundColor: colors.sunken, borderRadius: radius.md, padding: space.xs }}
    >
      {options.map((o) => {
        const on = o.value === value;
        const fill = on ? (o.tone ? colors[o.tone] : colors.brand) : 'transparent';
        const ink = on ? (o.tone === 'warning' ? '#0b0b0b' : '#ffffff') : colors.text;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: TOUCH,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: fill,
            }}
          >
            <Text variant="bodyStrong" style={{ color: ink, fontSize: 16 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
