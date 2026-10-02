import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Icon, PercentPicker, Pill, ProgressBar, Sheet, Text } from '@/components/ui';
import { dayLabel, localDate } from '@/lib/format';
import type { Milestone } from '@/lib/types';
import { space, TOUCH } from '@/theme';

interface RowProps {
  milestone: Milestone;
  /** A change waiting in the outbox, shown in place of the server's figure. */
  pendingPercent?: number;
  onPress?: () => void;
}

export function MilestoneRow({ milestone, pendingPercent, onPress }: RowProps) {
  const shown = pendingPercent ?? milestone.percent;
  const today = localDate();
  const late = !!milestone.plannedFinish && milestone.plannedFinish < today && shown < 100;
  const body = (
    <View style={{ gap: space.sm, paddingVertical: space.md, minHeight: TOUCH }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
          {milestone.name}
        </Text>
        <Text variant="bodyStrong" tabular tone={shown >= 100 ? 'goodText' : 'text'}>
          {shown}%
        </Text>
        {onPress ? <Icon name="chevron-forward" size={20} tone="textMuted" /> : null}
      </View>
      <ProgressBar percent={shown} tone={late ? 'warning' : undefined} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        {pendingPercent != null ? <Pill label={`Waiting to send · was ${milestone.percent}%`} tone="warning" /> : null}
        {late ? <Pill label={`Late · due ${dayLabel(milestone.plannedFinish!)}`} tone="warning" icon="time-outline" /> : null}
        {!late && milestone.plannedFinish && shown < 100 ? <Text variant="caption">Due {dayLabel(milestone.plannedFinish)}</Text> : null}
        {milestone.completedOn && shown >= 100 ? <Text variant="caption">Done {dayLabel(milestone.completedOn)}</Text> : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${milestone.name}, ${shown} percent. Change`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
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
  const start = initial ?? current;
  const [value, setValue] = useState(start);
  // Each time the sheet opens on a milestone, start from that milestone's figure.
  useEffect(() => setValue(start), [start, milestone?.id]);
  return (
    <Sheet
      visible={!!milestone}
      title={milestone?.name ?? ''}
      onClose={onClose}
      footer={
        <Button title={value === start ? 'No change' : `${saveLabel} ${value}%`} size="lg" disabled={value === start} onPress={() => onSave(value)} />
      }
    >
      <PercentPicker value={value} onChange={setValue} from={current} />
    </Sheet>
  );
}
