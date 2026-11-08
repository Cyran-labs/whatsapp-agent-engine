# Raccordement WhatsApp : analyse d'écart Embedded Signup (Meta)

Date : 7 novembre 2026. Périmètre : étape « connecter WhatsApp » de l'assistant de création d'agent IA et écran Organisation › Connexions.

Conventions de lecture :
- **Doc** : ce que dit la documentation Meta consultée le 7 novembre 2026 (URL en fin de document, numérotées [n]).
- **Déduction** : ce que j'en conclus, non écrit tel quel par Meta.
- **Incertain** : non trouvé dans la doc officielle, ou sources secondaires seulement, ou contradictoire.

## Synthèse

1. Pour proposer l'Embedded Signup, WABAGENT doit devenir **Tech Provider** : vérification d'entreprise, App Review avec accès avancé sur `whatsapp_business_management` et `whatsapp_business_messaging`, puis vérification d'accès. Aucun frais Meta trouvé ; délai dominé par la vérification d'entreprise (variable, non documentée). App Review annoncée à environ 24 h en moyenne [3].
2. Les vidéos d'App Review peuvent être tournées **sans l'interface WABAGENT** (script cURL de l'écran API Setup et WhatsApp Manager sont acceptés) [2]. Le dossier administratif peut donc démarrer tout de suite.
3. L'intégration technique est de taille moyenne : SDK JavaScript Facebook, configuration Facebook Login for Business (`config_id`), échange du code (durée de vie 30 s) contre un jeton métier qui n'expire pas par défaut, abonnement webhook de la WABA, enregistrement du numéro avec PIN [4][5][7]. Elle exige un **domaine HTTPS public** (wabagent.com déployé).
4. Facturation : en Tech Provider, **le client paie Meta sur sa propre carte** ; WABAGENT ne peut pas refacturer les frais Meta [2][8]. Point nouveau : depuis le 1er octobre 2026, les messages de service (réponses de l'agent IA dans la fenêtre de 24 h) sont **payants au-delà de 1 000 par numéro et par mois** [9].
5. Le découpage proposé par le fondateur (raccordement au niveau Organisation, choix du numéro dans l'assistant) **colle au modèle Meta** : le jeton est par entreprise cliente, la WABA porte modèles, facturation et webhooks, le numéro est l'unité qu'on affecte à un agent IA. Il faut seulement autoriser plusieurs comptes WhatsApp par organisation (groupes, entités juridiques distinctes).
6. Recommandation : concevoir dès maintenant l'objet « compte WhatsApp de l'organisation » et l'écran Connexions avec un **mode manuel guidé** (WABA ID + jeton + secret d'app, numéros listés automatiquement), lancer en parallèle vérification d'entreprise et App Review, puis brancher l'Embedded Signup (v5, coexistence désactivée au départ) comme simple autre source de jeton, une fois wabagent.com en ligne. Aucun travail jeté. BSP (360dialog) en plan B uniquement pour la facturation par ligne de crédit : il n'évite pas la vérification d'entreprise ni l'App Review [11].

## 0. État actuel du code (constaté)

| Sujet | Constat | Fichier |
|---|---|---|
| Driver Meta | Appels directs `graph.facebook.com`, version figée `v22.0` | `src/transport/meta-cloud.ts` |
| Identifiants | `phone_number_id`, `access_token`, `app_secret` saisis par agent IA via `PUT /bots/:botId/transport`, repli portée organisation puis `.env` | `src/core/providers.ts`, `src/core/credentials/resolver.ts`, `src/api/admin/routes/connections.ts` |
| Validation | `GET /<phone_number_id>?fields=id` | `meta-cloud.ts` `validateCredentials` |
| Webhook entrant | `POST /webhook/meta`, un seul `META_VERIFY_TOKEN` global, HMAC vérifié avec l'`app_secret` du bot ; refus si `app_secret` absent | `src/index.ts`, `meta-cloud.ts` |
| Routage | Par `metadata.display_phone_number` vers `bot_numbers.whatsapp_number` (saisie libre côté agent IA) | `meta-cloud.ts` `parseWebhookPayload`, `src/core/router.ts` |
| Parsing | Seul `entry[0].changes[0].messages[0]` est lu ; `statuses` et autres champs (`account_update`, etc.) ignorés | `meta-cloud.ts` |
| Écran | Aucun écran Connexions dans `apps/web` | |
| Modèle comptes | Organisation (`clients`), entités, agences (`clients.agency_id`), agents IA rattachés à une entité | `src/core/database/postgres.ts` |

Conséquences directes pour l'Embedded Signup (déduction) :
- Avec l'Embedded Signup, tous les clients partagent **l'app Meta de WABAGENT** : un seul secret d'app (celui de WABAGENT) signe tous les webhooks, un seul jeton de vérification. Le contrat actuel « `app_secret` par bot obligatoire » doit accepter un secret plateforme.
- Le routage par numéro affiché est fragile (format, changement de nom affiché) ; `metadata.phone_number_id` est l'identifiant stable fourni par Meta.
- Meta peut regrouper plusieurs changements dans un même webhook ; lire uniquement le premier élément fera perdre des messages quand le volume monte (déduction, comportement de lot non vérifié dans la doc consultée).
- `v22.0` expire le 20 mai 2027 [14].

## 1. Statuts possibles côté Meta

### Ce que dit la doc

Trois statuts pertinents [8] :

| Statut | Ce que c'est | Facturation | Accès |
|---|---|---|---|
| **Tech Provider** | Éditeur qui intègre la plateforme pour ses clients, seul ou avec un Solution Partner | Pas de ligne de crédit : « Tech Providers do not have credit lines ». Le client ajoute son propre moyen de paiement, Meta le facture directement | App Review + accès avancé |
| **Tech Partner** | Tech Provider devenu Meta Business Partner | Idem Tech Provider | Programme accélérateur |
| **Solution Partner** (ex-BSP) | Meta Business Partner offrant toute la gamme de services | Ligne de crédit partageable : le client n'entre pas de carte, le partenaire le refacture | « becoming a Solution Partner is a lengthy process » |

Les Multi-Partner Solutions ne sont pas un statut : elles permettent à un Tech Provider et un Solution Partner de gérer ensemble les actifs d'un client [8].

Étapes pour devenir Tech Provider [2] :
1. Prérequis : une app Meta avec le cas d'usage WhatsApp et un portefeuille business connecté.
2. **Vérification d'entreprise** : nom, adresse, téléphone, e-mail, site web ; documents à téléverser si l'entreprise n'est pas trouvée. « Your business must be verified before you can start the app review process. »
3. **App Review** :
   - réglages de l'app : icône, politique de confidentialité, catégorie ;
   - accès avancé `whatsapp_business_messaging` (envoyer pour le compte des clients) et `whatsapp_business_management` (accéder aux comptes WhatsApp et Messaging des clients ; sans lui, erreur `200` sur les comptes non détenus) ;
   - une vidéo et une description écrite **par permission**, pas de capture d'écran, pas de vidéo combinant plusieurs permissions [3] ;
   - vidéo 1 : un message envoyé depuis l'app et reçu dans WhatsApp ; vidéo 2 : création d'un modèle de message. Alternatives acceptées : enregistrer le script cURL de l'écran API Setup, et WhatsApp Manager pour le modèle [2] ;
   - délai moyen : « about 24 hours » [3] ; on peut soumettre avant d'avoir fini l'intégration Embedded Signup [3].
4. **Vérification d'accès** (Access Verification) : citée par la page Embedded Signup comme condition du passage de 10 à 200 nouveaux clients par fenêtre glissante de 7 jours [4]. Elle n'est pas détaillée dans la page « Become a Tech Provider » consultée.

Limites d'intégration de clients [4] : « By default, you can onboard up to 10 new business customers in a rolling 7-day window », puis 200 après vérification d'entreprise, App Review et vérification d'accès. Au-delà, sources secondaires : devenir Meta Business Partner ou ticket au support [16].

Prérequis de l'Embedded Signup [5] : être Solution Partner ou Tech Provider, s'abonner au webhook `account_update`, certificat SSL valide.

`business_management` : non requis pour le flux Embedded Signup d'après les pages consultées (seules les deux permissions WhatsApp sont listées [2][3]). Il apparaît uniquement dans la génération manuelle d'un jeton système [7].

### Déduction

- Coût Meta du statut : aucun frais trouvé dans la doc. Le coût réel est du temps (dossier, vidéos, pages légales) et le prérequis d'un site public.
- L'entité juridique vérifiée doit être celle qui porte WABAGENT (à trancher : Cyran ou une société dédiée). Le site déclaré doit être cohérent avec le nom légal ; wabagent.com doit donc être en ligne avec mentions légales.
- Politique de confidentialité publique obligatoire ; conditions d'utilisation et URL de suppression des données : non exigées par la page Meta Tech Provider consultée, mais demandées par 360dialog dans son guide [11] et classiques du tableau de bord Meta. À prévoir.

### Incertain

- Délai de vérification d'entreprise : non documenté par Meta ; il dépend des documents (Kbis, justificatif d'adresse, domaine e-mail). Retours terrain usuels : de quelques jours à quelques semaines.
- Délai de vérification d'accès : « 5 business days » selon des sources secondaires (Twilio, synthèse de recherche), non confirmé sur une page Meta consultée [15][16].
- Plafond 200 : chiffre Meta [4], mais la mention « 10 par défaut » ne dit pas explicitement si ces 10 sont possibles avant l'App Review. La page d'implémentation dit le contraire pour les clients externes : « You will not be able to onboard business customers until your app has been approved for advanced access » [4]. Déduction : les 10 s'appliquent après l'App Review, avant la vérification d'accès ; en mode développement, seuls les comptes ayant un rôle sur l'app peuvent tester.

### Politique IA de Meta (risque à connaître)

- Doc (secondaire, la page des conditions n'a pas pu être lue) : les conditions WhatsApp Business interdisent depuis le 15 octobre 2025 (nouveaux) et le 15 janvier 2026 (existants) les fournisseurs d'IA dont l'assistant généraliste est le produit principal ; les usages IA spécialisés d'une entreprise (support, qualification) restent autorisés [17].
- Le 9 juin 2026, la Commission européenne a imposé des mesures provisoires obligeant Meta à rétablir l'accès gratuit des assistants IA généralistes concurrents dans l'EEE, jusqu'à décision finale [18].
- Déduction : WABAGENT (agent IA métier d'une entreprise, sur le numéro de cette entreprise) est dans le cas autorisé. Pour l'App Review et les CGU, décrire l'usage comme « service client et qualification commerciale de l'entreprise », jamais comme assistant généraliste, et interdire contractuellement aux clients l'usage généraliste.
- Signal concurrentiel : la grille Meta mentionne depuis le 1er juillet 2026 un produit « Meta Business Agent » facturé au jeton [9]. Non analysé ici.

## 2. Embedded Signup aujourd'hui

### Versions (doc [6][10])

| Version | Sortie | Fin |
|---|---|---|
| v2, v3 (et préversions) | 2023, mai 2025 | 15 octobre 2026 (requêtes servies en v4) |
| v4 | 8 octobre 2025 | non fixée |
| v5 | 20 octobre 2026 | non fixée |

- v4 : produits (Marketing Messages, Click to WhatsApp Ads, Conversions API) déclarés dans la configuration Facebook Login for Business ; `extras` optionnels ; l'utilisateur peut finir avec un numéro vérifié, non vérifié ou sans numéro [6].
- v5 : coexistence avec l'app WhatsApp Business **activée par défaut** (désactivation via `features: [{ name: "whatsapp_business_app_onboarding", enabled: false }]`) ; objet de session v5 avec `messaging_account_ids`, `primary_waac_ids`, `is_on_biz_app` ; événement `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` [10].

Recommandation (déduction) : partir directement en v5, coexistence désactivée au départ, et lire les deux formats d'objet de session (v4 `waba_id`, v5 `messaging_account_ids`).

### Ce que l'app doit intégrer (doc [5][4][7][12])

Côté tableau de bord Meta (une fois) :
- Produit Facebook Login for Business ; réglages OAuth client : Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth Login, Strict Mode, Login with the JavaScript SDK à « Yes » [5].
- Domaines autorisés et URI de redirection OAuth valides : « Only HTTPS domains are supported », domaines de dev inclus [5].
- Configuration Facebook Login for Business : modèle « WhatsApp Embedded Signup Configuration With 60 Expiration Token » ou variante personnalisée « WhatsApp Embedded Signup » ; type de jeton « system-user access token » ; on récupère le `config_id` [5][12].
- Abonnement au webhook `account_update` [5].

Côté app web :
- Chargement de `https://connect.facebook.net/en_US/sdk.js`, `FB.init({ appId, version })` [5].
- `FB.login(callback, { config_id, response_type: 'code', override_default_response_type: true, extras: {...} })` [5].
- Écouteur `message` sur `window`, vérifier `event.origin` (facebook.com), traiter `WA_EMBEDDED_SIGNUP` : `FINISH` (et variantes), `CANCEL` (avec `current_step`), `ERROR` [5].
- Le code n'est renvoyé que si l'utilisateur clique sur Finish ; **durée de vie 30 secondes** [5] : l'envoyer immédiatement au moteur.

Côté moteur, après le flux (doc Tech Provider [4]) :
1. Échange serveur à serveur `GET /oauth/access_token` (`client_id`, `client_secret`, `code`) contre un **jeton métier** (Business Integration System User access token).
2. `POST /<WABA_ID>/subscribed_apps` avec le jeton métier (abonnement webhook ; option `override_callback_uri` pour une autre URL [13]).
3. `POST /<PHONE_NUMBER_ID>/register` avec `messaging_product: "whatsapp"` et un `pin` à 6 chiffres, qui devient le PIN de vérification en deux étapes. À sauter en coexistence [4][19].
4. Demander au client d'ajouter un moyen de paiement dans WhatsApp Manager : « Until then, the customer is not fully onboarded » [4].

### Jetons (doc [7][12])

| Jeton | Durée de vie | Usage |
|---|---|---|
| Jeton utilisateur | Expire en quelques heures | Tests |
| Jeton système (System User) | Long, expiration choisie à la génération | Développeur direct, mode manuel |
| Jeton métier (BISU) | « Defaults to never expire » ; option 60 jours à la génération | Tech Provider, un par client intégré |

- Pas de mécanisme de renouvellement documenté pour le jeton métier ; il est invalidé si le client retire l'app dans les réglages de son portefeuille [12].
- Déduction : prévoir la détection de révocation (erreur d'authentification Graph, webhook `account_update`) et un bouton « Reconnecter » qui relance le flux.
- Incertain : le nom du modèle de configuration (« 60 Expiration Token ») suggère une expiration à 60 jours alors que la doc Login for Business annonce « never expire » par défaut. À vérifier à la création de la configuration ; si 60 jours, il faut un rappel de reconnexion.

### Évolution du modèle de compte (doc [20])

- La WABA se scinde en **compte Messaging** (modèles, facturation, abonnements webhook ; l'ancien WABA ID devient son ID) et **compte WhatsApp (WAAC)**, un par numéro, détenu par le client et partageable entre partenaires. GA le 23 septembre 2026, déploiement terminé mi-octobre 2026.
- Phase 2 (S1 2027) : IDs WAAC renvoyés par l'Embedded Signup, à stocker. Phase 3 (S1 2028) : les API par numéro passent aux IDs WAAC.
- Remplacer `paid_messaging_account_id` par `messaging_account_id` avant le 31 décembre 2026 (non utilisé dans le code actuel).
- Continuer d'envoyer un `pin` valide à `/register` même si Meta ne s'en sert plus pour valider.

### Coexistence avec l'app WhatsApp Business (doc [19])

- Garde le numéro sur l'app mobile et l'ouvre à l'API. App ≥ 2.24.17, Tech Provider obligatoire.
- Limites : débit fixe 20 messages/s, pas de groupes synchronisés, messages éphémères, diffusions et appels désactivés côté API, appareils compagnons déliés.
- À traiter en plus : webhooks `smb_message_echoes` (messages envoyés depuis l'app à afficher dans le fil), `history` (180 jours, fenêtre de 24 h pour synchroniser), `smb_app_state_sync` ; pas d'appel `/register`.
- Déduction : très pertinent pour les PME qui utilisent déjà l'app sur leur numéro principal, mais impose de gérer un humain et un agent IA sur la même conversation (reprise humaine). À différer après la reprise humaine.

## 3. Facturation

### Doc

- Tarification **par message délivré** depuis le 1er juillet 2025, selon catégorie et pays [9].
- **Changement du 1er octobre 2026** : les messages de service (non modèles, dans la fenêtre de 24 h) redeviennent payants, avec **1 000 messages de service gratuits par numéro et par mois** ; les messages utilitaires dans la fenêtre aussi [9].
- Fenêtre d'entrée gratuite de 7 jours après un clic sur une publicité Click to WhatsApp [9].
- Chaque compte Messaging a sa propre relation de facturation, son moyen de paiement et ses plafonds [9].
- Tech Provider : le client paie Meta avec sa carte ; Solution Partner : ligne de crédit et refacturation possible [8].

### Déduction pour WABAGENT

- En Tech Provider, WABAGENT ne touche pas aux frais Meta : il facture son abonnement à part. Pas de risque de trésorerie, mais pas de marge sur le volume et une étape « ajouter une carte dans WhatsApp Manager » que WABAGENT ne contrôle pas (lien vers l'aide Meta [4]).
- Un agent IA qui converse génère surtout des messages de service : au-delà de 1 000 par numéro et par mois, chaque réponse a un coût Meta pour le client. Le simulateur de coûts et l'écran Usage et coûts doivent l'afficher. Le tarif unitaire par pays n'a pas été relevé ici (grille Meta à consulter).
- Sans carte, la livraison des messages échoue : le moteur doit lire les statuts d'échec (webhook `statuses`, ignoré aujourd'hui) pour signaler « moyen de paiement manquant » plutôt que laisser l'agent IA muet.
- Incertain : aucune API trouvée pour lire directement la présence d'un moyen de paiement sur la WABA du client.

## 4. Alternatives si le statut tarde

### 4.1 Saisie manuelle (faisable, déjà supportée par le moteur)

Le client utilise **sa propre app Meta** (développeur direct), ce qui ne nécessite pas d'App Review pour ses propres actifs (l'erreur `200` ne concerne que les comptes non détenus [2]).

Parcours client (doc [7][19], déduction pour l'enchaînement) :
1. Portefeuille Meta Business, WABA et numéro (WhatsApp Manager).
2. Créer une app Meta (cas d'usage WhatsApp).
3. Créer un utilisateur système, lui assigner l'app et la WABA, générer un jeton avec `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`, expiration au choix (choisir « jamais ») [7].
4. Copier le secret d'app, l'ID de numéro, l'ID de WABA.
5. Configurer dans son app l'URL de webhook WABAGENT et le jeton de vérification, s'abonner au champ `messages`.
6. Enregistrer le numéro (PIN), ajouter un moyen de paiement.

Limites :
- 6 étapes et une dizaine d'écrans Meta, hors de portée de nombreuses PME sans accompagnement.
- Le client confie son secret d'app à WABAGENT (déjà chiffré au repos).
- Le jeton de vérification webhook est aujourd'hui **global** (`META_VERIFY_TOKEN`) : il faudrait le communiquer à chaque client, ou passer à un jeton par organisation.
- Incertain : l'app du client doit peut-être être passée en mode Live (donc avec une URL de politique de confidentialité) pour recevoir les webhooks de production. Non confirmé dans la doc consultée ; à tester avec un compte réel.
- Durée de vie : jeton système à expiration choisie par le client ; s'il choisit 60 jours, coupure silencieuse. Afficher et contrôler.

Une variante « le client partage sa WABA avec le portefeuille WABAGENT » n'évite pas l'App Review : l'app WABAGENT accéderait alors à des comptes non détenus (déduction de [2]).

### 4.2 Passer par un BSP

- 360dialog, comme Twilio ou Infobip, propose un programme Tech Provider « avec Solution Partner » : **WABAGENT doit quand même faire la vérification d'entreprise classique et l'App Review** (la vérification par le partenaire n'est pas acceptée) [11].
- Ce qu'il apporte : ligne de crédit et facturation par 360dialog, approbation de la solution en 24 h maximum après saisie du Solution ID, et un parcours d'intégration hébergé (« Integrated Onboarding ») utilisable **avant** que l'Embedded Signup propre soit approuvé [11].
- Coût (sources tierces, chiffres mouvants en 2026, à confirmer auprès de 360dialog) : licence par numéro de l'ordre de 49 à 99 € par mois, plan partenaire de 500 à 1 000 € par mois plus frais par canal, frais Meta répercutés sans marge selon 360dialog [21][22].
- Déduction : un BSP ne raccourcit pas les étapes administratives Meta côté WABAGENT ; il ne se justifie que pour la ligne de crédit (facturer les clients sans qu'ils entrent de carte) ou si l'Embedded Signup propre est refusé. Il ajoute un driver de transport (API 360dialog) ou un mode « partenaire » sur le driver Meta.
- CM.com : garder le driver existant pour les organisations déjà chez CM.com ; leur raccordement reste manuel (identifiants CM.com).

## 5. Analyse d'écart

### 5.1 Cadrage du fondateur : connexion au niveau Organisation, numéro au niveau agent IA

Modèle Meta (doc [4][7][8][20]) :
- Le **portefeuille business du client** possède la WABA (désormais compte Messaging) et ses numéros (un WAAC par numéro).
- L'Embedded Signup produit **un jeton métier par client intégré**, valable pour les actifs accordés pendant le flux (une ou plusieurs WABA : `waba_ids` en flux multi-WABA [5]).
- Modèles de messages, moyen de paiement, abonnement webhook : au niveau du compte Messaging (WABA).
- Envoi : par numéro (`/<PHONE_NUMBER_ID>/messages`).
- Limite : 2 numéros enregistrés par portefeuille avant vérification de l'entreprise cliente, 20 après [23].

Adéquation (déduction) :

| Niveau WABAGENT | Objet Meta | Ce qui s'y configure |
|---|---|---|
| Organisation › Connexions | Portefeuille client + WABA (jeton métier, moyen de paiement, modèles, webhook) | Raccordement une fois, liste des numéros, état (connecté, PIN, qualité, paiement), modèles de messages |
| Assistant de création d'agent IA | Numéro (phone_number_id, futur WAAC) | Choix d'un numéro libre parmi ceux raccordés |

Le découpage colle. Trois ajustements :
1. **Plusieurs comptes WhatsApp par organisation**. Une organisation peut avoir plusieurs WABA, ou plusieurs portefeuilles Meta si ses entités sont des sociétés distinctes (chacune avec sa vérification et sa carte). L'objet doit être « compte WhatsApp » (0..n par organisation), pas un champ unique.
2. **Entités** : rattacher le compte WhatsApp à l'organisation, avec une restriction optionnelle à une ou plusieurs entités. Un agent IA d'une entité ne voit que les numéros autorisés pour elle. Le droit « connecter WhatsApp » est un droit d'administration d'organisation (`can()` existant), le choix du numéro un droit de configuration d'agent IA (`bots.configure`).
3. **Agences** : le client final doit rester propriétaire de son portefeuille, de sa WABA et de sa carte (sinon le numéro et la facturation appartiennent à l'agence, ce qui pose problème au départ du client). Or l'Embedded Signup se fait avec le compte Facebook de quelqu'un qui administre le portefeuille du client. Deux cas à prévoir :
   - l'agence a un accès administrateur au portefeuille du client : elle lance le flux elle-même depuis l'organisation du client ;
   - sinon : WABAGENT envoie au client un **lien de raccordement** (invitation limitée à cette étape, en réutilisant le mécanisme d'invitations à accepter) et le client fait le flux seul.

Ce que ça change à l'écart :
- Le modèle actuel (identifiants transport par agent IA, numéros saisis en texte libre dans `bot_numbers`) devient : compte WhatsApp (organisation) → inventaire de numéros (lus via l'API Meta) → affectation d'un numéro à un agent IA (1 numéro = 1 agent IA reste vrai).
- Le portail d'activation passe de « transport validé pour l'agent IA » à « numéro affecté, enregistré, compte WhatsApp connecté ».
- Ce modèle est **le même pour le mode manuel et l'Embedded Signup** : seule la manière d'obtenir le jeton diffère. C'est ce qui évite le travail jeté.

### 5.2 Tableau d'écart

Tailles : S (moins de 2 jours), M (2 à 5 jours), L (plus d'une semaine). Estimations grossières pour un développeur.

| # | Domaine | Élément à ajouter | Taille | Dépendances |
|---|---|---|---|---|
| A1 | Admin | Trancher l'entité juridique qui porte WABAGENT, puis vérification d'entreprise Meta (Kbis, adresse, site cohérent) | S en effort, délai incertain | Site wabagent.com avec mentions légales |
| A2 | Admin | App Meta WABAGENT (type Business, cas d'usage WhatsApp), icône, catégorie | S | Portefeuille WABAGENT |
| A3 | Juridique | Politique de confidentialité, CGU (dont interdiction d'usage assistant généraliste), URL ou callback de suppression des données, publiées sur wabagent.com | M | Site public HTTPS |
| A4 | Admin | App Review : 2 vidéos (alternatives API Setup cURL et WhatsApp Manager) + descriptions, décrivant un usage IA métier | S | A1, A2, A3 |
| A5 | Admin | Vérification d'accès, passage de l'app en mode Live | S, environ 5 jours ouvrés (incertain) | A4 |
| A6 | Juridique | Contrat client : WABAGENT sous-traitant des données ; frais Meta facturés directement au client ; coût des messages de service au-delà de 1 000 par numéro | S | |
| I1 | Infra | wabagent.com en HTTPS public (app web et URL de webhook), variables `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, jeton de vérification plateforme | M (chantier Infra déjà prévu) | VPS, DNS |
| I2 | Infra | CSP de l'app web autorisant `connect.facebook.net` et les cadres facebook.com | S | I1 |
| E1 | Moteur | Modèle de données : `whatsapp_accounts` (organisation, entités autorisées, mode `embedded_signup` / `manual` / `cm-com`, business_id, waba_id = messaging_account_id, référence de jeton chiffré, état) et `whatsapp_numbers` (phone_number_id, numéro affiché, nom vérifié, état, PIN chiffré, waac_id nul pour la phase 2, agent IA affecté) ; migration des identifiants par agent IA existants | L | |
| E2 | Moteur | API admin Connexions au niveau organisation : créer et lister les comptes WhatsApp, rafraîchir les numéros (`GET /<WABA_ID>/phone_numbers`), affecter et libérer un numéro, valider | M | E1 |
| E3 | Moteur | Endpoint d'échange Embedded Signup : reçoit code + IDs de session, échange immédiat (30 s), stocke le jeton métier, `subscribed_apps`, `register` avec PIN généré, audit | M | E1, A2, I1 |
| E4 | Moteur | Webhook : routage par `metadata.phone_number_id`, secret d'app plateforme pour les comptes en Embedded Signup (secret client conservé en mode manuel), jeton de vérification par organisation en mode manuel, lecture de toutes les entrées et de tous les messages | M | E1 |
| E5 | Moteur | Champs webhook supplémentaires : `account_update` (obligatoire pour l'Embedded Signup [5], déconnexions), `statuses` (échecs de livraison, paiement manquant), mises à jour de qualité et de capacité | M | E4 |
| E6 | Moteur | Cycle de vie du jeton : détection de révocation, état « à reconnecter », notification (e-mail dépendant du SMTP) | S | E5, SMTP |
| E7 | Moteur | Montée de version Graph de `v22.0` (expire le 20 mai 2027) vers la version courante, centralisée | S | |
| E8 | Moteur | Mode manuel guidé : validation complète (jeton, WABA, numéros, abonnement webhook), contrôle de l'expiration du jeton (`debug_token`, à vérifier) | S | E2 |
| W1 | Web | Écran Organisation › Connexions : liste des comptes WhatsApp et numéros, états, bouton Reconnecter, rappel moyen de paiement | M | E2 |
| W2 | Web | Bouton Embedded Signup : SDK, `FB.login` avec `config_id`, écoute des événements, envoi immédiat du code, gestion `CANCEL`/`ERROR` | M | E3, I1, I2 |
| W3 | Web | Assistant manuel pas à pas (captures, champs, URL de webhook et jeton de vérification à copier, validation) | M | E8 |
| W4 | Web | Étape de l'assistant de création d'agent IA : choisir un numéro libre, ou lien vers Connexions si aucun | S | E2 |
| W5 | Web | Lien de raccordement pour le client d'une agence (invitation limitée à l'étape Connexions) | M | Invitations existantes, W1 |
| W6 | Web | Affichage du coût des messages de service (seuil 1 000 par numéro et par mois) dans Usage et coûts | S | Grille Meta |
| D1 | Différé | Coexistence (v5) : `smb_message_echoes`, `history`, `smb_app_state_sync`, pas de `register` | L | Reprise humaine |
| D2 | Différé | Phase 2 du modèle de compte (IDs WAAC, `messaging_account_id` en multi-comptes) | S à M | S1 2027 |

Chemin critique (déduction) : A1 → A4 → A5 côté Meta, en parallèle de I1 → E3/W2 côté technique. Le développement E1, E2, E4, W1, W3, W4 ne dépend de rien d'externe.

## 6. Recommandation pour l'étape « connecter WhatsApp »

### Ce qu'on conçoit et construit maintenant

- **Deux lieux distincts**, comme proposé par le fondateur :
  - Organisation › Connexions : raccordement d'un ou plusieurs comptes WhatsApp, inventaire des numéros, états.
  - Assistant de création d'agent IA : étape « Numéro WhatsApp » qui propose les numéros libres déjà raccordés ; s'il n'y en a aucun, renvoi vers Connexions (ou le lien de raccordement pour un client d'agence), l'agent IA restant créable et testable dans le simulateur sans numéro.
- Le modèle de données E1 et l'API E2, communs à tous les modes.
- Le **mode manuel guidé** (E8, W3) comme premier mode livré, simplifié par l'inventaire automatique : le client saisit une fois WABA ID, jeton et secret d'app ; les numéros apparaissent seuls.
- Les corrections webhook E4, E5, E7, utiles quel que soit le mode.

### Ce qu'on lance en parallèle, hors code

- Vérification d'entreprise (A1) dès maintenant : c'est l'étape la plus longue et la moins prévisible.
- Pages légales (A3), puis App Review (A4) avec les vidéos alternatives, sans attendre l'interface.

### Ce qui attend

- Le bouton Embedded Signup (E3, W2) : après la mise en ligne de wabagent.com en HTTPS et l'App Review. Il s'ajoute comme un mode de plus dans Connexions, sans toucher au reste.
- Coexistence (D1) : après la reprise humaine.
- BSP : seulement si l'App Review est refusée, ou si la ligne de crédit devient un besoin commercial.

### Chemin intermédiaire sans travail jeté

1. Maintenant : objet compte WhatsApp + inventaire de numéros + mode manuel guidé + étape « choisir un numéro ».
2. Dès l'approbation Meta (10 clients par semaine) : bouton Embedded Signup en mode « recommandé », manuel en repli replié.
3. Après la vérification d'accès (200 par semaine) : Embedded Signup par défaut, manuel réservé aux cas particuliers (app Meta existante du client, CM.com).

Le seul code propre au mode manuel qui perdra de l'importance est l'assistant pas à pas W3 ; il reste utile pour les clients qui ont déjà leur app Meta.

### Points à trancher par le fondateur

- Entité juridique porteuse de WABAGENT pour la vérification Meta.
- Acceptation que le client paie Meta sur sa carte (Tech Provider) plutôt qu'une ligne de crédit (Solution Partner ou BSP).
- Coexistence : priorité produit pour les PME déjà sur l'app WhatsApp Business, ou plus tard.

## Sources

Doc Meta (consultées le 7 novembre 2026) :
- [2] Become a Tech Provider : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- [3] App Review (WhatsApp) : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- [4] Onboarding customers as a Tech Provider : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider ; vue d'ensemble Embedded Signup : https://developers.facebook.com/docs/whatsapp/embedded-signup
- [5] Embedded Signup, implémentation : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- [6] Embedded Signup, versions : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions
- [7] Access tokens : https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- [8] Solution providers, overview : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview/
- [9] Pricing : https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- [10] Embedded Signup v5 : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5
- [12] Facebook Login for Business : https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- [13] Webhook overrides : https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override
- [14] Graph API, versions : https://developers.facebook.com/docs/graph-api/changelog/versions
- [19] Coexistence (WhatsApp Business app users) : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- [20] Account model evolution : https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/
- [23] Business phone numbers : https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers

Sources secondaires :
- [11] 360dialog, Becoming a Meta Tech Provider : https://docs.360dialog.com/partner/partner-program/meta-tech-provider-program/becoming-a-meta-tech-provider-a-step-by-step-guide
- [15] Twilio, Tech Provider Program FAQ : https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/faq
- [16] Infobip, onboarding Tech Provider : https://www.infobip.com/docs/whatsapp/tech-provider-program/business-onboarding.md
- [17] The Register, enquête UE sur la politique IA de WhatsApp (4 décembre 2025) : https://www.theregister.com/2025/12/04/eu_probes_meta_whatsapp_ai/
- [18] Commission européenne, mesures provisoires du 9 juin 2026 (copie du communiqué) : https://www.sipotra.it/wp-content/uploads/2026/06/Commission-imposes-interim-measures-on-Meta-to-preserve-free-access-to-WhatsApp-for-rival-AI-assistants-%E2%80%93-press-release.pdf ; dépêche AP : https://wtop.com/europe/2026/06/eu-orders-meta-to-restore-whatsapp-access-for-rival-ai-chatbots/
- [21] 360dialog, programme partenaires : https://docs.360dialog.com/partner/partner-and-account-management/solutions-for-partners/360dialog-partnership-program ; https://360dialog.com/partners
- [22] Suivi de prix 360dialog 2026 (tiers) : https://pricingsaas.com/companies/360dialog/diffs/2026Q2

Non lues directement : les conditions WhatsApp Business Platform (https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform) n'ont pas pu être récupérées ; la clause « AI Providers » est rapportée via [17].

Code consulté : `src/transport/meta-cloud.ts`, `src/transport/index.ts`, `src/index.ts`, `src/core/services/connections-service.ts`, `src/core/providers.ts`, `src/core/credentials/resolver.ts`, `src/api/admin/routes/connections.ts`, `packages/contracts/src/connections.ts`, `src/core/database/postgres.ts`.
