/**
 * The papers the reading eval is scored on.
 *
 * Every one is invented, for this repository: the people, companies, places,
 * survey numbers, document numbers and amounts belong to nobody. The district
 * (Kadamba), taluk (Suvarnagiri) and hobli (Hirekolale) do not exist, so no
 * survey number here can be looked up as a real parcel. What is real is only
 * what such a paper must carry to be one: the Act a conversion is ordered
 * under, the form number of an encumbrance certificate.
 *
 * Each paper is written once per script from the same true values, so the
 * Kannada page prints exactly the numbers, dates, identifiers and names the
 * English one does and one answer key serves both. In the Kannada version
 * every word of the language is Kannada (headings, labels, standing phrases)
 * and only those entries stay in Latin letters and Western digits. That is
 * the easier half of a real Kannada paper, which writes the names in Kannada
 * too; it is the half that can be scored without arguing over transliteration.
 * The Kannada is form Kannada written for this test, not a lawyer's drafting.
 *
 * `truth` is what the page states, under the reader's own fact keys and in
 * the form the reader reports a value in: a date as YYYY-MM-DD, an area in
 * square metres, an amount in rupees. A list means any of them is right,
 * where the page's own words can fairly be given in either script. A value
 * the reader returns under any other key is something the page does not say.
 *
 * A paper has a first page and a last. An ordinary rendering runs them
 * together; a long scan puts `LONG_SCAN_PAGES_BETWEEN` pages of standing
 * conditions between them, the way a deed's schedule and registration come
 * after its covenants.
 */

import type { ReadDocumentType } from '@realytica/shared';

export type Script = 'en' | 'kn';
export type Value = string | number | boolean;

/** A line that starts "# " is a heading. */
export interface Sides {
  front: string[];
  back: string[];
}

export interface Paper {
  id: string;
  name: string;
  /** What it is, in the reader's vocabulary. */
  kind: ReadDocumentType;
  /** Kannada only for the papers Karnataka issues in Kannada. */
  text: { en: Sides; kn?: Sides };
  truth: Record<string, Value | Value[]>;
}

/** 31850000 as "3,18,50,000": the grouping an Indian paper prints. */
const grouped = (n: number): string => n.toLocaleString('en-IN');

/** "2021-07-09" as "09-07-2021". */
const dmy = (iso: string): string => iso.split('-').reverse().join('-');

