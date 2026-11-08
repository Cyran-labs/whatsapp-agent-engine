#!/usr/bin/env bash
# Garde-fou : les tests HTTP doivent passer par `request(await serve(app))` (src/test-support/http.ts).
# `request(app)` direct fait écouter supertest sur le joker IPv6 `::` ; sous macOS la requête peut alors
# partir chez un autre processus. Échoue si un appel `request(` ou `supertest(` reçoit autre chose que
# `await serve(...)` ou une variable de serveur nommée `server` ou `s`.
set -u

cd "$(dirname "$0")/.." || exit 2

files=$(grep -rlE "from 'supertest'" src 2>/dev/null)
if [ -z "$files" ]; then
  echo "[check-test-http] aucun fichier de test utilisant supertest trouvé, vérification inattendue" >&2
  exit 2
fi

# Appels request( / supertest( (hors méthode d'objet .request( et commentaires), sauf formes autorisées.
bad=$(echo "$files" | xargs grep -nE "(^|[^.A-Za-z0-9_$])(request|supertest)\(" \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)" \
  | grep -vE "(^|[^.A-Za-z0-9_$])(request|supertest)\((await serve\(|server\)|s\))")

if [ -n "$bad" ]; then
  echo "[check-test-http] appels supertest sans serveur lié à 127.0.0.1 (utiliser request(await serve(app))) :" >&2
  echo "$bad" >&2
  exit 1
fi
echo "[check-test-http] ok ($(echo "$files" | wc -l | tr -d ' ') fichiers vérifiés)"
