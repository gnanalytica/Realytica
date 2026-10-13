import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { papersPlacePath, projectBrief, reachesEveryProject, type BriefLine, type DdProject } from '@realytica/shared';
import { useMe } from '../../lib/useMe';
import { useDailyReviewCount } from '../review/DailyReview';
import { AiMark, cn, toneText } from '../ui/kit';

/**
 * What a person running the project asks first, in four lines: what needs
 * them, what is slipping, what is owed, what changed in cost.
 *
 * Each part of a line opens the page that holds it: a count of papers owed
 * opens the Documents of the department holding them. The daily review's
 * suggestions are one more thing that needs a person, so they are a part of
 * the first line and not a line of their own.
 */
export function ProjectBrief({ project }: { project: DdProject }) {
  const navigate = useNavigate();
  const me = useMe();
  const outside = me ? !reachesEveryProject(me.role) : true;
  const lines = useMemo(() => projectBrief(project, new Date(), { outside }), [project, outside]);
  const suggested = useDailyReviewCount(project.id);
  if (!me) return null;
  const go = (open: BriefLine['open']) => navigate(papersPlacePath(project.id, open));
  return (
    <section aria-label="What needs attention" className="divide-y divide-hairline rounded-2xl bg-surface shadow-card ring-1 ring-[var(--ring)]">
      {lines.map((line) => {
        const parts = [...line.parts, ...(line.key === 'needs' && suggested ? [{ text: `${suggested} suggested by the daily review`, open: { pane: 'risks' as const }, ai: true }] : [])];
        return (
          <div key={line.key} className="flex items-start gap-x-3 px-4 py-2.5 [@container(max-width:36rem)]:flex-col [@container(max-width:36rem)]:gap-y-0.5">
            <h3 className="w-28 shrink-0 text-[13px] font-semibold text-ink">{line.label}</h3>
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">
              {parts.length
                ? parts.map((part, i) => (
                    <span key={part.text}>
                      {i ? <span className="text-ink-muted"> · </span> : null}
                      <button type="button" onClick={() => go(part.open)} className={cn('rounded text-left hover:underline coarse:py-1', 'tone' in part && part.tone ? toneText(part.tone) : 'text-ink', 'tone' in part && part.tone ? 'font-medium' : '')}>
                        {'ai' in part ? <AiMark size="xs" className="mr-1 inline-block align-[-2px]" /> : null}
                        {part.text}
                      </button>
                    </span>
                  ))
                : line.quiet}
            </p>
            <button
              type="button"
              onClick={() => go(parts[0]?.open ?? line.open)}
              aria-label={`Open ${line.label}`}
              className="group/open shrink-0 self-center rounded-lg p-1 text-ink-muted hover:bg-sunken hover:text-ink [@container(max-width:36rem)]:hidden"
            >
              <ArrowRight size={13} className="transition-transform duration-quick ease-state group-hover/open:translate-x-0.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </section>
  );
}
