import { useState } from 'react';
import { ANALYTICS_WINDOW_DAYS, readsAnalytics, sameEmail, type PersonFigures as PersonFiguresView } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useMe } from '../../lib/useMe';
import { Card, CardBody, CardHeader, Select } from '../ui/kit';
import { FigureButton } from './FigureList';

/**
 * One person's figures: what is on them, what is overdue, what they accepted
 * lately, and how long a thing waited before they dealt with it.
 *
 * The server sends only the people this reader may read: themselves, and for
 * a department lead the people on the projects they lead. A viewer is sent
 * nobody and sees no card. The people are listed by name and one is shown at
 * a time; nothing here sets one beside another.
 */
export function PersonFigures() {
  const me = useMe();
  const asks = Boolean(me && readsAnalytics(me.role) && me.role !== 'viewer');
  const { data } = useAsync<{ people: PersonFiguresView[] } | null>(() => (asks ? api.analyticsPeople() : Promise.resolve(null)), [asks]);
  const [picked, setPicked] = useState<string | null>(null);
  const people = data?.people ?? [];
  if (!me || people.length === 0) return null;
  const person = people.find((p) => p.email === picked) ?? people.find((p) => sameEmail(p.email, me.email)) ?? people[0]!;
  const own = sameEmail(person.email, me.email);
  const whose = own ? 'you' : (person.name ?? person.email);
  const median = person.medianWaitDays;
  return (
    <Card>
      <CardHeader
        title="By person"
        subtitle={`${own ? 'Yours' : (person.name ?? person.email)} · last ${ANALYTICS_WINDOW_DAYS} days · ${person.projects} project${person.projects === 1 ? '' : 's'}`}
        action={
          people.length > 1 ? (
            <Select aria-label="Person" value={person.email} onChange={(e) => setPicked(e.target.value)}>
              {people.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name ?? p.email}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      <CardBody className="flex flex-wrap gap-1.5">
        <FigureButton label="open" title={`Open, on ${whose}`} figure={person.on} />
        <FigureButton label="overdue" title={`Overdue, on ${whose}`} figure={person.overdue} tone="critical" />
        <FigureButton label="accepted" title={`Accepted by ${whose}, last ${ANALYTICS_WINDOW_DAYS} days`} figure={person.accepted} />
        <FigureButton
          label={median === undefined ? 'median wait' : `day${median === 1 ? '' : 's'} median wait`}
          title={`What waited on ${whose}, last ${ANALYTICS_WINDOW_DAYS} days`}
          value={median === undefined ? '—' : median}
          figure={person.waited}
        />
      </CardBody>
    </Card>
  );
}
