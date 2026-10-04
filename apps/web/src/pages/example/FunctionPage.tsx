import { Badge, Button, cn, useToast } from '../../components/ui/kit';
import { SectionPage, type PageSection } from '../../components/workspace/SectionPage';
import { blockId, fnId, standingOf } from './engine';
import { SECTION_ICON } from './icons';
import { useExample } from './state';
import type { Department, FunctionSpec } from './types';
import { BlockView } from './blocks/Block';
import { ChecksAndFlags } from './ChecksAndFlags';

/**
 * How a function stands: on a result a professional has signed, or on the
 * running estimate. A signed result that the estimate has since moved away
 * from says so, and offers to ask the signer to look again.
 */
function StandingStrip({ dept, fn }: { dept: Department; fn: FunctionSpec }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const standing = standingOf(dept, fn, state);
  const certified = standing.state === 'certified';
  return (
    <section
      aria-label="How this function stands"
      className={cn(
        'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl bg-surface px-3 py-[9px] text-[13px] text-ink-secondary shadow-card ring-1 ring-inset',
        certified ? 'ring-good/35' : 'ring-[var(--ring)]',
      )}
    >
      <Badge tone={certified ? 'good' : 'neutral'}>{certified ? 'Certified' : 'Indicative'}</Badge>
      <span className="min-w-0 flex-[1_1_170px] [overflow-wrap:anywhere]">
        {standing.state === 'certified'
          ? `${standing.by}, ${standing.role} · ${standing.on}${standing.moved ? ' · the estimate has moved since' : ''}`
          : `${standing.basis} · no certified result`}
      </span>
      {standing.state === 'indicative' ? (
        <Button
          size="sm"
          onClick={() => {
            dispatch({ type: 'certify', fn: fnId(dept, fn) });
            toast('Certified result added.');
          }}
        >
          Add certified result
        </Button>
      ) : standing.moved ? (
        <Button size="sm" onClick={() => toast('Asked the signer to revisit.')}>
          Ask to revisit
        </Button>
      ) : null}
    </section>
  );
}

/**
 * One function's page: how it stands, then its own sections one under
 * another, each made of the blocks its file lists, and last the checks and
 * flags every function carries.
 */
export function FunctionPage({ dept, fn, jump }: { dept: Department; fn: FunctionSpec; jump: { id: string; at: number } | null }) {
  const sections: PageSection[] = [
    ...fn.sections.map((section) => ({
      id: section.id,
      name: section.name,
      icon: SECTION_ICON[section.icon] ?? SECTION_ICON.details,
      body: section.blocks.map((block, i) => <BlockView key={i} at={{ dept, fn, section, id: blockId(dept, fn, section, i) }} block={block} />),
    })),
    { id: 'checks', name: 'Checks and flags', icon: SECTION_ICON.checks, body: <ChecksAndFlags dept={dept} fn={fn} /> },
  ];
  return <SectionPage sections={sections} lead={<StandingStrip dept={dept} fn={fn} />} jump={jump} />;
}
