import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Ban,
  Compass,
  FileSearch,
  GitBranch,
  HandCoins,
  MapPin,
  ScrollText,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import { ENGINE_VERSION, KARNATAKA_PACK, REFERENCE_DATA, SITE_CONSTRAINT_KEYS } from '@valytica/shared';
import { useReveal } from '../lib/useReveal';
import { LIFT, cn } from '../components/ui/kit';

/**
 * The front door.
 *
 * --- The one rule this page is written under -----------------------------
 *
 * Every number on it is read from the shipped data at render time, and there
 * is not a single claim about outcomes. No "40% faster", no satisfaction
 * percentage, no customer logos, no testimonials. Those were noted as the
 * thing the nearest competitor does and as the opposite of what this product
 * is: a tool whose entire proposition is that it will not assert what it
 * cannot evidence cannot open with an unevidenced assertion about itself.
 *
 * The counters below are therefore facts about the software — eleven title
 * checks because `KARNATAKA_PACK.titleChecks` has eleven entries — so they
 * cannot drift, cannot be wrong, and update themselves when the pack does.
 *
 * --- Motion ---------------------------------------------------------------
 *
 * No new vocabulary. The same three durations and two curves the app already
 * uses, the same `LIFT` on anything that lifts, and the global
 * `prefers-reduced-motion` guard covers all of it. `useReveal` starts
 * revealed and hides only once it knows the observer works, so a page that
 * loses its JavaScript is a static page rather than a blank one.
 */

/* ------------------------------------------------------------------ */
/* Facts, read rather than written                                     */
/* ------------------------------------------------------------------ */

const FACTS = [
  { value: KARNATAKA_PACK.titleChecks.length, label: 'Karnataka title checks', detail: 'khata classification, DC conversion, PTCL, e-khata, layout approval…' },
  { value: SITE_CONSTRAINT_KEYS.length, label: 'restrictions beyond title', detail: 'aerodrome height, transmission corridor, highway control line…' },
  { value: KARNATAKA_PACK.requiredDocuments.length, label: 'documents tracked', detail: 'and each one named when it is missing' },
  { value: REFERENCE_DATA.localities.filter(l => l.city === 'Bengaluru').length, label: 'Bengaluru localities', detail: 'with their own rates, liquidity and flood catchment' },
];

/* ------------------------------------------------------------------ */
/* Hero: a number resolving to its sources                             */
/* ------------------------------------------------------------------ */

/**
 * The animated demo in the hero.
 *
 * It shows the one thing that actually distinguishes this product: a figure
 * that dissolves into the sources behind it. Deliberately not a fake
 * dashboard — a dashboard screenshot says "we have charts", which every
 * competitor also has. This says "every number here has a receipt", which is
 * the claim.
 *
 * The sequence loops slowly and pauses on hover, because a loop the reader
 * cannot stop is a loop they scroll past to escape.
 */
const CHAIN = [
  { icon: FileSearch, label: 'Sale deed, page 3', note: 'extent conveyed: 111.5 sqm' },
  { icon: ScrollText, label: 'Khata extract', note: 'assessed area: 111.5 sqm' },
  { icon: Compass, label: 'Schedule of property', note: '30 ft × 40 ft = 111.5 sqm' },
  { icon: GitBranch, label: 'All three agree', note: 'no extent conflict on this parcel' },
];

