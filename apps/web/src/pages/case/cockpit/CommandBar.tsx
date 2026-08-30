import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  DD_DOMAIN_KEYS,
  DD_DOMAIN_PROFILES,
  technicalDocumentChecklist,
  TECHNICAL_SYSTEM_LABEL,
} from '@realytica/shared';
import type { DdDomain, PropertyCase } from '@realytica/shared';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/kit';

/**
 * The command bar — the acting half of the authorship law, given a door of
 * its own.
 *
 * A command needs no history, so it gets a bar; a question does, so it keeps
 * the chat column. Both speak the same vocabulary: every command here has a
 * counterpart in the copilot's command tools, deliberately, so that saying it
 * and typing it do the same thing to the case. Nothing in here can create a
 * finding or author a conclusion — those go through propose-and-review, as
 * they do everywhere else.
 *
 * Matching is plain substring over a list built from THIS case, so a command
 * can never name a checklist item, risk or department the case does not have.
 */
type Command =
  | { kind: 'go'; id: string; label: string; hint: string; domain: DdDomain }
  | { kind: 'mark'; id: string; label: string; hint: string; itemId: string; provided: boolean }
  | { kind: 'risk'; id: string; label: string; hint: string; riskId: string; status: 'open' | 'mitigated' | 'accepted' }
  | { kind: 'action'; id: string; label: string; hint: string; actionId: string; done: boolean }
  | { kind: 'finding'; id: string; label: string; hint: string; findingId: string; reviewState: 'accepted' | 'rejected' }
  | { kind: 'ask'; id: string; label: string; hint: string };

export function CommandBar({
  open,
  caseData,
  onClose,
  onGo,
  onAsk,
  onChanged,
}: {
  open: boolean;
  caseData: PropertyCase;
  onClose: () => void;
  onGo: (domain: DdDomain) => void;
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
      // Focus after paint, or the bar opens with the caret still in the page.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const out: Command[] = [];
    for (const domain of DD_DOMAIN_KEYS) {
      out.push({
        kind: 'go',
        id: `go:${domain}`,
        label: `Open ${DD_DOMAIN_PROFILES[domain].label}`,
        hint: 'Go',
        domain,
      });
    }
    const provided = caseData.technicalDocumentsProvided ?? {};
    for (const phase of ['built', 'proposed'] as const) {
      for (const item of technicalDocumentChecklist(phase)) {
        const isProvided = Boolean(provided[item.id]);
        out.push({
          kind: 'mark',
          id: `mark:${item.id}`,
          label: `${isProvided ? 'Un-mark' : 'Mark'} ${item.label} ${isProvided ? 'not received' : 'received'}`,
          hint: TECHNICAL_SYSTEM_LABEL[item.system],
          itemId: item.id,
          provided: !isProvided,
        });
      }
    }
    /*
     * The bar's vocabulary was a strict subset of the copilot's, and the
     * missing half was the half that closes work: an action could be ticked
     * off and a drafted finding accepted by ASKING for it in chat, but not by
     * typing it here. Both surfaces are the person acting, so both should
     * offer the same verbs — the design note above already says they speak
     * one vocabulary, and it was only half true.
     */
    for (const risk of caseData.result?.risks ?? []) {
      if (risk.status === 'open') {
        out.push({ kind: 'risk', id: `risk:mit:${risk.id}`, label: `Mark "${risk.title}" mitigated`, hint: 'Risk', riskId: risk.id, status: 'mitigated' });
        out.push({ kind: 'risk', id: `risk:acc:${risk.id}`, label: `Accept "${risk.title}" as a known risk`, hint: 'Risk', riskId: risk.id, status: 'accepted' });
      } else {
        // Reopening matters more than it looks: a risk closed in error is
        // otherwise only reachable by asking chat to undo it.
        out.push({ kind: 'risk', id: `risk:open:${risk.id}`, label: `Reopen "${risk.title}"`, hint: 'Risk', riskId: risk.id, status: 'open' });
      }
    }
    for (const action of caseData.result?.actions ?? []) {
      out.push({
        kind: 'action',
        id: `action:${action.id}`,
        label: action.done ? `Reopen "${action.title}"` : `Mark "${action.title}" done`,
        hint: `${action.priority.replace(/_/g, ' ')} · ${action.owner}`,
        actionId: action.id,
        done: !action.done,
      });
    }
    for (const finding of caseData.technicalFindings ?? []) {
      // Only a DRAFTED finding: accepting is what turns a model's claim into
      // part of the case, and re-deciding a settled one is a different act
      // that belongs on the finding itself, with its history in view.
      if (finding.reviewState !== 'proposed') continue;
      out.push({ kind: 'finding', id: `find:acc:${finding.id}`, label: `Accept "${finding.observation}"`, hint: 'Drafted finding', findingId: finding.id, reviewState: 'accepted' });
      out.push({ kind: 'finding', id: `find:rej:${finding.id}`, label: `Reject "${finding.observation}"`, hint: 'Drafted finding', findingId: finding.id, reviewState: 'rejected' });
    }
    return out;
  }, [caseData]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q.length === 0 ? commands.slice(0, 7) : commands.filter(c => c.label.toLowerCase().includes(q)).slice(0, 7);
    // A free-text query the command list cannot satisfy is a question, so the
    // bar offers to hand it to the chat rather than refusing it.
    if (q.length > 0) {
      found.push({ kind: 'ask', id: 'ask', label: `Ask the copilot: “${query.trim()}”`, hint: 'Ask' });
    }
    return found;
  }, [commands, query]);

  useEffect(() => {
    setActive(a => Math.min(a, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  async function run(command: Command): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (command.kind === 'go') {
        onGo(command.domain);
        onClose();
      } else if (command.kind === 'ask') {
        onAsk(query.trim());
        onClose();
      } else if (command.kind === 'mark') {
        await api.setTechnicalDocumentProvided(caseData.id, command.itemId, command.provided);
        await onChanged();
        toast(command.label, 'good');
        onClose();
      } else if (command.kind === 'action') {
        await api.setActionDone(caseData.id, command.actionId, command.done);
        await onChanged();
        toast(command.label, 'good');
        onClose();
      } else if (command.kind === 'finding') {
        await api.reviewTechnicalFinding(caseData.id, command.findingId, command.reviewState);
        await onChanged();
        toast(command.label, 'good');
        onClose();
      } else {
        await api.setRiskStatus(caseData.id, command.riskId, command.status);
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(11,11,11,0.28)] px-4 pt-[16vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-[var(--axis)]"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          <Search size={15} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(a => Math.min(matches.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(a => Math.max(0, a - 1));
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
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12.5px] text-ink-muted">Nothing on this case matches that.</li>
          ) : (
            matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void run(c)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                    i === active ? 'bg-brand-soft' : ''
                  }`}
                >
                  <span
                    className={`text-micro font-semibold uppercase tracking-[0.05em] ${
                      c.kind === 'go' || c.kind === 'ask' ? 'text-ink-muted' : 'text-brand'
                    }`}
                  >
                    {c.kind === 'go' ? 'Go' : c.kind === 'ask' ? 'Ask' : 'Do'}
                  </span>
                  <span className="min-w-0 flex-grow truncate text-[12.5px] text-ink">{c.label}</span>
                  <span className="shrink-0 text-micro text-ink-muted">{c.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
