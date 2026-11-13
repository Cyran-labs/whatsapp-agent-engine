# Lot R1 : raccordement automatique du compte WhatsApp (Meta)

Date : 12 nov. 2026. Statut : approuvée par François le 12 nov. 2026 ; amendée le 12 nov. 2026 après l'audit des décisions (§12).

Sources d'autorité :
- `docs/ROADMAP.md`, section R ;
- essai du 12 nov. 2026 : `docs/superpowers/research/2026-11-12-essai-raccordement-automatique.md` ;
- limites de l'API Meta : `docs/superpowers/research/2026-11-12-limites-api-meta-raccordement.md` ;
- spec 2b (`docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md`), dont ce lot amende le §7.1 et le §9 pour le mode Meta.

## 1. Intention

Aujourd'hui, raccorder un compte WhatsApp Meta oblige l'administrateur à faire des allers-retours entre WABAGENT et les pages de Meta : il saisit trois identifiants dans WABAGENT, puis recopie l'URL de webhook et le jeton de vérification dans la configuration de son app Meta. Les pages de Meta sont difficiles : nomenclature ancienne, pages qui changent, informations dures à trouver, même pour qui les connaît. Une prise en main sera toujours douloureuse si l'utilisateur doit y aller.

Principe de François : tout ce que l'API de Meta permet, WABAGENT le fait. Ce que l'API ne permet pas devient un prérequis imposé et guidé, avec une collecte claire des informations ; ensuite WABAGENT prend la main.

L'essai du 12 nov. 2026 a établi la frontière : sans Embedded Signup (qui exige une app publiée et le statut Tech Provider), l'utilisateur doit créer chez Meta son app, son utilisateur système et son jeton, et nous donner trois informations : le **WABA ID**, le **jeton** et le **secret de l'app** (illisible par l'API, indispensable pour vérifier la signature des webhooks). Tout le reste se fait par l'API.

## 2. Objectifs, non-objectifs, anti-objectifs

Objectifs :
- l'utilisateur ne saisit plus rien dans Meta pour le webhook : WABAGENT inscrit lui-même le webhook de la WABA et celui de l'app ;
- la copie ne se fait plus que dans un sens, de Meta vers WABAGENT, une fois : WABA ID, jeton, secret de l'app ;
- un guide dans WABAGENT dit exactement quoi faire chez Meta et où trouver chacune des trois informations ;
- WABAGENT lit et affiche l'état du compte que Meta expose (envoi limité ou bloqué, et pourquoi : vérification d'entreprise, paiement), pour que l'utilisateur n'ait pas à aller le chercher chez Meta.

