import type { DdProject, ReportTable } from '@realytica/shared';
import { evidenceFileUrl } from '../../lib/api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { cn } from '../ui/kit';

/**
 * A report section that is a table: the observations and their mitigations,
 * the answered questionnaire, the document sheet. One component for the
 * editor and the printed page, so what is edited is what prints.
 */
export function ReportTableView({ table, print = false, onOpenRecord }: { table: ReportTable; print?: boolean; onOpenRecord?: (recordId: string) => void }) {
  const line = print ? 'border-neutral-300' : 'border-hairline';
  const last = table.columns.length - 1;
  const max = table.bars ? Math.max(1, ...table.rows.map((r) => Number(r.cells[last]) || 0)) : 0;
  return (
    <div className={cn('overflow-x-auto', print ? 'mt-2' : 'rounded-xl ring-1 ring-inset ring-[var(--ring)]')}>
      <table className={cn('w-full border-collapse text-left align-top', print ? 'text-[12px]' : 'text-[13px]')}>
        <thead>
          <tr className={cn('border-b', line, print ? 'bg-neutral-100' : 'bg-sunken/70')}>
            {table.columns.map((c) => (
              <th key={c} scope="col" className={cn('px-2 py-1.5 font-semibold', print ? 'text-black' : 'text-ink')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr
              key={i}
              onClick={row.recordId && onOpenRecord ? () => onOpenRecord(row.recordId!) : undefined}
              className={cn('border-b align-top last:border-b-0', line, print && 'break-inside-avoid', row.recordId && onOpenRecord && 'cursor-pointer hover:bg-sunken/60')}
            >
              {row.cells.map((cell, j) => (
                <td key={j} className={cn('px-2 py-1.5', j === 0 && 'whitespace-nowrap font-mono tabular-nums', print ? 'text-black' : j === 0 ? 'text-ink-muted' : 'text-ink-secondary')}>
                  {table.bars && j === last ? (
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-right font-mono tabular-nums">{cell}</span>
                      <span className={cn('h-2.5 rounded-full', print ? 'bg-neutral-700' : 'bg-ink')} style={{ width: `${Math.max(4, ((Number(cell) || 0) / max) * 60)}%` }} aria-hidden />
                    </span>
                  ) : j === 1 && row.worded && !print ? (
                    // Words a model put the line in, and nobody has yet read through: the colour of what waits. Print carries the note under the table instead.
                    <span className="text-provenance-ink" title="A model put this line in plainer words. The day, the person and what is behind it are the file’s own.">
                      {cell}
                    </span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Photo({ project, evidenceId, caption, print }: { project: DdProject; evidenceId: string; caption: string; print: boolean }) {
  const row = project.evidence.find((e) => e.id === evidenceId);
  const shot = row?.attachments.find((a) => a.mimeType.startsWith('image/'));
  const { url } = useAuthedUrl(row && shot ? evidenceFileUrl(project.id, row.id, shot.id, { inline: true }) : undefined);
  if (!row || !shot) return null;
  const taken = shot.capture?.takenAt ?? shot.uploadedAt;
  return (
    <figure className="break-inside-avoid">
      <div className={cn('aspect-[4/3] overflow-hidden rounded-lg', print ? 'border border-neutral-300 bg-neutral-100' : 'bg-sunken ring-1 ring-inset ring-[var(--ring)]')}>
        {url ? <img src={url} alt={row.title} className="size-full object-cover" /> : null}
      </div>
      <figcaption className={cn('mt-1 text-[11px] leading-snug', print ? 'text-neutral-700' : 'text-ink-secondary')}>
        {caption}: {row.title}
        {taken ? ` · ${new Date(taken).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
        {shot.capture?.lat != null && shot.capture?.lng != null ? ` · ${shot.capture.lat.toFixed(5)}, ${shot.capture.lng.toFixed(5)}` : ''}
      </figcaption>
    </figure>
  );
}

/** The photographs a table's rows cite, each captioned with the row it belongs to. */
export function photosOfTable(project: DdProject, table: ReportTable): Array<{ evidenceId: string; caption: string }> {
  const out: Array<{ evidenceId: string; caption: string }> = [];
  for (const row of table.rows) {
    let n = 0;
    for (const id of row.evidenceIds ?? []) {
      const e = project.evidence.find((x) => x.id === id);
      if (!e?.attachments.some((a) => a.mimeType.startsWith('image/'))) continue;
      n += 1;
      out.push({ evidenceId: id, caption: `Photograph ${row.cells[0] || '–'}.${n}` });
    }
  }
  return out;
}

export function ReportPhotos({ project, table, print = false }: { project: DdProject; table: ReportTable; print?: boolean }) {
  const photos = photosOfTable(project, table);
  if (!photos.length) return null;
  return (
    <div className="mt-3">
      <p className={cn('text-[12px] font-semibold', print ? 'text-black' : 'text-ink')}>Photographs</p>
      <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((p) => (
          <Photo key={`${p.caption}:${p.evidenceId}`} project={project} evidenceId={p.evidenceId} caption={p.caption} print={print} />
        ))}
      </div>
    </div>
  );
}
