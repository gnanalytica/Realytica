import { Search } from 'lucide-react';
import { Badge, Button, Input, useToast } from '../../../components/ui/kit';
import { Group, LINE, RowText } from '../parts';
import type { SearchBlock as Spec } from '../types';

/** A look-up in an outside source: what was asked of it, what came back, and which results were picked. */
export function SearchBlock({ block }: { block: Spec }) {
  const toast = useToast();
  return (
    <Group title={block.title ?? 'Look-up'} note={block.source}>
      <div className="relative flex items-center gap-2 border-t border-hairline px-3.5 py-2.5">
        <Search size={15} aria-hidden className="pointer-events-none absolute left-[23px] z-[1] text-ink-muted" />
        <Input defaultValue={block.query} aria-label={`Search ${block.source}`} className="min-w-0 flex-1 pl-[30px]" />
        <Button variant="primary" onClick={() => toast('Searched.')}>
          Search
        </Button>
      </div>
      <ul>
        {block.results.map((result, i) => (
          <li key={i} className={LINE}>
            <RowText sub={result.sub}>{result.t}</RowText>
            {result.picked ? (
              <Badge tone="brand">Picked</Badge>
            ) : (
              <Button size="sm" onClick={() => toast('Picked.')}>
                Pick
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Group>
  );
}
