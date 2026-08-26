import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  CircleAlert,
  FileSignature,
  GitBranch,
  Scale,
  Sparkles,
  Unlink,
  UserRound,
} from 'lucide-react';
import type {
  ChainBreak,
  GraphContradiction,
  ResolutionPath,
  RiskSeverity,
  TitleChain,
  TitleGraphSummary,
} from '@valytica/shared';
import type { TabProps } from '../tab-props';
import { DOCUMENT_KIND_LABEL } from '../../../lib/format';
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ProgressBar,
  Stat,
  cn,
  type Tone,
} from '../../../components/ui/kit';

/**
 * The title tab: what the documents on file actually establish about ownership.
 *
 * This is the view the rest of the product builds towards. A completeness
 * checklist can say "mother deed: present"; only the graph can say the chain
 * breaks between two named parties in a named year, or that the extent being
 * conveyed grew by 222 sqm somewhere between the partition and the sale. So
 * the layout leads with the specific finding and its evidence, not with a
 * score — the score is a summary of the findings, and a user who reads only
 * the score has learned nothing they can act on.
 */

const SEVERITY_TONE: Record<RiskSeverity, Tone> = {
  info: 'neutral',
  warning: 'warning',
  serious: 'serious',
  critical: 'critical',
};

function integrityBand(score: number, criticalCount: number): { label: string; tone: Tone } {
  if (criticalCount > 0) return { label: 'Title not established', tone: 'critical' };
  if (score >= 85) return { label: 'Chain established', tone: 'good' };
  if (score >= 60) return { label: 'Chain mostly established', tone: 'warning' };
  return { label: 'Chain incomplete', tone: 'serious' };
}

function formatDate(iso?: string): string {
  if (!iso) return 'undated';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------------ */
/* Chain                                                               */
/* ------------------------------------------------------------------ */

/**
 * One conveyance, drawn as a link in a vertical chain.
 *
 * Grantor and grantee are always shown, even when one is unknown, because an
 * unknown party is the shape of the defect — collapsing the row when a name is
 * missing would hide exactly the thing worth seeing.
 */
function ChainLinkRow({ link }: { link: TitleChain['links'][number] }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken ring-1 ring-[var(--ring)]">
          <FileSignature size={13} className="text-ink-secondary" />
        </div>
        <div className="mt-1 w-px flex-1 bg-hairline" />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-ink">{link.label}</p>
          <span className={cn('tabular text-[11px]', link.at ? 'text-ink-muted' : 'text-warning')}>
            {formatDate(link.at)}
          </span>
          {link.extentSqm !== undefined && (
            <Badge tone="neutral">{link.extentSqm.toFixed(1)} sqm</Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
          <UserRound size={11} className="shrink-0 text-ink-muted" />
          <span className={link.fromPartyLabel ? '' : 'italic text-warning'}>
            {link.fromPartyLabel ?? 'grantor not identified'}
          </span>
          <ArrowDown size={11} className="shrink-0 -rotate-90 text-ink-muted" />
          <span className={link.toPartyLabel ? '' : 'italic text-warning'}>
            {link.toPartyLabel ?? 'grantee not identified'}
          </span>
        </p>
      </div>
    </div>
  );
}

/** A gap in the chain, drawn between the links it sits between. */
function ChainBreakRow({ chainBreak }: { chainBreak: ChainBreak }) {
  const tone = SEVERITY_TONE[chainBreak.severity];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
            tone === 'critical' ? 'bg-critical-soft ring-critical' : 'bg-warning-soft ring-warning',
          )}
        >
          <Unlink size={13} className={tone === 'critical' ? 'text-critical' : 'text-warning'} />
        </div>
        <div className="mt-1 w-px flex-1 border-l border-dashed border-hairline" />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{chainBreak.kind.replace(/_/g, ' ')}</Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink">{chainBreak.statement}</p>
        {chainBreak.resolvedBy.length > 0 && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
            <span className="font-semibold uppercase tracking-wide">Closes with</span>{' '}
            {chainBreak.resolvedBy.join('; ')}
          </p>
        )}
      </div>
    </div>
  );
}

