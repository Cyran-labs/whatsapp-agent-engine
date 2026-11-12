# Roadmap WABAGENT Engine

**Source de vérité** : ce document fixe les étapes P0 à P5 du découplage et de la productisation du moteur.

---

## P0 — Décollage (2 semaines)

**Objectif** : avoir un nouveau dépôt fonctionnel, débarrassé des spécificités de la démo Cyran (thématiques golf, immo, voyage, auto, acquisition).

- [x] Créer le repo `cyran-labs-engine`
- [x] Copier le code base de `whatsapp-cyran-bot/src/` (db, llm, whatsapp-api, router, handler, admin, events)
- [x] Supprimer toutes les thématiques métier (`bots/handler.ts` ne doit plus connaître "golf", "immo", etc.)
- [x] Refondre le routing : plus de mot-clé `[GOLF]`, plus de `routeMessage()` par tag, mais routage par `client_id` × `bot_id` issu de la config
- [x] Multi-tenant DB : ajouter `client_id` sur toutes les tables (sessions, conversations, leads, processed_messages)
- [x] Charger la config bot depuis un fichier `bots/{client_id}/{bot_id}.json` (pas hardcodé en code)
- [x] Doc d'architecture publique (`docs/ARCHITECTURE.md` interne + `docs/ARCHITECTURE-PARTENAIRE.md` commercial)

**Critère de sortie** : un bot configurable par fichier JSON, déployable pour un nouveau client en moins d'une heure (sans toucher au code). **✅ Atteint, validé runtime e2e Phase 1bis (welcome + Anthropic + sendText Meta).**

---

## P1 — Connecteurs CRM (2 semaines)

**Objectif** : sortir le push CRM hors du code core. Tout passe par une couche `connectors/` avec une interface commune.

- [x] Définir `Connector` interface (TypeScript) avec méthodes : `pushLead()`, `updateLead()`, `pushBooking()`
- [x] Migrer `attio.ts` → `connectors/attio.ts` *(réécrit from scratch, parité prod : Person+Company+Note + Deal en stage configurable + Task assignée ; config par `options` Attio-spécifiques car modèle imbriqué incompatible FieldMapper)*
- [x] Migrer `hubspot.ts` → `connectors/hubspot.ts` *(réécrit from scratch avec FieldMapper externalisé, validation runtime sur compte HubSpot réel `148357699`)*
- [ ] 🚧 Créer `connectors/mad-crm.ts` *(squelette posé, en attente des specs API MAD CRM — ne bloque pas le reste : webhook-generic couvre le besoin V1)*
- [x] Créer `connectors/webhook-generic.ts` (POST signé HMAC, retry exponentiel 1s/4s/16s, idempotency keys ; bug fail-fast 4xx corrigé)
- [x] Documenter l'événement normalisé : format JSON, signature, retry *(docs/CRM_INTEGRATION.md)*
- [x] Tests unitaires par connecteur *(50 tests Vitest : FieldMapper, HubSpot, Attio, webhook-generic ; mad-crm = squelette non testé tant que specs absentes)*

**Connecteurs additionnels (librairie)** — code-complet + tests unitaires, runtime à valider quand comptes disponibles :
- [x] `connectors/pipedrive.ts` (Person + note RDV, modèle plat via FieldMapper, auth api_token)
- [x] `connectors/salesforce.ts` (sObject Lead, SOQL dedup, auth OAuth Bearer + instanceUrl ; refresh token = P3)
- [x] `connectors/zoho.ts` (module Leads, search criteria, auth Zoho-oauthtoken + apiDomain par data center ; refresh token = P3)
- [x] Helper HTTP partagé `connectors/http.ts` (retry exponentiel + fail-fast 4xx typé via CrmHttpError ; utilisé par les nouveaux connecteurs)
- [x] Mappings par défaut `connectors-config/default/{pipedrive,salesforce,zoho}.json`
- [x] Smoke test registry instanciant les 7 types

