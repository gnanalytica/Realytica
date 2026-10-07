# Signing in

Realytica does not issue identities. Google does, and the server checks the
token Google signed. That means there are no passwords in this system, no
password reset, and nothing to leak — the whole of the security story on our
side is: *is this token genuine, and does the person it names belong to this
workspace?*

Pick one of the two Google products below. Everything after the setup is
identical.

---

## Option A — Google Identity Services (an OAuth client)

The lightest path. One client id, no SDK, no Firebase project.

**In Google Cloud Console**

1. **APIs & Services → OAuth consent screen.** Internal if everybody is on your
   Workspace domain; External otherwise. Fill in the app name and support
   email.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   Application type **Web application**.
3. **Authorized JavaScript origins** — add every origin the app is served from.
   This is the one people get wrong: it is the *origin*, no path and no
   trailing slash.
   ```
   https://realytica.yourfirm.in
   http://localhost:5173
   ```
4. Copy the client id. It looks like `1234-abc.apps.googleusercontent.com` and
   it is **not a secret** — it ships in the browser bundle by design.

**Configure**

```bash
# API
REALYTICA_AUTH_MODE=google
REALYTICA_AUTH_CLIENT_ID=1234-abc.apps.googleusercontent.com

# Web, at build time
VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
```

---

## Option B — Identity Platform / Firebase Authentication

Choose this if you want more than Google sign-in later — email links, SAML,
Microsoft, phone. The server side is one variable; the client side needs the
Firebase SDK and a replacement for `apps/web/src/pages/SignIn.tsx`, which is
deliberately the only file that knows how a token is obtained.

**In Google Cloud Console**

1. Enable **Identity Platform** on the project.
2. Add the **Google** provider (and any others you want).
3. Under **Settings → Authorised domains**, add the domain the app is served
   from.

**Configure**

```bash
REALYTICA_AUTH_MODE=identity_platform
REALYTICA_AUTH_PROJECT=your-gcp-project-id
```

The server derives the rest: Identity Platform issues tokens with
`iss = https://securetoken.google.com/<project-id>` and `aud = <project-id>`,
signed with keys published at Google's `securetoken` JWKS endpoint.

Replace `SignIn.tsx` with the Firebase SDK's sign-in and call
`setToken(await user.getIdToken())`. Nothing else in the app changes: every
request already carries whatever token that function was given.

---

## Any other OIDC provider

```bash
REALYTICA_AUTH_MODE=oidc
REALYTICA_AUTH_ISSUER=https://issuer.example.com
REALYTICA_AUTH_AUDIENCE=the-audience-it-mints-for
REALYTICA_AUTH_JWKS_URL=https://issuer.example.com/.well-known/jwks.json
```

RS256 only.

---

## Local development

```bash
REALYTICA_AUTH_MODE=off
```

Every request becomes one named local operator — through the real tenancy
path, with a real membership and a real role, not around it. A bypass that
skipped tenancy would hide tenancy bugs until the day they mattered.

**This mode refuses to start when `NODE_ENV=production`.** A deployment that
forgets to configure auth fails loudly instead of coming up green and serving
every project to anybody who finds the URL.

Optional:

```bash
REALYTICA_AUTH_LOCAL_EMAIL=you@yourfirm.in   # who the audit trail names
REALYTICA_AUTH_LOCAL_NAME="Your Name"
```

---

## Who gets in

**The first person to sign in claims the workspace and becomes its owner.**
That is right for a firm standing up its own instance and wrong for anything
already on a public URL, so pin it before you deploy:

```bash
REALYTICA_AUTH_BOOTSTRAP_EMAILS=you@yourfirm.in,partner@yourfirm.in
```

Anybody else is refused with *"You are not a member of this workspace"* until
an admin invites them under **Workspace** in the sidebar. An invite is a row
against an email address; no email is sent, and the person claims it by signing
in with that address. From then on their provider subject is what matches — an
email can be reassigned inside a company, a subject cannot, so a later invite
to the same address cannot promote an account that already exists.

An owner can open the workspace to a whole domain, which admits colleagues as
**staff** and never as managers. Public mailbox domains (gmail.com and friends)
are refused: "anyone with a gmail address may join" is not a workspace.

### Roles

The shape is a developer and their people. Four roles reach every project in
the workspace; the fifth reaches only what it is given.

| | Reads every project | Writes | Manages people | Owns the workspace |
|---|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ | ✓ |
| **Manager** | ✓ | ✓ | ✓ | |
| **Staff** | ✓ | ✓ | | |
| **Viewer** | ✓ | | | |
| **Collaborator** | — | per grant | | |

Write covers everything on a file: checks, evidence, findings, risks, reports.
Manager adds creating and deleting projects and running the people list. Owner
adds transferring the workspace.

