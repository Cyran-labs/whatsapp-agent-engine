# Architecture WABAGENT Engine

**Audience** : développeurs, architectes et partenaires techniques (intégrateurs CRM, agences, éditeurs WhatsApp).

**Statut** : document vivant. Chaque élément porte un statut explicite : `Livré`, `En cours`, `Planifié`.

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

## Promesses techniques

| Promesse | Statut |
|---|---|
| **Multi-tenant** : isolation `client_id × bot_id` au niveau données | Livré |
| **Configurable par fichier JSON** : un nouveau bot = 1 fichier de config, aucune modification de code | Livré |
| **Transport WhatsApp pluggable** : Meta Cloud API officielle ou BSP intermédiaire, choisi par le compte WhatsApp du numéro | Livré (Meta Cloud + CM.com) ; comptes WhatsApp d'organisation : Livré (lot 2b-2) |
| **LLM pluggable** : interface `chat()` agnostique du fournisseur | Livré (Anthropic) |
| **Connecteurs CRM pluggables** : interface stable, format d'événement normalisé signé HMAC | En cours (interface posée) |
| **Webhooks authentifiés** : une URL par compte WhatsApp ; signature HMAC Meta vérifiée avec le secret d'application du compte, clé d'URL secrète pour CM.com, avant tout routage | Livré (lot 2b-2) |
| **Lead extraction automatique** : extraction structurée des informations du prospect, attendue sous le verrou de la conversation | Livré |
| **Prompt caching** : optimisation des coûts LLM via cache TTL des system prompts | Livré |
| **Idempotency / déduplication** : un même message entrant n'est traité qu'une fois | Livré |
| **Verrou par conversation** : sérialisation stricte des messages d'un même contact pour un même numéro destinataire | Livré |
| **LLM agnostique runtime** : choix du modèle par bot (par client à terme) | Planifié |
| **Multi-transport simultané** : plusieurs comptes WhatsApp de transports différents en parallèle dans un même runtime | Livré (architecture) |
| **Credentials chiffrés** : identifiants des comptes WhatsApp chiffrés en base par compte d'organisation | Livré (lot 2b-2) |
| **Credentials chiffrés** : clés LLM et CRM stockées chiffrées en DB par client | Planifié (P3) |
| **Dashboard self-service** : UI d'administration par client pour onboarding 30 min | Planifié (P3) |
| **Éditeur de parcours drag & drop** : composition visuelle des conversations | Planifié (P4) |

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
  // La signature Meta (HMAC sur les octets reçus, jamais sur un corps réanalysé) est vérifiée par la
  // fonction pure verifyMetaSignature(rawBody, header, appSecret), pas par le transport.
}
```

### Implémentations

| Transport | Statut | Description |
|---|---|---|
| **Meta Cloud API** | Livré | API officielle Meta, accès direct sans intermédiaire (compte `meta_manual`). Vérification HMAC avec le secret d'application du compte WhatsApp. |
| **CM.com BSP** | Livré | Business Solution Provider intermédiaire (compte `cm_com`). Format propriétaire, pas de signature HMAC standard : l'authentification repose sur la clé secrète de l'URL du compte. |
| **Twilio Conversations** | Planifié | Si demande client. |
| **360dialog** | Planifié | BSP européen. |

### Choix par compte WhatsApp

Le transport n'est plus déclaré par l'agent IA : il découle du compte WhatsApp auquel appartient le numéro branché (`meta_manual` ou `cm_com`). Les anciens champs `transport` et `whatsapp_numbers` n'existent plus. Un même runtime sert simultanément plusieurs comptes de transports différents.

Chaque compte WhatsApp d'organisation a ses propres URL de webhook, portant une clé secrète (voir « Comptes WhatsApp d'organisation ») : `GET` et `POST /webhook/meta/<clé>` pour Meta, `POST /webhook/cm-com/<clé>` pour CM.com. Le transport d'un numéro est construit à partir du compte et du numéro relus en base ; il n'existe aucun repli sur des identifiants de la plateforme.

---

## Couche 2 : Core (logique métier)

**Responsabilité** : routing, sessions, déduplication, sérialisation per-phone, dispatch LLM, parsing réponse, dispatch sortant, événements métier.

Cette couche **ne connaît rien** du transport ni du CRM. Elle reçoit un `IncomingMessage` normalisé du transport, appelle le LLM, dispatche la réponse au transport, et émet des événements consommés par les connecteurs CRM.

### Composants

| Composant | Rôle | Statut |
|---|---|---|
| **Router** | Résolution de l'agent IA par le seul numéro destinataire, cherché dans l'inventaire du compte identifié par l'URL ; relecture en base de tout ce qui décide de servir (numéro, compte, organisation, statut, liste d'accès limité) | Livré (lot 2b-2) |
| **Session manager** | Gestion des sessions multi-tenant en DB | Livré |
| **Handler** | Pipeline LLM (prompt système + historique + profil → appel → parsing → dispatch sortant) | Livré |
| **Dedup** | Déduplication atomique des messages entrants (table `processed_messages`) | Livré |
| **Verrou par conversation** | Sérialisation stricte des messages d'un même contact pour un même numéro destinataire, clé (numéro destinataire, contact) (pas de race condition) | Livré |
| **Lead extractor** | Extraction structurée (modèle léger), attendue sous le verrou de la conversation après la réponse ; un échec d'extraction n'empêche pas le traitement du message | Livré |
| **Event bus** | Bus d'événements `BotEvent` (user/assistant messages, lead.qualified à venir) | Livré |
| **Bot config loader** | Chargement et indexation des fichiers `bots/{client_id}/{bot_id}.json` | Livré |

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

| LLM | Statut | Modèles utilisés |
|---|---|---|
| **Anthropic** | Livré | Claude Sonnet 5.5, puis Sonnet 5 et Haiku 5.5 en cascade (conversation, effort bas) ; Claude Haiku 5.5 (extraction) |
| **OpenAI** | Planifié | GPT-5 / GPT-4o-mini |
| **Google** | Planifié | Gemini 2.5 Pro / Flash |
| **Mistral** | Planifié | Mistral Large / Small (option européenne / souveraineté) |

### Optimisations livrées

- **Prompt caching** : le system prompt + les blocs catalogue/contexte semi-statiques sont marqués `cache: true` côté Anthropic, réduisant le coût des conversations multi-tours.
- **Cascade de modèles** : un modèle en surcharge (429/529), en erreur (modèle retiré compris), qui refuse pour raison de sécurité ou ne rend aucun texte laisse la place au suivant ; la cause est journalisée. Seuls les blocs de texte forment la réponse (les modèles 5.5 peuvent réfléchir avant de répondre). Tout modèle appelable a un tarif, contrôlé par un test.
- **Concurrency limit** : `p-limit` global (max 10 appels LLM parallèles) pour éviter de saturer les rate limits.

### Choix par bot

À terme (P3), chaque agent IA pourra spécifier son modèle de conversation et d'extraction dans la config. Aujourd'hui, un modèle de conversation peut être imposé à un agent IA, choisi parmi les modèles courants (`CLAUDE_CHAT_MODELS` des contrats partagés) ; le modèle d'extraction est fixé en code (Haiku 5.5). Le test d'un agent IA depuis le back-office utilise les mêmes modèles qu'un vrai contact.

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

| Connecteur | Statut | Description |
|---|---|---|
| **MAD CRM** | En cours (P1) | Webhook `lead.qualified` et `lead.updated` en temps réel |
| **Attio** | Planifié | Migration depuis prod existante |
| **HubSpot** | Planifié | OAuth + API CRM standard |
| **Webhook générique** | Planifié | POST signé HMAC vers URL configurable (n8n, Zapier, custom) |
| **Salesforce** | Planifié | Si demande client |
| **Klaviyo** | Planifié | E-commerce |

### Garanties (cible P1)

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

À l'arrivée d'un message sur l'URL d'un compte, le moteur procède dans cet ordre :

1. **Identifier le compte** par la clé de l'URL (empreinte SHA-256 en base) : clé inconnue ou compte déconnecté, refus
2. **Authentifier** : signature Meta avec le secret du compte, ou clé d'URL CM.com ; aucun effet de bord avant ce point
3. **Numéro WhatsApp destinataire** : cherché dans l'inventaire de ce seul compte ; le numéro porte l'agent IA branché
4. **Aucun numéro ou aucun agent IA branché** : message ignoré, journal sans contenu

Il n'existe qu'une façon de router : un numéro WhatsApp = un agent IA, jamais de routage par mot-clé ou tag. Cohérence et prévisibilité maximales.

### Stockage credentials (P3)

Les identifiants des comptes WhatsApp sont déjà chiffrés par compte d'organisation (voir « Comptes WhatsApp d'organisation »). Les credentials LLM et CRM restent à traiter : en P3, ils seront chiffrés (AES-256) et stockés par client en DB, avec la clé maître `CREDENTIALS_ENCRYPTION_KEY` côté env, pour permettre l'onboarding self-service multi-clients sans redéploiement.

---

## Comptes et équipes

Une organisation (`clients`, `client_id`) regroupe des entités (boutique, équipe, service client) et des utilisateurs. Les identifiants de code restent ceux du modèle multi-tenant ci-dessus.

| Élément | Statut |
|---|---|
| Entités par organisation (`entities`), agent IA rattaché à une entité (`bots.entity_id`) | Livré |
| Appartenances par organisation et par entité (`memberships`) avec quatre rôles | Livré |
| Réglages d'organisation (`clients.settings`), visibilité « tout le monde voit tout » | Livré |
| Invitation par lien à usage unique, acceptation obligatoire | Livré |
| Migration idempotente au démarrage (entité par défaut, `client_admin` vers appartenance `admin`) | Livré |
| Script d'exploitation `scripts/create-organization.ts` | Livré |
| Sélecteur d'organisation, gestion des utilisateurs et des entités dans l'app web | Planifié (plan 2) |
| Envoi réel des invitations par SMTP (aujourd'hui, le lien est écrit dans les journaux du serveur) | Planifié (chantier Infra) |
| Visibilités restreintes (`entities`, `own_and_pool`), actions sur les contacts, reprise humaine | Planifié |

### Rôles

Un rôle s'applique à un périmètre. Par organisation, un utilisateur a soit une appartenance de niveau organisation, soit une ou plusieurs appartenances d'entité.

| Rôle | Périmètre | Droits dans cette version |
|---|---|---|
| Admin (`admin`) | organisation | Tout : agents IA, connexions, entités, utilisateurs, invitations, réglages, journal d'audit |
| Super manager (`super_manager`) | organisation (toutes les entités, futures comprises) | Consultation complète et simulateur ; option lecture seule |
| Manager (`manager`) | une ou plusieurs entités | Consultation et simulateur |
| Conseiller (`advisor`) | une ou plusieurs entités | Consultation et simulateur |

Le rôle plateforme `users.role` vaut `super_admin` (opérateur WABAGENT, droits d'admin dans toute organisation) ou `member`. La politique d'accès est centralisée dans `src/core/auth/permissions.ts` (`can(access, action)`) : aucune route ne teste un rôle en dur. Retirer ou suspendre le dernier admin actif d'une organisation est refusé.

### Organisation active

Le jeton d'accès ne porte que l'identifiant de l'utilisateur et son rôle plateforme. Chaque appel à l'API admin (`/api/admin/v1`) désigne l'organisation par l'en-tête `X-Organization-Id`. Si l'en-tête manque et que l'utilisateur n'appartient qu'à une organisation, celle-ci est prise ; sinon la réponse est 400. Un utilisateur sans appartenance active dans l'organisation demandée reçoit 403. Le statut de l'utilisateur et ses appartenances sont relus en base à chaque requête : une suspension ou une désactivation prend effet immédiatement, et le moteur ne garde aucun état d'appartenance en mémoire (compatible multi-instance sur un même Postgres). `GET /auth/me` renvoie l'utilisateur et la liste de ses organisations avec un rôle résumé.

### Invitations

- Seul un admin invite (`POST /invitations`, avec les appartenances à créer à l'acceptation) ; le super admin invite le premier admin d'une organisation.
- Toute invitation doit être acceptée, que la personne ait déjà un compte ou non. La réponse est identique dans tous les cas : l'admin n'apprend rien sur l'existence d'un compte.
- Le lien est à usage unique, valable `ADMIN_INVITE_TTL_DAYS` jours (7 par défaut), stocké haché, et n'apparaît jamais dans une réponse d'API. Aucun identifiant n'est envoyé : l'invité choisit son mot de passe (`POST /auth/accept-invite`), ou se connecte avec son compte existant pour accepter.
- Un lien perdu ou expiré se remplace par « renvoyer l'invitation » (nouveau jeton, ancien invalidé).

### Réglages d'organisation

Stockés dans `clients.settings` et validés par un schéma partagé avec valeurs par défaut : `visibility: 'all'`, `pool_self_claim: true`, `reassign: 'managers'`, `transfer: 'managers'`, `takeover: 'owner'`. Seule la visibilité `all` est sélectionnable dans cette version. Lecture pour tous les membres, écriture réservée à l'admin.

### Exploitation

Création d'une organisation avec son entité par défaut et invitation de son premier admin :

```bash
npx tsx scripts/create-organization.ts <client_id> "<Nom de l'organisation>" <email_admin>
```

Le lien d'invitation est écrit dans les journaux du serveur (`ConsoleMailer`) et nulle part ailleurs. La création du super admin passe par `scripts/seed-admin.ts`. Au démarrage, la migration crée l'entité par défaut des organisations qui n'en ont pas, y rattache les agents IA, et remplace les appartenances des anciens `client_admin` par une seule appartenance `admin` (un compte encore `invited` n'en reçoit aucune : son invitation en attente porte la grant `admin`) ; elle est idempotente (compteurs à zéro au démarrage suivant).

---

## Comptes WhatsApp d'organisation

**Statut** : Livré (lot 2b-2, moteur et API d'administration ; écrans au lot 2b-3). Spec : `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` (§6 à §8).

Un compte WhatsApp appartient à une seule organisation. Il porte un nom, un mode (`meta_manual` ou `cm_com`), des identifiants chiffrés selon le mode, l'identifiant de la WABA (Meta) ou le `accountId` (CM.com), une clé publique de webhook, un état, la date de dernière vérification réussie et des alertes. Toute lecture d'un compte, d'un numéro ou d'une liste par l'API d'administration est filtrée par l'organisation active ; un objet d'une autre organisation répond comme un objet inconnu (404).

### Route de webhook lue en base

| Mode | Routes | Authentification |
|---|---|---|
| `meta_manual` | `GET` et `POST /webhook/meta/<clé>` | `GET` : jeton de vérification propre au compte. `POST` : signature `X-Hub-Signature-256` avec le secret d'application du compte |
| `cm_com` | `POST /webhook/cm-com/<clé>` | Clé secrète de l'URL |

La clé est aléatoire (32 octets, base64url) ; seule son empreinte SHA-256 sert à retrouver le compte. Il n'existe plus de jeton de vérification global ni de route sans clé. L'adresse publique affichée aux administrateurs vient de `PUBLIC_BASE_URL` (optionnelle ; sans elle, seul le chemin est donné).

À chaque message, la route est relue en base (jamais depuis un cache de configuration) : le numéro doit appartenir au compte de l'URL et être branché sur l'agent IA, le compte doit être `connected`, l'organisation `active`, et le statut de l'agent IA permettre de servir.

### Transports par compte

Le transport d'un numéro est construit à partir du compte et du numéro relus en base (`getTransportForNumber`), avec les identifiants déchiffrés du compte. L'agent IA ne porte ni identifiant de transport, ni transport choisi, ni numéro en texte libre. Un agent IA a au plus un numéro, un numéro au plus un agent IA, et un numéro n'appartient qu'à un seul compte `connected` sur la plateforme.

### États d'un compte

| État | Messages entrants | Remarque |
|---|---|---|
| `connected` | Traités selon le statut de l'agent IA | Entré par une vérification réussie |
| `error` (jeton invalide, signatures rejetées, autre) | Non servis, comptés par agent IA | Les agents IA gardent leur statut et reprennent seuls au retour en `connected` |
| `disconnected` | Refusés à l'authentification | Action de l'administrateur ; libère les numéros du compte |

### Statuts de l'agent IA et accès limité

Statuts : `draft` (brouillon), `limited` (accès limité), `active`, `paused`. Un agent IA ne répond qu'en `limited` (contacts de sa liste seulement) et `active`. Passer en `limited` ou `active` exige un numéro branché sur un compte `connected` ; `limited` exige aussi une liste d'accès non vide (20 entrées au plus, numéros E.164 ou identifiants opaques). Depuis `draft`, `active` n'est permis que sur un numéro de test. Pause automatique avec motif dans un seul cas : le numéro est retiré chez le fournisseur.

Un message qui n'est pas servi (brouillon, pause, contact hors liste, compte en erreur, organisation suspendue) ne déclenche ni réponse, ni appel LLM, ni session : seul un compteur par agent IA avec la date du dernier est incrémenté, sans contenu.

---

## Sécurité

| Mesure | Statut |
|---|---|
| Vérification HMAC SHA-256 des webhooks entrants Meta (`X-Hub-Signature-256`), avec le secret d'application du compte WhatsApp identifié par la clé de l'URL, avant tout effet de bord | Livré (lot 2b-2) |
| Vérification du jeton de vérification Meta propre au compte sur la route GET de validation (plus de jeton global) | Livré (lot 2b-2) |
| Clé d'URL de webhook aléatoire par compte, retrouvée par empreinte SHA-256, comparaisons à temps constant | Livré (lot 2b-2) |
| Verrou par (numéro destinataire, contact) : pas de race condition entre messages d'une même conversation | Livré |
| Déduplication atomique des messages entrants (idempotent) | Livré |
| Purge automatique des conversations anciennes (90 jours par défaut, réglable par `CONVERSATION_RETENTION_DAYS`), des messages traités (7 jours) et des sessions inactives (30 jours), au démarrage puis toutes les 6 h | Livré |
| Graceful shutdown (SIGTERM/SIGINT, fermeture DB propre) | Livré |
| Leads, santé, métriques et usage de chaque agent IA lus par l'API d'administration, cloisonnée par organisation | Livré |
| Credentials chiffrés en DB (AES-256) par client | Planifié (P3) |
| Audit log des accès admin | Planifié (P3) |
| Rotation programmée des API keys | Planifié (P3) |

---

## Performance

### Capacité actuelle

Estimations à confirmer en charge réelle :

- **1 instance moyenne (4 vCPU / 8 GB RAM)** : ~50-100 conversations simultanées
- **Au-delà** : scale horizontal, Postgres partagé, multiplier les workers Express derrière un load balancer
- **Rate limits Anthropic** : ~100 RPM tier 1, ~1000 RPM tier 2
- **Rate limits Meta Cloud API** : 80 messages/seconde V1, scalable selon vérification entreprise

Un benchmark formel sera produit en P3.

### Stockage

- **PostgreSQL** : recommandé en production (concurrence, durabilité, JSONB pour les leads)
- **SQLite** : supporté en développement local et tests (driver auto-sélectionné selon `DATABASE_URL`)

---

## Roadmap

| Phase | Objectif | Statut |
|---|---|---|
| **P0 : Décollage** | Moteur agnostique, multi-tenant, configurable par fichier JSON | Livré |
| **P1 : Connecteurs CRM** | Couche connectors complète (MAD CRM, HubSpot, webhook générique) avec retry, HMAC, idempotency | En cours |
| **P2 : Transport agnostique** | Multi-transport simultané, credentials par client chiffrés | Architecture livrée, credentials P3 |
| **P3 : Onboarding self-service** | UI dashboard par client, guided setup Meta Business, configuration bot via UI, API REST d'administration | Planifié |
| **P4 : Éditeur drag & drop** | Composeur visuel de parcours conversationnels (React Flow), génération automatique des prompts depuis le graphe | Planifié |
| **P5 : Marketplace & Solution Partner** | Templates sectoriels, marketplace agences, candidature Meta Solution Partner | Planifié |

---

## Documents associés

- `docs/CRM_INTEGRATION.md` : Format normalisé de l'événement CRM, signature HMAC, retry, idempotency
- `docs/GLOSSAIRE.md` : Terminologie projet
- `docs/ROADMAP.md` : Roadmap détaillée

---

*Édité par WABAGENT. Dernière mise à jour : novembre 2026.*
