# Cyran Labs Engine

## Contexte

Repo en cours de découplage depuis `whatsapp-cyran-bot`.

**Objectif** : moteur de bot WhatsApp e-commerce portable, agnostique du transport, du CRM et du modèle IA.

**Phase actuelle** : P0 — Décollage.

Voir `docs/ROADMAP.md` pour le plan complet.

## Repo de référence (production actuelle)

Toute la logique opérationnelle est dans `/Users/francoisgreze/www/whatsapp-cyran-bot/`.

Quand on développe ici, on doit :
1. **Reprendre** la logique éprouvée (sessions, dedup, mutex, prompt caching, lead extraction)
2. **Découpler** des spécificités Cyran demo (5 bots thématiques, routing par mot-clé)
3. **Multi-tenant-iser** dès le départ (`client_id` partout dans les schemas DB)
4. **Abstraire** le transport (CM.com → interface), le LLM (Anthropic → interface), le CRM (Attio hardcodé → connector)

## Conventions code

- Console.log : `[Service] message` sans emoji
- TypeScript strict, pas de `any`, `const` par défaut
- Pas de commit sans validation explicite
- Author git : Francois Greze <tech@snowleopardcrm.com>
- Pas de référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition)

## Architecture cible

Voir `docs/ARCHITECTURE.md` pour le détail des 4 couches :
1. Transport (Meta Cloud, CM.com, ...)
2. Core (logique métier, indépendante du reste)
3. LLM (Anthropic, OpenAI, Google, Mistral)
4. Connecteurs CRM (MAD CRM, HubSpot, Attio, webhook generic)

## Spécification connecteur CRM

Voir `docs/CRM_INTEGRATION.md`. Format normalisé des événements, signature HMAC, retry, idempotency.

C'est ce document qu'on partage avec MAD CRM et tout futur partenaire.
