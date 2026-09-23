/**
 * A chat card, as the person confirmed it.
 *
 * A proposal is a draft. The wizard opens one, the person corrects it, and
 * what comes back is what should be filed — so the confirmed values are
 * written onto the stored proposal before it is applied, and the card
 * afterwards records what actually went in rather than what was suggested.
 *
 * What may not come back is the card's SUBJECT. Identity keys say which
 * record is being acted on and which file is attached: the storage key of an
 * upload, the check a reading belongs to, the report a paragraph is being
 * inserted into, the drafts a batch commits. Those were decided when the card
 * was raised, from the file and the conversation. Accepting them from the
 * request would turn "correct this title" into a way to address any row on
 * any project the caller can open — the request already names a proposal, and
 * the proposal already names its subject, so there is nothing a second copy
 * could add except a way for the two to disagree.
 *
 * Values are the person's. Subjects are the card's.
 */
export const PROPOSAL_IDENTITY: ReadonlySet<string> = new Set([
  'assetId',
  'assessmentId',
  'blockId',
  'checkId',
  'checkIds',
  'draftIds',
  'evidenceId',
  'mimeType',
  'proposalId',
  'reportId',
  'scopeInstanceIds',
  'sizeBytes',
  'storageKey',
  'subject',
]);

/**
 * Writes the confirmed values onto the stored payload, in place.
 *
 * In place because the proposal is the record of what was filed: a card read
 * back after committing should show the title that reached the register, not
 * the one the model offered.
 */
export function applyReviewedPayload(
  stored: Record<string, unknown>,
  confirmed: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!confirmed) return stored;
  for (const [key, value] of Object.entries(confirmed)) {
    if (PROPOSAL_IDENTITY.has(key)) continue;
    stored[key] = value;
  }
  return stored;
}
