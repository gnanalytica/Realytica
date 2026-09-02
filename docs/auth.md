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
**members** and never as admins. Public mailbox domains (gmail.com and friends)
are refused: "anyone with a gmail address may join" is not a workspace.

### Roles

| | Read | Write | Manage members | Own the workspace |
|---|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ | ✓ |
| **Admin** | ✓ | ✓ | ✓ | |
| **Member** | ✓ | ✓ | | |
| **Viewer** | ✓ | | | |

Write covers everything on a file: checks, evidence, findings, risks, reports.
Admin adds creating and deleting projects and running the member list. Owner
adds transferring the workspace.

A workspace always keeps at least one owner. The last one cannot demote or
remove themselves — there is no way back into a workspace that has nobody who
can administer it.

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

## Deploying behind this

- Serve over HTTPS. A bearer token on plain HTTP is a bearer token anybody on
  the path can copy.
- Set `REALYTICA_AUTH_BOOTSTRAP_EMAILS` **before** the first deploy, not after.
- `/api/health` is the only unauthenticated route. It reports the auth mode so
  the web app knows whether to show the door, and nothing else about the
  deployment.
- The token lives in `localStorage`, which is the accepted trade for a
  single-page app with no server session. It is short-lived — Google issues an
  hour — and a 401 anywhere drops it and returns you to sign-in.
