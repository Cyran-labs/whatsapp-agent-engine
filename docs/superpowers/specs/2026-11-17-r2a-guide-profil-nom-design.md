# Lot R2a : guide en deux temps, profil WhatsApp et nom d'affichage

Date : 17 nov. 2026. Statut : relue par un builder neuf le 17 nov. 2026, à approuver par François.

Sources d'autorité :
- `docs/ROADMAP.md`, section R (ligne R2) ;
- spec R1 (`docs/superpowers/specs/2026-11-12-raccordement-automatique-r1-design.md`), §12 compris ;
- registre d'exécution R1 : `.superpowers/sdd/2026-11-12-raccordement-automatique-r1/progress.md` (adresses Meta relevées par François, lignes 166 à 175) ;
- maquettes validées par François :
  - `.superpowers/brainstorm/49361-1794600018/content/01-portefeuille-saisie.html` (variante A) ;
  - `02-guide-liens-precis.html` ;
  - `03-deux-chemins.html` (13 nov. 2026) ;
  - `.superpowers/brainstorm/43584-1794928324/content/04-profil-et-nom.html` (17 nov. 2026) ;
- décisions de François du 13, du 14 et du 17 nov. 2026 (brainstorm R2a, reprises au §11).

## 1. Intention

R1 a supprimé la recopie du webhook dans Meta. Deux douleurs restent.

1. **Le guide de raccordement envoie sur des pages génériques de Meta.** L'administrateur arrive sur le dernier portefeuille ou la dernière WABA ouverts, parfois les mauvais, et doit chercher ses informations dans une nomenclature difficile. En recette R1 (13 nov. 2026), le lien de l'étape 4 ouvrait la vue d'ensemble et non la bonne page.
2. **Pour régler ce que voit le contact, il faut aller dans WhatsApp Manager.** C'est le cas du profil de l'entreprise (description, adresse, photo, etc.) et du nom affiché au-dessus des messages.

Principe de François, repris de R1 : tout ce que l'API de Meta permet, WABAGENT le fait. Ce que l'API ne permet pas devient un prérequis guidé avec des liens qui ouvrent la bonne page.

## 2. Objectifs, non-objectifs, anti-objectifs

Objectifs :
- **guide en deux temps.** D'abord le portefeuille Meta Business, dans un seul champ qui accepte une adresse de page Meta Business ou l'identifiant seul. Ensuite deux chemins, « J'ai déjà un compte WhatsApp Business » et « Je pars de zéro ». Chaque lien dont la forme est connue ouvre la page de ce portefeuille, et de cette WABA quand elle est connue ;
- **portefeuille gardé avec le compte.** Le moteur le relit chez Meta et s'en sert pour les liens des alertes et des menus ;
- **profil WhatsApp lu et modifié depuis WABAGENT**, avec un aperçu de ce que voit le contact ;
- **nom d'affichage.** L'administrateur voit le nom actuel, peut demander un autre nom et suit l'état de la demande. Une fois le nom approuvé, il l'applique en saisissant le PIN du numéro ;
- **phrase dans le résultat du raccordement** quand la WABA était déjà abonnée et que le webhook de l'app pointe vers un autre produit (reportée de R1, registre R1 ligne 155).

Non-objectifs :
- ajout et enregistrement d'un nouveau numéro, avec code SMS ou appel, PIN et quota (lot R2b) ;
- migration d'un numéro depuis un autre prestataire. Un compte géré par un autre prestataire (360dialog, Twilio, etc.) est signalé dans le guide par « contactez-nous », sans parcours ;
- Embedded Signup ; modèles de messages ; catalogue (chantier C) ;
- CM.com : aucun profil ni nom d'affichage par l'API connue, l'entrée « Profil WhatsApp » n'existe pas pour un compte CM.com ;
- copie du profil en base (approche A retenue, §3).

Anti-objectifs (échec même si tout le reste marche) :
- un profil ou un nom lu ou écrit avec les identifiants d'un autre compte que celui du numéro, ou pour un numéro d'une autre organisation ;
- un PIN gardé, journalisé, renvoyé dans une réponse, un détail d'erreur ou une trace d'audit ;
- un lien du guide présenté comme précis alors qu'il ouvre une page générique. La maquette 02 distingue « précis » et « générique » ; un lien dont la forme n'a pas été vérifiée dans les vraies pages reste générique ;
- un compte raccordé dans un portefeuille différent de celui saisi, sans que l'administrateur le sache ;
- un nom présenté comme « affiché » alors que Meta ne l'affiche pas encore, notamment s'il est approuvé mais pas appliqué ;
- un bouton « Enregistrer » du profil qui dit « enregistré » sans avoir relu le profil chez Meta ;
- un champ du profil ou du nom accepté par l'écran puis refusé par Meta sans raison lisible.

## 3. Approches (choisie : A)

