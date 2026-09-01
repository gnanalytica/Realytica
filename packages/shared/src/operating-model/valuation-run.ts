/**
 * Running the approaches against what the file actually records.
 *
 * Every input is looked for on the valuation scope's own checks first, and
 * falls back to a project particular or a locality median only where that is
 * an honest thing to do — recording WHICH of the three it used on the input
 * itself, so a report can say "the area is evidenced, the rate is not".
 *
 * Four rules run through all of it:
 *
 * 1. **A missing input stops its approach.** It never becomes zero and never
 *    becomes a default. The previous version defaulted a missing locality rate
 *    to 18,000/sqm and valued sites on it with nothing on the page to say so.
 * 2. **Cost is depreciated.** A replacement cost with no depreciation
 *    overstates an old building by whatever share of its life has run, and the
 *    old code did this on every asset it touched.
 * 3. **Income is capitalised from NET income.** Rent, less vacancy, less
 *    operating expenses, over a capitalisation rate. The old formula was
 *    `capital × grossYield / 0.07`, which is the comparable figure multiplied
 *    by a ratio of yields — the market number wearing an income approach's
 *    name.
 * 4. **A residual carries profit and finance.** GDV less construction is the
 *    price a developer would pay if they worked for nothing and borrowed for
 *    free, which is not a number anybody should see.
 */

import { fieldNumber, withComputed } from './check-fields';
import { CHECK_DEFINITIONS } from './libraries';
import { ApproachBuilder, reconcile, type ValuationApproachRun, type ValuationInput, type ValuationInputSource, type ValuationReconciliation } from './valuation-model';
import type { CheckInstance, DdProject } from './types';
import type { LocalityReference } from '../types';

/* ==================================================================== */
/* Finding an input                                                      */
/* ==================================================================== */

interface CheckField {
  value: number | null;
  source: ValuationInputSource;
  evidenceId?: string;
}

/** Every check on the file, by its definition id. Scope instances may repeat; the newest wins. */
function checksByDefinition(project: DdProject): Map<string, CheckInstance> {
  const out = new Map<string, CheckInstance>();
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        const held = out.get(check.definitionId);
        // A file can carry the same check on two assessments. The most
        // recently updated one is the current answer; picking arbitrarily
        // would make the valuation depend on assessment creation order.
        if (!held || check.updatedAt > held.updatedAt) out.set(check.definitionId, check);
      }
    }
  }
  return out;
}

/**
 * The recorded values of one check, computed fields included.
 *
 * Reads the schema off the catalogue rather than through `operations`, which
 * keeps this module out of the operations/report cycle and — more usefully —
 * means the valuation sees exactly the same values the check panel does,
 * including the derived ones like `depreciation_pct`.
 */
function valuesOf(check: CheckInstance) {
  const def = CHECK_DEFINITIONS.find((d) => d.id === check.definitionId);
  return withComputed(def?.fields ?? [], check.fields ?? {});
}

function fromCheck(checks: Map<string, CheckInstance>, definitionId: string, fieldKey: string): CheckField | null {
  const check = checks.get(definitionId);
  if (!check) return null;
  const value = valuesOf(check)[fieldKey];
  if (!value) return null;
  const n = fieldNumber(value);
  if (n === null) return null;
  return {
    value: n,
    source: { kind: 'check_field', checkId: check.id, checkTitle: check.title, fieldKey },
    ...(value.sourceEvidenceId ? { evidenceId: value.sourceEvidenceId } : {}),
  };
}

/**
 * The area a valuation should be run on.
 *
 * Prefers the RERA carpet figure whenever the quoted basis has no statutory
 * definition — which is the whole point of having recorded both. A value
 * stated on super built-up is a value stated on a number the seller chose the
 * loading for, and `areaBasisIsUndefined` already knows which those are.
 */
