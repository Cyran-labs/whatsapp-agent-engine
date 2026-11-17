# Essai Meta du lot R2a : profil, photo, nom d'affichage, réenregistrement

Date : 17 nov. 2026. Tâche 0 du plan `docs/superpowers/plans/2026-11-17-r2a-guide-profil-nom.md`.

Essai mené par Claude Code avec François, sur la WABA de dev `1122051030798254` (portefeuille Wabagent `1270659448489249`, app WABAGENT Dev) et son numéro de test +1 555 164 9072 (`phone_number_id` `1444139162121271`), avec l'API Graph `v26.0`, le jeton de l'utilisateur système et `appsecret_proof`. Chaque écriture a été faite avec l'accord de François. Aucun jeton, secret ni code n'est reproduit ici.

## 1. Champs du nom d'affichage

- Sur `/<PHONE_NUMBER_ID>` et dans la liste `/<WABA>/phone_numbers`, les champs utiles sont :
  - `verified_name` : le nom affiché aux contacts ;
  - `name_status` : l'état du nom affiché ;
  - `new_name_status` : l'état de la demande ;
  - `new_display_name` : le nom demandé, absent tant qu'aucune demande n'existe.
- Valeurs observées :
  - au départ : `name_status = AVAILABLE_WITHOUT_REVIEW`, `new_name_status = NONE` ;
  - après `POST /<PHONE_NUMBER_ID>` avec `{"new_display_name":"Wabagent Test"}` (réponse `{"success":true}`), immédiatement : `new_name_status = AVAILABLE_WITHOUT_REVIEW`, `new_display_name = "Wabagent Test"`, `verified_name` inchangé (« Test Number »). C'est l'état « approuvé, à appliquer » de la spec ;
  - après le réenregistrement (§3) : `verified_name = "Wabagent Test"`, `new_name_status = NONE`, `new_display_name` absent.
- Conséquence pour la règle du nom affiché (spec §6.3) : `verified_name` n'est **pas** mis à jour par l'approbation. Il ne change qu'au réenregistrement. `display_name` peut donc continuer à venir de `verified_name`, et le nom demandé vient de `new_display_name`.
- `approved_pending` correspond à `new_name_status ∈ {APPROVED, AVAILABLE_WITHOUT_REVIEW}` avec `new_display_name` présent. Les autres valeurs (`PENDING_REVIEW`, `DECLINED`, `EXPIRED`, etc.) n'ont pas été observées ; elles viennent de la documentation de Meta.
- L'événement `phone_number_name_update` n'a pas été observé : le moteur et le tunnel ne tournaient pas. Sa date d'approbation est donc inconnue, et c'est la date de la première relecture qui fait foi (`apply_before_approx: true`), comme le prévoit la spec. À observer en recette.
- La limite des 10 changements par 30 jours n'a pas été atteinte (1 demande), et son code d'erreur n'a pas été relevé.

## 2. Le nom du numéro de test peut-il changer ?

Oui. La demande est acceptée sans revue, et le nom est appliqué après le réenregistrement. Le parcours du nom peut donc être recetté en réel sur le numéro de test.

## 3. Réenregistrement et code de vérification en deux étapes

- `POST /<PHONE_NUMBER_ID>/register` avec `{"messaging_product":"whatsapp","pin":"<6 chiffres>"}` répond `{"success":true}` et applique le nom approuvé.
- **Webhooks inchangés.** Avant et après le réenregistrement :
  - `GET /<WABA>/subscribed_apps` rend la même entrée pour l'app WABAGENT Dev, avec la même `override_callback_uri` ;
  - le champ `webhook_configuration` du numéro garde la même adresse aux niveaux WABA et app.
- **Réception d'un message après le réenregistrement : non vérifiée** (moteur arrêté). À faire en recette (plan, tâche 12, point 6).
- **Numéro de test : le code n'est jamais exigé.**
  - `is_pin_enabled` vaut `false` au départ ;
  - le réenregistrement avec un code quelconque réussit et ne pose aucun code (`is_pin_enabled` reste `false`) ;
  - la pose du code par `POST /<PHONE_NUMBER_ID>` avec `{"pin":"…"}` répond `{"success":true}`, mais `is_pin_enabled` reste `false`, même relu 20 secondes plus tard ;
  - un réenregistrement avec un mauvais code réussit ensuite comme avec le bon.
  - Le réglage « Vérification en deux étapes » n'apparaît pas dans WhatsApp Manager pour ce numéro (constat de François).
- **Non observé** : le refus d'un mauvais code sur un numéro dont le code est actif, et son code d'erreur. La documentation de Meta cite le code `133005` (code de vérification en deux étapes erroné) ; il n'est pas vérifié ici. Il faut un vrai numéro pour le voir.
- Quatre réenregistrements ont été faits au total. Aucune limite de débit n'a été rencontrée.

## 4. Photo de profil

