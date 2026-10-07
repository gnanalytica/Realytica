import { Button } from '../../../components/ui/kit';
import type { FlagRef } from '../engine';
import { useOpen, usePlace } from '../place';
import { useExample, type ProofTab } from '../state';
import { Labelled, Pad, PassesOn, ProofHead, ProofTabs } from './pieces';

const TABS: [ProofTab, string][] = [
  ['source', 'Why'],
  ['links', 'Links'],
];

const RAISED: Record<FlagRef['by'], (fn: string) => string> = {
  rule: (fn) => `Raised by a rule in ${fn}.`,
  person: (fn) => `Raised by a person in ${fn}.`,
  ai: (fn) => `An AI insight in ${fn}, raised as a flag by a person.`,
};

/** The proof of a flag: who or what raised it and in which function, with the way there. */
export function FlagProof({ flag }: { flag: FlagRef }) {
  const { state } = useExample();
  const open = useOpen();
  const place = usePlace();

  return (
    <>
      <ProofHead kind="Flag" title={flag.t} />
      <ProofTabs tabs={TABS} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.proofTab === 'links' ? (
          <Pad>
            <Labelled label="This department passes on" />
            <PassesOn dept={flag.dept} />
          </Pad>
        ) : (
          <Pad>
            <Labelled label="Why it was raised">{RAISED[flag.by](flag.fn.name)}</Labelled>
            {place.fn !== flag.fn ? (
              <Button size="sm" className="justify-self-start" onClick={() => open.to(flag.dept, flag.fn, { part: 'checks' })}>
                Open {flag.fn.name}
              </Button>
            ) : null}
          </Pad>
        )}
      </div>
    </>
  );
}
