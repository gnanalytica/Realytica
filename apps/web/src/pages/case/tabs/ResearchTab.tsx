import { useState } from 'react';
import { AlertTriangle, ExternalLink, Globe, Lock, Search, ShieldQuestion } from 'lucide-react';
import type { DisclosureLevel, DiscoveryFinding, DiscoveryRecordKind, RiskSeverity } from '@realytica/shared';
import { DISCLOSURE_LEVELS, DISCOVERY_PLAN, resolveDisclosure } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { DisclosureCard } from '../../../components/DisclosureCard';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Tile, useToast } from '../../../components/ui/kit';
import { api } from '../../../lib/api';
import { date, relativeTime } from '../../../lib/format';

/**
 * What Realytica has looked for outside itself, and what it is allowed to.
 *
 * The two belong on one page because they are one decision. A reader looking
 * at an empty findings list needs to know whether that means nothing was
 * found or nothing was looked for — and at the default disclosure level the
 * answer is the second.
 *
 * The page is built around a three-way distinction an ordinary results list
 * collapses: found, searched-and-absent, and never-searched. Only the middle
 * one is evidence of absence, and it is the only one rendered as reassurance.
 */

const KIND_LABEL: Record<DiscoveryRecordKind, string> = Object.fromEntries(
  DISCOVERY_PLAN.map((p) => [p.kind, p.label]),
) as Record<DiscoveryRecordKind, string>;
KIND_LABEL.other = 'Other';

const MATERIALITY_TONE: Record<RiskSeverity, 'critical' | 'serious' | 'warning' | 'neutral'> = {
  critical: 'critical',
  serious: 'serious',
  warning: 'warning',
  info: 'neutral',
};

/**
 * How sure we are that a record is about THIS property — the number this
 * whole feature turns on, and the one that leads every finding card.
 *
 * A search for "Survey No. 42, Sarjapur" returns records about every other
 * Survey No. 42 in Karnataka. A high-quality court listing about a different
 * parcel is a reliable record at 10% identity, and showing it without that
 * number would fabricate an encumbrance.
 */
function identityBand(confidence: number): { label: string; tone: 'good' | 'warning' | 'critical' } {
  if (confidence >= 0.8) return { label: 'Almost certainly this property', tone: 'good' };
  if (confidence >= 0.5) return { label: 'Probably this property — verify', tone: 'warning' };
  return { label: 'May be a different property', tone: 'critical' };
}

