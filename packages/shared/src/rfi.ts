/**
 * The RFI generator: the gap IS the request.
 *
 * Every workboard already states what is missing — the technical checklist's
 * unmarked items, the completeness list's absent documents, the constraint
 * questions nobody has answered. This module turns exactly that list, and
 * nothing else, into a ready-to-send request: what is asked for, from whom,
 * and the absence that evidences the ask. Deterministic — no model call —
 * because a request list is an enumeration of recorded gaps, and a model
 * paraphrasing one can only add items the case cannot back.
 *
 * "From whom" is deliberately coarse: the owner/seller side for project and
 * title papers, the site team for observations. Which AUTHORITY issues a
 * missing record is the connector registry's knowledge (dd-connectors.ts)
 * and the request text points there rather than duplicating it.
 */

import type { PropertyCase, TechnicalSystem } from './types';
import { SITE_CONSTRAINT_KEYS } from './packs/karnataka';
import { TECHNICAL_SYSTEM_LABEL, technicalDocumentGaps } from './technical-diligence';
import { domainForCheck, domainForSystem, domainsForDocumentKind } from './dd-domains';
import type { DdDomain } from './dd-domains';

export interface RfiItem {
  /** What is being asked for. */
  what: string;
  /** Who is asked. */
  fromWhom: string;
  /** The recorded absence that evidences the ask. */
  why: string;
  domain: DdDomain;
}

export interface RfiDocument {
  caseLabel: string;
  generatedAt: string;
  /** Set when the request was drawn for one department only. */
  domain?: DdDomain;
  items: RfiItem[];
  /** The ready-to-send plain text a person reviews, edits and sends themselves. */
  text: string;
}

const OWNER_SIDE = 'Owner / seller side';
const SITE_SIDE = 'Site team';

function technicalItems(caseData: PropertyCase): RfiItem[] {
  const provided = caseData.technicalDocumentsProvided;
  const phases = ['built', 'proposed'] as const;
  const out: RfiItem[] = [];
  for (const phase of phases) {
    for (const item of technicalDocumentGaps(phase, provided)) {
      out.push({
        what: item.label,
        fromWhom: OWNER_SIDE,
        why: `Not on the technical DD checklist as received (${TECHNICAL_SYSTEM_LABEL[item.system as TechnicalSystem]}).`,
        domain: domainForSystem(item.system),
      });
    }
  }
  return out;
}

function completenessItems(caseData: PropertyCase): RfiItem[] {
  const items = caseData.result?.completeness.items ?? [];
  return items
    .filter(item => item.required && !item.present)
    .map(item => ({
      what: item.label,
      fromWhom: OWNER_SIDE,
      why: 'Required for this property and state; not on file. Where the owner cannot supply it, the Connectors panel names the issuing authority and the counter route.',
      domain: domainsForDocumentKind(item.satisfiedBy[0] ?? 'other')[0] ?? 'legal',
    }));
}

function constraintItems(caseData: PropertyCase): RfiItem[] {
  const checks = caseData.result?.stateCompliance?.checks ?? [];
  return checks
    .filter(check => check.verdict === 'unknown' && (SITE_CONSTRAINT_KEYS as readonly string[]).includes(check.key))
    .map(check => ({
      what: `An answer to: ${check.label}`,
      fromWhom: SITE_SIDE,
      why: 'Declared neither way on the case, so the check cannot conclude.',
      domain: domainForCheck(check.key),
    }));
}

function renderText(caseLabel: string, generatedAt: string, items: RfiItem[], domain?: DdDomain): string {
  const lines: string[] = [
    `Request for information — ${caseLabel}`,
    `Drawn ${generatedAt.slice(0, 10)}${domain ? ` · ${domain} department` : ''} from the gaps recorded on the case.`,
    '',
  ];
  const groups = [...new Set(items.map(i => i.fromWhom))];
  for (const group of groups) {
    const grouped = items.filter(i => i.fromWhom === group);
    lines.push(`${group}:`);
    grouped.forEach((item, i) => {
      lines.push(`  ${i + 1}. ${item.what}`);
      lines.push(`     Why: ${item.why}`);
    });
    lines.push('');
  }
  lines.push(
    'Each item above corresponds to a gap recorded on the diligence file as at the date drawn; nothing is requested that the file does not show as missing.',
  );
  return lines.join('\n');
}

/**
 * The case's open gaps as one request document. `domain` narrows to one
 * department's asks; `now` is the caller's clock, so the same case and date
 * always draw the same request.
 */
export function buildRfi(caseData: PropertyCase, options: { now: string; domain?: DdDomain }): RfiDocument {
  const all = [...technicalItems(caseData), ...completenessItems(caseData), ...constraintItems(caseData)];
  const items = options.domain ? all.filter(i => i.domain === options.domain) : all;
  const caseLabel = caseData.identity.label;
  return {
    caseLabel,
    generatedAt: options.now,
    domain: options.domain,
    items,
    text: renderText(caseLabel, options.now, items, options.domain),
  };
}
