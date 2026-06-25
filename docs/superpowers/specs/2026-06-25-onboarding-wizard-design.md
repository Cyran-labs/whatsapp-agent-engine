# Plan 6 — Onboarding (wizard de création + simulateur) — Design

Date : 2026-06-25
Statut : validé (brainstorming), prêt pour `writing-plans`.

## 1. Contexte et objectif

Le Plan 5 a livré la fondation de l'app Next.js (`apps/web`) : monorepo, `@wabagent/contracts`,
shell, auth BFF (cookies httpOnly), i18n FR/EN, design system Émeraude-Ambre, e2e Playwright.
La page `(app)/page.tsx` n'est qu'un stub « FirstRunPage ».

Objectif du Plan 6 : permettre à un utilisateur authentifié de **créer son premier agent en
self-service**, via un wizard guidé, et de **le tester gratuitement en simulation**, le tout en
restant cohérent avec la charte. L'agent est créé en statut `draft` ; sa mise en ligne
(connexion WhatsApp + activation) relève du Plan 7.

## 2. Périmètre

Dans le périmètre (Plan 6) :

- **Engine** : champ `personality` (localisé, structuré) persisté sur les bots + helper de
  migration idempotent (ensure-column) + module de composition du `system_prompt` côté serveur
  (cf. §3.2 et §5.2). Évolution des contrats `CreateBotInput`/`UpdateBotInput`.
- Page d'accueil **first-run + checklist d'onboarding** (remplace le stub).
- **Wizard de création** en 3 étapes : Identité -> Personnalité -> Tester.
- **Simulateur de chat** in-app (gratuit, plateforme + Haiku).
- **Écran de succès** après création du draft.
- BFF : routes Next `/api/bots/*` proxy vers l'engine (Bearer via cookie), comme le pattern auth.
- i18n FR/EN de tous les nouveaux écrans.
- Tests unitaires (Vitest/RTL) + e2e Playwright du parcours complet (avec mock-engine).

Hors périmètre (Plan 7) :

- Liste d'agents complète (table) + espace agent (onglets, dashboard, conversations/leads).
- Connexion WhatsApp (BYO + validation) et activation du bot.
- Usage & coûts détaillé, Paramètres.

Référence structurelle Plan 7 (à re-skinner Émeraude-Ambre) :
`.superpowers/brainstorm/53521-1782117013/content/hifi-agent-space.html` (+ `hifi-dashboard`, `hifi-table-v2`).

## 3. Architecture

### 3.1 API engine consommée (déjà livrée)

| Action | Endpoint admin | Contrat | Notes |
|---|---|---|---|
| Lister agents | `GET /api/admin/v1/bots` | `BotSummary[]` | vide => first-run |
| Créer agent (draft) | `POST /api/admin/v1/bots` | `CreateBotInput` -> `BotDetail` | statut forcé à `draft` côté engine |
| Modifier | `PATCH /api/admin/v1/bots/:id` | `UpdateBotInput` -> `BotDetail` | retour arrière dans le wizard |
| Simuler | `POST /api/admin/v1/bots/:id/simulate` | `SimulateInput` -> `{session_id, reply, model}` | `use_bot_config:false` = gratuit |

Le Plan 6 **fait évoluer** l'engine et les contrats (cf. §3.2) : `CreateBotInput`/`UpdateBotInput`
acceptent un champ `personality` optionnel, et le `system_prompt` devient dérivable côté serveur
pour les langues guidées.

### 3.2 Engine — persistance et composition de la personnalité

- **Schéma** : nouvelle colonne `personality` sur la table `bots` (SQLite `TEXT` JSON, Postgres `JSONB`),
  nullable. Type `BotRecord.personality: Localized<{ role, tones, objective, info }> | null`.
- **Migration** : il n'existe aucun mécanisme de migration aujourd'hui (`CREATE TABLE IF NOT EXISTS`
  seulement). On ajoute un helper **idempotent ensure-column** appelé à l'init du schéma :
  - SQLite : lire `PRAGMA table_info(bots)`, `ALTER TABLE bots ADD COLUMN personality TEXT` si absent.
  - Postgres : `ALTER TABLE bots ADD COLUMN IF NOT EXISTS personality JSONB`.
  Ce helper est la **brique d'extensibilité** : toute future capacité du bot = une colonne typée + un
  appel ensure-column, sans casser les bases existantes.
