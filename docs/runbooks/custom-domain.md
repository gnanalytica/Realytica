# Putting Realytica on realytica.gnanalytica.com

Nothing in the codebase knows its own hostname. The web app calls `/api`
relatively (`apps/web/src/lib/api.ts`), the API reads no host header to build a
URL, and no file mentions a domain. So this is entirely a configuration change
across two consoles, and **no code change is part of it** — if you find yourself
editing a source file to make a domain work, something else is wrong.

Two things are true of this deployment and shape every step below.

> **This cutover is done.** `realytica.gnanalytica.com` is live and is the
> only hostname the deployment answers on; `/api/health` reports `status: ok`
> with the Neo4j graph and Google auth attached. What follows is the procedure
> that got it there, kept because the next domain will want it.

**`gnanalytica.com` is served by Cloudflare, not by Vercel's edge.** The
nameservers are `yew.ns.cloudflare.com` and `dorthy.ns.cloudflare.com`, and the
apex answers from a Cloudflare address with `server: cloudflare` *and*
`x-vercel-id` in the same response — Cloudflare proxying in front of Vercel. The
DNS record you add lives in Cloudflare's dashboard. Vercel's DNS page is not
where this happens, and adding a record there does nothing at all.

**The API refuses to start without an origin allowlist.** `corsPolicy` throws
when `REALYTICA_ALLOWED_ORIGINS` is unset and `NODE_ENV=production`
(`apps/api/src/http/hardening.ts`). That is deliberate — see the reasoning in
that file — but it means a new origin is not merely *allowed* by config, it is
load-bearing. Step 3 is not optional polish.

---

## 1. Claim the domain on the Vercel project

**Vercel → team `gnanalytica` → project `realytica` → Settings → Domains → Add.**

Enter `realytica.gnanalytica.com`. Vercel will accept it and then show it as
**Invalid Configuration**, because the DNS record does not exist yet. That is
the expected intermediate state, not a failure — the panel is now showing you
the exact record to create, which is the reason for doing this step first.

**Copy the CNAME target from that panel rather than from this file.** Vercel
issues per-account CNAME targets and has changed the default more than once
(`cname.vercel-dns-0.com` in current docs, `cname.vercel-dns.com` on older
projects). A stale value pasted from a runbook resolves to something real and
wrong, which is a worse failure than a typo.

## 2. Create the record in Cloudflare

**Cloudflare → `gnanalytica.com` → DNS → Records → Add record.**

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Name | `realytica` |
| Target | the value Vercel showed in step 1 |
| Proxy status | **DNS only** (grey cloud) |
| TTL | Auto |

### Why grey cloud, when the apex is orange

The apex is proxied and works, so proxying this one is tempting. Three reasons
not to, in ascending order of how long they take to diagnose:

- **Vercel's verification reads DNS.** Behind the orange cloud the record
  resolves to Cloudflare's anycast addresses, not to Vercel's target, so the
  Domains panel can sit on *Invalid Configuration* while the site is in fact
  reachable. You then have a domain that works and a console that says it does
  not, and no way to tell a real misconfiguration from this one.
- **Vercel cannot issue its certificate** while a proxy answers the ACME
  challenge. You end up depending on Cloudflare's Universal SSL — which covers
  exactly one level of subdomain on the free plan. `realytica.gnanalytica.com`
  is one level and is covered; the day somebody wants
  `app.realytica.gnanalytica.com` it silently is not.
- **A Flexible SSL setting is an infinite redirect.** Cloudflare talks HTTP to
  Vercel, Vercel redirects to HTTPS, Cloudflare re-requests over HTTP. The
  browser reports `ERR_TOO_MANY_REDIRECTS` and nothing in either log says why.
  The zone setting that causes it is shared with the apex, so this is a trap
  you can walk into by changing something unrelated later.

Grey cloud costs you Cloudflare's caching and WAF on this hostname and buys a
hostname whose failure modes are all in one console. For an app that is behind
a bearer token on every route and serves a small SPA plus JSON, that is the
right trade. If you later want the orange cloud, set the zone's SSL mode to
**Full (strict)** first, and expect the Vercel panel to keep complaining.

