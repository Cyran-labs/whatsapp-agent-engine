# Architecture Cyran Labs Engine

**Audience** : développeurs et partenaires techniques (MAD CRM, futurs CRM partenaires).

---

## Principe directeur

Le moteur ne connaît rien du transport WhatsApp, du CRM cible, ni du modèle IA. Il définit des **interfaces** que des **adaptateurs** implémentent. C'est le seul moyen d'être réellement portable.

```
┌──────────────────────────────────────────────────────────────────┐
│                         CYRAN LABS ENGINE                        │
│                                                                  │
│  ┌────────────┐      ┌──────────────┐      ┌───────────────┐    │
│  │ TRANSPORT  │ ───→ │ CORE         │ ───→ │ CONNECTORS    │    │
│  │ (interface)│      │ (logique     │      │ (interface)   │    │
│  │            │      │ métier pure) │      │               │    │
│  └────────────┘      └──────────────┘      └───────────────┘    │
│        │                    │                      │            │
│        │                    │                      │            │
│        ▼                    ▼                      ▼            │
│   meta-cloud           llm/anthropic         crm/mad-crm        │
│   cm-com               llm/openai            crm/hubspot        │
│   twilio               llm/google            crm/attio          │
│                                              crm/webhook-gen    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Couche 1 — Transport

Responsabilité : recevoir et envoyer des messages WhatsApp, sans qu'on sache via quel fournisseur.

### Interface

```typescript
interface Transport {
  // Envoi
  sendText(to: string, text: string): Promise<void>;
  sendButtons(to: string, text: string, buttons: Button[]): Promise<void>;
  sendList(to: string, header: string, body: string, sections: ListSection[]): Promise<void>;
  sendImage(to: string, url: string, caption?: string): Promise<void>;
  sendCta(to: string, text: string, ctaText: string, ctaUrl: string): Promise<void>;

  // Réception
  parseWebhook(payload: unknown): IncomingMessage | null;

  // Métadonnées
  readonly providerName: string;
}
```

### Implémentations prévues

- `meta-cloud.ts` — Meta Cloud API (officiel, accès direct, pas de BSP)
- `cm-com.ts` — CM.com BSP (legacy, déjà en prod sur whatsapp-cyran-bot)
- `twilio.ts` — Twilio Conversations API (à venir si besoin client)
- `360dialog.ts` — 360dialog BSP (à venir)

### Choix par tenant

Chaque tenant a un `transport_provider` dans sa config. Au boot, le moteur charge la bonne implémentation. Un même runtime peut servir simultanément plusieurs tenants avec des transports différents.

---

## Couche 2 — Core (logique métier)

Responsabilité : routing, sessions, dedup, mutex, dispatch vers le LLM, parsing de la réponse, dispatch vers le transport et les événements.

Cette couche **ne connaît rien** du transport ni du CRM. Elle reçoit un `IncomingMessage` du transport, appelle le LLM, retourne un `OutgoingMessage` au transport, et émet des événements métier consommés par les connecteurs.

### Modules

- `core/router.ts` — routage par `client_id` + `bot_id` (depuis config, pas de mot-clé)
- `core/handler.ts` — pipeline LLM (chargement prompt + catalogue + historique → appel → parsing → dispatch)
- `core/sessions.ts` — gestion sessions multi-tenant
- `core/events.ts` — bus d'événements (lead.qualified, rdv.created, ...)
- `core/dedup.ts` — déduplication des messages entrants (atomique)
- `core/mutex.ts` — mutex par numéro de téléphone

---

## Couche 3 — LLM (modèle IA)

Responsabilité : générer des réponses conversationnelles et extraire des leads structurés, sans qu'on sache quel modèle est utilisé.

### Interface

```typescript
interface LLMProvider {
  // Conversation
  chat(messages: Message[], systemPrompt: string, options?: ChatOptions): Promise<string>;

  // Extraction structurée (mode JSON)
  extractStructured<T>(prompt: string, schema: JSONSchema): Promise<T>;

