import { Badge } from '../../components/ui/kit';
import { SectionPage, type PageSection } from '../../components/workspace/SectionPage';
import { fnId, insightsOf, slotState, standingOf, summary } from './engine';
import { SECTION_ICON } from './icons';
import type { ExampleStage } from './paths';
import { Blank, Capped, DropStrip, Group, RowButton, RowText, ShowAll } from './parts';
import { useOpen } from './place';
import { fnsOf } from './spec';
import { useExample } from './state';
import type { Department } from './types';
import { FlagRow } from './blocks/FlagRow';
import { InsightRow } from './blocks/InsightRow';
import { TILES } from './blocks/OutputsBlock';
import { ReportTile } from './blocks/ReportTile';
import { SlotRow } from './blocks/SlotRow';
import { Connections } from './Connections';

/** What to chase comes first: papers not asked for, then asked for, then in hand. */
const RANK = { none: 0, asked: 1, in: 2 };

/** How many report covers show before the rest are asked for. */
const COVERS = 6;

/**
 * A department as a whole at one stage: its functions and how each stands,
 * every paper it keeps, every report, every flag, what the copilot notices,
 * and how it connects to the others.
 */
export function SummaryPage({ dept, stage, jump }: { dept: Department; stage: ExampleStage; jump: { id: string; at: number } | null }) {
  const { state, dispatch } = useExample();
  const open = useOpen();
  const key = `${dept.key}@${stage}`;
  const fns = fnsOf(dept, stage);
  const sum = summary(dept, stage, state);
  const docs = [...sum.docs].sort((a, b) => RANK[slotState(a, state)] - RANK[slotState(b, state)]);
  const reports = fns.flatMap((fn) => fn.outputs.reports.map((title, i) => ({ id: `${fnId(dept, fn)}/rep/${i}`, title, tag: fn.name })));
  const everyCover = Boolean(state.opened[`${key}:reps`]) || reports.length <= COVERS;
  const insights = fns.flatMap((fn) => insightsOf(dept, fn, state));

  const sections: PageSection[] = [
    {
      id: 'fns',
      name: 'Functions',
      icon: SECTION_ICON.fns,
      body: (
        <Group title="Functions">
          {fns.length ? (
            <ul>
              {fns.map((fn) => {
                const standing = standingOf(dept, fn, state);
                const certified = standing.state === 'certified';
                return (
                  <li key={fn.name} className="border-t border-hairline">
                    <RowButton onClick={() => open.to(dept, fn)}>
                      <RowText
                        sub={fn.sections
                          .slice(0, 4)
                          .map((s) => s.name)
                          .join(' · ')}
                      >
                        {fn.name}
                      </RowText>
                      <span className="inline-flex shrink-0 gap-1.5">
                        {standing.state === 'certified' && standing.moved ? <Badge tone="warning">Revisit</Badge> : null}
                        <Badge tone={certified ? 'good' : 'neutral'}>{certified ? 'Certified' : 'Indicative'}</Badge>
                      </span>
                    </RowButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Blank>No functions at this stage.</Blank>
          )}
        </Group>
      ),
    },
    {
      id: 'docs',
      name: 'Documents',
      icon: SECTION_ICON.docs,
      body: (
        <Group title="Documents" note={`${sum.docsIn} of ${docs.length} in hand`}>
          {docs.length ? (
            <Capped id={`${key}:docs`} items={docs} cap={6}>
              {(slot) => <SlotRow key={slot.id} slot={slot} tagged />}
            </Capped>
          ) : (
            <Blank>No documents yet.</Blank>
          )}
          <DropStrip what="Add documents" says="Adds the files." />
        </Group>
      ),
    },
    {
      id: 'reports',
      name: 'Reports',
      icon: SECTION_ICON.report,
      body: (
        <Group title="Reports and filings">
          {reports.length ? (
            <>
              <div className={TILES}>
                {(everyCover ? reports : reports.slice(0, COVERS)).map((report) => (
                  <ReportTile key={report.id} id={report.id} title={report.title} tag={report.tag} />
                ))}
              </div>
              {everyCover ? null : <ShowAll count={reports.length} onClick={() => dispatch({ type: 'mark', what: 'opened', ids: [`${key}:reps`] })} />}
            </>
          ) : (
            <Blank>No reports yet.</Blank>
          )}
        </Group>
      ),
    },
    {
      id: 'flags',
      name: 'Flags',
      icon: SECTION_ICON.flags,
      body: (
        <Group title="Flags" note={sum.flags.length ? `${sum.flags.length} open` : undefined}>
          {sum.flags.length ? (
            <Capped id={`${key}:flags`} items={sum.flags}>
              {(flag) => <FlagRow key={flag.id} flag={flag} tagged />}
            </Capped>
          ) : (
            <Blank>No flags.</Blank>
          )}
        </Group>
      ),
    },
    {
      id: 'ai',
      name: 'AI insights',
      icon: SECTION_ICON.ai,
      body: (
        <Group title="AI insights">
          {insights.length ? (
            <Capped id={`${key}:ai`} items={insights}>
              {(insight) => <InsightRow key={insight.id} insight={insight} tagged />}
            </Capped>
          ) : (
            <Blank>Nothing to point out.</Blank>
          )}
        </Group>
      ),
    },
    { id: 'links', name: 'Connections', icon: SECTION_ICON.links, body: <Connections dept={dept} stage={stage} /> },
  ];

  return <SectionPage sections={sections} jump={jump} />;
}
