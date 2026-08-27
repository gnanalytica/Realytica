import { useState } from 'react';
import { ClipboardList, Copy } from 'lucide-react';
import type { AssessmentProfile } from '@realytica/shared';
import { Button, Modal, useToast } from './ui/kit';
import { DOCUMENT_KIND_LABEL, titleCase } from '../lib/format';

/**
 * The profile in force, as a sheet the reader can hand to whoever holds the
 * documents.
 *
 * Every requirement here is read from the assessment profile — nothing is
 * authored in this component, so the sheet can never promise a document the
 * assessment does not actually depend on. The copy button is the point: a
 * requirement list's job is to leave this product and arrive in a seller's,
 * lawyer's or client's inbox, and plain text is what survives that journey.
 */

/** What each critical check asks, in the words a document-holder understands. */
const CHECK_LABEL: Record<string, string> = {
  title_chain: 'Chain of title established, root to present holder',
  encumbrance: 'Encumbrance certificate continuity over the examined period',
  land_conversion: 'Agricultural-to-non-agricultural conversion order',
  khata_classification: 'Khata classification (A / B / e-khata)',
  acquisition_notification: 'No acquisition notification over the survey number',
  layout_approval: 'Layout approval by the competent authority',
  rajakaluve_buffer: 'Rajakaluve (storm-water drain) buffer clearance',
  lake_buffer: 'Lake buffer clearance',
  far_headroom: 'FAR headroom against what is already built',
  road_width: 'Abutting road width supports the intended FAR',
  aerodrome_height: 'Aerodrome height restriction clearance',
  rera_registration: 'RERA registration of the project',
  setback_compliance: 'Setback compliance of the sanctioned scheme',
  zoning_permitted_use: 'Zoning permits the intended use',
  parking_provision: 'Parking provision meets the norm for the use',
  fire_noc: 'Fire NOC current and matching the built configuration',
  pollution_consent: 'Pollution-control consent for the intended operation',
  occupancy_certificate: 'Occupancy certificate matching what stands',
  property_tax: 'Property tax assessed and paid up to date',
  jda_terms: 'JDA terms: deposit, timelines, penalties, termination',
  power_of_attorney: 'Power of attorney backing the developer’s signature',
};

function checkLabel(key: string): string {
  return CHECK_LABEL[key] ?? titleCase(key);
}

export function RequirementSheet({ profile, reference }: { profile: AssessmentProfile; reference: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const copyText = (): string =>
    [
      `Requirement sheet — ${profile.label} (${reference})`,
      '',
      profile.headlineQuestion,
      '',
      'Documents required:',
      ...profile.requiredDocuments.map(kind => `  [ ] ${DOCUMENT_KIND_LABEL[kind]}`),
      '',
      'Checks the conclusion depends on:',
      ...profile.criticalChecks.map(key => `  [ ] ${checkLabel(key)}`),
      '',
      'What decides the answer:',
      ...profile.decisionBasis.map(basis => `  - ${basis}`),
      '',
      'Copies or scans are fine. Missing items are findings, not failures — send what exists.',
    ].join('\n');

  const copy = () => {
    navigator.clipboard
      .writeText(copyText())
      .then(() => toast('Requirement sheet copied — paste it into an email or message', 'good'))
      .catch(() => toast('Could not copy — clipboard unavailable', 'critical'));
  };

  return (
    <>
      <Button variant="ghost" size="sm" icon={<ClipboardList size={13} />} onClick={() => setOpen(true)}>
        Requirement sheet
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Requirement sheet — ${profile.label}`}>
        <div className="flex flex-col gap-4 text-[13px] leading-relaxed">
          <p className="text-ink-secondary">{profile.headlineQuestion}</p>
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Documents required</h4>
            <ul className="mt-1.5 space-y-1">
              {profile.requiredDocuments.map(kind => (
                <li key={kind} className="flex gap-2 text-ink-secondary">
                  <span aria-hidden="true" className="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-[3px] border border-ink-faint" />
                  {DOCUMENT_KIND_LABEL[kind]}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Checks the conclusion depends on</h4>
            <ul className="mt-1.5 space-y-1">
              {profile.criticalChecks.map(key => (
                <li key={key} className="flex gap-2 text-ink-secondary">
                  <span aria-hidden="true" className="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-[3px] border border-ink-faint" />
                  {checkLabel(key)}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-ink-muted">Copies or scans are fine. Missing items are findings, not failures — ask for what exists.</p>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" icon={<Copy size={13} />} onClick={copy}>
              Copy as text
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