**Bonus livrés au-delà du scope initial** :
- [x] `FieldMapper` externalisé en JSON (`connectors-config/{client_id}/{connector}.json`) — préparé comme output de la future UI P3
- [x] Distinction `fixed_values` vs `default_values` (valeurs forcées vs fallbacks non destructifs)
- [x] CRM Bridge : orchestrateur qui scanne les bots au boot, instancie les connecteurs, s'abonne aux events `lead.qualified` / `lead.updated`
- [x] Classification automatique du `lifecyclestage` par le LLM (champ `stage` extrait par Claude Haiku selon la conversation)
- [x] Validation runtime e2e : message WhatsApp → Anthropic → lead extraction → push HubSpot avec `salesqualifiedlead` correctement classifié

**Critère de sortie** : ajouter un nouveau connecteur CRM = créer un fichier dans `connectors/` qui implémente l'interface. Zéro modif du moteur. **✅ Atteint et validé sur 3 connecteurs (HubSpot, Attio, webhook-generic). MAD CRM = squelette en attente de specs, ne bloque plus le critère de sortie (webhook-generic couvre la V1).**

---

## P2 — Transport agnostique (2 semaines)

**Objectif** : le moteur ne sait plus si les messages passent par CM.com ou Meta directement. Le client choisit son backend WhatsApp à l'onboarding.

