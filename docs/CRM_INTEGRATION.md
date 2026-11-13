# Recevoir les leads WABAGENT dans un CRM

**Audience** : développeurs qui intègrent un CRM (MAD CRM, HubSpot, Attio ou un outil maison).

Ce document est la spécification de ce que le moteur envoie : événement, format, signature, nouvelles tentatives, idempotence.

---

## Principe

Quand un agent IA apprend quelque chose d'utile sur un contact (nom, besoin, étape), le moteur envoie la fiche du lead au CRM de l'organisation.

Deux façons de la recevoir :
1. **le webhook signé** : le moteur fait un POST vers une adresse que vous fournissez. Aucun développement de notre côté ;
2. **un connecteur dédié** : un module du moteur parle directement à l'API du CRM.

---

## Événement envoyé

Le moteur envoie un seul événement : **`lead.qualified`**.

Il part à la première qualification du lead, puis après chaque réponse de l'agent IA dont l'extraction relève au moins un champ. Chaque envoi contient **la fiche complète** du lead (champs déjà connus et champs nouveaux), pas seulement ce qui a changé. Le CRM fait donc une création ou mise à jour (upsert) à partir de `lead_id`.

---

## Format `NormalizedLead`

```typescript
interface NormalizedLead {
  // Identification
  client_id: string;        // l'organisation
  bot_id: string;           // l'agent IA
  lead_id: string;          // le numéro du contact
  phone: string;            // format international sans +, ex. "33600000000"
  profile_name?: string;    // nom public WhatsApp

  // Identité, extraite de la conversation
  prenom?: string;
  nom?: string;
  email?: string;
  societe?: string;
  fonction?: string;

  // Contexte
  besoin?: string;
  budget?: string;
  stage?: string;           // lead | marketingqualifiedlead | salesqualifiedlead
                            // | opportunity | customer | unqualified
  custom_fields?: Record<string, string>; // champs propres à l'agent IA

  // Métadonnées
  source: string;           // "whatsapp-<organisation>-<agent IA>"
  created_at: string;       // ISO 8601, première qualification
  updated_at: string;       // ISO 8601, cet envoi
}
```

Tous les champs facultatifs peuvent manquer : l'agent IA n'envoie que ce que le contact a dit. Les champs propres à un agent IA (par exemple une demande de rendez-vous ou une préférence produit) arrivent dans `custom_fields`, sous forme de texte.

---

## Webhook signé

Réglage par agent IA, avec deux valeurs : l'adresse (`url`) et un secret partagé (`secret`).

- Méthode : `POST`, corps JSON `{ "event": ..., "data": ... }`.
- Signature : HMAC SHA-256 du corps brut avec le secret, en-tête `X-Cyran-Signature` (`sha256=<hex>`).
- Horodatage : en-tête `X-Cyran-Timestamp` (ISO 8601), fixé à la création de l'envoi. Il n'entre pas dans la signature.
- Identifiant de l'envoi : en-tête `X-Cyran-Event-Id` (UUID), identique sur les nouvelles tentatives d'un même envoi, différent d'un envoi à l'autre.
- Délai d'attente : 10 secondes par tentative.

### Exemple

```http
POST /webhooks/wabagent HTTP/1.1
Host: api.exemple-crm.com
Content-Type: application/json
X-Cyran-Signature: sha256=a3f5b7...
X-Cyran-Timestamp: 2026-11-13T14:32:00.000Z
X-Cyran-Event-Id: 550e8400-e29b-41d4-a716-446655440000

{
  "event": "lead.qualified",
  "data": {
    "client_id": "boutique-exemple",
    "bot_id": "accueil",
    "lead_id": "33600000000",
    "phone": "33600000000",
    "profile_name": "Camille D.",
    "prenom": "Camille",
    "nom": "Durand",
    "email": "camille@exemple.fr",
    "besoin": "Devis pour une installation",
    "stage": "marketingqualifiedlead",
    "custom_fields": {},
    "source": "whatsapp-boutique-exemple-accueil",
    "created_at": "2026-11-13T14:30:00.000Z",
    "updated_at": "2026-11-13T14:32:00.000Z"
  }
}
```

`client_id` et `bot_id` sont dans `data`, pas à la racine.

### Vérifier la signature

Calculez la signature sur le corps **tel que reçu**, avant toute analyse JSON.

