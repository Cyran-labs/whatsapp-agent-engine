# Audit de restitution des erreurs et des règles de gestion

Date : 9 nov. 2026. Branche : `feat/2b-3-ecrans` (dernier commit lu : `4b0f478`). Auteur : audit en lecture seule, aucun fichier de code modifié.

Question posée : chaque règle de gestion et chaque erreur levée par le moteur est-elle restituée dans le back-office au bon endroit, compréhensible, actionnable, et chaque écriture réussie a-t-elle un retour visible ?

Réponse courte : le chemin « nominal » des écrans 2b-3 (Connexions, assistant, page de l'agent IA) est soigné : les refus du moteur sont affichés tels quels dans la fenêtre ou le panneau concerné, avec relecture de l'état. Les défauts se concentrent ailleurs : écrans plus anciens qui remplacent le message du moteur par un texte générique ou faux (connexion, création d'agent IA, acceptation d'invitation), chiffres masqués en zéro, informations d'erreur que le moteur connaît mais que l'interface ne montre pas, transitions de session sans explication, et l'absence d'un système commun de notifications.

---

## 1. Méthode et périmètre réellement couverts

### 1.1 Moteur (lu en entier pour les erreurs)

- `src/api/errors.ts` (codes et statuts), `src/api/middleware/{auth,context,error-handler,rate-limit}.ts`, `src/api/admin/router.ts`, toutes les routes de `src/api/admin/routes/`.
- `src/core/auth/{access-service,auth-service,admin-service,permissions}.ts`.
- `src/core/services/{bot,entity,user-admin,settings,connections,credentials,dashboard,simulate,whatsapp-account}-service.ts`.
- Messages des fournisseurs : `src/whatsapp/meta-graph.ts`, `src/whatsapp/cm-channels.ts`.
- Contrats : `packages/contracts/src/{errors,bot-status,bots,accounts,auth,whatsapp}.ts`. Les messages Zod par défaut ont été évalués par script (`safeParse` sur les schémas réels).
- Refus des pilotes de base (`src/core/database/whatsapp-{sqlite,postgres}.ts`, raisons `not_found`, `holder_changed`, `empty_allowlist`, `number_in_use`, `meta_app_taken`, `provider_account_taken`).

### 1.2 Back-office (lu en entier)

- Couche d'accès : `apps/web/src/lib/{api-fetch,engine-fetch,engine-client,proxy,api-response,api-json,session-errors,holder-changed,organizations}.ts`, `middleware.ts`.
- Session : `components/providers/session-provider.tsx`, `components/shell/{org-notice-banner,org-switcher,user-menu}.tsx`, `app/[locale]/no-organization/page.tsx`.
- Authentification : `components/auth/{login-form,forgot-password-form,reset-password-form,accept-invite-form,invitation-flow}.tsx`, `components/account/change-password-form.tsx`, routes BFF `app/api/auth/**`.
- Organisation : pages `entites`, `utilisateurs`, `reglages`, `connexions`, `connexions/raccorder`, et composants `components/organisation/**`, `components/connections/**`.
- Agents IA : liste (`app/[locale]/(app)/page.tsx`), assistant (`components/wizard/**`, 5 étapes), page de l'agent IA (`app/[locale]/(app)/agents/[botId]/**`, `components/agent/**`), simulateur, `components/numbers/**`.
- Usage et coûts : `app/[locale]/(app)/usage/page.tsx`, `agents/[botId]/usage/page.tsx`, routes BFF `api/usage/summary`, `api/bots/summary`.
- Textes : `apps/web/messages/fr.json` et `en.json` (754 clés chacun, parité des clés vérifiée).

### 1.3 Vérifications en navigateur

Back-office lancé sur le moteur simulé (`npx tsx e2e/mock-engine.ts`, `next dev -p 3012`), parcours pilotés par Playwright (Chromium sans tête), compte `demo@wabagent.test`. Les deux serveurs ont été arrêtés à la fin ; l'état git est inchangé.

| Cas vérifié | Résultat observé |
|---|---|
| Renommer un compte WhatsApp avec un nom vide | Fenêtre : « String must contain at least 1 character(s) » |
| Remplacer les identifiants Meta avec des valeurs trop courtes | Sous les champs : « String must contain at least 20 character(s) », « String must contain at least 16 character(s) », et le même texte anglais en message général |
| Carte de coût de la page de l'agent IA `demo-1` | « 184 k tokens in · 39 k out · 0 erreur » ; page Usage de l'agent IA : « 0 erreur » |
| Page de l'agent IA : mention des échecs de remise | Aucune |
| Connexion avec le moteur arrêté | BFF 500, écran : « Identifiants invalides. » |

Script de contrôle des messages Zod (contrats réels) : `name` vide → « String must contain at least 1 character(s) » ; `account_id` → « Invalid uuid » ; `email` → « Invalid email » ; `message` du simulateur vide → « String must contain at least 1 character(s) ».

### 1.4 Hors périmètre

- Routes sans écran à ce jour : identifiants CRM et LLM par agent IA (`/bots/:id/crm`, `/llm`, `/mappings`), routes plateforme (`/clients`, `/platform`), journal d'audit. Leurs messages sont listés pour mémoire quand ils posent un problème de formulation.
- Webhooks (`/webhook/**`) : pas d'interface ; leurs effets visibles (compte en erreur de signature, alertes) sont couverts par la matrice.
- Aucun test de lecteur d'écran réel ; l'accessibilité n'est jugée que sur les rôles `alert` et `status`.

---

## 2. Matrice des erreurs et des règles de gestion

Légende du verdict : **OK** ; **Défaut R-n** (renvoi à la section 4) ; **n/a** (pas atteignable depuis l'interface).

### 2.1 Transversal (session, organisation, serveur)

| # | Code, statut, message moteur | Déclencheur | Écrans | Ce que voit l'utilisateur | Verdict | Preuve |
|---|---|---|---|---|---|---|
| T1 | `UNAUTHORIZED` 401, « Session expirée. » / « Session invalide. » (renouvellement impossible) | Jeton de renouvellement expiré pendant une action | Tous les écrans sous session | Le message de l'action s'affiche un instant (« Session expirée. »), puis redirection vers `/login` sans aucune explication ; saisie perdue ; après reconnexion, retour à l'accueil, pas à la page quittée | Défaut R-10 | `lib/engine-fetch.ts:79-94`, `components/providers/session-provider.tsx:203`, `app/[locale]/login/page.tsx:15-19` |
| T2 | `ORG_CHANGED` 409 (BFF), « Organisation changée dans un autre onglet. » | Bascule d'organisation dans un autre onglet | Tous | Rechargement complet sur l'accueil, aucun message ; saisie perdue | Défaut R-11 | `lib/engine-fetch.ts:69-71`, `session-provider.tsx:87-89,201` |
| T3 | `FORBIDDEN` 403, « Organisation suspendue. » | Organisation suspendue pendant la session | Tous | Autre organisation disponible : rechargement et bandeau « Cette organisation est suspendue. » (sans nom). Seule organisation : page « Aucune organisation » qui parle d'invitation, jamais de suspension | Partiel, Défaut R-13 | `session-provider.tsx:125-147`, `no-organization/page.tsx`, `fr.json noOrganization.body` |
| T4 | `FORBIDDEN` 403, « Accès refusé. » (rôle ou appartenance) | Droits retirés pendant la session | Tous | Le texte brut « Accès refusé. » dans la zone d'erreur de l'action, et si le rôle a changé le bandeau « Votre accès à cette organisation a changé. » | OK (formulation : R-29) | `lib/api-fetch.ts:34-41`, `session-provider.tsx:140-141` |
| T5 | `VALIDATION_ERROR` 400, « Organisation à préciser. » ; `NOT_FOUND` 404, « Organisation introuvable. » | Cookie d'organisation périmé | Tous | Rien : le BFF efface le cookie et la session se relit | OK | `lib/engine-fetch.ts:33-41,76` |
| T6 | `RATE_LIMITED` 429, « Trop de requêtes. » | Connexion, mot de passe oublié, page d'invitation, changement de mot de passe | Écrans d'authentification, Mon compte | Texte traduit « Trop de tentatives. Réessayez dans un instant. » ; sauf Changer le mot de passe qui affiche le texte brut du moteur | OK, Défaut R-26 | `login-form.tsx:57`, `forgot-password-form.tsx:41`, `change-password-form.tsx:53` |
| T7 | `INTERNAL` 500, « Erreur interne. » | Panne moteur, exception non prévue, LLM en échec | Toutes les écritures passant par `sendMutation` | « Erreur interne. » à la place du message contextuel prévu (« Changement de statut impossible. Réessayez. » etc.) ; aucun identifiant de requête | Défaut R-14 | `lib/api-fetch.ts:95-101,169`, `lib/api-response.ts:6-13` |
| T8 | Moteur injoignable (BFF 500) | Moteur arrêté | Connexion | « Identifiants invalides. » (vérifié en navigateur) | Défaut R-1 | `login-form.tsx:56-59` |
| T9 | Réponse non JSON du moteur | Proxy intermédiaire en 502 ou 504 | Toutes | Message « Erreur engine. » (mot anglais) si l'écran affiche le message | Défaut R-24 | `lib/engine-client.ts:44` |
| T10 | `VALIDATION_ERROR` 400 du BFF avec messages Zod par défaut | Valeur hors contrat non contrôlée côté écran | Renommer un compte, Remplacer les identifiants | Anglais technique (vérifié en navigateur) | Défaut R-7 | `lib/proxy.ts:44-50`, `packages/contracts/src/whatsapp.ts:7,11-17` |
| T11 | `VALIDATION_ERROR` « Corps JSON invalide. » / « trop volumineux. » | Corps mal formé | n/a depuis l'interface (les écrans envoient du JSON) ; les routes BFF `api/bots`, `api/bots/[botId]`, `simulate` répondent 500 sur un corps illisible au lieu de 400 | n/a, Défaut R-24 | `error-handler.ts:19-23`, `app/api/bots/route.ts:17` |
| T12 | Messages du moteur en français seulement | Tout refus métier | Interface en anglais | Le texte français du moteur s'affiche tel quel dans l'interface anglaise | Défaut R-15 | `lib/api-fetch.ts:98`, commentaire `connect-form.tsx:33` |

### 2.2 Authentification et invitations

| # | Code, message moteur | Déclencheur | Écran | Ce que voit l'utilisateur | Verdict | Preuve |
|---|---|---|---|---|---|---|
| A1 | 401 « Identifiants invalides. » | Mauvais mot de passe | Connexion | « Identifiants invalides. » sous le formulaire | OK | `login-form.tsx:57,94` |
| A2 | 400 `current_password` « Mot de passe actuel incorrect. » | Mot de passe actuel faux | Mon compte › Sécurité | Texte traduit sous le formulaire | OK | `change-password-form.tsx:48-50` |
| A3 | 400 « Le mot de passe doit faire au moins 10 caractères. » | Mot de passe court | Accepter une invitation, Nouveau mot de passe, Sécurité | Contrôle avant envoi, texte traduit | OK | `accept-invite-form.tsx:30-33`, `reset-password-form.tsx:32-35` |
| A4 | 401 « Invitation invalide ou expirée. » (lecture du lien) | Lien expiré, révoqué, déjà utilisé | Page d'invitation | Carte « lien invalide » avec lien vers la connexion ; 5xx et 429 : message et « Réessayer » | OK | `invitation-flow.tsx:100-112,177-205` |
| A5 | 401 « Invitation invalide ou expirée. » (acceptation, compte existant) | Invitation révoquée entre-temps | Page d'invitation, compte connecté | Le texte est juste dans ce cas, mais il s'affiche aussi pour une panne moteur, une erreur réseau ou un 429 | Défaut R-8 | `invitation-flow.tsx:157-171` |
| A6 | Acceptation, compte neuf | Toute erreur | Page d'invitation | 429 : tentatives ; 5xx : « Enregistrement impossible pour le moment » ; autre : invitation invalide | OK | `accept-invite-form.tsx:49-55` |
| A7 | 401 « Lien de réinitialisation invalide ou expiré. » | Lien périmé | Nouveau mot de passe | Carte « lien expiré » et lien « demander un nouveau lien » | OK | `reset-password-form.tsx:50-51,64-78` |
| A8 | Refus 4xx de « mot de passe oublié » | Adresse inconnue | Mot de passe oublié | Confirmation identique (anti-énumération voulue) | OK | `app/api/auth/forgot-password/route.ts:20-22` |
| A9 | 401 « Session expirée. » à l'acceptation | Session perdue sur la page d'invitation | Page d'invitation | Retour au formulaire de connexion de la même page, jeton gardé | OK | `invitation-flow.tsx:158-164` |

### 2.3 Organisation : utilisateurs, invitations, entités, réglages

| # | Code, message moteur | Déclencheur | Écran | Ce que voit l'utilisateur | Verdict | Preuve |
|---|---|---|---|---|---|---|
| U1 | 409 « Cette personne est déjà membre de l'organisation : modifiez ses accès. » | Inviter un membre | Tiroir Inviter | Message dans le tiroir, actionnable | OK | `access-drawer.tsx:257`, `user-admin-service.ts:41` |
| U2 | 409 « Ce compte ne peut pas être invité. » | Compte plateforme ou invité d'un autre type | Tiroir Inviter | Message dans le tiroir, sans dire pourquoi ni quoi faire | Défaut R-28 | `user-admin-service.ts:42` |
| U3 | 409 « Cette invitation a déjà été acceptée. » | Renvoyer une invitation acceptée dans un autre onglet | Utilisateurs | Message en haut de page, loin de la ligne ; liste non relue | Défaut R-27 | `utilisateurs/page.tsx:146-149,188-190` |
| U4 | 404 « Invitation introuvable. » | Double clic sur Révoquer, ou invitation déjà révoquée | Utilisateurs | Message d'erreur en haut de page alors que la révocation a réussi | Défaut R-20 | `utilisateurs/page.tsx:154-163`, `invitations-table.tsx:61` |
| U5 | 409 « L'organisation doit garder au moins un admin. » | Retirer ou suspendre le dernier admin | Tiroir Modifier, fenêtre Suspendre | Message dans la fenêtre | OK | `access-drawer.tsx:257`, `suspend-dialog.tsx:36` |
| U6 | 400 `grants` « Rôles invalides. » / « Entité introuvable ou archivée. » ; règles Zod des rôles (messages français) | Entité archivée entre-temps | Tiroir | Message dans le tiroir (le tiroir empêche les combinaisons invalides) | OK | `user-admin-service.ts:292-297`, `accounts.ts:36-56` |
| U7 | 404 « Utilisateur introuvable. » | Membre retiré entre-temps | Tiroir, Suspendre | Message dans la fenêtre | OK | idem |
| U8 | Échec de lecture des utilisateurs | Panne | Utilisateurs | « Impossible de charger les utilisateurs. » sans bouton Réessayer | Défaut R-16 | `utilisateurs/page.tsx:188-190` |
| N1 | 409 « Une entité porte déjà ce nom. » | Créer ou renommer | Entités | Message sous la ligne en cours d'édition | OK | `entities-table.tsx:51,84` |
| N2 | 409 « L'organisation doit garder au moins une entité active. » | Archiver la dernière entité | Entités | Action masquée quand une seule entité est active ; sinon message dans la fenêtre | OK | `entities-table.tsx:238`, `archive-entity-dialog.tsx:82` |
| N3 | 409 « Déplacez d'abord les agents IA et les membres de cette entité. » | Archiver une entité utilisée | Fenêtre Archiver | Contrôle préalable (« Impossible pour l'instant : … ») avec bouton Déplacer, puis message moteur si l'état a bougé | OK | `archive-entity-dialog.tsx:35-53` |
| N4 | 400 « Le nom est requis. » / « … 80 caractères. » | Nom vide ou long | Entités | Contrôle local traduit, puis message moteur sous la ligne | OK | `entities-table.tsx:40-43` |
| N5 | 404 « Entité introuvable. » | Entité supprimée ailleurs | Entités | Message sous la ligne ou dans la fenêtre | OK | idem |
| N6 | Refus de la réactivation (ex. 409 nom en double) | Réactiver une entité | Entités | Message en haut de page, loin de la ligne ; pas de garde de double clic | Défaut R-27 | `entites/page.tsx:110-118,166-168` |
| N7 | Échec de lecture des entités | Panne | Entités | « Impossible de charger les entités. » sans Réessayer ; échec du chargement des archivées : « Une erreur est survenue. » | Défaut R-16 | `entites/page.tsx:131-134,166-168` |
| S1 | 400 « Ce mode de visibilité n'est pas encore disponible. » | n/a : la page n'écrit pas | Réglages | Les modes indisponibles portent « bientôt disponible » et la note « rien à enregistrer » | OK | `reglages/page.tsx:94-105` |
| S2 | Échec de lecture des réglages | Panne | Réglages | « Une erreur est survenue. » sans Réessayer, et cartes affichées sans aucun mode coché | Défaut R-16 | `reglages/page.tsx:50-52,54-66` |

### 2.4 Connexions (comptes WhatsApp, numéros, webhook)

| # | Code, message moteur | Déclencheur | Écran | Ce que voit l'utilisateur | Verdict | Preuve |
|---|---|---|---|---|---|---|
| W1 | 400 « Saisissez la valeur complète : une valeur masquée n'est pas acceptée. » (par champ) | Coller une valeur masquée | Raccorder, Remplacer les identifiants | Message sous le champ concerné | OK | `connect-form.tsx:122`, `replace-credentials-dialog.tsx:83,123` |
| W2 | 409 « Ce compte WhatsApp est déjà raccordé. » | WABA déjà raccordée dans l'organisation | Raccorder | Message sous le bouton | OK | `connect-form.tsx:117` |
| W3 | 409 « Ce compte ne peut pas être raccordé. Contactez le support. » | WABA ou app tenue par une autre organisation | Raccorder, Remplacer | Message sous le bouton (aucun lien vers le support) | OK | idem |
| W4 | 409 « Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte. » | Autre WABA dans Remplacer | Remplacer | Indice sous le champ (« Doit rester celui de ce compte ») et message moteur | OK | `replace-credentials-dialog.tsx:105,127` |
| W5 | 409 « Ce compte WhatsApp est déconnecté : raccordez un nouveau compte. » | Action sur un compte déconnecté | n/a : les comptes déconnectés n'ont pas de menu | OK | `connexions/page.tsx:155-169` |
| W6 | 409 « Les identifiants enregistrés de ce compte sont illisibles : raccordez un nouveau compte. » | Clé de chiffrement changée | Remplacer, Rafraîchir | Message dans la fenêtre, actionnable | OK | `account-run-dialog.tsx:67` |
| W7 | 422 `WA_VALIDATION_FAILED` avec contrôles (« Jeton refusé par Meta », « Secret de l'app refusé », « Identifiant de compte introuvable ou non partagé avec le jeton », « Meta ne répond pas », « Abonnement aux webhooks non confirmé par Meta »…) | Raccorder ou remplacer | Raccorder, Remplacer | Message général et liste des contrôles en échec avec libellé traduit et détail | OK ; texte brut de Meta : Défaut R-21 | `verification-checks.tsx:19-21`, `meta-graph.ts:139` |
| W8 | 422 « Impossible de lire l'application du jeton auprès de Meta, réessayez. » | debug_token en échec | Raccorder, Remplacer | Contrôle « app » en échec, message | OK | `whatsapp-account-service.ts:85` |
| W9 | Vérifier maintenant : issue `refused` ou `inconclusive` (200) | Jeton révoqué, fournisseur indisponible | Fenêtre Vérifier | Titre en rouge (« Vérification refusée : le compte est passé en erreur. ») et contrôles | OK | `account-run-dialog.tsx:77-88` |
| W10 | 422 erreur de lecture des numéros (`path: numbers`) | Rafraîchir avec jeton refusé | Fenêtre Rafraîchir | Message ; la page se relit (le compte passe en erreur) | OK | `account-run-dialog.tsx:50` |
| W11 | 422 « Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré. » | Inventaire vide | Rafraîchir, Remplacer | Message dans la fenêtre, ou contrôle « numbers » en attente | OK | `whatsapp-account-service.ts:413,293-295` |
| W12 | 409 « Mettez d'abord en pause ou en brouillon les agents IA qui utilisent ce compte. » + noms | Déconnecter un compte en service | Fenêtre Déconnecter | Message et liste des agents IA (sans lien vers eux) | OK | `disconnect-dialog.tsx:44-57` |
| W13 | 404 « Compte WhatsApp introuvable. » / « Numéro WhatsApp introuvable. » | Compte ou numéro disparu | Fenêtres | Message dans la fenêtre | OK | `dialog-ui.tsx:29-31` |
| W14 | 400 Zod par défaut sur `name` | Nom vide ou plus de 80 caractères | Renommer un compte | « String must contain at least 1 character(s) » (vérifié) | Défaut R-7 | `rename-account-dialog.tsx:39`, `whatsapp.ts:7` |
| W15 | 400 Zod par défaut sur `access_token`, `app_secret`, `account_id`, `product_token` | Valeur trop courte, UUID invalide | Remplacer les identifiants | Anglais technique sous les champs et en message général (vérifié) ; l'écran Raccorder, lui, traduit les mêmes règles | Défaut R-7 | `replace-credentials-dialog.tsx:60-84` vs `connect-form.tsx:73-86` |
| W16 | Compte `error`, motif `token_invalid` | Jeton révoqué à l'envoi ou à la vérification | Connexions | Bandeau rouge « Jeton refusé par Meta. Les agents IA de ce compte ne peuvent plus répondre : remplacez les identifiants du compte. » | OK | `account-alerts.tsx:45-49` |
| W17 | Compte `error`, motif `signature_rejected` | Signatures de webhook rejetées en série | Connexions | Bandeau avec conseil | OK | `account-alerts.tsx:50` |
| W18 | Compte `error`, motif `other` avec message précis stocké par le moteur (« Ce compte ne peut pas être raccordé. Contactez le support. », « Secret de l'app refusé », « Identifiant de compte introuvable… ») | Vérification refusée | Connexions, page de l'agent IA | « Le compte est en erreur. La vérification est reprise automatiquement ; si l'erreur persiste, contrôlez le compte chez le fournisseur. » Le motif réel n'est jamais montré, et pour l'app non conforme le compte ne revient jamais en `connected` | Défaut R-5 | `account-alerts.tsx:51`, `whatsapp-account-service.ts:341-366`, vue `WhatsAppAccountView` sans message (`contracts/src/whatsapp.ts:142-159`) |
| W19 | Alertes fournisseur (paiement, compte verrouillé, politique, mise à jour) | Événements Meta | Connexions | Bandeaux avec lien vers le gestionnaire WhatsApp | OK | `account-alerts.tsx:95-113` |
| W20 | Alerte `token_expiring` | Jeton qui expire sous 7 jours | Connexions | Bandeau avec nombre de jours | OK | `account-alerts.tsx:74` |
| W21 | Alerte `quality_degraded` | Qualité du numéro dégradée | Connexions | Bandeau nommant le numéro | OK | `account-alerts.tsx:88` |
| W22 | Échecs de remise par numéro (`delivery_failures`, `last_delivery_error_code`, spec §7.6) | Messages sortants refusés par Meta | Connexions, page de l'agent IA | Rien : ces champs ne sont lus par aucun écran | Défaut R-6 | `grep delivery_failures apps/web/src` : aucun résultat |
| W23 | Échec de lecture du webhook | Panne | Connexions | Message dans la boîte et « Réessayer » | OK | `account-webhook.tsx:60-72` |
| W24 | Échec de copie | Presse-papiers indisponible | Boîte webhook | « Copie impossible » | OK | `webhook-box.tsx:22-41` |
| W25 | Échec de lecture des comptes | Panne | Connexions | Page d'erreur avec Réessayer ; échec d'une relecture : bandeau « Impossible de relire les connexions… » avec Réessayer | OK | `connexions/page.tsx:72-77,92-104,125-132` |

### 2.5 Agents IA (statut, numéro, liste d'accès limité, création, simulateur, usage)

| # | Code, message moteur | Déclencheur | Écran | Ce que voit l'utilisateur | Verdict | Preuve |
|---|---|---|---|---|---|---|
| B1 | 409 `no_number`, `number_removed`, `account_not_connected`, `empty_allowlist`, `not_from_draft`, `invalid_transition` (`TRANSITION_MESSAGES`) | Changer de statut | Panneau Statut | Les actions impossibles sont prévues côté écran (bouton désactivé et raison sous la rangée) ; un refus du moteur s'affiche sous le panneau et la page se relit | OK | `status-panel.tsx:56-74,110-120`, `lib/bot-transitions.ts` |
| B2 | Pause automatique `number_removed` | Numéro retiré chez le fournisseur | Panneau Statut | Ligne rouge sous le statut | OK | `status-panel.tsx:86-88` |
| B3 | 409 « Ce numéro a changé depuis votre lecture : vérifiez la liste. » (`expected_bot_id`) | Numéro pris dans un autre onglet | Brancher (page de l'agent IA, Connexions), Débrancher, Activer | Message dans la fenêtre, liste relue, choix à refaire ; Débrancher passe en « Fermer » | OK | `assign-number-dialog.tsx:92-97`, `assign-bot-dialog.tsx:95-100`, `unassign-dialog.tsx` |
| B4 | 409 « Ce numéro a été retiré chez le fournisseur. » | Brancher un numéro retiré | Fenêtres de branchement, étape Activer | Message en place ; l'étape Activer ajoute le lien Connexions | OK | `step-activate.tsx:174-185` |
| B5 | 404 « Agent IA ou numéro WhatsApp introuvable. » | Numéro ou agent IA disparu | Idem | Message en place | OK | idem |
| B6 | 400 « Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu. » (`entries.<i>` / `allowlist.<i>`) | Entrée invalide | Liste d'accès limité (page de l'agent IA, étape Activer) | Message sous la ligne fautive | OK | `allowlist-panel.tsx:20-29,98-100`, `allowlist-editor.tsx:110` |
| B7 | 400 « 20 entrées au plus. » | Liste trop longue | Idem | Contrôle préalable (champ désactivé, « liste pleine ») | OK | `allowlist-editor.tsx:33-41` |
| B8 | 409 `empty_allowlist` à l'enregistrement d'une liste vide en accès limité | Vider la liste | Panneau Liste d'accès limité | Message moteur sous le panneau | OK | `allowlist-panel.tsx:100,127` |
| B9 | 400 `entity_id` « Choisissez une entité. » | Liste des entités illisible, champ Entité masqué | Assistant, étape 2 | « Création impossible. Vérifiez les champs. Réessayez. » : l'étape 1 qui porte le champ est derrière, et le champ n'existe pas à l'écran | Défaut R-2 | `wizard.tsx:61-64`, `step-identity.tsx:44-46`, `step-personality.tsx:76-77,160` |
| B10 | 400 `entity_id` « Entité introuvable ou archivée. » | Entité archivée pendant l'assistant ; Déplacer un agent IA | Assistant étape 2 ; fenêtre Déplacer | Assistant : texte générique (R-2) ; Déplacer : message en place (OK) | Défaut R-2 | idem, `move-agent-dialog.tsx:46,64` |
| B11 | 400 `system_prompt` « Aucune personnalité ni prompt pour la langue par défaut (fr). » | Deux langues, personnalité remplie seulement dans la langue non par défaut (le bouton est actif : il suffit d'une langue remplie) | Assistant, étape 2 | Texte générique ; « Réessayez » ne change rien | Défaut R-2 | `step-personality.tsx:82-85` vs `bot-service.ts:80-84` |
| B12 | 409 « bot_id déjà pris. » | Identifiant déjà utilisé | Assistant, étape 2 | Nouvel essai automatique avec un suffixe ; l'identifiant affiché change | OK | `step-personality.tsx:66-72` |
| B13 | 403 « Accès refusé. » | Rôle retiré pendant l'assistant | Assistant | Texte générique (R-2) | Défaut R-2 | idem |
| B14 | 404 « Agent IA introuvable. » | Agent IA d'une autre organisation ou inconnu | Page de l'agent IA, Usage | « Agent IA introuvable. » et lien vers la liste ; le rail affiche un nom vide et le statut « Brouillon » | OK, Défaut R-23 | `page-failure.tsx:41-49`, `agents/[botId]/layout.tsx:23-28` |
| B15 | Échec d'une des quatre lectures (agent IA, santé, métriques, usage) | Panne partielle | Page de l'agent IA | Toute la page devient « Quelque chose s'est mal passé » | Défaut R-17 | `agents/[botId]/page.tsx:39-43,92` |
| B16 | Échec de la lecture des conversations récentes | Panne | Page de l'agent IA | Silence : la liste s'affiche vide comme s'il n'y avait aucune conversation | Défaut R-17 | `agents/[botId]/page.tsx:44-46` |
| B17 | Échec du simulateur (LLM 500, 404, 403) | Envoi d'un message | Simulateur (étape 3, page de l'agent IA) | « Envoi impossible. Réessayez. » ; la bulle du message reste comme si elle était partie, le champ est vidé (texte à retaper) | Défaut R-9 | `simulate-chat.tsx:29-41` |
| B18 | Messages non servis (compteur) | Contact hors liste, agent IA en brouillon ou en pause | Panneau Statut | Nombre, date du dernier, conseil | OK | `status-panel.tsx:140-153` |
| B19 | Métriques ou usage d'un agent IA en échec dans les synthèses | Panne partielle | Liste des agents IA, Usage et coûts | Valeur 0 affichée comme vraie | Défaut R-3 | `app/api/bots/summary/route.ts:20-22`, `app/api/usage/summary/route.ts:21-23` |
| B20 | Nombre d'erreurs LLM | n/a : le moteur ne le fournit pas | Carte Coût, page Usage | « 0 erreur » écrit en dur (vérifié) | Défaut R-4 | `cost-card.tsx:42`, `usage-view.tsx:61` |
| B21 | Échec de lecture de l'usage | Panne | Usage de l'agent IA, Usage et coûts | Page d'erreur ou encadré « Une erreur est survenue. » avec Réessayer | OK (générique) | `usage/page.tsx:85-90` |
| B22 | Échec de lecture des numéros | Panne | Étapes Numéro et Activer, fenêtres Brancher | Message et Réessayer ; la raison du bouton désactivé est dite | OK | `step-number.tsx:93-107,156` |
| B23 | Échec de lecture des entités | Panne | Liste des agents IA, Usage, assistant | Silence : rail sans entités, assistant sans champ Entité (mène à B9) | Défaut R-18 | `(app)/page.tsx:68-75`, `usage/page.tsx:42-49`, `wizard.tsx:61-64` |
| B24 | Échec de lecture de la liste des agents IA | Panne | Accueil | Encadré « Une erreur est survenue. » et Réessayer ; jamais confondu avec la liste vide | OK (générique) | `(app)/page.tsx:52-66,98-110` |

**Total : 87 cas audités** (12 transversaux, 9 authentification, 17 organisation, 25 Connexions, 24 agents IA, auxquels s'ajoutent les 34 actions d'écriture de la section 3, comptées à part).

---

## 3. Actions d'écriture et retour de réussite

« Implicite » : l'état affiché change (ligne qui apparaît, badge, statut), sans message. Ce retour suffit quand le changement est sous les yeux de l'utilisateur ; il ne suffit pas quand la fenêtre se ferme sur un élément éloigné, quand l'élément disparaît, ou quand la relecture échoue.

| # | Action | Écran | Retour de réussite | Double envoi | Verdict | Preuve |
|---|---|---|---|---|---|---|
| 1 | Se connecter | Connexion | Redirection | Gardé | OK | `login-form.tsx:30,45-55` |
| 2 | Mot de passe oublié | Mot de passe oublié | Encadré vert « e-mail envoyé » | Gardé | OK | `forgot-password-form.tsx:58-62` |
| 3 | Nouveau mot de passe | Réinitialisation | Bandeau vert sur la page de connexion | Gardé | OK | `login/page.tsx:15-19` |
| 4 | Accepter une invitation (compte neuf) | Invitation | Accueil avec bandeau de bienvenue | Gardé | OK | `accept-invite-form.tsx:43-47` |
| 5 | Accepter une invitation (compte existant) | Invitation | Idem | Gardé | OK | `invitation-flow.tsx:151-155` |
| 6 | Changer le mot de passe | Sécurité | Message « Mot de passe modifié… » | Gardé | OK | `change-password-form.tsx:39-43` |
| 7 | Changer d'organisation | Sélecteur, Mon compte › Organisations | Rechargement ; en échec, rien | Non gardé | Défaut R-12 | `session-provider.tsx:176-190` |
| 8 | Se déconnecter | Menu | Redirection | Gardé (page sans organisation) | OK | `user-menu.tsx:23-30` |
| 9 | Créer une entité | Entités | Implicite (ligne ajoutée, compteur du rail) | Gardé | OK | `entites/page.tsx:85-92` |
| 10 | Renommer une entité | Entités | Implicite | Gardé | OK | `entites/page.tsx:94-100` |
| 11 | Archiver une entité | Fenêtre Archiver | Implicite : la ligne disparaît | Gardé | Défaut R-19 | `entites/page.tsx:102-108` |
| 12 | Réactiver une entité | Entités | Implicite | Non gardé | Défaut R-27 | `entites/page.tsx:110-118` |
| 13 | Déplacer un agent IA | Fenêtre Déplacer | Implicite : la fenêtre se ferme | Gardé | Défaut R-19 | `entites/page.tsx:120-126` |
| 14 | Inviter | Tiroir | Notification locale 6 s « Invitation envoyée à … » | Gardé | OK | `utilisateurs/page.tsx:103-110,254-258` |
| 15 | Renvoyer une invitation | Utilisateurs | Notification locale 6 s | Gardé | OK | `utilisateurs/page.tsx:138-152` |
| 16 | Révoquer une invitation | Menu de ligne | Implicite : la ligne disparaît ; ni confirmation ni garde | Non gardé | Défaut R-20 | `utilisateurs/page.tsx:154-163` |
| 17 | Modifier les accès | Tiroir | Implicite | Gardé | Défaut R-19 | `utilisateurs/page.tsx:112-116` |
| 18 | Suspendre | Fenêtre | Implicite | Gardé | Défaut R-19 | `utilisateurs/page.tsx:126-130` |
| 19 | Réactiver un membre | Ligne | Implicite | Non gardé | Défaut R-27 | `utilisateurs/page.tsx:132-136` |
| 20 | Raccorder un compte WhatsApp | Raccorder | Écran de résultat (numéros, webhook, suite) | Gardé | OK | `connect-result.tsx` |
| 21 | Renommer un compte | Fenêtre | Implicite | Gardé | OK | `rename-account-dialog.tsx:36` |
| 22 | Remplacer les identifiants | Fenêtre | « Identifiants remplacés, compte revérifié. », contrôles, inventaire | Gardé | OK | `replace-credentials-dialog.tsx:86-97` |
| 23 | Vérifier maintenant | Fenêtre | Issue et contrôles | Part à l'ouverture | OK | `account-run-dialog.tsx` |
| 24 | Rafraîchir les numéros | Fenêtre | Bilan d'inventaire | Part à l'ouverture | OK | idem |
| 25 | Déconnecter un compte | Fenêtre | Implicite : le compte passe dans le repli « déconnectés » fermé | Gardé | Défaut R-19 | `connexions/page.tsx:155-170` |
| 26 | Marquer ou démarquer un numéro de test | Fenêtre | Implicite (badge) | Gardé | OK | `test-flag-dialog.tsx` |
| 27 | Brancher un numéro (Connexions) | Fenêtre | Implicite (agent IA dans la ligne) | Gardé | OK | `assign-bot-dialog.tsx:90-93` |
| 28 | Débrancher | Fenêtre | Implicite | Gardé | OK | `unassign-dialog.tsx` |
| 29 | Créer l'agent IA (étape 2) | Assistant | Passage à l'étape 3 | Bouton désactivé | OK | `step-personality.tsx:53-80` |
| 30 | Activer (étape 5) | Assistant | Écran de confirmation, QR code, lien `wa.me` | Gardé | OK | `step-activate.tsx:187-214`, `success.tsx` |
| 31 | Changer le statut | Panneau Statut | Implicite (pastille) ; si la relecture échoue, bandeau « Impossible de relire cette page » sans dire que l'action a réussi | Gardé | Défaut R-19 | `status-panel.tsx:65-68`, `agents/[botId]/page.tsx:97-104` |
| 32 | Brancher ou changer le numéro (page de l'agent IA) | Fenêtre | Implicite ; même ambiguïté si la relecture échoue | Gardé | Défaut R-19 | `number-panel.tsx:41-44` |
| 33 | Enregistrer la liste d'accès limité | Panneau | « Liste enregistrée. » | Gardé | OK | `allowlist-panel.tsx:83-94,124` |
| 34 | Envoyer un message au simulateur | Simulateur | Réponse dans le fil | Gardé | OK (échec : R-9) | `simulate-chat.tsx` |

Constat : 3 façons différentes de dire « c'est fait » coexistent (message en place, notification locale de 6 s propre à la page Utilisateurs, changement implicite), sans règle. Il n'existe **aucun système de notifications commun** : ni composant, ni dépendance (`package.json` sans bibliothèque de type toast), ni région `aria-live` partagée.

---

## 4. Défauts classés

### Gravité haute (silence, perte d'information, message faux)

**R-1. Connexion : toute panne devient « Identifiants invalides. »**
- Scénario : moteur arrêté, base indisponible, erreur 500 ou réseau. Vérifié en navigateur (BFF 500, écran « Identifiants invalides. »).
- Écran : Connexion, et le formulaire de connexion intégré à la page d'invitation.
- Effet : l'utilisateur croit son mot de passe faux, le réinitialise, et le problème persiste.
- Correction : distinguer 401 (identifiants), 429 (tentatives), 5xx et réseau (« Connexion impossible pour le moment. Réessayez dans un instant. »). `login-form.tsx:56-59`. Ajouter le test 500 à `login-form.test.tsx` (seul le 401 est testé, ligne 40).

**R-2. Création d'un agent IA : tout refus devient « Création impossible. Vérifiez les champs. Réessayez. »**
- Scénarios : entité requise mais champ absent (liste des entités illisible), entité archivée entre-temps, personnalité remplie dans une langue qui n'est pas la langue par défaut (le bouton est actif, le moteur refuse « Aucune personnalité ni prompt pour la langue par défaut (fr). »), rôle retiré (403), panne (500).
- Écran : assistant, étape 2.
- Effet : le message précis du moteur est perdu ; « Vérifiez les champs » ne dit pas lequel, et le champ fautif peut être à l'étape 1 ou absent. « Réessayez » ne change rien.
- Correction : passer à `sendMutation` et afficher `failure.error` ; router `details[].path` vers le champ (`entity_id` : retour à l'étape 1 avec le champ affiché et en erreur ; `system_prompt` : onglet de la langue par défaut en erreur) ; aligner `canSubmit` sur la règle du moteur (la langue par défaut doit être remplie). `step-personality.tsx:53-80,82-85,160`.

**R-3. Synthèses : un échec de lecture est affiché comme un zéro**
- Scénario : la lecture des métriques ou de l'usage d'un agent IA échoue dans la boucle du BFF.
- Écrans : liste des agents IA (messages, leads), Usage et coûts (appels, tokens, coût, total de l'organisation).
- Effet : chiffres faux présentés comme vrais, total des coûts sous-évalué, sans aucun signe.
- Correction : renvoyer `null` (ou un drapeau `partial: true` et la liste des agents IA concernés) au lieu de 0 ; l'écran affiche « indisponible » sur la ligne et un avertissement « Total partiel ». `app/api/bots/summary/route.ts:20-22`, `app/api/usage/summary/route.ts:21-23`.

**R-4. « 0 erreur » écrit en dur**
- Scénario : toujours. Vérifié en navigateur sur `demo-1` (carte Coût et page Usage).
- Écrans : page de l'agent IA (carte Coût), Usage de l'agent IA (indicateur Appels LLM).
- Effet : affirmation fausse dès qu'un appel LLM échoue ; contraire à l'anti-objectif « un élément d'interface sans effet qui ne le dit pas ».
- Correction : retirer la mention tant que le moteur ne compte pas les erreurs, ou exposer ce compte dans `/usage` et l'afficher. `cost-card.tsx:42`, `usage-view.tsx:61`.

**R-5. Compte WhatsApp en erreur « autre » : motif perdu et conseil faux**
- Scénario : vérification refusée pour app non conforme (« Ce compte ne peut pas être raccordé. Contactez le support. »), secret de l'app refusé, WABA non partagée avec le jeton. Le moteur stocke ce message avec le compte, mais `WhatsAppAccountView` ne l'expose pas.
- Écrans : Connexions (bandeau du compte), page de l'agent IA (état du compte), étape Activer.
- Effet : l'admin lit « La vérification est reprise automatiquement ; si l'erreur persiste, contrôlez le compte chez le fournisseur. », alors que pour l'app non conforme le compte ne revient jamais en `connected` (`whatsapp-account-service.ts:341-366`). Il attend une reprise qui n'aura pas lieu, sans savoir quoi corriger.
- Correction : ajouter le message d'erreur (déjà neutre et sans donnée d'une autre organisation) à la vue du compte, l'afficher dans le bandeau ; conseil selon la cause (remplacer les identifiants, contacter le support), et ne promettre la reprise automatique que pour les pannes transitoires. `account-alerts.tsx:44-60`, `contracts/src/whatsapp.ts:142-159`. Un test du moteur doit vérifier que ce message ne nomme jamais une autre organisation.

**R-6. Échecs de remise jamais affichés**
- Scénario : Meta refuse des messages sortants (code d'erreur sur `statuses`). Le moteur compte `delivery_failures` et garde `last_delivery_error_code` par numéro (spec §7.6 : « l'état est visible dans Connexions et sur la page de l'agent IA »).
- Écrans : Connexions (tableau des numéros), page de l'agent IA (encart Numéro).
- Effet : l'agent IA semble répondre alors que les contacts ne reçoivent rien ; seul l'admin qui ouvre Meta le découvre.
- Correction : colonne ou pastille « N échecs de remise » avec le code traduit (table de codes Meta courants : 131047 fenêtre de 24 h, 131026 destinataire non joignable, paiement) et lien vers le gestionnaire WhatsApp ; reprise dans l'encart Numéro de la page de l'agent IA.

**R-8. Acceptation d'une invitation (compte existant) : tout échec devient « Invitation invalide ou expirée. »**
- Scénario : panne moteur, réseau, 429, erreur d'écriture.
- Écran : page d'invitation, utilisateur connecté.
- Effet : message faux ; l'utilisateur pense le lien mort et redemande une invitation.
- Correction : même tri que `accept-invite-form.tsx:50-52` (429, 5xx, 401). `invitation-flow.tsx:157-171`.

**R-10. Session expirée pendant une action : renvoi muet vers la connexion**
- Scénario : jeton de renouvellement expiré ou révoqué (changement de mot de passe dans un autre navigateur), puis clic sur une action.
- Écrans : tous.
- Effet : le message « Session expirée. » apparaît un instant dans la zone d'erreur, puis la page de connexion s'affiche sans explication ; la saisie en cours (formulaire d'assistant, identifiants à remplacer, liste d'accès) est perdue ; après reconnexion, retour à l'accueil.
- Correction : `onUnauthorized` redirige vers `/login?reason=session&next=<chemin>` ; la page de connexion affiche « Votre session a expiré. Reconnectez-vous pour continuer. » et renvoie vers `next` (chemin interne contrôlé). `session-provider.tsx:203`, `login/page.tsx`, `login-form.tsx:46-48`.

**R-11. Organisation changée dans un autre onglet : rechargement muet**
- Scénario : bascule d'organisation dans un autre onglet, puis action ou retour sur l'onglet.
- Écrans : tous.
- Effet : l'onglet revient à l'accueil d'une autre organisation sans dire pourquoi ; saisie perdue. C'est exactement le « on ne sait pas ce qui se passe » à éviter.
- Correction : `onOrgChanged` et la vérification au retour sur l'onglet passent par `storeNotice('changed')` avant `reloadHome`, avec un bandeau « Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant {org}. » `session-provider.tsx:151-174,201`.

**R-12. Changer d'organisation : échec silencieux**
- Scénario : organisation suspendue ou accès retiré entre l'affichage du sélecteur et le clic, panne.
- Écrans : sélecteur d'organisation, Mon compte › Organisations.
- Effet : le clic ne fait rien de visible (la session est relue, la liste se met à jour sans message) ; bouton sans effet.
- Correction : `switchOrg` renvoie le refus ; afficher « Impossible d'ouvrir {org} : {raison} » dans le sélecteur ou en notification ; garde de double clic. `session-provider.tsx:176-190`, `org-switcher.tsx:34`.

### Gravité moyenne (générique, mal placé, non actionnable, incohérent)

**R-7. Messages Zod par défaut, en anglais technique**
- Scénarios vérifiés : Renommer un compte (nom vide ou de plus de 80 caractères), Remplacer les identifiants (jeton, secret, productToken trop courts, UUID CM.com invalide).
- Effet : « String must contain at least 20 character(s) », « Invalid uuid » dans une interface française. Incohérence : l'écran Raccorder applique les mêmes règles avec des textes traduits (`connect-form.tsx:73-86`), Remplacer ne le fait pas.
- Correction : (a) donner un message français à chaque règle des contrats qui n'en a pas (`accountName`, `access_token`, `app_secret`, `account_id`, `product_token`, `name` de `CreateBotInput`, `message` de `SimulateInput`, `email`) ; (b) réutiliser la validation traduite de Raccorder dans Remplacer et Renommer ; (c) au BFF, ne jamais renvoyer un message Zod par défaut (carte d'erreurs Zod française dans `lib/proxy.ts`).

**R-9. Simulateur : message perdu en cas d'échec**
- Scénario : LLM indisponible (500), agent IA supprimé (404).
- Effet : la bulle « envoyée » reste dans le fil comme si elle était partie, le champ est vidé ; « Envoi impossible. Réessayez. » oblige à retaper le texte.
- Correction : marquer la bulle « non envoyé » avec « Renvoyer » (ou remettre le texte dans le champ) ; distinguer 404 (« Cet agent IA n'existe plus ») d'une panne. `simulate-chat.tsx:29-41`.

**R-13. Seule organisation suspendue : la page « Aucune organisation » ne le dit pas**
- Effet : « Si vous attendez une invitation, ouvrez le lien reçu par e-mail » alors que l'organisation existe et est suspendue.
- Correction : `/auth/me` porte le statut ; afficher « {org} est suspendue. Contactez l'administrateur de votre organisation ou le support. » `no-organization/page.tsx`, `session-provider.tsx:139-141`.

**R-14. Panne serveur : « Erreur interne. » au lieu du message prévu**
- Scénario : toute 500 sur une écriture passant par `sendMutation`.
- Effet : le texte contextuel prévu par chaque écran (« Changement de statut impossible. Réessayez. », « Action impossible. Réessayez. ») n'est jamais affiché pour une 500, car `errorMessage` préfère le message du corps. Aucun identifiant de requête n'est montré : impossible de relier la plainte d'un client au journal.
- Correction : pour `status >= 500` ou `status === 0`, utiliser le `fallback` de l'écran ; le BFF transmet `request_id` (le moteur le fournit, `api-response.ts:8` le perd) et l'interface l'affiche en petit (« Référence : … »). `lib/api-fetch.ts:95-101,166-169`.

**R-15. Messages du moteur en français dans l'interface anglaise**
- Scénario : tout refus métier affiché tel quel (statut, branchement, entités, invitations, raccordement).
- Correction : le moteur ajoute un identifiant stable par refus (`error.reason`, par exemple `transition.no_number`, `entity.duplicate_name`) ; le web traduit par clé et ne garde le texte du moteur qu'en repli. `TRANSITION_MESSAGES` est déjà dans les contrats : premier candidat.

**R-16. Échecs de chargement sans « Réessayer »**
- Écrans : Entités (« Impossible de charger les entités. »), Utilisateurs (« Impossible de charger les utilisateurs. »), Réglages (« Une erreur est survenue. », et cartes affichées sans mode coché, ce qui laisse croire à un réglage vide).
- Correction : même encadré que l'accueil ou Connexions (message, bouton Réessayer) ; masquer les cartes de Réglages tant que la lecture a échoué. `entites/page.tsx:166-168`, `utilisateurs/page.tsx:188-190`, `reglages/page.tsx:50-66`.

**R-17. Page de l'agent IA : une lecture en échec fait tomber toute la page, une autre se tait**
- Scénarios : l'usage ou les métriques échouent → page entière « Quelque chose s'est mal passé » (le statut, le numéro et la liste d'accès, lisibles, sont cachés) ; les conversations récentes échouent → liste vide présentée comme « aucune conversation ».
- Correction : erreur par panneau (« Coûts indisponibles », « Conversations indisponibles » avec Réessayer), la page ne tombe que si la lecture de l'agent IA échoue. `agents/[botId]/page.tsx:39-47`.

**R-18. Liste des entités illisible : silence**
- Écrans : rail de l'accueil et de Usage (pas de regroupement par entité), assistant (champ Entité absent, ce qui mène à R-2).
- Correction : dans l'assistant, bloquer l'étape 1 avec « Impossible de charger les entités » et Réessayer quand l'organisation en a peut-être plusieurs ; dans les rails, signal discret. `wizard.tsx:61-64`, `(app)/page.tsx:68-75`, `usage/page.tsx:42-49`.

**R-19. Réussites sans retour visible**
- Actions : Archiver une entité (la ligne disparaît), Déplacer un agent IA (fenêtre fermée, rien ne nomme le changement), Modifier les accès, Suspendre, Déconnecter un compte (le compte part dans un repli fermé), Changer le statut et Brancher un numéro quand la relecture qui suit échoue (le bandeau « Impossible de relire cette page » laisse croire à un échec de l'action).
- Correction : notification de réussite commune (section 5) ; après une écriture réussie suivie d'une relecture en échec, dire « Modification enregistrée. L'affichage n'a pas pu être actualisé. » `agents/[botId]/page.tsx:97-104`, `connexions/page.tsx:125-132`.

**R-20. Révoquer une invitation : ni confirmation, ni garde, faux échec**
- Scénario : clic sur Révoquer (action destructive, un e-mail a été envoyé) ; double clic.
- Effet : révocation immédiate sans confirmation ; au double clic, la seconde requête répond 404 « Invitation introuvable. » affichée comme une erreur alors que l'action a réussi ; aucune confirmation de réussite.
- Correction : fenêtre de confirmation (comme Suspendre), garde par identifiant (comme Renvoyer), notification « Invitation à {email} révoquée. » `utilisateurs/page.tsx:154-163`.

### Gravité basse (formulation, détails)

**R-21. Texte brut de Meta dans les contrôles.** « Meta : <message anglais de Graph> » (`meta-graph.ts:139`). Garder le texte brut en détail repliable et afficher une phrase traduite selon le contrôle.

**R-22. Fermer une fenêtre pendant un envoi perd le résultat.** `DialogFrame` ferme sur Échap même pendant l'envoi (`dialog-frame.tsx:15-17`) ; le refus éventuel n'est plus affiché. Le tiroir des accès, lui, refuse de se fermer pendant l'envoi (`access-drawer.tsx:104-107`) : aligner.

**R-23. Rail de l'agent IA faux en cas d'échec.** Nom vide et statut « Brouillon » affichés quand la lecture échoue (`agents/[botId]/layout.tsx:23-28`). Afficher un statut inconnu.

**R-24. Détails du BFF.** « Erreur engine. » (anglais, terme technique) en repli (`engine-client.ts:44`) ; corps illisible en 500 au lieu de 400 sur `api/bots`, `api/bots/[botId]`, `simulate` (`request.json()` hors `safeParse`).

**R-25. Libellé codé en dur.** `aria-label="Fermer"` du simulateur, non traduit (`simulate-panel.tsx:21`).

**R-26. Changer le mot de passe : incohérences.** 429 affiche le texte brut « Trop de requêtes. » au lieu de la clé `auth.rateLimited` ; 401 affiche « Session expirée. » sans renvoi vers la connexion (appel direct à `fetch`, hors `apiFetch`). `change-password-form.tsx:44-57`.

**R-27. Actions de ligne : erreur loin de la ligne, pas de garde.** Réactiver une entité, réactiver un membre, renvoyer une invitation déjà acceptée : erreur en haut de page, sans nommer la ligne ; Réactiver n'a pas de garde de double clic. `entites/page.tsx:110-118`, `utilisateurs/page.tsx:132-149`.

**R-28. « Ce compte ne peut pas être invité. »** Ni cause ni suite. Proposer « Cette adresse appartient à un compte de la plateforme : contactez le support. » (sans révéler plus que nécessaire).

**R-29. Bandeau d'organisation peu précis.** « Votre accès à cette organisation a changé. » ne dit ni l'organisation ni le nouveau rôle ; « Cette organisation est suspendue. » ne la nomme pas après rechargement sur une autre.

### Récapitulatif

| Gravité | Nombre | Défauts |
|---|---|---|
| Haute | 10 | R-1, R-2 (couvre B9 à B13), R-3, R-4, R-5, R-6, R-8, R-10, R-11, R-12 |
| Moyenne | 10 | R-7, R-9, R-13, R-14, R-15, R-16, R-17, R-18, R-19, R-20 |
| Basse | 9 | R-21 à R-29 |

Ordre de correction suggéré : R-1, R-2, R-8 (messages faux sur les parcours d'entrée), puis R-3, R-4 (chiffres faux), puis R-5, R-6 (états connus du moteur et invisibles), puis R-10, R-11, R-12 avec le système de notifications de la section 5, qui règle aussi R-19 et R-20.

---

## 5. Règle de restitution unique proposée

### 5.1 Où va chaque type d'erreur

| Type | Exemple | Emplacement | Contenu |
|---|---|---|---|
| Champ refusé (`details[].path` = un champ affiché) | Entrée de liste invalide, valeur masquée, nom en double | Sous le champ, `aria-invalid`, focus sur le premier champ fautif | Message traduit de la règle |
| Refus métier d'une action dans une fenêtre ou un tiroir | Dernier admin, numéro changé, compte en service | Dans la fenêtre, au-dessus des boutons ; la fenêtre reste ouverte | Message du moteur (traduit par clé), suivi de l'action à faire (lien, bouton) |
| Refus métier d'une action de ligne ou de panneau | Réactiver, changer de statut | Sous la ligne ou dans le panneau concerné, jamais en haut de page | Idem, en nommant l'élément |
| Champ absent de l'écran courant | `entity_id` refusé à l'étape 2 | Retour à l'écran qui porte le champ, champ en erreur | Idem |
| Échec de lecture d'une page | Liste illisible | À la place du contenu | « Impossible de charger … » et Réessayer |
| Échec de lecture d'un panneau | Coûts indisponibles | Dans le panneau | Idem, le reste de la page s'affiche |
| Échec d'une relecture après réussite | Relecture de la page | Bandeau de page | « Modification enregistrée. L'affichage n'a pas pu être actualisé. » et Réessayer |
| Panne serveur ou réseau sur une écriture | 500, 502, réseau | À l'endroit de l'action | Texte contextuel de l'écran (« Enregistrement impossible pour le moment. Réessayez. ») et référence de requête |
| Événement de session ou d'organisation | Session expirée, organisation changée, suspendue | Bandeau persistant en haut de page (ou de la page de connexion) | Ce qui s'est passé, ce que l'onglet affiche désormais, quoi faire |
| État durable d'un objet | Compte en erreur, jeton qui expire, échecs de remise, messages non servis | Bandeau ou pastille sur l'objet, repris là où l'objet est utilisé (page de l'agent IA) | Cause précise, conséquence, action |
| Chiffre inconnu | Usage d'un agent IA illisible | À la place du chiffre | « indisponible », jamais 0 ; total marqué partiel |

### 5.2 Quand utiliser une notification

- **Oui** pour confirmer une écriture réussie dont l'effet n'est pas sous les yeux : la fenêtre se ferme, l'élément disparaît ou change de section (archiver, révoquer, déconnecter, déplacer, inviter, suspendre).
- **Oui** pour une erreur d'une action déclenchée hors de toute fenêtre et sans emplacement naturel (changement d'organisation depuis le sélecteur).
- **Non** pour une erreur qui a un emplacement (champ, fenêtre, panneau) : la notification disparaît, l'erreur doit rester tant qu'elle vaut.
- **Non** pour un état durable (compte en erreur) : bandeau sur l'objet.
- Réussite : notification `role="status"`, 5 s, texte qui nomme l'objet (« Entité Nord archivée. ») ; erreur en notification : `role="alert"`, persistante jusqu'à fermeture.
- Une seule région `aria-live` pour toute l'application.

### 5.3 Comment signaler une réussite

1. L'état affiché change (toujours).
2. Si la fenêtre se ferme ou si l'élément sort de la vue : notification de réussite qui nomme l'objet.
3. Si l'action reste dans une fenêtre de résultat (raccorder, remplacer, vérifier) : le résultat en titre de la fenêtre, comme aujourd'hui.
4. Si la relecture qui suit échoue : le dire sans laisser croire à un échec de l'action (section 5.1).

### 5.4 Ce qu'il manque pour l'appliquer

| Manque | Proposition |
|---|---|
| Système de notifications | `NotificationProvider` monté dans `(app)/layout.tsx`, hook `useNotify()` (`success`, `error`), région `aria-live` unique ; remplace la notification locale de `utilisateurs/page.tsx:254-258`. Aucune dépendance nécessaire. |
| Lecture uniforme d'un refus | Une seule fonction `describeFailure(failure, context)` dans `lib/` : tri 401 / 403 / 404 / 409 / 422 / 429 / 5xx / réseau, choix entre message du moteur et texte contextuel, répartition des `details` par champ. Tous les écrans (dont login, invitation, assistant, simulateur, changement de mot de passe) passent par `sendMutation` et cette fonction. |
| Composants d'erreur | `FieldError` (sous un champ, relié par `aria-describedby`), `InlineError` (fenêtre, panneau), `LoadError` (message et Réessayer), `PartialValue` (« indisponible »). Aujourd'hui chaque écran recode ses classes et ses rôles. |
| Identifiants de refus stables | Côté moteur et contrats : `error.reason` (clé) en plus du texte, pour traduire en anglais et tester sans dépendre du libellé (R-15). |
| Messages français dans les contrats | Message explicite pour chaque règle Zod exposée à un écran, et carte d'erreurs Zod française au BFF (R-7). |
| Référence de requête | Le BFF relaie `request_id` ; `InlineError` l'affiche pour les 5xx (R-14). |
| Message de session | `/login?reason=session&next=…` et bandeau `orgNotice.changed` (R-10, R-11). |
| Exposition des états d'erreur | `WhatsAppAccountView.error_message`, échecs de remise par numéro affichés (R-5, R-6). |
| Garde-fou de test | Un test par écran d'écriture : refus 409 du moteur affiché tel quel, 500 affiché avec le texte contextuel, réseau idem. Un test qui casse si un message Zod par défaut (« String must », « Invalid ») atteint une réponse du BFF. |
