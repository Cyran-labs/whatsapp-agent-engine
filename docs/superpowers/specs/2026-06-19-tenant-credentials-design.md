# Design — Credentials chiffrés par tenant

Statut : validé en brainstorming, à implémenter.
Date : 19 juin 2026.
Item ROADMAP : P3 (fondation) / clôture du point P2 « credentials Meta -> DB par tenant chiffrés ».

## Objectif

Sortir les credentials (LLM, transport, CRM) des variables d'environnement globales vers un stockage par tenant, chiffré au repos, chargé au runtime via une couche de résolution unique. Permettre deux modèles économiques sur le même moteur sans s'enfermer : BYO (le client apporte sa clé LLM, mode API/wholesale) et plateforme (Cyran fournit l'IA, mode SaaS).

Hors scope (item de résilience ultérieur) : pool multi-clés, quotas par tenant, contrôle de concurrence. Le schéma les permet mais on ne les code pas ici.

## Contexte et état actuel

- Les credentials sont aujourd'hui globaux dans `.env`, exposés via `src/core/config.ts` (un seul app Meta, une seule clé Anthropic, un seul token HubSpot).
- La config des bots vit en fichiers JSON `bots/{client_id}/{bot_id}.json` ; `BotConfig` déclare `transport`, `crm.connector`, `llm.model` mais aucun secret. Elle reste en fichiers (l'UI P3 qui l'écrira est un autre item).
- L'abstraction DB (`src/core/database/`) sélectionne le driver via `DATABASE_URL` : Postgres en prod, SQLite en dev/test. Décision confirmée : on garde cette abstraction ; prod hébergée sur Supabase comme fournisseur Postgres (connection string), le moteur reste Postgres-générique. Les features propriétaires Supabase (Auth, RLS, Realtime) sont réservées à la couche UI P3, pas au cœur moteur.

## Décisions structurelles (validées)

1. Granularité hybride : transport par bot, LLM et CRM par client. Résolution avec fallback bot-scope -> client-scope -> `.env`.
2. Modèle byo/platform pour le LLM, derrière un resolver, pour ne pas figer le modèle économique. Même patron que `getTransport()` / `createConnector()`.
3. La clé LLM est par client. BYO = isolation native des rate limits (pool Anthropic propre au client). Platform = pool Cyran (aujourd'hui une seule clé env ; pool/quotas = item futur).
4. Stockage : blob JSON chiffré (évite l'explosion de colonnes ; chaque transport/CRM a des champs différents).
5. Chiffrement AES-256-GCM, KEK depuis l'env, `key_version` pour rotation future. Envelope encryption (DEK par tenant) reportée (YAGNI).

## Modèle de données

Table `tenant_credentials` :

| Colonne | Type | Rôle |
|---|---|---|
| `id` | clé primaire | |
| `client_id` | text not null | tenant |
| `bot_id` | text null | NULL = portée client ; renseigné = portée bot |
| `service` | text not null | `llm` \| `transport` \| `crm` |
| `provider` | text not null | `anthropic`, `meta-cloud`, `cm-com`, `hubspot`, `salesforce`, `zoho`, `pipedrive`, `attio`, `webhook-generic` |
| `mode` | text not null | `byo` \| `platform` (pertinent pour `llm` ; `byo` par défaut ailleurs) |
| `secret_encrypted` | blob/bytea not null | enveloppe AES-256-GCM du JSON des params de connexion |
| `key_version` | integer not null default 1 | version de la KEK utilisée |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Contrainte d'unicité : `(client_id, bot_id, service, provider)`.

Le blob déchiffré est un JSON propre à chaque provider, contenant secrets ET config de connexion (chiffrer la config non sensible est sans coût et simplifie). Exemples :
- `meta-cloud` : `{ phone_number_id, access_token, app_secret, verify_token }`
- `cm-com` : `{ product_token, from_number, service_url }`
- `anthropic` (byo) : `{ api_key }`
- `anthropic` (platform) : `{}` (la clé vient du pool plateforme, pas de l'enregistrement)
- `hubspot` : `{ access_token }`
- `salesforce` : `{ instance_url, access_token }`
- `zoho` : `{ access_token, api_domain }`

## Chiffrement

Module `src/core/credentials/crypto.ts`, pur (aucune dépendance DB) :
- `encrypt(plaintext: string): EncryptedEnvelope` et `decrypt(env: EncryptedEnvelope): string`.
- Algorithme : AES-256-GCM. IV aléatoire 12 octets par opération. Enveloppe stockée = concaténation `iv (12) ‖ authTag (16) ‖ ciphertext`, encodée (base64 ou bytea brut selon le driver).
- KEK lue depuis `process.env.CREDENTIALS_ENCRYPTION_KEY` (32 octets ; acceptée en hex ou base64). Validation de longueur au chargement.
- Fail-closed : `encrypt`/`decrypt` lèvent une erreur explicite si la KEK est absente ou de mauvaise taille. (Le resolver, lui, retombe sur `.env` quand il n'y a aucun enregistrement — voir Migration — donc le dev sans KEK ni record continue de tourner.)
- `key_version` stocké par enregistrement ; `decrypt` choisit la clé selon la version. Aujourd'hui une seule version. Permet une rotation future sans changement de schéma.

GCM fournit l'authentification : toute falsification du blob fait échouer le déchiffrement (tag invalide).

## Couche de résolution

Module `src/core/credentials/`, trois unités à responsabilité unique :

- `crypto.ts` — chiffrement pur. In : plaintext + KEK. Out : enveloppe. Testable seul.
- `store.ts` — accès DB uniquement. `getCredential(clientId, botId|null, service, provider)`, `upsertCredential(...)`, `listCredentials(clientId)`. Renvoie des enregistrements chiffrés ; ne déchiffre pas. S'appuie sur l'interface `Database` (méthodes ajoutées + implémentations sqlite/postgres).
- `resolver.ts` — compose store + crypto, porte la logique byo/platform et le fallback. Seul module appelé par le reste du moteur.

API du resolver :
- `resolveTransportCredentials(bot: BotConfig): TransportCredentials` — lit `(client_id, bot_id, 'transport', bot.transport)`, déchiffre, renvoie la config attendue par `getTransport`.
- `resolveLlmCredentials(clientId, botId): { apiKey: string; quotaContext?: QuotaContext }` — lit l'enregistrement `llm`. Si `mode='byo'` : renvoie la clé client déchiffrée. Si `mode='platform'` : renvoie une clé du pool plateforme (aujourd'hui : une seule clé depuis l'env) et un `quotaContext` (no-op pour l'instant, réservé à l'item résilience).
- `resolveCrmCredentials(clientId, connectorType): ConnectorCredentials` — lit l'enregistrement `crm`, déchiffre, renvoie la config attendue par `createConnector`.

Ordre de résolution (fallback) : enregistrement bot-scope, sinon client-scope, sinon valeurs `.env` (compatibilité ascendante).

Point de consommation : les sites d'instanciation transport/LLM/CRM du moteur appellent le resolver au lieu de lire `config.*`. C'est le seul couplage introduit.

## Migration depuis `.env`

Script one-shot `scripts/seed-credentials.ts` :
- Lit les globals `.env` actuels et écrit des enregistrements chiffrés pour le client `default` :
  - meta -> `(default, null, 'transport', 'meta-cloud')` au niveau client (il n'y a qu'une config Meta globale dans `.env`) ; le fallback bot -> client du resolver suffit à servir tous les bots du client default
  - anthropic -> `(default, null, 'llm', 'anthropic', mode='byo')` (préserve le comportement actuel : le client default utilise exactement cette clé)
  - hubspot -> `(default, null, 'crm', 'hubspot')`
- Non destructif : tant qu'aucun enregistrement n'existe, le resolver retombe sur `.env`. Rien ne casse ; la bascule est progressive (les enregistrements priment dès qu'ils existent).

## Config et sécurité

- Ajout de `CREDENTIALS_ENCRYPTION_KEY` dans `config.ts` et `.env.example` (documentée comme requise pour utiliser le stockage chiffré).
- `crypto` fail-closed sur KEK manquante/invalide.
- Cohérent avec le durcissement déjà fait (meta-cloud, dashboard) : on échoue plutôt que de dégrader silencieusement la sécurité.

## Architecture des modules (isolation)

- `crypto.ts` : que fait-il ? chiffrer/déchiffrer. Dépendances : KEK env. Testable sans DB.
- `store.ts` : que fait-il ? lire/écrire des enregistrements chiffrés. Dépendances : `Database`. Aucune crypto.
- `resolver.ts` : que fait-il ? fournir au moteur des credentials prêts à l'emploi, en gérant byo/platform et le fallback. Dépendances : store + crypto.
- Interface `Database` : ajout de `getCredential`, `upsertCredential`, `listCredentials`, implémentées dans `sqlite.ts` et `postgres.ts`.

## Tests (Vitest)

- crypto : round-trip encrypt/decrypt ; détection de falsification (tag GCM altéré) ; mauvaise clé rejetée ; KEK absente -> erreur.
- store : upsert puis get (SQLite in-memory) ; unicité `(client_id, bot_id, service, provider)`.
- resolver : `byo` renvoie la clé client ; `platform` renvoie la clé plateforme ; fallback `.env` quand aucun enregistrement ; bot-scope prioritaire sur client-scope.

## Hors scope (items ultérieurs, non bloqués par ce design)

- Pool multi-clés plateforme, quotas par tenant, contrôle de concurrence (item « résilience LLM »). Le discriminant `mode` et `quotaContext` réservent la place.
- Migration de la config bot en DB et UI d'onboarding (P3).
- Isolation multi-tenant via RLS Supabase et features propriétaires (couche UI P3).
- Rotation effective de la KEK (mécanique permise par `key_version`, procédure à définir le moment venu).
