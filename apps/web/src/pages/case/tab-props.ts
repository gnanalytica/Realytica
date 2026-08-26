import type { LensKey, PropertyCase, ScreenResult } from '@realytica/shared';

/**
 * Every tab inside the case workspace receives exactly this prop object.
 * `result` is null until the case has been screened at least once.
 */
export interface TabProps {
  caseData: PropertyCase;
  result: ScreenResult | null;
  /** Re-fetch the case from the API and re-render the workspace. */
  refresh: () => Promise<void>;
  /** Run (or re-run) the screening engine for this case. */
  runScreen: () => Promise<void>;
  /** True while the screening engine is running. */
  running: boolean;
  /** Jump to another tab by key, e.g. 'documents'. */
  goToTab: (key: string) => void;
  /**
   * Who the case is being read by. A view uses it to decide what leads and
   * what folds away — never to decide what to show at all. Every finding is
   * reachable under every lens.
   */
  lens: LensKey;
}