function valuationArea(project: DdProject, checks: Map<string, CheckInstance>): ValuationInput {
  const quotedBasis = checks.get('indicative_valuation.subject');
  const basisValue = quotedBasis ? valuesOf(quotedBasis).quoted_basis : undefined;
  const basis = basisValue && typeof basisValue.value === 'string' ? basisValue.value : '';

  const carpet = fromCheck(checks, 'indicative_valuation.subject', 'rera_carpet_area');
  const quoted = fromCheck(checks, 'indicative_valuation.subject', 'quoted_area');

  if (basis && areaBasisIsUndefinedLocal(basis) && carpet) {
    return {
      key: 'area',
      label: 'Area valued (RERA carpet)',
      value: carpet.value,
      unit: 'sqm',
      source: carpet.source,
      ...(carpet.evidenceId ? { evidenceId: carpet.evidenceId } : {}),
      note: `The quote is on ${basis}, which has no statutory definition, so the RERA carpet figure is used instead.`,
    };
  }
  if (quoted) {
    return {
      key: 'area',
      label: `Area valued${basis ? ` (${basis})` : ''}`,
      value: quoted.value,
      unit: 'sqm',
      source: quoted.source,
      ...(quoted.evidenceId ? { evidenceId: quoted.evidenceId } : {}),
    };
  }
  // Last resort, and marked as one. A project particular is a number somebody
  // typed on a form, not one read off a drawing against a proof requirement.
  const saleable = project.saleableAreaSqm || project.builtUpAreaSqm || null;
  return {
    key: 'area',
    label: 'Area valued',
    value: saleable,
    unit: 'sqm',
    source: { kind: 'project', field: 'saleableAreaSqm' },
    note: 'No area recorded on Subject identification, so the project particular is used. It carries no proof requirement.',
  };
}

/** Local copy of the standards rule, to keep this module free of a cycle. */
function areaBasisIsUndefinedLocal(basis: string): boolean {
  const key = basis.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return key !== 'carpet';
}

/* ==================================================================== */
/* The approaches                                                        */
/* ==================================================================== */

export interface ValuationWorking {
  runs: ValuationApproachRun[];
  reconciliation: ValuationReconciliation;
  area: ValuationInput;
}

export function runValuationApproaches(project: DdProject, locality?: LocalityReference): ValuationWorking {
  const checks = checksByDefinition(project);
  const area = valuationArea(project, checks);

  return finishWorking(
    [
      comparableApproach(project, checks, locality, area),
      costApproach(project, checks, locality),
      incomeApproach(project, checks, area),
      residualApproach(project, checks),
    ],
    area,
  );
}

function finishWorking(runs: ValuationApproachRun[], area: ValuationInput): ValuationWorking {
  return { runs, reconciliation: reconcile(runs), area };
}

function comparableApproach(
  project: DdProject,
  checks: Map<string, CheckInstance>,
  locality: LocalityReference | undefined,
  area: ValuationInput,
): ValuationApproachRun {
  const b = new ApproachBuilder('comparable_rate', 'area × rate × (1 + net adjustment)');
  const a = b.need(area);

  const recorded = fromCheck(checks, 'indicative_valuation.comparable_inputs', 'rate_per_sqm');
  const rate = b.need(
    recorded
      ? { key: 'rate', label: 'Rate applied', value: recorded.value, unit: 'INR/sqm', source: recorded.source, ...(recorded.evidenceId ? { evidenceId: recorded.evidenceId } : {}) }
      : {
          key: 'rate',
          label: 'Rate applied',
          // A locality median is used only when nobody recorded a rate, and it
          // is labelled as what it is. When there is no locality either, this
          // is null and the approach does not run — which is the correct
          // outcome and the one the old `?? 18_000` prevented.
          value: locality?.medianPricePerSqm ?? null,
          unit: 'INR/sqm',
          source: locality
            ? { kind: 'locality', localityId: locality.id, localityLabel: `${locality.locality}, ${locality.city}`, field: 'medianPricePerSqm' }
            : { kind: 'assumption', statedBy: 'nobody' },
          note: locality ? 'No rate recorded on the comparable-inputs check, so the locality median stands in. It was not inspected for this asset.' : undefined,
        },
  );

  const adjustment = b.optional(
    {
      key: 'net_adjustment',
      label: 'Net adjustment to the comparables',
      value: fromCheck(checks, 'indicative_valuation.comparable_inputs', 'net_adjustment_pct')?.value ?? null,
      unit: '%',
      source: { kind: 'check_field', checkId: '', checkTitle: 'Comparable evidence', fieldKey: 'net_adjustment_pct' },
    },
    0,
  );

  if (a === null || rate === null) return b.done(null, 0, '');

  const gross = b.step('Gross', `${a.toLocaleString('en-IN')} sqm × ${rate.toLocaleString('en-IN')}/sqm`, a * rate, 'INR');
  const amount = adjustment
    ? b.step('Adjusted', `${Math.round(gross).toLocaleString('en-IN')} × (1 ${adjustment >= 0 ? '+' : '−'} ${Math.abs(adjustment)}%)`, gross * (1 + adjustment / 100), 'INR')
    : gross;

  const evidenced = recorded !== null;
  return b.done(
    amount,
    evidenced ? 0.45 : 0.3,
    evidenced
      ? 'Weighted highest: the rate rests on comparables recorded on this file.'
      : 'Weighted lower than usual for a market approach: the rate is a locality median, not comparables inspected for this asset.',
  );
}

