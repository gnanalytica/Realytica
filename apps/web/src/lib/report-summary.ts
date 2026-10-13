import { reportIsFrozen, reportSummaryLine, type DdProject, type GeneratedReport } from '@realytica/shared';

/**
 * The line at the head of a report, or nothing.
 *
 * The line counts open findings, risks and papers still expected. It knows
 * nothing of the functions' sheets. On a report that prints fields, "0 open
 * findings" above a section that reads "Defects open: 6" is a good standing
 * over bad facts, so such a report carries no such line: what stands is what
 * its own sections say. A report that reads no field keeps the line, live
 * while it is a draft and as it was frozen once issued.
 */
export function reportSummary(project: DdProject, report: Pick<GeneratedReport, 'status' | 'body'>): string {
  if (report.body.blocks.some((block) => block.source?.kind === 'fields')) return '';
  return reportIsFrozen(report.status) ? report.body.summary : reportSummaryLine(project);
}
