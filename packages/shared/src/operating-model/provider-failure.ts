/**
 * What went wrong with a model call, in a word a person can act on.
 *
 * Provider errors are written for whoever is on call: an HTTP status, a JSON
 * body, a `request_id`, sometimes a Zod dump naming `fields[6].unit`. None of
 * that belongs in a diligence file's chat, but the FACT of the failure very
 * much does — and the failure mode this module exists to prevent is the one
 * where it silently does not.
 *
 * Twice now the same shape has cost a person their trust in an answer. An
 * upload whose parse was rate limited rendered the provider's 400 body where
 * a summary of the deed belonged, and four documents were filed on the back of
 * it. A question the copilot could not reach fell through to the day's
 * standing briefing, so "what would a buyer pay for this?" was answered with
 * an unrelated finding about an agricultural pocket, in the same confident
 * voice as a real answer.
 *
 * Both are the same bug: a failure wearing the clothes of a result. The cause
 * is classified here, once, and each caller writes its own sentence — a
 * document reader and a copilot fail for the same reasons but do not say so
 * in the same words.
 */

export type FailureCause =
  /** The provider throttled us. Trying again later is the whole remedy. */
  | 'rate_limited'
  /** No model endpoint or key on this deployment. An operator fixes it, not the user. */
  | 'unconfigured'
  /** The provider could not read the file it was handed. */
  | 'unreadable'
  /** The model answered, but not in the shape the app requires. */
  | 'malformed'
  /** The file type is not one the reader accepts at all. */
  | 'unsupported'
  /** No answer inside the time allowed. */
  | 'timeout'
  /** Something else. Deliberately last: a specific cause must be matched first. */
  | 'unknown';

/**
 * Classify a raw provider error.
 *
 * Ordered from most specific to least. `unconfigured` is tested before the
 * credential words because "No model endpoint is configured (set
 * REALYTICA_API_KEY…)" mentions a key while being a deployment problem, not
 * an authorisation one.
 */
export function failureCause(raw: string | undefined | null): FailureCause {
  const text = (raw ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (/no model endpoint|not configured|unavailable on this deployment/.test(text)) return 'unconfigured';
  if (/rate limit|429|too many requests|quota/.test(text)) return 'rate_limited';
  if (/failed to parse|could not parse|parsing engine|corrupt/.test(text)) return 'unreadable';
  if (/schema validation|invalid_type|failed schema|expected .* received/.test(text)) return 'malformed';
  if (/only reads pdfs|unsupported|not supported/.test(text)) return 'unsupported';
  if (/timeout|timed out|etimedout|econnreset|socket hang up/.test(text)) return 'timeout';
  if (/credential|api[_ ]key|unauthor|401|403/.test(text)) return 'unconfigured';
  return 'unknown';
}

/**
 * Why the copilot did not answer a question, and what the person can do.
 *
 * Second person and no jargon: whoever is reading this asked a question and
 * did not get an answer, and the only useful information is whether waiting
 * helps or somebody has to change a setting.
 */
export function unansweredReason(cause: FailureCause): string {
  switch (cause) {
    case 'rate_limited':
      return 'I could not answer that — the model is rate limited just now. Ask again in a minute.';
    case 'unconfigured':
      return 'I cannot answer questions on this deployment — no model endpoint is configured.';
    case 'timeout':
      return 'I could not answer that in time.';
    case 'malformed':
      return 'I could not answer that — the model returned something unusable.';
    default:
      return 'I could not answer that.';
  }
}

/**
 * Is this text a provider's error rather than something read out of a document?
 *
 * Needed because the two shared a field. A rate-limited parse wrote its HTTP
 * body into `extractionNotes`, the card rendered it as though it were a summary
 * of the deed, and approving filed it onto the evidence row — so projects on
 * disk carry notes like `Request rejected: 400 {"type":"error"…"request_id":…}`
 * against a perfectly real NOC. New uploads cannot do this any more; these are
 * the ones already written.
 *
 * Deliberately conservative. It matches STRUCTURE a machine emits and a
 * Karnataka title document does not — a JSON error envelope, a validator's
 * path dump, an HTTP status introduced by a rejection verb — never a topic
 * word. Clearing a real extraction note would destroy the only record of what
 * a document said, which is far worse than leaving an ugly one in place, so
 * every pattern here has to be wrong on purpose to fire.
 */
export function looksLikeProviderError(text: string | undefined | null): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return (
    /\{\s*"(type|error|code|message)"\s*:/.test(t)
    || /"(request_id|invalid_request_error|invalid_type)"/.test(t)
    || /\b(request|call) (rejected|failed)\b[^.]{0,40}\b[45]\d{2}\b/i.test(t)
    || /model output failed schema validation/i.test(t)
    || /no model endpoint is configured/i.test(t)
    || /"path"\s*:\s*\[/.test(t)
  );
}
