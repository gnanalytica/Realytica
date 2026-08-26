import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ENGINE_VERSION, KARNATAKA_PACK, REFERENCE_DATA, SITE_CONSTRAINT_KEYS } from '@valytica/shared';
import { useInView } from '../lib/useReveal';
import { SectionBand, Tile, cn } from '../components/ui/kit';

/**
 * The front door, as a specimen of the thing the product makes.
 *
 * --- What this page is, and what it deliberately is not -------------------
 *
 * The first version of this page was a SaaS landing page: sticky glass nav,
 * a centred eyebrow over a centred heading over a centred lead, three
 * icon-in-a-rounded-square cards, a radial gradient wash, a centred closing
 * call to action. Every one of those is the statistically average choice, and
 * together they produce a page that could have belonged to any company in any
 * category. It described the product accurately and looked like nothing.
 *
 * This one argues the same case by *being* the artefact instead. Valytica's
 * output is a numbered, hairline-ruled diligence report with statutes set in
 * monospace and an `as of` line in the margin under every figure that has
 * one. So: the page is left-aligned to a document measure and never centred;
 * there is not a single drop shadow or rounded card; the sections are
 * numbered the way the report numbers its own; provenance sits in a margin
 * column exactly as it does in the app; and the section that would normally
 * hold three feature cards holds the real check catalogue in a real table.
 *
 * The register shift is carried by a serif for display type against the app's
 * sans — registries, statutes and title opinions are set in serif, and the
 * page should feel like it comes from that world rather than from a product
 * launch.
 *
 * --- Every figure is read, none is claimed -------------------------------
 *
 * There is no outcome claim anywhere: no percentage faster, no satisfaction
 * score, no logos, no testimonials. The numbers are read out of the shipped
 * pack at render time, and the check table is the actual catalogue with the
 * actual statute citations — content a competitor cannot copy without
 * building the pack, and content that cannot go stale because it is not a
 * copy of anything.
 *
 * --- Motion is typesetting -----------------------------------------------
 *
 * Rules draw from the left. Display lines are set from below behind a mask.
 * Nothing fades up on scroll, because fade-up-on-scroll is the motion
 * equivalent of the layout this page replaced. All of it runs through the
 * app's existing keyframes so the global `prefers-reduced-motion` guard
 * covers it, and every reveal starts visible and hides only once it knows
 * the observer works.
 */

/* ==================================================================== */
/* Document furniture                                                    */
/* ==================================================================== */

/**
 * One line of display type, set from below behind a mask.
 *
 * `overflow-hidden` on the outer span is what makes it a mask rather than a
 * slide, and the inner span carries the transform. `pb-[0.12em]` keeps
 * descenders from being clipped by the mask they are travelling behind — a
 * detail that is invisible when right and unmistakable when wrong.
 */
function SetLine({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <span className="block overflow-hidden pb-[0.12em]">
      <span className={cn('block animate-set-line', className)} style={{ animationDelay: `${delay}ms` }}>
        {children}
      </span>
    </span>
  );
}

/** A numbered section head, quoting the report's own numbering. */
function SectionHead({ n, title, note }: { n: string; title: string; note?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="mb-8">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[12px] tabular-nums text-brand">{n}</span>
        <h2 className="m-0 font-display text-[24px] font-normal leading-tight tracking-tight text-ink sm:text-[30px]">{title}</h2>
      </div>
      <div
        className={cn('mt-4 h-px origin-left bg-ink/25 transition-transform duration-slow ease-enter', inView ? 'scale-x-100' : 'scale-x-0')}
      />
      {note && <p className="m-0 mt-3 max-w-[62ch] text-[14px] leading-relaxed text-ink-secondary">{note}</p>}
    </div>
  );
}

/**
 * The page's grid: a wide document column and a narrow margin column.
 *
 * Asymmetric on purpose. A symmetric two-column split reads as a landing
 * page; a text measure with an annotation rail beside it reads as a document,
 * which is the entire conceit. Below `lg` the margin column falls under the
 * text, which is what a printed marginal note does when it will not fit.
 */
