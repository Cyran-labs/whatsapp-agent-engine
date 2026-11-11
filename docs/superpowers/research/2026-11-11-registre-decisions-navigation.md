# Registre des décisions du lot « Refonte de la navigation »

Date : 11 novembre 2026. Branche : `feat/refonte-navigation`. Tâche 17, étape 1 du plan `docs/superpowers/plans/2026-11-10-refonte-navigation.md`.

Sources relevées :
- lignes `Ruling:` du registre d'exécution `.superpowers/sdd/2026-11-10-refonte-navigation/progress.md` ;
- choix du rédacteur P-1 à P-12 et amendements A-1 à A-15 du plan ;
- décisions des implémenteurs acceptées par le contrôleur (rapports `task-*-report.md` et lignes du registre qui disent « accepté »).

Familles :
- **A, produit visible** : ce qu'un utilisateur voit ou peut faire ;
- **B, interprétation d'une règle validée** : lecture d'une décision de François, de la spec ou de `CLAUDE.md` ;
- **C, technique** : structure du code, tests, méthode, sans effet visible propre.

Ce tableau est destiné à un auditeur neuf : il donne chaque décision sans sa justification. Chaque décision est contestable, sauf celles de la dernière section. Abréviations des sources : « spec » désigne `docs/superpowers/specs/2026-11-10-refonte-navigation-design.md` ; « spec comptes » la spec « Comptes et équipes » ; « registre » le fichier `progress.md`.

## Décisions contestables

### Choix du rédacteur du plan (P-1 à P-12)

| N° | Décision | Tâche | Fichier(s) | Famille | Source appliquée ou interprétée |
|---|---|---|---|---|---|
| 1 | La colonne de compteur de la liste des agents IA s'appelle « Messages », sans « 30 j » ; la statistique de la Vue d'ensemble `overview.statMessages` passe de « Messages 30 j » à « Messages ». (P-1) | 8, 14 | `apps/web/src/components/agents/agents-table.tsx`, `apps/web/messages/{fr,en}.json` | A | spec 10.2, 18 ; spec 19 n° 23 |
| 2 | Encadré « Ne répond pas » de la page d'un agent IA, compte WhatsApp en erreur : lien « Ouvrir Connexions ↗ » vers `/organisation/connexions`, pas de second point d'entrée de « Remplacer les identifiants ». Motif `number_removed` : action « Changer de numéro ». (P-2) | 9 | `apps/web/src/components/agent/status-panel.tsx` | A | spec 10.3 |
| 3 | Masque d'un numéro de contact : valeur de n chiffres (n au moins 8), précédés ou non de « + » : « + » s'il y en avait un, les min(3, n - 8) premiers chiffres, ` •• •• •• `, les 2 derniers (`+336 •• •• •• 78`) ; moins de 8 chiffres : `••••` ; identifiant non numérique (BSUID) : ses 2 premiers caractères puis `••••`, ou `••••` s'il fait 4 caractères ou moins. Ce format remplace celui écrit d'abord dans P-3 (5 premiers chiffres, `•• ••`, 2 derniers, seuil de 9 chiffres) ; révision faite par le contrôleur à la relecture de la tâche 3. (P-3) | 3 | `packages/contracts/src/contact-mask.ts` | A | spec 9.2, 18 |
| 4 | Chaque page rend sa propre barre du haut (`PageBar`) en tête de sa zone de contenu, collante ; aucun contexte ne remonte le fil d'Ariane vers un gabarit. (P-4) | 5, 6 | `apps/web/src/components/shell/page-bar.tsx`, pages de `apps/web/src/app/[locale]/(app)/` | C | spec 5.3, 18 |
| 5 | Le bandeau d'organisation (`OrgNoticeBanner`) reste en haut de l'écran, au-dessus du rail. (P-4) | 6 | `apps/web/src/components/shell/app-frame.tsx` | B | spec 5.3 |
| 6 | Pastille Draft : fond `surface`, contour `border-strong`, texte `muted`, point en contour seul. Pastille Offline : fond `surface-subtle`, texte `muted-2`, point plein `muted-2`. (P-5) | 7 | `apps/web/src/components/agents/status-style.ts`, `status-pill.tsx` | A | spec 6.2, 18 |
| 7 | Rail de 84 px ; icônes `lucide-react` : Organisation `Building2`, Agents IA `Bot`, Usage `BarChart3`, Leads `MessagesSquare`, Reprise `Headset`, Aide `CircleHelp`. (P-6) | 5 | `apps/web/src/components/shell/app-rail.tsx` | A | spec 5.1, 18 |
| 8 | Période des pages d'usage : état local de la page, 30 jours par défaut, absente de l'adresse. (P-7) | 6, 11 | `apps/web/src/components/usage/period-choice.tsx`, `apps/web/src/app/[locale]/(app)/usage/page.tsx`, `agents/[botId]/usage/page.tsx` | A | spec 10.4, 10.8 |
| 9 | Fenêtre de sortie de l'assistant : titre « Quitter la création ? », texte « Ce que vous avez saisi n'est pas encore enregistré. », boutons « Rester » et « Quitter sans enregistrer ». (P-8) | 13 | `apps/web/src/components/wizard/leave-dialog.tsx` | A | spec 12.4 |
| 10 | Titre de fin de l'assistant après activation : « {nom} est Online » ou « {nom} est en Preview », au lieu de « {nom} est en ligne ». (P-9) | 13 | `apps/web/src/components/wizard/success.tsx`, `wizard-column.tsx` | B | spec 12.3 et 6.1 (écart entre les deux) |
| 11 | Texte du refus du moteur pour un compte WhatsApp encore utilisé : « Mettez d'abord Offline les agents IA qui utilisent ce compte : » suivi des noms. Version révisée à la relecture de la tâche 4 ; la première version disait « Passez d'abord Offline… ». (P-10) | 4 | `src/core/services/whatsapp-account-service.ts`, `apps/web/e2e/mock-engine.ts`, `apps/web/messages/fr.json` | A | spec 6.4 |
| 12 | « Whitelist » prend la majuscule partout, en milieu de phrase compris (« Ajoutez au moins un numéro à la Whitelist. ») ; les exemples en minuscule des sections 6.1 et 6.4 de la spec sont tenus pour fautifs. (P-10, révision) | 4, 7, 14 | `packages/contracts/src/bot-status.ts`, `apps/web/messages/{fr,en}.json` | B | spec 6.3 |
| 13 | Script de création d'une organisation : le nom de la première entité est le quatrième argument, après l'adresse de l'admin. (P-11) | 4 | `scripts/create-organization.ts` | C | spec 13 |
| 14 | Phrase du refus sur place : « Cette page de l'organisation {Org} est réservée aux administrateurs. » au lieu de « Cette page de {Org} … ». (P-12) | 5 | `apps/web/src/components/shell/reserved-page.tsx`, `apps/web/messages/{fr,en}.json` | A | spec 10.6 |