- Chemin qui marche avec le jeton de l'utilisateur système :
  1. `POST /<APP_ID>/uploads?file_length=<octets>&file_type=<type>&appsecret_proof=…` rend `{"id":"upload:…?sig=…"}` ;
  2. `POST /<id de session>` avec `Authorization: OAuth <jeton>`, l'en-tête `file_offset: 0` et le fichier en corps rend `{"h":"<handle>"}`. Piège rencontré : il ne faut pas ajouter `appsecret_proof` à l'adresse de session (qui porte déjà `?sig=`), sinon l'appel échoue avec « HMAC check failed » ;
  3. `POST /<PHONE_NUMBER_ID>/whatsapp_business_profile` avec `profile_picture_handle` rend `{"success":true}`. La lecture rend ensuite `profile_picture_url` (adresse `pps.whatsapp.net`).
- Résultats :
  - JPEG et PNG acceptés ;
  - résolution minimale 192 × 192 pixels : à 191 pixels, Meta répond `code 1`, `error_subcode 3441013`, avec le message « Veuillez importer une image JPG dont la résolution est supérieure à 192 pixels * 192 pixels » ;
  - GIF : seul un GIF de 1 × 1 a été essayé, refusé pour sa résolution ; un GIF de taille suffisante n'a pas été essayé ;
  - poids : un PNG de 6,7 Mo a été accepté, la limite haute de Meta n'a pas été atteinte.
- Le retrait d'une photo par l'API n'a pas été essayé. Le numéro de test garde un carré vert uni de 640 pixels.

## 5. Profil : longueurs, secteurs, vidage

- Les longueurs maximales se comptent en caractères (points de code) : 139 emoji passent dans `about`, 140 sont refusés.
  - `about` : 139 ;
  - `description` : 512 ;
  - `address` : 256 ;
  - `email` : 128.
  - Au-delà, Meta répond `code 100`, avec le message « Param <champ> must be at most <n> characters long. »
- `websites` : 2 au plus. À 3, Meta répond `code 105`, avec « The parameter websites must have at most 2 elements, 3 found. »
  - une adresse sans schéma (`example.com`) est acceptée ;
  - une adresse de plus de 250 caractères est acceptée ;
  - Meta ajoute une barre finale (`https://example.com/`).
- `email` : la forme n'est pas contrôlée par Meta (« pas-un-email » accepté).
- `vertical` : liste fermée de 22 valeurs. Hors liste, Meta répond `code 100` avec la liste : `OTHER, AUTO, BEAUTY, APPAREL, EDU, ENTERTAIN, EVENT_PLAN, FINANCE, GROCERY, GOVT, HOTEL, HEALTH, NONPROFIT, PROF_SERVICES, RETAIL, TRAVEL, RESTAURANT, ALCOHOL, ONLINE_GAMBLING, PHYSICAL_GAMBLING, OTC_DRUGS, MATRIMONY_SERVICE`.
- Vidage :
  - `address`, `description`, `email` et `websites: []` se vident ;
  - `about` ne se vide pas : la valeur vide ou un espace donne une erreur 500, `code 131000`, « Something went wrong ».
- État laissé :
  - le profil du numéro de test garde les valeurs d'essai (`about` en emoji, etc.) ;
  - le nom affiché est « Wabagent Test » ;
  - un code a été posé par l'API, sans effet visible (`is_pin_enabled = false`) ; c'est celui de `META_DEV_PIN` dans le `.env` du dépôt.

## 6. Adresses du guide

Non vérifiées dans cet essai. Elles le seront avec François dans les vraies pages, en recette (plan, tâche 12, point 1) ; la forme `settings/system_users` reste « à confirmer ». En attendant, `metaLinks` marque `systemUsers` comme générique.

## 7. Incident

Pendant l'essai, la clé d'URL du webhook du compte de dev est apparue en clair dans la conversation : le filtre de sortie du script ne masquait pas les barres échappées. Elle n'est écrite dans aucun fichier. Elle sera changée au premier pas de la recette, qui retire le compte puis le raccorde de nouveau.

## 8. Conséquences sur le plan

- `‹essai›` longueurs : `about` 1 à 139 (jamais vide), `description` 0 à 512, `address` 0 à 256, `email` 0 à 128 (le moteur contrôle la forme, Meta ne le fait pas), `websites` 0 à 2 adresses de 1 à 256 caractères, `WHATSAPP_VERTICALS` = les 22 valeurs ci-dessus.
- Le compteur de caractères du web compte en points de code (`[...texte].length`), comme Meta.
- `‹essai›` photo : JPEG et PNG, 192 × 192 pixels au minimum (contrôlé par Meta, refus `3441013` restitué en `photo_invalid`).
- `‹essai›` champs du nom : `verified_name`, `name_status`, `new_name_status`, `new_display_name`, plus `is_pin_enabled`.
- `‹essai›` code du mauvais code : `133005` selon Meta, non vérifié. Le moteur reconnaît `133005` et garde une restitution générique pour tout autre refus du réenregistrement.
- Pas d'effet de bord sur les webhooks : la porte de sortie de la spec (§4, essai 3) n'est pas déclenchée.
- Questions pour François, voir le rapport de la tâche 0 dans le registre d'exécution.
