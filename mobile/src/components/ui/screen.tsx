import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

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

/**
 * Padding for the given safe-area edges, from the insets the root provider measures for the window.
 *
 * Use this rather than the native SafeAreaView: that one measures where its own view sits, and in
 * a full-screen modal that slides up (the log, the scanner, the photo) it measures before the slide
 * has finished, reads zero, and leaves the header under the status bar.
 */
export function useSafePadding(edges: readonly Edge[]): ViewStyle {
  const insets = useSafeAreaInsets();
  return {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingRight: edges.includes('right') ? insets.right : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingLeft: edges.includes('left') ? insets.left : 0,
  };
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
  const insets = useSafeAreaInsets();
  const safe = useSafePadding(edges);
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
    <View style={[{ flex: 1, backgroundColor: colors.page }, safe]}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
              backgroundColor: colors.surface,
              // A faint lift off the content scrolling under it; dark mode has the hairline alone.
              boxShadow: isDark ? undefined : '0px -4px 16px rgba(21, 23, 26, 0.05)',
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: space.sm + insets.bottom,
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}
