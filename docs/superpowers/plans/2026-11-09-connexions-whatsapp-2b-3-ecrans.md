# Plan 2b-3 Écrans des connexions WhatsApp

> **Pour les agents d'exécution :** sous-skill requise : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** livrer dans le back-office les écrans du plan 2b : Organisation › Connexions (comptes WhatsApp, numéros, alertes, actions), le raccordement guidé d'un compte, les étapes « Numéro » et « Activer » de l'assistant de création, et les encarts de la page de l'agent IA (numéro, statut et actions, liste d'accès limité, messages non servis), sur l'API livrée au lot 2b-2.

**Architecture :** une route BFF par route du moteur (`proxyEngine` + schéma Zod des contrats), aucune logique métier dans le web : le moteur reste la seule source des règles (machine d'états, unicité, contrôles), le web affiche ses refus tels quels. Deux modules purs côté web (`whatsapp-display`, `bot-transitions`) portent l'affichage et les actions permises ; les composants des numéros (liste groupée par compte, choix d'un numéro) sont partagés entre Connexions, l'assistant et la page de l'agent IA.

**Tech :** Next.js (App Router), React, next-intl, Tailwind (jetons de la charte Émeraude·Menthe), Vitest + Testing Library, Playwright avec le moteur simulé `apps/web/e2e/mock-engine.ts`, contrats `@wabagent/contracts`, bibliothèque `qrcode` (déjà à la racine du dépôt, ajoutée aux dépendances du web).

**Spec :** `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` (§2 anti-objectifs, §6, §8, §9, §10, §11). Maquettes validées : `.superpowers/brainstorm/14321-1794139133/content/01-connexions-whatsapp.html` et `02-assistant-numero-activer.html` (non versionnées, à ouvrir dans un navigateur). Référence de charte : `marketing/design-reference-emeraude-menthe.html`. L'exécutant lit la spec §9 et ouvre les deux maquettes avant chaque tâche d'écran.

## Contraintes globales

- TypeScript strict, pas de `any`, `const` par défaut.
- Journaux : format `[Service] message`, sans emoji. Jamais de jeton, secret, clé d'URL ni contenu de liste d'accès limité dans un journal.
- Aucun tiret cadratin ni demi-cadratin, nulle part. Textes français avec accents. FR et EN ont exactement les mêmes clés (`src/i18n/__tests__/messages-style.test.ts`) ; « agent IA » / « AI agent », jamais « agent » seul.
- Commits : 1 commit = 1 sujet, message en français `type(portée): résumé` puis corps factuel ; auteur `Francois Greze <francois@cyran.fr>` ; aucune signature Claude ou Anthropic ; aucun push sans accord explicite de François.
- Aucune référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition) dans le code, les textes ni les données de test.
- Charte au pixel : jetons existants de `tailwind.config.ts` (`accent`, `success`, `warning`, `danger`, `surface`, `rounded-pill`…), aucun dégradé, aucune couleur codée en dur. « Accès limité » garde la pastille `bg-warning-soft text-warning-ink`.
- Appels côté client : `apiFetch` / `sendMutation` (`src/lib/api-fetch.ts`) ; après chaque réponse, `if (await isOrgChanged(res)) return;`. Routes BFF : `proxyEngine` (`src/lib/proxy.ts`), `rejectNonNumericId` pour tout identifiant numérique, schéma des contrats pour tout corps.
- Le web n'invente aucune règle : un refus du moteur (409, 422, détails par champ) s'affiche avec son message ; un contrôle fait côté web (liste vide, plus de 20 entrées) ne remplace jamais celui du moteur.
- Aucun élément d'interface sans effet qui ne le dit pas : un bouton désactivé porte sa raison, visible (texte sous le bouton ou `title` et `aria-describedby`).
- Écrans d'organisation (Connexions, raccordement) : admin seulement (garde existante de `organisation/layout.tsx`). Page de l'agent IA : lecture pour tous les membres, actions pour l'admin non en lecture seule (`useSession().isAdmin && !readOnly`).
- Les numéros WhatsApp de l'organisation s'affichent en entier sur les écrans admin (Connexions, raccordement, assistant, encart numéro pour l'admin) ; ailleurs, `maskNumber` reste en place. La liste d'accès limité s'affiche en entier à qui peut la lire.
- Chaque tâche finit avec `npm test -w @wabagent/web`, `npx tsc --noEmit` dans `apps/web`, et `npm test` à la racine si un contrat ou le moteur change.

## Choix du rédacteur (laissés au builder par la spec, à confirmer par François)

1. **Raccordement sur une page dédiée** `/organisation/connexions/raccorder` (et non une fenêtre) : la maquette montre un écran à deux colonnes (saisie guidée, résultat), trop riche pour une fenêtre. Retour à Connexions par « Terminer » ou « Annuler ».
2. **Rail Organisation** : entrée « Connexions » entre Utilisateurs et Réglages, icône `⇄`, compteur = comptes non déconnectés. Les comptes déconnectés restent listés en bas de la page, repliés, sans action.
3. **Menu d'un numéro** : « Brancher sur un agent IA » (ou « Changer d'agent IA » s'il est branché), « Débrancher », « Marquer comme numéro de test » / « Ce n'est pas un numéro de test » (Meta ne le déclare pas, choix validé au 2b-2), « Voir dans WhatsApp Manager ↗ » (Meta seulement).
4. **Actions de statut** calculées côté web pour l'affichage (`bot-transitions.ts`, miroir de la machine d'états §8.1) avec la raison de chaque action indisponible ; le moteur décide et son refus s'affiche.
5. **Jeton de vérification webhook** masqué par défaut (`••••` + 4 derniers caractères) avec « Afficher » et « Copier » ; URL de webhook avec « Copier ». Si le moteur n'a pas d'adresse publique (`webhook.url` null), le chemin s'affiche avec la mention « Adresse publique du moteur non configurée ».
6. **QR code de l'étape 5** généré dans le navigateur avec `qrcode` (`toDataURL`), sans appel externe.
7. **Compteur « Qualifiés » de la page de l'agent IA** (report 2b-2 tâche 12) : il compte aujourd'hui les rendez-vous (`metrics.rdv_total`) alors que l'étiquette « qualifié » des conversations récentes signifie « informations collectées » (`qualified_data` non vide). Correction minimale : la tuile s'appelle « Rendez-vous » et l'étiquette « Infos collectées ». La vraie définition d'un lead qualifié revient au chantier Conversations & Leads.

## Points d'attention de la revue (non couverts par la spec, tests ajoutés aux tâches)

1. Activation refusée par le moteur (compte non connecté, liste vide, numéro retiré entre l'étape 4 et l'étape 5) : l'étape 5 affiche le message du moteur et le lien vers Connexions, l'agent IA reste en brouillon, aucun écran de confirmation. Test ajouté à la tâche 7.
2. Organisation changée dans un autre onglet pendant une saisie (raccordement, liste d'accès limité, assistant) : `409 ORG_CHANGED`, rien n'est envoyé au moteur, l'écran se recharge sans message d'erreur parasite. Tests ajoutés aux tâches 1 et 5.
3. Déconnexion refusée (`409`, des agents IA en accès limité ou actifs utilisent un numéro) : le message du moteur s'affiche tel quel dans la fenêtre de confirmation, rien ne change à l'écran. Test ajouté à la tâche 4.
4. Liste d'accès limité invalide : une entrée refusée par le moteur (`details[].path = 'entries.<i>'`) s'affiche sous la bonne ligne, les autres restent ; au-delà de 20 entrées, l'ajout est bloqué avec la raison. Test ajouté à la tâche 8.
5. Liste des numéros périmée dans l'assistant (numéro raccordé dans un autre onglet, numéro pris par un autre agent IA entre-temps) : la liste se recharge au retour sur l'onglet (`visibilitychange`), et l'étape 5 relit le numéro choisi avant d'activer. Test ajouté à la tâche 6.

---

## Carte des fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `apps/web/src/app/api/whatsapp-accounts/**/route.ts` (nouveaux) | BFF des comptes WhatsApp | 1 |
| `apps/web/src/app/api/bots/[botId]/{number,status,allowlist,activate}/route.ts` (nouveaux) | BFF des actions de l'agent IA | 1 |
| `apps/web/src/lib/whatsapp-display.ts` (nouveau) | affichage pur : numéro, lien `wa.me`, jours avant expiration, libellés | 1 |
| `apps/web/src/lib/bot-transitions.ts` (nouveau) | actions de statut permises et raisons | 8 |
| `apps/web/e2e/mock-engine.ts`, `e2e/mock-state.ts` | moteur simulé : comptes, numéros, actions de l'agent IA | 2 |
| `apps/web/src/components/organisation/organisation-rail.tsx`, `(app)/organisation/layout.tsx` | entrée et compteur Connexions | 3 |
| `apps/web/src/components/connections/*` (nouveaux) | blocs de compte, tableau des numéros, alertes, webhook, menus, fenêtres | 3, 4 |
| `apps/web/src/app/[locale]/(app)/organisation/connexions/page.tsx`, `raccorder/page.tsx` (nouveaux) | pages | 3, 5 |
| `apps/web/src/components/numbers/number-picker.tsx` (nouveau) | choix d'un numéro groupé par compte | 6, 8 |
| `apps/web/src/components/wizard/{wizard,stepper,step-number,step-activate,success}.tsx` | assistant à cinq étapes | 6, 7 |
| `apps/web/src/components/agent/{overview,number-panel,status-panel,allowlist-panel}.tsx` | encarts de la page de l'agent IA | 8 |
| `apps/web/src/lib/onboarding.ts`, `src/app/api/bots/summary/route.ts`, `components/agents/setup-banner.tsx` | « WhatsApp connecté » réel dans la mise en route | 8 |
| `apps/web/messages/fr.json`, `en.json` | textes (namespace `connections`, `wizard`, `agentNumber`, `agentStatus`, `allowlist`) | toutes |
| `apps/web/e2e/connections.spec.ts`, `e2e/activation.spec.ts` (nouveaux) | parcours de bout en bout | 9 |

---

### Tâche 1 : BFF des comptes WhatsApp et des actions de l'agent IA, affichage pur

**Fichiers :**
- Créer : `apps/web/src/app/api/whatsapp-accounts/route.ts` (GET, POST), `[accountId]/route.ts` (GET, PATCH), `[accountId]/credentials/route.ts` (PUT), `[accountId]/verify/route.ts`, `[accountId]/refresh-numbers/route.ts`, `[accountId]/disconnect/route.ts` (POST), `[accountId]/numbers/[numberId]/route.ts` (PATCH).
- Créer : `apps/web/src/app/api/bots/[botId]/number/route.ts` (PUT, DELETE), `status/route.ts` (PUT), `allowlist/route.ts` (PUT), `activate/route.ts` (POST).
- Créer : `apps/web/src/lib/whatsapp-display.ts`.
- Tests : `apps/web/src/app/api/whatsapp-accounts/__tests__/whatsapp-accounts-routes.test.ts`, `apps/web/src/app/api/bots/__tests__/bot-actions-routes.test.ts`, `apps/web/src/lib/__tests__/whatsapp-display.test.ts`.

**Interfaces :**
- Consomme : `proxyEngine`, `rejectNonNumericId` (`src/lib/proxy.ts`) ; schémas `CreateWhatsAppAccountInput`, `RenameWhatsAppAccountInput`, `ReplaceWhatsAppCredentialsInput`, `SetWhatsAppNumberTestFlagInput`, `AssignNumberInput`, `SetBotStatusInput`, `SetAllowlistInput`, `ActivateBotInput` (`@wabagent/contracts`). Moteur : `src/api/admin/routes/whatsapp-accounts.ts:28-66`, `src/api/admin/routes/bots.ts:32-58`.
- Produit (routes BFF, mêmes chemins que le moteur sous `/api`) : `/api/whatsapp-accounts`, `/api/whatsapp-accounts/:accountId{,/credentials,/verify,/refresh-numbers,/disconnect,/numbers/:numberId}`, `/api/bots/:botId/{number,status,allowlist,activate}`.
- Produit (`whatsapp-display.ts`) :
  - `formatPhone(e164: string): string` : `+33612457890` donne `+33 6 12 45 78 90`, `+15551649072` donne `+1 555 164 9072`, autre indicatif : `+` puis l'indicatif et le reste par groupes de 3, entrée non E.164 rendue telle quelle.
  - `waMeUrl(e164: string): string` : `https://wa.me/` suivi des chiffres seuls.
  - `daysUntil(iso: string, now: Date): number` (arrondi vers le haut, 0 si dépassé).
  - `whatsAppManagerUrl(wabaId: string): string` : `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=<wabaId>`.

- [ ] **Étape 1 : écrire les tests des routes** (modèle : `src/app/api/bots/__tests__/bots-routes.test.ts`, cookies simulés, `ENGINE_API_URL`, `fetch` espionné). Cas exigés, nommés ainsi :
  - `GET /api/whatsapp-accounts relaie la liste du moteur avec le jeton et l'organisation` : appel à `<ENGINE>/whatsapp-accounts`, en-têtes `authorization` et `X-Organization-Id` présents.
  - `POST /api/whatsapp-accounts : corps invalide refusé en 400 sans appel au moteur` (`waba_id: 'abc'`) ; `corps valide relayé, 201 et vue du compte renvoyés`.
  - `identifiant non numérique (accountId, numberId) : 404 sans appel au moteur`.
  - `refus du moteur relayé tel quel` : `409 CONFLICT` avec son message, `422 WA_VALIDATION_FAILED` avec `details`.
  - `POST disconnect, verify, refresh-numbers : méthode et chemin exacts, corps vide`.
  - `PUT /api/bots/:botId/allowlist : plus de 20 entrées refusées en 400 sans appel au moteur` ; `PUT status : statut inconnu refusé` ; `POST activate : number_id manquant refusé` ; `DELETE number : 204 relayé`.
  - `organisation affichée différente du cookie : 409 ORG_CHANGED sans appel au moteur` (en-tête `X-Wab-Org` différent).
- [ ] **Étape 2 : vérifier qu'ils échouent** : `npm test -w @wabagent/web -- src/app/api` (routes absentes).
- [ ] **Étape 3 : écrire les routes**, une ligne `proxyEngine` par méthode, `status: 201` pour la création, `rejectNonNumericId` avant tout appel pour `accountId` et `numberId`.
- [ ] **Étape 4 : écrire les tests de `whatsapp-display`** (valeurs ci-dessus, plus `daysUntil` à 12 jours et à date dépassée), puis le module ; tout passe.
- [ ] **Étape 5 : commit** `feat(web): routes BFF des comptes WhatsApp et des actions de l'agent IA`.

### Tâche 2 : moteur simulé (Playwright) des comptes WhatsApp et des actions de l'agent IA

**Fichiers :**
- Modifier : `apps/web/e2e/mock-engine.ts` (routes `adminRoutes`), `apps/web/e2e/mock-state.ts` (état initial).
- Test : `apps/web/e2e/mock-whatsapp.spec.ts` (appels `request` Playwright directs au moteur simulé).

**Interfaces :**
- Consomme : vues `WhatsAppAccountView`, `WhatsAppNumberView`, `WhatsAppAccountCreated`, `BotNumberSummary` (`@wabagent/contracts`), messages exacts du moteur `TRANSITION_MESSAGES` (`src/core/bot-status.ts:23-30`).
- Produit : état initial de l'organisation de démo : un compte `meta_manual` « Boutique principale » (`connected`, WABA `104829371625544`, jeton sans expiration, webhook `{ path: '/webhook/meta/cle-demo', url: 'https://dev.wabagent.com/webhook/meta/cle-demo', verify_token: 'vt-demo-1234' }`) avec trois numéros : `+33184801234` branché sur `demo-1`, `+33612457890` libre, `+15551649072` libre, `is_test: true`. Une seconde organisation a un compte et un numéro, jamais visibles depuis la première. Routes simulées : toutes celles de la tâche 1 ; machine d'états et refus avec les messages exacts du moteur ; `disconnect` refusé en 409 si un numéro sert un agent IA `limited` ou `active` ; `POST /whatsapp-accounts` avec `waba_id: '000000'` renvoie `422 WA_VALIDATION_FAILED` avec `checks` en échec.

- [ ] **Étape 1 : écrire `mock-whatsapp.spec.ts`** : liste des comptes de l'organisation de démo (un compte, trois numéros), compte de l'autre organisation en 404 ; `activate` sans liste en `limited` refusé avec « Ajoutez au moins un numéro à la liste d'accès limité. » ; `activate` en `active` sur le numéro de test accepté ; `disconnect` refusé tant que `demo-1` est actif.
- [ ] **Étape 2 : vérifier l'échec** : `npx playwright test e2e/mock-whatsapp.spec.ts` dans `apps/web`.
- [ ] **Étape 3 : implémenter** ; l'expression des sous-routes des agents IA accepte plusieurs segments et le trait d'union (`refresh-numbers`).
- [ ] **Étape 4 : relancer le test et toute la suite e2e existante** : `npx playwright test` ; tout passe.
- [ ] **Étape 5 : commit** `test(web): moteur simulé des comptes WhatsApp et des actions de l'agent IA`.

### Tâche 3 : page Organisation › Connexions (lecture)

**Fichiers :**
- Modifier : `apps/web/src/components/organisation/organisation-rail.tsx` (`OrganisationKey` + entrée `connexions`), `apps/web/src/app/[locale]/(app)/organisation/layout.tsx` (compteur), `organisation-counts.tsx` si le type des compteurs l'exige.
- Créer : `apps/web/src/app/[locale]/(app)/organisation/connexions/page.tsx`, `apps/web/src/components/connections/account-card.tsx`, `numbers-table.tsx`, `account-alerts.tsx`, `webhook-box.tsx`, `crm-coming.tsx`.
- Tests : `apps/web/src/components/connections/__tests__/account-card.test.tsx`, `account-alerts.test.tsx`, `webhook-box.test.tsx`, `apps/web/src/app/[locale]/(app)/organisation/connexions/__tests__/page.test.tsx`.

**Interfaces :**
- Consomme : `GET /api/whatsapp-accounts` (tâche 1) ; `formatPhone`, `daysUntil`, `whatsAppManagerUrl` (tâche 1) ; `Rail`, `Skeleton`, `PageFailureView` existants.
- Produit : `AccountCard({ account: WhatsAppAccountView, onChanged: () => void })` (les menus d'actions arrivent en tâche 4 et s'y branchent), `NumbersTable({ account, onChanged })`, `AccountAlerts({ account, now })`, `WebhookBox({ webhook, mode })`.

Contenu (spec §9.1, maquette 1) : en-tête « Connexions » avec le texte de la maquette et « + Raccorder un compte WhatsApp » (lien vers `/organisation/connexions/raccorder`) ; un bloc par compte non déconnecté (nom, mode « API Meta directe · raccordement manuel » ou « CM.com », WABA, pastille d'état « Connecté » / « En erreur » / « Déconnecté », « vérifié il y a … », badge « Compte de test » si `is_test`) ; tableau des numéros (numéro `formatPhone`, nom affiché, état Meta, qualité (`GREEN` « Élevée », `YELLOW` « Moyenne », `RED` « Basse », autre ou null « Non évaluée »), agent IA branché avec son statut ou « Libre ») ; numéro `removed` en rouge « Retiré du fournisseur » avec son agent IA ; bandeaux : jeton qui expire (`token_expiring`, « Le jeton expire dans N jours »), compte en erreur (motif `token_invalid` : « Jeton refusé par Meta… remplacez les identifiants » ; `signature_rejected` : « Les messages reçus ne sont pas signés avec le secret de l'app… » ; `other`), alertes du fournisseur (`payment`, `account_locked`, `policy_block`, `account_update`), qualité dégradée, numéro de test (« seuls les destinataires déclarés dans votre app Meta (5 au plus)… Gérer les destinataires dans Meta ↗ ») ; boîte webhook (choix 5) ; bloc « CRM : à venir » ; comptes déconnectés repliés en bas (choix 2) ; état vide « Aucun compte WhatsApp raccordé » avec le bouton de raccordement.

- [ ] **Étape 1 : écrire les tests** :
  - `account-card` : nom, mode, WABA, pastille « Connecté », numéros formatés, « Libre » pour un numéro sans agent IA, nom et statut de l'agent IA branché, numéro retiré affiché « Retiré du fournisseur ».
  - `account-alerts` : jeton à 12 jours affiche « 12 jours » ; `error_reason: 'token_invalid'` affiche le bandeau d'erreur jeton ; compte de test affiche le lien vers Meta ; aucune alerte : rien.
  - `webhook-box` : jeton de vérification masqué puis affiché par « Afficher » ; « Copier » appelle `navigator.clipboard.writeText` avec l'URL ; `url: null` affiche le chemin et « Adresse publique du moteur non configurée » ; CM.com : pas de jeton de vérification.
  - `page` : squelettes pendant le chargement, état vide, échec du moteur avec `PageFailureView`, réponse `ORG_CHANGED` sans message d'erreur, rail avec « Connexions » entre Utilisateurs et Réglages et son compteur.
- [ ] **Étape 2 : vérifier l'échec**, puis **Étape 3 : implémenter** (textes FR et EN dans un namespace `connections`).
- [ ] **Étape 4 : tests web et typecheck** ; tout passe.
- [ ] **Étape 5 : commit** `feat(web): page Organisation › Connexions`.

### Tâche 4 : actions des comptes et des numéros

**Fichiers :**
- Créer : `apps/web/src/components/connections/account-menu.tsx`, `number-menu.tsx`, `rename-account-dialog.tsx`, `replace-credentials-dialog.tsx`, `disconnect-dialog.tsx`, `assign-bot-dialog.tsx`, `verification-checks.tsx`.
- Modifier : `account-card.tsx`, `numbers-table.tsx` (menus branchés).
- Tests : `apps/web/src/components/connections/__tests__/account-menu.test.tsx`, `disconnect-dialog.test.tsx`, `assign-bot-dialog.test.tsx`, `replace-credentials-dialog.test.tsx`, `number-menu.test.tsx`.

**Interfaces :**
- Consomme : routes BFF de la tâche 1 ; `usePopover` (`src/components/shell/use-popover.ts`) ; `DialogFrame` (`src/components/organisation/dialog-frame.tsx`) ; `GET /api/bots` pour la liste des agents IA.
- Produit : `VerificationChecks({ checks: WhatsAppVerificationCheck[] })` (réutilisé en tâche 5) : une ligne par contrôle, libellés FR de chaque clé (`token`, `waba_access`, `app_secret`, `subscription`, `token_expiry`, `numbers`, `cm_account`, `cm_channels`, `app` : « Application du jeton lue chez Meta », report 2b-2 tâche 5) et de chaque état (`ok` ✓, `failed` en rouge, `pending` « contrôlé au premier message reçu », `created` « abonnement créé »).

Menus (choix 3) : compte : Renommer, Remplacer les identifiants (champs du mode, aucun préremplissage des secrets), Vérifier maintenant (affiche `VerificationChecks`, « Vérification non concluante, réessayez » si le moteur la déclare telle), Rafraîchir les numéros (bilan `added` / `removed` / `refused` en clair, `refused` sans autre détail), Déconnecter (fenêtre de confirmation, message du moteur affiché si refus). Numéro : Brancher sur un agent IA / Changer d'agent IA (fenêtre : agents IA de l'organisation ; un agent IA qui a déjà un numéro est signalé « perdra son numéro … » ; un numéro branché sur un agent IA en accès limité ou actif : l'avertissement nomme cet agent IA, qui repasse en brouillon), Débrancher (`DELETE /api/bots/:botId/number`, confirmation qui nomme l'agent IA), Marquer comme numéro de test / Ce n'est pas un numéro de test (avec l'explication : « Un numéro de test peut être ouvert à tous sans passer par l'accès limité »), Voir dans WhatsApp Manager ↗ (Meta). Après chaque action réussie, `onChanged()` recharge la page et le compteur du rail.

- [ ] **Étape 1 : écrire les tests** :
  - `disconnect-dialog` : `409` du moteur, son message s'affiche dans la fenêtre, `onChanged` n'est pas appelé (point d'attention 3) ; `204` : fenêtre fermée, `onChanged` appelé.
  - `assign-bot-dialog` : liste des agents IA, choix puis `PUT /api/bots/<botId>/number` avec `{ number_id }` ; avertissement qui nomme l'agent IA actuel quand le numéro est branché ; refus du moteur affiché.
  - `replace-credentials-dialog` : Meta : trois champs vides, `PUT /credentials` avec `mode: 'meta_manual'` ; `422` : contrôles en échec affichés par `VerificationChecks`, la fenêtre reste ouverte.
  - `account-menu` : « Vérifier maintenant » affiche les contrôles ; « Rafraîchir les numéros » affiche « 1 numéro ajouté, 0 retiré » ; clavier : flèches et Échap (`data-menu-nav`).
  - `number-menu` : « Voir dans WhatsApp Manager » absent pour CM.com ; marquage test envoie `PATCH` avec `{ is_test: true }`.
- [ ] **Étape 2 : vérifier l'échec**, **Étape 3 : implémenter**, **Étape 4 : tests et typecheck**.
- [ ] **Étape 5 : commit** `feat(web): actions des comptes WhatsApp et des numéros`.

### Tâche 5 : raccorder un compte WhatsApp (page guidée)

**Fichiers :**
- Créer : `apps/web/src/app/[locale]/(app)/organisation/connexions/raccorder/page.tsx`, `apps/web/src/components/connections/connect-form.tsx`, `connect-guide-meta.tsx`, `connect-guide-cm.tsx`, `connect-result.tsx`.
- Tests : `apps/web/src/components/connections/__tests__/connect-form.test.tsx`, `connect-result.test.tsx`.

**Interfaces :**
- Consomme : `POST /api/whatsapp-accounts` (`WhatsAppAccountCreated`, ou `422` avec `checks`) ; `CreateWhatsAppAccountInput` pour la validation côté client ; `VerificationChecks` (tâche 4) ; `WebhookBox` (tâche 3).
- Produit : la page ; « Terminer » mène à `/organisation/connexions`.

Contenu (spec §9.2, maquette 1 partie 2) : prérequis (« un portefeuille Meta Business avec l'entreprise vérifiée ») ; trois modes : « API Meta directe » (actif), « Connexion Meta » (grisé, badge « Bientôt », non cliquable, explication visible), « CM.com » (actif) ; guide Meta numéroté (créer une app Meta et y ajouter WhatsApp, lien vers la doc Meta ; ajouter son numéro dans WhatsApp Manager, facultatif avec le numéro de test ; créer un utilisateur système et un jeton sans expiration ; puis saisie) avec l'encart « numéro dédié » (spec §9.2 : un numéro de l'app WhatsApp Business doit y être supprimé, historique perdu, coexistence seulement via la Connexion Meta à venir) ; guide CM.com (où trouver `accountId` et productToken) ; champs du mode ; « Rien n'est enregistré tant que la vérification échoue. » ; « Vérifier et raccorder ». Résultat : contrôles (`VerificationChecks`), numéros trouvés (`formatPhone`, nom), bilan (`refused` : « N numéro(s) déjà raccordé(s) ailleurs, non ajouté(s) »), puis la boîte webhook du nouveau compte (étape « coller ces deux valeurs dans la configuration Webhook de votre app Meta, champ messages » pour Meta, URL de rappel pour CM.com), « Branchez-les ensuite sur vos agents IA. », « Terminer ». Écart avec la maquette (spec §9.2) : le webhook s'affiche après le raccordement, car l'URL et le jeton sont propres au compte et n'existent qu'une fois le compte créé.

- [ ] **Étape 1 : écrire les tests** :
  - `connect-form` : « Connexion Meta » non cliquable avec « Bientôt » ; Meta : WABA non numérique bloque l'envoi avec le message du contrat ; envoi valide `POST` avec `mode: 'meta_manual'` et le nom ; `422` : contrôles en échec affichés, champs conservés, aucun résultat ; `409` (compte déjà raccordé) : message neutre du moteur affiché ; `ORG_CHANGED` : rien n'est affiché (point d'attention 2) ; CM.com : `account_id` non UUID bloqué.
  - `connect-result` : contrôles, numéros formatés, mention des numéros refusés, boîte webhook avec jeton de vérification (Meta) ou sans (CM.com).
- [ ] **Étape 2 : vérifier l'échec**, **Étape 3 : implémenter**, **Étape 4 : tests et typecheck**.
- [ ] **Étape 5 : commit** `feat(web): raccordement guidé d'un compte WhatsApp`.

### Tâche 6 : assistant, étape « Numéro »

**Fichiers :**
- Créer : `apps/web/src/components/numbers/number-picker.tsx`, `apps/web/src/components/wizard/step-number.tsx`.
- Modifier : `apps/web/src/components/wizard/wizard.tsx` (étapes `1 | 2 | 3 | 4 | 5 | 'success'`, état `numberId: number | null`), `stepper.tsx` (cinq libellés : Identité, Personnalité, Tester, Numéro, Activer), `step-test.tsx` (« Continuer » mène à l'étape 4 au lieu de terminer).
- Tests : `apps/web/src/components/numbers/__tests__/number-picker.test.tsx`, `apps/web/src/components/wizard/__tests__/step-number.test.tsx`, `stepper.test.tsx`, mise à jour de `step-test.test.tsx`.

**Interfaces :**
- Consomme : `GET /api/whatsapp-accounts` ; `formatPhone`.
- Produit : `NumberPicker({ accounts: WhatsAppAccountView[], selectedId: number | null, currentBotId: string | null, onSelect: (numberId: number) => void })` : numéros `present` des comptes `connected` ou `error`, groupés par compte ; libre : « libre » ; branché sur un autre agent IA : « Utilisé par <nom> » et, une fois choisi, l'avertissement de la maquette 4 bis qui nomme l'agent IA qui sera débranché et repassera en brouillon ; numéro de test : badge « Test Meta » et le rappel des destinataires déclarés ; numéro branché sur `currentBotId` : « Numéro actuel ». `StepNumber({ botId, numberId, onChange, onBack, onNext, onLater })`.

Contenu (spec §9.3, maquette 2, écrans 4, 4 bis, 4 ter) : titre « Sur quel numéro répond-il ? » ; `NumberPicker` ; « Raccorder un autre compte WhatsApp ↗ » (nouvel onglet vers `/organisation/connexions/raccorder`) ; la liste se recharge quand l'onglet redevient visible (point d'attention 5) ; aucun numéro : bloc « Aucun numéro WhatsApp raccordé », lien de raccordement, « Laisser en brouillon et terminer » ; boutons « ← Retour au test », « Plus tard » (termine en brouillon, écran de succès), « Continuer » (désactivé sans choix, raison affichée). L'étape ne fait que retenir le choix.

- [ ] **Étape 1 : écrire les tests** :
  - `number-picker` : groupes par compte, « libre », « Utilisé par Support client », avertissement nommant l'agent IA après le choix d'un numéro utilisé, numéro retiré et compte déconnecté absents.
  - `step-number` : « Continuer » désactivé avec sa raison tant qu'aucun numéro n'est choisi ; choix puis `onNext` ; aucune requête d'écriture envoyée par l'étape ; état vide avec le lien (`target="_blank"`) et « Laisser en brouillon » qui appelle `onLater` ; un `visibilitychange` vers `visible` relance `GET /api/whatsapp-accounts`.
  - `stepper` : cinq libellés, étape courante marquée.
- [ ] **Étape 2 : vérifier l'échec**, **Étape 3 : implémenter**, **Étape 4 : tests et typecheck**.
- [ ] **Étape 5 : commit** `feat(web): assistant, étape Numéro`.

### Tâche 7 : assistant, étape « Activer » et confirmation

**Fichiers :**
- Créer : `apps/web/src/components/wizard/step-activate.tsx`, `apps/web/src/components/numbers/allowlist-editor.tsx`.
- Modifier : `apps/web/src/components/wizard/success.tsx` (succès en brouillon : la carte « Connecter WhatsApp, à venir » devient « Brancher un numéro » vers la page de l'agent IA ; succès actif : écran de confirmation), `apps/web/package.json` (dépendance `qrcode` et `@types/qrcode`, mêmes versions qu'à la racine).
- Tests : `apps/web/src/components/wizard/__tests__/step-activate.test.tsx`, `apps/web/src/components/numbers/__tests__/allowlist-editor.test.tsx`, mise à jour de `success.test.tsx`.

**Interfaces :**
- Consomme : `GET /api/whatsapp-accounts` (relecture du numéro choisi), `POST /api/bots/:botId/activate` avec `ActivateBotInput` ; `ALLOWLIST_MAX` ; `waMeUrl`, `formatPhone`.
- Produit : `AllowlistEditor({ entries: string[], errors: Record<number, string>, onChange: (entries: string[]) => void, disabled?: boolean })` (réutilisé en tâche 8 ; ajout limité à `ALLOWLIST_MAX` avec la raison affichée ; erreurs affichées sous la ligne d'indice) ; `StepActivate({ botId, numberId, onBack, onLater, onActivated: (r: { status: 'limited' | 'active'; phone: string }) => void })`.

Contenu (spec §9.3, maquette 2 écran 5, écarts de la spec) : récapitulatif (agent IA, entité, langues, numéro, statut « Brouillon ») ; contrôles relus avant activation (numéro toujours présent et libre ou repris en connaissance de cause, compte connecté et « vérifié il y a … ») ; liste d'accès limité (vide au départ, au moins un numéro exigé hors numéro de test) ; rappel de facturation Meta avec lien `https://business.facebook.com/billing_hub/` (rappel seulement : aucune API ne permet de lire le moyen de paiement) ; bouton « Activer en accès limité », ou « Activer » sur un numéro de test (statut `active`, liste facultative) ; « ← Changer de numéro », « Laisser en brouillon ». Confirmation : « <nom> est en ligne », pastille « Accès limité » ou « Actif », numéro, QR code (`qrcode.toDataURL(waMeUrl(phone))`) et lien `wa.me`, « Retour aux agents IA », « Ouvrir l'agent IA ». En accès limité, la confirmation rappelle que seuls les numéros de la liste reçoivent une réponse.

- [ ] **Étape 1 : écrire les tests** :
  - `step-activate` : numéro normal : bouton « Activer en accès limité » désactivé avec sa raison tant que la liste est vide ; envoi `POST /activate` avec `{ number_id, status: 'limited', allowlist: ['+33612345678'] }` ; numéro de test : bouton « Activer », `status: 'active'`, liste vide acceptée ; `409` du moteur (« Le compte WhatsApp de ce numéro n'est pas connecté. ») affiché en rouge avec le lien vers Connexions, `onActivated` non appelé (point d'attention 1) ; `400` avec `details[{ path: 'allowlist.1' }]` : erreur sous la deuxième ligne ; numéro devenu `removed` à la relecture : contrôle en rouge, bouton désactivé.
  - `allowlist-editor` : ajout, suppression, vingt et unième ajout bloqué avec « 20 numéros au plus ».
  - `success` : brouillon : « Brancher un numéro » mène à la page de l'agent IA ; actif : QR code présent (`img` avec `src` en `data:image/png`) et lien `https://wa.me/33612457890`.
- [ ] **Étape 2 : vérifier l'échec**, **Étape 3 : implémenter**, **Étape 4 : tests et typecheck**.
- [ ] **Étape 5 : commit** `feat(web): assistant, étape Activer et confirmation`.

### Tâche 8 : page de l'agent IA (numéro, statut, liste, non servis) et mise en route

**Fichiers :**
- Créer : `apps/web/src/lib/bot-transitions.ts`, `apps/web/src/components/agent/number-panel.tsx`, `status-panel.tsx`, `allowlist-panel.tsx`.
- Modifier : `apps/web/src/components/agent/overview.tsx` (le bouton « Mettre en pause » désactivé disparaît au profit de `StatusPanel`, report 2b-2 tâche 12), `health-panel.tsx` (choix 7), `recent-conversations.tsx` (choix 7), `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx` (lecture de `GET /api/bots/:botId` pour le numéro, la liste, le statut et `unserved`), `apps/web/src/lib/onboarding.ts` et `src/app/api/bots/summary/route.ts` (champ `connected` réel, suppression de l'artefact `numbers`, report 2b-2 tâche 8), `apps/web/src/components/agents/setup-banner.tsx` (bouton « Connecter WhatsApp » vers Connexions pour l'admin).
- Tests : `apps/web/src/lib/__tests__/bot-transitions.test.ts`, `apps/web/src/components/agent/__tests__/number-panel.test.tsx`, `status-panel.test.tsx`, `allowlist-panel.test.tsx`, mises à jour de `overview.test.tsx`, `onboarding` et `summary.test.ts`, `setup-banner.test.tsx`.

**Interfaces :**
- Consomme : `PUT/DELETE /api/bots/:botId/number`, `PUT /api/bots/:botId/status`, `PUT /api/bots/:botId/allowlist` ; `NumberPicker` (tâche 6), `AllowlistEditor` (tâche 7) ; vue moteur de l'agent IA (`BotDetail`, `src/core/services/bot-service.ts:18-22` : `whatsapp_number`, `allowlist`, `unserved: { count, last_at }`, `status`, `status_reason`).
- Produit : `availableActions(bot: { status: 'draft' | 'limited' | 'active' | 'paused'; whatsapp_number: BotNumberSummary | null; allowlist: string[] }): Array<{ target: 'limited' | 'active' | 'paused' | 'draft'; key: 'limit' | 'open' | 'pause' | 'resume' | 'draft'; enabled: boolean; reason: 'no_number' | 'number_removed' | 'account_not_connected' | 'empty_allowlist' | 'not_from_draft' | null }>`, miroir de la spec §8.1 : depuis `draft` : « Activer en accès limité » (`limited`), « Ouvrir à tous » seulement sur un numéro de test ; depuis `limited` : « Ouvrir à tous », « Mettre en pause », « Revenir en brouillon » ; depuis `active` : « Revenir en accès limité », « Mettre en pause », « Revenir en brouillon » ; depuis `paused` : « Reprendre en accès limité », « Ouvrir à tous », « Revenir en brouillon ». Un compte `error` ou un numéro `removed` rend `limited` et `active` indisponibles avec leur raison ; liste vide rend `limited` indisponible. Les raisons s'affichent avec les mêmes phrases que `TRANSITION_MESSAGES` du moteur.

Contenu (spec §9.4) : encart « Numéro WhatsApp » : numéro (complet pour l'admin, `maskNumber` sinon), compte et son état, numéro de test, « Retiré du fournisseur » en rouge ; sans numéro : « Brancher un numéro » (admin) qui ouvre `NumberPicker` dans `DialogFrame` puis `PUT /number` ; « Changer de numéro », « Débrancher » (confirmation). Encart « Statut » : pastille, motif (`status_reason = 'number_removed'` : « Mis en pause : le numéro a été retiré chez le fournisseur »), boutons de `availableActions` pour l'admin, refus du moteur affiché. Encart « Accès limité » : liste (lecture pour tous, édition pour l'admin avec `AllowlistEditor` et « Enregistrer »), rappel qu'elle sert aussi au mot-clé « reset ». Compteur : « N message(s) non servi(s), le dernier le … » ou « Aucun message non servi ». Mise en route : `connected` vrai si un agent IA a un numéro `present` sur un compte `connected`.

- [ ] **Étape 1 : écrire les tests** :
  - `bot-transitions` : chaque statut et ses actions ; `limited` indisponible avec `empty_allowlist` ; `active` depuis `draft` seulement sur numéro de test (`not_from_draft` sinon) ; compte en erreur et numéro retiré.
  - `status-panel` : boutons de l'admin selon le statut, raison visible sous un bouton indisponible, `PUT /status` avec `{ status: 'paused' }`, refus `409` affiché, aucun bouton pour un membre non admin ni en lecture seule.
  - `allowlist-panel` : édition admin, `PUT /allowlist` avec `{ entries }`, erreur `details[{ path: 'entries.1' }]` sous la deuxième ligne (point d'attention 4), lecture seule pour un membre.
  - `number-panel` : numéro masqué pour un membre, complet pour l'admin ; « Brancher un numéro » ouvre le choix et envoie `PUT /number` ; « Débrancher » envoie `DELETE`.
  - `overview` : plus aucun bouton désactivé sans raison ; tuile « Rendez-vous » et étiquette « Infos collectées » (choix 7).
  - `onboarding` / `summary` : numéro `removed` sur compte connecté donne `connected: false` ; numéro présent sur compte `error` donne `connected: false` ; numéro présent sur compte `connected` donne `connected: true` (report 2b-2 tâche 8).
- [ ] **Étape 2 : vérifier l'échec**, **Étape 3 : implémenter**, **Étape 4 : tests et typecheck**.
- [ ] **Étape 5 : commit** `feat(web): page de l'agent IA, numéro, statut, accès limité et messages non servis`.

### Tâche 9 : parcours de bout en bout (Playwright)

**Fichiers :**
- Créer : `apps/web/e2e/connections.spec.ts`, `apps/web/e2e/activation.spec.ts`.
- Modifier : `apps/web/e2e/onboarding.spec.ts` (assistant à cinq étapes).

**Interfaces :**
- Consomme : moteur simulé (tâche 2), helpers `resetMock`, `login`, `loginToAgents`.

- [ ] **Étape 1 : écrire les parcours** :
  - `connections.spec` : un admin ouvre Connexions par le rail, voit le compte, ses trois numéros et le bandeau du numéro de test ; raccorde un second compte Meta (échec `422` affiché, puis succès), le compteur du rail passe à 2 ; branche le numéro libre sur `demo-2` ; tente de déconnecter le premier compte et voit le refus nommant l'agent IA actif ; un membre non admin qui ouvre `/fr/organisation/connexions` est renvoyé à l'accueil.
  - `activation.spec` : assistant complet jusqu'à « Activer en accès limité » avec un numéro dans la liste, confirmation avec QR code et lien `wa.me` ; puis page de l'agent IA : statut « Accès limité », « Ouvrir à tous », statut « Actif », pastille mise à jour dans la liste des agents IA ; second assistant sur le numéro de test : « Activer » directement en actif ; « Plus tard » à l'étape 4 termine en brouillon.
- [ ] **Étape 2 : lancer** `npx playwright test` dans `apps/web` ; tout passe, parcours existants compris.
- [ ] **Étape 3 : commit** `test(web): parcours Connexions et activation de bout en bout`.

### Tâche 10 : revue d'isolation dédiée

Spec §4.5 et `CLAUDE.md` : relecteur qui ne reçoit pas les conclusions de l'implémenteur, sur le code modifié et sur le code qu'il appelle ou qui l'appelle (routes BFF, `engine-fetch.ts`, `proxy.ts`, routes du moteur appelées).

Questions imposées au relecteur : une route BFF peut-elle appeler le moteur sans l'organisation du cookie, ou avec une organisation différente de celle affichée ? Un identifiant de compte, de numéro ou d'agent IA d'une autre organisation peut-il produire autre chose qu'un 404 neutre ? Un membre non admin peut-il déclencher une écriture (le web masque, le moteur refuse : vérifier les deux) ? Un secret (jeton d'accès, secret d'app, productToken) peut-il revenir dans une réponse, un journal ou le DOM ? Le jeton de vérification et l'URL de webhook sont-ils limités aux écrans admin ? Une liste périmée (autre onglet, autre organisation) peut-elle mener à brancher un numéro sur le mauvais agent IA ?

- [ ] **Étape 1 :** lancer la revue (modèle le plus capable), rapport versé dans `docs/superpowers/research/<date du jour>-revue-isolation-2b-3.md`.
- [ ] **Étape 2 :** corriger chaque constat bloquant, test d'abord, le test portant le numéro du constat (`// revue 2b-3 I-1`) ; mineurs notés dans le registre.
- [ ] **Étape 3 : commit** `docs(revue): revue d'isolation du lot 2b-3` puis un commit par correction.

### Tâche 11 : test en live et recette

Règle de François : tester l'application en réel à chaque livraison.

- [ ] **Étape 1 : préparer** un worktree jetable de la branche, une copie de `store/demo.db`, moteur sur le port 3800 avec `PUBLIC_BASE_URL=https://dev.wabagent.com`, tunnel `wabagent-dev` (`cloudflared tunnel --config ~/.cloudflared/wabagent-dev.yml run wabagent-dev`), web lancé (`npm run dev -w @wabagent/web`), tarifs chargés (`scripts/seed-pricing.ts`), clé Anthropic dans la réserve de la copie.
- [ ] **Étape 2 : parcours admin réel** : raccorder la WABA de test Ravivo par la page de raccordement (contrôles réels, abonnement constaté), afficher l'URL de webhook et le jeton de vérification du nouveau compte, les reporter dans l'app WABAGENT Dev (accord de François au moment du test), créer un agent IA par l'assistant jusqu'à « Activer » sur le numéro de test, scanner le QR code, échanger avec l'agent IA depuis le téléphone de François ; passer en accès limité avec son numéro, vérifier qu'un autre numéro n'est pas servi et que le compteur de la page de l'agent IA monte.
- [ ] **Étape 3 : contrôles d'écran** : clair et sombre, FR et EN, largeur 1280 et 1440, comparaison aux maquettes et à la charte ; membre non admin (lecture seule de la page de l'agent IA, pas d'accès à Connexions).
- [ ] **Étape 4 : rapport** à François (vérifié, non vérifié, écarts) et recette avec lui.

Puis revue finale de branche (subagent-driven-development), merge local avec l'accord de François, push seulement avec son accord explicite.

---

## Hors lot 2b-3 (rappel)

- Embedded Signup (« Connexion Meta ») : après le statut Tech Provider et la mise en ligne de wabagent.com.
- CRM au niveau de l'organisation : plan suivant (le bloc « CRM : à venir » de Connexions l'annonce).
- Définition d'un lead qualifié, affichage des conversations : chantier Conversations & Leads.
- Double accueil, message d'erreur non enregistré : chantier Personnalité et contenu.
- Remplissage des tarifs et de la réserve de clés au déploiement : check-list Infra.
