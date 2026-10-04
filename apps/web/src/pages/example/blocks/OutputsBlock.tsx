import { Badge, Button, useToast } from '../../../components/ui/kit';
import { fnId, standingOf, type BlockAt } from '../engine';
import { Blank, Group, LINE, RowText } from '../parts';
import { useExample } from '../state';
import { ReportTile } from './ReportTile';

/** The grid report covers are laid out on, here and on a department's Summary. */
export const TILES = 'grid gap-2.5 px-3.5 pb-3.5 pt-0.5 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]';

/**
 * What a function delivers: the certified results a professional signs, the
 * reports and filings it produces, and what it sends on to people and to
 * other departments. Nothing is sent without a person pressing Send.
 */
export function OutputsBlock({ at }: { at: BlockAt }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const fid = fnId(at.dept, at.fn);
  const { certified, reports, sent } = at.fn.outputs;
  const signed = standingOf(at.dept, at.fn, state).state === 'certified';

  return (
    <>
      {certified.length ? (
        <Group title="Certified" note="signed, the result of record">
          <ul>
            {certified.map((text, i) => {
              const id = `${fid}/cert/${i}`;
              // A function that stands certified has its first result on file already.
              const onFile = Boolean(state.filed[id]) || (i === 0 && signed);
              return (
                <li key={id} className={LINE}>
                  <RowText>{text}</RowText>
                  {onFile ? (
                    <Badge tone="good">On file</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        dispatch({ type: 'mark', what: 'filed', ids: [id] });
                        toast('Filed.');
                      }}
                    >
                      File it
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}
      <Group title="Reports and filings">
        {reports.length ? (
          <div className={TILES}>
            {reports.map((title, i) => (
              <ReportTile key={i} id={`${fid}/rep/${i}`} title={title} />
            ))}
          </div>
        ) : (
          <Blank>Nothing to deliver.</Blank>
        )}
      </Group>
      {sent.length ? (
        <Group title="Sent on" note="to people and other departments">
          <ul>
            {sent.map((text, i) => {
              const id = `${fid}/sent/${i}`;
              return (
                <li key={id} className={LINE}>
                  <RowText>{text}</RowText>
                  {state.sent[id] ? (
                    <Badge>Sent</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        dispatch({ type: 'mark', what: 'sent', ids: [id] });
                        toast('Sent, with your approval.');
                      }}
                    >
                      Send
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}
    </>
  );
}
