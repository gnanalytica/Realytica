import { useEffect, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { radius, space, TOUCH, useTheme } from '@/theme';
import { leave, pop, reflow, SETTLE_SPRING } from '@/theme/motion';
import { Icon } from './icon';
import { Text } from './text';
import { Touchable } from './touchable';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Drawn before the label; a weather glyph, say. */
  leading?: ReactNode;
  accessibilityHint?: string;
}

/**
 * A big, pill-shaped toggle. Selected chips carry a tick as well as colour,
 * and the tick pops in, so the change is felt (a haptic tick) and seen.
 * Chips glide when a neighbour grows, shrinks or leaves.
 */
export function Chip({ label, selected, onPress, leading, accessibilityHint }: ChipProps) {
  const { colors } = useTheme();
  return (
    // The glide lives on a wrapper: layout animations and the press fade must not drive the same view.
    <Animated.View layout={reflow} exiting={leave}>
      <Touchable
        accessibilityRole="button"
        accessibilityState={{ selected: !!selected }}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        haptic="tick"
        style={{
          minHeight: TOUCH,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          borderWidth: 1.5,
          borderColor: selected ? colors.brand : colors.hairline,
          backgroundColor: selected ? colors.brandSoft : colors.surface,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        }}
      >
        {selected ? (
          <Animated.View entering={pop()}>
            <Icon name="checkmark" size={20} tone="brandStrong" />
          </Animated.View>
        ) : (
          leading
        )}
        <Text variant="bodyStrong" tone={selected ? 'brandStrong' : 'text'} style={{ fontSize: 16 }}>
          {label}
        </Text>
      </Touchable>
    </Animated.View>
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

const TRACK_PAD = space.xs;

/**
 * One choice out of a few, as equal-width segments: severity, for instance.
 * A white thumb glides to the chosen one; a coloured dot beside each label
 * carries the tone, so colour is never the only signal.
 */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  const { colors, shadow } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width > 0 ? (width - TRACK_PAD * 2) / options.length : 0;
  const at = useSharedValue(index);
  // Glide to the chosen segment whenever it changes; before the first layout, just be there.
  useEffect(() => {
    at.set(width > 0 ? withSpring(index, SETTLE_SPRING) : index);
  }, [at, index, width]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: at.get() * segment }] }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityRole="radiogroup"
      onLayout={onLayout}
      style={{ flexDirection: 'row', backgroundColor: colors.sunken, borderRadius: radius.md, padding: TRACK_PAD }}
    >
      {segment > 0 ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: TRACK_PAD,
              bottom: TRACK_PAD,
              left: TRACK_PAD,
              width: segment,
              borderRadius: radius.sm,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              boxShadow: shadow.card,
            },
            thumb,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Touchable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            haptic="tick"
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: TOUCH, flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center' }}
          >
            {o.tone ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors[o.tone] }} /> : null}
            {/* Equal shares of one row: the word grows only as far as its share holds. */}
            <Text variant="bodyStrong" tone={on ? 'text' : 'textSecondary'} maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ fontSize: 16, flexShrink: 1 }}>
              {o.label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}
