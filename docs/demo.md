# The demo

One real project, filed from its own documents: a large residential development in Bengaluru, at construction, with its legal opinion, title bundle, encumbrance certificates, sanctioned plans, environmental clearance, RERA registration, the airport height clearance and the utility NOCs. Nothing on it is invented — every figure on screen was read off one of those documents, and every gap is a gap in them.

The documents are the client's. They are never committed to this repository; they are loaded into a running deployment through the same upload path a person uses.

## Loading it

```bash
# into a local API (sign-in off)
node scripts/load-documents.mjs --folder <folder> --create "<project name>" --city Bengaluru --location "<locality>" --stage construction

# into a deployment, as yourself
REALYTICA_TOKEN=<your session token> node scripts/load-documents.mjs --api https://<deployment>/api --folder <folder> --project <projectId> --read
```

Each file goes up in 4 MB parts (a merged title bundle is 66 MB), is assembled in storage, read locally — text layer, then OCR for scans — typed, and given to the workstream it belongs to. `--read` then asks the chat to read what the local reader could not make out; with a model configured, a long scan is sent as its first and last pages, which is where a title bundle's schedule and an opinion's conclusion sit.

From the web app the same happens by dropping the folder on **Documents**, or into the chat. On the demo project the large merged bundles were filed as labelled parts (`Title Documents merged - part 3 of 10 (pp. 211-319).pdf`); each part is read, typed and filed on its own, and the page range in its name says where it sits in the original.

### Reading what the local reader could not

Say **Read the filed documents** in the chat. Each turn takes up to ten documents nobody has read, sends them straight to the model (no second OCR pass), and stops starting new ones after eight minutes; it ends by saying how many are left, and saying it again carries on. **Read the filed documents again** reads everything from the start.

What a model's reading adds depends on the route it goes through:

- **Claude, directly** (`REALYTICA_BASE_URL` unset, an Anthropic key): every value comes back with the page it was found on, verified by the API's citations. The values wait on the document for a person to accept, and the title chain, approvals and valuation read them once accepted.
- **A gateway** (OpenRouter with another vendor's model): the model says what each document is and describes it, and the document is filed under that type and workstream, but no citation comes back, so no value is placed on a page and none is kept. The description shows on the document as *the model's reading*.

The Kannada encumbrance certificates are the case that needs the first: their text layer is unreadable and they carry no images to OCR.

## The walk-through

1. **Portfolio.** The project sits under *Construction*. Its alerts are counted on the card.
2. **The timeline** at the top: Construction, at its Construction step. Open *Pre-development* to see what was filed and decided while the project was there.
3. **Overview.** Each department's workstreams with their quick assessments: Legal's title and approvals, Construction's progress and site, Finance's valuation — each with what it rests on.
4. **Legal › Approvals.** The register, read from the documents: the AAI height clearance with its permissible top elevation, the BESCOM, BSNL and BWSSB NOCs, the environmental clearance and its validity, the RERA registration with its number and term. Construction's gate says whether the plan sanction and commencement certificate are in hand.
5. **Legal › Title.** The encumbrance certificates and title documents, and the legal opinion. **File a certified report** from the opinion: its date, advocate and conclusion are read off it for you to confirm. It becomes the figure of record; the quick assessment keeps running beside it. The title chain — owners, the instruments between them, the charges — is drawn once **Value this property** has checked the deeds and ECs against the Karnataka title rules (step 8).
6. **Connections** on any workstream: what it depends on, and — walked in Neo4j — what a change to it reaches: an approval lapsing gates progress, which feeds the valuation and the cost to complete, and names the engagements and people standing on each.
7. **Construction › Progress.** Use the usual milestones, then **Pair a phone** from People. On the phone, in the Realytica Site app, scan the code, log today's entry with a photograph — offline if you like — and watch it arrive: progress moves, and if the commencement certificate is not on file, an alert says work is being logged before it is allowed.
8. **Finance › Valuation.** **Value this property** fills what the file holds — on this pack, the plot area off the sale deed, and the 2006 sale price, which it shows but will not use as a rate twenty years on — and checks the Karnataka title rules: K-RERA registered, the occupancy certificate not yet due, the EC period as read, and what is not established. The rate and the land rate wait for a valuer, a comparable you add, or the portal search (which needs a scraping service account on the API).
9. **People.** Roles by department: make an outside advocate the signer for Legal, and see what they can and cannot reach.
10. **Graph.** Opens on the project, its departments and their workstreams; open any node to walk out to the records placed in it, and search to reach past what is open.

## What the demo does not claim

- The quick assessments are estimates from the file, labelled by source; they are not certified opinions. The certified report is whatever the professional signed.
- Pages the reader could not make out are said to be unread, not guessed. A scan read only by OCR carries no model's reading until one is configured.
- Departments marked *Coming soon* show what they will hold; nothing in them is simulated.
