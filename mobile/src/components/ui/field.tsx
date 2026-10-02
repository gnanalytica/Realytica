import { forwardRef, useState } from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { radius, space, type as typeScale, useTheme } from '@/theme';
import { Text } from './text';

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, containerStyle, multiline, style, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: space.xs + 2 }, containerStyle]}>
      {label ? (
        <Text variant="label" tone="text" style={{ fontWeight: '600' }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        multiline={multiline}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          typeScale.body,
          {
            color: colors.text,
            backgroundColor: colors.surfaceRaised,
            borderWidth: focused ? 2 : 1.5,
            borderColor: error ? colors.critical : focused ? colors.brand : colors.hairline,
            borderRadius: radius.md,
            paddingHorizontal: space.md + 2,
            paddingVertical: multiline ? space.md : 0,
            minHeight: multiline ? 120 : 54,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="label" tone="criticalText">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
});
