import { STATION_PHOTO_COLUMNS, type DdProject, type ReportTable } from '@realytica/shared';

/**
 * One photograph a report's table prints under it: where the picture is
 * kept, and the caption it goes under.
 *
 * A photograph is on the document register (`evidenceId` and `fileId`) or
 * still only in the site log (`sitePhoto`). A section of photographs by
 * station and period cites both kinds, and both are printed: the Word file
 * and the screen read this one list.
 */
export interface ReportPhotoRef {
  caption: string;
  evidenceId?: string;
  fileId?: string;
  mimeType?: string;
  sitePhoto?: { entryId: string; index: number };
}

/** The photographs a table's rows cite, in the order of its rows: the filed ones, and the site log's own. */
export function reportTablePhotos(project: Pick<DdProject, 'evidence'>, table: ReportTable): ReportPhotoRef[] {
  // A table of stations by period captions a photograph by its station, its period, its day and who took it.
  const stations = table.columns.join('|') === STATION_PHOTO_COLUMNS.join('|');
  const out: ReportPhotoRef[] = [];
  for (const row of table.rows) {
    const [name, , period, taken, by] = row.cells;
    const ofStation = `${name}, ${period}: ${taken}${by ? ` · ${by}` : ''}`;
    let n = 0;
    for (const id of row.evidenceIds ?? []) {
      const filed = project.evidence.find((held) => held.id === id);
      const shot = filed?.attachments.find((file) => file.mimeType.startsWith('image/'));
      if (!filed || !shot) continue;
      n += 1;
      out.push({ caption: stations ? ofStation : `Photograph ${row.cells[0] || '–'}.${n}: ${filed.title}`, evidenceId: filed.id, fileId: shot.id, mimeType: shot.mimeType });
    }
    // Still in the site log: nobody has filed it, and it is the station's shot of the period all the same.
    if (row.sitePhoto && !n) out.push({ caption: ofStation, sitePhoto: row.sitePhoto });
  }
  return out;
}
