# Design — Flow Labs : back-office (onboarding self-service + dashboard de gestion)

Statut : validé en brainstorming, à implémenter.
Date : 22 juin 2026.
Nom produit : **Flow Labs** (le nom de l'app n'est PAS Cyran).
Item ROADMAP : P3 « Onboarding self-service » (l'éditeur drag & drop reste P4, anticipé ici via des hooks).

## 1. Objectif

Permettre à un client (ou à un partenaire type MAD CRM pour ses propres clients) de configurer et gérer des agents WhatsApp e-commerce **en autonomie depuis une UI**, sans intervention dev : création d'agent, personnalité, connexion WhatsApp/CRM/IA, test, suivi des leads et de la consommation. Critère de sortie historique : un nouveau client se branche en < 30 min.

## 2. Périmètre & découpage

Le besoin global (UI + multilingue UI **et** contenu bot) se décompose en **deux sous-systèmes** partageant un même modèle de données :

1. **Back-office Flow Labs** — CE spec. Next.js + API admin sur l'engine + auth multi-tenant + i18n UI (FR/EN) + migration des configs en DB (modèle **multilingue-ready**) + wizard de création + dashboard de gestion + capture metering LLM.
2. **Runtime bot multilingue** — sous-système 2, **hors scope ici** (spec ultérieur) : détection de langue du prospect, rendu welcome/erreurs/prompt par langue dans le pipeline live. Le modèle de données est conçu dès maintenant pour le porter sans double migration ; le runtime actuel lit `default_language`.

**Hooks anticipés (à ne pas casser, sans les construire ici)** :
- **P4 — builder drag & drop** : s'embarquera dans l'**espace agent**. `system_prompt` est traité comme l'**artefact compilé** du bot (saisi à la main en P3, généré depuis un graphe en P4). On ajoutera alors une colonne `flow_graph` sans toucher au runtime, qui lit toujours `system_prompt`.
- **P5 — marketplace / commission sur usage / Solution Partner** : la table `llm_usage` (metering) et `audit_log` (traçabilité) en sont la fondation.

## 3. Décisions structurantes (validées)

| Sujet | Décision |
|---|---|
| Stack UI | **Next.js dédiée** (App Router), `apps/web`. Tailwind + **shadcn/ui** (primitives Radix), `lucide-react` pour les icônes, `next-intl` pour l'i18n. |
| Frontière UI/engine | **API REST admin versionnée sur l'engine** (`/api/admin/v1/*`). Next.js = client pur (déployable Vercel ou VPS). L'API sert aussi les partenaires. |
| Source de vérité config | **Migration en DB** : bots + mappings CRM deviennent des tables ; le loader passe derrière une **interface `ConfigStore`** ; import one-shot des JSON existants. |
| Auth & tenance | **Multi-tenant sur invitation**, auth **détenue par l'engine** (JWT + refresh). Rôles `super_admin` (Flow Labs) / `client_admin`. Le client accepte l'invitation et fait son onboarding lui-même. |
| i18n | **UI admin FR + EN dès le départ** (extensible). Contenu bot multilingue = sous-système 2, modèle prêt. |
| Scope CRM | **Bot-scope + fallback client** (cohérent transport/LLM déjà en place). Un client peut avoir plusieurs CRM. |
| Metering LLM | **Capture dès maintenant** (`llm_usage` + `llm_pricing` + écriture dans `chat()` et l'extracteur) + vue read « Usage & coûts ». Facturation/marge = phase ultérieure. |
| Direction visuelle | **Light = direction A** (neutre + accent indigo, clean). **Dark = direction C** (command, accent cyan). Toggle de thème, préférence mémorisée. |

## 4. Architecture & frontières

```
Next.js (apps/web)  ──HTTPS/JWT──▶  Engine (Express) — source de vérité
  App Router                          /api/admin/v1/*  (API admin, séparée du webhook runtime)
  shadcn/ui + Tailwind                  auth · clients · bots · mappings · credentials
  next-intl (FR/EN)                     leads/convos · health · metering · WA connect
  client pur (pas d'accès DB/FS)      ConfigStore (DB) ⇠ remplace bots/*.json + connectors-config/*.json
                                       pipeline runtime existant : INCHANGÉ
contracts (Zod partagé) ── types + validation identiques des deux côtés
```

Principes :
- L'engine **reste la seule source de vérité**. La surface admin est **séparée** du pipeline webhook runtime (qui ne bouge pas). Tous les écrits passent par l'API (jamais le filesystem côté UI).
- **`contracts`** : module de schémas Zod (+ types inférés) partagé engine/Next.js — une seule définition pour la validation API et la validation formulaire. En monorepo : `packages/contracts` ; sinon dossier partagé importé des deux côtés.
- Sécurité reprise de l'existant : credentials chiffrés AES-256-GCM, comparaison constant-time, HMAC webhooks inchangés. Secrets **jamais** renvoyés en clair (masqués `••••1234`).

## 5. Modèle de données

SQLite = JSON en `TEXT`, Postgres = `JSONB` (même patron que `leads.qualified_data`). Champs de contenu localisés : `Localized = { "fr": "...", "en": "..." }`, lus avec fallback sur `default_language`.

**`clients`** : `client_id` (PK), `name`, `status` ('active'|'suspended'), `created_at`, `updated_at`.

**`bots`** (remplace `bots/{client}/{bot}.json`) :
- `id` (PK surrogate), `client_id`, `bot_id` (slug), **UNIQUE(client_id, bot_id)**, `name`
- `transport` ('meta-cloud'|'cm-com'), `status` ('draft'|'active'|'paused')
- `default_language` (ex. 'fr'), `languages` (json `["fr","en"]`)
- `system_prompt` (Localized — artefact compilé, voir hook P4), `lead_fields` (CSV, inchangé)
- `welcome` (json `{ enabled, message: Localized }`), `error_messages` (Localized — messages prospect, multilingue-ready)
- `catalog` (json?), `llm` (json? `{ model, mode }`), `crm` (json? `{ connector }`)
- `created_at`, `updated_at`
- (réservé P4, non créé maintenant : `flow_graph` json)

**`bot_numbers`** : `whatsapp_number` (**PK** → garantit *1 numéro = 1 bot* global), `client_id`, `bot_id`, `created_at`. Power `findBotByNumber`.

**`connector_mappings`** (remplace `connectors-config/{client}/{type}.json`) : `id` (PK), `client_id`, `bot_id` (nullable → null = mapping client-level partagé), `connector`, **UNIQUE(client_id, bot_id, connector)**, `mapping` (json = FieldMapping complet : version, target_object, field_mapping[], fixed_values, default_values, fallback, deduplication), `created_at`, `updated_at`. Résolution : `(client_id, bot_id, connector)` → fallback `(client_id, null, connector)`.

**Auth** :
- **`users`** : `id` (PK), `email` (unique, lower), `password_hash` (null tant qu'invité), `role` ('super_admin'|'client_admin'), `client_id` (null pour super_admin), `status` ('invited'|'active'|'disabled'), timestamps.
- **`invitations`** : `id`, `email`, `client_id`, `role`, `token_hash`, `expires_at`, `accepted_at` (null), `created_at`.
- **`auth_sessions`** : `id`, `user_id`, `token_hash` (refresh haché), `expires_at`, `revoked_at` (null), `created_at`.

**Metering** :
- **`llm_usage`** (append-only, 1 ligne/appel) : `id`, `client_id`, `bot_id`, `phone` (nullable), `call_type` ('chat'|'lead_extraction'), `mode` ('byo'|'platform'), `platform_key_id` (→ `platform_llm_keys.id`, null si byo), `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd` (vrai coût figé à T), `pricing_version`, `anthropic_request_id` (nullable), `created_at`.
- **`llm_pricing`** (référence versionnée) : `id`, `model`, `input_per_mtok`, `output_per_mtok`, `cache_read_per_mtok`, `cache_write_per_mtok`, `currency`, `effective_from`, `effective_to` (null = courant).

**Traçabilité** :
- **`audit_log`** : `id`, `actor_user_id`, `action`, `target` (ex. `bot:acme/immo`), `client_id`, `metadata` (json), `created_at`.

**Accès & migration** :
- Le loader (`loadBotConfig`/`findBotByNumber`/mappings) passe derrière **`ConfigStore`** : `getBot`, `findBotByNumber`, `listBots`, `upsertBot`, `deleteBot`, `getMapping`, `upsertMapping`. Backend DB ; cache + invalidation sur écriture admin (`resetBotConfigCache` existe).
- **Script d'import one-shot**, idempotent, non destructif : `bots/` + `connectors-config/` → tables, en wrappant les champs de contenu en `{ "<default_language>": <valeur> }`. Crée la ligne `clients` `default`.

## 6. API admin, auth & erreurs

**Base** : `/api/admin/v1/*`, montée dans l'Express existant, séparée du webhook runtime. Entrées validées par Zod (schémas `contracts`).

**Forme d'erreur unique** :
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...",
    "details": [{ "path": "email", "message": "..." }], "request_id": "..." } }
```
Codes machine stables (`UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_ERROR`, `WA_VALIDATION_FAILED`, `CRM_VALIDATION_FAILED`, …) → l'UI traduit par code (FR/EN) ; `message` = fallback. Statuts HTTP standard ; conflits → 409 (bot_id pris, numéro déjà routé).

**Auth (engine-owned)** :
- Access token = **JWT court** (~15 min, HS256, `ADMIN_JWT_SECRET`, claims `sub/role/client_id`). Refresh token opaque **stocké haché** dans `auth_sessions`, rotation à chaque refresh, révocable (logout).
- Middlewares : `requireAuth` → `requireRole` → `scopeToClient` (force le `client_id` du JWT ; super-admin transverse via `?client_id` explicite).
- Rate-limit sur `login`/`forgot-password`. Secrets **jamais** renvoyés : GET credentials → `{ configured: true, masked: "••••1234" }`.
- Email (invitations/reset) derrière une interface **`Mailer`** (impl Resend ou SMTP au plan).

**Groupes d'endpoints** :
- `auth/*` : login, refresh, logout, accept-invite, forgot/reset-password, me
- `clients/*` (super-admin) : CRUD client + `clients/:id/invitations` (créer/lister/révoquer)
- `bots/*` : CRUD bot (draft→active), `:botId/status`, `:botId/numbers` (PUT, valide unicité globale)
- `bots/:botId/transport` : `validate` (appel test Meta) puis `PUT` (chiffre creds + configure webhook) ; GET masqué
- `connectors` (catalogue + schéma champs) ; `bots/:botId/mappings/:connector` (PUT/GET, Zod valide FieldMapping) gère le mapping **bot-scope** ; le mapping **client-level** (fallback partagé) est posé par l'import one-shot et, si besoin, via `clients/:id/mappings/:connector` (super-admin) — la résolution runtime fait bot → client ; `bots/:botId/crm/validate` + credentials
- `bots/:botId/llm` (mode byo/platform, model, clé chiffrée si byo)
- `bots/:botId/simulate` (chat in-app : exécute le pipeline LLM sans transport, mode platform+Haiku par défaut)
- Dashboard : `bots/:botId/leads` (paginé/filtré), `.../leads/:phone` (+ conversation), `:botId/health`, `:botId/metrics`, `:botId/usage` (lecture `llm_usage`)
- `bots/:botId/test/session` : lien `wa.me` / QR vers le numéro du bot (test réel)

## 7. Metering LLM

- **Capture** dans `chat()` (chemins byo ET platform) ET dans l'extracteur de leads : à chaque `messages.create`, on lit `response.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) et on écrit une ligne `llm_usage`. Derrière une interface `UsageRecorder` (testable, comme l'event bus).
- **Coût** : `cost_usd` calculé à partir des tokens × tarif courant de `llm_pricing` (cache write ≈ 1,25×, cache read ≈ 0,1× selon Anthropic), **figé** dans la ligne ; `pricing_version` pour ré-auditer.
- **Lecture** : agrégations par client/bot/modèle/période (dashboard global « Usage & coûts » + onglet par agent). En platform → COGS (base de facturation future) ; en byo → tokens informatifs.
- La capture **ne doit jamais bloquer ni ralentir** la réponse (fire-and-forget, échec loggé).

## 8. Surfaces UI

**Trois zones** :
1. **First-run global** (1×) : accueil, langue de travail, « créez votre premier agent », checklist persistante non bloquante.
2. **Créer un agent** (récurrent, léger) : (1) nom + langues → (2) personnalité *light* (prompt texte, champs à extraire, welcome) → (3) **simuler in-app** (clé platform + Haiku par défaut, sans WhatsApp ni clé). Agent en `draft`, testable immédiatement.
3. **Espace de l'agent** (profond, à la demande), onglets :
   - **Vue d'ensemble** : santé (chips WhatsApp/CRM/LLM/langues), métriques, coût 30j, simuler, pause/activer, checklist si incomplet.
   - **Conversations & Leads** : liste paginée/filtrée → détail lead + transcript + données qualifiées.
   - **Personnalité & contenu** : prompt (onglets par langue), champs, welcome par langue, messages d'erreur prospect par langue.
   - **Connexions** : **WhatsApp en tête et mis en évidence** (c'est lui qui débloque l'activation) — BYO guidé + validation + webhook ; puis CRM (connecteur + creds + mapping) ; puis IA (platform ou clé BYO + modèle). Secrets masqués.
   - **Usage & coûts** : détail metering du bot (tokens, modèle, coût par jour/conversation).
   - **Paramètres** : numéros, langues, statut, zone danger.
   - **Builder (P4)** : grisé/à venir.

**Activation** : `draft → active` exige WhatsApp connecté + validé ; CRM et clé LLM restent optionnels (défaut : platform).

**Direction visuelle** :
- **Light = A** : fond neutre clair, panneaux blancs, accent **indigo** (#6366f1), cartes arrondies (radius ~13px), ombres subtiles, typo système/Inter, aéré.
- **Dark = C** : fond sombre (#0b0f17), panneaux #131a26, accent **cyan** (#22d3ee), densité « command ».
- Branding **Flow Labs**. Icônes **lucide**. **Dashboard agents en vue tableau par défaut** (toggle Cartes/Tableau, préférence mémorisée), santé en icônes colorées (vert OK / rouge problème / gris non configuré). Simulateur de chat style WhatsApp avec badge du modèle utilisé.

## 9. Transversal (erreurs, i18n, tests, sécurité)

**Erreurs** :
- API : erreurs structurées (codes stables), validation Zod, statuts cohérents.
- UI : états **loading/empty/error** sur chaque surface async ; validation champ + formulaire (Zod partagé) ; toasts ; error boundaries par route ; 401 → refresh puis login ; 403 → écran dédié ; réseau/offline gérés.
- **Erreurs opérationnelles runtime remontées au dashboard** : token WhatsApp expiré, **dernière erreur de push CRM** (aujourd'hui fire-and-forget → on stocke la dernière erreur par bot et on l'affiche dans la santé).

**i18n** : `next-intl`, FR+EN dès le départ, catalogues de messages, routing par locale, codes d'erreur → messages localisés, formats date/nombre/**devise** par locale. Ajouter une langue = ajouter un catalogue.

**Tests** :
- API engine : Vitest unit + intégration (contre l'app Express) — endpoints, middlewares auth, validation, **enforcement du scope client**, masquage secrets, écriture `llm_usage`. `ConfigStore` (sqlite in-memory). Script d'import.
- `contracts` (Zod) testés.
- Next.js : tests composants (Vitest + Testing Library) sur formulaires/validation ; **e2e Playwright** limité aux parcours critiques (login/accept-invite, créer agent + simuler, valider WhatsApp, dashboard).

**Sécurité / ops** : secrets chiffrés AES-GCM + masqués ; `ADMIN_JWT_SECRET` ; rate-limit auth ; CORS restreint à l'origine web ; HTTPS ; **`audit_log`** des mutations admin (fondation conformité P5).

## 10. Décomposition & séquencement (pour le plan)

Chaque tranche produit du logiciel livrable/testable :
1. **Fondation back** : `ConfigStore` + tables (clients/bots/bot_numbers/connector_mappings) + script d'import + bascule du loader runtime sur la DB (runtime inchangé fonctionnellement).
2. **Metering** : `llm_usage` + `llm_pricing` + `UsageRecorder` câblé dans `chat()` + extracteur (capture au plus tôt).
3. **Auth & API** : users/invitations/auth_sessions, JWT + middlewares, `contracts`, endpoints auth + clients + invitations + Mailer.
4. **API config** : bots/numbers/mappings/credentials/transport-validate/crm-validate/llm/simulate + leads/health/metrics/usage + audit_log.
5. **App Next.js — fondation** : shell (nav, thème A/C, i18n FR/EN), auth (login/accept-invite), design system shadcn.
6. **App — onboarding** : wizard création + simulateur.
7. **App — dashboard** : liste agents (table) + espace agent (onglets) + Usage & coûts.

## 11. Hors scope (non bloqués)

- Runtime bot multilingue (sous-système 2 : détection langue + rendu par langue).
- Builder drag & drop P4 (`flow_graph` réservé).
- Meta Embedded Signup (full auto) — V1 = BYO guidé + validation.
- Facturation/marge/quotas/plans (`client_billing`) — le metering en est la base.
- Bibliothèque de connexions CRM nommées (V1 = bot-scope + fallback client).
- Open self-signup (V1 = invitation).