### Amendements du scan de cohérence (A-1 à A-15)

Ligne `Ruling:` du registre : toutes les suggestions du scan sont retenues et écrites en amendements.

| N° | Décision | Tâche | Fichier(s) | Famille | Source appliquée ou interprétée |
|---|---|---|---|---|---|
| 15 | La suppression de `org-switcher.tsx` et de son test passe à la tâche 6. (A-1) | 5, 6 | `apps/web/src/components/shell/org-switcher.tsx`, `top-bar.tsx` | C | plan, ordre des tâches |
| 16 | `WhatsAppNumberView.bot.status_reason` reste le motif brut `string \| null` ; un motif inconnu s'affiche « Arrêté ». (A-2) | 1, 7 | `packages/contracts/src/whatsapp.ts`, `apps/web/src/lib/status-words.ts` | C | spec 6.1 |
| 17 | `ColumnItem` dérive de `RailItem` (`Omit<RailItem, 'dot' \| 'soon'> & { dot?: BotStatus \| 'danger' }`), classes tirées de `STATUS_STYLE` et `MENTION_STYLE`. (A-3) | 5, 8 | `apps/web/src/components/shell/middle-column.tsx` | C | plan, source unique des styles |
| 18 | La tâche 6 pose le fil d'Ariane de base de chaque page ; les tâches 8 et 11 ajoutent les variantes filtrées et d'usage. (A-4) | 6, 8, 11 | `apps/web/src/components/shell/page-bar.tsx`, pages | C | plan, ordre des tâches |
| 19 | La tâche 2 retire aussi, pour un non-admin, l'appel à `/usage` et la carte de coût de la Vue d'ensemble. (A-5) | 2 | `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx`, `apps/web/src/components/agent/overview.tsx` | C | spec 9.1 |
| 20 | Le faux moteur importe `canSeeContactNumbers` et `maskContactNumber` au lieu de les recopier ; test de parité obligatoire si l'import est impossible. (A-6) | 3 | `apps/web/e2e/mock-engine.ts` | C | plan, contraintes globales (faux moteur) |
| 21 | Un lien qui change d'espace porte le nom de l'espace de destination (« ↗ Connexions ») ; « ↗ » seul reste pour le tableau de `/usage`. (A-7) | 5, 8, 9, 11 | `apps/web/src/components/shell/middle-column.tsx`, `apps/web/src/components/agents/setup-banner.tsx`, `apps/web/src/components/usage/usage-summary-table.tsx` | A | spec 10.3, 10.8 ; spec 19 n° 28 |
| 22 | Le contexte de `useNavigationGuard` a une valeur par défaut où `confirmLeave` rend `true`. (A-8) | 5, 13 | `apps/web/src/components/shell/navigation-guard.tsx` | C | plan |
| 23 | Le test de recherche des leads par numéro cherche « 612345 ». (A-9) | 3 | tests de `src/core/services/dashboard-service.ts` | C | spec 9.2, 15 |
| 24 | Le parcours qui vérifie le numéro masqué dans Dernières conversations utilise un lead sans nom. (A-10) | 15 | `apps/web/e2e/navigation.spec.ts`, `mock-engine.ts`, `mock-state.ts` | C | spec 9.2, 15 |
| 25 | « Même corps » des 403 de coûts : même statut, même `error.code`, même `error.reason`, même texte ; `request_id` exclu de la comparaison. (A-11) | 2 | `src/__tests__/isolation/navigation.test.ts` | B | spec 9.1, 15 ; plan, impact multi-organisation |
| 26 | `detail()` calcule `not_responding` à partir du numéro et de la liste déjà lus ; `loadNotResponding` sert aux lectures qui n'ont pas ces faits. (A-12) | 1 | `src/core/services/bot-service.ts`, `src/core/services/bot-responding.ts` | C | spec 7.2 |
| 27 | La bulle de la mention « Ne répond pas » réutilise le composant de bulle de `ComingSoon`. (A-13) | 7 | `apps/web/src/components/agents/not-responding-mention.tsx`, `apps/web/src/components/shell/coming-soon.tsx` | C | plan |
| 28 | Pas de test rouge exigé pour un comportement déjà vrai : un test de non-régression, signalé comme tel, suffit. (A-14) | 6, 9 et suivantes | tests web | B | `CLAUDE.md` (tout invariant a un test) ; méthode TDD du plan |
| 29 | Le test des mots anglais vérifie Draft, Preview, Online, Offline, Whitelist, New, Soon en français ; en anglais, Whitelist est « Allowlist ». (A-15) | 14 | `apps/web/src/i18n/__tests__/messages-style.test.ts` | B | spec 6.3 |

### Décisions prises en cours d'exécution

