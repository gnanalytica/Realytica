import { Router } from 'express';
import type { AgentKind, LlmCallOutcome, ProviderId } from '@valytica/shared';
import { summariseTelemetry } from '@valytica/agents';
import { telemetrySink } from '../telemetry';

/**
 * What every model call cost, how long it took, and what it could not do.
 *
 * One endpoint rather than three, because the three questions are answered
 * from the same records and splitting them would let the cost view and the
 * performance view disagree about which window they are describing.
 */
export const telemetryRouter = Router();

/** Default window. Long enough to cover a working session, short enough that the summary is about now. */
const DEFAULT_WINDOW_MINUTES = 24 * 60;

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

telemetryRouter.get('/', async (req, res) => {
  const sinceMinutes = Number(req.query.sinceMinutes ?? DEFAULT_WINDOW_MINUTES);
  const minutes = Number.isFinite(sinceMinutes) && sinceMinutes > 0 ? sinceMinutes : DEFAULT_WINDOW_MINUTES;
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  const records = await telemetrySink.query({
    since,
    caseId: csv(req.query.caseId),
    agent: csv(req.query.agent) as AgentKind[] | undefined,
    provider: csv(req.query.provider) as ProviderId[] | undefined,
    model: csv(req.query.model),
    outcome: csv(req.query.outcome) as LlmCallOutcome[] | undefined,
    degradedOnly: req.query.degradedOnly === '1' || req.query.degradedOnly === 'true',
  });

  // `pricing` rides along on the view rather than being computed by the
  // client: a total that silently excludes routes this deployment has no
  // rates for is a number the reader would trust and should not.
  res.json(summariseTelemetry(records));
});
