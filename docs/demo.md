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

Each file goes up in 4 MB parts (a merged title bundle is 66 MB), is assembled in storage, read locally — text layer, then OCR for scans — typed, and given to the function it belongs to. `--read` then asks the chat to read what the local reader could not make out; with a model configured, a long scan is sent as its first and last pages, which is where a title bundle's schedule and an opinion's conclusion sit.

From the web app the same happens by dropping the folder on **Documents**, or into the chat. On the demo project the large merged bundles were filed as labelled parts (`Title Documents merged - part 3 of 10 (pp. 211-319).pdf`); each part is read, typed and filed on its own, and the page range in its name says where it sits in the original.

### Reading what the local reader could not

Say **Read the filed documents** in the chat. Each turn takes up to ten documents nobody has read, sends them straight to the model (no second OCR pass), and stops starting new ones after eight minutes; it ends by saying how many are left, and saying it again carries on. **Read the filed documents again** reads everything from the start.

A value the model reads is kept only with the page it is printed on, and that page is checked, never taken on the model's word:

- **Claude, directly** (`REALYTICA_BASE_URL` unset, an Anthropic key): the API's own citations say which page each value came from.
- **Any model through a gateway** (OpenRouter, any vendor): no citation survives the gateway, so the page the model names is checked here. A quote found in the page's own text (its text layer, or this server's OCR) is placed there. Otherwise that one page is cut out and shown to a checking model (`REALYTICA_MODEL_PAGE_CHECK`, another vendor's for an independent check), which must find the words printed on it. A quote not on the page it was said to be on is dropped.

Either way the values wait on the document for a person to accept, and the title chain, approvals and valuation read them once accepted. A value nothing could check stays in *the model's reading*, with no page.

The Kannada encumbrance certificates are read by the model alone: their text layer is unreadable and they carry no images for this server to OCR, so each of their pages is checked by the checking model.

## The walk-through

1. **Portfolio.** The project sits under *Under construction*. Its alerts are counted on the card.
2. **The stage track** in the project bar: Land and Pre-construction ticked, Under construction current. Press *Land* and the workspace is looked at in that stage: the selector lists the departments with work at Land, and a department's tabs list its functions there. On Overview the stage's record says what was filed and decided while the project was there, with the finer steps inside it. Press *Under construction* to come back.
3. **Overview.** Each department's functions with their quick assessments: Legal's title and approvals, Engineering's progress and site, Finance's valuation — each with what it rests on.
4. **Legal › Approvals.** The register, read from the documents: the AAI height clearance with its permissible top elevation, the BESCOM, BSNL and BWSSB NOCs, the environmental clearance and its validity, the RERA registration with its number and term. Construction's gate says whether the plan sanction and commencement certificate are in hand.
5. **Legal › Title.** The encumbrance certificates and title documents, and the legal opinion. **File a certified report** from the opinion: its date, advocate and conclusion are read off it for you to confirm. It becomes the figure of record; the quick assessment keeps running beside it. The title chain — owners, the instruments between them, the charges — is drawn once **Value this property** has checked the deeds and ECs against the Karnataka title rules (step 8).
6. **Connections** on any function: what it depends on, and — walked in Neo4j — what a change to it reaches: an approval lapsing gates progress, which feeds the valuation and the cost to complete, and names the engagements and people standing on each.
7. **Engineering › Progress.** Use the usual milestones, then **Pair a phone** from People. On the phone, in the Realytica Site app, scan the code, log today's entry with a photograph — offline if you like — and watch it arrive: progress moves, and if the commencement certificate is not on file, an alert says work is being logged before it is allowed.
8. **Finance › Valuation.** **Value this property** fills what the file holds — on this pack, the plot area off the sale deed, and the 2006 sale price, which it shows but will not use as a rate twenty years on — and checks the Karnataka title rules: K-RERA registered, the occupancy certificate not yet due, the EC period as read, and what is not established. The rate and the land rate wait for a valuer, a comparable you add, or the portal search (which needs a scraping service account on the API).
9. **People.** Roles by department: make an outside advocate the signer for Legal, and see what they can and cannot reach.
10. **Graph.** Opens on the project, the four stages, its departments and their functions; open any node to walk out to the records placed in it, and search to reach past what is open.

## What the demo does not claim

- The quick assessments are estimates from the file, labelled by source; they are not certified opinions. The certified report is whatever the professional signed.
- Pages the reader could not make out are said to be unread, not guessed. A scan read only by OCR carries no model's reading until one is configured.
- Departments marked *Coming soon* show what they will hold; nothing in them is simulated.
