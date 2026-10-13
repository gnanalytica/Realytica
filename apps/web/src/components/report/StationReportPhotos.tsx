import type { DdProject, ReportTable } from '@realytica/shared';
import { evidenceFileUrl } from '../../lib/api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { workspaceApi } from '../../lib/workspace-api';
import { cn } from '../ui/kit';

type Row = ReportTable['rows'][number];

/** One row's photograph: a filed one by its register row, or one still in the site log. A row with neither says the station was not photographed. */
function RowPhoto({ project, row, print }: { project: DdProject; row: Row; print: boolean }) {
  const filed = project.evidence.find((held) => held.id === row.evidenceIds?.[0]);
  const shot = filed?.attachments.find((file) => file.mimeType.startsWith('image/'));
  const path = filed && shot ? evidenceFileUrl(project.id, filed.id, shot.id, { inline: true }) : row.sitePhoto ? workspaceApi.sitePhotoUrl(project.id, row.sitePhoto.entryId, row.sitePhoto.index) : undefined;
  const { url } = useAuthedUrl(path);
  const [, , period, taken, by] = row.cells;
  return (
    <figure className="break-inside-avoid">
      <div className={cn('grid aspect-[4/3] place-items-center overflow-hidden rounded-lg', print ? 'border border-neutral-300 bg-neutral-100' : 'bg-sunken ring-1 ring-inset ring-[var(--ring)]')}>
        {url ? <img src={url} alt={`${row.cells[0]}, ${period}`} className="size-full object-cover" /> : !path ? <span className={cn('text-[11px]', print ? 'text-neutral-600' : 'text-ink-muted')}>{taken}</span> : null}
      </div>
      <figcaption className={cn('mt-1 text-[11px] leading-snug', print ? 'text-neutral-700' : 'text-ink-secondary')}>
        {period}
        {path ? `: ${taken}` : ''}
        {path && by ? ` · ${by}` : ''}
      </figcaption>
    </figure>
  );
}

/**
 * The photographs of a section that prints stations by period: each station
 * under its own name, its periods side by side, each photograph with its
 * period, its day and who took it. The same component for the editor and the
 * printed page.
 */
export function StationReportPhotos({ project, table, print = false }: { project: DdProject; table: ReportTable; print?: boolean }) {
  const stations = new Map<string, Row[]>();
  for (const row of table.rows) stations.set(row.recordId ?? row.cells[0]!, [...(stations.get(row.recordId ?? row.cells[0]!) ?? []), row]);
  if (!stations.size) return null;
  return (
    <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2" data-station-photos>
      {[...stations].map(([id, rows]) => (
        <div key={id} className="break-inside-avoid">
          <p className={cn('text-[12px] font-semibold', print ? 'text-black' : 'text-ink')}>
            {rows[0]!.cells[0]}
            {rows[0]!.cells[1] ? <span className={cn('font-normal', print ? 'text-neutral-600' : 'text-ink-muted')}> · {rows[0]!.cells[1]}</span> : null}
          </p>
          <div className={cn('mt-1.5 grid gap-3', rows.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {rows.map((row, index) => (
              <RowPhoto key={`${id}:${index}`} project={project} row={row} print={print} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
