# État des évolutions de WABAGENT

Document interne, établi le 13 nov. 2026 en lecture seule, pour préparer le positionnement commercial et le modèle de prix.

Méthode : chaque statut a été vérifié dans le code (`src/`, `apps/web`, `packages/contracts`) et dans git (historique, branches), pas seulement dans `docs/ROADMAP.md`, `README.md` ou `CLAUDE.md`. Aucune date ni durée n'est inventée : une date n'apparaît que si elle est écrite dans un document ou un commit. Les durées de la roadmap (« 2 semaines », etc.) ne sont pas reprises : elles datent du découpage initial et ne sont pas des engagements.

Statuts :
- **livré** : sur `main`, testé ;
- **en cours** : code écrit sur une branche, pas sur `main` ;
- **prévu** : décidé et écrit dans la roadmap, pas de code ;
- **backlog** : besoin noté, pas décidé.

Rappel important : **rien n'est déployé**. « Livré » veut dire « fonctionne sur `main` et en recette locale », jamais « en ligne chez un client ».

---

## 1. Tableau de synthèse

| Évolution | Ce que ça apporte au client | Statut | Preuve | Préalables | Reste à faire |
|---|---|---|---|---|---|
| Moteur multi-organisations | Plusieurs entreprises clientes sur une même plateforme, sans qu'aucune voie les données d'une autre | livré | suite `src/__tests__/isolation/`, lancée sur SQLite et Postgres dans la CI (`.github/workflows/ci.yml`) | aucun | audit complet avant mise en ligne (chantier S) |
| Agent IA conversationnel sur WhatsApp | Un agent IA répond aux contacts sur WhatsApp, en plusieurs langues, avec la personnalité choisie | livré | `src/core/handler.ts`, `src/llm/anthropic.ts`, champs `languages` et `default_language` (`packages/contracts/src/bots.ts`) | compte WhatsApp raccordé | aucun |
| Qualification automatique des leads | L'agent IA extrait nom, besoin, demande de rendez-vous et étape du lead à partir de la conversation | livré | extraction dans `src/core/handler.ts` (modèle `claude-haiku-5-5`, `src/llm/models.ts`), table `leads` | aucun | aucun |
| Transport Meta (API Cloud officielle) | Le client utilise son propre compte WhatsApp Business chez Meta, sans intermédiaire | livré | `src/transport/meta-cloud.ts`, `src/webhooks/meta.ts`, recettes en réel | compte Meta du client | aucun |
| Transport CM.com | Le client passe par le prestataire CM.com | livré côté code | `src/transport/cm-com.ts`, tests `parse-cm.test.ts` et `cm-webhook.test.ts` | compte CM.com | non rejoué en réel sur ce dépôt (`docs/ROADMAP.md`, P2) |
| Comptes et équipes | Rôles (administrateur, manager, conseiller), entités, invitations à accepter, droits tenus par le moteur | livré | plan 1 et plan 2a, `src/core/auth/permissions.ts` | aucun | affectation des contacts (avec Conversations et leads) |
| Back-office web | Créer et régler ses agents IA, ses comptes WhatsApp et son équipe sans développeur | livré | `apps/web`, 20 pages (`apps/web/src/app/[locale]`) | aucun | sections encore marquées « Soon » (voir §2.8) |
| Assistant de création d'un agent IA | Identité, personnalité, numéro, test au simulateur, activation, en une suite d'étapes | livré | `apps/web/src/components/wizard/` | compte WhatsApp raccordé | modifier la personnalité après création (marqué « Soon ») |
| Simulateur | Tester l'agent IA comme un vrai contact avant de l'ouvrir | livré | `POST /bots/:botId/simulate`, `src/core/services/simulate-service.ts` | aucun | aucun |
| Statuts Draft, Preview, Online, Offline et Whitelist | Ouvrir l'agent IA d'abord à quelques numéros, puis à tous, ou le couper | livré | `packages/contracts/src/bot-status.ts`, mergé le 12 nov. 2026 | aucun | aucun |
| Raccordement d'un compte WhatsApp (manuel guidé) | Le client saisit ses identifiants Meta puis recopie l'URL de webhook chez Meta | livré | lot 2b-2 et 2b-3 sur `main` | compte Meta | remplacé par le lot R1 au merge |
| Lot R1 : raccordement automatique | Plus aucune saisie dans les pages de Meta pour le webhook : 3 informations à coller, WABAGENT fait le reste | en cours | branche locale `feat/raccordement-r1`, 45 commits au-dessus de `main`, non poussée | aucun | fin de recette, retouches, docs, merge (§2.1) |
| Lot R2 : profil, nom d'affichage, numéros | Gérer profil WhatsApp et numéros depuis WABAGENT | prévu | non-objectif écrit dans la spec R1, §2 ; absent de `docs/ROADMAP.md` | R1 | spec, plan, exécution |
| Connecteur HubSpot | Les leads qualifiés arrivent dans HubSpot | livré, validé en réel | `src/connectors/hubspot.ts`, `docs/CONNECTORS.md` (compte réel) | jeton HubSpot | réglage depuis l'écran (marqué « Soon ») |
| Connecteurs Attio, Pipedrive, Salesforce, Zoho | Même chose pour ces CRM | codés, non validés en réel | `src/connectors/*.ts`, tests unitaires | comptes de test | essai en réel ; OAuth complet pour Salesforce et Zoho |
| Webhook générique signé | Tout outil qui sait recevoir un appel HTTP reçoit les leads, signés | livré côté code | `src/connectors/webhook-generic.ts`, `docs/CRM_INTEGRATION.md` | URL du client | non validé en réel (`docs/CONNECTORS.md`) ; file des échecs non codée |
| Connecteur MAD CRM natif | Intégration profonde avec MAD CRM | backlog, squelette | `src/connectors/mad-crm.ts` lève « not yet implemented » | spécification d'API de MAD CRM | tout (§2.4) |
| Envoi de produits et de catalogue dans la conversation | L'agent IA envoie un produit, une liste de produits ou le catalogue WhatsApp | livré côté code | `src/core/handler.ts` (cas `catalog`, `product`, `product_list`), `src/transport/meta-cloud.ts` | catalogue créé chez Meta, identifiant saisi dans la config de l'agent IA | réglage depuis l'écran ; validation en réel non trouvée |
| Commande reçue par WhatsApp | Le panier envoyé par le contact est lu | partiel | lu par le transport (`kind: 'order'`), puis traité comme du texte ; `pushOrder` n'est appelé par aucun code | catalogue | émettre `order.placed` vers le CRM |
| Mesure de l'usage IA | Coût et jetons du modèle IA par agent IA, par modèle, par jour, et par organisation | livré | table `llm_usage`, `GET /bots/:botId/usage`, page Usage | aucun | coûts WhatsApp, facturation (§2.10) |
| Conversations et leads (écran) | Lire et suivre les conversations et les leads dans le back-office | prévu | l'API existe (`GET /bots/:botId/leads`, `/leads/:phone`) ; l'écran dit « Disponible prochainement » (`apps/web/messages/fr.json`) | aucun | spec et écrans |
| Reprise par un humain | Un conseiller prend la main sur une conversation | prévu | entrée « Soon » du rail (`app-rail.tsx`) ; aucun code moteur | Conversations et leads | tout |
| Chantier S : sécurité et données en Europe | Pouvoir démontrer la sécurité et traiter les données dans l'UE | prévu | `docs/ROADMAP.md`, section S ; `docs/SECURITE.md` absent | aucun | tout (§2.2) ; bloquant pour la mise en ligne |
| Chantier A : API ouverte | Piloter WABAGENT depuis son propre outil, sans le back-office, ou le revendre | prévu | `docs/ROADMAP.md`, section A | lot R, chantier S | §2.3 |
| Chantier C : catalogue WhatsApp géré | Gérer son catalogue Meta depuis WABAGENT | backlog | `docs/ROADMAP.md`, section C | lot R probable | étude, puis tout |
| P4 : éditeur de parcours | Dessiner les parcours conversationnels sans écrire de prompt | prévu, aucun code | aucune trace de builder dans `apps/web` | P3 | tout |
| P5 : modèles par secteur, marketplace, Solution Partner | Partir d'un agent IA type par secteur ; réseau d'agences | prévu, aucun code | `docs/ROADMAP.md`, P5 | aucun écrit | tout |
| Embedded Signup (raccordement « en un clic ») | Raccorder son compte avec son compte Facebook | prévu | `docs/superpowers/research/2026-11-07-meta-embedded-signup-analyse.md` | app Meta publiée, statut Tech Provider, mise en ligne | tout |

