# Install npm — diagnostic & procédure propre

## TL;DR

**Ne jamais lancer `npm audit fix --force` sur ce repo.** Il « répare » les vulnérabilités en rétrogradant les dépendances majeures — concrètement il a rétrogradé **Next 15 → next@9.3.3** (version de 2020), ce qui réintroduit toute l'ancienne chaîne webpack4 / babel-plugin-proposal / postcss-preset-env et fait exploser le nombre de paquets et de vulnérabilités.

Pour (ré)installer proprement : **`npm ci`** (reproductible depuis `package-lock.json`).

## Symptôme observé

Après trois `npm audit fix --force` :

| | next@9 (cassé par --force) | install saine (next@15) |
|---|---|---|
| Paquets | 1542 | 566 |
| Vulnérabilités | 98 (1 critical, 27 high, 59 moderate, 11 low) | 6 (2 high, 3 moderate, 1 low) |
| Déprécations | ~30 (babel-proposal-*, rimraf@2, fsevents@1, uuid@3, move-concurrently…) | ~9 (chaîne de build native) |

Indice dans le log : `npm warn audit Updating next to 9.3.3, which is a SemVer major change` + `peer react@"^16.6.0" from next@9.3.3`. Le `--force` avait réécrit `apps/web/package.json` en `"next": "^9.3.3"`.

## Procédure de remise au propre

```bash
# 1. tuer les serveurs dev éventuels
pkill -f "next dev"; pkill -f "tsx watch"

# 2. restaurer les manifests depuis la branche (next 15)
git checkout HEAD -- package.json package-lock.json apps/web/package.json

# 3. purger les node_modules
rm -rf node_modules apps/web/node_modules packages/contracts/node_modules

# 4. install reproductible (PAS de --force)
npm ci

# 5. correctifs non-breaking uniquement (optionnel)
npm audit fix          # sans --force : ne touche pas les versions majeures
```

## Triage des 6 vulnérabilités restantes (install saine)

Aucune n'est corrigeable sans casser une majeure, aucune n'est réellement exploitable dans ce contexte :

- **tar (high)** — build-time uniquement (`better-sqlite3` → `@mapbox/node-pre-gyp`), jamais au runtime ; install depuis le registre npm officiel. Acceptable.
- **postcss (moderate)** — bundlé **dans next@15.5.19** (dernière version). Le seul « fix » proposé est le downgrade next@9.3.3 (le piège). Attendre un patch Next upstream.
- **next-intl ≤4.9.1 (moderate ×2)** — open-redirect + prototype-pollution via `experimental.messages.precompile` (non utilisé ici). Le correctif est next-intl **4.x (breaking)** → migration à planifier, pas un audit-fix.
- **esbuild (low)** — lecture de fichier du dev-server **Windows uniquement** (via vitest), absent du bundle de prod. Acceptable (dev macOS).
- **qs** — corrigé (6.15.1 → 6.15.2, non-breaking via `npm audit fix`).

## Déprécations résiduelles

`npmlog`, `gauge`, `are-we-there-yet`, `tar`, `rimraf@3`, `glob@7`, `inflight`, `prebuild-install` proviennent de la chaîne de compilation native de `better-sqlite3` (`@mapbox/node-pre-gyp`) et de `jsdom` (tests). Transitives, hors de notre contrôle, sans impact runtime.

## À planifier (non urgent)

- Migration **next-intl 3 → 4** (résout les 2 advisories next-intl ; breaking, à tester sur le routing par locale).
- Suivre les patches **Next 15.x** pour la vuln postcss bundlée.
