import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REVIEW_QUESTION_MAX, plural, reviewPapers, sameEmail, type EvidenceRecord } from '@realytica/shared';
import { api } from '../../lib/api';
import { reviewAddress, reviewApi, type SavedReviewItem } from '../../lib/review-api';
import { useAsync } from '../../lib/useAsync';
import { useRoster } from '../../lib/useRoster';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Modal, Select, SubmitButton, Textarea, useToast } from '../ui/kit';
import { PlaybookEditor, type PlaybookDraft } from './PlaybookEditor';

/**
 * The workspace's saved asks and playbooks, on its Libraries page.
 *
 * Anybody of the firm's own who may change a record saves one. The person who
 * saved it, an owner or a manager changes or removes it, and everybody else
 * runs it. The server says which of those this person is, and the buttons
 * follow. Somebody outside the firm is shown no card at all.
 */
export function ReviewLibraryCard() {
  const toast = useToast();
  const roster = useRoster();
  const [library, setLibrary] = useState<{ items: SavedReviewItem[]; mayAdd: boolean } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [ask, setAsk] = useState<{ id?: string; question: string } | null>(null);
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);
  const [running, setRunning] = useState<SavedReviewItem | null>(null);
  const [removing, setRemoving] = useState<SavedReviewItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => reviewApi.library().then(setLibrary, () => setHidden(true)), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (hidden || !library) return null;
  const who = (email: string) => roster.find((person) => sameEmail(person.email, email))?.name ?? email.split('@')[0] ?? email;

  async function act(what: () => Promise<unknown>, done: string, failed: string): Promise<boolean> {
    setBusy(true);
    try {
      await what();
      await load();
      toast(done, 'good');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : failed, 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Saved asks and playbooks"
        subtitle="Questions and checklists to run on a project’s papers."
        action={
          library.mayAdd ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setAsk({ question: '' })}>
                New ask
              </Button>
              <Button size="sm" onClick={() => setDraft({ name: '', columns: [] })}>
                New playbook
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody className="divide-y divide-hairline p-0">
        {library.items.length ? (
          library.items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[13px] font-medium text-ink">{item.kind === 'playbook' ? item.name : item.question}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {item.kind === 'playbook' ? `${item.paper ?? 'Any paper'}, ${plural(item.columns.length, 'column')}` : 'Saved ask'}, by {who(item.by)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {library.mayAdd ? (
                  <Button size="sm" onClick={() => setRunning(item)}>
                    Run on…
                  </Button>
                ) : null}
                {item.mayChange ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        item.kind === 'ask' ? setAsk({ id: item.id, question: item.question }) : setDraft({ id: item.id, name: item.name, ...(item.paper ? { paper: item.paper } : {}), columns: item.columns })
                      }
                    >
                      Change
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(item)}>
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="Nothing saved yet" description="A saved ask is one question. A playbook is a set of columns for a kind of paper." className="py-8" />
        )}
      </CardBody>

      {ask ? (
        <Modal
          open
          onClose={() => setAsk(null)}
          title={ask.id ? 'Change saved ask' : 'New ask'}
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <SubmitButton
                needs={ask.question.trim().length >= 3 ? [] : ['A question']}
                busy={busy}
                onClick={() => {
                  const input = { kind: 'ask' as const, question: ask.question };
                  void act(() => (ask.id ? reviewApi.change(ask.id, input) : reviewApi.save(input)), ask.id ? 'Saved ask changed' : 'Question saved to the library', 'The question could not be saved').then((ok) => ok && setAsk(null));
                }}
              >
                {ask.id ? 'Save changes' : 'Save ask'}
              </SubmitButton>
            </>
          }
        >
          <Field label="A question">
            <Textarea value={ask.question} onChange={(e) => setAsk({ ...ask, question: e.target.value })} placeholder="Is there a right of way?" maxLength={REVIEW_QUESTION_MAX} data-autofocus />
          </Field>
        </Modal>
      ) : null}

      {draft ? (
        <PlaybookEditor
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void load();
          }}
        />
      ) : null}

      {removing ? (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title={removing.kind === 'playbook' ? 'Remove playbook' : 'Remove saved ask'}
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)} data-autofocus>
                Keep it
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void act(() => reviewApi.remove(removing.id), 'Removed from the library', 'It could not be removed').then((ok) => ok && setRemoving(null))}>
                Remove
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink">{removing.kind === 'playbook' ? removing.name : removing.question}</p>
          <p className="mt-1 text-[12px] text-ink-muted">Tables it was already run on keep their columns and answers.</p>
        </Modal>
      ) : null}

      {running ? <RunOn item={running} onClose={() => setRunning(null)} /> : null}
    </Card>
  );
}

/** Where to run a saved thing: a project, and all its papers of the kind or one of them. */
function RunOn({ item, onClose }: { item: SavedReviewItem; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: projects } = useAsync(() => api.listProjects(), []);
  const [projectId, setProjectId] = useState('');
  const [papers, setPapers] = useState<EvidenceRecord[]>([]);
  const [evidenceId, setEvidenceId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPapers([]);
    setEvidenceId('');
    if (!projectId) return;
    let live = true;
    void api.getProject(projectId).then(
      (project) => live && setPapers(reviewPapers(project)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [projectId]);

  async function run() {
    setBusy(true);
    try {
      const out = await reviewApi.runSaved(projectId, item.id, evidenceId || undefined);
      navigate(reviewAddress(projectId, out.show));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'It could not be run', 'critical');
      setBusy(false);
    }
  }

  const every = item.kind === 'playbook' && item.paper ? `Every paper of the kind: ${item.paper}` : 'Every paper';
  return (
    <Modal
      open
      onClose={onClose}
      title={`Run ${item.kind === 'playbook' ? item.name : 'saved ask'}`}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton needs={projectId ? [] : ['Project']} busy={busy} onClick={() => void run()}>
            Open the table
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project</option>
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Papers">
          <Select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} disabled={!projectId}>
            <option value="">{every}</option>
            {papers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
