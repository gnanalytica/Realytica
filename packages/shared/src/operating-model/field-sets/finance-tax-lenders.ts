/**
 * The field sets of Finance (funding, cash, the RERA account, receivables),
 * Tax, Lenders and Ledgers, and the rule rows their formulas read.
 *
 * Each department's sets are a file of its own under `finance/`, with the
 * rule rows beside them; this file is the one the index registers.
 */

import type { FieldSet } from '../types';
import { FUNDING_SETS } from './finance/funding';
import { LEDGER_SETS } from './finance/ledgers';
import { LENDER_SETS } from './finance/lenders';
import { TAX_SETS } from './finance/tax';

export { FINANCE_RULE_ROWS } from './finance/rule-rows';

export const FINANCE_TAX_LENDERS_FIELD_SETS: FieldSet[] = [...FUNDING_SETS, ...TAX_SETS, ...LENDER_SETS, ...LEDGER_SETS];
