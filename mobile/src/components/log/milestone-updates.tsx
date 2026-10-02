import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { MilestoneSheet } from '@/components/site/milestones';
import { Icon, IconButton, Pill, Text, Touchable } from '@/components/ui';
import type { Milestone } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';
import { appear, pop } from '@/theme/motion';

interface Props {
  milestones: Milestone[];
  updates: { milestoneId: string; percent: number }[];
  onChange: (updates: { milestoneId: string; percent: number }[]) => void;
}

/** Did a milestone move today? Each change is filed with the entry and updates the project's progress. */
export function MilestoneUpdatesEditor({ milestones, updates, onChange }: Props) {
  const { colors, shadow } = useTheme();
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
              borderRadius: radius.lg,
              backgroundColor: next != null ? colors.brandSoft : colors.surface,
              borderWidth: 1.5,
              borderColor: next != null ? colors.brand : colors.hairline,
              boxShadow: next != null ? undefined : shadow.card,
            }}
          >
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={`${m.name}, at ${m.percent} percent${next != null ? `, changing to ${next}` : ''}. Change`}
              onPress={() => setEditing(m)}
              pressScale={0.985}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                minHeight: 56,
                paddingLeft: space.md,
                paddingRight: next != null ? 0 : space.md,
                paddingVertical: space.sm,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {m.name}
                </Text>
                {next != null ? (
                  // Keyed by the new figure, so each change pops in.
                  <Animated.View key={next} entering={pop()}>
                    <Pill label={`${m.percent}% → ${next}%`} tone="info" icon="trending-up" />
                  </Animated.View>
                ) : (
                  <Text variant="caption">
                    At{' '}
                    <Text variant="caption" mono>
                      {m.percent}%
                    </Text>
                  </Text>
                )}
              </View>
              {next == null ? <Icon name="chevron-forward" size={20} tone="textMuted" /> : null}
            </Touchable>
            {/* Beside the row, not inside it, so it is a control of its own. */}
            {next != null ? (
              <Animated.View entering={appear}>
                <IconButton icon="close" label={`Undo the change to ${m.name}`} tone="textMuted" onPress={() => set(m, m.percent)} />
              </Animated.View>
            ) : null}
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