```typescript
import crypto from 'crypto';

function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice('sha256='.length) : '';
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### Réponses attendues et nouvelles tentatives

| Votre réponse | Ce que fait le moteur |
|---|---|
| 2xx | envoi réussi |
| 4xx, sauf 429 | abandon immédiat, pas de nouvelle tentative |
| 429, 5xx, délai dépassé, erreur réseau | nouvelle tentative |

Trois tentatives au plus : la deuxième après 1 seconde, la troisième après 4 secondes. Le corps, la signature, l'horodatage et `X-Cyran-Event-Id` sont identiques d'une tentative à l'autre.

Après la troisième tentative en échec, ou après un refus 4xx, l'envoi est abandonné et la dernière erreur est enregistrée sur l'agent IA. L'événement n'est pas renvoyé : la fiche complète repart au prochain changement du lead.

### Idempotence et ordre

- Traitez un `X-Cyran-Event-Id` déjà reçu comme un succès (réponse 2xx), sans le rejouer.
- Faites un upsert sur `lead_id`, dans le périmètre de `client_id` et `bot_id`.
- Une nouvelle tentative peut arriver après un envoi plus récent pour le même lead. Comparez `updated_at` et ignorez une fiche plus ancienne que celle déjà enregistrée.

---

## Connecteurs dédiés

| `type` | Objet créé | Authentification |
|---|---|---|
| `hubspot` | Contact | jeton d'application privée (`access_token`) |
| `webhook-generic` | au choix du receveur | adresse et secret partagé (`url`, `secret`) |
| `attio` | Person, Company, Note, et selon réglage Deal et Task | clé d'API (`api_key`) |

Le réglage se fait par agent IA, par l'API d'administration :
- `PUT /api/admin/v1/bots/:botId/crm/:connector`, corps `{ "values": { ... } }` : identifiants du connecteur, chiffrés en base ;
- `POST /api/admin/v1/bots/:botId/crm/:connector/validate` : test des identifiants auprès du CRM ;
- `PUT /api/admin/v1/bots/:botId/mappings/:connector` : table de correspondance des champs.

Aucun identifiant de la plateforme ne sert de repli pour un connecteur CRM.

Deux façons de faire correspondre les champs :
- **table de correspondance** (HubSpot) : une table JSON, enregistrée en base pour l'agent IA ou pour l'organisation, associe chaque champ du lead à une propriété du CRM. Aucune logique dans le code ;
- **réglages dédiés** (Attio) : son modèle imbriqué ne se prête pas à une table plate. La logique est dans le connecteur, seuls les identifiants variables (étape, propriétaire) sont réglables.

---

## Écrire un connecteur dédié

Créer `src/connectors/{nom}.ts`, avec une classe qui implémente `CRMConnector` (`src/connectors/types.ts`) :

```typescript
import type { CRMConnector, NormalizedLead, NormalizedBooking } from './types.js';

export class ExempleConnector implements CRMConnector {
  readonly connectorName = 'exemple';

  constructor(private readonly options: { apiUrl: string; apiKey: string }) {}

  async pushLead(lead: NormalizedLead): Promise<void> {
    // création ou mise à jour dans le CRM, à partir de lead.lead_id
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {}

  async pushBooking(booking: NormalizedBooking): Promise<void> {}
}
```

Puis l'enregistrer dans `createConnector` (`src/connectors/registry.ts`).

Le moteur appelle `pushLead` à chaque événement `lead.qualified`. `updateLead`, `pushBooking` et `pushOrder` font partie de l'interface et ne sont pas appelées par le moteur. Une erreur levée par `pushLead` est enregistrée sur l'agent IA et n'interrompt pas la conversation.

Conseils :
- pour un CRM à modèle plat, réutiliser `FieldMapper` (voir HubSpot) ;
- pour les appels HTTP, réutiliser `requestJson` de `src/connectors/http.ts` (nouvelles tentatives, abandon immédiat sur 4xx) ;
- implémenter `validate()` pour que les identifiants puissent être testés ;
- tests unitaires obligatoires avec `fetch` simulé (`src/connectors/__tests__/`).

---

## Questions fréquentes

**Le webhook suffit-il ?**
Oui dans la plupart des cas. Un connecteur dédié sert quand le CRM a des contraintes propres : objets liés, étapes de cycle de vie, associations entre personne et société.

**Et les limites de débit de mon CRM ?**
Un 429 déclenche une nouvelle tentative, dans la limite des trois tentatives.

**Que se passe-t-il si mon CRM est indisponible cinq minutes ?**
Les envois de cette période sont abandonnés après trois tentatives. Les leads restent dans WABAGENT, et leur fiche complète repart au prochain changement.

**Un lead peut-il arriver deux fois ?**
Oui : une nouvelle tentative après un délai dépassé peut arriver alors que le premier envoi a été traité. `X-Cyran-Event-Id` permet d'écarter le doublon, et l'upsert sur `lead_id` rend un second traitement sans effet.
