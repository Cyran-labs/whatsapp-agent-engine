# Connecteurs CRM — référence opérateur

Document interne. Détail de configuration de chaque connecteur natif : `credentials`, `options`, fichier de mapping, et statut de maturité.

Pour la spécification du contrat (événements, format normalisé, webhook HMAC) voir `CRM_INTEGRATION.md`.

---

## Configuration d'un connecteur

Un connecteur est instancié par `createConnector(config)` (`src/connectors/registry.ts`) à partir d'une config tenant :

```jsonc
{
  "type": "hubspot",                 // clé du connecteur
  "credentials": { "...": "..." },   // secrets et identifiants (cf. tableaux ci-dessous)
  "options": { "...": "..." }        // configuration non secrète, spécifique au connecteur
}
```

Les connecteurs à modèle plat chargent leur mapping depuis `connectors-config/{client_id}/{type}.json` via `FieldMapper`. Le `client_id` est lu dans `credentials.client_id` (défaut `default`).

---

## Statut de maturité

| Connecteur | Tests unitaires | Runtime validé |
|---|---|---|
| `hubspot` | oui | oui — compte réel `148357699` |
| `attio` | oui | schéma validé en lecture (workspace Cyran) ; write-path non exécuté |
| `pipedrive` | oui | non |
| `salesforce` | oui | non |
| `zoho` | oui | non |
| `webhook-generic` | oui | non |
| `mad-crm` | squelette | non (en attente specs API) |

« Runtime validé » = au moins un appel d'écriture réel réussi contre l'API du CRM. Les autres sont corrects vis-à-vis des API publiques mais non éprouvés de bout en bout.

---

## hubspot

- **credentials** : `access_token` (Private App, format `pat-...`), `client_id`
- **options** : —
- **mapping** : `connectors-config/{client_id}/hubspot.json`
- **cible** : objet Contact. Dédup par `email` puis `phone`.

## pipedrive

- **credentials** : `api_token`, `company_domain` (sous-domaine `{x}.pipedrive.com`, défaut `api`), `client_id`
- **options** : —
- **mapping** : `connectors-config/{client_id}/pipedrive.json`
- **cible** : objet Person (+ note pour les RDV). Champs natifs `email`/`phone` sérialisés en `[{ value, primary }]`.

## salesforce

- **credentials** : `instance_url` (ex `https://acme.my.salesforce.com`), `access_token` (OAuth 2.0), `client_id`
- **options** : `api_version` (défaut `v59.0`), `sobject` (défaut `Lead`)
- **mapping** : `connectors-config/{client_id}/salesforce.json`
- **cible** : sObject Lead. Dédup par requête SOQL (valeur échappée, identifiants validés). Le sObject Lead exige `LastName` et `Company` → garantis par `default_values` dans le mapping.
- **limite** : le refresh du token OAuth n'est pas géré (le connecteur attend un access token valide). Flow OAuth complet prévu en P3.

## zoho

- **credentials** : `access_token` (OAuth 2.0), `api_domain` (data center : `https://www.zohoapis.com` / `.eu` / `.in` / ...), `client_id`
- **options** : `module` (défaut `Leads`)
- **mapping** : `connectors-config/{client_id}/zoho.json`
- **cible** : module Leads. Dédup par `search?criteria` (valeur restreinte à un charset sûr, identifiants validés). `Last_Name` requis → garanti par `default_values`.
- **limite** : refresh OAuth non géré (idem Salesforce, P3). Attention au data center : `api_domain` doit correspondre à la région du compte.

## attio

- **credentials** : `api_key`
- **options** :
  - `create_deal` (bool) — crée un Deal en plus de Person+Company+Note
  - `deal_stage_id` (string) — requis si `create_deal`
  - `owner_member_id` (string) — `workspace_member_id`, requis si `create_deal` (l'attribut `owner` du Deal est obligatoire dans Attio)
  - `create_task` (bool) — crée une Task assignée à l'owner (requiert `create_deal`)
  - `note_title` (string) — titre des notes (défaut `Lead WhatsApp`)
- **mapping** : aucun (modèle imbriqué, pas de `FieldMapper`)
- **cible** : Person + Company + Note ; Deal + Task si activés. Match Person par email, sinon par téléphone numérique (un identifiant alphanumérique type wa_id n'est jamais rangé dans `phone_numbers`).

## webhook-generic

- **credentials** : `url`, `secret`
- **options** : —
- **mapping** : aucun (le payload est le format normalisé brut)
- **cible** : tout endpoint HTTP. POST signé HMAC SHA-256 (`X-Cyran-Signature`), retry 1s/4s/16s, `X-Cyran-Event-Id` pour l'idempotency.

## mad-crm

- **credentials** : `api_url`, `api_key`
- **statut** : squelette. `pushLead`/`updateLead`/`pushBooking` lèvent `not yet implemented`. À compléter à réception des specs API MAD CRM ; en attendant, `webhook-generic` couvre le besoin V1.
