/**
 * Chain-of-title reconstruction: walking the graph's instruments into an
 * ordered sequence of conveyances, and naming every place the sequence does
 * not actually join up.
 *
 * The distinction this module exists to enforce is between a document being
 * *present* and the chain being *established*. A flat completeness score says
 * "mother deed: on file" and moves on. A chain says: the mother deed is on
 * file, it carries no execution date, so it cannot be placed in sequence, so
 * the thirty years Karnataka practice examines are not established — which is
 * the finding a buyer's lawyer would actually make.
 *
 * Two judgements are load-bearing and both are deliberate.
 *
 * **Only conveyances are links.** An agreement to sell and a lease are
 * instruments and belong in the graph, but neither passes title. Treating an
 * agreement to sell as a link is the commonest way a chain is read wrongly —
 * it makes an unconveyed property look owned — so `conveysOwnership` gates
 * entry to the chain and a case holding only an agreement gets `no_root`
 * rather than a one-link chain.
 *
 * **A gap the documents cannot rule out is not the same as a gap they prove.**
 * Where a grantor is simply unrecorded, this module does not assert a
 * discontinuity; it reports what is missing. `party_discontinuity` is reserved
 * for the case where two consecutive instruments name parties that genuinely
 * fail to meet, because that finding is strong enough to stop a transaction
 * and must not be produced by an absence.
 */

import type { ChainBreak, ChainBreakKind, ChainLink, RiskSeverity, TitleChain, TitleEdge, TitleGraph, TitleNode } from '../types';
import { REMEDIES, severityRank, stableDigest } from './ontology';

/** Mean Gregorian year. Chain spans are quoted to a tenth of a year, so leap-year drift matters. */
const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