function Spread({ children, margin }: { children: ReactNode; margin?: ReactNode }) {
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0">{children}</div>
      <aside className="lg:pt-1">{margin}</aside>
    </div>
  );
}

/** A margin annotation, set the way the app sets its provenance lines. */
function MarginNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-hairline pl-3">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{label}</p>
      <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-secondary">{children}</p>
    </div>
  );
}

/* ==================================================================== */
/* 01 — the evidence chain, as a ledger                                  */
/* ==================================================================== */

const CHAIN = [
  { source: 'Sale deed, p.3', claim: 'extent conveyed', value: '111.5 m²' },
  { source: 'Khata extract', claim: 'area assessed', value: '111.5 m²' },
  { source: 'Schedule of property', claim: '30 ft × 40 ft', value: '111.5 m²' },
];

function EvidenceLedger() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [step, setStep] = useState(CHAIN.length + 1);

  useEffect(() => {
    if (!inView) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setStep(0);
    const id = window.setInterval(() => setStep(s => (s > CHAIN.length ? s : s + 1)), 620);
    return () => window.clearInterval(id);
  }, [inView]);

  return (
    <Tile className="p-5">
      <div ref={ref} className="font-mono text-[13px]">
      <div className="flex items-baseline justify-between border-b border-ink/20 pb-2 text-[10px] uppercase tracking-[0.12em] text-ink-muted">
        <span>Source</span>
        <span>States</span>
      </div>
      {CHAIN.map((row, i) => (
        <div
          key={row.source}
          className={cn(
            'flex items-baseline justify-between gap-4 border-b border-hairline py-3 transition-[opacity,transform] duration-base ease-enter',
            step > i ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          )}
        >
          <span className="text-ink-secondary">{row.source}</span>
          <span className="flex items-baseline gap-3">
            <span className="text-ink-muted">{row.claim}</span>
            <span className="tabular-nums text-ink">{row.value}</span>
          </span>
        </div>
      ))}
      <div
        className={cn(
          'flex items-baseline justify-between gap-4 py-3 transition-[opacity,transform] duration-base ease-enter',
          step > CHAIN.length ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        )}
      >
        <span className="text-good">Three sources, no conflict</span>
        <span className="tabular-nums text-good">111.5 m²</span>
      </div>
      </div>
    </Tile>
  );
}

/* ==================================================================== */
/* Page                                                                  */
/* ==================================================================== */

const SPEC = [
  { label: 'Engine', value: `v${ENGINE_VERSION}` },
  { label: 'Jurisdiction', value: 'Karnataka / Bengaluru' },
  { label: 'Statutory checks', value: String(KARNATAKA_PACK.titleChecks.length) },
  { label: 'Restrictions beyond title', value: String(SITE_CONSTRAINT_KEYS.length) },
  { label: 'Documents tracked', value: String(KARNATAKA_PACK.requiredDocuments.length) },
  { label: 'Localities priced', value: String(REFERENCE_DATA.localities.filter(l => l.city === 'Bengaluru').length) },
];

/**
 * The check set out in full beside the table.
 *
 * Khata classification, because it is the single biggest binary in a
 * Bengaluru title screen and the one a reader is most likely to have heard of
 * and least likely to understand the consequences of.
 */
const SPECIMEN_CHECK = KARNATAKA_PACK.titleChecks.find(c => c.key === 'khata_classification') ?? KARNATAKA_PACK.titleChecks[0];

/**
 * The first citation from a statute string, without its trailing gloss.
 *
 * The pack joins several instruments with semicolons where a check rests on
 * more than one. Printing all of them turns a scannable column into a second
 * paragraph; printing the first, with the count of the rest, keeps the column
 * a column and still says there is more behind it.
 */
