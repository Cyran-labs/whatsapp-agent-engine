# Design — Résilience LLM (mode plateforme)

Statut : validé en brainstorming, à implémenter.
Date : 20 juin 2026.
Item ROADMAP : item « résilience LLM » réservé par la fondation credentials (`quotaContext`). Concerne le mode économique `platform`/SaaS.

## Objectif

En mode `platform` (Cyran fournit l'IA à plusieurs clients SaaS via une infra partagée), éviter deux problèmes : (1) le plafond de débit Anthropic d'une clé unique sous forte charge, (2) un client qui monopolise la clé partagée et pénalise les autres. On le fait sans jamais dégrader l'UX conversationnelle : sous contention on **ralentit** (file d'attente) et on **dégrade** (cascade de modèles), on ne **coupe jamais** une conversation.

Principe directeur (validé) : le quota n'est pas un interrupteur qui rejette un message utilisateur, c'est un **ordonnanceur d'équité** — il agit sur *quand* une requête part, pas sur *si* elle part. Le seul échec visible reste l'épuisement total (déjà le comportement actuel).

## Périmètre

- **Mode `platform` uniquement.** Le mode **BYO est totalement inchangé** : le client utilise sa propre clé (`getClientForTenant`), ses propres limites de rate sont isolées, aucune file ni pool ne s'applique.
- Mono-instance aujourd'hui ; les mécanismes runtime exposent une **interface pluggable** (compteurs en mémoire maintenant) pour basculer vers un store partagé (Postgres/Redis) en multi-instance plus tard, sans réécrire les appelants.
- Hors scope : quotas par tokens/minute (le levier retenu est la concurrence) ; UI de gestion des clés (P3) ; store partagé multi-instance (interface prête, impl ultérieure).

## Contexte et état actuel

- `src/llm/anthropic.ts` : `chat(parts, messages, { clientId, botId, model? })` résout un client via `getClientForTenant` (cache `Map<apiKey, Anthropic>`), puis tente une **cascade de modèles** (`MODEL_CASCADE` : Sonnet 4 → Sonnet 4.5 → Haiku 4.5) avec `withRetry` (backoff sur 429/529). Le dernier plan re-throw.
- `src/core/credentials/resolver.ts` : `resolveLlmCredentials(clientId, botId)` renvoie `{ apiKey, quotaContext? }`. En `byo` : clé client déchiffrée. En `platform` ou absence d'enregistrement : `process.env.ANTHROPIC_API_KEY`. Le `quotaContext` est réservé (no-op) — il sert ici à exposer le **mode** à `chat()`.
- `src/core/handler.ts` : `llmLimit = pLimit(10)` borne la concurrence LLM globale (garde-fou conservé).
- Crypto credentials disponible : `encryptJson/decryptJson` (AES-256-GCM, KEK `CREDENTIALS_ENCRYPTION_KEY`).

## Données — table `platform_llm_keys`

Pool de clés Anthropic de la plateforme (infra, pas per-tenant). Chiffrées via le crypto existant.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | PK | |
| `label` | text not null | nom lisible (ex. `pool-1`) pour les logs/gestion |
| `secret_encrypted` | text not null | enveloppe AES-256-GCM de `{ api_key }` |
| `key_version` | integer not null default 1 | version KEK |
| `active` | integer/boolean not null default 1 | activable/désactivable à chaud |
| `created_at` | timestamp | |

Drivers SQLite + Postgres (même patron que `tenant_credentials`). Méthode de lecture : `listActivePlatformKeys(): Promise<PlatformKeyRecord[]>`. Le pool ne stocke pas l'état de charge (en mémoire, voir runtime).

Amorçage : un script (ou extension de `seed-credentials.ts`) lit `ANTHROPIC_API_KEYS` (liste séparée par virgules) ou `ANTHROPIC_API_KEY` (clé unique) du `.env` et upsert un enregistrement actif par clé (label `pool-1`, `pool-2`, …). Non destructif.

## Mécanismes runtime (interfaces pluggables)

Deux unités à responsabilité unique sous `src/llm/`.

