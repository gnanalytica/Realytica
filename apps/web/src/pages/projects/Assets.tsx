import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { LIFECYCLE_STAGE_LABEL, LIFECYCLE_STAGES, type LifecycleStage } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui/kit';
import { assetTree } from '@realytica/shared';
import type { ProjectOutlet } from './ProjectLayout';

export default function Assets() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState('Residential tower');
  const [parentId, setParentId] = useState('');
  const [stage, setStage] = useState<LifecycleStage>(project.currentStage);
  const [stageAsset, setStageAsset] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const tree = assetTree(project);

  async function add() {
    setBusy(true);
    try {
      await api.addAsset(project.id, {
        name,
        assetType,
        parentId: parentId || undefined,
        currentStage: stage,
      });
      setProject(await api.getProject(project.id));
      setOpen(false);
      setName('');
      setAssetType('Residential tower');
      setParentId('');
      toast('Asset added', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add asset', 'critical');
    } finally {
      setBusy(false);
    }
  }

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
        <Button onClick={() => setOpen(true)}>Add asset</Button>
      </div>
      {tree.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description="Build the component tree — towers, podiums, utilities — each with its own stage history."
          action={<Button onClick={() => setOpen(true)}>Add the first asset</Button>}
        />
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {tree.map((asset) => (
              <div key={asset.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ paddingLeft: 16 + asset.depth * 20 }}>
                <div>
                  <p className="text-[13px] font-medium text-ink">{asset.name}</p>
                  <p className="text-[12px] text-ink-secondary">
                    {asset.assetType}
                    {asset.responsible ? ` · ${asset.responsible}` : ''}
                  </p>
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
                    Stage
                  </Button>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add asset / component"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void add()} disabled={busy || !name.trim()}>Add</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tower A" />
          </Field>
          <Field label="Asset type">
            <Input value={assetType} onChange={(e) => setAssetType(e.target.value)} />
          </Field>
          <Field label="Parent" hint="Leave empty for a top-level asset.">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">None — top level</option>
              {project.assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)}>
              {LIFECYCLE_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(stageAsset)}
        onClose={() => setStageAsset(null)}
        title="Change asset stage"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStageAsset(null)}>Cancel</Button>
            <Button onClick={() => void changeAssetStage()} disabled={busy || !reason.trim()}>Save</Button>
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
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
