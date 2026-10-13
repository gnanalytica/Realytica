/**
 * Procurement › Tenders: the calls that change a tender.
 *
 * Reading is not here. The tenders are on the project the browser already
 * holds, and their standing and comparison are worked out from it. Every call
 * answers with the project as this person may read it.
 */

import type { DdProject, Tender, TenderBidder, TenderBidderInput, TenderBidderPatch, TenderOffer, TenderRecommendation, TenderStage, TenderStageKey, TenderStagePatch } from '@realytica/shared';
import { request } from './api';

const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const at = (projectId: string, rest = ''): string => `/projects/${projectId}/procurement${rest}`;

type Changed<T = unknown> = Promise<{ project: DdProject } & T>;

export const procurementApi = {
  startTender: (projectId: string, body: { workPackageId: string; estimate?: number }): Changed<{ tender: Tender }> => request(at(projectId, '/tenders'), send('POST', body)),
  setEstimate: (projectId: string, tenderId: string, estimate: number | null): Changed<{ tender: Tender }> => request(at(projectId, `/tenders/${tenderId}`), send('PATCH', { estimate })),
  removeTender: (projectId: string, tenderId: string): Changed => request(at(projectId, `/tenders/${tenderId}`), send('DELETE')),
  setStage: (projectId: string, tenderId: string, stage: TenderStageKey, patch: TenderStagePatch): Changed<{ stage: TenderStage }> => request(at(projectId, `/tenders/${tenderId}/stages/${stage}`), send('PUT', patch)),
  addBidder: (projectId: string, tenderId: string, body: TenderBidderInput): Changed<{ bidder: TenderBidder }> => request(at(projectId, `/tenders/${tenderId}/bidders`), send('POST', body)),
  updateBidder: (projectId: string, tenderId: string, bidderId: string, patch: TenderBidderPatch): Changed<{ bidder: TenderBidder }> => request(at(projectId, `/tenders/${tenderId}/bidders/${bidderId}`), send('PATCH', patch)),
  removeBidder: (projectId: string, tenderId: string, bidderId: string): Changed => request(at(projectId, `/tenders/${tenderId}/bidders/${bidderId}`), send('DELETE')),
  recommend: (projectId: string, tenderId: string, body: { bidderId: string; text: string }): Changed<{ recommendation: TenderRecommendation }> => request(at(projectId, `/tenders/${tenderId}/recommendation`), send('PUT', body)),
  recordLetter: (projectId: string, tenderId: string, body: { bidderId: string; value: number; letterOn: string }): Changed<{ tender: Tender }> => request(at(projectId, `/tenders/${tenderId}/letter-of-acceptance`), send('POST', body)),
  withdrawLetter: (projectId: string, tenderId: string): Changed<{ tender: Tender }> => request(at(projectId, `/tenders/${tenderId}/letter-of-acceptance`), send('DELETE')),
  acceptOffer: (projectId: string, tenderId: string): Changed<{ offer: TenderOffer }> => request(at(projectId, `/tenders/${tenderId}/offer/accept`), send('POST', {})),
  declineOffer: (projectId: string, tenderId: string, reason: string): Changed<{ offer: TenderOffer }> => request(at(projectId, `/tenders/${tenderId}/offer/decline`), send('POST', { reason })),
  offerAgain: (projectId: string, tenderId: string): Changed<{ offer: TenderOffer }> => request(at(projectId, `/tenders/${tenderId}/offer/again`), send('POST', {})),
  /** Finance takes an approved variation onto the draft Cost Report: PO issued and the anticipated cost, or PO issued alone where the forecast carries it already. */
  acceptVariation: (projectId: string, variationId: string, forecast?: 'add' | 'already_in'): Changed => request(at(projectId, `/variations/${variationId}/offer/accept`), send('POST', forecast ? { forecast } : {})),
  declineVariation: (projectId: string, variationId: string, reason: string): Changed => request(at(projectId, `/variations/${variationId}/offer/decline`), send('POST', { reason })),
};
