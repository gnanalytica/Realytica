import { useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, View, type LayoutChangeEvent } from 'react-native';

import { radius, space, TOUCH, useTheme } from '@/theme';
import { Text } from './text';

const STEP = 5;

function snap(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value / STEP) * STEP));
}

interface PercentPickerProps {
  value: number;
  onChange: (value: number) => void;
  /** Where it stood before, drawn as a faint mark on the track. */
  from?: number;
}

/**
 * Setting a milestone's percentage: a big number, a slider that snaps to 5%,
 * minus/plus 5 buttons and one-tap presets. The slider is hand-built on
 * PanResponder (no extra native dependency) with a 56pt-tall touch strip, so a
 * gloved thumb that lands a little off the track still moves it.
 */
export function PercentPicker({ value, onChange, from }: PercentPickerProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  // The responder is created once; it reads the latest width and callback from refs.
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });
  const startX = useRef(0);

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the gesture even if a parent scroll view would like it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        if (widthRef.current > 0) onChangeRef.current(snap((startX.current / widthRef.current) * 100));
      },
      onPanResponderMove: (_e, g) => {
        if (widthRef.current > 0) onChangeRef.current(snap(((startX.current + g.dx) / widthRef.current) * 100));
      },
    }),
  );

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const stepButton = (label: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? 'Add' : 'Take off'} ${STEP} percent`}
      onPress={() => onChange(snap(value + delta))}
      disabled={(delta < 0 && value <= 0) || (delta > 0 && value >= 100)}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.brandSoft,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant="heading" tone="brandStrong">
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ gap: space.lg }}>
      <Text variant="display" center tabular accessibilityLiveRegion="polite">
        {value}%
      </Text>

      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Percent complete"
        accessibilityValue={{ min: 0, max: 100, now: value, text: `${value} percent` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? STEP : -STEP)))}
        onLayout={onLayout}
        style={{ height: 56, justifyContent: 'center' }}
        {...responder.panHandlers}
      >
        {/* Children ignore touches so locationX is always measured against this strip. */}
        <View style={{ pointerEvents: 'none', height: 14, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: 'hidden' }}>
          <View style={{ width: `${value}%`, height: '100%', backgroundColor: value >= 100 ? colors.good : colors.brand }} />
        </View>
        {from != null && width > 0 ? (
          <View
            style={{ pointerEvents: 'none', position: 'absolute', left: (from / 100) * width - 1.5, width: 3, height: 26, borderRadius: 2, backgroundColor: colors.textMuted }}
          />
        ) : null}
        {width > 0 ? (
          <View
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              left: (value / 100) * width - 18,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.surfaceRaised,
              borderWidth: 4,
              borderColor: value >= 100 ? colors.good : colors.brand,
            }}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: space.md }}>
        {stepButton(`−${STEP}`, -STEP)}
        {stepButton(`+${STEP}`, STEP)}
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {[0, 25, 50, 75, 100].map((preset) => {
          const on = preset === value;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${preset} percent`}
              onPress={() => onChange(preset)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: TOUCH,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: on ? colors.brand : colors.hairline,
                backgroundColor: on ? colors.brandSoft : colors.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="bodyStrong" tone={on ? 'brandStrong' : 'text'} style={{ fontSize: 16 }}>
                {preset === 100 ? 'Done' : `${preset}%`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {from != null ? (
        <Text variant="label" center>
          Was {from}%{value !== from ? ` · ${value > from ? '+' : '−'}${Math.abs(value - from)}` : ''}
        </Text>
      ) : null}
    </View>
  );
}
