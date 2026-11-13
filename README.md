# WABAGENT Engine

Moteur d'agents IA WhatsApp, multi-organisations, avec son back-office web.

Produit : WABAGENT (wabagent.com). Dépôt : `cyran-labs-engine`.

---

## État

Le produit fonctionne sur `main` et en recette locale. **Rien n'est déployé.**

L'état détaillé, vérifié dans le code, est dans [docs/EVOLUTIONS.md](docs/EVOLUTIONS.md) : ce qui est livré, en cours, prévu, et ce qu'on peut promettre à un client.

Livré :
- un agent IA qui répond sur WhatsApp, dans les langues et avec la personnalité choisies ;
- la qualification automatique des leads (nom, besoin, demande de rendez-vous, étape) ;
- le cloisonnement des données entre organisations, testé sur SQLite et Postgres ;
- le back-office web : agents IA, comptes WhatsApp, entités, équipe et rôles, simulateur, usage et coût de l'IA ;
- l'ouverture progressive d'un agent IA : Draft, Preview (Whitelist), Online, Offline ;
- l'envoi des leads vers HubSpot, validé sur un compte réel.

Codé mais pas validé en réel : transport CM.com ; connecteurs Attio, Pipedrive, Salesforce, Zoho ; webhook générique signé.

Pas encore fait : écran Conversations et leads, reprise par un conseiller, API ouverte avec clés, marque blanche, facturation, données traitées en Europe, connecteurs e-commerce, éditeur de parcours.

Préalable à toute mise en ligne : le chantier S (sécurité, conformité, données en Europe) de [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Ce qui est réellement branché

| Couche | Disponible | Remarque |
|---|---|---|
| Transport WhatsApp | API Cloud de Meta ; CM.com | CM.com non rejoué en réel sur ce dépôt |
| Modèle IA | Anthropic (Claude) | aucun autre fournisseur n'est codé |
| CRM | HubSpot ; Attio, Pipedrive, Salesforce, Zoho, webhook signé | seul HubSpot est validé en réel ; MAD CRM est un squelette |
| Base de données | Postgres (cible) ; SQLite (développement et tests) | |

Le moteur est organisé en couches (transport, cœur, modèle IA, connecteurs CRM). Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Structure du dépôt

```
src/                  moteur (Express)
  core/               logique métier, sessions, droits, base de données
  transport/          Meta Cloud API, CM.com
  webhooks/           réception et authentification des webhooks
  llm/                appels au modèle IA, mesure de l'usage
  connectors/         connecteurs CRM
  api/                API d'administration
apps/web/             back-office (Next.js)
packages/contracts/   contrats partagés entre le moteur et le web
docs/                 architecture, roadmap, specs, plans, revues
marketing/            brief de la landing, calculateur de coût, charte
scripts/              création d'organisation, amorçage, gardes de la CI
```

---

## Démarrer en local

Prérequis : Node.js, et Docker pour les tests Postgres.

1. `npm install`
2. Copier `.env.example` en `.env` et renseigner au minimum `ADMIN_JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` et `ANTHROPIC_API_KEY`.
3. `npm run dev` pour le moteur.
4. `npm run dev -w @wabagent/web` pour le back-office (port 3001).

Les scripts d'amorçage sont dans `scripts/` (`seed-admin.ts`, `create-organization.ts`, `seed-pricing.ts`).

---

## Commandes

| Commande | Rôle |
|---|---|
| `npm test` | tests du moteur sur SQLite |
| `npm run test:pg` | tests du moteur sur Postgres |
| `npm run typecheck` | typage du moteur |
| `npm run typecheck:tests` | typage des fichiers de test |
| `npm run check:tests` | garde des tests HTTP |
| `npm run check:logs` | garde des journaux (moteur et web) |
| `npm test -w @wabagent/web` | tests du back-office |

Les règles de développement, d'isolation entre organisations et de méthode sont dans [CLAUDE.md](CLAUDE.md).

---

## Documents

- [docs/EVOLUTIONS.md](docs/EVOLUTIONS.md) : état réel des évolutions
- [docs/ROADMAP.md](docs/ROADMAP.md) : plan d'ensemble
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : architecture interne
- [docs/ARCHITECTURE-PARTENAIRE.md](docs/ARCHITECTURE-PARTENAIRE.md) : architecture pour un partenaire
- [docs/CRM_INTEGRATION.md](docs/CRM_INTEGRATION.md) : recevoir les leads dans un CRM
- [docs/CONNECTORS.md](docs/CONNECTORS.md) : réglage des connecteurs
- [docs/GLOSSAIRE.md](docs/GLOSSAIRE.md) : vocabulaire

---

## Licence

Propriétaire. Voir [LICENSE](LICENSE).

## Contact

WABAGENT · info@wabagent.com
