import {
  CheckCircle2,
  CircleDollarSign,
  Database,
  FileJson,
  Landmark,
  ListChecks,
  Milestone,
  Quote,
  ShieldCheck,
  Users2,
  XCircle,
} from 'lucide-react';
import {
  KEY_USER_JOBS,
  MVP_SCOPE,
  OUT_OF_SCOPE,
  PERSONAS,
  PRODUCT_FAMILY,
  PRODUCT_PRINCIPLES,
  ROLLOUT_PHASES,
} from '@realytica/shared';
import { Callout, Card, CardBody, CardHeader, SectionTitle, cn } from '../components/ui/kit';

/** Static product-page copy; docs/product.md is the longer version. */
const VISION = 'One workspace for a property’s whole life, and every profession on it.';
const POSITIONING = 'A copilot beside every view. People decide what goes on the record.';
const NORTH_STAR =
  'Realytica succeeds when a project runs from the first document to the building in use in one place — its departments working from one record, its professionals certifying from it, its site logging into it — and every figure traceable to the page it came from.';

export default function About() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <section className="space-y-2 pt-2 text-center">
        <p className="text-[12px] font-semibold text-brand">Realytica</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{VISION}</h1>
        <p className="text-[13px] text-ink-secondary">{POSITIONING}</p>
        <p className="text-xs text-ink-muted">Project workspace · Karnataka · India</p>
      </section>

      <Card as="article" className="border-l-4 border-l-brand p-5">
        <div className="flex gap-3">
          <Quote size={22} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-[15px] italic leading-relaxed text-ink">{NORTH_STAR}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="The product family" subtitle="One operating model. Engines and AI write into the same registers." icon={<Landmark size={16} />} />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline text-[11px] font-medium text-ink-muted">
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 font-medium">What it answers</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCT_FAMILY.map((p, i) => (
                <tr key={p.title} className={cn('align-top', i > 0 && 'border-t border-hairline')}>
                  <td className="w-56 py-2.5 pr-4 text-[13px] font-semibold text-ink">{p.title}</td>
                  <td className="py-2.5 text-[13px] leading-relaxed text-ink-secondary">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <section>
        <SectionTitle hint="Legible in every screen">Five product principles</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PRODUCT_PRINCIPLES.map((p, i) => (
            <Card key={p.title} className="p-3.5">
              <div className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-mini font-semibold text-brand">
                {i + 1}
              </div>
              <p className="text-[13px] font-semibold text-ink">{p.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{p.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader title="Who it's for" subtitle="Primary MVP personas — each drives a different lens on the same screen." icon={<Users2 size={16} />} />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PERSONAS.map((p) => (
            <div key={p.key} className="rounded-lg bg-sunken p-3">
              <p className="text-[13px] font-semibold text-ink">{p.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{p.description}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Eight key user jobs" subtitle="What the operating model has to let a DD team do without AI." icon={<ListChecks size={16} />} />
        <CardBody>
          <ol className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {KEY_USER_JOBS.map((job, i) => (
              <li key={job.title} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-mini font-semibold text-ink-secondary">
                  {i + 1}
                </span>
                <span className="min-w-0 text-[13px] leading-relaxed text-ink-secondary">
                  <span className="font-medium text-ink">{job.title}.</span> {job.description}
                </span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="In scope for the MVP" icon={<CheckCircle2 size={16} className="text-good" />} />
          <CardBody>
            <ul className="space-y-2.5">
              {MVP_SCOPE.map((item) => (
                <li key={item.title} className="flex gap-2 text-[13px] leading-relaxed">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" />
                  <span>
                    <span className="font-medium text-ink">{item.title}.</span>{' '}
                    <span className="text-ink-secondary">{item.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Explicitly out of scope" icon={<XCircle size={16} className="text-critical" />} />
          <CardBody>
            <ul className="space-y-2.5">
              {OUT_OF_SCOPE.map((item) => (
                <li key={item.title} className="flex gap-2 text-[13px] leading-relaxed">
                  <XCircle size={14} className="mt-0.5 shrink-0 text-critical" />
                  <span>
                    <span className="font-medium text-ink">{item.title}.</span>{' '}
                    <span className="text-ink-secondary">{item.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Rollout phases" subtitle="Global Core + Country Pack + State / Municipality Pack architecture." icon={<Milestone size={16} />} />
        <CardBody>
          <ol className="space-y-0">
            {ROLLOUT_PHASES.map((phase, i) => (
              <li key={phase.title} className="relative flex gap-3 pb-5 last:pb-0">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-mini font-semibold',
                      i === 0 ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink-muted',
                    )}
                  >
                    {i + 1}
                  </div>
                  {i < ROLLOUT_PHASES.length - 1 ? <div className="mt-1 w-px flex-1 bg-hairline" /> : null}
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[13px] font-semibold text-ink">
                    {phase.title}
                    {i === 0 ? <span className="ml-2 rounded-full bg-brand-soft px-1.5 py-0.5 text-micro font-semibold text-brand">This build</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{phase.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How this build works" subtitle="A local-first reference implementation of the MVP." icon={<Database size={16} />} />
        <CardBody className="space-y-4">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <li className="flex gap-2 text-[13px] text-ink-secondary">
              <FileJson size={14} className="mt-0.5 shrink-0 text-ink-muted" />
              Local-first — everything runs on your machine, no external accounts required.
            </li>
            <li className="flex gap-2 text-[13px] text-ink-secondary">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ink-muted" />
              An Express API on port 5174 serves the web app on 5173 via a dev proxy.
            </li>
            <li className="flex gap-2 text-[13px] text-ink-secondary">
              <Database size={14} className="mt-0.5 shrink-0 text-ink-muted" />A JSON-file store persists cases — no database to install.
            </li>
            <li className="flex gap-2 text-[13px] text-ink-secondary">
              <CircleDollarSign size={14} className="mt-0.5 shrink-0 text-ink-muted" />
              A deterministic screening engine — same inputs always produce the same evidence-backed result.
            </li>
          </ul>
          <Callout tone="warning" title="Geographic coverage in this build" collapsible>
            This build covers <strong>Karnataka</strong>, with Telangana revenue maps. Stamp duty, registration
            fees and the property register (the khata extract) are set by each Indian state, so they are not
            portable to another one. A project entered outside a covered state still screens, but is flagged with
            a material risk rather than quietly measured against the wrong documents.
          </Callout>
        </CardBody>
      </Card>

    </div>
  );
}
