# Limites de l'API Meta pour le raccordement d'un compte WhatsApp

Date : 12 nov. 2026. Base du lot R (`docs/ROADMAP.md`, section R). Principe de François : tout ce que l'API permet, WABAGENT le fait ; le reste devient un prérequis guidé, avec une collecte claire des informations, puis WABAGENT prend la main.

Sources : documentation Meta lue le 12 nov. 2026 (Meta migre sa documentation WhatsApp vers `developers.facebook.com/documentation/business-messaging/whatsapp/` ; les anciennes pages `/docs/graph-api/reference/` la contredisent parfois) et essais en lecture seule sur le compte de dev (WABA `1122051030798254`, numéro de test `1444139162121271`, app WABAGENT Dev `1424483510748297`, jeton d'utilisateur système aux portées `whatsapp_business_management`, `whatsapp_business_messaging`, `manage_app_solution`, `whatsapp_business_manage_events`). Voir aussi l'essai de l'inscription du webhook : `2026-11-12-essai-raccordement-automatique.md`.

Légende : **Essai** = constaté sur le compte de dev ; **Doc** = écrit par Meta ; **Déduit** = inférence, à confirmer.

## Tableau

| Étape | WABAGENT par l'API | L'utilisateur chez Meta | À saisir dans WABAGENT |
|---|---|---|---|
| Créer l'app, ajouter WhatsApp | Non (Doc) | Oui : developers.facebook.com, Mes apps, Créer une app, cas d'usage WhatsApp, rattachée au portefeuille | Rien (l'app se lit depuis le jeton) |
| Utilisateur système et jeton permanent | Non en pratique : création par clics seulement ; génération de jeton par API réservée à un utilisateur système admin avec accès Ads Management (Doc) | Oui : Paramètres de l'entreprise, Utilisateurs système, Ajouter, Attribuer les actifs (app et WABA, contrôle total), Générer un jeton sans expiration | **Le jeton** |
| Secret de l'app | Non : aucun champ lisible (Doc) ; indispensable pour vérifier la signature des webhooks (Essai : signature = HMAC du secret de l'app abonnée) | Oui : tableau de bord de l'app, Paramètres, Général, Clé secrète, Afficher | **Le secret** |
| Retrouver l'app depuis le jeton | Oui : `debug_token` donne `app_id`, type, portées, expiration (Essai, avec le jeton d'app) | Non | Rien |
| Retrouver les WABA depuis le jeton | Seulement si le jeton a `business_management` : `GET /<BUSINESS>/owned_whatsapp_business_accounts` refusé sinon (Essai, erreur 200) ; `GET /me/assigned_whatsapp_business_accounts` répond vide (Essai) | Cocher `business_management` à la génération du jeton | **Le WABA ID** tant que le jeton n'a pas `business_management` |
| Numéros de la WABA, état de chacun | Oui : `GET /<WABA>/phone_numbers` ; statut, qualité, nom d'affichage et son statut, palier, `health_status` (Essai) | Non | Rien |
| Abonner l'app et inscrire notre webhook | Oui : `POST /<WABA>/subscribed_apps` avec `override_callback_uri` et `verify_token` ; GET de vérification synchrone, erreur 2200 sinon (Essai) | Non | Rien |
| Webhook par défaut de l'app | Contradictoire : la doc WhatsApp dit `POST /<APP_ID>/subscriptions` avec le jeton d'app, la référence Graph dit « non supporté pour WhatsApp ». Lecture par le jeton d'app possible (Essai). Écriture non testée | Oui tant que l'écriture n'est pas confirmée : tableau de bord, WhatsApp, Configuration | Rien |
| Webhooks qui ignorent l'adresse propre | `account_update`, `account_review_update`, `account_alerts` et les webhooks de modèles vont toujours à l'adresse de l'app (Doc) | Voir ligne précédente | Rien |
| Passer l'app en Live | Non, et le mode n'est pas lisible (Doc) ; en Dev « certains webhooks ne partent pas » (Doc) ; nos vrais messages sont arrivés avec l'app de dev (Essai) | Oui : publier l'app (politique de confidentialité, conditions, adresse requises) | Rien ; WABAGENT ne peut pas le vérifier |
| Ajouter et enregistrer un numéro | Oui : `POST /<WABA>/phone_numbers`, `request_code`, `verify_code`, `register` avec PIN à 6 chiffres, `deregister` ; 10 enregistrements par 72 h (Doc) | Supprimer un numéro, désactiver la double authentification : WhatsApp Manager seulement (Doc) | Numéro, code reçu par SMS ou appel, PIN |
| Nom d'affichage | Oui : `POST /<PHONE> new_display_name`, statut lisible, réenregistrement dans les 14 jours après approbation (Doc) | Non | Le nom souhaité |
| Profil WhatsApp (description, adresse, site, photo) | Lecture (Essai) et écriture (Doc) ; photo par upload resumable, documenté avec un jeton utilisateur seulement | Non | Les champs du profil |
| Moyen de paiement | Non : `primary_funding_id` refusé à une app qui n'est pas BSP (Essai, erreur 10) ; seul `health_status` dit qu'un envoi est limité, et pourquoi | Oui : compte de paiement du compte WhatsApp (pas celui des publicités) | Rien |
| Vérification d'entreprise | Lecture : `business_verification_status` de la WABA, code 141010 dans `health_status` (Essai) | Oui : Centre de sécurité du portefeuille | Rien |
| Modèles de messages | Oui : lecture (Essai) et création (Doc) | Non | Hors lot R |
| Compte de messagerie (Messaging account) | L'ID de la WABA est celui du compte de messagerie ; aucun appel ne change en 2026 (Doc) ; `messaging_account_id` exigé en 2027 ou 2028 si le jeton voit plusieurs comptes | Donner l'accès à l'utilisateur système (Doc) | Rien |

