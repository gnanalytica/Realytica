import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { haptics } from '@/lib/haptics';
import { space, useTheme } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** Wrap the content in a ScrollView (default true). */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned above the bottom edge — for the one action the screen is for. */
  footer?: ReactNode;
  /** Pinned above the content, outside the scroll. */
  header?: ReactNode;
  /** Safe-area edges to pad. Screens under a navigation header drop 'top'. */
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  header,
  edges = ['top', 'left', 'right'],
  contentStyle,
}: ScreenProps) {
  const { colors, isDark } = useTheme();
  const pad: ViewStyle = { padding: space.lg, gap: space.xl, paddingBottom: space.xxxl };

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        onRefresh ? (
          // The pull is teal, and felt once when it lets go and starts checking.
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={() => {
              haptics.tap();
              onRefresh();
            }}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }} edges={edges}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer ? (
          <SafeAreaView
            edges={['bottom']}
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
              backgroundColor: colors.surface,
              // A faint lift off the content scrolling under it; dark mode has the hairline alone.
              boxShadow: isDark ? undefined : '0px -4px 16px rgba(21, 23, 26, 0.05)',
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: space.sm,
            }}
          >
            {footer}
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