| N° | Décision | Tâche | Fichier(s) | Famille | Source appliquée ou interprétée |
|---|---|---|---|---|---|
| 30 | `npm run test:pg` lancé sur un Postgres local (Homebrew) au lieu du conteneur jetable, tant que Docker ne répond pas. | 1 et suivantes | `docker-compose.test.yml` (non utilisé) | C | `CLAUDE.md`, commandes |
| 31 | Le dossier `apps/web/e2e`, non couvert par `tsc`, est parqué puis couvert à la tâche 15 par `tsconfig.e2e.json`, enchaîné dans `npm run typecheck -w @wabagent/web`. | 1, 15 | `apps/web/tsconfig.e2e.json`, `apps/web/package.json`, `.github/workflows/ci.yml` | C | `CLAUDE.md`, CI |
| 32 | Le test d'équivalence de la mention simule par des lectures surchargées les deux états que le store n'atteint pas (numéro retiré, compte `disconnected` avec un numéro). | 1 | `src/core/__tests__/not-responding-equivalence.test.ts` | C | spec 15.1, 20 n° 2 |
| 33 | Le motif de la mention est comparé au verdict de `checkRoute` par une table de correspondance (`number_removed`, `account_error` donne `account_not_connected`, `org_inactive` donne `organization_suspended`, `not_allowed` donne `empty_allowlist`). | 1 | `src/core/__tests__/not-responding-equivalence.test.ts` | C | spec 7.2, 15.1 |
| 34 | `listBots` lit le statut de l'organisation une fois pour toute la liste. | 1 | `src/core/services/bot-service.ts` | C | relecture tâche 1, M-2 |
| 35 | Le faux moteur calcule la mention sur l'état stocké du compte (pas de simulation des signatures rejetées). | 1 | `apps/web/e2e/mock-engine.ts` | C | plan, contraintes globales (faux moteur) |
| 36 | Le refus des coûts est livré en deux commits (moteur, puis écran). | 2 | historique git | C | `CLAUDE.md` (1 commit = 1 sujet) |
| 37 | État intermédiaire accepté entre les tâches 2 et 11 : liens Usage encore visibles pour un non-admin, qui reçoit l'échec générique. | 2 à 11 | `top-bar.tsx`, `agent-sections.ts` (états intermédiaires) | C | plan, ordre des tâches |
| 38 | Garde statique : tout appel `listLlmUsage*` est dans `DashboardService.usage`, et `.usage(` n'est appelé que par la route `GET /usage` sous `requireAction('usage.read')`. | 2 | `src/__tests__/cost-readers.test.ts` | C | spec 15.5 ; `CLAUDE.md` (tout invariant a un test) |
| 39 | Le BFF `/api/usage/summary` répond 403 en entier, sans appeler le moteur, quand le rôle dans l'organisation active n'est pas `admin` ; organisation indéterminée : le moteur décide. | 2 | `apps/web/src/app/api/usage/summary/route.ts` | B | spec 9.1 ; spec 19 n° 5 |
| 40 | Le web lit « admin » comme `activeOrg.role === 'admin'`, ce qui comprend l'opérateur (listé `role: 'admin'` par `/auth/me`). | 2, 5, 6 | `apps/web/src/components/agent/overview.tsx`, `apps/web/src/components/shell/app-rail.tsx` | B | spec 9.1 ; spec comptes (opérateur) |
| 41 | `OverviewData.usage` distingue « non lu » (`NOT_READ`) de « en chargement » ; la carte de coût n'est rendue que pour l'admin. | 2 | `apps/web/src/components/agent/overview.tsx` | C | relecture tâche 2, Mineur 2 |
| 42 | Le mineur 3 de la relecture de la tâche 2 est laissé en l'état. | 2 | aucun | C | relecture tâche 2 |
| 43 | `qualified_data.phone` (copie du numéro écrite par le moteur dans les données de chaque lead) est masqué comme `phone`, dès qu'il est non nul, même non textuel. | 3 | `src/core/services/dashboard-service.ts` | B | spec 9.2 ; spec 19 n° 4 (champs libres non masqués) |
| 44 | Un nom de profil WhatsApp égal au numéro n'est pas masqué (texte libre, hors périmètre). | 3 | `src/core/services/dashboard-service.ts` | B | spec 9.2 ; spec 19 n° 4 |
| 45 | `canSeeContactNumbers` : vrai pour l'opérateur, l'admin et le super manager (lecture seule comprise) ; sinon vrai seulement si l'agent IA a une entité et que le membre a une appartenance sur cette entité ; agent IA sans entité : masqué pour le manager et le conseiller. | 3 | `src/core/auth/permissions.ts` | B | spec 9.2 ; plan, point d'attention 2 |
| 46 | Les réponses des écritures (`POST /bots`, `PATCH`, `PUT allowlist`, statut, numéro, activation) renvoient la Whitelist en entier, sous `bots.configure`. | 3 | `src/api/admin/routes/bots.ts` | B | spec 9.2 |
| 47 | `GET /bots/:botId/leads/:phone` répond 404 si l'agent IA est hors de l'organisation, puis 403 pour un membre masqué, avant toute lecture du lead. | 3 | `src/core/services/dashboard-service.ts` | C | spec 9.2 ; spec 19 n° 3 |
| 48 | Recherche des leads pour un membre masqué : sur le nom seul ; les jokers `%` et `_` de LIKE restent actifs dans le nom. | 3 | `src/core/database/{sqlite,postgres}.ts` | C | spec 9.2 |
| 49 | Le faux moteur importe `src/core/auth/permissions.ts` du moteur par chemin relatif. | 3 | `apps/web/e2e/mock-engine.ts` | C | A-6 |
| 50 | Les cinq clés de `fr.json` qui reprennent mot pour mot les refus du moteur sont alignées dès la tâche 4. | 4 | `apps/web/messages/fr.json` | C | spec 6.4 |
| 51 | Création d'une organisation et de sa première entité en une transaction (`createClientWithEntity`, INSERT stricts, tests sur les deux pilotes). | 4 | `src/core/database/{types,sqlite,postgres}.ts`, `src/core/auth/admin-service.ts` | C | spec 13 ; spec 19 n° 35 |
| 52 | `isUniqueViolation` restreint aux violations d'unicité (une violation NOT NULL ne donne plus CONFLICT) et déplacé dans un module partagé. | 4 | `src/core/database/unique-violation.ts`, `src/core/services/entity-service.ts` | C | relecture tâche 4 |
| 53 | Script en reprise (organisation déjà créée sans admin) : le quatrième argument reste exigé mais est ignoré, l'entité existante n'est pas renommée, et le script l'écrit dans son journal `[CreateOrganization] …`. | 4 | `scripts/create-organization.ts` | C | plan, contraintes globales (aucune entité existante renommée) ; `CLAUDE.md` (journaux) |
| 54 | Les deux « whitelist » en minuscule hors écran (commentaire de test, `docs/ARCHITECTURE.md`) sont laissés à la tâche 14. | 4 | `src/core/services/__tests__/contact-numbers.test.ts`, `docs/ARCHITECTURE.md` | C | spec 6.3 |
| 55 | Jetons `--on-brand` et `--brand-hover` ajoutés au thème au lieu de couleurs codées en dur. | 5 | `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts` | C | plan, contraintes globales (charte) |
| 56 | Entrée active de la colonne du milieu : fond `surface-subtle`, contour intérieur, gras, sans barre menthe (aspect de la maquette). | 5 | `apps/web/src/components/shell/middle-column.tsx` | A | maquette ; spec muette |
| 57 | Largeur de la colonne du milieu gardée à 236 px (la maquette en a 250). | 5 | `apps/web/src/components/shell/middle-column.tsx` | B | spec 4 ; spec 20 n° 3 |
| 58 | « Mon compte » du fil d'Ariane des pages du compte est un lien vers `/account/organisations`. | 5 | `apps/web/src/components/shell/page-bar.tsx`, `apps/web/src/app/[locale]/(app)/account/layout.tsx` | A | spec 11 |
| 59 | Entrées grisées (Leads, Reprise, Aide, entrées Soon) : `role="link"`, sans `href`, `aria-disabled="true"`, focalisables ; la bulle est hors du nom accessible, à contraste plein, et se ferme par Échap et au redimensionnement. | 5, 6 | `apps/web/src/components/shell/coming-soon.tsx`, `app-rail.tsx` | B | `CLAUDE.md` (élément sans effet qui le dit) ; spec 5.1, 18 |
| 60 | Nom accessible de l'entrée Compte du rail : « Compte, {adresse} ». | 5 | `apps/web/src/components/shell/app-rail.tsx`, `apps/web/messages/{fr,en}.json` | A | spec 5.1 |
| 61 | Le déclencheur du menu du bloc Organisation a pour nom accessible son contenu (nom, rôle, nombre), sans `aria-label`. | 5 | `apps/web/src/components/shell/org-block.tsx` | C | spec 5.2 |
| 62 | Test moteur ajouté : `/auth/me` de l'opérateur liste chaque organisation avec `role: 'admin'`. | 6 | `src/api/admin/__tests__/auth-routes.test.ts` | C | `CLAUDE.md` (tout invariant a un test) ; spec comptes |
| 63 | `UsageView` ne reçoit plus `period` ; la période vit dans la page, qui la passe à `PeriodChoice` et à la lecture. | 6 | `apps/web/src/components/agent/usage-view.tsx` | C | P-7 |
| 64 | Sections à venir de l'agent IA affichées en Soon avec leur bulle dès la tâche 6. | 6 | `apps/web/src/components/agent/agent-rail.tsx`, `apps/web/messages/{fr,en}.json` | A | spec 5.4 ; `CLAUDE.md` (élément sans effet qui le dit) |
| 65 | Page en échec de lecture (agent IA, usage, Connexions) : la barre du haut garde le fil d'Ariane, sans action. | 6 | `apps/web/src/components/shell/page-bar.tsx`, pages concernées | A | spec 5.3 |
| 66 | Nom de l'agent IA encore en lecture : squelette à sa place dans le fil d'Ariane, jamais un lien ni un segment vide. | 6 | `apps/web/src/components/shell/page-bar.tsx` | A | spec 5.3 |
| 67 | L'encart « Whitelist vide » et son action d'ajout restent affichés dès qu'un agent IA en Preview a une Whitelist vide, même si la mention « Ne répond pas » donne un autre motif (compte en erreur). | 7 | `apps/web/src/components/agent/status-panel.tsx` | A | spec 7.1, 10.3 |
| 68 | La mention suit l'ordre des motifs de la règle des contrats : un agent IA en Preview à Whitelist vide sur un compte en erreur porte le motif du compte. | 7 | `packages/contracts/src/bot-status.ts`, `apps/web/src/components/agent/status-panel.tsx` | B | spec 7.1, 7.2 |
| 69 | Motif d'Offline affiché à côté de la pastille dans la fenêtre « Brancher » de Connexions. | 7 | `apps/web/src/components/connections/assign-bot-dialog.tsx` | A | spec 6.1 |
| 70 | Un seul composant (`AgentStatusLine`) rend « motif pour Offline, sinon mention » dans la liste, Connexions et la colonne de l'agent IA ; la mention n'y apparaît que pour un statut en service (Preview, Online) et un motif connu. | 7 | `apps/web/src/components/agents/agent-status-line.tsx`, `apps/web/src/lib/status-words.ts` | B | spec 7.1, 7.3 |
| 71 | Dans Connexions, la pastille de statut sort du lien du nom de l'agent IA. | 7 | `apps/web/src/components/connections/account-card.tsx` | A | spec 7.3 |
| 72 | La bulle de la mention et sa forme longue portent le même texte complet (« Ne répond pas : … »). | 7 | `apps/web/src/components/agents/not-responding-mention.tsx`, `apps/web/messages/{fr,en}.json` | A | spec 7.3 |
| 73 | La mention « Ne répond pas » est un bouton sans autre effet que d'ouvrir sa bulle, qui lui sert de description accessible. | 7 | `apps/web/src/components/agents/not-responding-mention.tsx` | A | spec 7.3 ; `CLAUDE.md` (élément sans effet qui le dit) |
| 74 | Textes des confirmations de statut réécrits par l'implémenteur : `limitAccess` « passera en Preview et ne répondra plus qu'aux numéros de sa Whitelist », `deactivate` « vous pourrez le remettre en Preview ou Online », `unservedHint.paused` « de le remettre en service ». | 7 | `apps/web/messages/{fr,en}.json` | A | spec 6.1, 6.4 |
| 75 | Point de la pastille tiré de `STATUS_STYLE.*.dot` ; Draft a un point en contour de 1 px. | 7 | `apps/web/src/components/agents/status-pill.tsx` | A | P-5 |
| 76 | Le filtre et le compteur « Ne répond pas » de la colonne comptent les agents IA dont la pastille montre la mention (Preview ou Online, motif connu), pas tous ceux dont `not_responding` est non nul. | 8 | `apps/web/src/lib/agents-filter.ts` | B | spec 7.3 |
| 77 | Le lien « Brancher un numéro » de la Mise en route qui mène à Connexions porte « ↗ Connexions ». | 8 | `apps/web/src/lib/onboarding.ts`, `apps/web/src/components/agents/setup-banner.tsx` | A | A-7 ; spec 10.2 |
| 78 | Pastilles Online, Preview, « Ne répond pas » et encadré rouge gardent un fond clair en thème sombre (jetons de la charte inchangés). | 8, 9 | `apps/web/src/app/globals.css`, `apps/web/src/components/agents/status-style.ts` | A | charte (`globals.css`) |
| 79 | Tout membre voit tous les agents IA de l'organisation ; seule la Whitelist est masquée hors de son entité. | 8 | `src/core/auth/contact-visibility.ts`, `apps/web/src/components/agents/agents-table.tsx` | B | spec comptes ; spec 9.2, 9.3 |
| 80 | `ColumnItem` garde sa propre interface au lieu de la forme écrite par A-3. | 8 | `apps/web/src/components/shell/middle-column.tsx` | C | A-3 |
| 81 | L'entrée « Ne répond pas » de la colonne apparaît avec les autres compteurs, à la fin de la lecture, sans place réservée pendant la lecture. | 8 | `apps/web/src/app/[locale]/(app)/page.tsx` | A | spec 7.3 |
| 82 | Quand `not_responding` est non nul, le résumé du panneau Santé dit « ne répond pas : voir l'encart Statut » au lieu de « tout est opérationnel » ou « à vérifier ». | 9 | `apps/web/src/components/agent/health-panel.tsx` | A | spec 7.3, 10.3 |
| 83 | Une seule ligne de raison sous une rangée d'actions quand toutes ses actions grisées ont la même raison (pas seulement Draft sans numéro). | 9 | `apps/web/src/components/agent/status-panel.tsx` | A | spec 10.3 |
| 84 | Le test Q-10 de l'encart Whitelist est retiré de l'encart et reporté sur l'encadré Statut. | 9 | `apps/web/src/components/agent/__tests__/overview.test.tsx`, `status-panel.test.tsx` | C | `CLAUDE.md` (aucun test affaibli) |
| 85 | `formatPhone` reste appliqué aux entrées de la Whitelist en lecture ; une entrée masquée s'affiche telle que reçue. | 9 | `apps/web/src/components/agent/allowlist-panel.tsx` | B | spec 10.3 (« entrées affichées telles que reçues ») |
| 86 | Membre qui n'est pas administrateur (super manager, lecture seule comprise, manager, conseiller) : l'encadré « Ne répond pas » affiche « Prévenez un administrateur de votre organisation. » au lieu de l'action, lien vers Connexions compris. Un admin n'est jamais en lecture seule (la lecture seule n'existe que sur un super manager, spec comptes) ; reformulé le 11 novembre 2026 après l'audit des décisions, qui avait relevé un fait faux. | 9 | `apps/web/src/components/agent/status-panel.tsx` | A | spec 10.3, 9.3 ; spec comptes (lecture seule) |
| 87 | `MiddleColumn` gagne une prop `back` (lien de retour). | 9 | `apps/web/src/components/shell/middle-column.tsx` | C | spec 5.2 |
| 88 | Phrases nouvelles de l'encadré `agentStatus.notResponding.*` (aucun numéro branché, numéro retiré chez le fournisseur, compte en erreur, Preview à Whitelist vide), phrase du « reset », bulle de « Modifier la personnalité ». | 9 | `apps/web/messages/{fr,en}.json` | A | spec 7.1, 10.3 |
| 89 | Graphique de coût de la Vue d'ensemble : 7 jours calendaires de Paris finissant aujourd'hui, un jour sans appel en barre à zéro. | 9 | `apps/web/src/components/agent/cost-card.tsx`, `apps/web/src/lib/period.ts` | A | spec 10.3 (légende « 7 derniers jours ») |
| 90 | Coûts groupés par jour UTC dans le moteur, affichés sur des jours de Paris : décalage possible entre minuit et 2 h, laissé en l'état. | 9 | `src/core/services/dashboard-service.ts`, `apps/web/src/components/agent/cost-card.tsx` | C | spec 10.3 |
| 91 | Moyenne « ~{montant}/jour » divisée par les jours d'activité (comportement antérieur), laissée en l'état. | 9 | `apps/web/src/components/agent/cost-card.tsx` | A | spec 10.3 |
| 92 | « Brancher sur un agent IA » est grisé, avec sa raison, sur un numéro libre d'un compte en erreur, en plus de « Changer d'agent IA » ; raison « Le compte WhatsApp de ce numéro n'est pas connecté : un agent IA branché ici ne répondrait pas. ». | 10 | `apps/web/src/components/connections/number-menu.tsx`, `numbers-table.tsx` | A | spec 10.7 ; spec 19 n° 30 |
| 93 | « N en erreur » de l'entrée Connexions rendu en pastille `danger-soft` / `danger-ink`, fond clair en sombre. | 10 | `apps/web/src/components/shell/middle-column.tsx` | A | spec 10.7 |
| 94 | Bandeau d'expiration sans bouton « Remplacer les identifiants » quand les identifiants sont illisibles ; texte de reconnexion à la place. | 10 | `apps/web/src/components/connections/account-alerts.tsx`, `account-error.ts` | A | spec 10.7 |
| 95 | « Renvoyer » une invitation : `aria-disabled` pendant l'envoi, bulle « Envoi en cours », un second clic n'envoie rien. | 10 | `apps/web/src/components/organisation/invitations-table.tsx` | A | spec 10.7 |
| 96 | Réglages : les modes indisponibles sont des `role="radio"` focalisables, le mode en vigueur aussi ; la carte Connexion Meta est un `group` dans le `radiogroup`. | 10 | `apps/web/src/app/[locale]/(app)/organisation/reglages/page.tsx` | C | `CLAUDE.md` (élément sans effet qui le dit) |
| 97 | Textes des quatre bulles de l'espace Organisation, libellé « {n} en erreur », icône ◈ de « Marque et connaissances ». | 10 | `apps/web/messages/{fr,en}.json`, `apps/web/src/components/organisation/organisation-rail.tsx` | A | spec 10.7, 16 |
| 98 | En anglais, les bulles à venir commencent toutes par « Coming soon: ». | 10, 14 | `apps/web/messages/en.json` | A | spec 5.4, 6.3 |
| 99 | Compteurs de l'espace Organisation remis en chargement sur un 409 `ORG_CHANGED`. | 10 | `apps/web/src/app/[locale]/(app)/organisation/layout.tsx` | C | `CLAUDE.md` (multi-organisations) |
| 100 | La page d'usage d'un agent IA porte sa propre garde (refus sur place pour un non-admin), en plus de celle de la mise en page ; la page est reconnue à son segment exact (`isAgentUsagePath`). | 11 | `apps/web/src/app/[locale]/(app)/agents/[botId]/usage/page.tsx`, `layout.tsx`, `apps/web/src/components/agent/agent-path.ts` | C | spec 9.1, 10.6 |
| 101 | Titre de la page d'usage d'un agent IA aligné à gauche avec le fil d'Ariane. | 11 | `apps/web/src/components/agent/usage-view.tsx` | A | spec 10.4 |
| 102 | Au changement de période, les chiffres des deux pages d'usage repassent en squelette. | 11 | `apps/web/src/app/[locale]/(app)/usage/page.tsx`, `agents/[botId]/usage/page.tsx` | A | spec 10.4, 10.8 |
| 103 | Nom de l'entité filtrée encore en lecture : squelette dans le fil et le titre de `/usage`. | 11 | `apps/web/src/app/[locale]/(app)/usage/page.tsx` | A | spec 10.8 |
| 104 | Entités illisibles sur `/usage` : fil « Entité indisponible », titre « Usage et coûts : entité indisponible » (clé `usage.entityUnavailableTitle`). | 11 | `apps/web/src/app/[locale]/(app)/usage/page.tsx`, `apps/web/messages/{fr,en}.json` | A | spec 10.8 |
| 105 | Refus sur place sans organisation active : « Cette page est réservée aux administrateurs. ». | 11 | `apps/web/src/components/shell/reserved-page.tsx` | A | spec 10.6 |
| 106 | `/agents/new` rend le refus sur place aussi pour un membre en lecture seule. | 11 | `apps/web/src/app/[locale]/(app)/agents/new/page.tsx` | B | spec 10.6 ; spec comptes (lecture seule) |
| 107 | Tableau des organisations du compte : colonne d'action vide pour l'organisation ouverte (plus de « ouverte » répété). | 12 | `apps/web/src/app/[locale]/(app)/account/organisations/page.tsx` | A | spec 11 |
| 108 | « Aucune organisation » : un 401 à la lecture de session renvoie à la connexion ; les autres échecs affichent « Impossible de lire votre session pour le moment. » avec « Réessayer ». | 12 | `apps/web/src/app/[locale]/no-organization/page.tsx` | A | spec 11 ; spec 19 n° 32 |
| 109 | Pendant la relecture de session, « Réessayer » reste en place, `aria-disabled`, libellé « Lecture en cours. ». | 12 | `apps/web/src/app/[locale]/no-organization/page.tsx` | A | spec 11 |
| 110 | Traduction anglaise de « Ouverte » : « Open ». | 12 | `apps/web/messages/en.json` | A | spec 11, 18 |
| 111 | « Contactez le support. » s'affiche si toutes les organisations suspendues ont `role: 'admin'`, sans regarder `read_only`. | 12 | `apps/web/src/app/[locale]/no-organization/page.tsx` | B | spec 11 ; spec comptes |
| 112 | Clés de statut d'organisation nommées d'après le mot affiché (`current`, `openable`). | 12 | `apps/web/messages/{fr,en}.json` | C | relecture tâche 12 |
| 113 | Étape Numéro de l'assistant : la raison « Le compte WhatsApp de ce numéro n'est pas connecté. » s'affiche une fois, sous l'en-tête du compte, et non sous chaque numéro. | 13 | `apps/web/src/components/numbers/number-picker.tsx` | A | spec 12.3 |
| 114 | La fenêtre « Brancher un numéro » de la page de l'agent IA suit la même règle que l'assistant : numéro d'un compte en erreur non choisissable, avertissement « passera Offline » visible avant le choix. | 13 | `apps/web/src/components/agent/assign-number-dialog.tsx`, `apps/web/src/components/numbers/number-picker.tsx` | A | spec 12.3 (étendue hors assistant) |
| 115 | Raison quand aucun numéro n'est utilisable : « Aucun numéro n'est utilisable : le compte WhatsApp n'est pas connecté. Réparez-le dans Connexions, ou choisissez Plus tard. » (assistant), et texte équivalent dans la fenêtre « Brancher un numéro ». | 13 | `apps/web/src/components/wizard/step-number.tsx`, `apps/web/src/components/agent/assign-number-dialog.tsx` | A | spec 12.3 |
| 116 | Espaces insécables retirées des nouveaux textes de l'assistant. | 13 | `apps/web/messages/fr.json` | C | `fr.json` existant |
| 117 | Confirmation de sortie seulement si une saisie serait perdue : assistant ouvert sans rien toucher, « Quitter » et le rail sortent sans fenêtre ; une entité présélectionnée par l'adresse n'est pas une saisie. | 13 | `apps/web/src/components/wizard/wizard.tsx` | B | spec 12.4 ; P-8 |
| 118 | La garde de sortie couvre toute saisie en attente : modification non envoyée, champ de lead tapé sans « Ajouter », entrées de la Whitelist de l'étape 5, numéro tapé sans « Ajouter ». | 13 | `apps/web/src/components/wizard/wizard.tsx`, `step-personality.tsx`, `step-activate.tsx` | A | spec 12.4 |
| 119 | Le lien du fil d'Ariane passe aussi par la garde de sortie (`GuardedLink`), comme le rail, la colonne et le sélecteur d'organisation. | 13 | `apps/web/src/components/shell/navigation-guard.tsx`, `page-bar.tsx` | A | spec 12.4 |
| 120 | `GuardedLink` et deux méthodes internes au contexte (`isActive`, `navigate`) en plus de `{ setGuard, confirmLeave }`. | 13 | `apps/web/src/components/shell/navigation-guard.tsx` | C | plan, tâche 13 |
| 121 | Le fournisseur de la garde est monté au-dessus de `SessionProvider`, et `reloadHome` lève la garde avant de recharger. | 13 | `apps/web/src/app/[locale]/(app)/layout.tsx`, `apps/web/src/components/providers/session-provider.tsx` | C | spec 12.4, 15.4 |
| 122 | Le bouton Retour du navigateur quitte l'assistant sans fenêtre de confirmation ; une fenêtre ouverte se ferme au changement de page. | 13 | `apps/web/src/components/shell/navigation-guard.tsx` | A | spec 12.4 |
| 123 | Le bouton « Créer & tester » devient « Créer et tester » (EN « Create and test »). | 13 | `apps/web/messages/{fr,en}.json` | A | spec 6.4 |
| 124 | Écran de fin : aucune étape du stepper n'est cliquable, avec la bulle « L'assistant est terminé : la suite se règle sur la page de l'agent IA. » ; l'étape 5 n'est cochée que si l'agent IA a été activé. | 13 | `apps/web/src/components/wizard/stepper.tsx` | A | maquette ; spec 12.1 |
| 125 | Un saut par le stepper vers les étapes 3 à 5 envoie d'abord les modifications en attente (même PATCH que « Créer et tester ») ; en cas d'échec, l'assistant reste sur l'étape, ou revient à l'étape du champ refusé. | 13 | `apps/web/src/components/wizard/wizard.tsx` | A | spec 12.1, 12.4 |
| 126 | Tant qu'une modification attend, l'encadré d'état dit « … Vos dernières modifications ne sont pas encore enregistrées : « Créer et tester » les enregistre. » ; la Whitelist de l'étape 5 n'y compte pas. | 13 | `apps/web/src/components/wizard/wizard-column.tsx` | A | spec 12.1 |
| 127 | Un seul envoi à la fois entre « Créer et tester » et le stepper ; ce qui est enregistré est ce qui est parti, une frappe pendant l'envoi reste en attente. | 13 | `apps/web/src/components/wizard/wizard.tsx`, `step-personality.tsx` | C | spec 12.4 |
| 128 | Passer à un numéro de test à l'étape 5 vide la Whitelist tenue par l'assistant ; l'activation d'un numéro de test envoie une Whitelist vide. | 13 | `apps/web/src/components/wizard/step-activate.tsx`, `wizard.tsx` | A | spec 12.3 |
| 129 | Le champ de lead tapé à l'étape 2 est gardé quand on passe par l'étape 1 et revient. | 13 | `apps/web/src/components/wizard/step-personality.tsx` | A | spec 12.4 |
| 130 | Textes « retiré de WABAGENT » remplacés, moteur, web et faux moteur au même commit : « Ce compte WhatsApp a été retiré : raccordez un nouveau compte. », « Les identifiants enregistrés de ce compte sont illisibles : retirez le compte puis raccordez-le de nouveau. », « Le compte WhatsApp a été retiré. », menu et confirmation « Retirer le compte », titre « Retirer le compte {nom} ? », notification « Compte WhatsApp {nom} retiré. ». | 14 | `src/core/services/whatsapp-account-service.ts`, `apps/web/messages/{fr,en}.json`, `apps/web/e2e/mock-engine.ts` | A | spec 6.4 ; spec 19 n° 13 |
| 131 | Bouton d'activation d'un numéro de test : « Activer et passer Online » (EN « Activate and go Online ») au lieu de « Activer et ouvrir à tous ». | 14 | `apps/web/messages/{fr,en}.json` | A | spec 6.4, 12.3 ; spec 19 n° 34 |
| 132 | Refus anglais du compte encore utilisé : « First take Offline the AI agents that use this account: ». | 14 | `apps/web/messages/en.json` | A | spec 6.3 |
| 133 | Textes de la Mise en route : « Activez votre agent IA pour qu'il réponde à vos clients. », « Votre premier agent IA ne répond encore à personne » (au lieu de formulations avec « en ligne »). | 14 | `apps/web/messages/{fr,en}.json` | A | spec 6.1, 6.3 |
| 134 | Tokens : « {in} tokens d'entrée · {out} tokens de sortie » sur l'usage et la Vue d'ensemble ; « Conversations & Leads » devient « Conversations et leads » ; « Personnaliser et tester ». | 14 | `apps/web/messages/{fr,en}.json` | A | spec 6.4 ; spec 19 n° 13 |
| 135 | État « pas encore atteinte » (minuscule) d'une étape à venir du stepper, au lieu de « à venir ». | 14 | `apps/web/messages/{fr,en}.json` | A | spec 5.4 (règle Soon) |
| 136 | Garde de style : toute clé `*.soon` ou `*Soon` (sauf la pastille `common.soon`) commence par « Disponible prochainement : » et « Coming soon: », et réciproquement. | 14 | `apps/web/src/i18n/__tests__/messages-style.test.ts` | C | spec 5.4 |
| 137 | La garde « un même texte français, une seule traduction anglaise » est limitée aux textes qui contiennent un des sept mots ; « Retry » et « Try again » restent deux traductions de « Réessayer ». | 14 | `apps/web/src/i18n/__tests__/messages-style.test.ts` | C | spec 6.3 |
| 138 | Clés sans lecteur retirées (`nav.usage`, `nav.breadcrumbAgents`). | 14 | `apps/web/messages/{fr,en}.json` | C | relecture tâche 14 |
| 139 | Les deux journaux de migration « repassé(s) en brouillon » et les commentaires de code gardent l'ancien vocabulaire. | 14 | `src/core/database/sqlite.ts`, `postgres.ts` | C | spec 6.4 (textes d'écran) |
| 140 | Le mineur 5 de la relecture de la tâche 14 est laissé en l'état. | 14 | aucun | C | relecture tâche 14 |
| 141 | Point d'attention 5 du plan : l'onglet resté ouvert sur `/organisation/entites` de A, quand l'autre onglet passe sur B, se recharge sur la liste des agents IA de B (règle actuelle de `reloadHome`) ; le refus sur place qui nomme B n'apparaît qu'en rechargeant la même adresse. | 15 | `apps/web/src/components/providers/session-provider.tsx`, `apps/web/e2e/two-tabs.spec.ts` | A | plan, point d'attention 5 ; spec 10.6, 15.3 |
| 142 | Parcours spec 15.4 vérifié par l'absence de Draft dans l'autre organisation et la recréation dans la bonne (le BFF répond 409 avant le moteur). | 15 | `apps/web/e2e/two-tabs.spec.ts` | C | spec 15.4 |
| 143 | Aucun contrôle d'accessibilité automatique (axe) ajouté dans ce lot ; aucune dépendance ajoutée. | 15 | aucun | C | plan, tâche 15 |
| 144 | La zone d'action de la barre du haut porte un repère `data-page-action` lu par les parcours. | 15 | `apps/web/src/components/shell/page-bar.tsx` | C | plan, tâche 15 |
| 145 | Revue d'isolation, m-1 (champs libres des leads non masqués) : hors périmètre, renvoyé au chantier « Conversations et leads ». | 16 | aucun | B | spec 9.2 ; spec 19 n° 4 |
| 146 | Revue d'isolation, m-2 : garde statique des lectures de la Whitelist (toute lecture `org.read` d'un agent IA passe par `presentBotForViewer`, `bots.configure` réservé à l'admin et à l'opérateur). | 16 | `src/__tests__/allowlist-readers.test.ts` | C | `CLAUDE.md` (tout invariant a un test) |
| 147 | Revue d'isolation, m-3 (faux moteur moins strict sur le détail d'un lead) : sans effet, laissé. | 16 | `apps/web/e2e/mock-engine.ts` | C | plan, contraintes globales (faux moteur) |
| 148 | Revue d'isolation, m-4 : la règle « coûts réservés à l'admin » reste dupliquée dans le BFF. | 16 | `apps/web/src/app/api/usage/summary/route.ts` | C | spec 9.1 |

