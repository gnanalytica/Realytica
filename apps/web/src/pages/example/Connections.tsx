import { FileText, Table2 } from 'lucide-react';
import { connections, passedTo, takenFrom, type Link } from './links';
import type { ExampleStage } from './paths';
import { Capped, Group, GroupHead, RowButton, RowText } from './parts';
import { useOpen } from './place';
import type { Department } from './types';

const NONE = 'px-3.5 pb-3 pt-1 text-[13px] text-ink-muted';

/** One connection. `note` is the function of this department it belongs to. */
function LinkRow({ link, says, note, onOpen }: { link: Link; says: string; note?: string; onOpen: () => void }) {
  const Kind = link.kind === 'paper' ? FileText : Table2;
  return (
    <li className="border-t border-hairline">
      <RowButton onClick={onOpen}>
        <Kind size={14} aria-hidden className="shrink-0 text-ink-muted" />
        <RowText sub={says}>{link.what}</RowText>
        {note ? <span className="whitespace-nowrap text-[12px] text-ink-muted">{note}</span> : null}
      </RowButton>
    </li>
  );
}

/**
 * How a department connects to the rest of the project, as two plain lists.
 *
 * What comes in: every paper it refers to that is filed in another function,
 * and every table whose rows arrive from one. What it passes on: the same,
 * seen from the departments that take from it. Each row opens the other end.
 */
export function Connections({ dept, stage }: { dept: Department; stage: ExampleStage }) {
  const open = useOpen();
  const { takes, gives } = connections(dept, stage);
  const key = `${dept.key}@${stage}`;
  return (
    <Group title="How this department connects" note={`${takes.length} in · ${gives.length} out`}>
      <GroupHead>Comes in from</GroupHead>
      {takes.length ? (
        <Capped id={`${key}:in`} items={takes} cap={6} flush>
          {(link) => (
            <LinkRow
              key={link.id}
              link={link}
              says={takenFrom(link)}
              note={link.user.fn.name}
              onOpen={() => open.to(link.origin.dept, link.origin.fn, { part: link.origin.section?.id })}
            />
          )}
        </Capped>
      ) : (
        <p className={NONE}>Nothing comes in.</p>
      )}
      <GroupHead>Passes on to</GroupHead>
      {gives.length ? (
        <Capped id={`${key}:out`} items={gives} cap={6} flush>
          {(link) => (
            <LinkRow
              key={link.id}
              link={link}
              says={passedTo(link)}
              note={link.origin.fn?.name}
              onOpen={() => open.to(link.user.dept, link.user.fn, { part: link.user.section.id })}
            />
          )}
        </Capped>
      ) : (
        <p className={NONE}>Nothing is passed on.</p>
      )}
    </Group>
  );
}
