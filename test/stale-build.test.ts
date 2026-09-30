/**
 * Telling a screen broken by a deploy apart from a screen that is broken.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleBuildError } from '../apps/web/src/lib/stale-build';

describe('a chunk the new build no longer serves', () => {
  it('is recognised in each browser’s words', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://realytica.gnanalytica.com/assets/GisOverlayCard-Cs_nQVCP.js',
      'Importing a module script failed.',
      'error loading dynamically imported module: https://realytica.gnanalytica.com/assets/Report-x1.js',
      'Unable to preload CSS for /assets/GisOverlayCard-Dgihpmma.css',
    ]) {
      assert.equal(isStaleBuildError(new TypeError(message)), true, message);
    }
  });

  it('leaves every other failure to the ordinary error screen', () => {
    assert.equal(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'bounds')")), false);
    assert.equal(isStaleBuildError(undefined), false);
  });
});
