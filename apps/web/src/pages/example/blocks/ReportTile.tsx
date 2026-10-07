import { ChevronRight, FileText } from 'lucide-react';
import { cn, useToast } from '../../../components/ui/kit';
import { useExample } from '../state';

/**
 * A report, as its cover: a spine down the left that takes colour once a
 * draft exists. `tag` names the function, for a list that mixes several.
 */
export function ReportTile({ id, title, tag }: { id: string; title: string; tag?: string }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const made = Boolean(state.drafted[id]);
  return (
    <button
      type="button"
      onClick={() => {
        if (!made) dispatch({ type: 'mark', what: 'drafted', ids: [id] });
        toast(made ? 'Opens the draft.' : 'Draft made.');
      }}
      className={cn(
        'group/tile grid grid-cols-[28px_minmax(0,1fr)] content-start gap-x-2.5 gap-y-px rounded-[4px_10px_10px_4px] border border-l-4 border-hairline bg-surface px-3 py-[11px] text-left text-[13px] text-ink',
        'transition-[transform,box-shadow] duration-base ease-enter hover:-translate-y-0.5 hover:shadow-tile motion-reduce:hover:translate-y-0',
        made ? 'border-l-brand' : 'border-l-[var(--axis)]',
      )}
    >
      <span aria-hidden className="row-span-3 grid size-7 place-items-center rounded-[7px] bg-brand-soft text-brand-strong">
        <FileText size={16} strokeWidth={1.7} />
      </span>
      <b className="font-semibold [overflow-wrap:anywhere]">{title}</b>
      <span className="col-start-2 text-[12px] text-ink-muted">
        {tag ? `${tag} · ` : ''}
        {made ? 'Draft made' : 'Not drafted yet'}
      </span>
      <span className="col-start-2 mt-[7px] inline-flex items-center gap-1 justify-self-start text-[12px] font-semibold text-brand-strong">
        {made ? 'Open draft' : 'Create draft'}
        <ChevronRight size={12} aria-hidden className="transition-transform duration-quick ease-state group-hover/tile:translate-x-[3px] motion-reduce:transition-none" />
      </span>
    </button>
  );
}