---

## 2. Zooms

### 2.1 Lot R, raccordement automatique : où en est-on vraiment

- `docs/ROADMAP.md` dit encore « essai préalable » et « spec, plan » à faire : **c'est dépassé**. L'essai, la spec et le plan sont sur `main` (commits `0090c3f`, `f106828`, `c516ab8`). Le code est sur la branche locale `feat/raccordement-r1` (45 commits, dernier `723c4ae` le 12 nov. 2026), **ni poussée ni mergée**.
- Le lot a été découpé : **R1** (raccordement automatique, ce qui est sur la branche) et **R2** (profil, nom d'affichage, numéros), qui n'existe que comme non-objectif de la spec R1.
- Ce que R1 apporte : le client colle 3 informations venues de Meta (WABA ID, jeton, secret de l'app) ; WABAGENT inscrit lui-même les webhooks chez Meta, vérifie, lit l'état du compte chez Meta (envoi limité ou bloqué, et pourquoi) et l'affiche. Plus de recopie d'URL dans Meta.
- Contrôles faits : revue d'isolation (0 bloquant, 1 important, 5 mineurs, traités ensuite), audit des décisions (25 décisions, dont 4 non conformes et 5 contestées, puis tranchées par François le 12 nov. 2026).
- Recette en réel du 12 nov. 2026 au soir : parcours essentiel validé chez Meta, message réel reçu et répondu (registre `.superpowers/sdd/2026-11-12-raccordement-automatique-r1/progress.md`, non versionné).
- Reste : libellés du guide relus dans les vraies pages de Meta, nouveau raccordement de la WABA de dev, validation des décisions produit (section A du registre), 4 retouches de recette, mise à jour de `CLAUDE.md` et `docs/ROADMAP.md`, rapport de recette, merge avec accord de François.
- Limite à connaître : sans Embedded Signup, le client doit toujours créer son app, son utilisateur système et son jeton chez Meta. R1 supprime la recopie, pas la création.

### 2.2 Chantier S, sécurité et données en Europe

Fait (et testé), à inventorier dans le futur document :
- cloisonnement par organisation, testé sur SQLite et Postgres ;
- identifiants chiffrés en base (AES-256-GCM) ;
- webhooks authentifiés avant tout traitement (clé d'URL par compte, signature Meta) ;
- aucun repli sur les identifiants de la plateforme ;
- droits par rôle tenus par le moteur ;
- garde des journaux dans la CI (`npm run check:logs`) ;
- limite de débit sur les routes de connexion seulement (`src/api/middleware/rate-limit.ts`, en mémoire, un seul serveur).

Pas fait :
- `docs/SECURITE.md` n'existe pas ;
- aucune analyse des dépendances ni des secrets dans la CI ;
- aucun audit complet, aucun test d'intrusion ;
- **modèles IA hors d'Europe** : le moteur n'appelle que l'API Anthropic directe (`src/llm/anthropic.ts`), qui n'a pas de zone Europe selon la roadmap (état vérifié le 9 nov. 2026). Aucun fournisseur Bedrock ou Vertex n'est codé ;
- localisation du serveur non écrite ;
- RGPD : pas d'export ni de suppression d'un contact à la demande, pas de contrat de sous-traitance. La purge automatique existe (`src/core/maintenance.ts` : conversations après 90 jours, réglable par `CONVERSATION_RETENTION_DAYS` ; sessions inactives après 30 jours), mais la durée n'est écrite dans aucun document destiné au client. [corrigé le 13 nov. 2026 après relecture du code]

Bloquant pour la mise en ligne : tout le chantier, selon la roadmap (« chantier obligatoire avant la mise en ligne de wabagent.com »).

### 2.3 Chantier A, API ouverte (clé d'organisation et clé de partenaire)

Ce qui existe : une API d'administration complète sous `/api/admin/v1` (agents IA, entités, utilisateurs, comptes WhatsApp, réglages, simulateur, leads, usage, audit). Le back-office ne fait rien que l'API ne sache faire. Mais elle n'est accessible qu'avec une session d'utilisateur (identifiant et mot de passe, jeton court).

Ce qui manque pour qu'un éditeur de CRM ou une agence revende WABAGENT sous sa marque :
- **clés d'API** : aucune. Ni clé d'organisation, ni clé de partenaire. Aucune table ne garde quel partenaire a créé quelle organisation ;
- **limites de débit** : aucune par clé ni par organisation. La seule limite protège la connexion, par adresse IP ;
- **API v1 stable** : le préfixe `/v1` existe déjà, mais c'est l'API du back-office, qui change à chaque lot. Pas de version stable séparée, pas de documentation OpenAPI ;
- **raccordement par API** : dépend du lot R1 (en cours) ;
- **marque de l'interface** : aucun code de marque blanche (logo, couleurs, nom de domaine par partenaire) n'existe, et ce besoin n'est **pas écrit dans la roadmap** ;
- **facturation par partenaire** : rien (ni compteur par partenaire, ni commission). La roadmap P5 mentionne seulement « programme partenaires (commission sur usage) » ;
- **événements par webhook pour l'intégrateur** : seuls les leads partent (`lead.qualified`, `lead.updated`). Pas d'événement de conversation, de message ni de commande.

### 2.4 Connecteur MAD CRM

État : squelette. Les trois méthodes lèvent une erreur « not yet implemented » (`src/connectors/mad-crm.ts`). Le commentaire parle d'une « réunion lundi », sans date.

Ce qu'on attend d'eux : la spécification de leur API (adresses, authentification, création de contact, lien avec une affaire). En attendant, ils peuvent recevoir les leads par le webhook générique signé, s'ils acceptent notre format (`docs/CRM_INTEGRATION.md`). Ce webhook n'a lui-même jamais été validé en réel.

### 2.5 Connecteurs CRM

| Connecteur | État |
|---|---|
| HubSpot | validé en réel (un compte réel, `docs/CONNECTORS.md`) |
| Attio | schéma lu sur un vrai compte, écriture jamais exécutée |
| Pipedrive, Salesforce, Zoho | codés et testés en unitaire, jamais essayés en réel ; Salesforce et Zoho ne renouvellent pas leur jeton OAuth |
| Webhook générique | codé et testé en unitaire, jamais essayé en réel |
| MAD CRM | squelette |

Point commun : le réglage d'un CRM depuis le back-office n'existe pas (section « CRM » marquée « Soon »). Il se fait par l'API (`PUT /bots/:botId/crm/:connector`) ou par fichier de configuration. Les rendez-vous (`pushBooking`) et les commandes (`pushOrder`) existent dans l'interface des connecteurs mais aucun code ne les appelle : seuls les leads partent vers les CRM.

### 2.6 E-commerce

Existe :
- l'agent IA peut envoyer un produit, une liste de produits (jusqu'à 30 par section) ou le catalogue WhatsApp, si l'identifiant du catalogue Meta est dans la configuration de l'agent IA (`catalog.meta_catalog_id`) ;
- une commande envoyée par le contact depuis le catalogue est lue par le moteur (Meta et CM.com) et passée à l'agent IA sous forme de texte.

N'existe pas :
- l'événement `order.placed` n'est jamais émis : la commande ne part pas vers le CRM ;
- aucun lien avec Shopify, WooCommerce ou PrestaShop ;
- aucun suivi de commande (statut, livraison) ;
- aucun écran pour saisir l'identifiant du catalogue ;
- aucune gestion du catalogue (chantier C) ;
- pas de paiement dans WhatsApp.

Aucune validation en réel de l'envoi de produits n'a été trouvée dans les documents.

### 2.7 Chantier C, catalogue WhatsApp

Backlog, aucun code. Besoin écrit le 12 nov. 2026 : gérer depuis WABAGENT le catalogue rattaché au compte WhatsApp, au lieu du Commerce Manager de Meta. Première étape prévue : une étude de l'API Graph des catalogues. Préalable probable : lot R.

### 2.8 Conversations et leads : ce qu'un client voit aujourd'hui

Dans le back-office :
- sur la page d'un agent IA : le nombre de leads, de rendez-vous demandés, de conversations et de messages, et les dernières conversations (nom ou icône, dernier message, lead qualifié ou non) ;
- les numéros des contacts sont masqués pour qui n'a pas le droit de les voir ;
- la page Usage (coûts IA), pour l'administrateur seulement.

Ne voit pas : la liste complète des leads, le détail d'une conversation, la recherche, l'affectation à un conseiller, la reprise par un humain. Ces écrans sont marqués « Soon » ou « Disponible prochainement ». L'API sait déjà lister les leads et lire le détail d'un lead avec sa conversation : il manque l'écran.

### 2.9 Éditeur de parcours (P4) et modèles par secteur (P5)

Aucun code pour l'un ni pour l'autre. Aujourd'hui, le comportement d'un agent IA se règle par sa personnalité (texte) dans l'assistant de création, et ne se modifie plus ensuite depuis l'écran (« Modifier la personnalité » marqué « Soon »).

### 2.10 Mesure de l'usage et des coûts

Compté aujourd'hui :
- chaque appel au modèle IA : organisation, agent IA, contact, modèle, jetons (entrée, sortie, cache), coût en dollars selon une grille de prix versionnée (tables `llm_usage` et `llm_pricing`) ;
- vue par agent IA (total, par modèle, par jour) et par organisation (somme des agents IA), réservée à l'administrateur et à l'opérateur ;
- comptages simples par agent IA : leads, rendez-vous demandés, conversations (contacts distincts), messages.

Pas compté :
- le coût des messages WhatsApp (payé par l'organisation à Meta directement, ce que l'écran dit) ;
- aucun comptage par période de facturation ni par partenaire.

Manque pour facturer : abonnement, offres, quotas ou plafonds, blocage au dépassement, paiement (aucun code Stripe ni autre), factures. Rien de cela n'existe, et la facturation n'est pas un chantier écrit de la roadmap.

---

## 3. Vendable aujourd'hui

Précaution commune : rien n'est en ligne. Tant que le chantier S n'est pas fait, il ne faut vendre ni une date de mise en service ni une conformité.

On peut promettre sans mentir (fonctions qui existent et sont testées) :
- un agent IA qui répond sur WhatsApp, avec la personnalité et les langues choisies ;
- la qualification automatique des leads (nom, besoin, rendez-vous demandé, étape) ;
- l'utilisation de son propre compte WhatsApp Business (API officielle de Meta) ;
- plusieurs agents IA, un par numéro, plusieurs entités et une équipe avec des rôles ;
- un test au simulateur et une ouverture progressive (Whitelist, puis à tous) ;
- l'envoi des leads vers HubSpot ;
- le suivi du coût IA par agent IA ;
- le cloisonnement strict des données entre organisations clientes (testé).

Le site ne doit pas encore promettre :
- un raccordement sans aller dans Meta (lot R1 pas mergé ; et la création de l'app chez Meta reste nécessaire) ;
- « en un clic avec Facebook » (Embedded Signup) ;
- l'intégration avec Attio, Pipedrive, Salesforce, Zoho ou MAD CRM comme « prête » ;
- l'envoi des rendez-vous ou des commandes vers un CRM ;
- Shopify, WooCommerce, PrestaShop, suivi de commande, gestion du catalogue ;
- l'écran Conversations et leads, la reprise par un humain ;
- une API ouverte, la marque blanche, un programme partenaire ;
- des données traitées en Europe, la conformité RGPD, ISO 27001 ;
- le choix du modèle IA (OpenAI, Gemini, Mistral) : seul Anthropic est codé ;
- Twilio ou 360dialog ;
- un éditeur de parcours ou des modèles par secteur ;
- une offre avec quotas ou un paiement en ligne.

---

## 4. Écarts entre les documents et le code

1. **`README.md` est périmé** : il dit « P0, scaffolding, pas encore exécutable » et P1 à P5 en attente. Le dépôt compte 747 commits sur `main`, P0 à P2 sont faits, et une grande partie de P3 aussi. Il annonce Twilio, 360dialog, GPT, Gemini et Mistral : aucun n'est codé. Il cite `marketing/roi-calculator.html` sans que ce document ne l'ait vérifié.
2. **`docs/ROADMAP.md`, section R** : présente l'essai, la spec et le plan comme à faire ; ils sont faits et le code R1 est sur une branche.
3. **`docs/ROADMAP.md`, section P3** : toutes les cases sont vides ou partielles (« UI Settings », « API d'administration (REST) », « configuration bot via UI », « stockage chiffré : reste UI + câblage runtime »). Or le back-office, l'API d'administration, l'assistant et le câblage des identifiants chiffrés sont livrés. La ligne P2 « credentials par tenant en DB chiffrés = chantier P3 » est aussi dépassée.
4. **`docs/ROADMAP.md`, P1** : « validé sur 3 connecteurs (HubSpot, Attio, webhook-generic) ». `docs/CONNECTORS.md` dit qu'Attio n'a jamais écrit en réel et que le webhook générique n'a pas été validé en réel. Seul HubSpot l'est.
5. **`docs/ROADMAP.md`, P1** : « 50 tests Vitest » et « 98/98 tests » (P3) sont des chiffres d'époque, sans intérêt aujourd'hui.
6. **`docs/CRM_INTEGRATION.md`** (document partagé avec les partenaires) promet les événements `rdv.created`, `order.placed` et `message.received`, une file des échecs (« dead letter queue ») avec rejeu depuis un tableau de bord. Dans le code, seuls `lead.qualified` et `lead.updated` partent ; la file des échecs est un `TODO` (`src/connectors/webhook-generic.ts`, `src/core/crm-bridge.ts`). **À corriger avant de l'envoyer à un partenaire.**
7. **`docs/ARCHITECTURE-PARTENAIRE.md`** (document commercial) cite OpenAI, Google, Mistral (« option européenne »), Twilio et 360dialog, « API key par client, rotation supportée » et « rotation programmée des API keys ». Rien de cela n'est codé.
8. **`docs/ROADMAP.md`, P0** : « config bot depuis un fichier JSON ». Les agents IA sont aujourd'hui en base et créés depuis l'écran ; le pont CRM lit encore la configuration au démarrage (`listBots`, `src/core/crm-bridge.ts`), sans que ce document ait vérifié s'il voit un agent IA créé après le démarrage.
9. **`CLAUDE.md`** ne mentionne pas encore R1 en cours ni la nouvelle obligation de `PUBLIC_BASE_URL` pour le mode Meta (prévu dans le reste à faire de R1).
10. **`src/connectors/mad-crm.ts`** parle d'une « réunion lundi » sans date ni compte rendu trouvé.

---

## 5. Questions ouvertes pour François

1. **Facturation** : faut-il un chantier écrit (abonnement, quotas par organisation, paiement), et doit-il passer avant ou après le chantier A ? Aujourd'hui seul le coût IA est compté.
2. **Coûts WhatsApp** : on dit au client qu'il paie Meta directement. Veut-on le garder ainsi dans l'offre, ou refacturer et donc compter les conversations WhatsApp ?
3. **Marque blanche** : la revente par un éditeur ou une agence suppose-t-elle une interface à leur marque, ou seulement l'API (chantier A) ? Le besoin n'est écrit nulle part.
4. **MAD CRM** : la spécification d'API a-t-elle été obtenue ? Sinon, leur propose-t-on le webhook générique, à valider en réel d'abord ?
5. **Documents partenaires** : corrige-t-on `docs/CRM_INTEGRATION.md`, `docs/ARCHITECTURE-PARTENAIRE.md` et `README.md` avant tout envoi commercial, pour qu'ils ne promettent que ce qui existe ?
