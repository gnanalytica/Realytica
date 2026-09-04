import { X } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  SCOPE_LABEL,
  checkAdvise,
  paneForTalk,
  proposalsPinnedToCheck,
  quotesForCheck,
  sittingCheckOf,
  type ChatProposal,
  type CockpitPathExtra,
  type DdProject,
  type ProjectCockpitPane,
  type TalkSitting,
} from '@realytica/shared';
import { api } from '../../../lib/api';
import { Badge, Button, cn, useToast } from '../../../components/ui/kit';
import { checkTone } from '../shared';
import { FieldAdvise } from './FieldAdvise';
import { ProposalCard } from './ProposalCard';

export function SittingChip({
  talk,
  active,
  onOpen,
}: {
  talk: TalkSitting;
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ring-1 ring-inset',
        active ? 'bg-brand-soft ring-brand/30' : 'bg-surface ring-[var(--ring)] hover:bg-sunken',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{talk.label}</span>
      <span className="shrink-0 text-[11px] text-ink-muted">{talk.kind === 'check' ? 'Field' : talk.kind === 'scope' ? 'Scope' : talk.kind}</span>
    </button>
  );
}

export function SittingDock({
  project,
  talk,
  busy,
  compact,
  onClose,
  onOpen,
  onApprove,
  onSkip,
  onProject,
}: {
  project: DdProject;
  talk: TalkSitting;
  busy?: boolean;
  /** Desktop: cards + pointer. The field (tick/cross) lives on the right pane. */
  compact?: boolean;
  onClose: () => void;
  onOpen: (pane: ProjectCockpitPane, extra?: CockpitPathExtra) => void;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onProject: (next: DdProject) => void;
}) {
  return (
    <div className="rounded-xl bg-surface p-3 shadow-sm ring-1 ring-inset ring-[var(--ring)]">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          {talk.kind === 'check' ? (compact ? 'On the right' : 'This field') : talk.kind === 'scope' ? 'This scope' : 'On this file'}
        </p>
        <button type="button" aria-label="Dismiss field" onClick={onClose} className="rounded p-0.5 text-ink-muted hover:bg-sunken hover:text-ink">
          <X size={13} />
        </button>
      </div>
      {talk.kind === 'check' ? (
        <CheckPeek
          project={project}
          talk={talk}
          busy={busy}
          compact={compact}
          onOpen={onOpen}
          onApprove={onApprove}
          onSkip={onSkip}
          onProject={onProject}
        />
      ) : talk.kind === 'scope' ? (
        <ScopePeek project={project} talk={talk} onOpen={onOpen} />
      ) : (
        <button
          type="button"
          onClick={() => onOpen(paneForTalk(talk.kind), talk.extra)}
          className="mt-1.5 w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-ink hover:bg-sunken"
        >
          {talk.label}
        </button>
      )}
    </div>
  );
}

function CheckPeek({
  project,
  talk,
  busy,
  compact,
  onOpen,
  onApprove,
  onSkip,
  onProject,
}: {
  project: DdProject;
  talk: TalkSitting;
  busy?: boolean;
  compact?: boolean;
  onOpen: (pane: ProjectCockpitPane, extra?: CockpitPathExtra) => void;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onProject: (next: DdProject) => void;
}) {
  const toast = useToast();
  const hit = sittingCheckOf(project, talk.extra);
  const pinned = talk.extra.checkId ? proposalsPinnedToCheck(project, talk.extra.checkId) : [];
  const quotes = talk.extra.checkId ? quotesForCheck(project, talk.extra.checkId) : [];

  if (!hit) {
    return (
      <p className="mt-1 text-[12px] text-ink-muted">
        {talk.label} is no longer on this file.
      </p>
    );
  }

  const check = hit.check;
  const advise = checkAdvise(project, check);

  async function record(result: 'compliant' | 'missing_evidence') {
    try {
      const { project: next } = await api.recordCheck(project.id, check.id, {
        result,
        comments: result === 'compliant' ? 'Tick from the sitting.' : 'Cross from the sitting — expected proof still missing.',
      });
      onProject(next);
      toast(result === 'compliant' ? 'Recorded compliant' : 'Recorded missing evidence', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record check', 'critical');
    }
  }

  if (compact) {
    return (
      <div className="mt-1.5 space-y-2">
        <button type="button" onClick={() => onOpen('scope', talk.extra)} className="w-full text-left">
          <p className="text-[12px] text-ink-muted">{SCOPE_LABEL[hit.scope.scopeKey]} · {hit.assessment.name}</p>
          <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-ink">{check.title}</p>
        </button>
        {pinned.length ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-ink-muted">Cards for this field</p>
            {pinned.slice(0, 3).map((item) => (
              <ProposalCard key={item.id} item={item} busy={Boolean(busy)} onApprove={onApprove} onSkip={onSkip} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-2">
      <FieldAdvise
        check={check}
        scope={hit.scope}
        assessmentName={hit.assessment.name}
        advise={advise}
        quotes={quotes}
        pending={check.result === 'pending'}
        busy={busy}
        onTick={() => void record('compliant')}
        onCross={() => void record('missing_evidence')}
        onDetails={() => onOpen('scope', talk.extra)}
      />
      {pinned.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-ink-muted">Cards for this field</p>
          {pinned.slice(0, 3).map((item) => (
            <ProposalCard key={item.id} item={item} busy={Boolean(busy)} onApprove={onApprove} onSkip={onSkip} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScopePeek({
  project,
  talk,
  onOpen,
}: {
  project: DdProject;
  talk: TalkSitting;
  onOpen: (pane: ProjectCockpitPane, extra?: CockpitPathExtra) => void;
}) {
  const assessment = project.assessments.find((a) => a.id === talk.extra.ddId);
  const scope = assessment?.scopes.find((s) => s.id === talk.extra.scopeId);
  if (!assessment || !scope) {
    return <p className="mt-1 text-[12px] text-ink-muted">{talk.label} is no longer on this file.</p>;
  }
  const pending = scope.checks.filter((c) => c.result === 'pending');
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-[12px] text-ink-muted">{assessment.name}</p>
      <p className="text-[13.5px] font-semibold text-ink">{SCOPE_LABEL[scope.scopeKey]}</p>
      <p className="text-[12px] text-ink-secondary">{pending.length} pending</p>
      <div className="divide-y divide-hairline rounded-lg ring-1 ring-inset ring-[var(--ring)]">
        {scope.checks.slice(0, 4).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen('scope', { ddId: assessment.id, scopeId: scope.id, checkId: c.id })}
            className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-sunken"
          >
            <span className="min-w-0 truncate text-[12px] text-ink">{c.title}</span>
            <Badge tone={checkTone(c.result)}>{CHECK_RESULT_LABEL[c.result]}</Badge>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onOpen('scope', talk.extra)}
        className="text-[11.5px] text-brand hover:underline"
      >
        Open the scope
      </button>
    </div>
  );
}