- **A. Profil lu chez Meta à l'ouverture, état du nom gardé avec le numéro (choisie par François le 17 nov. 2026).**
  - Le profil n'est jamais stocké. La fenêtre le lit par le moteur à chaque ouverture ; l'enregistrement l'écrit chez Meta puis le relit.
  - Le nom demandé et l'état de la demande sont des colonnes du numéro, mises à jour par la relecture des numéros qui existe déjà. Cette relecture est déclenchée par les événements `phone_number_*` (`src/whatsapp/meta-events.ts:35`), dont `phone_number_name_update`.
  - En échange, si Meta ne répond pas, la fenêtre ne s'ouvre pas et le dit, avec « Réessayer ».
- **B. Tout gardé en base.** Écartée : la copie se périme dès que le client modifie son profil dans WhatsApp Manager. On garderait aussi des données de plus (adresse, e-mail) à protéger au chantier S, pour un gain faible, puisqu'on ne modifie pas un profil sans Meta de toute façon.
- **C. Tout lu à la demande, nom compris.** Écartée : le tableau de Connexions appellerait Meta pour chaque numéro à chaque affichage, et l'état « approuvé, à appliquer », urgent à cause des 14 jours, ne se verrait pas sans ouvrir la fenêtre.

Un seul lot : une spec, un plan, une recette (décision de François du 17 nov. 2026).

## 4. Ce qui est établi, ce qui reste à essayer

Établi :
- `GET /<WABA>?fields=owner_business_info` avec le jeton du compte et `appsecret_proof` rend le nom et l'identifiant du portefeuille propriétaire (essai du 14 nov. 2026 sur la WABA de dev : « Wabagent », 1270659448489249). La phrase du §3 de la spec R1 selon laquelle « le portefeuille ne se trouve pas à partir du jeton seul » est donc fausse à partir de la WABA : elle reste vraie sans WABA ;
- dans l'adresse de WhatsApp Manager, `asset_id` est le WABA ID (recette R1, registre ligne 166) ;
- documentation de Meta, à confirmer par l'essai :
  - le nom se change par l'API, champ `new_display_name` du numéro, avec 10 changements au plus par 30 jours ;
  - l'approbation met à jour `verified_name` et `name_status` et déclenche `phone_number_name_update` ;
  - après l'approbation, il faut réenregistrer le numéro dans les 14 jours (`POST /<PHONE_NUMBER_ID>/register` avec le PIN à 6 chiffres), sinon la demande est à refaire ;
- le profil se lit et s'écrit par `/<PHONE_NUMBER_ID>/whatsapp_business_profile` : `about`, `description`, `address`, `email`, `websites` (2 au plus), `vertical`, `profile_picture_url` en lecture. La photo s'écrit par un `profile_picture_handle` obtenu par l'API d'envoi de fichiers de Meta (`/<APP_ID>/uploads`). L'identifiant de l'app est connu du compte (`meta_app_id`, R1).

À essayer en tâche 0 du plan, sur la WABA de dev, avant toute écriture de code produit, avec le résultat consigné dans `docs/superpowers/research/` :
1. les champs exacts du numéro qui portent le nom demandé et son état (`name_status`, `new_name_status`, `new_display_name` ou autre), leurs valeurs possibles et ce que porte l'événement `phone_number_name_update` (date d'approbation ou non) ;
2. si le nom du numéro de test peut être changé. Sinon, le parcours « Demander un autre nom » ne sera recetté en réel que sur un vrai numéro, voir §10 ;
3. le réenregistrement : effet sur les messages en cours, effet sur les adresses de webhook (numéro, WABA, app), erreur rendue avec un mauvais code, comportement quand le numéro n'a pas de code de vérification en deux étapes, changement du code dans WhatsApp Manager sans l'ancien, quota ;
4. l'envoi de la photo avec le jeton de l'utilisateur système ; formats et tailles acceptés ;
5. les longueurs maximales et la liste des secteurs (`vertical`) rendues ou refusées par Meta ;
6. la forme des adresses du guide marquées « à confirmer » (utilisateurs système notamment), vérifiée avec François dans les vraies pages.

Si l'essai 4 échoue, la photo sort du lot. La fenêtre dit alors « La photo se change dans WhatsApp Manager », avec le lien précis. Si l'essai 3 montre un effet de bord sur les adresses de webhook, on revient vers François avant d'écrire le plan de cette partie.

## 5. Parcours de l'utilisateur

### 5.1 Raccorder (guide en deux temps)

