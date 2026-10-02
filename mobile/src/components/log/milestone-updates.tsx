import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { MilestoneSheet } from '@/components/site/milestones';
import { Icon, IconButton, Pill, Text } from '@/components/ui';
import type { Milestone } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

interface Props {
  milestones: Milestone[];
  updates: { milestoneId: string; percent: number }[];
  onChange: (updates: { milestoneId: string; percent: number }[]) => void;
}

/** Did a milestone move today? Each change is filed with the entry and updates the project's progress. */
export function MilestoneUpdatesEditor({ milestones, updates, onChange }: Props) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<Milestone | null>(null);
  const changed = new Map(updates.map((u) => [u.milestoneId, u.percent]));

  const set = (milestone: Milestone, percent: number) => {
    const rest = updates.filter((u) => u.milestoneId !== milestone.id);
    onChange(percent === milestone.percent ? rest : [...rest, { milestoneId: milestone.id, percent }]);
    setEditing(null);
  };

  return (
    <View style={{ gap: space.sm }}>
      {milestones.map((m) => {
        const next = changed.get(m.id);
        return (
          <View
            key={m.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: radius.md,
              backgroundColor: next != null ? colors.brandSoft : colors.surfaceRaised,
              borderWidth: 1.5,
              borderColor: next != null ? colors.brand : colors.hairline,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${m.name}, at ${m.percent} percent${next != null ? `, changing to ${next}` : ''}. Change`}
              onPress={() => setEditing(m)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                minHeight: 56,
                paddingLeft: space.md,
                paddingRight: next != null ? 0 : space.md,
                paddingVertical: space.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {m.name}
                </Text>
                {next != null ? <Pill label={`${m.percent}% → ${next}%`} tone="info" /> : <Text variant="caption">At {m.percent}%</Text>}
              </View>
              {next == null ? <Icon name="chevron-forward" size={20} tone="textMuted" /> : null}
            </Pressable>
            {/* Beside the row, not inside it, so it is a control of its own. */}
            {next != null ? <IconButton icon="close" label={`Undo the change to ${m.name}`} tone="textMuted" onPress={() => set(m, m.percent)} /> : null}
          </View>
        );
      })}
      <MilestoneSheet
        milestone={editing}
        current={editing ? editing.percent : 0}
        initial={editing ? changed.get(editing.id) : undefined}
        saveLabel="Set to"
        onClose={() => setEditing(null)}
        onSave={(percent) => editing && set(editing, percent)}
      />
    </View>
  );
}
