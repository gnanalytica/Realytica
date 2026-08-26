/**
 * The provider port, as one import.
 *
 * Agents reach the port through this module rather than by deep path, so the
 * split between the normalised types, the two implementations and the registry
 * stays an internal arrangement rather than part of eight call sites.
 */

export * from './types';
export * from './registry';
export { anthropicProvider, buildCompleteParams, buildToolRunnerParams, clientToolFromRunnable, toContentBlocks } from './anthropic';
export {
  createOpenAiCompatibleProvider,
  extractPdfText,
  openAiCompatibleProvider,
  readConfig as readOpenAiCompatibleConfig,
  DEFAULT_MAX_TOOL_ITERATIONS,
  type OpenAiCompatibleConfig,
  type OpenAiCompatibleOverrides,
} from './openai';
