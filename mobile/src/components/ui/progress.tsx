import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { radius, useTheme } from '@/theme';
import { FILL } from '@/theme/motion';
import { Text } from './text';
import { Ticker } from './ticker';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** A 0..100 figure that runs to its value: from nothing on first draw, then from wherever it was. */
function useFill(value: number) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(reduced ? value : 0);
  useEffect(() => {
    shown.set(withTiming(value, FILL));
  }, [shown, value]);
  return shown;
}

interface RingProps {
  /** 0..100, or null when there is nothing to measure yet. */
  percent: number | null;
  size?: number;
  stroke?: number;
}

/** Overall progress as a ring with the number in the middle. The ring sweeps and the number counts up as it opens. */
export function ProgressRing({ percent, size = 148, stroke = 14 }: RingProps) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const value = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const done = value >= 100;
  const shown = useFill(value);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - shown.get() / 100) }));
  const big = size > 120;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={percent == null ? 'No progress recorded yet' : `${formatPercent(value)} percent complete`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.sunken} strokeWidth={stroke} fill="none" />
        {value > 0 ? (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={done ? colors.good : colors.brand}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={arc}
            // Start at twelve o'clock rather than three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {percent == null ? (
        <Text variant="display" mono style={{ fontSize: big ? 34 : 22, lineHeight: big ? 40 : 26 }}>
          —
        </Text>
      ) : (
        <Ticker
          value={value}
          from={0}
          // As many decimals on the way as at the end, so the figure does not change width as it runs.
          format={(n) => `${n.toFixed(Number.isInteger(value) ? 0 : 1)}%`}
          variant="display"
          mono
          style={{ fontSize: big ? 32 : 20, lineHeight: big ? 38 : 24, letterSpacing: -0.5 }}
        />
      )}
      {percent != null && big ? (
        <Text variant="caption" tone="textSecondary">
          complete
        </Text>
      ) : null}
    </View>
  );
}

/** One milestone's progress as a thick bar that fills to its value. */
export function ProgressBar({ percent, tone, height = 10 }: { percent: number; tone?: 'brand' | 'good' | 'warning' | 'ai'; height?: number }) {
  const { colors } = useTheme();
  const value = Math.max(0, Math.min(100, percent));
  const fill = tone ? colors[tone] : value >= 100 ? colors.good : colors.brand;
  const shown = useFill(value);
  const bar = useAnimatedStyle(() => ({ width: `${shown.get()}%` }));
  return (
    <View style={{ height, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', borderRadius: radius.pill, backgroundColor: fill }, bar]} />
    </View>
  );
}

/** 37.5 → "37.5", 40 → "40": the API reports progress to one decimal place. */
export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
