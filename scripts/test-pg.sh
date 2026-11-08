#!/usr/bin/env bash
# Lance vitest sur un Postgres jetable. Si TEST_DATABASE_URL est déjà défini (CI), l'utilise tel quel.
set -u

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  npx vitest run "$@"
  exit $?
fi

COMPOSE="docker compose -f docker-compose.test.yml"
trap '$COMPOSE down -v >/dev/null 2>&1' EXIT

$COMPOSE up -d --wait || exit 1
export TEST_DATABASE_URL="postgres://wab:wab@localhost:54329/wab"
npx vitest run "$@"
exit $?
