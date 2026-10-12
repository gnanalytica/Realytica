/**
 * The checklist of papers owed as a spreadsheet, beside the requirement
 * sheet's (`requirementSheetCsv`): one line a paper, in the order the desk
 * shows them, with who owes it, how it stands and what answers it.
 */

import type { ChecklistSheet } from './checklist';
import { REQUIREMENT_STATUS_LABEL } from './requirement-sheet';

function csvCell(value: string): string {
  // A cell that opens with a sign a spreadsheet reads as a formula is given as text. A tab or a carriage return before the sign is dropped on opening, so they count as one.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
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

/**
 * The checklist as the file that is downloaded: the same lines after a
 * byte-order mark, which is what tells Excel the file is UTF-8. Without it a
 * title in Devanagari or Kannada opens as broken letters.
 */
export function checklistCsvFile(sheet: ChecklistSheet): string {
  return `\uFEFF${checklistCsv(sheet)}`;
}
