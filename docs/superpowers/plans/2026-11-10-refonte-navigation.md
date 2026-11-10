# Plan de la refonte de la navigation du back-office

> **Pour les exécutants :** sous-skill requise : superpowers:subagent-driven-development (mode retenu), tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`). Registre du plan : `.superpowers/sdd/2026-11-10-refonte-navigation/progress.md` (chaque décision prise en cours d'exécution y est écrite sur une ligne `Ruling:`).

**Objectif :** que chaque page connectée nomme l'organisation à deux endroits fixes, que le statut d'un agent IA dise ce qui se passe vraiment (« Ne répond pas »), que le conseiller ne voie ni coûts ni numéros de contacts hors de son entité, le moteur le lui refusant, et que chaque page ait au plus une action principale.

**Architecture :** le moteur gagne trois lectures et un refus : la règle « Ne répond pas » (fonction pure des contrats, appelée par le moteur et exposée en champ `not_responding`), l'action `usage.read` réservée à l'admin, le masquage des numéros de contacts selon `canSeeContactNumbers`, et le nom obligatoire de la première entité à la création d'une organisation. Le faux moteur des tests Playwright reproduit chaque changement dans la tâche qui le fait. Le web remplace la barre sombre par un rail sombre à gauche, garde la colonne blanche du milieu qui commence par le bloc Organisation, et réduit la barre du haut au fil d'Ariane et à l'action principale ; les pages, l'assistant et le vocabulaire sont ensuite repris page par page.

**Tech :** moteur Express et TypeScript (SQLite et Postgres), contrats `@wabagent/contracts` (Zod), Next.js App Router, React, next-intl, Tailwind (jetons de `apps/web/tailwind.config.ts`), `lucide-react`, Vitest et Testing Library, Playwright avec le faux moteur `apps/web/e2e/mock-engine.ts` et `mock-state.ts`.

**Spec (fait autorité) :** `docs/superpowers/specs/2026-11-10-refonte-navigation-design.md`, sections 1 à 20. Les choix de Claude (section 19) sont acquis pour l'exécution (section 20) et deviennent des étapes de la recette. L'exécutant lit la section de la spec citée par sa tâche avant d'écrire une ligne. Maquettes : disposition et aspect seulement ; en cas d'écart, la spec fait foi.

## Choix du rédacteur (contestables, à présenter à la recette)

Ces décisions comblent ce que la spec laisse au constructeur (section 18) ou tranchent un écart constaté dans le code. Les relecteurs de tâche les reçoivent comme contestables.

- **P-1. Compteur « Messages » de la liste (spec 10.2).** `getBotMetrics` (`src/core/database/sqlite.ts:644`) compte tous les messages depuis la création, sans période. La colonne garde le libellé « Messages » sans « 30 j ». Le libellé `overview.statMessages` (« Messages 30 j ») est faux aujourd'hui pour la même raison : il devient « Messages » (tâche 14).
- **P-2. Action de l'encadré « Ne répond pas » pour un compte WhatsApp en erreur (spec 10.3).** La fenêtre « Remplacer les identifiants » vit dans Connexions ; l'encadré de la page de l'agent IA porte le lien « Ouvrir Connexions ↗ » (vers `/organisation/connexions`) et non un second point d'entrée de la fenêtre. Motif `number_removed` (non cité par la spec) : action « Changer de numéro » (bouton existant de l'encart Numéro WhatsApp).
- **P-3. Format du masque d'un numéro de contact (spec 9.2, section 18).** Valeur faite de chiffres, précédés ou non de « + », d'au moins 9 chiffres : `+` puis les 5 premiers chiffres, `•• ••`, les 2 derniers (`+33612 •• •• 78`). Moins de 9 chiffres : `••••`. Toute autre valeur (BSUID) : ses 2 premiers caractères puis `••••` (`US••••`), `••••` si elle fait 4 caractères ou moins.
- **P-4. Barre du haut (section 18).** Chaque page rend sa barre (`PageBar`) en tête de sa zone de contenu, collante en haut ; il n'y a pas de contexte qui remonte le fil d'Ariane vers un gabarit. Le bandeau d'organisation (`OrgNoticeBanner`) reste en haut de l'écran, au-dessus du rail compris (spec 5.3).
- **P-5. Gris de Draft et d'Offline (spec 6.2).** Draft : fond `surface`, contour `border-strong`, texte `muted`, point contour seul. Offline : fond `surface-subtle`, texte `muted-2`, point plein `muted-2`.
- **P-6. Rail (section 18).** Largeur 84 px ; icônes `lucide-react` : Organisation `Building2`, Agents IA `Bot`, Usage `BarChart3`, Leads `MessagesSquare`, Reprise `Headset`, Aide `CircleHelp` (l'exécutant prend le nom équivalent de la version installée si l'un manque, et l'écrit au registre).
- **P-7. Période des pages d'usage (spec 10.4, 10.8).** État local de la page, 30 jours par défaut, pas dans l'adresse.
- **P-8. Confirmation de sortie de l'assistant (spec 12.4).** Fenêtre « Quitter la création ? », texte « Ce que vous avez saisi n'est pas encore enregistré. », boutons « Rester » et « Quitter sans enregistrer ».
- **P-9. Titre de fin de l'assistant après activation (spec 12.3 contre 6.1).** La spec garde « {nom} est en ligne », qui contredit le vocabulaire pour un agent IA en Preview. Titre retenu : « {nom} est Online » ou « {nom} est en Preview », comme l'encadré d'état de la colonne (spec 12.1).
- **P-10. Texte du moteur, compte WhatsApp encore utilisé.** « Passez d'abord Offline les agents IA qui utilisent ce compte : » suivi des noms (au lieu de « Désactivez d'abord… »).
- **P-11. Script de création d'une organisation.** Le nom de la première entité est le quatrième argument, après l'adresse de l'admin : `<client_id> "<Nom>" <email_admin> "<Nom de la première entité>"`.

## Contraintes globales

- Règles non négociables de `CLAUDE.md` : multi-organisations, journaux `[Service] message` sans donnée sensible (`npm run check:logs`), aucun repli sur des identifiants de plateforme.
- Codes moteur inchangés : `draft`, `limited`, `active`, `paused` (`packages/contracts/src/bot-status.ts:7`). Seuls les mots affichés changent.
- Le web ne lit un refus que par `describeFailure` ; un nouveau refus du moteur passe par là.
- Machine d'états, décisions de branchement et règle « Ne répond pas » : `packages/contracts/src/bot-status.ts`, appelées par le moteur ; le web ne recalcule jamais la mention à partir de champs épars.
- Le faux moteur (`apps/web/e2e/mock-engine.ts`, `mock-state.ts`) reproduit, dans la tâche qui les fait, le refus des coûts, le masquage des numéros et le champ `not_responding`, en appelant les mêmes fonctions des contrats.
- Aucun fichier de `src/webhooks/`, `src/transport/`, `src/whatsapp/` ni `src/core/router.ts` n'est modifié (spec 15.8).
- Rien n'est déployé ; aucune entité existante n'est renommée.
- Charte : jetons de `tailwind.config.ts` seulement, menthe en accent, aucun dégradé, aucune couleur codée en dur nouvelle. Pas de version mobile.
- Textes : français avec tous les accents ; aucun tiret cadratin ni demi-cadratin nulle part ; « agent IA » / « AI agent », jamais « agent » seul ; exception actée pour **Draft, Preview, Online, Offline, Whitelist, New, Soon** (majuscule, jamais accordés ni conjugués) ; en anglais « Whitelist » se dit « Allowlist ». FR et EN ont les mêmes clés (`apps/web/src/i18n/__tests__/messages-style.test.ts`).
- Appels côté client : `apiFetch` / `sendMutation`, puis `if (await isOrgChanged(res)) return;`. Routes BFF : `engineFetch`, `errorResponse`, `rejectNonNumericId`.
- Un élément sans effet le dit : entrée grisée `aria-disabled="true"`, non lien, bulle au survol et au focus clavier.
- Tests moteur HTTP : `request(await serve(app))` (`src/test-support/http.ts`). Tests de base : `createTestDatabase()` (`src/test-support/test-database.ts`), donc SQLite et Postgres. Un test qui protège un point de la section 15 porte son repère en commentaire (`// nav 15.5`) ; un test qui protège un problème du prototype, le sien (`// prototype 9`).
- Commandes de fin de tâche selon la portée : moteur `npm test`, `npm run test:pg`, `npm run typecheck`, `npm run typecheck:tests`, `npm run check:tests`, `npm run check:logs` ; web `npm test -w @wabagent/web`, `npx tsc --noEmit` dans `apps/web` ; toute tâche qui touche l'interface ou le faux moteur : `npx playwright test` dans `apps/web`, entièrement vert. Un test e2e cassé par la navigation est réécrit sur la nouvelle interface sans retirer d'assertion de comportement.
- Commits : 1 commit = 1 sujet, message en français `type(portée): résumé` puis corps factuel ; auteur `Francois Greze <francois@cyran.fr>` ; aucune signature Claude ou Anthropic ; aucun push ni merge sans accord explicite de François.

## Points d'attention de la revue

Cas que la spec implique sans les tester ; chacun a son test dans la tâche citée.

1. Numéros de contacts de formes variées (`33699999999` sans « + », `+1234`, BSUID `US.abc123`, chaîne vide) : le masque ne contient jamais la valeur entière, ni ses chiffres consécutifs au-delà de 5. Tâche 3.
2. Agent IA sans entité (`entity_id` nul, organisations anciennes) : seuls l'admin, l'opérateur et le super manager voient les numéros en entier ; un conseiller ou un manager les reçoit masqués. Tâche 3.
3. Nom d'organisation long (80 caractères) dans le bloc Organisation et le fil d'Ariane : tronqué sur une ligne avec le nom entier en `title`, jamais de débordement de la colonne ni de la barre. Tâche 5.
4. Statut brut inconnu en base (`'archived'`) : `decideResponding` le lit comme `draft` (`toBotStatus`) et renvoie `null` ; la pastille affiche le texte brut comme aujourd'hui, jamais une mention. Tâche 1 (contrats) et tâche 7 (pastille).
5. Membre admin de A et conseiller de B, sur `/organisation/entites` de A, qui passe sur B dans un autre onglet : l'onglet resté ouvert se recharge et affiche le refus sur place qui nomme B, jamais la liste des entités de A. Tâche 15.

