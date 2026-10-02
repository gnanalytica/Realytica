import { forwardRef, useEffect, useState } from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { face, radius, space, type as typeScale, useTheme } from '@/theme';
import { FADE } from '@/theme/motion';
import { Text } from './text';

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

/** A text box whose edge turns teal, with a soft focus ring, while it is being typed in. */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, containerStyle, multiline, style, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const focus = useSharedValue(0);
  useEffect(() => {
    focus.set(withTiming(focused ? 1 : 0, FADE));
  }, [focus, focused]);

  const edge = error ? colors.critical : colors.hairline;
  const lit = error ? colors.critical : colors.brand;
  const frame = useAnimatedStyle(() => ({ borderColor: interpolateColor(focus.get(), [0, 1], [edge, lit]) }));

  return (
    <View style={[{ gap: space.xs + 2 }, containerStyle]}>
      {label ? (
        <Text variant="label" tone="text" style={{ fontWeight: '600' }}>
          {label}
        </Text>
      ) : null}
      <Animated.View
        style={[
          {
            borderWidth: 1.5,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceRaised,
            boxShadow: focused ? `0px 0px 0px 3px ${error ? colors.criticalSoft : colors.brandSoft}` : undefined,
          },
          frame,
        ]}
      >
        <TextInput
          ref={ref}
          multiline={multiline}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.brand}
          cursorColor={colors.brand}
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
            face('400'),
            {
              color: colors.text,
              // The frame around it draws the focus; a browser's own focus ring would double it.
              outlineStyle: 'solid',
              outlineWidth: 0,
              paddingHorizontal: space.md + 2,
              paddingVertical: multiline ? space.md : 0,
              minHeight: multiline ? 120 : 52,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
          {...rest}
        />
      </Animated.View>
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
