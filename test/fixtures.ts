/**
 * Case fixtures the tests build on.
 *
 * Built from the shipped seed data rather than from hand-written literals,
 * for one reason learned the hard way: a hand-rolled `ScreenResult` in an
 * earlier round of this work was missing a required field, and the test that
 * used it was asserting against a shape the engine never produces. Fixtures
 * that go through the real constructors cannot drift from the real contract.
 */

import {
  REFERENCE_DATA,
  FIXTURE_CASES,
  FIXTURE_DOCUMENT_FILENAMES,
  addBill,
  addContract,
  addEvidence,
  addMilestones,
  addWorkPackages,
  certifyBill,
  certifyLine,
  classifyDocument,
  createProject,
  defineCostColumn,
  extractFields,
  recordPayment,
  runScreen,
  setCostForecast,
  withdrawCertification,
} from '@realytica/shared';
import type { CaseDocument, ProjectBrief, PropertyCase, PropertyIdentity, ScreenResult, SiteContext } from '@realytica/shared';

/**
 * A fixed instant, so nothing in the suite depends on the day it runs.
 *
 * The engine takes `now` as a parameter precisely so this is possible; a test
 * that used the wall clock would pass today and fail whenever a threshold in
 * `staleness.ts` was crossed.
 */
export const NOW = '2026-08-26T00:00:00.000Z';

export function seedFor(match: string): (typeof FIXTURE_CASES)[number] {
  const seed = FIXTURE_CASES.find(s => s.identity.label.includes(match));
  if (!seed) throw new Error(`No seed case matching "${match}"`);
  return seed;
}

export function documentsFor(identity: PropertyIdentity, label: string, caseId = 'test-case', uploadedAt = NOW): CaseDocument[] {
  const names = FIXTURE_DOCUMENT_FILENAMES[label] ?? [];
  return names.map((fileName, i) => {
    const doc: CaseDocument = {
      id: `doc-${i}`,
      caseId,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedAt,
      kind: classifyDocument(fileName, 'application/pdf').kind,
      classificationConfidence: 0.9,
      kindConfirmedByUser: true,
      pages: 2,
      ocrStatus: 'complete',
      extracted: [],
    };
    doc.extracted = extractFields(doc, identity, caseId);
    return doc;
  });
}

export interface ScreenFixtureOptions {
  /** Merged over the seed's Karnataka attributes. */
  karnataka?: Partial<NonNullable<PropertyIdentity['karnataka']>>;
  /** Merged over the seed identity itself. */
  identity?: Partial<PropertyIdentity>;
  siteContext?: SiteContext;
  documents?: CaseDocument[];
  now?: string;
  /** Pass a stated brief; omitted, the engine infers one as it does in production. */
  project?: ProjectBrief;
}

export function screenSeed(match: string, options: ScreenFixtureOptions = {}): { result: ScreenResult; identity: PropertyIdentity; documents: CaseDocument[] } {
  const seed = seedFor(match);
  const identity: PropertyIdentity = {
    ...seed.identity,
    ...options.identity,
    ...(seed.identity.karnataka ? { karnataka: { ...seed.identity.karnataka, ...options.karnataka } } : {}),
  };
  const documents = options.documents ?? documentsFor(identity, seed.identity.label);
  const result = runScreen({
    caseId: 'test-case',
    reference: 'TEST-0001',
    identity,
    documents,
    refData: REFERENCE_DATA,
    now: options.now ?? NOW,
    siteContext: options.siteContext,
    project: options.project,
  });
  return { result, identity, documents };
}

export function caseFrom(identity: PropertyIdentity, documents: CaseDocument[], result?: ScreenResult, extra: Partial<PropertyCase> = {}): PropertyCase {
  return {
    id: 'test-case',
    reference: 'TEST-0001',
    identity,
    status: result ? 'screened' : 'collecting',
    ownerName: 'Test Owner',
    createdAt: NOW,
    updatedAt: NOW,
    documents,
    result,
    notes: '',
    ...extra,
  };
}