function EvidenceChain() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Reduced motion gets the finished state, not a frozen first frame.
      //
      // `CHAIN.length`, not `CHAIN.length - 1`: an item shows when `step > i`,
      // so the last index needs a step above it. Off by one here hid the
      // conclusion — the "all three agree" line the whole example exists to
      // arrive at — from exactly the viewers who cannot watch it arrive.
      setStep(CHAIN.length);
      return;
    }
    const id = window.setInterval(() => setStep(s => (s + 1) % (CHAIN.length + 1)), 1400);
    return () => window.clearInterval(id);
  }, [paused]);

  return (
    <div
      className="rounded-2xl bg-surface p-5 shadow-card ring-1 ring-[var(--ring)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={0}
      aria-label="An example: the extent of a site, and the three documents that agree on it."
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Extent of this site</span>
        <span className="text-[11px] text-ink-muted">{paused ? 'paused' : 'live example'}</span>
      </div>
      <p className="m-0 mt-1 text-[30px] font-semibold tabular-nums tracking-tight text-ink">111.5 m²</p>

      <ul className="m-0 mt-4 list-none space-y-2 p-0">
        {CHAIN.map((item, i) => {
          const Icon = item.icon;
          const shown = step > i;
          const last = i === CHAIN.length - 1;
          return (
            <li
              key={item.label}
              className={cn(
                'flex items-start gap-2.5 rounded-lg px-2.5 py-2',
                last ? 'bg-good/10 ring-1 ring-inset ring-good/30' : 'bg-sunken',
                shown ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
              )}
              style={{ transition: 'opacity 320ms cubic-bezier(0.16,1,0.3,1), transform 320ms cubic-bezier(0.16,1,0.3,1)' }}
            >
              <Icon size={14} className={cn('mt-0.5 shrink-0', last ? 'text-good' : 'text-ink-muted')} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{item.label}</span>
                <span className="block text-[12px] text-ink-secondary">{item.note}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Reveal({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  const { props } = useReveal<HTMLDivElement>({ delayMs: delay });
  return (
    <div {...props} className={cn(props.className, className)}>
      {children}
    </div>
  );
}

function SectionHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</p>
      <h2 className="m-0 mt-2 text-[26px] font-semibold tracking-tight text-ink sm:text-[32px]">{title}</h2>
      {lead && <p className="m-0 mt-3 text-[15px] leading-relaxed text-ink-secondary">{lead}</p>}
    </Reveal>
  );
}

function Capability({
  icon: Icon,
  title,
  children,
  delay,
}: {
  icon: typeof FileSearch;
  title: string;
  children: ReactNode;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <div className={cn('h-full rounded-xl bg-surface p-5 shadow-card ring-1 ring-[var(--ring)]', LIFT)}>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Icon size={17} />
        </span>
        <h3 className="m-0 mt-3 text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
        <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{children}</p>
      </div>
    </Reveal>
  );
}

function Refusal({ title, children, delay }: { title: string; children: ReactNode; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div className="flex h-full gap-3 rounded-xl border border-hairline bg-sunken p-5">
        <Ban size={18} className="mt-0.5 shrink-0 text-critical" />
        <div>
          <h3 className="m-0 text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
          <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{children}</p>
        </div>
      </div>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  return (
    <div className="min-h-screen bg-page">
      {/* ---------------------------------------------------------- Nav */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-page/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <span className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand">
              <svg viewBox="0 0 100 100" className="h-4 w-4" aria-hidden="true">
                <path d="M26 68 L50 26 L74 68 Z" fill="none" stroke="white" strokeWidth={10} strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">Valytica</span>
          </span>
          <nav className="flex items-center gap-1">
            <a href="#what" className="hidden rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors duration-quick hover:text-ink sm:block">
              What it checks
            </a>
            <a href="#refusals" className="hidden rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors duration-quick hover:text-ink sm:block">
              What it won't do
            </a>
            <Link
              to="/app"
              className={cn(
                'ml-1 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-brand-ink',
                'transition-[background-color,box-shadow] duration-quick ease-state hover:bg-brand-strong',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page',
              )}
            >
              Sign in <ArrowRight size={14} />
            </Link>
          </nav>
        </div>
      </header>

      {/* -------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden">
        {/* A single soft wash rather than a gradient mesh — this is a
            diligence tool, and the page should not look like it is selling
            something the product does not do. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60"
          style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgb(var(--brand-soft-rgb)) 0%, transparent 70%)' }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
          <div>
            <p className="m-0 animate-rise-in text-[11px] font-semibold uppercase tracking-[0.14em] text-brand" style={{ animationDelay: '40ms' }}>
              Property diligence · Bengaluru
            </p>
            <h1
              className="m-0 mt-3 animate-rise-in text-[34px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[46px]"
              style={{ animationDelay: '100ms' }}
            >
              Know what you are buying
              <span className="block text-ink-secondary">before you pay for it.</span>
            </h1>
            <p
              className="m-0 mt-5 max-w-xl animate-rise-in text-[16px] leading-relaxed text-ink-secondary"
              style={{ animationDelay: '180ms' }}
            >
              Upload the deeds. Valytica reconstructs the chain of title, reconciles every extent the documents claim,
              runs the Karnataka statutory checks, and tells you what to offer — with a source behind each figure and a
              plain sentence wherever there isn't one.
            </p>
            <div className="mt-7 flex animate-rise-in flex-wrap items-center gap-3" style={{ animationDelay: '260ms' }}>
              <Link
                to="/app"
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-[14px] font-semibold text-brand-ink shadow-card',
                  'transition-[background-color,box-shadow,transform] duration-quick ease-state hover:bg-brand-strong hover:shadow-pop active:translate-y-px',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                )}
              >
                Open a case <ArrowRight size={16} />
              </Link>
              <a
                href="#what"
                className="inline-flex items-center gap-2 rounded-xl border border-hairline px-5 py-3 text-[14px] font-semibold text-ink transition-colors duration-quick hover:bg-sunken"
              >
                See what it checks
              </a>
            </div>
            <p className="m-0 mt-4 animate-rise-in text-[12px] text-ink-muted" style={{ animationDelay: '320ms' }}>
              Runs on the deterministic engine alone — no AI key required. Engine v{ENGINE_VERSION}.
            </p>
          </div>

          <div className="animate-scale-in" style={{ animationDelay: '360ms' }}>
            <EvidenceChain />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Facts */}
      <section className="border-y border-hairline bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-10 sm:grid-cols-4">
          {FACTS.map((fact, i) => (
            <Reveal key={fact.label} delay={i * 70}>
              <p className="m-0 text-[28px] font-semibold tabular-nums tracking-tight text-ink">{fact.value}</p>
              <p className="m-0 mt-0.5 text-[13px] font-medium text-ink">{fact.label}</p>
              <p className="m-0 mt-1 text-[12px] leading-snug text-ink-muted">{fact.detail}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- Capability */}
      <section id="what" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-20">
        <SectionHeading
          eyebrow="What it does"
          title="Six questions, answered from the paperwork"
          lead="Not a chatbot with opinions. A deterministic engine that reads what you have, states what it found, and names what it could not."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Capability icon={GitBranch} title="The chain of title" delay={0}>
            Every deed, khata and certificate becomes a graph. Breaks in the chain, a register naming a holder no deed
            conveys to, and dates that cannot both be true are surfaced with both claims quoted.
          </Capability>
          <Capability icon={Compass} title="The schedule of property" delay={70}>
            The four boundaries and the two dimensions, read out of the deed and checked against each other. Two
            schedules that disagree about the north side are describing two different pieces of land.
          </Capability>
          <Capability icon={ShieldCheck} title="Karnataka compliance" delay={140}>
            {KARNATAKA_PACK.titleChecks.length} statutory checks — khata classification, DC conversion, PTCL, layout
            approval, K-RERA — each with a finding, a consequence and the exact next step, cited to the statute.
          </Capability>
          <Capability icon={HandCoins} title="What to offer" delay={0}>
            An opening, a target and a walk-away, the total cash needed at completion, and the argument behind each
            adjustment. Stamp duty recomputed at your offer, not at the ask.
          </Capability>
          <Capability icon={Waves} title="Water and restrictions" delay={70}>
            Which storm-water valley the locality drains through, and the {SITE_CONSTRAINT_KEYS.length} restrictions
            that never appear in a deed — aerodrome height caps, transmission corridors, highway control lines.
          </Capability>
          <Capability icon={MapPin} title="Where it actually is" delay={140}>
            The site on a map with the geocoder's own precision attached, distances measured to transit and amenities,
            and street-level imagery that always carries its capture date.
          </Capability>
        </div>
      </section>

      {/* --------------------------------------------------- Refusals */}
      <section id="refusals" className="scroll-mt-20 border-y border-hairline bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <SectionHeading
            eyebrow="What it won't do"
            title="The refusals are the product"
            lead="Anything can produce a number. These are the three places where producing one would be worse than saying nothing."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <Refusal title="An unpriced cost is never zero" delay={0}>
              Where a charge is real but its size is not yet known, it appears as an unpriced item with a sentence
              saying so — never quietly folded into a total as nothing.
            </Refusal>
            <Refusal title="Not assessed is never fine" delay={70}>
              A check nobody has answered reports as unanswered, with the consequence spelled out. It never renders as
              clear, and it never silently drops off a list.
            </Refusal>
            <Refusal title="A pin is never a boundary" delay={140}>
              A geocoded map marker is an address, not a surveyed parcel. There is no draw-a-polygon-and-read-the-area
              tool, because an extent is settled by a licensed surveyor's sketch and not by a mouse.
            </Refusal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Scope */}
      <section className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
        <Reveal>
          <div className="rounded-xl border border-hairline p-6">
            <h2 className="m-0 text-[17px] font-semibold tracking-tight text-ink">What this is, exactly</h2>
            <p className="m-0 mt-3 text-[14px] leading-relaxed text-ink-secondary">
              A documentary property screen for Karnataka / Bengaluru, with a second pack covering the Netherlands. It
              reads what you supply and reasons over {KARNATAKA_PACK.datasets.length} named registries — Kaveri, Bhoomi,
              the BBMP roll, K-RERA and others — but it does not query them live, and it says so wherever that
              distinction matters.
            </p>
            <p className="m-0 mt-3 text-[14px] leading-relaxed text-ink-secondary">
              It is <strong className="text-ink">not</strong> a certified valuation, a legal title certificate, a formal
              opinion or an engineering inspection. It is the thing you do first, so that when you pay a lawyer and a
              surveyor you already know what to ask them.
            </p>
          </div>
        </Reveal>
      </section>

      {/* --------------------------------------------------------- CTA */}
      <section className="border-t border-hairline bg-surface">
        <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:py-20">
          <Reveal>
            <h2 className="m-0 text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
              Start with a conversation, not a form.
            </h2>
            <p className="m-0 mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-secondary">
              Describe the property in your own words and upload whatever you have. Six demo cases are already loaded if
              you would rather look around first.
            </p>
            <Link
              to="/app"
              className={cn(
                'mt-7 inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-brand-ink shadow-card',
                'transition-[background-color,box-shadow,transform] duration-quick ease-state hover:bg-brand-strong hover:shadow-pop active:translate-y-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              )}
            >
              Sign in and open the app <ArrowRight size={16} />
            </Link>
            {/* Stated rather than hidden: a sign-in button that signs nobody in
                is a small lie unless the page says what it does. */}
            <p className="m-0 mt-4 text-[12px] text-ink-muted">
              Sign-in is not enabled yet — this opens the app directly.
            </p>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-[12px] text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Valytica — property diligence, evidence first. Engine v{ENGINE_VERSION}.</span>
          <span>A screen, not a legal opinion.</span>
        </div>
      </footer>
    </div>
  );
}
