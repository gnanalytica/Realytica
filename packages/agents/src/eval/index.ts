/**
 * Cross-provider evaluation.
 *
 * Four files, in the order they are used: `cases` builds the corpus (derived
 * from the seeded documents, plus the hand-written absence cases that are the
 * reason this exists), `score` matches one answer against one case, `run`
 * takes an injected executor across every route, and `rank` turns the runs
 * into a table where the fabrication gate is applied.
 *
 * Re-exported from here so the package's file layout can move without
 * breaking the API layer that wires it up.
 */

export * from './cases';
export * from './score';
export * from './run';
export * from './rank';
