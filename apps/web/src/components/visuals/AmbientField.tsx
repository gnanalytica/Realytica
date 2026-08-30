import { cn } from '../ui/kit';
import { positionClass } from './position';

/**
 * The colour behind everything.
 *
 * Three or four soft radial sources, drifting slowly against one another,
 * under a layer of grain. It is the single piece of furniture that decides
 * whether a screen feels like a product or like a form, and it is why the app
 * can be genuinely colourful without any colour landing on a figure.
 *
 * Three things make it read as atmosphere rather than as a gradient:
 *
 *  - The sources move independently and on prime-ish periods, so the field
 *    never returns to a pose you have seen. A single animated gradient loops
 *    visibly within about fifteen seconds and then reads as a GIF.
 *  - It is blurred well past the radius of its own sources, which removes
 *    every edge. Any visible edge turns the field into a shape, and a shape
 *    behind text is a distraction.
 *  - Grain over the top. Large flat gradients band into concentric rings on
 *    8-bit displays, and that banding is the specific artefact that makes a
 *    gradient look cheap. A few percent of noise dithers it away.
 *
 * Every colour used here is an identity colour — indigo, violet, fuchsia,
 * cyan. None of them is a verdict, so no amount of this can be mistaken for a
 * finding. That is the rule that lets it be turned up this far.
 */
export function AmbientField({
  variant = 'mesh',
  className,
  intensity = 1,
}: {
  /**
   * `mesh`   — four sources, hero scale. For a page that opens with a picture.
   * `band`   — three sources across the top. For a section or page header.
   * `aurora` — a rotating conic behind a blur. For panels that should look lit.
   */
  variant?: 'mesh' | 'band' | 'aurora';
  className?: string;
  /**
   * Multiplies the theme's own field opacity. 1 is "as strong as this theme
   * allows"; use less to push a field further back behind dense content.
   */
  intensity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      // `field-layer` is what the print stylesheet switches off: ambient
      // colour is screen furniture, and on paper it costs toner and sits
      // under the figures somebody printed the page for.
      className={cn(
        'field-layer grain pointer-events-none inset-0 overflow-hidden',
        // `fixed inset-0` from the app shell has to win over a hard-coded
        // `absolute` — see `positionClass`.
        positionClass(className) === 'relative' ? 'absolute' : '',
        className,
      )}
      // Scaled by the theme rather than fixed: the same blob alphas that read
      // as a lit room on an indigo ground read as a paint spill on paper.
      style={{ opacity: `calc(var(--field-opacity) * ${intensity})` }}
    >
      {variant === 'aurora' ? (
        <div className="absolute -inset-1/2 animate-orbit bg-aurora opacity-70 blur-3xl" />
      ) : (
        <>
          {/*
            * Anchored to the edges, not spread across the middle.
            *
            * The first version used sources wide enough to overlap everywhere,
            * which averages out to one flat tint over the whole area — and a
            * flat tint over a warm paper ground is just a different, worse
            * paper. Pushing them to the corners leaves the page's own colour
            * visible through the middle, which is where the reading happens,
            * and gives the field a direction instead of a level.
            */}
          <Source className="animate-drift bg-brand/60" style={{ top: '-42%', left: '-20%', width: '58%', height: '125%' }} />
          <Source
            className="animate-drift-slow bg-accent/50"
            style={{ top: '-48%', right: '-18%', width: '52%', height: '120%', animationDelay: '-9s' }}
          />
          <Source
            className="animate-drift bg-cyan/45"
            style={{ bottom: '-56%', right: '14%', width: '44%', height: '112%', animationDelay: '-17s' }}
          />
          {variant === 'mesh' && (
            <Source
              className="animate-drift-slow bg-violet/50"
              style={{ bottom: '-60%', left: '4%', width: '50%', height: '118%', animationDelay: '-23s' }}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * One source.
 *
 * A blurred ellipse rather than a `radial-gradient`, because a gradient's
 * falloff is defined by its stops and a blur's falloff is Gaussian — and
 * Gaussian is what light actually does. Stacked gradients look like stacked
 * gradients; stacked blurs look like a lit room.
 */
function Source({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('absolute rounded-[50%] blur-3xl', className)} style={style} />;
}

/**
 * A one-pixel line carrying the identity ramp.
 *
 * Used as the top edge of the app frame and under section heads. It is a
 * small thing that does a disproportionate amount of work: it is the only
 * element that appears on literally every screen, so it is the thing that
 * makes two unrelated pages look like the same product.
 */
export function RampRule({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-px w-full bg-ramp', className)} />;
}
