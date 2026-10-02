import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { STAGE_PHASES, stagePosition } from '@/lib/stages';
import { radius, useTheme } from '@/theme';

/**
 * Where a project is in its lifecycle, as a segmented track: twelve stages in
 * four phases, the ones behind it filled in teal, the current one darker and
 * a little taller. The fill sweeps left to right as the card arrives. A stage
 * this app does not know draws nothing rather than a wrong position.
 */
export function StageTrack({ stage, delay = 0 }: { stage: string; delay?: number }) {
  const { colors } = useTheme();
  const at = stagePosition(stage);
  if (!at) return null;

  // Where each phase starts in the lifecycle, so every segment knows its own place.
  const starts = STAGE_PHASES.map((_, p) => STAGE_PHASES.slice(0, p).reduce((sum, phase) => sum + phase.length, 0));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Stage ${at.index + 1} of ${at.of}`}
      accessibilityValue={{ min: 1, max: at.of, now: at.index + 1 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 10 }}
    >
      {STAGE_PHASES.map((phase, p) => (
        <View key={p} style={{ flex: phase.length, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          {phase.map((key, j) => {
            const i = starts[p] + j;
            const reached = i <= at.index;
            const current = i === at.index;
            return (
              <View key={key} style={{ flex: 1, height: current ? 10 : 6, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: 'hidden' }}>
                {reached ? (
                  <Animated.View
                    entering={FadeIn.duration(200)
                      .delay(delay + i * 28)
                      .reduceMotion(ReduceMotion.System)}
                    style={{ flex: 1, backgroundColor: current ? colors.brandStrong : colors.brand }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
