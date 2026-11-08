# Architecture WABAGENT Engine

**Audience** : développeurs, architectes et partenaires techniques (intégrateurs CRM, agences, éditeurs WhatsApp).

---

## Vue d'ensemble

WABAGENT Engine est un moteur conversationnel WhatsApp **multi-tenant**, **agnostique du transport, du modèle IA et du CRM**.

Le moteur ne dépend d'aucun fournisseur en particulier : ni d'un BSP WhatsApp (CM.com, 360dialog, Twilio…), ni d'un éditeur LLM (Anthropic, OpenAI, Google, Mistral), ni d'un CRM (HubSpot, Attio, Salesforce, MAD CRM…). Il définit des **interfaces** que des **adaptateurs** implémentent.

```
┌──────────────────────────────────────────────────────────────────┐
│                      CYRAN LABS ENGINE                           │
│                                                                  │
│  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐     │
│  │ TRANSPORT   │ ──→ │ CORE         │ ──→ │ CONNECTORS     │     │
│  │ (interface) │     │ (logique     │     │ (interface)    │     │
│  │             │     │  métier)     │     │                │     │
│  └─────────────┘     └──────────────┘     └────────────────┘     │
│        │                    │                     │              │
│        ▼                    ▼                     ▼              │
│   meta-cloud           llm/anthropic         crm/mad-crm         │
│   cm-com               llm/openai            crm/hubspot         │
│   twilio               llm/google            crm/attio           │
│   360dialog            llm/mistral           crm/webhook         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Capacités du moteur

- **Multi-tenant** : isolation `client_id × bot_id` au niveau données
- **Configurable par fichier JSON ou via interface d'administration** : un nouveau bot = 1 fichier de config (ou quelques clics dans l'UI), aucune modification de code
- **Transport WhatsApp pluggable** : Meta Cloud API officielle ou BSP intermédiaire
- **LLM pluggable** : interface `chat()` agnostique du fournisseur
- **Connecteurs CRM pluggables** : interface stable, format d'événement normalisé signé HMAC
- **Webhooks signés** : vérification HMAC des webhooks entrants Meta, avec le secret d'application de l'agent IA auquel le numéro destinataire est routé
- **Lead extraction automatique** : extraction structurée des informations du prospect, attendue sous le verrou de la conversation
- **Prompt caching** : optimisation des coûts LLM via cache TTL des system prompts
- **Idempotency / déduplication** : un même message entrant n'est traité qu'une fois
- **Verrou par conversation** : sérialisation stricte des messages d'un même contact pour un même numéro destinataire
- **LLM agnostique runtime** : choix du modèle par bot, configurable par client
- **Multi-transport simultané** : plusieurs bots avec des transports différents en parallèle dans un même runtime
- **Credentials chiffrés** : tokens transport / LLM / CRM stockés chiffrés en DB par client
- **Dashboard self-service** : UI d'administration par client pour onboarding rapide
- **Éditeur de parcours drag & drop** : composition visuelle des conversations

---

## Couche 1 : Transport

**Responsabilité** : recevoir et envoyer des messages WhatsApp, sans coupler le moteur à un fournisseur.

### Interface

```typescript
interface Transport {
  readonly id: string;
  readonly senderId: string; // identifiant de l'expéditeur chez le fournisseur (Meta : phone_number_id ; CM.com : from_number)

  // Envoi
  sendText(to: string, text: string): Promise<void>;
  sendButtons(to: string, text: string, buttons: ReplyButton[]): Promise<void>;
  sendList(to: string, text: string, button: string, sections: ListSection[]): Promise<void>;
  sendImage(to: string, url: string, caption?: string): Promise<void>;
  sendImageButtons(to: string, url: string, text: string, buttons: ReplyButton[]): Promise<void>;
  sendCta(to: string, text: string, label: string, url: string): Promise<void>;
  sendCatalog(to: string, text: string, footer?: string): Promise<void>;
  sendProduct(to: string, text: string, catalogId: string, productId: string): Promise<void>;
  sendProductList(to: string, text: string, header: string, catalogId: string, sections: ProductListSection[]): Promise<void>;

  // UX feedback
  sendReadReceipt(messageId: string): Promise<void>;
  sendTypingIndicator(to: string, messageId: string): Promise<void>;

