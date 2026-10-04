import { MapBlock, type MapBlockSpec } from '../MapBlock';
import type { At, BlockAt } from '../engine';
import { useOpen } from '../place';
import { DEPARTMENTS } from '../spec';
import { useExample } from '../state';

/** The project keeps one map, in Engineering · Site. Every other map is a view of it. */
function mapHome(): At | null {
  const dept = DEPARTMENTS.find((d) => d.key === 'engineering');
  const fn = dept?.functions.find((f) => f.name === 'Site');
  const section = fn?.sections.find((s) => s.blocks.some((b) => b.type === 'map'));
  return dept && fn && section ? { dept, fn, section } : null;
}

/**
 * A map on a function's page.
 *
 * Anywhere but in Engineering · Site this is a view of the map kept there,
 * with its own layers switched on, and it says where the original is. Which
 * layers are on is remembered for each map separately.
 */
export function SiteMap({ at, block }: { at: BlockAt; block: MapBlockSpec }) {
  const { state, dispatch } = useExample();
  const open = useOpen();
  const kept = mapHome();
  const elsewhere = kept && kept.fn !== at.fn ? kept : null;
  return (
    <MapBlock
      block={block}
      layers={state.layers[at.id] ?? block.layers}
      onToggleLayer={(layer) => dispatch({ type: 'layer', map: at.id, layer, initial: block.layers })}
      home={
        elsewhere
          ? { label: `Kept in ${elsewhere.dept.label} · ${elsewhere.fn.name}`, onOpen: () => open.to(elsewhere.dept, elsewhere.fn, { part: elsewhere.section.id }) }
          : null
      }
    />
  );
}
