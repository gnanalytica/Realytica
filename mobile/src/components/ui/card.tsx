import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Text } from './text';
import { Touchable } from './touchable';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Inner padding (default true). */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** White on the grey page, a hairline edge and the softest shadow. A pressable card gives a little under the thumb. */
export function Card({ children, onPress, accessibilityLabel, accessibilityHint, padded = true, style }: CardProps) {
  const { colors, shadow } = useTheme();
  const look: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.card,
    padding: padded ? space.lg : 0,
    gap: space.md,
  };
  if (onPress) {
    return (
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        // A whole card moving 3% is a lot of pixels; it gives less than a button.
        pressScale={0.985}
        pressOpacity={0.92}
        style={[look, style]}
      >
        {children}
      </Touchable>
    );
  }
  return <View style={[look, style]}>{children}</View>;
}

/** A titled block of a screen: a heading, an optional action on the right, then content. */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          {hint ? <Text variant="label">{hint}</Text> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: 1, marginLeft: inset, backgroundColor: colors.hairline }} />;
}
