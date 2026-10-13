# Fields

Every function keeps fixed, typed fields. A person fills or links them, a paper or a public source offers values for them, and a model never writes a sentence that is kept. This page is for whoever declares a function's fields.

## The rules a field set lives under

- **A value somebody offered counts for nothing until a person accepts it.** A model's value, a parser's, another paper's: each waits on its field as `proposed`. No formula reads it, no rule fires on it, no status is drawn from it, and neither the graph nor memory hears of it, until a lead or signer of the function's department accepts it.
- **A model picks keys and gives values with a source.** A paper's page and its exact words, or a named public source and the date it was read. It writes no prose, and cannot offer a value for a field that is worked out, mirrored or `longtext`.
- **Complexity is more fields, not more screen.** A field shows when its condition holds. Expert fields stay folded. A field that is not showing is never counted as missing, and a field a person fills that is not in play feeds nothing: no formula, standing, situation or count reads it, as no rule does. What it holds is kept, and reads again the moment it is back in play.
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
  periodic?: Periodic;   // kept by period: opened from the last, compared with it, due, issued. See Periods
}
```

**A function's page.** A function with at least one field set opens on **Needs you** (see below) and the list of its sheets, and on nothing else. A function with a desk of its own opens on the desk instead (Budget on the Cost Report, Progress on the board, Tenders on the tenders, Approvals on the register), with Needs you above it as its first five lines and the sheets one part away. Its certified reports, checks, papers and connections are parts reached from the row of parts across the top, each an icon with its name, one at a time, never stacked below. No quick assessment is drawn over a function that keeps sheets. A function still marked `coming_soon` in `departments.ts` becomes a page of its sheets and its documents as soon as a set names it in `fn`; its tab stops being muted. There is nothing to switch on.

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

**Viewers.** `viewer` on an `evidence` field is `pdf`, `image`, `drawing` or `deed`, each opening the paper in the app's own viewer, or `ifc`, which says the model is filed and not drawn yet. `series` draws photographs by the period each was taken in, two periods side by side: see Photographs. An `image` field is drawn the same way once its photographs span more than one month.

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
| `trend` | How it is drawn over time, inside the popover its label opens: see Trends |
| `retired`, `since` | No longer asked; the version that introduced it |

## Units

Give a measure a `dimension`: `area`, `length`, `volume`, `mass`, `money`, `time`, `count`, `ratio`. The value is kept once in the base unit (sqm, m, cu m, kg, the field's currency, days) with what was typed beside it, so "1 acre 22 guntas" is worked on as 6,272.63 sqm and prints as "1 acre 22 guntas (6,272.63 sqm)".

- **Area:** `sqm`, `sqft`, `sqyd`, `acre`, `gunta`, `cent`, `hectare`, and `ground`. A ground has a size only where the state's pack gives it one (`field-sets/state-packs.ts`); elsewhere the person is asked for another unit.
- **Length:** `m`, `ft`, `in`, `mm`, `cm`, `km`, `yd`. **Volume:** `cum`, `cft`, `litre`. **Mass:** `kg`, `tonne`, `quintal`, `g`.
- **One way to write each.** A day is `13 Oct 2026`, a share has at most two decimals with its sign against it, and a count agrees with its noun: `daySaid`, `percentSaid`, `countSaid` and `agreeSaid` in `said.ts`, which `formatFieldValue` and every page go through. No raw ISO date, no "INR" suffix and no "(s)" is printed.
- **Money:** typed as `4,20,00,000`, `4.2 Cr` or `45 lakh`; printed in lakh and crore, to two places, by one formatter (`rupeesSaid`, `formatMoney`), which the cost register's `moneySaid` and every page's `amount` go through. A column of a table is written in one unit chosen for the column (`moneyUnitFor`, `formatMoneyIn`; on a page `moneyColumn`), with the figure in full as the cell's title. Another currency is kept in its own, never converted. `test/rehearsal-screens.test.ts` fails on an amount or a date written to a screen without the formatter.
- `enterIn` narrows what may be typed. A bare number is in the base unit, or in the first unit of `enterIn` where the base is not one of them. `m2` and `m3` are read as square and cubic metres.
- What is typed is read strictly. Spaces alone are nothing recorded, never a zero; a figure is digits, commas and one point (`0x10` and a lone comma are refused); a day has to be one the calendar has. An amount with no `currency` and no unit of its own prints in rupees, and a rule prints two amounts in full where they would read the same in lakh and crore.

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
type FieldAddress = { fn: string; set: string; field: string; column?: string; record?: string; period?: string };
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

Make it a set of records, not a `table`, when a row has a status, an expiry or a paper of its own, is linked to from elsewhere, or needs more than six columns. A record is one once somebody has accepted or typed a value on it. Until then it holds only what was offered (`SheetReading.pending`): it is listed so its values can be accepted, and it has no name, no place in the graph, nothing links to it and it raises no Missing line. A record taken off its list is kept and read by nothing; a link that still names it says so, under Failing. A count or a sum over no records is 0, not empty: see the note on standings under Rules. A parent counts or sums its records with `{ op: 'records', set, reduce: 'count' | 'sum' | 'min' | 'max' | 'spread_pct', field }`. Inside a record's own fields, a `showWhen` or a formula that names a field of the same set reads that record's.

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

A field hidden by its condition that still holds a value is kept, under "Filled in earlier, not needed now". A field that is worked out, a standing or a mirror is nobody's entry: out of play, it is not listed there. An expert field that is worked out stays folded however much it holds: it is the working behind a standing.

**One declaration.** A project-scoped situation is declared once, by the department that owns it, and named by every other set that waits on it; a second declaration that differs by a character fails the catalog test. The ones several departments answer to: `joint_development` and `leasehold_land` (Law, proposed from the agreement or the lease), `lender_funded` (Lenders, derived from a facility recorded), `designated_account_kept` (Finance), `rera_registered`, `revised_sanction`, `stop_work_order` and `agricultural_needs_conversion` (Law and Liaison, derived), `tdr_or_premium_far`, `high_rise` and `mixed_use` (the Architect), `litigation_pending` (Litigation). `agricultural_land` (Title) says the land is or was agricultural; `agricultural_needs_conversion` says it is not yet converted. The four valuation approaches are declared with the valuation checks (`check-conditions.ts`). A function's page shows a derived situation as a chip only while it holds.

**Not applicable.** A person marks a field or a section not applicable with one of five reasons: not in this project, not at this stage, done by another party, exempt, no such paper. The reason is a key, never a sentence.

**Usual values.** `defaults: [{ when?, value, from, cite }]` fills a field as `assumed`: it is said to be assumed, feeds what is worked out, needs nobody, and gives way the moment a value is typed or accepted. A value somebody offered does not switch it off: the offer shows on the field to be accepted, and the usual value goes on standing in behind it. A value worked out from one carries the labels of the fields that stood in (`assumes`), and a report prints it as "worked out, on an assumed value". `cite` is required unless `from` is `'firm'`. A value assumed because a paper will not come stands in the same way, ahead of a usual value, with its line of Papers owed as the citation: see Lists.

## Due and owed

Two attributes say when a field is the reader's to fill, and both keep the count honest.

```ts
{ key: 'title_opinion', label: 'Title opinion', kind: 'evidence', owedBy: 'advocate', dueFrom: 'acquisition' },
{ key: 'possession_letter', label: 'Possession letter', kind: 'evidence', owedBy: { ref: 'seller' }, dueFrom: 'acquisition' },
```

- **`dueFrom`** is a step of the project (`opportunity_site`, `feasibility`, `acquisition`, `design`, `approvals`, `procurement`, `pre_construction`, `construction`, `testing_commissioning`, `completion`, `handover`, `operations`) or a day (`YYYY-MM-DD`). Before then the field shows and takes a value, and is neither counted nor listed as empty. An occupancy certificate's date is not missing during design.
- **`owedBy`** is a role (`owner`, `advocate`, `authority`, `consultant`, `contractor`, `lender`, `buyer`) or `{ ref }`, the key of a `ref` field of the same set that links to a party: whoever that link names owes it. A field somebody else owes is never under Missing and never counted against the reader. It is listed under that party on the function's page ("Waiting on others") and as a line of the department's **Papers owed** list, on its Documents part. There is no page of its own.

Only a must-field that a person fills can be owed.

## Lists: papers owed, and a form of answers

Two lists a consultant keeps are taken in as they are, through the one **Load a list** on a department's Documents part (`POST /checklist/import`; with `preview` it says what it would do and changes nothing). Neither is a field set: a list is lines, and a form is answers to fields that already exist.

**A tracked list** is a spreadsheet of information required, sent again each time it moves: a title and a legend, a row that names the columns, section rows between the items, and for each item a number, an older number, a package, the round it was asked in, a few words on what came back, and a status. `parseTrackedSheets` (`list-import.ts`) reads it from an `.xlsx`, a CSV or pasted rows. It finds the header wherever it is and knows the columns by their words, whoever's name is in them:

| Column, by its words | Kept on the line as |
|---|---|
| `Ref No`, `Sl. No`, `Item No` | `ref`, as written: "2.1.4" |
| `Orig. Sl.No`, `Old Ref` | `oldRef` |
| `Package`, `Discipline`, `Trade` | `package`; a blank cell takes the package of the line above in the same section |
| `Description of Information Required`, `Description`, `Item`, `Particulars` | `title` |
| `Availability (at request)` | `availability`, as written |
| `Request Ref`, `Asked in`, `Round` | `round`: a line with one has been asked for |
| `Client Response / Remarks` | `remark`, read from the list |
| `Current Status` | how the line stands: see below |
| `Responsibility`, `Action by` | `owedBy` |
| `Target Date`, `Due`, `Required by` | `targetDate`, as a day |
| `Next Action / … Comments` | `note` |

A row with only its number and its name is a section: it is kept as a heading over the lines under it (`headings`, outermost first, each with its number) and is never a paper, and neither is the title, the legend or the header. A sheet that counts the list ("Summary") is not read. A load ends by saying how many rows the sheet held, how many lines and sections were made of them, and each row that became neither with its reason (`counted`), so a count that does not add up is seen. A workbook's merged cells, blank rows and signature block are read through, and a file that cannot be read is refused in a sentence, never in an error's own words.

- **What makes a line itself.** Its number where the list has one, else its name within the sections it sits under: two phases that ask for a paper in the same words are two lines.
- **A load is one step.** Every line a load adds carries the load's id. The card says "Loaded 99 lines from …" with **Undo**, which takes that load back whole (`removeChecklistLoad`, `POST /checklist/remove`), and a tracked list is removed whole, with one confirmation, by somebody who may edit on every desk its lines are on.
- **Lines ticked are set together** (`assignChecklistItems`, `POST /checklist/assign`): in hand, partial, to be assumed, asked for on a day, who owes them and the day they are wanted by.
- **A document is offered for a line only on words that mean something.** "Client", "drawing", "details", "report", "list", "works" and "information" carry no weight: a match needs two other words in common, or the one the line has.
- **Owed is counted one way.** A paper is owed once somebody has been asked for it; the card, Overview and every notice say the same number (`askedFor`, `papersOwedSaid`, `notAskedSaid`). Lines nobody was asked for, and lines that name nobody or no day, are what the list needs of somebody: a function's opening says so in one line with the counts (`papersNeedSaid`).
- **Who owes it is a party.** The owed-by box picks from the project's parties, and a name that is not one yet is offered to be added to them. A consultant a tender form names who is no party is offered as a new party with its role; once accepted, the form's row links to it.
- **A spreadsheet dropped in the chat** that is a tracked list or a tender form is offered to its loader in one press, in place of being read as a paper.

- **Six standings.** Four are worked out as before: not asked, asked for, answered and in hand. Two more are set by a person who may edit the list, or by the list's own status column: **partial** (some of it is in hand and the rest is still owed, with a short line on what is still wanted) and **to be assumed** (it will not come, and a named party proceeds on an assumption). The status column reads `Received` as in hand, `Partial` as partial, `… to assume` as to be assumed with whoever is named, and `Pending` as asked for where a round is named and not asked where none is.
- **Sent again, it updates.** `loadTrackedList` matches a line to the one an earlier copy of the same list made: by its number and name, then by its name where the number moved, then by its number where it was reworded. It reports what became received, became partial, became to be assumed, went back to pending, was added, and is no longer on the list (kept, and said). A line is never added twice. What a person settled here is not undone by the list.
- **Each package has a desk.** `PACKAGE_DESKS` sends a package to a function by the words in its name: general to Budget, civil and structural to the Structural design basis, architectural and finishes to the Finishes schedule, external development to Landscape and external works, MEP to the Electrical load. The firm answers differently as it loads the list (`desks`, a package's name to a function's key), and a package nothing names stays on the desk the list was loaded on. Whoever loads it has to be able to edit in every department it reaches.
- **The count is worked out.** `checklistSummary` gives, for each package and in total, how many lines are received, partial, to be assumed and pending, and the percent received; with `round`, of the lines asked for in one round. The card draws it above the list of a tracked list, and a report carries it as the bound block `information_status`.
- **Who owes it and by when.** A line still owed that names nobody, or no day, says so in one quiet mark on a list that keeps such things ("nobody named, no date"), each is a filter, and one act sets the party and the day for every line ticked (`assignChecklistItems`). A line past its day is overdue. Nothing new is counted: Overview and the work list read the same papers-owed list as before.
- **A paper that will not come.** A line to be assumed may name the fields the paper would have filled, each with the value assumed (`assumeChecklistItem`, `list-assumptions.ts`). Such a field reads that value as **assumed**, with the line as its reason: it feeds what is worked out, is said to be assumed wherever it shows, and gives way the moment a value is typed or accepted. Nothing is written onto the field, so taking the line back takes the assumption with it. Only a field a person fills with one value can be assumed, and whoever sets it has to be able to type in that field's department.

**A tender form** is a form of answers: lines above a table for the project, the client, the package and the day a reply is wanted by, then rows under `Information / Document Required`, `Details to be Provided`, `Client Response`, `Document Attached` and `Remarks`. A sheet with the second and third of those columns is one. Its rows are the fields of **Tender terms** (`procurement.boq.tender_terms`), a record for each tender, and `TENDER_FORM_ROWS` (`tender-form.ts`) is the one table that says which: fifty-one rows in ten sections, each with the fields it answers and how a response is read as each.

- A row is known by its wording, a letter or a word off (`tenderFormRowFor`), helped by its section and its number.
- A filled response is **offered** as each field's value, with the file, the sheet and the row as its source, and counts for nothing until a lead or signer accepts it on the field. Words that cannot be read as the field's type are offered nowhere: the row is listed for a person to type.
- `Not Applicable` is offered as not applicable, and a lead or signer of Procurement takes it or sets it aside.
- A paper named under `Document Attached` is offered as the field's paper where a document of that name is on the project.
- A row left unanswered, or naming a paper that is not on file, is a line of Papers owed: owed by the client, asked for, and wanted by the day the form asks for its reply.
- `tenderFormExport` writes the same form back out, in the same columns, from the values that stand on the sheet. A form written here and read back offers nothing new.

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
- A record at its twenty-field limit makes room by moving the fields of one hard case to a depth sheet under the keys they always had: what projects saved stays where it was.

The catalog declares twenty-two: an owner's guardianship and succession (with the heirs as rows under the owner who died), an instrument signed by an attorney and a partition, the partition suit, a final order and its appeal, what a plan revision changes, a variation's time claim, the cost of a delay, a guarantee's invocation, a design change that alters what buyers were promised or needs a modified sanction, a cancellation after the registered agreement, and the nine sheets of a tender's terms. Six of those every tender has (issue and reply, consultants, water and electricity, retention and security, approved makes and guarantee formats, the appendices); three open only once the tender says yes (earnest money, the mobilisation advance, materials the client supplies), so a tender with none of them is a short sheet.

## Needs you

A function does not open on its form. It opens on at most five lines in all, the most pressing first across the five groups below. Each group that holds something is a chip with its count that narrows the card to it, and one "Show all" lifts the cap. Every line has one action: Accept (with Not this) where the reader may decide the value where it is held, otherwise Open, which goes to the sheet, the record or the check that holds it, brings the field's box into view and puts the caret in it. Nothing is listed under Accept that the server would refuse: a line's `address` is always the field that holds the value, a reading (a computed field, a status, a mirror) is never offered as something to decide, and Accept is drawn only for somebody who leads or signs in that field's function (any department's lead, for a shared record).

| Line | Holds | Why it is in this place |
|---|---|---|
| **Decide** | Two values in dispute; a situation a paper proposes | A situation changes what every later line holds, and a dispute blocks a report |
| **Accept** | Values offered and waiting, with "Accept all" for each paper that offered more than one. A value waiting beside a mirror, or offered for a check's field a sheet mirrors, is one line, drawn at the mirror (`shownAt`) and addressed to the field or check that holds it (`address`), where one tap accepts it. A value offered to a shared record (a unit, a contract, a parcel, an account, a party) is listed under the function that adds that fact to the record, or, for a fact of the record itself, the function its paper is filed under | The cheapest act with the largest effect |
| **Failing** | A rule firing at high or critical; a day that has run out; a pairing whose names differ | Needs judgement, best made once the values under it are settled |
| **Due soon** | A day within its `expires.leadDays`; a rule at medium; a standing whose tone is a warning | Can wait a day |
| **Missing** | A must-field the function's own people owe that holds nothing; a thing with no counterpart in a match | Last, because most of it is cured by filing a paper |

A set kept by period (see Periods) adds one line of its own, of kind `due`: the latest period that has ended and is not issued, said as how full it is and when it is due ("October: 4 of 9 fields, due 7 Nov 2026"). It is counted under **Due soon** until its day and under **Failing** after it ("was due"), inside the five lines like any other. There is one for a set, whatever else the set is behind on; older periods nobody kept are said on the sheet, not here. The photograph round is one more such line, on the Site record: the stations not photographed this period, however many (`stationRoundDue`).

Not on the card: expert fields; fields before their `dueFrom`; what another party owes (one quiet line, "Waiting on others"); usual values standing in (one quiet line); a rule at low, which is said on the sheet it is about.

A line that rests on a rule row nobody has verified carries `ruleUnchecked` and the rows it read (`cites`), and one that rests on a usual value carries `assumes`, the labels of the fields nobody entered. The page marks the first "rule not checked" and the second "on an assumed value", on the line, on the value in its sheet, in a report ("worked out, on an assumed value") and on the chat's card. A line whose rule reads another function's records carries `target`, the address of the record there that causes it: the one a paper offered and nobody has accepted where there is one, else the one that meets the rule's condition, else the list. Open goes to it. "Today" is the day in India everywhere a day is compared with one (`indiaToday`): a date runs out, a field falls due and a rule row comes into force at midnight there.

A lead or signer may **postpone a line under Due soon** until a day they name, at most ninety days ahead. It comes back on that day, or at once if it starts failing. Nothing else can be put off. `readFunctionFields(project, fn)` returns the five lines as `needs`, what is put off as `snoozed`, and what others owe as `waitingOn`.

On a phone the card is the first screen of the function. On a laptop it is the first card on the function's page.

**Below it, a sheet is one line.** Every sheet is drawn as a line (its title, how full it is, what is still to fill, and where its standings are) that unfolds when pressed. A set that repeats is one line with its count, and so is a shared record: it is never printed in full on a page that only reads it. A sheet none of whose fields is in play yet is not drawn as an empty card: the page names such sheets in one sentence. So keep a sheet's standing honest on an untouched project (see Rules): it is what a person reads without opening anything.

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

**A standing over nothing.** A sum over nothing entered is a zero nobody stated (`overNothing`): a count of no heirs is a fact, a sum of no contributions is not an amount. No comparison fires on one, and a standing whose failing case would have fired on one is empty: neither "short of the minimum" nor "in step" is true of a sheet with nothing on it. Nor is `otherwise` read while a limit is on file and the figure it limits could not be worked out (FAR allowed recorded, plot area not): "within the limit" would be said of a figure nobody has. Apart from those, a status is empty until a field its cases read holds a value, and a count or a sum over no records holds 0. So a standing with an `otherwise` reads as that label on an untouched sheet, and "In order" over nothing recorded tells a reader the work is done. Open such a status with a case for nothing recorded, in a neutral tone ("No approval recorded"), or read a figure that is blank until its inputs exist (`finance/kit.ts` has `totalOf`, `tallyWhere`, `once` and `limitFor` for this). `test/field-catalog.test.ts` fails on any standing in a good tone on a project nobody has touched.

## Formulas

A formula is a tree. Every leaf is a field, a figure or a rule row; nothing in it runs a string. An input that is not known gives no answer, never zero.

| `op` | Gives |
|---|---|
| `field` `{ key, at?, via? }` | A field of this set, or with `at` of any set. With `via` as well, `at` names a field of a set that repeats and `via` one of this set's own links: the field is read from the record that link holds (the agreed value of this ledger's unit) |
| `figure` `{ key, of?, asAt? }` | A figure a module of its own works out, read and never entered: see Figures from other modules. `asAt` names one of the holder's own dates: the figure is then read as the project stood when that day ended, where the day has gone by |
| `moved` `{ key, since }` | How far one of the holder's own figures has moved: now less then. `since: 'last_period'` is since the last period issued of a set kept by period; `since: { days }` is since so many days ago, read from the project as it stood then. No answer where the record does not reach that far |
| `const` | A figure. Never one a law sets: see the rule table |
| `add` `subtract` `multiply` `divide` `power` `variance_pct` | Arithmetic on `left` and `right` |
| `min` `max` `{ of: [] }` | The least or the most, leaving out what is not known |
| `if` `{ when, then, else }` | By a condition: two amounts compared, or what a field holds |
| `sum` `count` | Over a table of this set |
| `sum_if` `count_if` `{ over, column, where }` | Over the rows of a table or the records of a set that meet a condition. `where: { column, is: 'own', value? }` joins rows to the record being worked out: the row's column holds that record's id, or what its own field named in `value` holds (the demands of this unit, the claims of this contract). The same join works in a `showWhen` over records |
| `where: { all: [...] }` `{ any: [...] }` | Several row conditions at once, in any `where` (a formula's or a `showWhen`'s): all of them, or any of them. A join inside `all` that cannot be told yet makes no row the record's own; inside `any` it is left out |
| `over: { records, table }` | The rows of a table kept inside each record of a set, read as one list: the receipts on every demand |
| `between: { column, from?, to? }` on `sum_if` and `count_if` | A window of days: the row counts where its date column falls on or between two days, each a formula (a date of the record the figure is for). An end left out is open. No answer, not nought, while an end is not recorded |
| `asAt: { from, until?, on }` on `count_if` | The rows that stood on a past day: begun on or before it and not yet ended |
| `distinct: column` on `count_if` | Each value of a column counted once |
| `records` `{ set, reduce, field }` | Count, sum, least, most or spread over a set that repeats |
| `records` `{ set, reduce: 'latest', by, orBy?, field, where? }` | One field of the record dated last by `by` (by `orBy` where it states no `by` day), among those meeting `where`. A date field is read as its day |
| `span_days` `{ over, from, to, where?, within?, reduce }` | Days dated spans cover, overlapping spans counted once (`covered`), or the days of the period `within` that none covers, never below nought (`uncovered`) |
| `rate` `{ table, on?, where? }` | A figure from the rule table |
| `irr` `npv` `{ over, date, amount }` | A yearly rate of return, or a present value, of dated cash flows |
| `date` `{ key, at?, via? }` `today` `add_days` `add_months` `days_between` | Dates as day numbers; `yields: 'date'` on the field turns the answer back |

Fields are worked out in the order of what they read, across sets and functions. A ring fails the catalog test, with the ring named.

Each of these is a pure function with its arithmetic written out in `test/formula-operators.test.ts`. A match table's side may likewise be read from a table inside records (`of: { records, table, column }`: the sellers named on every purchase).

A formula takes the latest of dated records (`records` with `latest`), counts or sums the rows inside a window of days (`between`), counts the rows that stood on a past day (`asAt` on `count_if`), reads a figure as at a day the holder names (`figure` with `asAt`), and says how far a figure has moved since the last period or a number of days (`moved`). What formulas still cannot do, so that nobody hunts for it: group rows by a column and reduce each group, or run an ordered window over records (a running balance). A money field refuses a negative value unless it declares a negative `min` (an overdrawn balance, a net outflow).

## Figures from other modules

The schedule, the site log, the tender tracker, the cost register, the monthly cost report, the comparable schedule and the valuation keep their figures in modules of their own. A field set does not hold those a second time. A computed field reads one with `{ op: 'figure', key }`:

```ts
{ key: 'actual_percent', label: 'Progress, by the weight of the milestones', kind: 'computed', unit: '%', formula: { op: 'figure', key: 'progress.percent' } }
{ key: 'awarded_on', label: 'Awarded on', kind: 'computed', yields: 'date', formula: { op: 'figure', key: 'package.award_day', of: 'package' } }   // of one work package: `of` names this set's own link to it
```

Planned progress is one of them, and is typed by nobody: `progress.planned_percent` is each milestone's planned start and finish read by its weight (none before the start, all of it from the finish, a straight line between), and is null while any milestone has no planned finish. `progress.planned_value`, `progress.earned_value`, `progress.schedule_index` and `progress.cost_index` are the work in money, and are null unless every milestone is tied to a work package with a budget (`earnedValue` in `milestone-schedule.ts`): a milestone's weight is a share somebody judged, not money. `progress.building_percent` and `progress.building_planned_percent` are of one building, by the link the set names.

`field-figures.ts` is the one door: `PROJECT_FIGURES` lists every figure by key (`progress.*`, `schedule.*`, `site_log.*`, `observations.*`, `tenders.*`, `cost.*`, `cost_report.*`, `comparables.*`, `value.*`, `cash_flow.*`, `project.*`, `photos.*`, and `package.*` for one work package). A figure marked `own` (`photos.station_*`) is of the record that asks for it: read from a field of a set that repeats, it is given that record with no link named. One group of them is worked out from field records by code, because it moves milestones and a formula does not: what the extensions of time granted do to the schedule. The days of a search period no encumbrance certificate covers and the plan sanction as the last sanctioned revision leaves it used to be figures too; they are formulas now (`span_days`, `records` with `latest`). Each reads only values that stand, through `standing-records.ts`. A figure is read-only, is worked out afresh each time the sheet is read, and is null where its module cannot tell it yet, never zero. A day comes as a day number, for a field with `yields: 'date'`. A key that is not there, or a per-package figure with no link named, fails the catalog test. To expose a new figure, add a row to `PROJECT_FIGURES`.

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

**A consequence that crosses departments** is read, never copied. A time claim's days granted move the milestones its contract's packages are measured against and the work planned after them (`milestoneExtensions` in `progress.ts`); the programme's `completion_now` is the later of the forecast and planned completion after extensions, and the lender's sheet, RERA's rule and the landowner's delivery date are held to it. An approved variation is offered to a lead or signer in Finance (`variationOffersWaiting`, `acceptVariationOffer` in `tenders.ts`) and moves the Cost Report only when taken. The sanction in force (`legal.approvals.sanction`: `built_up_in_force`, `units_in_force`) is what the last sanctioned revision states, and is what the Architect's area statement, Sales' unit count, the environment clearance and RERA's application read. What a court's order covers is a record for each parcel or unit (`legal.litigation.order_cover`), so a unit says which orders in force restrain its sale.

Who owns what, so two files do not both declare it: the provision against claims and the contingent liabilities are Finance's (Ledgers), read against Litigation's matters; the welfare cess is Tax's; the day work began on site is Construction's; the carpet area as built is the Architect's; variations and extension-of-time claims are Procurement's; the unit, the unit mix and the area statement the Architect's; milestones and progress Construction's; RERA filings Law's, which types none of the figures; the designated account, GST and TDS Finance's and Tax's; comparables Valuation's; snags the site's (Technical); a lift's permission and licence Liaison's; the party record is shared.

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
- **The list to check.** `ruleRowsListed(ruleRowsFor(project))` (`rule-row-list.ts`) gives every row by the department whose fields read it, with its citation, its source and those fields. A firm admin marks one checked with the clause and the day read (`checkRuleRow`, `POST /api/law-watch/rule-rows/check`): the row becomes the firm's own, verified under that person's name. The built-in table is never marked.
- **A firm's own rows.** The law watch offers a row where a confirmed change moves a rate; a firm admin verifies it by name (`POST /api/law-watch/rule-rows/:offerId/verify`). A verified row is the firm's: it supersedes the built-in row from the day it takes effect, and every formula on that firm's projects reads it, on the server and on the page (`ruleRowsFor(project)`, installed as the firm's fields are). An offered row nobody has verified changes no figure.

What differs by state and is not a rate (form numbers, the size of a ground) is in `field-sets/state-packs.ts`, keyed by state, Karnataka first.

## A check's fields

Every check's fields are in the catalog under the check definition's id, and are read, offered and decided through the same functions as a sheet's.

- **When they are asked.** `check-conditions.ts` gives a check the condition all its fields wait on, and declares the situations those conditions name for the function the check sits in. The four valuation input checks open by approach this way: `comparable_approach`, `cost_approach`, `income_approach`, `residual_approach`, each in play once a person says so or once one of its inputs is recorded (`impliedBy`). The check's screen does not draw a field that is not asked, folds an expert one, and keeps one that holds a value while not asked under "Filled in earlier, not needed now" (`checkFieldsShown`). Add a condition to a check there; never in the check's schema.
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
- **How a paper's kind maps to fields.** The rules name the kind (`parseDocumentText`), or a model does and a person confirms it. The kind decides three things: the row the paper is filed on (one titled as that kind and nothing else, else a row of its own, under the function `DOCUMENT_WORKSTREAM` gives the kind); the keys the reader is asked for (every registered field whose `fromTypes` names the kind, by `factKey` or its own key: `paperKeys(kind)`); and the fields its values are offered to (the same list). The chat's route hands the reader the kind even where it hands over no local reading (`papers` on `enrichIngestWithDocumentIntelligence`).
- **A measure keeps the paper's units.** A value read in the base unit carries the measure as the page writes it (`written` on the fact and on the proposal: "1 acre 20 guntas"). Where that is a measure the field takes and comes to the value offered, it is kept as what was entered, so the field shows "1 acre 20 guntas (6,070 sqm)". The value itself is never taken from it.
- **One parcel's extent is not the holding's.** A deed or a record of rights that names fewer survey numbers than the project holds is offered to that parcel's own record, and to no check that asks for the extent of the whole land.
- **A paper that states rows offers rows.** A cost report states a line for each package and an engineer's report an observation after another; neither is a fact with one key. A technical due diligence report's observations are offered to **Report observations** (`construction.quality.observations`), a record to each, by `offerReportObservations` through `proposeFieldValues`: what was seen and what is recommended as the page's own words in a line each, the risk and the part of the building as picks, every value with its page. A cost report's rows are offered to the Cost Report, which is no field set, and wait there the same way (`cost-import.ts`). Neither kind names fields with `fromTypes`, and the keyed-fact reader is not asked about either.
- **A new record is one line.** A record a paper offered, and nobody has accepted a value of, is one line under Accept ("New purchase", with each value said). Accepting it (`decideField` at the address whose field is `RECORD_AS_OFFERED`) takes every value that needs no naming; one a person has to name stays for them. It is nothing until then.

The model's tools are `get_fields({ fn })` and `propose_field_values({ values: [{ address, value, origin }] })`. A proposal is refused without a source, for a choice not on the list, for a link to something not on the project, and for any field that is computed, a status, a mirror or prose. What is kept as a value's origin is built by the server from the named members of what was sent (`offeredOrigin`), never stored as sent: who read it is the proposer; a model's words are looked for on the pages this server read (`setPaperPages`, the page check a review answer is held to) and the value is `page_text` on the page that holds them or `unverified`, which "accept all" never takes; every string is cut to a bound and a link is kept only as https. Words given to `suggest_answers` as a paper's are laid beside a question only where a page of the paper holds them. On a check, a field whose `proof` is `'required'` takes a value only from a paper on the project.

The copilot is told the rule in one paragraph (`FIELD_RULE` in `packages/agents/src/agents/project-copilot.ts`): it reads values off papers with the page and the paper's words, looks up named public sources with the date read, maps each value to a field key from the list `get_fields` gave it, and writes no prose into any field. `get_fields` also says of each field whether it is on a depth sheet, not yet due, or owed by another party, so the model does not ask a person for those.

**What a model may hand back.** Every model call answers with keys, picks, values with a source, or a paper's own words quoted. It writes no sentence that is kept or shown: the daily review's lines, the law watch's changes, the chat's answer and a report are all printed by code from the record. `test/no-model-prose.test.ts` fails on anything else, and a new tool or free-text member has to be classified there.

**What is told as a fact.** A value read off a paper is offered: to a check as a card, to a field as a value that waits. That is as far as it goes until a person accepts it, whoever read it and however surely. The rules' own sure reading of a clean page stands far enough to be offered (`standingFacts`) and no further: the Approvals card dates an approval, the chat says what the land last changed hands for and Valuation tells an old sale only from what a person has accepted (`acceptedStanding` in `fact-review.ts`), and each says of anything else that it is waiting to be accepted. Accepting a value on the field or the check it was offered to accepts it on its paper too, where the person may decide the paper (`acceptOnPaper`), so the same value is not asked about twice.

## What a value carries

```ts
state?: 'empty' | 'proposed' | 'accepted' | 'typed' | 'disputed' | 'not_applicable' | 'assumed'
origin?: { kind: 'paper', evidenceId, page, quote, reader } | { kind: 'external', source, asOf, url? }
       | { kind: 'field', address } | { kind: 'person' } | { kind: 'default', from, cite? }
