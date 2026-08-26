/**
 * Prompt management components.
 *
 * The invariant module is re-exported wholesale rather than only its
 * component: the version-lookup helpers, the live checker and the waiver
 * dialog are one mechanism, and anything that renders a prompt's guardrails
 * must resolve "which version is in force" and "does it still keep them" the
 * same way. A second, subtly different answer to either question is exactly
 * how a dropped guardrail ends up shown as intact somewhere.
 */
export * from './InvariantList';
export { PromptList, ROLE_LABEL, ROLE_HINT, type PromptListProps } from './PromptList';
export { VersionHistory, type VersionHistoryProps } from './VersionHistory';
export { PromptDiff, diffLines, diffStats, type DiffOp, type DiffRow, type DiffStats } from './PromptDiff';
export { PromptEditor, type PromptDraft, type PromptEditorProps } from './PromptEditor';