- [x] Définir `Transport` interface : `sendText()`, `sendButtons()`, `sendList()`, `sendImage()`, `sendCta()`, `parseWebhook()` + UX feedback (read receipt, typing) + vérification HMAC optionnelle
- [x] Migrer `whatsapp-api.ts` (CM.com) → `transport/cm-com.ts` *(refactor en factory `createCmComTransport()`)*
- [x] Créer `transport/meta-cloud.ts` (Meta Cloud API officielle, accès direct sans BSP, vérification HMAC `X-Hub-Signature-256`)
- [x] Externaliser les credentials Meta : passage de `.env` → DB par tenant (chiffrés) *(fondation P3 + câblage runtime livrés : resolver consommé par LLM (`getClientForTenant`), transport (`getTransportForBot` async, bot résolu avant vérif HMAC) et CRM (`initCrmBridge` async, tous connecteurs câblés). Aucun repli sur les identifiants `.env` de la plateforme depuis le lot 2b-1 : un agent IA sans identifiants complets n'est pas servi.)*
- [x] Adapter `index.ts` pour charger le bon transport par tenant *(routes séparées `POST /webhook/meta` et `POST /webhook/cm-com/<organisation>/<agent IA>/<secret>` ; l'URL CM.com porte l'organisation, l'agent IA et un secret propre à l'agent IA ; choix via `bot.transport`)*
- [ ] Documentation procédure onboarding nouveau client (Direct Meta vs BSP vs Client BYO) *(à rédiger, partiellement décrit dans `ARCHITECTURE.md`)*

**Critère de sortie** : un même moteur qui sert simultanément un client en Meta Direct et un client en CM.com BSP, sans ambiguïté. **✅ Architecture livrée et runtime-ready (validé Meta direct, CM.com prêt côté code mais non re-testé runtime sur ce repo). Credentials par tenant en DB chiffrés = chantier P3.**

---

## P3 — Onboarding self-service (3 semaines)

**Objectif** : permettre à un nouveau client (ou MAD CRM pour ses propres clients) de configurer un bot via une UI, sans intervention dev.

- [ ] UI Settings (React + Tailwind ?) : dashboard admin par tenant
- [ ] Connexion Meta Business Manager : guided setup pas-à-pas
  - Création WABA
  - Vérification numéro
  - Génération token API Cloud
  - [~] Stockage chiffré des credentials *(porte aussi les credentials LLM et CRM par client)* (**fondation livrée**) : `src/core/credentials/` (crypto AES-256-GCM, store SQLite/Postgres, resolver byo/platform + fallback bot→client→`.env` ; le repli `.env` pour les identifiants de transport a été supprimé au lot 2b-1, seule la clé LLM de la plateforme (`ANTHROPIC_API_KEY`) reste en mode platform, par choix), table `tenant_credentials`, script `scripts/seed-credentials.ts`, 98/98 tests. Reste UI + câblage runtime.
- [ ] Mapping champs CRM : associer chaque champ extrait du lead à une property du CRM cible *(préparé par le format `FieldMapping` JSON versionné déjà en place — l'UI produira exactement ce format)*
- [ ] Configuration bot via UI (prompts, parcours, catalogue, CTA)
- [ ] Test bot live depuis l'UI (envoyer un QR code, scanner, vérifier la conversation)
- [ ] API d'administration (REST) pour intégration MAD CRM côté plateforme

**Critère de sortie** : un nouveau client se branche en autonomie en moins de 30 min depuis l'UI.

---

## P4 — Éditeur drag & drop (4 semaines)

**Objectif** : composer les parcours conversationnels visuellement, sans toucher aux prompts.

- [ ] Builder visuel React Flow
- [ ] Bibliothèque de blocs métier :
  - Entrée : Accueil, Routing
  - Collecte : Identité, Question, Validation
  - Logique : Condition, Branche
  - Contenu : Produit, Catalogue, Image
  - Action : CTA, Booking, Webhook
  - Sortie : Confirmation, Escalade
- [ ] Intégration WhatsApp Flows natifs Meta : un bloc compile vers un Flow JSON natif (formulaire, sélection multi-étapes) au lieu d'une séquence de messages
- [ ] Génération automatique des prompts à partir du graphe
- [ ] Génération de la config bot
- [ ] Prévisualisation temps réel (simulateur conversation)
- [ ] Intégration dans l'UI Settings (P3)

**Critère de sortie** : un commercial Cyran configure un bot pour un nouveau client en 1h sans dev.

---

## S — Sécurité, conformité et données en Europe (préalable à la mise en ligne)

**Objectif** (François, 9 nov. 2026) : n'avoir aucun doute sur la sécurité de la plateforme et des données des organisations et de leurs contacts, pouvoir le démontrer à un client, et traiter les données en Europe, modèles Claude compris. Chantier obligatoire avant la mise en ligne de wabagent.com.

### S1. Document de sécurité

- [ ] `docs/SECURITE.md` (interne, avec statuts et preuves) et une version partenaire sans statuts, sur le modèle de `ARCHITECTURE.md` / `ARCHITECTURE-PARTENAIRE.md`.
- [ ] Référentiels retenus, chacun avec une table « exigence, mesure, preuve (test ou fichier) » :
  - OWASP ASVS (dernière version, niveau 2) : référentiel applicatif principal, vérifiable point par point ;
  - OWASP Top 10 : contrôle de couverture ;
  - RGPD : WABAGENT est sous-traitant de ses organisations clientes (contrat de sous-traitance art. 28, registre, liste des sous-traitants ultérieurs, durées de conservation, droits des contacts) ;
  - recommandations de l'ANSSI (hygiène informatique, journalisation) pour l'hébergement ;
  - ISO 27001 comme cadre d'organisation, certification seulement si des clients l'exigent (rappel P5).
- [ ] Inventaire des mesures déjà en place, avec leur preuve : isolation par organisation testée sur SQLite et Postgres (suite `src/__tests__/isolation/`) ; identifiants chiffrés en AES-256-GCM ; webhooks authentifiés avant tout effet de bord (clé d'URL par compte, signature HMAC Meta) ; aucun repli sur les identifiants de la plateforme ; rôles et droits par périmètre ; aucune mise en cache des réponses authentifiées (BFF et API d'administration) ; journaux sans secret ; revue d'isolation indépendante à chaque lot.

### S2. Audits

- [ ] Revue de sécurité automatisée de tout le dépôt avec les outils d'Anthropic : commande `/security-review` de Claude Code, et Claude Code Security (scanner lancé le 20 févr. 2026, en accès limité pour les comptes Team et Enterprise à son lancement : vérifier l'accès sur le compte de François). En complément des outils d'analyse statique, pas à leur place.
- [ ] Analyse des dépendances et des secrets dans la CI (`npm audit` ou équivalent, détection de secrets dans l'historique git).
- [ ] Audit complet avant mise en ligne (spec 2b, §4.6), observations héritées des revues d'isolation comprises (`docs/superpowers/research/*revue-isolation*`).
- [ ] Test d'intrusion externe par un prestataire avant les premiers clients payants.

### S3. Données en Europe

- [ ] Modèles Claude traités en Europe. État vérifié le 9 nov. 2026 :
  - l'API Anthropic directe propose `inference_geo` avec `global` (par défaut) ou `us`, pas de zone Europe ;
  - Amazon Bedrock propose des profils d'inférence géographiques UE (exemple documenté : `eu.anthropic.claude-sonnet-5`, traitement réparti entre régions AWS de l'UE) ; Google Vertex AI propose des régions européennes.
  - À vérifier avant de choisir : disponibilité de Sonnet 5.5 et Haiku 5.5 dans le profil UE, prix, mise en cache des prompts et autres fonctions utilisées par le moteur (tableau de disponibilité par plateforme), conditions de traitement des données.
  - Travail moteur : un fournisseur Bedrock (ou Vertex) dans la couche LLM, choisi par configuration, avec la même cascade de modèles, les tarifs par fournisseur et les tests ; la couche LLM est déjà abstraite.
- [ ] Moteur, base de données et sauvegardes hébergés dans l'UE (localisation du VPS à confirmer et à écrire dans S1).
- [ ] WhatsApp : documenter où Meta et CM.com traitent les messages, et l'option de stockage local de l'API Cloud de Meta si elle existe pour l'UE (à vérifier).
- [ ] Données des contacts : durée de conservation des conversations et purge, export et suppression d'un contact à la demande, information du contact.

**Critère de sortie** : le document de sécurité est à jour et chaque exigence a sa preuve ; les audits n'ont plus de constat bloquant ; les messages des contacts et les appels aux modèles sont traités dans l'UE, ou l'écart est écrit et accepté par François.

---

## R : raccordement automatique du compte WhatsApp (lot suivant le merge de la refonte de la navigation)

**Objectif** : supprimer la recopie manuelle de l'URL de webhook et du jeton de vérification dans l'app Meta. Décidé par François le 12 nov. 2026 : on enchaîne sur ce lot dès le merge de la branche `feat/refonte-navigation`.

**Aujourd'hui** : l'administrateur saisit le WABA ID, le jeton et le secret de l'app dans le back-office (Organisation › Connexions › Raccorder) ; le back-office lui donne l'URL de webhook propre au compte et le jeton de vérification, qu'il recopie lui-même dans la configuration Webhook de son app Meta.

**Cible** : le moteur inscrit lui-même le webhook auprès de Meta par l'API Graph `POST /<WABA_ID>/subscribed_apps` avec `override_callback_uri` (200 caractères au plus) et `verify_token` ; lecture par `GET /<WABA_ID>/subscribed_apps` ; retrait par `POST` sans corps. Priorité de Meta : numéro, puis WABA, puis app.

- [ ] Essai préalable, avant la spec, sur le compte de développement (WABA de dev `1122051030798254`, numéro de test +1 555 164 9072, app WABAGENT Dev) : Meta fait-il le GET de vérification au moment de l'appel ; quelle permission du jeton est exigée ; l'override marche-t-il avec un numéro de test et une app non publiée.
- [ ] Spec, plan, exécution, revue d'isolation, recette (méthode de `CLAUDE.md`).

**Critère de sortie** : un compte raccordé depuis le back-office reçoit les messages sans aucune saisie dans Meta.

Note : l'Embedded Signup (raccordement « en un clic » avec Facebook) demande une app publiée et le statut Tech Provider ; ce lot s'en rapproche côté expérience sans en dépendre.

---

## A : API ouverte, intégration sans interface (après le lot R et le chantier S)

**Besoin (François, 12 nov. 2026)** : un client qui a déjà son propre outil, le plus souvent son CRM, veut utiliser WABAGENT sans notre back-office, en pilotant tout depuis son outil par notre API : raccorder son compte WhatsApp Business côté Meta (le travail technique est fait par WABAGENT), créer et régler l'agent IA (personnalité, langues, Whitelist, passage en Preview puis Online), et récupérer leads et conversations dans son outil. WABAGENT devient un moteur sans interface visible ; notre back-office n'est qu'une interface parmi d'autres, au-dessus de la même API.

**Deux usages, compatibles, à prévoir dès la conception** (on ne sait pas encore lequel viendra en premier) :
- clé d'organisation : une entreprise utilise WABAGENT pour elle-même ; la clé ne voit que son organisation, comme un administrateur aujourd'hui ;
- clé de partenaire : un éditeur revend WABAGENT à ses propres clients ; la clé crée des organisations et n'agit que sur celles qu'elle a créées, jamais sur les autres. La base garde quel partenaire a créé quelle organisation, et ce cloisonnement est tenu par le moteur. La clé d'organisation est un cas particulier : on peut commencer par elle sans rien casser ensuite.

**Ce qui existe déjà** (état du 12 nov. 2026) :
- API d'administration complète du moteur (`src/api/admin/router.ts`) : agents IA, entités, utilisateurs, comptes WhatsApp, réglages, simulateur, tableaux de bord, audit ; le back-office ne fait rien que l'API ne sache faire ;
- cloisonnement par organisation : authentification, résolution de l'organisation active, puis action requise par route, droits par rôle tenus par le moteur (`src/core/auth/permissions.ts`) ;
- contrats partagés (`packages/contracts`), erreurs stables avec clé `error.reason` et référence de requête ;
- événements sortants signés (connecteur CRM : HMAC, nouvel essai, idempotence), documentés pour un partenaire dans `docs/CRM_INTEGRATION.md`.

**Ce qui manque** :
- [ ] Clés d'API par organisation (puis par partenaire) : hachées en base, à périmètre précis (lecture des leads, envoi, gestion), révocables, tracées dans l'audit ; aujourd'hui seule une session d'utilisateur (jeton court et renouvellement) donne accès.
- [ ] Limites de débit par clé et par organisation (aucune aujourd'hui) : protéger les autres organisations et la facture LLM.
- [ ] API `/v1` stable et versionnée, séparée des routes du back-office qui changent à chaque lot ; documentation OpenAPI publique.
- [ ] Routes métier : raccorder un compte WhatsApp (dépend du lot R), créer et régler un agent IA, envoyer un message ou ouvrir une conversation, lire conversations et leads (recoupe le chantier « Conversations et leads »), s'abonner aux événements par webhook.
- [ ] Revue d'isolation dédiée et audit complet avant ouverture (spec 2b, §4.5 et §4.6).

**Préalables** : lot R (on ne peut pas proposer le raccordement par API s'il demande encore une saisie dans Meta) ; chantier S (sécurité, hébergement en Europe, audits), car une API publique est la plus grande surface d'attaque.

**Critère de sortie** : un client raccorde son compte WhatsApp, crée un agent IA, le met Online et reçoit ses leads, uniquement par l'API, avec une clé qui ne voit que son organisation (ou, pour un partenaire, que les organisations qu'il a créées), sans jamais ouvrir le back-office.

---

## P5 — Marketplace & Solution Partner (+)

**Objectif** : industrialiser et obtenir le statut officiel Meta.

- [ ] Templates de bots par secteur (e-commerce, immobilier, services, B2B)
- [ ] Marketplace interne pour les agences partenaires
- [ ] Programme partenaires (commission sur usage)
- [ ] Dossier Solution Partner Meta (candidature officielle)
- [ ] Certifications conformité (RGPD, ISO 27001 si pertinent)

**Critère de sortie** : WABAGENT est référencé dans le directory Meta des Solution Partners.

---

## Légende

- [x] Fait
- [ ] À faire
- 🚧 En cours
- ⏳ Bloqué (dépendance externe)

---

*Dernière mise à jour : 12 novembre 2026 (lots R et A).*
