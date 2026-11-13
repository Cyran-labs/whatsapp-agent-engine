# Architecture WABAGENT Engine

**Audience** : développeurs, architectes et partenaires techniques (intégrateurs CRM, agences, éditeurs WhatsApp).

---

## Vue d'ensemble

WABAGENT Engine est un moteur d'agents IA WhatsApp **multi-organisations**, construit en couches : transport, cœur, modèle IA, connecteurs CRM.

Le transport WhatsApp et les connecteurs CRM passent par une interface : ajouter un fournisseur revient à écrire un adaptateur, sans toucher au cœur. Le cœur ne connaît ni le transport ni le CRM.

```
┌──────────────────────────────────────────────────────────────────┐
│                      WABAGENT ENGINE                             │
│                                                                  │
│  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐     │
│  │ TRANSPORT   │ ──→ │ CŒUR         │ ──→ │ CONNECTEURS    │     │
│  │ (interface) │     │ (logique     │     │ (interface)    │     │
│  │             │     │  métier)     │     │                │     │
│  └─────────────┘     └──────┬───────┘     └────────────────┘     │
│        │                    │                     │              │
│        ▼                    ▼                     ▼              │
│   meta-cloud           modèle IA             hubspot             │
│   cm-com               (Claude,              webhook signé       │
│                         Anthropic)           attio               │
└──────────────────────────────────────────────────────────────────┘
```

| Couche | Fournisseurs |
|---|---|
| Transport WhatsApp | API Cloud de Meta ; CM.com |
| Modèle IA | Anthropic (modèles Claude) |
| CRM | HubSpot ; Attio ; webhook signé |

---

## Capacités du moteur

- **Multi-organisations** : toute donnée d'exécution est rattachée à une organisation et à un agent IA ; le cloisonnement est vérifié par une suite de tests « deux organisations », sur SQLite et sur Postgres.
- **Agents IA réglés sans code** : créés et réglés depuis le back-office ou par l'API d'administration (identité, personnalité, langues, numéro, Whitelist, statut, modèle).
- **Ouverture progressive** : Draft, Preview (réponse aux seuls numéros de la Whitelist), Online, Offline.
- **Raccordement d'un compte WhatsApp Meta** : l'organisation colle trois informations (WABA ID, jeton d'accès, secret de l'app). Le moteur inscrit lui-même le webhook auprès de Meta, lit les numéros du compte et l'état du compte chez Meta (capacité d'envoi, vérification de l'entreprise, problèmes signalés), et l'affiche.
- **Transport WhatsApp interchangeable** : API Cloud officielle de Meta, ou CM.com.
- **Webhooks authentifiés** : une adresse secrète par compte WhatsApp, et pour Meta une signature HMAC vérifiée avant tout traitement.
- **Messages riches** : texte, boutons, listes, images, lien d'action, produit, liste de produits et catalogue WhatsApp.
- **Qualification automatique des leads** : extraction structurée des informations du contact après chaque réponse.
- **Connecteurs CRM interchangeables** : interface stable, fiche de lead normalisée, webhook signé HMAC pour tout outil qui reçoit un appel HTTP.
- **Mise en cache des prompts** : baisse du coût des conversations à plusieurs tours.
- **Déduplication** : un même message entrant n'est traité qu'une fois.
- **Verrou par conversation** : les messages d'un même contact sur un même numéro sont traités l'un après l'autre.
- **Identifiants chiffrés** : jetons de transport, de modèle IA et de CRM chiffrés en base, par organisation.
- **Back-office web** : agents IA, comptes WhatsApp, entités, équipe et rôles, simulateur, usage et coût de l'IA.
- **API d'administration** (`/api/admin/v1`) : tout ce que fait le back-office, avec une session d'utilisateur.
- **Mesure de l'usage IA** : jetons et coût de chaque appel, par organisation, agent IA et modèle.

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
  sendImage(to: string, imageUrl: string, caption?: string): Promise<void>;
  sendImageButtons(to: string, imageUrl: string, text: string, buttons: ReplyButton[]): Promise<void>;
  sendCta(to: string, text: string, buttonText: string, url: string): Promise<void>;
  sendCatalog(to: string, text: string, footer?: string): Promise<void>;
  sendProduct(to: string, text: string, catalogId: string, productRetailerId: string, footer?: string): Promise<void>;
  sendProductList(to: string, text: string, header: string, catalogId: string, sections: ProductListSection[]): Promise<void>;

  // Retour visuel
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

