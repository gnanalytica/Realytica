# Fields

Every function keeps fixed, typed fields. A person fills or links them, a paper or a public source offers values for them, and a model never writes a sentence that is kept. This page is for whoever declares a function's fields.

## The rules a field set lives under

- **A value somebody offered counts for nothing until a person accepts it.** A model's value, a parser's, another paper's: each waits on its field as `proposed`. No formula reads it, no rule fires on it, no status is drawn from it, and neither the graph nor memory hears of it, until a lead or signer of the function's department accepts it.
- **A model picks keys and gives values with a source.** A paper's page and its exact words, or a named public source and the date it was read. It writes no prose, and cannot offer a value for a field that is worked out, mirrored or `longtext`.
- **Complexity is more fields, not more screen.** A field shows when its condition holds. Expert fields stay folded. A field that is not showing is never counted as missing.
- **Nothing is thrown away.** Taking a situation out of play keeps what its fields hold. A record taken off its list is kept. A value under a key no longer declared is kept as it is.
- **A fact has one home.** The second place a fact appears is a mirror (`sameAs`) or a link (`ref`), never a second box to type in.

## Declaring a field set

1. Create one file in `packages/shared/src/operating-model/field-sets/`, named for your group of departments. Export one array: `export const LEGAL_FIELD_SETS: FieldSet[] = [ … ]`. A large group keeps its sets in a folder of the same name (`field-sets/finance/`, `field-sets/design/`, `field-sets/construction-procurement/`) and gathers them in that one file.
2. Register it with one line in `field-sets/index.ts`: import the array and spread it into `FIELD_SETS`.

Nothing else is edited. `pnpm check` runs two tests over the whole catalog (`test/field-catalog.test.ts`): one fails on anything that cannot work, the other on anything past the limits below, and both name your field set.

The worked example is `field-sets/example-land-holding.ts`: Legal › Title's land holding and its owners. Read it beside this page. Title's real catalog is `field-sets/titles-litigation.ts`, which adds to the example's Owners record (`legal.title.owner_facts`). Every department's sets, with counts, are listed in [departments.md](departments.md).

```ts
export interface FieldSet {
  id: string;            // 'legal.title.holding'. Never reused, never the id of a check.
  fn: string;            // the function: a workstream key from departments.ts, as 'legal.title'
  title: string;         // on the card: 'Land holding'
  v: number;             // raise when you add fields; a new field carries `since: v`
  fields: CheckFieldDef[];
  rules: CheckInsightRule[];
  sections?: FieldSection[];
  records?: { of: string; titleField: string; summaryFields: string[] };
  situations?: Situation[];
  optionSets?: OptionSet[];
  extends?: string;      // adds these fields to a shared record in place of making a sheet
  sheets?: DepthSheet[]; // hard cases, each a small sheet opened from the holder that needs it
  reports?: FieldReportTemplate[]; // the reports this set's function hands over: see Reports
}
```

**A function's page.** A function with at least one field set opens on **Needs you** (see below), above every other part of its page, and has a Sheet part holding the sheets themselves. A function still marked `coming_soon` in `departments.ts` becomes a page of its sheets and its documents as soon as a set names it in `fn`; its tab stops being muted. There is nothing to switch on.

## Kinds

| Kind | Holds | Notes |
|---|---|---|
| `text` | One line | `suggest` completes from a register (`'party'`) so a name is written one way |
| `longtext` | A person's words | `maxLength` is required. A model's write is refused. The screen says who wrote it |
| `number` | A figure | `min`, `max`, `precision`. With `dimension`, a measure |
| `money` | An amount | `currency`; rupees read and print in lakh and crore |
| `area` | An area | Give it `dimension: 'area'` and it is kept in sqm with what was typed |
| `percent` | 0 to 100 unless `max` says otherwise | |
| `duration` | A span | `unit` says days, months or years |
| `date` | `YYYY-MM-DD` | `expires: { leadDays }` makes the page say when it is about to run out, and when it has |
| `boolean` | Yes or no, or nobody has looked | |
| `enum` | One of a list | `options` for a list used once, `optionSet` for a shared one |
| `multi_enum` | Several of a list | Also what a checklist of ticks is |
| `computed` | Worked out by `formula` | Never written. `yields: 'date'` keeps the answer as a date |
| `status` | Worked out by rules | Never written. The first of `cases` whose rule fires gives the label and tone; `otherwise` when none does. A standing a person sets is an `enum` |
| `table` | Rows with `columns` | Six columns at most, and no status, expiry or paper per row: that is a set of records |
| `evidence` | Papers on the register | `accepts`, and `viewer` for how the file opens |
| `ref` | A link to something entered once | `target` says what |

## Controls and displays

They change how a field is drawn, never what it holds. Use the plain one unless the case below is yours.

| | On | Use when |
|---|---|---|
| `control: 'segmented'` | `enum` | Five options or fewer, short words |
| `control: 'tiles'` | `enum` | The choice that turns a sheet: three to six options worth seeing at once, each with a tone |
| `control: 'tick'` | `boolean` | A thing that was done or was not, checked on site |
| `control: 'switch'` | `boolean` | A yes or no where "not looked" must stay visible |
| `control: 'scale'` | `number` with `min` and `max` | A judgement on a short scale. At most eleven steps |
| `display: 'timeline'` | `table` with a date column | Events in order: a chain of title, hearings. A `ref` column reads as the name of what it links to |
| `display: 'chart'` | `table` with `chart: { x, y, mark?, stack? }` | A handful of figures worth comparing by eye |
| `display: 'match'` | `table` with `match` | Lists that should pair up: demands to milestones, survey numbers to owners |

