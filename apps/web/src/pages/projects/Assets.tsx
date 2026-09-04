import { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { LIFECYCLE_STAGE_LABEL, LIFECYCLE_STAGES, UNICLASS_ENTITIES, looksLikeUniclassCode, type LifecycleStage } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui/kit';
import { assetTree } from '@realytica/shared';
import type { ProjectOutlet } from './ProjectLayout';
import { LiveRow } from './LiveRow';

export default function Assets() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const [searchParams] = useSearchParams();
  const liveIds = [...(highlightIds ?? []), ...(searchParams.get('asset') ? [searchParams.get('asset')!] : [])];
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState('Residential tower');
  const [uniclassCode, setUniclassCode] = useState('');
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
        uniclassCode: uniclassCode.trim() || undefined,
        uniclassTitle: UNICLASS_ENTITIES.find((e) => e.code === uniclassCode.trim())?.title,
        parentId: parentId || undefined,
        currentStage: stage,
      });
      setProject(await api.getProject(project.id));
      setOpen(false);
      setName('');
      setAssetType('Residential tower');
      setUniclassCode('');
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
          description="Towers, podiums, utilities — each with its own stage history."
          action={<Button onClick={() => setOpen(true)}>Add the first asset</Button>}
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
          {/* A datalist rather than a dropdown: the suggestions are a working
              subset of a table with thousands of rows, maintained at source, so
              the field has to take a code this build has never seen. Refusing
              one would make the field wrong every time NBS publishes. */}
          <Field
            label="Uniclass code"
            hint={
              uniclassCode.trim() && !looksLikeUniclassCode(uniclassCode) && !UNICLASS_ENTITIES.some((e) => e.code === uniclassCode.trim())
                ? 'That does not look like a Uniclass code (e.g. En_20_20_53). Kept as typed.'
                : 'Optional. What a cost consultant or a BIM model calls this — it sits beside your own asset type, not instead of it.'
            }
          >
            <Input
              list="uniclass-entities"
              value={uniclassCode}
              onChange={(e) => setUniclassCode(e.target.value)}
              placeholder="En_20_20_53"
            />
            <datalist id="uniclass-entities">
              {UNICLASS_ENTITIES.map((e) => (
                <option key={e.code} value={e.code}>{e.title}</option>
              ))}
            </datalist>
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