- **Composition** : module engine `composeSystemPrompt(personality[lang], lang) -> string` à partir
  d'un gabarit **localisé** (FR/EN). Appelé dans `createBot`/`updateBot` (cf. §5.2).

### 3.3 BFF Next.js

Nouvelles route handlers Next, mêmes conventions que `/api/auth/*` (Plan 5) :

- `GET  /api/bots` -> proxy `GET /bots`
- `POST /api/bots` -> proxy `POST /bots`
- `PATCH /api/bots/[botId]` -> proxy `PATCH /bots/:id`
- `POST /api/bots/[botId]/simulate` -> proxy `POST /bots/:id/simulate`

Elles utilisent `engineFetch` (Bearer depuis le cookie `wab_access`, refresh auto sur 401).
Aucun token n'est exposé au navigateur. Les erreurs engine sont normalisées comme en Plan 5.

### 3.4 Pages web

- `app/[locale]/(app)/page.tsx` : **accueil onboarding** (first-run + checklist dérivée). Remplace le stub.
- `app/[locale]/(app)/agents/new/page.tsx` : **wizard** (composant client à état local).
- Le wizard est un composant client mono-page à 3 étapes (état en mémoire), pas une route par étape,
  pour conserver les saisies sans aller-retour serveur. La création (POST) se fait à la fin de l'étape 2.

## 4. Parcours utilisateur

```
0 bot  -> Accueil first-run (hero + checklist, étape 1 active) -- CTA --> Wizard
Wizard E1 Identité (nom, langues, langue par défaut)
       -> E2 Personnalité (guidé + prompt brut, accueil, champs) -- POST draft -->
       -> E3 Tester (simulateur gratuit) -- Terminer -->
Écran de succès (récap draft, "connecter WhatsApp" en aperçu Plan 7) -> Accueil
```

Maquettes de référence (à la charte, validées le 25 juin) :
`.superpowers/brainstorm/62043-1782384014/content/` : `01-first-run`, `02-wizard-step1`,
`03-wizard-step2`, `04-wizard-step3`, `05-success`.

### 4.1 Accueil first-run + checklist

- Si `GET /bots` renvoie une liste vide : hero « Bienvenue sur WABAGENT » + checklist 4 étapes
  + CTA « Créer mon premier agent ».
- Si >= 1 bot : même page, checklist reflétant l'avancement (« Créer l'agent » coché) + un
  rappel minimal « N agent(s) — brouillon » + CTA « Créer un agent ». La liste complète et les
  liens vers la fiche agent arrivent au Plan 7 (pas de table ici).
- La **checklist est dérivée** des données, sans table d'état d'onboarding (cf. §6).

### 4.2 Wizard E1 — Identité

Champs : nom (texte), langues (multi-select FR/EN/...), langue par défaut (radio parmi les langues cochées).

- Le `bot_id` (slug) est **généré automatiquement** depuis le nom (minuscules, tirets), affiché et
  modifiable. Regex engine : `^[a-z0-9][a-z0-9-]*$`. En cas de collision (409 `bot_id déjà pris`),
  l'UI suffixe `-2`, `-3`, ... et réaffiche le slug.
- Le **transport n'est pas demandé** dans le wizard. À la création, on envoie `transport:'meta-cloud'`
  par défaut ; le choix/branchement réel se fait au Plan 7 (Connexions).

### 4.3 Wizard E2 — Personnalité

Réglages **par langue** (onglets FR/EN). Deux modes :

- **Guidé** (par défaut) : rôle/métier, ton (chips), objectif principal, informations clés (texte libre).
  Ces champs composent un `system_prompt` par langue, côté client (cf. §5.2).