- **API Cloud de Meta** : API officielle, accès direct sans intermédiaire.
- **CM.com** : prestataire intermédiaire, format propriétaire.

Lorsque le transport passe par un prestataire comme CM.com, la gestion du compte WhatsApp, des modèles de message et du débit relève de ce prestataire.

### Raccordement d'un compte Meta

L'organisation fournit le WABA ID, un jeton d'accès et le secret de son app Meta. Avec ces trois informations, le moteur :

- inscrit le webhook du compte auprès de Meta (adresse propre au compte et jeton de vérification propre au compte) ;
- abonne l'app aux champs qu'il lit : messages et statuts, mises à jour du compte et des numéros ;
- lit les numéros du compte et leur qualité ;
- lit l'état du compte chez Meta : envoi possible, limité ou bloqué, vérification de l'entreprise, problèmes signalés par Meta avec leur code.

L'app Meta, l'utilisateur système et le jeton d'accès sont créés par l'organisation dans les pages de Meta.

### Comptes WhatsApp et routage

Les identifiants WhatsApp appartiennent à un **compte WhatsApp d'organisation**, chiffrés en base. Le transport découle du compte auquel le numéro appartient, jamais de l'agent IA.

Chaque compte a sa propre adresse de webhook, qui contient une clé secrète :

- Meta : `GET` et `POST /webhook/meta/<clé>`. La signature `X-Hub-Signature-256` est vérifiée sur le corps brut, avec le secret d'application du compte.
- CM.com : `POST /webhook/cm-com/<clé>`. La clé de l'adresse sert de secret.

L'ordre est strict : identifier le compte par la clé, authentifier, puis router vers le numéro destinataire, qui doit appartenir à ce compte. Aucun traitement n'a lieu avant l'authentification.

Un même serveur sert en parallèle des organisations qui utilisent des transports différents.

---

## Couche 2 : Cœur (logique métier)

**Responsabilité** : routage, sessions, déduplication, traitement des messages d'un contact l'un après l'autre, appel du modèle IA, lecture de la réponse, envoi, événements métier.

Cette couche ne connaît ni le transport ni le CRM. Elle reçoit un message entrant normalisé du transport, appelle le modèle IA, envoie la réponse par le transport et émet des événements consommés par les connecteurs CRM.

### Composants

- **Routeur** : résolution de l'organisation et de l'agent IA à partir du numéro WhatsApp destinataire, et de lui seul.
- **Gestion des sessions** : sessions en base, par organisation et par agent IA.
- **Traitement d'un message** : prompt système, historique et profil du contact, appel du modèle, lecture de la réponse, envoi.
- **Déduplication** : déduplication atomique des messages entrants.
- **Verrou par conversation** : clé (numéro destinataire, contact), sans concurrence entre deux messages d'une même conversation.
- **Extraction du lead** : extraction structurée par un modèle léger, attendue sous le verrou de la conversation après la réponse ; un échec d'extraction n'empêche pas le traitement du message.
- **Bus d'événements** : messages du contact et de l'agent IA, lead qualifié ou mis à jour.
- **Configuration des agents IA** : en base, par organisation, écrite par le back-office ou l'API d'administration.

### Données persistées

- `sessions` : session active d'un contact sur un numéro, avec l'organisation et l'agent IA ;
- `conversations` : historique des messages du contact et de l'agent IA, par organisation et agent IA ;
- `leads` : informations de qualification extraites, une fiche par (contact, organisation, agent IA) ;
- `processed_messages` : déduplication, clée par l'identifiant du message chez le fournisseur.

---

## Couche 3 : Modèle IA

**Responsabilité** : produire les réponses de l'agent IA et extraire les informations du lead.

