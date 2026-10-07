import { Badge, cn } from '../../../components/ui/kit';
import { photoById, photoOk, type BlockAt, type PhotoRef } from '../engine';
import { AiChip, DropStrip, Group } from '../parts';
import { useOpen, usePicked } from '../place';
import { SEEK, useSeek } from '../seek';
import { useExample } from '../state';
import type { PhotosBlock as Spec } from '../types';
import { PhotoArt } from './PhotoArt';

/**
 * One photograph, as a print: the picture, where it was taken and what the
 * copilot says it shows. The description is a suggestion until a person
 * accepts it; pressing the print opens it large, with that choice beside it.
 */
function Print({ photo, index }: { photo: PhotoRef; index: number }) {
  const { state } = useExample();
  const open = useOpen();
  const visit = usePicked('photo', photo.id);
  const picked = visit > 0;
  const frame = useSeek<HTMLLIElement>(visit);
  const described = photoOk(photo, state);
  return (
    // The arrival is on the frame and the lift on the print, so one does not undo the other.
    <li ref={frame} className={cn('grid animate-rise-in', SEEK)} style={{ animationDelay: `${index * 30}ms` }}>
      <button
        type="button"
        aria-pressed={picked}
        onClick={() => open.photo(photo.id)}
        className={cn(
          'grid min-w-0 content-start gap-1 rounded-[3px] bg-surface px-1.5 pb-2.5 pt-1.5 text-left',
          'transition-[transform,box-shadow] duration-base ease-enter motion-reduce:transition-none',
          picked
            ? '-translate-y-[3px] shadow-raised ring-2 ring-brand'
            : 'shadow-tile ring-1 ring-[var(--ring)] hover:-translate-y-[3px] hover:rotate-[0.5deg] hover:shadow-raised motion-reduce:hover:transform-none',
        )}
      >
        <span className="block aspect-[16/10] overflow-hidden rounded-[2px] bg-sunken">
          <PhotoArt kind={photo.photo.art} />
        </span>
        <b className="px-1 pt-[5px] text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">{photo.photo.where}</b>
        <span className="line-clamp-2 px-1 text-[12px] text-ink-muted">{photo.photo.says}</span>
        <span className="mx-1 mt-[3px] justify-self-start">{described ? <Badge tone="good">Described</Badge> : <AiChip>To accept</AiChip>}</span>
      </button>
    </li>
  );
}

/** A contact sheet from the phone: the prints laid out on a board, and a strip to drop more on. */
export function PhotosBlock({ at, block }: { at: BlockAt; block: Spec }) {
  const photos = block.items.map((_, i) => photoById(`${at.id}/${i}`)).filter((x): x is PhotoRef => Boolean(x));
  return (
    <Group title={block.title ?? 'Photographs'} note="From the phone">
      <ul className="grid gap-3.5 border-t border-hairline bg-sunken bg-[radial-gradient(circle_at_1px_1px,var(--ring)_1px,transparent_0)] bg-[length:14px_14px] px-3.5 py-4 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {photos.map((photo, i) => (
          <Print key={photo.id} photo={photo} index={i} />
        ))}
      </ul>
      <DropStrip what="Add photographs" says="Adds the photographs." />
    </Group>
  );
}
