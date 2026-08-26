/**
 * Public surface of `@valytica/agents`.
 *
 * Everything a consumer (the API layer, or a script exercising these agents
 * directly) needs is re-exported from here rather than reached into by deep
 * import path, so the package's internal file layout can move without
 * breaking callers.
 */

export * from './client';
export * from './context';
export * from './tools/case-tools';

export * from './agents/document-intelligence';
export * from './agents/proof-pathways';
export * from './agents/copilot';
export * from './agents/market-research';
export * from './agents/diligence-planner';
export * from './agents/explorer';

export * from './orchestrator';
