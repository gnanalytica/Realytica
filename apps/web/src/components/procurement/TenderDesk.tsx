/**
 * Procurement › Tenders: each work package from tender papers to a signed
 * contract.
 *
 * One tender at a time: its nine stages with a date and an owner each, its
 * bidders set side by side against the estimate and against each other, then
 * the recommendation a person writes and the letter of acceptance. A flag
 * here is arithmetic, and reads as such: "differs from the others by 18%".
 *
 * The letter offers the awarded value to Finance. It reaches the Cost Report
 * when Finance accepts it (`TenderOffers`), not from this page.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  TENDER_BID_FLAG_PERCENT,
  TENDER_STAGES_OPTIONAL,
  TENDER_STAGE_LABEL,
  cockpitPath,
  costRegister, packageAwaitsNoAward,
  departmentRole,
  indiaToday,
  moneySaid,
  roleCanDecide,
  roleCanEdit,
  tenderComparison,
  tenderPackageName,
  tenderPercentSaid,
  tenderStageSettled,
  tenderStanding,
  tendersOf,
  type DdProject,
  type Tender,
  type TenderBidder,
  type TenderBidderInput,
  type TenderStage,
  type TenderStagePatch,
} from '@realytica/shared';
import { procurementApi } from '../../lib/procurement-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select, Textarea, cn, useToast } from '../ui/kit';
import { TenderOffers } from './TenderOffers';
import { daySaid } from '@realytica/shared';

type Run = (fallback: string, work: () => Promise<{ project: DdProject }>) => Promise<boolean>;

const today = (): string => indiaToday(new Date());

/** An amount as typed: digits, with commas or spaces between. Empty is none, and anything else is not an amount. */
function amountOf(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[,\s₹]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function TenderDesk({ project, onChanged, marked }: { project: DdProject; onChanged: (p: DdProject) => void; marked?: string | null }) {
  const toast = useToast();
  const me = useMe();
  const role = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, 'procurement') : undefined;
  const mayEdit = roleCanEdit(role);
  const mayDecide = roleCanDecide(role);
  const tenders = tendersOf(project);
  // A contingency, a fee, tax or a sub-total is a budget line nobody tenders: it is not offered a tender.
  const packages = costRegister(project).workPackages.filter((pack) => !packageAwaitsNoAward(pack.name));
  const free = packages.filter((pack) => !tenders.some((tender) => tender.workPackageId === pack.id));
  const [picked, setPicked] = useState<string | null>(marked ?? null);
  const [starting, setStarting] = useState('');
  const [busy, setBusy] = useState(false);
  const tender = tenders.find((held) => held.id === picked) ?? tenders[0];
  const late = tenders.filter((held) => tenderStanding(held).late.length).length;

  const run: Run = async (fallback, work) => {
    setBusy(true);
    try {
      onChanged((await work()).project);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : fallback, 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function start() {
    const workPackageId = starting || free[0]?.id;
    if (!workPackageId) return;
    setBusy(true);
    try {
      const res = await procurementApi.startTender(project.id, { workPackageId });
      onChanged(res.project);
      setPicked(res.tender.id);
      setStarting('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start the tender', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Tenders"
          subtitle={tenders.length ? `${tenders.length} of ${Math.max(packages.length, tenders.length)} packages${late ? ` · ${late} past a date` : ''}` : 'One for each work package'}
          action={
            mayEdit && free.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Select aria-label="Work package to tender" value={starting || free[0]!.id} onChange={(e) => setStarting(e.target.value)} className="w-[12rem]">
                  {free.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {[pack.code, pack.name].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </Select>
                <Button size="sm" icon={<Plus size={14} />} loading={busy} onClick={() => void start()}>
                  Start
                </Button>
              </div>
            ) : null
          }
        />
        <CardBody>
          {tenders.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">
              {packages.length ? 'No tender started.' : 'No work packages yet. '}
              {packages.length ? null : (
                <Link to={cockpitPath(project.id, 'workstream', { workstream: 'finance.budget' })} className="font-medium text-brand hover:underline">
                  Add them in Budget
                </Link>
              )}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tenders.map((held) => {
                const standing = tenderStanding(held);
                return (
                  <button
                    key={held.id}
                    type="button"
                    aria-pressed={held.id === tender?.id}
                    onClick={() => setPicked(held.id)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-left text-[12px] ring-1 ring-inset transition-colors coarse:min-h-11',
                      held.id === tender?.id ? 'bg-brand-soft font-semibold text-brand ring-brand/30' : 'text-ink-secondary ring-[var(--ring)] hover:text-ink',
                    )}
                  >
                    {tenderPackageName(project, held)}
                    <span className={cn('ml-1.5 font-normal', standing.late.length ? 'text-[var(--status-warning-text)]' : 'text-ink-muted')}>{standing.at ? `${standing.settled}/${held.stages.length} · ${TENDER_STAGE_LABEL[standing.at]}` : 'Signed'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {tender ? (
        <>
          <Stages key={`stages:${tender.id}`} project={project} tender={tender} mayEdit={mayEdit} busy={busy} run={run} />
          <Bidders key={`bidders:${tender.id}`} project={project} tender={tender} mayEdit={mayEdit} busy={busy} run={run} />
          <Award key={`award:${tender.id}`} project={project} tender={tender} mayDecide={mayDecide} busy={busy} run={run} />
        </>
      ) : null}
      <TenderOffers project={project} onChanged={onChanged} />
    </div>
  );
}

/* ==================================================================== */
/* Stages                                                                */
/* ==================================================================== */

function Stages({ project, tender, mayEdit, busy, run }: { project: DdProject; tender: Tender; mayEdit: boolean; busy: boolean; run: Run }) {
  const standing = tenderStanding(tender);
  return (
    <Card>
      <CardHeader title="Stages" subtitle={`${standing.settled} of ${tender.stages.length} behind it${standing.late.length ? ` · ${standing.late.length} past ${standing.late.length === 1 ? 'its' : 'their'} date` : ''}`} />
      <CardBody className="p-0">
        <ol>
          {tender.stages.map((stage, i) => (
            <StageRow
              key={`${stage.key}:${stage.dueOn ?? ''}:${stage.owner ?? ''}:${stage.doneOn ?? ''}:${stage.notNeeded ?? ''}`}
              n={i + 1}
              stage={stage}
              current={standing.at === stage.key}
              late={standing.late.includes(stage.key)}
              mayEdit={mayEdit}
              busy={busy}
              onPatch={(patch) => void run('Could not change the stage', () => procurementApi.setStage(project.id, tender.id, stage.key, patch))}
            />
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function StageRow({ n, stage, current, late, mayEdit, busy, onPatch }: { n: number; stage: TenderStage; current: boolean; late: boolean; mayEdit: boolean; busy: boolean; onPatch: (patch: TenderStagePatch) => void }) {
  const [owner, setOwner] = useState(stage.owner ?? '');
  const settled = tenderStageSettled(stage);
  const optional = TENDER_STAGES_OPTIONAL.includes(stage.key);
  // The letter of acceptance is done by recording the letter, with the bidder and the value.
  const byLetter = stage.key === 'letter_of_acceptance';
  return (
    <li className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b border-hairline px-4 py-2.5 last:border-b-0 [@container(min-width:46rem)]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ring-1 ring-inset',
            settled ? 'bg-good text-[var(--text-inverse)] ring-good' : current ? 'bg-ink text-[var(--text-inverse)] ring-ink' : 'bg-sunken text-ink-muted ring-[var(--ring)]',
          )}
        >
          {stage.doneOn ? <Check size={12} /> : n}
        </span>
        <p className={cn('min-w-0 text-[13px]', stage.notNeeded ? 'text-ink-muted line-through' : 'font-medium text-ink')}>{TENDER_STAGE_LABEL[stage.key]}</p>
        {late ? <Badge tone="warning">Past its date</Badge> : stage.notNeeded ? <Badge tone="neutral">Not needed</Badge> : null}
      </div>
      {mayEdit ? (
        <div className="grid grid-cols-2 items-end gap-2 [@container(min-width:46rem)]:flex">
          <label className="block min-w-0 text-micro text-ink-muted">
            Due
            <Input type="date" value={stage.dueOn ?? ''} disabled={busy} onChange={(e) => onPatch({ dueOn: e.target.value || null })} className="mt-0.5 w-full [@container(min-width:46rem)]:w-[9.25rem]" />
          </label>
          <label className="block min-w-0 text-micro text-ink-muted">
            With
            <Input
              value={owner}
              disabled={busy}
              maxLength={120}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={() => {
                if (owner.trim() !== (stage.owner ?? '')) onPatch({ owner: owner.trim() || null });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="mt-0.5 w-full [@container(min-width:46rem)]:w-[9rem]"
            />
          </label>
          <label className="block min-w-0 text-micro text-ink-muted">
            Done
            <Input
              type="date"
              value={stage.doneOn ?? ''}
              max={today()}
              disabled={busy || byLetter || Boolean(stage.notNeeded)}
              title={byLetter ? 'Done by recording the letter below' : undefined}
              onChange={(e) => onPatch({ doneOn: e.target.value || null })}
              className="mt-0.5 w-full [@container(min-width:46rem)]:w-[9.25rem]"
            />
          </label>
          {/* The same width on every row of a wide page, so the dates stand in columns. */}
          {optional ? (
            <Button size="sm" variant="ghost" className="[@container(min-width:46rem)]:w-[6rem]" disabled={busy || Boolean(stage.doneOn)} onClick={() => onPatch({ notNeeded: !stage.notNeeded })}>
              {stage.notNeeded ? 'Needed' : 'Not needed'}
            </Button>
          ) : (
            <span aria-hidden className="hidden w-[6rem] [@container(min-width:46rem)]:block" />
          )}
        </div>
      ) : (
        <p className="font-mono text-[12px] text-ink-secondary">
          {[stage.doneOn ? `Done ${daySaid(stage.doneOn)}` : stage.dueOn ? `Due ${daySaid(stage.dueOn)}` : '', stage.owner ?? ''].filter(Boolean).join(' · ') || '—'}
        </p>
      )}
    </li>
  );
}

/* ==================================================================== */
/* Bidders and the comparison                                            */
/* ==================================================================== */

function Bidders({ project, tender, mayEdit, busy, run }: { project: DdProject; tender: Tender; mayEdit: boolean; busy: boolean; run: Run }) {
  const compared = useMemo(() => tenderComparison(tender), [tender]);
  const money = (amount: number | undefined): string => (amount === undefined ? '—' : moneySaid(amount, project.currency));
  const [estimate, setEstimate] = useState(tender.estimate === undefined ? '' : String(tender.estimate));
  const [editing, setEditing] = useState<TenderBidder | 'new' | null>(null);

  function saveEstimate() {
    const next = amountOf(estimate);
    if (next === undefined || next === (tender.estimate ?? null)) return;
    void run('Could not set the estimate', () => procurementApi.setEstimate(project.id, tender.id, next));
  }

  return (
    <Card>
      <CardHeader
        title="Bidders"
        subtitle={`${tender.bidders.length} ${tender.bidders.length === 1 ? 'bid' : 'bids'}${compared.flags.length ? ` · ${compared.flags.length} past ${TENDER_BID_FLAG_PERCENT}% or its item limit` : ''}`}
        action={
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-micro text-ink-muted">
              Estimate
              {mayEdit ? (
                <Input
                  value={estimate}
                  inputMode="decimal"
                  disabled={busy}
                  onChange={(e) => setEstimate(e.target.value)}
                  onBlur={saveEstimate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className="mt-0.5 w-36 text-right tabular-nums"
                />
              ) : (
                <span className="mt-0.5 block font-mono text-[13px] tabular-nums text-ink">{money(tender.estimate)}</span>
              )}
            </label>
            {mayEdit ? (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>
                Bidder
              </Button>
            ) : null}
          </div>
        }
      />
      <CardBody className="space-y-4">
        {tender.bidders.length === 0 ? (
          <p className="text-[13px] text-ink-secondary">No bids yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
                  <th className="py-1.5 pr-3 font-medium">Bidder</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Quoted</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Revised</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Against estimate</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Against the others</th>
                  {mayEdit ? <th className="py-1.5 font-medium" /> : null}
                </tr>
              </thead>
              <tbody>
                {compared.bids.map((bid, i) => {
                  const bidder = tender.bidders[i]!;
                  const noted = [bidder.qualifications ? `Qualified: ${bidder.qualifications}` : '', bidder.exclusions ? `Excluded: ${bidder.exclusions}` : ''].filter(Boolean);
                  return (
                    <tr key={bid.bidderId} className="border-b border-hairline/70 align-top">
                      <td className="py-2 pr-3">
                        <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                          {bid.name}
                          {bid.lowest ? <Badge tone="neutral">Lowest</Badge> : null}
                          {tender.award?.bidderId === bid.bidderId ? <Badge tone="good">Awarded</Badge> : tender.recommendation?.bidderId === bid.bidderId ? <Badge tone="brand">Recommended</Badge> : null}
                        </p>
                        {noted.map((line) => (
                          <p key={line} className="mt-0.5 max-w-[44ch] text-xs text-ink-secondary">
                            {line}
                          </p>
                        ))}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">{money(bid.quoted)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">{money(bid.revised)}</td>
                      <td className="py-2 pr-3 text-right text-ink-secondary">{bid.againstEstimate === undefined ? '—' : tenderPercentSaid(bid.againstEstimate)}</td>
                      <td className={cn('py-2 pr-3 text-right', bid.flagged ? 'font-medium text-[var(--status-warning-text)]' : 'text-ink-secondary')}>
                        {bid.againstOthers === undefined ? '—' : tenderPercentSaid(bid.againstOthers, bid.flagged ? TENDER_BID_FLAG_PERCENT : undefined)}
                      </td>
                      {mayEdit ? (
                        <td className="py-1.5 text-right">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(bidder)}>
                            Edit
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {compared.lines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
                  <th className="py-1.5 pr-3 font-medium">Item</th>
                  {compared.bids.map((bid) => (
                    <th key={bid.bidderId} className="py-1.5 pr-3 text-right font-medium">
                      {bid.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compared.lines.map((line) => (
                  <tr key={line.item} className="border-b border-hairline/70">
                    <td className="py-1.5 pr-3 text-ink">{line.item}</td>
                    {line.cells.map((cell) => (
                      <td key={cell.bidderId} className={cn('py-1.5 pr-3 text-right font-mono tabular-nums', cell.flagged ? 'font-medium text-[var(--status-warning-text)]' : 'text-ink')}>
                        {money(cell.amount)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {compared.flags.length ? (
          <ul className="space-y-1">
            {compared.flags.map((flag) => (
              <li key={`${flag.bidderId}:${flag.item ?? ''}`} className="flex items-start gap-2 text-[13px] text-ink">
                <Badge tone="warning">By rule</Badge>
                <span className="min-w-0">{flag.say}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
      {editing ? <BidderForm key={editing === 'new' ? 'new' : editing.id} project={project} tender={tender} bidder={editing === 'new' ? undefined : editing} busy={busy} run={run} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

/** Priced items as they are typed: one a line, the item and then its amount. */
function linesOf(text: string): TenderBidderInput['lines'] | undefined {
  const out: Array<{ item: string; amount: number }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const said = /^(.*?)[,\t:]\s*([₹\d][\d,.\s]*)$/.exec(line);
    const amount = said ? amountOf(said[2]!) : undefined;
    if (!said || !said[1]!.trim() || !amount) return undefined;
    out.push({ item: said[1]!.trim(), amount });
  }
  return out;
}

function BidderForm({ project, tender, bidder, busy, run, onClose }: { project: DdProject; tender: Tender; bidder?: TenderBidder; busy: boolean; run: Run; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(bidder?.name ?? '');
  const [quoted, setQuoted] = useState(bidder?.quoted === undefined ? '' : String(bidder.quoted));
  const [revised, setRevised] = useState(bidder?.revised === undefined ? '' : String(bidder.revised));
  const [qualifications, setQualifications] = useState(bidder?.qualifications ?? '');
  const [exclusions, setExclusions] = useState(bidder?.exclusions ?? '');
  const [lines, setLines] = useState((bidder?.lines ?? []).map((line) => `${line.item}, ${line.amount}`).join('\n'));
  const awarded = tender.award?.bidderId === bidder?.id;

  async function save() {
    const q = amountOf(quoted);
    const r = amountOf(revised);
    const priced = linesOf(lines);
    if (!name.trim() || q === undefined || r === undefined) {
      toast(!name.trim() ? 'Give the bidder a name.' : 'An amount is a number, more than nothing.', 'critical');
      return;
    }
    if (!priced) {
      toast('Priced items are one a line: the item, a comma, its amount.', 'critical');
      return;
    }
    const notes = { qualifications: qualifications.trim() || null, exclusions: exclusions.trim() || null, lines: priced.length ? priced : null };
    const ok = bidder
      ? // The one awarded to keeps the name and figures the letter was written on.
        await run('Could not change the bidder', () => procurementApi.updateBidder(project.id, tender.id, bidder.id, awarded ? notes : { name: name.trim(), quoted: q, revised: r, ...notes }))
      : await run('Could not add the bidder', () =>
          procurementApi.addBidder(project.id, tender.id, {
            name: name.trim(),
            ...(q !== null ? { quoted: q } : {}),
            ...(r !== null ? { revised: r } : {}),
            ...(notes.qualifications ? { qualifications: notes.qualifications } : {}),
            ...(notes.exclusions ? { exclusions: notes.exclusions } : {}),
            ...(priced.length ? { lines: priced } : {}),
          }),
        );
    if (ok) onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={bidder ? bidder.name : 'Add a bidder'}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {bidder ? (
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              disabled={busy}
              onClick={() =>
                void run('Could not remove the bidder', () => procurementApi.removeBidder(project.id, tender.id, bidder.id)).then((ok) => {
                  if (ok) onClose();
                })
              }
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} maxLength={160} disabled={awarded} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Quoted">
            <Input value={quoted} inputMode="decimal" disabled={awarded} onChange={(e) => setQuoted(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label="Revised after negotiation">
            <Input value={revised} inputMode="decimal" disabled={awarded} onChange={(e) => setRevised(e.target.value)} className="text-right tabular-nums" />
          </Field>
        </div>
        <Field label="Qualifications">
          <Textarea value={qualifications} maxLength={2000} onChange={(e) => setQualifications(e.target.value)} />
        </Field>
        <Field label="Exclusions">
          <Textarea value={exclusions} maxLength={2000} onChange={(e) => setExclusions(e.target.value)} />
        </Field>
        <Field label="Priced items" hint="One a line: the item, a comma, its amount">
          <Textarea value={lines} onChange={(e) => setLines(e.target.value)} className="font-mono" />
        </Field>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* The recommendation and the letter of acceptance                       */
/* ==================================================================== */

function Award({ project, tender, mayDecide, busy, run }: { project: DdProject; tender: Tender; mayDecide: boolean; busy: boolean; run: Run }) {
  const toast = useToast();
  const nameOf = (bidderId: string | undefined): string => tender.bidders.find((bidder) => bidder.id === bidderId)?.name ?? '';
  const first = tender.recommendation?.bidderId ?? tender.bidders[0]?.id ?? '';
  const [recommended, setRecommended] = useState(first);
  const [text, setText] = useState(tender.recommendation?.text ?? '');
  const [to, setTo] = useState(first);
  const [value, setValue] = useState('');
  const [letterOn, setLetterOn] = useState(today());
  const { recommendation, award, offer } = tender;
  const pick = (current: string, set: (id: string) => void, label: string) => (
    <Select aria-label={label} value={current || tender.bidders[0]?.id || ''} onChange={(e) => set(e.target.value)} className="w-[12rem]">
      {tender.bidders.map((bidder) => (
        <option key={bidder.id} value={bidder.id}>
          {bidder.name}
        </option>
      ))}
    </Select>
  );

  function recordLetter() {
    const amount = amountOf(value);
    const bidderId = to || tender.bidders[0]?.id;
    if (!amount || !bidderId) {
      toast('Give the awarded value.', 'critical');
      return;
    }
    void run('Could not record the letter', () => procurementApi.recordLetter(project.id, tender.id, { bidderId, value: amount, letterOn }));
  }

  return (
    <Card>
      <CardHeader title="Recommendation and award" subtitle={award ? `${nameOf(award.bidderId)} · ${moneySaid(award.value, project.currency)}` : recommendation ? `${nameOf(recommendation.bidderId)} recommended` : 'Written by a person'} />
      <CardBody className="space-y-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Recommendation</p>
          {recommendation ? (
            <div>
              <p className="whitespace-pre-wrap text-[13px] text-ink">{recommendation.text}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {nameOf(recommendation.bidderId)} · {recommendation.by}, {daySaid(recommendation.at.slice(0, 10))}
              </p>
            </div>
          ) : !mayDecide ? (
            <p className="text-[13px] text-ink-secondary">None written.</p>
          ) : null}
          {mayDecide && !award ? (
            tender.bidders.length ? (
              <div className="space-y-2">
                <Textarea aria-label="Recommendation" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Who, and why" />
                <div className="flex flex-wrap items-center gap-2">
                  {pick(recommended, setRecommended, 'Bidder recommended')}
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={!text.trim() || (text.trim() === recommendation?.text && (recommended || first) === recommendation?.bidderId)}
                    onClick={() => void run('Could not save the recommendation', () => procurementApi.recommend(project.id, tender.id, { bidderId: recommended || first, text: text.trim() }))}
                  >
                    {recommendation ? 'Rewrite' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-ink-secondary">Add a bidder first.</p>
            )
          ) : null}
        </div>

        <div className="space-y-2 border-t border-hairline pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Letter of acceptance</p>
          {award ? (
            <div className="space-y-1.5">
              <p className="text-[13px] text-ink">
                {nameOf(award.bidderId)} · <span className="font-mono tabular-nums">{moneySaid(award.value, project.currency)}</span> · letter of {daySaid(award.letterOn)}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                {offer?.status === 'accepted' ? (
                  <>
                    <Badge tone="good">PO issued</Badge>
                    Accepted by {offer.decidedBy}, {daySaid(offer.decidedAt?.slice(0, 10))}
                  </>
                ) : offer?.status === 'declined' ? (
                  <>
                    <Badge tone="serious">Declined by Finance</Badge>
                    {offer.reason}
                  </>
                ) : (
                  <>
                    <Badge tone="neutral">Offered to Finance</Badge>
                    Not on the Cost Report until accepted
                  </>
                )}
              </p>
              {mayDecide && offer?.status !== 'accepted' ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {offer?.status === 'declined' ? (
                    <Button size="sm" loading={busy} onClick={() => void run('Could not offer it again', () => procurementApi.offerAgain(project.id, tender.id))}>
                      Offer again
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('Could not take the letter back', () => procurementApi.withdrawLetter(project.id, tender.id))}>
                    Take back
                  </Button>
                </div>
              ) : null}
            </div>
          ) : mayDecide && tender.bidders.length ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-micro text-ink-muted">
                To
                <div className="mt-0.5">{pick(to, setTo, 'Bidder awarded to')}</div>
              </label>
              <label className="block text-micro text-ink-muted">
                Awarded value
                <Input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} className="mt-0.5 w-36 text-right tabular-nums" />
              </label>
              <label className="block text-micro text-ink-muted">
                Letter of
                <Input type="date" value={letterOn} max={today()} onChange={(e) => setLetterOn(e.target.value)} className="mt-0.5 w-[9.25rem]" />
              </label>
              <Button size="sm" variant="primary" loading={busy} disabled={!value.trim() || !letterOn} onClick={recordLetter}>
                Record letter
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-ink-secondary">None recorded.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