/** "2021-07-09" as "9th day of July, 2021", the way a deed dates itself. */
function dayOf(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const th = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${th} day of ${months[month - 1]}, ${year}`;
}

const DISTRICT = 'Kadamba';
const TALUK = 'Suvarnagiri';
const HOBLI = 'Hirekolale';

/* -------------------------------------------------------------------- */
/* Sale deed                                                             */
/* -------------------------------------------------------------------- */

const deed = {
  on: '2021-07-09',
  vendor: 'Copper Kettle Landholdings Private Limited',
  purchaser: 'Nine Lanterns Realty LLP',
  survey: '73/4',
  sqm: 2450,
  price: 31850000,
  stampDuty: 1783600,
  fee: 318500,
  number: 'HRK-1-03127-2021-22',
  road: 'Temple Tank Road',
  /** The deed the vendor bought under, recited on the first page as every deed recites one. */
  earlier: { on: '2003-11-18', number: '1184/2003-04' },
};

const saleDeed: Paper = {
  id: 'sale-deed',
  name: 'Sale deed',
  kind: 'sale_deed',
  text: {
    en: {
      front: [
        '# SALE DEED',
        `This Deed of Absolute Sale is made and executed at ${TALUK} on this the ${dayOf(deed.on)}.`,
        'BY',
        `${deed.vendor}, a company incorporated under the Companies Act, 1956, having its registered office at No. 27, Old Granary Road, ${TALUK}, represented by its authorised signatory Sri M. Honnegowda, hereinafter called the VENDOR.`,
        'IN FAVOUR OF',
        `${deed.purchaser}, a limited liability partnership having its office at No. 5, Tank Bund Lane, ${TALUK}, represented by its designated partner Smt. R. Siddalingamma, hereinafter called the PURCHASER.`,
        `WHEREAS the Vendor is the absolute owner of the land bearing Survey No. ${deed.survey} of Navilugudda Village, having purchased it under a Sale Deed dated ${dmy(deed.earlier.on)}, registered as Document No. ${deed.earlier.number} of Book I in the office of the Sub-Registrar, ${TALUK}.`,
        `WHEREAS the Vendor has agreed to sell and the Purchaser has agreed to purchase the Schedule Property for a total sale consideration of Rs. ${grouped(deed.price)} (Rupees Three Crore Eighteen Lakh Fifty Thousand only).`,
        'NOW THIS DEED WITNESSETH that in consideration of the said sum paid by the Purchaser, the receipt of which the Vendor hereby acknowledges, the Vendor hereby conveys the Schedule Property to the Purchaser absolutely and for ever, free from all encumbrances.',
      ],
      back: [
        '# SCHEDULE PROPERTY',
        `All that piece and parcel of converted land bearing Survey No. ${deed.survey}, situated at Navilugudda Village, ${HOBLI} Hobli, ${TALUK} Taluk, ${DISTRICT} District, measuring ${grouped(deed.sqm)} square metres, having direct access from the public road, and bounded on the:`,
        'North by: Survey No. 72',
        `South by: ${deed.road}`,
        'East by: Survey No. 74/1',
        'West by: Survey No. 73/3',
        'IN WITNESS WHEREOF the parties have signed this Deed on the day, month and year first above written.',
        '# REGISTRATION',
        `Registered as Document No. ${deed.number} in Book I, CD No. HRKD 418, in the office of the Sub-Registrar, ${HOBLI}, on ${dmy(deed.on)}.`,
        `Stamp duty paid: Rs. ${grouped(deed.stampDuty)}. Registration fee paid: Rs. ${grouped(deed.fee)}.`,
      ],
    },
    kn: {
      front: [
        '# ಶುದ್ಧ ಕ್ರಯ ಪತ್ರ',
        `ಈ ಶುದ್ಧ ಕ್ರಯ ಪತ್ರವನ್ನು ದಿನಾಂಕ ${dmy(deed.on)} ರಂದು ${TALUK} ನಲ್ಲಿ ಬರೆದು ಕೊಡಲಾಗಿದೆ.`,
        'ಬರೆದು ಕೊಟ್ಟವರು (ಮಾರಾಟಗಾರರು):',
        `${deed.vendor}, ನೋಂದಾಯಿತ ಕಚೇರಿ: No. 27, Old Granary Road, ${TALUK}, ಇವರ ಪರವಾಗಿ ಅಧಿಕೃತ ಸಹಿದಾರರು Sri M. Honnegowda.`,
        'ಬರೆಸಿಕೊಂಡವರು (ಖರೀದಿದಾರರು):',
        `${deed.purchaser}, ಕಚೇರಿ: No. 5, Tank Bund Lane, ${TALUK}, ಇವರ ಪರವಾಗಿ ನಿಯೋಜಿತ ಪಾಲುದಾರರು Smt. R. Siddalingamma.`,
        `ಮಾರಾಟಗಾರರು Navilugudda ಗ್ರಾಮದ ಸರ್ವೆ ನಂಬರ್ ${deed.survey} ರ ಜಮೀನಿನ ಸಂಪೂರ್ಣ ಮಾಲೀಕರಾಗಿದ್ದು, ಸದರಿ ಜಮೀನನ್ನು ದಿನಾಂಕ ${dmy(deed.earlier.on)} ರ ಕ್ರಯ ಪತ್ರದ ಮೂಲಕ ಖರೀದಿಸಿರುತ್ತಾರೆ. ಆ ಪತ್ರವು ${TALUK} ಉಪ ನೋಂದಣಾಧಿಕಾರಿಗಳ ಕಚೇರಿಯಲ್ಲಿ 1 ನೇ ಪುಸ್ತಕದ ದಸ್ತಾವೇಜು ಸಂಖ್ಯೆ ${deed.earlier.number} ಆಗಿ ನೋಂದಣಿಯಾಗಿರುತ್ತದೆ.`,
        `ಮಾರಾಟಗಾರರು ಷೆಡ್ಯೂಲ್ ಸ್ವತ್ತನ್ನು ಮಾರಲು ಮತ್ತು ಖರೀದಿದಾರರು ಅದನ್ನು ಕೊಳ್ಳಲು ಒಪ್ಪಿದ್ದು, ಒಟ್ಟು ಕ್ರಯದ ಪ್ರತಿಫಲ ರೂ. ${grouped(deed.price)} (ಮೂರು ಕೋಟಿ ಹದಿನೆಂಟು ಲಕ್ಷ ಐವತ್ತು ಸಾವಿರ ರೂಪಾಯಿಗಳು ಮಾತ್ರ) ಆಗಿರುತ್ತದೆ.`,
        'ಸದರಿ ಮೊತ್ತವನ್ನು ಖರೀದಿದಾರರಿಂದ ಪೂರ್ತಿಯಾಗಿ ಪಡೆದುಕೊಂಡು, ಮಾರಾಟಗಾರರು ಷೆಡ್ಯೂಲ್ ಸ್ವತ್ತನ್ನು ಯಾವುದೇ ಋಣಭಾರವಿಲ್ಲದೆ ಖರೀದಿದಾರರಿಗೆ ಶಾಶ್ವತವಾಗಿ ಕ್ರಯಕ್ಕೆ ಕೊಟ್ಟಿರುತ್ತಾರೆ.',
      ],
      back: [
        '# ಸ್ವತ್ತಿನ ಷೆಡ್ಯೂಲ್',
        `${DISTRICT} ಜಿಲ್ಲೆ, ${TALUK} ತಾಲ್ಲೂಕು, ${HOBLI} ಹೋಬಳಿ, Navilugudda ಗ್ರಾಮದ ಸರ್ವೆ ನಂಬರ್ ${deed.survey} ರಲ್ಲಿನ, ಸಾರ್ವಜನಿಕ ರಸ್ತೆಯಿಂದ ನೇರ ಪ್ರವೇಶವಿರುವ, ${grouped(deed.sqm)} ಚದರ ಮೀಟರ್ ವಿಸ್ತೀರ್ಣದ ಪರಿವರ್ತಿತ ಜಮೀನು. ಇದರ ಚಕ್ಕುಬಂದಿ:`,
        'ಉತ್ತರಕ್ಕೆ: ಸರ್ವೆ ನಂಬರ್ 72',
        `ದಕ್ಷಿಣಕ್ಕೆ: ${deed.road}`,
        'ಪೂರ್ವಕ್ಕೆ: ಸರ್ವೆ ನಂಬರ್ 74/1',
        'ಪಶ್ಚಿಮಕ್ಕೆ: ಸರ್ವೆ ನಂಬರ್ 73/3',
        'ಇದಕ್ಕೆ ಸಾಕ್ಷಿಯಾಗಿ ಉಭಯ ಪಕ್ಷಗಾರರು ಮೇಲೆ ಬರೆದ ದಿನ ಈ ಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿರುತ್ತಾರೆ.',
        '# ನೋಂದಣಿ',
        `ಈ ದಸ್ತಾವೇಜು ${HOBLI} ಉಪ ನೋಂದಣಾಧಿಕಾರಿಗಳ ಕಚೇರಿಯಲ್ಲಿ 1 ನೇ ಪುಸ್ತಕದ ದಸ್ತಾವೇಜು ಸಂಖ್ಯೆ ${deed.number} ಆಗಿ, ಸಿ.ಡಿ. ಸಂಖ್ಯೆ HRKD 418 ರಲ್ಲಿ, ದಿನಾಂಕ ${dmy(deed.on)} ರಂದು ನೋಂದಣಿಯಾಗಿದೆ.`,
        `ಪಾವತಿಸಿದ ಮುದ್ರಾಂಕ ಶುಲ್ಕ: ರೂ. ${grouped(deed.stampDuty)}. ನೋಂದಣಿ ಶುಲ್ಕ: ರೂ. ${grouped(deed.fee)}.`,
      ],
    },
  },
  truth: {
    survey_numbers: deed.survey,
    extent_title: deed.sqm,
    registration_date: deed.on,
    document_number: deed.number,
    sub_registrar: HOBLI,
    consideration: deed.price,
    stamp_duty: deed.stampDuty,
    vendor: deed.vendor,
    purchaser: deed.purchaser,
    boundary_north: ['Survey No. 72', 'ಸರ್ವೆ ನಂಬರ್ 72'],
    boundary_south: deed.road,
    boundary_east: ['Survey No. 74/1', 'ಸರ್ವೆ ನಂಬರ್ 74/1'],
    boundary_west: ['Survey No. 73/3', 'ಸರ್ವೆ ನಂಬರ್ 73/3'],
    access_type: 'public road',
  },
};

/* -------------------------------------------------------------------- */
/* Encumbrance certificate                                               */
/* -------------------------------------------------------------------- */

const ec = { survey: '141/2', sqm: 4860, from: '1994-04-01', to: '2024-03-31', issued: '2024-04-22' };

const encumbranceCertificate: Paper = {
  id: 'encumbrance-certificate',
  name: 'Encumbrance certificate',
  kind: 'encumbrance_certificate',
  text: {
    en: {
      front: [
        '# ENCUMBRANCE CERTIFICATE',
        '# FORM No. 15',
        `Office of the Sub-Registrar, ${HOBLI}. Application No. EC/HRK/2024/20961.`,
        'Certificate of encumbrance on the property described below.',
        `Description of the property: Survey No. ${ec.survey}, Bettadakoppa Village, ${HOBLI} Hobli, ${TALUK} Taluk, ${DISTRICT} District, measuring ${grouped(ec.sqm)} square metres.`,
        `Period of search: from ${dmy(ec.from)} to ${dmy(ec.to)}.`,
        'Applicant: Sri K. Basavarajappa.',
      ],
      back: [
        '# TRANSACTIONS FOUND DURING THE PERIOD',
        `1. 14-02-1996 - Sale Deed - Document No. 311/1995-96 - Executant: Sri D. Narasimhamurthy - Claimant: Smt. Girijamma - Consideration Rs. ${grouped(210000)}.`,
        `2. 27-08-2012 - Sale Deed - Document No. HRK-1-01846-2012-13 - Executant: Smt. Girijamma - Claimant: Blue Jacaranda Homesteads Private Limited - Consideration Rs. ${grouped(8640000)}.`,
        `3. 05-12-2019 - Mortgage by deposit of title deeds - Document No. HRK-1-05502-2019-20 - Executant: Blue Jacaranda Homesteads Private Limited - Claimant: ${TALUK} Merchants Co-operative Bank Ltd - Amount secured Rs. ${grouped(12500000)}. No release deed is registered during the period.`,
        'It is certified that a search has been made in Book I and the indexes relating to it for the period stated, and that, save the acts and encumbrances stated above, no other acts or encumbrances affecting the said property have been found.',
        `Date of issue: ${dmy(ec.issued)}. Sub-Registrar, ${HOBLI}.`,
      ],
    },
    kn: {
      front: [
        '# ಋಣಭಾರ ಪ್ರಮಾಣ ಪತ್ರ',
        '# ನಮೂನೆ 15',
        `ಉಪ ನೋಂದಣಾಧಿಕಾರಿಗಳ ಕಚೇರಿ, ${HOBLI}. ಅರ್ಜಿ ಸಂಖ್ಯೆ: EC/HRK/2024/20961.`,
        'ಕೆಳಗೆ ವಿವರಿಸಿದ ಸ್ವತ್ತಿನ ಮೇಲಿನ ಋಣಭಾರಗಳ ಪ್ರಮಾಣ ಪತ್ರ.',
        `ಸ್ವತ್ತಿನ ವಿವರ: ಸರ್ವೆ ನಂಬರ್ ${ec.survey}, Bettadakoppa ಗ್ರಾಮ, ${HOBLI} ಹೋಬಳಿ, ${TALUK} ತಾಲ್ಲೂಕು, ${DISTRICT} ಜಿಲ್ಲೆ, ವಿಸ್ತೀರ್ಣ ${grouped(ec.sqm)} ಚದರ ಮೀಟರ್.`,
        `ಶೋಧನೆಯ ಅವಧಿ: ದಿನಾಂಕ ${dmy(ec.from)} ರಿಂದ ${dmy(ec.to)} ರವರೆಗೆ.`,
        'ಅರ್ಜಿದಾರರು: Sri K. Basavarajappa.',
      ],
      back: [
        '# ಈ ಅವಧಿಯಲ್ಲಿ ಕಂಡುಬಂದ ವ್ಯವಹಾರಗಳು',
        `1. 14-02-1996 - ಕ್ರಯ ಪತ್ರ - ದಸ್ತಾವೇಜು ಸಂಖ್ಯೆ 311/1995-96 - ಬರೆದುಕೊಟ್ಟವರು: Sri D. Narasimhamurthy - ಬರೆಸಿಕೊಂಡವರು: Smt. Girijamma - ಪ್ರತಿಫಲ ರೂ. ${grouped(210000)}.`,
        `2. 27-08-2012 - ಕ್ರಯ ಪತ್ರ - ದಸ್ತಾವೇಜು ಸಂಖ್ಯೆ HRK-1-01846-2012-13 - ಬರೆದುಕೊಟ್ಟವರು: Smt. Girijamma - ಬರೆಸಿಕೊಂಡವರು: Blue Jacaranda Homesteads Private Limited - ಪ್ರತಿಫಲ ರೂ. ${grouped(8640000)}.`,
        `3. 05-12-2019 - ಹಕ್ಕು ಪತ್ರಗಳ ಠೇವಣಿ ಮೂಲಕ ಅಡಮಾನ - ದಸ್ತಾವೇಜು ಸಂಖ್ಯೆ HRK-1-05502-2019-20 - ಬರೆದುಕೊಟ್ಟವರು: Blue Jacaranda Homesteads Private Limited - ಬರೆಸಿಕೊಂಡವರು: ${TALUK} Merchants Co-operative Bank Ltd - ಭದ್ರತೆಯ ಮೊತ್ತ ರೂ. ${grouped(12500000)}. ಈ ಅವಧಿಯಲ್ಲಿ ಯಾವುದೇ ಬಿಡುಗಡೆ ಪತ್ರ ನೋಂದಣಿಯಾಗಿಲ್ಲ.`,
        'ಮೇಲೆ ತಿಳಿಸಿದ ಅವಧಿಗೆ 1 ನೇ ಪುಸ್ತಕ ಮತ್ತು ಅದರ ಸೂಚಿಗಳನ್ನು ಶೋಧಿಸಲಾಗಿದ್ದು, ಮೇಲೆ ನಮೂದಿಸಿದ ವ್ಯವಹಾರಗಳು ಮತ್ತು ಋಣಭಾರಗಳನ್ನು ಹೊರತುಪಡಿಸಿ ಸದರಿ ಸ್ವತ್ತಿನ ಮೇಲೆ ಬೇರೆ ಯಾವುದೇ ಋಣಭಾರ ಕಂಡುಬಂದಿಲ್ಲ ಎಂದು ಪ್ರಮಾಣೀಕರಿಸಲಾಗಿದೆ.',
        `ನೀಡಿದ ದಿನಾಂಕ: ${dmy(ec.issued)}. ಉಪ ನೋಂದಣಾಧಿಕಾರಿ, ${HOBLI}.`,
      ],
    },
  },
  truth: {
    survey_numbers: ec.survey,
    ec_from: ec.from,
    ec_to: ec.to,
    // Three entries, and the third is a mortgage nothing in the period releases.
    ec_transactions: 3,
    ec_nil: false,
    subsisting_charges: 1,
  },
};

/* -------------------------------------------------------------------- */
/* Khata certificate and extract                                         */
/* -------------------------------------------------------------------- */

const khata = { number: '1907/88/3', pid: '47-212-0903', owner: 'Smt. Rathnamma Siddalingaiah', survey: '88/3', sqm: 1115 };

const khataCertificate: Paper = {
  id: 'khata',
  name: 'Khata certificate',
  kind: 'khata',
  text: {
    en: {
      front: [
        '# KHATA CERTIFICATE',
        `${TALUK} City Municipal Council - Revenue Section - Ward No. 14`,
        'Certified that the property described below stands registered in the Khata register of this office.',
        `Khata No.: ${khata.number}`,
        `Name of the owner: ${khata.owner}`,
        'Khata type: A-Khata (Form A register)',
        'Issued on 16-01-2025 by the Assistant Revenue Officer, Ward No. 14.',
      ],
      back: [
        '# KHATA EXTRACT',
        `PID No.: ${khata.pid}`,
        `Property: Survey No. ${khata.survey}, Kallusanka Village, Temple Car Street, ${TALUK}.`,
        `Site area: ${grouped(khata.sqm)} square metres. Built-up area on record: nil (vacant land).`,
        'Property tax paid up to: 2024-25.',
      ],
    },
    kn: {
      front: [
        '# ಖಾತಾ ಪ್ರಮಾಣ ಪತ್ರ',
        `${TALUK} ನಗರಸಭೆ - ಕಂದಾಯ ವಿಭಾಗ - ವಾರ್ಡ್ ಸಂಖ್ಯೆ 14`,
        'ಕೆಳಗೆ ವಿವರಿಸಿದ ಸ್ವತ್ತು ಈ ಕಚೇರಿಯ ಖಾತಾ ವಹಿಯಲ್ಲಿ ದಾಖಲಾಗಿರುತ್ತದೆ ಎಂದು ಪ್ರಮಾಣೀಕರಿಸಲಾಗಿದೆ.',
        `ಖಾತಾ ಸಂಖ್ಯೆ: ${khata.number}`,
        `ಮಾಲೀಕರ ಹೆಸರು: ${khata.owner}`,
        'ಖಾತೆಯ ವಿಧ: ಎ-ಖಾತಾ (ನಮೂನೆ ಎ ವಹಿ)',
        'ದಿನಾಂಕ 16-01-2025 ರಂದು ವಾರ್ಡ್ ಸಂಖ್ಯೆ 14 ರ ಸಹಾಯಕ ಕಂದಾಯ ಅಧಿಕಾರಿಗಳಿಂದ ನೀಡಲಾಗಿದೆ.',
      ],
      back: [
        '# ಖಾತಾ ನಕಲು',
        `ಪಿಐಡಿ ಸಂಖ್ಯೆ: ${khata.pid}`,
        `ಸ್ವತ್ತು: ಸರ್ವೆ ನಂಬರ್ ${khata.survey}, Kallusanka ಗ್ರಾಮ, Temple Car Street, ${TALUK}.`,
        `ನಿವೇಶನದ ವಿಸ್ತೀರ್ಣ: ${grouped(khata.sqm)} ಚದರ ಮೀಟರ್. ದಾಖಲೆಯಲ್ಲಿರುವ ಕಟ್ಟಡದ ವಿಸ್ತೀರ್ಣ: ಇಲ್ಲ (ಖಾಲಿ ನಿವೇಶನ).`,
        'ಆಸ್ತಿ ತೆರಿಗೆ ಪಾವತಿಸಿರುವ ಅವಧಿ: 2024-25 ರವರೆಗೆ.',
      ],
    },
  },
  truth: {
    khata_number: khata.number,
    owner: khata.owner,
    khata_type: 'A-Khata',
    pid: khata.pid,
    survey_numbers: khata.survey,
    extent_khata: khata.sqm,
  },
};

/* -------------------------------------------------------------------- */
/* Property tax receipt                                                  */
/* -------------------------------------------------------------------- */

const tax = { sas: '2024-25-0047-31882', year: '2024-25', paid: 47616, on: '2024-05-11' };

const taxReceipt: Paper = {
  id: 'tax-receipt',
  name: 'Property tax receipt',
  kind: 'property_tax_receipt',
  text: {
    en: {
      front: [
        '# PROPERTY TAX PAYMENT RECEIPT',
        `${TALUK} City Municipal Council - Self Assessment Scheme`,
        `SAS Application No.: ${tax.sas}`,
        `Assessment year: ${tax.year}`,
        `PID No.: ${khata.pid}`,
        `Name of the assessee: ${khata.owner}`,
        `Ward No. 14, Temple Car Street, ${TALUK}.`,
      ],
      back: [
        '# PAYMENT DETAILS',
        `Property tax: Rs. ${grouped(38400)}. Cess: Rs. ${grouped(9216)}. Total amount paid: Rs. ${grouped(tax.paid)}.`,
        `Date of payment: ${dmy(tax.on)}. Mode of payment: Net banking.`,
        'Transaction reference: SCMC2405110093.',
        'This is a computer generated receipt and needs no signature.',
      ],
    },
  },
  truth: {
    sas_number: tax.sas,
    tax_year: tax.year,
    pid: khata.pid,
    tax_paid: tax.paid,
    tax_paid_on: tax.on,
  },
};

/* -------------------------------------------------------------------- */
/* Conversion order                                                      */
/* -------------------------------------------------------------------- */

const conversion = { number: 'ALN(S)(H)SR 84/2018-19', on: '2019-10-03', survey: '56/1' };

const conversionOrder: Paper = {
  id: 'conversion-order',
  name: 'Conversion order',
  kind: 'conversion_order',
  text: {
    en: {
      front: [
        '# OFFICIAL MEMORANDUM',
        `Office of the Deputy Commissioner, ${DISTRICT} District`,
        `No. ${conversion.number}, dated ${dmy(conversion.on)}.`,
        'Subject: Conversion of agricultural land for non-agricultural residential purpose under Section 95(2) of the Karnataka Land Revenue Act, 1964.',
        'Applicant: Tamarind Courtyard Developers Private Limited.',
        `Land: Survey No. ${conversion.survey}, Malligekere Village, ${HOBLI} Hobli, ${TALUK} Taluk, measuring 2 Acres 10 Guntas.`,
      ],
      back: [
        '# ORDER',
        'Permission is hereby granted to convert the above land from agricultural to non-agricultural residential purpose, subject to the conditions of this order.',
        `The conversion fine of Rs. ${grouped(437400)} has been paid by challan dated 19-09-2019.`,
        'The land shall be used only for the purpose for which it is converted, and the work shall begin within two years of this order.',
        `Deputy Commissioner, ${DISTRICT} District.`,
      ],
    },
    kn: {
      front: [
        '# ಅಧಿಕೃತ ಜ್ಞಾಪನ',
        `ಜಿಲ್ಲಾಧಿಕಾರಿಗಳ ಕಚೇರಿ, ${DISTRICT} ಜಿಲ್ಲೆ`,
        `ಸಂಖ್ಯೆ: ${conversion.number}, ದಿನಾಂಕ: ${dmy(conversion.on)}.`,
        'ವಿಷಯ: ಕರ್ನಾಟಕ ಭೂ ಕಂದಾಯ ಅಧಿನಿಯಮ, 1964 ರ ಕಲಂ 95(2) ರ ಅಡಿಯಲ್ಲಿ ಕೃಷಿ ಜಮೀನನ್ನು ಕೃಷಿಯೇತರ ವಾಸದ ಉದ್ದೇಶಕ್ಕೆ ಪರಿವರ್ತಿಸುವ ಬಗ್ಗೆ.',
        'ಅರ್ಜಿದಾರರು: Tamarind Courtyard Developers Private Limited.',
        `ಜಮೀನು: ಸರ್ವೆ ನಂಬರ್ ${conversion.survey}, Malligekere ಗ್ರಾಮ, ${HOBLI} ಹೋಬಳಿ, ${TALUK} ತಾಲ್ಲೂಕು, ವಿಸ್ತೀರ್ಣ 2 ಎಕರೆ 10 ಗುಂಟೆ.`,
      ],
      back: [
        '# ಆದೇಶ',
        'ಮೇಲ್ಕಂಡ ಜಮೀನನ್ನು ಈ ಆದೇಶದ ಷರತ್ತುಗಳಿಗೆ ಒಳಪಟ್ಟು ಕೃಷಿ ಉದ್ದೇಶದಿಂದ ಕೃಷಿಯೇತರ ವಾಸದ ಉದ್ದೇಶಕ್ಕೆ ಪರಿವರ್ತಿಸಲು ಈ ಮೂಲಕ ಅನುಮತಿ ನೀಡಲಾಗಿದೆ.',
        `ಪರಿವರ್ತನಾ ಶುಲ್ಕ ರೂ. ${grouped(437400)} ಅನ್ನು ದಿನಾಂಕ 19-09-2019 ರ ಚಲನ್ ಮೂಲಕ ಪಾವತಿಸಲಾಗಿದೆ.`,
        'ಜಮೀನನ್ನು ಪರಿವರ್ತಿಸಿದ ಉದ್ದೇಶಕ್ಕೆ ಮಾತ್ರ ಬಳಸತಕ್ಕದ್ದು ಮತ್ತು ಈ ಆದೇಶದ ದಿನಾಂಕದಿಂದ ಎರಡು ವರ್ಷದೊಳಗೆ ಕಾಮಗಾರಿಯನ್ನು ಪ್ರಾರಂಭಿಸತಕ್ಕದ್ದು.',
        `ಜಿಲ್ಲಾಧಿಕಾರಿ, ${DISTRICT} ಜಿಲ್ಲೆ.`,
      ],
    },
  },
  truth: {
    order_number: conversion.number,
    conversion_date: conversion.on,
    converted_use: 'residential',
    survey_numbers: conversion.survey,
    conversion_status: 'converted',
  },
};

/* -------------------------------------------------------------------- */
/* Building plan sanction                                                */
/* -------------------------------------------------------------------- */

const sanction = { number: 'SCC/TP/LP/0219/2022-23', on: '2022-08-17', survey: '204/5', site: 3640, built: 8190, far: 2.25, refuge: 96 };

const planSanction: Paper = {
  id: 'plan-sanction',
  name: 'Building plan sanction',
  kind: 'building_sanction',
  text: {
    en: {
      front: [
        '# BUILDING PLAN SANCTION',
        `${TALUK} City Corporation - Town Planning Section`,
        `LP No. ${sanction.number}`,
        `Date of sanction: ${dmy(sanction.on)}`,
        'Applicant: Kingfisher Ridge Housing LLP.',
        `Property: Survey No. ${sanction.survey}, Anegundipura Village, PID No. 47-305-1127.`,
        'Proposal: Residential apartment building of stilt, ground and nine upper floors.',
      ],
      back: [
        '# AREA STATEMENT',
        `Site area: ${grouped(sanction.site)} square metres.`,
        `Sanctioned built-up area: ${grouped(sanction.built)} square metres.`,
        `FAR sanctioned: ${sanction.far}. Ground coverage sanctioned: 38 percent.`,
        `Refuge area provided: ${sanction.refuge} square metres.`,
        'This sanction is valid for two years from the date of sanction.',
      ],
    },
  },
  truth: {
    sanction_number: sanction.number,
    sanction_date: sanction.on,
    survey_numbers: sanction.survey,
    sanctioned_extent: sanction.site,
    sanctioned_area: sanction.built,
    sanctioned_far: sanction.far,
    refuge_area_provided: sanction.refuge,
  },
};

/* -------------------------------------------------------------------- */
/* Zoning certificate                                                    */
/* -------------------------------------------------------------------- */

const zoning = { survey: '19/2', use: 'Residential (Mixed)', plan: 'Revised Master Plan 2031', far: 1.75, roadFeet: 60 };

const zoningCertificate: Paper = {
  id: 'zoning-certificate',
  name: 'Zoning certificate',
  kind: 'zoning_certificate',
  text: {
    en: {
      front: [
        '# ZONING CERTIFICATE',
        `${TALUK} Urban Development Authority - Town Planning Section`,
        'Certificate No. SUDA/TP/ZC/2024/0715, dated 28-06-2024.',
        `Property: Survey No. ${zoning.survey}, Tavarekoppalu Village, ${HOBLI} Hobli, ${TALUK} Taluk.`,
        'Issued to: Seventh Banyan Estates LLP.',
      ],
      back: [
        '# PARTICULARS',
        `Land use as per the ${zoning.plan}: ${zoning.use}.`,
        `Abutting road width as per the plan: 18 metres (${zoning.roadFeet} feet).`,
        `Permissible FAR: ${zoning.far}. Permissible ground coverage: 55 percent.`,
        'This certificate states only the land use in the plan in force. It is not a permission to build.',
      ],
    },
  },
  truth: {
    survey_numbers: zoning.survey,
    zoning: zoning.use,
    plan_in_force: zoning.plan,
    road_width_ft: zoning.roadFeet,
    permissible_far: zoning.far,
  },
};

/* -------------------------------------------------------------------- */
/* Survey sketch                                                         */
/* -------------------------------------------------------------------- */

const sketch = { survey: '112/6', sqm: 6275, roadFeet: 30, on: '2023-11-21' };

const surveySketch: Paper = {
  id: 'survey-sketch',
  name: 'Survey sketch',
  kind: 'survey_sketch',
  text: {
    en: {
      front: [
        '# SURVEY SKETCH',
        'Department of Survey, Settlement and Land Records',
        `Survey No. ${sketch.survey}, Kallusanka Village, ${HOBLI} Hobli, ${TALUK} Taluk, ${DISTRICT} District.`,
        'Applicant: Sri H. Thimmarayappa.',
      ],
      back: [
        '# MEASUREMENT',
        `Extent as measured on the ground: ${grouped(sketch.sqm)} square metres.`,
        `Abutting road: Kallusanka Village Road, road width ${sketch.roadFeet} feet.`,
        `Sketch prepared on ${dmy(sketch.on)} by the Licensed Surveyor, ${TALUK}.`,
      ],
    },
    kn: {
      front: [
        '# ಸರ್ವೆ ನಕ್ಷೆ',
        'ಭೂಮಾಪನ, ಕಂದಾಯ ವ್ಯವಸ್ಥೆ ಮತ್ತು ಭೂ ದಾಖಲೆಗಳ ಇಲಾಖೆ',
        `ಸರ್ವೆ ನಂಬರ್ ${sketch.survey}, Kallusanka ಗ್ರಾಮ, ${HOBLI} ಹೋಬಳಿ, ${TALUK} ತಾಲ್ಲೂಕು, ${DISTRICT} ಜಿಲ್ಲೆ.`,
        'ಅರ್ಜಿದಾರರು: Sri H. Thimmarayappa.',
      ],
      back: [
        '# ಅಳತೆಯ ವಿವರ',
        `ಸ್ಥಳದಲ್ಲಿ ಅಳತೆ ಮಾಡಿದಂತೆ ವಿಸ್ತೀರ್ಣ: ${grouped(sketch.sqm)} ಚದರ ಮೀಟರ್.`,
        `ಹೊಂದಿಕೊಂಡಿರುವ ರಸ್ತೆ: Kallusanka Village Road, ರಸ್ತೆಯ ಅಗಲ ${sketch.roadFeet} ಅಡಿ.`,
        `ಈ ನಕ್ಷೆಯನ್ನು ದಿನಾಂಕ ${dmy(sketch.on)} ರಂದು ${TALUK} ನ ಪರವಾನಗಿ ಪಡೆದ ಭೂಮಾಪಕರು ತಯಾರಿಸಿರುತ್ತಾರೆ.`,
      ],
    },
  },
  truth: {
    survey_numbers: sketch.survey,
    extent_survey: sketch.sqm,
    road_width_ft: sketch.roadFeet,
    survey_date: sketch.on,
  },
};

/* -------------------------------------------------------------------- */
/* RTC                                                                   */
/* -------------------------------------------------------------------- */

/*
 * The one paper that is only ever issued in Kannada. The English side is the
 * translation a diligence file carries beside it.
 */
const rtc = { survey: '9/3', owner: 'Sri D. Narasimhamurthy', father: 'Sri Doddaiah' };

const recordOfRights: Paper = {
  id: 'rtc',
  name: 'RTC',
  kind: 'rtc',
  text: {
    en: {
      front: [
        '# RECORD OF RIGHTS, TENANCY AND CROPS (RTC)',
        'Form No. 16 - Revenue Department',
        `Village: Bettadakoppa. Hobli: ${HOBLI}. Taluk: ${TALUK}. District: ${DISTRICT}.`,
        `Survey No. ${rtc.survey}. Valid for the year 2023-24.`,
        `Name of the owner: ${rtc.owner}, son of ${rtc.father}`,
        'Extent: 1 Acre 22 Guntas. Kharab: nil.',
      ],
      back: [
        '# CULTIVATION AND RIGHTS',
        `Name of the cultivator: ${rtc.owner} (self).`,
        'Nature of possession: by purchase, Mutation Register No. H6/2009-10.',
        'Crop: Ragi. Source of water: rain fed.',
        'Rights and liabilities: nil.',
      ],
    },
    kn: {
      front: [
        '# ಹಕ್ಕು, ಗೇಣಿ ಮತ್ತು ಪಹಣಿ ಪತ್ರ (ಆರ್.ಟಿ.ಸಿ)',
        'ನಮೂನೆ 16 - ಕಂದಾಯ ಇಲಾಖೆ',
        `ಗ್ರಾಮ: Bettadakoppa. ಹೋಬಳಿ: ${HOBLI}. ತಾಲ್ಲೂಕು: ${TALUK}. ಜಿಲ್ಲೆ: ${DISTRICT}.`,
        `ಸರ್ವೆ ನಂಬರ್ ${rtc.survey}. 2023-24 ನೇ ಸಾಲಿಗೆ ಮಾನ್ಯ.`,
        `ಮಾಲೀಕರ ಹೆಸರು: ${rtc.owner}, ತಂದೆ ${rtc.father}`,
        'ವಿಸ್ತೀರ್ಣ: 1 ಎಕರೆ 22 ಗುಂಟೆ. ಖರಾಬು: ಇಲ್ಲ.',
      ],
      back: [
        '# ಸಾಗುವಳಿ ಮತ್ತು ಹಕ್ಕುಗಳು',
        `ಸಾಗುವಳಿದಾರರ ಹೆಸರು: ${rtc.owner} (ಸ್ವಂತ).`,
        'ಸ್ವಾಧೀನದ ರೀತಿ: ಕ್ರಯದ ಮೂಲಕ, ಮ್ಯುಟೇಶನ್ ವಹಿ ಸಂಖ್ಯೆ H6/2009-10.',
        'ಬೆಳೆ: ರಾಗಿ. ನೀರಿನ ಮೂಲ: ಮಳೆ ಆಶ್ರಿತ.',
        'ಹಕ್ಕುಗಳು ಮತ್ತು ಋಣಗಳು: ಇಲ್ಲ.',
      ],
    },
  },
  truth: {
    survey_numbers: rtc.survey,
    owner: [rtc.owner, `${rtc.owner}, son of ${rtc.father}`],
    // 1 acre 22 guntas: 4,046.86 + 22 x 101.17 square metres.
    extent_title: 6273,
  },
};

export const PAPERS: Paper[] = [
  saleDeed,
  encumbranceCertificate,
  khataCertificate,
  taxReceipt,
  conversionOrder,
  planSanction,
  zoningCertificate,
  surveySketch,
  recordOfRights,
];

/* -------------------------------------------------------------------- */
/* The pages a long scan puts between a paper's first page and its last  */
/* -------------------------------------------------------------------- */

/**
 * Enough that the last page of a long scan lies past the eight scanned pages
 * the reader reads today, whatever the first page runs to.
 */
export const LONG_SCAN_PAGES_BETWEEN = 8;

const CONDITIONS_PER_PAGE = 5;

/*
 * Standing conditions that state nothing: no number but their own, no date,
 * no amount, and none of the words the reader tells one paper from another
 * by. The eval checks that before it runs (see `checkPapers`), because a
 * condition that read as a fact would be scored against the reader.
 */
const CONDITIONS: Record<Script, { heading: string; lines: string[] }> = {
  en: {
    heading: 'GENERAL CONDITIONS',
    lines: [
      'This copy is given at the request of the applicant and is to be read together with the register kept in this office.',
      'Any correction, erasure or overwriting on this copy makes it void unless it carries the initials of the officer who gave it.',
      'The applicant shall keep this paper safely and shall produce it whenever an officer asks to see it.',
      'Names of persons and places are spelt here exactly as they appear in the office register.',
      'A fresh copy may be had on application in the prescribed form, with the prescribed fee.',
      'Where a page of this paper is torn, stained or cannot be read, the applicant shall apply for a fresh copy and shall not rely on the damaged one.',
      'This office is not answerable for anything done with this paper beyond what it was applied for.',
      'A mistake noticed in this paper shall be brought to the notice of the office in writing as soon as it is seen.',
      'The seal and signature at the foot of the last page apply to every page of this paper.',
      'Nothing in these conditions adds to or takes away from what the body of this paper states.',
    ],
  },
  kn: {
    heading: 'ಸಾಮಾನ್ಯ ಷರತ್ತುಗಳು',
    lines: [
      'ಈ ಪ್ರತಿಯನ್ನು ಅರ್ಜಿದಾರರ ಕೋರಿಕೆಯ ಮೇರೆಗೆ ನೀಡಲಾಗಿದ್ದು, ಇದನ್ನು ಈ ಕಚೇರಿಯಲ್ಲಿರುವ ವಹಿಯೊಂದಿಗೆ ಹೋಲಿಸಿ ಓದತಕ್ಕದ್ದು.',
      'ಈ ಪ್ರತಿಯಲ್ಲಿ ಮಾಡಿದ ಯಾವುದೇ ತಿದ್ದುಪಡಿ, ಅಳಿಸುವಿಕೆ ಅಥವಾ ಮೇಲ್ಬರಹಕ್ಕೆ ನೀಡಿದ ಅಧಿಕಾರಿಯ ಸಹಿ ಇಲ್ಲದಿದ್ದರೆ ಈ ಪ್ರತಿ ಅಸಿಂಧುವಾಗುತ್ತದೆ.',
      'ಅರ್ಜಿದಾರರು ಈ ಪತ್ರವನ್ನು ಜೋಪಾನವಾಗಿ ಇಟ್ಟುಕೊಂಡು, ಅಧಿಕಾರಿಗಳು ಕೇಳಿದಾಗ ಹಾಜರುಪಡಿಸತಕ್ಕದ್ದು.',
      'ವ್ಯಕ್ತಿಗಳ ಮತ್ತು ಸ್ಥಳಗಳ ಹೆಸರುಗಳನ್ನು ಕಚೇರಿಯ ವಹಿಯಲ್ಲಿ ಇರುವಂತೆಯೇ ಇಲ್ಲಿ ಬರೆಯಲಾಗಿದೆ.',
      'ನಿಗದಿತ ನಮೂನೆಯಲ್ಲಿ ಅರ್ಜಿ ಸಲ್ಲಿಸಿ, ನಿಗದಿತ ಶುಲ್ಕ ಪಾವತಿಸಿ ಹೊಸ ಪ್ರತಿಯನ್ನು ಪಡೆಯಬಹುದು.',
      'ಈ ಪತ್ರದ ಯಾವುದೇ ಪುಟ ಹರಿದಿದ್ದರೆ, ಕಲೆಯಾಗಿದ್ದರೆ ಅಥವಾ ಓದಲು ಬಾರದಿದ್ದರೆ ಅರ್ಜಿದಾರರು ಹೊಸ ಪ್ರತಿಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸತಕ್ಕದ್ದು.',
      'ಯಾವ ಉದ್ದೇಶಕ್ಕಾಗಿ ಈ ಪತ್ರವನ್ನು ಕೋರಲಾಗಿದೆಯೋ ಅದನ್ನು ಬಿಟ್ಟು ಬೇರೆ ಬಳಕೆಗೆ ಈ ಕಚೇರಿ ಹೊಣೆಯಲ್ಲ.',
      'ಈ ಪತ್ರದಲ್ಲಿ ಕಂಡುಬಂದ ತಪ್ಪನ್ನು ಕೂಡಲೇ ಲಿಖಿತವಾಗಿ ಕಚೇರಿಯ ಗಮನಕ್ಕೆ ತರತಕ್ಕದ್ದು.',
      'ಕೊನೆಯ ಪುಟದ ಕೆಳಗಿರುವ ಮುದ್ರೆ ಮತ್ತು ಸಹಿ ಈ ಪತ್ರದ ಎಲ್ಲಾ ಪುಟಗಳಿಗೂ ಅನ್ವಯಿಸುತ್ತದೆ.',
      'ಈ ಷರತ್ತುಗಳು ಪತ್ರದ ಮುಖ್ಯ ಭಾಗದಲ್ಲಿ ಹೇಳಿರುವುದಕ್ಕೆ ಏನನ್ನೂ ಸೇರಿಸುವುದಿಲ್ಲ, ಏನನ್ನೂ ತೆಗೆಯುವುದಿಲ್ಲ.',
    ],
  },
};

/** One page of conditions, numbered on from the page before. `page` counts from 0. */
export function conditionsPage(script: Script, page: number): string[] {
  const { heading, lines } = CONDITIONS[script];
  const numbered = Array.from({ length: CONDITIONS_PER_PAGE }, (_, i) => {
    const n = page * CONDITIONS_PER_PAGE + i;
    return `${n + 1}. ${lines[n % lines.length]}`;
  });
  return [`# ${heading}`, ...numbered];
}
