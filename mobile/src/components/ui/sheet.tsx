import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { radius, space, useTheme } from '@/theme';
import { SETTLE_SPRING } from '@/theme/motion';
import { IconButton } from './button';
import { Text } from './text';

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the content: Save / Cancel. */
  footer?: ReactNode;
}

/** Pulled down this far (points), or flicked down this fast (points a second), the sheet goes. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/**
 * A panel that springs up from the bottom over a fading shade, for one small
 * decision. It closes from the close button, a tap on the shade, the Android
 * back button, or by pulling its top edge down — a gloved thumb finds an edge
 * more easily than a small ✕.
 *
 * While closing it keeps drawing and slides away whole; it leaves the tree
 * only once it is off screen.
 */
export function Sheet({ visible, title, onClose, children, footer }: SheetProps) {
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  /** How far below its resting place the panel is. */
  const offset = useSharedValue(screen);
  /** The panel's own height, so the shade fades as the panel is pulled down. */
  const panel = useSharedValue(screen);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      offset.set(withSpring(0, SETTLE_SPRING));
    } else {
      offset.set(
        withTiming(screen, { duration: 220, easing: Easing.in(Easing.cubic), reduceMotion: ReduceMotion.System }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [visible, mounted, offset, screen]);

  const drag = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      // Down follows the thumb; up resists, so the panel never lifts off its edge.
      offset.set(e.translationY > 0 ? e.translationY : e.translationY / 6);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) scheduleOnRN(onClose);
      else offset.set(withSpring(0, { ...SETTLE_SPRING, velocity: e.velocityY }));
    });

  const shade = useAnimatedStyle(() => ({
    opacity: interpolate(offset.get(), [0, Math.max(1, panel.get())], [1, 0], 'clamp'),
  }));
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(-24, offset.get()) }] }));

  const onPanelLayout = (e: LayoutChangeEvent) => panel.set(e.nativeEvent.layout.height);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* A modal is its own root on Android; gestures inside it need their own handler root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, shade]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
            </Animated.View>
            <Animated.View
              onLayout={onPanelLayout}
              style={[
                {
                  maxHeight: '90%',
                  backgroundColor: colors.surfaceRaised,
                  borderTopLeftRadius: radius.xl,
                  borderTopRightRadius: radius.xl,
                  boxShadow: shadow.raised,
                  paddingBottom: insets.bottom,
                },
                lift,
              ]}
            >
              <GestureDetector gesture={drag}>
                {/* The grab area: the handle and the title row. */}
                <View accessibilityHint="Pull down to close">
                  <View style={{ alignItems: 'center', paddingTop: space.sm + 2, paddingBottom: space.xs }}>
                    <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.hairline }} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.md }}>
                    <Text variant="heading" style={{ flex: 1 }} accessibilityRole="header" numberOfLines={2}>
                      {title}
                    </Text>
                    <IconButton icon="close" label="Close" onPress={onClose} filled />
                  </View>
                </View>
              </GestureDetector>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
                {children}
              </ScrollView>
              {footer ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm }}>{footer}</View> : null}
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
