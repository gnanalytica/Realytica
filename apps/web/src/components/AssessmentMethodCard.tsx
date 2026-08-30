import { useState } from 'react';
import { Check, ChevronDown, Compass, HelpCircle, Pencil } from 'lucide-react';
import { ASSESSMENT_PROFILES, PROJECT_KINDS } from '@realytica/shared';
import type { AssessmentProfile, MethodRole, ProjectBrief, ProjectKind, ValueAnchor } from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, Callout, Tile, cn } from './ui/kit';
import { pct, titleCase } from '../lib/format';
import { RequirementSheet } from './RequirementSheet';

/**
 * How this project is being assessed, and why.
 *
 * The product concluded what kind of undertaking this is and picked a method
 * from it. That conclusion moves every number on every other screen, so it is
 * shown here rather than applied silently — and, where the evidence does not
 * settle it, shown *as* an assumption with the one question that would settle
 * it and a control to answer it.
 *
 * The alternative, which is what this replaces, is a blend the reader cannot
 * inspect: a residual and a comparable and a land rate averaged together for
 * every subject, producing a number that is defensible for none of them.
 */

const ROLE_TONE: Record<MethodRole, 'brand' | 'good' | 'neutral' | 'warning'> = {
  primary: 'brand',
  supporting: 'good',
  sense_check: 'neutral',
  not_applicable: 'warning',
};

const ROLE_LABEL: Record<MethodRole, string> = {
  primary: 'Leads',
  supporting: 'Supports',
  sense_check: 'Sense check',
  not_applicable: 'Not used',
};

function methodLabel(anchors: ValueAnchor[], method: string): string {
  return anchors.find((a) => a.method === method)?.label ?? titleCase(method);
}

export function AssessmentMethodCard({
  project,
  profile,
  anchors,
  onChangeKind,
  busy,
  reference,
}: {
  project: ProjectBrief;
  profile: AssessmentProfile;
  anchors: ValueAnchor[];
  onChangeKind: (kind: ProjectKind) => void | Promise<void>;
  busy?: boolean;
  /** Case reference, stamped onto the copyable requirement sheet. */
  reference?: string;
}) {
  const [picking, setPicking] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const unsettled = project.source === 'inferred' && project.inference.alternatives.length > 0;

  return (
    <Card>
      <CardHeader
        title="How this is being assessed"
        subtitle={profile.summary}
        action={
          <div className="flex items-center gap-1">
            <RequirementSheet profile={profile} reference={reference ?? ''} />
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil size={13} />}
              onClick={() => setPicking((v) => !v)}
              disabled={busy}
            >
              {picking ? 'Cancel' : 'Change'}
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-4">
        <Tile tone="brand" rail className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Compass size={15} className="text-brand" />
            <span className="text-[15px] font-semibold text-ink">{profile.label}</span>
            <Badge tone={project.source === 'user' ? 'good' : unsettled ? 'warning' : 'neutral'}>
              {project.source === 'user' ? 'You confirmed this' : unsettled ? 'Working assumption' : `Inferred · ${pct(project.inference.confidence * 100, 0)} confident`}
            </Badge>
          </div>
          <p className="mt-2 font-display text-[17px] leading-snug text-ink">{profile.headlineQuestion}</p>
        </Tile>

        <div>
          <h4 className="text-mini font-semibold uppercase tracking-[0.08em] text-ink-subtle">Why this method</h4>
          <ul className="mt-1.5 space-y-1">
            {project.inference.basis.map((b) => (
              <li key={b} className="flex gap-2 text-[13px] leading-relaxed text-ink-muted">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {project.fitCaution && (
          <Callout tone="serious" title="This method does not fit this subject">
            {project.fitCaution}
          </Callout>
        )}

        {unsettled && (
          <Callout tone="warning" title={project.inference.settledBy ?? 'This is an assumption, not a finding.'}>
            <p>
              The evidence narrows this to {profile.label.toLowerCase()} but does not settle it — it is equally consistent
              with {project.inference.alternatives.map((k) => ASSESSMENT_PROFILES[k].label.toLowerCase()).join(', ')}.
              Until you say which, the assessment uses the reading that assumes least.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[project.kind, ...project.inference.alternatives].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={busy}
                  onClick={() => void onChangeKind(kind)}
                  className="rounded-md bg-surface px-2.5 py-1 text-[12px] font-medium text-ink ring-1 ring-[var(--ring)] transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  {ASSESSMENT_PROFILES[kind].label}
                </button>
              ))}
            </div>
          </Callout>
        )}

        {picking && (
          <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-[var(--ring)]">
            <p className="text-[12px] text-ink-muted">
              Pick what you are actually doing here. The valuation methods, the checks that cannot be skipped and the
              documents we ask for all change with it.
            </p>
            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {PROJECT_KINDS.map((kind) => {
                const active = kind === project.kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPicking(false);
                      void onChangeKind(kind);
                    }}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-2.5 py-2 text-left ring-1 transition-colors disabled:opacity-50',
                      active ? 'bg-brand-soft ring-brand' : 'bg-surface ring-[var(--ring)] hover:bg-surface-2',
                    )}
                  >
                    {active ? <Check size={14} className="mt-0.5 shrink-0 text-brand" /> : <span className="mt-0.5 w-[14px] shrink-0" />}
                    <span>
                      <span className="block text-[13px] font-medium text-ink">{ASSESSMENT_PROFILES[kind].label}</span>
                      <span className="block text-mini leading-snug text-ink-subtle">{ASSESSMENT_PROFILES[kind].summary}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <h4 className="text-mini font-semibold uppercase tracking-[0.08em] text-ink-subtle">What the decision turns on</h4>
          <ol className="mt-1.5 space-y-1.5">
            {profile.decisionBasis.map((b, i) => (
              <li key={b} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                <span className="mt-px font-mono text-mini tabular-nums text-ink-faint">{String(i + 1).padStart(2, '0')}</span>
                {b}
              </li>
            ))}
          </ol>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowMethods((v) => !v)}
            className="flex w-full items-center justify-between rounded-md py-1 text-left"
          >
            <span className="text-mini font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Valuation methods in play
            </span>
            <ChevronDown size={14} className={cn('text-ink-faint transition-transform duration-base', showMethods && 'rotate-180')} />
          </button>
          {showMethods && (
            <ul className="mt-2 space-y-2">
              {profile.methodStances.map((stance) => {
                const anchor = anchors.find((a) => a.method === stance.method);
                return (
                  <li key={stance.method} className="rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-[var(--ring)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{methodLabel(anchors, stance.method)}</span>
                      <Badge tone={ROLE_TONE[stance.role]}>{ROLE_LABEL[stance.role]}</Badge>
                      {anchor && (
                        <span className="font-mono text-mini tabular-nums text-ink-faint">
                          {pct(anchor.weight * 100, 0)} of the blend
                        </span>
                      )}
                      {!anchor && stance.role !== 'not_applicable' && (
                        <span className="inline-flex items-center gap-1 text-mini text-ink-faint">
                          <HelpCircle size={11} /> no anchor produced — the data it needs is missing
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{stance.why}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