### 1. `KeyPool` (`src/llm/key-pool.ts`)
Gère la sélection de clé et la résilience 429 du pool plateforme.
- Charge les clés actives au démarrage (déchiffrées) ; rechargement possible (à chaud = item de gestion ultérieur, mais l'interface le permet).
- État en mémoire par clé : **nombre de requêtes en vol** + **timestamp de fin de cooldown**.
- `withPlatformKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T>` :
  1. choisit la clé **active, hors cooldown, la moins chargée** (min in-flight) ;
  2. si toutes en cooldown → attend (court délai, retry) plutôt que d'échouer ;
  3. incrémente l'in-flight, exécute `fn(apiKey)`, décrémente dans un `finally` ;
  4. si `fn` lève une erreur **429/529** → met la clé en **cooldown** (`LLM_KEY_COOLDOWN_MS`, défaut 30 000 ms) et **relève** l'erreur (le caller décide de réessayer sur une autre clé).
- Le client `Anthropic` par clé est mis en cache (réutilise `getClientForTenant`/un cache par apiKey).
- Interface `KeyLoadTracker` (in-flight + cooldown) extraite pour pouvoir passer à un store partagé plus tard.

### 2. `ClientFairQueue` (`src/llm/client-fairness.ts`)
Garantit l'équité entre clients sans jamais rejeter.
- `Map<clientId, limiter>` où `limiter` borne la **concurrence par client** (`LLM_CLIENT_CONCURRENCY`, défaut 3) — un `pLimit(n)` par client.
- `run<T>(clientId: string, fn: () => Promise<T>): Promise<T>` : au-delà de N requêtes en vol pour ce client, `fn` **attend son tour** (file), n'est jamais rejeté.
- Interface extraite pour un futur backend partagé.

## Intégration dans `chat()`

`resolveLlmCredentials` expose désormais le **mode** dans son retour : `{ apiKey: string; mode: 'byo' | 'platform' }`. (Le `quotaContext?` réservé, jamais peuplé, peut être retiré ou conservé inerte — au choix du plan ; le porteur du mode est le champ `mode` explicite, pas `quotaContext`.) En `platform`, `apiKey` peut être vide/ignoré côté `chat()` puisque la clé vient du pool.

- **byo** : chemin actuel **inchangé** — `getClientForTenant` (1 client) + cascade + `withRetry`.
- **platform** :
  ```
  ClientFairQueue.run(clientId, () =>
    <cascade de modèles existante>(model =>
      KeyPool.withPlatformKey(apiKey =>
        clientForKey(apiKey).messages.create({ model, ... })
      )
    )
  )
  ```
  Composition de la résilience sur un 429 : d'abord **bascule de clé** (même modèle, via le retry interne au `KeyPool` côté caller), puis si le pool est épuisé/en cooldown, **bascule de modèle** (cascade Sonnet→Haiku). Le `pLimit(10)` global du handler reste en garde-fou externe.

La forme exacte de la boucle (retry clé vs modèle) est détaillée au plan ; l'invariant : on épuise les clés disponibles pour un modèle avant de descendre d'un cran de modèle, et on ne re-throw qu'à épuisement total.

## Configuration

Nouvelles variables `.env` (avec défauts, documentées dans `.env.example`) :
- `LLM_CLIENT_CONCURRENCY` (défaut `3`) — concurrence max par client en mode platform.
- `LLM_KEY_COOLDOWN_MS` (défaut `30000`) — durée de mise en pause d'une clé après un 429/529.
- `ANTHROPIC_API_KEYS` (optionnel) — liste de clés pour amorcer le pool ; à défaut `ANTHROPIC_API_KEY`.

Lues via getters `config.*` (cohérent avec le reste).

## Erreurs / UX

- Aucun message utilisateur rejeté en contention : la file fait patienter (indicateur « en train d'écrire… » côté bot), le pool bascule de clé, la cascade dégrade le modèle.
- Échec visible uniquement à **épuisement total** (toutes clés en cooldown + cascade épuisée) → message d'erreur actuel. Inchangé.
- Logs `[LLMPool]` / `[LLMFairness]` sans secret (jamais de clé en clair).

## Architecture des modules (isolation)

- `key-pool.ts` : que fait-il ? choisir une clé plateforme et encaisser les 429. Dépend du store de clés + crypto. Testable avec clés factices.
- `client-fairness.ts` : que fait-il ? sérialiser/limiter par client sans rejet. Aucune dépendance externe. Testable seul.
- `anthropic.ts` : compose les deux pour le mode platform ; byo inchangé.
- `database` : ajout `platform_llm_keys` + `listActivePlatformKeys` dans l'interface `Database` (impl sqlite/postgres).

## Tests (Vitest, SDK Anthropic mocké)

- KeyPool : sélection de la clé la moins chargée ; cooldown sur 429 + bascule de clé ; attente si toutes en cooldown ; décrément en `finally` même sur erreur.
- ClientFairQueue : au-delà de N, la 2e requête attend (pas de rejet) ; libération après complétion ; clients distincts indépendants.
- chat platform : byo inchangé (1 client, pas de pool) ; platform passe par file + pool ; composition 429 → bascule clé puis modèle ; épuisement total → throw.
- Store : `listActivePlatformKeys` (sqlite in-memory) ne renvoie que les clés `active` ; déchiffrement correct.
- Amorçage : `.env` (`ANTHROPIC_API_KEYS`/`ANTHROPIC_API_KEY`) → enregistrements `platform_llm_keys`.

## Hors scope (non bloqués)

- Quotas par tokens/minute (levier = concurrence).
- Store partagé multi-instance (interfaces `KeyLoadTracker` / fair-queue prêtes ; impl Postgres/Redis ultérieure).
- UI de gestion du pool (P3) et rotation à chaud assistée.