  // Réception
  // Le parsing n'est pas porté par l'interface : ce sont des fonctions pures, sans identifiants,
  // parseMetaWebhook et parseCmWebhook, appelées par les routes de webhook.
  // Signature HMAC calculée sur les octets reçus (jamais sur un corps réanalysé).
  verifyWebhookSignature?(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
}
```

### Implémentations

- **Meta Cloud API** : API officielle Meta, accès direct sans intermédiaire. Vérification HMAC avec le secret d'application de l'agent IA.
- **CM.com BSP** : Business Solution Provider intermédiaire. Format propriétaire.
- **Twilio Conversations** : Provider alternatif sur demande client.
- **360dialog** : BSP européen.

### Choix par bot

Chaque bot déclare son transport dans son fichier de config :

```json
{
  "transport": "meta-cloud",
  "whatsapp_numbers": ["+33XXXXXXXXX"]
}
```

Un même runtime sert simultanément plusieurs bots avec des transports différents. Le routage entrant est dispatché par la route HTTP : `POST /webhook/meta` pour Meta (signature `X-Hub-Signature-256` vérifiée avec le secret d'application de l'agent IA) et `POST /webhook/cm-com/<organisation>/<agent IA>/<secret>` pour CM.com (l'URL porte l'organisation, l'agent IA et un secret propre à l'agent IA).

---

## Couche 2 : Core (logique métier)

**Responsabilité** : routing, sessions, déduplication, sérialisation per-phone, dispatch LLM, parsing réponse, dispatch sortant, événements métier.

Cette couche **ne connaît rien** du transport ni du CRM. Elle reçoit un `IncomingMessage` normalisé du transport, appelle le LLM, dispatche la réponse au transport, et émet des événements consommés par les connecteurs CRM.

### Composants

- **Router** : Résolution `client_id × bot_id` à partir du numéro WhatsApp destinataire ou de la session existante
- **Session manager** : Gestion des sessions multi-tenant en DB
- **Handler** : Pipeline LLM (prompt système + historique + profil → appel → parsing → dispatch sortant)
- **Dedup** : Déduplication atomique des messages entrants
- **Verrou par conversation** : Sérialisation stricte des messages d'un même contact pour un même numéro destinataire, clé (numéro destinataire, contact) (pas de race condition)
- **Lead extractor** : Extraction structurée (modèle léger), attendue sous le verrou de la conversation après la réponse ; un échec d'extraction n'empêche pas le traitement du message
- **Event bus** : Bus d'événements `BotEvent` (user/assistant messages, lead.qualified)
- **Bot config loader** : Chargement et indexation des fichiers `bots/{client_id}/{bot_id}.json`

### Données persistées

Tables, toutes munies de la paire `(client_id, bot_id)` pour l'isolation multi-tenant :

- `sessions` : session active d'un prospect sur un bot donné
- `conversations` : historique complet des messages user/assistant
- `leads` : données de qualification extraites (JSONB)
- `processed_messages` : table de déduplication (TTL 7 jours)

---

## Couche 3 : LLM (modèle IA)

**Responsabilité** : générer des réponses conversationnelles et extraire des informations structurées, sans coupler le moteur à un éditeur LLM.

### Interface

```typescript
interface LLMProvider {
  // Conversation
  chat(
    systemParts: SystemPromptPart[],
    messages: ChatMessage[],
    model?: string
  ): Promise<string>;

  // Extraction structurée
  extract(prompt: string, schema: JSONSchema): Promise<unknown>;

  readonly providerName: string;
}
```

### Implémentations

- **Anthropic** : Claude Sonnet 4 (conversation) + Claude Haiku 4.5 (extraction)
- **OpenAI** : GPT-5 / GPT-4o-mini
- **Google** : Gemini 2.5 Pro / Flash
- **Mistral** : Mistral Large / Small (option européenne / souveraineté)

### Optimisations

- **Prompt caching** : le system prompt + les blocs catalogue/contexte semi-statiques sont marqués `cache: true`, réduisant le coût des conversations multi-tours.
- **Cascade de modèles** : retry avec fallback automatique en cas de 429/529 upstream.
- **Concurrency limit** : contrôle global des appels LLM parallèles pour éviter de saturer les rate limits.

### Choix par bot

Chaque bot peut spécifier son modèle de conversation et d'extraction dans la config. Cela permet par exemple à un client de choisir Mistral pour des raisons de souveraineté EU.

---

## Couche 4 : Connecteurs CRM

**Responsabilité** : pousser les événements métier (lead qualifié, RDV, etc.) vers le CRM du client, avec garanties de livraison.

### Interface

```typescript
interface CRMConnector {
  pushLead(lead: NormalizedLead): Promise<void>;
  updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void>;
  pushBooking(booking: NormalizedBooking): Promise<void>;

