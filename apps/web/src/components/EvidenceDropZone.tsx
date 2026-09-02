import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { UploadCloud } from 'lucide-react';
import { matchFilesToEvidence, type EvidenceFileMatch, type EvidenceRecord } from '@realytica/shared';
import { Badge, Button, Modal, Select, cn, useToast } from './ui/kit';
import { api } from '../lib/api';

/**
 * A diligence pack arrives as a folder, so take a folder.
 *
 * Matching is deterministic — word overlap against the visible register,
 * weighted so a rare word decides and a common one does not — which is why it
 * is allowed to fill the targets in rather than merely suggest them. What it is
 * not allowed to do is file anything silently: every file is shown against the
 * row it landed on, with a select to move it, before a byte is uploaded.
 *
 * Matching runs against `rows` — the list the person is actually looking at —
 * rather than the whole project, because a register showing one assessment's
 * gaps is the context the drop was made in.
 */
export function EvidenceDropZone({
  projectId,
  rows,
  onFiled,
  children,
}: {
  projectId: string;
  rows: EvidenceRecord[];
  onFiled: () => Promise<void> | void;
  /** Given the picker, so a button anywhere inside can open the same flow. */
  children: (pick: (files: File[]) => void) => ReactNode;
}) {
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // A dragenter fires again for every child element the pointer crosses, so the
  // highlight has to be reference-counted or it flickers off mid-drag.
  const depth = useRef(0);

  const matches: EvidenceFileMatch[] = useMemo(
    () => (dropped ? matchFilesToEvidence(rows, dropped.map((f) => f.name)) : []),
    [dropped, rows],
  );

  const open = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const seeded = matchFilesToEvidence(rows, files.map((f) => f.name));
      const next: Record<string, string> = {};
      files.forEach((f, i) => {
        next[`${i}:${f.name}`] = seeded[i]?.evidenceId ?? '';
      });
      setDropped(files);
      setTargets(next);
    },
    [rows],
  );

  const close = () => {
    setDropped(null);
    setTargets({});
  };

  async function file() {
    if (!dropped) return;
    setBusy(true);
    try {
      // One request for the whole pack. Per-row calls would each write their
      // own line into the thread, so filing a folder would bury the
      // conversation under thirty near-identical acknowledgements.
      const entries = dropped
        .map((file, i) => ({ file, evidenceId: targets[`${i}:${file.name}`] ?? '' }))
        .filter((e) => e.evidenceId);
      if (entries.length === 0) {
        toast('Nothing to file — every document is set to skip.', 'warning');
        return;
      }
      await api.fileEvidenceBatch(projectId, entries);
      await onFiled();
      close();
      const rows = new Set(entries.map((e) => e.evidenceId)).size;
      toast(
        `Filed ${entries.length} document${entries.length === 1 ? '' : 's'} against ${rows} row${rows === 1 ? '' : 's'}`,
        'good',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Those documents did not file.', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const willFile = Object.values(targets).filter(Boolean).length;

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        open([...e.dataTransfer.files]);
      }}
      className="relative"
    >
      {children(open)}

      {over ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-brand-soft/85 ring-2 ring-inset ring-brand">
          <p className="flex items-center gap-2 text-[13px] font-medium text-brand">
            <UploadCloud size={16} /> Drop to file against this register
          </p>
        </div>
      ) : null}

      <Modal
        open={Boolean(dropped)}
        onClose={close}
        title={dropped ? `File ${dropped.length} document${dropped.length === 1 ? '' : 's'}` : 'File documents'}
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={() => void file()} disabled={busy || willFile === 0}>
              {willFile === 0 ? 'Nothing selected' : `File ${willFile}`}
            </Button>
          </>
        }
      >
        <ul className="space-y-2">
          {(dropped ?? []).map((f, i) => {
            const key = `${i}:${f.name}`;
            const match = matches[i];
            return (
              <li key={key} className="rounded-lg border border-hairline p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[13px] font-medium text-ink">{f.name}</p>
                  {!match?.evidenceId ? (
                    <Badge tone="warning">No match — pick a row</Badge>
                  ) : match.ambiguousWith ? (
                    <Badge tone="warning">Two rows fit — confirm</Badge>
                  ) : (
                    <Badge tone="good">Matched</Badge>
                  )}
                </div>
                <Select
                  className="mt-2"
                  aria-label={`File ${f.name} against`}
                  value={targets[key] ?? ''}
                  onChange={(e) => setTargets((prev) => ({ ...prev, [key]: e.target.value }))}
                >
                  <option value="">Skip this document</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </Select>
                {match?.ambiguousWith ? (
                  <p className="mt-1.5 text-[11.5px] text-ink-muted">
                    Also fits “{match.ambiguousWith.title}”.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Modal>
    </div>
  );
}

/** The affordance for people who would rather click than drag. */
export function EvidenceDropButton({ onPick, className }: { onPick: (files: File[]) => void; className?: string }) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) onPick([...files]);
          e.target.value = '';
        }}
      />
      <Button className={cn(className)} icon={<UploadCloud size={14} />} onClick={() => input.current?.click()}>
        Add documents
      </Button>
    </>
  );
}
