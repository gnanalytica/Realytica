import { useEffect, type ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { PRESS_SPRING } from '@/theme/motion';

// Give it no entering, exiting or layout animation of its own: those belong on a wrapping
// Animated.View, so they never fight the press fade for the same view's opacity.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it gives under the thumb. About 0.97 for buttons; big cards give less. */
  pressScale?: number;
  /** How much it fades while held. */
  pressOpacity?: number;
  /** A background that deepens while held: the action colour and its pressed shade. */
  fill?: string;
  fillPressed?: string;
  /** Felt on a completed press: `tap` for a screen's main action, `tick` for choices and steps. */
  haptic?: 'tap' | 'tick';
  /** Drawn faded. Follows `disabled` unless set: a busy button is disabled but not faded. */
  dimmed?: boolean;
}

/**
 * Every pressable thing in the app. It gives under the thumb on a quick spring
 * and fades a little, so a press is seen even through a dusty screen in
 * sunlight; the haptic comes on release, so a touch that turns into a scroll
 * never buzzes. With Reduce Motion on, only the fade remains.
 */
export function Touchable({
  children,
  style,
  pressScale = 0.97,
  pressOpacity = 0.86,
  fill,
  fillPressed,
  haptic,
  disabled,
  dimmed,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: TouchableProps) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const dim = (dimmed ?? disabled) ? 0.45 : 1;
  const fillRest = fill ?? 'transparent';
  const fillHeld = fillPressed ?? fillRest;
  // A control disabled under the thumb (minus reaching zero while held) may never hear the release.
  useEffect(() => {
    if (disabled) pressed.set(withSpring(0, PRESS_SPRING));
  }, [disabled, pressed]);

  const animated = useAnimatedStyle(() => {
    const p = pressed.get();
    return {
      opacity: dim * interpolate(p, [0, 1], [1, pressOpacity]),
      transform: [{ scale: reduced ? 1 : interpolate(p, [0, 1], [1, pressScale]) }],
      ...(fill ? { backgroundColor: interpolateColor(p, [0, 1], [fillRest, fillHeld]) } : null),
    };
  });

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        pressed.set(withSpring(1, PRESS_SPRING));
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        pressed.set(withSpring(0, PRESS_SPRING));
        onPressOut?.(e);
      }}
      onPress={
        onPress
          ? (e: GestureResponderEvent) => {
              if (haptic === 'tap') haptics.tap();
              else if (haptic === 'tick') haptics.tick();
              onPress(e);
            }
          : undefined
      }
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