Non-objectifs (lot R2 ou plus tard) :
- profil WhatsApp, nom d'affichage, ajout et enregistrement d'un numéro (lot R2) ;
- modèles de messages ; catalogue (chantier C) ;
- Embedded Signup (après la mise en ligne et le statut Tech Provider) ;
- CM.com : inchangé (son webhook reste à configurer chez CM.com, faute d'API connue).

Anti-objectifs (échec même si tout le reste marche) :
- un écran qui demande encore de recopier une URL ou un jeton dans Meta pour un compte Meta ;
- un webhook inscrit chez Meta qui pointe vers le compte d'une autre organisation, ou un événement d'une WABA traité par le compte d'une autre organisation ;
- un compte affiché « raccordé » alors que Meta n'a pas accepté notre webhook ;
- une écriture chez Meta avant que toutes les lectures de vérification aient réussi (règle du §7.1 de la spec 2b, gardée) ;
- un raccordement qui échoue en laissant chez Meta une adresse qui pointe vers un compte inexistant, sans le dire ;
- remplacer sans prévenir un webhook d'app qui sert un autre produit du client (voir §5.4 et §10, question 1) ;
- un guide qui décrit des écrans de Meta faux : chaque étape du guide est rejouée en recette dans les vraies pages ;
- deux façons de raccorder un compte Meta (l'ancienne recopie manuelle ne reste pas en repli).

## 3. Ce que l'essai a établi (rappel)

- `POST /<WABA>/subscribed_apps` avec `override_callback_uri` et `verify_token` : Meta fait le GET de vérification **pendant** l'appel ; si la réponse n'est pas le défi, l'appel échoue avec l'erreur 2200 et rien n'est écrit. Réussi, le niveau WABA passe avant le niveau app ; les messages arrivent signés avec le secret de l'app abonnée. Le retrait est le même appel sans corps.
- `POST /<APP_ID>/subscriptions` avec le jeton d'app (`app_id|app_secret`), `object=whatsapp_business_account`, `callback_url`, `verify_token`, `fields` : accepté par l'API (GET de vérification reçu, puis 2200 avec un jeton faux, rien d'écrit), même avec l'interrupteur « Autoriser l'accès de l'API aux paramètres d'apps » désactivé ; cas réussi joué le 12 nov. 2026 (`success`, relecture conforme).
- Selon Meta, `account_update`, `account_review_update`, `account_alerts` et les webhooks de modèles ignorent l'adresse de la WABA et vont toujours au webhook de l'app. D'où l'inscription des deux.
- `debug_token` fonctionne avec le jeton lui-même : il donne l'app, le type et l'expiration.
- `GET /<WABA>?fields=health_status,business_verification_status` est lisible avec le jeton : `can_send_message` (AVAILABLE, LIMITED, BLOCKED) et les erreurs avec leur code (141010 vérification d'entreprise, etc.).
- La portée `business_management` ne supprime aucune saisie (le portefeuille ne se trouve pas à partir du jeton seul) : elle n'est pas demandée.
- Une app non publiée a reçu les vrais messages du numéro de test ; Meta dit que « certains webhooks » ne partent pas en mode Développement, et le mode de l'app n'est pas lisible par l'API.

## 4. Parcours de l'utilisateur

1. Organisation › Connexions › Raccorder, mode Meta. Le guide (§6.1) se lit avant le formulaire.
2. L'utilisateur saisit le nom du compte, le WABA ID, le jeton et le secret de l'app. Rien d'autre.
3. WABAGENT vérifie, inscrit les webhooks, inventorie les numéros, lit l'état du compte. Le résultat liste les contrôles (dont les deux webhooks) et l'état du compte.
4. Il n'y a plus d'étape « copiez cette URL dans Meta ». Le compte est utilisable tout de suite (brancher un numéro, activer un agent IA).
5. Ensuite, « Vérifier maintenant » et « Remplacer les identifiants » refont la même chose, réinscription des webhooks comprise.

## 5. Comportements du moteur

### 5.1 Ordre du raccordement (amende le §7.1 de la spec 2b)

1. Prérequis de plateforme : `PUBLIC_BASE_URL` doit être définie. Sinon, refus avant tout appel à Meta, avec une raison stable (`whatsapp_account.public_url_missing`, texte : la plateforme n'a pas d'adresse publique, contactez le support). Elle devient obligatoire pour le mode Meta.
2. Lectures, inchangées : WABA (`appsecret_proof`), `debug_token`, `subscribed_apps`, inventaire, et en plus `health_status` et `business_verification_status` de la WABA. Contrôle d'unicité (WABA, app propre à l'organisation, choix 3 du 2b-2) avant toute écriture, comme aujourd'hui.
3. Préparation de la réponse au GET de vérification : la clé d'URL et le jeton de vérification du futur compte doivent être servis par `GET /webhook/meta/<clé>` **avant** les écritures chez Meta, puisque Meta vérifie pendant l'appel. Aucun message ne doit être traité par ce compte tant que le raccordement n'est pas confirmé (§5.2).
4. Écriture obligatoire : abonnement de l'app à la WABA avec notre adresse propre (`POST /<WABA>/subscribed_apps` avec `override_callback_uri` = URL du compte et `verify_token`). Il remplace l'abonnement simple d'aujourd'hui (un seul appel).
5. Confirmation par relecture : `GET /<WABA>/subscribed_apps` montre notre adresse sur l'entrée de l'app ; sinon le contrôle est en échec et le raccordement refusé (avec retrait, §5.2).
6. Le compte est enregistré `connected` avec ses contrôles.
7. Écriture complémentaire, après l'enregistrement : webhook de l'app (`POST /<APP_ID>/subscriptions`), selon le §5.4. Son échec ne refuse pas le raccordement (les messages arrivent par l'adresse de la WABA) : le compte reste `connected` avec une alerte « alertes de compte de Meta non reçues » et la raison. Choix du rédacteur, motivé par la relecture du builder : la référence Graph dit cet appel non supporté (la doc WhatsApp et l'essai du 12 nov. 2026 disent le contraire) ; si Meta le refuse un jour, R1 reste utilisable.
8. Audit `whatsapp_account.create`, comme aujourd'hui, avec le résultat des deux inscriptions.

Contrôles de vérification : deux clés s'ajoutent à `VERIFICATION_CHECK_KEYS` (source unique du moteur et du web), une pour le webhook de la WABA et une pour celui de l'app ; noms exacts au builder. Le webhook de la WABA est obligatoire (échec = raccordement refusé). Le webhook de l'app est complémentaire (échec = alerte, étape 7).

### 5.2 Échec en cours de route

- Échec d'une lecture : rien n'est écrit, ni chez Meta ni en base (inchangé).
- Erreur 2200 (Meta n'a pas pu vérifier notre adresse : tunnel arrêté, adresse publique fausse, moteur injoignable) : raison stable `whatsapp_account.webhook_unreachable`, texte qui dit quoi faire ; rien n'est enregistré comme raccordé.
- Échec après l'écriture obligatoire (relecture qui ne montre pas notre adresse, ou enregistrement en échec) : le moteur retire l'adresse de la WABA (`POST subscribed_apps` sans corps) et le dit dans le résultat. Le webhook de l'app n'est écrit qu'après l'enregistrement, il n'a donc jamais à être défait ici. S'il n'y parvient pas, le résultat le dit aussi et l'événement est journalisé (sans secret). Jamais un compte fantôme visible ou servi.
- La forme exacte de l'état transitoire du §5.1, étape 3 (ligne en base dans un état non servi, ou registre en mémoire) est laissée au builder, avec trois contraintes : rien n'est servi ni listé tant que le raccordement n'est pas confirmé ; un échec ne laisse rien dans les listes ; le multi-instance n'est pas exigé en R1, mais le choix est noté pour le chantier Infra (verrou et état en mémoire déjà différés).

### 5.3 Vérifier maintenant, remplacer les identifiants

- « Vérifier maintenant » relit l'abonnement et l'adresse de la WABA ; si l'adresse n'est plus la nôtre (retirée ou remplacée chez Meta), il la réinscrit, puis applique le §5.4 au webhook de l'app. Le résultat dit ce qui a été réinscrit.
- Échec de la réinscription à « Vérifier maintenant » (choix du rédacteur) : une erreur 2200 ou réseau est non concluante (`transient`, revue 2b-2 M-1) et ne met jamais le compte en `error` : une panne passagère du tunnel ou de l'hébergement n'arrête pas les agents IA Online. Le compte garde son état et porte une alerte visible « webhook absent chez Meta » sur Connexions et sur la page de l'agent IA. Un refus net des identifiants (jeton invalide) suit les règles actuelles (`error`).
- `PUBLIC_BASE_URL` absente à « Vérifier maintenant » : vérification refusée avec la raison `public_url_missing`, non concluante, état du compte inchangé.
- « Remplacer les identifiants » refait le parcours complet du §5.1 avec les nouveaux identifiants ; la clé d'URL du compte et son jeton de vérification ne changent pas (inchangé).
- Un compte raccordé avant ce lot (recopie manuelle) est mis à niveau à sa prochaine vérification ou au prochain remplacement des identifiants, avec les mêmes règles (dont la question 1 du §10 pour un webhook d'app qui pointe ailleurs) ; aucune migration n'appelle Meta toute seule (rien n'est déployé).

### 5.4 Webhook de l'app

Le webhook de l'app porte les événements de compte et de modèles de toutes les WABA abonnées à l'app. Une app Meta n'appartient qu'à une organisation (choix 3), mais plusieurs comptes de la même organisation peuvent partager une app.

Règle (choix du rédacteur, à valider) :
- l'adresse inscrite est celle d'un compte `connected` de l'organisation qui utilise cette app ; si le webhook de l'app pointe déjà vers un tel compte, on n'y touche pas ;
- un événement de compte reçu sur l'adresse d'un compte A pour une WABA B est traité pour B seulement si B est un compte `connected` de la **même organisation** et de la **même app** ; sinon il est ignoré (comme aujourd'hui, où il est filtré par WABA) ; la signature est vérifiée avec le secret de A, qui est celui de l'app commune ;
- quand le compte vers lequel pointe le webhook de l'app est déconnecté, le moteur le fait pointer vers un autre compte `connected` de la même organisation et de la même app s'il en existe un ;
- si le webhook de l'app pointe hors de WABAGENT (autre produit du client) : question 1 du §10 ;
- les **messages** et statuts restent filtrés par WABA, comme aujourd'hui (`processBatch`) : un message de la WABA B reçu sur l'adresse de A (adresse propre de B retirée chez Meta) n'est jamais traité ; seule façon de router un message : l'adresse propre de sa WABA, puis le numéro destinataire. Le moteur en tire seulement une alerte sur le compte B (même organisation, même app) : « webhook absent chez Meta, lancez Vérifier maintenant » ;
- deux raccordements simultanés de la même organisation sur la même app : le dernier qui écrit le webhook de l'app gagne ; c'est sans risque puisque l'un et l'autre pointent vers un compte `connected` de la même organisation et de la même app, et que le traitement croisé ci-dessus couvre les deux. Aucun verrou par app en R1 (choix du rédacteur).

Champs abonnés : au moins `messages` et les événements de compte et de numéro que le moteur traite déjà (§7.6 de la spec 2b) ; liste exacte au builder, d'après les champs que le moteur sait lire.

### 5.5 Déconnexion du compte

- Le moteur retire l'adresse propre de la WABA (`POST /<WABA>/subscribed_apps` sans corps), avec les identifiants du compte, avant d'effacer ses secrets. La WABA revient au webhook de l'app.
- Le webhook de l'app suit le §5.4 ; s'il ne reste aucun autre compte `connected` de la même organisation et de la même app, il est laissé tel quel (il pointe vers le compte déconnecté, dont l'adresse refuse tout) et la fenêtre de déconnexion le dit, avec la marche à suivre si le client veut le changer chez Meta (choix du rédacteur : Meta ne rend pas le jeton de vérification d'une adresse précédente, la restaurer est impossible).
- Si Meta refuse ou ne répond pas, la déconnexion a quand même lieu (le compte n'a plus de secret, les requêtes vers son adresse sont refusées à l'authentification) et le résultat le dit.

### 5.6 État du compte lu chez Meta

À chaque vérification et à « Rafraîchir les numéros », le moteur lit `health_status` et `business_verification_status` de la WABA et l'état des numéros (déjà lus en partie à l'inventaire). Il en tire, pour l'affichage :
- envoi possible, limité ou bloqué ;
- les causes que Meta donne, traduites par code quand le code est connu (141010 vérification d'entreprise, codes de paiement déjà traités au §7.6 de la spec 2b), sinon le texte de Meta (`provider_text`) ;
- ce que l'utilisateur doit faire chez Meta, avec le lien de la page.

Ces informations ne changent pas l'état du compte (`connected` reste `connected`) : ce sont des alertes, comme au §6 de la spec 2b. Stockage au builder (alertes existantes ou champ dédié).

## 6. Écrans

### 6.1 Guide de raccordement Meta (remplace `connect-guide-meta.tsx`)

Prérequis, dans l'ordre, chacun avec le chemin de clics et le lien direct quand il existe :
1. Créer l'app Meta avec le cas d'usage WhatsApp, dans le portefeuille de l'entreprise.
2. Le numéro WhatsApp dédié à l'agent IA (texte actuel gardé : un numéro utilisé dans l'application WhatsApp ne peut pas servir).
3. Créer l'utilisateur système, lui attribuer l'app et la WABA (contrôle total), générer un jeton sans expiration avec `whatsapp_business_management` et `whatsapp_business_messaging`.
4. Où lire le WABA ID (et pas une autre valeur qui lui ressemble : piège rencontré en recette le 11 nov. 2026, `selected_asset_id`).
5. Où lire le secret de l'app (Paramètres de l'app, Général, Clé secrète, Afficher).

Recommandé, signalé comme tel : publier l'app ; ajouter le moyen de paiement du compte WhatsApp (pas celui des publicités) ; lancer la vérification d'entreprise ; activer « Clé requise » (Paramètres de l'app, Avancé).

Plus aucune étape « Webhook ». Les libellés exacts des pages Meta sont relevés en recette avec François, dans les vraies pages.

### 6.2 Formulaire et résultat

- Formulaire : nom, WABA ID, jeton, secret de l'app (inchangé).
- Résultat : la liste des contrôles, avec les deux webhooks (« Webhook inscrit chez Meta », ou la raison de l'échec et quoi faire) ; l'état du compte (§5.6).
- La boîte webhook (`webhook-box.tsx`, `account-webhook.tsx`) disparaît pour les comptes Meta ; elle reste pour CM.com. La route `GET /whatsapp-accounts/:id/webhook` reste pour CM.com ; pour un compte Meta, au builder de la retirer ou de la restreindre, sans exposer le jeton de vérification à l'écran.
- Carte du compte et encart Numéro de la page de l'agent IA : l'état du compte (§5.6) s'affiche avec la même phrase aux deux endroits (règle `AccountErrorSentence` du sous-lot En-tête).

### 6.3 Textes

Textes français avec accents, vocabulaire de `CLAUDE.md`. Chaque raison nouvelle (`public_url_missing`, `webhook_unreachable`, échec de retrait, webhook d'app non inscrit) a sa clé `error.reason` dans `ERROR_REASONS`, son texte, et un test de restitution (règle du lot « Restitution des erreurs »).

## 7. Contrats changés

- `VERIFICATION_CHECK_KEYS` : deux clés en plus.
- `ERROR_REASONS` : les raisons du §6.3.
- `WhatsAppAccountView` : l'état lu chez Meta (§5.6) et l'état des deux webhooks.
- `PUBLIC_BASE_URL` obligatoire pour le mode Meta.
- `GET /whatsapp-accounts/:id/webhook` : CM.com seulement, ou réponse sans jeton pour Meta (au builder).

## 8. Impact multi-organisation

| Risque | Ce qui l'empêche | Test |
|---|---|---|
| L'adresse inscrite chez Meta pour la WABA d'une organisation pointe vers le compte d'une autre | l'adresse est calculée à partir du compte en cours de raccordement, dans l'organisation de la requête ; unicité de la WABA sur la plateforme | raccordement de A : l'appel `subscribed_apps` porte l'URL du compte de A, jamais d'un compte de B (faux Meta) |
| Le webhook de l'app pointe vers un compte d'une autre organisation | une app n'appartient qu'à une organisation (choix 3) ; le §5.4 ne choisit qu'un compte de la même organisation et de la même app | deux organisations, apps différentes : aucun appel `subscriptions` de A ne porte une URL de B ; app partagée entre deux organisations : raccordement refusé (test existant, gardé) |
| Événement de compte de la WABA d'une organisation traité par le compte d'une autre | événement reçu sur l'adresse de A traité pour B seulement si même organisation et même app | événement pour une WABA de B arrivé sur l'adresse de A (signé avec le secret de A) : ignoré |
| GET de vérification servi pendant le raccordement avec le jeton d'un autre compte | état transitoire clé par la clé d'URL du compte en cours ; jeton propre au compte | GET sur l'adresse en cours avec le jeton d'un autre compte : 403 |
| Message traité par un compte dont le raccordement n'est pas confirmé | rien n'est servi avant la confirmation (§5.2) | POST signé sur l'adresse d'un raccordement en cours ou échoué : aucun effet de bord |
| Écriture chez Meta avec les identifiants d'une autre organisation | les appels utilisent les identifiants du compte de la requête, aucun repli `.env` | isolation existante (« agent sans identifiants ») étendue aux nouveaux appels |
| Retrait à la déconnexion appliqué à la WABA d'une autre organisation | retrait fait avec le compte déconnecté, sur sa propre WABA | déconnexion de A : un seul appel, sur la WABA de A |
| Secret ou jeton dans un journal | règles de `check:logs` ; aucune URL de webhook complète journalisée (elle contient la clé) | `check:logs` ; test des journaux du raccordement |

La revue d'isolation du plan porte sur le code modifié et sur le code qui l'appelle ou qu'il appelle (entrée webhook, service des comptes, client Graph).

## 9. Vérification

- Tests du client Graph sur un faux Meta : ordre des appels (aucune écriture avant la fin des lectures), 2200, échec de l'écriture 2 après l'écriture 1 et retrait, relecture qui ne montre pas notre adresse, `PUBLIC_BASE_URL` absente.
- Test du GET de vérification servi pendant le raccordement (faux Meta qui appelle notre route avant de répondre).
- Suite d'isolation : lignes du §8, sur SQLite et Postgres.
- Recette en réel sur le compte de dev (WABA `1122051030798254`, app WABAGENT Dev, tunnel `wabagent-dev`) : raccordement sans aucune saisie chez Meta ; message reçu et agent IA qui répond ; webhook de l'app inscrit par le moteur ; « Vérifier maintenant » après retrait manuel de l'adresse ; déconnexion et retour de la WABA au webhook de l'app ; chaque étape du guide rejouée dans les vraies pages Meta par François.

## 10. Questions pour François

1. Tranché par François le 12 nov. 2026 (recommandation acceptée). Le webhook de l'app pointe hors de WABAGENT (autre produit du client). Recommandation révisée après la relecture du builder (une confirmation pendant le raccordement exige un état qui dure entre deux requêtes) : WABAGENT n'y touche pas pendant le raccordement, qui réussit (les messages arrivent par l'adresse de la WABA) ; le compte porte une alerte qui montre l'adresse actuelle (domaine seulement) et dit que les alertes de compte de Meta n'arrivent pas ; un bouton « Faire pointer vers WABAGENT », avec confirmation, fait l'écriture à part. 

## 11. Choix du rédacteur et laissé au builder

Choix du rédacteur (contestables) : deux lots R1 et R2 ; webhook de l'app écrit après l'enregistrement et non bloquant ; échec de réinscription non concluant (alerte, jamais `error`) ; messages toujours filtrés par WABA, alerte sur le compte dont l'adresse a disparu ; pas de verrou par app ; webhook de l'app laissé tel quel à la dernière déconnexion ; `business_management` non demandé ; `PUBLIC_BASE_URL` obligatoire pour Meta ; règle du webhook de l'app (§5.4) ; retrait de l'adresse de la WABA à la déconnexion ; état lu chez Meta affiché comme alerte, sans changer l'état du compte.

Laissé au builder : forme de l'état transitoire (§5.2) ; noms des clés de contrôle et des raisons ; liste exacte des champs abonnés ; stockage de l'état lu chez Meta ; sort de la route webhook pour Meta.

## 12. Amendements du 12 nov. 2026 (audit des décisions, décisions de François)

Ils priment sur les paragraphes précédents.

- §5.1 et §5.2 : si la WABA porte déjà, pour l'app du jeton, une adresse propre qui n'est pas de WABAGENT, elle est remplacée et le résultat du raccordement le dit (domaine seul). WABAGENT ne retire jamais une adresse qu'il n'a pas posée : tout retrait relit d'abord l'adresse en place et ne retire que celle du compte concerné. Au raccordement raté, si l'app n'était pas abonnée avant la tentative, elle est désabonnée.
- §5.3 : « Vérifier maintenant » dont les identifiants sont bons mais dont la réinscription échoue rend l'issue « vérifié » (la date de vérification est écrite), jamais `error` ; le compte qui sortait d'erreur repasse `connected`, avec l'alerte « Webhook absent » ; la fenêtre titre « Identifiants vérifiés, webhook à contrôler chez Meta. ». Sans `PUBLIC_BASE_URL`, l'issue est non concluante et porte la raison stable `public_url_missing`.
- §5.5 : au retrait d'un compte, WABAGENT désabonne l'app de la WABA (`DELETE /<WABA>/subscribed_apps`), et non plus seulement son adresse propre ; même chose pour l'ancienne app au remplacement des identifiants vers une autre app. La fenêtre de retrait distingue « le webhook de l'app pointe encore vers ce compte » (lu) de « WABAGENT n'a pas pu le lire », avec le chemin dans Meta (tableau de bord de l'app, WhatsApp, Configuration).
- §5.4 : champs abonnés sur le webhook de l'app réduits à ceux que le moteur lit : `messages`, `account_update`, `phone_number_name_update`, `phone_number_quality_update`.
  Constat de la recette en réel du 12 nov. 2026 : `POST /<APP_ID>/subscriptions` ajoute les champs demandés à ceux déjà abonnés sur l'app, il ne les remplace pas. Une app déjà abonnée à d'autres champs (par un autre outil ou à la main) les garde ; WABAGENT ne les retire pas, conformément à la règle « ne jamais retirer ce qu'il n'a pas posé ». Le moteur ignore les événements des champs qu'il ne lit pas.
- §6.3 : raison supplémentaire `whatsapp_account.meta_unavailable` (panne passagère de Meta pendant l'écriture) ; `webhook_unreachable` est réservée à l'erreur 2200.
