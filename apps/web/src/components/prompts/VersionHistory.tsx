import { useState } from 'react';
import { Check, GitBranch, Lock, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import type { PromptDescriptor, PromptVersion } from '@realytica/shared';
import { Badge, Button, Modal, cn } from '../ui/kit';
import { date, relativeTime } from '../../lib/format';
import { GuardrailWaiver, UNGUARDED_CONSEQUENCE, brokenChecks, versionsNewestFirst } from './InvariantList';

/**
 * The version history of one prompt, newest first, and the controls that
 * change which text is in force.
 *
 * Two decisions worth stating.
 *
 * **The built-in is inviolable, and the interface says why.** Version 1 ships
 * with the build and cannot be edited or deleted, because it is the way back:
 * whatever anyone does to a preamble, there is always a version whose
 * guarantees are known and which can be restored in one click. A greyed-out
 * button with no explanation would read as an oversight; the row says what the
 * built-in is for instead.
 *
 * **Activating a version is an edit to production.** Switching to a version
 * that already dropped a guardrail puts unguarded text in front of every run
 * from that moment, which is the same consequence as saving one — so it costs
 * the same deliberate confirmation, not a single click.
 */

export interface VersionHistoryProps {
  prompt: PromptDescriptor;
  onActivate: (versionId: string) => void;
  onEdit: (versionId: string) => void;
  onNewVersionFrom: (versionId: string) => void;
  onDelete: (versionId: string) => void;
  /** Set while a mutation for this version is in flight, so the row that is changing is the row that shows it. */
  busyVersionId?: string | null;
  /**
   * The version a deep link arrived pointing at — the text some run actually
   * used, which is usually not the one in force now. Marked rather than
   * selected, because arriving from a run should not change what is running.
   */
  highlightVersionId?: string | null;
  className?: string;
}

export function VersionHistory({
  prompt,
  onActivate,
  onEdit,
  onNewVersionFrom,
  onDelete,
  busyVersionId,
  highlightVersionId,
  className,
}: VersionHistoryProps) {
  const [pendingActivate, setPendingActivate] = useState<PromptVersion | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PromptVersion | null>(null);

  const versions = versionsNewestFirst(prompt);
  const customCount = versions.filter((v) => !v.builtIn).length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {customCount === 0 ? (
        <div className="rounded-lg bg-sunken p-3 text-xs leading-relaxed text-ink-secondary">
          <span className="font-medium text-ink">No custom versions.</span> This prompt is running exactly the text it
          shipped with, and its guardrails are the ones that were checked at build time. Creating a version does not
          replace that text — the built-in stays here permanently as the way back.
        </div>
      ) : null}

      <ol className="flex flex-col gap-2">
        {versions.map((version) => {
          const isActive = version.id === prompt.activeVersionId;
          const isLinked = highlightVersionId != null && version.id === highlightVersionId;
          const broken = brokenChecks(version);
          const busy = busyVersionId === version.id;

          return (
            <li
              key={version.id}
              data-testid={`version-row-${version.version}`}
              className={cn(
                'rounded-lg p-3 ring-1 ring-inset',
                broken.length > 0 ? 'bg-critical/5 ring-critical/40' : 'bg-surface ring-[var(--ring)]',
                isActive && 'ring-2 ring-brand',
                // Deliberately weaker than the active ring: this row is what a
                // run used, not what is in force, and the two must not look
                // like the same claim.
                // ring-brand at reduced alpha: related to the active ring but plainly
                // weaker. There is no `info` colour in the Tailwind palette — only
                // the Badge maps that tone — so `ring-info` would compile to
                // nothing and the highlight would silently not render.
                isLinked && !isActive && 'ring-2 ring-brand/40',
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="tabular font-mono text-[13px] font-semibold text-ink">v{version.version}</span>
                <span className="text-[13px] font-medium text-ink">{version.label}</span>
                {isActive ? (
                  <Badge tone="brand" icon={<Check size={11} />}>
                    Active
                  </Badge>
                ) : null}
                {version.builtIn ? (
                  <Badge tone="neutral" icon={<Lock size={11} />}>
                    Built-in
                  </Badge>
                ) : null}
                {isLinked ? <Badge tone="info">Used by the run you came from</Badge> : null}
                {broken.length > 0 ? (
                  <Badge tone="critical" icon={<ShieldAlert size={11} />}>
                    {broken.length} guardrail{broken.length > 1 ? 's' : ''} dropped
                  </Badge>
                ) : (
                  <Badge tone="good">All guardrails kept</Badge>
                )}
                <span className="ml-auto text-mini text-ink-muted" title={date(version.createdAt, 'long')}>
                  {relativeTime(version.createdAt)}
                </span>
              </div>

              <p className="mt-1 font-mono text-micro text-ink-muted">
                {date(version.createdAt, 'long')} · {version.contentHash.slice(0, 12)}
              </p>

              {version.notes ? (
                <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{version.notes}</p>
              ) : (
                <p className="mt-1.5 text-xs italic text-ink-muted">No notes were recorded for this version.</p>
              )}

              {broken.length > 0 ? (
                <div className="mt-2 rounded-md bg-critical/10 p-2 ring-1 ring-inset ring-critical/40">
                  <p className="text-mini font-semibold text-critical">
                    Drops: {broken.map((b) => b.label).join(', ')}
                  </p>
                  <p className="mt-0.5 text-mini leading-relaxed text-ink-secondary">
                    {isActive
                      ? 'This is the text in force now, so findings being produced are not covered by the anti-fabrication guarantee.'
                      : 'Making this version active would put that text in force.'}
                  </p>
                </div>
              ) : null}

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {isActive ? (
                  <span className="text-mini font-medium text-brand">In force for every run of this prompt</span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    data-testid={`activate-v${version.version}`}
                    onClick={() => (broken.length > 0 ? setPendingActivate(version) : onActivate(version.id))}
                  >
                    Make active
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  icon={<GitBranch size={13} />}
                  data-testid={`branch-v${version.version}`}
                  onClick={() => onNewVersionFrom(version.id)}
                >
                  New version from this
                </Button>

                {version.builtIn ? null : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil size={13} />}
                      data-testid={`edit-v${version.version}`}
                      onClick={() => onEdit(version.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={13} />}
                      disabled={isActive}
                      title={isActive ? 'This version is in force. Activate another version before deleting it.' : undefined}
                      onClick={() => setPendingDelete(version)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>

              {version.builtIn ? (
                <p
                  className="mt-2 flex items-start gap-1.5 text-mini leading-relaxed text-ink-secondary"
                  data-testid="built-in-note"
                >
                  <Lock size={12} className="mt-0.5 shrink-0 text-ink-muted" />
                  <span>
                    This is the text that shipped with the build. It cannot be edited or deleted so that there is
                    always a way back to a version whose guarantees were checked before release — one click on
                    <span className="font-medium text-ink"> Make active</span> restores it. To change this prompt,
                    branch a new version from it.
                  </span>
                </p>
              ) : isActive ? (
                <p className="mt-2 text-mini leading-relaxed text-ink-muted">
                  A version that is in force cannot be deleted — switch to another version first, so no run is ever
                  left pointing at text that is no longer here.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <GuardrailWaiver
        open={pendingActivate !== null}
        onClose={() => setPendingActivate(null)}
        onConfirm={() => {
          if (pendingActivate) onActivate(pendingActivate.id);
          setPendingActivate(null);
        }}
        title={`Make v${pendingActivate?.version ?? ''} active without its guardrails?`}
        lead={`v${pendingActivate?.version ?? ''} ("${pendingActivate?.label ?? ''}") does not satisfy every guardrail declared for ${prompt.label}. Making it active puts that text in force for every run of this prompt from now on.`}
        dropped={pendingActivate ? brokenChecks(pendingActivate) : []}
        actionLabel={`Activate v${pendingActivate?.version ?? ''} unguarded`}
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={`Delete v${pendingDelete?.version ?? ''}?`}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete version
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink">
          v{pendingDelete?.version} ("{pendingDelete?.label}") will be removed from this prompt's history.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
          Runs already recorded against it keep their prompt hash, so past results stay attributable — but the text
          behind that hash will no longer be readable here. The built-in is unaffected.
        </p>
      </Modal>
    </div>
  );
}

export default VersionHistory;
