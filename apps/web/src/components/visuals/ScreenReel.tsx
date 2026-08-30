import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, CircleDashed, Pause, Play, ShieldAlert, TriangleAlert } from 'lucide-react';
import { KARNATAKA_PACK } from '@realytica/shared';
import { cn } from '../ui/kit';
import { useInView, useReducedMotion } from '../../lib/useReveal';
import { ParcelPlan } from './ParcelPlan';
import { MassingRender } from './MassingRender';

/*
 * ============================================================================
 * The reel — five scenes of the product working, on a loop
 * ============================================================================
 *
 * What a landing page owes a visitor is a demonstration, and the usual way to
 * pay that debt is a screen recording. A recording would have been the wrong
 * artefact here for reasons that are not aesthetic:
 *
 *   It goes stale silently. A recorded UI is a photograph of a build. The app
 *   ships, the video does not, and six months later the front door is showing
 *   a product that no longer exists — with nothing in CI that can notice.
 *
 *   It cannot be read. A recording is pixels: no text selection, no screen
 *   reader, no reflow on a phone, no dark mode, and it looks soft on every
 *   display it was not mastered for.
 *
 *   It weighs several megabytes and comes from a CDN. Nothing else in this
 *   app makes an external request.
 *
 * So the reel is built out of the same components the app renders, reading the
 * same shipped pack. Every statute cited in scene three is read out of
 * `KARNATAKA_PACK` at render time: if a check is added, the reel shows it, and
 * if the pack changes shape the build fails rather than the page lying. It
 * theme-swaps, it scales, its type is real type, and it is a few kilobytes.
 *
 * --- The one thing it invents, and how that is handled --------------------
 *
 * Scene three shows verdicts. No case has been screened to produce them, so
 * they are a worked example — which is a thing this product is otherwise
 * extremely careful never to blur. The reel is therefore labelled `Specimen
 * run` in its own chrome, permanently and not on hover, and the verdicts shown
 * include an unanswered check and an unpriced charge, because a specimen that
 * showed everything coming back clear would be selling a product that does not
 * exist.
 *
 * --- Playback -------------------------------------------------------------
 *
 * It plays only while on screen, so it is not burning a phone battery three
 * sections above where the reader is. It can be paused, and every chapter is a
 * button, so the whole thing is steppable by hand. Under
 * `prefers-reduced-motion` it does not advance itself at all and becomes a
 * five-tab figure — the content is identical, only the timer is gone.
 */

const SCENE_MS = 5200;
const TICK_MS = 70;

/*
 * A note on the type inside the stage.
 *
 * Every size in the five scenes below is hand-set in pixels rather than taking
 * the `micro` / `mini` tokens, and that is deliberate: the tokens grow under a
 * coarse pointer, which is right for controls a thumb has to hit and wrong
 * here. The stage is a picture OF an interface, drawn at reduced scale inside
 * a 16:9 frame — grow its type on a phone and the rows it belongs to overflow
 * the frame, so the reel stops depicting a working screen and starts depicting
 * a broken one.
 *
 * Nothing inside the stage is interactive, so nothing inside it has a touch
 * target to satisfy. The reel's own chrome — the chapter buttons, the pause
 * control — is real UI and does take the tokens and the 44px minimum.
 */
interface Chapter {
  key: string;
  label: string;
  caption: string;
  render: () => ReactNode;
}

