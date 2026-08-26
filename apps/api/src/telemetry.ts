import type { LlmCallRecord } from '@valytica/shared';
import { PersistedTelemetrySink, type TelemetryPersistence } from '@valytica/agents';
import { store } from './store';

/**
 * Model-call telemetry, persisted through the app's own store.
 *
 * `@valytica/agents` deliberately does not know how this deployment persists
 * anything — the sink takes a `load`/`save` port and leaves the backend to the
 * caller. This is that port, over the same `StorageAdapter` the cases use
 * (filesystem locally, Vercel Blob in a deployment), so telemetry inherits the
 * durability guarantee already established rather than inventing a weaker one.
 *
 * Telemetry is the highest-volume thing this app produces — one record per
 * model call, and a single orchestration makes a dozen. The sink's own
 * retention rule is what keeps that from growing the case store without
 * bound; nothing here needs to prune, and nothing here should try, because
 * two components trimming the same collection is how records go missing for
 * reasons no one can reconstruct.
 */
const persistence: TelemetryPersistence = {
  async load(): Promise<LlmCallRecord[]> {
    return store.data.telemetry ?? [];
  },
  async save(records: LlmCallRecord[]): Promise<void> {
    store.data.telemetry = records;
    await store.save();
  },
};

/**
 * The process-wide sink.
 *
 * One instance, because `PersistedTelemetrySink` serialises its own writes
 * through a single queue — two instances over the same backing document would
 * each hold a partial view and the last writer would drop the other's records.
 */
export const telemetrySink = new PersistedTelemetrySink(persistence);
