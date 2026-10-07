/**
 * A status report's lines, put in plainer words by a model.
 *
 * The report is written by code from the project's record
 * (`status-report.ts` in the shared package). Where a model is set up, the
 * lines of a draft just written are sent to it once, numbered and with
 * nothing else of the record, and what it answers is laid over the report's
 * sections only as far as the shared rule lets it be (`keepStatusWording`):
 * a wording for a line that exists, with that line's figures and quoted
 * titles and no others. The day, the person and what is behind a line are
 * never a model's.
 */

import { rewordStatusLinesByModel } from '@realytica/agents';
import { keepStatusWording, statusLinesToWord, type DdProject } from '@realytica/shared';

/**
 * Ask a model to reword the lines of one status report, and keep what holds.
 * Returns how many lines were given a wording. Never throws: with no model,
 * no answer or nothing that holds, the report reads as code wrote it.
 */
export async function wordStatusReport(project: DdProject, reportId: string): Promise<number> {
  const report = project.reports.find((held) => held.id === reportId);
  if (!report || report.kind !== 'status') return 0;
  const asked = statusLinesToWord(project, report);
  if (!asked.length) return 0;
  // Who the report is for is in its name, where it names anybody.
  const audience = /^Status report for (.{1,60}?) — /.exec(report.title)?.[1];
  const said = await rewordStatusLinesByModel({ lines: asked.map((row) => row.line), audience, caseId: project.id });
  if (!said) return 0;
  const kept = keepStatusWording(report, asked, said);
  if (kept) project.updatedAt = new Date().toISOString();
  return kept;
}
