import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  FileDiff,
  History,
  Plus,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { PromptDescriptor, PromptVersion } from '@realytica/shared';
import { api as appApi } from '../lib/api';
import { useMe } from '../lib/useMe';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Callout,
  EmptyState,
  Modal,
  Select,
  Skeleton,
  Stat,
  Tabs,
  cn,
  useToast,
  type Tone,
} from '../components/ui/kit';
import {
  PromptDiff,
  PromptEditor,
  PromptList,
  ROLE_HINT,
  ROLE_LABEL,
  UNGUARDED_CONSEQUENCE,
  VersionHistory,
  activeVersion,
  brokenChecks,
  builtInVersion,
  versionsNewestFirst,
  type PromptDraft,
} from '../components/prompts';

/**
 * Prompt management — every prompt the agent layer runs, and which text is in
 * force.
 *
 * The whole page is organised around one constraint. The shared preamble is
 * not stylistic: it is the text that says *never invent a document, a
 * transaction, a statute, a case number, a date, or a figure*, and an invented
 * survey number is the one failure this product cannot ship. Prompts still
 * have to be editable — an operator who cannot fix a preamble will work around
 * the tool instead — so the contract's answer is that editing is allowed and
 * editing *invisibly* is not.
 *
 * That turns into four commitments here, in descending order of importance:
 *
 * 1. A prompt whose active version dropped a guardrail is visible from the
 *    list, from the page banner, and from its own header — without opening
 *    anything, and never as a small amber dot.
 * 2. The consequence is spelled out in product terms wherever that state
 *    appears: findings produced under it are not covered by the
 *    anti-fabrication guarantee and must not be filed alongside ones that are.
 * 3. Putting unguarded text into production — by saving it or by activating it
 *    — costs a deliberate confirmation that names each guarantee being given
 *    up.
 * 4. Nothing unchecked is drawn as checked. A guardrail this build cannot
 *    evaluate says so, in the same register the model-operations page uses for
 *    capability gaps.
 *
 * Data comes from the API client when it carries prompt endpoints, from props
 * when a caller supplies them, and otherwise from nowhere — in which case the
 * page says the registry was not reported rather than implying every prompt is
 * in its shipped state.
 */

/* ------------------------------------------------------------------ */
/* The data port                                                       */
/* ------------------------------------------------------------------ */

export interface PromptsApi {
  list: () => Promise<PromptDescriptor[]>;
  createVersion: (key: string, draft: PromptDraft) => Promise<PromptDescriptor>;
  updateVersion: (key: string, versionId: string, draft: PromptDraft) => Promise<PromptDescriptor>;
  activateVersion: (key: string, versionId: string) => Promise<PromptDescriptor>;
  deleteVersion: (key: string, versionId: string) => Promise<PromptDescriptor>;
}

export interface PromptsPageProps {
  /** Injected by a caller (or a harness). Anything absent falls back to the shared client, then to a local store. */
  api?: Partial<PromptsApi>;
  /** Seed data for standalone rendering. Ignored once a live `list` is available. */
  initialPrompts?: PromptDescriptor[];
}

/**
 * Pick up prompt endpoints from the shared API client if it has grown them.
 *
 * The client is owned elsewhere and does not carry these yet. Duck-typing them
 * means the page starts working the moment they land, with no edit here — and
 * until then it reports the registry as unavailable rather than inventing a
 * roster of prompts, which on this page would be indistinguishable from
 * claiming that every prompt is in its shipped state.
 */
function clientPromptApi(): Partial<PromptsApi> {
  const client = appApi as unknown as Record<string, unknown>;
  const fn = <T,>(name: string): T | undefined =>
    typeof client[name] === 'function' ? (client[name] as T) : undefined;
  return {
    list: fn<PromptsApi['list']>('prompts'),
    createVersion: fn<PromptsApi['createVersion']>('createPromptVersion'),
    updateVersion: fn<PromptsApi['updateVersion']>('updatePromptVersion'),
    activateVersion: fn<PromptsApi['activateVersion']>('activatePromptVersion'),
    deleteVersion: fn<PromptsApi['deleteVersion']>('deletePromptVersion'),
  };
}