## Ce qui reste incompressible chez Meta

1. Créer l'app (cas d'usage WhatsApp) dans le bon portefeuille.
2. Créer l'utilisateur système, lui attribuer l'app et la WABA, générer un jeton permanent avec les bonnes portées.
3. Copier le secret de l'app.
4. Publier l'app.
5. Ajouter le moyen de paiement du compte WhatsApp.
6. Lancer la vérification d'entreprise (pour sortir de l'envoi limité).

## Collecte minimale dans WABAGENT

Le WABA ID, le jeton et le secret de l'app. Tout le reste se lit ou s'écrit par l'API. `business_management` ne supprime aucune saisie (voir essai 2) : non demandée.

## À essayer avant la spec

1. Fait le 12 nov. 2026 : `POST /<APP_ID>/subscriptions` (jeton d'app, `object=whatsapp_business_account`, `callback_url`, `verify_token`, `fields`) est accepté par l'API, interrupteur « Autoriser l'accès de l'API aux paramètres d'apps » désactivé : Meta fait le GET de vérification, puis répond 2200 avec un jeton faux et n'écrit rien (relu). Cas réussi joué le 12 nov. 2026 à 15:25 UTC : `{"success":true}` après le GET de vérification, relecture conforme (adresse et 10 champs), le numéro reprend l'adresse au niveau `application`. Un message envoyé ensuite au numéro de test est arrivé par ce webhook d'app (15:26 UTC, champ `messages`, signature valide). Le prérequis 7 disparaît. L'app de dev pointe depuis sur l'adresse d'essai, désormais morte : le raccordement de la WABA de dev est à refaire dans la copie de recette. Constat sur la page Paramètres, Avancé : l'app de dev est « Non publiée » ; « Clé requise » (appsecret_proof obligatoire) est un réglage à recommander dans le guide.
2. Fait le 12 nov. 2026 avec un second jeton du même utilisateur système, généré après ajout de `business_management` au cas d'usage de l'app (Cas d'utilisation, Personnaliser, Autorisations et fonctionnalités ; la case n'apparaît pas à la génération du jeton tant que la permission n'est pas ajoutée). Avec l'ID du portefeuille, le jeton lit le portefeuille, ses WABA (`owned_whatsapp_business_accounts`), ses apps (`owned_apps`) et ses utilisateurs système (rôle ADMIN ici). Mais rien ne donne le portefeuille à partir du jeton seul : `/me/businesses`, `/me/assigned_whatsapp_business_accounts`, `/me/assigned_business_asset_groups` répondent vide, le champ `business` n'existe ni sur `/me` ni sur l'app. Il faudrait donc saisir l'ID du portefeuille au lieu du WABA ID : aucun gain, une étape de plus chez Meta et un jeton bien plus puissant (gestion des utilisateurs système et des apps du portefeuille). `primary_funding_id` reste refusé (non BSP). Générer un nouveau jeton n'a pas révoqué l'ancien (relu valide).
3. Fait le 12 nov. 2026 : `debug_token` marche avec le jeton lui-même, sans jeton d'app (Essai : `app_id`, `SYSTEM_USER`, `expires_at: 0`). Le moteur le fait déjà ainsi (`verifyMetaManual`).
4. Ce que WABAGENT peut détecter quand l'app n'est pas publiée (entité APP de `health_status`).