/** A site context with a precise pin, for the paths gated on geocode precision. */
export function preciseSiteContext(overrides: Partial<SiteContext> = {}): SiteContext {
  return {
    caseId: 'test-case',
    location: {
      point: { lat: 13.2437, lng: 77.7126 },
      precision: 'rooftop',
      queried: 'queried address',
      resolvedAddress: 'Site 118, NPKL, Devanahalli, Bengaluru 562110, India',
      provider: 'google',
      resolvedAt: NOW,
      caveat: 'Located from the address on file.',
    },
    amenities: [],
    streetView: null,
    gaps: [],
    provider: 'google',
    builtAt: NOW,
    ...overrides,
  };
}

/** Who does what in the worked cost example: the lead who keeps the register, the certifier, and accounts. */
export const COST_LEAD = 'lead@firm.in';
export const COST_CERTIFIER = 'qs@firm.in';
export const COST_ACCOUNTS = 'accounts@firm.in';

/**
 * A cost register worked by hand, through the register's own functions.
 *
 * A budget of ₹60,00,000 in two packages, and a third with none. Two
 * contracts. Three bills, one in each state a bill can be in:
 *
 *   RA-1  claimed 10,00,000. Certified 4,00,000 as claimed and 5,40,000 of
 *         6,00,000: 9,40,000 gross. Less retention 47,000 and tax 18,800:
 *         8,74,200 net. Paid 8,00,000, so 74,200 is outstanding.
 *   RA-2  claimed 11,50,000. Every line decided (10,00,000, 80,000 and
 *         nothing), a certificate issued for 10,80,000, then withdrawn: so
 *         nothing of it counts as certified.
 *   F-1   claimed 2,00,000 on the other contract, and no line decided.
 *
 * The forecast final cost is ₹65,00,000, above the budget.
 */