- **Anthropic** : Claude Sonnet 5.5 pour la conversation, avec repli sur Sonnet 5 puis Haiku 5.5 ; Claude Haiku 5.5 pour l'extraction des leads.
- Le modèle de conversation se choisit par agent IA, parmi les modèles Claude.
- Une organisation utilise la clé de la plateforme ou fournit la sienne.

### Optimisations

- **Mise en cache des prompts** : le prompt système et les blocs de contexte stables sont mis en cache.
- **Cascade de modèles** : un modèle en surcharge, en erreur ou qui ne rend aucun texte laisse la place au suivant.
- **Limite de concurrence** : les appels parallèles sont plafonnés par organisation, pour un partage équitable.
- **Mesure de l'usage** : jetons (entrée, sortie, cache) et coût de chaque appel, par organisation, agent IA et modèle.

---

## Couche 4 : Connecteurs CRM

**Responsabilité** : envoyer les leads qualifiés vers le CRM de l'organisation.

### Interface

```typescript
interface CRMConnector {
  readonly connectorName: string;

  pushLead(lead: NormalizedLead): Promise<void>;
  updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void>;
  pushBooking(booking: NormalizedBooking): Promise<void>;
  pushOrder?(order: NormalizedOrder): Promise<void>;
  validate?(): Promise<{ ok: boolean; error?: string }>;
}
```

### Implémentations

| Connecteur | Objet créé | Authentification |
|---|---|---|
| HubSpot | Contact | jeton d'application privée |
| Webhook signé | au choix du receveur (n8n, Zapier, Make, outil maison) | secret partagé |
| Attio | Person, Company, Note, et selon réglage Deal et Task | clé d'API |

### Ce qui part vers le CRM

La fiche complète du lead, à sa première qualification puis après chaque extraction qui relève au moins un champ. Le CRM fait une création ou mise à jour à partir de `lead_id`. Le format est décrit dans `docs/CRM_INTEGRATION.md`.

### Garanties du webhook signé

- POST signé **HMAC SHA-256** sur le corps brut.
- **Trois tentatives** au plus (attente de 1 seconde, puis 4 secondes) sur les erreurs 429, 5xx, réseau et délai dépassé ; abandon immédiat sur les autres erreurs 4xx.
- **Identifiant d'envoi** unique dans un en-tête, identique sur les nouvelles tentatives, pour écarter les doublons côté CRM.
- Après trois tentatives en échec, l'envoi est abandonné et la dernière erreur est enregistrée sur l'agent IA ; la fiche complète repart au prochain changement du lead.

---

## Multi-organisations : modèle de données

### Configuration

Un agent IA appartient à une organisation et à une entité. Il se crée et se règle depuis le back-office ou par l'API d'administration : identité, personnalité, langues, numéro, Whitelist, statut. Aucun code à modifier.

### Isolation des données

Les sessions, les conversations et les leads sont rattachés à une organisation et à un agent IA. Chaque lecture filtre sur ces deux clés. Une suite de tests « deux organisations » vérifie qu'aucune donnée ne traverse la frontière, sur SQLite et sur Postgres, à chaque modification du code.

### Routage entrant

Une seule règle : **un numéro WhatsApp, un agent IA**. Un message est routé par son numéro destinataire, après l'authentification du webhook du compte auquel ce numéro appartient.

Un agent IA ne répond pas s'il est en Draft, en Offline, si le contact n'est pas dans la Whitelist en Preview, ou si son organisation est suspendue.

Il n'existe aucun routage par mot-clé.

### Stockage des identifiants

Les identifiants de transport, de modèle IA et de CRM sont chiffrés en base (AES-256-GCM), par organisation, avec une clé maîtresse fournie au serveur par son environnement. Aucun identifiant de la plateforme ne sert de repli pour envoyer un message ou vérifier un webhook.

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
| Admin | organisation | Tout : agents IA, connexions, entités, utilisateurs, invitations, réglages, journal d'audit, coûts |
| Super manager | organisation (toutes les entités, futures comprises) | Consultation complète et simulateur ; option lecture seule |
| Manager | une ou plusieurs entités | Consultation et simulateur |
| Conseiller | une ou plusieurs entités | Consultation et simulateur |