function costApproach(project: DdProject, checks: Map<string, CheckInstance>, locality: LocalityReference | undefined): ValuationApproachRun {
  const b = new ApproachBuilder(
    'depreciated_replacement_cost',
    'land area × land rate + built area × replacement rate × (1 − effective age ÷ expected life)',
  );

  const landArea = b.need({
    key: 'land_area',
    label: 'Plot area',
    value: project.landAreaSqm ?? null,
    unit: 'sqm',
    source: { kind: 'project', field: 'landAreaSqm' },
  });

  const landRateField = fromCheck(checks, 'indicative_valuation.cost_inputs', 'land_rate_per_sqm');
  const landRate = b.need(
    landRateField
      ? { key: 'land_rate', label: 'Land rate', value: landRateField.value, unit: 'INR/sqm', source: landRateField.source, ...(landRateField.evidenceId ? { evidenceId: landRateField.evidenceId } : {}) }
      : {
          key: 'land_rate',
          label: 'Land rate',
          value: locality?.medianLandRatePerSqm ?? null,
          unit: 'INR/sqm',
          source: locality
            ? { kind: 'locality', localityId: locality.id, localityLabel: `${locality.locality}, ${locality.city}`, field: 'medianLandRatePerSqm' }
            : { kind: 'assumption', statedBy: 'nobody' },
        },
  );

  const builtArea = project.builtUpAreaSqm ?? 0;
  let building = 0;
  if (builtArea > 0) {
    const rateField = fromCheck(checks, 'indicative_valuation.cost_inputs', 'replacement_rate');
    const replacement = b.need(
      rateField
        ? { key: 'replacement_rate', label: 'Replacement cost', value: rateField.value, unit: 'INR/sqm', source: rateField.source, ...(rateField.evidenceId ? { evidenceId: rateField.evidenceId } : {}) }
        : {
            key: 'replacement_rate',
            label: 'Replacement cost',
            value: locality?.replacementCostPerSqm ?? null,
            unit: 'INR/sqm',
            source: locality
              ? { kind: 'locality', localityId: locality.id, localityLabel: `${locality.locality}, ${locality.city}`, field: 'replacementCostPerSqm' }
              : { kind: 'assumption', statedBy: 'nobody' },
          },
    );
    // Depreciation is REQUIRED once there is a building. An undepreciated
    // replacement cost is the error the previous version made on every asset,
    // and it is always in the same direction: too high.
    const age = b.need({
      key: 'effective_age',
      label: 'Effective age',
      value: fromCheck(checks, 'indicative_valuation.cost_inputs', 'effective_age_years')?.value ?? null,
      unit: 'years',
      source: { kind: 'check_field', checkId: '', checkTitle: 'Replacement cost', fieldKey: 'effective_age_years' },
    });
    const life = b.need({
      key: 'expected_life',
      label: 'Expected total life',
      value: fromCheck(checks, 'indicative_valuation.cost_inputs', 'expected_life_years')?.value ?? null,
      unit: 'years',
      source: { kind: 'check_field', checkId: '', checkTitle: 'Replacement cost', fieldKey: 'expected_life_years' },
    });

    if (replacement === null || age === null || life === null || life <= 0) return b.done(null, 0, '');
    const gross = b.step('Replacement, new', `${builtArea.toLocaleString('en-IN')} sqm × ${replacement.toLocaleString('en-IN')}/sqm`, builtArea * replacement, 'INR');
    const depreciation = Math.min(1, Math.max(0, age / life));
    building = b.step(
      'Less depreciation',
      `${Math.round(gross).toLocaleString('en-IN')} × (1 − ${age}/${life})`,
      gross * (1 - depreciation),
      'INR',
    );
  }

  if (landArea === null || landRate === null) return b.done(null, 0, '');
  const land = b.step('Land', `${landArea.toLocaleString('en-IN')} sqm × ${landRate.toLocaleString('en-IN')}/sqm`, landArea * landRate, 'INR');
  const amount = builtArea > 0 ? b.step('Land + depreciated building', `${Math.round(land).toLocaleString('en-IN')} + ${Math.round(building).toLocaleString('en-IN')}`, land + building, 'INR') : land;

  return b.done(
    amount,
    0.3,
    builtArea > 0
      ? 'A cross-check rather than a primary indication: replacement cost sets an upper bound on what a buyer would pay to acquire rather than build.'
      : 'Land only — no built area recorded, so this is a land-rate indication.',
  );
}

