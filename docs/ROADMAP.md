# Roadmap Cyran Labs Engine

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
- [ ] Migrer `attio.ts` → `connectors/attio.ts` qui implémente l'interface
- [x] Migrer `hubspot.ts` → `connectors/hubspot.ts` *(réécrit from scratch avec FieldMapper externalisé, validation runtime sur compte HubSpot réel `148357699`)*
- [ ] 🚧 Créer `connectors/mad-crm.ts` *(squelette posé, en attente des specs API MAD CRM)*
- [x] Créer `connectors/webhook-generic.ts` (POST signé HMAC, retry exponentiel 1s/4s/16s, idempotency keys)
- [x] Documenter l'événement normalisé : format JSON, signature, retry *(docs/CRM_INTEGRATION.md)*
- [x] Tests unitaires par connecteur *(37 tests Vitest pour FieldMapper + HubSpot ; webhook-generic et mad-crm à compléter)*

**Bonus livrés au-delà du scope initial** :
- [x] `FieldMapper` externalisé en JSON (`connectors-config/{client_id}/{connector}.json`) — préparé comme output de la future UI P3
- [x] Distinction `fixed_values` vs `default_values` (valeurs forcées vs fallbacks non destructifs)
- [x] CRM Bridge : orchestrateur qui scanne les bots au boot, instancie les connecteurs, s'abonne aux events `lead.qualified` / `lead.updated`
- [x] Classification automatique du `lifecyclestage` par le LLM (champ `stage` extrait par Claude Haiku selon la conversation)
- [x] Validation runtime e2e : message WhatsApp → Anthropic → lead extraction → push HubSpot avec `salesqualifiedlead` correctement classifié

**Critère de sortie** : ajouter un nouveau connecteur CRM = créer un fichier dans `connectors/` qui implémente l'interface. Zéro modif du moteur. **✅ Atteint pour HubSpot. Reste à appliquer pour Attio (migration) et MAD CRM (debloqué quand specs partenaires arrivent).**

---

## P2 — Transport agnostique (2 semaines)

**Objectif** : le moteur ne sait plus si les messages passent par CM.com ou Meta directement. Le client choisit son backend WhatsApp à l'onboarding.

- [x] Définir `Transport` interface : `sendText()`, `sendButtons()`, `sendList()`, `sendImage()`, `sendCta()`, `parseWebhook()` + UX feedback (read receipt, typing) + vérification HMAC optionnelle
- [x] Migrer `whatsapp-api.ts` (CM.com) → `transport/cm-com.ts` *(refactor en factory `createCmComTransport()`)*
- [x] Créer `transport/meta-cloud.ts` (Meta Cloud API officielle, accès direct sans BSP, vérification HMAC `X-Hub-Signature-256`)
- [ ] Externaliser les credentials Meta : passage de `.env` → DB par tenant (chiffrés) *(repoussé à P3 onboarding self-service)*
- [x] Adapter `index.ts` pour charger le bon transport par tenant *(routes séparées `/webhook/meta` et `/webhook/cm-com`, choix via `bot.transport`)*
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
  - Stockage chiffré des credentials *(porte aussi les credentials LLM et CRM par client)*
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

## P5 — Marketplace & Solution Partner (+)

**Objectif** : industrialiser et obtenir le statut officiel Meta.

- [ ] Templates de bots par secteur (e-commerce, immobilier, services, B2B)
- [ ] Marketplace interne pour les agences partenaires
- [ ] Programme partenaires (commission sur usage)
- [ ] Dossier Solution Partner Meta (candidature officielle)
- [ ] Certifications conformité (RGPD, ISO 27001 si pertinent)

**Critère de sortie** : Cyran Labs est référencé dans le directory Meta des Solution Partners.

---

## Légende

- [x] Fait
- [ ] À faire
- 🚧 En cours
- ⏳ Bloqué (dépendance externe)

---

*Dernière mise à jour : 29 avril 2026.*