Writing is not deciding. Whether a value read off a document is accepted is a
department's call on each project, and staff do not hold it by default: see
[Departments](#departments).

A workspace always keeps at least one owner. The last one cannot demote or
remove themselves — there is no way back into a workspace that has nobody who
can administer it.

### Collaborators, and what a grant says

A collaborator — a contractor, a consultant, a site helper — reaches **nothing
until they are named on a project**, under **People** on the project itself.
The grant narrows in four steps:

```
project  →  which assessments  →  which scopes inside them  →  which areas
```

Areas are the parts of a file that belong to no scope: the valuation, the
decisions, the reports, the budget, the site record. Each is off unless ticked,
and `allAssessments: false` with an empty list means none rather than all — a
convention where "empty" silently meant "everything" is the one that puts the
wrong contractor on the acquisition file.

A grant can carry an expiry, which the server enforces. Contractors churn and
nobody remembers to revoke.

Three things follow from the grant rather than being written per route:

- **Reads are redacted, not filtered.** The project handed to any reader —
  including the chat, the search index and the graph — is a copy with the
  withheld parts absent. A model told to withhold the valuation mentions it; a
  model handed a file that has no valuation on it cannot.
  The stored graph is the one thing kept whole. What it answers is cut to the
  caller's reach before it is handed on: to the page
  (`GET /graph/neighbourhood`), to the model answering in their chat, and to a
  flow they run. What a change reaches (`GET /graph/impact`) is not asked of
  the store at all for somebody working from a grant. It is worked out on
  their own copy, and a record that is not on it is not found.
- **Writes are gated separately.** The API mutates the real project, not the
  copy, so a request naming a record that exists but is not in the caller's
  projection is refused — whether the id came from the path or the body.
- **Refusals are 404.** For the same reason as a project in another workspace:
  a 403 answers the question the caller was really asking.

### Who runs the deployment

Two things reach past a workspace and are therefore not any admin's:

- **Model spend** (`/api/telemetry`) is scoped to the caller's workspace. Every
  call is stamped with the workspace that made it, so one firm never reads
  another's bill.
- **The prompt registry** (`/api/prompts`) is one registry for the whole
  deployment. Any admin may read it; changing it needs an operator:

  ```bash
  REALYTICA_OPERATORS=ops@yourfirm.in,partner@yourfirm.in
  ```

  Unset, the owner of the *only* workspace on the deployment is the operator —
  which is what a local install and a single-firm deployment are, and neither
  should need configuration to edit a prompt. That rule stops the moment a
  second workspace appears: a shared deployment has no operator until somebody
  says who it is. Refusing an edit is recoverable; letting one firm rewrite
  another's agents is not.

Agent memory is cross-project by design and workspace-scoped by enforcement: a
fact learned on one firm's file is never recalled into another firm's prompt.

---

## What the server actually checks

In this order, because it is the order an attacker tries:

1. **The algorithm is ours to state.** RS256, taken from our config and only
   matched against the token's. `alg: none` and the HS256 key-confusion trick
   are refused before anything else is read.
2. **The key must be one the issuer publishes**, fetched from the JWKS and
   cached. A `kid` we do not hold forces exactly one refresh — Google rotates
   keys, and an unknown kid is usually our cache being behind.
3. **The signature verifies.** Only then are the claims read at all; an
   unverified token's claims are attacker input.
4. **Expiry, not-before and issued-at**, with a minute of clock tolerance.
5. **Issuer and audience** must be the ones configured. A whole-value
   comparison, so `your-project-staging` does not pass as `your-project`.
6. **The email is verified** by the provider, unless
   `REALYTICA_AUTH_REQUIRE_VERIFIED_EMAIL=false`.

Then, separately, whether that identity has a membership here. A genuine Google
account nobody invited is a genuine Google account with no business on your
files.

Projects are scoped by workspace in Express's `param` handler, before any route
handler runs, so a route added later is scoped by construction. A project in
another workspace returns **404, not 403** — a 403 confirms the project exists,
which is the fact somebody probing is looking for.

---

## Phones: the site app

The site app never sees a Google sign-in. A signed-in person opens **People ›
The site app › Pair a phone**, which shows an 8-character code (and the same
code as a QR) valid for ten minutes and one use. The phone trades it at
`POST /api/devices/claim` for a token of its own, `rdt_…`, kept on the phone in
its secure store and on the server only as a SHA-256 hash.

Every call from the phone resolves the token to the person who paired it, as
the workspace knows them *now*: remove the person, or revoke the phone from
People, and the next call is a 401. A phone's token reaches only the site
routes — the projects list, a project's site view, the site log and its
photographs, milestone progress and alert reads — and anything else is a 403.
Department roles apply as they do on the web: logging from site needs a lead,
contributor or signer in Construction.

## Departments

Inside a project, what a person may do is decided per department. Their firm
role sets the default — owners and managers lead every department, staff
contribute, viewers read — and the project's team list says otherwise where it
needs to. Someone from outside the firm reaches only the departments given to
them; that is written as a project grant (the scopes whose checks those
departments hold, and the matching areas), so the response redaction described
above applies to them unchanged.

| | Edits the department's records | Decides |
|---|---|---|
| **Lead** | ✓ | ✓ |
| **Signer** | ✓ | ✓ |
| **Contributor** | ✓ | |
| **Viewer** | | |

### Who decides what a document states

Reading a document proposes values; a person decides where each one stands.
Accepting a value, setting it aside, reopening it, and picking one of two that
disagree are all decisions, and a decision is for **a lead or a signer of the
department the value belongs to**. A contributor files documents and records
what they find. They decide nothing that was read.

| What is decided | Whose it is |
|---|---|
| What a document states, on its own row | The department whose function holds the document. While no function holds it: a lead or signer of any department the project uses. |
| A value waiting on a check | The check's department |
| A value offered to the valuation, and which comparables count | Finance |
| Moving a document out of the function that holds it | The department that holds it now |
| Saying what kind of document a row is, once a value on it has been decided | The department that holds it |

The server checks this. What it checks, by the way a decision arrives:

| Way in | Routes, under `/projects/:id` |
|---|---|
| The document's row | `POST /evidence/:evidenceId/facts/review` |
| The check | `POST /proposals/:proposalId/fields`, `/proposals/:proposalId/accept`, `/proposals/:proposalId/set-aside`, `/checks/:checkId/fields/:key/pick` |
| The Value tab | `POST /value/accept`, `/value/set-aside`, `/comparables/decide` |
| The chat | An approval typed or pressed: `POST /chat`, `/chat/proposals/:proposalId/commit`, `/chat/proposals/:proposalId/reject`. The firm's own chat and a collaborator's. |
| A plan | A step that accepts, run from the chat |
| Where a document is held | `PUT /evidence/:evidenceId/workstream` and its `null`, "File … under …" in the chat, a card that files a document under a function, `POST /certified`, `POST /evidence/:evidenceId/document-type/confirm` and `/correct` |

Each route hands the shared function that does the deciding the caller's
standing (`decidesFor`), and that function refuses before anything changes.
Two routes also ask for themselves, because they write a correction onto a
card before the card is decided: `POST /proposals/:proposalId/accept` and
`POST /chat/proposals/:proposalId/commit` take a corrected value only from
somebody who may decide that card. Whatever the card, the correction belongs
to that one commit: where the commit is refused, fails, or leaves the card
waiting, the card is put back exactly as it was raised. And where a card
would file a document is the card's own, like the document it names, and
cannot be sent with an accept.

Handed nobody, a shared function takes the work for the server's own and
refuses nothing. A call that left the caller out would let anybody through,
so a test reads the source for one (`test/decide-gate.test.ts`). Every such
call in the API passes the caller in the code of the call, not in a comment or
a string and not as `undefined`; none of these functions is handed on under
another name; and the two calls in the shared package that pass nobody are
listed there, each with why nobody is asking.

What the rule does not cover. Each of these is as it was before the rule, and
each lets somebody without the role change what is decided or who decides it:

- **A document held only because a check lists it.** A document of no kind,
  with no function given to it, is held by the first check that lists it.
  Listing it on a check, or taking it off one, changes who holds it, and is
  not held to the rule for a move or written as one
  (`recordCheckResult` in `operations.ts`). So is the first reading of such a
  document: a row with no kind yet is named by the reading, and its kind then
  says who holds it.
- **Undo.** A person takes back their own chat message, and what it changed
  goes back as it was: a document it moved, a value it accepted or set aside.
  Nobody is asked for the role, at the time of the undo or for what it puts
  back (`undoTurn` in `chat-changes.ts`).
- **Marking a document's row.** Setting a row to rejected or superseded takes
  what was accepted on it out of force, and setting it back to received puts
  it back in force. Anybody who may write to the row may do either
  (`PATCH /evidence/:evidenceId`, `POST /evidence/status`).
- **Comparables other than deciding them.** One added by hand counts from the
  moment it is added, and changing a comparable's adjustments or weight needs
  no role (`POST /comparables`, `PATCH /comparables/:comparableId`).
- A value typed onto a check by hand (`PUT /checks/:checkId/fields`), and the
  valuation's own fields. It goes on the record under the name of whoever typed
  it, and settles nothing that was read.
- A card that is not a read value: a finding, a request, a DD to start, a
  result suggested for a check, a suggested answer on a questionnaire. And a
  card that writes what a document says about the project itself onto the
  project's own record, its survey number or its address. Anybody who may
  write accepts these.
- A card on a check, for a lead or signer from outside the firm. The cards are
  not on their copy of the project, so the write gate answers 404 before this
  rule is asked. They decide on the document's row and in the chat.

What follows from the rule:

- **A decision stops at the department's edge.** A Legal lead who accepts what
  a sale deed states records it on Legal's checks. A rate the same deed states
  stays waiting on Finance's check, for Finance. The other way round too:
  Finance accepting that rate on its own check does not accept it on Legal's
  document.
- **A check takes what the document was accepted as stating.** A figure
  corrected on the document, or the other reader's value kept there, is what
  another department's check records when its own lead accepts it, never the
  figure its card was raised with. A value set aside on the document is taken
  by no check from there until it is reopened, however the document is read
  afterwards. A figure the check's own lead types, on the check or on the card
  as they accept it, is theirs and is recorded as typed.
- **Moving a document is a decision too.** Which function holds a document
  says whose its values are, so whoever could move one could decide it. A lead
  of Engineering cannot take Finance's valuation report: not by filing it
  under Site, not by handing back to its own kind a document somebody gave to
  Finance, not by accepting a card that files it elsewhere, not by filing it
  as a signed report of their own, and not by saying it is another kind of
  document. A document no function holds yet is given its first home by
  anybody who may file. Between the design workstreams, which are one
  function, nothing has moved. Each of these moves is on the trail when it is
  made: from where, to where, by whom. The moves the rule does not cover are
  listed above, and are not written as moves.
- **A file never renames a row.** Putting a file on a row that already has a
  kind leaves the kind as it is, whatever the file reads as: by upload, in
  parts, from the chat, or by a plan that reads the filed documents. What the
  file reads as is kept beside the row's kind as an offer, and taking the
  offer is saying what the document is, which is held to the rule for a move.
  A row with no kind yet is named by the first reading put on it.
- **Saying what a document is can be a decision on its values.** A row's kind
  says which of its values stand. Once a value on the row has been accepted or
  set aside, confirming or correcting its kind takes a lead or signer of the
  department that holds it, even where the document would stay in the same
  function. Setting an offer aside renames nothing, and is anybody's.
- **Reading a document again undoes nobody's decision.** A value a person
  accepted or corrected stays in force. A value a person set aside stays set
  aside whatever is read afterwards: the same value read again brings nothing
  new, and a different value waits beside it as a new proposal. No number of
  files put on the row brings back what somebody set aside; only reopening it
  does, and that takes the role.
- **A collaborator is judged on the whole project.** Their chat runs on their
  copy, and a copy with Legal's checks taken out cannot say that Legal holds a
  document. Where a document is held, and where a check sits, are worked out on
  the real project. What their chat accepts is written on the real trail, and
  only that: a line is carried back where the record it names is on the real
  project.
- **A refusal is a 403 that names the department**, by the menu's word for it:
  *"Deciding what was read on this paper needs a lead or signer in Legal."* The
  caller can already see the document, so there is nothing a 404 would protect.
  Where the project's team list is why, because it gives somebody less than
  their firm role would, the refusal says so: *"On this project the team list
  makes you a viewer there."* The chat refuses nothing outright. It takes what
  the person may decide and says how many values wait, and for which
  department; a value is counted once, however many places it waits in.
- **Owners and managers lose nothing. Staff and collaborators do.** Staff
  contribute by default and a collaborator holds nothing by default, so either
  has to be made a lead or a signer of a department on the project's team list
  before they decide there.

Saying what a document is, where a reading only offered a kind, is for
anybody who may write while no function holds the document and nothing on it
has been decided. Where a function holds it and the kind would move it, or a
value on it has been decided, it is that department's. The values that kind of
document cannot carry are set aside with it only when the person may decide
the document. From anybody else they stay waiting, where nobody can accept
them, for somebody who may.

## Deploying behind this

- Serve over HTTPS. A bearer token on plain HTTP is a bearer token anybody on
  the path can copy.
- Set `REALYTICA_AUTH_BOOTSTRAP_EMAILS` **before** the first deploy, not after.
- `/api/health` and `POST /api/devices/claim` are the only unauthenticated
  routes. Health reports the auth mode so the web app knows whether to show the
  door, and nothing else about the deployment; claim trades a pairing code for
  a phone's token, ten tries a minute per address.
- The token lives in `localStorage`, which is the accepted trade for a
  single-page app with no server session. It is short-lived — Google issues an
  hour — and a 401 anywhere drops it and returns you to sign-in.
