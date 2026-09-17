import { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { LIFECYCLE_STAGE_LABEL, LIFECYCLE_STAGES, type LifecycleStage } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Modal, Select, SubmitButton, Textarea, useToast } from '../../components/ui/kit';
import { CreateButton } from '../../components/create/CreateWizard';
import { assetTree } from '@realytica/shared';
import type { ProjectOutlet } from './ProjectLayout';
import { LiveRow } from './LiveRow';

export default function Assets() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const [searchParams] = useSearchParams();
  const liveIds = [...(highlightIds ?? []), ...(searchParams.get('asset') ? [searchParams.get('asset')!] : [])];
  const toast = useToast();
  // Adding an asset lives in the shared wizard; what is left here is the one
  // thing that is not a creation — moving an asset along its lifecycle.
  const [stage, setStage] = useState<LifecycleStage>(project.currentStage);
  const [stageAsset, setStageAsset] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const tree = assetTree(project);

  async function changeAssetStage() {
    if (!stageAsset) return;
    setBusy(true);
    try {
      await api.changeStage(project.id, { subject: 'asset', assetId: stageAsset, stage, reason });
      setProject(await api.getProject(project.id));
      setStageAsset(null);
      setReason('');
      toast('Asset stage updated', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change stage', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateButton kind="add_asset" project={project} onCreated={setProject} />
      </div>
      {tree.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description="Towers, podiums, utilities — each with its own stage history."
          action={<CreateButton kind="add_asset" project={project} onCreated={setProject} label="Add the first asset" />}
        />
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {tree.map((asset) => (
              <LiveRow key={asset.id} id={asset.id} highlightIds={liveIds} variant="flush" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ paddingLeft: 16 + Math.min(asset.depth, 2) * 16 }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{asset.name}</p>
                  <p className="text-[12px] text-ink-secondary">
                    {asset.assetType}
                    {asset.responsible ? ` · ${asset.responsible}` : ''}
                  </p>
                  {asset.uniclassCode ? (
                    <p className="text-[11px] text-ink-muted" title="Uniclass 2015 Entities — structured to ISO 12006-2, and how a cost consultant or a BIM model names the same thing.">
                      {asset.uniclassCode}
                      {asset.uniclassTitle ? ` · ${asset.uniclassTitle}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{LIFECYCLE_STAGE_LABEL[asset.currentStage]}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setStageAsset(asset.id);
                      setStage(asset.currentStage);
                    }}
                  >
                    {/* A bare "Stage" beside a stage badge reads as a stray
                        column header, not a control. Name the action. */}
                    Change stage
                  </Button>
                </div>
              </LiveRow>
            ))}
          </CardBody>
        </Card>
      )}

      <Modal
        open={Boolean(stageAsset)}
        onClose={() => setStageAsset(null)}
        title="Change asset stage"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStageAsset(null)}>Cancel</Button>
            <SubmitButton onClick={() => void changeAssetStage()} busy={busy} needs={reason.trim() ? [] : ['Reason']}>Save</SubmitButton>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)}>
              {LIFECYCLE_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" required hint="Kept on the asset's stage history — it is the answer to 'why did this move' a year from now.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
