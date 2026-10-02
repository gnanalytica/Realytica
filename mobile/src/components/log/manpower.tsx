import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, Chip, ChipRow, Field, Icon, IconButton, Stepper, Text, Ticker } from '@/components/ui';
import type { DraftManpower } from '@/lib/drafts';
import { newId } from '@/lib/ids';
import { TRADES } from '@/lib/site-options';
import { radius, space, useTheme } from '@/theme';
import { arrive, leave, reflow } from '@/theme/motion';

/** The API keeps at most 40 trades per entry. */
const MAX_ROWS = 40;

interface Props {
  rows: DraftManpower[];
  onChange: (rows: DraftManpower[]) => void;
}

/**
 * Who was on site, by trade. Tap a trade to add it with one person, then use
 * the big minus and plus (or type the number). Any trade not in the list can
 * be typed in. A tapped trade leaves the chips and lands as a row; the total
 * counts up as people are added.
 */
export function ManpowerEditor({ rows, onChange }: Props) {
  const { colors, shadow } = useTheme();
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
        <Animated.View
          key={r.key}
          entering={arrive()}
          exiting={leave}
          layout={reflow}
          style={{
            gap: space.xs,
            paddingLeft: space.md,
            paddingRight: space.xs,
            paddingBottom: space.md,
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            boxShadow: shadow.card,
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
        </Animated.View>
      ))}

      {rows.length ? (
        <Animated.View
          entering={arrive()}
          layout={reflow}
          accessible
          accessibilityLabel={`${total} ${total === 1 ? 'person' : 'people'} on site`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
        >
          <Icon name="people" size={20} tone="brandStrong" />
          <Text variant="bodyStrong" tone="brandStrong">
            <Ticker value={total} variant="bodyStrong" mono tone="brandStrong" /> {total === 1 ? 'person' : 'people'} on site
          </Text>
        </Animated.View>
      ) : null}

      {available.length ? (
        <Animated.View layout={reflow} style={{ gap: space.sm }}>
          <Text variant="label">{rows.length ? 'Add another trade' : 'Tap a trade to add it'}</Text>
          <ChipRow>
            {available.map((t) => (
              <Chip key={t} label={t} onPress={() => add(t)} leading={<Icon name="add" size={20} tone="textSecondary" />} />
            ))}
          </ChipRow>
        </Animated.View>
      ) : null}

      <Animated.View layout={reflow} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
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
          // Level with the text box beside it, not with its label.
          style={{ alignSelf: 'flex-end' }}
          disabled={!other.trim() || has(other.trim())}
          onPress={() => {
            add(other);
            setOther('');
          }}
        />
      </Animated.View>
    </View>
  );
}
