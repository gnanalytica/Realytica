/**
 * Public surface of `@realytica/agents`.
 *
 * Everything a consumer (the API layer, or a script exercising these agents
 * directly) needs is re-exported from here rather than reached into by deep
 * import path, so the package's internal file layout can move without
 * breaking callers.
 */

export * from './env';
// The endpoint, key and tier table — a script measuring a model has to be
// able to ask which model is configured.
export * from './config';
export * from './client';
export * from './context';
export * from './tools/case-tools';
export * from './tools/command-tools';
export * from './tools/project-tools';

export * from './agents/document-intelligence';
export * from './agents/photo-intelligence';
export * from './agents/project-copilot';
export * from './agents/meeting-notes';
export * from './agents/voice-note';
export * from './transcribe';
export * from './agents/status-wording';
export * from './agents/plan-proposal';
export * from './agents/review-answers';
export * from './agents/outgoing-draft';
export * from './agents/project-orchestrator';
export * from './project/ingest-intelligence';
export * from './agents/property-discovery';
export * from './records';

export * from './routing';
export * from './providers';
export * from './telemetry';
export * from './eval';
export * from './memory';
export * from './sources';

// Where a case is and what surrounds it. Context, never evidence of extent —
// see `SiteContext` in the shared types.
export * from './places';
export { createWebSearchTool, createWebFetchTool, BLOCKED_HOSTNAMES } from './tools/exploration-tools';

// The conversational front door. Placed last because it depends on the
// engine, the playbooks and the provider port, and nothing depends on it.
export * from './intake';