entered?, proposedBy?, acceptedBy?, acceptedAt?, other?, declined?, naReason?, naNote?
```

A value also carries `history`, what the field held before (see History), and `since` where the day it began to stand is neither `acceptedAt` nor `at`.

Accepted, typed and assumed values stand. Typing over a value accepted from a paper does not replace it: the two are disputed until a lead or signer keeps one, and typing again adds a third beside them. Typing the value a field already holds changes nothing, source and all. A value accepted from a source is cleared only by a lead or signer, and is then kept among what was set aside; a disputed one is not cleared at all. Marking a field not applicable keeps what it held (`was`), and asking it again puts that back as it was. On screen an accepted or typed value carries no mark; pressing its label shows where it came from. Only what needs somebody is marked.

**In a report and in the chat.** An accepted, entered or worked-out value prints with a footnote: the paper and page, the public source and the day read, or the person and the day. An assumed one prints "assumed". A proposed or disputed one prints "waiting" and never its figure. A figure from a rule row prints the row's citation and "not verified". A field that is not in play is left out. The chat's card says the same of each row, and calls a worked-out figure worked out, never accepted.

**Who may do what.** Whoever edits in the function's department (lead, contributor, signer) types values, adds records and raises a dispute. Only a lead or signer accepts, keeps, sets aside, marks not applicable, sets a situation or takes a record off its list. A situation the whole project shares is set from a function that declares it or has fields waiting on it, and from no other. A check's field is decided on its check: a collaborator whose grant leaves that check out does not decide it. A decision sent to a mirror is made on the field it reads, in that field's function. An outside collaborator is handed a function's sheets only where their grant names a scope the function's checks sit in, and three functions ask for more (the Procurement scope by name, the Budget area, the Valuation area): the gates, what follows a sheet onto a copy and what is refused are in [auth.md](auth.md), under “Field sheets on a collaborator's copy”. They are never handed a set in `CUSTOMER_SETS` (buyers) or a party record one of those names, and are handed a department's additions to a shared record only where that department's function is in their reach.

## History

A field holds one value, and keeps what it held before on the value itself.

```ts
interface FieldPast {
  value: string | number | boolean | string[] | null;   // never a table's rows: a table keeps `rows`, how many it had
  rows?: number;
  entered?: { value: number; unit: string; text?: string };
  state: 'accepted' | 'typed' | 'not_applicable' | 'empty';
  origin?: FieldOrigin;        // a paper's words cut to 80 characters
  by: string; at: string;      // who made it stand, and from when
  until: string;               // when it stopped standing
}
// CheckFieldValue.history?: FieldPast[]   newest first, at most 24
```

- **One writer.** `stand(holder, key, next, { at, by })` in `field-history.ts` is the only way a stored value changes: a sheet, a record, a check (`recordCheckFields`), an acceptance, an edit made while accepting, a field marked not applicable and asked again. A mirror holds nothing, and says its owner's past. Where the value that stood stops standing, it is kept with the moment it stopped; where what stands is unchanged (the same figure typed again, a value offered beside it) nothing is added. Clearing a field keeps its past on an empty value.
- **Only what stood enters.** A value somebody offered, one in dispute and a usual value standing in are never history.
- **Bounded.** Past 24 entries the first is kept, the latest 12, and of the rest the ones that stood at a month's end (`thinHistory`). An entry whose successor was dropped says so, so a day in the hole is never read as a day nothing stood.
- **Read as at a day.** `fieldAsAt(value, day, project.historyFrom)` gives what stood when the day ended in India: the value held now, an entry of its history, nothing, or today's value marked `as_now` where the record does not reach that day. `fieldMoved(value, sinceDay)` gives then, now and the difference.
- **No migration.** History begins at a field's first change after this was built. `project.historyFrom` is the moment a project's history is whole from: its making, or its first change of a field since. Before it, a past day reads as now and says so.
- **On screen.** Nothing new on the sheet. The popover a label opens gains one line put together by code, "Was ₹4.1 Cr on 12 Aug 2026 (R. Iyer); now ₹4.32 Cr", and a small line where the field has held three figures or more (`fieldHistorySaid`).
- **Who, by name.** Wherever a line says who typed, accepted or issued something (the popover, a footnote of a report, the line that opens a set's past, a photograph's caption, a notice), it prints the name the project's team gives them, else the name part of their address (`personSaid` in `team.ts`). No line prints an address; the trail keeps it.
- **The trail** says what a field held and what it holds, as the field prints them (`oldValue`, `newValue` on `set_field_values`, `record_check_fields` and each `field_<decision>`).
- **A collaborator's copy** cuts a field's past as it cuts the field: with the field, and each entry's citation only where its paper is on the copy.

## Periods

A set kept by period says so with `periodic`. There are two forms and one declaration.

```ts
interface Periodic {
  every: 'week' | 'month' | 'quarter' | 'year' | { event: string; on?: string };  // event: a records set; `on`, its record's own day
  by?: string;            // on a set that repeats: the field that names the period
  per?: string[];         // on a set that repeats: what tells one instance from another in a period (the kind, the building)
  carry?: string[];       // keys copied from the last period; the rest open blank
  cumulative?: string[];  // running totals: what moved is this less the last
  due: { days: number } | { rate: string };   // after the period ends; a day a law sets is a rule row, in days or months
  issuer: 'lead' | 'signer' | OwedRole;       // an outside party's paper is recorded as issued, under the name it was signed by
  attribute?: Array<{ field; rows: FormulaRows; date; amount; label; of?: 'movement' | 'amount' }>;
  reasons?: string;       // the option set a person picks from for what the rows do not explain
}
```

**Records as periods.** On a set that repeats, each record is one period's instance. `by` names the field the period is read from: a date (the month a cash record begins, the quarter a certificate ends), the year as a receipt writes it ("2026-27"), or for `{ event }` the link to the event's record. Storage is what it was; a record gains only `issued`, `frozen`, `revises`, `carried` and `reasons`.

```ts
{ id: 'finance.funding.rera_certificates', fn: 'finance.funding', title: 'RERA certificates', v: 1,
  records: { of: 'certificate', titleField: 'kind', summaryFields: ['period_end', 'signed_on'] },
  periodic: { every: 'quarter', by: 'period_end', per: ['kind'], carry: ['signed_by', 'membership_no'],
              due: { rate: 'rera_quarterly_filing_days' }, issuer: 'consultant' },
  fields: [ … ], rules: [] }