1. Organisation › Connexions › Raccorder, mode Meta.
2. **Étape 1, votre portefeuille Meta Business** (maquette 01, variante A) :
   - un seul champ, qui accepte une adresse de page Meta Business (`business_id=` dans l'adresse) ou l'identifiant seul ;
   - l'aide « Où trouver l'identifiant ? » est dépliée dessous, avec le schéma dessiné de la page « Informations sur le portefeuille business » et le lien vers cette page.
   - Reconnu, le champ dit « Portefeuille <identifiant> reconnu ». C'est un contrôle de forme : sans jeton, WABAGENT ne peut rien lire chez Meta à ce stade, et il ne montre donc pas de nom de portefeuille à l'étape 1.
   - Si l'adresse collée contient aussi `asset_id` (adresse de WhatsApp Manager), la WABA est préremplie et le chemin 1 est présélectionné : un seul collage donne les deux.
3. **Choix du chemin** : « J'ai déjà un compte WhatsApp Business » ou « Je pars de zéro ». Les étapes de chaque chemin sont celles de la maquette 03 ; le bloc « Recommandé » de R1 reste en bas, commun aux deux.
   - Chemin 1 : WABA, numéro (facultatif au départ), app reliée à ce compte (« Sans app, créez-la et choisissez ce compte »), utilisateur système et jeton, secret de l'app.
   - Chemin 2 : créer l'app (Meta crée alors une WABA et un numéro de test), relever la WABA créée, numéro (facultatif, le numéro de test suffit pour essayer), utilisateur système et jeton, secret de l'app.
   - Dans les deux chemins, une ligne dit : « Votre compte WhatsApp est géré par un autre prestataire (360dialog, Twilio…) ? Contactez-nous. » Pas de parcours dans ce lot.
4. Les liens « précis » ouvrent la page du portefeuille, et de la WABA quand elle est connue, selon les adresses relevées (registre R1, lignes 168 à 174). Les liens vers Meta for Developers (apps, secret) restent génériques : aucun paramètre de portefeuille n'y est connu.
5. Le formulaire garde ses quatre saisies de R1 (nom, WABA ID, jeton, secret). Le portefeuille s'y ajoute, rempli par l'étape 1. Le champ WABA accepte aussi l'adresse de sa page (maquette 03, chemin 2) et en extrait `asset_id`.
6. **Au raccordement**, le moteur lit `owner_business_info` de la WABA avec le jeton, parmi les lectures de vérification et avant toute écriture chez Meta (règle du §7.1 de la spec 2b) :
   - même portefeuille que celui saisi : le nom et l'identifiant du portefeuille sont gardés avec le compte, et le résultat dit « Portefeuille <nom> ».
   - portefeuille différent : refus avant toute écriture, raison `whatsapp_account.business_mismatch`, avec le texte : « Ce compte WhatsApp appartient au portefeuille <nom> (<identifiant>), pas à celui que vous avez saisi. Vérifiez le portefeuille ou le WABA ID. »
   - lecture impossible : refus avant toute écriture, « Réessayez dans un moment » (raison `whatsapp_account.business_unreadable`, détail transitoire). Rien n'est raccordé sans que le portefeuille saisi soit vérifié (décision de François du 17 nov. 2026). L'étape du portefeuille est obligatoire dans le guide (maquette 01) ; un appel par l'API sans `business_id` raccorde sans comparaison, comme un compte R1.
7. **Phrase reportée de R1** : quand la WABA était déjà abonnée à l'app et que le webhook de l'app pointe vers un autre produit, le résultat dit que les messages de ce compte WhatsApp arrivent désormais dans WABAGENT et que l'autre produit ne les reçoit plus. Texte exact au builder, à valider en recette.

Portefeuille relu différent de celui gardé (WABA déplacée chez Meta, cas rare : le remplacement des identifiants ne peut pas changer de WABA) : la valeur lue chez Meta remplace l'ancienne, puisque c'est elle qui rend les liens justes, et le changement est écrit dans la trace d'administration. Pas d'alerte ni d'erreur du compte (choix du rédacteur).

Comptes déjà raccordés (R1) : le portefeuille est lu à la prochaine « Vérifier maintenant », au prochain remplacement des identifiants ou à la prochaine relecture des numéros. Il est comparé à rien, puisqu'aucun portefeuille n'a été saisi. « Remplacer les identifiants » ne demande pas le portefeuille, il le relit.

### 5.2 Profil WhatsApp

1. Connexions, ligne d'un numéro d'un compte Meta, menu « Gérer », première entrée « Profil WhatsApp » (maquette 04, partie 1). L'entrée n'existe pas pour un numéro retiré chez le fournisseur (`provider_state = 'removed'`), ni pour un compte CM.com.
2. La fenêtre lit le profil chez Meta. Pendant la lecture, elle montre un squelette. En échec, elle affiche la raison lisible (même restitution que les autres appels à Meta) et « Réessayer ».
3. Champs, dans l'ordre de la maquette : photo, infos (`about`, sous le nom), description, secteur (liste), adresse, e-mail, sites web (2 au plus). Chaque champ texte montre son compteur de caractères avec la limite confirmée par l'essai 5.
4. L'aperçu « ce que voit le contact » suit la saisie. Il est indicatif : le rendu exact dépend de l'application WhatsApp du contact.
5. « Enregistrer » envoie seulement les champs modifiés, puis relit le profil. La fenêtre affiche la version relue et « Profil enregistré chez Meta. » Si Meta refuse un champ, la raison est montrée sous ce champ quand Meta le désigne, en tête de fenêtre sinon.
6. Photo : « Changer la photo » choisit un fichier (formats et taille selon l'essai 4). Le fichier passe par le moteur, est envoyé à Meta, puis le profil est relu. Le fichier n'est pas gardé.

### 5.3 Nom d'affichage

1. Le tableau des numéros gagne une colonne « Nom affiché » : le nom réellement affiché aux contacts, avec une étiquette quand une demande est en cours (maquette 04, partie 1). Un nom approuvé mais pas encore appliqué n'y apparaît jamais comme nom affiché (§6.3, règle du nom affiché).
2. L'encart « Nom affiché », en tête de la fenêtre du profil, a quatre états (maquette 04, partie 3) :
   - **en revue chez Meta** : le nom actuel, le nom demandé et sa date. Le nom actuel reste affiché pendant la revue ;
   - **refusé** : le nom refusé, la raison quand Meta la donne, un lien vers les règles de Meta et « Demander un autre nom » ;
   - **approuvé, à appliquer** : le nom approuvé, la date limite (approbation plus 14 jours, §6.3), un champ « Code de vérification en deux étapes » (6 chiffres) et « Appliquer le nouveau nom ». Sous le champ : « Le code à 6 chiffres de la vérification en deux étapes de ce numéro, choisi dans WhatsApp Manager. Code oublié ou jamais créé : réglez-le d'abord dans WhatsApp Manager ↗ », avec le lien précis vers la page du numéro. Ce code est propre à Meta, sans rapport avec le PIN d'une carte SIM : l'écran ne dit jamais « PIN » seul (décision de François du 17 nov. 2026). WABAGENT ne fait pas créer un code par ce champ : l'administrateur le règle lui-même chez Meta ;
   - **appliqué** (ou aucune demande) : le nom affiché, l'étiquette « Approuvé » et le rappel des 10 changements au plus par 30 jours.
3. « Demander un autre nom » ouvre un champ et envoie la demande. Le résultat est relu chez Meta et l'état passe en revue. Meta revoit en général en 1 à 2 jours : la fenêtre le dit sans le promettre.
4. « Appliquer le nouveau nom » réenregistre le numéro avec le PIN saisi :
   - réussi : relecture du numéro, état « appliqué » ;
   - code refusé par Meta : raison `whatsapp_account.pin_rejected`, avec le texte : « Code de vérification en deux étapes refusé par Meta. Vérifiez-le ou changez-le dans WhatsApp Manager. » et le lien précis vers la page du numéro ;
   - délai de 14 jours dépassé : l'encart repasse à « Demander un autre nom », avec la phrase qui le dit.
5. Une alerte de la carte du compte signale un nom « approuvé, à appliquer », avec sa date limite, pour qu'il ne se perde pas sans ouvrir la fenêtre.

### 5.4 Liens précis ailleurs

Avec un portefeuille gardé, les liens existants vers Meta (menu « Ouvrir dans WhatsApp Manager », alertes de la carte du compte, encart Numéro de la page de l'agent IA) ouvrent la page du portefeuille et de la WABA. Sans portefeuille, ils restent ceux d'aujourd'hui (`whatsAppManagerUrl`).

## 6. Comportements du moteur

### 6.1 Données

- Compte WhatsApp : `meta_business_id` et `meta_business_name`, nuls tant qu'ils ne sont pas lus ; ce sont des données Meta publiques pour le client et non des secrets. Écrits seulement par une lecture réussie avec le jeton du compte.
- Numéro : nom demandé, état de la demande, date d'approbation observée. Colonnes exactes selon l'essai 1. Mises à jour par la relecture des numéros (`fetchNumbers`, champs ajoutés à la requête) et par les écritures du §6.3.
- Le profil n'est jamais écrit en base (approche A).
- Migrations : colonnes ajoutées, nulles par défaut, sur SQLite et Postgres. Aucune donnée supprimée.

### 6.2 Profil

- Lecture et écriture par le moteur seulement, avec les identifiants du compte du numéro (`appsecret_proof` compris), sur le `provider_number_id` du numéro.
- L'écriture valide les champs (longueurs, forme de l'e-mail et des adresses web, nombre de sites, secteur dans la liste) avant l'appel à Meta. Un refus de forme répond 400 `VALIDATION_ERROR` sans appel.
- Le corps d'une écriture de profil n'est jamais journalisé (règle `check:logs` : il contient adresse et e-mail).
- Photo : le moteur reçoit le fichier, contrôle le type et la taille, l'envoie à Meta, pose le handle, relit le profil. Le fichier est tenu en mémoire et non écrit sur disque. Le chemin exact entre le web et le moteur (corps binaire, limite de taille propre à cette route) est laissé au builder, avec la contrainte qu'il ne rouvre pas la limite de taille des autres routes d'administration.

### 6.3 Nom d'affichage

- Demande : écriture de `new_display_name` sur le numéro chez Meta, puis relecture du numéro.
- État : relu à chaque relecture des numéros, et donc après `phone_number_name_update`.
- Règle du nom affiché (choix du rédacteur, relecture du builder) : aujourd'hui `display_name` est rempli depuis `verified_name` à chaque relecture (`meta-graph.ts:311`). Si l'approbation met à jour `verified_name` avant le réenregistrement, la relecture ne doit plus écraser le nom affiché avec ce nom : le nom approuvé va dans la demande, et le nom affiché ne change qu'à la fin d'un réenregistrement réussi, ou quand Meta indique que le nom est appliqué. Si l'essai 1 ne permet pas de distinguer « approuvé, à appliquer » et « appliqué », WABAGENT tient cet état lui-même : il passe à « appliqué » sur un réenregistrement réussi depuis WABAGENT. Un réenregistrement fait hors de WABAGENT reste alors invisible jusqu'à ce que Meta le dise, et la limite est écrite dans le rapport de l'essai. Test qui casse si une relecture fait apparaître un nom approuvé non appliqué comme nom affiché.
- Date limite : date d'approbation plus 14 jours. Elle est seulement affichée : le moteur ne bloque pas l'application à cette date, puisqu'elle peut n'être qu'approchée. C'est le refus de Meta qui fait passer l'encart à « Demander un autre nom » (`name_apply_expired`). Si l'événement de Meta porte la date d'approbation (essai 1), on la prend ; sinon c'est la première relecture qui observe l'approbation, et l'écran dit « avant le <date> environ ».
- Application : `POST /<PHONE_NUMBER_ID>/register` avec le PIN et `messaging_product`, puis relecture. Règles strictes pour le PIN :
  - il n'est jamais écrit en base ni gardé en mémoire au-delà de la requête ;
  - il n'est jamais journalisé, ni renvoyé dans une réponse, un détail d'erreur ou une trace d'audit ;
  - il est validé comme 6 chiffres avant l'appel.
- Les autres effets du réenregistrement (adresses de webhook, messages) suivent l'essai 3.
- Chaque action (demande de nom, application, écriture du profil, photo) est tracée dans la journalisation d'administration existante, sans le contenu : qui, quel numéro, quelle action, réussite ou raison.

### 6.4 Routes (API d'administration, `connections.manage`)

Toutes sous `/whatsapp-accounts/:accountId/numbers/:numberId`. Le compte est retrouvé dans l'organisation active (404 sinon, comme aujourd'hui) et le numéro doit appartenir à ce compte (404 sinon) :
- `GET …/profile` : profil lu chez Meta ;
- `PUT …/profile` : champs modifiés ; réponse = profil relu ;
- `POST …/profile/photo` : fichier ; réponse = profil relu ;
- `POST …/display-name` : `{ new_display_name }` ; réponse = vue du numéro relue ;
- `POST …/display-name/apply` : `{ pin }` ; réponse = vue du numéro relue.

Compte CM.com ou numéro retiré chez le fournisseur : refus avec raison (`whatsapp_account.profile_unsupported`, `whatsapp_account.number_removed` si elle n'existe pas déjà), sans appel extérieur.

### 6.5 Raisons nouvelles (`ERROR_REASONS`)

`whatsapp_account.business_mismatch`, `whatsapp_account.business_unreadable`, `whatsapp_account.pin_rejected`, `whatsapp_account.name_change_limit` (10 par 30 jours), `whatsapp_account.name_apply_expired`, `whatsapp_account.profile_unsupported`, `whatsapp_account.photo_invalid`, plus celles que l'essai fait apparaître. Chacune a son texte français et son test de restitution (règle du lot « Restitution des erreurs »).

## 7. Écrans

- Guide : remplace le guide Meta de R1 (`connect-guide-meta.tsx`) par l'étape du portefeuille et les deux chemins, selon les maquettes 01 (variante A), 02 et 03. Le schéma de la page « Informations sur le portefeuille business » est dessiné, et non une capture.
- Résultat du raccordement : portefeuille reconnu, refus `business_mismatch`, phrase reportée de R1 (§5.1, point 7).
- Tableau des numéros : colonne « Nom affiché », entrée « Profil WhatsApp » en tête du menu « Gérer » (maquette 04).
- Fenêtre « Profil WhatsApp » : encart du nom en tête, champs du profil, aperçu (maquette 04). Elle suit les règles des fenêtres existantes (`dialog-ui.tsx`, retour du focus).
- Textes français avec accents, vocabulaire de `CLAUDE.md`, sans tiret cadratin ni demi-cadratin. Les libellés exacts des pages Meta cités dans le guide sont relevés en recette avec François, dans les vraies pages.
- Droits : Connexions est réservé à l'administrateur (`connections.manage`, aucune lecture pour les autres rôles). Le profil et le nom suivent cette règle. Ceci corrige une proposition du brainstorm du 17 nov. 2026, qui parlait d'une lecture par les autres rôles : cette lecture n'existe pas aujourd'hui et ce lot ne l'ajoute pas.

## 8. Contrats changés

- `WhatsAppAccountView` : `business` (`{ id, name } | null`).
- `WhatsAppNumberView` : `display_name_request` (`{ requested_name, status, approved_at, apply_before } | null`, forme exacte selon l'essai 1).
- Nouveaux types : `WhatsAppBusinessProfileView` (lecture), `UpdateWhatsAppBusinessProfileInput`, `RequestDisplayNameInput`, `ApplyDisplayNameInput` (le PIN n'apparaît que dans ce type d'entrée).
- `CreateWhatsAppAccountInput` : `business_id` facultatif (chiffres seuls ; l'extraction depuis une adresse se fait dans le web, le moteur ne reçoit que l'identifiant).
- Fonctions partagées des contrats : extraction de `business_id` et `asset_id` depuis une adresse Meta, construction des liens précis. Une seule source pour le web, testée sur les adresses relevées au registre R1.
- `ERROR_REASONS` : §6.5.

## 9. Impact multi-organisation

Ce qui pourrait fuir, agir à tort ou utiliser de mauvais identifiants, et le test qui l'empêche :

1. **Profil ou nom d'un numéro d'une autre organisation** : une requête avec un `accountId` ou un `numberId` d'une autre organisation répond 404, sans appel à Meta. Test dans `src/__tests__/isolation/` sur SQLite et Postgres : deux organisations ; lecture, écriture du profil, photo, demande et application du nom croisées ; le faux Meta ne reçoit aucun appel.
2. **Numéro d'un autre compte de la même organisation** : un `numberId` qui n'appartient pas à `accountId` répond 404, sans appel. Test.
3. **Mauvais identifiants envoyés à Meta** : l'appel part avec le jeton et le secret du compte du numéro, sur le `provider_number_id` de ce numéro, jamais avec un repli de plateforme ni d'environnement. Test qui contrôle le jeton, l'`appsecret_proof` et le chemin reçus par le faux Meta, avec deux comptes aux identifiants distincts.
4. **PIN** : jamais en base, jamais dans les journaux, les réponses, les détails d'erreur ou la trace d'audit. Tests :
   - un PIN reconnaissable ne se retrouve ni dans la base après l'appel, ni dans les journaux capturés, ni dans la réponse, réussite et échec compris ;
   - `check:logs` refuse un journal qui contient `pin`.
5. **Portefeuille** : le portefeuille gardé vient seulement d'une lecture avec le jeton du compte ; un portefeuille saisi différent refuse le raccordement avant toute écriture chez Meta. Tests : refus `business_mismatch` sans aucun `POST` reçu par le faux Meta ; portefeuille d'un compte jamais montré à une autre organisation (vue de compte croisée, déjà en 404).
6. **Événement `phone_number_name_update`** : il est traité par le compte retrouvé par la clé d'URL, après authentification (règle inchangée), et ne relit que les numéros de ce compte. Test : un événement signé pour le compte de l'organisation A ne change pas l'état du nom d'un numéro de l'organisation B qui porterait le même `provider_number_id` dans la donnée du test.
7. **Liens précis** : construits avec le portefeuille et la WABA du compte affiché seulement. Test web : deux comptes de portefeuilles différents, chaque lien porte le sien.

Relecture d'isolation : tâche dédiée du plan (spec 2b, §4.5). Le relecteur ne reçoit pas les conclusions de l'implémenteur et lit le code modifié ainsi que le code qu'il appelle ou qui l'appelle (relecture des numéros, routage du webhook, journalisation).

## 10. Vérification

- Tests moteur sur SQLite et Postgres, tests web, `check:tests`, `check:logs`, typecheck, e2e sur le faux moteur.
- Faux Meta étendu : profil (lecture, écriture, refus de champ), envoi de photo, demande de nom, réenregistrement (réussite, mauvais PIN), `owner_business_info`.
- Recette en réel avec François, pilotée par Claude Code (navigateur et terminal) :
  - guide : chaque lien précis ouvert dans les vraies pages, les deux chemins, le collage unique, le refus `business_mismatch` ;
  - profil : lecture, modification, photo, vérification dans l'application WhatsApp d'un contact ;
  - nom : demande, revue, application avec le PIN.
  - Si le nom du numéro de test ne peut pas changer (essai 2), le parcours du nom n'est recetté en réel que sur un vrai numéro de François. Sinon il est recetté sur le faux Meta, et c'est dit dans le rapport de recette.
- Chaque décision produit visible prise en cours d'exécution devient une étape de recette (audit des décisions, `CLAUDE.md`).

## 11. Décisions de François (brainstorm R2a)

- 13 nov. 2026 : saisie du portefeuille en variante A ; deux chemins après le portefeuille ; maquette 03 acceptée, à valider définitivement en recette.
- 14 nov. 2026 :
  - découpage : R2a contient le guide, le profil et le nom d'affichage ; R2b contient l'ajout d'un numéro ;
  - le portefeuille est relu par le jeton et gardé avec le compte.
- 17 nov. 2026 :
  - maquette 04 validée ;
  - option A pour le PIN (demandé au moment d'appliquer le nom, jamais gardé), appelé « code de vérification en deux étapes » à l'écran, avec le renvoi vers WhatsApp Manager si le code est oublié ou jamais créé ;
  - portefeuille illisible au raccordement : refus « Réessayez dans un moment » (B) ;
  - approche A (profil lu chez Meta, état du nom gardé avec le numéro) ;
  - un seul lot ;
  - propositions acceptées : refus si les portefeuilles diffèrent, collage unique, compte d'un autre prestataire hors lot, photo sous réserve de l'essai.

## 12. Choix du rédacteur et laissé au builder

Choix du rédacteur, contestables :
- alerte de la carte du compte pour un nom approuvé à appliquer (§5.3, point 5) ;
- l'étape 1 ne montre pas de nom de portefeuille : la maquette 03 disait « Portefeuille Wabagent reconnu », ce qui est impossible avant le jeton (§5.1, point 2) ;
- noms des raisons et des routes.

Laissé au builder : colonnes exactes après l'essai 1 ; transport du fichier de la photo ; texte exact de la phrase reportée de R1 ; découpage des composants web.

## 13. Amendements du 17 nov. 2026 (essai de la tâche 0, décisions de François)

Source : `docs/superpowers/research/2026-11-17-essai-r2a-profil-nom.md`. Ces amendements priment sur les sections précédentes.

1. **État du nom.**
   - `verified_name` ne change qu'au réenregistrement. Il donne donc le nom affiché, sans qu'aucune règle de plus soit nécessaire du côté de Meta.
   - Le nom demandé est `new_display_name`.
   - « Approuvé, à appliquer » correspond à `new_name_status` valant `APPROVED` ou `AVAILABLE_WITHOUT_REVIEW`, avec `new_display_name` présent.
   - Le test du §6.3 (aucun nom approuvé non appliqué présenté comme affiché) reste exigé.
2. **Numéro sans code actif.** `is_pin_enabled` est lu avec le numéro.
   - S'il vaut `false`, l'encart « Approuvé, à appliquer » demande quand même 6 chiffres, avec le texte : « Aucun code n'est actif sur ce numéro. Choisissez 6 chiffres et notez-les : Meta peut en faire le code du numéro. » (option A, décision de François du 17 nov. 2026).
   - Le renvoi « réglez-le d'abord dans WhatsApp Manager » du §5.3 ne reste que dans le texte d'aide d'un numéro dont le code est actif (« Code oublié : changez-le dans WhatsApp Manager ↗ »).
3. **Refus d'un mauvais code.** Il n'a pas été observé : le numéro de test n'exige jamais le code.
   - Le moteur reconnaît `133005` (documentation de Meta) comme `pin_rejected`, et restitue tout autre refus du réenregistrement de façon générique.
   - Le cas est déclaré non recetté en réel, sauf si un vrai numéro est disponible à la recette.
4. **Profil**, tel que l'essai l'a établi :
   - `about` (infos) : 1 à 139 caractères, jamais vide (Meta répond 500 au vidage) ;
   - `description` : 512 au plus ; `address` : 256 au plus ; `email` : 128 au plus ;
   - les longueurs se comptent en caractères, emoji compris ;
   - `websites` : 2 au plus ;
   - `vertical` : la liste fermée de 22 valeurs du rapport ;
   - la forme de l'e-mail est contrôlée par WABAGENT, puisque Meta ne la contrôle pas.
5. **Photo** :
   - JPEG ou PNG, 5 Mo au plus du côté de WABAGENT (choix du PO) ;
   - 192 × 192 pixels au minimum, contrôlé par Meta (refus `3441013`, restitué en `photo_invalid`) ;
   - envoi par l'API d'envoi de fichiers avec le jeton de l'utilisateur système, chemin décrit dans le rapport.
6. **Webhooks.** Le réenregistrement ne change ni l'adresse de la WABA ni celle du numéro. La porte de sortie du §4 n'est pas déclenchée.

## 14. Amendements du 18 nov. 2026 (recette en réel et relecture des retouches, décisions de François)

Sources : rapport de recette `docs/debug/2026-11-18-recette-r2a.md` (constats RF-1 à RF-3, RC-1 à RC-3 et décisions de fin de recette), relecture des retouches `.superpowers/sdd/2026-11-17-r2a-guide-profil-nom/recette-retouches-review.md` (rulings R-35 et R-36 du PO). Ces amendements priment sur les sections précédentes, §13 compris. Les textes de l'étape 1 (`business.recognised`) et du chemin 2 (`waba.createdHint`), ainsi que le refus d'une adresse d'un autre portefeuille, sont soumis à François.

1. **Liens précis du guide** (§5.1, point 4, qui disait les liens vers Meta for Developers génériques et laissait les utilisateurs système imprécis, ruling R-9bis) :
   - étape du jeton (RF-1) : `https://business.facebook.com/latest/settings/system_users?business_id=<ID>`, précis avec un portefeuille ; Meta y ajoute lui-même `selected_user_id`, jamais recopié par WABAGENT ; texte du lien « Ouvrir les utilisateurs système ↗ » ;
   - étape du WABA ID (RF-2) : WhatsApp Manager du portefeuille, `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=<ID>`, sans `asset_id` (entrée `managerHome` des contrats ; générique `https://business.facebook.com/wa/manage/home/`). La page des Paramètres « Comptes WhatsApp » (`whatsapp_business_presence`) n'est plus citée : elle n'affiche jamais le WABA ID et y sélectionne un autre identifiant. Texte de l'étape (chemin 1, validé mot pour mot) : « Ouvrez WhatsApp Manager, choisissez le compte WhatsApp et collez ici l'adresse de la page : WABAGENT y lit l'identifiant du compte. Vous le trouvez aussi dans votre app Meta : Cas d'utilisation, Personnaliser, Configuration de base, sous « ID du compte de messagerie ». » ;
   - étapes de l'app et du secret (RF-3) : `https://developers.facebook.com/apps/?business_id=<ID>`, liste filtrée sur les apps du portefeuille ; `precise` reste faux, la liste n'ouvrant jamais une app.
2. **Champ WABA** (§5.1, point 5) : une adresse collée dont le `business_id` n'est pas le portefeuille de l'étape 1 est refusée sur place, sans appel ; son WABA n'est jamais assemblé avec ce portefeuille dans un lien. Le refus disparaît dès que l'étape 1 ou le champ le lèvent.
3. **Sites du profil** (§6.2 ; Ruling R-6, qui les gardait sans schéma) : un site saisi sans schéma part chez Meta en `https://` (RC-2, Meta enregistrait « wabagent.com » en `http://wabagent.com/`) ; un schéma saisi, `http://` compris, est gardé. La limite de 256 caractères porte sur l'adresse envoyée, et le compteur de l'écran la compte. Une barre ou une barre inverse entre « schéma:// » et l'hôte (`//exemple.fr`, `https:///exemple.fr`) est refusée comme adresse invalide. Source unique : `profileWebsiteToSend` et `isProfileWebsite` des contrats.
4. **Aperçu** (§5.2, point 4) : il n'affiche pas une valeur saisie que la règle d'envoi refuse (RC-3) ; une valeur non touchée, telle que Meta la rend, reste montrée.
5. **« Vérifier maintenant » relit les numéros** (§5.1, comptes déjà raccordés ; §6.3) : une vérification réussie d'un compte Meta applique aussi les numéros qu'elle vient de lire chez Meta (RC-1), par la même écriture que « Rafraîchir les numéros » (même réconciliation de l'état du nom, même trace `whatsapp_account.refresh`) :
   - **sans reprise** (ruling R-35) : un numéro tenu par un autre compte, en erreur ou non, de la même organisation ou d'une autre, n'est jamais repris par la vérification ; il est compté refusé. La reprise reste l'action explicite « Rafraîchir les numéros » ;
   - un numéro du compte absent chez Meta est retiré et l'agent IA qui le tient, s'il est en service, est mis en pause (`number_removed`), comme pour la relecture ;
   - **bilan** (ruling R-36) : la réponse porte `inventory` (même forme que celui de « Rafraîchir les numéros ») quand les numéros ont été appliqués, et la fenêtre de vérification l'affiche quand il dit un ajout, un retrait ou un refus ;
   - rien n'est relu pour une vérification refusée, non concluante ou périmée par un remplacement concurrent ; un inventaire vide n'est pas appliqué ; une écriture en échec ne fait pas échouer la vérification (contrôle des numéros « en attente »).
   - Impact multi-organisation : la relecture écrit seulement sur le compte et l'organisation vérifiés ; constats dans `src/__tests__/isolation/profil-nom.test.ts` (numéro de B tenu par un compte connecté, puis par un compte en erreur : jamais repris, agent IA de B jamais mis en pause).
