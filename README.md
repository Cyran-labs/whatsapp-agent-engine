# WhatsApp Agent Engine

> Conversational Agent Engine for WhatsApp. Portable. Pluggable. Production-ready.

A portable WhatsApp conversational agent engine, agnostic of transport, CRM and LLM provider.

---

## Status

**P0 — Scaffolding.** Repo en cours de découplage depuis une production existante.
Pas encore exécutable. Voir [docs/ROADMAP.md](docs/ROADMAP.md) pour le plan détaillé P0 → P5.

---

## Vision en une ligne

Un même moteur, plusieurs déploiements, zéro dépendance technique à un éditeur tiers.

---

## Architecture en 4 couches

```
┌──────────────────────────────────────────────────────────────┐
│  TRANSPORT                                                   │
│  Meta Cloud API · CM.com · Twilio · 360dialog                │
├──────────────────────────────────────────────────────────────┤
│  CONVERSATIONAL ENGINE                                       │
│  Claude Sonnet/Haiku (prod) · pluggable GPT, Gemini, Mistral │
│  Cache · multi-tenant · prompts par bot                      │
├──────────────────────────────────────────────────────────────┤
│  EVENT BUS                                                   │
│  lead.qualified · rdv.created · order.placed · message.received│
├──────────────────────────────────────────────────────────────┤
│  CRM CONNECTORS                                              │
│  Webhook generic (HMAC) · Attio · HubSpot · Salesforce · etc.│
└──────────────────────────────────────────────────────────────┘
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les interfaces détaillées.

---

## Repo structure

```
src/
  core/              -- Logique métier (router, handler, sessions)
  transport/         -- Abstraction WhatsApp (Meta Cloud, CM.com, ...)
  llm/               -- Abstraction LLM (Anthropic, OpenAI, Google, ...)
  connectors/        -- Connecteurs CRM
docs/
  ARCHITECTURE.md    -- Interfaces des 4 couches
  ROADMAP.md         -- Plan P0 → P5
  CRM_INTEGRATION.md -- Spec connecteur CRM (HMAC, retry, idempotency)
  GLOSSAIRE.md       -- Terminologie technique
marketing/
  roi-calculator.html -- Calculateur ROI commercial (HTML autonome)
```

---

## Phases

| Phase | Statut | Sujet |
|---|---|---|
| P0 | 🚧 En cours | Découplage du code de prod vers ce repo |
| P1 | ⏳ | Connecteurs CRM (webhook generic, HubSpot, Attio, partenaires) |
| P2 | ⏳ | Transport agnostique (Meta Cloud direct, externalisation credentials) |
| P3 | ⏳ | Onboarding self-service (UI Settings) |
| P4 | ⏳ | Éditeur drag & drop des parcours |
| P5 | ⏳ | Marketplace & Solution Partner Meta |

---

## Local setup

À documenter une fois P0 terminé.

---

## License

Proprietary. See [LICENSE](LICENSE).

---

## Contact

Cyran Labs · tech@snowleopardcrm.com
