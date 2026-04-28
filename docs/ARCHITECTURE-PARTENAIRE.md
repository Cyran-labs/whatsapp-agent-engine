# Architecture Cyran Labs Engine

**Audience** : développeurs, architectes et partenaires techniques (intégrateurs CRM, agences, éditeurs WhatsApp).

---

## Vue d'ensemble

Cyran Labs Engine est un moteur conversationnel WhatsApp **multi-tenant**, **agnostique du transport, du modèle IA et du CRM**.

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
- **Webhooks signés** : vérification HMAC des webhooks entrants Meta
- **Lead extraction automatique** : extraction structurée des informations du prospect en arrière-plan
- **Prompt caching** : optimisation des coûts LLM via cache TTL des system prompts
- **Idempotency / déduplication** : un même message entrant n'est traité qu'une fois
- **Mutex per-phone** : sérialisation stricte des messages d'un même prospect
- **LLM agnostique runtime** : choix du modèle par bot, configurable par client
- **Multi-transport simultané** : plusieurs bots avec des transports différents en parallèle dans un même runtime
- **Credentials chiffrés** : tokens transport / LLM / CRM stockés chiffrés en DB par client
- **Dashboard self-service** : UI d'administration par client pour onboarding rapide
- **Éditeur de parcours drag & drop** : composition visuelle des conversations

---

## Couche 1 — Transport

**Responsabilité** : recevoir et envoyer des messages WhatsApp, sans coupler le moteur à un fournisseur.

### Interface

```typescript
interface Transport {
  readonly id: string;

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
  parseWebhookPayload(body: unknown): IncomingMessage | null;
  verifyWebhookSignature?(rawBody: string, headers: Record<string, string>): boolean;
}
```

### Implémentations

- **Meta Cloud API** — API officielle Meta, accès direct sans intermédiaire. Vérification HMAC `META_APP_SECRET`.
- **CM.com BSP** — Business Solution Provider intermédiaire. Format propriétaire.
- **Twilio Conversations** — Provider alternatif sur demande client.
- **360dialog** — BSP européen.

### Choix par bot

Chaque bot déclare son transport dans son fichier de config :

```json
{
  "transport": "meta-cloud",
  "whatsapp_numbers": ["+33XXXXXXXXX"]
}
```

Un même runtime sert simultanément plusieurs bots avec des transports différents. Le routage entrant est dispatché par la route HTTP (`/webhook/meta`, `/webhook/cm-com`).

---

## Couche 2 — Core (logique métier)

**Responsabilité** : routing, sessions, déduplication, sérialisation per-phone, dispatch LLM, parsing réponse, dispatch sortant, événements métier.

Cette couche **ne connaît rien** du transport ni du CRM. Elle reçoit un `IncomingMessage` normalisé du transport, appelle le LLM, dispatche la réponse au transport, et émet des événements consommés par les connecteurs CRM.

### Composants

- **Router** — Résolution `client_id × bot_id` à partir du numéro WhatsApp destinataire ou de la session existante
- **Session manager** — Gestion des sessions multi-tenant en DB
- **Handler** — Pipeline LLM (prompt système + historique + profil → appel → parsing → dispatch sortant)
- **Dedup** — Déduplication atomique des messages entrants
- **Per-phone mutex** — Sérialisation stricte des messages d'un même prospect (pas de race condition)
- **Lead extractor** — Extraction structurée en arrière-plan (modèle léger, fire-and-forget)
- **Event bus** — Bus d'événements `BotEvent` (user/assistant messages, lead.qualified)
- **Bot config loader** — Chargement et indexation des fichiers `bots/{client_id}/{bot_id}.json`
- **Admin commands** — Commandes opérateur (`/reset`, `/history`, `/sessions`, `/leads`, `/bots`)

### Données persistées

Tables, toutes munies de la paire `(client_id, bot_id)` pour l'isolation multi-tenant :

- `sessions` — session active d'un prospect sur un bot donné
- `conversations` — historique complet des messages user/assistant
- `leads` — données de qualification extraites (JSONB)
- `processed_messages` — table de déduplication (TTL 7 jours)

---

## Couche 3 — LLM (modèle IA)

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

- **Anthropic** — Claude Sonnet 4 (conversation) + Claude Haiku 4.5 (extraction)
- **OpenAI** — GPT-5 / GPT-4o-mini
- **Google** — Gemini 2.5 Pro / Flash
- **Mistral** — Mistral Large / Small (option européenne / souveraineté)

### Optimisations

- **Prompt caching** : le system prompt + les blocs catalogue/contexte semi-statiques sont marqués `cache: true`, réduisant le coût des conversations multi-tours.
- **Cascade de modèles** : retry avec fallback automatique en cas de 429/529 upstream.
- **Concurrency limit** : contrôle global des appels LLM parallèles pour éviter de saturer les rate limits.

### Choix par bot

Chaque bot peut spécifier son modèle de conversation et d'extraction dans la config. Cela permet par exemple à un client de choisir Mistral pour des raisons de souveraineté EU.

---

## Couche 4 — Connecteurs CRM

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

- **MAD CRM** — Webhook `lead.qualified` et `lead.updated` en temps réel
- **Attio** — Connecteur natif
- **HubSpot** — OAuth + API CRM standard
- **Webhook générique** — POST signé HMAC vers URL configurable (n8n, Zapier, custom)
- **Salesforce** — Connecteur entreprise
- **Klaviyo** — Connecteur e-commerce

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
  "client_id": "agence-immo-paris",
  "bot_id": "qualification-leads",
  "name": "Bot qualification — Agence Immo Paris",
  "transport": "meta-cloud",
  "whatsapp_numbers": ["+33XXXXXXXXX"],
  "system_prompt": "Tu es un assistant immobilier...",
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

1. **Session existante** — on continue avec son couple `(client_id, bot_id)`
2. **Numéro WhatsApp destinataire** — mappé vers un bot via le champ `whatsapp_numbers` de la config
3. **Aucun bot configuré pour ce numéro** — message ignoré, log d'avertissement

L'absence de routage par mot-clé ou tag est un choix : un numéro WhatsApp = un bot. Cohérence et prévisibilité maximales.

### Stockage credentials

Les credentials transport / LLM / CRM sont chiffrés (AES-256) et stockés par client en DB, avec une clé maître `MASTER_ENCRYPTION_KEY` côté env, pour permettre l'onboarding self-service multi-clients sans redéploiement.

---

## Sécurité

- Vérification HMAC SHA-256 des webhooks entrants Meta (`X-Hub-Signature-256`)
- Vérification du `verify_token` Meta sur la route GET de validation
- Mutex per-phone : pas de race condition cross-bot pour un même utilisateur
- Déduplication atomique des messages entrants (idempotent)
- Purge automatique des conversations > 90 jours (configurable)
- Graceful shutdown (SIGTERM/SIGINT, fermeture DB propre)
- Dashboard protégé par API key
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

- Templates de bots par secteur (e-commerce, immobilier, services, B2B)
- Marketplace pour les agences partenaires
- Programme partenaires (commission sur usage)
- Certifications conformité (RGPD, ISO 27001 si pertinent)
- Candidature Meta Solution Partner

---

## Documents associés

- `CRM_INTEGRATION.md` — Format normalisé de l'événement CRM, signature HMAC, retry, idempotency
- `GLOSSAIRE.md` — Terminologie projet

---

*Édité par Cyran Labs. Dernière mise à jour : avril 2026.*
