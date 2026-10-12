# Fields

Every function keeps fixed, typed fields. A person fills or links them, a paper or a public source offers values for them, and a model never writes a sentence that is kept. This page is for whoever declares a function's fields.

## The rules a field set lives under

- **A value somebody offered counts for nothing until a person accepts it.** A model's value, a parser's, another paper's: each waits on its field as `proposed`. No formula reads it, no rule fires on it, no status is drawn from it, and neither the graph nor memory hears of it, until a lead or signer of the function's department accepts it.
- **A model picks keys and gives values with a source.** A paper's page and its exact words, or a named public source and the date it was read. It writes no prose, and cannot offer a value for a field that is worked out, mirrored or `longtext`.
- **Complexity is more fields, not more screen.** A field shows when its condition holds. Expert fields stay folded. A field that is not showing is never counted as missing.
- **Nothing is thrown away.** Taking a situation out of play keeps what its fields hold. A record taken off its list is kept. A value under a key no longer declared is kept as it is.
- **A fact has one home.** The second place a fact appears is a mirror (`sameAs`) or a link (`ref`), never a second box to type in.

## Declaring a field set

1. Create one file in `packages/shared/src/operating-model/field-sets/`, named for your group of departments. Export one array: `export const LEGAL_FIELD_SETS: FieldSet[] = [ … ]`.
2. Register it with one line in `field-sets/index.ts`: import the array and spread it into `FIELD_SETS`.

Nothing else is edited. `pnpm check` runs two tests over the whole catalog (`test/field-catalog.test.ts`): one fails on anything that cannot work, the other on anything past the limits below, and both name your field set.

The worked example is `field-sets/example-land-holding.ts`: Legal › Title's land holding and its owners. Read it beside this page.

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
}
```

**A function's page.** A function with at least one field set has a Sheet part on its page, opening on what needs a person. A function still marked `coming_soon` in `departments.ts` becomes a page of its sheets and its documents as soon as a set names it in `fn`; its tab stops being muted. There is nothing to switch on.

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
| `display: 'timeline'` | `table` with a date column | Events in order: a chain of title, hearings |
| `display: 'chart'` | `table` with `chart: { x, y }` | A handful of figures worth comparing by eye |
| `display: 'match'` | `table` with `match` | Two lists that should pair up: demands to milestones, survey numbers to owners |

**Match.** The table's rows are the pairs. `match` names a column and a list for each side; whatever of either list no row pairs is left over, and every leftover is a line under Needs you.

```ts
{ key: 'demand_to_stage', label: 'Demands to stages', kind: 'table', display: 'match',
  columns: [{ key: 'demand', label: 'Demand', kind: 'ref', target: { set: 'commercial.buyers.demands' } }, { key: 'stage', label: 'Stage', kind: 'ref', target: 'milestone' }],
  match: { left:  { column: 'demand', label: 'Demands', of: { records: 'commercial.buyers.demands', field: 'ref' } },
           right: { column: 'stage',  label: 'Stages',  of: { target: 'milestone' } } } }
```

A side's list is `{ records, field }` (a field of every record of a set), `{ table, column }` (a column of another table, by its address) or `{ target }` (a register).

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
- **`ref`** holds the id of something entered once. `target` is `'party'`, `'parcel'`, `'building'`, `'unit'`, `'drawing'`, `'approval'`, `'matter'`, `'contract'`, `'account'`, `'package'`, `'document'`, `'milestone'`, or `{ set }` for the records of any set that repeats.

## Shared records

`field-sets/shared-records.ts` declares the records every department links to, each a set that repeats under the function `shared`: `shared.parties`, `shared.parcels`, `shared.buildings`, `shared.units`, `shared.drawings`, `shared.approvals`, `shared.matters`, `shared.contracts`, `shared.accounts`. What the project already keeps is linked to as it is and never entered twice: a `party` link also offers the project's people, a `parcel` link its survey numbers, an `approval` link the approvals register's kinds, and `package`, `document` and `milestone` read the cost register, the evidence register and the schedule.

To hold your department's own facts about a party, a unit or a parcel, extend the record in place of making a second one:

```ts
{ id: 'commercial.buyers.customer', fn: 'commercial.buyers', title: 'Customer', v: 1,
  extends: 'shared.parties',
  fields: [{ key: 'resident', label: 'Resident in India', kind: 'boolean', required: false }], rules: [] }
```

A function's page lists the shared records its fields link to, below its own sheets.

## Records: anything there can be more than one of

A set with `records` repeats. Each record is a small sheet of its own; the page shows a row for each, titled by `titleField`, with `summaryFields` as chips.

```ts
{ id: 'legal.title.owners', fn: 'legal.title', title: 'Owners', v: 1,
  records: { of: 'owner', titleField: 'name', summaryFields: ['share_pct', 'capacity'] },
  fields: [ … at most twenty … ], rules: [] }
