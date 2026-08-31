/**
 * Named government portals as sittings, not scrapers.
 *
 * A Karnataka EC, RTC, khata or Fire NOC lives behind login/CAPTCHA/OTP.
 * The product names the authority, opens the sitting, and waits for a person
 * to attach the download. Matching a check to a connector is how that sitting
 * appears; fetching the portal is not.
 */

import { DD_CONNECTORS, type DdConnector } from '../dd-connectors';

const ALIASES: Array<{ keys: string[]; test: RegExp }> = [
  { keys: ['kaveri_ec', 'kaveri_cc'], test: /\bkaveri\b|\bencumbrance\b|\bform\s*15|\bform\s*16|\bcertified cop/i },
  { keys: ['kaveri_gv'], test: /\bguidance value\b|\bstamp duty\b|\bcircle rate\b/i },
  { keys: ['bhoomi', 'mutation_register'], test: /\bbhoomi\b|\brtc\b|\bpahani\b|\brecord of rights\b|\bmutation\b/i },
  { keys: ['ekhata'], test: /\bkhata\b|\be-?aasthi\b|\be-?khata\b/i },
  { keys: ['survey_settlement', 'dishaank'], test: /\bmojini\b|\bdishaank\b|\btippani\b|\bsurvey (sketch|map)\b/i },
  { keys: ['krera', 'krera_updates'], test: /\brera\b|\bk-?rera\b/i },
  { keys: ['cersai'], test: /\bcersai\b/i },
  { keys: ['ecourts'], test: /\becourts?\b|\blitigation\b|\bcause list\b/i },
  { keys: ['fire_noc'], test: /\bfire noc\b|\bfire (and|&) emergency\b|\bfire (and|&) life/i },
  { keys: ['kspcb'], test: /\bkspcb\b|\bcfe\b|\bcfo\b|\bpollution\b|\benvironmental clearance\b/i },
  { keys: ['ceig'], test: /\bceig\b|\blift licence\b/i },
  { keys: ['bbmp_tax'], test: /\bproperty tax\b|\bbbmp tax\b/i },
  { keys: ['bbmp_plan'], test: /\bsanction(ed)? plan\b|\bbbmp plan\b|\bbda plan\b/i },
  { keys: ['bda_rmp'], test: /\bmaster plan\b|\btown plan\b|\brmp\b|\bland-?use\b|\bzoning (certificate|map|overlay|regulations?)?\b|\bpermitted (land )?use\b/i },
  { keys: ['bbmp_gis'], test: /\bbbmp gis\b|\bgis viewer\b|\bbbmp (ward|lake) map\b/i },
  { keys: ['bmrda_maps'], test: /\bbmrda maps?\b|\blpa (map|sheet|plan)\b|\bkanakapura (plan|map|lpa)\b/i },
  { keys: ['aai_nocas'], test: /\bnocas\b|\bheight clearance\b|\baai\b/i },
];

/** Hosts we will not fetch, even with a VPN — CAPTCHA, OTP, or session. */
const GATED_HOSTS = [
  'kaveri.karnataka.gov.in',
  'kaverionline.karnataka.gov.in',
  'igr.karnataka.gov.in',
  'landrecords.karnataka.gov.in',
  'bhoomi.karnataka.gov.in',
  'bbmpeaasthi.karnataka.gov.in',
  'bbmptax.karnataka.gov.in',
  'bbmp.gov.in',
  'ksfes.karnataka.gov.in',
];

export const CONNECTOR_ALIASES = ALIASES;

export function connectorIsGated(connector: DdConnector): boolean {
  if (!connector.url) return true;
  const host = connector.url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
  if (!host) return true;
  return GATED_HOSTS.some((g) => host === g || host.endsWith(`.${g}`));
}

export function connectorsMatchingText(...parts: string[]): DdConnector[] {
  const title = parts[0] ?? '';
  const purpose = parts[1] ?? '';
  const rest = parts.slice(2).join(' \n ');
  const hay = parts.filter(Boolean).join(' \n ');
  if (!hay.trim()) return [];
  const scored = new Map<string, number>();
  for (const row of ALIASES) {
    let score = 0;
    if (title && row.test.test(title)) score += 8;
    if (purpose && row.test.test(purpose)) score += 4;
    if (rest && row.test.test(rest)) score += 2;
    if (!score && row.test.test(hay)) score += 1;
    if (!score) continue;
    for (const key of row.keys) scored.set(key, Math.max(scored.get(key) ?? 0, score));
  }
  const keys = [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  const byKey = new Map(DD_CONNECTORS.map((c) => [c.key, c]));
  return keys.map((key) => byKey.get(key)).filter((c): c is DdConnector => Boolean(c));
}

export function portalForCheck(check: { title: string; purpose?: string; expectedEvidence?: string[] }): DdConnector | undefined {
  const rows = connectorsMatchingText(check.title, check.purpose ?? '', ...(check.expectedEvidence ?? []));
  return rows[0];
}

const VIEWER_KEYS = new Set(['bbmp_gis', 'bmrda_maps']);

export function portalObtainLine(connector: DdConnector): string {
  const where = connector.url ? `Open ${connector.label} (${connector.url})` : `Obtain ${connector.label}`;
  if (VIEWER_KEYS.has(connector.key)) {
    return `${where}. ${connector.route} We do not scrape this viewer.`;
  }
  return `${where}. ${connector.route} Download after login/OTP if asked, then attach the file on this check. We do not scrape this portal.`;
}

export function wantsPortalObtain(question: string): boolean {
  return (
    /\b(download|obtain|collect|fetch|pull|get|open) (the )?(portal|file|extract|noc|ec|rtc|khata|deed|copy)?\b/i.test(question)
    || /\bfrom (kaveri|bhoomi|e-?khata|e-?aasthi)\b/i.test(question)
    || /\bhow do i (get|download|obtain)\b/i.test(question)
    || /\bopen (the )?portal\b/i.test(question)
    || /\b(master plan|zoning certificate|rmp sheet|plan sheet)\b/i.test(question)
  );
}
