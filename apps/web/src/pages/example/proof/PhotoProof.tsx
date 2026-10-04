import { Button, useToast } from '../../../components/ui/kit';
import { photoOk, type PhotoRef } from '../engine';
import { useExample, type ProofTab } from '../state';
import { PhotoArt } from '../blocks/PhotoArt';
import { Desk, History, Labelled, Pad, PassesOn, ProofFoot, ProofHead, ProofTabs, ReadCard, StandingChip, type Step } from './pieces';

const TABS: [ProofTab, string][] = [
  ['source', 'Source'],
  ['links', 'Links'],
  ['history', 'History'],
];

/**
 * The proof of one photograph: the picture itself, then what the copilot
 * says it shows. The description prints nowhere until a person accepts it.
 */
export function PhotoProof({ photo }: { photo: PhotoRef }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const { where, says, art } = photo.photo;
  const described = photoOk(photo, state);

  const history: Step[] = [
    { t: 'Taken on the phone', sub: 'R. Iyer · 3 Oct, 11:42' },
    { t: 'Described by the copilot', sub: '3 Oct, 11:43' },
    described
      ? { t: 'Description accepted', sub: 'S. Rao · 3 Oct, 12:05' }
      : { t: 'Waiting for a person to accept the description', sub: 'It prints nowhere until then', kind: 'wait' },
  ];

  return (
    <>
      <ProofHead kind="Photograph" title={where} />
      <ProofTabs tabs={TABS} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.proofTab === 'links' ? (
          <Pad>
            <Labelled label="Used in">
              {photo.fn.name} · {photo.section.name}
            </Labelled>
            <Labelled label="In the report">{described ? 'Chosen' : 'Not yet'}</Labelled>
            <Labelled label="This department passes on" />
            <PassesOn dept={photo.dept} />
          </Pad>
        ) : state.proofTab === 'history' ? (
          <Pad>
            <History steps={history} />
          </Pad>
        ) : (
          <Desk>
            <figure className="mx-auto max-w-[620px] overflow-hidden rounded-xl bg-surface ring-1 ring-[var(--ring)]">
              <PhotoArt kind={art} large />
              <figcaption className="border-t border-hairline px-3 py-2 text-[12px] text-ink-muted">Example image.</figcaption>
            </figure>
            <ReadCard
              title="What was read from it"
              rows={[
                ['Shows', <span className="font-display text-[14px] leading-normal">{says}</span>],
                ['Where', `${where} · 13.06° N, 77.59° E`],
                ['Taken', '3 Oct 2026, 11:42, on R. Iyer’s phone'],
                ['Read by', 'The copilot, a model'],
                ['Standing', <StandingChip standing={described ? 'accepted' : 'waiting'} />],
              ]}
            />
          </Desk>
        )}
      </div>
      {described ? null : (
        <ProofFoot>
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: 'mark', what: 'described', ids: [photo.id] });
              toast('Description accepted.');
            }}
          >
            Accept the description
          </Button>
          <Button onClick={() => toast('Opens for editing.')}>Edit it</Button>
        </ProofFoot>
      )}
    </>
  );
}
