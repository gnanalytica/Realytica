/**
 * Reading configuration.
 *
 * Every variable this package reads is `REALYTICA_`-prefixed, and every read
 * goes through here so a key built dynamically (`TIER_${agent}`,
 * `PROMPT_${key}`) is spelled the same way as a literal one.
 *
 * An empty string counts as unset: a variable set to `""` in a deployment
 * dashboard is someone clearing it rather than configuring it.
 */

const PREFIX = 'REALYTICA_';

/**
 * Reads `REALYTICA_<suffix>`.
 *
 * `suffix` is the name without the prefix — `MODEL_JUDGMENT`, not
 * `REALYTICA_MODEL_JUDGMENT`.
 */
export function readEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[`${PREFIX}${suffix}`];
  return value !== undefined && value !== '' ? value : undefined;
}

/** True when the variable is set to a non-empty value. */
export function hasEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv(suffix, env) !== undefined;
}

/** The full name, for telling an operator what to set. */
export function envName(suffix: string): string {
  return `${PREFIX}${suffix}`;
}
