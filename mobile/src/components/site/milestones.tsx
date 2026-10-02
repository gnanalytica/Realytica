import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Icon, PercentPicker, Pill, ProgressBar, Sheet, Text, Ticker, Touchable } from '@/components/ui';
import { dayLabel, localDate } from '@/lib/format';
import type { Milestone } from '@/lib/types';
import { space, TOUCH } from '@/theme';

interface RowProps {
  milestone: Milestone;
  /** A change waiting in the outbox, shown in place of the server's figure. */
  pendingPercent?: number;
  onPress?: () => void;
}

/** Written with as many decimals as the final figure, so it does not change width as it ticks. */
function percentOf(final: number) {
  return (n: number) => `${n.toFixed(Number.isInteger(final) ? 0 : 1)}%`;
}

export function MilestoneRow({ milestone, pendingPercent, onPress }: RowProps) {
  const shown = pendingPercent ?? milestone.percent;
  const today = localDate();
  const done = shown >= 100;
  const late = !!milestone.plannedFinish && milestone.plannedFinish < today && !done;
  const body = (
    <View style={{ gap: space.sm, paddingVertical: space.md, minHeight: TOUCH }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {done ? <Icon name="checkmark-circle" size={20} tone="goodText" /> : null}
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
          {milestone.name}
        </Text>
        <Ticker value={shown} format={percentOf(shown)} variant="bodyStrong" mono tone={done ? 'goodText' : 'text'} />
        {onPress ? <Icon name="chevron-forward" size={20} tone="textMuted" /> : null}
      </View>
      <ProgressBar percent={shown} tone={late ? 'warning' : undefined} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        {pendingPercent != null ? <Pill label={`Waiting to send · was ${milestone.percent}%`} tone="warning" live /> : null}
        {late ? <Pill label={`Late · due ${dayLabel(milestone.plannedFinish!)}`} tone="warning" icon="time-outline" /> : null}
        {!late && milestone.plannedFinish && !done ? <Text variant="caption">Due {dayLabel(milestone.plannedFinish)}</Text> : null}
        {milestone.completedOn && done ? <Text variant="caption">Done {dayLabel(milestone.completedOn)}</Text> : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${milestone.name}, ${shown} percent. Change`}
      onPress={onPress}
      pressScale={0.985}
      pressOpacity={0.8}
    >
      {body}
    </Touchable>
  );
}

interface SheetProps {
  milestone: Milestone | null;
  /** Where it stands now, including any change still waiting to send. Drawn as "Was …". */
  current: number;
  /** Where the slider starts, when that differs from `current` (a change already made in this form). */
  initial?: number;
  onClose: () => void;
  onSave: (percent: number) => void;
  saveLabel?: string;
}

/** Set one milestone's percentage: slider, ±5 and presets, then Save. */
export function MilestoneSheet({ milestone, current, initial, onClose, onSave, saveLabel = 'Save' }: SheetProps) {
  const open = initial ?? current;
  // What the sheet showed while open, kept as it slides away (by then `milestone` is already null).
  const [held, setHeld] = useState({ milestone, current, open });
  if (milestone && (milestone !== held.milestone || current !== held.current || open !== held.open)) setHeld({ milestone, current, open });
  const shown = milestone ?? held.milestone;
  const from = milestone ? current : held.current;
  const start = milestone ? open : held.open;

  const [value, setValue] = useState(start);
  // Each time the sheet opens on a milestone, start from that milestone's figure.
  useEffect(() => {
    if (milestone) setValue(open);
  }, [open, milestone?.id]);

  return (
    <Sheet
      visible={!!milestone}
      title={shown?.name ?? ''}
      onClose={onClose}
      footer={
        <Button
          title={value === start ? 'No change' : `${saveLabel} ${value}%`}
          size="lg"
          disabled={value === start}
          onPress={() => onSave(value)}
        />
      }
    >
      <PercentPicker value={value} onChange={setValue} from={from} />
    </Sheet>
  );
}
