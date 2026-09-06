/**
 * The unit suite never talks to a model, a mapping provider or a graph.
 *
 * Loaded before every test file, because otherwise the suite's behaviour
 * depends on whose machine it runs on. This was not a theory: with
 * `REALYTICA_API_KEY` and `REALYTICA_BASE_URL` set in the shell, the property
 * discovery tests — whose own comment reads "no credentials are configured in
 * the test environment, so this exercises the path a deployment without a key
 * actually takes" — found a key, made real calls to a live gateway, and took
 * 56 and 96 seconds before failing. Intermittently, because whether a rate
 * limit or a retry landed decided the outcome.
 *
 * A test that reads the ambient environment is a test that passes on CI and
 * fails on the machine of whoever has just configured the product, which is
 * the worst possible distribution of failures: it lands on the person doing
 * real work and never on the person who could see it in a pipeline.
 *
 * Scrubbed rather than mocked. A test that wants a configured deployment sets
 * the variable itself, inside the test, and puts it back afterwards — as
 * `gateway-error-envelope.test.ts` does. That way the intent is written where
 * it applies instead of inherited from a shell.
 */

const AMBIENT = [
  // The model endpoint. Both halves: a key alone reaches Anthropic, and a base
  // URL alone reaches a proxy that may need no key at all.
  'REALYTICA_API_KEY',
  'REALYTICA_BASE_URL',
  'REALYTICA_ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  // Tier overrides, so a test asserting the default model is not told another.
  'REALYTICA_MODEL_EXTRACTION',
  'REALYTICA_MODEL_REASONING',
  'REALYTICA_MODEL_JUDGMENT',
  // Everything else a run might reach for on its own.
  'REALYTICA_GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'REALYTICA_AGENT_WEB_SEARCH',
  'REALYTICA_NEO4J_URL',
  'REALYTICA_RECORDS_PROVIDER',
  'REALYTICA_PRICING',
];

for (const name of AMBIENT) delete process.env[name];
