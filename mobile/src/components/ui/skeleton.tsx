import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { radius, useTheme } from '@/theme';

const Pulse = createContext<SharedValue<number> | null>(null);

/**
 * The shape of a screen before its data arrives. Every block in the group
 * breathes on one shared pulse, so the page glows as one rather than
 * flickering block by block. With Reduce Motion on, the blocks keep still.
 * Screen readers hear one "Loading" for the whole group.
 */
export function SkeletonGroup({ label, children, style }: { label: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);
  return (
    <Pulse.Provider value={pulse}>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
        {children}
      </View>
    </Pulse.Provider>
  );
}

/** One grey block: a line of text, a ring, a button. */
export function Bone({ width = '100%', height = 14, round, style }: { width?: DimensionValue; height?: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const pulse = useContext(Pulse);
  const breathe = useAnimatedStyle(() => ({ opacity: pulse ? 1 - 0.45 * pulse.get() : 1 }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: round ? radius.pill : Math.min(radius.sm, height / 2), backgroundColor: colors.sunken }, breathe, style]}
    />
  );
}
