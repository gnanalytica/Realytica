import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

/**
 * A small status dot. With `pulse`, a ring breathes out of it: something is
 * happening right now (sending, checking, finding a location). With Reduce
 * Motion on, the dot just sits there.
 */
export function StatusDot({ color, size = 8, pulse }: { color: string; size?: number; pulse?: boolean }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  const live = !!pulse && !reduced;

  useEffect(() => {
    if (!live) return;
    t.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
    return () => {
      cancelAnimation(t);
      t.set(0);
    };
  }, [live, t]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - t.get()),
    transform: [{ scale: 1 + t.get() * 1.8 }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {live ? (
        <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ring]} />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** Turns its child steadily while `active`: a sync arrow while something is on its way. */
export function Spin({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  const live = active && !reduced;

  useEffect(() => {
    if (!live) return;
    turn.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(turn);
      turn.set(0);
    };
  }, [live, turn]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