  readonly providerName: string;
  readonly modelTier: 'conversation' | 'extraction';
}
```

### Implémentations prévues

- `llm/anthropic.ts` — Claude Sonnet 4 (conversation) + Claude Haiku 4.5 (extraction). En production.
- `llm/openai.ts` — GPT-5 (conversation) + GPT-4o-mini (extraction).
- `llm/google.ts` — Gemini 2.5 Pro (conversation) + Gemini 2.5 Flash (extraction).
- `llm/mistral.ts` — Mistral Large (conversation) + Mistral Small (extraction). Option européenne / souveraineté.

### Choix par tenant

Comme pour le transport : `llm_conversation_provider` et `llm_extraction_provider` dans la config tenant. Permet par exemple d'avoir un client qui veut Mistral pour des raisons de souveraineté EU.

---

## Couche 4 — Connecteurs CRM

Responsabilité : pousser les événements métier vers le CRM du client. Identique à un webhook signé, sauf qu'on encapsule la logique de transformation (champs CRM, format note, gestion erreurs).

### Interface

```typescript
interface CRMConnector {
  // Push d'un lead qualifié (création ou mise à jour)
  pushLead(lead: NormalizedLead): Promise<void>;

  // Update partiel d'un lead existant (champ par champ, événement lead.updated)
  updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void>;

  // Push d'une réservation (RDV via Calendly ou similaire)
  pushBooking(booking: NormalizedBooking): Promise<void>;

  readonly connectorName: string;
}
```

### Implémentations prévues

- `connectors/mad-crm.ts` — MAD CRM (V1 : webhook lead.qualified + lead.updated en temps réel). Priorité P1.
- `connectors/attio.ts` — Attio (déjà en prod sur whatsapp-cyran-bot, à migrer)
- `connectors/hubspot.ts` — HubSpot (squelette créé sur whatsapp-cyran-bot, à migrer)
- `connectors/webhook-generic.ts` — Webhook signé HMAC vers URL configurable (pour CRM custom ou n8n)
- `connectors/salesforce.ts` — À venir
- `connectors/klaviyo.ts` — À venir

### Standards respectés

- Webhooks POST signés HMAC SHA-256
- API key par client (rotation supportée)
- Retry avec backoff exponentiel (3 tentatives, 1s/4s/16s)
- Idempotency keys (un même événement ne peut pas être poussé deux fois)
- Dead letter queue (événements en échec persistent en DB pour replay manuel)
- Body JSON normalisé (voir CRM_INTEGRATION.md)

---

## Multi-tenant

### Schéma DB

Tables existantes (sessions, conversations, leads, processed_messages) reçoivent toutes une colonne `client_id` indexée.

```sql
ALTER TABLE sessions ADD COLUMN client_id UUID NOT NULL;
ALTER TABLE sessions ADD INDEX idx_sessions_client (client_id);
-- idem pour conversations, leads, processed_messages
```

Une nouvelle table `clients` :

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  transport_provider TEXT NOT NULL,
  transport_credentials_encrypted TEXT,
  llm_conversation_provider TEXT NOT NULL DEFAULT 'anthropic',
  llm_extraction_provider TEXT NOT NULL DEFAULT 'anthropic',
  crm_connector TEXT,
  crm_credentials_encrypted TEXT,
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Configuration bot

Chaque bot d'un client est défini par un fichier `bots/{client_id}/{bot_id}.json` :

```json
{
  "client_id": "uuid",
  "bot_id": "qualification-leads",
  "name": "Bot qualification leads ChariotDeGolf",
  "system_prompt_path": "prompts/qualification-leads.md",
  "catalogue_source": {
    "type": "json_file",
    "path": "catalogues/chariotdegolf.json"
  },
  "lead_fields": ["prenom", "nom", "email", "phone", "besoin", "budget"],
  "transport_overrides": null,
  "active": true
}
```

---

## Sécurité

- Toutes les credentials (Meta, LLM, CRM) chiffrées en DB (AES-256, clé maître dans variable d'env)
- Dashboard protégé par API key par tenant
- Toutes les API keys validées au boot
- Mutex par numéro de téléphone (pas de race conditions cross-bot pour un même user)
- Graceful shutdown (SIGTERM/SIGINT → fermeture propre DB + flush queues)
- Dedup atomique sur les messages entrants
- Purge RGPD : conversations > 90 jours supprimées (configurable par client)

---

## Performance — capacité actuelle estimée

Limites connues (à challenger en charge) :

- 1 instance VPS OVH médium : ~50-100 conversations simultanées
- Au-delà : scale horizontal (Postgres partagé déjà OK, juste multiplier les Express workers)
- Rate limits Anthropic : ~100 RPM en tier 1, ~1000 RPM en tier 2
- Rate limits Meta Cloud API : 80 messages/seconde en V1, scalable selon vérification entreprise

À documenter en P3 avec un benchmark réel.
