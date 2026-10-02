import { addDays, differenceInCalendarDays } from 'date-fns';
import { View } from 'react-native';

import { Chip, ChipRow, IconButton, Text } from '@/components/ui';
import { localDate, longDay, parseDay } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';

/** How far back an entry can be dated: catching up after a week away, not rewriting history. */
const MAX_DAYS_BACK = 31;

/** The entry's date: Today, Yesterday, or stepped back a day at a time. Never in the future. */
export function DayPicker({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  const { colors } = useTheme();
  const today = localDate();
  const yesterday = localDate(addDays(new Date(), -1));
  const back = differenceInCalendarDays(parseDay(today), parseDay(value));
  const shift = (days: number) => onChange(localDate(addDays(parseDay(value), days)));

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
          backgroundColor: colors.surfaceRaised,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colors.hairline,
        }}
      >
        <IconButton icon="chevron-back" label="A day earlier" onPress={() => shift(-1)} disabled={back >= MAX_DAYS_BACK} size={56} />
        <Text variant="bodyStrong" center style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {longDay(value)}
        </Text>
        <IconButton icon="chevron-forward" label="A day later" onPress={() => shift(1)} disabled={back <= 0} size={56} />
      </View>
    </View>
  );
}
