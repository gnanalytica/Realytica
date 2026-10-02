import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useTheme, type Palette } from '@/theme';

export type IconName = keyof typeof Ionicons.glyphMap;
export type WeatherIconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface IconProps {
  name: IconName;
  size?: number;
  /** A palette key, or any colour string. */
  tone?: keyof Palette | (string & {});
}

function useColour(tone: IconProps['tone']): string {
  const { colors } = useTheme();
  if (!tone) return colors.text;
  return tone in colors ? colors[tone as keyof Palette] : tone;
}

export function Icon({ name, size = 22, tone }: IconProps) {
  return <Ionicons name={name} size={size} color={useColour(tone)} />;
}

/** Ionicons has no wind or heavy-rain glyphs, so weather uses Material's set. */
export function WeatherIcon({ name, size = 22, tone }: { name: WeatherIconName; size?: number; tone?: IconProps['tone'] }) {
  return <MaterialCommunityIcons name={name} size={size} color={useColour(tone)} />;
}
