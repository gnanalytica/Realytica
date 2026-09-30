/**
 * Whether Automations run on this deployment.
 *
 * Off unless `REALYTICA_AUTOMATIONS=on`. The builder, the flow engine and the
 * scheduler stay in the codebase; with the switch off nothing fires, nothing
 * is scheduled, and `/api/flows` is not mounted, so no project event reaches
 * a flow somebody drew and forgot.
 */
export function automationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.REALYTICA_AUTOMATIONS ?? '').trim().toLowerCase() === 'on';
}
