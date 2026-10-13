/**
 * A model's wording for the lines of a status report.
 *
 * The report is written by code: each line, its day, its person and what is
 * behind it come from the record. Where a model is set up it may put a line
 * in plainer words for the person the report is for. That is all it is asked
 * for and all it is given: the numbered lines, and nothing of the record.
 *
 * Nothing it answers is used on its word. The caller holds every wording to
 * the line it was made for (`statusWordingHeld` in the shared package): a
 * wording is kept only for a line that exists, with every figure, month and
 * quoted title of that line and no other, the same words for where things
 * stand, and most of the line's own words. So the answer here can add no
 * line, drop none, and change no date, amount or name of a paper, nor turn
 * "overdue" into "done".
 *
 * Never throws. A model that cannot be reached, runs out of time or answers
 * something else has reworded nothing, and the lines stand as code wrote them.
 */


export const STATUS_WORDING_TOOL = 'reword_status_lines';

/** How long the rewording may take before the lines stand as they are. */
export const STATUS_WORDING_LIMIT_MS = 20_000;

/** How many lines one report sends to be reworded, at most. */
export const STATUS_WORDING_LINES = 60;

/**
 * What a model would put some lines as: a list of `{ n, text }`, or null when
 * no model reworded them. `audience` is who the report is for, in words.
 */
export async function rewordStatusLinesByModel(input: { lines: readonly string[]; audience?: string; caseId?: string; timeoutMs?: number }): Promise<unknown[] | null> {
  // A report's lines are made by code from the record, and no model rewords them: a line a model put in its own words is a
  // sentence a model wrote, shown as the firm's. Nothing is asked. The wording a report kept from before still reads, and
  // the report says of it that a model reworded the line.
  void input;
  return null;
}