function ChainCard({ chain }: { chain: TitleChain }) {
  // Breaks are anchored to the link they follow, so the sequence reads the way
  // a practitioner walks it: deed, gap, deed — rather than a list of deeds and
  // a separate list of complaints about them.
  const rows = useMemo(() => {
    const out: ReactNode[] = [];
    const leading = chain.breaks.filter((b) => !b.afterLinkId);
    for (const b of leading) out.push(<ChainBreakRow key={b.id} chainBreak={b} />);
    for (const link of chain.links) {
      out.push(<ChainLinkRow key={link.id} link={link} />);
      for (const b of chain.breaks.filter((x) => x.afterLinkId === link.id)) {
        out.push(<ChainBreakRow key={b.id} chainBreak={b} />);
      }
    }
    return out;
  }, [chain]);

  const short = chain.yearsExpected !== undefined
    && chain.yearsEstablished !== undefined
    && chain.yearsEstablished < chain.yearsExpected;

  return (
    <Card>
      <CardHeader
        title={chain.parcelLabel}
        subtitle={
          chain.yearsEstablished !== undefined
            ? `${chain.yearsEstablished} year${chain.yearsEstablished === 1 ? '' : 's'} of chain established${
                chain.yearsExpected !== undefined ? ` — ${chain.yearsExpected} expected here` : ''
              }`
            : 'No dated instrument establishes a span'
        }
        action={
          chain.breaks.length > 0 ? (
            <Badge tone="warning">{chain.breaks.length} break{chain.breaks.length === 1 ? '' : 's'}</Badge>
          ) : (
            <Badge tone="good">Continuous</Badge>
          )
        }
      />
      <CardBody>
        {short && chain.yearsExpected !== undefined && (
          <Callout tone="warning" title="Shallower than local practice expects">
            A {chain.yearsExpected}-year chain is the usual standard here. What is on file reaches back{' '}
            {chain.yearsEstablished} year{chain.yearsEstablished === 1 ? '' : 's'}, so anything before that is
            unexamined rather than clean.
          </Callout>
        )}
        <div className={cn(short && 'mt-4')}>
          {rows.length > 0 ? rows : <p className="text-xs text-ink-muted">No instruments on file for this parcel.</p>}
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Contradictions                                                      */
/* ------------------------------------------------------------------ */

/**
 * Sources that cannot both be right, shown side by side.
 *
 * The claims table is the point of this card. "Area mismatch" is a label; two
 * rows showing 2,400 sqft from the sale deed against 2,178 sqft from the khata
 * extract is the finding, and it is what a user takes to their lawyer.
 */
function ContradictionCard({ contradiction }: { contradiction: GraphContradiction }) {
  const tone = SEVERITY_TONE[contradiction.severity];
  return (
    <Card>
      <CardHeader
        title={contradiction.subject}
        subtitle={contradiction.kind.replace(/_/g, ' ')}
        action={
          <div className="flex items-center gap-2">
            {contradiction.divergence !== undefined && (
              <Badge tone={tone}>{(contradiction.divergence * 100).toFixed(1)}% apart</Badge>
            )}
            <Badge tone={tone}>{contradiction.severity}</Badge>
          </div>
        }
      />
      <CardBody>
        <p className="text-xs leading-relaxed text-ink">{contradiction.statement}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="pb-1.5 pr-3 font-semibold">Source</th>
                <th className="pb-1.5 pr-3 font-semibold">Field</th>
                <th className="pb-1.5 pr-3 font-semibold">Says</th>
                <th className="pb-1.5 font-semibold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {contradiction.claims.map((claim, i) => (
                <tr key={`${claim.sourceRef}-${claim.fieldKey}-${i}`} className="border-b border-hairline last:border-0">
                  <td className="py-1.5 pr-3 align-top text-ink-secondary">{claim.sourceLabel}</td>
                  <td className="py-1.5 pr-3 align-top font-mono text-[11px] text-ink-muted">{claim.fieldKey}</td>
                  <td className="tabular py-1.5 pr-3 align-top font-medium text-ink">
                    {claim.value}
                    {claim.unit ? ` ${claim.unit}` : ''}
                  </td>
                  <td className="tabular py-1.5 align-top text-ink-muted">{(claim.confidence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {contradiction.resolvedBy.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
            <span className="font-semibold uppercase tracking-wide">Resolves with</span>{' '}
            {contradiction.resolvedBy.join('; ')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Resolution paths                                                    */
/* ------------------------------------------------------------------ */

/**
 * The counterfactual: obtain one thing, and see what closes.
 *
 * Ranked by computed impact rather than listed, because the whole value is
 * knowing which single document to chase first when a case has fourteen open
 * findings and a buyer with a week to decide.
 */
function ResolutionPathRow({ path, rank }: { path: ResolutionPath; rank: number }) {
  return (
    <div className="flex gap-3 border-b border-hairline py-3 last:border-0">
      <div className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-ink">{path.obtain}</p>
          <span className="tabular shrink-0 text-[11px] text-ink-muted">
            closes {path.resolves.length} finding{path.resolves.length === 1 ? '' : 's'}
          </span>
        </div>
        {path.documentKind && (
          <Badge tone="neutral" className="mt-1">{DOCUMENT_KIND_LABEL[path.documentKind]}</Badge>
        )}
        <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{path.rationale}</p>
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={Math.round(path.impact * 100)} tone="brand" className="flex-1" />
          <span className="tabular w-10 shrink-0 text-right text-[11px] text-ink-muted">
            {Math.round(path.impact * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

type Section = 'chain' | 'contradictions' | 'paths';

export default function TitleTab({ result }: TabProps) {
  const graph: TitleGraphSummary | undefined = result?.titleGraph;
  const [section, setSection] = useState<Section>('chain');

  if (!graph) {
    return (
      <EmptyState
        icon={<GitBranch size={28} />}
        title="No title graph yet"
        description="The title graph is built from the deeds, khata extracts and certificates on file. Upload the title documents and re-run the screen to reconstruct the chain of ownership, surface contradictions between sources, and rank what to obtain next."
      />
    );
  }

  const criticalCount =
    graph.contradictions.filter((c) => c.severity === 'critical').length
    + graph.chains.reduce((n, c) => n + c.breaks.filter((b) => b.severity === 'critical').length, 0);
  const breakCount = graph.chains.reduce((n, c) => n + c.breaks.length, 0);
  const band = integrityBand(graph.integrityScore, criticalCount);
  const rejected = graph.proposals?.filter((p) => p.outcome !== 'accepted' && p.outcome !== 'duplicate') ?? [];

  const sections: { key: Section; label: string; count: number }[] = [
    { key: 'chain', label: 'Chain of title', count: graph.chains.length },
    { key: 'contradictions', label: 'Contradictions', count: graph.contradictions.length },
    { key: 'paths', label: 'What to obtain next', count: graph.resolutionPaths.length },
  ];

  return (
    <div className="space-y-6">
      <Callout tone={band.tone} title={band.label}>
        {graph.headline}
      </Callout>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Title integrity" value={`${Math.round(graph.integrityScore)}`} hint="out of 100" tone={band.tone} />
        <Stat label="Chain breaks" value={String(breakCount)} hint={breakCount === 0 ? 'none found' : 'gaps in ownership'} tone={breakCount > 0 ? 'warning' : 'good'} />
        <Stat
          label="Contradictions"
          value={String(graph.contradictions.length)}
          hint={graph.contradictions.length === 0 ? 'sources agree' : 'sources disagree'}
          tone={graph.contradictions.length > 0 ? 'serious' : 'good'}
        />
        <Stat label="Graph size" value={`${graph.nodeCount}`} hint={`${graph.edgeCount} relationships`} tone="neutral" />
      </div>

      {rejected.length > 0 && (
        <Callout tone="info" title={`${rejected.length} proposed relationship${rejected.length === 1 ? '' : 's'} rejected`}>
          A model suggested {rejected.length} additional link{rejected.length === 1 ? '' : 's'} that the builder declined
          to accept — uncited, below the confidence floor, or naming something not in the graph. They are recorded rather
          than discarded, because a model repeatedly proposing a link the evidence will not carry is itself worth seeing.
          <ul className="mt-2 space-y-1">
            {rejected.slice(0, 5).map((p) => (
              <li key={p.id} className="text-[11px] text-ink-muted">
                <span className="font-mono">{p.kind}</span> {p.fromMergeKey} → {p.toMergeKey} —{' '}
                {p.rejectionReason ?? p.outcome.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex flex-wrap gap-1.5">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              section === s.key ? 'bg-brand text-white' : 'bg-sunken text-ink-secondary hover:text-ink',
            )}
          >
            {s.key === 'chain' && <GitBranch size={12} />}
            {s.key === 'contradictions' && <Scale size={12} />}
            {s.key === 'paths' && <Sparkles size={12} />}
            {s.label}
            <span className="tabular opacity-70">{s.count}</span>
          </button>
        ))}
      </div>

      {section === 'chain' && (
        <div className="space-y-4">
          {graph.chains.length === 0 ? (
            <EmptyState
              icon={<Unlink size={24} />}
              title="No chain could be reconstructed"
              description="No instrument on file names both a grantor and a parcel, so there is nothing to sequence. A title deed or mother deed is what starts the chain."
            />
          ) : (
            graph.chains.map((c) => <ChainCard key={c.parcelNodeId} chain={c} />)
          )}
        </div>
      )}

      {section === 'contradictions' && (
        <div className="space-y-4">
          {graph.contradictions.length === 0 ? (
            <EmptyState
              icon={<Scale size={24} />}
              title="No contradictions found"
              description="Every source on file agrees within tolerance on areas, parties, identifiers and dates. That is a statement about the documents supplied, not a guarantee about documents that are missing."
            />
          ) : (
            graph.contradictions.map((c) => <ContradictionCard key={c.id} contradiction={c} />)
          )}
        </div>
      )}

      {section === 'paths' && (
        <Card>
          <CardHeader
            title="What to obtain next"
            subtitle="Ranked by how much of the open title risk each one clears"
          />
          <CardBody>
            {graph.resolutionPaths.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Nothing outstanding — no finding on this case names a document that would close it.
              </p>
            ) : (
              graph.resolutionPaths.map((p, i) => <ResolutionPathRow key={p.id} path={p} rank={i + 1} />)
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