## Impact multi-organisation

| Changement | Ce qui pourrait fuir ou mal répondre | Test qui l'empêche (tâche) |
|---|---|---|
| `not_responding` sur `BotDetail` et `WhatsAppNumberView.bot` | Mention calculée avec le compte, le numéro ou le statut d'une autre organisation | Compte de beta en erreur : aucun agent IA d'acme n'a la mention, l'agent IA de beta l'a ; équivalence avec `checkRoute` (1) |
| `usage.read` | Coûts lus par un non-admin, ou indice d'existence d'un agent IA | 403 pour chaque rôle non admin, même corps pour un agent IA de l'organisation, inconnu ou d'une autre ; 404 pour l'admin d'acme sur beta (2) |
| Masquage des numéros | Numéro de contact entier reçu par un membre hors de l'entité ; recherche qui révèle un numéro | Matrice des rôles sur `GET /bots`, `GET /bots/:id`, `GET /leads`, `GET /leads/:phone`, recherche par numéro sans résultat (3) |
| `first_entity_name` | Entité créée ou renommée dans une autre organisation | Création d'acme2 : une seule entité, dans acme2 ; entités d'acme inchangées (4) |
| Bloc Organisation, fil, sélecteur | Nom d'une autre organisation affiché, ou ancienne organisation avec les données de la nouvelle | Tests du bloc (5) et parcours deux onglets (15) |
| Assistant dans le cadre normal | Agent IA créé dans l'organisation changée dans un autre onglet | Parcours e2e de la spec 15.4 (15) |

## Amendements du scan de cohérence (avant exécution, font foi sur le texte des tâches)

