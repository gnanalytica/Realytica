# Departments and their fields

What each function keeps as typed fields, as the catalog declares it. This page is a listing; [fields.md](fields.md) says how a field set is declared, and [product.md](product.md#what-is-built-and-what-is-not) says what is built.

**In all:** 49 functions, 47 of them with field sheets. 286 field sets: 116 sheets, 148 sets of records (the nine shared records among them) and 22 that add a department's own facts to a shared record. 3,415 fields: 2,231 core, 939 situational, 245 expert. 73 situations. 529 rules and 179 standings. 189 rows of the rule table under 108 keys, **0 of them verified**, and 10 limits with no figure yet. 19 reports declared by the departments, and 9 more made from the fields on checks. 78 figures read from other modules (eight that the catalog now works out by formula are gone). The checks keep a further 186 fields on 48 check definitions, in the same catalog.

How to read the tables:

- **Sheets and records.** A sheet is held once. A set marked "(records)" repeats: one small sheet for each owner, approval, variation or unit. "Adds to" means the function keeps its own facts on a shared record.
- **Fields: core, situational, expert.** Core fields are always asked. Most core fields sit on records, which have no limit of twelve; no sheet opens on more than twelve. Situational fields show when their situation or condition holds. Expert fields stay folded.
- **Situations** are the ones the function's fields wait on, its own and the project's.
- **Reports** are the ones its file declares, put together from fields.

Two functions keep no field sheets: the Site record and Property management.

## Sets kept by period

A set kept by period is opened from the last, compared with it, due on a day and issued under a name ([fields.md](fields.md#periods)). Twenty-seven are.

| Kept | Records, one a period | Sheets, issued a period at a time |
|---|---|---|
| By the week | Forecast by week (`finance.funding.forecast_weeks`) | Inventory (`commercial.inventory.stock`); Bookings and agreements (`commercial.inventory.bookings`); Enquiries and site visits (`commercial.inventory.enquiries`) |
| By the month | Cash by month (`finance.funding.cash_months`); GST by month (`finance.tax.gst_months`); Tax deducted by month (`finance.tax.tds_months`) | Month at a glance (`construction.progress.month`); Safety statistics (`construction.safety.statistics`); Cash position (`finance.funding.cash`); Receivables (`finance.funding.receivables`); Loan position (`finance.lenders.position`); Contracts and claims (`procurement.orders.position`); Collections (`commercial.buyers.collections`); Dues by age (`commercial.buyers.dues`); Marketing spend (`commercial.marketing.spend`); RFI log (`design.rfis.log`) |
| By the quarter | Quarterly statements of tax deducted (`finance.tax.tds_statements`); RERA certificates (`finance.funding.rera_certificates`, one of each kind); Filings (`legal.rera.filings`, one of each kind); Quarterly progress (`legal.rera.progress_quarters`, one for each building); Architect's certificates (`design.certificates.architect`, one for each building); Engineer's certificates (`design.structural_set.engineer_certificates`, one for each building) | |
| By the year | Annual statement of accounts (`finance.funding.rera_years`); Property tax by year (`finance.tax.property_tax_years`, one for each property) | |
| For each drawdown | Lender's engineer's reports (`finance.lenders.engineer_reports`); Cost incurred, as stated (`finance.lenders.cost_incurred_stated`, one for each person who states it) | |

The monthly Cost Report is not a field set. It is read as periods all the same (`finance.budget.cost_report`), so what is due and a chart over periods see it.

## Finance & Investment

| Function | Sheets and records | Fields: core, situational, expert | Situations | Reports |
|---|---|---|---|---|
| Valuation (`finance.valuation`) | Instruction; adds to Parties; Land and its value; adds to Parcels; Inputs by approach; adds to Buildings; Leases (records); Value conclusion; Valuations on file (records); Valuation register | 69, 74, 21 | For lending; For insolvency; Less than the freehold; Leasehold land; Under construction; Comparable approach; Cost approach; Income approach; Residual approach; Value rests on an assumption; Lender funded | Valuation summary |
| Feasibility & underwriting (`finance.feasibility`) | Areas the appraisal rests on; Revenue; Costs; Approval fees and charges (records); Cash flow by month (records); Cash flow and returns; Sensitivity; Residual land value and decision; Conditions of the decision (records) | 93, 30, 20 | Premium FAR or TDR; Joint development; Agricultural land to be converted; Lender funded | Development appraisal |
| Budget & cost to complete (`finance.budget`) | Approved budget; Estimated project cost, as stated (records); Contingency and escalation; Transfers between packages (records); Commitments; Monthly cost report; Cost to complete; Cost to complete, as stated (records) | 68, 26, 13 | Forecast over the budget; Lender funded | Cost to complete report |
| Funding & escrow (`finance.funding`) | Funding plan; Sources of funds (records); adds to Accounts; Cash position; Cash by month (records); Forecast by week (records); RERA project cost; Withdrawal from the designated account; Deposit into the designated account; RERA certificates (records); Annual statement of accounts (records); Receivables | 57, 78, 5 | Lender funded; Cash falls short within the forecast; RERA designated account kept; Units are being sold | Funding and cash report; Designated account, the quarter |
| Tax (`finance.tax`) | adds to Parties; GST on units sold; adds to Units; GST by month (records); Registered-supplier test by year (records); Tax deducted at source; Tax deducted by month (records); Quarterly statements of tax deducted (records); Tax deducted on property bought (records); Tax deducted by buyers (records); Stamp duty and registration; Duty by instrument (records); Khata and assessed property (records); Property tax by year (records); Joint development: the facts; Joint development: tax at completion; Money paid to the landowner (records); Construction workers’ welfare cess | 126, 60, 5 | Began under the scheme with input credit; Joint development | Tax position |
| Lenders (`finance.lenders`) | Facilities (records); Security (records); Security cover; Guarantees (records); Release letters by unit (records); Conditions of sanction (records); Covenants (records); Papers the lender is owed (records); Letters from the lender (records); Conditions and covenants; Completion date and cost overrun; Drawdowns (records); Cost incurred, as stated (records); Drawn against eligible; Drawdown tests; Lender’s engineer’s reports (records); Lender’s engineer’s observations (records); Escrow and reserve; Repayment schedule (records); Loan position | 131, 77, 4 | Lender funded; RERA designated account kept; Recall or demand notice received | Lender’s pack |
| Ledgers (`finance.ledgers`) | adds to Parties; Contractor accounts (records); Payables; Customer ledgers (records); Collections; Reconciliation with the books; Reconciliation lines (records); Ledger mapping (records); Provisions and contingent liabilities | 50, 37, 2 | A supplier is a micro or small enterprise; Joint development | None declared |

## Legal & Compliance

| Function | Sheets and records | Fields: core, situational, expert | Situations | Reports |
|---|---|---|---|---|
| Title & land records (`legal.title`) | Land holding; Owners (records); adds to Parcels; Land records; Land record, parcel by parcel (records); Ownership and who signs; adds to Owners; Chain of title; Instruments in the chain (records); Encumbrance and charge search; Encumbrance certificates (records); Entries on the certificates (records); Charges on the land (records); Land character and restrictions; Restrictions, parcel by parcel (records); Title opinion; Requisitions and conditions before closing (records) | 120, 112, 9 | Agricultural land; More than one owner; An owner has died; A minor holds a share; An owner is a company or a trust; A deed was signed by an attorney; A partition was not registered; A charge is on the land; Granted land; Tenancy or inam in the history; Acquisition or reservation notified; Litigation pending | Land holding report; Title report |
| Approvals & NOCs (`legal.approvals`) | adds to Approvals; Approvals register; Stop-work orders (records); Land conversion and use; Plan sanction; adds to Buildings; Plan revisions (records); Deviations from the sanctioned plan (records); Commencement and occupancy; Height and fire clearances; Environment and pollution control; Water and power; Lifts (records) | 117, 70, 9 | A stop-work order is in force; Agricultural land to be converted; Plan sanction running out; Revised sanction; Built away from the sanctioned plan; An environment clearance is needed | Approvals status report |
| RERA (`legal.rera`) | RERA registration; Phases (records); RERA compliance; Quarterly progress (records); Filings (records) | 36, 20, 20 | Registered with RERA; Registration running out; Registered in phases; Joint development; RERA designated account kept | RERA compliance report |
| Contracts (`legal.contracts`) | Land agreements; Land purchases (records); Conditions and obligations (records); Joint development: terms; Joint development: dates and shares; adds to Units; Powers of attorney (records); Agreement for sale | 49, 56, 5 | Joint development; Leasehold land; Land held on an agreement to sell; The agreement departs from the notified form | None declared |
| Handover & society (`legal.handover`) | Conveyance and handover | 12, 1, 1 | None | None declared |
| Litigation & notices (`legal.litigation`) | adds to Matters; Matters and what is at stake; Hearings and orders; Orders (records); What each order covers (records); Court and registry searches; Search log (records); Search hits (records); Notices and claims (records) | 59, 51, 8 | Litigation pending; A partition suit; An earlier agreement holder is suing; An insolvency is admitted or sought; An order is in force; An owner is a company or a trust | Litigation report |

## Design & Architecture

| Function | Sheets and records | Fields: core, situational, expert | Situations | Reports |
|---|---|---|---|---|
| Drawings & versions (`design.drawings`) | adds to Drawings; Register; Revisions (records); Transmittals (records) | 28, 0, 2 | None | Design status report |
| Design compliance (`design.compliance`) | Plot, zone and FAR; Ground coverage; Height and setbacks; Setbacks (records); Parking; Parking required (records); Deviations sought (records) | 47, 4, 6 | Premium FAR or TDR; High-rise | None declared |
| RFIs (`design.rfis`) | RFI log; Requests for information (records) | 19, 2, 0 | None | None declared |
| Coordination (`design.coordination`) | Coordination | 8, 0, 1 | None | None declared |
| Brief & unit mix (`design.brief`) | Design brief; Unit types (records); Consultants appointed (records); adds to Buildings | 38, 5, 3 | Mixed use; Architect changed | None declared |
| Area statement (`design.areas`) | adds to Units; Area statement; Floors (records); Parking provided (records) | 26, 3, 3 | Revised sanction | Area statement and code compliance |
| Sanctioned set (`design.sanction`) | Design against the sanction; Construction drawings against sanctioned sheets (records) | 14, 7, 0 | Revised sanction | None declared |
| Architect’s certificates (`design.certificates`) | Architect’s certificates (records) | 10, 2, 0 | Registered with RERA | None declared |
| Finishes schedule (`design.finishes`) | Finishes schedule; Finishes (records); Approved makes (records); Doors and windows (records); Waterproofing (records) | 31, 1, 2 | None | None declared |
| Landscape & external works (`design.landscape`) | Landscape; External works (records) | 13, 5, 1 | Trees to be cut; Landscape on a podium slab | None declared |
| Samples & mock-ups (`design.samples`) | Approvals; Material and sample submittals (records); Mock-ups (records) | 32, 1, 1 | None | None declared |
| Design changes (`design.changes`) | Changes; Design changes (records) | 23, 10, 1 | None | None declared |
| Soil investigation (`design.soil`) | Soil investigation; Boreholes (records); Bearing capacity recommended (records) | 22, 9, 3 | Basement; Difficult ground | None declared |
| Structural design basis (`design.structure`) | Design basis; Loads and materials; Foundation | 27, 4, 4 | Higher seismic zone | None declared |
| Peer review & stability (`design.proof`) | Independent review; Review comments (records); Stability certificates (records) | 23, 0, 1 | None | None declared |
| Structural set & certificates (`design.structural_set`) | Structural set; Bar bending schedules (records); Engineer’s site instructions (records); Engineer’s certificates (records) | 25, 2, 0 | None | None declared |
| Electrical load (`design.electrical`) | Electrical demand; Capacity and headroom; Common area loads (records); Transformers and generators (records) | 31, 5, 3 | High-rise; Own sub-station | None declared |
| Cooling & ventilation (`design.hvac`) | Cooling and ventilation; Conditioned spaces (records); Basement ventilation (records) | 16, 2, 2 | High-rise | None declared |
| Water (`design.water`) | Water demand; Sources and storage; Water sources (records); Storage tanks (records) | 28, 3, 3 | No piped water | None declared |
| Sewage treatment (`design.sewage`) | Whether a treatment plant is needed; Treatment plant; Treated water tests (records) | 21, 3, 3 | None | None declared |
| Fire fighting (`design.fire`) | Fire water and pumps; Escape and life safety; Fire installations (records) | 25, 5, 0 | High-rise | None declared |
| Lifts (`design.lifts`) | Lift provision; Lifts (records) | 17, 1, 5 | High-rise | None declared |

## Engineering & Construction

| Function | Sheets and records | Fields: core, situational, expert | Situations | Reports |
|---|---|---|---|---|
| Progress & schedule (`construction.progress`) | Programme; Delay events (records); Site log; Month at a glance; Decisions awaited (records) | 50, 20, 11 | A delay event is recorded; Projected to finish late; Registered with RERA; A stop-work order is in force; Litigation pending | Monthly progress report |
| Technical due diligence (`construction.quality`) | Quality standing; Mix designs (records); Pours (records); Cube samples (records); Groups of four samples (records); Reinforcement lots (records); Material and system tests (records); Inspection requests (records); Non-conformances (records); Handover; adds to Units; Snags (records); Systems commissioned (records); Warranties (records) | 171, 8, 16 | A critical non-conformance is open; Units are handed over | None declared |
| Site record (`construction.site`) | No sheet yet | | | |
| Safety & environment (`construction.safety`) | Safety statistics; Site establishment; Incidents (records); Permits to work (records); Training and talks (records); Lifting and plant certificates (records); Contractors’ labour licences (records) | 55, 15, 5 | A reportable accident is recorded; Workforce at the figure that asks for a safety officer; Work under permit; More than one contractor on site | None declared |

## Procurement & Supply Chain

| Function | Sheets and records | Fields: core, situational, expert | Situations | Reports |
|---|---|---|---|---|
| BOQ & tenders (`procurement.boq`) | Procurement plan; Package plans (records); Bid evaluations (records); Earnest money (records); Addenda (records) | 46, 3, 5 | None | Procurement plan report |
| Purchase orders & commitments (`procurement.orders`) | Contracts and claims; adds to Contracts; Contract terms and position (records); Variations (records); Time claims (records) | 69, 24, 4 | A contract is being terminated | Contracts and claims report |
| Vendors (`procurement.vendors`) | Securities and cover; adds to Parties; Securities (records); Insurance policies (records); Evaluations after a contract (records) | 49, 13, 8 | A security is held | None declared |
| Deliveries & materials (`procurement.deliveries`) | Deliveries; Material received (records); Orders on long lead (records) | 23, 2, 1 | An order is on long lead | None declared |

## Commercial & Operations

| Function | Sheets and records | Fields: core, situational, expert | Situations | Reports |
|---|---|---|---|---|
| Market & pricing (`commercial.market`) | Price list; Market watch; Competing projects (records) | 35, 1, 7 | None | None declared |
| Marketing & launch (`commercial.marketing`) | Launch; Marketing spend; Campaigns (records); Advertising compliance; Advertisements (records) | 49, 16, 4 | Advertisements on the register | Marketing and advertising report |
| Sales & leasing inventory (`commercial.inventory`) | Inventory; Bookings and agreements; adds to Units; adds to Units; Buyers (records); Enquiries and site visits; Channel partners (records); Brokerage; Brokerage invoices (records) | 53, 42, 13 | Litigation pending; Leads are called or messaged; Channel partners engaged; Joint development; Lender funded | Sales and collections report |
| Buyers & collections (`commercial.buyers`) | Collections; Dues by age; Demands (records); Payment plans (records); Cancellations and refunds (records) | 55, 16, 2 | A demand is overdue | None declared |
| Handover & defects (`commercial.handover`) | Handover; adds to Units; Service requests (records) | 19, 13, 3 | Occupancy certificate issued | None declared |
| Property management (`commercial.operations`) | No sheet yet | | | |

## Shared records

One record each, linked to by every department. A department adds its own facts to one with `extends`; its page draws the record with those.

| Record | Its own fields | Added by |
|---|---|---|
| Parties (`shared.parties`) | 4 | Valuation (3); Tax (3); Ledgers (2); Vendors (12) |
| Parcels (`shared.parcels`) | 7 | Title & land records (7); Valuation (2) |
| Units (`shared.units`) | 5 | Contracts (1); Tax (7); Area statement (5); Technical due diligence (10); Sales & leasing inventory (16); Sales & leasing inventory (17); Handover & defects (11) |
| Drawings (`shared.drawings`) | 6 | Drawings & versions (5) |
| Approvals (`shared.approvals`) | 8 | Approvals & NOCs (12) |
| Matters (`shared.matters`) | 5 | Litigation & notices (15) |
| Buildings (`shared.buildings`) | 3 | Approvals & NOCs (4); Valuation (8); Brief & unit mix (5) |
| Contracts (`shared.contracts`) | 5 | Purchase orders & commitments (14) |
| Accounts (`shared.accounts`) | 3 | Funding & escrow (9) |