function statuteHead(statute: string): string {
  const parts = statute.split(';').map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} + ${parts.length - 1} more` : statute;
}

const REFUSALS = [
  {
    clause: 'i',
    title: 'An unpriced cost is never zero.',
    body: 'Where a charge is real but its size is not yet known, it is listed as unpriced with a sentence saying so. It is never folded into a total as nothing, and the offer advice carries a null rather than a figure.',
    margin: 'The most expensive possible rounding error.',
  },
  {
    clause: 'ii',
    title: 'Not assessed is never fine.',
    body: 'A check nobody has answered reports as unanswered, with its consequence spelled out and the document that would settle it named. It never renders as clear and it never quietly drops off a list.',
    margin: 'Six of the checks below default to this state.',
  },
  {
    clause: 'iii',
    title: 'A pin is never a boundary.',
    body: 'A geocoded marker is an address, and in Bengaluru it is frequently the centre of a village. The precision the geocoder reported travels with it everywhere it is drawn, and there is no draw-a-polygon-and-read-the-area tool.',
    margin: 'An extent is settled by a surveyor’s sketch, not a mouse.',
  },
];

const CTA_CLASSES =
  'group inline-flex items-center gap-2 border border-ink bg-ink px-5 py-2.5 text-[14px] font-medium text-ink-inverse ' +
  'transition-[background-color,color] duration-quick ease-state hover:bg-transparent hover:text-ink ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page';

export default function Landing() {
  // `overflow-x-clip`, not `overflow-hidden`: the band bleeds half a viewport
  // past each edge so it can run under the masthead, and without clipping
  // that became 195px of horizontal scroll on a phone. Clip rather than
  // hidden so no scroll container is created and nothing inside is affected.
  return (
    <div className="min-h-screen overflow-x-clip bg-page">
      {/* ------------------------------------------------------ Masthead */}
      <header className="border-b border-ink/20">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <span className="flex items-baseline gap-3">
            <span className="font-display text-[17px] tracking-tight text-ink">Valytica</span>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted sm:inline">
              Property screen · Karnataka
            </span>
          </span>
          <Link
            to="/app"
            className="group inline-flex items-baseline gap-2 border-b border-ink pb-0.5 text-[13px] font-medium text-ink transition-colors duration-quick hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Sign in
            <ArrowRight size={13} className="translate-y-px transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {/* -------------------------------------------------------- Header */}
      {/*
        * The band wash under the opening.
        *
        * Two very low-opacity radial fields, one brand and one green, drawn
        * from the token layer so they follow the theme. It gives the page a
        * top rather than starting flat, and it is the only place on the page
        * with a gradient this wide — a document has one masthead, not six.
        */}
      {/* `isolate` is load-bearing: `position: relative` with `z-index: auto`
          creates no stacking context, so the band's `-z-10` escaped to the
          root and painted behind the page's own opaque background — present
          in the DOM, correct in the computed style, and invisible. */}
      <section className="relative isolate mx-auto max-w-5xl px-6 pb-16 pt-12 sm:pt-16">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-[-50vw] top-[-3.5rem] -z-10 h-[620px] bg-band" />
        <div className="mb-10 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          <span>Ref. specimen</span>
          <span>Evidence before assertion</span>
        </div>

        <Spread
          margin={
            <Tile className="p-4">
              <dl className="m-0 space-y-3">
              {SPEC.map((item, i) => (
                <div key={item.label} className="animate-fade-in flex flex-wrap items-baseline justify-between gap-x-3 border-b border-hairline pb-2" style={{ animationDelay: `${520 + i * 60}ms` }}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">{item.label}</dt>
                  {/* Wraps rather than crowding the rule: "Karnataka / Bengaluru"
                      is wider than the column and looked broken pinned to the edge. */}
                  <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">{item.value}</dd>
                </div>
              ))}
              </dl>
            </Tile>
          }
        >
          <h1 className="m-0 font-display text-[40px] font-normal leading-[1.06] tracking-[-0.015em] text-ink sm:text-[58px]">
            <SetLine delay={40}>Know what you are</SetLine>
            <SetLine delay={130}>buying before you</SetLine>
            <SetLine delay={220}>
              <span className="text-ink-secondary">pay for it.</span>
            </SetLine>
          </h1>

          <p className="m-0 mt-8 max-w-[58ch] animate-fade-in text-[16px] leading-[1.65] text-ink-secondary" style={{ animationDelay: '340ms' }}>
            Upload the deeds. Valytica reconstructs the chain of title, reconciles every extent the documents claim,
            runs the Karnataka statutory checks and tells you what to offer — with a source behind each figure, and a
            plain sentence wherever there is not one.
          </p>

          <div className="mt-9 flex animate-fade-in flex-wrap items-center gap-6" style={{ animationDelay: '420ms' }}>
            <Link to="/app" className={CTA_CLASSES}>
              Open a case
              <ArrowRight size={15} className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
            </Link>
            <a href="#checks" className="border-b border-hairline pb-0.5 text-[14px] text-ink-secondary transition-colors duration-quick hover:border-ink hover:text-ink">
              Read the check list
            </a>
          </div>

          <p className="m-0 mt-6 animate-fade-in font-mono text-[11px] text-ink-muted" style={{ animationDelay: '480ms' }}>
            Runs on the deterministic engine alone. No AI key required.
          </p>
        </Spread>
      </section>

      {/* ---------------------------------------------------- 01 What it reads */}
      <SectionBand ground="surface" className="border-y border-hairline">
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHead
          n="01"
          title="What it reads"
          note="Every figure the screen produces resolves to the document that states it. Where three sources describe one parcel, all three are quoted — and where they disagree, that disagreement is the finding."
        />
        <Spread
          margin={
            <MarginNote label="Worked example">
              The extent of a Devanahalli site, as three instruments on the same case state it. A fourth figure that
              disagreed by more than 2% would open an <span className="font-mono text-[12px]">area_mismatch</span>.
            </MarginNote>
          }
        >
          <EvidenceLedger />
        </Spread>
      </section>
      </SectionBand>

      {/* --------------------------------------------------- 02 What it checks */}
      <section id="checks" className="mx-auto max-w-5xl scroll-mt-8 px-6 py-16">
        <SectionHead
          n="02"
          title="What it checks"
          note={`The ${KARNATAKA_PACK.titleChecks.length} statutory checks the Karnataka pack carries, each returning a finding, a consequence and the next step — cited to the instrument it comes from. This is the catalogue itself, not a summary of it.`}
        />
        {/*
          * Name and citation only.
          *
          * The first cut of this table printed every check's full description
          * as well, and eleven paragraphs in a narrow column made the section
          * three times taller than the rest of the page put together — a wall
          * nobody would read, which is a worse outcome than saying less. A
          * specimen shows the form of the thing, not all of it. What survives
          * is the part a competitor cannot copy without building the pack:
          * each check cited to the instrument it comes from. One check is set
          * out in full in the margin so the depth is visible without the
          * wall.
          */}
        <Spread
          margin={
            <MarginNote label="One check, in full">
              <span className="block text-ink">{SPECIMEN_CHECK.label}</span>
              <span className="mt-1.5 block">{SPECIMEN_CHECK.description}</span>
              <span className="mt-1.5 block font-mono text-[11px] text-ink-muted">{SPECIMEN_CHECK.statute}</span>
            </MarginNote>
          }
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink/20">
                <th className="pb-2 pr-6 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-ink-muted">Check</th>
                <th className="pb-2 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-ink-muted">Cited to</th>
              </tr>
            </thead>
            <tbody>
              {KARNATAKA_PACK.titleChecks.map(check => (
                <tr key={check.key} className="border-b border-hairline align-baseline transition-colors duration-quick hover:bg-sunken">
                  <td className="py-2.5 pr-6 text-[14px] text-ink">{check.label}</td>
                  <td className="py-2.5 font-mono text-[11px] leading-snug text-ink-muted">{statuteHead(check.statute)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mt-5 max-w-[62ch] text-[13px] leading-relaxed text-ink-muted">
            Alongside these sit {SITE_CONSTRAINT_KEYS.length} restrictions that never appear in a deed — an aerodrome
            height cap, a transmission corridor, a highway control line — and the flood catchment the locality drains
            through.
          </p>
        </Spread>
      </section>

      {/* -------------------------------------------------- 03 What it refuses */}
      <SectionBand ground="sunken" className="border-y border-hairline">
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHead
          n="03"
          title="What it refuses to do"
          note="Anything can produce a number. These are the three places where producing one would be worse than saying nothing, and they are enforced in the engine rather than promised in the copy."
        />
        <div className="space-y-8">
          {REFUSALS.map(item => (
            <Spread key={item.clause} margin={<MarginNote label={`Clause ${item.clause}`}>{item.margin}</MarginNote>}>
              <div className="flex gap-5">
                <span className="mt-1 font-mono text-[12px] text-brand">{item.clause}</span>
                <div className="min-w-0">
                  <h3 className="m-0 font-display text-[19px] font-normal leading-snug text-ink">{item.title}</h3>
                  <p className="m-0 mt-2 max-w-[62ch] text-[14px] leading-relaxed text-ink-secondary">{item.body}</p>
                </div>
              </div>
            </Spread>
          ))}
        </div>
      </section>
      </SectionBand>

      {/* ----------------------------------------------------------- 04 Scope */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHead n="04" title="Scope and limitations" />
        <Spread
          margin={
            <MarginNote label="Registries consulted">
              {KARNATAKA_PACK.datasets.join(' · ')}
            </MarginNote>
          }
        >
          <div className="max-w-[62ch] space-y-4 text-[15px] leading-[1.7] text-ink-secondary">
            <p className="m-0">
              A documentary property screen for Karnataka and Bengaluru, with a second pack covering the Netherlands. It
              reasons over {KARNATAKA_PACK.datasets.length} named registries but does not query them live, and it says
              so wherever that distinction changes what a finding means.
            </p>
            <p className="m-0">
              It is <span className="text-ink">not</span> a certified valuation, a legal title certificate, a formal
              opinion, or an engineering inspection. It is the thing you do first — so that when you do pay a lawyer and
              a surveyor, you already know what to ask them.
            </p>
          </div>
        </Spread>
      </section>

      {/* ------------------------------------------------------------- Close */}
      <SectionBand ground="brand" className="border-t border-hairline">
      <section className="mx-auto max-w-5xl px-6 py-20">
        <Spread
          margin={
            <MarginNote label="Access">
              Sign-in is not enabled yet. The button opens the application directly.
            </MarginNote>
          }
        >
          <h2 className="m-0 max-w-[24ch] font-display text-[30px] font-normal leading-tight tracking-tight text-ink sm:text-[38px]">
            Start with a conversation, not a form.
          </h2>
          <p className="m-0 mt-4 max-w-[56ch] text-[15px] leading-relaxed text-ink-secondary">
            Describe the property in your own words and upload whatever you have. Six worked cases are already loaded if
            you would rather read one first.
          </p>
          <Link to="/app" className={cn(CTA_CLASSES, 'mt-8')}>
            Open the application
            <ArrowRight size={15} className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
          </Link>
        </Spread>
      </section>
      </SectionBand>

      {/* --------------------------------------------------------- Colophon */}
      <footer className="border-t border-ink/20">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-8 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted sm:flex-row sm:items-baseline sm:justify-between">
          <span>Valytica · Engine v{ENGINE_VERSION}</span>
          <span>A screen, not a legal opinion</span>
        </div>
      </footer>
    </div>
  );
}
