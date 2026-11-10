# Plan du lot « Restitution des erreurs et vocabulaire »

> **Pour les agents d'exécution :** sous-skill requise : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** que chaque règle et chaque refus du moteur arrivent à l'écran au bon endroit, vrais, compréhensibles et actionnables, que chaque écriture réussie se voie, que les libellés disent ce que fait l'action, et qu'aucun journal du moteur ne porte de secret ni de donnée personnelle.

**Architecture :** le moteur ajoute à chaque refus affiché à l'écran une clé stable (`error.reason`) en plus de son texte français, et expose deux états qu'il connaît déjà (motif précis d'un compte en erreur, organisations suspendues d'un membre). Le BFF ne renvoie plus jamais de message Zod par défaut, relaie la référence de requête et ne transforme plus un échec de lecture en zéro. Le web gagne un socle commun : une seule fonction de lecture des refus (`describeFailure`), quatre composants d'erreur, un système de notifications sans dépendance et un bouton d'actions visible ; chaque écran est ensuite branché sur ce socle. Une règle du moteur change (liste d'accès limité vide enregistrable), avec amendement de la spec 2b.

**Tech :** moteur Express et TypeScript (SQLite et Postgres), Next.js App Router, React, next-intl, Tailwind (jetons de la charte Émeraude·Menthe), Vitest et Testing Library, Playwright avec le moteur simulé `apps/web/e2e/mock-engine.ts`, contrats `@wabagent/contracts`.

**Entrées (font autorité) :**
- `docs/superpowers/research/2026-11-09-audit-restitution-erreurs.md` : matrice §2 (87 cas), actions d'écriture §3, défauts R-1 à R-29 §4, règle de restitution §5 (validée telle quelle par François le 9 nov. 2026). L'exécutant lit la section de chaque défaut qu'il traite et la règle §5 avant chaque tâche web.
- Retours de recette du lot 2b-3 (9 nov. 2026), recopiés ci-dessous (Q-1 à Q-14), car ils ne sont consignés nulle part ailleurs dans le dépôt.
- Spec 2b `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` §2 (anti-objectifs), §7.6, §8.1, §8.3 ; amendée par la tâche 2.

## Retours de recette du 2b-3 (entrées du lot)

- **Q-1** Libellés de statut : « Revenir en brouillon » est incompréhensible ; parler d'activer et de désactiver ; revoir tous les libellés de statut et d'action.
- **Q-2** Coûts en dollars : afficher l'équivalent en euros, dire pourquoi la valeur source est en dollars (tarifs Anthropic), format de nombre français (virgule).
- **Q-3** Carte des coûts : barres pleines à 0,00 $ ; « 0 erreur » en dur (R-4).
- **Q-4** Rail de l'agent IA : l'entrée « Connexions · À venir » se confond avec Organisation › Connexions ; aucun lien vers Organisation depuis la page d'un agent IA.
- **Q-5** « Déconnecter » (compte WhatsApp) confondu avec « Se déconnecter » (session) : François s'est déconnecté de l'application en voulant retirer le compte.
- **Q-6** Le bouton ⋯ d'un compte ne se voit pas.
- **Q-7** Tous les menus ⋯ (comptes, numéros, lignes d'Utilisateurs et d'Entités) sont invisibles.
- **Q-8** Après la déconnexion d'un compte, la page relit encore `GET /whatsapp-accounts/:id/webhook` (le moteur répond un webhook vide) : ne plus la lire pour un compte déconnecté.
- **Q-9** Le moteur journalise la réponse brute de Meta avec le numéro du contact (`[MetaCloud] Sent OK ... wa_id`).
- **Q-10** Décision de François : en accès limité, retirer le dernier numéro de la liste doit être possible ; liste vide enregistrable, l'agent IA ne répond alors à personne ; encart qui le dit avec les actions (ajouter, ouvrir à tous, désactiver) ; activer en accès limité exige toujours au moins un numéro.
- **Q-11** Le moteur journalise le contenu des réponses de l'agent IA (« [Bot] Reponse non-JSON de Claude: <texte> », prénom du contact compris). Constat du rédacteur : le format JSON attendu sert aux messages riches de WhatsApp (boutons, listes) et la consigne composée par l'assistant n'en parle jamais ; une réponse en texte simple est donc le cas normal pour tout agent IA créé par l'assistant, et elle est bien envoyée.
- **Q-12** Assistant, étape 2, « Informations à collecter » : un champ ne s'ajoute qu'avec la touche Entrée ; un texte tapé sans Entrée est perdu en silence à « Créer & tester » (constaté en base : `lead_fields` vide).
- **Q-13** Les informations collectées ne sont visibles nulle part et aucune correspondance vers le CRM n'est réglable : le dire à l'écran tant que c'est le cas.
- **Q-14** Loader global : vérifier la visibilité de la pastille `#1C3814` en thème sombre.

Hors lot (consigné pour mémoire) : formulations de l'agent IA et cadre de style commun (chantier Personnalité et contenu) ; Conversations & Leads ; chantier S.

## Choix à trancher par François

Chaque choix est expliqué d'abord par ce que l'utilisateur verra. La recommandation est appliquée dans les tâches ; un autre choix change seulement la tâche citée.

**C-1. Vocabulaire des statuts d'un agent IA (Q-1, tâche 11).** Aujourd'hui l'écran propose « Revenir en brouillon » et « Mettre en pause », deux façons d'arrêter un agent IA dont la différence est invisible : depuis « pause », on peut rouvrir à tous directement ; depuis « brouillon », il faut repasser par l'accès limité (sauf numéro de test).
- **Option A (recommandée) : une seule façon d'arrêter.** Pastilles : « Brouillon » (créé, jamais activé), « Accès limité », « Ouvert à tous », « Désactivé ». Actions : « Activer en accès limité », « Ouvrir à tous », « Désactiver », et depuis Désactivé « Réactiver en accès limité » ou « Réactiver pour tous ». « Désactiver » fait passer en pause dans le moteur ; « Revenir en brouillon » disparaît de l'écran (le moteur garde la transition, sans bouton). Pause automatique : « Désactivé : son numéro a été retiré chez le fournisseur ».
- Option B : garder deux arrêts, renommés « Mettre en pause » (reprise directe) et « Désactiver » (retour au brouillon), chacun avec une phrase d'explication. Plus fidèle au moteur, mais l'utilisateur doit comprendre une nuance qui ne lui sert pas.
- Même choix pour le compte WhatsApp (Q-5) : « Déconnecter » devient **« Retirer de WABAGENT »** (fenêtre « Retirer {compte} de WABAGENT ? », section « Comptes retirés »). « Se déconnecter » (session) ne change pas.

**C-2. Monnaie des coûts (Q-2, tâche 14).** Anthropic facture en dollars ; le moteur calcule en dollars.
- **Option A (recommandée) : dollars exacts et équivalent en euros à taux fixe réglé par la plateforme.** Affichage du type « 1,23 $ (≈ 1,06 €) » et une note « Anthropic facture en dollars ; équivalent en euros au taux de {taux} du {date}. » (valeurs d'exemple : le taux réel est saisi par la plateforme). Taux et date dans deux variables d'environnement du back-office (`USD_EUR_RATE`, `USD_EUR_RATE_DATE`) ; sans taux, dollars seuls avec la note. Aucun appel externe.
- Option B : taux automatique du jour (BCE). Plus juste, mais ajoute une dépendance réseau et un cas d'échec à restituer.
- Option C : euros seuls. Plus simple à lire, mais le montant ne correspond plus à la facture Anthropic.

**C-3. Menus d'actions invisibles (Q-6, Q-7, tâches 6, 9, 10).**
- **Option A (recommandée) : bouton contour libellé « Gérer ▾ »** à la place de chaque ⋯ (comptes, numéros, membres, invitations, entités), et l'action principale d'une ligne en bouton direct quand il y en a une (« Brancher » sur un numéro libre, « Renvoyer » sur une invitation en attente).
- Option B : toutes les actions affichées en boutons sur chaque ligne. Plus direct, mais lignes surchargées (jusqu'à 5 actions par compte).

**C-4. Liste d'accès limité vide (Q-10, tâche 2).** Décision prise par François ; un cas restait ouvert : un agent IA en accès limité avec liste vide qui **change de numéro**. Recommandé : permis (son statut ne change pas, il ne répond toujours à personne). Toute **entrée** en accès limité (depuis Brouillon ou Désactivé, et l'activation de l'assistant) exige au moins un numéro.

**C-5. Messages du moteur dans l'interface anglaise (R-15, tâches 1 et 6).**
- **Option A (recommandée) : clé stable pour chaque refus qui a un écran aujourd'hui** (environ 45, listés par la tâche 1), traduite en français et en anglais par le web ; les autres refus gardent le texte français du moteur.
- Option B : reporter ; l'interface anglaise continue d'afficher des refus en français.

**C-6. Liens d'invitation et de réinitialisation écrits dans les journaux (tâche 4).** Aujourd'hui c'est le seul moyen de recevoir une invitation (aucun envoi d'e-mail), et la recette en dépend.
- **Option A (recommandée) :** le lien reste écrit hors production ; avec `NODE_ENV=production`, le lien n'est jamais écrit (seulement « invitation créée, envoi d'e-mail non configuré » et l'adresse masquée), et le moteur avertit au démarrage qu'aucun envoi d'e-mail n'est configuré.
- Option B : ne plus jamais écrire le lien et afficher le lien d'invitation à l'admin qui invite, dans le tiroir. Utile tant qu'il n'y a pas d'e-mail, mais crée un écran à protéger (le lien vaut accès).

**C-7. Réponses « non JSON » (Q-11, tâche 4).** **Recommandé :** une réponse en texte simple est le cas normal ; elle n'est plus signalée comme une anomalie et rien de son contenu n'est journalisé. Offrir les boutons et listes WhatsApp aux agents IA de l'assistant revient au chantier Personnalité et contenu.

**C-8. « 0 erreur » des coûts (R-4, tâche 14).** **Recommandé :** retirer la mention, le moteur ne compte pas les appels LLM en échec. Compter ces échecs (utile pour l'admin) est un ajout du moteur, à faire avec Conversations & Leads.

## Choix du rédacteur (à confirmer)

1. Une seule branche `feat/restitution-erreurs`, ordre des tâches imposé : moteur (1 à 4), BFF (5), socle web (6), écrans (7 à 14), mineurs (15), parcours (16), revues (17, 18).
2. Notifications maison, sans dépendance (audit §5.4) : `role="status"` 5 s pour une réussite, `role="alert"` persistante jusqu'à fermeture pour une erreur sans emplacement, une seule région `aria-live`.
3. Session expirée (R-10) : retour à la page quittée après reconnexion ; la saisie en cours n'est pas sauvegardée (le bandeau le dit : « Votre session a expiré. Reconnectez-vous pour reprendre là où vous étiez. Ce qui n'était pas enregistré est perdu. »).
4. Rail de l'agent IA (Q-4) : l'entrée « Connexions · À venir » devient « CRM · À venir » ; un bloc bas de rail « Organisation » (admins seulement) mène à Organisation › Connexions avec le texte « Numéros WhatsApp de l'organisation ».
5. Échecs de remise (R-6) : table de codes Meta traduits limitée à 131047 (fenêtre de 24 h dépassée), 131026 (destinataire non joignable), 131042 (problème de paiement du compte), 131056 (trop de messages vers ce contact), 130472 (contact dans une expérience Meta), significations à vérifier par l'exécutant dans la documentation Meta des codes d'erreur avant de les écrire ; tout autre code : « Code Meta {code} » et lien vers le gestionnaire WhatsApp.
6. Le texte brut de Meta (R-21) reste visible dans un détail repliable « Message de Meta (en anglais) ».

## Contraintes globales

- TypeScript strict, pas de `any`, `const` par défaut.
- Journaux : format `[Service] message`, sans emoji. Jamais de jeton, secret, clé d'URL, lien d'invitation (en production), contenu de message, nom ou prénom de contact, numéro de contact en clair, adresse e-mail en clair, ni objet d'erreur entier dans un journal ; contrôlé par `npm run check:logs` (tâche 4).
- Aucun tiret cadratin ni demi-cadratin, nulle part. Textes français avec accents. FR et EN ont exactement les mêmes clés (`apps/web/src/i18n/__tests__/messages-style.test.ts`) ; « agent IA » / « AI agent », jamais « agent » seul.
- Commits : 1 commit = 1 sujet, message en français `type(portée): résumé` puis corps factuel ; auteur `Francois Greze <francois@cyran.fr>` ; aucune signature Claude ou Anthropic ; aucun push sans accord explicite de François.
- Aucune référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition).
- Charte au pixel : jetons de `tailwind.config.ts` seulement, aucun dégradé, aucune couleur codée en dur (les couleurs du loader, données par François, sont l'exception déjà en place).
- Appels côté client : `apiFetch` / `sendMutation` ; après chaque réponse, `if (await isOrgChanged(res)) return;`. Routes BFF : `proxyEngine`, `rejectNonNumericId`, schéma des contrats pour tout corps.
- Règle de restitution : audit §5.1 (où va chaque type d'erreur), §5.2 (quand notifier), §5.3 (réussite). Un refus qui a un emplacement (champ, fenêtre, panneau, ligne) n'est jamais en notification ; un chiffre inconnu n'est jamais 0.
- Le web n'invente aucune règle : un contrôle fait côté web ne remplace jamais celui du moteur, et le refus du moteur reste affiché s'il survient.
- Aucun élément d'interface sans effet qui ne le dit pas.
- Tests : HTTP du moteur avec `request(await serve(app))` ; base avec `createTestDatabase()` ; un test qui protège un défaut de l'audit porte en commentaire son numéro (`// audit R-5`), un retour de recette le sien (`// recette Q-10`).
- Chaque tâche finit avec les commandes de sa portée : moteur `npm test`, `npm run typecheck`, `npm run typecheck:tests`, `npm run check:tests` ; Postgres `npm run test:pg` dès qu'un pilote change ; web `npm test -w @wabagent/web` et `npx tsc --noEmit` dans `apps/web`.

## Impact multi-organisation

| Changement | Ce qui pourrait fuir ou mal répondre | Test qui l'empêche (tâche) |
|---|---|---|
| Motif d'erreur d'un compte exposé (`error_detail`) | Un message qui nomme une autre organisation ou son compte (cas « app Meta tenue ailleurs ») | Le motif enregistré pour `meta_app_taken` et `provider_account_taken` est le texte neutre `CANNOT_CONNECT` ; la vue d'un compte de l'organisation A ne contient aucun nom, identifiant ni WABA de B (3) ; suite d'isolation SQLite et Postgres |
| Organisations suspendues dans `/auth/me` | Un membre voit une organisation dont il n'est pas membre actif, ou en obtient l'accès | Seules les organisations où l'utilisateur a une appartenance active apparaissent ; une organisation suspendue n'est jamais ouvrable (`isOpenable`) ; toute route d'administration reste 403 (3) |
| Liste d'accès limité vide permise | Un agent IA en accès limité à liste vide qui répond à quelqu'un | Message entrant d'un contact quelconque vers un agent IA `limited` à liste vide : aucune réponse, aucun appel LLM, aucune session, compteur des messages non servis incrémenté, sur les deux moteurs (2) |
| Clés de refus (`reason`) | Une clé qui révèle l'existence d'un objet d'une autre organisation (par exemple « numéro tenu ailleurs ») | Les refus 404 « introuvable » et « tenu ailleurs » gardent leur texte et leur clé uniques quelle que soit l'organisation détentrice (1) |
| Référence de requête affichée | Aucune donnée : identifiant aléatoire par requête | Néant |
| Journaux | Donnée d'un contact (organisation A) lisible par l'exploitant | `check:logs` et tests des journaux masqués (4) |

## Points d'attention de la revue (non couverts par l'audit, tests ajoutés aux tâches)

1. Session expirée avec un `next` hostile (`next=https://evil.example`, `next=//evil.example`, `next=/api/...`) : la page de connexion renvoie à l'accueil, jamais hors du back-office ni vers une route BFF. Test ajouté à la tâche 7.
2. Refus du moteur sans `reason` connu du web (moteur plus récent que le web) : l'écran affiche le texte du moteur en français, et en anglais le texte contextuel de l'écran, jamais une clé brute. Test ajouté à la tâche 6.
3. Liste d'accès limité vidée puis agent IA désactivé et réactivé en accès limité : la réactivation est refusée (`empty_allowlist`) avec le message et l'action « Ajouter un numéro ». Test ajouté à la tâche 11.
4. Taux de change absent, nul, négatif ou illisible (`USD_EUR_RATE=abc`) : dollars seuls et note, jamais « NaN € » ni « 0,00 € ». Test ajouté à la tâche 14.
5. Notification affichée puis changement de page : la notification de réussite reste lisible sur la page d'arrivée pendant ses 5 s (archiver une entité puis ouvrir une autre page), et une erreur persistante ne survit pas au changement d'organisation. Test ajouté à la tâche 6.

---

## Carte des fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `packages/contracts/src/errors.ts` | `ERROR_REASONS`, `reason` dans `ApiErrorBody` | 1 |
| `packages/contracts/src/{whatsapp,bots,accounts,auth}.ts` | messages français des règles Zod, `error_detail` | 1, 3 |
| `packages/contracts/src/bot-status.ts` | entrée en accès limité, messages au nouveau vocabulaire | 1, 2 |
| `src/api/errors.ts`, `src/core/services/*.ts`, `src/core/auth/*.ts` | clé de chaque refus affiché | 1 |
| `src/core/database/whatsapp-{sqlite,postgres}.ts` | liste vide enregistrable | 2 |
| `src/core/auth/auth-service.ts` | organisations suspendues dans `me()` | 3 |
| `src/core/phone.ts`, `src/core/auth/mailer.ts`, `src/transport/*.ts`, `src/core/handler.ts`, `src/connectors/*.ts`, `scripts/check-logs.ts` | journaux masqués et garde | 4 |
| `apps/web/src/lib/{proxy,engine-client,api-response,zod-fr}.ts`, `app/api/{bots,usage}/**` | BFF | 5 |
| `apps/web/src/lib/{api-fetch,describe-failure}.ts`, `components/feedback/*` (nouveau) | socle web | 6 |
| `apps/web/src/components/auth/*`, `app/[locale]/login/page.tsx`, `components/account/change-password-form.tsx` | authentification | 7 |
| `apps/web/src/components/providers/session-provider.tsx`, `components/shell/*`, `app/[locale]/no-organization/page.tsx` | session et organisation | 8 |
| `apps/web/src/app/[locale]/(app)/organisation/{entites,utilisateurs,reglages}/page.tsx`, `components/organisation/*` | pages Organisation | 9 |
| `apps/web/src/components/connections/*`, `organisation/connexions/page.tsx` | Connexions | 10 |
| `apps/web/src/lib/bot-transitions.ts`, `components/agent/{status-panel,allowlist-panel}.tsx`, `agents/[botId]/layout.tsx` | statuts et liste d'accès limité | 11 |
| `apps/web/src/components/wizard/*` | assistant | 12 |
| `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx`, `components/agent/*` | page de l'agent IA | 13 |
| `apps/web/src/lib/money.ts` (nouveau), `components/agent/{cost-card,usage-view}.tsx`, `components/usage/*`, `components/ui/bar-chart.tsx`, `src/i18n/request.ts` | chiffres et formats | 14 |
| `apps/web/e2e/*.spec.ts`, `e2e/mock-engine.ts` | parcours | 6 à 16 |
| `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` | amendement et état | 2, 18 |

---

### Tâche 1 : moteur et contrats, clés de refus et messages français des règles

**Fichiers :**
- Modifier : `packages/contracts/src/errors.ts`, `packages/contracts/src/{whatsapp,bots,accounts,auth}.ts`, `packages/contracts/src/bot-status.ts` (textes seulement), `src/api/errors.ts`, les services et la couche d'accès qui lèvent un refus affiché (`src/core/services/*-service.ts`, `src/core/auth/{access-service,auth-service,user-admin-service}.ts`).
- Tests : `packages/contracts/src/__tests__/zod-messages.test.ts` (nouveau), `packages/contracts/src/__tests__/error-reasons.test.ts` (nouveau), tests de service existants complétés.

**Interfaces :**
- Produit (contrats) : `export const ERROR_REASONS = [...] as const; export type ErrorReason = (typeof ERROR_REASONS)[number];` ; `ApiErrorBody.error.reason?: ErrorReason`.
- Produit (moteur) : `new AppError(code, message, details?, reason?)` et `conflict(m, reason?)`, `notFound(m, reason?)`, `forbidden(m, reason?)`, `validationError(details, m, reason?)` ; `toErrorBody` écrit `reason` s'il est présent.
- Nommage des clés : `<domaine>.<cas>` en snake_case, domaines `transition`, `assign`, `allowlist`, `whatsapp_account`, `entity`, `member`, `invitation`, `bot`, `auth`, `session`. Exemples imposés : `transition.no_number` (et une clé par `TransitionRefusal`), `assign.holder_changed`, `assign.number_removed`, `whatsapp_account.already_connected`, `whatsapp_account.cannot_connect`, `whatsapp_account.in_use`, `whatsapp_account.disconnected`, `entity.duplicate_name`, `entity.last_active`, `entity.in_use`, `member.last_admin`, `member.already_member`, `invitation.not_invitable`, `invitation.already_accepted`, `invitation.not_found`, `bot.default_language_missing`, `bot.entity_required`.
- Liste complète : un refus 4xx métier par ligne de la matrice de l'audit §2.2 à §2.5 qui a un écran (U1 à U7, N1 à N5, W1 à W13, B1 à B12, A1, A2, A4, A7) ; l'exécutant la recopie dans le rapport de tâche avec, pour chaque clé, le texte français du moteur.

- [ ] **Étape 1 : test des messages Zod** `zod-messages.test.ts` : pour chaque schéma exposé à un écran (`CreateWhatsAppAccountInput`, `RenameWhatsAppAccountInput`, `ReplaceWhatsAppCredentialsInput`, `CreateBotInput`, `SimulateInput`, `InviteInput` ou l'équivalent qui porte `email`, `SetAllowlistInput`), des valeurs fautives (vide, trop court, trop long, UUID invalide, e-mail invalide) donnent des messages qui ne contiennent ni « String must », ni « Invalid », ni « Expected », ni « Required » ; valeurs exactes : nom vide « Le nom est requis. », nom de plus de 80 caractères « Le nom fait 80 caractères au plus. », jeton Meta court « Le jeton d'accès semble incomplet : collez-le en entier. », secret court « Le secret de l'app semble incomplet : collez-le en entier. », UUID CM.com « Identifiant de compte CM.com invalide. », e-mail « Adresse e-mail invalide. », message du simulateur vide « Écrivez un message. » (`// audit R-7`).
- [ ] **Étape 2 : test des clés** `error-reasons.test.ts` : `ERROR_REASONS` sans doublon, chaque clé de la forme `^[a-z_]+\.[a-z_]+$`, chaque `TransitionRefusal` a sa clé `transition.<refus>`.
- [ ] **Étape 3 : tests de service** : pour un refus par domaine (au moins `member.last_admin`, `entity.duplicate_name`, `whatsapp_account.in_use`, `transition.empty_allowlist`, `assign.holder_changed`, `bot.default_language_missing`), la réponse HTTP porte `error.reason` et le texte inchangé. Refus 404 d'un numéro d'une autre organisation et d'un numéro inexistant : même `reason`, même texte (isolation).
- [ ] **Étape 4 : vérifier l'échec**, puis écrire les messages dans les contrats, les clés dans les contrats et chaque `throw` concerné.
- [ ] **Étape 5 : textes du moteur au vocabulaire de C-1** : `whatsapp-account-service` (« Désactivez d'abord les agents IA qui utilisent ce compte : » suivi des noms, au lieu de « Mettez d'abord en pause ou en brouillon »), `HOLDER_CHANGED_MESSAGE` inchangé (le texte propre à Débrancher est traité côté web, tâche 15).
- [ ] **Étape 6 : vérifier** : `npm test`, `npm run typecheck`, `npm run typecheck:tests`, `npm test -w @wabagent/web` (les tests web qui comparent un texte du moteur restent verts).
- [ ] **Étape 7 : commit** `feat(moteur): clé stable des refus et messages français des règles des contrats`.

### Tâche 2 : moteur, liste d'accès limité vide enregistrable (Q-10)

**Fichiers :**
- Modifier : `packages/contracts/src/bot-status.ts` (`decideTransition`), `src/core/database/whatsapp-sqlite.ts:586`, `src/core/database/whatsapp-postgres.ts:635`, `src/core/database/whatsapp-types.ts:131-135`, `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` §8.1 et §8.3.
- Tests : `packages/contracts/src/__tests__/bot-status.test.ts`, tests des pilotes WhatsApp, `src/__tests__/isolation/` (nouveau cas).

**Interfaces :**
- `decideTransition(to, f)` : vers `limited`, refus `empty_allowlist` seulement si `f.from !== 'limited'` et `f.allowlistCount === 0` (choix C-4 : un agent IA qui reste en accès limité, par un changement de numéro, n'est pas refusé).
- `setAllowlist` : le refus `empty_allowlist` disparaît du type de résultat ; il reste `not_found`.

- [ ] **Étape 1 : tests** : `decideTransition('limited', { from: 'limited', allowlistCount: 0, ... })` accepté ; depuis `draft` et `paused` avec 0 entrée refusé `empty_allowlist` ; `decideAssign` d'un agent IA `limited` à liste vide sur un autre numéro accepté ; `activateWithNumber` en `limited` sans liste toujours refusé ; enregistrer une liste vide sur un agent IA `limited` : 200, statut inchangé (`// recette Q-10`), SQLite et Postgres.
- [ ] **Étape 2 : test d'isolation et de routage** dans `src/__tests__/isolation/` : agent IA `limited` à liste vide de l'organisation A, message entrant d'un contact quelconque, et d'un contact présent dans la liste d'un agent IA de B : aucune réponse, aucun appel LLM, aucune session, compteur des messages non servis de l'agent IA de A incrémenté, rien chez B.
- [ ] **Étape 3 : vérifier l'échec, implémenter, vérifier** : `npm test`, `npm run test:pg`.
- [ ] **Étape 4 : amender la spec** §8.1, ligne `limited` : « numéro branché, compte `connected`, liste d'accès limité non vide pour y entrer ; un agent IA déjà en accès limité peut vider sa liste, il ne répond alors à personne (amendement du 9 nov. 2026, décision de François) » ; §8.3 : ajouter « la liste peut être vide en accès limité ».
- [ ] **Étape 5 : commit** `feat(moteur): liste d'accès limité vide enregistrable, entrée en accès limité inchangée`.

### Tâche 3 : moteur, états connus exposés (R-5, R-13)

**Fichiers :**
- Modifier : `packages/contracts/src/whatsapp.ts` (`WhatsAppAccountView`), la construction de la vue dans `src/core/services/whatsapp-account-service.ts`, `src/core/auth/auth-service.ts:141-165`, `packages/contracts/src/auth.ts` si `OrganizationSummary` y vit (sinon le type moteur de `MeResult`).
- Tests : `src/core/services/__tests__/whatsapp-account-service*.test.ts`, `src/core/auth/__tests__/auth-service*.test.ts`, `src/__tests__/isolation/`.

**Interfaces :**
- `WhatsAppAccountView.error_detail: string | null` : le texte enregistré (`error_detail` en base) quand `state === 'error'`, sinon null ; jamais pour un compte déconnecté.
- `me()` : pour un membre, chaque organisation où il a une appartenance active apparaît, y compris suspendue, avec `status: 'suspended'` ; les organisations actives gardent `status` absent (contrat actuel du web `isOpenable`).

- [ ] **Étape 1 : tests** : vue d'un compte en erreur après `meta_app_taken` : `error_detail === "Ce compte ne peut pas être raccordé. Contactez le support."`, ni nom, ni `client_id`, ni WABA de l'autre organisation (`// audit R-5`) ; compte `connected` : `error_detail === null`. `me()` d'un membre dont la seule organisation est suspendue : une entrée `{ status: 'suspended' }` ; appartenance suspendue ou retirée : aucune entrée ; route d'administration avec cette organisation : 403 inchangé (`// audit R-13`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** (`npm test`, `npm run test:pg`, `npm test -w @wabagent/web`).
- [ ] **Étape 3 : commit** `feat(moteur): motif précis d'un compte en erreur et organisations suspendues dans la session`.

### Tâche 4 : moteur, journaux sans secret ni donnée personnelle (Q-9, Q-11, revue finale 2b-3)

**Fichiers :**
- Modifier : `src/core/phone.ts` (masquage), `src/core/auth/mailer.ts`, `src/transport/meta-cloud.ts:321,507,534`, `src/transport/cm-com.ts:245,292`, `src/core/handler.ts:219,554`, `src/core/audit.ts:11`, `src/core/auth/auth-service.ts:344`, `src/index.ts:86`, `src/connectors/{hubspot,pipedrive,salesforce,zoho,attio}.ts`, tout autre appel relevé par la garde.
- Créer : `scripts/check-logs.ts`, script `check:logs` dans `package.json`, étape dans `.github/workflows/ci.yml`.
- Tests : `src/core/__tests__/phone.test.ts`, `src/core/auth/__tests__/mailer.test.ts`, `scripts/__tests__/check-logs.test.ts`.

**Interfaces :**
- `maskContact(id: string): string` : E.164 garde l'indicatif saisi et les 2 derniers chiffres (`+33612345678` donne `+33•••••••78`), autre identifiant (BSUID) : 4 premiers caractères et `•••`.
- `maskEmail(email: string): string` : `claire.bernard@x.fr` donne `c•••@x.fr`.
- `ConsoleMailer` (choix C-6 A) : hors production, comportement actuel ; avec `NODE_ENV=production`, `[Mailer] Invitation créée pour c•••@x.fr : envoi d'e-mail non configuré, lien non journalisé`. Avertissement au démarrage en production sans fournisseur d'e-mail.
- `check-logs.ts` : parcourt `src/**/*.ts` hors `__tests__` ; refuse un appel `console.(log|info|warn|error)` qui passe en argument un identifiant d'erreur nu (`err`, `error`, `e`), ou qui interpole ou passe `responseText`, `profileName`, `fullName`, `link`, `token`, `secret`, `.phone`, `.email`, `text`, `content`, `trimmed` hors d'un appel `maskContact(...)` ou `maskEmail(...)` ; sortie : fichier, ligne, motif ; code 1 si au moins un refus.

- [ ] **Étape 1 : tests** de `maskContact`, `maskEmail`, du mailer (production : le lien n'apparaît dans aucun appel à `console`, l'adresse est masquée) et de `check-logs` sur des fichiers d'exemple (un appel fautif par motif, un appel accepté `err instanceof Error ? err.message : String(err)`).
- [ ] **Étape 2 : lancer `npm run check:logs`** : il échoue et liste les appels actuels.
- [ ] **Étape 3 : corriger chaque appel** : `Sent OK` devient `[MetaCloud] Message envoyé (${status})` sans corps ; réponse en texte simple (C-7) : plus aucun journal ; objets d'erreur entiers remplacés par le motif habituel `err instanceof Error ? err.message : String(err)` ; connecteurs CRM : `maskEmail` / `maskContact`.
- [ ] **Étape 4 : vérifier** : `npm run check:logs` passe, `npm test`, `npm run typecheck`.
- [ ] **Étape 5 : commit** `fix(moteur): journaux sans secret ni donnée de contact, garde check:logs`.

### Tâche 5 : BFF, erreurs et synthèses (R-7, R-14, R-24, R-3)

**Fichiers :**
- Créer : `apps/web/src/lib/zod-fr.ts`.
- Modifier : `apps/web/src/lib/proxy.ts`, `lib/engine-client.ts:44`, `lib/api-response.ts`, `app/api/bots/route.ts`, `app/api/bots/[botId]/route.ts`, la route BFF du simulateur, `app/api/bots/summary/route.ts:20-22`, `app/api/usage/summary/route.ts:21-23`, `lib/usage.ts`, le type de synthèse des agents IA.
- Tests : `apps/web/src/lib/__tests__/proxy.test.ts`, tests des routes `bots` et `usage`.

**Interfaces :**
- `zodIssueToFrench(issue: z.ZodIssue): string` : message de l'issue s'il a été écrit dans les contrats, sinon un texte français par type (`too_small` chaîne « Valeur trop courte. », `too_big` « Valeur trop longue. », `invalid_string` « Format invalide. », `invalid_type` « Valeur manquante ou invalide. », autre « Valeur invalide. »).
- `EngineError` porte `reason?: string` et `requestId?: string` ; `errorResponse` les recopie dans `error.reason` et `error.request_id`.
- Repli d'un corps moteur illisible : « Le moteur a renvoyé une réponse illisible. » (au lieu de « Erreur engine. »).
- Synthèses : `UsageRow` devient `UsageRowAvailable | { bot_id: string; name: string; entity_id: number | null; unavailable: true }` ; `UsageSummary.partial: boolean` ; total calculé sur les lignes disponibles. Synthèse des agents IA : `messages: number | null`, `leads: number | null`.

- [ ] **Étape 1 : tests** : un schéma à message par défaut renvoie un message français et le test casse si une réponse BFF contient « String must », « Invalid », « Expected » ou « Required » (`// audit R-7`) ; refus moteur avec `reason` et `request_id` relayés (`// audit R-14`) ; corps illisible sur `POST /api/bots`, `PATCH /api/bots/:botId`, simulateur : 400 `VALIDATION_ERROR` (`// audit R-24`) ; une lecture d'usage en échec donne une ligne `unavailable` et `partial: true`, jamais 0 (`// audit R-3`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** (`npm test -w @wabagent/web`, `npx tsc --noEmit`).
- [ ] **Étape 3 : commit** `fix(web): BFF sans message Zod par défaut, référence de requête, synthèses partielles`.

### Tâche 6 : socle web, lecture des refus, composants d'erreur, notifications, bouton d'actions

**Fichiers :**
- Créer : `apps/web/src/lib/describe-failure.ts`, `apps/web/src/components/feedback/{field-error,inline-error,load-error,partial-value,notification-provider,action-menu}.tsx`.
- Modifier : `apps/web/src/lib/api-fetch.ts` (`MutationFailure`), `apps/web/src/app/[locale]/(app)/layout.tsx` (montage du fournisseur), `messages/{fr,en}.json` (namespace `errors.reasons`, `errors.generic`, `notify`, `actions`).
- Tests : `apps/web/src/lib/__tests__/describe-failure.test.ts`, `apps/web/src/components/feedback/__tests__/*.test.tsx`, `apps/web/src/i18n/__tests__/error-reasons.test.ts`.

**Interfaces :**
- `MutationFailure` gagne `reason: string | null` et `requestId: string | null`.
- `describeFailure(failure: MutationFailure, opts: { fallback: string; locale: 'fr' | 'en'; t: (key: string) => string; has: (key: string) => boolean }): DescribedFailure`, avec `DescribedFailure = { kind: 'field' | 'business' | 'session' | 'forbidden' | 'not_found' | 'rate_limited' | 'server' | 'network'; message: string; fieldErrors: Record<string, string>; reference: string | null }`. Règles : `status === 0` donne `network` et `fallback` ; `>= 500` donne `server`, `fallback` et `reference` ; `429` le texte `errors.generic.rateLimited` ; sinon, si `reason` a une clé `errors.reasons.<reason>`, sa traduction, sinon en français le texte du moteur, en anglais `fallback` ; `details` dont le `path` est un champ connu de l'écran vont dans `fieldErrors`.
- `FieldError({ id, message })` (relié par `aria-describedby`), `InlineError({ message, reference?, action? })` (`role="alert"`, « Référence : {reference} » en petit), `LoadError({ message, onRetry })`, `PartialValue()` (« indisponible »).
- `NotificationProvider` et `useNotify(): { success(text: string): void; error(text: string): void }` ; une région `aria-live` ; réussite `role="status"` 5 s ; erreur persistante jusqu'à fermeture, effacée au changement d'organisation.
- `ActionMenu({ label, items })` : bouton contour libellé (« Gérer ▾ » par défaut, choix C-3 A), menu au clavier (flèches, Échap, retour du focus), reprend le comportement de `RowMenu` (`components/organisation/members-table.tsx`) et `components/connections/{account-menu,number-menu}.tsx`, qui deviennent des usages d'`ActionMenu` aux tâches 9 et 10.

- [ ] **Étape 1 : tests de `describeFailure`** : un cas par `kind`, clé connue traduite, clé inconnue en français (texte du moteur) et en anglais (`fallback`, jamais la clé brute, point d'attention 2), 500 avec `fallback` et référence (`// audit R-14`), `details` répartis.
- [ ] **Étape 2 : test des clés** : chaque valeur de `ERROR_REASONS` a sa clé `errors.reasons.<clé>` en FR et en EN (`// audit R-15`).
- [ ] **Étape 3 : tests des composants** : `ActionMenu` visible avec son libellé, ouvert au clavier, Échap rend le focus (`// recette Q-7`) ; notification de réussite lue par `role="status"` et retirée après 5 s ; notification d'erreur persistante ; notification de réussite qui survit à une navigation et erreur effacée au changement d'organisation (point d'attention 5).
- [ ] **Étape 4 : vérifier l'échec, implémenter, vérifier.** La notification locale de `utilisateurs/page.tsx` est remplacée à la tâche 9, pas ici.
- [ ] **Étape 5 : commit** `feat(web): socle de restitution, lecture des refus, notifications et bouton d'actions`.

### Tâche 7 : authentification et session expirée (R-1, R-8, R-10, R-26)

**Fichiers :**
- Modifier : `apps/web/src/components/auth/{login-form,invitation-flow}.tsx`, `apps/web/src/app/[locale]/login/page.tsx`, `apps/web/src/components/providers/session-provider.tsx:203` (`onUnauthorized`), `apps/web/src/components/account/change-password-form.tsx`, `apps/web/src/lib/safe-next.ts` (nouveau).
- Tests : `login-form.test.tsx`, `invitation-flow.test.tsx`, `change-password-form.test.tsx`, `safe-next.test.ts`, `e2e/login.spec.ts`.

**Interfaces :**
- `safeNext(raw: string | null): string | null` : chemin interne commençant par `/` et pas par `//`, sans schéma, hors `/api/`, sinon null.
- `onUnauthorized` redirige vers `/<locale>/login?reason=session&next=<chemin actuel>`.
- Textes : panne ou réseau à la connexion « Connexion impossible pour le moment. Réessayez dans un instant. » ; bandeau de session (choix du rédacteur 3).

- [ ] **Étape 1 : tests** : connexion avec 500 et avec erreur réseau : texte de panne, jamais « Identifiants invalides. » (`// audit R-1`) ; acceptation (compte existant) en 500, 429 et réseau : textes de `accept-invite-form` (`// audit R-8`) ; changement de mot de passe en 429 : `auth.rateLimited` ; en 401 : redirection de session (`// audit R-26`) ; `reason=session` affiche le bandeau, la connexion réussie renvoie vers `next` ; `next` hostile (point d'attention 1) : accueil.
- [ ] **Étape 2 : e2e** `login.spec.ts` : moteur simulé arrêté (route qui répond 500), texte de panne.
- [ ] **Étape 3 : vérifier l'échec, implémenter (`change-password-form` passe par `sendMutation`), vérifier.**
- [ ] **Étape 4 : commit** `fix(web): connexion, invitation et session expirée disent ce qui s'est passé`.

### Tâche 8 : changement d'organisation et organisation suspendue (R-11, R-12, R-13, R-29)

**Fichiers :**
- Modifier : `apps/web/src/components/providers/session-provider.tsx:87-89,125-190,201`, `components/shell/{org-notice-banner,org-switcher}.tsx`, `app/[locale]/no-organization/page.tsx`, `lib/organizations.ts`, `messages/{fr,en}.json` (`orgNotice`, `noOrganization`).
- Tests : `session-provider.test.tsx`, `org-switcher.test.tsx`, `org-notice-banner.test.tsx`, `no-organization` (page), `e2e/two-tabs.spec.ts`.

**Interfaces :**
- `OrgNoticeKind` devient `'access' | 'suspended' | 'changed'` et le bandeau reçoit le nom de l'organisation concernée et, pour `access`, le nouveau rôle.
- `switchOrg(clientId): Promise<{ ok: true } | { ok: false; message: string }>` ; garde de double clic dans `OrgSwitcher`.
- Textes : « Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant {org}. » ; « {org} est suspendue. Contactez l'administrateur de votre organisation ou le support. » ; « Votre accès à {org} a changé : vous êtes maintenant {role}. » ; « Impossible d'ouvrir {org} : {raison} ».

- [ ] **Étape 1 : tests** : 409 `ORG_CHANGED` et retour sur l'onglet : bandeau `changed` nommant la nouvelle organisation (`// audit R-11`) ; `switchOrg` refusé : message dans le sélecteur, double clic sans second appel (`// audit R-12`) ; seule organisation suspendue (vue `status: 'suspended'` de la tâche 3) : page qui dit la suspension et la nomme, sans parler d'invitation (`// audit R-13`) ; bandeaux nommant l'organisation et le rôle (`// audit R-29`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** (unitaires et `e2e/two-tabs.spec.ts`, `e2e/no-organization.spec.ts`).
- [ ] **Étape 3 : commit** `fix(web): changement d'organisation et suspension expliqués`.

### Tâche 9 : pages Organisation (R-16, R-19, R-20, R-22, R-27, R-28, Q-7)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/organisation/{entites,utilisateurs,reglages}/page.tsx`, `components/organisation/{members-table,invitations-table,entities-table,access-drawer,suspend-dialog,archive-entity-dialog,move-agent-dialog}.tsx`, `components/connections/dialog-frame.tsx` (ou l'emplacement réel de `DialogFrame`).
- Créer : `components/organisation/revoke-invitation-dialog.tsx`.
- Tests : tests existants de ces pages et composants, `e2e/organisation.spec.ts`.

**Interfaces :**
- Consomme : `useNotify`, `LoadError`, `InlineError`, `ActionMenu`, `describeFailure` (tâche 6).
- Notifications de réussite (textes) : « Entité {name} archivée. », « {bot} déplacé vers {entity}. », « Accès de {email} modifiés. », « {email} suspendu. », « Invitation à {email} révoquée. », « Invitation envoyée à {email}. », « Invitation renvoyée à {email}. ».
- `DialogFrame` : Échap et clic extérieur sans effet pendant un envoi (comme `access-drawer.tsx:104-107`).
- Texte `invitation.not_invitable` (clé de la tâche 1) : « Cette adresse appartient à un compte de la plateforme : contactez le support. »

- [ ] **Étape 1 : tests** : lecture en échec des Entités, Utilisateurs et Réglages : `LoadError` avec Réessayer, cartes de Réglages masquées (`// audit R-16`) ; réussites ci-dessus notifiées (`// audit R-19`) ; Révoquer : fenêtre de confirmation, garde par identifiant, 404 après succès ignoré, notification (`// audit R-20`) ; Échap pendant l'envoi ne ferme pas (`// audit R-22`) ; refus d'une action de ligne (Réactiver une entité, un membre ; Renvoyer une invitation acceptée) affiché sous la ligne en la nommant, liste relue, garde de double clic (`// audit R-27`) ; `ActionMenu` libellé sur chaque ligne (`// recette Q-7`).
- [ ] **Étape 2 : vérifier l'échec, implémenter (la notification locale de 6 s disparaît au profit de `useNotify`), vérifier.**
- [ ] **Étape 3 : commit** `fix(web): pages Organisation, réussites notifiées et erreurs à leur place`.

### Tâche 10 : Connexions (R-5, R-6, R-19, R-21, Q-5, Q-6, Q-8)

**Fichiers :**
- Modifier : `apps/web/src/components/connections/{account-alerts,account-card,numbers-table,account-menu,number-menu,account-webhook,verification-checks,disconnect-dialog}.tsx`, `organisation/connexions/page.tsx`, `lib/whatsapp-display.ts` (`deliveryErrorKey(code: number | null): string`), `e2e/mock-engine.ts` (compte en erreur `other` avec `error_detail`, numéro avec `delivery_failures: 3` et code 131047), `messages/{fr,en}.json`.
- Tests : `account-alerts.test.tsx`, `numbers-table.test.tsx`, `account-card.test.tsx`, `connexions/__tests__/page.test.tsx`, `e2e/connections.spec.ts`.

**Interfaces :**
- Bandeau d'un compte en erreur `other` : `error_detail` en clair ; conseil selon la cause : texte `CANNOT_CONNECT` (le motif du moteur) : « Contactez le support », sans promesse de reprise ; motif d'un contrôle refusé (jeton, secret, WABA) : « Remplacez les identifiants du compte » avec le bouton ; panne du fournisseur (contrôle `inconclusive`) : seule cause qui garde « La vérification est reprise automatiquement ».
- Échecs de remise : pastille « {n} échecs de remise » sur la ligne du numéro, code traduit (choix du rédacteur 5), lien vers le gestionnaire WhatsApp ; même information dans l'encart Numéro de la page de l'agent IA (tâche 13 la consomme).
- Libellés (C-1) : « Retirer de WABAGENT », fenêtre « Retirer {name} de WABAGENT ? », bouton « Retirer le compte », section « Comptes retirés » ; notification « {name} retiré de WABAGENT. ».
- `AccountWebhook` n'est pas monté pour un compte `disconnected`.

- [ ] **Étape 1 : tests** : bandeau avec `error_detail` et conseil propre à chaque cause, jamais « reprise automatique » pour `CANNOT_CONNECT` (`// audit R-5`) ; pastille d'échecs de remise et texte du code 131047, code inconnu « Code Meta {code} » (`// audit R-6`) ; détail repliable du texte de Meta (`// audit R-21`) ; « Gérer ▾ » visible sur chaque compte et chaque numéro, « Brancher » direct sur un numéro libre (`// recette Q-6`) ; aucun libellé « Déconnecter » sur la page (`// recette Q-5`) ; aucune requête `GET .../webhook` pour un compte retiré (`// recette Q-8`) ; notification après Retirer (`// audit R-19`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** (unitaires et `e2e/connections.spec.ts`).
- [ ] **Étape 3 : commit** `fix(web): Connexions, motif d'erreur, échecs de remise et actions visibles`.

### Tâche 11 : statuts et liste d'accès limité (Q-1, Q-10, R-23)

**Fichiers :**
- Modifier : `apps/web/src/lib/bot-transitions.ts`, `components/agent/{status-panel,allowlist-panel}.tsx`, `components/numbers/allowlist-editor.tsx` (ou son emplacement réel), `app/[locale]/(app)/agents/[botId]/layout.tsx:23-28`, filtres et pastilles de la liste des agents IA, `e2e/mock-engine.ts` (règle de la tâche 2), `messages/{fr,en}.json` (`agentStatus`, `statusActions`, `allowlist`, filtres).
- Tests : `bot-transitions.test.ts`, `status-panel.test.tsx`, `allowlist-panel.test.tsx`, `e2e/agent-space.spec.ts`.

**Interfaces :**
- `bot-transitions.ts` suit `decideTransition` des contrats (tâche 2) : l'action « Désactiver » envoie `paused` ; aucune action n'envoie `draft` depuis l'écran (C-1 A) ; depuis `paused` : « Réactiver en accès limité » (`limited`), « Réactiver pour tous » (`active`).
- Pastilles et filtres : Brouillon, Accès limité (pastille `bg-warning-soft text-warning-ink` inchangée), Ouvert à tous, Désactivé ; EN : Draft, Limited access, Open to all, Deactivated.
- Encart liste vide en accès limité : « Cet agent IA ne répond à personne : sa liste d'accès limité est vide. » avec « Ajouter un numéro », « Ouvrir à tous », « Désactiver » ; l'enregistrement d'une liste vide est permis (le blocage côté web disparaît).
- Rail en échec de lecture : statut « Statut inconnu », nom remplacé par l'identifiant de l'agent IA.

- [ ] **Étape 1 : tests** : aucune occurrence de « brouillon » dans les actions de statut (`// recette Q-1`) ; liste vidée et enregistrée en accès limité : 200, encart et ses trois actions (`// recette Q-10`) ; liste vide puis Désactiver puis « Réactiver en accès limité » : refus `transition.empty_allowlist` affiché avec « Ajouter un numéro » (point d'attention 3) ; rail en échec : « Statut inconnu », jamais « Brouillon » (`// audit R-23`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : commit** `feat(web): statuts en mots d'activation, liste d'accès limité vide expliquée`.

### Tâche 12 : assistant de création (R-2, R-18, Q-12, Q-13)

**Fichiers :**
- Modifier : `apps/web/src/components/wizard/{wizard,step-identity,step-personality}.tsx`, `messages/{fr,en}.json` (`wizard`).
- Tests : `step-personality.test.tsx`, `wizard.test.tsx`, `step-identity.test.tsx`, `e2e/onboarding.spec.ts`.

**Interfaces :**
- Création par `sendMutation` et `describeFailure` ; `details[].path` routé : `entity_id` ramène à l'étape 1 avec le champ Entité affiché et en erreur ; `system_prompt` ouvre l'onglet de la langue par défaut en erreur ; autre refus : `InlineError` sous le bouton.
- `canSubmit` exige la personnalité de la langue par défaut (règle de `bot-service.ts:80-84`), avec la raison sous le bouton désactivé.
- Entités illisibles : l'étape 1 affiche `LoadError` et bloque la suite ; dans les rails de l'accueil et d'Usage, une ligne discrète « Entités indisponibles » avec Réessayer remplace le regroupement (`app/[locale]/(app)/page.tsx:68-75`, `usage/page.tsx:42-49`).
- Informations à collecter : bouton « Ajouter » à côté du champ ; à « Créer & tester », un texte non ajouté est ajouté s'il est valide, sinon la création est bloquée avec le message sous le champ. Note sous la liste : « Ces informations sont collectées pendant les conversations. Elles ne sont pas encore visibles dans WABAGENT ni envoyées à votre CRM : ce sera possible avec la page Conversations & Leads. »

- [ ] **Étape 1 : tests** : refus `bot.entity_required` : retour à l'étape 1, champ en erreur ; `bot.default_language_missing` : onglet de la langue par défaut en erreur ; 403 et 500 : message propre, jamais « Vérifiez les champs » (`// audit R-2`) ; entités illisibles : `LoadError`, suite bloquée, ligne « Entités indisponibles » dans les deux rails (`// audit R-18`) ; texte tapé sans Entrée présent dans le corps envoyé, bouton Ajouter (`// recette Q-12`) ; note visible (`// recette Q-13`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : commit** `fix(web): assistant, refus routés vers le bon champ et informations à collecter sûres`.

### Tâche 13 : page de l'agent IA (R-9, R-17, R-19, R-25, Q-4)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx:39-47,92-104`, `components/agent/{overview,number-panel,status-panel,recent-conversations,simulate-chat,simulate-panel,agent-rail,agent-sections}.ts(x)`, `messages/{fr,en}.json`.
- Tests : `agents/[botId]/__tests__/page.test.tsx`, `simulate-chat.test.tsx`, `agent-rail.test.tsx`, `number-panel.test.tsx`.

**Interfaces :**
- La page ne tombe que si la lecture de l'agent IA échoue ; santé, métriques, usage et conversations ont chacun leur `LoadError` dans leur panneau.
- Écriture réussie puis relecture en échec : bandeau « Modification enregistrée. L'affichage n'a pas pu être actualisé. » avec Réessayer.
- Simulateur : bulle en échec marquée « Non envoyé » avec « Renvoyer », texte remis dans le champ ; 404 « Cet agent IA n'existe plus. ».
- Rail (choix du rédacteur 4) : « CRM · À venir » ; bloc « Organisation » pour l'admin, lien « Numéros WhatsApp de l'organisation » vers `/organisation/connexions`.
- Encart Numéro : échecs de remise (tâche 10).

- [ ] **Étape 1 : tests** : usage en échec : statut, numéro et liste visibles, « Coûts indisponibles » et Réessayer ; conversations en échec : « Conversations indisponibles », jamais la liste vide (`// audit R-17`) ; statut changé puis relecture en échec : bandeau d'enregistrement (`// audit R-19`) ; simulateur en 500 : bulle « Non envoyé », texte conservé (`// audit R-9`) ; `aria-label` du bouton Fermer traduit (`// audit R-25`) ; rail sans « Connexions · À venir », lien Organisation pour l'admin, absent pour un conseiller (`// recette Q-4`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.**
- [ ] **Étape 3 : commit** `fix(web): page de l'agent IA, erreurs par panneau et simulateur sans perte`.

### Tâche 14 : chiffres, monnaie et formats (R-3, R-4, Q-2, Q-3, fuseau horaire)

**Fichiers :**
- Créer : `apps/web/src/lib/money.ts`.
- Modifier : `components/agent/{cost-card,usage-view}.tsx`, `components/usage/usage-summary-table.tsx`, `app/[locale]/(app)/usage/page.tsx`, la liste des agents IA (valeurs `null` de la tâche 5), `components/ui/bar-chart.tsx`, la route BFF qui sert `UsageData` et `app/api/usage/summary/route.ts` (champ `usd_eur_rate`), `src/i18n/request.ts` (`timeZone: 'Europe/Paris'`), `messages/{fr,en}.json` (`noError`, `tokensLine` sans erreurs).
- Tests : `apps/web/src/lib/__tests__/money.test.ts`, `cost-card.test.tsx`, `usage-view.test.tsx`, `usage-summary-table.test.tsx`, `bar-chart.test.tsx`.

**Interfaces :**
- `readUsdEurRate(env: NodeJS.ProcessEnv): { rate: number; date: string } | null` : nombre fini strictement positif et date ISO, sinon null.
- `formatUsd(amount: number, locale: 'fr' | 'en'): string` : `1.234` donne « 1,23 $ » en FR, « $1.23 » en EN.
- `formatEurApprox(amountUsd: number, rate: number, locale): string` : « ≈ 1,14 € » / « ≈ €1.14 ».
- Note FR : « Anthropic facture en dollars ; équivalent en euros au taux de {rate} du {date}. » ; sans taux : « Anthropic facture en dollars. »
- Nombres (tokens, appels) par `Intl.NumberFormat` de la langue (espace fine en FR).
- `BarChart` : série toute à 0 donne des barres vides et la mention « Aucun coût sur la période ».

- [ ] **Étape 1 : tests** : formats FR et EN ; taux absent, `0`, `-1`, `abc` : dollars seuls et note sans taux, jamais « NaN » ni « 0,00 € » (point d'attention 4) ; carte sans « erreur » (`// audit R-4`) ; ligne `unavailable` : `PartialValue` et « Total partiel » (`// audit R-3`) ; barres vides à 0 (`// recette Q-3`) ; date affichée en heure de Paris pour un ISO à 23 h 30 UTC (`// revue finale 2b-3, fuseau`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier.** Aucun `IntlError` dans la sortie des tests web.
- [ ] **Étape 3 : commit** `fix(web): coûts en dollars et en euros, chiffres inconnus jamais à zéro, heure de Paris`.

### Tâche 15 : mineurs repris des revues du 2b-3

Chaque point a son test ou sa vérification ; les points non repris sont listés en annexe.

**Fichiers et points :**
- `src/api/middleware/error-handler.ts:9-13` : `bodyParserType` ne reconnaît que les types de `body-parser` (`entity.too.large`, `entity.parse.failed`, `encoding.unsupported`, `charset.unsupported`, `request.aborted`, `request.size.invalid`, `stream.encoding.set`, `stream.not.readable`) ; test : une erreur portant `type: 'autre'` donne 500.
- Texte du 409 « numéro changé » dans Débrancher (page de l'agent IA) : « Le numéro de cet agent IA a changé entre-temps. La page a été actualisée. » côté web, clé `assign.holder_changed` contextualisée.
- `encodeURIComponent(botId)` dans `components/agents/agents-table.tsx:40` et `components/usage/usage-summary-table.tsx:38`.
- Test de garde de m-2 élargi aux guillemets doubles et aux gabarits (fichier du test m-2 de la revue 2b-3).
- Test de session « onglet redevenu visible » : `act()` avant l'événement, sans allonger le délai.
- `assign-bot-dialog.tsx` : `aria-describedby` vers un id présent, prop `account` inutilisée retirée.
- `allowlist-panel.tsx` : « la liste a changé » seulement sur un 409 explicite, message effacé à la saisie suivante.
- Badge « Numéro de test » masqué sur un numéro retiré.
- `docs/ARCHITECTURE.md` et plan 2b-3 : `src/core/bot-status.ts` remplacé par `packages/contracts/src/bot-status.ts`.
- Loader en thème sombre (Q-14) : contrôle visuel ; si `#1C3814` ne se distingue pas du fond sombre, pastille sombre remplacée en thème sombre par la couleur que François valide (capture avant et après dans le rapport, aucun changement sans son accord).

- [ ] **Étape 1 : écrire les tests listés, vérifier l'échec, corriger, vérifier toutes les suites.**
- [ ] **Étape 2 : un commit par sujet** (`fix(moteur): ...`, `fix(web): ...`, `docs: ...`).

### Tâche 16 : parcours de bout en bout et garde de restitution

**Fichiers :**
- Modifier : `apps/web/e2e/mock-engine.ts` (refus avec `reason`, `request_id`, panne simulable par route), `apps/web/e2e/{login,organisation,connections,activation,agent-space,onboarding}.spec.ts`.
- Créer : `apps/web/e2e/restitution.spec.ts`.

- [ ] **Étape 1 : `restitution.spec.ts`**, un test par écran d'écriture de l'audit §3 (34 actions) regroupés par page : refus 409 du moteur affiché à son emplacement (audit §5.1) ; 500 affiché avec le texte contextuel et la référence ; réussite visible (état changé, et notification si la fenêtre se ferme ou si l'élément sort de la vue) ; interface en anglais pour trois refus à clé (texte anglais, jamais français).
- [ ] **Étape 2 : lancer `npx playwright test` dans `apps/web`** : tout passe.
- [ ] **Étape 3 : commit** `test(web): parcours de restitution des erreurs et des réussites`.

### Tâche 17 : revue d'isolation (spec 2b §4.5)

Relecteur qui ne reçoit pas les rapports des implémenteurs. Périmètre : le code modifié par les tâches 1 à 4 et 15 (moteur), et le code qu'il appelle ou qui l'appelle : `decideTransition` et `decideAssign` et leurs appelants, pilotes WhatsApp, routage et pipeline des webhooks (liste vide), construction de `WhatsAppAccountView` et toutes ses routes, `me()` et le middleware de contexte d'organisation, `toErrorBody` et chaque refus à clé, les journaux.

- [ ] **Étape 1 : revue**, rapport `docs/superpowers/research/2026-11-XX-revue-isolation-restitution.md` : chaque constat avec fichier, ligne, scénario entre deux organisations, gravité, test qui le prouve ou qui manque.
- [ ] **Étape 2 : corriger les constats bloquants et importants, chacun avec son test (`// revue isolation restitution n`)**, puis `npm test`, `npm run test:pg`, suite `src/__tests__/isolation/` sur les deux moteurs.
- [ ] **Étape 3 : commit** du rapport et des corrections (un commit par sujet).

### Tâche 18 : contre-audit, documentation, recette en réel

- [ ] **Étape 1 : contre-audit de restitution** par un relecteur neuf, avec l'audit du 9 nov. 2026 comme grille : il rejoue les 87 cas de la matrice §2 et les 34 actions de la §3 (navigateur sur le moteur simulé, plus les cas réels de la recette), et rend un verdict par ligne. Rapport : `docs/superpowers/research/2026-11-XX-contre-audit-restitution.md`. Tout défaut restant est corrigé ou présenté à François, rien n'est déclaré « garanti » sans cette preuve.
- [ ] **Étape 2 : documentation** : `CLAUDE.md` (état du projet, contrat `error.reason`, règle de la liste vide, `check:logs`), `docs/ARCHITECTURE.md` (restitution des erreurs : clé du moteur, `describeFailure`, notifications).
- [ ] **Étape 3 : recette en réel** avec François (moteur et back-office lancés, worktree jetable, copie de `store/demo.db`) : connexion moteur arrêté, liste d'accès limité vidée puis message réel non servi, compte en erreur, coûts en euros, libellés de statut, Retirer de WABAGENT, menus Gérer, journaux du moteur relus pendant un échange réel (aucun numéro, nom ni contenu).
- [ ] **Étape 4 : revue finale de la branche** sur le modèle le plus capable, puis merge `--no-ff` et push seulement avec l'accord explicite de François.

---

## Annexe : mineurs différés du 2b-3 non repris dans ce lot

Gardés pour mémoire (le registre `.superpowers/sdd/` n'est pas versionné) :
- Moteur simulé de 921 lignes (module `mock-whatsapp.ts` à extraire) ; fixtures manquantes (compte en erreur `token_invalid`, `token_expiring`, `quality_degraded`, CM.com) au-delà de celles ajoutées par la tâche 10.
- Constantes dupliquées côté web (`ALLOWLIST_MAX`, `ALLOWLIST_ENTRY_MAX`, `TOKEN_EXPIRING_MS`, `normalizeEntry`) ; type `Ctx` répété ; type intersection `WhatsAppAccountVerified & WhatsAppAccountRefreshed`.
- `ORG_CHANGED` testé sur une partie des routes BFF seulement (comptes, assign, unassign, test-flag, rename, run).
- `now` figé au chargement de Connexions ; états Meta inconnus affichés bruts en anglais ; `h3` sans `h2` dans le bloc CRM ; contraste de `text-muted-2` (2,99:1, jeton de toute l'application, à traiter avec la charte).
- Coquille non responsive à 634 px ; `DialogFrame` sans piège à focus (au-delà de la tâche 9) ; « ⚡ » et couleurs codées en dur dans `step-test`.
- Tests : EN du bandeau de simulation, `WIZARD_PANE`, nom de test « documentation CM.com vérifiée », message EN `tooLong`, `setBusy` après démontage, `StepIndex` non lié à `STEP_COUNT`, `hasData` non remis à zéro quand `botId` change, garde `unchecked` limitée à `src/`, double import dans `test-support/whatsapp.ts`, sélecteurs Playwright fragiles (radios `force`, `header`, `page.goto` de retour).
- Statut illisible dans la réponse d'activation qui retombe sur le statut demandé.