Un opérateur plateforme accède à toute organisation avec les droits d'un Admin. Retirer ou suspendre le dernier Admin actif d'une organisation est refusé. Les numéros des contacts sont masqués pour qui n'a pas le droit de les voir.

### Organisation active

Chaque appel à l'API d'administration (`/api/admin/v1`) désigne l'organisation par l'en-tête `X-Organization-Id`. Si l'en-tête manque et que l'utilisateur n'appartient qu'à une organisation, celle-ci est prise ; sinon la réponse est 400. Un utilisateur sans appartenance active dans l'organisation demandée reçoit 403. La liste des organisations d'un utilisateur, avec son rôle, est disponible sur `GET /auth/me`.

### Invitations

- Seul un Admin invite ; l'opérateur plateforme invite le premier Admin d'une organisation.
- Toute invitation doit être acceptée par la personne invitée, qu'elle ait déjà un compte ou non.
- Le lien est à usage unique et expire après 7 jours par défaut. Aucun identifiant n'est envoyé : l'invité choisit son mot de passe, ou se connecte avec son compte existant pour accepter.
- Un lien perdu ou expiré se remplace par « renvoyer l'invitation ».

### Réglages d'organisation

Les réglages d'organisation portent sur la visibilité (tout le monde voit tout). Lecture pour tous les membres, écriture réservée à l'Admin.

---

## Sécurité

- Vérification HMAC SHA-256 des webhooks entrants Meta (`X-Hub-Signature-256`), avec le secret d'application du compte WhatsApp de l'organisation, avant tout traitement.
- Jeton de vérification Meta propre à chaque compte WhatsApp, chiffré en base.
- Verrou par (numéro destinataire, contact) : pas de concurrence entre messages d'une même conversation.
- Déduplication atomique des messages entrants.
- Purge automatique des conversations anciennes (90 jours par défaut, réglable par `CONVERSATION_RETENTION_DAYS`), des messages traités (7 jours) et des sessions inactives (30 jours), au démarrage puis toutes les 6 heures.
- Arrêt propre sur SIGTERM et SIGINT, avec fermeture de la base.
- Leads, santé, métriques et usage de chaque agent IA lus par l'API d'administration, cloisonnée par organisation.
- Droits par rôle tenus par le moteur, pas seulement par l'interface.
- Identifiants chiffrés en base (AES-256-GCM) par organisation.
- Journal d'audit des actions d'administration.
- Aucun jeton, secret ni contenu de message dans les journaux, contrôlé à chaque modification du code.

---

## Stockage

- **PostgreSQL** : base de production (concurrence, durabilité, JSONB pour les leads).
- **SQLite** : développement local et tests. Le pilote est choisi selon `DATABASE_URL`.

---

## Axes de développement

Chantiers sur lesquels le produit évolue, sans ordre :

- conversations et suivi des leads dans le back-office, avec reprise d'une conversation par un conseiller ;
- API ouverte : clés par organisation, clés de partenaire pour un éditeur qui crée et pilote les organisations de ses clients, limites de débit, version stable et documentée ;
- événements CRM supplémentaires (rendez-vous, commandes, messages) et rejeu des envois en échec ;
- réglage du CRM depuis le back-office, connecteurs CRM supplémentaires (Pipedrive, Salesforce, Zoho) ;
- gestion du catalogue WhatsApp depuis WABAGENT ;
- éditeur de parcours, avec les WhatsApp Flows de Meta ;
- modèles d'agents IA par secteur ;
- données et modèles IA traités en Europe, cadre RGPD (sous-traitance, export et suppression d'un contact) ;
- autres fournisseurs de modèle IA et de transport WhatsApp ;
- fonctionnement sur plusieurs serveurs.

---

## Documents associés

- `CRM_INTEGRATION.md` : format de la fiche de lead, signature HMAC, nouvelles tentatives.
- `GLOSSAIRE.md` : terminologie du projet.

---

*Édité par WABAGENT.*
