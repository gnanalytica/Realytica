import Animated, { FadeIn, FadeInDown, ReduceMotion, ZoomIn } from 'react-native-reanimated';

import { travel } from '@/theme/motion';

/** The mark's own teal, the same in both themes: it is a logo, not a surface. */
const TEAL = '#0B6464';

/**
 * The app's mark: a building going up, three floors done and one to come.
 * The same drawing as the app icon (assets/images/*.png), laid out on its
 * 1024-unit grid with plain views rather than SVG, so that on the pairing
 * screen (`animated`) the floors can rise one after another and the floor to
 * come can appear last, outlined.
 */
export function BrandMark({ size = 64, animated }: { size?: number; animated?: boolean }) {
  const u = size / 1024;
  const floor = (top: number, order: number) => (
    <Animated.View
      entering={
        animated
          ? travel(FadeInDown.springify().mass(1).stiffness(260).damping(22), { opacity: 0, transform: [{ translateY: 70 * u }] })
              .delay(180 + order * 90)
              .reduceMotion(ReduceMotion.System)
          : undefined
      }
      style={{ position: 'absolute', left: 297 * u, top: top * u, width: 430 * u, height: 118 * u, borderRadius: 18 * u, backgroundColor: '#FFFFFF' }}
    />
  );
  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Realytica Site"
      entering={animated ? ZoomIn.springify().mass(1).stiffness(240).damping(20).reduceMotion(ReduceMotion.System) : undefined}
      style={{ width: size, height: size, borderRadius: 224 * u, backgroundColor: TEAL, overflow: 'hidden' }}
    >
      {floor(678, 0)}
      {floor(536, 1)}
      {floor(394, 2)}
      {/* The floor still to come: an outline (stroke 30 on the 400×118 box, drawn inside a 430×148 frame). */}
      <Animated.View
        entering={animated ? FadeIn.duration(320).delay(560).reduceMotion(ReduceMotion.System) : undefined}
        style={{ position: 'absolute', left: 297 * u, top: 231 * u, width: 430 * u, height: 148 * u, borderRadius: 29 * u, borderWidth: 30 * u, borderColor: '#FFFFFF' }}
      />
    </Animated.View>
  );
}
