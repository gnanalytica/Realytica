import { Check, Compass, FileText, Sparkles, Trash2, X } from 'lucide-react';
import type { IntakeField, IntakeReadout } from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, Stat, cn } from '../ui/kit';
import { VERDICT_LABEL, money } from '../../lib/format';
import { formatArea, useAreaUnitFor } from '../../lib/units';

/**
 * What the conversation has learned, beside the conversation.
 *
 * The chat is where the talking happens; this is where the user can see what
 * the app decided they said. That split is the point: a conversational intake
 * that silently populates a form is worse than the form, because the user
 * cannot see what was captured and therefore cannot correct it. Every
 * particular here is visible, sourced, and removable in one click.
 */

const PROVENANCE_LABEL: Record<IntakeField['provenance'], string> = {
  stated: 'You said this',
  inferred: 'Inferred',
  document: 'From a document',
  default: 'Default',
};

export interface DraftPanelProps {
  readout: IntakeReadout;
  fields: IntakeField[];
  onConfirm: (path: string) => void;
  onClear: (path: string) => void;
  onBuild: () => void;
  building: boolean;
  busyPath?: string | null;
}

/**
 * A captured particular as a person reads it.
 *
 * Enums arrive carrying their own label from the field table. Areas and prices
 * are formatted here instead, because how an area reads depends on the unit
 * the reader has chosen and that is a UI preference, not a property of the
 * draft. Everything else is already a string somebody typed.
 */
export function displayValue(f: IntakeField, areaUnit: ReturnType<typeof useAreaUnitFor>): string {
  if (f.display) return f.display;
  if (typeof f.value === 'number') {
    if (f.path.endsWith('AreaSqm')) return formatArea(f.value, areaUnit);
    // In full, not compact. A price is a figure the user gave to the rupee, and
    // "₹1.2 Cr" sitting beside «you said "1.15 cr"» reads as a misrecording.
    if (f.path === 'askingPrice') return money(f.value, 'INR', { compact: false });
    return String(f.value);
  }
  if (typeof f.value === 'boolean') return f.value ? 'Yes' : 'No';
  return String(f.value ?? '—');
}

