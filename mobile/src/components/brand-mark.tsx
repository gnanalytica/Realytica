import Svg, { Rect } from 'react-native-svg';

/**
 * The app's mark: a building going up, three floors done and one to come.
 * The same drawing as the app icon (assets/images/*.png).
 */
export function BrandMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="Realytica Site">
      <Rect x={0} y={0} width={1024} height={1024} rx={224} fill="rgb(42,120,214)" />
      <Rect x={312} y={246} width={400} height={118} rx={14} fill="none" stroke="#ffffff" strokeWidth={30} />
      <Rect x={297} y={394} width={430} height={118} rx={18} fill="#ffffff" />
      <Rect x={297} y={536} width={430} height={118} rx={18} fill="#ffffff" />
      <Rect x={297} y={678} width={430} height={118} rx={18} fill="#ffffff" />
    </Svg>
  );
}