**Chart.** `mark` says what is drawn. `'bar'` (the default) is a bar for each row. `'line'` is a line over the `x` column in its own order: a date column is put in date order, so a table typed out of order still runs forward. `'stacked'` is one bar for each `x`, built of its rows' `y` by the `stack` column; past six parts the smallest are drawn as one, "Other". A row with no figure is left out, never drawn as zero.

```ts
{ key: 'outflow', label: 'Outflow by quarter', kind: 'table', display: 'chart',
  columns: [{ key: 'quarter_end', label: 'Quarter ending', kind: 'date' }, { key: 'head', label: 'Head', kind: 'enum', optionSet: 'cost_head' }, { key: 'amount', label: 'Amount', kind: 'money', currency: 'INR' }],
  chart: { x: 'quarter_end', y: 'amount', mark: 'stacked', stack: 'head' } }
```

**Match.** The table's rows are the pairs. `match` names a column and a list for each side; whatever of either list no row pairs is left over, and every leftover is a line under Needs you (Missing).

```ts
{ key: 'demand_to_stage', label: 'Demands to stages', kind: 'table', display: 'match',
  columns: [{ key: 'demand', label: 'Demand', kind: 'ref', target: { set: 'commercial.buyers.demands' } }, { key: 'stage', label: 'Stage', kind: 'ref', target: 'milestone' }],
  match: { left:  { column: 'demand', label: 'Demands', of: { records: 'commercial.buyers.demands', field: 'ref' } },
           right: { column: 'stage',  label: 'Stages',  of: { target: 'milestone' } } } }
```

A side's list is `{ records, field }` (a field of every record of a set), `{ table, column }` (a column of another table, by its address) or `{ target }` (a register). A side may carry `optional: true`: nothing of that side is then left over (a parcel in no suit is in order). With both sides optional the table is a pairing and nothing more, as design changes to variations are.

To pair more than two lists, add the further ones under `also`: each is paired to the left one, so a row names the left item and what it pairs to in every other list. `agree` names the columns that should read the same on a row; a row where they differ is a line under Needs you (Failing).

```ts
match: { left:  { column: 'survey_no',  label: 'Survey numbers', of: { target: 'parcel' } },
         right: { column: 'rtc_owner',  label: 'RTC owners',     of: { table: { fn, set, field: 'rtc_owners' }, column: 'name' } },
         also: [{ column: 'purchaser',    label: 'Purchasers',    of: { records: 'legal.title.owners', field: 'name' } },
                { column: 'khata_holder', label: 'Khata holders', of: { table: { fn, set, field: 'khata_holders' }, column: 'name' } }],
         agree: ['rtc_owner', 'purchaser', 'khata_holder'] }
```

**Viewers.** `viewer` on an `evidence` field is `pdf`, `image`, `drawing` or `deed`, each opening the paper in the app's own viewer, or `ifc`, which says the model is filed and not drawn yet.

## Attributes

| Attribute | Means |
|---|---|
| `section` | The section it sits in, by key |
| `tier`, `showWhen` | When it shows: see Tiers |
| `required: false`, `requiredWhen` | Whether it is a must-field. Default: it is |
| `dimension`, `enterIn` | A measure, and the units a person may type |
| `currency`, `precision` | How an amount or a figure prints |
| `optionSet` | A shared list, by id |
| `target` | What a `ref` links to |
| `sameAs` | A mirror of the field at this address. Read here, entered there |
| `cases`, `otherwise` | A `status` field's standing |
| `from` | In words, the paper it comes from. Shown beside the label |
| `fromTypes`, `factKey` | The kinds of paper that offer its value: see Papers |
| `proof` | `'required'`: cannot be typed without a paper cited. `'expected'`: can, and is listed as unproven |
| `defaults` | Usual values that stand in as assumed |
| `expires` | A date that runs out |
| `dueFrom` | From when it is expected: a step of the project or a day. See Due and owed |
| `owedBy` | Who owes it, where that is not the function's own people. See Due and owed |
| `maxLength` | The cap on a `longtext` |
| `retired`, `since` | No longer asked; the version that introduced it |

## Units

