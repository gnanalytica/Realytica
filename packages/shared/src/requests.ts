/**
 * The request tracker — what we have asked for, of whom, and whether it came.
 *
 * `buildRfi` computes what a department is OWED; this module is about what
 * was ASKED. The distinction is the whole point: a gap recomputes on every
 * read and disappears the moment evidence exists, but a request happened on a
 * date, to a person, and can still be outstanding after the gap closed some
 * other way. Deriving requests from gaps would lose all three.
 *
 * Everything here is pure — no ids minted, no clock read. The caller supplies
 * both, as it does everywhere else in this package.
 */

import type { CaseRequest, PropertyCase, RequestRecipient, RequestStatus } from './types';
import type { DdDomain } from './dd-domains';
import { DD_DOMAIN_PROFILES } from './dd-domains';
import { buildRfi } from './rfi';

export const REQUEST_RECIPIENT_LABEL: Record<RequestRecipient, string> = {
  vendor: 'Vendor',
  vendor_advocate: "Vendor's advocate",
  site_team: 'Site team',
  authority: 'Authority',
  internal: 'Internal',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  open: 'Open',
  sent: 'Sent',
  answered: 'Answered',
  withdrawn: 'Withdrawn',
};

/** A request still being waited on. Withdrawn and answered ones are settled. */
export function isOutstanding(request: CaseRequest): boolean {
  return request.status === 'open' || request.status === 'sent';
}

/**
 * Overdue means a due date has passed on something still outstanding.
 * A request with no due date is never overdue — an undated ask is a request
 * nobody promised a date for, and calling it late would be inventing one.
 */
export function isOverdue(request: CaseRequest, now: string): boolean {
  if (!isOutstanding(request) || !request.dueAt) return false;
  const due = Date.parse(request.dueAt);
  return Number.isFinite(due) && due < Date.parse(now);
}

export interface RequestSummary {
  total: number;
  outstanding: number;
  overdue: number;
  answered: number;
  /** Outstanding requests per department, for the rail's badges. */
  outstandingByDomain: Record<string, number>;
}

export function summariseRequests(requests: CaseRequest[], now: string): RequestSummary {
  const outstandingByDomain: Record<string, number> = {};
  let outstanding = 0;
  let overdue = 0;
  let answered = 0;
  for (const r of requests) {
    if (r.status === 'answered') answered += 1;
    if (isOutstanding(r)) {
      outstanding += 1;
      outstandingByDomain[r.domain] = (outstandingByDomain[r.domain] ?? 0) + 1;
      if (isOverdue(r, now)) overdue += 1;
    }
  }
  return { total: requests.length, outstanding, overdue, answered, outstandingByDomain };
}

/** Sort for display: overdue first, then outstanding, then by department. */
export function orderRequests(requests: CaseRequest[], now: string): CaseRequest[] {
  const rank = (r: CaseRequest): number => (isOverdue(r, now) ? 0 : isOutstanding(r) ? 1 : r.status === 'answered' ? 2 : 3);
  return [...requests].sort(
    (a, b) => rank(a) - rank(b) || a.domain.localeCompare(b.domain) || a.what.localeCompare(b.what) || a.id.localeCompare(b.id),
  );
}

export interface RequestDraft {
  domain: DdDomain;
  what: string;
  why: string;
  recipient: RequestRecipient;
  originGapId?: string;
}

/**
 * The gaps a department is owed that nobody has asked for yet.
 *
 * This is what makes the tracker and the gap list agree rather than compete:
 * a gap already covered by an outstanding request is not offered again, so
 * nobody chases the same document twice, and closing the request does not
 * make the gap silently reappear as un-asked.
 *
 * Matching is on `originGapId` where the request carries one, falling back to
 * the request text — a request typed by hand for the same thing still counts
 * as having asked.
 */
export function unaskedGaps(propertyCase: PropertyCase, domain: DdDomain, now: string): RequestDraft[] {
  const asked = new Set<string>();
  for (const r of propertyCase.requests ?? []) {
    if (!isOutstanding(r) && r.status !== 'answered') continue;
    if (r.originGapId) asked.add(`gap:${r.originGapId}`);
    asked.add(`what:${r.what.trim().toLowerCase()}`);
  }

  const rfi = buildRfi(propertyCase, { now, domain });
  const out: RequestDraft[] = [];
  for (const item of rfi.items) {
    if (asked.has(`what:${item.what.trim().toLowerCase()}`)) continue;
    out.push({
      domain,
      what: item.what,
      why: item.why,
      // The RFI's coarse "from whom" maps onto the recipient vocabulary; a
      // site observation is the team's, everything else starts with the vendor
      // and is re-addressed by whoever sends it.
      recipient: item.fromWhom === 'Site team' ? 'site_team' : 'vendor',
    });
  }
  return out;
}

/** The request list as the plain text a person reviews and sends themselves. */
export function renderRequestList(requests: CaseRequest[], caseLabel: string, now: string): string {
  const outstanding = orderRequests(requests.filter(isOutstanding), now);
  const lines: string[] = [`Request for information — ${caseLabel}`, `As at ${now.slice(0, 10)}`, ''];
  const recipients = [...new Set(outstanding.map(r => r.recipient))];
  for (const recipient of recipients) {
    lines.push(`${REQUEST_RECIPIENT_LABEL[recipient]}:`);
    outstanding
      .filter(r => r.recipient === recipient)
      .forEach((r, i) => {
        const dept = DD_DOMAIN_PROFILES[r.domain as DdDomain]?.label ?? r.domain;
        lines.push(`  ${i + 1}. ${r.what}  [${dept}]`);
        lines.push(`     Why: ${r.why}`);
      });
    lines.push('');
  }
  if (outstanding.length === 0) lines.push('Nothing outstanding.', '');
  lines.push('Each item corresponds to a gap recorded on the diligence file; nothing is requested that the file does not show as missing.');
  return lines.join('\n');
}
