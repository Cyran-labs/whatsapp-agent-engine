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
| **Router** | Résolution de l'agent IA par le seul numéro destinataire, cherché dans l'inventaire du compte identifié par l'URL ; relecture en base de tout ce qui décide de servir (numéro, compte, organisation, statut, Whitelist) | Livré (lot 2b-2) |
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
| Sélecteur d'organisation, gestion des utilisateurs et des entités dans l'app web | Livré (plan 2a ; sélecteur dans le bloc Organisation depuis la refonte de la navigation) |
| Envoi réel des invitations par SMTP (aujourd'hui, le lien n'est écrit dans les journaux du serveur que si `MAILER_LOG_LINKS=true`) | Planifié (chantier Infra) |
| Visibilités restreintes (`entities`, `own_and_pool`), actions sur les contacts, reprise humaine | Planifié |

### Rôles

Un rôle s'applique à un périmètre. Par organisation, un utilisateur a soit une appartenance de niveau organisation, soit une ou plusieurs appartenances d'entité.

| Rôle | Périmètre | Droits dans cette version |
|---|---|---|
| Admin (`admin`) | organisation | Tout : agents IA, connexions, entités, utilisateurs, invitations, réglages, journal d'audit, usage et coûts |
| Super manager (`super_manager`) | organisation (toutes les entités, futures comprises) | Consultation complète et simulateur ; option lecture seule |
| Manager (`manager`) | une ou plusieurs entités | Consultation et simulateur |
| Conseiller (`advisor`) | une ou plusieurs entités | Consultation et simulateur |

Le rôle plateforme `users.role` vaut `super_admin` (opérateur WABAGENT, droits d'admin dans toute organisation) ou `member`. La politique d'accès est centralisée dans `src/core/auth/permissions.ts` (`can(access, action)`) : aucune route ne teste un rôle en dur. L'action `usage.read` (usage et coûts LLM, `GET /bots/:botId/usage`, seule route du moteur qui renvoie des coûts) est réservée à l'admin et à l'opérateur : le super manager, en lecture seule ou non, le manager et le conseiller reçoivent le 403 générique, contrôlé avant toute lecture de l'agent IA (même réponse pour un agent IA de l'organisation, inconnu ou d'une autre organisation). Le BFF de l'usage de l'organisation (`/api/usage/summary`) répond lui-même le 403 en entier, sans appeler `/bots` ni `/usage`, quand le rôle du membre dans l'organisation active (lu par `/auth/me`) n'est pas `admin` ; si l'organisation active ne se déduit pas (plusieurs organisations sans cookie), le moteur décide, et le BFF relaie en entier le 403 de chaque `/usage`, jamais comme une ligne indisponible. `src/__tests__/cost-readers.test.ts` garde les seuls lecteurs des coûts : tout appel `listLlmUsage*` est dans `DashboardService.usage`, appelé par la seule route `GET /usage` sous `requireAction('usage.read')`. Retirer ou suspendre le dernier admin actif d'une organisation est refusé.

Numéros des contacts (spec de la refonte de la navigation, 8 et 9.2). Le numéro d'un agent IA (`whatsapp_number`) est en entier pour tous les membres. Les numéros des contacts (entrées de la Whitelist, E.164 ou BSUID, et `phone` des leads) sont en entier pour l'opérateur, l'admin, le super manager (lecture seule comprise) et le membre qui a une appartenance (manager ou conseiller) sur l'entité de l'agent IA (`bots.entity_id`) ; un agent IA sans entité n'a de numéros en entier que pour les trois premiers. Tout autre membre les reçoit masqués par le moteur, jamais seulement à l'écran : la règle est `canSeeContactNumbers(access, botEntityId)` (`permissions.ts`), le masque `maskContactNumber` (`packages/contracts/src/contact-mask.ts` : au moins 6 chiffres toujours cachés : `+336 •• •• •• 78`, `••••` sous 8 chiffres, `US••••` pour un BSUID), tous deux repris tels quels par le faux moteur du web. Routes concernées :

- `GET /bots` et `GET /bots/:botId` : `allowlist` masquée (`presentBotForViewer`, `src/core/auth/contact-visibility.ts`), droit calculé agent IA par agent IA. Les réponses des écritures (PATCH, Whitelist, statut, activation, branchement) vont à l'admin et à l'opérateur (`bots.configure`) et restent entières. `src/__tests__/allowlist-readers.test.ts` casse si une route de lecture renvoie un agent IA sans `presentBotForViewer`, ou si `bots.configure` est accordée à un autre rôle.
- `GET /bots/:botId/leads` : `phone` et sa copie `qualified_data.phone` (écrite par le moteur à chaque message) masqués ; le paramètre `search` ne cherche alors que dans le nom, jamais dans le numéro (`listLeadsByBot`, `search.includePhone`), pour qu'une recherche ne dise pas si un numéro est un contact.
- `GET /bots/:botId/leads/:phone` : 403 générique pour un membre masqué, après le 404 d'un agent IA hors de l'organisation et avant toute lecture du lead (même refus que le numéro soit un contact ou non).

Limite : les autres champs de `qualified_data` et le texte des messages (`transcript`) sont du texte libre (un champ « Téléphone » collecté, un numéro tapé dans un message) ; ils ne sont pas masqués par ce lot et relèvent du chantier Conversations et leads.

### Organisation active

Le jeton d'accès ne porte que l'identifiant de l'utilisateur et son rôle plateforme. Chaque appel à l'API admin (`/api/admin/v1`) désigne l'organisation par l'en-tête `X-Organization-Id`. Si l'en-tête manque et que l'utilisateur n'appartient qu'à une organisation, celle-ci est prise ; sinon la réponse est 400. Un utilisateur sans appartenance active dans l'organisation demandée reçoit 403. Le statut de l'utilisateur et ses appartenances sont relus en base à chaque requête : une suspension ou une désactivation prend effet immédiatement, et le moteur ne garde aucun état d'appartenance en mémoire (compatible multi-instance sur un même Postgres). `GET /auth/me` renvoie l'utilisateur et la liste de ses organisations avec un rôle résumé, suspendues comprises (`status: 'suspended'`) ; l'opérateur y reçoit chaque organisation avec `role: 'admin'` et `read_only: false`, ce que le web lit comme « admin » (rail, coûts, actions). Le BFF du web (`GET /api/auth/me`) ajoute `active_client_id` et `refused_client_id` (organisation du cookie refusée parce que suspendue ; voir « Bandeau d'organisation suspendue »).

