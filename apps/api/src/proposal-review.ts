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
  // Where on a document each value was read. Decided when the card was
  // raised; a person corrects values, not the page a document says them on.
  'citations',
  'draftIds',
  'evidenceId',
  // What this server and a model read off the file, each value with who read
  // it and what stands behind it. A person corrects a value where it waits on
  // its row, and the row records that they did. Taken from a request, a
  // model's reading could come back as one the rules made, and stand at once.
  'facts',
  'mimeType',
  // On a site entry read from a voice note: which note it is, and the id that files it once. The lines are the person's to correct.
  'note',
  'clientId',
  // Whether a model read the file. This server's record of its own work.
  'modelRead',
  'proposalId',
  // How much of the file was read, by which reader, and what was sent to a
  // model: this server's record of its own reading, and nobody's to send.
  'reading',
  'reportId',
  'scopeInstanceIds',
  'sizeBytes',
  'storageKey',
  'subject',
  // Where a card that files a document under a function would put it. The card was raised and titled for one place, and whoever
  // accepts it accepts that. Sent with an accept, another place would be a move nobody was shown.
  'workstream',
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

/**
 * Put a person's corrections on a card for the commit that is about to read
 * it, and take them off again if that commit does not happen.
 *
 * The corrections are written first because the commit works from the card.
 * But they belong to that commit. One that is refused, that fails, or that
 * leaves the card waiting with nothing on it decided was not made with them,
 * and left on the card they would be carried out later by whoever accepts it
 * as it is titled. So `settle` is called once the commit has been tried,
 * however it went: where the card still waits exactly as it was corrected, it
 * is put back exactly as it was raised. A card the commit filed, or decided in
 * part, keeps what went in.
 */
export function reviewCard(
  card: { status: string; payload: Record<string, unknown> },
  confirmed: Record<string, unknown> | undefined,
): { settle: () => void } {
  const raised = structuredClone(card.payload);
  applyReviewedPayload(card.payload, confirmed);
  const corrected = JSON.stringify(card.payload);
  return {
    settle: () => {
      if (card.status !== 'proposed' || JSON.stringify(card.payload) !== corrected) return;
      for (const key of Object.keys(card.payload)) delete card.payload[key];
      Object.assign(card.payload, raised);
    },
  };
}