export function costExample() {
  const project = createProject({ name: 'Balagere towers', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-COST');
  const paper = (title: string) => addEvidence(project, { title, kind: 'document', status: 'received' }, COST_LEAD);
  const papers = {
    budget: paper('Budget sheet.xlsx'),
    order: paper('Work order WO-CIV-014.pdf'),
    ra1: paper('RA Bill 1.xlsx'),
    ra2: paper('RA Bill 2.pdf'),
    certificate: paper('Payment certificate 1.pdf'),
  };
  const [milestone] = addMilestones(project, [{ name: 'Foundation and basement', weight: 1 }], COST_LEAD);

  const [earthwork, structure, finishes] = addWorkPackages(
    project,
    [
      { code: 'A', name: 'Earthwork', budget: 1_000_000, source: { evidenceId: papers.budget.id, sheet: 'Budget', cell: 'C4' } },
      { code: 'B', name: 'Structure', budget: 5_000_000, source: { evidenceId: papers.budget.id, sheet: 'Budget', cell: 'C5' }, milestoneId: milestone!.id },
      { code: 'C', name: 'Finishes' },
    ],
    COST_LEAD,
  );
  const civil = addContract(
    project,
    { contractor: 'Sharma Constructions', title: 'Civil works', reference: 'WO-CIV-014', workPackageIds: [earthwork!.id, structure!.id], value: 4_500_000, retentionPercent: 5, source: { evidenceId: papers.order.id, page: 1 } },
    COST_LEAD,
  );
  const interiors = addContract(project, { contractor: 'Lakshmi Interiors', title: 'Finishes', workPackageIds: [finishes!.id], value: 800_000 }, COST_LEAD);
  defineCostColumn(project, { key: 'boqRef', label: 'BOQ ref', kind: 'text' }, COST_LEAD);

  const ra1 = addBill(
    project,
    {
      contractId: civil.id,
      number: 'RA-1',
      date: '2026-08-31',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      statedTotal: 1_000_000,
      evidenceId: papers.ra1.id,
      lines: [
        { item: '1.1', description: 'Excavation in ordinary soil', workPackageId: earthwork!.id, unit: 'cum', rate: 400, quantityToDate: 1000, amountToDate: 400_000, previousAmount: 0, amount: 400_000, extra: { boqRef: 'E-01' }, source: { evidenceId: papers.ra1.id, sheet: 'RA 1', cell: 'H12' }, readBy: 'sheet' },
        { item: '2.4', description: 'RCC M30 in raft foundation', workPackageId: structure!.id, unit: 'cum', rate: 3000, quantityToDate: 200, amountToDate: 600_000, previousAmount: 0, amount: 600_000, source: { evidenceId: papers.ra1.id, sheet: 'RA 1', cell: 'H19' }, readBy: 'sheet' },
      ],
    },
    COST_LEAD,
  );
  const [excavation, raft] = ra1.lines;
  certifyLine(project, ra1.id, excavation!.id, { amount: 400_000 }, COST_CERTIFIER);
  certifyLine(project, ra1.id, raft!.id, { amount: 540_000, quantity: 180, note: '20 cum of the raft is not yet cast' }, COST_CERTIFIER);
  const certificate = certifyBill(
    project,
    ra1.id,
    {
      signer: { email: COST_CERTIFIER, name: 'R. Menon', profession: 'Quantity Surveyor', registration: 'RICS 1234567' },
      certifiedOn: '2026-09-05',
      deductions: [
        { kind: 'retention', amount: 47_000 },
        { kind: 'tax', label: 'TDS 2%', amount: 18_800 },
      ],
      evidenceId: papers.certificate.id,
    },
    COST_CERTIFIER,
  );
  const payment = recordPayment(project, ra1.id, { amount: 800_000, paidOn: '2026-09-12', reference: 'NEFT 4471' }, COST_ACCOUNTS);

  const ra2 = addBill(
    project,
    {
      contractId: civil.id,
      number: 'RA-2',
      date: '2026-09-30',
      evidenceId: papers.ra2.id,
      lines: [
        { item: '2.6', description: 'RCC M30 in columns, ground floor', workPackageId: structure!.id, unit: 'cum', rate: 4000, quantityToDate: 250, amountToDate: 1_000_000, previousAmount: 0, amount: 1_000_000, source: { evidenceId: papers.ra2.id, page: 2 }, readBy: 'model' },
        { item: '1.3', description: 'Backfilling with excavated earth', workPackageId: earthwork!.id, unit: 'cum', rate: 200, quantityToDate: 500, amountToDate: 100_000, previousAmount: 0, amount: 100_000, source: { evidenceId: papers.ra2.id, page: 2 }, readBy: 'model' },
        { item: 'V-1', description: 'Extra rock cutting below the basement', amount: 50_000, variation: true, source: { evidenceId: papers.ra2.id, page: 3 }, readBy: 'model' },
      ],
    },
    COST_LEAD,
  );
  const [columns, backfill, rock] = ra2.lines;
  certifyLine(project, ra2.id, columns!.id, { amount: 1_000_000 }, COST_CERTIFIER);
  certifyLine(project, ra2.id, backfill!.id, { amount: 80_000, note: '100 cum is not compacted' }, COST_CERTIFIER);
  certifyLine(project, ra2.id, rock!.id, { amount: 0, note: 'No instruction was given for it' }, COST_CERTIFIER);
  certifyBill(project, ra2.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-10-03', deductions: [{ kind: 'retention', amount: 54_000 }] }, COST_CERTIFIER);
  const withdrawn = withdrawCertification(project, ra2.id, COST_CERTIFIER, 'The rate of item 2.6 is to be checked');

  const f1 = addBill(
    project,
    { contractId: interiors.id, number: 'F-1', date: '2026-10-02', lines: [{ item: '7.1', description: 'Internal painting, two coats', workPackageId: finishes!.id, unit: 'sqm', amount: 200_000, readBy: 'person' }] },
    COST_LEAD,
  );
  setCostForecast(project, { finalCost: 6_500_000, note: 'Rock in the basement' }, COST_LEAD);

  return {
    project,
    papers,
    milestone: milestone!,
    packages: { earthwork: earthwork!, structure: structure!, finishes: finishes! },
    contracts: { civil, interiors },
    bills: { ra1, ra2, f1 },
    lines: { excavation: excavation!, raft: raft!, columns: columns!, backfill: backfill!, rock: rock!, painting: f1.lines[0]! },
    certificates: { ra1: certificate, ra2: withdrawn },
    payment,
  };
}
