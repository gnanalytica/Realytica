import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { face, radius, space, useTheme } from '@/theme';
import { SETTLE_SPRING } from '@/theme/motion';
import { Icon } from './icon';
import { Touchable } from './touchable';

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Read aloud with the number: "Masons, 4". */
  label: string;
}

/** How long a thumb rests on minus or plus before it starts repeating, and how fast it then goes. */
const HOLD_MS = 350;
const REPEAT_MS = 90;

/**
 * A count with big minus and plus buttons either side. Each step ticks under
 * the thumb and the number gives a small bounce; holding a button keeps
 * counting. The number itself can also be typed, because tapping plus forty
 * times for forty helpers is no one's job.
 */
export function Stepper({ value, onChange, min = 0, max = 5000, label }: StepperProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  const set = (n: number) => onChange(clamp(n));

  // The number bounces when it changes, not when it first appears.
  const bump = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!reduced) bump.set(withSequence(withTiming(1.14, { duration: 70 }), withSpring(1, SETTLE_SPRING)));
  }, [bump, reduced, value]);
  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: bump.get() }] }));

  // Holding a button: count from where the hold began, so repeats never wait on a re-render.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = useRef(value);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const hold = (delta: number) => {
    running.current = value;
    stop();
    const step = () => {
      const next = clamp(running.current + delta);
      if (next === running.current) return stop();
      running.current = next;
      haptics.tick();
      onChange(next);
    };
    step();
    timer.current = setInterval(step, REPEAT_MS);
  };

  const button = (icon: 'remove' | 'add', delta: number, disabled: boolean) => (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? 'One more' : 'One fewer'}: ${label}`}
      accessibilityHint="Hold to keep counting"
      disabled={disabled}
      onPress={() => set(value + delta)}
      onLongPress={() => hold(delta)}
      delayLongPress={HOLD_MS}
      onPressOut={stop}
      haptic="tick"
      pressScale={0.92}
      hitSlop={4}
      style={{
        width: 52,
        height: 52,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.brandSoft,
      }}
    >
      <Icon name={icon} size={28} tone="brandStrong" />
    </Touchable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {button('remove', -1, value <= min)}
      <Animated.View style={bounce}>
        <TextInput
          accessibilityLabel={label}
          value={text}
          onChangeText={(t) => {
            const digits = t.replace(/[^0-9]/g, '');
            setText(digits);
            if (digits) set(Number(digits));
          }}
          onBlur={() => setText(String(value))}
          keyboardType="number-pad"
          selectTextOnFocus
          maxLength={4}
          // Four digits in a box of fixed size; past this they no longer fit it.
          maxFontSizeMultiplier={1.3}
          selectionColor={colors.brand}
          style={[
            face('500', true),
            {
              fontSize: 21,
              width: 68,
              height: 52,
              textAlign: 'center',
              color: colors.text,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: colors.hairline,
              backgroundColor: colors.surfaceRaised,
            },
          ]}
        />
      </Animated.View>
      {button('add', 1, value >= max)}
    </View>
  );
}
