import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, CloudOff, FileText, Lock, Minus, Plus, Smartphone, Sparkles, Waypoints } from 'lucide-react';
import { DEPARTMENTS, STAGES, SUB_STAGE_LABEL, type DepartmentKey, type StageKey } from '@realytica/shared';
import { EASE_ENTER, SPRING, motion } from '../lib/motion';
import { AiMark, cn } from '../components/ui/kit';
import { DEPARTMENT_ICON } from '../components/departments/icons';

/**
 * The front door.
 *
 * It says what the product is by showing it: the four stages, the
 * departments and their work, the copilot's proposals waiting for a person,
 * a value with its page, what a change reaches, the site on a phone. Every
 * name on it — stages, departments, workstreams, what each produces — is read
 * from the product's own definitions, so the page cannot describe a product
 * that does not exist. The illustrations carry no figures: nothing here is a
 * real project's data, and nothing pretends to be.
 */

/** Small counts in words, the way the rest of the sentence is written. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = (n: number) => WORDS[n] ?? String(n);

const CTA =
  'group inline-flex items-center gap-2 rounded-xl bg-action px-5 py-3 text-[14px] font-medium text-action-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_8px_24px_-8px_rgb(var(--shadow-tint)/0.5)] transition-[transform,background-color] duration-quick ease-state hover:bg-action-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

const NAV = [
  { href: '#structure', label: 'How it is organised' },
  { href: '#copilot', label: 'Copilot' },
  { href: '#evidence', label: 'Evidence' },
  { href: '#site', label: 'Site app' },
  { href: '#scope', label: 'Scope' },
];

/** Rises into place the first time it scrolls into view. */
function InView({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: EASE_ENTER, delay }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({ n, title, note }: { n: string; title: string; note?: ReactNode }) {
  return (
    <InView className="mb-10 max-w-[44rem]">
      <p className="font-mono text-[12px] text-brand">{n}</p>
      <h2 className="mt-2 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[40px]">{title}</h2>
      {note ? <p className="mt-4 text-[16px] leading-relaxed text-ink-secondary">{note}</p> : null}
    </InView>
  );
}

/* ------------------------------------------------------------------ */
/* The hero's picture: a project, assembling itself                    */
/* ------------------------------------------------------------------ */

function TimelineSketch() {
  return (
    <div className="flex gap-2" aria-hidden>
      {STAGES.map((stage, i) => {
        const done = i < 2;
        const current = i === 2;
        return (
          <div key={stage.key} className="min-w-0 flex-1">
            <p className={cn('truncate text-[11px] font-semibold', i > 2 ? 'text-ink-muted' : 'text-ink')}>{stage.label}</p>
            <div className="relative mt-1.5 flex h-3 items-center justify-between">
              <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-[1.5px] border-dashed border-[var(--axis)]" />
              {done || current ? (
                <motion.span
                  className="absolute left-0 top-1/2 h-[2px] origin-left -translate-y-1/2 rounded-full bg-ink"
                  style={{ width: current ? '34%' : '100%' }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.45, ease: EASE_ENTER, delay: 0.5 + i * 0.25 }}
                />
              ) : null}
              {stage.subStages.map((step, j) => {
                const isNow = current && j === 1;
                const reached = done || (current && j <= 1);
                return (
                  <span key={step} className="relative z-10 grid size-3 place-items-center">
                    {isNow ? <span className="absolute inset-0 animate-ping-once rounded-full bg-brand/40 [animation-delay:1.4s]" /> : null}
                    <span className={cn('rounded-full', isNow ? 'size-2.5 bg-surface ring-2 ring-ink' : reached ? 'size-1.5 bg-ink' : 'size-1.5 bg-surface ring-1 ring-[var(--axis)]')} />
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkRow({ label, verdict, tone, fill, delay }: { label: string; verdict: string; tone: 'good' | 'critical' | 'warning' | 'neutral'; fill: number; delay: number }) {
  const bar = { good: 'bg-good', critical: 'bg-critical', warning: 'bg-warning', neutral: 'bg-[var(--axis)]' }[tone];
  const chip = {
    good: 'bg-good/10 text-[var(--status-good-text)] ring-good/25',
    critical: 'bg-critical/10 text-critical ring-critical/30',
    warning: 'bg-warning/15 text-[var(--status-warning-text)] ring-warning/35',
    neutral: 'bg-sunken text-ink-secondary ring-[var(--ring)]',
  }[tone];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-ink">{label}</span>
        <span className={cn('shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium ring-1 ring-inset', chip)}>{verdict}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-sunken">
        <motion.span
          className={cn('block h-full rounded-full', bar)}
          initial={{ width: 0 }}
          animate={{ width: `${fill}%` }}
          transition={{ duration: 0.7, ease: EASE_ENTER, delay }}
        />
      </div>
    </div>
  );
}

function DeptSketch({ dept, rows, delay }: { dept: DepartmentKey; rows: Array<Parameters<typeof WorkRow>[0]>; delay: number }) {
  const Icon = DEPARTMENT_ICON[dept];
  const label = DEPARTMENTS.find((d) => d.key === dept)!.label;
  return (
    <motion.div
      className="rounded-xl bg-surface p-3 shadow-card ring-1 ring-[var(--ring)]"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_ENTER, delay }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-sunken text-ink ring-1 ring-inset ring-[var(--ring)]">
          <Icon size={12} />
        </span>
        <span className="truncate text-[12px] font-semibold text-ink">{label}</span>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <WorkRow key={r.label} {...r} />
        ))}
      </div>
    </motion.div>
  );
}

/** The proposal card: arrives, is accepted by a person, and says so. */
function ProposalSketch() {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setTimeout(() => setAccepted(true), 3600);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <motion.div
      className={cn(
        'w-[min(19rem,100%)] rounded-2xl bg-surface p-3.5 shadow-pop ring-[1.5px] transition-[box-shadow] duration-slow',
        accepted ? 'ring-good/50' : 'ring-ai/60',
      )}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING.layer, delay: 1.6 }}
    >
      <div className="flex items-center gap-2">
        <AiMark size="sm" />
        <span className={cn('text-[11px] font-medium', accepted ? 'text-[var(--status-good-text)]' : 'text-ai-ink')}>
          {accepted ? 'Accepted by a person' : 'Proposed by AI · needs your decision'}
        </span>
      </div>
      <p className="mt-2 text-[13px] font-medium leading-snug text-ink">File the commencement certificate under Legal › Approvals</p>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-muted">
        <FileText size={11} />
        Read from the document, with its page
      </p>
      <div className="mt-3 flex items-center gap-1.5">
        {accepted ? (
          <motion.span
            className="inline-flex items-center gap-1.5 rounded-lg bg-good/10 px-2.5 py-1.5 text-[12px] font-medium text-[var(--status-good-text)] ring-1 ring-inset ring-good/25"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          >
            <CheckCircle2 size={13} />
            Filed on the record
          </motion.span>
        ) : (
          <>
            <motion.span
              className="rounded-lg bg-action px-2.5 py-1.5 text-[12px] font-medium text-action-ink"
              animate={{ scale: [1, 1, 0.94, 1] }}
              transition={{ duration: 0.5, delay: 3.1, times: [0, 0.4, 0.7, 1] }}
            >
              Accept
            </motion.span>
            <span className="rounded-lg px-2.5 py-1.5 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">Edit</span>
            <span className="rounded-lg px-2.5 py-1.5 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">Reject</span>
          </>
        )}
      </div>
    </motion.div>
  );
}

function HeroCanvas() {
  return (
    <div className="relative" role="img" aria-label="An illustration of a project workspace: the four stages as a timeline, departments with their work, and an AI proposal waiting for a person's decision.">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-band opacity-70 blur-2xl" aria-hidden />
      <motion.div
        className="overflow-hidden rounded-2xl bg-page shadow-pop ring-1 ring-[var(--ring)]"
        initial={{ opacity: 0, y: 16, rotateX: 6 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.8, ease: EASE_ENTER, delay: 0.2 }}
        style={{ transformPerspective: 1200 }}
      >
        <div className="flex items-center gap-1.5 border-b border-hairline bg-surface px-3 py-2" aria-hidden>
          <span className="size-2.5 rounded-full bg-[var(--axis)]" />
          <span className="size-2.5 rounded-full bg-[var(--axis)]" />
          <span className="size-2.5 rounded-full bg-[var(--axis)]" />
          <span className="ml-3 rounded-md bg-sunken px-2 py-0.5 font-mono text-[10px] text-ink-muted">Project workspace</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded-xl bg-surface p-3 shadow-card ring-1 ring-[var(--ring)]">
            <TimelineSketch />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DeptSketch
              dept="legal"
              delay={0.9}
              rows={[
                { label: 'Title & land records', verdict: 'Clear', tone: 'good', fill: 100, delay: 1.2 },
                { label: 'Approvals & NOCs', verdict: 'Blockers', tone: 'critical', fill: 58, delay: 1.35 },
              ]}
            />
            <DeptSketch
              dept="finance"
              delay={1.0}
              rows={[
                { label: 'Valuation', verdict: 'Estimate', tone: 'warning', fill: 72, delay: 1.45 },
                { label: 'Budget', verdict: 'Soon', tone: 'neutral', fill: 0, delay: 1.5 },
              ]}
            />
          </div>
          <DeptSketch
            dept="construction"
            delay={1.1}
            rows={[{ label: 'Progress & schedule', verdict: 'From site', tone: 'good', fill: 64, delay: 1.6 }]}
          />
        </div>
      </motion.div>
      <div className="absolute -bottom-20 right-2 sm:-right-8">
        <ProposalSketch />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 01 — stages × departments                                           */
/* ------------------------------------------------------------------ */

/**
 * What each department produces at each stage, from the definitions.
 *
 * Pointing at a department lights its row; the cells say what that
 * department's live workstreams deliver at that stage, so the grid is the
 * product's own scope rather than a diagram of it.
 */
function StageMatrix() {
  const [hover, setHover] = useState<DepartmentKey | null>(null);
  const cell = (dept: (typeof DEPARTMENTS)[number], stage: StageKey) =>
    dept.workstreams.flatMap((w) => w.deliverables.filter((d) => d.stage === stage).map((d) => ({ title: d.title, live: w.status === 'live' })));
  return (
    <div className="overflow-x-auto rounded-2xl bg-surface shadow-card ring-1 ring-[var(--ring)]">
      <div className="min-w-[56rem]">
        <div className="grid grid-cols-[13rem_repeat(4,minmax(0,1fr))] border-b border-hairline bg-sunken/60">
          <div className="px-4 py-3 text-[11px] font-medium text-ink-muted">Department</div>
          {STAGES.map((s, i) => (
            <div key={s.key} className="border-l border-hairline px-4 py-3">
              <p className="font-mono text-[10px] text-ink-muted">0{i + 1}</p>
              <p className="text-[13px] font-semibold text-ink">{s.label}</p>
              <p className="truncate text-[11px] text-ink-muted">{s.subStages.map((x) => SUB_STAGE_LABEL[x]).join(' · ')}</p>
            </div>
          ))}
        </div>
        {DEPARTMENTS.map((dept, row) => {
          const Icon = DEPARTMENT_ICON[dept.key];
          const dim = hover !== null && hover !== dept.key;
          return (
            <motion.div
              key={dept.key}
              onMouseEnter={() => setHover(dept.key)}
              onMouseLeave={() => setHover(null)}
              className={cn('grid grid-cols-[13rem_repeat(4,minmax(0,1fr))] border-b border-hairline transition-opacity duration-base last:border-0', dim && 'opacity-45')}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, ease: EASE_ENTER, delay: row * 0.06 }}
            >
              <div className="flex items-start gap-2.5 px-4 py-3.5">
                <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset', dept.status === 'live' ? 'bg-ink text-[var(--text-inverse)] ring-ink' : 'bg-sunken text-ink-muted ring-[var(--ring)]')}>
                  <Icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-tight text-ink">{dept.label}</p>
                  <p className={cn('mt-0.5 text-[11px]', dept.status === 'live' ? 'text-[var(--status-good-text)]' : 'text-ink-muted')}>{dept.status === 'live' ? 'Live' : 'Coming soon'}</p>
                </div>
              </div>
              {STAGES.map((s) => {
                const items = cell(dept, s.key);
                return (
                  <div key={s.key} className="border-l border-hairline px-4 py-3.5">
                    {items.length ? (
                      <ul className="space-y-1">
                        {items.slice(0, 3).map((d) => (
                          <li key={d.title} className={cn('flex items-start gap-1.5 text-[12px] leading-snug', d.live ? 'text-ink' : 'text-ink-muted')}>
                            <span className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', d.live ? 'bg-brand' : 'bg-[var(--axis)]')} />
                            {d.title}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Minus size={14} className="text-[var(--axis)]" aria-label="Nothing at this stage" />
                    )}
                  </div>
                );
              })}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 03 — a value and its page                                           */
/* ------------------------------------------------------------------ */

function CitationSpecimen() {
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" role="img" aria-label="An illustration: a value on the record, with a citation chip pointing to the line on the page it was read from.">
      <div className="relative mx-auto w-full max-w-[16rem] rounded-xl bg-[#fbfaf6] p-4 shadow-raised ring-1 ring-[var(--ring)] dark:bg-[#1f1e1b]">
        <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted">Page 4</p>
        <div className="space-y-2" aria-hidden>
          {[92, 78, 88, 64].map((w, i) => (
            <span key={i} className="block h-1.5 rounded-full bg-ink/20" style={{ width: `${w}%` }} />
          ))}
          <span className="relative block h-3">
            <motion.span
              className="absolute inset-0 origin-left rounded-sm bg-mark/70"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: EASE_ENTER, delay: 0.4 }}
            />
            <span className="relative block h-1.5 translate-y-[3px] rounded-full bg-ink/40" style={{ width: '84%' }} />
          </span>
          {[70, 90, 58, 82, 46].map((w, i) => (
            <span key={i} className="block h-1.5 rounded-full bg-ink/20" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        {[
          { label: 'Survey number', state: 'Accepted', tone: 'good' as const },
          { label: 'Extent on the deed', state: 'Waiting for a person', tone: 'ai' as const },
          { label: 'Registered on', state: 'Accepted', tone: 'good' as const },
        ].map((row, i) => (
          <motion.div
            key={row.label}
            className="flex items-center gap-3 rounded-xl bg-surface px-3.5 py-3 shadow-card ring-1 ring-[var(--ring)]"
            initial={{ opacity: 0, x: 12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, ease: EASE_ENTER, delay: 0.2 + i * 0.12 }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{row.label}</p>
              <p className={cn('text-[12px]', row.tone === 'good' ? 'text-[var(--status-good-text)]' : 'text-ai-ink')}>{row.state}</p>
            </div>
            <span className="rounded-md bg-brand-soft px-2 py-1 font-mono text-[11px] text-brand ring-1 ring-inset ring-brand/20">deed · p. 4</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 04 — what a change reaches                                          */
/* ------------------------------------------------------------------ */

const IMPACT = [
  { label: 'Commencement certificate', kind: 'Approval', tone: 'critical' as const },
  { label: 'Progress & schedule', kind: 'gated', tone: 'neutral' as const },
  { label: 'Valuation', kind: 'fed', tone: 'neutral' as const },
  { label: 'Funding & escrow', kind: 'fed, 2 steps away', tone: 'neutral' as const },
];

function ImpactWalk() {
  return (
    <div className="flex flex-col items-stretch gap-0 sm:flex-row sm:items-center" role="img" aria-label="An approval that is missing gates construction progress, which feeds the valuation, which feeds funding and escrow.">
      {IMPACT.map((node, i) => (
        <div key={node.label} className="flex flex-col items-center sm:flex-row">
          <motion.div
            className={cn(
              'w-full rounded-xl px-4 py-3 shadow-card ring-1 sm:w-44',
              node.tone === 'critical' ? 'bg-critical/10 ring-critical/30' : 'bg-surface ring-[var(--ring)]',
            )}
            initial={{ opacity: 0, scale: 0.92 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ ...SPRING.settle, delay: 0.15 + i * 0.28 }}
          >
            <p className={cn('text-[11px] font-medium', node.tone === 'critical' ? 'text-critical' : 'text-ink-muted')}>{i === 0 ? 'Missing' : node.kind}</p>
            <p className="text-[13px] font-semibold leading-snug text-ink">{node.label}</p>
          </motion.div>
          {i < IMPACT.length - 1 ? (
            <motion.span
              aria-hidden
              className="my-1 h-6 w-[2px] origin-top bg-ink/40 sm:mx-1 sm:my-0 sm:h-[2px] sm:w-8 sm:origin-left"
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, ease: EASE_ENTER, delay: 0.35 + i * 0.28 }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 05 — the site, from a phone                                         */
/* ------------------------------------------------------------------ */

function PhoneSketch() {
  return (
    <div className="relative mx-auto w-[17rem]" role="img" aria-label="An illustration of the site app: today's log with manpower, milestone progress and photographs, saved on the phone and sent when there is signal.">
      <motion.div
        className="rounded-[2.4rem] bg-ink p-2.5 shadow-pop"
        initial={{ opacity: 0, y: 24, rotate: -2 }}
        whileInView={{ opacity: 1, y: 0, rotate: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, ease: EASE_ENTER }}
      >
        <div className="overflow-hidden rounded-[1.9rem] bg-page">
          <div className="flex justify-center pt-2" aria-hidden>
            <span className="h-4 w-20 rounded-full bg-ink" />
          </div>
          <div className="space-y-3 px-4 pb-6 pt-3">
            <div>
              <p className="text-[10px] font-medium text-ink-muted">Today</p>
              <p className="text-[16px] font-semibold tracking-tight text-ink">Daily log</p>
            </div>
            <div className="rounded-xl bg-surface p-3 shadow-card ring-1 ring-[var(--ring)]">
              <p className="text-[11px] font-semibold text-ink">Manpower</p>
              {['Mason', 'Bar bender', 'Carpenter'].map((trade, i) => (
                <div key={trade} className="mt-2 flex items-center justify-between text-[11px] text-ink-secondary">
                  {trade}
                  <span className="flex items-center gap-1.5">
                    <span className="grid size-5 place-items-center rounded-md bg-sunken"><Minus size={10} /></span>
                    <motion.span
                      className="w-4 text-center font-mono text-ink"
                      initial={{ opacity: 0, y: 6 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + i * 0.15 }}
                    >
                      {['·', '·', '·'][i]}
                    </motion.span>
                    <span className="grid size-5 place-items-center rounded-md bg-ink text-[var(--text-inverse)]"><Plus size={10} /></span>
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-surface p-3 shadow-card ring-1 ring-[var(--ring)]">
              <p className="text-[11px] font-semibold text-ink">Milestones</p>
              {[62, 38].map((w, i) => (
                <div key={i} className="mt-2.5">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-sunken">
                    <motion.span
                      className="block h-full rounded-full bg-good"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${w}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, ease: EASE_ENTER, delay: 0.6 + i * 0.15 }}
                    />
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="aspect-square rounded-lg bg-gradient-to-br from-[var(--axis)] to-sunken"
                  initial={{ opacity: 0, scale: 0.6 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ ...SPRING.settle, delay: 0.9 + i * 0.1 }}
                />
              ))}
            </div>
            <p className="flex items-center justify-center gap-1.5 rounded-full bg-sunken py-1.5 text-[11px] text-ink-secondary">
              <CloudOff size={11} />
              Saved on the phone · sends when there is signal
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const live = DEPARTMENTS.filter((d) => d.status === 'live');
  return (
    <div className="min-h-full overflow-x-hidden bg-page text-ink">
      <header className="sticky top-0 z-30 border-b border-hairline/70 bg-page/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-brand" aria-hidden>
              <svg viewBox="0 0 100 100" className="size-[18px]">
                <path d="M26 68 L50 26 L74 68 Z" fill="none" stroke="white" strokeWidth={10} strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Realytica</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="On this page">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary transition-colors duration-quick hover:bg-sunken hover:text-ink">
                {n.label}
              </a>
            ))}
          </nav>
          <Link to="/portfolio" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-action px-3.5 py-2 text-[13px] font-medium text-action-ink transition-colors hover:bg-action-hover md:ml-0">
            Open workspace
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--hairline)_1px,transparent_1px),linear-gradient(to_bottom,var(--hairline)_1px,transparent_1px)] bg-[size:48px_48px] opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:pb-32 lg:pt-20">
          <div>
            <motion.p
              className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-[12px] text-ink-secondary shadow-card ring-1 ring-[var(--ring)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_ENTER }}
            >
              <span className="size-1.5 rounded-full bg-good" />
              For engineering firms, developers and the professionals around them
            </motion.p>
            <h1 className="mt-6 text-[38px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[52px] lg:text-[44px] xl:text-[50px]">
              {['A property’s whole life,', 'in one place.'].map((line, i) => (
                <span key={line} className="block overflow-hidden pb-[0.06em]">
                  <motion.span
                    className={cn('block', i === 1 && 'text-ink-secondary')}
                    initial={{ y: '105%' }}
                    animate={{ y: 0 }}
                    transition={{ duration: 0.7, ease: EASE_ENTER, delay: 0.1 + i * 0.12 }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.p
              className="mt-6 max-w-[34rem] text-[16px] leading-relaxed text-ink-secondary"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE_ENTER, delay: 0.35 }}
            >
              Every project moves through {inWords(STAGES.length)} stages, and its work through {inWords(DEPARTMENTS.length)} departments. Realytica gives each its place — title and approvals, progress and the site, the valuation — reads the documents for you, Kannada included, with the page behind every value, and keeps a copilot beside every view.
            </motion.p>
            <motion.div
              className="mt-8 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE_ENTER, delay: 0.45 }}
            >
              <Link to="/portfolio" className={CTA}>
                Open the workspace
                <ArrowRight size={16} className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
              </Link>
              <a href="#structure" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-3 text-[14px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick hover:bg-surface">
                See how it is organised
              </a>
            </motion.div>
            <motion.p
              className="mt-6 flex items-center gap-2 text-[13px] text-ink-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.6 }}
            >
              <Lock size={13} />
              The AI proposes. Nothing is filed until a person accepts it.
            </motion.p>
          </div>
          <div className="pb-8 lg:pb-0">
            <HeroCanvas />
          </div>
        </div>
      </section>

      {/* 01 */}
      <section id="structure" className="scroll-mt-20 border-t border-hairline bg-surface py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead
            n="01"
            title="Organised the way the work is."
            note={
              <>
                {inWords(STAGES.length).replace(/^./, (c) => c.toUpperCase())} stages, {inWords(DEPARTMENTS.length)} departments and the workstreams inside them. {live.map((d) => d.label.split(' ')[0]).join(', ')} are live; the rest are listed with what they will hold. Point at a department to follow its work across the life of the project.
              </>
            }
          />
          <InView>
            <StageMatrix />
          </InView>
        </div>
      </section>

      {/* 02 */}
      <section id="copilot" className="scroll-mt-20 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <SectionHead n="02" title="The copilot proposes. A person decides." note="It reads what you file, answers from the file with the source attached, and drafts what you ask for. Everything it wants to change arrives as a proposal, marked as the model’s, and waits." />
            <ul className="space-y-4">
              {[
                { icon: Sparkles, title: 'Proposals, not edits', text: 'A value read off a page, a document filed under a department, a finding drafted from a photograph — each waits as a card for someone to accept, correct or set aside.' },
                { icon: Lock, title: 'Only people change the record', text: 'What is accepted carries the name of the person who accepted it. What the model wrote stays marked as the model’s until then.' },
                { icon: Check, title: 'No figure without a source', text: 'When nothing on file supports an answer, it says so rather than filling the gap with a plausible number.' },
              ].map((item, i) => (
                <InView key={item.title} delay={0.08 * i}>
                  <li className="flex gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-ink shadow-card ring-1 ring-[var(--ring)]">
                      <item.icon size={17} />
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold text-ink">{item.title}</p>
                      <p className="mt-1 text-[14px] leading-relaxed text-ink-secondary">{item.text}</p>
                    </div>
                  </li>
                </InView>
              ))}
            </ul>
          </div>
          <InView delay={0.1} className="flex justify-center">
            <div className="w-full max-w-md space-y-3 rounded-2xl bg-surface p-5 shadow-raised ring-1 ring-[var(--ring)]">
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-sunken px-3.5 py-2 text-[13px] text-ink ring-1 ring-inset ring-[var(--ring)]">Read the documents I filed today</div>
              <div className="flex gap-2.5">
                <AiMark className="mt-0.5" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <p className="text-[12px] font-semibold text-ink">Copilot</p>
                  <p className="text-[13px] leading-relaxed text-ink">Read them, and typed each one. The values each states are waiting on its row, with the page they came from.</p>
                  <ProposalSketchStatic />
                </div>
              </div>
            </div>
          </InView>
        </div>
      </section>

      {/* 03 */}
      <section id="evidence" className="scroll-mt-20 border-y border-hairline bg-surface py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead n="03" title="Every value with its page." note="Deeds, encumbrance certificates, plans and NOCs are read where they are filed — the text layer, then the scan, in English and Kannada, then a model where those fail. Each value keeps the line it was read from, and a person accepts it before anything relies on it." />
          <InView>
            <CitationSpecimen />
          </InView>
        </div>
      </section>

      {/* 04 */}
      <section className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead
            n="04"
            title="See what a change reaches."
            note={
              <>
                The project is a graph — stages, departments, workstreams and every record in them. When an approval lapses, the walk shows what it gates and what that feeds, and who is standing on each. <span className="inline-flex items-center gap-1 text-ink"><Waypoints size={14} /> Walked in Neo4j.</span>
              </>
            }
          />
          <InView>
            <ImpactWalk />
          </InView>
        </div>
      </section>

      {/* 05 */}
      <section id="site" className="scroll-mt-20 border-y border-hairline bg-surface py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <SectionHead n="05" title="The site, from a phone." note="Realytica Site, for Android and iOS, does one job: the day on site. Manpower, work done, progress against milestones, weather, photographs and issues — logged with no signal and sent when there is. Pair it with a code; it never sees a password." />
            <InView>
              <p className="inline-flex items-center gap-2 rounded-full bg-page px-3 py-1.5 text-[13px] text-ink-secondary ring-1 ring-[var(--ring)]">
                <Smartphone size={14} />
                Work logged before the approvals that allow it is flagged at once.
              </p>
            </InView>
          </div>
          <PhoneSketch />
        </div>
      </section>

      {/* 06 */}
      <section id="scope" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead n="06" title="Scope and limitations." />
          <InView className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="max-w-[62ch] space-y-4 text-[16px] leading-[1.7] text-ink-secondary">
              <p>
                A portfolio by stage, a workspace per project with its departments and their workstreams, one chat across all of it, a graph of how the work connects, and a site app for Android and iOS. Reports are built from the records and export to Word or PDF.
              </p>
              <p>
                It is <span className="font-medium text-ink">not</span> a certified valuation, a legal title certificate or a live-registry product. Indicative figures and AI drafts sit on the same records and never replace a registered valuer or the engineer who signs.
              </p>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl bg-surface p-4 shadow-card ring-1 ring-[var(--ring)]">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Coverage</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">Karnataka’s rules and revenue maps, with Telangana’s maps. India only in this build.</p>
              </div>
              <div className="rounded-xl bg-surface p-4 shadow-card ring-1 ring-[var(--ring)]">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Access</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">The workspace owner invites the team and outside professionals, each to the departments of a file they need.</p>
              </div>
            </div>
          </InView>
        </div>
      </section>

      {/* Start */}
      <section className="px-4 pb-24 sm:px-6">
        <InView className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-16 text-[var(--text-inverse)] shadow-pop sm:px-12">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-brand/40 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 left-10 size-72 rounded-full bg-ai/30 blur-3xl" />
          <div className="relative max-w-xl">
            <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[40px]">Start with a project.</h2>
            <p className="mt-4 text-[16px] leading-relaxed opacity-75">Create one for a property and drop in its documents. They are read and given to the department they belong to while you bring the team in.</p>
            <Link
              to="/portfolio"
              className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-[var(--text-inverse)] px-5 py-3 text-[14px] font-medium text-ink transition-transform duration-quick ease-state active:scale-[0.98]"
            >
              Open the application
              <ArrowRight size={16} className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
            </Link>
          </div>
        </InView>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12px] text-ink-muted sm:px-6">
          <span>Realytica · Project workspace</span>
          <span>A system of record, not a legal opinion.</span>
        </div>
      </footer>
    </div>
  );
}

/** The same proposal, at rest, for the copilot section — the hero already plays it out. */
function ProposalSketchStatic() {
  return (
    <div className="rounded-xl bg-surface p-3 ring-[1.5px] ring-ai/55">
      <div className="flex items-center gap-2">
        <AiMark size="xs" />
        <span className="text-[11px] font-medium text-ai-ink">Proposed by AI · needs your decision</span>
      </div>
      <p className="mt-1.5 text-[13px] font-medium text-ink">Accept the values read off the sale deed</p>
      <div className="mt-2.5 flex gap-1.5">
        <span className="rounded-lg bg-action px-2.5 py-1 text-[12px] font-medium text-action-ink">Accept</span>
        <span className="rounded-lg px-2.5 py-1 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">Edit</span>
        <span className="rounded-lg px-2.5 py-1 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">Reject</span>
      </div>
    </div>
  );
}
