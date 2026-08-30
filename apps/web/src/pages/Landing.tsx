import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  CHECK_DEFINITIONS,
  DD_TYPE_DEFINITIONS,
  LIFECYCLE_STAGES,
  PROJECT_ARCHETYPES,
  SCOPE_DEFINITIONS,
} from '@realytica/shared';
import { useInView } from '../lib/useReveal';
import { SectionBand, Tile, cn } from '../components/ui/kit';

/**
 * The front door, as a specimen of the thing the product makes.
 *
 * Realytica's output is a numbered, hairline-ruled diligence record: projects,
 * concurrent assessments, and shared registers. The page is left-aligned to a
 * document measure; sections are numbered the way a report numbers its own.
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

function Spread({ children, margin }: { children: ReactNode; margin?: ReactNode }) {
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0">{children}</div>
      <aside className="lg:pt-1">{margin}</aside>
    </div>
  );
}

function MarginNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-hairline pl-3">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{label}</p>
      <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-secondary">{children}</p>
    </div>
  );
}

const CHAIN = [
  { source: 'Finding', claim: 'Fire-escape width vs NBC', value: 'Open · high' },
  { source: 'Construction Progress DD', claim: 'linked from Quality', value: 'Check #04' },
  { source: 'Design DD', claim: 'same finding, not copied', value: 'Tower A' },
];

function RegisterLedger() {
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
        <span>Register</span>
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
        <span className="text-good">One finding, two DDs, one risk</span>
        <span className="tabular-nums text-good">Shared</span>
      </div>
      </div>
    </Tile>
  );
}

const SPEC = [
  { label: 'Project types', value: String(PROJECT_ARCHETYPES.length) },
  { label: 'Lifecycle stages', value: String(LIFECYCLE_STAGES.length) },
  { label: 'DD type templates', value: String(DD_TYPE_DEFINITIONS.length) },
  { label: 'Reusable scopes', value: String(SCOPE_DEFINITIONS.length) },
  { label: 'Library checks', value: String(CHECK_DEFINITIONS.length) },
  { label: 'Shared registers', value: '6' },
];

const REFUSALS = [
  {
    clause: 'i',
    title: 'AI is not required to operate.',
    body: 'Every core workflow — project, asset tree, concurrent DDs, checks, registers, reports — must run with no model. AI later writes into these same objects; it does not replace them.',
    margin: 'The BRD’s first principle.',
  },
  {
    clause: 'ii',
    title: 'A DD type is a template, not a tab.',
    body: 'Acquisition, Construction Progress, Design, Regulatory and Cost & Schedule are presets you instantiate. They are not permanent folders that trap evidence inside a department.',
    margin: 'Concurrent assessments against different targets.',
  },
  {
    clause: 'iii',
    title: 'An unissued figure is never a certified value.',
    body: 'Indicative valuation is a later capability on this model. Until a registered valuer signs separately, the product does not pretend the range is a certificate.',
    margin: 'Decision support, not a legal opinion.',
  },
];

const CTA_CLASSES =
  'group inline-flex items-center gap-2 border border-ink bg-ink px-5 py-2.5 text-[14px] font-medium text-ink-inverse ' +
  'transition-[background-color,color] duration-quick ease-state hover:bg-transparent hover:text-ink ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page';

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-clip bg-page">
      <header className="border-b border-ink/20">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <span className="flex items-baseline gap-3">
            <span className="font-display text-[17px] tracking-tight text-ink">Realytica</span>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted sm:inline">
              Due diligence · project intelligence
            </span>
          </span>
          <Link
            to="/projects"
            className="group inline-flex items-baseline gap-2 border-b border-ink pb-0.5 text-[13px] font-medium text-ink transition-colors duration-quick hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Open workspace
            <ArrowRight size={13} className="translate-y-px transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <section className="relative isolate mx-auto max-w-5xl px-6 pb-16 pt-12 sm:pt-16">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-[-50vw] top-[-3.5rem] -z-10 h-[620px] bg-band" />
        <div className="mb-10 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          <span>Ref. operating model</span>
          <span>Manual first · AI later</span>
        </div>

        <Spread
          margin={
            <Tile className="p-4">
              <dl className="m-0 space-y-3">
              {SPEC.map((item, i) => (
                <div key={item.label} className="animate-fade-in flex flex-wrap items-baseline justify-between gap-x-3 border-b border-hairline pb-2" style={{ animationDelay: `${520 + i * 60}ms` }}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">{item.label}</dt>
                  <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">{item.value}</dd>
                </div>
              ))}
              </dl>
            </Tile>
          }
        >
          <h1 className="m-0 font-display text-[40px] font-normal leading-[1.06] tracking-[-0.015em] text-ink sm:text-[58px]">
            <SetLine delay={40}>Run diligence as a</SetLine>
            <SetLine delay={130}>living project record,</SetLine>
            <SetLine delay={220}>
              <span className="text-ink-secondary">not a static report.</span>
            </SetLine>
          </h1>

          <p className="m-0 mt-8 max-w-[58ch] animate-fade-in text-[16px] leading-[1.65] text-ink-secondary" style={{ animationDelay: '340ms' }}>
            Create the project and the asset tree. Start concurrent due diligence assessments from reusable scopes and
            checks. Evidence, findings, risks, actions and decisions live once and link across DDs. AI comes later, on
            this same model — it is not required to operate.
          </p>

          <div className="mt-9 flex animate-fade-in flex-wrap items-center gap-6" style={{ animationDelay: '420ms' }}>
            <Link to="/projects" className={CTA_CLASSES}>
              Open the workspace
              <ArrowRight size={15} className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
            </Link>
            <a href="#templates" className="border-b border-hairline pb-0.5 text-[14px] text-ink-secondary transition-colors duration-quick hover:border-ink hover:text-ink">
              Read the DD templates
            </a>
          </div>

          <p className="m-0 mt-6 animate-fade-in font-mono text-[11px] text-ink-muted" style={{ animationDelay: '480ms' }}>
            Manual system of record. No AI key required.
          </p>
        </Spread>
      </section>

      <SectionBand ground="surface" className="border-y border-hairline">
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHead
          n="01"
          title="What it records"
          note="A due diligence assessment is an exercise at a point in time. Evidence, findings, risks, actions and decisions are reusable project reality — linked into DDs, not trapped inside them."
        />
        <Spread
          margin={
            <MarginNote label="Worked example">
              A fire-escape finding on the Harohalli township sits once on the project register and participates in
              Construction Progress and Design assessments. The report is a view of those records.
            </MarginNote>
          }
        >
          <RegisterLedger />
        </Spread>
      </section>
      </SectionBand>

      <section id="templates" className="mx-auto max-w-5xl scroll-mt-8 px-6 py-16">
        <SectionHead
          n="02"
          title="What it instantiates"
          note={`${DD_TYPE_DEFINITIONS.length} DD type templates and ${SCOPE_DEFINITIONS.length} reusable scopes. Starting an assessment copies these into the project; editing an instance does not change the library.`}
        />
        <Spread
          margin={
            <MarginNote label="One scope, in full">
              <span className="block text-ink">{SCOPE_DEFINITIONS[0].label}</span>
              <span className="mt-1.5 block">{SCOPE_DEFINITIONS[0].purpose}</span>
              <span className="mt-1.5 block font-mono text-[11px] text-ink-muted">
                {CHECK_DEFINITIONS.filter(c => c.scopeKey === SCOPE_DEFINITIONS[0].key).length} checks in the library
              </span>
            </MarginNote>
          }
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink/20">
                <th className="pb-2 pr-6 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-ink-muted">DD type</th>
                <th className="pb-2 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-ink-muted">Default scopes</th>
              </tr>
            </thead>
            <tbody>
              {DD_TYPE_DEFINITIONS.filter(d => d.key !== 'custom').map(d => (
                <tr key={d.key} className="border-b border-hairline align-baseline transition-colors duration-quick hover:bg-sunken">
                  <td className="py-2.5 pr-6 text-[14px] text-ink">{d.label}</td>
                  <td className="py-2.5 text-[12px] leading-snug text-ink-muted">
                    {d.defaultScopes.map(k => SCOPE_DEFINITIONS.find(s => s.key === k)?.label ?? k).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mt-5 max-w-[62ch] text-[13px] leading-relaxed text-ink-muted">
            Custom DDs start empty and take the scopes you add. Recommended types follow the project’s current lifecycle
            stage; they do not overwrite prior assessments when the stage changes.
          </p>
        </Spread>
      </section>

      <SectionBand ground="sunken" className="border-y border-hairline">
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHead
          n="03"
          title="What it refuses to do"
          note="The first release proves that a team can run progressive due diligence by hand. Anything that would force AI, a department silo, or a fake certificate is out."
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

      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionHead n="04" title="Scope and limitations" />
        <Spread
          margin={
            <MarginNote label="First archetype">
              Residential township — Harohalli is the sample. Other project types share the same operating model.
            </MarginNote>
          }
        >
          <div className="max-w-[62ch] space-y-4 text-[15px] leading-[1.7] text-ink-secondary">
            <p className="m-0">
              The operating model is the product: project setup, nested assets, stage history, concurrent DDs, shared
              registers, dashboards, IBBI-structured indicative valuation, reusable engines, controlled AI drafts, and a
              graph of data links. Reports are generated from those records.
            </p>
            <p className="m-0">
              It is <span className="text-ink">not</span> a certified valuation, a legal title certificate, a BIM
              comparator, or a live-registry product. Indicative valuation and AI drafts sit on the same project
              registers and never replace a registered valuer or a human reviewer.
            </p>
          </div>
        </Spread>
      </section>

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
            Start with a project, not a conversation.
          </h2>
          <p className="m-0 mt-4 max-w-[56ch] text-[15px] leading-relaxed text-ink-secondary">
            Open the sample Harohalli township or create a project of your own. Libraries, registers and reports are
            already wired. Neither path needs an AI key.
          </p>
          <Link to="/projects" className={cn(CTA_CLASSES, 'mt-8')}>
            Open the application
            <ArrowRight size={15} className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
          </Link>
        </Spread>
      </section>
      </SectionBand>

      <footer className="border-t border-ink/20">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-8 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted sm:flex-row sm:items-baseline sm:justify-between">
          <span>Realytica · Due diligence OS</span>
          <span>A system of record, not a legal opinion</span>
        </div>
      </footer>
    </div>
  );
}