function incomeApproach(project: DdProject, checks: Map<string, CheckInstance>, area: ValuationInput): ValuationApproachRun {
  const b = new ApproachBuilder(
    'investment_income',
    '((rent × area × 12) × (1 − vacancy) × (1 − opex)) ÷ cap rate',
  );

  const letField = fromCheck(checks, 'indicative_valuation.income_inputs', 'let_area');
  const lettable = b.need(
    letField
      ? { key: 'let_area', label: 'Lettable area', value: letField.value, unit: 'sqm', source: letField.source }
      : { ...area, key: 'let_area', label: 'Lettable area (from Subject identification)' },
  );
  const rentField = fromCheck(checks, 'indicative_valuation.income_inputs', 'achievable_rent');
  const rent = b.need({
    key: 'rent',
    label: 'Achievable rent',
    value: rentField?.value ?? null,
    unit: 'INR/sqm/month',
    source: rentField?.source ?? { kind: 'check_field', checkId: '', checkTitle: 'Income inputs', fieldKey: 'achievable_rent' },
    ...(rentField?.evidenceId ? { evidenceId: rentField.evidenceId } : {}),
  });
  const capField = fromCheck(checks, 'indicative_valuation.income_inputs', 'cap_rate_pct');
  const cap = b.need({
    key: 'cap_rate',
    label: 'Capitalisation rate',
    value: capField?.value ?? null,
    unit: '%',
    source: capField?.source ?? { kind: 'check_field', checkId: '', checkTitle: 'Income inputs', fieldKey: 'cap_rate_pct' },
    ...(capField?.evidenceId ? { evidenceId: capField.evidenceId } : {}),
    note: 'The rate NET income is capitalised at. A gross yield here would overstate the value by the whole of the outgoings.',
  });
  const vacancy = b.optional(
    { key: 'vacancy', label: 'Vacancy allowance', value: fromCheck(checks, 'indicative_valuation.income_inputs', 'vacancy_pct')?.value ?? null, unit: '%', source: { kind: 'check_field', checkId: '', checkTitle: 'Income inputs', fieldKey: 'vacancy_pct' } },
    0,
  );
  const opex = b.optional(
    { key: 'opex', label: 'Operating expenses', value: fromCheck(checks, 'indicative_valuation.income_inputs', 'opex_pct')?.value ?? null, unit: '%', source: { kind: 'check_field', checkId: '', checkTitle: 'Income inputs', fieldKey: 'opex_pct' } },
    0,
  );

  if (lettable === null || rent === null || cap === null || cap <= 0) return b.done(null, 0, '');

  const gross = b.step('Gross annual income', `${lettable.toLocaleString('en-IN')} sqm × ${rent.toLocaleString('en-IN')}/sqm/month × 12`, lettable * rent * 12, 'INR/yr');
  const afterVacancy = b.step('Less vacancy', `${Math.round(gross).toLocaleString('en-IN')} × (1 − ${vacancy}%)`, gross * (1 - vacancy / 100), 'INR/yr');
  const noi = b.step('Net operating income', `${Math.round(afterVacancy).toLocaleString('en-IN')} × (1 − ${opex}%)`, afterVacancy * (1 - opex / 100), 'INR/yr');
  const amount = b.step('Capitalised', `${Math.round(noi).toLocaleString('en-IN')} ÷ ${cap}%`, noi / (cap / 100), 'INR');

  return b.done(amount, 0.25, 'An income indication, weighted as a cross-check unless the asset is held for income.');
}