```

**A sheet as periods.** On a sheet held once, the sheet is the open period, and each period issued is kept beside it (`StoredFieldSheet.periods`) with every field frozen. It names no `by`.

```ts
{ id: 'finance.lenders.position', fn: 'finance.lenders', title: 'Loan position', v: 1,
  periodic: { every: 'month', carry: ['account_class', 'notice_dated', 'reply_by', 'matter'], due: { days: 7 }, issuer: 'lead' },
  fields: [ … ], rules: [] }
```

- **Keys.** A period's key never changes: `2026-09`, `FY2026-Q2` (or `2026-Q3` where the project numbers quarters by the calendar year), `2026-W41` (Monday to Sunday, numbered as ISO 8601 numbers weeks), `FY2026`, and `evt:<record>` for an event. Days are days in India. `period-keys.ts` holds the calendar, and it is the only one: `periodOfDay`, `periodOfKey`, `periodShift`, and `periodsNumbered(project)` for the year a project numbers its quarters in. A cash month, a RERA quarter and a photograph round all ask it, so a week, a month and a quarter mean one thing.
- **The first period.** A set nobody has kept shows one quiet line, "No period kept yet · Start with October 2026" (`SetPeriods.first`), and asks for nothing: no line under Needs you, no notice, however long it is left. Starting it is one press, on the period today falls in or the one before: `openPeriod` for a set of records, `startSheetPeriod` for a sheet. That first start is what begins the due cycle, and nothing is expected of any period before it. A set started on October can still keep September: "Also keep September" (`SetPeriods.alsoKeep`) opens the period before the earliest kept, beside the rest, to be filled and issued in its turn; on a sheet it is an open period kept beside the sheet, which stays on the period it is on. On a set that keeps several instances a period, the first period opens a row for each kind the set declares (each certificate) or for each building the project keeps, never one blank row that says no kind.
- **What a period opens with.** `carry` lists the fields whose value normally holds from one period to the next: a bank, a facility, a rate, a party, a limit, a name, a classification, and a total to date, which only grows (every `cumulative` key is carried; `test/tracking-gaps.test.ts` holds the catalog to it). They open filled and say "Carried from September" until somebody writes them. Every other field a person fills is read afresh each period (a balance as at a day, a month's collections, a week's count): it opens blank, with what it read last period beside it as "last: ₹4.1 Cr" (`FieldView.last`), so a person sees what to compare. A worked-out field never goes blank because an input was cleared: it says "Waiting for Opening balance" (`FieldView.waitingFor`, the fields of its own holder it reads that hold nothing).
- **Opening.** `openPeriod` makes the period today falls in, or one named: a record for each instance the last period kept, with the `per` fields and the `carry` keys already filled and marked "Carried from September" until somebody writes them. Asked twice it makes nothing twice. Nothing carried is asked again.
- **Comparing.** `comparePeriods` (a record) and `compareSheetPeriods` (a sheet) give each figure as it was and as it is, by its key, in one templated line: "Was ₹4.1 Cr in September; now ₹4.32 Cr", or for a `cumulative` key "+₹15 Cr in FY 2026-27: ₹10 Cr to ₹25 Cr". Where `attribute` names dated rows for a figure, their sum inside the period is set against the movement (or against the period's own amount, with `of: 'amount'`), and what is left is "Unexplained". A person settles it with a pick from `reasons`; no sentence is kept.
- **Due, late, not kept.** A period is due `days` after it ends, or by what the rule row says. A set is expected only once somebody has kept a first instance of it, or started its sheet on a period. The latest period that has ended and is not issued is the set's one `due` line; past its day it is said to be late. A period that went by with nothing kept is said to be not kept ("2 periods not kept: September, July") and is filled in by nobody but a person: opened late, its record is dated the day it was made.
- **Issuing.** `issuePeriod` (a record) and `issueSheetPeriod` (a sheet) issue a period under a person's name: a lead or signer of the function's department for `lead`, its signer alone for `signer`, and for an outside party's role a lead or signer who gives the name it was signed under. Refused while a value waits or is in dispute. Issuing writes down every field in play, the worked-out ones among them, as it read and as it printed, with its footnote (`frozen`): an issued period is never worked out again. A sheet then goes on as the next period's, keeping what it carries and opening the rest blank, with what it held in each field's history.
- **A late issue reads the period's last day.** A period that has ended is frozen as at its last day, whenever it is issued: September issued on 13 October carries nothing recorded in October. What the sheet or the record itself holds is the period's own entries and is taken as typed, whenever it was typed; everything it reads from the rest of the project (other sheets and records, the milestones, the site log, the Cost Reports) is read through `projectAsAt` as the project stood when that day ended. A figure the record's history does not reach, or one of a module that keeps no past, is frozen as it reads on the day of issue and marked (`FrozenField.asNow`); the issued sheet says which, in one line: "2 figures as now, no history before 13 Oct 2026: Drawn to date, Principal outstanding" (`frozenAsNowSaid`). What a period holds of the rest of the project is decided by the day each entry describes, never by when it was typed (`projectAsOfPeriod`): a drawdown disbursed on 28 September and entered on 3 October is in September as issued, and one dated 5 October and entered early is not. The day a record describes is its only date field, or the one its set names (`records.dated`: a drawdown's `disbursed_on`); a table's rows go by its only date column. An entry with no date of its own falls back to when it was recorded. Whoever issues the period is shown what was entered after it ended and is dated in it (`enteredAfterPeriod`), in the one confirmation that issuing asks for. "Moved" in a comparison is said only of a field with a value in both periods: a field merely blank in a period just opened has not moved.
- **Being told.** Whoever issues a set, and whoever opened the period that is due, is told once for the period, as a notice (`gatherPeriodsDue` in `tell-periods.ts`, written by the daily job). No report day has to be set. Only the firm's own people are told.
- **An issued period is never edited.** Every write to it is refused. A correction is a revision kept beside it (`revisePeriod`, `reviseSheetPeriod`): a copy of what it held, worked on like any open period (a sheet's with `period` named on the write), and issued in its turn. Until then the issue stands and is what every figure reads; after, the revision does, and the first is kept as it was sent.
- **Opening a past period.** The one line under a set's title, "September issued by A. Rao · 11 earlier", opens the list of its periods, newest first, each with its status (issued, issued late, replaced by a revision, a revision not issued) and who issued it. One picked is read only under a band that names the period and who issued it, with "Compare with the one before" one press away (`comparePeriods`, `compareSheetPeriods` with the period's key).
- **Reading a set's periods in code.** `periodsOf(project, setId)` gives every instance, latest first (`PeriodInstance`: its period, status, who issued it, whether a revision replaced it, when it is due, how full it is). `currentPeriod(project, setId)` and `lastPeriod(project, setId)` give the period today falls in and the one before, each as `{ span, instances }`. `periodSeries(project, { set, field })` gives one figure period by period, and reads a figure that keeps its own months (progress by the milestones, the plan by their dates) the same way; the view across projects reads the schedule and the units sold through it (`ACROSS_SCHEDULE_SERIES`, `ACROSS_SOLD_SERIES`).
- **The Cost Report** stays its own module. `periodsOf(project, 'finance.budget.cost_report')` reads its months as instances, so the due list and a chart see it as they see any set kept by period. Its reopen is a revision too: a draft beside the issued report, which is `superseded` once the draft is issued.

Which sets are kept by period is listed in [departments.md](departments.md).

## As at a day

`projectAsAt(project, day)` (`as-at.ts`) is the project as it stood when a day ended in India: a reading, never saved. Fields are what stood then (`fieldAsAt`); a record is there where it had been made by then and not yet taken off its list; a milestone is at the percent last reported by then; the site log and the Cost Reports are those of the days up to it. `resolveFields(view, asAtMoment(day))` then gives every formula, standing and figure as at that day with no change to a formula.

- **An issued period wins.** Where a period issued for a sheet covers the day, the sheet reads as that period was frozen, whatever would be worked out afresh.
- **What keeps no past says so.** A value the record's history does not reach, and a figure of a module that keeps none (the cost register, the tenders), is today's and carries `asNow`; so does whatever is worked out from it. A report prints it "as now" with the footnote "As now: no history before 14 Oct 2026."
- **Reports.** A field section with `asAt` on its source reads the project as at that day and says "Figures as at 30 Sep 2026." A function's report made for a period (`generateReport` with `period`) sets it to the period's last day; the owner pack for a period that has ended reads progress, the schedule and the functions' fields as at its last day. A report for September is not moved by what is recorded in October.
- **On screen.** Live carries no mark. The sheets read as at a past day carry a band with the date that stays in view, and every control is off; so does an issued period opened from its sheet. The control that picks the day sits beside the line that opens a set's past (at the head of the sheets where no set there is kept by period), and the day picked holds while a person moves between the function's parts.
- **Photographs.** A station's standing, the round, a milestone's checklist and a station's series are read as at a day too: a shot taken after it is not counted (`stationRound(project, asAtMoment(day))`, `photoSeries(…, asAt)`).

## Trends

A field says how it is drawn over time with `trend`, and it is drawn inside the popover its label opens.

```ts
trend?: { over: 'history' | 'periods'; mark: 'line' | 'bar'; against?: string; last?: number }
```

Four forms and no more: a line over periods, bars by period, either with a second field of the same holder drawn against it (`against`: planned against actual), and the stacked bar a table already draws. `over: 'periods'` reads the periods of a set kept by period (its issues, then the sheet as it reads now), or the month-by-month readings of a figure that keeps them (progress by the milestones, the plan by their dates). `over: 'history'` reads the values a typed field has held. `fieldTrend(project, address)` in `field-charts.ts` shapes the points, beside `fieldChart`. A threshold is an ordinary `status` over a `moved` field: "Little progress since the last month" is a case that fires when the figure moved less than one point. A report draws a field period by period with `chart: { of: { periods: setId }, y: field, moved? }`.

**Progress.** A milestone keeps what was reported of it day by day for a hundred and twenty days, and past that its first report and each month's last (`thinReadings`): nothing is dropped outright. Planned against actual, month by month, is `progressCurve`, and is the trend the programme sheet declares. RERA's quarterly progress is a set of records, one a quarter and one for each building where the milestones say which building they are of (`legal.rera.progress_quarters`): every figure is read as at the quarter's end, and Law types none.

## Limits the catalog test holds you to

- At most **twelve core fields** on a sheet. Past that: give a field a `showWhen`, fold it as `expert`, or make what repeats a set of records.
- At most **twenty fields** on a record. A set that adds to a shared record is held to twenty of its own; the record as merged is not, because each function's page draws only its own additions.
- At most **twenty fields in four sections** on a depth sheet.
- A table of more than **six columns**, or whose rows carry a status, a date that runs out or a paper, is a set of records.
- A `situational` field has a `showWhen`, its own or its section's.
- No statutory figure in a key or a label, a table's columns included.
- No option called "not applicable" or "unknown", however it is abbreviated and whichever set declares the list.
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

A section is one of `fields` (with `layout`), `table`, `records` (with `columns`), `chart`, `note`, `photos` (photographs by place and period: see Photographs) or `register` (a reading of the project's registers). A chart may draw a field of a set kept by period, period by period (`of: { periods }`). A report made for a period reads its field sections as at the period's last day: see As at a day. `reportTemplateFaults()` names anything a template points at that is not there, and `test/report-fields.test.ts` holds every declared template to it, and to being fields, tables, charts and at most one capped note. Every department declares at least one; they are listed in [departments.md](departments.md). A function whose fields are on checks in Legal, Finance or Engineering also gets a generated `<fn>.checks` template.

## Photographs: a place, a station and a period

A photograph is kept where photographs are kept: on the phone's site log, or as a file on the document register. Both carry the same three optional members, and `photo-stations.ts` reads the two stores as one list of shots (`projectShots`).

```ts
interface PhotoPlace { building?: string; floor?: string; unit?: string; milestone?: string; element?: PhotoElement }
// SiteLogPhoto and CaptureFacts:  place?: PhotoPlace;  stationId?: string;  placed?: { how: 'picked' | 'near' | 'person'; by; at; metres? }
```

- **A place** is links, never a sentence: a building and a unit of the shared records, a milestone of the schedule, an element off the list a model picks from (`PHOTO_ELEMENTS`), and a floor as a word or two. The free-text `zone` a person wrote before this still reads. A person sets a place (`setShotPlace`, `PUT /photos/place`). A model writes none of it: the element it picked in a photograph is offered beside the place and is the place's only once a person accepts it, and words a model wrote about a photograph before photographs were read as picks are shown as "Written by a model, before this change".
- **A station** is a place shot again and again from the same spot: a record of `construction.site.stations`, the Site record's own sheet, with its label, building, floor, element, milestone, how often it is to be shot (week, month, quarter) and its `shots`, an evidence field with `viewer: 'series'`. Its shots are not held on its sheet: they are the photographs of either store that name it, with any register row a person files on the station itself.
- **Its standing is worked out each time it is read**, from the days its shots were taken by the day it is in India: shot this period; due, where its last shot is in the period before; overdue, where a whole period has gone by; never shot. The station's sheet reads it as figures (`photos.station_shots`, `photos.station_last_shot`, `photos.station_behind`), in no tone that raises a line of its own.
- **A shot reaches a station by code** (`matchStation`, `placeEntryShots`): the station picked on the phone, else the one station whose point the photograph's own position is within `STATION_MATCH_M` (30 m) of, else it waits as "place not set" for a person. Two stations both within the distance are a question for a person, since position cannot tell the same corner on two floors apart. A station's point is the one recorded on it, else where it was first shot from by somebody who picked it.
- **What is due is one line, of kind `due`.** The stations not photographed this period are one line under the Site record's Needs you, as any set kept by period has one (`stationRoundDue`): "October: 3 of 5 stations photographed, due 31 Oct 2026" where the stations it waits on share an interval, "2 of 5 stations to photograph: 1 by the week, due 18 Oct 2026; 1 by the month, due 31 Oct 2026" where they do not, each interval with the day its round is due. It is under Due soon until a station has gone a whole period without a shot, and under Failing after. It is no rule's line as well: the round's sheet (`construction.site.round`) counts them, and says so in a tone that raises nothing. Open goes to the round, where the stations are listed.
- **A milestone that names required photographs is not marked complete without them.** A station marked as needed by its milestone is on that milestone's checklist (`milestonePhotoChecklist`). A person who marks the milestone a hundred per cent while such a station holds no shot of the period is refused, with the stations named (`markMilestonePercent` in `milestone-photos.ts`; the route answers 409). The one way past is a waiver: somebody who may accept in Construction picks why from a short list (`MILESTONE_PHOTO_WAIVERS`: no access, the work was covered, the station is gone, not safe, photographed under another record), and the pick is kept on the milestone with who made it. No sentence is kept. What is reported from the phone and what a schedule brings in is recorded as reported, since a report from site is not a person's decision that the milestone is complete; a milestone complete that way, or completed before photographs were required of it, reads "complete, photographs wanting" on its own line (`milestonePhotoStanding`) and is a line under Failing on the Site record until the photographs are taken or the reason is picked.
- **The series viewer** (`PhotoSeries.tsx`) groups the shots by period (`photoSeries`), newest first, and puts two periods side by side (`seriesPair`): this one and the last, or any two picked. Under each photograph is its date and who took it, and nothing else. On a phone the two stack. Every field that holds photographs (`photo()`: snags, non-conformances, pours, the lender's engineer's report) takes a place for each, and is drawn through the same viewer once its photographs span more than one month.
- **A station's period is the calendar's own.** Each station says how often it is shot, and the period it is in is `periodOfDay(station.every, indiaToday(now), periodsNumbered(project))`, the one before it `periodShift(…, -1)` (`period-keys.ts`): the week, month and quarter a set kept by period is in, numbered in the Indian financial year or the calendar year as the project says. The standing, the series, the round's line and the report section all ask there.

**In a report.** A section that names `photos` prints the shots of stations for a period:

```ts
{ heading: 'Site photographs, this month beside the last', photos: { show: 'period_and_last', most: 12 } }
// photos: { stations?: string[]; place?: PhotoPlace; show: 'period' | 'period_and_last'; most: number; every?: 'week' | 'month' | 'quarter' }
```

It becomes a block that reads `station_photographs`, resolved by code (`resolveStationPhotos`): the stations named, else those at the place, else every one; each gives its newest shot of the period the report is of (the period its `asAt` day is in, else its `to`, else the period today is in), and a station with none is printed as not photographed. A function's report made for a period carries that period's last day on the section, so a report for September prints September's shot beside August's whatever has been shot since. Each row is a station, its place, the period, the day taken and who took it. Construction's monthly progress report carries the section, the owner pack places it under Time where the project keeps stations (`ownerPackPhotos`), and any report takes it from the list of what a section reads. The older section of photographs a person ticked (`site_photographs`) reads as before. The Word file prints both kinds of photograph a section cites, the ones on the document register and the ones still in the site log (`reportTablePhotos` in `apps/web/src/lib/report-photos.ts`).

**On a collaborator's copy.** The Site record's sheets go with the scope its checks sit in and the Site record area. A station is on the copy only where the copy holds the building and the milestone it names. A photograph the grant holds by its own scope keeps the parts of its place the copy holds, and its station only where the station is on the copy. The site log's own photographs are the firm's, as the site log is.

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
| `checklist.ts`, `papers-owed.ts` | A list's lines and what loading one again does; the one list of papers owed, its standings and its count |
| `list-import.ts`, `list-assumptions.ts` | A tracked list read as it is sent, and the desk each package goes to; a line to be assumed and the fields it stands in for |
| `tender-form.ts` | The tender form's rows as fields: reading a client's form into Tender terms, and writing the form back out |
| `report-fields.ts` | A report's field sections: resolving, templates, freezing, and what a grant's copy keeps |
| `sweep-rules.ts`, `law-change.ts`, `chat-answer.ts` | The daily review's rules, a law change as fields with its lists and offered rule rows, and the chat's card |
| `field-history.ts` | What a field held before: the one writer, the bound, a field as at a day and how far it moved |
| `period-keys.ts`, `field-periods.ts`, `sheet-periods.ts` | The calendar's periods, for every set and every station; a set of records kept by period (open, compare, issue, revise, due); a sheet kept by period (start, issue, revise), and the Cost Report read as periods |
| `as-at.ts` | The project as it stood when a past day ended |
| `field-charts.ts` | A table's rows shaped for its chart, and a field's trend over time |
| `photo-stations.ts`, `photo-report.ts`, `photo-figures.ts` | Photographs tied to a place and a period: stations, their standing, matching a shot to one, the round's due line, the series, the report section, and the figures the Site record's sheets read |
| `milestone-photos.ts` | A milestone is not marked complete without the photographs it needs, unless a lead or signer picks why |
| `tell-periods.ts` | Who is told a period is due, and the notice written for each of them once |
| `rule-tables.ts`, `units.ts` | Dated figures a law sets; units and money |

The screen is `apps/web/src/components/fields/FieldSheets.tsx` (Needs you, the sheets folded to a line each, records and depth sheets, the band a past day or an issued period is read under, and the units' stack plan from `StackPlan.tsx`) over `CheckFields.tsx`, which draws every kind of field and the popover a label opens. `Periods.tsx` draws a set kept by period (its open period, the one line that opens the past, the comparison, issue and revise), and `TrendChart.tsx` a field over time. Construction's Technical page draws its sheets too, though it is not laid out in parts.