- **Avancé (dépliable)** : le `system_prompt` généré, **éditable**. Dès que l'utilisateur édite le texte
  brut pour une langue, ce texte fait foi pour cette langue (le mode guidé ne l'écrase plus).

Plus, sur la même étape :

- **Message d'accueil** : toggle (activé/désactivé) + texte par langue -> `welcome {enabled, message}`.
- **Informations à collecter** : tags -> joints en une chaîne `lead_fields` (séparateur « , »).

À la fin de l'étape 2, bouton « Créer & tester » : **POST `/api/bots`** avec `CreateBotInput` complet.
Si l'utilisateur revient ensuite à E1/E2 puis ravance, on **PATCH** le draft (idempotent).

### 4.4 Wizard E3 — Tester

- Simulateur type messagerie : on affiche d'abord le `welcome.message` (si activé), puis l'échange.
- Chaque envoi appelle `POST /api/bots/:id/simulate` avec `{session_id?, message, use_bot_config:false}`.
  Le premier appel ne passe pas de `session_id` ; la réponse renvoie un `session_id` réutilisé ensuite.
- Bandeau explicite « Simulation gratuite — clés plateforme, modèle Haiku, aucune consommation quota ».
- Bouton « Réinitialiser » : oublie le `session_id` côté client (nouvelle conversation).
- Bouton « Terminer » -> écran de succès.

### 4.5 Écran de succès

- Récap : nom, langues, statut `Brouillon`.
- Carte « Connecter WhatsApp » en **aperçu désactivé** (tag « Plan 7 »).
- Actions : « Retour aux agents » (accueil), « Modifier la personnalité » (ré-ouvre le wizard E2 sur le draft).

## 5. Mapping vers `CreateBotInput`

### 5.1 Champs

```
bot_id            <- slug(nom) (modifiable, collision -> suffixe)
name              <- nom
transport         <- 'meta-cloud' (défaut, non demandé)
default_language  <- radio langue par défaut
languages         <- langues cochées
personality       <- { [lang]: { role, tones[], objective, info } } pour les langues en mode guidé
system_prompt     <- { [lang]: texte } UNIQUEMENT pour les langues en mode avancé/brut (cf 5.2)
welcome           <- { enabled, message: { [lang]: texte } }
lead_fields       <- tags.join(', ')
error_messages    <- {}    (défaut)
catalog           <- null  (défaut)
llm               <- null  (défaut => plateforme)
crm               <- null  (défaut)
```

### 5.2 Personnalité : champs guidés persistés + composition côté engine (décision)

Modèle de données :

- Nouveau champ **`personality`** (localisé, optionnel) :
  `{ [langue]: { role: string; tones: string[]; objective: string; info: string } }`.
- **`system_prompt`** (existant, localisé) reste le texte utilisé par le runtime.

Règle de composition (**côté engine**, à la création et à la mise à jour) :

- Pour chaque langue présente dans `personality`, l'engine **compose** `system_prompt[langue]` à
  partir du gabarit localisé. -> mode **guidé**.
- Pour chaque langue absente de `personality` mais avec un `system_prompt[langue]` fourni, l'engine
  **stocke le texte tel quel**. -> mode **avancé/brut**.
- Une langue est donc soit guidée (personality présent, prompt recomposé), soit brute (personality
  absent, prompt préservé). **Jamais d'écrasement d'un prompt édité à la main.**

Re-hydratation (retour wizard, et Plan 7 « Personnalité & contenu ») :

- `personality[langue]` présent -> formulaire **guidé** pré-rempli.
- absent -> mode **avancé** montrant `system_prompt[langue]`.

Gabarit de composition (FR ; équivalent EN), lignes à champ vide omises :

```
Tu es {role}.
Ton ton est : {tones joints}.
Ton objectif principal : {objective}.
Informations à connaître : {info}.
Réponds en {langue}, en messages courts adaptés à WhatsApp.
```

Templates fournis pour **FR et EN**. Une langue sans template doit fournir un `system_prompt` brut
(le mode guidé y est désactivé). Pour le Plan 6 (FR/EN), le cas ne se pose pas.

Contrat : `CreateBotInput`/`UpdateBotInput` acceptent `personality` (optionnel). `system_prompt`
devient **optionnel à l'entrée** (l'engine le remplit pour les langues guidées) mais l'engine
**garantit en sortie** un `system_prompt` non vide pour `default_language` — au moins une source
(personality ou prompt brut) doit exister pour la langue par défaut, sinon erreur de validation.