### Invitations

- Seul un admin invite (`POST /invitations`, avec les appartenances à créer à l'acceptation) ; le super admin invite le premier admin d'une organisation.
- Toute invitation doit être acceptée, que la personne ait déjà un compte ou non. La réponse est identique dans tous les cas : l'admin n'apprend rien sur l'existence d'un compte.
- Le lien est à usage unique, valable `ADMIN_INVITE_TTL_DAYS` jours (7 par défaut), stocké haché, et n'apparaît jamais dans une réponse d'API. Aucun identifiant n'est envoyé : l'invité choisit son mot de passe (`POST /auth/accept-invite`), ou se connecte avec son compte existant pour accepter.
- Un lien perdu ou expiré se remplace par « renvoyer l'invitation » (nouveau jeton, ancien invalidé).

### Réglages d'organisation

Stockés dans `clients.settings` et validés par un schéma partagé avec valeurs par défaut : `visibility: 'all'`, `pool_self_claim: true`, `reassign: 'managers'`, `transfer: 'managers'`, `takeover: 'owner'`. Seule la visibilité `all` est sélectionnable dans cette version. Lecture pour tous les membres, écriture réservée à l'admin.

### Exploitation

Création d'une organisation avec sa première entité et invitation de son premier admin :

```bash
npx tsx scripts/create-organization.ts <client_id> "<Nom de l'organisation>" <email_admin> "<Nom de la première entité>"
```

Le nom de la première entité est obligatoire (mêmes règles qu'un nom d'entité, `EntityName` des contrats, 80 caractères au plus) : l'opérateur le demande à l'admin avant de créer l'organisation. `POST /clients` (opérateur) exige de même `first_entity_name` (`CreateClientInput`). L'organisation et sa première entité sont écrites dans une seule transaction (`Database.createClientWithEntity`, deux INSERT stricts) : un échec de l'une n'en laisse aucune, et un `client_id` déjà pris répond CONFLICT sans écraser l'organisation existante ni lui ajouter d'entité. En reprise (organisation déjà créée, sans admin), le script exige encore le quatrième argument mais l'ignore : l'entité existante n'est jamais renommée, et le script l'écrit dans son journal. L'admin peut ensuite renommer l'entité depuis Organisation, Entités.

Aucun e-mail n'est envoyé : le lien d'invitation n'est écrit dans les journaux du serveur (`ConsoleMailer`), et nulle part ailleurs, que si `MAILER_LOG_LINKS=true` est posé explicitement (développement et recette), quel que soit `NODE_ENV` ; sinon seule l'adresse masquée est journalisée. La création du super admin passe par `scripts/seed-admin.ts`. Au démarrage, la migration crée l'entité par défaut des organisations qui n'en ont pas, y rattache les agents IA, et remplace les appartenances des anciens `client_admin` par une seule appartenance `admin` (un compte encore `invited` n'en reçoit aucune : son invitation en attente porte la grant `admin`) ; elle est idempotente (compteurs à zéro au démarrage suivant).

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

Vérification d'un compte Meta (`src/whatsapp/meta-graph.ts`) : quand Meta répond code 100 avec un message qui contient « nonexisting field » et « subscribed_apps » (identifiant saisi qui n'est pas celui d'une WABA, par exemple celui d'un numéro), le contrôle `waba_access` échoue avec un texte clair (« Cet identifiant n'est pas celui d'un compte WhatsApp Business (WABA). … »), non transitoire. C'est un texte seulement : la raison reste `other`. Le texte de Meta (`provider_text`, masqué des secrets du compte) reste dans l'erreur enregistrée du compte, pas sur le contrôle, pour que le texte clair s'affiche à sa place.

### Statuts de l'agent IA et Whitelist

Codes des statuts : `draft`, `limited`, `active`, `paused`, affichés Draft, Preview, Online et Offline (spec de la refonte de la navigation, 6.1 ; les codes ne changent pas). Un agent IA ne répond qu'en `limited` (Preview : contacts de sa Whitelist seulement) et `active` (Online). Passer en `limited` ou `active` exige un numéro branché sur un compte `connected` ; entrer en `limited` exige aussi une Whitelist (`allowlist`) non vide (20 entrées au plus, numéros E.164 ou identifiants opaques) ; un agent IA déjà en `limited` peut la vider, il ne répond alors à personne. Depuis `draft`, `active` n'est permis que sur un numéro de test. Pause automatique avec motif (`BOT_PAUSE_REASONS` des contrats) d'un agent IA en `limited` ou `active`, dans deux cas : son numéro est retiré chez le fournisseur (`number_removed`), ou il perd son numéro par débranchement ou par branchement sur un autre agent IA (`number_unassigned`, décision de François du 10 nov. 2026) ; un agent IA en `draft` ou `paused` (Draft ou Offline) garde son statut. La machine d'états, la décision d'activation avec numéro (`decideActivation` : entrer en `limited` par l'activation exige une entrée, même depuis `limited`) et les décisions de branchement (`decideTransition`, `decideAssign`) vivent dans `packages/contracts/src/bot-status.ts`, appelées par le moteur et par le web.

