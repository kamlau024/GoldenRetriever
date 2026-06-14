#!/usr/bin/env bash
#
# GoldenRetriever test runner.
#
# Brings up the Postgres + pgvector test database, applies the schema on a fresh
# DB, then runs the full Vitest suite. Extra arguments are passed straight through
# to vitest, so you can scope a run:
#
#   ./scripts/test.sh                      # everything
#   ./scripts/test.sh packages/retrieval   # one package
#   ./scripts/test.sh -t "IDOR"            # by test name
#
# KEEP THIS SCRIPT UPDATED as new test suites are added. The Python (markitdown)
# block at the bottom is wired and commented out until services/convert tests land
# (see docs/superpowers/plans/2026-06-14-goldenretriever-testing-plan.md, Part A4).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f docker-compose.test.yml"
export DATABASE_URL="${DATABASE_URL:-postgres://gr:gr@localhost:5433/gr_test}"
export AI_GATEWAY_API_KEY="${AI_GATEWAY_API_KEY:-test}"

echo "▶ Ensuring dependencies are installed…"
[ -d node_modules ] || pnpm install

echo "▶ Starting Postgres + pgvector (test DB)…"
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker daemon is not running. Start Docker Desktop and re-run." >&2
  exit 1
fi
$COMPOSE up -d --wait

echo "▶ Ensuring schema is applied…"
has_docs="$($COMPOSE exec -T db psql -U gr -d gr_test -tAc \
  "SELECT to_regclass('public.documents') IS NOT NULL" 2>/dev/null | tr -d '[:space:]' || true)"
if [ "$has_docs" != "t" ]; then
  echo "  schema not found — applying migrations"
  for f in packages/db/drizzle/*.sql; do
    echo "  applying $(basename "$f")"
    $COMPOSE exec -T db psql -U gr -d gr_test -v ON_ERROR_STOP=1 < "$f"
  done
else
  echo "  schema present — skipping"
fi

echo "▶ Running Vitest suite…"
pnpm vitest run "$@"

# --- Python (markitdown) tests -------------------------------------------------
# Uncomment when services/convert/test_convert.py exists (testing plan Part A4):
#
# echo "▶ Running markitdown Python tests…"
# if python3 -c "import markitdown" >/dev/null 2>&1; then
#   python3 -m pytest services/convert -q
# else
#   echo "⏭  skipping (markitdown not installed: pip install -r services/convert/requirements.txt)"
# fi

echo "✓ Tests complete."
