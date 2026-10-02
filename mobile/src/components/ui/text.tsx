import { StyleSheet, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { face, type, useTheme, type Palette, type TypeVariant } from '@/theme';

interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  /** A palette key. Labels and captions default to the secondary colours. */
  tone?: keyof Palette;
  center?: boolean;
  /** Even-width digits, so counts and percentages do not jitter as they change. */
  tabular?: boolean;
  /** DM Mono, for figures, codes, percentages and counts. Even-width by nature. */
  mono?: boolean;
}

const DEFAULT_TONE: Partial<Record<TypeVariant, keyof Palette>> = {
  label: 'textSecondary',
  caption: 'textMuted',
  eyebrow: 'textMuted',
};

export function Text({ variant = 'body', tone, center, tabular, mono, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const color = colors[tone ?? DEFAULT_TONE[variant] ?? 'text'];
  const flat: TextStyle =
    StyleSheet.flatten([
      type[variant],
      { color },
      center ? { textAlign: 'center' as const } : null,
      tabular ? { fontVariant: ['tabular-nums' as const] } : null,
      style,
    ]) ?? {};
  // The weight, wherever it was set (the variant or a style override), picks the face.
  // A fontFamily set on purpose wins.
  return <RNText {...rest} style={[flat, flat.fontFamily ? null : face(flat.fontWeight, mono)]} />;
}
