import { useAuthedUrl } from '../../lib/useAuthedUrl';

interface Line {
  kind: 'work' | 'issue' | 'manpower' | 'weather';
  text: string;
  quote: string;
}

const LABEL: Record<Line['kind'], string> = { work: 'Work done', issue: 'Issue', manpower: 'On site', weather: 'Weather' };

/**
 * A site entry proposed from a voice note, as its card shows it: each line
 * beside the words of the note it came from, and the note itself to listen
 * to. The sound is fetched only when somebody opens the card.
 */
export function SiteEntryLines({ projectId, proposalId, payload }: { projectId: string; proposalId: string; payload: Record<string, unknown> }) {
  const lines = (Array.isArray(payload.lines) ? payload.lines : []) as Line[];
  const sound = useAuthedUrl(`/api/projects/${projectId}/chat/proposals/${proposalId}/file`);
  const from = payload.dateFrom === 'said' ? `The day the note says: “${String(payload.dateQuote ?? '')}”.` : 'The day the note was recorded: it names no day.';
  return (
    <div className="ml-4 space-y-1.5">
      <p className="text-[12px] text-ink-secondary">{from}</p>
      <ul className="space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="text-[12px] leading-relaxed text-ink">
            <span className="font-medium">{LABEL[line.kind] ?? 'Work done'}:</span> {line.text === line.quote ? null : `${line.text} `}
            <span className="text-ink-muted">“{line.quote}”</span>
          </li>
        ))}
      </ul>
      {sound.url ? <audio controls preload="none" src={sound.url} className="h-8 w-full max-w-[320px]" aria-label="The voice note" /> : null}
      <p className="text-[11px] text-ink-muted">Adds the entry to the site log, with the voice note beside it. Nothing is on the record until you accept.</p>
    </div>
  );
}
