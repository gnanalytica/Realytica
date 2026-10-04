import { Badge, Button, useToast } from '../../../components/ui/kit';
import { fnId, standingOf, type BlockAt } from '../engine';
import { Blank, Group, LINE, RowText } from '../parts';
import { useCertify, useExample } from '../state';
import { ReportTile } from './ReportTile';

/** The grid report covers are laid out on, here and on a department's Summary. */
export const TILES = 'grid gap-2.5 px-3.5 pb-3.5 pt-0.5 [grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr))]';

/**
 * What a function delivers: the figures the product works out as it goes,
 * which nobody has signed; the certified results a professional signs; the
 * reports and filings it produces; and what it sends on to people and to
 * other departments.
 *
 * The first certified result is the one the function is certified by. Filing
 * it is the same change as "Add certified result" on the standing strip, so
 * the two always agree.
 */
export function OutputsBlock({ at }: { at: BlockAt }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const certify = useCertify(at.dept, at.fn);
  const fid = fnId(at.dept, at.fn);
  const { indicative, certified, reports, sent } = at.fn.outputs;
  const signed = standingOf(at.dept, at.fn, state).state === 'certified';

  return (
    <>
      {indicative.length ? (
        <Group title="Indicative" note="worked out by the product, not signed">
          <ul>
            {indicative.map((text, i) => (
              <li key={i} className={LINE}>
                <RowText>{text}</RowText>
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {certified.length ? (
        <Group title="Certified" note="signed, the result of record">
          <ul>
            {certified.map((text, i) => {
              const id = `${fid}/cert/${i}`;
              const onFile = i === 0 ? signed : Boolean(state.filed[id]);
              return (
                <li key={id} className={LINE}>
                  <RowText>{text}</RowText>
                  {onFile ? (
                    <Badge tone="good">On file</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={
                        i === 0
                          ? certify
                          : () => {
                              dispatch({ type: 'mark', what: 'filed', ids: [id] });
                              toast('Files the signed result.');
                            }
                      }
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
                        toast('Sends it on.');
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
