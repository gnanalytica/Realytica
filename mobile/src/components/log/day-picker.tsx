import { addDays, differenceInCalendarDays } from 'date-fns';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, ReduceMotion } from 'react-native-reanimated';

import { Chip, ChipRow, IconButton, Text } from '@/components/ui';
import { localDate, longDay, parseDay } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';
import { travel } from '@/theme/motion';

/** How far back an entry can be dated: catching up after a week away, not rewriting history. */
const MAX_DAYS_BACK = 31;

const FROM_LEFT = travel(FadeInLeft.duration(200), { opacity: 0, transform: [{ translateX: -16 }] }).reduceMotion(ReduceMotion.System);
const FROM_RIGHT = travel(FadeInRight.duration(200), { opacity: 0, transform: [{ translateX: 16 }] }).reduceMotion(ReduceMotion.System);

/**
 * The entry's date: Today, Yesterday, or stepped back a day at a time. Never
 * in the future. The date slides in from the side it moved towards, so a
 * thumb stepping back through the week feels the calendar turn.
 */
export function DayPicker({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  const { colors } = useTheme();
  const today = localDate();
  const yesterday = localDate(addDays(new Date(), -1));
  const back = differenceInCalendarDays(parseDay(today), parseDay(value));
  const shift = (days: number) => onChange(localDate(addDays(parseDay(value), days)));
  // Which way the date last moved ('YYYY-MM-DD' compares in calendar order).
  const [moved, setMoved] = useState({ value, dir: 0 });
  if (moved.value !== value) setMoved({ value, dir: value > moved.value ? 1 : -1 });

  return (
    <View style={{ gap: space.md }}>
      <ChipRow>
        <Chip label="Today" selected={value === today} onPress={() => onChange(today)} />
        <Chip label="Yesterday" selected={value === yesterday} onPress={() => onChange(yesterday)} />
      </ChipRow>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colors.hairline,
          overflow: 'hidden',
        }}
      >
        <IconButton icon="chevron-back" label="A day earlier" onPress={() => shift(-1)} disabled={back >= MAX_DAYS_BACK} size={56} haptic="tick" />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Animated.View key={value} entering={moved.dir === 0 ? undefined : moved.dir > 0 ? FROM_RIGHT : FROM_LEFT}>
            <Text variant="bodyStrong" center accessibilityLiveRegion="polite">
              {longDay(value)}
            </Text>
            {back >= 2 ? (
              <Text variant="caption" center>
                <Text variant="caption" mono>
                  {back}
                </Text>{' '}
                days ago
              </Text>
            ) : null}
          </Animated.View>
        </View>
        <IconButton icon="chevron-forward" label="A day later" onPress={() => shift(1)} disabled={back <= 0} size={56} haptic="tick" />
      </View>
    </View>
  );
}
