/**
 * The checklist of papers owed as a spreadsheet, beside the requirement
 * sheet's (`requirementSheetCsv`): one line a paper, in the order the desk
 * shows them, with who owes it, how it stands and what answers it.
 */

import type { ChecklistSheet } from './checklist';
import { REQUIREMENT_STATUS_LABEL } from './requirement-sheet';

function csvCell(value: string): string {
  // A cell that opens with a sign a spreadsheet reads as a formula is given as text.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function checklistCsv(sheet: ChecklistSheet): string {
  const lines = [['Stage', 'Package', 'Paper', 'Owed by', 'Status', 'Asked of', 'Due', 'Overdue', 'Received', 'Document', 'Note'].join(',')];
  for (const stage of sheet.stages) {
    for (const pack of stage.packages) {
      for (const line of pack.lines) {
        lines.push(
          [
            line.item.stage ?? '',
            line.item.package ?? '',
            line.item.title,
            line.item.owedBy ?? '',
            REQUIREMENT_STATUS_LABEL[line.status],
            line.askedOf ?? '',
            line.dueAt?.slice(0, 10) ?? '',
            line.overdue ? 'yes' : '',
            line.receivedAt?.slice(0, 10) ?? '',
            line.fileName ?? '',
            line.item.note ?? '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
