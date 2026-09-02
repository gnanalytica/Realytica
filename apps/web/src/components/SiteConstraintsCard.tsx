import { useMemo, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import type { ComplianceCheck, PropertyCase, SiteConstraintDeclaration, SiteConstraintKey, ConstraintPresence } from '@realytica/shared';
import { DECLARABLE_SITE_CONSTRAINTS } from '@realytica/shared';
import { api } from '../lib/api';
import { Button, Card, CardBody, CardHeader, Input, useToast } from './ui/kit';

/**
 * Where a user answers the constraint questions the documents never will.
 *
 * Placed with the checks it feeds rather than in the identity editor, because
 * the useful moment is the one where the reader has just seen five findings
 * saying "nobody has looked at this" and wants to record that somebody now
 * has. A form three screens away, behind an Edit button on a different tab,
 * is a form nobody fills in.
 *
 * `airport_height` is deliberately absent. It is computed from the property's
 * location, and offering it here would invite someone to overrule a measured
 * distance with a guess.
 *
 * The three states are the point. "Not checked" is the honest default and the
 * engine reports it as a finding; "Doesn't apply" is a *negative recorded on
 * the case*, which the check says out loud rather than treating as a search
 * result. The control never collapses those two into one.
 */

const PRESENCE_OPTIONS: { value: ConstraintPresence; label: string; hint: string }[] = [
  { value: 'unknown', label: 'Not checked', hint: 'Nobody has established this either way.' },
  { value: 'absent', label: "Doesn't apply", hint: 'Checked, and it does not affect this parcel.' },
  { value: 'present', label: 'Applies', hint: 'It does affect this parcel.' },
];

function declarationsOf(caseData: PropertyCase): Record<string, SiteConstraintDeclaration> {
  const out: Record<string, SiteConstraintDeclaration> = {};
  for (const declaration of caseData.identity.karnataka?.siteConstraints ?? []) out[declaration.key] = declaration;
  return out;
}

export function SiteConstraintsCard({
  caseData,
  checks,
  refresh,
}: {
  caseData: PropertyCase;
  checks: ComplianceCheck[];
  refresh: () => Promise<void>;
}) {
  const initial = useMemo(() => declarationsOf(caseData), [caseData]);
  const [draft, setDraft] = useState<Record<string, SiteConstraintDeclaration>>(initial);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // The label and the "what to obtain" line come off the checks themselves,
  // not from a second copy in the UI — so what is offered here can never
  // describe something different from what is checked.
  const byKey = useMemo(() => new Map(checks.map(c => [c.key, c])), [checks]);
  const rows = DECLARABLE_SITE_CONSTRAINTS.map(key => ({ key, check: byKey.get(key) })).filter(
    (row): row is { key: SiteConstraintKey; check: ComplianceCheck } => row.check !== undefined,
  );

  if (rows.length === 0 || !caseData.identity.karnataka) return null;

  const dirty = DECLARABLE_SITE_CONSTRAINTS.some(
    key => (draft[key]?.presence ?? 'unknown') !== (initial[key]?.presence ?? 'unknown') || (draft[key]?.note ?? '') !== (initial[key]?.note ?? ''),
  );

  const set = (key: SiteConstraintKey, patch: Partial<SiteConstraintDeclaration>) => {
    setDraft(d => ({ ...d, [key]: { ...d[key], key, presence: d[key]?.presence ?? 'unknown', ...patch } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      // Only non-default declarations are stored. Persisting a wall of
      // "unknown" would make a case that has been through this form look
      // different in the data from one that has not, when they say the same
      // thing.
      const siteConstraints = DECLARABLE_SITE_CONSTRAINTS.map(key => draft[key])
        .filter((d): d is SiteConstraintDeclaration => d !== undefined && d.presence !== 'unknown')
        .map(d => ({ key: d.key, presence: d.presence, ...(d.note?.trim() ? { note: d.note.trim() } : {}) }));
      await api.updateCase(caseData.id, {
        identity: { ...caseData.identity, karnataka: { ...caseData.identity.karnataka!, siteConstraints } },
      });
      await refresh();
      toast('Site constraints saved. Re-run the screen to apply them.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save.', 'critical');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="What else restricts this parcel"
        icon={<Landmark size={16} />}
        action={
          <Button variant="primary" size="sm" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <p className="m-0 text-[13px] leading-relaxed text-ink-secondary">
          A transmission corridor, a highway control line or a quarry lease is somebody else&rsquo;s right over land whose
          title is otherwise perfect. None of them is in the paperwork, so the screen cannot find them — it can only ask,
          and report honestly that nobody has answered.
        </p>

        {rows.map(({ key, check }) => {
          const presence = draft[key]?.presence ?? 'unknown';
          return (
            <div key={key} className="border-b border-hairline pb-4 last:border-0 last:pb-0">
              {/* No status badge: the selected button below already says it, and
                  two copies of "Not checked" on one row is noise. */}
              <span className="text-[13px] font-medium text-ink">{check.label}</span>

              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={check.label}>
                {PRESENCE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={presence === option.value}
                    title={option.hint}
                    onClick={() => set(key, { presence: option.value })}
                    className={
                      'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                      (presence === option.value
                        ? option.value === 'present'
                          ? 'bg-serious text-white'
                          : option.value === 'absent'
                            ? 'bg-good text-white'
                            // "Not checked" is the default, not a decision.
                            // Filling it with the brand colour makes an
                            // unanswered question look answered, which is the
                            // one thing this control exists to prevent.
                            : 'bg-sunken text-ink ring-1 ring-inset ring-[var(--ring)]'
                        : 'bg-sunken text-ink-secondary hover:text-ink')
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {presence !== 'unknown' && (
                <Input
                  className="mt-2"
                  placeholder={presence === 'present' ? 'Which line, which highway, how far — whatever is known' : 'Who confirmed it, and from what record'}
                  value={draft[key]?.note ?? ''}
                  onChange={e => set(key, { note: e.target.value })}
                />
              )}

              <p className="m-0 mt-1.5 text-[12px] leading-relaxed text-ink-muted">{check.nextStep}</p>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
