# Spécification Connecteur CRM

**Audience** : développeurs intégrant un nouveau CRM (MAD CRM, HubSpot, Salesforce, Klaviyo, ou CRM custom).

---

## Principe

Tout connecteur CRM est un module qui :
1. Implémente l'interface `CRMConnector` (voir `src/connectors/types.ts`)
2. Reçoit des événements métier normalisés depuis le bus d'événements interne
3. Pousse les données vers l'API du CRM cible (REST signé, ou SDK officiel)

---

## Événements émis par le moteur

| Événement | Quand | Payload |
|---|---|---|
| `lead.qualified` | Le bot a extrait un set complet de champs (selon `lead_fields` du bot) | `NormalizedLead` |
| `lead.updated` | Un champ d'un lead existant change pendant la conversation | `{ leadId, fields }` |
| `rdv.created` | Webhook Calendly reçu (ou équivalent) | `NormalizedBooking` |
| `order.placed` | Order WhatsApp natif reçu (panier produit) | `NormalizedOrder` |
| `message.received` | Tout message entrant (rare, pour analytics) | `IncomingMessage` |

---

## Format normalisé `NormalizedLead`

```typescript
interface NormalizedLead {
  // Identification
  client_id: string;
  bot_id: string;
  lead_id: string;          // UUID interne Cyran
  phone: string;            // Format international sans +, ex: "33761848975"
  profile_name?: string;    // Nom WhatsApp public

  // Identité (extraits par Haiku ou équivalent)
  prenom?: string;
  nom?: string;
  email?: string;
  societe?: string;
  fonction?: string;

  // Contexte métier (variable selon bot)
  besoin?: string;
  budget?: string;
  custom_fields?: Record<string, string>;

  // Métadonnées
  source: string;           // "whatsapp-bot-cyran"
  created_at: string;       // ISO 8601
  updated_at: string;       // ISO 8601
}
```

---

## Webhook signé HMAC

Pour les CRM custom (et MAD CRM en V1), pas besoin d'écrire un connecteur spécifique. Utiliser `connectors/webhook-generic.ts` avec :

- URL : configurée par tenant (`webhook_url` dans table `clients`)
- Secret : configuré par tenant (`webhook_secret`)
- Signature : HMAC SHA-256 du body, dans header `X-Cyran-Signature`
- Timestamp : header `X-Cyran-Timestamp` (ISO 8601)
- Idempotency key : header `X-Cyran-Event-Id` (UUID v4 unique par événement)

### Exemple de payload

```http
POST /webhooks/cyran HTTP/1.1
Host: api.madcrm.com
Content-Type: application/json
X-Cyran-Signature: sha256=a3f5b7...
X-Cyran-Timestamp: 2026-04-25T14:32:00Z
X-Cyran-Event-Id: 550e8400-e29b-41d4-a716-446655440000

{
  "event": "lead.qualified",
  "client_id": "client-uuid-here",
  "bot_id": "qualification-leads",
  "data": {
    "lead_id": "lead-uuid-here",
    "phone": "33761848975",
    "profile_name": "François Greze",
    "prenom": "François",
    "nom": "Greze",
    "email": "francois@cyran.fr",
    "societe": "Cyran",
    "fonction": "CTO",
    "besoin": "Bot WhatsApp pour qualifier mes prospects",
    "source": "whatsapp-bot-cyran",
    "created_at": "2026-04-25T14:30:00Z",
    "updated_at": "2026-04-25T14:32:00Z"
  }
}
```

### Vérification de signature côté CRM

```typescript
import crypto from 'crypto';

function verifyCyranSignature(body: string, signatureHeader: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  const provided = signatureHeader.replace('sha256=', '');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(provided, 'hex')
  );
}
```

---

## Retry et idempotency

Le moteur Cyran Labs garantit :

- **3 tentatives** en cas d'échec (4xx ou 5xx)
- **Backoff exponentiel** : 1s → 4s → 16s
- **Dead letter queue** : si les 3 tentatives échouent, l'événement est persisté en DB et peut être rejoué manuellement via dashboard admin
- **Idempotency** : chaque événement a un `X-Cyran-Event-Id` unique. Le CRM doit rejeter (200 OK) si l'event ID a déjà été traité, pour éviter les doublons en cas de retry

Le CRM **doit** retourner 200/201/204 pour signaler "événement traité avec succès". Tout 4xx/5xx déclenche un retry.

---

## Implémentation custom (un nouveau CRM)

Si vous voulez écrire un connecteur dédié (au lieu d'utiliser le webhook générique), créer un fichier `src/connectors/{nom}.ts` qui exporte une classe implémentant `CRMConnector` :

```typescript
import { CRMConnector, NormalizedLead, NormalizedBooking } from './types.js';

export class MadCrmConnector implements CRMConnector {
  readonly connectorName = 'mad-crm';

  constructor(private apiKey: string, private apiUrl: string) {}

  async pushLead(lead: NormalizedLead): Promise<void> {
    // Appel API MAD CRM ici
    // ...
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    // ...
  }

  async pushBooking(booking: NormalizedBooking): Promise<void> {
    // ...
  }
}
```

Puis enregistrer le connecteur dans `src/connectors/registry.ts` :

```typescript
import { MadCrmConnector } from './mad-crm.js';

export const connectorRegistry = {
  'mad-crm': MadCrmConnector,
  'hubspot': HubSpotConnector,
  'attio': AttioConnector,
  'webhook-generic': WebhookGenericConnector,
  // ...
};
```

Le client choisit son connecteur via le champ `crm_connector` dans la table `clients`.

---

## FAQ

**Q : Pourquoi pas juste des webhooks pour tout ?**
R : Les webhooks suffisent à 80% des cas. Mais certains CRM (HubSpot, Salesforce) ont des contraintes spécifiques (gestion des objects/properties, lifecycle stages, associations Person ↔ Company) qu'on peut mieux gérer avec un connecteur dédié.

**Q : Comment gérer les rate limits du CRM cible ?**
R : Chaque connecteur peut implémenter son propre rate limiting interne (token bucket par tenant). À documenter par connecteur.

**Q : Que se passe-t-il si le CRM est down 5 minutes ?**
R : Les événements partent en dead letter queue après 3 retries. Replay manuel ou automatique configurable par tenant.

**Q : Comment tester un connecteur ?**
R : Mock du CRM avec `nock` ou serveur local. Tests unitaires obligatoires pour chaque connecteur. Voir `src/connectors/__tests__/`.
