/**
 * What differs by state and is not a rate: the numbers of the forms a
 * regulator asks for, and customary measures of land. Keyed by state, in
 * lower case. Karnataka first; a state is added by adding its pack here.
 *
 * Nothing here is marked verified until a named person has checked it against
 * the regulation, and the screen says so beside whatever reads it.
 */

export interface StateForm {
  number: string;
  signedBy: string;
  when: string;
  source: string;
  verified: boolean;
  verifiedBy?: string;
}

export interface FieldStatePack {
  state: string;
  /** Square feet in a ground, where the state's records use one of a settled size. */
  groundSqft?: number;
  /** The regulator's forms, by what each is for. */
  forms: Record<string, StateForm>;
}

const KRERA = 'Karnataka Real Estate Regulatory Authority (General) Regulations, 2022';

export const FIELD_STATE_PACKS: Record<string, FieldStatePack> = {
  karnataka: {
    state: 'Karnataka',
    forms: {
      rera_ca_registration: { number: 'Form 1', signedBy: 'Chartered accountant', when: 'Registration', source: KRERA, verified: false },
      rera_architect_registration: { number: 'Form 2', signedBy: 'Architect', when: 'Registration', source: KRERA, verified: false },
      rera_engineer_registration: { number: 'Form 3', signedBy: 'Engineer', when: 'Registration', source: KRERA, verified: false },
      rera_ca_withdrawal: { number: 'Form 4', signedBy: 'Chartered accountant', when: 'Quarterly', source: KRERA, verified: false },
      rera_architect_progress: { number: 'Form 5', signedBy: 'Architect', when: 'Quarterly', source: KRERA, verified: false },
      rera_engineer_cost: { number: 'Form 6', signedBy: 'Engineer', when: 'Quarterly', source: KRERA, verified: false },
      rera_annual_audit: { number: 'Form 7', signedBy: 'Chartered accountant', when: 'Annual', source: KRERA, verified: false },
    },
  },
  'tamil nadu': { state: 'Tamil Nadu', groundSqft: 2400, forms: {} },
  puducherry: { state: 'Puducherry', groundSqft: 2400, forms: {} },
};

export function fieldStatePack(state: string | undefined): FieldStatePack | undefined {
  return state ? FIELD_STATE_PACKS[state.trim().toLowerCase()] : undefined;
}
