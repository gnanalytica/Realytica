import { useWindowDimensions } from 'react-native';

import { CONTENT_MAX, space } from '@/theme';

/**
 * The room a screen has, for the few layouts that change with it.
 *
 * Read from the window rather than the device, so it follows a rotation, an
 * iPad's Split View and a foldable opening, and the layout answers at once.
 *
 * - `column`: the width of a screen's content, inside its padding.
 * - `compact`: a small phone (an iPhone SE, a 360dp Android), where a picture
 *   beside text gives up some size so the words keep room for a few per line.
 * - `fontScale`: the phone's text-size setting, for rows that should stack
 *   rather than squeeze when the words get large.
 */
export function useLayout() {
  const { width, fontScale } = useWindowDimensions();
  return {
    width,
    column: Math.min(width, CONTENT_MAX) - space.lg * 2,
    compact: width < 360,
    fontScale,
  };
}
