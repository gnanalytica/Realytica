import { useEffect, useState } from 'react';
import { Download, FileWarning, Loader2, X } from 'lucide-react';
import type { CaseDocument } from '@realytica/shared';
import { DOCUMENT_KIND_LABEL } from '@realytica/shared';
import { Badge, cn } from './ui/kit';
import { api } from '../lib/api';
import { fileSize } from '../lib/format';

/**
 * Look at the document you uploaded.
 *
 * Until this existed the product could accept a sale deed, classify it,
 * extract fields from it and cite it by name in the evidence ledger — and
 * offer no way to open it. A screen that says "per EC_30Year_2025.pdf" and
 * cannot show you EC_30Year_2025.pdf is asking to be taken on faith, which is
 * the one thing this product is built not to do.
 *
 * What renders inline is decided by the server, not here: the API serves an
 * allowlisted set of formats as themselves and everything else as an opaque
 * download, because the stored MIME type came from the upload and cannot be
 * trusted as a rendering instruction. This component mirrors that list only
 * to choose which element to mount — if the two ever disagree the server
 * wins, and the viewer falls back to the download panel.
 */

/** Formats the API will serve inline. Kept in step with its own allowlist. */
const PDF = 'application/pdf';
const INLINE_IMAGE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

function inlineKind(mimeType: string): 'pdf' | 'image' | 'none' {
  const declared = mimeType.split(';')[0].trim().toLowerCase();
  if (declared === PDF) return 'pdf';
  if (INLINE_IMAGE.has(declared)) return 'image';
  return 'none';
}

export interface DocumentPreviewProps {
  caseId: string;
  doc: CaseDocument;
  onClose: () => void;
  /** Rendered beside the download button — e.g. a link back to the evidence that cited this. */
  actions?: React.ReactNode;
}

export function DocumentPreview({ caseId, doc, onClose, actions }: DocumentPreviewProps) {
  const kind = inlineKind(doc.mimeType);
  const src = api.documentFileUrl(caseId, doc.id);
  const downloadHref = api.documentFileUrl(caseId, doc.id, { download: true });

  const [state, setState] = useState<'loading' | 'ready' | 'error'>(kind === 'pdf' ? 'loading' : 'ready');
  const [errorText, setErrorText] = useState<string | null>(null);

  // Escape closes, and the page behind does not scroll while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  /*
   * Only the PDF path pays for a probe.
   *
   * An <iframe> fires `load` for an error page as readily as for a PDF, so it
   * cannot tell us whether the bytes arrived — a HEAD request is the only way
   * to turn "this document was seeded without a file" into a sentence rather
   * than a blank grey rectangle. An <img> has no such problem: it fires
   * `error` on a non-image response, so probing one would be a second round
   * trip to learn what the first will tell us anyway.
   */
  useEffect(() => {
    if (kind !== 'pdf') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(src, { method: 'HEAD' });
        if (cancelled) return;
        if (res.ok) {
          setState('ready');
          return;
        }
        // The body carries the engine's own explanation on the JSON error
        // paths; a GET is needed to read it because HEAD has no body.
        const detail = await fetch(src)
          .then((r) => r.json() as Promise<{ error?: string }>)
          .then((j) => j.error)
          .catch(() => undefined);
        setErrorText(detail ?? `The file could not be read (HTTP ${res.status}).`);
        setState('error');
      } catch (e) {
        if (cancelled) return;
        setErrorText(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, kind]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/40 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${doc.fileName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden animate-fade-in rounded-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]">
        <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-[14px] font-semibold text-ink" title={doc.fileName}>
              {doc.fileName}
            </h2>
            <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-muted">
              <Badge tone={doc.kindConfirmedByUser ? 'good' : 'neutral'}>{DOCUMENT_KIND_LABEL[doc.kind]}</Badge>
              <span>{fileSize(doc.sizeBytes)}</span>
              {doc.pages ? <span>· {doc.pages} page{doc.pages === 1 ? '' : 's'}</span> : null}
            </p>
          </div>
          {actions}
          <DownloadLink href={downloadHref} fileName={doc.fileName}>
            Download
          </DownloadLink>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className={cn('min-h-0 flex-1', kind === 'image' ? 'overflow-auto bg-sunken p-4' : 'bg-sunken')}>
          {state === 'loading' ? (
            <div className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-muted">
              <Loader2 size={15} className="animate-spin" />
              Loading {doc.fileName}…
            </div>
          ) : state === 'error' ? (
            <NoPreview
              title="This file could not be opened"
              detail={errorText ?? 'The stored file could not be read.'}
              downloadHref={downloadHref}
              fileName={doc.fileName}
            />
          ) : kind === 'pdf' ? (
            // `title` is what a screen reader announces for the frame, and
            // what the browser falls back to if the plugin is unavailable.
            <iframe src={src} title={doc.fileName} className="h-full w-full border-0" />
          ) : kind === 'image' ? (
            <img
              src={src}
              alt={doc.fileName}
              className="mx-auto max-w-full rounded-lg shadow-sm"
              onError={() => {
                setErrorText('The stored file could not be read, or is not the image its type claims.');
                setState('error');
              }}
            />
          ) : (
            <NoPreview
              title="No preview for this format"
              detail={`${doc.mimeType || 'This file type'} is not one the browser can render safely in place. The file is intact — download it to open in the application it belongs to.`}
              downloadHref={downloadHref}
              fileName={doc.fileName}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The honest empty state.
 *
 * Says which of the two things happened — the format has no in-browser
 * viewer, or the bytes could not be read — because they call for different
 * responses, and offers the download either way rather than leaving the
 * reader at a dead end.
 */
function NoPreview({
  title,
  detail,
  downloadHref,
  fileName,
}: {
  title: string;
  detail: string;
  downloadHref: string;
  fileName: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <FileWarning size={26} className="text-ink-faint" />
      <div>
        <p className="m-0 text-[13px] font-medium text-ink">{title}</p>
        <p className="m-0 mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-secondary">{detail}</p>
      </div>
      <DownloadLink href={downloadHref} fileName={fileName}>
        Download {fileName}
      </DownloadLink>
    </div>
  );
}


/**
 * The download control, as an anchor rather than a button.
 *
 * `Button` in the kit renders a `<button>`, which cannot carry `href` or
 * `download` — a click handler calling `window.open` would work but loses
 * middle-click, "save link as", and the filename the `download` attribute
 * supplies. Styled to match `Button variant="secondary" size="sm"` so it sits
 * in a row with real buttons without looking like a stray link.
 */
function DownloadLink({ href, fileName, children }: { href: string; fileName: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      download={fileName}
      className={cn(
        'inline-flex h-7 shrink-0 select-none items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium no-underline',
        'bg-surface text-ink ring-1 ring-inset ring-[var(--ring)] transition-colors hover:bg-sunken',
      )}
    >
      <Download size={13} />
      {children}
    </a>
  );
}