export function ScreenReel({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>();
  const [scene, setScene] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);

  const chapters = useMemo(() => CHAPTERS, []);
  const playing = !reduced && !paused && inView;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      elapsed.current += TICK_MS;
      if (elapsed.current >= SCENE_MS) {
        elapsed.current = 0;
        setScene(s => (s + 1) % chapters.length);
      }
      setProgress(elapsed.current / SCENE_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, chapters.length]);

  function go(next: number) {
    elapsed.current = 0;
    setProgress(0);
    setScene(next);
  }

  const active = chapters[scene];

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* The bezel. A gradient ring rather than a border, so the frame belongs
          to the same palette as the field behind it. */}
      <div className="relative rounded-2xl bg-ramp p-px shadow-pop">
        <div className="relative overflow-hidden rounded-[15px] bg-page">
          {/* Chrome. Not a fake browser toolbar with fake traffic lights —
              this is an application, and the strip says what is on screen. */}
          <div className="flex items-center gap-3 border-b border-hairline bg-surface/80 px-3 py-2">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-brand/70" />
              <span className="h-2 w-2 rounded-full bg-accent/70" />
              <span className="h-2 w-2 rounded-full bg-cyan/70" />
            </span>
            <span className="truncate font-mono text-micro uppercase tracking-[0.14em] text-ink-muted">
              Specimen run · Devanahalli · Karnataka pack
            </span>
            <button
              type="button"
              onClick={() => setPaused(p => !p)}
              className="ml-auto flex h-6 items-center gap-1 rounded-full px-2 text-micro font-medium text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink coarse:h-11 coarse:px-3"
              aria-label={paused ? 'Play the sequence' : 'Pause the sequence'}
            >
              {reduced ? null : paused ? <Play size={10} /> : <Pause size={10} />}
              {reduced ? 'Stepped' : paused ? 'Play' : 'Pause'}
            </button>
          </div>

          {/* The stage. A fixed aspect so the page does not jump between
              scenes of different natural heights — a reel that resizes the
              layout under the reader is worse than no reel. */}
          <div className="relative aspect-[16/9] w-full">
            {/* `key` restarts every entrance animation inside the scene. */}
            <div key={active.key} className="absolute inset-0">
              {active.render()}
            </div>
          </div>

          {/* Chapters. Buttons, not dots: the labels are the fastest summary of
              what the product does that exists anywhere on the page. */}
          <div className="grid grid-cols-5 gap-px border-t border-hairline bg-hairline">
            {chapters.map((c, i) => {
              const on = i === scene;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => go(i)}
                  aria-current={on ? 'step' : undefined}
                  className={cn(
                    'relative overflow-hidden bg-surface px-2 py-2 text-left transition-colors duration-quick coarse:min-h-11',
                    on ? 'text-ink' : 'text-ink-muted hover:bg-sunken hover:text-ink-secondary',
                  )}
                >
                  <span className="block font-mono text-micro uppercase tracking-[0.12em]">{`0${i + 1}`}</span>
                  <span className="block truncate text-mini font-medium">{c.label}</span>
                  {/* The progress fill doubles as the active indicator, so a
                      paused reel still shows where it stopped. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-ramp"
                    style={{ transform: `scaleX(${on ? (reduced ? 1 : progress) : 0})`, transition: 'transform 90ms linear' }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[12px] text-ink-muted" aria-live="polite">
        {active.caption}
      </p>
    </div>
  );
}

/* ==================================================================== */
/* Scene furniture                                                       */
/* ==================================================================== */

function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('absolute inset-0 overflow-hidden', className)}>{children}</div>;
}

function SceneTitle({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="absolute left-4 top-3 z-10 flex items-baseline gap-2 animate-fade-in">
      <span className="font-mono text-[10px] text-brand">{n}</span>
      <span className="font-display text-[15px] leading-none text-ink">{children}</span>
    </div>
  );
}

/* ==================================================================== */
/* 01 — the plot                                                         */
/* ==================================================================== */

function SceneSurvey() {
  return (
    <Stage className="bg-tile-sunken">
      <SceneTitle n="01">The plot, as the documents describe it</SceneTitle>
      {/*
        * The plan is boxed rather than full-bleed.
        *
        * Stretched across the whole 16:10 stage it rendered at four and a half
        * times its drawn scale, which turned 1.8px survey lines into 8px bars
        * and made a precise drawing look like a diagram of a diagram. Boxed at
        * roughly its native aspect it stays a plan, and the panel beside it
        * gets to carry the figures — which is also how the app itself lays this
        * out, so the reel is showing the real thing.
        */}
      <div className="absolute inset-x-4 bottom-4 top-11 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-[var(--ring)]">
          <ParcelPlan seed="reel-devanahalli-01" className="h-full w-full" caption={false} />
        </div>
        <div className="flex flex-col justify-center gap-1.5">
          {[
            ['Extent', '111.5 m²'],
            ['Frontage', "30'"],
            ['Setback', '3 m / 1.5 m'],
            ['Sources agreeing', '3'],
          ].map(([k, v], i) => (
            <div
              key={k}
              className="flex animate-rise-in items-baseline justify-between gap-2 rounded-md bg-surface px-2.5 py-1.5 ring-1 ring-inset ring-[var(--ring)]"
              style={{ animationDelay: `${900 + i * 180}ms` }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">{k}</span>
              <span className="tabular-nums text-[11px] font-medium text-ink">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}

/* ==================================================================== */
/* 02 — the documents                                                    */
/* ==================================================================== */

/** Field, value, and the page it was read from — never a value on its own. */
const EXTRACTED: readonly (readonly [string, string, string])[] = [
  ['Instrument', 'Sale deed · 2019', 'Registered 14 Mar 2019, SRO Devanahalli'],
  ['Extent conveyed', '111.5 m²', 'Sale deed, p.3, recital 2'],
  ['Khata', 'A · BBMP', 'Khata extract, 2023-24'],
  ['Encumbrance', 'Nil, 13 yr', 'EC Form 15, 2011–2024'],
  ['Schedule', "30' × 40'", 'Schedule of property, item 1'],
];

/**
 * A page of a Karnataka sale deed, at the density a page of one actually has.
 *
 * The first cut drew eleven three-pixel rules at 12% ink in a 560px sheet,
 * which filled the top eighth of the paper and left the rest blank — it read
 * as a wireframe of a document rather than as a document. A deed page is
 * dense, it has a recital block and a numbered schedule, and the schedule is
 * the part this product reads hardest, so it is the part drawn most clearly.
 */
function DeedSheet() {
  const recital = [96, 88, 93, 74, 90, 85, 97, 69, 92, 87, 78, 94, 83, 91, 66];
  const schedule = [82, 68, 90, 57];
  const attestation = [89, 76, 94, 63];
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg px-4 py-3.5">
      {/* Title block. */}
      <div className="mb-1 h-2 w-24 rounded-full bg-brand/80" />
      <div className="mb-3 h-1.5 w-16 rounded-full bg-ink/25" />

      <div className="space-y-[6px]">
        {recital.map((w, i) => (
          <div key={i} className="h-[3.5px] rounded-full bg-ink/22" style={{ width: `${w}%` }} />
        ))}
      </div>

      {/* The schedule of property — boxed, because it is boxed on the page and
          because it is the block every extent in this product comes from. */}
      <div className="mt-4 rounded border border-hairline p-2.5">
        <div className="mb-2 h-1.5 w-28 rounded-full bg-accent/70" />
        <div className="space-y-[6px]">
          {schedule.map((w, i) => (
            <div key={i} className="h-[3.5px] rounded-full bg-ink/28" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-[6px]">
        {attestation.map((w, i) => (
          <div key={i} className="h-[3.5px] rounded-full bg-ink/22" style={{ width: `${w}%` }} />
        ))}
      </div>

      {/* `flex-1` rather than a fixed margin: the sheet is used at whatever
          height its column happens to be, and an execution block floating in
          the middle of a page is the tell that a document is a mock-up. */}
      <div className="flex-1" />

      <div className="flex items-end justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="h-px w-2/3 bg-ink/30" />
          <div className="h-px w-2/3 bg-ink/30" />
        </div>
        <svg viewBox="0 0 40 40" className="h-11 w-11 shrink-0 text-accent opacity-75">
          <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 2.5" />
          <circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M13 20 L18 25 L27 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>

      {/* The scan pass — a narrow specular band, not a wash. A wide one reads
          as a gradient somebody left on the page. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 -left-[10%] w-[10%] animate-sweep bg-gradient-to-r from-transparent via-cyan/40 to-transparent"
      />
    </div>
  );
}

function SceneDocuments() {
  return (
    <Stage className="bg-tile">
      <SceneTitle n="02">Every page, read and cited</SceneTitle>

      <div className="absolute inset-x-4 bottom-4 top-11 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The stack: three sheets fanned, the front one being read. */}
        <div className="relative">
          {[2, 1, 0].map(i => (
            <div
              key={i}
              className="absolute inset-0 animate-rise-in rounded-lg bg-raised shadow-tile ring-1 ring-[var(--ring)]"
              style={{
                animationDelay: `${140 * (2 - i)}ms`,
                transform: `translate(${i * 9}px, ${i * -7}px) rotate(${i * -1.8}deg)`,
              }}
            >
              {i === 0 && <DeedSheet />}
            </div>
          ))}
        </div>

        {/* What came off the page, with the page it came off. */}
        <div className="flex flex-col justify-center gap-2">
          <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">Read from the instrument</p>
          {EXTRACTED.map(([k, v, src], i) => (
            <div
              key={k}
              className="animate-rise-in rounded-md bg-surface px-3 py-2 ring-1 ring-inset ring-[var(--ring)]"
              style={{ animationDelay: `${520 + i * 200}ms` }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">{k}</span>
                <span className="tabular-nums text-[12px] font-medium text-ink">{v}</span>
              </div>
              {/* The provenance line. It is the product's one non-negotiable,
                  so it is in the demo of the product. */}
              <p className="m-0 mt-0.5 font-mono text-[9.5px] text-brand">{src}</p>
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}

/* ==================================================================== */
/* 03 — the checks                                                       */
/* ==================================================================== */

/*
 * Six checks off the front of the shipped pack, with a specimen verdict each.
 *
 * The verdicts are assigned by position rather than by key so the reel cannot
 * break when the pack is reordered — and deliberately include one `unanswered`
 * and one `serious`. A demo where everything comes back clear is a demo of a
 * product that never finds anything, which is not this one.
 */
const VERDICTS = [
  { tone: 'good', label: 'Clear', Icon: Check },
  { tone: 'good', label: 'Clear', Icon: Check },
  { tone: 'warning', label: 'Query', Icon: TriangleAlert },
  { tone: 'neutral', label: 'Not assessed', Icon: CircleDashed },
  { tone: 'good', label: 'Clear', Icon: Check },
  { tone: 'serious', label: 'Blocker', Icon: ShieldAlert },
] as const;

const VERDICT_CLASS: Record<(typeof VERDICTS)[number]['tone'], string> = {
  good: 'bg-good/12 text-[var(--status-good-text)] ring-good/35',
  warning: 'bg-warning/18 text-ink ring-warning/45',
  serious: 'bg-serious/18 text-ink ring-serious/45',
  neutral: 'bg-sunken text-ink-secondary ring-[var(--ring)]',
};

function SceneChecks() {
  const checks = KARNATAKA_PACK.titleChecks.slice(0, VERDICTS.length);
  const tally = VERDICTS.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v.label]: (acc[v.label] ?? 0) + 1 }), {});

  return (
    <Stage className="bg-tile-sunken">
      <SceneTitle n="03">{`${KARNATAKA_PACK.titleChecks.length} statutory checks, each cited`}</SceneTitle>
      <div className="absolute inset-x-4 bottom-4 top-11 flex flex-col">
        <div className="flex items-baseline gap-3 border-b border-hairline pb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-muted">
          <span className="flex-1">Check</span>
          <span className="hidden w-[38%] sm:block">Cited to</span>
          <span className="w-[86px] text-right">Finding</span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-1.5 py-2">
          {checks.map((check, i) => {
            const v = VERDICTS[i];
            return (
              <div
                key={check.key}
                className="flex animate-rise-in items-center gap-3 rounded-md bg-surface/80 px-3 py-2.5 ring-1 ring-inset ring-[var(--ring)]"
                style={{ animationDelay: `${180 + i * 340}ms` }}
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{check.label}</span>
                <span className="hidden w-[38%] truncate font-mono text-[10px] text-ink-muted sm:block">
                  {check.statute.split(';')[0]}
                </span>
                <span
                  className={cn(
                    'flex w-[86px] shrink-0 items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium ring-1 ring-inset',
                    VERDICT_CLASS[v.tone],
                  )}
                >
                  <v.Icon size={10} />
                  {v.label}
                </span>
              </div>
            );
          })}
        </div>

        {/*
          * The tally.
          *
          * It is here because it is the honest summary of a screen and because
          * "3 clear" is not the headline — a blocker and an unanswered check
          * are, and a reel that buried them would be selling the wrong
          * product.
          */}
        <div
          className="flex animate-fade-in flex-wrap items-center gap-2 border-t border-hairline pt-2.5 font-mono text-[10px] text-ink-secondary"
          style={{ animationDelay: `${180 + checks.length * 340}ms` }}
        >
          {Object.entries(tally).map(([label, n]) => (
            <span key={label} className="rounded bg-surface px-2 py-1 ring-1 ring-inset ring-[var(--ring)]">
              <span className="tabular-nums text-ink">{n}</span> {label.toLowerCase()}
            </span>
          ))}
          <span className="ml-auto text-ink-muted">{`and ${KARNATAKA_PACK.titleChecks.length - checks.length} more in the pack`}</span>
        </div>
      </div>
    </Stage>
  );
}

/* ==================================================================== */
/* 04 — the massing                                                      */
/* ==================================================================== */

function SceneMassing() {
  return (
    <Stage className="bg-tile">
      <SceneTitle n="04">What the rules let you build</SceneTitle>
      <div className="absolute inset-x-4 bottom-14 top-10">
        <MassingRender seed="reel-devanahalli-01" floors={3} envelopeFloors={4} coverage={0.5} className="h-full w-full" />
      </div>
      <div className="absolute bottom-3 left-4 right-4 flex flex-wrap gap-1.5 animate-fade-in" style={{ animationDelay: '1100ms' }}>
        {[
          ['Coverage', '50%'],
          ['FAR used', '1.50 of 1.75'],
          ['Buildable', '167 m²'],
          ['Bound by', 'Height cap'],
        ].map(([k, v]) => (
          <span
            key={k}
            className="rounded-md bg-surface/90 px-2 py-1 font-mono text-[10px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
          >
            {k} <span className="tabular-nums text-ink">{v}</span>
          </span>
        ))}
      </div>
    </Stage>
  );
}

/* ==================================================================== */
/* 05 — the number                                                       */
/* ==================================================================== */

/**
 * How the range was reached, and why it does not collapse to a point.
 *
 * Three anchors with the weights the engine gave them, then the range they
 * produce, then the one charge that stops it becoming a single number. Showing
 * the weights matters: a range with no stated basis is a guess with error bars
 * on it, and the difference between this product and a guess is the entire
 * pitch.
 */
const ANCHORS = [
  { label: 'Comparable transactions', weight: 55, note: '9 sales, 400 m radius, 18 months' },
  { label: 'Residual, capped at buildable', weight: 25, note: 'G+2 massing, not the permitted G+3' },
  { label: 'Guidance value', weight: 20, note: 'Kaveri, Devanahalli hobli, 2024' },
];

function SceneOffer() {
  return (
    <Stage className="bg-tile-sunken">
      <SceneTitle n="05">And what to offer for it</SceneTitle>

      <div className="absolute inset-x-5 bottom-4 top-11 flex flex-col justify-center gap-4">
        {/* What the number rests on. */}
        <div className="space-y-2">
          <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">Weighted from</p>
          {ANCHORS.map((a, i) => (
            <div
              key={a.label}
              className="animate-rise-in rounded-md bg-surface px-3 py-2 ring-1 ring-inset ring-[var(--ring)]"
              style={{ animationDelay: `${140 + i * 200}ms` }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[12px] text-ink">{a.label}</span>
                <span className="tabular-nums text-[11px] font-medium text-ink-secondary">{a.weight}%</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full origin-left rounded-full bg-ramp"
                  style={{ width: `${a.weight}%`, animation: `draw-rule 700ms cubic-bezier(0.16,1,0.3,1) ${300 + i * 200}ms both` }}
                />
              </div>
              <p className="m-0 mt-1 font-mono text-[9.5px] text-ink-muted">{a.note}</p>
            </div>
          ))}
        </div>

        {/* The range. A band with a marker, not a single figure — the whole
            argument of the product is that a point estimate is a lie. */}
        <div>
          <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            <span>Indicative range</span>
            <span>Before the blocker clears</span>
          </div>
          <div className="relative mt-2 h-9 overflow-hidden rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]">
            <div className="h-full origin-left bg-ramp opacity-80" style={{ animation: 'draw-rule 900ms cubic-bezier(0.16,1,0.3,1) 900ms both' }} />
            <span
              className="absolute inset-y-0 w-[3px] animate-fade-in bg-ink"
              style={{ left: '58%', animationDelay: '1750ms' }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between tabular-nums text-[11px] text-ink-secondary">
            <span className="animate-fade-in" style={{ animationDelay: '1800ms' }}>₹ 82.0 L</span>
            <span className="animate-fade-in font-semibold text-ink" style={{ animationDelay: '1900ms' }}>₹ 96.4 L mid</span>
            <span className="animate-fade-in" style={{ animationDelay: '1800ms' }}>₹ 1.08 Cr</span>
          </div>
        </div>

        {/* The refusal, on screen, in the demo. This is the single most
            distinctive behaviour the engine has and it belongs in the reel
            rather than three sections further down the page. */}
        <div
          className="flex animate-rise-in items-start gap-2 rounded-lg bg-warning/12 p-2.5 ring-1 ring-inset ring-warning/40"
          style={{ animationDelay: '2100ms' }}
        >
          <TriangleAlert size={13} className="mt-px shrink-0 text-ink" />
          <p className="m-0 text-[11px] leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink">One charge is unpriced.</span> A betterment levy applies and its size is not
            yet known, so it is carried as unpriced rather than folded in as zero — and the offer advice returns no single
            figure until it is settled.
          </p>
        </div>
      </div>
    </Stage>
  );
}

const CHAPTERS: Chapter[] = [
  { key: 'survey', label: 'The plot', caption: 'Three instruments describe one parcel. All three are quoted, and any disagreement becomes the finding.', render: () => <SceneSurvey /> },
  { key: 'docs', label: 'The papers', caption: 'Every figure resolves to the page that states it — deed, khata extract, encumbrance certificate.', render: () => <SceneDocuments /> },
  { key: 'checks', label: 'The checks', caption: 'A check nobody has answered reports as unanswered. It never renders as clear.', render: () => <SceneChecks /> },
  { key: 'massing', label: 'The envelope', caption: 'Setbacks, coverage, floor area and the height cap, resolved into what is actually buildable.', render: () => <SceneMassing /> },
  { key: 'offer', label: 'The number', caption: 'A range with a stated basis — and no number at all where a real charge has no size yet.', render: () => <SceneOffer /> },
];
