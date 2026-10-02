import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { arrive, leave, reflow } from '@/theme/motion';

/**
 * Wraps a card or row so it arrives with its list (staggered by `index`),
 * fades when it leaves, and glides when a neighbour above it comes or goes.
 * A row that was already on screen never arrives twice: entering only plays
 * when it first mounts.
 */
export function Appear({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={arrive(index)} exiting={leave} layout={reflow} style={style}>
      {children}
    </Animated.View>
  );
}