  readonly connectorName: string;
}
```

### Implémentations

- **MAD CRM** : Webhook `lead.qualified` et `lead.updated` en temps réel
- **Attio** : Connecteur natif
- **HubSpot** : OAuth + API CRM standard
- **Webhook générique** : POST signé HMAC vers URL configurable (n8n, Zapier, custom)
- **Salesforce** : Connecteur entreprise
- **Klaviyo** : Connecteur e-commerce

### Garanties

- Webhooks POST signés **HMAC SHA-256**
- API key par client, rotation supportée
- **Retry exponentiel** (3 tentatives, 1s / 4s / 16s)
- **Idempotency keys** : un même événement ne peut être poussé deux fois
- **Dead letter queue** : événements en échec persistent pour replay manuel
- Body JSON normalisé selon `docs/CRM_INTEGRATION.md`

---

## Multi-tenant : modèle de données

### Configuration

Chaque bot est défini par un fichier JSON dans `bots/{client_id}/{bot_id}.json`. Aucun code à modifier pour ajouter un bot.

```json
{
  "client_id": "boutique-paris",
  "bot_id": "qualification-leads",
  "name": "Bot qualification : Boutique Paris",
  "transport": "meta-cloud",
  "whatsapp_numbers": ["+33XXXXXXXXX"],
  "system_prompt": "Tu es le conseiller de vente de la boutique...",
  "lead_fields": "first_name, last_name, email, project_type, budget",
  "welcome": {
    "enabled": true,
    "message": "Bonjour {profileName}, en quoi puis-je vous aider ?"
  }
}
```

### Isolation données

Toutes les tables (`sessions`, `conversations`, `leads`, `processed_messages`) embarquent `client_id` + `bot_id`. Chaque requête métier filtre sur ces deux colonnes. Aucune fuite cross-tenant possible au niveau applicatif.

### Routage entrant

À l'arrivée d'un message, le moteur résout le `(client_id, bot_id)` cible :

1. **Session existante** : on continue avec son couple `(client_id, bot_id)`
2. **Numéro WhatsApp destinataire** : mappé vers un bot via le champ `whatsapp_numbers` de la config
3. **Aucun bot configuré pour ce numéro** : message ignoré, log d'avertissement

L'absence de routage par mot-clé ou tag est un choix : un numéro WhatsApp = un bot. Cohérence et prévisibilité maximales.

### Stockage credentials

Les credentials transport / LLM / CRM sont chiffrés (AES-256) et stockés par client en DB, avec une clé maître `MASTER_ENCRYPTION_KEY` côté env, pour permettre l'onboarding self-service multi-clients sans redéploiement.

---

## Comptes et équipes

Une organisation regroupe des entités (boutique, équipe, service client) et des utilisateurs. Chaque agent IA est rattaché à une entité.

Le moteur fournit :

- des entités par organisation ;
- des appartenances par organisation ou par entité, avec quatre rôles ;
- des réglages d'organisation ;
- des invitations par lien à usage unique.

### Rôles

Un rôle s'applique à un périmètre. Par organisation, un utilisateur a soit une appartenance de niveau organisation, soit une ou plusieurs appartenances d'entité.

| Rôle | Périmètre | Droits |
|---|---|---|
| Admin | organisation | Tout : agents IA, connexions, entités, utilisateurs, invitations, réglages, journal d'audit |
| Super manager | organisation (toutes les entités, futures comprises) | Consultation complète et simulateur ; option lecture seule |
| Manager | une ou plusieurs entités | Consultation et simulateur |
| Conseiller | une ou plusieurs entités | Consultation et simulateur |

Un opérateur plateforme (super admin) accède à toute organisation avec les droits d'un Admin. Retirer ou suspendre le dernier Admin actif d'une organisation est refusé.

### Organisation active

Chaque appel à l'API d'administration (`/api/admin/v1`) désigne l'organisation par l'en-tête `X-Organization-Id`. Si l'en-tête manque et que l'utilisateur n'appartient qu'à une organisation, celle-ci est prise ; sinon la réponse est 400. Un utilisateur sans appartenance active dans l'organisation demandée reçoit 403. La liste des organisations d'un utilisateur, avec son rôle, est disponible sur `GET /auth/me`.

### Invitations

- Seul un Admin invite ; l'opérateur plateforme invite le premier Admin d'une organisation.
- Toute invitation doit être acceptée par la personne invitée, qu'elle ait déjà un compte ou non.
- Le lien est à usage unique et expire après 7 jours par défaut. Aucun identifiant n'est envoyé : l'invité choisit son mot de passe, ou se connecte avec son compte existant pour accepter.
- Un lien perdu ou expiré se remplace par « renvoyer l'invitation ».

### Réglages d'organisation

Les réglages d'organisation portent sur la visibilité (tout le monde voit tout) ; l'API accepte aussi les règles de gestion des contacts, qui s'appliqueront avec la gestion des contacts. Lecture pour tous les membres, écriture réservée à l'Admin.

---

## Sécurité

- Vérification HMAC SHA-256 des webhooks entrants Meta (`X-Hub-Signature-256`), avec le secret d'application de l'agent IA auquel le numéro destinataire est routé
- Vérification du `verify_token` Meta sur la route GET de validation
- Verrou par (numéro destinataire, contact) : pas de race condition entre messages d'une même conversation
- Déduplication atomique des messages entrants (idempotent)
- Purge automatique des conversations anciennes (90 jours par défaut, réglable par `CONVERSATION_RETENTION_DAYS`), des messages traités (7 jours) et des sessions inactives (30 jours), au démarrage puis toutes les 6 h
- Graceful shutdown (SIGTERM/SIGINT, fermeture DB propre)
- Leads, santé, métriques et usage de chaque agent IA lus par l'API d'administration, cloisonnée par organisation
- Credentials chiffrés en DB (AES-256) par client
- Audit log des accès admin
- Rotation programmée des API keys

---

## Performance

### Capacité actuelle

Estimations à confirmer en charge réelle :

- **1 instance moyenne (4 vCPU / 8 GB RAM)** : ~50-100 conversations simultanées
- **Au-delà** : scale horizontal, Postgres partagé, multiplier les workers Express derrière un load balancer
- **Rate limits Anthropic** : ~100 RPM tier 1, ~1000 RPM tier 2
- **Rate limits Meta Cloud API** : 80 messages/seconde V1, scalable selon vérification entreprise

### Stockage

- **PostgreSQL** : recommandé en production (concurrence, durabilité, JSONB pour les leads)
- **SQLite** : supporté en développement local et tests (driver auto-sélectionné selon `DATABASE_URL`)

---

## Axes de développement du moteur

Le moteur évolue autour de plusieurs chantiers structurants, pensés pour répondre aux besoins d'un déploiement multi-clients à grande échelle.

### Socle technique

- Moteur agnostique, multi-tenant, configurable par fichier JSON ou via interface d'administration
- Architecture en couches (Transport / Core / LLM / Connecteurs CRM) avec interfaces stables

### Connecteurs CRM

- Couche connectors complète : MAD CRM, HubSpot, Attio, Salesforce, Klaviyo, webhook générique
- Garanties de livraison : retry exponentiel, signature HMAC, idempotency keys, dead letter queue
- Format d'événement normalisé partagé par tous les connecteurs

### Transport WhatsApp

- Multi-transport simultané : plusieurs bots avec des transports différents en parallèle dans un même runtime
- Credentials par client chiffrés en DB
- Support BSP (CM.com, 360dialog) et accès direct Meta Cloud API

### Onboarding self-service

- UI d'administration par client
- Guided setup Meta Business : création WABA, vérification numéro, génération token
- Configuration bot via UI (prompts, parcours, catalogue, CTA)
- Mapping des champs CRM
- Test bot live depuis l'UI (QR code de prévisualisation)
- API REST d'administration pour intégrations partenaires

### Éditeur de parcours

- Composeur visuel de parcours conversationnels (drag & drop)
- Intégration des composants WhatsApp Flows dans la composition des parcours : un bloc de l'éditeur peut être compilé vers un Flow Meta natif (formulaire, sélection guidée) au lieu d'une séquence de messages séparés
- Bibliothèque de blocs métier : accueil, routing, identité, validation, condition, branche, produit, catalogue, image, CTA, booking, webhook, escalade
- Génération automatique des prompts depuis le graphe
- Prévisualisation temps réel (simulateur conversation)

### API Meta et WhatsApp Flows

- Intégration native de l'API Meta Cloud officielle (lorsqu'utilisée en accès direct, sans BSP) : gestion des comptes WABA, vérification de numéro, soumission et gestion des Message Templates, configuration des webhooks, conformité aux limites de débit Meta
- Lorsque le transport WhatsApp passe par un BSP (CM.com, 360dialog, Twilio…), la gestion du compte WABA, des Message Templates, de la vérification de numéro et du débit relève du BSP. Le moteur s'interface avec l'API exposée par le BSP.
- Support WhatsApp Flows : parcours interactifs guidés (formulaires, sélections multi-étapes, navigation conditionnelle), définition JSON Flow, intégration des résultats dans le moteur conversationnel

### Industrialisation

- Templates de bots par secteur (e-commerce, retail, services, B2B)
- Marketplace pour les agences partenaires
- Programme partenaires (commission sur usage)
- Certifications conformité (RGPD, ISO 27001 si pertinent)
- Candidature Meta Solution Partner

---

## Documents associés

- `CRM_INTEGRATION.md` : Format normalisé de l'événement CRM, signature HMAC, retry, idempotency
- `GLOSSAIRE.md` : Terminologie projet

---

*Édité par WABAGENT. Dernière mise à jour : novembre 2026.*
