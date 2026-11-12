# Essai préalable du lot R : raccordement automatique du compte WhatsApp

Date : 12 nov. 2026. Compte de développement : WABA `1122051030798254`, numéro de test +1 555 164 9072 (Phone Number ID `1444139162121271`), app WABAGENT Dev (`1424483510748297`). API Graph `v26.0` (celle du moteur).

## Montage

- Serveur jetable sur `localhost:3000`, hors dépôt : il journalise l'heure, le chemin, si le `hub.verify_token` reçu est le bon, et pour un POST la taille du corps, la validité de `x-hub-signature-256` calculée avec le secret de l'app et les noms des champs (`entry[].changes[].field`), jamais le contenu.
- Tunnel `wabagent-dev` lancé avec une copie temporaire de sa configuration (`dev.wabagent.com` vers le port 3000) ; `~/.cloudflared/wabagent-dev.yml` n'est pas modifié.
- Adresse d'essai : `https://dev.wabagent.com/essai-r/<16 caractères hexadécimaux>`, jeton de vérification de 32 caractères hexadécimaux tiré au hasard.

## État de départ (lecture)

- Jeton `META_DEV_ACCESS_TOKEN` : utilisateur système de l'app WABAGENT Dev, sans expiration, portées `whatsapp_business_management`, `whatsapp_business_messaging`, `manage_app_solution`, `whatsapp_business_manage_events`, sans restriction de cible.
- `GET /<WABA>/subscribed_apps` : WABAGENT Dev et « WA DevX Webhook Events 1P App » (app interne de Meta), sans `override_callback_uri`.
- Webhook de l'app (`GET /<APP_ID>/subscriptions`) : `https://dev.wabagent.com/webhook/meta/<clé>`, objet `whatsapp_business_account`, saisi à la main pendant la recette.
- `webhook_configuration` du numéro : seulement `application`.

## Constats

1. **Meta fait le GET de vérification pendant l'appel, de façon synchrone.** `POST /<WABA>/subscribed_apps` avec `override_callback_uri` et un `verify_token` faux : GET reçu une seconde après l'appel (`user-agent: facebookplatform/1.0`, `hub.mode=subscribe`), notre serveur répond 403, Meta répond à l'appel :
   `{"error":{"message":"(#2200) Callback verification failed with the following errors: HTTP Status Code = 403; HTTP Message = Forbidden","type":"OAuthException","code":2200}}`.
   Rien n'est écrit : la relecture montre toujours `override_callback_uri` absent.
2. **Avec le bon jeton**, GET reçu, `hub.challenge` renvoyé, réponse `{"success":true}`. La relecture donne `override_callback_uri` sur l'entrée de WABAGENT Dev, et le numéro a `webhook_configuration` = `{whatsapp_business_account: <adresse d'essai>, application: <adresse de l'app>}`.
3. **Le niveau WABA passe avant le niveau app** : un message envoyé par François au numéro de test est arrivé en `POST` sur l'adresse d'essai (champ `messages`, 569 octets), pas sur celle de l'app.
4. **La signature reste celle du secret de l'app** abonnée : `x-hub-signature-256` valide avec le secret de WABAGENT Dev. Le contrôle actuel du moteur (secret d'application du compte) ne change pas.
5. **Permission** : les portées du jeton ci-dessus suffisent (`whatsapp_business_management` est la portée attendue pour `subscribed_apps` ; non isolée par un essai avec moins de portées).
6. **App non publiée et numéro de test** : l'override marche et les vrais messages arrivent. La bannière de Meta « une app non publiée ne reçoit que les webhooks de test » ne s'est pas appliquée ici au champ `messages` de ce numéro. Le mode de l'app (Développement ou publiée) n'a pas été lu par l'API ; à confirmer par François dans le tableau de bord.
7. **Retrait** : `POST /<WABA>/subscribed_apps` sans corps répond `{"success":true}`, efface `override_callback_uri` et ramène le numéro au seul niveau `application`. État de départ retrouvé et relu.

## Conséquences pour la spec

- Le moteur doit être joignable publiquement (`PUBLIC_BASE_URL`) et la route `GET /webhook/meta/<clé>` déjà en place doit répondre au défi **avant** la fin de l'appel : la clé, le jeton de vérification et le compte doivent être écrits en base avant d'appeler Meta, ou servis par un état transitoire. Sinon l'appel échoue en 2200.
- L'erreur 2200 est un cas à restituer (clé `error.reason` dédiée) : adresse injoignable, `PUBLIC_BASE_URL` absente ou fausse, tunnel arrêté.
- Abonner l'app ou poser l'override est un seul appel ; il remplace aussi l'abonnement simple (`POST subscribed_apps` sans corps) que l'administrateur faisait ou que Meta faisait déjà.
- Le retrait au débranchement ou à la suppression du compte est le même appel sans corps : il ramène la WABA au webhook de l'app, qui peut pointer ailleurs (autre produit du client). À décider : retirer, ou laisser.
- L'override est par WABA et par app : deux comptes WABAGENT sur la même WABA et la même app se marcheraient dessus (le dernier appel gagne). Point d'isolation pour la section « Impact multi-organisation ».
- Limite de 200 caractères de `override_callback_uri` : notre adresse fait environ 70 caractères avec `dev.wabagent.com`.

## Non testé

- Override au niveau du numéro (`POST /<PHONE_NUMBER_ID>` avec `webhook_configuration`), priorité la plus forte selon Meta.
- Jeton aux portées réduites (sans `whatsapp_business_management`).
- Numéro réel (+33 6 63 53 50 53, app WABAGENT) et app publiée.
- Comportement quand l'adresse d'override devient injoignable après coup (relais de Meta vers l'app, ou perte des messages).
