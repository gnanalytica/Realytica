/**
 * Invented papers, one of each kind a field reads, as the words a text layer
 * gives: `pages[0]` is page 1. Every name, number and figure is made up.
 */

export interface InventedPaper {
  fileName: string;
  /** The register's document type the paper should be read as. */
  is: string;
  pages: string[];
}

const page = (...lines: string[]): string => lines.join('\n');

export const PAPERS = {
  saleDeed: {
    fileName: 'Sale_Deed_2317_2019_Sy_41-2.pdf',
    is: 'Sale deed',
    pages: [
      page(
        'SALE DEED',
        'Government of Karnataka - Department of Stamps and Registration',
        'This Deed of Absolute Sale is made and executed at Mysuru on this the 23rd day of August, 2019 (23-08-2019).',
        'BY',
        'Sri A. Vendor, son of late B. Gowda, residing at No. 7, Tank Road, Kere, Mysuru, represented by his attorney under a registered power of attorney, hereinafter called the VENDOR.',
        'IN FAVOUR OF',
        'Lakeside Homes LLP, a limited liability partnership having its office at No. 12, Lake Road, Mysuru, represented by its designated partner, hereinafter called the PURCHASER.',
        'RECITALS',
        'WHEREAS the Vendor is the absolute owner of the Schedule Property having purchased the same from Sri B. Grantee under a registered Sale Deed dated 11-03-1994, registered as Document No. 811/1993-94 in the office of the Sub-Registrar, Mysuru North, which is the root of title of the Vendor.',
        'WHEREAS the Vendor has agreed to sell and the Purchaser has agreed to purchase the Schedule Property for a total sale consideration of Rs. 6,40,00,000 (Rupees Six Crores Forty Lakhs only).',
      ),
      page(
        'SCHEDULE PROPERTY',
        'All that piece and parcel of converted land bearing Survey No. 41/2, situated at Kere Village, Kasaba Hobli, Mysuru Taluk, Mysuru District, measuring 6,070 square metres (1 Acre 20 Guntas), abutting Lake Road, and bounded on the:',
        'North by: Survey No. 40',
        'South by: Lake Road (60 feet wide)',
        'East by: Survey No. 41/3',
        'West by: Survey No. 41/1',
        'Access: The Schedule Property has direct frontage and access on the public road, Lake Road.',
        'REGISTRATION',
        'Registered as Document No. 2317/2019-20, Book I, in the office of the Sub-Registrar, Mysuru West, on 23-08-2019.',
        'Stamp duty paid: Rs. 35,84,000. Registration fee paid: Rs. 6,40,000.',
        'VENDOR: A. Vendor, by his attorney K. Advocate',
        'PURCHASER: for Lakeside Homes LLP, Designated Partner',
      ),
    ],
  },
  encumbranceCertificate: {
    fileName: 'Encumbrance_Certificate_1994-2026_Sy_41-2.pdf',
    is: 'Encumbrance certificate',
    pages: [
      page(
        'ENCUMBRANCE CERTIFICATE',
        'FORM No. 15 [See Rule 146] - Karnataka Registration Rules, 1965',
        'Office of the Sub-Registrar, Mysuru West. Certificate No. EC/MYW/2026/1002.',
        'Encumbrances on the property: Survey No. 41/2, Kere Village, Kasaba Hobli, Mysuru Taluk, measuring 6,070 square metres.',
        'Period of search: from 01-01-1994 to 30-09-2026.',
        'TRANSACTIONS FOUND DURING THE PERIOD',
        '1. 14-03-1994 - Sale Deed - Doc. No. 811/1993-94 - Executant: Sri B. Grantee - Claimant: Sri A. Vendor - Consideration Rs. 4,20,000.',
        '2. 23-08-2019 - Sale Deed - Doc. No. 2317/2019-20 - Executant: Sri A. Vendor - Claimant: Lakeside Homes LLP - Consideration Rs. 6,40,00,000.',
        'It is certified that, save the acts and encumbrances stated above, no other acts or encumbrances affecting the said property have been found during the period searched.',
        'Date of issue: 05-10-2026. Sub-Registrar, Mysuru West.',
      ),
    ],
  },
  rtc: {
    fileName: 'RTC_Sy_41-3_2026-27.pdf',
    is: 'RTC (record of rights)',
    pages: [
      page(
        'RECORD OF RIGHTS, TENANCY AND CROPS (RTC)',
        'Government of Karnataka - Revenue Department - Bhoomi - Form No. 16',
        'Survey No. 41/3, Kere Village, Kasaba Hobli, Mysuru Taluk, Mysuru District. Year: 2026-27.',
        'Name of the owner: B. Gowda',
        'Extent: measuring 2,833 square metres (0 Acres 28 Guntas). Kharab: nil.',
        'Nature of land: dry. Mutation register number: MR 14/2019-20, pending.',
        'Cultivator: C. Gowda. Liabilities: nil.',
        'Digitally signed extract issued on 01-09-2026.',
      ),
    ],
  },
  conversionOrder: {
    fileName: 'DC_Conversion_Order_Sy_41-2.pdf',
    is: 'DC conversion order',
    pages: [
      page(
        'OFFICIAL MEMORANDUM',
        'Office of the Deputy Commissioner, Mysuru District',
        'Order No. ALN/SR/118/2018-19, dated 12-06-2018.',
        'Under Section 95 of the Karnataka Land Revenue Act, permission is hereby granted to convert the agricultural land bearing Survey No. 41/2, Kere Village, measuring 6,070 square metres, to non-agricultural residential purpose.',
        'The conversion fine has been paid.',
      ),
    ],
  },
  planSanction: {
    fileName: 'Building_Plan_Sanction_2025.pdf',
    is: 'Sanctioned building plan',
    pages: [
      page(
        'BUILDING PLAN SANCTION',
        'Mysuru Urban Development Authority - Town Planning',
        'LP No. MUDA/TP/AD/088/2025-26. Date of sanction: 01-12-2025.',
        'Applicant: Lakeside Homes LLP. Property: Survey No. 41/2, 41/3 and 42/1, Kere Village.',
        'Site area: 11,129 square metres. Sanctioned built-up area: 19,800 square metres.',
        'FAR sanctioned: 2.32. Ground coverage sanctioned: 40 percent.',
        'Number of dwelling units sanctioned: 96.',
      ),
    ],
  },
  revisedSanction: {
    fileName: 'Revised_Building_Plan_Sanction_2026.pdf',
    is: 'Revised plan sanction',
    pages: [
      page(
        'BUILDING PLAN SANCTION (MODIFIED PLAN)',
        'Mysuru Urban Development Authority - Town Planning',
        'LP No. MUDA/TP/AD/123/2026-27. Date of sanction: 09-10-2026.',
        'Applicant: Lakeside Homes LLP. Property: Survey No. 41/2, 41/3 and 42/1, Kere Village.',
        'Proposal: Modified plan for residential apartment buildings, Tower A 2 basements + ground + 15 upper floors, Tower B ground + 10 upper floors.',
        'Site area: 11,129 square metres. Sanctioned built-up area: 20,450 square metres.',
        'FAR sanctioned: 2.40. Ground coverage sanctioned: 41 percent.',
        'Number of dwelling units sanctioned: 104. Height of Tower A: 47.8 metres.',
        'This modified plan supersedes the plan sanctioned on 01-12-2025 (built-up area 19,800 square metres, 96 units). Sanction valid for two years from the date of sanction.',
      ),
    ],
  },
  commencementCertificate: {
    fileName: 'Commencement_Certificate_2026.pdf',
    is: 'Commencement certificate',
    pages: [
      page(
        'COMMENCEMENT CERTIFICATE',
        'Mysuru Urban Development Authority - Town Planning',
        'No. MUDA/TP/CC/044/2025-26. Commencement certificate issued on 5 March 2026.',
        'To: Lakeside Homes LLP. Property: Survey No. 41/2, 41/3 and 42/1, Kere Village. LP No. MUDA/TP/AD/088/2025-26.',
        'The foundation and column positions set out on site have been inspected and found to be as per the sanctioned plan. Permission is granted to commence work above plinth.',
      ),
    ],
  },
  occupancyCertificate: {
    fileName: 'Occupancy_Certificate_Tower_A.pdf',
    is: 'Occupancy certificate',
    pages: [
      page(
        'OCCUPANCY CERTIFICATE',
        'Mysuru Urban Development Authority - Town Planning',
        'No. MUDA/TP/OC/017/2027-28. Date: 18-11-2027.',
        'The building constructed on Survey No. 41/2, Kere Village, under LP No. MUDA/TP/AD/123/2026-27, has been inspected and found fit for occupation. The occupancy certificate is hereby issued for Tower A.',
      ),
    ],
  },
  jointDevelopmentAgreement: {
    fileName: 'Joint_Development_Agreement_2025.pdf',
    is: 'Joint development agreement',
    pages: [
      page(
        'JOINT DEVELOPMENT AGREEMENT',
        'This Joint Development Agreement is made at Mysuru on 14-02-2025 and registered as Document No. 3120/2024-25 in the office of the Sub-Registrar, Mysuru West.',
        'BETWEEN Sri C. Gowda, owner of Survey No. 42/1, Kere Village, measuring 2,023 square metres (20 Guntas), hereinafter the OWNER; AND Lakeside Homes LLP, hereinafter the DEVELOPER.',
        '1. The Owner shall be entitled to 38 percent and the Developer to 62 percent of the saleable super built-up area and of the car parks, on an area sharing basis.',
        '2. The Developer has paid the Owner a refundable deposit of Rs. 1,50,00,000 (Rupees One Crore Fifty Lakhs only), refundable on handing over the Owner\'s share.',
        '3. The Developer shall obtain plan sanction within 9 months of this agreement and complete construction within 36 months of plan sanction, with a grace period of 6 months.',
        '4. For delay beyond the grace period the Developer shall pay the Owner Rs. 12 per square foot per month on the Owner\'s share.',
        '5. The agreement assumes an FAR of 2.25 on the Schedule Property.',
      ),
    ],
  },
  powerOfAttorney: {
    fileName: 'GPA_A_Vendor_2019.pdf',
    is: 'Power of attorney',
    pages: [
      page(
        'GENERAL POWER OF ATTORNEY',
        'Know all men by these presents that I, Sri A. Vendor, residing at No. 7, Tank Road, Kere, Mysuru, do hereby appoint, nominate and constitute Sri K. Advocate as my true and lawful attorney.',
        'Executed at Mysuru on 02-08-2019 and registered as Document No. 214/2019-20, Book IV, in the office of the Sub-Registrar, Mysuru West.',
        'The attorney is authorised to sell the property bearing Survey No. 41/2 and to execute and register the sale deed.',
      ),
    ],
  },
  loanSanctionLetter: {
    fileName: 'Loan_Sanction_Letter_Meridian_Bank.pdf',
    is: 'Loan sanction letter',
    pages: [
      page(
        'SANCTION LETTER',
        'Meridian Bank - Corporate Finance Branch, Mysuru',
        'Ref: MB/CF/2026/118. Date: 20-03-2026. To: Lakeside Homes LLP.',
        'We are pleased to sanction a construction term loan of Rs. 12,00,00,000 (Rupees Twelve Crores only) for the project Kere Bank Residences, against an appraised project cost of Rs. 31,00,00,000. Minimum promoter contribution: 30 percent.',
        'Rate of interest: one-year MCLR plus a spread of 2.10 percent. Tenor: 48 months including a moratorium of 18 months. Availability period ends 30-09-2027. Repayment in quarterly instalments.',
        'Terms and conditions of sanction: all sale receipts to be routed through the escrow account; debt service reserve of one quarter.',
      ),
    ],
  },
  disbursementAdvice: {
    fileName: 'Disbursement_Advice_Tranche_1.pdf',
    is: 'Disbursement advice',
    pages: [
      page(
        'DISBURSEMENT ADVICE',
        'Meridian Bank - Corporate Finance Branch, Mysuru',
        'Loan account: MB/CF/2026/118. Tranche 1.',
        'We advise that an amount of Rs. 3,00,00,000 (Rupees Three Crores only) has been disbursed on 30-06-2026 and credited to the designated account of the borrower.',
      ),
    ],
  },
  bankGuarantee: {
    fileName: 'Bank_Guarantee_Northgate_Performance.pdf',
    is: 'Bank guarantee',
    pages: [
      page(
        'BANK GUARANTEE',
        'Harbour Bank - Mysuru Main Branch',
        'Guarantee No. HB/BG/2026/0457. Date of issue: 10-04-2026.',
        'In consideration of Lakeside Homes LLP having awarded contract WO/2026/014 to Northgate Builders, we, Harbour Bank, hereby guarantee the due performance of the contract up to an amount of Rs. 92,00,000 (Rupees Ninety Two Lakhs only).',
        'This guarantee shall remain valid until 30-09-2027. Any claim under this guarantee must be lodged on or before 30-12-2027.',
      ),
    ],
  },
  workOrder: {
    fileName: 'Letter_of_Acceptance_WO-2026-014.pdf',
    is: 'Work order',
    pages: [
      page(
        'LETTER OF ACCEPTANCE',
        'Lakeside Homes LLP - Kere Bank Residences',
        'Work Order No. WO/2026/014. Date: 02-04-2026. To: Northgate Builders.',
        'Your bid for the Civil and structure package is accepted for a contract price of Rs. 18,40,00,000 excluding GST.',
        'Date of commencement: 15-04-2026. Date for completion: 30-06-2027. Defect liability period: 12 months.',
      ),
    ],
  },
  runningBill: {
    fileName: 'RA_Bill_06_Northgate.pdf',
    is: 'Running account bill',
    pages: [
      page(
        'RUNNING ACCOUNT BILL No. 06',
        'Northgate Builders',
        'Contract: WO/2026/014, Civil and structure. Bill date: 31-10-2026. Work done up to 25-10-2026.',
        'Gross value of work done to date: Rs. 7,45,00,000. Less previous bills: Rs. 6,10,00,000. This bill: Rs. 1,35,00,000.',
        'Retention at 5 percent: Rs. 6,75,000. Net amount payable: Rs. 1,28,25,000.',
      ),
    ],
  },
  variationClaim: {
    fileName: 'Variation_Claim_VO-09.pdf',
    is: 'Variation claim',
    pages: [
      page(
        'NOTICE OF VARIATION',
        'Northgate Builders',
        'Ref: VO-09. Date: 05-09-2026. To: Lakeside Homes LLP. Contract: WO/2026/014, Civil and structure.',
        'Variation VO-09: a transfer beam at podium level was added by structural drawing S-214 Revision C issued on 28-08-2026. We claim Rs. 18,20,000 for this extra item.',
      ),
    ],
  },
  timeClaim: {
    fileName: 'Extension_of_Time_Claim_TC-01.pdf',
    is: 'Extension of time claim',
    pages: [
      page(
        'CLAIM FOR EXTENSION OF TIME',
        'Northgate Builders',
        'Claim No. TC-01. Date: 05-09-2026. To: Lakeside Homes LLP. Contract: WO/2026/014, Civil and structure.',
        'Column drawings for the fourth floor were issued late. We claim an extension of 45 days to the date for completion, from 30-06-2027 to 14-08-2027, and prolongation cost of Rs. 31,50,000.',
      ),
    ],
  },
  bid: {
    fileName: 'Bid_Kaveri_Power_Systems_Electrical.pdf',
    is: 'Bid',
    pages: [
      page(
        'PRICE BID',
        'Kaveri Power Systems - Package E1 Electrical',
        'Tender: Kere Bank Residences, Package E1 Electrical. Date: 22-09-2026.',
        'Total quoted amount: Rs. 2,89,00,000 excluding GST. Validity of bid: 90 days.',
        'Exclusions: transformer and its plinth. Completion period: 26 weeks. Earnest money: bank guarantee BG/EMD/771 for Rs. 3,00,000 valid to 20-10-2026.',
      ),
    ],
  },
  allotmentLetter: {
    fileName: 'Allotment_Letter_A-301.pdf',
    is: 'Allotment letter',
    pages: [
      page(
        'ALLOTMENT LETTER',
        'Lakeside Homes LLP - Kere Bank Residences',
        'Date: 12-05-2026. To: A. Buyer.',
        'We are pleased to allot to you Apartment No. A-301 in Tower A for a total price of Rs. 81,00,000 (Rupees Eighty One Lakhs only), with 1 covered car park.',
        'We acknowledge the booking amount of Rs. 8,10,000 received from you.',
      ),
    ],
  },
  agreementForSale: {
    fileName: 'Agreement_for_Sale_A-301.pdf',
    is: 'Agreement for sale',
    pages: [
      page(
        'AGREEMENT FOR SALE',
        'This Agreement for Sale is executed at Mysuru on 20-06-2026 between Lakeside Homes LLP, the PROMOTER, and A. Buyer, the ALLOTTEE, and registered on 22-06-2026.',
        'The Promoter agrees to sell and the Allottee agrees to purchase Apartment No. A-301 having a carpet area of 78.50 square metres, for a total price of Rs. 81,00,000.',
        'The Promoter shall hand over possession of the Apartment on or before 31-12-2027.',
      ),
    ],
  },
  demandLetter: {
    fileName: 'Demand_Letter_DN-04_A-301.pdf',
    is: 'Demand letter',
    pages: [
      page(
        'DEMAND LETTER',
        'Lakeside Homes LLP - Kere Bank Residences',
        'Demand No. DN-04. Date: 08-10-2026. Unit: A-301. Allottee: A. Buyer.',
        'On completion of the fourth floor slab, the instalment of Rs. 12,15,000 (Rupees Twelve Lakhs Fifteen Thousand only) plus GST as applicable is due on or before 23-10-2026.',
        'Interest on delay is payable at the rate notified under the rules.',
      ),
    ],
  },
  paymentReceipt: {
    fileName: 'Receipt_RC-0412_A-301.pdf',
    is: 'Payment receipt',
    pages: [
      page(
        'PAYMENT RECEIPT',
        'Lakeside Homes LLP - Kere Bank Residences',
        'Receipt No. RC-0412. Date: 21-10-2026. Unit: A-301.',
        'Received with thanks from A. Buyer a sum of Rs. 12,15,000 (Rupees Twelve Lakhs Fifteen Thousand only) towards Demand No. DN-04, by bank transfer.',
      ),
    ],
  },
} as const satisfies Record<string, InventedPaper>;
