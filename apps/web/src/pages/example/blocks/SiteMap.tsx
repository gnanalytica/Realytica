import { MapBlock, type MapBlockSpec } from '../MapBlock';
import { mapHome, type BlockAt } from '../engine';
import { useOpen } from '../place';
import { useExample } from '../state';

/**
 * A map on a function's page.
 *
 * The project keeps one map, in Engineering · Site. Anywhere else this is a
 * view of it with its own layers switched on, and it says where the original
 * is. Which layers are on is remembered for each map separately.
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