## Décisions de François (non contestables)

Notées « décision de François » dans le registre ou « Validé par François » dans la spec. Elles ne sont pas soumises à l'audit ; l'auditeur vérifie seulement que le code les applique.

| N° | Décision | Tâche | Fichier(s) | Source |
|---|---|---|---|---|
| F-1 | Les coûts sont réservés à l'administrateur (et à l'opérateur) : super manager (avec ou sans lecture seule), manager et conseiller ne les voient pas (« Admin seul »). | 2, 11 | `src/core/auth/permissions.ts` (`usage.read`), `src/api/admin/routes/dashboard.ts` | spec 9.1, 19 n° 1, 20 n° 1 ; registre, tâche 2 |
| F-2 | Le super manager voit les numéros des contacts en entier, comme l'admin. | 3 | `src/core/auth/permissions.ts` (`canSeeContactNumbers`) | spec 9.2, 19 n° 2, 20 n° 1 |
| F-3 | Le nom de la première entité est donné à la création de l'organisation : `first_entity_name` obligatoire sur `POST /clients` et dans le script. | 4 | `packages/contracts/src/clients.ts`, `src/core/auth/admin-service.ts`, `scripts/create-organization.ts` | spec 13, 19 n° 35, 20 n° 1 ; registre, tâche 4 |
| F-4 | Exception des sept mots anglais gardés dans l'interface française (Draft, Preview, Online, Offline, Whitelist, New, Soon), avec majuscule, jamais accordés ni conjugués ; « Allowlist » en anglais ; écrite dans `CLAUDE.md`. | 14 | `CLAUDE.md`, `apps/web/src/i18n/__tests__/messages-style.test.ts` | spec 6.3 ; registre, tâche 14 |
| F-5 | « Whitelist » avec majuscule dans « Ne répond pas : Whitelist vide ». | 7 | `apps/web/messages/fr.json` | spec 6.3 ; rapport de la tâche 7 |

## Décompte

| Famille | Nombre |
|---|---|
| A, produit visible | 66 |
| B, interprétation d'une règle validée | 23 |
| C, technique | 59 |
| Total contestable | 148 |
| Décisions de François | 5 |