function residualApproach(project: DdProject, checks: Map<string, CheckInstance>): ValuationApproachRun {
  const b = new ApproachBuilder(
    'residual_land',
    'GDV − construction − fees − finance − marketing − profit',
  );
  const gdvField = fromCheck(checks, 'indicative_valuation.residual_inputs', 'gdv');
  const gdv = b.need({
    key: 'gdv',
    label: 'Gross development value',
    value: gdvField?.value ?? null,
    unit: 'INR',
    source: gdvField?.source ?? { kind: 'check_field', checkId: '', checkTitle: 'Residual inputs', fieldKey: 'gdv' },
    ...(gdvField?.evidenceId ? { evidenceId: gdvField.evidenceId } : {}),
  });
  const costField = fromCheck(checks, 'indicative_valuation.residual_inputs', 'construction_cost');
  const construction = b.need({
    key: 'construction',
    label: 'Construction cost',
    value: costField?.value ?? null,
    unit: 'INR',
    source: costField?.source ?? { kind: 'check_field', checkId: '', checkTitle: 'Residual inputs', fieldKey: 'construction_cost' },
    ...(costField?.evidenceId ? { evidenceId: costField.evidenceId } : {}),
  });
  // Profit is REQUIRED. A residual without it is the price a developer would
  // pay if they worked for nothing, which is not a number anybody should see.
  const profitPct = b.need({
    key: 'profit',
    label: 'Developer’s required profit',
    value: fromCheck(checks, 'indicative_valuation.residual_inputs', 'developer_profit_pct')?.value ?? null,
    unit: '% of GDV',
    source: { kind: 'check_field', checkId: '', checkTitle: 'Residual inputs', fieldKey: 'developer_profit_pct' },
  });
  const feesPct = b.optional({ key: 'fees', label: 'Professional fees', value: fromCheck(checks, 'indicative_valuation.residual_inputs', 'professional_fees_pct')?.value ?? null, unit: '% of cost', source: { kind: 'check_field', checkId: '', checkTitle: 'Residual inputs', fieldKey: 'professional_fees_pct' } }, 0);
  const financePct = b.optional({ key: 'finance', label: 'Finance', value: fromCheck(checks, 'indicative_valuation.residual_inputs', 'finance_pct')?.value ?? null, unit: '% of cost', source: { kind: 'check_field', checkId: '', checkTitle: 'Residual inputs', fieldKey: 'finance_pct' } }, 0);
  const marketingPct = b.optional({ key: 'marketing', label: 'Marketing and disposal', value: fromCheck(checks, 'indicative_valuation.residual_inputs', 'marketing_pct')?.value ?? null, unit: '% of GDV', source: { kind: 'check_field', checkId: '', checkTitle: 'Residual inputs', fieldKey: 'marketing_pct' } }, 0);

  if (gdv === null || construction === null || profitPct === null) return b.done(null, 0, '');

  const fees = b.step('Professional fees', `${Math.round(construction).toLocaleString('en-IN')} × ${feesPct}%`, construction * (feesPct / 100), 'INR');
  const finance = b.step('Finance', `${Math.round(construction).toLocaleString('en-IN')} × ${financePct}%`, construction * (financePct / 100), 'INR');
  const marketing = b.step('Marketing and disposal', `${Math.round(gdv).toLocaleString('en-IN')} × ${marketingPct}%`, gdv * (marketingPct / 100), 'INR');
  const profit = b.step('Developer’s profit', `${Math.round(gdv).toLocaleString('en-IN')} × ${profitPct}%`, gdv * (profitPct / 100), 'INR');
  const residual = b.step(
    'Residual to land',
    `${Math.round(gdv).toLocaleString('en-IN')} − ${Math.round(construction).toLocaleString('en-IN')} − ${Math.round(fees + finance + marketing + profit).toLocaleString('en-IN')}`,
    gdv - construction - fees - finance - marketing - profit,
    'INR',
  );

  return b.done(
    residual,
    0.3,
    'A residual land indication. It is the most assumption-heavy of the four and moves hardest on the profit and cost inputs.',
  );
}