## 6. Checklist dérivée (logique)

État calculé à partir de `GET /bots` (et du détail du bot le plus pertinent), sans persistance dédiée :

| Étape | Condition « faite » | Plan |
|---|---|---|
| 1. Créer l'agent | au moins un bot existe | 6 |
| 2. Personnaliser & tester | le bot a un `system_prompt` non vide pour `default_language` | 6 |
| 3. Connecter WhatsApp | transport configuré (lecture masquée `GET /bots/:id/transport`) | 7 |
| 4. Activer l'agent | `status === 'active'` | 7 |

Au Plan 6, les étapes 3 et 4 sont affichées en aperçu verrouillé (aucune action UI pour les réaliser
n'existe encore). L'étape « active » se base sur `BotSummary.status`.

## 7. Direction visuelle

- Charte **Émeraude-Ambre** (source de vérité : `marketing/design-reference-emeraude-ambre.html`).
- **Aucun gradient** (aplats uniquement) — règle actée le 25 juin.
- Typo : titres serif (Fraunces/Source Serif), corps Inter/system-ui, mono JetBrains pour le prompt brut.
- États fonctionnels (success/danger/...) inchangés en sombre. Dark mode supporté (tokens `.dark`).
- Composants nouveaux : stepper, chips multi-select, onglets de langue, tags input, zone de chat, switch.

## 8. i18n

- Toutes les chaînes des nouveaux écrans dans `apps/web/messages/{fr,en}.json` (namespaces dédiés :
  `onboarding`, `wizard`, `simulate`, `agents`).
- Le contenu **saisi** par l'utilisateur (prompt, accueil) est par langue d'agent (FR/EN) et est
  distinct de la langue d'**interface** (locale next-intl). Ne pas confondre les deux.

## 9. Tests

- Engine (Vitest) : helper ensure-column idempotent (colonne absente -> ajoutée, présente -> no-op),
  round-trip `personality` en DB (SQLite + Postgres si testé), `composeSystemPrompt` (FR/EN, champs
  vides omis), règle guidé->compose / brut->préservé dans `createBot`/`updateBot`, validation
  `default_language` (au moins une source).
- Contrats (Vitest) : `personality` optionnel, `system_prompt` optionnel à l'entrée.
- Web unitaires (Vitest/RTL) : slug/collision, bascule guidé->avancé (drop personality de la langue),
  dérivation checklist, mapping payload, gestion session simulateur.
- BFF : route handlers `/api/bots/*` (succès, 401->refresh, erreurs normalisées), aucun token ne fuite.
- e2e Playwright (mock-engine) : parcours complet 0 bot -> wizard 3 étapes -> simulate -> succès ;
  + cas retour arrière (PATCH) et collision de slug.

## 10. Décisions actées

1. Atterrissage = **écran de succès minimal** (liste/dashboard = Plan 7).
2. Personnalité = **guidé + accès au prompt brut**. Les **champs guidés sont persistés** (`personality`,
   par langue) et la **composition se fait côté engine** ; les langues éditées en brut sont préservées.
   Ré-hydratation du formulaire guidé garantie — cf §3.2 et §5.2.
3. First-run **+ checklist persistante**, mais **dérivée** des données (pas de table d'état).
4. **Slug auto** depuis le nom, visible et modifiable.
5. **Transport hors wizard** : défaut `meta-cloud`, choix réel au Plan 7.
6. Simulateur **gratuit** : `use_bot_config:false` (Haiku + plateforme), applique déjà la persona du draft.
7. **Aucun gradient** dans l'app.
8. Création du draft (**POST**) à la fin de l'étape 2 ; retours arrière -> **PATCH**.
9. **Stockage extensible** : colonne typée sur `bots` + helper ensure-column idempotent (SQLite/Postgres).
   Patron réutilisable pour toute future capacité du bot (un champ = une colonne + un ensure-column).
