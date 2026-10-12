import { useEffect, useState } from 'react';
import { DEPARTMENT_SHORT, SEVERITY_LABEL, SWEEP_KIND_LABEL, SWEEP_LIMITS, type DdProject, type SweepSource, type SweepSuggestion } from '@realytica/shared';
import { dailyReviewApi, type DailyReviewShown } from '../../lib/daily-review-api';
import { date } from '../../lib/format';
import { severityTone } from '../../pages/projects/shared';
import { AiMark, Badge, Button, Card, CardBody, Input, Why, useToast } from '../ui/kit';

/**
 * What the daily review suggested, for a person to accept or dismiss.
 *
 * Once a day a model reads the project's record against itself and proposes
 * what looks wrong. Nothing it proposes is on the project: each is listed
 * here, in the blue of what no person has accepted, with the record's own
 * lines it rests on. A lead or signer of its department accepts it, and it
 * becomes a finding or a risk, or dismisses it with a reason.
 *
 * `useDailyReview` is null until the answer is in, and stays null for
 * somebody working from a grant, who is answered as if nothing were here.
 */
function useDailyReview(projectId: string): [DailyReviewShown | null, (next: DailyReviewShown) => void] {
  const [shown, setShown] = useState<DailyReviewShown | null>(null);
  useEffect(() => {
    let live = true;
    setShown(null);
    dailyReviewApi.open(projectId).then(
      (next) => {
        if (live) setShown(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  return [shown, setShown];
}

type OpenPaper = (evidenceId: string, value?: { page?: number }) => void;

function Source({ source, onOpen }: { source: SweepSource; onOpen?: OpenPaper }) {
  const where = source.paper ? `${source.paper}${source.page ? `, page ${source.page}` : ''}` : source.on ? date(source.on) : '';
  const evidenceId = source.evidenceId;
  return (
    <li>
      {source.says}
      {where ? (
        evidenceId && onOpen ? (
          <button type="button" className="ml-1.5 text-left font-mono text-[11px] text-brand hover:underline" onClick={() => onOpen(evidenceId, source.page ? { page: source.page } : undefined)}>
            {where}
          </button>
        ) : (
          <span className="ml-1.5 font-mono text-[11px] text-ink-muted">{where}</span>
        )
      ) : null}
    </li>
  );
}

function Row({
  suggestion,
  mayDecide,
  busy,
  onAccept,
  onDismiss,
  onOpenPaper,
}: {
  suggestion: SweepSuggestion;
  mayDecide: boolean;
  busy: boolean;
  onAccept: () => void;
  onDismiss: (reason: string) => void;
  onOpenPaper?: OpenPaper;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const desk = DEPARTMENT_SHORT[suggestion.department];
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-2">
        <AiMark size="xs" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{suggestion.statement}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">
            <span>{SWEEP_KIND_LABEL[suggestion.kind]}</span>
            <span>{desk}</span>
            <span>Would be a {suggestion.as}</span>
            <span className="font-mono">{date(suggestion.raisedAt)}</span>
          </div>
          <Why label={`Why, and ${suggestion.sources.length} ${suggestion.sources.length === 1 ? 'source' : 'sources'}`}>
            <p>{suggestion.why}</p>
            {suggestion.action ? <p>Suggested: {suggestion.action}</p> : null}
            <ul className="list-disc space-y-0.5 pl-4">
              {suggestion.sources.map((source) => (
                <Source key={source.ref} source={source} onOpen={onOpenPaper} />
              ))}
            </ul>
          </Why>
        </div>
        <Badge tone={severityTone(suggestion.severity)} className="shrink-0">
          {SEVERITY_LABEL[suggestion.severity]}
        </Badge>
      </div>
      {!mayDecide ? (
        <p className="pl-6 text-[11px] text-ink-muted">For a lead or signer in {desk}</p>
      ) : dismissing ? (
        <form
          className="flex flex-wrap items-center gap-2 pl-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) onDismiss(reason.trim());
          }}
        >
          <Input aria-label="Why it is dismissed" placeholder="Why" value={reason} maxLength={SWEEP_LIMITS.reason} onChange={(e) => setReason(e.target.value)} className="min-w-0 flex-1 basis-48" autoFocus />
          <Button type="submit" size="sm" loading={busy} disabled={reason.trim().length < 3}>
            Dismiss
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDismissing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Button size="sm" variant="primary" loading={busy} onClick={onAccept}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDismissing(true)}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

/** The list, on the page of risks and actions. */
export function DailyReviewList({ project, onAccepted, onOpenPaper }: { project: DdProject; onAccepted: (next: DdProject) => void; onOpenPaper?: OpenPaper }) {
  const [shown, setShown] = useDailyReview(project.id);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (!shown) return null;

  async function decide(id: string, act: () => Promise<DailyReviewShown>) {
    setBusy(id);
    try {
      setShown(await act());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record that', 'critical');
      // What is kept may have moved under this page: another lead decided it first.
      void dailyReviewApi.open(project.id).then(setShown, () => undefined);
    } finally {
      setBusy(null);
    }
  }

  const count = shown.suggestions.length;
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-[12px] font-semibold text-ink-secondary">
        Suggested by the daily review
        <span className="font-mono font-normal tabular-nums text-ink-muted">{count}</span>
      </h2>
      {count ? (
        <Card className="ring-ai/25">
          <CardBody className="divide-y divide-hairline p-0">
            {shown.suggestions.map((suggestion) => (
              <Row
                key={suggestion.id}
                suggestion={suggestion}
                mayDecide={shown.decidesIn.includes(suggestion.department)}
                busy={busy === suggestion.id}
                onOpenPaper={onOpenPaper}
                onAccept={() =>
                  void decide(suggestion.id, async () => {
                    const answer = await dailyReviewApi.accept(project.id, suggestion.id);
                    onAccepted(answer.project);
                    toast(answer.record.type === 'risk' ? 'Added to risks' : 'Added to findings');
                    return answer;
                  })
                }
                onDismiss={(reason) =>
                  void decide(suggestion.id, async () => {
                    const answer = await dailyReviewApi.dismiss(project.id, suggestion.id, reason);
                    toast('Dismissed. It will not be raised again.');
                    return answer;
                  })
                }
              />
            ))}
          </CardBody>
        </Card>
      ) : null}
      {!shown.model ? (
        <p className="text-[12px] text-ink-muted">No model is set up, so the daily review is not running.</p>
      ) : !count ? (
        <p className="text-[12px] text-ink-muted">{shown.sweptAt ? `Nothing suggested. Last reviewed ${date(shown.sweptAt)}.` : 'Not reviewed yet. It runs once a day.'}</p>
      ) : null}
    </section>
  );
}

/** How many suggestions wait on a project, for Overview's first line. Nothing for somebody working from a grant. */
export function useDailyReviewCount(projectId: string): number {
  const [shown] = useDailyReview(projectId);
  return shown?.suggestions.length ?? 0;
}