function FindingCard({ finding }: { finding: DiscoveryFinding }) {
  const band = identityBand(finding.identityConfidence);
  return (
    <Tile tone={band.tone} rail className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={MATERIALITY_TONE[finding.materiality]}>{finding.materiality}</Badge>
        <span className="text-[12px] font-medium text-ink-secondary">{KIND_LABEL[finding.kind] ?? finding.kind}</span>
        <Badge tone={band.tone} className="ml-auto">
          {Math.round(finding.identityConfidence * 100)}% · {band.label}
        </Badge>
      </div>
      <p className="mt-2 text-[13.5px] font-medium leading-snug text-ink">{finding.claim}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{finding.bearing}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
        <span className="font-medium">Matched on:</span> {finding.matchedOn}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-2 text-[11.5px] text-ink-muted">
        {finding.sourceUrl ? (
          <a
            href={finding.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-brand hover:underline"
          >
            <ExternalLink size={11} /> {finding.sourceTitle ?? 'Source'}
          </a>
        ) : (
          <span>{finding.sourceTitle ?? 'No source URL returned'}</span>
        )}
        <span>{finding.corroboration.replace(/_/g, ' ')}</span>
        {finding.publishedAt && <span>published {date(finding.publishedAt)}</span>}
        <span>found at {finding.foundAtDisclosure.replace(/_/g, ' ')}</span>
      </div>
    </Tile>
  );
}

export default function ResearchTab({ caseData, refresh }: TabProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const level = resolveDisclosure(caseData.disclosure);
  const sweep = caseData.discovery;

  const setDisclosure = async (next: DisclosureLevel) => {
    setBusy(true);
    try {
      await api.setDisclosure(caseData.id, next);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runSweep = async () => {
    setSweeping(true);
    try {
      await api.discoverProperty(caseData.id);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The sweep could not be run.', 'critical');
    } finally {
      setSweeping(false);
    }
  };

  const sorted = [...(sweep?.findings ?? [])].sort((a, b) => b.identityConfidence - a.identityConfidence);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <DisclosureCard level={caseData.disclosure} onChange={setDisclosure} busy={busy} />

      <Card>
        <CardHeader
          title="What has been found"
          subtitle={sweep ? `Swept ${relativeTime(sweep.ranAt)} at ${DISCLOSURE_LEVELS[sweep.disclosure].label.toLowerCase()}` : 'Public records and reporting about this property'}
          icon={<Globe size={16} />}
          action={
            <Button variant="primary" size="sm" icon={<Search size={13} />} loading={sweeping} onClick={() => void runSweep()}>
              {sweep ? 'Sweep again' : 'Run a sweep'}
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-4">
          {!sweep && (
            <EmptyState
              icon={<Search size={26} />}
              title="Nothing has been searched for yet"
              description={
                level === 'locality_only'
                  ? `At ${DISCLOSURE_LEVELS[level].label.toLowerCase()}, nothing identifying this parcel leaves Realytica — so a sweep cannot find its RERA registration, a de-notification naming its survey number, or a case listing it. Widen the level above first if you want those looked for.`
                  : `The level is set to ${DISCLOSURE_LEVELS[level].label.toLowerCase()}, so a sweep can look for this parcel by its identifiers.`
              }
            />
          )}

          {sweep?.planOnlyReason && (
            <Callout tone="warning" title="Planned, not run">
              {sweep.planOnlyReason}
            </Callout>
          )}

          {sweep && sorted.length > 0 && (
            <div className="flex flex-col gap-3">
              {sorted.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}

          {sweep && !sweep.planOnlyReason && sorted.length === 0 && (
            <Callout tone="good" title="Nothing found in what was searched">
              The searches below ran and returned nothing about this property. That is a real result — but read it
              alongside what was not searched for.
            </Callout>
          )}

          {sweep && sweep.lookedForNotFound.length > 0 && (
            <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-[var(--ring)]">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Searched for and not found
              </p>
              <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
                {sweep.lookedForNotFound.map((k) => KIND_LABEL[k] ?? k).join(', ')}. This is the only kind of absence on
                this page that is evidence of anything.
              </p>
            </div>
          )}

          {sweep && sweep.notLookedFor.length > 0 && (
            <div className="rounded-lg bg-warning/10 p-3 ring-1 ring-warning/35">
              <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <Lock size={12} /> Not searched for — the disclosure level forbids it
              </p>
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                {sweep.notLookedFor.map((gate) => (
                  <li key={gate.kind} className="text-[12.5px] leading-relaxed text-ink-secondary">
                    <span className="font-medium text-ink">{KIND_LABEL[gate.kind] ?? gate.kind}</span> — needs{' '}
                    {DISCLOSURE_LEVELS[gate.needs].label.toLowerCase()}. {gate.consequence}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sweep && sweep.unreachable.length > 0 && (
            <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-[var(--ring)]">
              <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <ShieldQuestion size={12} /> Registries a search cannot reach at all
              </p>
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                {sweep.unreachable.map((u) => (
                  <li key={u.label} className="text-[12.5px] leading-relaxed text-ink-secondary">
                    <span className="font-medium text-ink">{u.label}</span> — {u.whatItWouldHaveAnswered}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-2 text-[12px] leading-relaxed text-ink-muted">
                These sit behind logins and CAPTCHAs with no machine interface. Nothing on this page substitutes for
                them — the encumbrance record that would settle half of this is in the first one.
              </p>
            </div>
          )}

          {sweep && sweep.queriesRun.length > 0 && (
            <details className="rounded-lg bg-surface-2 ring-1 ring-[var(--ring)]">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-ink-secondary">
                Exactly what left the system ({sweep.queriesRun.length} {sweep.queriesRun.length === 1 ? 'query' : 'queries'})
              </summary>
              <ul className="m-0 flex list-none flex-col gap-1 border-t border-[var(--ring)] p-3">
                {sweep.queriesRun.map((q) => (
                  <li key={q} className="font-mono text-[11.5px] leading-relaxed text-ink-muted">
                    {q}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {sorted.some((f) => f.identityConfidence < 0.5) && (
            <Callout tone="warning" title="Some of these may be about a different property">
              <p className="m-0 flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  A search for a survey number returns records about every other parcel with that number in the state.
                  Anything below 50% identity confidence needs to be checked against the parcel before it changes a
                  decision — and a record about someone else&rsquo;s land is not an encumbrance on yours.
                </span>
              </p>
            </Callout>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