Un message qui n'est pas servi (agent IA en `draft` ou `paused`, contact hors de la Whitelist, compte en erreur, organisation suspendue) ne déclenche ni réponse, ni appel LLM, ni session : seul un compteur par agent IA avec la date du dernier est incrémenté, sans contenu.

**Mention « Ne répond pas »** (spec de la refonte de la navigation, §7). La pastille dit le statut choisi, la mention dit ce qui se passe : un agent IA `limited` ou `active` « ne répond pas » quand le moteur refuserait tout message entrant, quel que soit le contact. La règle est `decideResponding` (`packages/contracts/src/bot-status.ts`) : elle renvoie `null` pour un agent IA `draft`, `paused` ou de statut inconnu (lu comme `draft`), sinon le premier motif vrai de `NOT_RESPONDING_REASONS`, dans l'ordre de `checkRoute` (`src/core/router.ts`) : `no_number`, `number_removed`, `account_not_connected`, `organization_suspended`, `empty_allowlist` (en `limited` seulement). Le moteur lit les faits avec le `client_id` de l'agent IA (`src/core/services/bot-responding.ts` : `respondingFacts`, `loadNotResponding`) et expose le résultat dans `not_responding`, sur le détail de l'agent IA (`GET /bots`, `GET /bots/:botId`, calculé avec le numéro et la liste déjà lus) et sur `WhatsAppNumberView.bot` (Connexions, avec `status_reason`) ; le BFF le relaie dans `AgentSummaryRow` (`GET /api/bots/summary`, avec `status_reason` et `account_state`) ; le web ne le recalcule jamais. L'état du compte retenu est l'état affiché (`BotNumberSummary.account.state`) : un compte aux signatures rejetées en série compte comme en erreur. Trois écarts voulus avec le routeur, figés par `src/core/__tests__/not-responding-equivalence.test.ts` (qui vérifie pour le reste que la mention est vraie si et seulement si `checkRoute` refuse un contact listé et un contact hors liste) :
- `draft` et `paused` : le routeur refuse tout (`bot_inactive`), la mention est nulle car la pastille le dit déjà ;
- signatures rejetées en série sur un compte stocké `connected` : la mention dit `account_not_connected` alors que le routeur, qui ne lit que l'état stocké, servirait ; ces messages sont refusés avant lui, par l'authentification du webhook ;
- aucun numéro : la mention dit `no_number`, le routeur n'a aucune route à éprouver (routage par le numéro destinataire).

