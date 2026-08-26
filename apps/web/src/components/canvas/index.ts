/**
 * The run canvas: an inspector for an orchestration, not an editor of one.
 *
 * `layout.ts` is pure geometry and has no React dependency, so it can be
 * exercised on its own; everything else is presentation over its output.
 */
export { default as Canvas, computeFit, zoomAbout, MIN_ZOOM, MAX_ZOOM } from './Canvas';
export type { CanvasProps, Transform } from './Canvas';
export { default as NodeInspector } from './NodeInspector';
export type { NodeInspectorProps } from './NodeInspector';
export { RunNode } from './RunNode';
export type { RunNodeProps } from './RunNode';
export {
  GAP_CONSEQUENCE,
  GAP_LABEL,
  GROUNDING_GAPS,
  KIND_ICON,
  KIND_LABEL,
  PROVIDER_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  brokenInvariants,
  isModelStep,
  isRefusal,
  ms,
  routeLabel,
  splitGaps,
  usd,
} from './RunNode';
export { DEFAULT_LAYOUT, layoutRunGraph } from './layout';
export type { GraphLayout, LaneBand, LayoutOptions, PositionedNode, RoutedEdge } from './layout';
