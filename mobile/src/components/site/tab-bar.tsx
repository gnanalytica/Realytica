import type { BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Text, Touchable } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import { space, useTheme } from '@/theme';
import { pop, SETTLE_SPRING } from '@/theme/motion';

/**
 * The bottom tabs: tall enough for a gloved thumb, with a soft teal pill that
 * glides to the open tab, an icon that lifts as it is chosen, and the outbox
 * count popping in whenever it changes.
 */
export function SiteTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const [width, setWidth] = useState(0);
  // Each tab's share of the bar, inside the side insets (an iPad in landscape has them).
  const slot = (width - insets.left - insets.right) / state.routes.length;
  const at = useSharedValue(state.index);
  useEffect(() => {
    at.set(withSpring(state.index, SETTLE_SPRING));
  }, [at, state.index]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: at.get() * slot }] }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.hairline,
        boxShadow: isDark ? undefined : '0px -6px 20px rgba(21, 23, 26, 0.05)',
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, space.sm),
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {slot > 0 ? (
        <Animated.View style={[{ position: 'absolute', top: 8, left: insets.left, width: slot, alignItems: 'center' }, pill]}>
          <View style={{ width: 64, height: 34, borderRadius: 17, backgroundColor: colors.brandSoft }} />
        </Animated.View>
      ) : null}
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? colors.brandStrong : colors.textSecondary;
        const title = typeof options.title === 'string' ? options.title : route.name;
        return (
          <TabButton
            key={route.key}
            title={title}
            focused={focused}
            color={color}
            badge={options.tabBarBadge}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
            icon={options.tabBarIcon?.({ focused, color, size: 26 })}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                haptics.tick();
                navigation.navigate(route.name, route.params);
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          />
        );
      })}
    </View>
  );
}

interface TabButtonProps {
  title: string;
  focused: boolean;
  color: string;
  icon: ReactNode;
  badge?: number | string;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress: () => void;
}

function TabButton({ title, focused, color, icon, badge, accessibilityLabel, onPress, onLongPress }: TabButtonProps) {
  const { colors, isDark } = useTheme();
  const reduced = useReducedMotion();
  const lift = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    // A small lift as a tab is chosen (not on first draw).
    if (first.current) {
      first.current = false;
      return;
    }
    if (focused && !reduced) lift.set(withSequence(withTiming(1.14, { duration: 90 }), withSpring(1, SETTLE_SPRING)));
  }, [focused, lift, reduced]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: lift.get() }] }));

  return (
    <Touchable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      pressScale={0.92}
      style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }}
    >
      <Animated.View style={[{ height: 34, width: 64, alignItems: 'center', justifyContent: 'center' }, iconStyle]}>{icon}</Animated.View>
      {badge != null ? (
        // Keyed by the count, so each change pops in afresh.
        <Animated.View
          key={String(badge)}
          entering={pop()}
          style={{
            position: 'absolute',
            top: 2,
            left: '50%',
            marginLeft: 6,
            minWidth: 22,
            height: 22,
            paddingHorizontal: 5,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: colors.surface,
            backgroundColor: colors.warning,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text mono variant="caption" style={{ fontSize: 12, lineHeight: 15, fontWeight: '500', color: isDark ? colors.textInverse : colors.text }}>
            {String(badge)}
          </Text>
        </Animated.View>
      ) : null}
      <Text variant="caption" style={{ color, fontWeight: focused ? '700' : '600' }}>
        {title}
      </Text>
    </Touchable>
  );
}
