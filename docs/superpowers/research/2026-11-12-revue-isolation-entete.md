# Revue d'isolation : en-tête de page et corrections de recette

Date : 12 nov. 2026. Branche : `feat/refonte-navigation`, commits `c45ef90..fa205ae` (23 commits). Relecteur neuf : ni rapports des exécutants, ni registres `.superpowers/`, ni plan. Référentiel : `CLAUDE.md` (règles non négociables multi-organisations) et la spec `docs/superpowers/specs/2026-11-11-entete-de-page-et-corrections-design.md` (sections 2.4, 3, 5 et 7).

Code lu : le diff du lot (web, contrats, `src/whatsapp`), et le code appelé ou appelant : `engine-client.ts`, `engine-fetch.ts`, routes BFF `/api/auth/me` et `/api/auth/refresh`, `resolveActiveOrg`, `readOrg`, `accessSubject`, `session-provider.tsx` (liaison d'`apiFetch`, `retry`, `reloadChanged`, `handleOrgError`, `switchOrg`), `api-fetch.ts`, `org-notice.ts`, `session-unreadable.tsx`, `app-rail.tsx`, `org-block.tsx`, les pages qui affichent un nom d'entité (liste des agents IA, mise en page et pages d'un agent IA, usage de l'organisation et d'un agent IA, assistant, Utilisateurs, Réglages, page réservée), `assign-choice.ts`, `decideAssign` (`packages/contracts/src/bot-status.ts`), `assign-bot-dialog.tsx`, `number-picker.tsx`, `account-alerts.tsx`, `src/whatsapp/meta-graph.ts`, `apps/web/e2e/mock-engine.ts`, route moteur `/auth/me` (`src/api/admin/routes/auth.ts`).

Aucun constat Bloquant ni Important. Quatre constats Mineurs.

## Constats

### M-1. Changement d'utilisateur pendant une session illisible : le bandeau peut nommer une organisation de l'utilisateur précédent

- Fichiers : `apps/web/src/components/providers/session-provider.tsx`, lignes 197 à 215 (`retry`) et 181 à 190 (`reloadChanged`) ; `apps/web/src/lib/org-notice.ts`, ligne 47 (`reloadNotice`) ; même logique sur le retour à l'onglet (lignes 278 à 300, antérieure au lot).
- Scénario (entre deux utilisateurs d'organisations différentes, même navigateur) : l'onglet affiche l'organisation X de l'utilisateur A ; le moteur tombe, l'onglet passe en « Impossible de lire votre session » avec le cadre de A. Le moteur revient, B se connecte dans un autre onglet (cookies de session remplacés). Dans le premier onglet, « Réessayer » relit la session de B ; son organisation active diffère de X, `reloadChanged(next, prev = X)` calcule `reloadNotice` : X n'est pas dans les organisations de B, le bandeau stocké dit « Vous n'avez plus accès à X ». B voit le nom d'une organisation dont il n'est pas membre. Variante au premier chargement (cadre neutre) : un bandeau déjà stocké dans `sessionStorage` (`takeStoredNotice`, ligne 240) est affiché après un « Réessayer » qui relit la session d'un autre utilisateur.
- Portée : le nom était déjà affiché dans cet onglet juste avant ; aucune donnée d'exécution (message, lead, numéro) ne traverse ; la page de B est relue à neuf. Mais c'est un nom d'organisation affiché qui n'est pas celui de l'organisation ouverte, contraire à l'anti-objectif de la spec (section 1). Le chemin `retry` est nouveau dans ce lot ; le chemin du retour à l'onglet existait.
- Correction proposée : dans `retry`, `reloadChanged` et le retour à l'onglet, comparer `next.user.id` à celui de la session précédente ; utilisateur changé : rechargement sans bandeau (et `sessionStorage` vidé).
- Gravité : Mineur.
- Test manquant : `session-provider.test.tsx`, « Réessayer » qui relit la session d'un autre utilisateur : aucun bandeau ne nomme une organisation absente de `next.user.organizations`.

### M-2. `src/whatsapp` : le diff dépasse le texte du message

- Fichier : `src/whatsapp/meta-graph.ts`, `classify` (genre `not_a_waba`, ajouté vers la ligne 96), `describeFailure` (indicateur `engineExplains`), `failureReport` (le contrôle `waba_access` ne porte plus `provider_text` dans ce cas).
- Constat : le contrôle imposé 5 demande un diff réduit au texte du message « identifiant qui n'est pas un WABA ». Le diff ajoute un genre d'échec, l'indicateur `engineExplains` et retire `provider_text` du contrôle. Effet vérifié : seule une réponse Meta en code 100 dont le message contient « nonexisting field » et « subscribed_apps » change de branche ; le contrôle devient `waba_access` au lieu de `subscription`, la raison reste `other`, non transitoire ; `provider_text` reste passé par `sanitizeProviderText` (secrets du compte masqués) et reste dans la réponse et l'erreur enregistrée du compte. Aucun effet sur l'authentification d'un webhook, le routage ou le choix des identifiants.
- Scénario : sans objet entre organisations (vérification d'un compte avec ses propres identifiants).
- Gravité : Mineur (écart à la lettre du contrôle, sans risque d'isolation).
- Test : `src/whatsapp/__tests__/meta-graph.test.ts`, deux cas « recette 3.14 » (message reconnu et autre code 100). Il manque un cas où le message de Meta contiendrait un secret du compte : le `provider_text` gardé doit être masqué (le code passe bien par `sanitizeProviderText`, le test ne le prouve pas pour cette branche).

### M-3. Jeton d'accès refusé gardé quand le renouvellement ne joint pas le moteur

- Fichier : `apps/web/src/lib/engine-fetch.ts`, ligne 102 ; `apps/web/src/app/api/auth/refresh/route.ts`, ligne 22.
- Constat : le moteur répond 401 au jeton d'accès, puis `/auth/refresh` ne répond pas (moteur arrêté entre les deux) : `ENGINE_UNREACHABLE` est relancé et les cookies restent, jeton d'accès refusé compris. Le jeton de renouvellement, lui, n'a pas été refusé : le garder est le but de la correction. Le jeton d'accès gardé est déjà rejeté par le moteur ; l'appel suivant reçoit 401 et refait le renouvellement. Aucun accès n'en découle, ni pour une autre organisation ni pour un autre membre.
- Cas voisin : moteur qui a traité le renouvellement (rotation) puis coupé la connexion avant la réponse : l'ancien jeton de renouvellement est gardé, le renouvellement suivant est refusé et la session est effacée. Sans fuite.
- Gravité : Mineur (à la lettre du contrôle 2, « un jeton refusé n'est jamais gardé » ; sans effet réel).
- Test : `auth-routes.test.ts`, « refresh : moteur injoignable, 503 ENGINE_UNREACHABLE et cookies de session conservés » ; `engine-fetch.test.ts`. Pas de test qui prouve qu'un renouvellement refusé (401 du moteur) efface toujours la session après ce changement dans `engineFetch` ; il existe pour la route `/api/auth/refresh` (« renouvellement refusé déconnecte toujours »), à vérifier aussi pour `engineFetch` si absent.

### M-4. Usage d'un agent IA illisible : l'identifiant de l'adresse est affiché dans la ligne des parents

- Fichiers : `apps/web/src/app/[locale]/(app)/agents/[botId]/layout.tsx`, lignes 17 et 18 (`unknownInfo` : `name: botId`) ; `apps/web/src/app/[locale]/(app)/agents/[botId]/usage/page.tsx`, ligne 64.
- Scénario (un seul membre, ou un identifiant d'agent IA d'une autre organisation tapé dans l'adresse) : `/agents/<id d'une autre organisation>/usage` ; `/api/bots/<id>` répond 404 (le moteur borne la lecture à l'organisation ouverte), la mise en page prend l'identifiant comme nom, et la ligne des parents devient « Agents IA › <id> ». Rien de l'autre organisation n'est lu ni affiché : seul le texte de l'adresse est recopié. La spec (7.4) demande pour une lecture échouée « Agent IA indisponible » et les parents « Agents IA » seuls ; la vue d'ensemble le fait, la page d'usage non.
- Gravité : Mineur (pas un nom d'entité ni d'organisation ; texte de l'adresse affiché tel quel).
- Test manquant : page d'usage d'un agent IA dont la lecture échoue : parents « Agents IA » seuls, identifiant de l'adresse jamais affiché.

## Résultat des contrôles imposés

### 1. Aucun nom d'entité ou d'organisation affiché ne vient d'un paramètre d'adresse : conforme

- Liste des agents IA (`app/[locale]/(app)/page.tsx`) : le nom d'entité du titre, de la bulle et du nom accessible du bouton rond (« Créer un agent IA dans {entité} ») vient de `/api/entities` de l'organisation ouverte, entités actives seulement ; entité inconnue : « Entité indisponible », liste vide, aucun bouton rond. `welcome=1` n'est qu'un drapeau, le nom vient de la session. Tests : `home.test.tsx` (« ?entity=2 absente des entités de l'organisation », « welcome=<texte> forgé »).
- Pages d'un agent IA : `agentParents` ne nomme l'entité que si `entity_id` (lu du moteur, organisation ouverte) est trouvé dans `/api/entities` lus ; sinon « Agents IA » seul. Réserve : M-4 pour l'identifiant de l'agent IA.
- Usage de l'organisation : nom tiré de `/api/entities` ; entité inconnue : « Entité indisponible », aucune ligne. Test : `usage-page.test.tsx` (« ?entity=2 hors de l'organisation ouverte »).
- Assistant : entité choisie lue des entités actives de l'organisation ouverte ; la présélection `?entity=` n'est retenue que si elle en fait partie ; la description de « Quitter » ne nomme l'entité d'origine que si elle est lue. Test : `wizard.test.tsx` (« origine entité hors de l'organisation »).
- Utilisateurs : filtre `?entity=` ignoré hors des entités lues. Réglages, page réservée, bloc Organisation, bandeau : nom tiré de la session (`activeOrg`, `me.organizations`).

### 2. Session illisible et jeton refusé : conforme, avec la réserve M-1 et la remarque M-3

- `engineCall` transforme un `fetch` rejeté en `ENGINE_UNREACHABLE` 503 ; `/api/auth/me` ne répond plus 500 et ne touche pas aux cookies.
- `SessionProvider` en échec : avec une session déjà lue, seul le cadre de cette session (rail, bloc Organisation) est rendu, sans les pages ; la liaison d'`apiFetch` reste celle de la session lue (en-tête d'organisation affichée inchangé, donc 409 `ORG_CHANGED` si le cookie a changé) ; sans session lue, cadre neutre (`AppRailView` sans compte, colonne vide, aucun bandeau). « Réessayer » sur une autre organisation recharge la page entière. Le passage de l'écran d'échec aux pages remonte les composants (types différents), aucune donnée de page n'est reprise. Tests : `session-provider.test.tsx` (lignes 213 à 296), `e2e/session-unreadable.spec.ts`.
- Renouvellement refusé par le moteur : session effacée (route et `engineFetch`) ; moteur injoignable : session gardée (M-3).

### 3. `refused_client_id` ne nomme qu'une organisation dont l'utilisateur du jeton est membre : conforme

- `/api/auth/me` (BFF) le cherche dans `user.organizations`, liste rendue par le moteur pour l'utilisateur du jeton (`authService.me(req.auth.userId)`, non modifié), et seulement pour le cookie posé par ce même utilisateur (`readOrg(user.id)`, cookie préfixé par l'identifiant). `refusedNotice` revérifie côté client que l'organisation est listée et non ouvrable. Tests : `auth-routes.test.ts` (« cookie d'un autre utilisateur », « organisation dont l'utilisateur n'est pas membre », avec contrôle que `c9` n'apparaît nulle part dans la réponse) ; `session-provider.test.tsx` (« refused_client_id inconnu ou ouvrable : aucun bandeau »).

### 4. Bouton rond et « Simuler » selon les droits : conforme

- Bouton rond : `isAdmin && !readOnly` sur la liste des agents IA (et pas d'entité inconnue), Connexions (et pas d'encart vide), Entités, Utilisateurs ; l'espace Organisation est entièrement réservé à l'administrateur (`organisation/layout.tsx`) ; l'assistant refuse sur place hors de ce droit. Tests par rôle : `home.test.tsx` (conseiller, super manager en lecture seule, administrateur en lecture seule, conseiller sur une entité et sur « Ne répond pas ») ; `organisation-space.test.tsx` (conseiller sur chaque page, lecture seule sur Entités et Utilisateurs) ; `connexions/__tests__/page.test.tsx` (lecture seule, aucun compte).
- « Simuler » : `!readOnly`, conseiller compris, conforme à la spec 2.4 et à l'action moteur `simulate.use` (membres, refusée en lecture seule, `src/core/auth/permissions.ts`). Tests : `agent-pages.test.tsx` (lecture seule, conseiller, échec de lecture).
- L'interface masque, le moteur refuse : aucune route BFF ni moteur n'est modifiée par le lot (les seules routes BFF touchées sont `/api/auth/me` et `/api/auth/refresh`).

### 5. Moteur hors du lot : partiellement conforme

- `git diff --stat main -- src/webhooks src/transport src/core/router.ts` : vide.
- `git diff main -- src/whatsapp` : plus que le texte du message (M-2), sans effet sur l'isolation.

### 6. Journaux : conforme

- Deux journaux ajoutés : `[BFF] moteur injoignable` (`engine-client.ts`, sans adresse ni en-têtes) et `[Session] nouvel essai de lecture impossible` avec `errorText(err)` (message d'une erreur `HTTP <statut>` ou réseau, côté navigateur). Aucun jeton, secret, numéro de contact ni texte de Meta journalisé. `npm run check:logs` : ok.

## Autres chemins examinés

- Branchement sur un compte en erreur (correction 7) : `assignRefusal` appelle `decideAssign` des contrats, comme le faux moteur (`assignRefusalOf`) ; aucune écriture ajoutée, les routes BFF de branchement ne changent pas ; les numéros et agents IA proposés viennent des listes de l'organisation ouverte. Le moteur décide de nouveau à l'écriture.
- Contrats : seuls des commentaires changent dans `bot-status.ts`.
- Faux moteur : `/__unreachable` coupe toutes les routes du moteur jusqu'au `__reset`, sans effet sur le code livré.
- « Vérifier maintenant » du bandeau d'un compte en erreur : ouvre la fenêtre existante du menu « Gérer », sur le compte de la carte (organisation ouverte).