Give a measure a `dimension`: `area`, `length`, `volume`, `mass`, `money`, `time`, `count`, `ratio`. The value is kept once in the base unit (sqm, m, cu m, kg, the field's currency, days) with what was typed beside it, so "1 acre 22 guntas" is worked on as 6,272.63 sqm and prints as "1 acre 22 guntas (6,272.63 sqm)".

- **Area:** `sqm`, `sqft`, `sqyd`, `acre`, `gunta`, `cent`, `hectare`, and `ground`. A ground has a size only where the state's pack gives it one (`field-sets/state-packs.ts`); elsewhere the person is asked for another unit.
- **Length:** `m`, `ft`, `in`, `mm`, `cm`, `km`, `yd`. **Volume:** `cum`, `cft`, `litre`. **Mass:** `kg`, `tonne`, `quintal`, `g`.
- **Money:** typed as `4,20,00,000`, `4.2 Cr` or `45 lakh`; printed in lakh and crore by one formatter (`rupeesSaid`, `formatMoney`). Another currency is kept in its own, never converted.
- `enterIn` narrows what may be typed. A bare number is in the base unit.

Do not write a conversion factor anywhere. `units.ts` is the one table.

## Option sets

A list used by more than one field is an `OptionSet`, declared on the set that owns it and named by id anywhere.

```ts
optionSets: [{ id: 'land_tenure', label: 'Tenure', options: [
  { key: 'freehold', label: 'Freehold', tone: 'good' },
  { key: 'inam', label: 'Inam', tone: 'warning' },
  { key: 'crown', label: 'Crown grant', retired: true },   // no longer offered; a value saved under it still reads
]}]
```

The key is stored and the label shown. Tones are `good`, `warning`, `critical`, `neutral`, `info`. Never an option called "not applicable" or "unknown": the first is a state any field can be put in, and the second is the field left empty.

## Addresses, mirrors and links

```ts
type FieldAddress = { fn: string; set: string; field: string; column?: string; record?: string };
```

`set` is a field set's id or a check definition's id: every check's fields are in the same catalog, unchanged, under the check's id and the function the check sits in.

- **`sameAs`** makes a field a read-only mirror of the one at an address, with that field's source. Use it for the second appearance of any fact.
- **`ref`** holds the id of something entered once. `target` is `'party'`, `'parcel'`, `'building'`, `'unit'`, `'drawing'`, `'approval'`, `'matter'`, `'contract'`, `'account'`, `'package'`, `'document'`, `'milestone'`, or `{ set }` for the records of any set that repeats. A `ref` whose target is its own set overflows the stack (`refChoices` and `readSheet` call each other): until that is fixed, hold such a link as a name with `suggest`.
- A **status** cannot be mirrored as kind `status`, which needs cases of its own: mirror it as `text`. A status case cannot read another set through `at`: mirror the field first, then name the mirror.

## Shared records

`field-sets/shared-records.ts` declares the records every department links to, each a set that repeats under the function `shared`: `shared.parties`, `shared.parcels`, `shared.buildings`, `shared.units`, `shared.drawings`, `shared.approvals`, `shared.matters`, `shared.contracts`, `shared.accounts`. What the project already keeps is linked to as it is and never entered twice: a `party` link also offers the project's people, a `parcel` link its survey numbers, an `approval` link the approvals register's kinds, and `package`, `document` and `milestone` read the cost register, the evidence register and the schedule.

To hold your department's own facts about a party, a unit or a parcel, extend the record in place of making a second one:

```ts
{ id: 'commercial.buyers.customer', fn: 'commercial.buyers', title: 'Customer', v: 1,
  extends: 'shared.parties',
  fields: [{ key: 'resident', label: 'Resident in India', kind: 'boolean', required: false }], rules: [] }
```

A function's page lists the shared records its fields link to, and the ones it adds to, below its own sheets.

- **One record, each department's own view of it.** A unit carries Sales', Tax's, the Architect's and the site's facts. A function's page draws the record with its own fields and the ones that function added, and says in one line who else keeps something on it (`sheetSeenFrom`). Formulas and rules read the whole record.
- **A key is added once.** Two sets that add the same key to one record fail the catalog test, as does a key one of the record's depth sheets already holds. Where two departments need the same fact of a party or a unit, one adds it and the other reads it.
- **What a rule in an adding set may read:** any field of the record as it stands merged, its own or another department's.
- **A shared record asks nothing of a function.** Its missing fields, rule lines and expiring dates are not raised under the Needs you of a function that links to it. A function that needs them surfaced counts them on a sheet of its own, as the approvals register counts approvals past validity. A function-scoped situation cannot gate a field added to a shared record: use a project-scoped one or a field condition.
- **Who is handed what.** A department's additions to a shared record go to an outside collaborator only where that department's function is in their reach, and the sets in `CUSTOMER_SETS` with the party records they name go to none. A report is cut by the same rule.

## Records: anything there can be more than one of

A set with `records` repeats. Each record is a small sheet of its own; the page shows a row for each, titled by `titleField`, with `summaryFields` as chips.

```ts
{ id: 'legal.title.owners', fn: 'legal.title', title: 'Owners', v: 1,
  records: { of: 'owner', titleField: 'name', summaryFields: ['share_pct', 'capacity'] },
  fields: [ … at most twenty … ], rules: [] }
```

Make it a set of records, not a `table`, when a row has a status, an expiry or a paper of its own, is linked to from elsewhere, or needs more than six columns. A count or a sum over no records is 0, not empty: see the note on standings under Rules. A parent counts or sums its records with `{ op: 'records', set, reduce: 'count' | 'sum' | 'min' | 'max' | 'spread_pct', field }`. Inside a record's own fields, a `showWhen` or a formula that names a field of the same set reads that record's.

**The same figure stated by several people** (cost to complete by the quantity surveyor, the engineer, the accountant and the lender's engineer) is a set of records, one for each person who states it, so nobody's figure overwrites another's. `statedBySeveral({ id, fn, title, key, figure, tolerancePct })` in `field-sets/builders.ts` returns the set and the parent's four fields: lowest, highest, spread and a status that turns when the spread passes the tolerance.

## Situations, tiers and conditions

A **situation** is something true of a project, or of one function, that brings fields into play. Name it for what is true: `agricultural_land`, `joint_development`, `minor_owner`. Lower case, underscores, no function prefix. `scope: 'project'` is shared by every function that names it, under the key itself; `scope: 'function'` is kept as `<fn>:<key>`.

```ts
situations: [
  { key: 'agricultural_land', label: 'Agricultural land', scope: 'project',
    hint: 'The land is, or was, recorded as agricultural.',
    proposeFrom: { documentTypes: ['RTC (record of rights)', 'DC conversion order'] } },
  { key: 'several_owners', label: 'More than one owner', scope: 'function',
    derive: { records: 'legal.title.owners', is: 'at_least', n: 2 } },
]
```

In order of preference: **derive** it from what is recorded, and nobody is asked; let a **paper propose** it (`proposeFrom.documentTypes`, or `proposeFrom.field` for a value recorded elsewhere), and a person says yes or no; or leave it for a person to set. A proposed situation brings nothing into play until accepted.

`impliedBy` is for a situation a person sets that is also plainly true once something is recorded: it is in play, with nobody asked, whenever the condition holds, and nobody takes it out while it does. A field that holds a value is then never hidden by a situation nobody thought to switch on.

```ts
type ShowWhen =
  | { situation: string }
  | { field: FieldAddress; is: 'set' | 'true' | 'false' | 'equals' | 'in' | 'gt' | 'lt'; value?: unknown }
  | { records: string; is: 'any' | 'none' | 'at_least'; n?: number; where?: RowCondition }
  | { all: ShowWhen[] } | { any: ShowWhen[] };
```

`showWhen` goes on a field, or on a section to cover every field in it. Conditions read only values that stand.

| Tier | Shows | Counted |
|---|---|---|
| `core` (default) | Always | Yes |
| `situational` | When its `showWhen` holds, its own or its section's | While it holds |
| `expert` | Folded under "More"; shown once it holds a value | Never |

A field hidden by its condition that still holds a value is kept, under "Recorded, not asked for now". A field that is worked out, a standing or a mirror is nobody's entry: out of play, it is not listed there. An expert field that is worked out stays folded however much it holds: it is the working behind a standing.

**One declaration.** A project-scoped situation is declared once, by the department that owns it, and named by every other set that waits on it; a second declaration that differs by a character fails the catalog test. The ones several departments answer to: `joint_development` and `leasehold_land` (Law, proposed from the agreement or the lease), `lender_funded` (Lenders, derived from a facility recorded), `designated_account_kept` (Finance), `rera_registered`, `revised_sanction`, `stop_work_order` and `agricultural_needs_conversion` (Law and Liaison, derived), `tdr_or_premium_far`, `high_rise` and `mixed_use` (the Architect), `litigation_pending` (Litigation). `agricultural_land` (Title) says the land is or was agricultural; `agricultural_needs_conversion` says it is not yet converted. The four valuation approaches are declared with the valuation checks (`check-conditions.ts`). A function's page shows a derived situation as a chip only while it holds.

**Not applicable.** A person marks a field or a section not applicable with one of five reasons: not in this project, not at this stage, done by another party, exempt, no such paper. The reason is a key, never a sentence.

**Usual values.** `defaults: [{ when?, value, from, cite }]` fills a field as `assumed`: it is said to be assumed, feeds what is worked out, needs nobody, and gives way the moment a value is typed or accepted. `cite` is required unless `from` is `'firm'`.

## Due and owed

Two attributes say when a field is the reader's to fill, and both keep the count honest.

```ts
{ key: 'title_opinion', label: 'Title opinion', kind: 'evidence', owedBy: 'advocate', dueFrom: 'acquisition' },
{ key: 'possession_letter', label: 'Possession letter', kind: 'evidence', owedBy: { ref: 'seller' }, dueFrom: 'acquisition' },
```

- **`dueFrom`** is a step of the project (`opportunity_site`, `feasibility`, `acquisition`, `design`, `approvals`, `procurement`, `pre_construction`, `construction`, `testing_commissioning`, `completion`, `handover`, `operations`) or a day (`YYYY-MM-DD`). Before then the field shows and takes a value, and is neither counted nor listed as empty. An occupancy certificate's date is not missing during design.
- **`owedBy`** is a role (`owner`, `advocate`, `authority`, `consultant`, `contractor`, `lender`, `buyer`) or `{ ref }`, the key of a `ref` field of the same set that links to a party: whoever that link names owes it. A field somebody else owes is never under Missing and never counted against the reader. It is listed under that party on the function's page ("Waiting on others") and as a line of the department's **Papers owed** list, on its Documents part. There is no page of its own.

Only a must-field that a person fills can be owed.

## Depth sheets

When one row needs a dozen more fields, they do not join the row. They are a **depth sheet**: a small sheet declared on the set, opened from the holder that needs it and from nowhere else.

```ts
{ id: 'legal.title.owners', fn: 'legal.title', title: 'Owners', v: 1,
  records: { of: 'owner', titleField: 'name', summaryFields: ['share_pct', 'capacity'] },
  fields: [ … ], rules: [],
  sheets: [{
    id: 'guardianship', title: 'Guardianship',
    showWhen: { field: { fn: 'legal.title', set: 'legal.title.owners', field: 'capacity' }, is: 'equals', value: 'minor through a guardian' },
    sections: [{ key: 'minor', label: 'The minor' }, { key: 'permission', label: 'The court’s permission' }],
    fields: [ … at most twenty … ],
    rules:  [ … read its own fields and the row's … ],
  }] }
```

- It shows on the row as one line that says how full it is ("Guardianship · 2 of 2 recorded · 1 failing") only while its `showWhen` holds, read from that row. On a set that does not repeat, it opens from the sheet itself.
- Its fields are kept on the holder it opens from, under their own keys. So a key in a depth sheet is never one of the set's own, and an address, a formula, a rule and a proposal name a depth field exactly as they name any field of the set.
- Its trouble rolls up: a rule failing on it is a line under the function's Needs you that names the row, so nobody opens sheets to find what is wrong.
- At most twenty fields in at most four sections, and no list inside that pairs or opens another. Function, row, sheet is the whole depth.

## Needs you

A function does not open on its form. It opens on five lines, in this order, each drawn only when it holds something, with its count and at most five of its lines until "Show all".

| Line | Holds | Why it is in this place |
|---|---|---|
| **Decide** | Two values in dispute; a situation a paper proposes | A situation changes what every later line holds, and a dispute blocks a report |
| **Accept** | Values offered and waiting, with "Accept all" for each paper that offered more than one | The cheapest act with the largest effect |
| **Failing** | A rule firing at high or critical; a day that has run out; a pairing whose names differ | Needs judgement, best made once the values under it are settled |
| **Due soon** | A day within its `expires.leadDays`; a rule at medium; a standing whose tone is a warning | Can wait a day |
| **Missing** | A must-field the function's own people owe that holds nothing; a thing with no counterpart in a match | Last, because most of it is cured by filing a paper |

Not on the card: expert fields; fields before their `dueFrom`; what another party owes (one quiet line, "Waiting on others"); usual values standing in (one quiet line); a rule at low, which is said on the sheet it is about.

A lead or signer may **put a line under Due soon off** until a day they name, at most ninety days ahead. It comes back on that day, or at once if it starts failing. Nothing else can be put off. `readFunctionFields(project, fn)` returns the five lines as `needs`, what is put off as `snoozed`, and what others owe as `waitingOn`.

On a phone the card is the first screen of the function. On a laptop it is the first card on the function's page.

**Below it, a sheet is one line.** A function that keeps more than one sheet draws each as a line (its title, how full it is, what is still to fill, and where its standings are) that unfolds when pressed. A sheet none of whose fields is in play yet is not drawn as an empty card: the page names such sheets in one sentence. So keep a sheet's standing honest on an untouched project (see Rules): it is what a person reads without opening anything.

## Rules

A rule is arithmetic with a sentence template. It reads values that stand and says nothing about a field nobody has filled.

| `kind` | Fires when | Template words |
|---|---|---|
| `compare` | Two figures differ by more than `tolerance` (default 1%) | `{a}` `{b}` `{divergence}` `{tolerance}` |
| `at_least` | The first is below the second | `{a}` `{b}` |
| `at_most` | The first is above the second | `{a}` `{b}` |
| `before` | The first date is after the second | `{a}` `{b}` |
| `require` | The field is empty and something else on the sheet is not | |
| `require_if` | The gate holds one of `whenIn` and the second field is empty | `{a}` |
| `row_missing`, `row_expired` | A table row's `column` is empty or its date has passed, for rows whose `gate` is in `whenIn` | `{row}` `{a}` `{days}` |

- `against: 100` puts a figure in place of the second field.
- `when: ShowWhen` makes the rule exist only under a condition.
- `at: { key: FieldAddress }` makes a key named in `fields` another set's field, so a rule can read another function.
- `at_least` and `at_most` are strict. "At or above a threshold" is written the other way round: short of the threshold is not above 0.
- `{a}` prints a stored choice by its key, not its label: word the template without it for an option-set field.
- Where a field is asked for by a rule that says why, mark it `required: false`, so it is not also counted as still empty. Do not repeat on a sheet above its records what a record's own standing already says.

**A standing over nothing.** A status is empty until a field its cases read holds a value, and a count or a sum over no records holds 0. So a standing with an `otherwise` reads as that label on an untouched sheet, and "In order" over nothing recorded tells a reader the work is done. Open such a status with a case for nothing recorded, in a neutral tone ("No approval recorded"), or read a figure that is blank until its inputs exist (`finance/kit.ts` has `totalOf`, `tallyWhere`, `once` and `limitFor` for this). `test/field-catalog.test.ts` fails on any standing in a good tone on a project nobody has touched.

## Formulas

A formula is a tree. Every leaf is a field, a figure or a rule row; nothing in it runs a string. An input that is not known gives no answer, never zero.

| `op` | Gives |
|---|---|
| `field` `{ key, at?, via? }` | A field of this set, or with `at` of any set. With `via` as well, `at` names a field of a set that repeats and `via` one of this set's own links: the field is read from the record that link holds (the agreed value of this ledger's unit) |
| `figure` `{ key, of? }` | A figure a module of its own works out, read and never entered: see Figures from other modules |
| `const` | A figure. Never one a law sets: see the rule table |
| `add` `subtract` `multiply` `divide` `power` `variance_pct` | Arithmetic on `left` and `right` |
| `min` `max` `{ of: [] }` | The least or the most, leaving out what is not known |
| `if` `{ when, then, else }` | By a condition: two amounts compared, or what a field holds |
| `sum` `count` | Over a table of this set |
| `sum_if` `count_if` `{ over, column, where }` | Over the rows of a table or the records of a set that meet a condition. `where: { column, is: 'own', value? }` joins rows to the record being worked out: the row's column holds that record's id, or what its own field named in `value` holds (the demands of this unit, the claims of this contract). The same join works in a `showWhen` over records |
| `records` `{ set, reduce, field }` | Count, sum, least, most or spread over a set that repeats |
| `rate` `{ table, on?, where? }` | A figure from the rule table |
| `irr` `npv` `{ over, date, amount }` | A yearly rate of return, or a present value, of dated cash flows |
| `date` `{ key, at?, via? }` `today` `add_days` `add_months` `days_between` | Dates as day numbers; `yields: 'date'` on the field turns the answer back |

Fields are worked out in the order of what they read, across sets and functions. A ring fails the catalog test, with the ring named.

What formulas cannot do, so that nobody hunts for it: group rows, window by date, take the latest of dated records, run an ordered window over records, or hold two row conditions at once. A money field refuses a negative value unless it declares a negative `min` (an overdrawn balance, a net outflow).

## Figures from other modules

The schedule, the site log, the tender tracker, the cost register, the monthly cost report, the comparable schedule and the valuation keep their figures in modules of their own. A field set does not hold those a second time. A computed field reads one with `{ op: 'figure', key }`:

```ts
{ key: 'actual_percent', label: 'Progress, by the weight of the milestones', kind: 'computed', unit: '%', formula: { op: 'figure', key: 'progress.percent' } }
{ key: 'awarded_on', label: 'Awarded on', kind: 'computed', yields: 'date', formula: { op: 'figure', key: 'package.award_day', of: 'package' } }   // of one work package: `of` names this set's own link to it
```

`field-figures.ts` is the one door: `PROJECT_FIGURES` lists every figure by key (`progress.*`, `schedule.*`, `site_log.*`, `observations.*`, `tenders.*`, `cost.*`, `cost_report.*`, `comparables.*`, `value.*`, `cash_flow.*`, `project.*`, and `package.*` for one work package). A figure is read-only, is worked out afresh each time the sheet is read, and is null where its module cannot tell it yet, never zero. A day comes as a day number, for a field with `yields: 'date'`. A key that is not there, or a per-package figure with no link named, fails the catalog test. To expose a new figure, add a row to `PROJECT_FIGURES`.

## Links to other departments

A fact has one home. Where a set needs a fact another department owns, it reads it, and those readings are declared together at the foot of the reader's file as one list, laid in with `withLinks` (`field-sets/builders.ts`):

```ts
const LINKS: SetLinks[] = [
  { set: 'finance.funding.plan',
    fields: [mirror('peak_funding', 'Peak funding need, per the appraisal', 'money', at('finance.feasibility', 'finance.feasibility.returns', 'peak_funding'), { tier: 'situational', showWhen: … })],
    rules: [{ kind: 'at_least', fields: ['planned_total', 'peak_funding'], say: 'Sources of {a} are planned and the appraisal’s cash flow needs {b} at its deepest.', severity: 'high' }] },
];
export const FINANCE_TAX_LENDERS_FIELD_SETS: FieldSet[] = withLinks([...FUNDING_SETS, …], LINKS);
```

An entry names a set of the file and gives any of: `fields` (a mirror, a `ref`, or a figure worked out from the owner's records), `replace` (a field the set already declares, given again as a reading of its owner, never as a typed kind), `repoint` (a mirror pointed at the field its owner now keeps), `rules` (holding a figure of this set to another department's with `at`), `sections` and `reports`. A link that names a set or a field that is not there stops the build.

Choose the lightest form that is true:

- **A rule**, where this set holds a dated statement of its own (receivables as at a day, a certificate's figure) that should agree with the owner's live figure. It costs no screen and speaks only when the two differ.
- **A mirror shown when its owner holds something** (`tier: 'situational'`, `showWhen: { field: owner, is: 'set' }`, or `{ records: ownerSet, is: 'any' }` for a count), where a reader of this sheet wants the owner's figure beside their own.
- **A working field** (`tier: 'expert'`, worked out) where a rule needs a figure of the linked record: `{ op: 'field', at, via }` or a `sum_if` joined with `own`.
- **A `ref`** where two records are one fact seen by two departments (a lender's security and the charge Title finds).

Who owns what, so two files do not both declare it: variations and extension-of-time claims are Procurement's; the unit, the unit mix and the area statement the Architect's; milestones and progress Construction's; RERA filings Law's, which types none of the figures; the designated account, GST and TDS Finance's and Tax's; comparables Valuation's; snags the site's (Technical); a lift's permission and licence Liaison's; the party record is shared.

## The rule table and the state pack

A figure a legislature, a regulator or a standards body can change is never in a key, a label or a formula. It is a dated row in the rule table:

```ts
{ key: 'far_limit', label: 'Floor area ratio allowed',
  jurisdiction: { state: 'Karnataka', city: 'Bengaluru', authority: 'BDA' },
  when: { zone: 'residential_main', road_width_m: { min: 12, max: 18 } },   // a band takes its lower end and stops short of its upper
  value: 2.25, unit: 'ratio', from: '2015-01-01', to: '2024-12-31',
  source: { regulation: '…', clause: '…', page: 41, url: '…' },
  verified: false }
```

Add your group's rows in `field-sets/rules/<group>.ts`, or in your group's own folder (`field-sets/finance/rule-rows.ts`), and register them in `RULE_ROWS` in `field-sets/index.ts`. Not in a `.ts` file directly in `field-sets/`: the catalog test takes every file there for a field-set file. Read one with `{ op: 'rate', table: 'far_limit', where: { road_width_m: { field: 'road_width' } }, on: 'sanction_date' }`: the row for the project's state and city, in force on that day (today when `on` is left out), whose conditions the fields meet. The value worked out carries the row it came from, and so does a status that reads it; a row with `verified: false` shows as not verified beside every value that used it. Mark a row verified only with the name of the person who checked it against the instrument. **No built-in row is verified today**: every figure worked out from one says so on the sheet, in a report and in the chat's card.

- **One key for one fact.** The height that makes a high-rise is `high_rise_height_m`, whichever department reads it. Before adding a row, look for the fact under another department's key.
- **A rule with no figure yet** is a `RuleShape` in `RULE_SHAPES` (`field-sets/design/rule-rows.ts`): a formula may name it, it gives no answer, and the standing over it has to say the limit is not on file.
- **A firm's own rows.** The law watch offers a row where a confirmed change moves a rate; a firm admin verifies it by name (`POST /api/law-watch/rule-rows/:offerId/verify`). A verified row is the firm's: it supersedes the built-in row from the day it takes effect, and every formula on that firm's projects reads it, on the server and on the page (`ruleRowsFor(project)`, installed as the firm's fields are). An offered row nobody has verified changes no figure.

What differs by state and is not a rate (form numbers, the size of a ground) is in `field-sets/state-packs.ts`, keyed by state, Karnataka first.

## A check's fields

Every check's fields are in the catalog under the check definition's id, and are read, offered and decided through the same functions as a sheet's.

- **When they are asked.** `check-conditions.ts` gives a check the condition all its fields wait on, and declares the situations those conditions name for the function the check sits in. The four valuation input checks open by approach this way: `comparable_approach`, `cost_approach`, `income_approach`, `residual_approach`, each in play once a person says so or once one of its inputs is recorded (`impliedBy`). The check's screen does not draw a field that is not asked, folds an expert one, and keeps one that holds a value while not asked under "Recorded, not asked for now" (`checkFieldsShown`). Add a condition to a check there; never in the check's schema.
- **How a value waits.** Once. A value offered for a check's field, by a paper's reading or by a model naming the field, is kept on a card of that check's values and read on the field as `proposed`, with its page and words (`check-waiting.ts`). Accepting or setting aside the field settles the card; settling the card settles the field. A value the field already holds, one already waiting for it, and one a person set aside there are not offered again by either door.

## Papers: how a value is offered

A field that a kind of paper states names that kind:

```ts
{ key: 'extent', label: 'Extent held', kind: 'area', dimension: 'area',
  from: 'Sale deed',                       // shown beside the label
  fromTypes: ['Sale deed', 'Mother deed'], // the register's document types that offer it
  factKey: 'extent_title' }                // the key the paper's reading files the value under, where it is not the field's own
```

`fromTypes` are the register's document types as it writes them (the labels in `document-parse.ts`: "Sale deed", "Encumbrance certificate", "DC conversion order", "Bank guarantee", "Demand letter", …). A paper reaches a field only through `fromTypes`, and a kind named there has to be one the classifier can produce: `test/papers-to-fields.test.ts` fails on a kind it cannot, and lists the kinds no field reads yet.

- **One fact of one paper has one field.** A value read from a paper is offered once, on the function that owns the fact. The second place it appears is a mirror (`sameAs`) where a sheet is held once (Tax's "Project commenced on" reads Liaison's commencement date), and nothing where both are records. The same test fails on two fields that read one fact off one kind of paper. A Sale deed's own particulars are the purchase's (`legal.contracts.purchases`): Title's chain, Tax's duty-by-instrument and the holding's extent are not offered them.
- **The reader answers in these keys.** The rules read the land papers under their standard keys. Every other paper, and whatever the rules could not read, goes to the model reader, which is told for the paper's kind the key of each field that waits (`factKey`, else the field's own), with its label, what it holds and what it may be (`paper-fields.ts`). It answers in those keys with the page and the paper's exact words. A value whose words are not found on that page is dropped, and so is a value under a key of the reader's own: it may not invent one. Where a field's label alone would be read wrongly on the paper ("Amount", on a bid), give it a `factKey` that says what it is (`earnest_money_amount`).
- **It waits once, on the field.** What stands on the paper and what a model read are both offered as the paper is read (`offerPaperToSheets` with `waiting`), each with its page and words, and each counts for nothing until a lead or signer of the field's function accepts it there. A value two readers differ on is a choice made on the paper first, and one a person set aside there is offered nowhere.
- **A set of records takes the paper on one record.** The record this paper was read into before; else the one known by what the paper calls it (the set's title field where the paper states it, else the first name or link it states: a survey number, a document, certificate or contract number); else a new one. So an RTC for Sy. No. 41/3 is offered to that parcel's land record and never as the whole holding, and a second copy of a certificate to the record the first made. A `ref` field takes the one thing on the project the paper's words name, and nothing where they name none or several.
- **A new record is one line.** A record a paper offered, and nobody has accepted a value of, is one line under Accept ("New purchase", with each value said). Accepting it (`decideField` at the address whose field is `RECORD_AS_OFFERED`) takes every value that needs no naming; one a person has to name stays for them. It is nothing until then.

The model's tools are `get_fields({ fn })` and `propose_field_values({ values: [{ address, value, origin }] })`. A proposal is refused without a source, for a choice not on the list, for a link to something not on the project, and for any field that is computed, a status, a mirror or prose. On a check, a field whose `proof` is `'required'` takes a value only from a paper on the project.

The copilot is told the rule in one paragraph (`FIELD_RULE` in `packages/agents/src/agents/project-copilot.ts`): it reads values off papers with the page and the paper's words, looks up named public sources with the date read, maps each value to a field key from the list `get_fields` gave it, and writes no prose into any field. `get_fields` also says of each field whether it is on a depth sheet, not yet due, or owed by another party, so the model does not ask a person for those.

**What a model may hand back.** Every model call answers with keys, picks, values with a source, or a paper's own words quoted. It writes no sentence that is kept or shown: the daily review's lines, the law watch's changes, the chat's answer and a report are all printed by code from the record. `test/no-model-prose.test.ts` fails on anything else, and a new tool or free-text member has to be classified there.

## What a value carries

```ts
state?: 'empty' | 'proposed' | 'accepted' | 'typed' | 'disputed' | 'not_applicable' | 'assumed'
origin?: { kind: 'paper', evidenceId, page, quote, reader } | { kind: 'external', source, asOf, url? }
       | { kind: 'field', address } | { kind: 'person' } | { kind: 'default', from, cite? }
entered?, proposedBy?, acceptedBy?, acceptedAt?, other?, declined?, naReason?, naNote?
```

Accepted, typed and assumed values stand. Typing over a value accepted from a paper does not replace it: the two are disputed until a lead or signer keeps one. On screen an accepted or typed value carries no mark; pressing its label shows where it came from. Only what needs somebody is marked.

**In a report and in the chat.** An accepted, entered or worked-out value prints with a footnote: the paper and page, the public source and the day read, or the person and the day. An assumed one prints "assumed". A proposed or disputed one prints "waiting" and never its figure. A figure from a rule row prints the row's citation and "not verified". A field that is not in play is left out. The chat's card says the same of each row, and calls a worked-out figure worked out, never accepted.

**Who may do what.** Whoever edits in the function's department (lead, contributor, signer) types values, adds records and raises a dispute. Only a lead or signer accepts, keeps, sets aside, marks not applicable, sets a situation or takes a record off its list. An outside collaborator is handed a function's sheets only where their grant names a scope the function's checks sit in. They are never handed a set in `CUSTOMER_SETS` (buyers) or a party record one of those names, and are handed a department's additions to a shared record only where that department's function is in their reach.

## Limits the catalog test holds you to

- At most **twelve core fields** on a sheet. Past that: give a field a `showWhen`, fold it as `expert`, or make what repeats a set of records.
- At most **twenty fields** on a record. A set that adds to a shared record is held to twenty of its own; the record as merged is not, because each function's page draws only its own additions.
- At most **twenty fields in four sections** on a depth sheet.
- A table of more than **six columns**, or whose rows carry a status, a date that runs out or a paper, is a set of records.
- A `situational` field has a `showWhen`, its own or its section's.
- No statutory figure in a key or a label.
- No option called "not applicable" or "unknown".
- Every `longtext` has a `maxLength`; every usual value a `cite`.

`catalogLimits()` reports each breach by field set; `catalogFaults()` reports what cannot work at all. The same test holds the whole catalog to three more things on a project nobody has touched: no standing in a good tone, no rule line, and no sheet that opens on more than twelve fields.

Adding sheets to a function moves a few tests that follow the catalog and not you: which sets a paper is offered to (`test/fields.test.ts`), which functions have page parts (`test/record-places.test.ts`), and the function a stray paper is first offered to (`test/document-drop.test.ts`). Function counts are worked out from `WORKSTREAMS`.

## Reports

A report is put together by code from fields. A function's report is a template: an ordered list of sections, declared on a field set (`reports`) or, where it draws on several sets, in the file's links list.

```ts
{ id: 'legal.title.report', title: 'Title report', sections: [
  { heading: 'Opinion', fields: ['title_standing', 'verdict', 'opinion_date'] },                      // a key alone is a field of the set the template sits on
  { heading: 'Land records', fields: [{ fn: 'legal.title', set: 'legal.title.records', field: 'extent_net' }] },
  { heading: 'Owners', records: 'legal.title.owners', columns: ['name', 'share_pct', 'capacity'] },
  { heading: 'Shares held', chart: { of: { records: 'legal.title.owners' }, x: 'name', y: 'share_pct' } },   // mark: 'bar' | 'line'
  { heading: 'Chain of title', table: 'chain' },
  { heading: 'Advocate’s remarks', note: { maxLength: 800, hint: '…' } },                              // a person's own words, capped at 2,000
] }
```

A section is one of `fields` (with `layout`), `table`, `records` (with `columns`), `chart`, `note` or `register` (a reading of the project's registers). `reportTemplateFaults()` names anything a template points at that is not there, and `test/report-fields.test.ts` holds every declared template to it, and to being fields, tables, charts and at most one capped note. Every department declares at least one; they are listed in [departments.md](departments.md). A function whose fields are on checks in Legal, Finance or Engineering also gets a generated `<fn>.checks` template.

## The firm's own fields

The built-in catalog is code. A firm adds to it as data, with a narrow power (`firm-fields.ts`):

- it **adds** fields to a built-in set, and lists for them to choose from. An added field is one a person fills (a line, a figure, an amount, a percentage, a date, a yes or no, a choice, bounded words), is never a must-field, and its key starts with `firm_`, which no built-in key does;
- it **folds** a built-in field as expert;
- it may not hide a built-in field, change what one holds, or take its key. The shape has no way to say any of those.

A firm admin does this on **Set up › Fields**. The pack is kept at firm level, beside the firm's law-watch list, and every reader of a project's fields asks for the catalog through `fieldCatalogFor(project)`, which is the built-in catalog with that firm's pack laid over it. So never write `fieldCatalog()` where a project is in hand: the functions in `field-sheets.ts` take the firm's catalog by default. One firm's fields are never another's.

Taking an added field away deletes nothing. What projects saved under its key stays on the sheet, under "No longer asked".

## Versions

Preview and production share one store and nothing is migrated. So: never reuse or re-type a key; retire a field (`retired: true`) or an option in place of deleting it; raise `v` and mark new fields `since`. A value under a key your build has not heard of is kept through every save, and is shown on its sheet as no longer asked (`SheetReading.unasked`). Do not start a built-in key with `firm_`.

## Reading a field's value in code

A stored value may be one that waits. Code that acts on a field reads it through `standingField`, `standingValues`, `withComputed`, `resolveFields`, `readSheet` or `standingFieldLines`, never from `check.fields` or a stored sheet's `values` directly. `test/field-readers.test.ts` reads the source and fails on a new direct read, with the list of the few that may and why.

## Where the parts are

| File (under `packages/shared/src/operating-model/`) | Holds |
|---|---|
| `field-sets/` | The field sets, the rule rows, the shared records and the state packs. One file per group of departments |
| `field-registry.ts` | The catalog: every set by id, the faults and the limits a catalog is held to |
| `field-sheets.ts` | Reading a sheet and a function's page, Needs you, and every way a value gets in |
| `check-fields.ts` | Kinds, validation, formulas, rules, what stands |
| `check-conditions.ts` | When a check's fields are asked, and the situations checks answer to |
| `check-waiting.ts` | The one way a value waits for a check's field |
| `firm-fields.ts` | A firm's overlay, the catalog for a project's firm, and the rule table a firm reads once it has verified rows of its own |
| `field-figures.ts` | The one door to figures other modules work out: schedule, site log, tenders, cost register, cost report, comparables, valuation, appraisal cash flow |
| `field-sets/builders.ts` | Shapes written once: one figure stated by several people, and a file's links to other departments (`withLinks`) |
| `report-fields.ts` | A report's field sections: resolving, templates, freezing, and what a grant's copy keeps |
| `sweep-rules.ts`, `law-change.ts`, `chat-answer.ts` | The daily review's rules, a law change as fields with its lists and offered rule rows, and the chat's card |
| `field-charts.ts` | A table's rows shaped for its chart |
| `rule-tables.ts`, `units.ts` | Dated figures a law sets; units and money |

The screen is `apps/web/src/components/fields/FieldSheets.tsx` (Needs you, the sheets folded to a line each, records and depth sheets, and the units' stack plan from `StackPlan.tsx`) over `CheckFields.tsx`, which draws every kind of field. Construction's Technical page draws its sheets too, though it is not laid out in parts.
