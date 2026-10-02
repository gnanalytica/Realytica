import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { type, useTheme, type Palette, type TypeVariant } from '@/theme';

interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  /** A palette key. Labels and captions default to the secondary colours. */
  tone?: keyof Palette;
  center?: boolean;
  /** Even-width digits, so counts and percentages do not jitter as they change. */
  tabular?: boolean;
}

const DEFAULT_TONE: Partial<Record<TypeVariant, keyof Palette>> = {
  label: 'textSecondary',
  caption: 'textMuted',
};

export function Text({ variant = 'body', tone, center, tabular, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const color = colors[tone ?? DEFAULT_TONE[variant] ?? 'text'];
  return (
    <RNText
      {...rest}
      style={[
        type[variant],
        { color },
        center ? { textAlign: 'center' } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}
