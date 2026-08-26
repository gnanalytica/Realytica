/**
 * What a record is worth when nobody has an API for it, and what it takes to
 * get it by hand.
 *
 * This table is the substance of the unconfigured provider, and it is not a
 * consolation prize. For Karnataka it is currently the *only* correct answer:
 * Kaveri and Bhoomi have no supported machine interface, so the manual route
 * is the supported route, and stating it precisely is more useful than an
 * error message about a missing key.
 *
 * `leavesUnknown` is written to be read by someone deciding whether to spend
 * an afternoon on it. "Encumbrance certificate unavailable" tells them
 * nothing; "the chain of title now rests entirely on what the seller chose to
 * hand over" tells them whether to go.
 */

import type { RecordKind } from './types';

export interface ManualRecordRoute {
  label: string;
  leavesUnknown: string;
  manualRoute: string;
}

export const MANUAL_ROUTES: Record<RecordKind, ManualRecordRoute> = {
  encumbrance_certificate: {
    label: 'Encumbrance certificate',
    leavesUnknown:
      'Every registered charge over the title — mortgage, lien, lis pendens, attachment — and, just as importantly, the ' +
      'periods with no entry. Without it the chain of title rests entirely on what the seller chose to hand over.',
    manualRoute:
      'Apply on Kaveri Online Services (kaverionline.karnataka.gov.in) for a Form 15/16 covering at least 30 years against ' +
      'the survey number or PID, or request one at the jurisdictional Sub-Registrar office. Upload the PDF here.',
  },
  certified_instrument: {
    label: 'Certified copy of a registered deed',
    leavesUnknown:
      'The registrar-certified text of the deed — the actual schedule, extent, consideration and parties as registered, ' +
      'rather than as the seller\'s copy states them. A discrepancy between the two is the discrepancy that matters.',
    manualRoute:
      'Order a certified copy on Kaveri Online Services against the registration number and year, or at the Sub-Registrar ' +
      'office that registered it.',
  },
  record_of_rights: {
    label: 'Record of rights (RTC / pahani)',
    leavesUnknown:
      'Who the revenue record shows in possession, the extent it records, and whether the land is still classed ' +
      'agricultural. On unconverted land this is the record that governs, not the khata.',
    manualRoute: 'Download the RTC from Bhoomi (landrecords.karnataka.gov.in) against the survey number.',
  },
  mutation: {
    label: 'Mutation record',
    leavesUnknown:
      'Whether the last transfer was actually carried into the register. An unmutated sale deed means the register still ' +
      'names the previous holder, and the next buyer inherits that gap.',
    manualRoute: 'Request the mutation extract (MR) from Bhoomi for revenue land, or from the BBMP ward office for municipal property.',
  },
  khata_extract: {
    label: 'Khata extract',
    leavesUnknown:
      'The municipal register entry: who it names, the extent it records, and its classification. A B-khata is a financing ' +
      'and resale problem that no sale deed discloses.',
    manualRoute: 'Download from the BBMP e-Khata portal (bbmpeaasthi.karnataka.gov.in), or apply at the ward office.',
  },
  property_tax: {
    label: 'Property tax paid statement',
    leavesUnknown:
      'Whether tax is current, and what the municipality believes about the property\'s extent and use — which regularly ' +
      'differs from the deed.',
    manualRoute: 'Download the paid receipt and the assessment from the BBMP tax portal (bbmptax.karnataka.gov.in) against the PID.',
  },
  survey_map: {
    label: 'Survey map / field measurement book',
    leavesUnknown:
      'Where the boundary actually runs, as surveyed. Nothing else in a file answers this, and the schedule in a deed ' +
      'describes it in words rather than in measurements anyone can check.',
    manualRoute:
      'Apply for the tippani / FMB sketch through the Survey Settlement and Land Records department, or commission a ' +
      'licensed surveyor to measure the parcel against it.',
  },
};
