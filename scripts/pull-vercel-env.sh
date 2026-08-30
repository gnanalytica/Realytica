#!/usr/bin/env bash
#
# Pull the deployment's environment variables from Vercel into a local
# .env.local that `pnpm dev` sources.
#
# Design contract:
#   - No VERCEL_TOKEN  -> clean no-op, exit 0. The repo must still boot locally
#                         with the journal adapter and no credentials, exactly
#                         as it does with no Vercel wiring at all.
#   - VERCEL_TOKEN set -> link the project non-interactively (using
#                         VERCEL_ORG_ID / VERCEL_PROJECT_ID when present, or an
#                         existing .vercel link otherwise) and pull the
#                         `development` environment into .env.local.
#
# Non-interactive and idempotent: safe to run on every boot. Never prints the
# token or any pulled secret value.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
VERCEL="npx --yes vercel@latest"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "[vercel-env] VERCEL_TOKEN is not set; skipping Vercel env pull."
  echo "[vercel-env] The app will run locally with no credentials (journal adapter, agents unavailable)."
  echo "[vercel-env] To enable it, add a VERCEL_TOKEN secret (plus VERCEL_ORG_ID and VERCEL_PROJECT_ID"
  echo "[vercel-env] for non-interactive linking) in the Cursor Secrets panel."
  exit 0
fi

echo "[vercel-env] VERCEL_TOKEN detected; pulling the development environment from Vercel."

# `vercel pull` links the project and writes .vercel/. When ORG/PROJECT ids are
# provided it links without prompting; otherwise it relies on an existing
# .vercel/project.json link. --yes suppresses all interactive confirmation.
$VERCEL pull --yes --environment=development --token="$VERCEL_TOKEN"

# Write the variables the API process reads (REALYTICA_*, BLOB_*) into .env.local,
# which the dev terminal sources before launching the app.
$VERCEL env pull "$ENV_FILE" --environment=development --token="$VERCEL_TOKEN" --yes

# Vercel refuses to return the value of any variable marked "Sensitive": the
# pull writes the literal placeholder [SENSITIVE] in its place. Sourcing that
# would set e.g. REALYTICA_BASE_URL="[SENSITIVE]", which the app would treat as
# a real endpoint/key and then fail on every call. Strip those lines so only
# usable values survive. Sensitive credentials must be supplied another way —
# as Cursor Secrets, or by un-marking them Sensitive on Vercel.
if [ -f "$ENV_FILE" ]; then
  # `grep -c` prints the count (including 0) but exits non-zero when it is 0,
  # so guard with `|| true` and never append a second value.
  stripped=$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=("?)\[SENSITIVE\]("?)$' "$ENV_FILE" 2>/dev/null || true)
  stripped=${stripped:-0}
  if [ "$stripped" -gt 0 ]; then
    sed -i -E '/^[A-Za-z_][A-Za-z0-9_]*=("?)\[SENSITIVE\]("?)$/d' "$ENV_FILE"
    echo "[vercel-env] Dropped $stripped variable(s) marked Sensitive on Vercel (unreadable via pull)."
    echo "[vercel-env] Supply those as Cursor Secrets, or un-mark them Sensitive on Vercel to pull them."
  fi
fi

usable=$(grep -c '=' "$ENV_FILE" 2>/dev/null || true)
echo "[vercel-env] Wrote $ENV_FILE (${usable:-0} usable variable(s)). It is gitignored and never committed."
