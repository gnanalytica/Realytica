import { Children, type ReactNode } from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { radius, space, TOUCH, useTheme, type Palette } from '@/theme';
import { appear } from '@/theme/motion';
import { Icon, type IconName } from './icon';
import { Text } from './text';
import { Touchable, type TouchableProps } from './touchable';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'xl';

interface ButtonProps extends Omit<TouchableProps, 'style' | 'children' | 'fill' | 'fillPressed'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  /** Stretch to the width of the parent (default). */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

// Every size clears the 48pt minimum; `xl` is for the one action a screen is for.
const HEIGHT: Record<ButtonSize, number> = { md: 52, lg: 58, xl: 68 };
const FONT: Record<ButtonSize, number> = { md: 17, lg: 18, xl: 20 };

/**
 * Primary is the action colour (near-black on the light theme, near-white on
 * the dark), kept for the one thing a screen is for, and it taps the hand when
 * pressed. Secondary is a teal tint; outline sits on cards; ghost reads as a
 * link; danger is for throwing work away.
 */
export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  block = true,
  style,
  haptic,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const off = disabled || loading;
  const look: Record<ButtonVariant, { bg: string; bgPressed?: string; fg: keyof Palette; border?: string }> = {
    primary: { bg: colors.action, bgPressed: colors.actionPressed, fg: 'actionInk' },
    secondary: { bg: colors.brandSoft, fg: 'brandStrong' },
    outline: { bg: colors.surface, bgPressed: colors.sunken, fg: 'text', border: colors.hairline },
    ghost: { bg: 'transparent', fg: 'brandStrong' },
    danger: { bg: colors.surface, bgPressed: colors.criticalSoft, fg: 'criticalText', border: colors.critical },
  };
  const v = look[variant];

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      dimmed={!!disabled}
      haptic={haptic ?? (variant === 'primary' ? 'tap' : undefined)}
      fill={v.bg}
      fillPressed={v.bgPressed ?? v.bg}
      style={[
        {
          minHeight: HEIGHT[size],
          paddingHorizontal: variant === 'ghost' ? space.md : space.xl,
          borderRadius: radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          borderWidth: v.border ? 1.5 : 0,
          borderColor: v.border,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <Animated.View entering={appear}>
          <ActivityIndicator color={colors[v.fg]} />
        </Animated.View>
      ) : (
        <>
          {icon ? <Icon name={icon} size={FONT[size] + 4} tone={v.fg} /> : null}
          <Text style={{ fontSize: FONT[size], lineHeight: FONT[size] + 6, fontWeight: '600', color: colors[v.fg] }} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Touchable>
  );
}

interface IconButtonProps extends Omit<TouchableProps, 'style' | 'children'> {
  icon: IconName;
  /** Read aloud by screen readers; there is no visible label. */
  label: string;
  /** A palette key, or any colour string (white on a photo, say). */
  tone?: keyof Palette | (string & {});
  filled?: boolean;
  size?: number;
}

export function IconButton({ icon, label, tone = 'text', filled, size = TOUCH, disabled, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      disabled={disabled}
      pressScale={0.9}
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? colors.sunken : 'transparent',
      }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} tone={tone} />
    </Touchable>
  );
}

/** Two or three buttons side by side, sharing the width equally. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      {Children.map(children, (child) => (child ? <View style={{ flex: 1 }}>{child}</View> : null))}
    </View>
  );
}
