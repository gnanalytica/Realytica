import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { DdProject, ProjectCockpitPane } from '@realytica/shared';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/kit';

type Command =
  | { kind: 'go'; id: string; label: string; hint: string; pane: ProjectCockpitPane }
  | { kind: 'do'; id: string; label: string; hint: string; run: () => Promise<void> }
  | { kind: 'ask'; id: string; label: string; hint: string };

const GO: Array<{ pane: ProjectCockpitPane; label: string; hint: string }> = [
  { pane: 'overview', label: 'Open overview', hint: 'Go' },
  { pane: 'assets', label: 'Open assets', hint: 'Go' },
  { pane: 'dd', label: 'Open assessments', hint: 'Go' },
  { pane: 'evidence', label: 'Open evidence', hint: 'Go' },
  { pane: 'visits', label: 'Open site record', hint: 'Go' },
  { pane: 'findings', label: 'Open findings', hint: 'Go' },
  { pane: 'risks', label: 'Open risks & actions', hint: 'Go' },
  { pane: 'decisions', label: 'Open decisions', hint: 'Go' },
  { pane: 'reports', label: 'Open reports', hint: 'Go' },
  { pane: 'graph', label: 'Open knowledge graph', hint: 'Go' },
  { pane: 'valuation', label: 'Open valuation', hint: 'Go' },
  { pane: 'orchestrate', label: 'Open orchestrator', hint: 'Go' },
  { pane: 'drafts', label: 'Open AI drafts', hint: 'Go' },
];

export function ProjectCommandBar({
  open,
  project,
  onClose,
  onGo,
  onAsk,
  onChanged,
}: {
  open: boolean;
  project: DdProject;
  onClose: () => void;
  onGo: (pane: ProjectCockpitPane) => void;
  onAsk: (text: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const out: Command[] = GO.map((g) => ({
      kind: 'go',
      id: `go:${g.pane}`,
      label: g.label,
      hint: g.hint,
      pane: g.pane,
    }));
    out.push({
      kind: 'do',
      id: 'do:orchestrate',
      label: 'Run orchestrator (propose drafts from registers)',
      hint: 'Do',
      run: async () => {
        await api.orchestrateProject(project.id);
      },
    });
    out.push({
      kind: 'do',
      id: 'do:drafts',
      label: 'Propose AI drafts from registers',
      hint: 'Do',
      run: async () => {
        await api.proposeAiDrafts(project.id);
      },
    });
    out.push({
      kind: 'do',
      id: 'do:screen',
      label: 'Run property screen (write findings, risks, valuation)',
      hint: 'Do',
      run: async () => {
        await api.runProjectScreen(project.id);
      },
    });
    out.push({
      kind: 'do',
      id: 'do:valuation',
      label: 'Run indicative valuation',
      hint: 'Do',
      run: async () => {
        await api.runValuation(project.id);
      },
    });
    for (const action of project.actions.filter((a) => a.status !== 'closed').slice(0, 8)) {
      out.push({
        kind: 'do',
        id: `do:action:${action.id}`,
        label: `Close action “${action.title}”`,
        hint: 'Do',
        run: async () => {
          await api.patchAction(project.id, action.id, 'closed');
        },
      });
    }
    for (const risk of project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted').slice(0, 6)) {
      out.push({
        kind: 'do',
        id: `do:risk:${risk.id}`,
        label: `Mark risk “${risk.title}” mitigated`,
        hint: 'Do',
        run: async () => {
          await api.patchRisk(project.id, risk.id, 'mitigated');
        },
      });
    }
    return out;
  }, [project]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = (q.length === 0 ? commands.slice(0, 8) : commands.filter((c) => c.label.toLowerCase().includes(q))).slice(0, 8);
    if (q.length > 0) {
      found.push({ kind: 'ask', id: 'ask', label: `Ask: “${query.trim()}”`, hint: 'Ask' });
    }
    return found;
  }, [commands, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  async function run(command: Command): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (command.kind === 'go') {
        onGo(command.pane);
        onClose();
      } else if (command.kind === 'ask') {
        onAsk(query.trim());
        onClose();
      } else {
        await command.run();
        await onChanged();
        toast(command.label, 'good');
        onClose();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That command did not go through.', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(11,11,11,0.28)] px-3 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-4 sm:pt-[16vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project command bar"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-[var(--axis)] max-h-[min(32rem,85dvh)] flex flex-col"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          <Search size={15} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(matches.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && matches[active]) {
                e.preventDefault();
                void run(matches[active]);
              }
            }}
            placeholder="Run a command, or ask…"
            aria-label="Run a command"
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12.5px] text-ink-muted">Nothing on this project matches that.</li>
          ) : (
            matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void run(c)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left coarse:min-h-11 ${
                    i === active ? 'bg-brand-soft' : ''
                  }`}
                >
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-[0.05em] ${
                      c.kind === 'do' ? 'text-brand' : 'text-ink-muted'
                    }`}
                  >
                    {c.kind === 'go' ? 'Go' : c.kind === 'ask' ? 'Ask' : 'Do'}
                  </span>
                  <span className="min-w-0 flex-grow truncate text-[12.5px] text-ink">{c.label}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-muted">{c.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
