import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { radius, space, type as typeScale, useTheme } from '@/theme';
import { Icon } from './icon';

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Read aloud with the number: "Masons, 4". */
  label: string;
}

/**
 * A count with big minus and plus buttons either side. The number itself can
 * be typed, because tapping plus forty times for forty helpers is no one's job.
 */
export function Stepper({ value, onChange, min = 0, max = 5000, label }: StepperProps) {
  const { colors } = useTheme();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const set = (n: number) => onChange(Math.max(min, Math.min(max, Math.round(n))));

  const button = (icon: 'remove' | 'add', delta: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? 'One more' : 'One fewer'}: ${label}`}
      disabled={disabled}
      onPress={() => set(value + delta)}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.brandSoft,
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={28} tone="brandStrong" />
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {button('remove', -1, value <= min)}
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={(t) => {
          const digits = t.replace(/[^0-9]/g, '');
          setText(digits);
          if (digits) set(Number(digits));
        }}
        onBlur={() => setText(String(value))}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={4}
        style={[
          typeScale.heading,
          {
            width: 64,
            height: 52,
            textAlign: 'center',
            color: colors.text,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: colors.hairline,
            backgroundColor: colors.surfaceRaised,
            fontVariant: ['tabular-nums'],
          },
        ]}
      />
      {button('add', 1, value >= max)}
    </View>
  );
}
