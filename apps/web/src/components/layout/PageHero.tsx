import type { ReactNode } from 'react';
import { cn } from '../ui/kit';
import { AmbientField, RampRule } from '../visuals';

/**
 * The opening of an app page.
 *
 * Every screen inside the app used to begin the same way: straight into a row
 * of stat tiles or a filter bar, with the only clue to where you were being
 * fourteen pixels of type in the top bar. Pages had no beginning, so a long
 * scroll had no top to return to and two different pages looked like the same
 * page with different numbers on it.
 *
 * This gives each one an opening: what this screen is, in a sentence, over the
 * ambient field, with its actions in a fixed place and — where there is one —
 * a drawing on the right. The field is the same one the front door uses at
 * lower strength, which is most of what makes the marketing page and the
 * application feel like one product rather than two.
 *
 * `art` is a slot rather than a variant because the right drawing differs by
 * page and only the page knows which: a parcel plan for a case, a locality
 * sheet for a location view, a massing block for yield. A page with nothing
 * worth drawing passes nothing and gets a clean band.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  actions,
  art,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'relative isolate mb-5 overflow-hidden rounded-2xl bg-tile shadow-tile ring-1 ring-[var(--ring)]',
        className,
      )}
    >
      <AmbientField variant="band" className="-z-10" intensity={0.85} />
      <RampRule className="absolute inset-x-0 top-0" />

      <div className="flex flex-wrap items-start justify-between gap-6 p-5 sm:p-6">
        <div className="min-w-[16rem] max-w-[62ch] flex-1">
          {eyebrow ? (
            <p className="m-0 mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">{eyebrow}</p>
          ) : null}
          <h1 className="m-0 font-display text-[24px] font-normal leading-tight tracking-tight text-ink sm:text-[28px]">{title}</h1>
          {lead ? <p className="m-0 mt-2.5 text-[13.5px] leading-relaxed text-ink-secondary">{lead}</p> : null}
          {actions ? <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>

        {/*
          * The drawing is hidden below `sm`, not shrunk.
          *
          * At phone width it would take the whole column and push the actions
          * below the fold, and a decorative image that costs you the button is
          * a bad trade. `hidden` rather than a media-query-free zero size so
          * the SVG is not laid out or animated at all on a phone.
          */}
        {art ? <div className="hidden w-[220px] shrink-0 overflow-hidden rounded-xl ring-1 ring-[var(--ring)] sm:block">{art}</div> : null}
      </div>
    </header>
  );
}