```

Make it a set of records, not a `table`, when a row has a status, an expiry or a paper of its own, is linked to from elsewhere, or needs more than six columns. A parent counts or sums its records with `{ op: 'records', set, reduce: 'count' | 'sum' | 'min' | 'max' | 'spread_pct', field }`. Inside a record's own fields, a `showWhen` or a formula that names a field of the same set reads that record's.

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

A field hidden by its condition that still holds a value is kept, under "Recorded, not asked for now".

**Not applicable.** A person marks a field or a section not applicable with one of five reasons: not in this project, not at this stage, done by another party, exempt, no such paper. The reason is a key, never a sentence.

**Usual values.** `defaults: [{ when?, value, from, cite }]` fills a field as `assumed`: it is said to be assumed, feeds what is worked out, needs nobody, and gives way the moment a value is typed or accepted. `cite` is required unless `from` is `'firm'`.

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

## Formulas

A formula is a tree. Every leaf is a field, a figure or a rule row; nothing in it runs a string. An input that is not known gives no answer, never zero.

| `op` | Gives |
|---|---|
| `field` `{ key, at? }` | A field of this set, or with `at` of any set |
| `const` | A figure. Never one a law sets: see the rule table |
| `add` `subtract` `multiply` `divide` `power` `variance_pct` | Arithmetic on `left` and `right` |
| `min` `max` `{ of: [] }` | The least or the most, leaving out what is not known |
| `if` `{ when, then, else }` | By a condition: two amounts compared, or what a field holds |
| `sum` `count` | Over a table of this set |
| `sum_if` `count_if` `{ over, column, where }` | Over the rows of a table or the records of a set that meet a condition |
| `records` `{ set, reduce, field }` | Count, sum, least, most or spread over a set that repeats |
| `rate` `{ table, on?, where? }` | A figure from the rule table |
| `irr` `npv` `{ over, date, amount }` | A yearly rate of return, or a present value, of dated cash flows |
| `date` `today` `add_days` `add_months` `days_between` | Dates as day numbers; `yields: 'date'` on the field turns the answer back |

Fields are worked out in the order of what they read, across sets and functions. A ring fails the catalog test, with the ring named.

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

Add rows in a file of your own beside `field-sets/rule-rows.ts` and register it in `RULE_ROWS` in `field-sets/index.ts`. Read one with `{ op: 'rate', table: 'far_limit', where: { road_width_m: { field: 'road_width' } }, on: 'sanction_date' }`: the row for the project's state and city, in force on that day (today when `on` is left out), whose conditions the fields meet. The value worked out carries the row it came from, and so does a status that reads it; a row with `verified: false` shows as not verified beside every value that used it. Mark a row verified only with the name of the person who checked it against the instrument.

What differs by state and is not a rate (form numbers, the size of a ground) is in `field-sets/state-packs.ts`, keyed by state, Karnataka first.

## Papers: how a value is offered

A field that a kind of paper states names that kind:

```ts
{ key: 'extent', label: 'Extent held', kind: 'area', dimension: 'area',
  from: 'Sale deed',                       // shown beside the label
  fromTypes: ['Sale deed', 'Mother deed'], // the register's document types that offer it
  factKey: 'extent_title' }                // the key the paper's reading files the value under, where it is not the field's own
```

`fromTypes` are the register's document types as it writes them (the labels in `document-parse.ts`: "Sale deed", "Encumbrance certificate", "DC conversion order", …). When a paper of one of those kinds is read, each value that stands on the paper is offered to every field naming its kind, with the page and the paper's words, and waits there for a person. A value for a set of records with no record named makes one new record, which is nothing until one of its values is accepted.

The model's tools are `get_fields({ fn })` and `propose_field_values({ values: [{ address, value, origin }] })`. A proposal is refused without a source, for a choice not on the list, for a link to something not on the project, and for any field that is computed, a status, a mirror or prose.

## What a value carries

```ts
state?: 'empty' | 'proposed' | 'accepted' | 'typed' | 'disputed' | 'not_applicable' | 'assumed'
origin?: { kind: 'paper', evidenceId, page, quote, reader } | { kind: 'external', source, asOf, url? }
       | { kind: 'field', address } | { kind: 'person' } | { kind: 'default', from, cite? }
entered?, proposedBy?, acceptedBy?, acceptedAt?, other?, declined?, naReason?, naNote?
```

Accepted, typed and assumed values stand. Typing over a value accepted from a paper does not replace it: the two are disputed until a lead or signer keeps one. On screen an accepted or typed value carries no mark; pressing its label shows where it came from. Only what needs somebody is marked.

**Who may do what.** Whoever edits in the function's department (lead, contributor, signer) types values, adds records and raises a dispute. Only a lead or signer accepts, keeps, sets aside, marks not applicable, sets a situation or takes a record off its list. An outside collaborator is handed a function's sheets only where their grant names a scope the function's checks sit in.

## Limits the catalog test holds you to

- At most **twelve core fields** on a sheet. Past that: give a field a `showWhen`, fold it as `expert`, or make what repeats a set of records.
- At most **twenty fields** on a record.
- A table of more than **six columns**, or whose rows carry a status, a date that runs out or a paper, is a set of records.
- A `situational` field has a `showWhen`, its own or its section's.
- No statutory figure in a key or a label.
- No option called "not applicable" or "unknown".
- Every `longtext` has a `maxLength`; every usual value a `cite`.

`catalogLimits()` reports each breach by field set; `catalogFaults()` reports what cannot work at all.

## Versions

Preview and production share one store and nothing is migrated. So: never reuse or re-type a key; retire a field (`retired: true`) or an option in place of deleting it; raise `v` and mark new fields `since`. A value under a key your build has not heard of is kept through every save.
