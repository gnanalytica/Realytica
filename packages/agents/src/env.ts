/**
 * Reading configuration under both the new and the old name.
 *
 * The product is Realytica. It was built under the name Valytica, and every
 * environment variable it reads still carries that prefix — including in
 * deployments that are already live with keys set. Renaming the reads without
 * a fallback would silently un-configure those deployments: the Anthropic key
 * would still be present in the dashboard, the app would report itself as
 * having no credentials, and nothing would say why.
 *
 * So every read goes through here and checks `REALYTICA_` first, then
 * `VALYTICA_`. New deployments use the new name; existing ones keep working
 * untouched; and an operator who sets both gets the new one, which is the
 * only sensible precedence when someone is midway through a migration.
 *
 * --- Why a call-time lookup rather than aliasing at boot -----------------
 *
 * The obvious alternative is a normaliser that walks `process.env` once at
 * startup and copies every `VALYTICA_*` to its `REALYTICA_*` twin. That is
 * fewer edits, and it is ordering-dependent: any module that reads an
 * environment variable at its own module scope, before the normaliser has
 * run, sees nothing. Several keys here are also built dynamically
 * (`TIER_${agent}`, `PROMPT_${key}`), so the failure would be partial and
 * would depend on import order — the worst shape a configuration bug can
 * take. Checking both names at the moment of the read has no ordering to get
 * wrong.
 */

/** The prefixes tried, in precedence order. */
const PREFIXES = ['REALYTICA_', 'VALYTICA_'] as const;

/**
 * Reads `REALYTICA_<suffix>`, falling back to `VALYTICA_<suffix>`.
 *
 * `suffix` is the name without a prefix — `ANTHROPIC_MODEL`, not
 * `REALYTICA_ANTHROPIC_MODEL`. Returns `undefined` when neither is set, and
 * treats an empty string as unset, because a variable set to `""` in a
 * deployment dashboard is someone clearing it rather than configuring it.
 */
export function readEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const prefix of PREFIXES) {
    const value = env[`${prefix}${suffix}`];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** True when either spelling of the variable is set to a non-empty value. */
export function hasEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv(suffix, env) !== undefined;
}

/**
 * The canonical name to print when telling an operator what to set.
 *
 * Always the new prefix: a message that names the deprecated spelling teaches
 * the next person to use it.
 */
export function envName(suffix: string): string {
  return `REALYTICA_${suffix}`;
}