Présentation de la mention (spec en-tête, 3.4, 3.5 et 7.1) : le web ne change aucune règle. Les motifs `no_number`, `number_removed`, `account_not_connected` et `organization_suspended` s'affichent en point rouge sur la pastille de statut (bulle au survol qui dit le motif), en étiquette rouge dans Santé et en encadré rouge dans l'encart Statut. `empty_allowlist` est présenté comme un état, jamais comme une alerte : étiquette neutre « Whitelist vide » (bulle d'invitation), encadré neutre avec l'invitation à ajouter un numéro à la Whitelist. Le motif reste dans `decideResponding`, le test d'équivalence avec `checkRoute` ne change pas, et un agent IA concerné reste compté dans le filtre « Ne répond pas » de la liste.

---

## Restitution des erreurs

**Statut** : Livré (lot « Restitution des erreurs et vocabulaire », mergé sur `main` le 10 nov. 2026). Audit : `docs/superpowers/research/2026-11-09-audit-restitution-erreurs.md` (la règle de placement est au §5). Plan : `docs/superpowers/plans/2026-11-09-restitution-erreurs-vocabulaire.md`.

Principe : toute règle ou erreur du moteur est visible, compréhensible et actionnable dans l'interface, avec un retour de réussite. Un écran n'invente pas son texte d'erreur et n'affiche jamais le texte français du moteur dans l'interface anglaise.

### Moteur

Un refus de l'API d'administration est `{ error: { code, message, details?, reason?, request_id } }` (`ApiErrorBody`, `packages/contracts/src/errors.ts`) :
- `code` et `message` : le code d'erreur et le texte français du moteur ;
- `reason` : clé stable d'un refus métier, de la forme `<domaine>.<cas>` (`ERROR_REASONS`), absente des erreurs techniques et des règles de forme. Une clé ne distingue jamais un objet d'une autre organisation d'un objet introuvable : les deux refus portent le même texte et la même clé ;
- `request_id` : référence de la requête, ajoutée par le gestionnaire d'erreurs (`toErrorBody`) ;
- `details[].provider_text` : texte du fournisseur (Meta ou CM.com), masqué et borné, pour un contrôle de vérification refusé.

Un test casse si une clé de `ERROR_REASONS` n'est émise par aucun code du moteur (`src/api/__tests__/error-reasons-usage.test.ts`), ou n'a pas de texte français et anglais dans le web (`apps/web/src/i18n/__tests__/error-reasons.test.ts`).

### BFF (`apps/web/src/app/api`)

- Les 400 de validation du BFF sont construits en un seul endroit (`lib/request-body.ts`, `validateBody` et `readValidatedBody`) avec des messages toujours français (`lib/zod-fr.ts`, `zodIssueToFrench`) ; un corps illisible répond 400, jamais 500 ;
- un refus du moteur est relayé tel quel avec sa clé `reason` et sa référence `request_id` (`lib/api-response.ts`).
- un moteur qui ne répond pas (connexion refusée ou coupée) est le code `ENGINE_UNREACHABLE`, statut 503, texte « Le moteur ne répond pas. » (`lib/engine-client.ts`), relayé comme tout refus ; il n'est jamais confondu avec un 500 inattendu.

### Web

- `describeFailure` (`lib/describe-failure.ts`) est la seule fonction qui lit un refus : elle décide du texte, de la nature du refus (`field`, `business`, `session`, `forbidden`, `not_found`, `rate_limited`, `server`, `network`), des erreurs par champ et de la référence (citée seulement pour une panne serveur). Le texte vient de la traduction de la clé `reason` (`errors.reasons.*`) ; sans clé connue, le texte du moteur n'est repris qu'en français, jamais en anglais. `MutationFailure.engineText` n'est lu que par `api-fetch.ts` et `describe-failure.ts` : un lecteur resté sur l'ancien champ `error` ne compile plus, et `lib/__tests__/engine-text-readers.test.ts` casse si un écran lit `engineText`. Les écrans passent par `useMutate` ou `useDescribeFailure` (`components/feedback/`) ;
- composants (`components/feedback/`) :
  - `FieldError` : refus d'un champ, sous le champ, lu avec lui (`aria-describedby`) ;
  - `InlineError` : refus d'une action dans une fenêtre, un tiroir, une ligne ou un panneau, avec la référence de la requête ;
  - `LoadError` : échec de lecture d'une page ou d'un panneau, avec « Réessayer » ;
  - `PartialValue` : « indisponible » à la place d'un chiffre inconnu, jamais 0 ;
  - `StaleBanner` : relecture en échec après une écriture réussie, sans parler d'échec de l'action ;
  - `ActionMenu` : menu « Gérer » d'une ligne ; un élément désactivé dit toujours pourquoi (`disabledReason` obligatoire) ;
  - `NotificationProvider` et `useNotify` : notifications de réussite (région polie, 5 s, texte qui nomme l'objet) et d'erreur sans emplacement naturel (région assertive, jusqu'à fermeture) ; une région polie pour les réussites et une région immédiate pour les erreurs, chacune montée une seule fois pour toute l'application, les notifications sans rôle propre (amendement du 10 nov. 2026 de l'audit de restitution, §5.2). Un refus qui a un emplacement n'est jamais notifié.

### Règle de placement

Elle est dans l'audit, §5.1 (où va chaque type d'erreur), §5.2 (quand notifier) et §5.3 (signaler une réussite). Une panne serveur ou réseau s'affiche à l'endroit de l'action avec le texte contextuel de l'écran et, pour le serveur, la référence ; un état durable d'un objet (compte en erreur, échecs de remise) est un bandeau sur l'objet, repris sur la page de l'agent IA.

### Garde de bout en bout

`apps/web/e2e/restitution.spec.ts` rejoue les actions d'écriture de l'audit (§3) : refus à son emplacement avec le texte de l'interface, panne 500 avec texte contextuel et référence, réussite visible. Les refus et les pannes viennent du faux moteur (`apps/web/e2e/mock-engine.ts`) : le crochet `POST /__fail` impose une réponse d'erreur à une route (statut, code, message, `reason`, `details`, `request_id`, nombre de réponses) jusqu'au prochain `POST /__reset`. Le faux moteur refuse une clé absente de `ERROR_REASONS`, et `lib/__tests__/mock-engine-reasons.test.ts` contrôle que les parcours n'en emploient aucune autre.

La garde tourne en CI : le job `e2e` de `.github/workflows/ci.yml` installe Chromium seul avec ses dépendances, lance la suite Playwright complète de `apps/web/e2e` (dont `restitution.spec.ts` et `contre-audit.spec.ts`) ; `playwright.config.ts` démarre le faux moteur (port 4999) puis construit et démarre le web (port 3002), sans réutiliser de serveur en CI. En cas d'échec, le rapport Playwright et `test-results/` sont publiés en artefact (`playwright-report`, 7 jours). En local : `npx playwright test` dans `apps/web`.

### Journaux

Format `[Service] message`, sans emoji. Jamais de jeton, secret, clé, lien d'invitation, corps de message ni donnée de contact dans un journal (un contact n'apparaît que masqué). Jamais un objet d'erreur entier : la forme acceptée est `err instanceof Error ? err.message : String(err)`, car l'objet peut porter un corps de requête ou des en-têtes. Le mailer console n'écrit les liens que si `MAILER_LOG_LINKS=true`.

`npm run check:logs` (`scripts/check-logs.ts`, lancé par la CI) fait respecter la règle de l'objet d'erreur entier sur le moteur (`src/`) et le web (`apps/web/src`), et celle des données sensibles sur le moteur. Une exemption se déclare par un commentaire `// check-logs-ignore: <raison>` (raison obligatoire) ; la seule exemption du moteur (lien d'invitation du mailer, en développement) est figée par un test (`src/__tests__/check-logs.test.ts`).

---

## Navigation du back-office

Spec : `docs/superpowers/specs/2026-11-10-refonte-navigation-design.md` (sections 5, 10 et 11), complétée par `docs/superpowers/specs/2026-11-11-entete-de-page-et-corrections-design.md` (en-tête de page, corrections de recette). Composants dans `apps/web/src/components/shell/`.

### Cadre d'une page connectée

`AppFrame({ space, column, children })` : le rail, la colonne du milieu, puis la zone de contenu (`main`, `data-page-scroll`, seule à défiler : le rail et la colonne gardent la hauteur de la fenêtre, le document ne défile jamais). Le cadre et la zone sont positionnés (`relative`), pour qu'un élément en position absolue d'une page reste dans la zone. La zone revient en haut à chaque changement de chemin ou de requête ; l'assistant le fait aussi à chaque changement d'étape. Il n'y a plus de barre du haut. Le bandeau d'événement d'organisation (`OrgNoticeBanner`) reste au-dessus de tout, rail compris (`app/[locale]/(app)/layout.tsx`). L'assistant de création (`/agents/new`) est dans ce cadre (rail, colonne avec le stepper, en-tête avec « ✕ Quitter ») ; il pose la garde de sortie (`NavigationGuardProvider`, `components/shell/navigation-guard.tsx`) tant qu'une saisie serait perdue, et les liens du rail, de la colonne, de la ligne des parents et le sélecteur d'organisation passent par elle (`GuardedLink`, `confirmLeave`).

Une adresse réservée à l'admin (espace Organisation, `/usage`, `/agents/:id/usage`, `/agents/new`) ouverte par un autre membre rend le refus sur place (`ReservedPage`) à la même adresse, dans le cadre : titre « Page réservée aux administrateurs », sans ligne des parents ni action, phrase qui nomme l'organisation active en description, lien de retour aux agents IA, aucune lecture des données de la page. La page `/forbidden` n'existe plus.

### Rail

`AppRail({ active })` lit la session et rend `AppRailView({ active, withOrg, isAdmin, account })`, bande sombre de 84 px à gauche : marque WABAGENT (lien vers la liste des agents IA, sans bulle), un espace par entrée (Organisation, Agents IA, Usage ; Organisation et Usage seulement pour l'admin, `isAdmin`), Leads et Reprise grisées, puis Aide grisée et Compte en bas. Chaque entrée sauf la marque a une bulle de deux lignes, le nom en gras puis une phrase, active comprise (le nom de la bulle est `aria-hidden`, la description lue est la phrase seule). L'entrée active est marquée par le fond et son icône en menthe clair ; aucune pastille. Une entrée à venir (`ComingSoon`) n'est pas un lien (`role="link"`, `aria-disabled="true"`). Entrée active : Organisation pour `/organisation/**`, Agents IA pour `/` et `/agents/:id` (usage de l'agent IA compris), Usage pour `/usage`, Compte pour `/account/**`. Sans organisation active, le rail ne montre que la marque, Aide et Compte. L'entrée Compte mène directement à `/account/organisations`. `AppRailView` ne lit aucune session : sans compte (`account` nul), l'entrée Compte n'a qu'une icône, sans initiales ni adresse (cadre neutre d'une session illisible).

### Colonne du milieu et bloc Organisation

`MiddleColumn` (236 px, blanche) commence toujours par le bloc Organisation (`OrgBlock` : libellé, nom de l'organisation active, rôle, nombre d'organisations, sans monogramme), sauf sur les pages du compte (`withOrg={false}`, libellé « Mon compte », adresse, « Se déconnecter » en pied de colonne). Le sélecteur d'organisation est le menu du bloc : flèche dès que `/auth/me` liste plus d'une organisation, suspendues comprises, ou pour l'opérateur ; une organisation suspendue y est grisée, sa pastille « Suspendue » à côté du rôle et sa phrase sous le nom. Une entité n'occupe jamais la tête de la colonne. Sous le bloc : le libellé de l'espace quand il en a un (pas de titre de groupe « Organisation » dans l'espace Organisation, le bloc dit déjà le nom) et les entrées propres à la page (compteur, point de statut, entrée « Soon » non cliquable avec sa bulle). La colonne d'un agent IA porte, pour l'admin, un encart « Numéros WhatsApp de l'organisation » avec le lien « Ouvrir Connexions ↗ » (`data-column-connections`).

### En-tête de page

`PageHeader` et `PageContent` (`components/shell/page-header.tsx`) remplacent la barre du haut : `PageContent` est le conteneur pleine largeur de chaque page (sans largeur maximale de page) et `PageHeader` se pose en premier dedans. L'en-tête est, dans l'ordre du DOM et du clavier :
- la ligne des parents, facultative : un `nav` « Fil d'Ariane » qui ne contient que des liens (`GuardedLink`, sans `aria-current`) séparés par « › ». Elle ne contient jamais le nom de l'organisation (il est dans le bloc Organisation) ni le titre de la page, et n'existe pas sur la première page d'un espace (cible directe d'une entrée du rail ou de la colonne). Un libellé encore en lecture est un squelette sans lien ; un nom trop long est tronqué avec le nom entier en `title` ;
- le titre, seul `h1` de la page (les titres d'étapes de l'assistant sont des `h2`), puis une ligne de description ;
- la zone `data-page-action` : les actions du titre (« ▶ Simuler », « ✕ Quitter », choix de période), puis le bouton rond de création.

Le bouton rond (`CreateAction` : `label`, `icon` parmi `agent`, `entity`, `user`, `whatsapp`, `href` ou `onClick`, `disabled`) est en haut à droite, sur la ligne du titre, collant au défilement : sa place est gardée dans la zone des actions, et le bouton vit dans une colonne en position absolue de `PageContent` mesurée en JavaScript (`offsetTop`, `ResizeObserver`) pour que l'ordre du clavier reste « titre, actions, bouton rond ». Son nom accessible est son libellé (« Créer un agent IA », « Créer un agent IA dans {entité} », « Nouvelle entité », « Inviter un utilisateur », « Raccorder un compte WhatsApp »), repris dans une bulle sous le bouton.

Règle des parents d'un agent IA (`agentParents`, `components/agent/agent-parents.ts`) : « Agents IA » (lien `/`), puis l'entité de l'agent IA (lien `/?entity={id}`), puis son nom pour une page sous la sienne (usage). L'entité n'est nommée que si `entity_id` (lu du moteur) figure dans les entités de l'organisation ouverte (`AgentInfo.entities` : `loading`, `ready` ou `failed`, lu une fois par la mise en page de l'agent IA) ; sinon « Agents IA » seul. Le nom d'une entité affiché dans un titre ou une ligne des parents (liste, usage, assistant) vient toujours de la liste des entités actives de l'organisation ouverte, jamais d'un paramètre d'adresse : une entité inconnue donne « Entité indisponible » (liste, usage) ou aucun nom (assistant, parents).

Droits : le bouton rond n'apparaît que pour `isAdmin && !readOnly` (et jamais sur une page « Entité indisponible », sur un premier lancement ni quand l'encart vide de la page porte déjà l'action : une action n'apparaît jamais deux fois). « ▶ Simuler » suit l'action moteur `simulate.use` : le conseiller l'a, la lecture seule non. L'interface masque, le moteur refuse.

Actions par page : liste des agents IA, bouton rond ; page d'un agent IA, « ▶ Simuler » ; usage d'un agent IA et de l'organisation, le choix de période (`PeriodChoice`) ; assistant, « ✕ Quitter », qui ramène à la liste d'où l'on venait (`/` suivi de `agentFilterQuery(origine)`, seulement si cette liste contient l'agent IA créé, sinon toute la liste) ; Entités, Utilisateurs, Connexions, bouton rond ; Raccorder un compte, Réglages, pages du compte, refus sur place : aucune action. Les parcours e2e lisent `data-page-header` et `data-page-action` ; les tests de pages passent par les constats communs de `components/shell/__tests__/frame-assertions.ts` (`headerParents`, `headerTitle`, `headerActions`, `expectCreateButton`).

### Session illisible

`SessionProvider` ne remplace plus l'arbre par une page d'erreur quand `/api/auth/me` échoue. Si une session valide a déjà été lue par cet onglet, `SessionUnreadable` garde le cadre de cette session (rail et bloc Organisation, colonne sans groupes) et affiche sur place, comme titre de la page, « Impossible de lire votre session pour le moment. » avec « Réessayer » ; aucune donnée de page n'est rendue ni relue. Au premier chargement sans session lue, le cadre est neutre : `AppRailView` sans organisation ni compte, colonne vide, aucun nom d'organisation ni bandeau relu du stockage. « Réessayer » relit la session : même organisation active, les pages reviennent ; organisation active différente, rechargement complet de la page (jamais l'ancien cadre avec les données d'une autre organisation). La page « Aucune organisation » lit la même phrase.

Le BFF y contribue de deux façons. Un `fetch` du moteur rejeté (port fermé, réseau) devient `EngineError('ENGINE_UNREACHABLE', 'Le moteur ne répond pas.', 503)` dans `engineCall` (`apps/web/src/lib/engine-client.ts`, `BffErrorCode`), journalisé `[BFF] moteur injoignable` sans adresse ni en-tête : plus de 500 « erreur inattendue ». Et une panne du moteur au renouvellement du jeton (`engineFetch`, `/api/auth/refresh`) garde la session (cookies conservés) : seul un vrai refus du moteur la détruit. Côté écran, ce 503 se lit comme une panne serveur (`describeFailure`, nature `server`) et s'affiche à l'endroit de l'action, sans référence puisque le moteur n'a pas répondu.

### Bandeau d'organisation suspendue

`GET /api/auth/me` (BFF) renvoie en plus `refused_client_id: string | null` : l'organisation du cookie d'organisation quand elle n'est pas ouvrable et que le BFF en a ouvert une autre (ou aucune). Elle n'est retenue que si elle figure dans la liste des organisations que le moteur rend pour l'utilisateur du jeton, et seulement pour le cookie posé par ce même utilisateur : jamais le cookie d'un autre compte ni une organisation non listée. Le web (`refusedNotice`, `org-notice.ts`) en tire le bandeau « {organisation} est suspendue. » (« Contactez le support. » pour un administrateur de cette organisation), seulement pour l'organisation que l'utilisateur a tenté d'ouvrir (sélecteur, lien, organisation enregistrée au rechargement). Une autre organisation suspendue dont il est membre ne déclenche aucun bandeau, et le bandeau ne nomme jamais l'organisation ouverte.

### Branchement d'un agent IA sur un compte en erreur

Les écrans décident d'un branchement par `assignRefusal` (`apps/web/src/lib/assign-choice.ts`), qui appelle `decideAssign` des contrats (`packages/contracts/src/bot-status.ts`) avec les faits lus par l'écran, la même fonction que le moteur : une seule règle. Un agent IA Draft ou Offline se branche sur un numéro d'un compte en erreur ou `disconnected` (pour préparer le branchement pendant qu'on répare le compte) ; un agent IA Preview ou Online y est refusé (`account_not_connected`), avec la raison affichée. Connexions et la page de l'agent IA décident avec le statut réel de l'agent IA. L'assistant décide avec le statut cible de l'activation (Preview) : il ne branche qu'à l'activation, donc un numéro d'un compte en erreur n'y est pas choisissable à l'étape Numéro (un choix sans effet serait un élément d'interface sans effet). `apps/web/src/lib/__tests__/assign-readers.test.ts` garde les écrans de branchement : aucun ne compare l'état d'un compte à `connected`. Le moteur décide de nouveau à l'écriture.

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
| Garde statique des journaux en CI (`npm run check:logs`) : aucun objet d'erreur entier, aucune donnée sensible | Livré |
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