export function DraftPanel({ readout, fields, onConfirm, onClear, onBuild, building, busyPath }: DraftPanelProps) {
  // 'IN' rather than the case's country: this build's intake serves Karnataka
  // only, and there is no case yet to read a country from.
  const areaUnit = useAreaUnitFor('IN');
  const preview = readout.preview;
  const unconfirmed = fields.filter((f) => !f.confirmed);
  const outstanding = readout.documents.filter((d) => d.critical && !d.received);
  const received = readout.documents.filter((d) => d.received);

  return (
    <div className="flex flex-col gap-4">
      {/*
        * Above the range, because the reading decides how the range was
        * produced. A user who sees a number first and the method second has
        * already formed a view of the number.
        */}
      {readout.project && readout.assessment && (
        <Card>
          <CardHeader
            title="Reading this as"
            subtitle={readout.projectKindStated ? 'You told us this.' : 'Read from what you have said so far — correct it any time.'}
            icon={<Compass size={15} />}
          />
          <CardBody className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">{readout.assessment.label}</span>
              {!readout.projectKindStated && (
                <Badge tone={readout.project.alternatives.length > 0 ? 'warning' : 'neutral'}>
                  {readout.project.alternatives.length > 0 ? 'Not settled' : `${Math.round(readout.project.confidence * 100)}% confident`}
                </Badge>
              )}
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-secondary">{readout.assessment.headlineQuestion}</p>
            <ul className="flex flex-col gap-1">
              {readout.project.basis.map((b) => (
                <li key={b} className="flex gap-2 text-mini leading-relaxed text-ink-muted">
                  <span aria-hidden="true" className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                  {b}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {preview ? (
        <Card>
          <CardHeader
            title="What the engine already says"
            subtitle="Computed from the particulars on the left, by the same engine that screens a finished case. These are not estimates of an answer — they are the answer, on what is known so far."
            icon={<Sparkles size={15} />}
          />
          {/*
            * Stacked, not side by side.
            *
            * `Stat` truncates its value, and in a 360px column two of these
            * abreast cut the range to "₹91.5 L – …" and the verdict to "do not
            * pu…". A headline number nobody can read is worse than no headline.
            */}
          <CardBody className="flex flex-col gap-3">
            <Stat
              label="Indicative range"
              value={`${money(preview.indicativeValue.low, preview.indicativeValue.currency, { compact: true })} – ${money(
                preview.indicativeValue.high,
                preview.indicativeValue.currency,
                { compact: true },
              )}`}
              sub={`${preview.confidence.band} confidence (${preview.confidence.score}/100)`}
            />
            <div>
              <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">Verdict</div>
              <div
                className={cn(
                  'mt-1 text-[15px] font-semibold leading-snug',
                  preview.recommendation.verdict === 'do_not_pursue' ? 'text-critical' : 'text-ink',
                )}
              >
                {VERDICT_LABEL[preview.recommendation.verdict]}
              </div>
              <div className="mt-0.5 text-xs text-ink-secondary">
                {preview.risks.length} risk{preview.risks.length === 1 ? '' : 's'} ·{' '}
                {preview.completeness.missingCritical.length} critical document
                {preview.completeness.missingCritical.length === 1 ? '' : 's'} missing
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="text-xs leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink">No number yet.</span> The engine needs a locality, a property type
            and an area before it can price anything. That is three answers, and everything after them sharpens the
            result rather than unlocking it.
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Particulars"
          subtitle={
            fields.length === 0
              ? 'Nothing captured yet.'
              : `${fields.length} captured${unconfirmed.length > 0 ? `, ${unconfirmed.length} inferred and unconfirmed` : ''}.`
          }
          action={fields.length > 0 ? <Badge tone="neutral">{fields.length}</Badge> : undefined}
        />
        <CardBody className="flex flex-col gap-2">
          {fields.length === 0 ? (
            <p className="text-xs text-ink-muted">Whatever you tell the concierge shows up here, with where it came from.</p>
          ) : (
            fields.map((f) => (
              <div
                key={f.path}
                data-field={f.path}
                data-provenance={f.provenance}
                className={cn(
                  'rounded-lg p-2.5 ring-1 ring-inset',
                  f.confirmed ? 'bg-surface ring-[var(--ring)]' : 'bg-warning/5 ring-warning/40',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[13px] font-medium text-ink">{f.label}</span>
                  <span className="text-[13px] text-ink-secondary">{displayValue(f, areaUnit)}</span>
                  {f.saidAs ? <span className="text-mini text-ink-muted">you said “{f.saidAs}”</span> : null}
                  <Badge tone={f.confirmed ? 'neutral' : 'warning'} className="ml-auto">
                    {PROVENANCE_LABEL[f.provenance]}
                  </Badge>
                </div>
                {/*
                 * The basis is not a tooltip. It is the only thing that lets
                 * someone judge an inference, and an inference nobody can
                 * judge is a fabricated particular with extra steps.
                 */}
                {f.basis && !f.confirmed ? (
                  <p className="mt-1 text-mini leading-relaxed text-ink-secondary">
                    Worked out from {f.basis}. It counts toward the numbers above until you say otherwise.
                  </p>
                ) : null}
                <div className="mt-1.5 flex items-center gap-1.5">
                  {!f.confirmed ? (
                    <Button size="sm" variant="secondary" icon={<Check size={12} />} onClick={() => onConfirm(f.path)} loading={busyPath === f.path}>
                      That's right
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon={f.confirmed ? <Trash2 size={12} /> : <X size={12} />} onClick={() => onClear(f.path)}>
                    {f.confirmed ? 'Remove' : 'No'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {outstanding.length > 0 || received.length > 0 ? (
        <Card>
          <CardHeader
            title="Documents"

            icon={<FileText size={15} />}
          />
          <CardBody className="flex flex-col gap-2">
            {outstanding.map((d) => (
              <div key={d.kind} data-document={d.kind} className="rounded-lg bg-sunken p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-ink">{d.label}</span>
                  <Badge tone="critical" className="ml-auto">Critical</Badge>
                </div>
                <p className="mt-1 text-mini leading-relaxed text-ink-secondary">Settles: {d.settles}</p>
              </div>
            ))}
            {received.map((d) => (
              <div key={d.kind} data-document={d.kind} className="flex items-baseline gap-2 rounded-lg bg-good/5 p-2.5 ring-1 ring-inset ring-good/30">
                <span className="text-[13px] text-ink">{d.label}</span>
                <Badge tone="good" className="ml-auto" icon={<Check size={11} />}>Received</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Button variant="primary" onClick={onBuild} loading={building} disabled={!readout.screenable}>
        {readout.screenable ? 'Build the case' : 'Not enough to build yet'}
      </Button>
      {readout.screenable ? (
        <p className="-mt-2 px-1 text-mini leading-relaxed text-ink-muted">
          Builds and screens it now. Everything still open becomes a named gap on the case rather than a blocker, and
          anything you left as an inference is written onto the case notes.
        </p>
      ) : null}
    </div>
  );
}
