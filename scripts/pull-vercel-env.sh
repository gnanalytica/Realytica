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

echo "[vercel-env] Wrote $ENV_FILE ($(grep -c '=' "$ENV_FILE" 2>/dev/null || echo 0) variables). It is gitignored and never committed."
