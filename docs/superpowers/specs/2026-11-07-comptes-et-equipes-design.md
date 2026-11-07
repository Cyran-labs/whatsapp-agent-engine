# Comptes et équipes : design

Date : 7 novembre 2026. Statut : en revue.

## 1. Intention

WABAGENT doit servir des organisations réelles : une marque avec un service client et un réseau de boutiques, une PME avec deux équipes commerciales. Aujourd'hui le modèle d'accès ne connaît que deux rôles (`super_admin` plateforme et `client_admin` lié à un seul client), sans équipes ni hiérarchie : tous les utilisateurs d'un client voient et modifient tout, et seul l'opérateur plateforme peut inviter.

Ce chantier pose les fondations dont dépendent les deux suivants :

- **Conversations & Leads** (pool de contacts par entité, prise en charge, affectation par un manager, transfert entre entités, historique, notes, tags, résumé envoyé au CRM) ;
- **Reprise humaine** (un conseiller prend la main sur la conversation WhatsApp, l'agent IA se tait, puis reprend).

Principe directeur (règle de François) : quand un besoin contredit un principe en place, on révise le principe au lieu d'empiler un cas particulier. Ce chantier révise donc explicitement le modèle de comptes, le rattachement des agents IA et le découpage 7b/7c (voir §10).

## 2. Vocabulaire

À employer dans l'UI, les documents et les échanges. Les identifiants de code existants ne sont pas renommés.

| Terme | Sens | Code |
|---|---|---|
| Agent IA | Le bot WhatsApp piloté par l'IA, un numéro chacun. Jamais « agent » seul. | `bot` |
| Utilisateur | Une personne qui se connecte à WABAGENT. | `users` |
| Conseiller | Utilisateur qui suit un contact et peut prendre la main sur sa conversation. | rôle `advisor` |
| Contact | La personne qui écrit sur WhatsApp. Un lead est un contact qualifié. | `leads` |
| Organisation | L'entreprise ou la marque cliente de WABAGENT. | `clients`, `client_id` |
| Entité | Boutique, équipe, service client, agence de voyage… à l'intérieur d'une organisation. | `entities` (nouveau) |
| Agence | Partenaire qui gère plusieurs organisations. | `agencies` (nouveau, sans UI) |

## 3. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. Une organisation se découpe en **entités** ; chaque agent IA est rattaché à exactement une entité.
2. Des **rôles par périmètre** : Admin et Super manager au niveau de l'organisation ; Manager et Conseiller au niveau d'une ou plusieurs entités.
3. L'**admin d'organisation gère son équipe** lui-même : invitation, liste, modification des rôles et entités, suspension.
4. Des **réglages d'organisation** : visibilité des conversations et règles de gestion, stockés et modifiables (voir §6 pour ce qui est actif dans ce chantier).
5. Un utilisateur peut **appartenir à plusieurs organisations**, avec un **sélecteur d'organisation** dans le bandeau. Corrige au passage le super admin qui ne voit rien dans l'app web (le BFF n'envoie jamais de `client_id`).
6. **Migration sans régression** : chaque `client_admin` existant garde exactement ce qu'il peut faire aujourd'hui.

**Non-objectifs (chantiers ultérieurs)**

- La **console agence** (gestion des organisations clientes, facturation, vue globale) : autre outil, hors de l'app WABAGENT. Ici, seulement la possibilité en base de rattacher une organisation à une agence.
- L'**affectation des contacts** (pool, prise en charge, transfert, historique) : chantier Conversations & Leads. Ce chantier fournit les rôles, les entités et les réglages qu'elle consommera.
- Les **modes de visibilité restreints** (« ses entités », « ses contacts et le pool ») : la structure les permet, leur application vient plus tard.
- **Licences, formules, facturation.** Piste retenue par François : facturation par agent IA, utilisateurs illimités. Rien à construire, ne rien empêcher.
- **Base de connaissance de marque, prompts par numéro** : cartographie à part (chantier Personnalité & contenu). Contrainte posée ici : la hiérarchie Organisation > Entité > Agent IA doit permettre d'y rattacher une base de connaissance au niveau de l'organisation.
- SSO, authentification à deux facteurs.

**Anti-objectifs (échec même si ça marche techniquement)**

- Un `client_admin` existant qui perd un accès, ou un agent IA en production qui cesse de répondre après la migration.
- Un modèle qui pousse au partage de comptes (l'affectation et l'historique perdraient leur sens).
- Un admin d'organisation capable d'agir hors de son organisation, ou de désactiver globalement un utilisateur qui appartient aussi à une autre organisation.
- Des réglages affichés dans l'UI qui n'ont aucun effet sans le dire.

## 4. Modèle de rôles

Un rôle s'applique à un périmètre. Un utilisateur a, **par organisation**, soit une appartenance au niveau de l'organisation, soit une ou plusieurs appartenances d'entité (un rôle par entité).

| Rôle | Périmètre | Droits |
|---|---|---|
| **Admin** (`admin`) | organisation | Tout, configuration comprise : agents IA, connexions, entités, utilisateurs, réglages, journal d'audit. Seul à inviter. |
| **Super manager** (`super_manager`) | organisation : toutes les entités, futures comprises | Tout ce que fait un manager, dans toutes les entités, et agir comme un conseiller. Pas de configuration. Option **lecture seule** activable par l'admin (cas du dirigeant qui consulte sans agir). |
| **Manager** (`manager`) | une ou plusieurs entités | Affecter un contact à un membre de son équipe (ce que le conseiller ne peut pas), transférer, reprendre ; agir aussi comme un conseiller dans ses entités. |
| **Conseiller** (`advisor`) | une ou plusieurs entités | Prendre un contact et le suivre, prendre la main sur la conversation (droits consommés par les chantiers suivants). |

Plateforme : `super_admin` reste l'opérateur WABAGENT. Il accède à toute organisation avec les droits d'un admin et choisit l'organisation active comme les autres utilisateurs.

**Droits effectifs dans ce chantier** (les actions sur les contacts arrivent au chantier suivant) :

| Action | Admin | Super manager | Manager | Conseiller |
|---|---|---|---|---|
| Voir agents IA, Vue d'ensemble, Usage & coûts, leads (visibilité « tout le monde voit tout ») | oui | oui | oui | oui |
| Utiliser le simulateur gratuit | oui | oui (sauf lecture seule) | oui | oui |
| Créer ou modifier un agent IA, ses numéros, son statut, ses connexions | oui | non | non | non |
| Gérer entités, utilisateurs, invitations, réglages | oui | non | non | non |
| Lire le journal d'audit | oui | non | non | non |

Choix du rédacteur : la configuration des agents IA reste réservée à l'admin, ce qui reproduit le comportement actuel (tous les utilisateurs actuels sont admins) sans élargir les droits.

**Invariants**

- Retirer ou suspendre le dernier admin actif d'une organisation est refusé. (Une organisation qui vient d'être créée par le super admin n'a pas encore d'admin tant que la première invitation n'est pas acceptée : c'est normal.)
- La lecture seule bloque toute écriture, y compris le simulateur ; elle n'existe que sur un super manager.
- Une appartenance d'entité référence une entité de la même organisation.
- Un admin d'organisation ne peut jamais attribuer le rôle plateforme `super_admin`.

## 5. Modèle de données

SQLite et Postgres, même patron que l'existant (tables créées au démarrage, colonnes ajoutées par ensure-column idempotent, upsert UPDATE puis INSERT).

**Nouvelles tables**

- `agencies` : `agency_id` (clé), `name`, `created_at`. Aucune API ni UI dans ce chantier.
- `entities` : `id`, `client_id`, `name`, `status` (`active` | `archived`), `created_at`, `updated_at`. Nom unique par organisation parmi les entités actives. Une entité qui porte encore des agents IA **ou des membres actifs** ne peut pas être archivée : l'admin les déplace d'abord (choix du rédacteur : refus explicite plutôt que perte d'accès silencieuse d'un conseiller).
- `memberships` : `id`, `user_id`, `client_id`, `entity_id` (null pour une appartenance d'organisation), `role` (`admin` | `super_manager` | `manager` | `advisor`), `read_only` (booléen, défaut faux), `status` (`active` | `suspended`), `created_at`, `updated_at`. Contraintes : `role` dans `admin`/`super_manager` si et seulement si `entity_id` est null ; une seule ligne par (`user_id`, `client_id`, `entity_id`) ; pour un même (`user_id`, `client_id`), soit une ligne d'organisation, soit des lignes d'entité, jamais les deux.

**Tables modifiées**

- `clients` (= organisations) : ajout `agency_id` (nullable) et `settings` (JSON, voir §6).
- `bots` : ajout `entity_id`. Colonne nullable en base (le patron ensure-column SQLite ne permet pas d'ajouter une colonne NOT NULL sans défaut) ; l'obligation est **applicative** : `BotService`, `config-store.upsertBot` et `scripts/import-config-to-db.ts` rattachent toujours un agent IA à une entité (à défaut, l'entité par défaut de l'organisation). Le routage runtime (1 numéro = 1 agent IA) ne change pas et ne lit pas `entity_id`.
- `users` : `role` ne porte plus que le rôle plateforme : `super_admin` ou `member`. `client_id` n'est plus lu (conservé en base pour la migration, non supprimé). `status` gagne la valeur `disabled` (désactivation globale, réservée au super admin).
- `invitations` : ajout `grants` (JSON : appartenances à créer à l'acceptation, par exemple `[{entity_id: 12, role: "advisor"}]` ou `[{entity_id: null, role: "admin"}]`). `client_id` désigne l'organisation qui invite.

## 6. Réglages d'organisation

Stockés dans `clients.settings`, validés par un schéma Zod partagé avec valeurs par défaut (un `settings` vide vaut les défauts).

| Réglage | Valeurs | Défaut | État dans ce chantier |
|---|---|---|---|
| `visibility` | `all` / `entities` / `own_and_pool` | `all` | Stocké. Seul `all` est sélectionnable ; les deux autres apparaissent dans l'UI comme « bientôt disponible ». |
| `pool_self_claim` | le conseiller peut se servir dans le pool : oui / non | oui | Stocké, consommé par Conversations & Leads. |
| `reassign` | reprendre un contact suivi par un autre : `managers` / `everyone` | `managers` | Idem. |
| `transfer` | transférer vers une autre entité : `managers` / `everyone` | `managers` | Idem. |
| `takeover` | prendre la main sur la conversation : `owner` / `entity_members` | `owner` | Stocké, consommé par Reprise humaine. |

Choix du rédacteur : l'écran Réglages de ce chantier n'affiche que la visibilité. Les quatre règles de gestion apparaissent dans l'UI avec le chantier qui leur donne un effet, pour respecter l'anti-objectif « réglage sans effet ». L'API et le schéma les acceptent dès maintenant.

## 7. Contrôle d'accès

**Jeton.** Le JWT d'accès ne porte plus que `sub` et le rôle plateforme. Il ne porte plus de `client_id`.

**Organisation active.** Chaque appel à l'API admin désigne l'organisation active par l'en-tête `X-Organization-Id`. Le BFF le pose à partir d'un cookie httpOnly `wab_org`. Le paramètre `?client_id` du super admin disparaît. **Repli si l'en-tête manque** (choix du rédacteur, filet de sécurité de déploiement) : si l'utilisateur n'appartient qu'à une seule organisation, elle est prise ; sinon 400 « organisation à préciser ». Le moteur et l'app web sont livrés ensemble, mais un décalage de déploiement ne doit jamais bloquer un admin mono-organisation.

**Résolution par requête.** Un middleware unique remplace `scopeToClient` :

1. vérifie que l'utilisateur est `active` (lecture en base : une désactivation ou une suspension prend effet immédiatement, sans attendre l'expiration du jeton) ;
2. charge ses appartenances actives dans l'organisation demandée (super admin : droits admin implicites) ;
3. refuse par 403 si l'utilisateur n'a aucune appartenance active dans l'organisation demandée ; sinon pose `req.scopedClientId` (nom conservé pour limiter les changements) et `req.access` (rôles, entités, lecture seule).

**Politique centralisée.** Un module unique `src/core/auth/permissions.ts` expose `can(access, action, context?)`. Les routes déclarent l'action requise ; aucune route ne teste un rôle en dur. C'est ce module que les chantiers suivants étendront (actions sur les contacts, visibilité restreinte).

Les règles existantes restent : un agent IA d'une autre organisation répond 404 ; toute écriture est auditée (`recordAudit`, best-effort) ; aucun secret n'est renvoyé en clair.

**Compatibilité multi-instance (règle de projet).** WABAGENT doit pouvoir tourner en plusieurs instances Docker derrière un même Postgres (chantier « Infra et déploiement autonome », qui suit celui-ci). Ce chantier n'ajoute donc **aucun état en mémoire** : appartenances, rôles, entités et réglages sont lus en base à chaque requête, sans cache de processus. Si un cache devient nécessaire pour la performance, il devra être invalidé de façon partagée (Postgres `LISTEN/NOTIFY`), pas seulement localement.

**Envoi des e-mails.** Le mailer actuel (`ConsoleMailer`) n'envoie rien : il écrit le lien dans les journaux du serveur, accessibles au seul opérateur. Ce chantier n'affiche **jamais** le lien d'invitation dans l'interface (un admin pourrait sinon activer le compte à la place de l'invité). L'envoi réel par SMTP relève du chantier Infra et doit être en place avant toute mise en production avec de vraies organisations.

**État existant non multi-instance.** `config-store.ts` garde déjà agents IA et index des numéros en mémoire, rafraîchis localement. Ce chantier ne l'aggrave pas (`entity_id` n'est pas lu à l'exécution) ; sa correction relève du chantier Infra.

## 8. API (préfixe `/api/admin/v1`, organisation active par en-tête)

- `GET /auth/me` : utilisateur, rôle plateforme, et liste de ses organisations (`client_id`, nom, rôle résumé). Super admin : toutes les organisations.
- `GET /entities`, `POST /entities`, `PATCH /entities/:id` (nom, archivage) : admin.
- `PATCH /bots/:botId` accepte `entity_id` (déplacer un agent IA d'entité) ; `POST /bots` exige `entity_id` si l'organisation a plusieurs entités, sinon prend l'unique entité : admin.
- `GET /users` : membres de l'organisation avec leurs appartenances et leur statut ; invitations en attente : admin.
- `POST /invitations` (email + `grants`), `DELETE /invitations/:id` : admin. Règles (choix du rédacteur) :
  - l'adresse e-mail est l'identité : un seul compte par e-mail sur la plateforme ;
  - utilisateur déjà actif (membre d'une autre organisation) : les appartenances sont créées directement, un e-mail d'information est envoyé, pas d'acceptation. L'admin voit donc que l'adresse avait déjà un compte : fuite d'information jugée acceptable en contexte B2B ;
  - utilisateur encore `invited` par une autre organisation : une nouvelle invitation est créée (plus de conflit). À la première acceptation, quel que soit le lien utilisé, l'utilisateur devient actif et **toutes ses invitations valides en attente** sont appliquées (la possession de l'adresse est prouvée une fois) ;
  - les invitations restent stockées sous forme de hash ; un lien perdu se remplace par « renvoyer l'invitation » (nouveau jeton, ancien invalidé).
- `PUT /users/:userId/memberships` (remplace les appartenances de l'utilisateur dans l'organisation ; l'option lecture seule est portée par l'appartenance super manager), `PATCH /users/:userId` (suspension ou réactivation dans l'organisation) : admin. La suspension ne touche que cette organisation.
- `GET /settings`, `PATCH /settings` : lecture par tous les membres, écriture admin.
- Super admin uniquement : routes `clients` existantes (organisations), invitation du premier admin d'une organisation, désactivation globale d'un utilisateur (`status = disabled`, révocation de toutes ses sessions : item différé depuis le Plan 3). **Pas d'écran super admin** dans ce chantier (la gestion des organisations clientes est l'outil séparé « console agence ») : un script `scripts/create-organization.ts` (organisation + entité par défaut + invitation du premier admin) sert à l'exploitation en attendant.

Contrats Zod correspondants dans `packages/contracts`.

**Parcours d'invitation (décision François, 7 nov. 2026 : clarifié).** On n'envoie **jamais d'identifiants** (ni mot de passe, ni mot de passe provisoire). L'invité reçoit un **lien à usage unique** valable 7 jours (`ADMIN_INVITE_TTL_DAYS`, mécanisme existant du Plan 3, jeton stocké haché) ; il clique, arrive sur la page d'acceptation, **choisit lui-même son mot de passe**, et son compte est actif. Un lien expiré ou perdu se remplace par « renvoyer l'invitation ». Un utilisateur déjà actif n'a rien à créer : il reçoit un e-mail l'informant de son nouvel accès et se connecte avec son mot de passe habituel. La connexion sans mot de passe (lien magique à chaque connexion) est hors périmètre.

**Connexions WhatsApp et CRM.** Elles restent configurées **par agent IA**, avec repli sur l'organisation pour les identifiants partagés (cas courant : un compte WhatsApp Business par organisation, un numéro par agent IA). Réservées à l'admin. Aucun niveau entité. L'écran Connexions et le choix du mode de raccordement (API Meta directe, BSP, Embedded Signup) relèvent du chantier Connexions et mise en ligne.

## 9. App web

- **Sélecteur d'organisation** dans le bandeau émeraude, visible seulement si l'utilisateur a plusieurs organisations (toujours pour le super admin). Le choix est mémorisé dans `wab_org`. À la connexion : une seule organisation, sélection automatique ; plusieurs, dernière utilisée, sinon la première.
- **Espace Organisation**, entrée de navigation globale visible par l'admin (remplace « Paramètres », grisé aujourd'hui), avec rail latéral comme l'espace agent IA : **Entités** (liste, création, renommage, archivage, agents IA rattachés), **Utilisateurs** (liste, invitation avec choix du rôle et des entités, modification, lecture seule pour un super manager, suspension), **Réglages** (visibilité).
- **Agents IA** : colonne et filtre « Entité » dans le tableau quand l'organisation en a plusieurs ; choix de l'entité à la première étape de l'assistant de création (masqué s'il n'y en a qu'une).
- Les actions non permises ne sont pas affichées (le moteur les refuse de toute façon).
- **Maquettes à valider par François avant l'implémentation UI**, au pixel près sur `marketing/design-reference-emeraude-ambre.html`, sans dégradé, FR et EN.

## 10. Principes révisés

| Principe en place | Révision |
|---|---|
| Deux rôles, `client_admin` lié à un seul client sur la fiche utilisateur | Rôles par périmètre dans `memberships` ; un utilisateur peut appartenir à plusieurs organisations. |
| `client_id` dans le JWT, `?client_id` pour le super admin | Organisation active par en-tête, droits résolus en base à chaque requête. |
| Agent IA rattaché directement à l'organisation | Rattaché à une entité de l'organisation. |
| Seul le super admin invite | L'admin d'organisation invite ; le super admin crée les organisations et leur premier admin. |
| Modèle agence parké en 7c, « Plan 7 = 100 % web » | Fondations multi-organisation dans ce chantier, travail moteur assumé ; console agence = outil séparé. |
| Résolution des clés et correspondances CRM « agent IA puis organisation » | **Inchangée.** Un niveau entité n'est ajouté que si un besoin réel apparaît (par exemple un pipeline CRM par boutique). |

## 11. Migration

Exécutée au démarrage, idempotente. Le moteur n'est déployé nulle part (testé en local uniquement, confirmé par François le 7 nov. 2026) : la migration est testée sur une base SQLite vierge, sur une copie de `store/demo.db` et sur un Postgres local en Docker. Pas de répétition sur données de production :

1. créer les tables et colonnes manquantes ;
2. pour chaque organisation sans entité : créer une entité par défaut portant le nom de l'organisation ;
3. rattacher à cette entité chaque agent IA sans `entity_id` ;
4. pour chaque utilisateur `client_admin` : créer une appartenance `admin` au niveau de son organisation, puis passer son `role` à `member` ;
5. idem pour les invitations `client_admin` en attente : `grants = [{entity_id: null, role: "admin"}]`.

Les jetons émis avant la migration (contenant `client_id`) restent acceptés jusqu'à expiration ; l'organisation vient de l'en-tête, ou du repli mono-organisation. Le BFF pose `wab_org` dès le premier appel. Le compte de démo `demo@wabagent.local` (présent seulement dans `store/demo.db`, organisation `demo-agency`) est migré par l'étape 4 ; il n'y a pas de seed à modifier. Le faux moteur des tests e2e (`apps/web/e2e/mock-engine.ts`) est aligné sur le nouveau format de `/auth/me`.

## 12. Vérification

- Tests unitaires moteur : politique `can()` (matrice §4 complète, lecture seule, dernier admin), migration (bases vierge et préexistante), services entités, utilisateurs, invitations, réglages.
- Tests d'API : isolation entre organisations (un admin de A n'atteint jamais B), en-tête absent ou organisation non membre (403), utilisateur suspendu ou désactivé (refus immédiat).
- Tests web et e2e Playwright : sélecteur d'organisation, invitation puis acceptation, création d'entité puis d'agent IA rattaché, masquage des actions selon le rôle.
- **Test en live** (engine + web lancés) avant de déclarer livré : connexion d'un admin migré, d'un super admin avec sélecteur, d'un conseiller invité.

## 13. Laissé au builder

Découpage en tâches et en sous-plans éventuels ; structure exacte des fichiers ; forme précise des réponses d'API dans le respect des contrats ; textes d'interface (FR et EN) dans le ton existant ; index de base de données.
