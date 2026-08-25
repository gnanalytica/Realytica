import type { PropertyCase, ScreenResult } from '@valytica/shared';

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
}
