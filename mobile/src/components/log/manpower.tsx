import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, ChipRow, Field, Icon, IconButton, Stepper, Text } from '@/components/ui';
import type { DraftManpower } from '@/lib/drafts';
import { plural } from '@/lib/format';
import { newId } from '@/lib/ids';
import { TRADES } from '@/lib/site-options';
import { radius, space, useTheme } from '@/theme';

/** The API keeps at most 40 trades per entry. */
const MAX_ROWS = 40;

interface Props {
  rows: DraftManpower[];
  onChange: (rows: DraftManpower[]) => void;
}

/**
 * Who was on site, by trade. Tap a trade to add it with one person, then use
 * the big minus and plus (or type the number). Any trade not in the list can
 * be typed in.
 */
export function ManpowerEditor({ rows, onChange }: Props) {
  const { colors } = useTheme();
  const [other, setOther] = useState('');
  const total = rows.reduce((n, r) => n + r.count, 0);
  const has = (trade: string) => rows.some((r) => r.trade.toLowerCase() === trade.toLowerCase());

  const add = (trade: string) => {
    const name = trade.trim().slice(0, 60);
    if (!name || has(name) || rows.length >= MAX_ROWS) return;
    onChange([...rows, { key: newId(), trade: name, count: 1 }]);
  };
  const setCount = (key: string, count: number) => onChange(rows.map((r) => (r.key === key ? { ...r, count } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const available = TRADES.filter((t) => !has(t));

  return (
    <View style={{ gap: space.md }}>
      {rows.map((r) => (
        <View
          key={r.key}
          style={{
            gap: space.xs,
            paddingLeft: space.md,
            paddingRight: space.xs,
            paddingBottom: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.hairline,
          }}
        >
          {/* Two lines rather than one, so "Electrician" never has to share a narrow phone with the stepper. */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {r.trade}
            </Text>
            <IconButton icon="close" label={`Remove ${r.trade}`} tone="textMuted" onPress={() => remove(r.key)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Stepper value={r.count} onChange={(n) => setCount(r.key, n)} label={r.trade} />
            <Text variant="label">{r.count === 1 ? 'person' : 'people'}</Text>
          </View>
        </View>
      ))}

      {rows.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="people" size={20} tone="brandStrong" />
          <Text variant="bodyStrong" tone="brandStrong">
            {plural(total, 'person', 'people')} on site
          </Text>
        </View>
      ) : null}

      {available.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="label">{rows.length ? 'Add another trade' : 'Tap a trade to add it'}</Text>
          <ChipRow>
            {available.map((t) => (
              <Chip key={t} label={t} onPress={() => add(t)} leading={<Icon name="add" size={20} tone="textSecondary" />} />
            ))}
          </ChipRow>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <Field
          containerStyle={{ flex: 1 }}
          label="Another trade"
          value={other}
          onChangeText={setOther}
          placeholder="e.g. Tiler, Crane operator"
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => {
            add(other);
            setOther('');
          }}
        />
        <Button
          title="Add"
          variant="secondary"
          block={false}
          disabled={!other.trim() || has(other.trim())}
          onPress={() => {
            add(other);
            setOther('');
          }}
        />
      </View>
    </View>
  );
}