Within a minute or two the Vercel panel should flip to **Valid Configuration**
and issue a certificate.

## 3. Set the origin allowlist, then redeploy

**Vercel → project `realytica` → Settings → Environment Variables**, ticked for
**Production** and **Preview**:

```
REALYTICA_ALLOWED_ORIGINS=https://realytica.gnanalytica.com
```

Exact origins: scheme and host, no path, no trailing slash, no port. The
comparison is whole-value and case-insensitive, so `https://realytica.gnanalytica.com`
does not admit `http://` or a port or a suffixed lookalike — which is the point
of it, and the reason a wildcard is not offered.

**One origin, and specifically not the `vercel.app` one.** Listing both is
right for the hour of a cutover and wrong afterwards, for a reason that is
easy to miss: a `vercel.app` hostname is only yours while the project holds
it. Release it — which is what happens when a custom domain replaces the alias
— and the name goes back into a pool anybody can claim by creating a project
of that name. An origin on this list is a page the browser will let script
this API; leaving one there that somebody else can take is the exact thing the
allowlist exists to prevent.

The bearer token still stands in the way (it lives in `localStorage`, so it is
not sent cross-origin the way a cookie would be), so this is a second line
rather than the only one. It is still not a line to leave open.

Preview deployments get a fresh hostname per deploy and are therefore not in
this list. That is fine and not an oversight: the SPA calls its own origin, so
a preview's own front end talks to a preview's own API with no CORS involved at
all. The allowlist governs genuinely cross-origin browser callers — a separate
front end, a console on another host — and nothing else.

**An environment variable change does not reach the deployment that is already
running.** Redeploy after saving, or the panel will show the new value while
production keeps failing with the old one.

> This variable is currently unset in production, and `/api/health` has been
> answering `500 FUNCTION_INVOCATION_FAILED` because of it. Setting it here
> fixes that outage as a side effect. Confirm with the health check in step 5
> rather than assuming the domain work is what fixed it.

## 4. Tell the identity provider about the new origin

Sign-in is a Google token verified server-side, and Google checks which origin
asked. A domain the provider has never heard of fails at the button, not at the
API, so this is easy to miss until somebody tries to log in.

Which console depends on `REALYTICA_AUTH_MODE` — read it off
`GET /api/health`, which reports the mode and is unauthenticated:

- **`google`** — Cloud Console → APIs & Services → Credentials → your OAuth Web
  client → **Authorized JavaScript origins** → add
  `https://realytica.gnanalytica.com`. Origin only: no path, no trailing slash.
- **`identity_platform`** — Cloud Console → Identity Platform → Settings →
  **Authorised domains** → add `realytica.gnanalytica.com`. A bare hostname
  here, not a URL.
- **`oidc`** — whatever your provider calls its redirect/origin allowlist.

`docs/auth.md` has the full setup for each.

## 5. Verify

```bash
curl -sI  https://realytica.gnanalytica.com/            # 200, server: Vercel
curl -s   https://realytica.gnanalytica.com/api/health  # JSON, names the auth mode
```

The health check is the one that matters. A 200 on `/` only proves the static
SPA is being served — that much worked throughout the outage above, which is
exactly why it fooled nobody who checked and everybody who did not.

Then open the app and sign in. Sign-in is the step that exercises step 4, and
it is the only one no `curl` will tell you about.

## Rolling back

Removing the CNAME in Cloudflare is one record deletion and a DNS TTL.

It is no longer a rollback on its own. While the `vercel.app` alias still
existed there was somewhere for traffic to land; the deployment now answers on
`realytica.gnanalytica.com` and nothing else, so deleting the record takes the
app off the internet rather than reverting it. A real rollback means putting an
alias back on the project first, and adding it to `REALYTICA_ALLOWED_ORIGINS`
before anybody is sent to it.

Leave `REALYTICA_ALLOWED_ORIGINS` set either way. Emptying *that* is what
refuses the boot.
