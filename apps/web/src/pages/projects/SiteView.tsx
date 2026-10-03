import { Suspense, lazy, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FileCheck2 } from 'lucide-react';
import { REVENUE_MAP_CAVEAT, revenueMapEvidenceCode } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton, useToast } from '../../components/ui/kit';
import SiteRecord from './SiteRecord';
import type { ProjectOutlet } from './ProjectLayout';
import { WorkstreamFrame } from './departments/WorkstreamPage';

/*
 * Both cards carry Leaflet or a map provider; lazy so the visit record paints
 * without waiting for either.
 */
const GisOverlayCard = lazy(() =>
  import('../../components/GisOverlayCard').then((m) => ({ default: m.GisOverlayCard })),
);
const SitePlaceCard = lazy(() =>
  import('../../components/SitePlaceCard').then((m) => ({ default: m.SitePlaceCard })),
);

const SEVERITY_TONE = { critical: 'critical', high: 'serious', medium: 'warning', low: 'neutral' } as const;

/**
 * The state's map reading, and the decision to file it.
 *
 * A read stays a record until a person files it: a machine reading of
 * published layers, with its own survey error, is not a certified extract.
 * Filing it puts it on the evidence register, where a report can cite it.
 */
function RevenueReadCard() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const read = project.revenueMap;
  if (!read) return null;
  const filed = project.evidence.find((e) => e.screenCode === revenueMapEvidenceCode(read));
  const place = [read.village, read.mandal, read.district].filter(Boolean).join(', ');

  async function file() {
    setBusy(true);
    try {
      const out = await api.fileRevenueMap(project.id);
      setProject(out.project);
      toast('Filed the map read as evidence', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not file the read', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`State map read · Sy. ${read.surveyNo}`}
        subtitle={`${place || read.sourceLabel} · read ${new Date(read.readAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
        info={REVENUE_MAP_CAVEAT}
        action={
          filed ? (
            <Badge tone="good" icon={<FileCheck2 size={11} />}>On the evidence register</Badge>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void file()} loading={busy}>
              File as evidence
            </Button>
          )
        }
      />
      <CardBody className="space-y-2">
        {read.factors.length === 0 ? (
          <p className="text-[13px] text-ink-secondary">No constraint was found near this parcel in the layers that could be read.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {read.factors.map((f) => (
              <li key={f.code} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{f.label}</p>
                  <p className="text-[12px] leading-snug text-ink-secondary">{f.headline}</p>
                </div>
                <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
              </li>
            ))}
          </ul>
        )}
        {read.unreadLayers.length ? (
          <p className="text-[12px] text-ink-muted">
            Not read: {read.unreadLayers.map((l) => l.layer).join(', ')}. Their silence says nothing about the site.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** The Site tab: the map and its readings, the place, and the visits. */
export default function SiteView() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Engineering &amp; Construction</p>
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">Site record</h2>
        <p className="max-w-[70ch] text-[12px] text-ink-secondary">Where the site is, what is next to it, and what visits found.</p>
      </div>
      <WorkstreamFrame project={project} workstream="construction.site" setProject={setProject} compact />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <GisOverlayCard project={project} onChanged={async () => setProject(await api.getProject(project.id))} />
      </Suspense>
      <RevenueReadCard />
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <SitePlaceCard project={project} />
      </Suspense>
      <SiteRecord />
    </div>
  );
}