/* ------------------------------------------------------------------ */
/* Local store — used only where no endpoint exists                    */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a, 32-bit, hex.
 *
 * Stands in for the real content digest so a locally created version still has
 * a stable identity to show. It is labelled `local:` wherever it is displayed
 * so nobody mistakes it for the digest a run was recorded against.
 */
function localHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `local:${h.toString(16).padStart(8, '0')}`;
}

function localCreate(prompt: PromptDescriptor, draft: PromptDraft, now: string): PromptDescriptor {
  const version = prompt.versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const created: PromptVersion = {
    id: `${prompt.key}@v${version}`,
    promptKey: prompt.key,
    version,
    label: draft.label,
    content: draft.content,
    createdAt: now,
    builtIn: false,
    contentHash: localHash(draft.content),
    notes: draft.notes,
    invariants: draft.invariants,
  };
  return {
    ...prompt,
    versions: [...prompt.versions, created],
    activeVersionId: draft.activate ? created.id : prompt.activeVersionId,
  };
}

function localUpdate(prompt: PromptDescriptor, versionId: string, draft: PromptDraft): PromptDescriptor {
  return {
    ...prompt,
    activeVersionId: draft.activate ? versionId : prompt.activeVersionId,
    versions: prompt.versions.map((v) =>
      v.id === versionId
        ? {
            ...v,
            label: draft.label,
            content: draft.content,
            notes: draft.notes,
            contentHash: localHash(draft.content),
            invariants: draft.invariants,
          }
        : v,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type DetailTab = 'versions' | 'diff' | 'text';

interface EditorState {
  mode: 'new' | 'edit';
  baseVersionId: string;
}

export default function Prompts({ api, initialPrompts }: PromptsPageProps = {}) {
  const toast = useToast();

  /*
   * Resolved from the individual members rather than from the props object: a
   * caller writing `<Prompts api={{ … }} />` hands over a fresh literal on
   * every render, and depending on the object itself would restart the load
   * effect forever.
   */
  const port = useMemo<Partial<PromptsApi>>(
    () => ({ ...clientPromptApi(), ...api }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api?.list, api?.createVersion, api?.updateVersion, api?.activateVersion, api?.deleteVersion],
  );
  const persists = Boolean(port.createVersion || port.updateVersion || port.activateVersion);

  const [prompts, setPrompts] = useState<PromptDescriptor[] | null>(initialPrompts ?? null);
  const [loading, setLoading] = useState<boolean>(Boolean(port.list));
  const [loadError, setLoadError] = useState<string | null>(null);
  /*
   * `?key=` and `?version=` open this page on a specific prompt.
   *
   * The run canvas links here from a node's `PromptUsage`, which is what makes
   * that recording worth anything: "the extraction got worse last Tuesday" is
   * only answerable if the exact text behind that run is one click away. Read
   * once into state rather than driven from the URL, so selecting a different
   * prompt afterwards does not have to rewrite the address bar and the back
   * button still leaves the page.
   */
  const [searchParams] = useSearchParams();
  const linkedKey = searchParams.get('key');
  const linkedVersionId = searchParams.get('version');

  const [selectedKey, setSelectedKey] = useState<string | null>(
    linkedKey ?? initialPrompts?.[0]?.key ?? null,
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [tab, setTab] = useState<DetailTab>('versions');
  /**
   * A `?version=` in the link is the version a run actually used, which is
   * rarely the one in force now. Held separately so the version history can
   * mark it, rather than silently scrolling past it.
   */
  const highlightVersionId = linkedVersionId;
  const [saving, setSaving] = useState(false);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  /*
   * These prompts are one registry for the whole deployment. Any admin may
   * read them — what the agents are told is worth being able to see — but
   * rewriting them reaches across every workspace on the install, so it takes
   * standing the workspace roles do not grant. The refusal that matters is the
   * server's; hiding the controls is only so nobody edits for ten minutes and
   * then finds out.
   */
  const me = useMe();
  const mayEdit = me?.operator ?? false;
  const [dirty, setDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

  useEffect(() => {
    const load = port.list;
    if (!load) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    load()
      .then((next) => {
        if (!live) return;
        setPrompts(next);
        // A `?key=` naming a prompt this build does not have falls through to
        // the first one rather than leaving the page blank — a stale link
        // should land somewhere usable, not on nothing.
        const linkedExists = linkedKey !== null && next.some((p) => p.key === linkedKey);
        setSelectedKey((current) => current ?? (linkedExists ? linkedKey : null) ?? next[0]?.key ?? null);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [port]);

  const selected = prompts?.find((p) => p.key === selectedKey) ?? null;

  /** Any move away from unsaved prompt text goes through here. */
  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPendingNavigation(() => action);
      else action();
    },
    [dirty],
  );

  const closeEditor = useCallback(() => {
    setEditor(null);
    setDirty(false);
  }, []);

  const applyDescriptor = useCallback((next: PromptDescriptor) => {
    setPrompts((prev) => (prev ?? []).map((p) => (p.key === next.key ? next : p)));
  }, []);

  /**
   * Compare what the editor predicted against what the store recorded.
   *
   * The stored result is authoritative — it is what travels with the version
   * and marks the runs. If the two disagree, the user is told, because the
   * screen they were reading while they typed said something the registry does
   * not agree with, and silently swapping one for the other is how people stop
   * trusting the readout.
   */
  const reportCheckDrift = useCallback(
    (draft: PromptDraft, stored: PromptVersion | undefined) => {
      if (!stored) return;
      const predicted = new Map(draft.invariants.map((i) => [i.id, i.satisfied]));
      const surprises = stored.invariants.filter((i) => predicted.get(i.id) === true && !i.satisfied);
      if (surprises.length > 0) {
        toast(
          `The registry recorded ${surprises.map((s) => s.label).join(', ')} as unmet — the editor's live check disagreed.`,
          'warning',
        );
      }
    },
    [toast],
  );

  const saveDraft = useCallback(
    async (prompt: PromptDescriptor, state: EditorState, draft: PromptDraft) => {
      setSaving(true);
      try {
        const now = new Date().toISOString();
        let next: PromptDescriptor;
        if (state.mode === 'edit') {
          next = port.updateVersion
            ? await port.updateVersion(prompt.key, state.baseVersionId, draft)
            : localUpdate(prompt, state.baseVersionId, draft);
          reportCheckDrift(draft, next.versions.find((v) => v.id === state.baseVersionId));
        } else {
          next = port.createVersion
            ? await port.createVersion(prompt.key, draft)
            : localCreate(prompt, draft, now);
          reportCheckDrift(
            draft,
            [...next.versions].sort((a, b) => b.version - a.version)[0],
          );
        }
        applyDescriptor(next);
        closeEditor();
        const stillBroken = brokenChecks(activeVersion(next)).length;
        toast(
          stillBroken > 0
            ? `Saved. ${prompt.label} is now running on a version that drops ${stillBroken} guardrail${stillBroken > 1 ? 's' : ''}.`
            : `Saved. ${prompt.label} keeps every declared guardrail.`,
          stillBroken > 0 ? 'critical' : 'good',
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not save this version.', 'critical');
      } finally {
        setSaving(false);
      }
    },
    [applyDescriptor, closeEditor, port, reportCheckDrift, toast],
  );

  const activate = useCallback(
    async (prompt: PromptDescriptor, versionId: string) => {
      setBusyVersionId(versionId);
      try {
        const next = port.activateVersion
          ? await port.activateVersion(prompt.key, versionId)
          : { ...prompt, activeVersionId: versionId };
        applyDescriptor(next);
        const version = next.versions.find((v) => v.id === versionId);
        const broken = brokenChecks(version).length;
        toast(
          broken > 0
            ? `v${version?.version} is now in force and drops ${broken} guardrail${broken > 1 ? 's' : ''}.`
            : `v${version?.version} is now in force.`,
          broken > 0 ? 'critical' : 'good',
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not change the active version.', 'critical');
      } finally {
        setBusyVersionId(null);
      }
    },
    [applyDescriptor, port, toast],
  );

  const remove = useCallback(
    async (prompt: PromptDescriptor, versionId: string) => {
      setBusyVersionId(versionId);
      try {
        const next = port.deleteVersion
          ? await port.deleteVersion(prompt.key, versionId)
          : { ...prompt, versions: prompt.versions.filter((v) => v.id !== versionId) };
        applyDescriptor(next);
        toast('Version deleted.', 'neutral');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not delete this version.', 'critical');
      } finally {
        setBusyVersionId(null);
      }
    },
    [applyDescriptor, port, toast],
  );

  /* ---------------------------------------------------------------- */
  /* Loading, absence, failure                                        */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!prompts) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeading />
        <Card>
          <CardBody>
            <EmptyState
              icon={<ScrollText size={24} />}
              title={loadError ? 'The prompt registry could not be read' : 'No prompt registry reported'}
              description={
                loadError
                  ? `${loadError} — nothing is shown rather than a stale roster, because a prompt list that is out of date is worse than none: it would report guardrails as intact without having checked them.`
                  : 'This build does not report the prompts the agent layer uses, so there is nothing to version here. This is not a statement that every prompt is in its shipped state — nothing was reported either way.'
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Roll-up                                                          */
  /* ---------------------------------------------------------------- */

  const compromised = prompts.filter((p) => {
    const active = activeVersion(p);
    return !active || brokenChecks(active).length > 0;
  });
  const customised = prompts.filter((p) => p.versions.length > 1);
  const declaredChecks = prompts.reduce((sum, p) => sum + (activeVersion(p)?.invariants.length ?? 0), 0);
  const headlineTone: Tone = compromised.length > 0 ? 'critical' : 'good';

  const selectedActive = selected ? activeVersion(selected) : undefined;
  const selectedBroken = brokenChecks(selectedActive);
  const editorBase: PromptVersion | undefined =
    selected && editor ? selected.versions.find((v) => v.id === editor.baseVersionId) : undefined;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeading />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Prompts" value={String(prompts.length)} sub="declared by the agent layer" />
        <Stat
          label="Customised"
          value={String(customised.length)}
          sub={customised.length === 0 ? 'all on shipped text' : 'have versions beyond the built-in'}
        />
        <Stat
          label="Running unguarded"
          value={String(compromised.length)}
          tone={headlineTone}
          sub={compromised.length === 0 ? 'every active version keeps its guardrails' : 'active version drops a guardrail'}
        />
        <Stat label="Guardrails in force" value={String(declaredChecks)} sub="checks carried by active versions" />
      </div>

      {compromised.length > 0 ? (
        <div
          className="flex items-start gap-2.5 rounded-lg bg-critical/10 p-3.5 ring-1 ring-critical/50"
          data-testid="page-unguarded-banner"
        >
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-critical" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">
              {compromised.length} prompt{compromised.length > 1 ? 's are' : ' is'} running on a version that drops a
              guardrail.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink">{UNGUARDED_CONSEQUENCE}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {compromised.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => guard(() => setSelectedKey(p.key))}
                    className="rounded-md bg-surface px-2 py-1 text-mini font-medium text-ink ring-1 ring-inset ring-critical/40 hover:bg-sunken"
                  >
                    {p.label} — {brokenChecks(activeVersion(p)).map((b) => b.label).join(', ') || 'active version missing'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-lg bg-good/10 p-3 ring-1 ring-good/35">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--status-good-text)]" />
          <p className="text-xs leading-relaxed text-ink">
            Every prompt is running on a version that satisfies all of its declared guardrails. Findings produced now
            carry the anti-fabrication guarantee the evidence ledger depends on.
          </p>
        </div>
      )}

      {persists && me && !mayEdit ? (
        <Callout tone="info" title="These prompts are read-only for you">
          One registry serves every workspace on this deployment, so a change here would rewrite the instructions
          every other workspace’s agents run under. Whoever runs the deployment makes that change.
        </Callout>
      ) : null}

      {!persists ? (
        <Callout tone="warning" title="Changes are held in this page only" collapsible>
          No prompt endpoint is available in this build, so versions created here live in the browser tab and vanish on
          reload. Guardrail results shown for them are this page's own evaluation, not a registry's.
        </Callout>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <Card className="flex max-h-[calc(100vh-9rem)] min-h-[18rem] flex-col overflow-hidden">
          <PromptList
            prompts={prompts}
            selectedKey={selectedKey}
            onSelect={(key) => guard(() => {
              setSelectedKey(key);
              setEditor(null);
              setTab('versions');
            })}
          />
        </Card>

        {!selected ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<BookOpen size={22} />}
                title="Select a prompt"
                description="Every prompt the agent layer uses is on the left, grouped by the agent that runs it."
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-baseline gap-2">
                  {selected.label}
                  <Badge tone={selected.role === 'grounding' ? 'brand' : 'neutral'} title={ROLE_HINT[selected.role]}>
                    {ROLE_LABEL[selected.role]}
                  </Badge>
                  {selectedBroken.length > 0 ? (
                    <Badge tone="critical" icon={<ShieldAlert size={11} />}>
                      Unguarded
                    </Badge>
                  ) : null}
                </span>
              }
              subtitle={
                <span className="block">
                  <span className="font-mono text-micro text-ink-muted">{selected.key}</span> · {selected.description}
                </span>
              }
              icon={<ScrollText size={16} />}
              action={
                mayEdit ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus size={13} />}
                    data-testid="new-version"
                    onClick={() =>
                      guard(() => {
                        const base = activeVersion(selected) ?? builtInVersion(selected) ?? selected.versions[0];
                        if (base) setEditor({ mode: 'new', baseVersionId: base.id });
                      })
                    }
                  >
                    New version
                  </Button>
                ) : null
              }
            />
            <CardBody className="flex flex-col gap-3">
              {selectedBroken.length > 0 ? (
                <div className="rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/50" data-testid="prompt-unguarded">
                  <p className="flex items-start gap-1.5 text-[13px] font-semibold text-ink">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-critical" />
                    The version in force drops: {selectedBroken.map((b) => b.label).join(', ')}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {selectedBroken.map((b) => (
                      <li key={b.id} className="text-mini leading-relaxed text-ink-secondary">
                        <span className="font-medium text-ink">{b.label}</span> — {b.rationale}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs leading-relaxed text-ink">{UNGUARDED_CONSEQUENCE}</p>
                </div>
              ) : null}

              {editor && editorBase ? (
                <PromptEditor
                  key={`${selected.key}:${editor.mode}:${editor.baseVersionId}`}
                  prompt={selected}
                  base={editorBase}
                  mode={editor.mode}
                  saving={saving}
                  onDirtyChange={setDirty}
                  onConvertToNewVersion={() => setEditor({ mode: 'new', baseVersionId: editor.baseVersionId })}
                  onCancel={() => guard(closeEditor)}
                  onSave={(draft) => void saveDraft(selected, editor, draft)}
                />
              ) : (
                <>
                  <Tabs
                    active={tab}
                    onChange={(key) => setTab(key as DetailTab)}
                    tabs={[
                      { key: 'versions', label: 'Versions', icon: <History size={13} />, badge: <Badge tone="neutral">{selected.versions.length}</Badge> },
                      { key: 'diff', label: 'Compare', icon: <FileDiff size={13} /> },
                      { key: 'text', label: 'Text', icon: <ScrollText size={13} /> },
                    ]}
                  />

                  {tab === 'versions' ? (
                    <VersionHistory
                      highlightVersionId={highlightVersionId}
                      prompt={selected}
                      busyVersionId={busyVersionId}
                      readOnly={!mayEdit}
                      onActivate={(versionId) => void activate(selected, versionId)}
                      onDelete={(versionId) => void remove(selected, versionId)}
                      onEdit={(versionId) => guard(() => setEditor({ mode: 'edit', baseVersionId: versionId }))}
                      onNewVersionFrom={(versionId) => guard(() => setEditor({ mode: 'new', baseVersionId: versionId }))}
                    />
                  ) : tab === 'diff' ? (
                    <PromptDiff key={selected.key} prompt={selected} />
                  ) : (
                    <PromptText prompt={selected} />
                  )}
                </>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <p className="flex items-start gap-2 text-mini leading-relaxed text-ink-muted">
        <Sparkles size={12} className="mt-0.5 shrink-0" />
        Guardrails shown against a stored version are the results recorded with that version. The editor's live check
        is an independent, coarser reading of the same rules — where the two disagree, the recorded result is the one
        that marks the runs.
      </p>

      <Modal
        open={pendingNavigation !== null}
        onClose={() => setPendingNavigation(null)}
        title="Discard unsaved prompt text?"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingNavigation(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              data-testid="discard-changes"
              onClick={() => {
                const action = pendingNavigation;
                setPendingNavigation(null);
                setDirty(false);
                setEditor(null);
                action?.();
              }}
            >
              Discard changes
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink">
          The version you are editing has not been saved. Leaving this editor loses the text you have typed — there is
          no draft kept for you.
        </p>
      </Modal>
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">AI instructions</h1>
      <p className="mt-0.5 text-sm text-ink-secondary">
        Every prompt the agent layer runs, every version of it, and which text is in force. Editing is allowed; editing
        invisibly is not.
      </p>
    </div>
  );
}

/**
 * The full text of one version, read-only, with line numbers.
 *
 * Prompts run to sixty lines and more, and someone reviewing a change needs to
 * read the thing rather than a summary of it. Line numbers make a review
 * comment ("line 31 is the problem") possible without a diff.
 */
function PromptText({ prompt }: { prompt: PromptDescriptor }) {
  const versions = versionsNewestFirst(prompt);
  const [versionId, setVersionId] = useState(prompt.activeVersionId);
  const version = prompt.versions.find((v) => v.id === versionId) ?? versions[0];
  if (!version) return <p className="text-xs text-ink-muted">This prompt has no versions to show.</p>;

  const lines = version.content.split('\n');
  const broken = brokenChecks(version);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={version.id}
          onChange={(e) => setVersionId(e.target.value)}
          aria-label="Version to read"
          className="h-8 w-[18rem] text-xs"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} — {v.label}
              {v.id === prompt.activeVersionId ? ' (active)' : ''}
              {v.builtIn ? ' (built-in)' : ''}
            </option>
          ))}
        </Select>
        <span className="tabular text-mini text-ink-muted">
          {lines.length} lines · {version.content.length} characters
        </span>
        {broken.length > 0 ? (
          <Badge tone="critical" icon={<ShieldAlert size={11} />}>
            drops {broken.map((b) => b.id).join(', ')}
          </Badge>
        ) : (
          <Badge tone="good">all guardrails kept</Badge>
        )}
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]">
        <table className="w-full border-collapse font-mono text-mini leading-[1.6]">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td
                  className={cn(
                    'w-10 select-none border-r border-hairline px-1.5 text-right align-top text-micro text-ink-muted',
                  )}
                >
                  {index + 1}
                </td>
                <td className="whitespace-pre-wrap break-words px-2 align-top text-ink">{line === '' ? ' ' : line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
