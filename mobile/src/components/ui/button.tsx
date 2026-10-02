import { Children, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, TOUCH, useTheme, type Palette } from '@/theme';
import { Icon, type IconName } from './icon';
import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'xl';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
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

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  block = true,
  style,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const off = disabled || loading;
  const look: Record<ButtonVariant, { bg: string; fg: keyof Palette; border?: string }> = {
    primary: { bg: colors.brand, fg: 'brandInk' },
    secondary: { bg: colors.brandSoft, fg: 'brandStrong' },
    outline: { bg: colors.surfaceRaised, fg: 'text', border: colors.hairline },
    ghost: { bg: 'transparent', fg: 'brandStrong' },
    danger: { bg: colors.surfaceRaised, fg: 'criticalText', border: colors.critical },
  };
  const v = look[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      style={({ pressed }) => [
        {
          minHeight: HEIGHT[size],
          paddingHorizontal: space.xl,
          borderRadius: radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          backgroundColor: v.bg,
          borderWidth: v.border ? 1.5 : 0,
          borderColor: v.border,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: off ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors[v.fg]} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={FONT[size] + 4} tone={v.fg} /> : null}
          <Text style={{ fontSize: FONT[size], fontWeight: '600', color: colors[v.fg] }} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      disabled={disabled}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? colors.sunken : 'transparent',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} tone={tone} />
    </Pressable>
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
