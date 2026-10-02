import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Text } from './text';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Inner padding (default true). */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, onPress, accessibilityLabel, padded = true, style }: CardProps) {
  const { colors } = useTheme();
  const look: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: padded ? space.lg : 0,
    gap: space.md,
  };
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [look, { opacity: pressed ? 0.85 : 1 }, style]}
      >
        {children}
      </Pressable>
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

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.hairline }} />;
}
