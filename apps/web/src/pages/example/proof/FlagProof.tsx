import { Button } from '../../../components/ui/kit';
import { flagById } from '../engine';
import { useOpen, usePlace } from '../place';
import { useExample, type ProofTab } from '../state';
import { Labelled, Pad, PassesOn, ProofHead, ProofTabs } from './pieces';

const TABS: [ProofTab, string][] = [
  ['source', 'Why'],
  ['links', 'Links'],
];

/** The proof of a flag: who or what raised it and in which function, with the way there. */
export function FlagProof({ id }: { id: string }) {
  const { state } = useExample();
  const open = useOpen();
  const place = usePlace();
  const flag = flagById(id, state);
  const why = !flag
    ? 'No longer open.'
    : flag.by === 'rule'
      ? `Raised by a rule in ${flag.fn.name}.`
      : flag.by === 'person'
        ? `Raised by a person in ${flag.fn.name}.`
        : `An AI insight in ${flag.fn.name}, raised as a flag by a person.`;

  return (
    <>
      <ProofHead kind="Flag" title={flag ? flag.t : 'Flag'} />
      <ProofTabs tabs={TABS} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.proofTab === 'links' && place.dept ? (
          <Pad>
            <Labelled label="This department passes on" />
            <PassesOn dept={place.dept} />
          </Pad>
        ) : (
          <Pad>
            <Labelled label="Why it was raised">{why}</Labelled>
            {flag && place.fn !== flag.fn ? (
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
