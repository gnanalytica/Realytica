import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { radius, space, TOUCH, useTheme } from '@/theme';
import { PRESS_SPRING, SETTLE_SPRING } from '@/theme/motion';
import { Text } from './text';
import { Ticker } from './ticker';
import { Touchable } from './touchable';

const STEP = 5;
const THUMB = 36;

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
 * gloved thumb that lands a little off the track still moves it. Each 5% step
 * ticks under the thumb like a detent; the thumb swells while held and glides
 * to a preset when one is tapped.
 */
export function PercentPicker({ value, onChange, from }: PercentPickerProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  // The responder is created once; it reads the latest width, value and callback from refs.
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });
  const startX = useRef(0);

  const at = useSharedValue(value);
  const held = useSharedValue(0);
  const dragging = useRef(false);
  useEffect(() => {
    // Under the thumb, follow closely; from a button or preset, glide.
    at.set(withSpring(value, dragging.current ? PRESS_SPRING : SETTLE_SPRING));
  }, [at, value]);

  const [responder] = useState(() => {
    const moveTo = (x: number) => {
      if (widthRef.current <= 0) return;
      const next = snap((x / widthRef.current) * 100);
      if (next === valueRef.current) return;
      valueRef.current = next;
      haptics.tick();
      onChangeRef.current(next);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the gesture even if a parent scroll view would like it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        dragging.current = true;
        held.set(withSpring(1, PRESS_SPRING));
        startX.current = e.nativeEvent.locationX;
        moveTo(startX.current);
      },
      onPanResponderMove: (_e, g) => moveTo(startX.current + g.dx),
      onPanResponderRelease: () => {
        dragging.current = false;
        held.set(withSpring(0, PRESS_SPRING));
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        held.set(withSpring(0, PRESS_SPRING));
      },
    });
  });

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const done = value >= 100;
  const fillStyle = useAnimatedStyle(() => ({ width: `${at.get()}%` }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (at.get() / 100) * width - THUMB / 2 }, { scale: reduced ? 1 : 1 + held.get() * 0.18 }],
  }));

  const stepButton = (label: string, delta: number) => (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? 'Add' : 'Take off'} ${STEP} percent`}
      onPress={() => onChange(snap(value + delta))}
      disabled={(delta < 0 && value <= 0) || (delta > 0 && value >= 100)}
      haptic="tick"
      style={{
        flex: 1,
        minHeight: 56,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.brandSoft,
      }}
    >
      <Text variant="heading" mono tone="brandStrong">
        {label}
      </Text>
    </Touchable>
  );

  return (
    <View style={{ gap: space.lg }}>
      <Ticker
        value={value}
        duration={220}
        format={(n) => `${Math.round(n)}%`}
        variant="display"
        mono
        center
        tone={done ? 'goodText' : 'text'}
        style={{ fontSize: 48, lineHeight: 56, letterSpacing: -1 }}
        accessibilityLiveRegion="polite"
      />

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
          <Animated.View style={[{ height: '100%', borderRadius: radius.pill, backgroundColor: done ? colors.good : colors.brand }, fillStyle]} />
        </View>
        {from != null && width > 0 ? (
          <View
            style={{ pointerEvents: 'none', position: 'absolute', left: (from / 100) * width - 1.5, width: 3, height: 26, borderRadius: 2, backgroundColor: colors.textMuted }}
          />
        ) : null}
        {width > 0 ? (
          <Animated.View
            style={[
              {
                pointerEvents: 'none',
                position: 'absolute',
                left: 0,
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: colors.surface,
                borderWidth: 4,
                borderColor: done ? colors.good : colors.brand,
                boxShadow: '0px 2px 6px rgba(21, 23, 26, 0.18)',
              },
              thumbStyle,
            ]}
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
            <Touchable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${preset} percent`}
              onPress={() => onChange(preset)}
              haptic="tick"
              style={{
                flex: 1,
                minHeight: TOUCH,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: on ? colors.brand : colors.hairline,
                backgroundColor: on ? colors.brandSoft : colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="bodyStrong" mono={preset !== 100} tone={on ? 'brandStrong' : 'text'} style={{ fontSize: 16 }}>
                {preset === 100 ? 'Done' : `${preset}%`}
              </Text>
            </Touchable>
          );
        })}
      </View>
      {from != null ? (
        <Text variant="label" center>
          Was <Text variant="label" mono>{from}%</Text>
          {value !== from ? (
            <Text variant="label" mono tone={value > from ? 'goodText' : 'textSecondary'}>
              {` · ${value > from ? '+' : '−'}${Math.abs(value - from)}`}
            </Text>
          ) : null}
        </Text>
      ) : null}
    </View>
  );
}