- A-1 (tâches 5 et 6) : la suppression de `org-switcher.tsx` et de son test passe à la tâche 6, quand `top-bar.tsx` cesse de l'importer.
- A-2 (tâches 1 et 7) : `WhatsAppNumberView.bot.status_reason` reste le motif brut, `string | null`, comme `BotView` et `AgentSummaryRow` ; un motif inconnu s'affiche « Arrêté » (spec 6.1).
- A-3 (tâches 5 et 8) : `ColumnItem` est `Omit<RailItem, 'dot' | 'soon'> & { dot?: BotStatus | 'danger' }` ; les classes viennent de `STATUS_STYLE` et `MENTION_STYLE`, source unique.
- A-4 (tâches 6, 8 et 11) : la tâche 6 pose le fil d'Ariane de base de chaque page ; les tâches 8 et 11 ajoutent seulement les variantes des listes filtrées et des pages d'usage, et leurs titres.
- A-5 (tâches 2 et 11) : la tâche 2 retire aussi, pour un non-admin, l'appel à `/usage` et la carte de coût de la Vue d'ensemble (`agents/[botId]/page.tsx`, `overview.tsx`), pour qu'aucune étape intermédiaire n'affiche une carte en échec.
- A-6 (tâche 3) : le faux moteur importe `canSeeContactNumbers` et `maskContactNumber` (module pur) au lieu de les recopier ; si l'import est impossible depuis `apps/web/e2e`, un test de parité sur la matrice des rôles est obligatoire.
- A-7 (tâches 5 et 9) : un lien qui change d'espace porte `external?: string` qui nomme l'espace de destination (« ↗ Connexions ») ; « ↗ » seul reste pour le tableau de `/usage`.
- A-8 (tâches 5 et 13) : le contexte de `useNavigationGuard` a une valeur par défaut où `confirmLeave` rend `true`, pour que rail, colonne et bloc Organisation se rendent sans fournisseur.
- A-9 (tâche 3) : le test de recherche par numéro cherche « 612345 » (présent dans `+33612345678`) : l'admin trouve le lead, le membre masqué non.
- A-10 (tâche 15) : la vérification du numéro masqué dans Dernières conversations utilise un lead sans nom (la ligne affiche alors le numéro) : entier pour l'admin, masqué pour le membre masqué.
- A-11 (tâche 2) : « même corps » pour les 403 veut dire même statut, même `error.code`, même `error.reason` et même texte ; `request_id` est exclu de la comparaison.
- A-12 (tâche 1) : `detail()` calcule `not_responding` avec `respondingFacts` à partir du numéro et de la liste déjà lus, sans relecture ; `loadNotResponding` sert aux lectures qui n'ont pas ces faits.
- A-13 (tâche 7) : la bulle de `NotRespondingMention` réutilise le composant de bulle de `ComingSoon` (factorisé si besoin), pas une deuxième implémentation.
- A-14 (tâches 6 et 9) : pas de test « rouge » pour un comportement déjà vrai (`UsageView` reçoit déjà `period`, clé de Dernières conversations déjà l'indice) : un test de non-régression suffit, signalé comme tel.
- A-15 (tâche 14) : le test des mots anglais vérifie Draft, Preview, Online, Offline, Whitelist, New, Soon en français ; en anglais, Whitelist est « Allowlist ».

## Carte des fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `packages/contracts/src/bot-status.ts` | `decideResponding`, `NOT_RESPONDING_REASONS`, textes `TRANSITION_MESSAGES` | 1, 4 |
| `packages/contracts/src/whatsapp.ts` | `WhatsAppNumberView.bot` | 1 |
| `packages/contracts/src/contact-mask.ts` (nouveau) | `maskContactNumber` | 3 |
| `packages/contracts/src/{clients,accounts}.ts` | `first_entity_name`, `EntityName` | 4 |
| `src/core/services/bot-responding.ts` (nouveau) | faits et calcul de la mention côté moteur | 1 |
| `src/core/services/{bot-service,whatsapp-account-service,dashboard-service}.ts` | champs exposés, leads masqués | 1, 3, 4 |
| `src/core/auth/permissions.ts`, `src/core/auth/contact-visibility.ts` (nouveau) | `usage.read`, `canSeeContactNumbers`, présentation | 2, 3 |
| `src/api/admin/routes/{dashboard,bots}.ts` | refus des coûts, masquage | 2, 3 |
| `src/core/database/{types,sqlite,postgres}.ts` | recherche des leads sans le numéro | 3 |
| `src/core/auth/admin-service.ts`, `scripts/create-organization.ts` | première entité | 4 |
| `src/__tests__/isolation/{harness,navigation.test}.ts` | membres non admin, tests deux organisations | 1, 2, 3 |
| `apps/web/e2e/{mock-engine,mock-state,helpers}.ts` | faux moteur et scénarios | 1, 2, 3, 6 à 15 |
| `apps/web/src/app/api/{bots/summary,usage/summary,bots/[botId]/usage}/route.ts`, `apps/web/src/lib/onboarding.ts` | BFF | 1, 2 |
| `apps/web/src/components/shell/*` | rail, colonne, bloc Organisation, barre du haut, garde de sortie | 5, 6, 13 |
| `apps/web/src/components/agents/*`, `apps/web/src/lib/{agents-filter,status-words}.ts` | statuts, mention, liste | 7, 8 |
| `apps/web/src/components/agent/*`, `app/[locale]/(app)/agents/[botId]/**` | page et usage d'un agent IA | 9, 11 |
| `apps/web/src/components/{organisation,connections}/*`, `app/[locale]/(app)/organisation/**` | espace Organisation | 10 |
| `apps/web/src/app/[locale]/(app)/usage/page.tsx`, `components/usage/*` | usage de l'organisation | 11 |
| `apps/web/src/app/[locale]/(app)/account/**`, `no-organization`, `components/auth/invitation-flow.tsx` | compte et hors session | 12 |
| `apps/web/src/components/wizard/*`, `app/[locale]/(app)/agents/new/page.tsx` | assistant | 13 |
| `apps/web/messages/{fr,en}.json` | textes | 5 à 14 |
| `CLAUDE.md`, `docs/ARCHITECTURE.md` | exception de vocabulaire, état, architecture | 1 à 4, 6, 14, 17 |

---

### Tâche 1 : contrats et moteur, règle « Ne répond pas » (spec 7)

**Fichiers :**
- Modifier : `packages/contracts/src/bot-status.ts`, `packages/contracts/src/whatsapp.ts:151`, `src/core/services/bot-service.ts:20` (`BotDetail`) et `detail()`, `src/core/services/whatsapp-account-service.ts:535` (`numberView`), `apps/web/src/app/api/bots/summary/route.ts`, `apps/web/src/lib/onboarding.ts:3` (`AgentSummaryRow`), `apps/web/src/lib/agent-types.ts` (`BotView`), `apps/web/e2e/mock-engine.ts` (`botView`, `numberViewOf`, `/__scenario`), `apps/web/e2e/helpers.ts` (`applyScenario`), `docs/ARCHITECTURE.md` (§ « Statuts de l'agent IA et accès limité »).
- Créer : `src/core/services/bot-responding.ts`, `src/core/__tests__/not-responding-equivalence.test.ts`, `src/__tests__/isolation/navigation.test.ts`.
- Tests : `packages/contracts/src/__tests__/bot-status.test.ts`, `src/core/services/__tests__/bot-service.test.ts`, `src/core/services/__tests__/whatsapp-account-service*.test.ts`, `apps/web/src/app/api/bots/__tests__/summary.test.ts`, `apps/web/e2e/mock-whatsapp.spec.ts`.

**Interfaces :**
- Produit (contrats) :
  - `export const NOT_RESPONDING_REASONS = ['no_number', 'number_removed', 'account_not_connected', 'organization_suspended', 'empty_allowlist'] as const; export type NotRespondingReason = (typeof NOT_RESPONDING_REASONS)[number];`
  - `export interface RespondingFacts { status: string; number: { present: boolean; account_state: WhatsAppAccountState } | null; organizationActive: boolean; allowlistCount: number }`
  - `export function decideResponding(f: RespondingFacts): NotRespondingReason | null` : `toBotStatus(f.status)` différent de `limited` et `active` donne `null` ; sinon, dans cet ordre, `number === null` donne `no_number`, `!present` `number_removed`, `account_state !== 'connected'` `account_not_connected`, `!organizationActive` `organization_suspended`, statut `limited` et `allowlistCount === 0` `empty_allowlist`, sinon `null`.
  - `WhatsAppNumberView.bot` devient `{ bot_id: string; name: string; status: string; status_reason: BotPauseReason | null; not_responding: NotRespondingReason | null } | null`.
- Produit (moteur) : `respondingFacts(status: string, number: BotNumberSummary | null, organizationStatus: string | null, allowlistCount: number): RespondingFacts` et `loadNotResponding(db: Database, clientId: string, bot: { bot_id: string; status: string }): Promise<NotRespondingReason | null>` dans `bot-responding.ts` ; l'état du compte est l'état affiché (`BotNumberSummary.account.state`, signatures rejetées comprises, spec 7.1). `BotDetail.not_responding: NotRespondingReason | null`. Tout est lu avec le `client_id` de l'agent IA.
- Produit (BFF) : `AgentSummaryRow` gagne `status_reason: string | null`, `not_responding: NotRespondingReason | null`, `account_state: WhatsAppAccountStateView | null` (état du compte du numéro branché, pour le texte « en erreur » ou « non connecté »).
- Produit (faux moteur) : `botView` et `numberViewOf` appellent `decideResponding` des contrats ; scénario `limited-empty-allowlist` : `demo-1` passe `limited`, liste vide.

- [ ] **Étape 1 : tests des contrats** dans `bot-status.test.ts` : un cas par motif ; ordre (numéro retiré et compte en erreur donnent `number_removed` ; compte en erreur et organisation suspendue donnent `account_not_connected` ; organisation suspendue et liste vide en Preview donnent `organization_suspended`) ; `draft`, `paused` et statut inconnu `'archived'` donnent `null` dans tous les cas (point d'attention 4) ; `active` à liste vide `null` ; `limited` avec une entrée `null`.
- [ ] **Étape 2 : test d'équivalence** `not-responding-equivalence.test.ts` (`createTestDatabase()`, fixtures `createMetaAccount` et `createConnectedBot` de `src/test-support/whatsapp.ts`, `checkRoute` réel) : pour chaque combinaison statut `limited` ou `active` × numéro présent ou retiré × état stocké `connected`, `error` ou `disconnected` × organisation `active` ou `suspended` × liste vide ou d'une entrée, `decideResponding(faits) !== null` si et seulement si `checkRoute` refuse à la fois un contact de la liste et un contact hors liste. Trois cas nommés pour les écarts voulus : Draft et Offline (`checkRoute` refuse, `decideResponding` donne `null`) ; signatures rejetées en série sur un compte stocké `connected` (mention `account_not_connected`, `checkRoute` sert) ; aucun numéro (mention `no_number`). Commentaire `// nav 15.1`.
- [ ] **Étape 3 : tests du moteur** : `getBot` d'un agent IA `limited` à liste vide porte `not_responding: 'empty_allowlist'` ; `draft` porte `null` ; la vue d'un numéro de Connexions porte `status_reason` et `not_responding` de l'agent IA branché.
- [ ] **Étape 4 : test d'isolation** `src/__tests__/isolation/navigation.test.ts`, premier cas (`// nav 15.1`) : compte Meta de beta mis en erreur ; `GET /bots` d'acme : `not_responding` nul pour `acme/ventes` ; `GET /bots/accueil` de beta : `account_not_connected` ; aucune réponse d'acme ne contient d'identifiant de beta.
- [ ] **Étape 5 : vérifier l'échec, implémenter, vérifier** (`npm test`, `npm run test:pg`, typecheck).
- [ ] **Étape 6 : BFF et faux moteur** : test de `summary.test.ts` (les trois champs relayés, `account_state` nul sans numéro) ; scénario `limited-empty-allowlist` ajouté à `applyScenario` ; test requête dans `mock-whatsapp.spec.ts` : après le scénario, `GET /bots` renvoie `not_responding: 'empty_allowlist'` pour `demo-1`, et après `account-error-check`, `account_not_connected`. Puis `npm test -w @wabagent/web`, `npx playwright test`.
- [ ] **Étape 7 : documentation** : `docs/ARCHITECTURE.md`, un paragraphe « Mention Ne répond pas » (fonction, champs, état affiché du compte, trois écarts avec le routeur).
- [ ] **Étape 8 : commits** `feat(contrats): règle Ne répond pas calculée par le moteur` puis `feat(web): relais de la mention Ne répond pas par le BFF et le faux moteur`.

### Tâche 2 : coûts réservés à l'admin, moteur et BFF (spec 9.1)

**Fichiers :**
- Modifier : `src/core/auth/permissions.ts:21` (`Action`), `src/api/admin/routes/dashboard.ts:27`, `apps/web/src/app/api/usage/summary/route.ts:26`, `apps/web/e2e/mock-engine.ts:990` (`/usage`), `src/__tests__/isolation/harness.ts`, `docs/ARCHITECTURE.md` (§ « Rôles »).
- Créer : `src/api/admin/__tests__/usage-access.test.ts`.
- Tests : `src/core/auth/__tests__/permissions.test.ts`, `src/__tests__/isolation/navigation.test.ts`, `apps/web/src/app/api/usage/__tests__/summary.test.ts`, `apps/web/src/app/api/bots/__tests__/usage-route.test.ts`.

**Interfaces :**
- `Action` gagne `'usage.read'`, absent de `MEMBER_ACTIONS` et de `READ_ONLY_ACTIONS`.
- `GET /bots/:botId/usage` : `requireAction('usage.read')`, monté avant toute lecture de l'agent IA ; refus `forbidden()` générique, sans `error.reason`.
- Harnais d'isolation : `TwoOrgs.memberApi(org: 'acme' | 'beta', email: string, grants: MembershipGrantRecord[]): Promise<AdminApi>` crée le membre par `seedOrgMember` et rend l'API authentifiée comme lui (réutilisée par la tâche 3).
- BFF `/api/usage/summary` : une `EngineError` de statut 403 sur une ligne est relancée et donne la réponse entière 403 (`errorResponse`), jamais une ligne `unavailable`. Les autres échecs gardent la ligne `unavailable`.
- Faux moteur : `/usage` répond 403 `FORBIDDEN` quand le membre n'est pas admin.

- [ ] **Étape 1 : tests** `permissions.test.ts` : `usage.read` vrai pour admin et opérateur, faux pour super manager (avec et sans lecture seule), manager, conseiller, membre sans appartenance.
- [ ] **Étape 2 : tests HTTP** `usage-access.test.ts` (`createTestDatabase()`, `serve`, vrai routeur `createAdminRouter`) : 200 pour l'admin et l'opérateur ; 403 pour super manager, super manager en lecture seule, manager et conseiller ; pour un non-admin, l'identifiant d'un agent IA inconnu et celui d'une autre organisation donnent le même statut 403 et le même corps que son propre agent IA ; 404 pour l'admin d'acme sur un agent IA de beta (`// nav 15.5`).
- [ ] **Étape 3 : test d'isolation** dans `navigation.test.ts` (`// nav 15.5`) : conseiller d'acme par `memberApi` : 403 sur `acme/ventes/usage` et sur `beta/accueil/usage`, corps identiques ; aucune écriture dans `llm_usage`.
- [ ] **Étape 4 : vérifier l'échec, implémenter, vérifier** (moteur sur les deux bases).
- [ ] **Étape 5 : BFF** : `summary.test.ts` : moteur qui répond 403 sur la deuxième ligne, réponse 403 sans aucune ligne ni total (`// nav 15.5`) ; un 500 garde la ligne `unavailable` ; `usage-route.test.ts` : 403 relayé tel quel.
- [ ] **Étape 6 : faux moteur** : test requête dans `mock-whatsapp.spec.ts` : `advisor@wabagent.test` reçoit 403 sur `/bots/demo-1/usage`, `demo@wabagent.test` (admin de c1) 200. Puis `npm test -w @wabagent/web`, `npx playwright test` (aucun écran ne change encore : les écrans de la tâche 11 cessent de faire l'appel).
- [ ] **Étape 7 : documentation** : `docs/ARCHITECTURE.md` § Rôles : action `usage.read` réservée à l'admin.
- [ ] **Étape 8 : commit** `feat(moteur): coûts réservés à l'admin (usage.read) et refus relayé par le BFF`.

### Tâche 3 : numéros des contacts masqués par le moteur (spec 8, 9.2)

**Fichiers :**
- Créer : `packages/contracts/src/contact-mask.ts` (exporté par `packages/contracts/src/index.ts`), `src/core/auth/contact-visibility.ts`, `src/api/admin/__tests__/contact-numbers.test.ts`, `src/core/database/__tests__/leads-search.test.ts`, `packages/contracts/src/__tests__/contact-mask.test.ts`.
- Modifier : `src/core/auth/permissions.ts`, `src/api/admin/routes/bots.ts` (`GET /`, `GET /:botId`), `src/api/admin/routes/dashboard.ts` (`/leads`, `/leads/:phone`), `src/core/services/dashboard-service.ts:38` et `:68`, `src/core/database/types.ts:268`, `src/core/database/sqlite.ts:442`, `src/core/database/postgres.ts:400`, `apps/web/e2e/mock-engine.ts`, `apps/web/e2e/mock-state.ts`, `apps/web/e2e/helpers.ts`, `docs/ARCHITECTURE.md` (§ « Rôles »).
- Tests : `src/core/auth/__tests__/permissions.test.ts`, `src/__tests__/isolation/navigation.test.ts`, `apps/web/e2e/mock-whatsapp.spec.ts`.

**Interfaces :**
- Consomme : `TwoOrgs.memberApi` (tâche 2).
- `maskContactNumber(value: string): string` (contrats), format P-3.
- `canSeeContactNumbers(access: Access, botEntityId: number | null): boolean` (`permissions.ts`) : vrai pour l'opérateur, l'admin et le super manager (lecture seule comprise) ; sinon vrai seulement si `botEntityId !== null` et `access.entityRoles` contient cette entité.
- `presentBotForViewer<T extends { allowlist: string[]; entity_id: number | null }>(bot: T, access: Access): T` (`contact-visibility.ts`) : `allowlist` passée par `maskContactNumber` quand `canSeeContactNumbers` est faux. Appelée par `GET /bots` et `GET /bots/:botId` seulement ; les réponses des écritures (réservées à `bots.configure`) restent entières.
- `DashboardService.listLeads(clientId, botId, q, access: Access)` : `phone` de chaque lead masqué pour un membre masqué ; la recherche passe au pilote `search: { text: string; includePhone: boolean }` avec `includePhone = canSeeContactNumbers(...)`. `DashboardService.getLead(clientId, botId, phone, access: Access)` : après `requireBot` (404 hors organisation), `forbidden()` pour un membre masqué.
- `Database.listLeadsByBot(clientId, botId, opts: { search?: { text: string; includePhone: boolean }; rdvOnly?: boolean; limit: number; offset: number })` : SQLite et Postgres ne cherchent dans `l.phone` que si `includePhone`.
- Faux moteur : même règle (fonction locale qui reprend `canSeeContactNumbers` sur ses appartenances) et même masque (`maskContactNumber` importé des contrats) sur `allowlist` et sur `phone` des leads ; scénario `advisor-other-entity` : entité 3 « Siège Paris » créée dans c1, `demo-1` déplacé dessus, liste `['+33611111111']`.
- Limite écrite dans le rapport de tâche et dans `docs/ARCHITECTURE.md` : `qualified_data` et `transcript` (texte libre) ne sont pas masqués par ce lot (spec 9.2, chantier Conversations et leads).

- [ ] **Étape 1 : tests du masque** `contact-mask.test.ts` : `+33612345678` donne `+33612 •• •• 78` ; `33699999999` donne `+33699 •• •• 99` ; `+1234` donne `••••` ; `US.abc123` donne `US••••` ; `''` et `abc` donnent `••••` ; pour chaque entrée, le résultat ne contient ni la valeur entière ni une suite de plus de 5 de ses chiffres (point d'attention 1).
- [ ] **Étape 2 : tests des droits** `permissions.test.ts` : matrice de `canSeeContactNumbers` (admin, opérateur, super manager, super manager en lecture seule, manager et conseiller de l'entité, de l'autre entité, agent IA à `entity_id` nul) (point d'attention 2).
- [ ] **Étape 3 : tests HTTP** `contact-numbers.test.ts` (`createTestDatabase()`, `serve`) : pour `GET /bots`, `GET /bots/:botId` et `GET /bots/:botId/leads`, entier pour l'admin, l'opérateur, le super manager, le conseiller et le manager de l'entité ; masqué pour le conseiller d'une autre entité ; aucun corps masqué ne contient le numéro entier (`// nav 15.6`). Recherche `search=0612` et `search=+33612345678` par un membre masqué : 0 résultat ; `search=Marie` : le lead ; `GET /leads/:phone` : 403 masqué, 200 entier (`// nav 15.6`).
- [ ] **Étape 4 : test des pilotes** `leads-search.test.ts` (`createTestDatabase()`) : `includePhone: false` ne trouve pas par le numéro, trouve par le nom ; `includePhone: true` trouve les deux.
- [ ] **Étape 5 : test d'isolation** dans `navigation.test.ts` : conseiller d'acme sans entité de `acme/ventes` : liste masquée ; membre de beta : 404 sur l'agent IA et les leads d'acme (comportement existant gardé, `// nav 15.6`).
- [ ] **Étape 6 : vérifier l'échec, implémenter, vérifier** (`npm test`, `npm run test:pg`, `npm run check:logs` : aucun numéro journalisé par le nouveau code).
- [ ] **Étape 7 : faux moteur** : test requête dans `mock-whatsapp.spec.ts` après `advisor-other-entity` : `advisor@` reçoit `allowlist: ['+33611 •• •• 11']` et le lead masqué, `demo@` les reçoit entiers. Puis `npx playwright test`.
- [ ] **Étape 8 : documentation** : `docs/ARCHITECTURE.md` § Rôles : qui voit les numéros des contacts, routes concernées, limite des champs libres.
- [ ] **Étape 9 : commit** `feat(moteur): numéros des contacts masqués hors de l'entité de l'agent IA`.

### Tâche 4 : première entité nommée à la création, textes du moteur (spec 13, 6.4)

**Fichiers :**
- Modifier : `packages/contracts/src/accounts.ts:75` (exporter `EntityName`, ancien `entityName`), `packages/contracts/src/clients.ts:5`, `src/core/auth/admin-service.ts:27`, `scripts/create-organization.ts`, `packages/contracts/src/bot-status.ts:28` (`TRANSITION_MESSAGES`), `src/core/services/whatsapp-account-service.ts` (texte du compte encore utilisé), `docs/ARCHITECTURE.md:311` (commande du script).
- Tests : `src/core/auth/__tests__/admin-service.test.ts`, `src/api/admin/__tests__/clients-routes.test.ts`, `src/core/database/__tests__/migrate-accounts.test.ts`, tests moteur et web qui comparent ces textes.

**Interfaces :**
- `CreateClientInput.first_entity_name: EntityName` (obligatoire, mêmes règles et clé `entity.name_invalid` qu'un nom d'entité de l'écran Entités).
- `AdminService.createClient(input: CreateClientInput)` crée l'organisation puis une entité nommée `first_entity_name` ; `ensureDefaultEntity` et `migrateAccounts` inchangés (organisations anciennes sans entité seulement).
- Script : usage P-11, refus sans le quatrième argument.
- `TRANSITION_MESSAGES.empty_allowlist` : « Ajoutez au moins un numéro à la whitelist. » ; `not_from_draft` : « Passez d'abord en Preview : seul un numéro de test peut passer Online directement. » ; les autres textes inchangés. Texte P-10 pour le compte encore utilisé.

- [ ] **Étape 1 : tests** : `POST /clients` sans `first_entity_name` : 400 `VALIDATION_ERROR` ; avec `"  "` : 400, `reason: 'entity.name_invalid'` ; avec « Boutique Lyon » : 201, une seule entité « Boutique Lyon » dans la nouvelle organisation, entités d'acme inchangées (`// nav 15.7`). `admin-service.test.ts` mis à jour avec le champ. `migrate-accounts.test.ts` : une organisation existante garde le nom de son entité.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** (`npm test`, `npm run test:pg`) ; script relu à la main avec ses trois cas d'échec (arguments manquants).
- [ ] **Étape 3 : commit** `feat(moteur): nom de la première entité obligatoire à la création d'une organisation`.
- [ ] **Étape 4 : textes du moteur** : `grep -rn "accès limité\|Ouvrir à tous\|ouvert à tous\|brouillon\|Désactiv" src packages/contracts/src --include=*.ts` hors tests ; chaque texte destiné à l'écran passe au vocabulaire de la spec 6 ; tests qui comparent ces textes mis à jour (moteur, web, faux moteur). `npm test`, `npm test -w @wabagent/web`, `npx playwright test`.
- [ ] **Étape 5 : commit** `refactor(moteur): textes des refus au vocabulaire Draft, Preview, Online, Offline et Whitelist`.

### Tâche 5 : composants de la coquille (spec 5)

**Fichiers :**
- Créer : `apps/web/src/components/shell/{app-rail,org-block,middle-column,page-bar,app-frame,coming-soon,reserved-page}.tsx`, `apps/web/src/components/agents/status-style.ts`, leurs tests dans `apps/web/src/components/shell/__tests__/`.
- Modifier : `apps/web/messages/{fr,en}.json` (`shell.rail`, `shell.orgBlock`, `shell.pageBar`, `shell.reserved`, `common.soon`, `common.new`).
- Supprimer (déplacé dans `org-block.tsx`, tests repris dans `org-block.test.tsx`) : `components/shell/org-switcher.tsx` et son test. Les autres anciens fichiers sont retirés à la tâche 6.

**Interfaces :**
- `type Space = 'organisation' | 'agents' | 'usage' | 'account'`.
- `AppRail({ active }: { active: Space | null })` : marque WABAGENT (lien `/`) ; entrées et règles de la spec 5.1 dans l'ordre ; Organisation et Usage seulement si `isAdmin` ; sans organisation active : marque, Aide, Compte ; Compte : initiales `initialsFromEmail`, étoile pour l'opérateur, lien `/account/organisations`, `aria-label` = adresse ; entrée active marquée par le fond seul, `aria-current="page"` ; largeur et icônes P-6 ; aucune pastille.
- `ComingSoon({ tooltip: string; badge?: boolean; children: ReactNode })` : élément `aria-disabled="true"`, `tabIndex={0}`, jamais un lien, bulle `role="tooltip"` reliée par `aria-describedby`, visible au survol et au focus ; `badge` ajoute la pastille « Soon ». `SoonBadge()` et `NewBadge()` exportés du même fichier.
- `OrgBlock()` : libellé « Organisation », `monogram()`, nom en gras (tronqué, nom entier en `title`), sous-titre `useRoleLabel` (« Admin implicite » pour l'opérateur) suivi de « · {count} organisations » si `me.organizations.length > 1` ; flèche et menu si `me.organizations.length > 1` ou opérateur ; contenu et comportement du menu repris de `org-switcher.tsx` (recherche au-delà de 6, suspendue grisée avec « Suspendue » et `shell.orgSwitcher.suspendedHint`, refus dans le menu, pied `shell.orgSwitcher.footer`) ; le menu se déroule sous le bloc.
- `MiddleColumn({ withOrg?: boolean; kicker?: string; title?: ReactNode; groups: ColumnGroup[]; activeKey: string; footer?: ReactNode })` : `OrgBlock` en tête sauf `withOrg={false}` ; reprend `Rail` (`rail.tsx`) avec `ColumnItem` = `RailItem` plus `dot?: 'online' | 'preview' | 'offline' | 'draft' | 'danger'`, `tooltip?: string` (entrée Soon), `alert?: string` (texte rouge à droite qui remplace le compteur), `external?: boolean` (« ↗ » après le libellé) ; `ColumnGroup` plus `tag?: string` (petite étiquette, « Entité »). Entrée Soon : `ComingSoon` avec `badge`, remplace la pastille `common.comingSoon`.
- `PageBar({ trail: Crumb[]; action?: ReactNode; root?: 'organisation' | 'account' })` avec `interface Crumb { label: string; href?: string }` : premier segment le nom de l'organisation active (lien `/`), ou « Mon compte » pour `root="account"` ; séparateur « › » ; dernier segment en gras, `aria-current="page"` ; `nav` `aria-label` « Fil d'Ariane » ; action à droite ; barre collante (P-4).
- `AppFrame({ space: Space | null; column: ReactNode; children: ReactNode })` : rail, colonne, zone de contenu défilante sans marge haute (la page y pose sa `PageBar`).
- `ReservedPage()` : cadre de la spec 10.6 (rail sans entrée active, colonne réduite au bloc Organisation, fil « Org › Accès refusé », titre, phrase avec le nom de l'organisation, lien « Retour aux agents IA »).
- `STATUS_STYLE: Record<'draft' | 'limited' | 'active' | 'paused', { pill: string; dot: string }>` et `MENTION_STYLE` dans `status-style.ts` : couleurs de la spec 6.2 et P-5 ; source unique de la pastille, des points de la colonne, de Connexions et de l'assistant.

- [ ] **Étape 1 : tests** `app-rail.test.tsx` : ordre des entrées pour l'admin ; conseiller sans Organisation ni Usage ; sans organisation active, marque, Aide et Compte seuls ; entrée active pour chacun des quatre espaces ; Leads, Reprise et Aide sans `href`, `aria-disabled`, bulle au focus clavier avec le texte de la spec 5.1 (`// prototype 16`) ; initiales et étoile de l'opérateur.
- [ ] **Étape 2 : tests** `org-block.test.tsx` (`// nav 15.2`) : membre d'une seule organisation, ni flèche ni nom d'une autre ; membre de A et de B suspendue, flèche, B grisée non ouvrable avec « Suspendue », sous-titre « Admin · 2 organisations » (`// prototype 2`) ; opérateur, flèche et « Admin implicite » ; nom de 80 caractères tronqué avec `title` (point d'attention 3) ; cas repris de `org-switcher.test.tsx` (recherche, double clic, refus).
- [ ] **Étape 3 : tests** `page-bar.test.tsx` (premier segment = organisation active, lien `/` ; `root="account"` commence par « Mon compte » ; dernier segment `aria-current`) et `middle-column.test.tsx` (bloc Organisation présent ou non, entrée Soon non lien avec bulle, point `danger`, `alert` à la place du compteur, étiquette `tag`, « ↗ », squelette).
- [ ] **Étape 4 : vérifier l'échec, implémenter, vérifier** (`npm test -w @wabagent/web`, `npx tsc --noEmit`) ; textes FR et EN ajoutés, test de style vert.
- [ ] **Étape 5 : commit** `feat(web): composants du rail, de la colonne du milieu et de la barre du haut`.

### Tâche 6 : la coquille sur toutes les pages connectées (spec 5, 10, 11)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/page.tsx`, `agents/[botId]/layout.tsx`, `components/agent/{agent-shell,agent-rail}.tsx`, `agents/[botId]/page.tsx` et `components/agent/overview.tsx:69` (Simuler), `agents/[botId]/usage/page.tsx` et `components/agent/usage-view.tsx:26` (période), `organisation/layout.tsx`, `components/organisation/organisation-rail.tsx`, `organisation/{entites,utilisateurs,connexions,connexions/raccorder,reglages}/page.tsx`, `usage/page.tsx`, `account/layout.tsx` et les trois pages du compte, `apps/web/e2e/*.spec.ts` touchés, `docs/ARCHITECTURE.md` (nouvelle section « Navigation du back-office »).
- Créer : `apps/web/src/components/usage/period-choice.tsx`.
- Supprimer : `components/shell/{top-bar,user-menu,page-shell,rail}.tsx` et leurs tests (`rail.tsx` devient `middle-column.tsx`, tâche 5).

**Interfaces :**
- Consomme : `AppFrame`, `MiddleColumn`, `PageBar`, `Crumb`, `Space` (tâche 5).
- `PeriodChoice({ value: 7 | 30 | 90; onChange(p: 7 | 30 | 90): void })` : groupe de trois boutons, extrait de `usage-view.tsx` ; `UsageView` reçoit `period` en prop.
- Fil d'Ariane et action principale de chaque page, textes de la spec 10 et 11 ; les titres et contenus de page ne changent pas encore (tâches 8 à 12), sauf le retrait des boutons montés dans la barre :
  - liste : « + Créer un agent IA » ; agent IA : « ▶ Simuler » (absent en lecture seule) ; usage de l'agent IA : `PeriodChoice` ; Entités : « + Nouvelle entité » ; Utilisateurs : « + Inviter » ; Connexions : « + Raccorder un compte WhatsApp » (caché sans compte) ; Raccorder, Réglages, compte : rien.
- Colonne du compte : `MiddleColumn withOrg={false}`, libellé « Mon compte », adresse avec point de rupture (`account/layout.tsx:12`), « Se déconnecter » en `footer` (la fonction `logout` de `user-menu.tsx` y est reprise). Le menu de l'avatar n'existe plus.
- L'assistant (`/agents/new`) garde son mode concentré jusqu'à la tâche 13.

- [ ] **Étape 1 : tests de pages** mis à jour ou ajoutés (`home.test.tsx`, `agent-layout.test.tsx`, `agent-pages.test.tsx`, `organisation-space.test.tsx`, `usage-page.test.tsx`, `account.test.tsx`) : chaque page rend le rail avec l'entrée active de la spec 5.1 (Agents IA sur `/agents/:id/usage`), le bloc Organisation en tête de colonne (sauf compte), le fil de la spec 10 et l'action principale dans la barre, jamais dans la page (`// prototype 9` pour Simuler).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** (`npm test -w @wabagent/web`, `npx tsc --noEmit`, `grep -rn "TopBar\|PageShell\|UserMenu\|OrgSwitcher" apps/web/src` vide).
- [ ] **Étape 3 : e2e** : sélecteurs mis à jour (déconnexion par la colonne du compte, sélecteur d'organisation dans le bloc, Simuler dans la barre) ; `npx playwright test` vert.
- [ ] **Étape 4 : documentation** : `docs/ARCHITECTURE.md`, section « Navigation du back-office » : rail, colonne, bloc Organisation, barre du haut, règle de l'action principale.
- [ ] **Étape 5 : commit** `feat(web): rail sombre, colonne du milieu et barre du haut sur toutes les pages`.

### Tâche 7 : statuts, motifs d'Offline et mention « Ne répond pas » (spec 6.1, 6.2, 7.3)

**Fichiers :**
- Créer : `apps/web/src/lib/status-words.ts`, `apps/web/src/components/agents/{offline-reason,not-responding-mention}.tsx`, leurs tests.
- Modifier : `components/agents/status-pill.tsx`, `components/agents/agents-table.tsx`, `components/agent/{agent-rail,status-panel}.tsx`, `agents/[botId]/layout.tsx` (lecture de `status_reason` et `not_responding`), `components/connections/numbers-table.tsx`, `lib/bot-transitions.ts`, `apps/web/messages/{fr,en}.json` (`agents.status`, `agentStatus.*`, `agents.notResponding`), tests unitaires et e2e qui lisent les anciens mots.

**Interfaces :**
- `offlineReasonKey(raw: string | null | undefined): 'manual' | 'number_removed' | 'number_unassigned' | 'unknown'` (`status-words.ts`) : absent ou nul `manual`, motif de `BOT_PAUSE_REASONS` lui-même, autre texte `unknown`. Textes `agentStatus.pauseReasons.*` : « Arrêté par un administrateur », « Numéro retiré », « Numéro débranché », « Arrêté ».
- `StatusPill({ status })` : mots de la spec 6.1 (`agents.status` : Draft, Preview, Online, Offline, « Statut inconnu »), classes de `STATUS_STYLE` (tâche 5) ; statut brut inconnu affiché tel quel (point d'attention 4).
- `OfflineReason({ raw })` : le motif à côté de la pastille, rendu seulement pour `paused`.
- `NotRespondingMention({ reason, accountState, variant })` avec `reason: NotRespondingReason`, `accountState: WhatsAppAccountStateView | null`, `variant: 'short' | 'full'` : `short` « Ne répond pas » en rouge avec la bulle du motif (`ComingSoon` n'est pas utilisé : bulle simple au survol et au focus, `tabIndex={0}`) ; `full` le texte du motif. Textes de la spec 7.1 ; `account_not_connected` : « … en erreur » sauf `accountState === 'disconnected'`.
- Lieux (spec 7.3, points 1, 2 et 4) : tableau de la liste (colonne Statut : pastille, mention ou motif), ligne d'un numéro de Connexions (pastille de l'agent IA branché depuis `WhatsAppNumberView.bot`, mention avec l'état du compte de la carte, motif d'Offline), colonne de l'agent IA (sous le nom). Les points 3 et 5 sont aux tâches 8 et 9.
- Actions de statut (`agentStatus.actions`) : « Passer en Preview », « Repasser en Preview », « Limiter à la whitelist », « Passer Online », « Repasser Online », « Passer Offline » ; descriptions (`agentStatus.description.*`) : phrases de la spec 6.1 ; confirmations (`agentStatus.confirm.*`) et raisons (`agentStatus.reasons.*`) réécrites avec ces mots ; « whitelist » partout pour la liste d'accès limité, jamais « numéros de test ».
- `status-panel.tsx` lit `bot.not_responding` à la place de son calcul local (`status-panel.tsx:98` à `111`) ; l'encadré complet est à la tâche 9.

- [ ] **Étape 1 : tests** : `status-pill.test.tsx` (quatre mots, statut inconnu, classes distinctes de Draft et Offline) ; `offline-reason.test.tsx` (quatre cas, jamais le code brut) ; `not-responding-mention.test.tsx` (cinq motifs, deux variantes d'état du compte, bulle au focus) ; `agents-table.test.tsx` (mention à côté d'une pastille Preview, motif à côté d'Offline, `// prototype 1`) ; `numbers-table.test.tsx` (agent IA Preview sur un compte en erreur : pastille et mention) ; `agent-rail.test.tsx` (mention sous le nom).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.** Les tests existants qui lisent « Brouillon », « Accès limité », « Ouvert à tous », « Désactivé » sont réécrits avec les nouveaux mots, assertions de comportement gardées.
- [ ] **Étape 3 : e2e** : sélecteurs aux nouveaux mots ; un test ajouté à `agent-space.spec.ts` : scénario `account-error-check`, `demo-1` Online porte « Ne répond pas » dans la liste, dans Connexions et dans la colonne de l'agent IA. `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): statuts Draft, Preview, Online, Offline, motifs et mention Ne répond pas`.

### Tâche 8 : liste des agents IA (spec 10.2, 7.3)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/page.tsx`, `lib/agents-filter.ts`, `components/agents/{agents-table,setup-banner,first-run}.tsx`, `lib/onboarding.ts` (`deriveChecklist` si le lien de la mise en route en dépend), `apps/web/messages/{fr,en}.json` (`agents.*`, `onboarding.comingSoon`), `apps/web/e2e/helpers.ts` (`loginToAgents` attend le titre « Agents IA »), specs e2e qui lisent les anciens titres.
- Tests : `lib/__tests__/agents-filter.test.ts`, `app/[locale]/(app)/__tests__/home.test.tsx`, `components/agents/__tests__/{agents-table,setup-banner,first-run}.test.tsx`.

**Interfaces :**
- `AgentFilter` gagne `{ kind: 'not_responding' }` ; `parseAgentFilter` lit `?status=not_responding` ; `applyAgentFilter` garde les lignes dont `not_responding !== null` ; `agentFilterQuery` l'écrit.
- Colonne : bloc Organisation, libellé « Agents IA », « Tous les agents IA » (n), groupe « Par entité » avec `tag` « Entité » (affiché comme aujourd'hui), groupe « Statut » : Online, Preview, Offline, Draft (points `STATUS_STYLE`), puis « Ne répond pas » (point `danger`, compteur, filtre) seulement si au moins un agent IA est concerné ; compteurs Preview et Online inchangés.
- Fil : « Org › Agents IA › Tous les agents IA », « … › Entité : {nom} », « … › Statut : {mot} », « … › Ne répond pas ». Titre : « Agents IA » ; filtré par entité « Entité : {nom} » ; par statut le mot du statut ; « Ne répond pas » pour le filtre de la mention.
- Tableau : numéro de l'agent IA en entier par `formatPhone` (fin de `maskNumber` dans `agents-table.tsx:57`), colonne « Messages » (P-1) et « Leads ».
- Mise en route : « Brancher un numéro » mène à `/agents/<id>` du premier agent IA Draft sans numéro (ordre de la liste) ; sans tel agent IA, au comportement actuel (`// prototype 8`). Premier lancement : « À venir » retiré des étapes Brancher et Activer.
- Premier lancement et lecture en échec : rail et colonne présents, colonne réduite au bloc Organisation et au libellé « Agents IA ».

- [ ] **Étape 1 : tests** : filtre `not_responding` (lecture, application, écriture, valeur inconnue ignorée) ; entrée « Ne répond pas » absente à 0, présente avec son nombre à 1, filtre la liste (`// prototype 1`) ; fils et titres des quatre cas ; conseiller : pas de bouton de création, texte de premier lancement inchangé ; numéro entier dans le tableau pour un conseiller (`// prototype 15`) ; lien de la mise en route.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : e2e** : `loginToAgents` attend `heading` « Agents IA » ; scénario `limited-empty-allowlist` : entrée « Ne répond pas » (1) dans la colonne, filtre, fil « Maison Lumière › Agents IA › Ne répond pas ». `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): liste des agents IA, filtre Ne répond pas, fil et titres par filtre`.

### Tâche 9 : page d'un agent IA, Vue d'ensemble (spec 10.3, 9.2)

**Fichiers :**
- Modifier : `apps/web/src/components/agent/{agent-rail,agent-sections,overview,status-panel,allowlist-panel,number-panel,recent-conversations,cost-card,shortcuts}.tsx`, `agents/[botId]/layout.tsx` (entité de l'agent IA), `apps/web/messages/{fr,en}.json` (`overview`, `agentStatus`, `agentAllowlist`, `agentNumber`, `agentSpace`).
- Tests : `components/agent/__tests__/{agent-rail,overview,status-panel,allowlist-panel,number-panel,recent-conversations,cost-card}.test.tsx`, `agents/[botId]/__tests__/agent-pages.test.tsx`.

**Interfaces :**
- Colonne de l'agent IA : bloc Organisation, « ‹ Tous les agents IA », étiquette « Agent IA », nom, pastille et mention ou motif, ligne « Entité · {nom} » (lue de `/api/entities` par l'identifiant `entity_id`, absente en échec), sections de `AGENT_SECTIONS` aux libellés « Conversations et leads », « Personnalité et contenu », « CRM », « Usage et coûts », « Réglages » (clé `settings`, ancien « Paramètres ») en Soon avec bulle ; groupe admin « Organisation » : « Numéros WhatsApp de l'organisation » avec `external` (`// prototype 8`). Lecture de l'agent IA en échec : identifiant à la place du nom, « Statut inconnu », ni mention ni ligne Entité (comportement de `agents/[botId]/layout.tsx:29` gardé).
- Titre de la page : nom de l'agent IA, puis « Entité · {nom} » et les langues (`overview.tsx:57`, `// prototype 7`).
- Encart Statut : phrase de la spec 6.1 ; si `not_responding` n'est pas nul, encadré rouge (jeton `danger`) avec `NotRespondingMention variant="full"` et une action : admin `no_number` « Brancher un numéro » (fenêtre existante), `number_removed` « Changer de numéro », `account_not_connected` lien « Ouvrir Connexions ↗ », `empty_allowlist` « Ajouter un numéro à la whitelist » (focus sur le champ de l'encart Whitelist) ; conseiller « Prévenez un administrateur de votre organisation. » (choix P-2). Liste vide : « Passer Online » n'est plus dans l'encadré, il reste dans la rangée des actions avec sa confirmation. Draft sans numéro : une seule ligne de raison sous les boutons grisés quand les raisons sont identiques (`// prototype 9`).
- Encart Whitelist : titre « Whitelist » ; phrase « Tant que l'agent IA est en Preview, seuls ces numéros reçoivent une réponse. » ; le mot-clé « reset » dans une phrase à part, plus petite ; entrées affichées telles que reçues.
- Encart Numéro WhatsApp : numéro entier par `formatPhone` pour tous (prop `seeFull` retirée) ; « Compte WhatsApp : {nom} ». `apps/web/src/lib/mask-number.ts` et son test sont supprimés (dernier usage).
- Dernières conversations : initiales des deux premiers mots du nom ; sans nom, icône de contact (`lucide-react` `UserRound`) ; « voir tout » retiré ; ligne = nom ou numéro reçu ; clé de liste qui ne suppose pas un numéro unique (deux numéros masqués peuvent être égaux).
- Carte Coût LLM : en-tête du graphique « 7 derniers jours », montant « 30 derniers jours ».
- Raccourcis : « Tester dans le simulateur » retiré ; « Modifier la personnalité » en Soon avec bulle (spec 5.4).

- [ ] **Étape 1 : tests** : colonne (ligne Entité, sections Soon non liens, « Réglages », groupe Organisation absent pour un conseiller) ; titre avec nom et entité ; encadré pour chacun des quatre motifs visibles, admin et conseiller ; whitelist vide : « Passer Online » absent de l'encadré, présent dans la rangée ; ligne de raison unique ; encart Whitelist (titre, phrases) ; numéro entier pour un conseiller (`// prototype 15`) ; initiales « Marie Curie » donne « MC », sans nom l'icône, jamais des chiffres (`// prototype 7`) ; absence de « voir tout » ; légende du graphique.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : e2e** : `agent-space.spec.ts` et `activation.spec.ts` mis à jour ; un test ajouté : scénario `limited-empty-allowlist`, encadré « Ne répond pas : whitelist vide » et « Ajouter un numéro à la whitelist » qui donne le focus au champ. `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): page de l'agent IA, titre avec entité, encadré Ne répond pas et whitelist`.

### Tâche 10 : espace Organisation (spec 10.7, 16, 5.4)

**Fichiers :**
- Modifier : `apps/web/src/components/organisation/{organisation-rail,entities-table,invitations-table,members-table}.tsx`, `organisation/layout.tsx` (compteur des comptes en erreur), `components/connections/{numbers-table,number-menu,account-alerts,crm-coming,connect-form}.tsx`, `organisation/reglages/page.tsx`, `apps/web/messages/{fr,en}.json` (`organisation`, `connections`).
- Tests : `components/organisation/__tests__/{organisation-space,entities,users}.test.tsx`, `components/connections/__tests__/{numbers-table,number-menu,account-alerts,connect-form}.test.tsx`, `organisation/connexions/__tests__/page.test.tsx`, `e2e/{organisation,connections}.spec.ts`.

**Interfaces :**
- Colonne : Entités (n), Utilisateurs (n), Connexions (n), Réglages, puis « Marque et connaissances » en Soon avec la bulle de la spec 16 ; Connexions : quand au moins un compte est `error`, point rouge et `alert` « {n} en erreur » à la place du compteur (`// prototype 17`). Le gabarit compte les comptes `error` depuis la même lecture `/api/whatsapp-accounts`.
- Entités : « Archiver… » reste dans le menu de la dernière entité active, grisé avec sa raison (texte du refus `entity.last_active` traduit). Utilisateurs : « Renvoyer » seulement en bouton direct, retiré du menu « Gérer » ; sa propre ligne : « Vous ne pouvez pas modifier vos propres accès. » en gris à la place du menu (`// prototype 9`).
- Connexions : entrée du menu d'un numéro qui branche un autre agent IA grisée, avec « Le compte WhatsApp de ce numéro n'est pas connecté. », quand le compte de la carte n'est pas `connected` ; bandeau « Le jeton expire dans N jours » avec le bouton « Remplacer les identifiants » (même fenêtre que le bandeau d'erreur) ; section CRM, carte Connexion Meta de Raccorder et les deux modes indisponibles de Réglages en Soon avec bulle « Disponible prochainement : … » (textes repris des mentions actuelles, « à venir », « Bientôt », « Pas encore disponible. », « bientôt disponible » retirés).

- [ ] **Étape 1 : tests** : colonne (Marque et connaissances non lien avec bulle ; point rouge et « 1 en erreur » avec un compte en erreur, compteur gris sinon) ; Archiver grisé avec raison ; Renvoyer une seule fois ; phrase de sa propre ligne ; menu du numéro grisé avec raison ; bouton du bandeau d'expiration ; Soon dans CRM, Raccorder, Réglages (`// prototype 10`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : e2e** : `organisation.spec.ts`, `connections.spec.ts` mis à jour ; scénario `account-error-check` : « 1 en erreur » sur l'entrée Connexions. `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): espace Organisation, comptes en erreur signalés et actions indisponibles expliquées`.

### Tâche 11 : usage et coûts, droits du conseiller à l'écran, refus sur place (spec 9.1, 10.4, 10.6, 10.8)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/usage/page.tsx:34`, `components/usage/usage-summary-table.tsx`, `agents/[botId]/usage/page.tsx`, `agents/[botId]/page.tsx:36` (lecteur `usage`), `components/agent/{agent-rail,overview}.tsx`, `organisation/layout.tsx:30`, `agents/new/page.tsx:21`, `apps/web/src/lib/public-routes.ts:2`, `apps/web/src/lib/describe-failure.ts` (vérifier qu'aucune lecture ne dépend de la page `/forbidden`), `apps/web/messages/{fr,en}.json` (`usage`, `errors.forbiddenTitle`, `errors.forbiddenBody` si orphelines).
- Supprimer : `apps/web/src/app/[locale]/forbidden/page.tsx`.
- Tests : `usage/__tests__/usage-page.test.tsx`, `agents/[botId]/__tests__/agent-pages.test.tsx`, `agents/new/__tests__/page.test.tsx`, `components/organisation/__tests__/organisation-space.test.tsx`, `apps/web/src/__tests__/middleware.test.ts`.

**Interfaces :**
- Consomme : `ReservedPage` (tâche 5), `PeriodChoice` (tâche 6), `periodStart` (`apps/web/src/lib/period.ts`).
- `/usage` : colonne « Usage et coûts », « Toute l'organisation », groupe « Par entité » avec `tag` « Entité » ; fil « Org › Usage et coûts › Toute l'organisation » ou « … › Entité : {nom} » ; titre « Usage et coûts : toute l'organisation » ou « Usage et coûts : Entité {nom} » ; `PeriodChoice` dans la barre, 30 par défaut (P-7), période écrite sous le titre (« 30 derniers jours »), `since` envoyé au BFF ; nom d'un agent IA du tableau suivi de « ↗ » vers son usage (`// prototype 3`, `// prototype 8`).
- `/agents/:id/usage` : titre « Usage et coûts de {nom} », fil « Org › Agents IA › {nom} › Usage et coûts ».
- Conseiller : aucune entrée Usage (tâche 5), section « Usage et coûts » absente de `AGENT_SECTIONS` rendues, carte Coût LLM absente et lecteur `usage` jamais appelé ; `/usage`, `/agents/:id/usage`, `/organisation/**` et `/agents/new` (non admin ou lecture seule) rendent `ReservedPage` à la même adresse, sans appel aux routes réservées (`// prototype 5`).

- [ ] **Étape 1 : tests** (`// nav 15.5`) : conseiller sur la Vue d'ensemble, aucun appel `fetch` vers `/usage` (espion sur `apiFetch`), ni carte ni section ; conseiller sur `/usage` et `/agents/:id/usage` : `ReservedPage` qui nomme l'organisation, aucun appel à `/api/usage/summary` ni `/api/bots/:id/usage` ; `/organisation/entites` et `/agents/new` : refus sur place, aucune redirection ; admin sur `/usage` : période 30, changement en 7 envoie un `since` à 7 jours (`periodStart`), titres et fils ; `/forbidden` n'est plus une route publique.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : e2e** : nouveau test dans `agent-space.spec.ts` : `advisor@wabagent.test` ouvre `/fr/usage` et lit « Page réservée aux administrateurs » et « Cette page de Maison Lumière est réservée aux administrateurs. » ; aucune requête vers `/api/usage/summary` (écoute `page.on('request')`). `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): coûts masqués au conseiller, période des usages et refus sur place`.

### Tâche 12 : pages du compte et pages hors session (spec 10.1, 11)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/account/{layout,organisations/page,preferences/page}.tsx`, `apps/web/src/app/[locale]/no-organization/page.tsx:36,65`, `apps/web/src/components/auth/invitation-flow.tsx:278`, `apps/web/messages/{fr,en}.json` (`account`, `noOrganization`, `auth.invite`).
- Tests : `account/__tests__/account.test.tsx`, `no-organization/__tests__/page.test.tsx`, `components/auth/__tests__/invitation-flow.test.tsx`, `e2e/{no-organization,accept-invite}.spec.ts`.

**Interfaces :**
- Colonne du compte : compteur d'Organisations = `me.organizations.length` (suspendues comprises) ; Organisations : « Active » (ouvrable), « Ouverte » (en cours), « Suspendue » ; Préférences : « Mémorisés sur cet appareil. » sous le titre. Sans organisation active : rail réduit (tâche 5), même colonne.
- « Aucune organisation » : « Mon compte » vers `/account/organisations` ; si toutes les organisations suspendues du membre portent `role: 'admin'`, « Contactez le support. » seul ; lecture de la session en échec : « Impossible de lire votre session pour le moment. » et « Réessayer » (`// prototype 13`).
- Invitation, compte neuf : pastille « {Rôle} · {Entité} » depuis `grants_summary` ; sous l'adresse masquée, « C'est l'adresse qui a reçu cette invitation ; elle servira d'identifiant. » ; titre « Activez votre compte », bouton « Activer mon compte » ; compte existant : « depuis le bloc Organisation, en haut de la colonne de gauche » (`// prototype 14`).

- [ ] **Étape 1 : tests** des cas ci-dessus (compteur avec une organisation suspendue, deux mots de statut, page sans organisation : trois cas, invitation compte neuf).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : e2e** : `no-organization.spec.ts` (lien Mon compte vers Organisations), `accept-invite.spec.ts` (titre et bouton). `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): pages du compte, page Aucune organisation et invitation d'un compte neuf`.

### Tâche 13 : assistant de création dans le cadre normal (spec 12)

**Fichiers :**
- Créer : `apps/web/src/components/shell/navigation-guard.tsx`, `apps/web/src/components/wizard/{wizard-column,leave-dialog}.tsx`, leurs tests.
- Modifier : `apps/web/src/app/[locale]/(app)/agents/new/page.tsx:26`, `components/wizard/{wizard,stepper,step-personality,step-number,step-activate,success}.tsx`, `components/numbers/number-picker.tsx`, `components/shell/{app-rail,middle-column,org-block}.tsx` (appel de la garde), `apps/web/src/app/[locale]/(app)/layout.tsx` (fournisseur de la garde), `apps/web/messages/{fr,en}.json` (`wizard`, `success`, `numberPicker`).
- Tests : `components/wizard/__tests__/{wizard,stepper,step-personality,step-number,step-activate,success}.test.tsx`, `e2e/onboarding.spec.ts`, `e2e/activation.spec.ts`.

**Interfaces :**
- `NavigationGuardProvider` et `useNavigationGuard(): { setGuard(active: boolean): void; confirmLeave(): Promise<boolean> }` : `confirmLeave` rend `true` sans fenêtre quand aucune garde n'est posée, sinon ouvre `LeaveDialog` (textes P-8) ; `AppRail`, les liens de `MiddleColumn`, `OrgBlock.choose` et « ✕ Quitter » l'appellent avant de naviguer ; `beforeunload` posé tant que la garde est active.
- `Stepper({ current, furthest, onGo })` vertical (remplace l'horizontal, garde `STEP_COUNT`, `StepIndex`, `WIZARD_PANE`, `StepCounter`) : cinq étapes avec leurs descriptions (spec 12.1) ; étape atteinte cliquable ; étape à venir `ComingSoon` avec les raisons de la maquette (`LATER_REASON`), « Créer & tester » écrit « Créer et tester ».
- `WizardColumn({ step, furthest, created, activated, name, onGo })` : bloc Organisation, « ‹ Tous les agents IA », « Créer un agent IA », stepper, encadré d'état aux trois textes de la spec 12.1 (« {nom} est Online » ou « est en Preview » après l'activation).
- Barre : fil « Org › Agents IA › Créer un agent IA » ; action « ✕ Quitter » précédée de la ligne grise : « Retour à Agents IA : rien n'est enregistré », « Retour à Agents IA : le Draft reste dans la liste », « Retour à la liste des agents IA ».
- Garde active : avant la création (étapes 1 et 2), ou après une modification de l'étape 2 non renvoyée (`step-personality.tsx:88`) ; inactive sinon.
- Étape 2 (variante A) : champs pleine largeur, redimensionnables en hauteur ; « Objectif principal » 3 lignes, « Informations clés à connaître » 300 px, mode avancé 320 px, message d'accueil 96 px ; mode avancé libellé « Écrire vos propres instructions (remplace le mode guidé) ».
- Étape 4 : numéro d'un compte non `connected` non choisissable avec « Le compte WhatsApp de ce numéro n'est pas connecté. » ; avertissement du numéro en service (`numberPicker.swapWarning`, mot « Offline ») visible sur la ligne avant de la cocher.
- Étape 5 : numéro de test, pas de section Whitelist, phrase « L'agent IA passe Online ; Meta ne laisse écrire que les numéros vérifiés de votre app. », bouton « Activer et ouvrir à tous » ; autre numéro, section « Whitelist » (au moins une entrée, `decideActivation`) et bouton « Activer en Preview ».
- Fin : sans activation, titre « Draft enregistré » ; après activation, P-9 ; sans numéro branché, bouton principal « Brancher un numéro » vers `/agents/<id>`.

- [ ] **Étape 1 : tests** : garde (aucune fenêtre sans garde ; fenêtre avant création sur un clic du rail, d'un lien de la colonne, du sélecteur et de Quitter ; « Rester » ne navigue pas ; pas de fenêtre après création sans saisie en attente ; fenêtre après une modification de l'étape 2) ; stepper (étape à venir non cliquable avec raison au focus, étape atteinte cliquable) ; encadré d'état aux trois moments ; ligne de Quitter aux trois moments ; étape 4 (numéro de compte en erreur non choisissable, avertissement avant la coche) ; étape 5 (numéro de test sans Whitelist, autre numéro avec Whitelist) ; titres de fin (`// prototype 6`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : e2e** : `onboarding.spec.ts` et `activation.spec.ts` sur le nouveau cadre (rail présent, fil, stepper vertical, Quitter avec confirmation avant création). `npx playwright test` vert.
- [ ] **Étape 4 : commit** `feat(web): assistant de création dans le rail, stepper vertical et sortie sans perte`.

### Tâche 14 : passe de vocabulaire et exception des mots anglais (spec 6.3, 6.4, 5.4)

**Fichiers :**
- Modifier : `apps/web/messages/{fr,en}.json`, `apps/web/src/i18n/__tests__/messages-style.test.ts`, composants qui portent encore un texte en dur relevé par la passe, `CLAUDE.md:123` (règle des textes français).
- Tests : `messages-style.test.ts`, tests unitaires et e2e qui lisent les textes changés.

**Interfaces (liste de contrôle, spec 6.4) :**
- `agentNumber.account` « Compte WhatsApp : {name} » ; `account.organisations.available` « Active », `account.organisations.active` « Ouverte » ; « Usage et coûts », « Conversations et leads », « Personnalité et contenu », « Créer et tester » partout (`nav.usage`, `usage.title`, `usage.rail.kicker`, `agentSpace.usage` compris) ; « tokens d'entrée » et « tokens de sortie » partout ; Connexions « Retirer le compte » (menu) ; `overview.statMessages` « Messages » (P-1) ; « Réglages » pour l'agent IA ; aucune « liste d'accès limité » ni « accès limité » restant pour la whitelist ; aucun « à venir », « Bientôt », « bientôt disponible », « Pas encore disponible. » dans les textes d'éléments à venir (règle Soon).
- `messages-style.test.ts` : le test « accès limité » devient : FR ne contient ni « liste d'accès limité » ni « numéros de test » appliqué à la whitelist ; EN ne contient jamais « Whitelist » et dit « Allowlist » ; les sept mots anglais sont écrits avec leur majuscule dans les deux langues ; aucune esperluette « & » dans un libellé FR ; « agent » seul toujours refusé.
- `CLAUDE.md` : la règle des textes français mentionne l'exception (« Draft, Preview, Online, Offline, Whitelist, New, Soon, noms d'état ou d'étiquette, majuscule, jamais accordés ni conjugués ; en anglais Allowlist »). Changement soumis à la validation de François (écrit dans le rapport de tâche et dans la recette).

- [ ] **Étape 1 : tests de style** réécrits, qui échouent sur les textes actuels.
- [ ] **Étape 2 : passe** : `grep -n "&\|à venir\|Bientôt\|bientôt disponible\|accès limité\|Paramètres" apps/web/messages/fr.json` traité ligne par ligne ; textes EN alignés ; `grep -rn "'[A-ZÉ][a-zéèêàç ]\{6,\}'" apps/web/src/components` relu pour les textes en dur.
- [ ] **Étape 3 : vérifier** : `npm test -w @wabagent/web`, `npx tsc --noEmit`, `npx playwright test` vert.
- [ ] **Étape 4 : commits** `refactor(web): passe de vocabulaire de la navigation` puis `docs: exception des sept mots anglais dans la règle des textes français`.

### Tâche 15 : parcours de bout en bout de la navigation (spec 15.3, 15.4, 17)

**Fichiers :**
- Créer : `apps/web/e2e/navigation.spec.ts`.
- Modifier : `apps/web/e2e/two-tabs.spec.ts`, `apps/web/e2e/mock-engine.ts` (seulement si un parcours manque d'un scénario).

- [ ] **Étape 1 : `navigation.spec.ts`**, un test par cas :
  - fil d'Ariane et action principale de chaque page de la spec 10 et 11 (admin), le nom « Maison Lumière » en tête de colonne et de fil sur chaque page connectée hors compte ;
  - rail par rôle : admin (sept entrées), conseiller (sans Organisation ni Usage), entrées grisées sans navigation au clic et bulle au focus clavier ;
  - mention aux cinq endroits de la spec 7.3 avec le scénario `account-error-check` puis `limited-empty-allowlist` ;
  - conseiller `advisor@` : numéro de l'agent IA entier, aucune carte de coût, refus sur place sur `/organisation/entites`, `/agents/new`, `/usage` ; après `advisor-other-entity`, numéro du lead masqué dans Dernières conversations ;
  - sélecteur : `demo@` voit Atelier Nord et Studio Ocre (grisée, « Suspendue ») ; `advisor@` n'a ni flèche ni autre nom.
- [ ] **Étape 2 : deux onglets** dans `two-tabs.spec.ts` : changement d'organisation dans un autre onglet, l'onglet resté ouvert ne montre jamais l'ancienne organisation avec les données de la nouvelle (`// nav 15.3`) ; même cas sur `/organisation/entites` avec `demo@` (admin de c1, conseiller de c2) : refus sur place qui nomme Atelier Nord (point d'attention 5) ; assistant à l'étape 2, organisation changée ailleurs, « Créer et tester » n'aboutit pas dans c2, le Draft n'apparaît que dans la liste de c1 après retour (`// nav 15.4`).
- [ ] **Étape 3 : lancer `npx playwright test`** : tout passe, aucune assertion retirée des specs existantes (`git diff --stat main -- apps/web/e2e` relu, chaque assertion retirée justifiée au rapport par son remplaçant).
- [ ] **Étape 4 : commit** `test(web): parcours de la navigation, deux onglets et droits du conseiller`.

### Tâche 16 : revue d'isolation (spec 2b §4.5, spec 15)

Relecteur qui ne reçoit ni les rapports des exécutants ni le registre. Il reçoit la spec, `CLAUDE.md` et le code. Périmètre : le code modifié par les tâches 1 à 4 et 11 (`permissions.ts`, `contact-visibility.ts`, routes `bots.ts` et `dashboard.ts`, `dashboard-service.ts`, `bot-service.ts`, `bot-responding.ts`, `whatsapp-account-service.ts` vue des numéros, pilotes `listLeadsByBot`, `admin-service.ts`, BFF `bots/summary`, `usage/summary`, `bots/[botId]/usage`, faux moteur) et le code qu'il appelle ou qui l'appelle : `resolveAccess` et `createRequireOrganization`, `requireAction`, `loadBotNumberSummary` et `displayedAccountState`, `checkRoute` (lecture seule), `getClient`, `getAllowlist`, toute autre route qui renvoie `allowlist` ou `phone` (`grep -rn "allowlist\|\.phone" src/api src/core/services`).

- [ ] **Étape 1 : revue**, rapport `docs/superpowers/research/2026-11-XX-revue-isolation-navigation.md` : chaque constat avec fichier, ligne, scénario (entre deux organisations, ou entre deux membres d'une organisation pour les numéros et les coûts), gravité, test qui le prouve ou qui manque ; contrôle de la spec 15.8 : `git diff --stat main -- src/webhooks src/transport src/whatsapp src/core/router.ts` vide.
- [ ] **Étape 2 : corriger les constats bloquants et importants**, chacun avec son test (`// revue isolation navigation n`), puis `npm test`, `npm run test:pg`, suite `src/__tests__/isolation/` sur les deux moteurs, `npm run check:logs`.
- [ ] **Étape 3 : commit** du rapport et des corrections (un commit par sujet).

### Tâche 17 : audit des décisions, documentation, recette guidée

- [ ] **Étape 1 : tri des décisions** : relever chaque ligne `Ruling:` du registre `.superpowers/sdd/2026-11-10-refonte-navigation/progress.md` et les choix P-1 à P-11 de ce plan ; les classer en trois familles (produit visible, interprétation d'une règle validée, technique) dans `docs/superpowers/research/2026-11-XX-registre-decisions-navigation.md`, une ligne par décision : texte, tâche, fichier, famille.
- [ ] **Étape 2 : audit indépendant** par un relecteur neuf qui reçoit la spec, `CLAUDE.md`, les specs des comptes et équipes et 2b, le code de la branche et le tableau de l'étape 1 sans les justifications : pour chaque décision, conforme, contraire à une source (laquelle) ou à trancher par François. Rapport `docs/superpowers/research/2026-11-XX-audit-decisions-navigation.md`. Toute décision contraire est corrigée (avec son test) ou présentée à François.
- [ ] **Étape 3 : documentation** : `CLAUDE.md`, état du projet (lot « Refonte de la navigation » exécuté sur `feat/refonte-navigation`, pas encore mergé, avec plan, spec, revue d'isolation, audit et contrats changés : `not_responding`, `usage.read`, numéros de contacts masqués par le moteur, `first_entity_name`, quatrième argument du script) ; `docs/ARCHITECTURE.md` relu contre le code (sections des tâches 1, 2, 3, 4 et 6).
- [ ] **Étape 4 : recette guidée rédigée** `docs/superpowers/research/2026-11-XX-recette-refonte-navigation.md` : moteur et back-office lancés sur une copie de `store/demo.db` dans un worktree jetable, `MAILER_LOG_LINKS=true` ; deux organisations dont une suspendue ; un agent IA par cas réalisable de la spec 7.1 (compte en erreur, whitelist vide). Une étape par choix de la section 19 de la spec qui se voit à l'écran, puis par décision « produit visible » de l'étape 1 (P-1 à P-11 compris), dans l'ordre des sections de la spec, parcours admin puis conseiller : pour chacune, où aller, quoi faire, ce qui doit se voir, case « validé » ou « à reprendre » laissée à François. Captures des pages principales (liste des agents IA, page d'un agent IA, assistant, Connexions, une page du compte) comparées à la maquette.
- [ ] **Étape 5 : commit** `docs(navigation): registre et audit des décisions, recette guidée, état du projet`.
- [ ] **Étape 6 : recette en réel avec François** sur ce document ; chaque « à reprendre » devient une correction avec son test avant la revue finale.
- [ ] **Étape 7 : revue finale de la branche** sur le modèle le plus capable, puis merge `--no-ff` et push seulement avec l'accord explicite de François.
