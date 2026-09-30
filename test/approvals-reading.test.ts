/**
 * Reading the approvals a project's file is built on.
 *
 * A residential diligence in Karnataka runs on a RERA registration, an
 * environmental clearance, utility and aviation NOCs, and the promoter's
 * incorporation papers. Every text here is invented — the promoter, the
 * project, the numbers — but laid out the way the certificates and board
 * letters are, down to OCR's habits: the RERA certificate printing values
 * without their labels, a letter citing the requisition it answers, a date
 * the scanner smudged.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { documentAnswers, parseDocumentText } from '../packages/shared/src';

function read(text: string, fileName: string) {
  return parseDocumentText(text.split('\f'), fileName);
}

function fact(parsed: ReturnType<typeof read>, key: string) {
  return parsed.facts.find((f) => f.key === key);
}

const RERA = `ACK/KA/RERA/9999/123/PR/010120/000111 01-01-2020 PRM/KA/RERA/9999/123/PR/150220/000222 EXAMPLE HEIGHTS PHASE 2, SY NO 10/1, 10/2, 11/3A,12 AND 14/2B OF SAMPLEPURA VILLAGE WARD NO 7, BENGALURU EAST, BENGALURU URBAN, KARNATAKA - 560000 EXAMPLE BUILDERS LIMITED EXAMPLE BUILDERS LIMITED, 1 MAIN ROAD, BENGALURU URBAN, KARNATAKA - 560001 30-06-2099 *Please scan the QR code to validate the authenticity of the certificate. Digitally Signed By A Officer, Chairman, Karnataka Real Estate Regulatory Authority Project Approval Date: 15-02-2020`;

describe('a RERA registration certificate', () => {
  it('is read for its number, project, land, approval and term', () => {
    const parsed = read(RERA, 'RERA_Cert_example.pdf');
    assert.equal(parsed.type, 'rera_registration');
    assert.equal(parsed.documentKind, 'rera_registration');
    assert.equal(fact(parsed, 'rera_number')?.value, 'PRM/KA/RERA/9999/123/PR/150220/000222');
    assert.equal(fact(parsed, 'rera_acknowledgement')?.value, 'ACK/KA/RERA/9999/123/PR/010120/000111');
    assert.equal(fact(parsed, 'project_name')?.value, 'EXAMPLE HEIGHTS PHASE 2');
    assert.equal(fact(parsed, 'survey_numbers')?.value, '10/1, 10/2, 11/3A, 12, 14/2B');
    assert.equal(fact(parsed, 'rera_approved_on')?.value, '2020-02-15');
    assert.equal(fact(parsed, 'rera_valid_until')?.value, '2099-06-30');
    assert.equal(fact(parsed, 'issued_by')?.value, 'Karnataka RERA');
    assert.equal(parsed.flags.length, 0);
    for (const f of parsed.facts) assert.ok(RERA.includes(f.quote.replace(/…/g, '').slice(0, 30)), `quote from the page: ${f.key}`);
  });

  it('flags a registration whose term has passed', () => {
    const parsed = read(RERA.replace('30-06-2099', '30-06-2019'), 'rera.pdf');
    assert.ok(parsed.flags.some((f) => /RERA registration lapsed on 30 Jun 2019/.test(f.title)));
  });
});

const CLEARANCE = `[page 1] State Level Environment Impact Assessment Authority-Karnataka (Constituted by MoEF, Government of India, under section 3(3) of E(P) Act, 1986) No. SEIAA 42 CON 2015 Date: 12-03-2016 To, M/s. Example Builders Limited (Formerly Example Developers Ltd) Regd Office, 1 Main Road, Bengaluru-560 001 Sir, Sub: Construction of Residential Apartment Project at Survey No's. 10/1,10/2, 11/3A, 12 of Samplepura Village, East Taluk by M/s. Example Builders Limited - Issue of Environment Clearance - Reg.
The project involves a total built up area of 1,20,000 Sqm with 900 dwelling units.
The environmental clearance is valid for a period of seven years from the date of issue.`;

describe('an environmental clearance', () => {
  it('is read for its number, date, holder, subject, land and term', () => {
    const parsed = read(CLEARANCE, 'Environment_clearance.pdf');
    assert.equal(parsed.type, 'environmental_clearance');
    assert.equal(fact(parsed, 'issued_by')?.value, 'SEIAA Karnataka');
    assert.equal(fact(parsed, 'clearance_number')?.value, 'SEIAA 42 CON 2015');
    assert.equal(fact(parsed, 'issued_on')?.value, '2016-03-12');
    assert.equal(fact(parsed, 'issued_to')?.value, 'Example Builders Limited');
    assert.equal(fact(parsed, 'subject')?.value, 'Construction of Residential Apartment Project');
    assert.equal(fact(parsed, 'covered_survey_numbers')?.value, '10/1, 10/2, 11/3A, 12');
    assert.equal(fact(parsed, 'cleared_built_up_area')?.value, 120000);
    assert.equal(fact(parsed, 'cleared_units')?.value, 900);
    assert.equal(fact(parsed, 'valid_until')?.value, '2023-03-12');
    assert.ok(parsed.flags.some((f) => /Environmental clearance lapsed on 12 Mar 2023/.test(f.title)));
    // Not the project's own parcel: an approval names all the land it covers.
    assert.equal(fact(parsed, 'survey_numbers'), undefined);
  });
});

const HEIGHT_NOC = `[page 1] NOCLetter Page 1 of 2 No. AAI/BIA/ATM/NOC/EXAM/SOUTH/B/010101/12345/ Date 10/3/2015 Example Road, Bengaluru NO Objection Certificate for Height Clearance This NOC is issued by Airports Authority of India (AAI) in pursuance of responsibility conferred by the Ministry of Civil Aviation order for Safe and Regular Aircraft Operations. NOCID EXAM/SOUTH/B/010101/12345 2. NOC Details for Height Clearance Site Cordinates 12 58 10.50N -77 38 05.25E Site Elevation AMSL in Mtrs 890.50Mtrs Permissible height above Ground Level 55.00 M
c. No radio/TV Antenna shall project above the Permissible Top Elevation 945.50 Mtrs, indicated in para 2.
e. The certificate is valid for a period of 5 years from the date of its issue. If the building is not completed within the period, the applicant will be required to obtain a fresh NOC.`;

describe('an aviation height NOC', () => {
  it('is read for its ceiling, site and term, and flagged once lapsed', () => {
    const parsed = read(HEIGHT_NOC, 'Airport_Authority_of_India.pdf');
    assert.equal(parsed.type, 'aviation_noc');
    assert.equal(fact(parsed, 'issued_by')?.value, 'Airports Authority of India');
    assert.equal(fact(parsed, 'noc_reference')?.value, 'EXAM/SOUTH/B/010101/12345');
    assert.equal(fact(parsed, 'issued_on')?.value, '2015-03-10');
    assert.equal(fact(parsed, 'permissible_top_elevation')?.value, 945.5);
    assert.equal(fact(parsed, 'site_elevation')?.value, 890.5);
    assert.equal(fact(parsed, 'permissible_height')?.value, 55);
    assert.equal(fact(parsed, 'site_coordinates')?.display, '12°58′10.5″N, 77°38′5.25″E');
    assert.equal(fact(parsed, 'valid_until')?.value, '2020-03-10');
    assert.ok(parsed.flags.some((f) => f.title === 'The Airports Authority of India height NOC lapsed on 10 Mar 2020'));
  });

  it('answers an AAI NOC row, not the utility NOCs row', () => {
    const parsed = read(HEIGHT_NOC, 'Airport_Authority_of_India.pdf');
    assert.ok(parsed.rowHints.includes('aai noc'));
    assert.equal(documentAnswers(parsed.label, 'Utility NOCs'), false);
  });
});

const WATER_NOC = `[page 1] Grams: "Water Sup" Phone: 0000 SAMPLEPURA WATER SUPPLY AND SEWERAGE BOARD 2nd Floor, Board Bhavan, Samplepura-560009 No.WSSB/EIC/CE(M)/ACE(M)/ 2015-16/77 Dated: \\ 3 \\ ot \\ 20) To M/s. Example Builders Ltd, Regd Office, 1 Main Road, Samplepura-560001. Sir, Sub: Issue of No Objection Certificate for the proposed Residential Apartment Building at Sy No.10/1, 10/2, 11/3A, 12, at Samplepura village, East Taluk. Ref : 1) Requisition letter dated 12.02.2015 of the applicant.`;

describe('a utility NOC', () => {
  it('is read for issuer, reference, holder, subject and land, and never borrows the date it cites', () => {
    const parsed = read(WATER_NOC, 'WSSB_NOC.pdf');
    assert.equal(parsed.type, 'utility_noc');
    assert.equal(fact(parsed, 'issued_by')?.value, 'Samplepura Water Supply and Sewerage Board');
    assert.equal(fact(parsed, 'issued_to')?.value, 'Example Builders Ltd');
    assert.equal(fact(parsed, 'subject')?.value, 'Issue of No Objection Certificate for the proposed Residential Apartment Building');
    assert.equal(fact(parsed, 'covered_survey_numbers')?.value, '10/1, 10/2, 11/3A, 12');
    // The letterhead's own date is illegible; the requisition's date is not the NOC's.
    assert.equal(fact(parsed, 'issued_on'), undefined);
    assert.ok(documentAnswers(parsed.label, 'Utility NOCs'));
  });

  it('keeps OCR noise out of the issuer and the reference, and reads a long subject', () => {
    const noisy = `EE BE SAMPLEPURA WATER SUPPLY AND SEWERAGE BOARD No.WSSB/EIC/CE(M)/ACE(M)-IT/ (5 © {_/ 2015-16 Dated: 12.02.2016 To M/s. Example Builders Ltd, Sir, Sub: Issue of No Objection Certificate for the proposed Residential Apartment Building at Sy No.${Array.from({ length: 60 }, (_, i) => `${i + 1}/1`).join(', ')}, at Samplepura village. Ref : 1) Requisition letter dated 01.01.2016.`;
    const parsed = read(noisy, 'noc.pdf');
    assert.equal(fact(parsed, 'issued_by')?.value, 'Samplepura Water Supply and Sewerage Board');
    assert.equal(fact(parsed, 'noc_reference')?.value, 'WSSB/EIC/CE(M)/ACE(M)-IT');
    assert.equal(fact(parsed, 'subject')?.value, 'Issue of No Objection Certificate for the proposed Residential Apartment Building');
    assert.equal(fact(parsed, 'issued_on')?.value, '2016-02-12');
  });

  it('reads a reference written with a bracketed section', () => {
    const telecom = `BHARAT SANCHAR NIGAM LTD. To, M/s. Example Builders Limited, No.AGM (TP)/S-6/Vol-27/2013-14/12 dt @ XX-8 the 15.03.2014 Subject: No Objection Certificate (NOC) High rise Building. Ref: Your letter.`;
    const parsed = read(telecom, 'telecom_noc.pdf');
    assert.equal(parsed.type, 'utility_noc');
    assert.equal(fact(parsed, 'noc_reference')?.value, 'AGM (TP)/S-6/Vol-27/2013-14/12');
    assert.equal(fact(parsed, 'issued_on')?.value, '2014-03-15');
  });

  it('reads the load a power NOC sanctions', () => {
    const power = `SAMPLEPURA ELECTRICITY SUPPLY COMPANY LIMITED NO: CEE/XX/SEE(O)/AEE-4/F-1/15-16 Date: 19-10-2015 Sub:- NOC for arranging power supply to an extent of 1200 kW (1.41 MVA) to the proposed residential building in favour of MS. Example Builders Limited at Sy.No. 10/1, 10/2 of Samplepura Village.`;
    const parsed = read(power, 'power_noc.pdf');
    assert.equal(parsed.type, 'utility_noc');
    assert.equal(fact(parsed, 'power_load')?.display, '1,200 kW (1.41 MVA)');
    assert.equal(fact(parsed, 'issued_on')?.value, '2015-10-19');
    assert.equal(fact(parsed, 'issued_to')?.value, 'Example Builders Limited');
  });
});

describe('a certificate of incorporation', () => {
  it('reads a name the scan broke across lines', () => {
    const text = `Corporate Identification Number (CIN): U12345KA2001PLC012345 I hereby certify that the name of the company has been changed from EXAMPLE\nDEVELOPERS LIMITED to EXAMPLE\nBUILDERS LIMITED with effect from the date of this certificate.`;
    const parsed = read(text, 'COI.pdf');
    assert.equal(fact(parsed, 'company_name')?.value, 'EXAMPLE BUILDERS LIMITED');
    assert.equal(fact(parsed, 'former_name')?.value, 'EXAMPLE DEVELOPERS LIMITED');
  });

  it('is read for the CIN and the name, before and after a change', () => {
    const text = `[page 1] GOVERNMENT OF INDIA MINISTRY OF CORPORATE AFFAIRS Registrar of Companies, Bangalore Certificate of Incorporation pursuant to change of name Corporate Identification Number (CIN): U12345KA2001PLC012345 I hereby certify that the name of the company has been changed from EXAMPLE DEVELOPERS LIMITED to EXAMPLE BUILDERS LIMITED with effect from the date of this certificate.`;
    const parsed = read(text, 'MOA__AOA_COI.pdf');
    assert.equal(parsed.type, 'company_incorporation');
    assert.equal(fact(parsed, 'cin')?.value, 'U12345KA2001PLC012345');
    assert.equal(fact(parsed, 'company_name')?.value, 'EXAMPLE BUILDERS LIMITED');
    assert.equal(fact(parsed, 'former_name')?.value, 'EXAMPLE DEVELOPERS LIMITED');
    assert.equal(fact(parsed, 'registrar')?.value, 'Registrar of Companies, Bangalore');
  });
});
