import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { radius, useTheme } from '@/theme';
import { Text } from './text';

interface RingProps {
  /** 0..100, or null when there is nothing to measure yet. */
  percent: number | null;
  size?: number;
  stroke?: number;
}

/** Overall progress as a ring with the number in the middle. */
export function ProgressRing({ percent, size = 148, stroke = 14 }: RingProps) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const value = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const done = value >= 100;
  const label = percent == null ? '—' : `${formatPercent(value)}%`;

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
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={done ? colors.good : colors.brand}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - value / 100)}
            // Start at twelve o'clock rather than three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <Text variant="display" tabular style={{ fontSize: size > 120 ? 36 : 22, lineHeight: size > 120 ? 42 : 26 }}>
        {label}
      </Text>
      {percent != null ? (
        <Text variant="caption" tone="textSecondary">
          complete
        </Text>
      ) : null}
    </View>
  );
}

/** One milestone's progress as a thick bar. */
export function ProgressBar({ percent, tone }: { percent: number; tone?: 'brand' | 'good' | 'warning' }) {
  const { colors } = useTheme();
  const value = Math.max(0, Math.min(100, percent));
  const fill = tone ? colors[tone] : value >= 100 ? colors.good : colors.brand;
  return (
    <View style={{ height: 10, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: 'hidden' }}>
      <View style={{ width: `${value}%`, height: '100%', borderRadius: radius.pill, backgroundColor: fill }} />
    </View>
  );
}

/** 37.5 → "37.5", 40 → "40": the API reports progress to one decimal place. */
export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