function yearsBetween(fromIso: string, toIso: string): number {
  return Math.round(((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_YEAR) * 10) / 10;
}

function attrString(node: TitleNode, key: string): string | undefined {
  const value = node.attributes[key];
  return typeof value === 'string' ? value : undefined;
}

function attrNumber(node: TitleNode, key: string): number | undefined {
  const value = node.attributes[key];
  return typeof value === 'number' ? value : undefined;
}

/** Lowercases only the leading character, so a label reads naturally mid-sentence without mangling an acronym. */
function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

function makeBreakId(kind: ChainBreakKind, parcelNodeId: string, discriminator: string): string {
  return `break-${kind}-${stableDigest(`${parcelNodeId}|${kind}|${discriminator}`, 8)}`;
}

/**
 * Reconstructs one chain per land parcel in the graph.
 *
 * Takes no clock: a chain's depth is the span between its own earliest and
 * latest instrument, not the span to today. Measuring to "now" would make the
 * same set of documents score differently next year, which is exactly the
 * kind of moving target the determinism rule exists to prevent.
 */
export function reconstructChains(graph: TitleGraph): TitleChain[] {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const edgesFrom = (id: string): TitleEdge[] => graph.edges.filter(e => e.fromNodeId === id);
  const edgesTo = (id: string): TitleEdge[] => graph.edges.filter(e => e.toNodeId === id);

  const landParcels = graph.nodes.filter(n => n.kind === 'parcel' && n.attributes.subject === 'land');

  // A parcel the builder judged to be another parcel under a different
  // spelling is folded into that other parcel rather than growing a chain of
  // its own — otherwise one property with two survey-number spellings would
  // report two half-chains, each looking broken.
  const foldedInto = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'identifies') continue;
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (from?.kind === 'parcel' && to?.kind === 'parcel') foldedInto.set(from.id, to.id);
  }

  const chains: TitleChain[] = [];

  for (const parcel of landParcels) {
    if (foldedInto.has(parcel.id)) continue;

    // Instruments affecting this parcel directly, or affecting any parcel
    // folded into it.
    const aliasIds = new Set<string>([parcel.id, ...[...foldedInto.entries()].filter(([, to]) => to === parcel.id).map(([from]) => from)]);
    const instrumentIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.kind !== 'affects' || !aliasIds.has(edge.toNodeId)) continue;
      const from = nodeById.get(edge.fromNodeId);
      if (from?.kind === 'instrument' && from.attributes.conveysOwnership === true) instrumentIds.add(from.id);
    }

    /* --- Links -------------------------------------------------------- */

    const links: ChainLink[] = [...instrumentIds]
      .map(id => nodeById.get(id))
      .filter((n): n is TitleNode => n !== undefined)
      .map(instrument => {
        const outgoing = edgesFrom(instrument.id);
        // Where an instrument names several grantees the first by node id is
        // taken, deterministically, so the ordering never depends on which
        // page the OCR read first. The others remain in the graph as edges.
        const grantee = outgoing
          .filter(e => e.kind === 'conveyed_to')
          .map(e => nodeById.get(e.toNodeId))
          .filter((n): n is TitleNode => n !== undefined)
          .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        const grantor = outgoing
          .filter(e => e.kind === 'conveyed_by')
          .map(e => nodeById.get(e.toNodeId))
          .filter((n): n is TitleNode => n !== undefined)
          .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        const areaEdge = outgoing.filter(e => e.kind === 'asserts_area' && aliasIds.has(e.toNodeId))[0];
        const extentSqm = typeof areaEdge?.attributes?.areaSqm === 'number' ? areaEdge.attributes.areaSqm : undefined;

        return {
          id: `link-${stableDigest(`${parcel.id}|${instrument.id}`, 8)}`,
          instrumentNodeId: instrument.id,
          label: instrument.label,
          at: attrString(instrument, 'instrumentDate'),
          fromPartyNodeId: grantor?.id,
          toPartyNodeId: grantee?.id,
          fromPartyLabel: grantor?.label,
          toPartyLabel: grantee?.label,
          documentId: attrString(instrument, 'documentId'),
          extentSqm,
          considerationAmount: attrNumber(instrument, 'consideration'),
        } satisfies ChainLink;
      })
      // Oldest first. An undated instrument sorts last because it cannot be
      // placed at all — putting it anywhere else would imply a position the
      // documents do not support. Node id breaks ties so the order is total.
      .sort((a, b) => {
        if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
        if (a.at && !b.at) return -1;
        if (!a.at && b.at) return 1;
        return a.instrumentNodeId < b.instrumentNodeId ? -1 : 1;
      });

    const dated = links.filter(l => l.at !== undefined);
    const rootAt = dated[0]?.at;
    const latestAt = dated[dated.length - 1]?.at;
    const yearsEstablished = rootAt && latestAt ? yearsBetween(rootAt, latestAt) : dated.length > 0 ? 0 : undefined;
    const yearsExpected = attrNumber(parcel, 'chainYearsExpected');

    /* --- Breaks ------------------------------------------------------- */

    const breaks: ChainBreak[] = [];
    const push = (kind: ChainBreakKind, discriminator: string, severity: RiskSeverity, statement: string, resolvedBy: string[], links?: { after?: string; before?: string }): void => {
      breaks.push({
        id: makeBreakId(kind, parcel.id, discriminator),
        kind,
        statement,
        afterLinkId: links?.after,
        beforeLinkId: links?.before,
        severity,
        resolvedBy,
      });
    };

    if (links.length === 0) {
      // A positive register (the Kadaster, and to a much weaker extent a
      // khata) evidences ownership on its own, so "no deed on file" is a
      // documentation gap there rather than an unproved title. In Karnataka
      // no register is conclusive of title, so the same absence is critical.
      const registerBacked = edgesTo(parcel.id).some(e => e.kind === 'asserts_area' && nodeById.get(e.fromNodeId)?.kind === 'authority');
      const nonConveying = graph.nodes.filter(
        n => n.kind === 'instrument' && n.attributes.conveysOwnership === false && edgesFrom(n.id).some(e => e.kind === 'affects' && aliasIds.has(e.toNodeId)),
      );
      const severity: RiskSeverity = yearsExpected !== undefined ? 'critical' : registerBacked ? 'warning' : 'serious';
      // The register-backed wording is confined to jurisdictions with no
      // expected chain span — which in practice means the Kadaster. Saying
      // that ownership "rests on the register extract" of a khata would be
      // actively wrong: a khata is a tax record and is not proof of title.
      const statement =
        registerBacked && yearsExpected === undefined
          ? `No deed of transfer is on file for ${parcel.label}; ownership rests on the register extract alone, so the chain of title has no documented root.`
          : nonConveying.length > 0
            ? `No instrument on file conveys title to ${parcel.label}: the ${lowerFirst(nonConveying[0].label)} on file does not itself pass title, so the chain of title has no root.`
            : `No instrument on file conveys title to ${parcel.label}, so the chain of title has no root.`;
      push(
        'no_root',
        'parcel',
        severity,
        statement,
        yearsExpected !== undefined
          ? [REMEDIES.registeredConveyance.obtain, REMEDIES.motherDeed.obtain, REMEDIES.thirtyYearEc.obtain]
          : [REMEDIES.registeredConveyance.obtain],
      );
    } else {
      /* Undated instruments — they cannot be placed, so they cannot be relied on. */
      for (const link of links) {
        if (link.at !== undefined) continue;
        const instrument = nodeById.get(link.instrumentNodeId);
        const fileName = instrument ? attrString(instrument, 'fileName') : undefined;
        push(
          'undated_instrument',
          link.instrumentNodeId,
          // Where a jurisdiction examines a fixed span, an undated link
          // document does not merely look untidy — it removes the years it
          // was supposed to cover from the established chain.
          yearsExpected !== undefined ? 'serious' : 'warning',
          `${link.label}${fileName ? ` (${fileName})` : ''} carries no execution date, so it cannot be placed in the chain of title for ${parcel.label}.`,
          [REMEDIES.motherDeed.obtain, REMEDIES.certifiedRegisteredCopies.obtain],
          { after: link.id },
        );
      }

      /* Consecutive dated links whose parties genuinely fail to meet. */
      for (let i = 1; i < dated.length; i += 1) {
        const previous = dated[i - 1];
        const current = dated[i];
        if (!previous.toPartyNodeId || !current.fromPartyNodeId) continue;
        if (previous.toPartyNodeId === current.fromPartyNodeId) continue;
        push(
          'party_discontinuity',
          `${previous.id}->${current.id}`,
          'critical',
          `The chain does not join: ${previous.toPartyLabel} took title under ${previous.label} on ${previous.at}, but ${current.label} of ${current.at} is conveyed by ${current.fromPartyLabel}, and no instrument on file carries title between them.`,
          [REMEDIES.intermediateConveyance.obtain, REMEDIES.thirtyYearEc.obtain],
          { after: previous.id, before: current.id },
        );
      }

      /* The root of the chain: is there anything behind it? */
      const root = links[0];
      const rootHasAntecedent = edgesFrom(root.instrumentNodeId).some(e => e.kind === 'derives_from' && nodeById.get(e.toNodeId)?.kind === 'instrument');
      if (!rootHasAntecedent) {
        const grantor = root.fromPartyLabel;
        push(
          'missing_predecessor',
          root.instrumentNodeId,
          'serious',
          grantor
            ? `Nothing on file explains how ${grantor} came to own ${parcel.label} before granting ${root.label}${root.at ? ` on ${root.at}` : ''} — the earliest instrument has no antecedent.`
            : `${root.label}${root.at ? ` of ${root.at}` : ''} is the earliest instrument on file for ${parcel.label} and nothing explains how its grantor came to own the parcel.`,
          [REMEDIES.motherDeed.obtain, REMEDIES.thirtyYearEc.obtain],
          { before: root.id },
        );
      }

      /* Depth against what the jurisdiction expects. */
      if (yearsExpected !== undefined && (yearsEstablished ?? 0) < yearsExpected) {
        const established = yearsEstablished ?? 0;
        const shortfall = yearsExpected - established;
        // Severity tracks the shortfall rather than the fact of it: a chain
        // twenty-eight years deep is a note, a chain of one instrument is not.
        const severity: RiskSeverity = shortfall >= 20 ? 'serious' : shortfall >= 10 ? 'warning' : 'info';
        push(
          'insufficient_depth',
          'depth',
          severity,
          `The dated instruments on file establish ${established} year${established === 1 ? '' : 's'} of title history for ${parcel.label}; Karnataka conveyancing practice examines a ${yearsExpected}-year chain.`,
          [REMEDIES.motherDeed.obtain, REMEDIES.thirtyYearEc.obtain],
        );
      }
    }

    breaks.sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity);
      if (bySeverity !== 0) return bySeverity;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    chains.push({
      parcelNodeId: parcel.id,
      parcelLabel: parcel.label,
      links,
      breaks,
      rootAt,
      yearsEstablished,
      yearsExpected,
    });
  }

  return chains.sort((a, b) => (a.parcelNodeId < b.parcelNodeId ? -1 : a.parcelNodeId > b.parcelNodeId ? 1 : 0));
}
