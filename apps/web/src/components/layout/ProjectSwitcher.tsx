import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, FolderTree, Plus } from 'lucide-react';
import { LIFECYCLE_STAGE_LABEL, PROJECT_HEALTH_LABEL, type ProjectHealth, type ProjectSummary } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Dot, cn, type Tone } from '../ui/kit';

const PROJECT_TABS = new Set(['cockpit', 'assets', 'dd', 'evidence', 'findings', 'risks', 'decisions', 'reports', 'valuation', 'graph', 'ai']);

export function projectSwitchPath(pathname: string, nextId: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const tab = parts[0] === 'projects' && parts[1] && parts[2] ? parts[2] : undefined;
  if (tab && PROJECT_TABS.has(tab)) return `/projects/${nextId}/${tab}`;
  return `/projects/${nextId}`;
}

function healthTone(health: ProjectHealth): Tone {
  if (health === 'green') return 'good';
  if (health === 'amber') return 'warning';
  if (health === 'red') return 'critical';
  return 'neutral';
}

function currentProjectId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1] || parts[1] === 'new') return null;
  return parts[1];
}

export default function ProjectSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data, loading, refresh } = useAsync(() => api.listProjects(), []);
  const projectId = currentProjectId(location.pathname);
  const list = data ?? [];
  const current = list.find((p) => p.id === projectId);

  useEffect(() => {
    void refresh();
  }, [projectId, refresh]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, refresh]);

  function go(project: ProjectSummary) {
    setOpen(false);
    if (project.id === projectId) return;
    navigate(projectSwitchPath(location.pathname, project.id));
  }

  const creating = location.pathname.startsWith('/projects/new');
  const label = current
    ? current.name
    : creating
      ? 'New project'
      : 'All projects';
  const reference = current?.reference;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch project"
        className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-sunken"
      >
        <FolderTree size={15} className="shrink-0 text-ink-muted" />
        <span className="min-w-0">
          {reference ? (
            <span className="block font-mono text-[10px] leading-none text-ink-muted">{reference}</span>
          ) : null}
          <span className="block truncate text-[14px] font-semibold tracking-tight text-ink">{label}</span>
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Projects"
          className="absolute left-0 top-full z-40 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-hairline bg-surface shadow-pop"
        >
          <div className="max-h-80 overflow-y-auto py-1">
            {loading && list.length === 0 ? (
              <p className="px-3 py-2 text-[13px] text-ink-muted">Loading projects…</p>
            ) : null}
            {list.length === 0 && !loading ? (
              <p className="px-3 py-2 text-[13px] text-ink-muted">No projects yet.</p>
            ) : null}
            {list.map((p) => {
              const selected = p.id === projectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => go(p)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-sunken',
                    selected && 'bg-brand-soft/60',
                  )}
                >
                  <Check size={14} className={cn('mt-0.5 shrink-0', selected ? 'text-brand' : 'text-transparent')} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">{p.name}</span>
                      <Badge tone={healthTone(p.health)}>{PROJECT_HEALTH_LABEL[p.health]}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-muted">
                      {p.reference} · {LIFECYCLE_STAGE_LABEL[p.currentStage]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-hairline p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/projects/new');
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-sunken"
            >
              <Plus size={14} className="text-ink-muted" />
              New project
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/projects');
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-sunken"
            >
              <FolderTree size={14} className="text-ink-muted" />
              All projects
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
