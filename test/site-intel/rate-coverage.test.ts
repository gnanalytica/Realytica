import { test } from 'node:test';

// Kshetra's pure check, run under node:test. The check file asserts at import
// time and throws on the first failure, so importing it IS the test.
test('site-intel: rate-coverage', async () => {
  await import('../../packages/site-intel/checks/rate-coverage');
});
