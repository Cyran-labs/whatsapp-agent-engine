# Refonte de la navigation du back-office : design

Date : 10 novembre 2026. Statut : en relecture par François (relue par un constructeur neuf le 10 novembre 2026, réponses intégrées en section 20).

Documents d'appui (ce document ne les répète pas ; en cas d'écart entre une maquette et ce texte, ce texte fait foi) :
- Décisions de François du 10 novembre 2026, consignées pendant la séance de conception (source d'autorité de cette spec). Chaque décision reprise ici porte sa marque : **(F)** décision de François, acquise ; **(C)** choix de Claude, à vérifier par François (liste complète en section 19).
- Maquette de référence : `.superpowers/brainstorm/41277-1794332796/content/navigation-rail-seul.html`.
- Prototype des 22 pages : `.superpowers/brainstorm/41277-1794332796/content/prototype-toutes-pages.html`.
- Maquette de l'assistant : `.superpowers/brainstorm/41277-1794332796/content/assistant-rail.html` (variante A).
- Constats du prototype (grille par page et 18 problèmes) : `.superpowers/brainstorm/41277-1794332796/prototype-constats.md`. Les problèmes sont cités « problème 1 » à « problème 18 ».
- Spec des comptes et équipes : `2026-11-07-comptes-et-equipes-design.md` (rôles, `can()`, §4).
- Spec 2b : `2026-11-08-connexions-whatsapp-2b-design.md` (statuts, accès limité, §8).

Ce qui est affirmé du code actuel vient de la lecture de `main` au commit `fc512c2` ; les points sensibles portent leur référence `fichier:ligne`. Les constats du prototype ont été établis sur la branche `feat/restitution-erreurs`, depuis mergée : quand le code de `main` diffère d'un constat, la spec le dit.

## 1. Intention

Pendant la recette du lot « Restitution des erreurs et vocabulaire », François a jugé que l'interface « n'est pas du tout user friendly » et qu'« on doit comprendre clairement que la page est la page société X ». Deux causes ont été relevées :
- l'organisation n'est pas toujours visible : le sélecteur d'organisation de la barre sombre disparaît dès qu'il ne reste qu'une organisation ouvrable (`apps/web/src/components/shell/org-switcher.tsx:36`), et le titre de la colonne de gauche est tantôt le nom de l'organisation (liste des agents IA, Organisation), tantôt le nom d'un agent IA, tantôt une adresse e-mail ;
- une entité qui porte le nom de la société se confond avec l'organisation : la première entité d'une organisation reçoit le nom de l'organisation (`src/core/database/migrate-accounts.ts:22`).

La refonte remplace la barre sombre du haut par un rail sombre à gauche, garde une colonne blanche au milieu qui commence toujours par l'organisation, et réduit la barre du haut au fil d'Ariane et à l'action principale. Elle en profite pour corriger ce que le prototype a montré : des agents IA muets qui portent la même pastille qu'un agent IA qui marche, des coûts visibles par des conseillers, des numéros masqués de façon incohérente, un vocabulaire de statuts flottant.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. Sur chaque page de l'application connectée (hors pages du compte), l'utilisateur lit le nom de son organisation à deux endroits fixes : en tête de la colonne du milieu et en tête du fil d'Ariane.
2. Une entité n'apparaît jamais à la place de l'organisation : seulement comme élément d'une liste étiquetée « Entité », ou comme attribut (« Entité · Boutique Lyon »).
3. Un agent IA qui ne peut répondre à personne le dit partout où son statut est affiché, avec la même règle que le moteur.
4. Les statuts ont un mot et une couleur, les mêmes sur toutes les pages.
5. Le conseiller ne voit aucun coût, et le moteur le lui refuse.
6. Le numéro d'un agent IA est affiché en entier pour tous ; le numéro d'un contact n'est envoyé en entier par le moteur qu'à qui y a droit.
7. Chaque page a au plus une action principale, dans la barre du haut.
8. Un constructeur peut écrire le plan à partir de cette spec sans revenir vers François.

**Non-objectifs (plus tard)**

- Chantier « Marque et connaissances » (niveaux Organisation, Entité, Agent IA ; base documentaire ; analyse LLM ; rôle « Responsable IA ») : la navigation lui réserve seulement la place (section 16).
- Pages Conversations et leads, Reprise humaine, Personnalité et contenu, CRM : restent à venir, grisées.
- Accueil de l'espace Organisation (problème 17), noms des utilisateurs et liens des entités (problème 18) : section 14.
- Page d'aide : aucune n'existe ; l'entrée Aide est grisée (problème 16).
- Remise à zéro du compteur des messages non servis : non (C, décision du 10 novembre, rappelée).
- Écran de création d'une organisation : il n'en existe pas (création par `scripts/create-organization.ts` ou `POST /clients`, opérateur seulement) ; la spec ne le crée pas.

**Anti-objectifs**

- Une page de l'application connectée (hors compte) sur laquelle l'organisation active n'est pas nommée.
- Une entité affichée dans le bloc Organisation, ou un titre de page qui laisse croire qu'une entité est l'organisation.
- Une pastille « Preview » ou « Online » seule pour un agent IA qui ne répond à personne.
- Une mention « Ne répond pas » calculée par une règle différente de celle du moteur (`src/core/router.ts:42`).
- Un coût affiché à un membre qui n'est pas admin, ou renvoyé par le moteur à ce membre.
- Un numéro de contact masqué seulement à l'écran alors que le moteur l'envoie en entier.
- Un élément d'interface sans effet qui ne le dit pas (entrée Aide, « voir tout », entrées à venir).
- Une redirection silencieuse : un conseiller qui ouvre une adresse réservée lit pourquoi il ne la voit pas.
- Un nom ou un nombre d'une autre organisation dans le sélecteur, le fil d'Ariane ou un compteur.

## 3. Contraintes

- Règles non négociables de `CLAUDE.md` (multi-organisations, journaux, tests HTTP avec `serve`, tests de base de données avec `createTestDatabase()`, suite d'isolation sur SQLite et Postgres).
- Codes moteur inchangés : `draft`, `limited`, `active`, `paused` (`packages/contracts/src/bot-status.ts:7`). Seuls les mots affichés changent.
- Le web ne lit un refus que par `describeFailure` (lot Restitution) ; les nouveaux refus du moteur passent par là.
- La machine d'états et les décisions de branchement restent dans `packages/contracts/src/bot-status.ts` ; la nouvelle règle « Ne répond pas » y vit aussi (section 7), appelée par le moteur.
- Le faux moteur des tests Playwright (`apps/web/e2e/mock-engine.ts`, `mock-state.ts`) reproduit les deux changements moteur (coûts refusés, numéros masqués) et le champ calculé « Ne répond pas ».
- Rien n'est déployé : la migration de la première entité ne renomme aucune entité existante.
- Charte : menthe en accent, pas de dégradé (mémoire de projet « Visual realignment »).
- Textes français avec accents, sans tiret cadratin ni demi-cadratin, « agent IA » jamais seul ; exception actée pour sept mots anglais (section 6.3).

## 4. Termes de cette spec

- **Rail** : la bande sombre, étroite, à gauche de l'écran (nouvelle). Elle porte les espaces et le compte.
- **Colonne du milieu** : la colonne blanche entre le rail et la page. Elle existe déjà : c'est le composant `Rail` actuel (`apps/web/src/components/shell/rail.tsx`, 236 px), utilisé par `OrganisationRail`, `AgentRail`, la liste des agents IA, l'usage et le compte. Le constructeur choisit s'il renomme le composant ; la spec dit « colonne du milieu ».
- **Barre du haut** : la ligne au-dessus de la page, à droite de la colonne du milieu. Elle remplace la barre sombre actuelle (`apps/web/src/components/shell/top-bar.tsx`), qui disparaît.
- **Bloc Organisation** : l'en-tête de la colonne du milieu (libellé « Organisation », monogramme, nom, sous-titre, sélecteur).
- **Espace** : Organisation, Agents IA, Usage et coûts, Compte. Une entrée du rail par espace.
- **Admin** : membre de rôle `admin` dans l'organisation active, ou opérateur WABAGENT (`super_admin`, « Admin implicite »), c'est-à-dire `can()` vrai pour toute action (`src/core/auth/permissions.ts:44`).
- **Conseiller** : dans cette spec, tout membre qui n'est pas admin (super manager, manager, conseiller), sauf mention contraire. Les quatre rôles sont décrits dans la spec des comptes et équipes, §4. Aujourd'hui `can()` donne les mêmes droits aux trois rôles non admin (`permissions.ts:33`), et le web ne distingue que `isAdmin` (`apps/web/src/components/providers/session-provider.tsx:320`) **(C)**.

## 5. Structure

### 5.1 Rail

**(F)** Rail seul à gauche, sombre (fond `brand-deep`, comme la barre actuelle), sans menu déployé. Chaque entrée : une icône et un mot court dessous. L'entrée active est marquée par le fond seul, sans barre menthe à gauche. Aucune pastille dans le rail (ni compteur, ni « New », ni « Soon »). Les entrées à venir sont grisées et disent au survol ce qu'elles apporteront.

En haut, la marque WABAGENT (point menthe et nom), lien vers la liste des agents IA, comme le lien actuel de la barre sombre (`top-bar.tsx:28`).

Ordre, de haut en bas **(F)** :

| Entrée | Mot | Destination | Admin | Conseiller |
|---|---|---|---|---|
| Organisation | Organisation | `/organisation` (renvoie vers Entités) | oui | absente |
| Agents IA | Agents IA | `/` | oui | oui |
| Usage et coûts | Usage | `/usage` | oui | absente **(F)** |
| Conversations et leads | Leads | aucune, grisée | grisée | grisée |
| Reprise humaine | Reprise | aucune, grisée | grisée | grisée |
| (espace) | | | | |
| Aide | Aide | aucune, grisée **(C)** | grisée | grisée |
| Compte | avatar et « Compte » | `/account/organisations` | oui | oui |

- Bulles des entrées grisées (textes du prototype) : Leads « Disponible prochainement : suivi des conversations et des leads. » ; Reprise « Disponible prochainement : un conseiller reprend la conversation. » ; Aide « Disponible prochainement : aide en ligne et contact du support. » **(C)**.
- Une entrée grisée est `aria-disabled="true"`, n'est pas un lien, et montre sa bulle au survol et au focus clavier **(C)**.
- Entrée Compte : initiales de l'adresse (`initialsFromEmail`, comme `user-menu.tsx:50`) dans un rond ; pour l'opérateur, l'étoile actuelle (`user-menu.tsx:51`). C'est un lien direct vers `/account/organisations` : le menu déroulant de l'avatar disparaît **(F, entrée par l'avatar ; C, suppression du menu)**. « Se déconnecter » passe en bas de la colonne du milieu du compte (section 11).
- Entrée active : Organisation pour `/organisation/**` ; Agents IA pour `/`, `/agents/new` et `/agents/:id` (Vue d'ensemble) ; Usage pour `/usage` ; Compte pour `/account/**`. Sur `/agents/:id/usage`, l'entrée active est Agents IA (la page appartient à l'agent IA) **(C)**.
- Sans organisation active (pages du compte ouvertes depuis « Aucune organisation ») : le rail ne montre que la marque, Aide et Compte **(C)**.
- Langue et thème restent dans Préférences ; ils ne sont pas dans le rail.

### 5.2 Colonne du milieu

**(F)** Toute blanche, conservée. Elle commence toujours par le bloc Organisation, sauf sur les pages du compte (section 11). Une entité n'occupe jamais cette place.

**Bloc Organisation**
- Libellé « Organisation » (petites capitales grises), puis monogramme (`monogram()`, `apps/web/src/lib/organizations.ts`), nom de l'organisation active en gras, sous-titre.
- Sous-titre : le rôle dans l'organisation active (`useRoleLabel`, « Admin », « Super manager · lecture seule », « Conseiller », « Admin implicite » pour l'opérateur), suivi de « · N organisations » quand le membre en a plus d'une, suspendues comprises **(C, d'après le prototype)**.
- Sélecteur (problème 2) **(C)** : la flèche ▾ et le menu sont présents dès que `/auth/me` liste plus d'une organisation pour ce membre, suspendues comprises, ou pour l'opérateur. Le contenu du menu est celui du sélecteur actuel (`org-switcher.tsx`) : recherche au-delà de six organisations, organisation suspendue grisée avec la pastille « Suspendue » et le texte `shell.orgSwitcher.suspendedHint`, refus affiché dans le menu, pied « Changer d'organisation ramène à la liste des agents IA. ». Avec une seule organisation, ni flèche ni menu : le bloc est un en-tête fixe.
- Le menu se déroule sous le bloc, dans la colonne ; le reste du comportement (`switchOrg`, un seul changement à la fois, refus) est inchangé.

**Sous le bloc** : le contenu propre à l'espace (section 10). Les éléments de la colonne gardent le modèle du composant actuel : icône ou point de couleur, libellé, compteur gris à droite, squelette pendant le chargement, rien quand la lecture a échoué (`rail.tsx:109`, `organisation-rail.tsx:16`).

**Pastilles** **(F)** : « New » et « Soon », en anglais, gardées pour l'instant dans la colonne du milieu seulement. « Soon » marque une entrée grisée, non cliquable, qui dit au survol ce qu'elle apportera (texte « Disponible prochainement : … »). Elle remplace la pastille actuelle « à venir » (`common.comingSoon`, `rail.tsx:89`). « New » : le composant la prend en charge, mais aucune entrée ne la porte dans ce lot, faute d'entrée nouvelle **(C)** ; sa règle de disparition (après la première visite, ou au bout de 30 jours, hypothèse de la maquette) reste à trancher quand une entrée la portera.

### 5.3 Barre du haut

**(F)** Réduite au fil d'Ariane, à gauche, et à l'action principale, à droite. Fond clair (celui de la page), sans la marque ni le sélecteur, qui sont dans le rail et la colonne.

- Le fil commence par le nom de l'organisation active, lien vers la liste des agents IA. Les segments intermédiaires sont des liens, le dernier est en gras, séparateur « › ». Exception **(F)** : les pages du compte commencent par « Mon compte ».
- L'action principale est un seul bouton (ou un seul groupe, pour le choix de période), décrit page par page en section 10. Une page sans action principale n'a rien à droite.
- Le bandeau d'événement d'organisation (`OrgNoticeBanner`, `apps/web/src/app/[locale]/(app)/layout.tsx:11`) reste au-dessus de la barre du haut et de la page ; le constructeur décide s'il couvre aussi le rail.

### 5.4 Éléments à venir dans les pages (problème 10)

**(C)** Même règle que la colonne : un élément à venir est grisé, porte la pastille « Soon » et une bulle « Disponible prochainement : … ». Elle remplace « à venir » (section CRM de Connexions), « Bientôt » et « Pas encore disponible. » (carte Connexion Meta de Raccorder), « bientôt disponible » (cartes de Réglages), « À venir » (Raccourcis, `overview.editPersonalitySoon`). Le premier lancement de la liste des agents IA ne marque plus « À venir » les étapes « Brancher un numéro » et « Activer l'agent IA », qui existent (`onboarding.comingSoon`).

## 6. Statuts et vocabulaire

### 6.1 Statuts d'un agent IA (F)

| Code | Mot affiché (fr et en) | Sens, phrase à côté de la pastille sur la page de l'agent IA |
|---|---|---|
| `draft` | Draft | « Ne répond à personne, testez-le dans le simulateur. » |
| `limited` | Preview | Répond seulement aux numéros de la whitelist. |
| `active` | Online | Répond à tous les contacts qui lui écrivent. |
| `paused` | Offline | Toujours suivi de son motif (ci-dessous), pour ne pas faire croire à une panne. |
| `unknown` (lecture en échec, `status-pill.tsx:4`) | « Statut inconnu » (fr), « Unknown status » (en) | Inchangé. |

Motifs d'Offline, lus de `bots.status_reason` par `toBotPauseReason` (`packages/contracts/src/bot-status.ts:55`) :
- motif absent (arrêt manuel) : « Arrêté par un administrateur » ;
- `number_removed` : « Numéro retiré » ;
- `number_unassigned` : « Numéro débranché » **(C, mot du motif ; la décision cite « Numéro retiré… » en exemple)** ;
- motif inconnu : « Arrêté » seul, jamais le code brut **(C)**.

Le motif s'affiche à côté de la pastille partout où la pastille Offline apparaît : liste des agents IA, colonne du milieu de l'agent IA, Connexions, page de l'agent IA **(F, « toujours avec son motif »)**. Il faut donc que le résumé de la liste et la vue du numéro portent `status_reason` (section 7.2).

Phrases de l'encart Statut (`agentStatus.description.*`) réécrites avec ces mots ; les libellés d'action (`agentStatus.actions.*`) deviennent **(C)** : « Passer en Preview » (limit), « Repasser en Preview » (resume), « Limiter à la whitelist » (limitAccess), « Passer Online » (open), « Repasser Online » (reopen), « Passer Offline » (deactivate). Les fenêtres de confirmation existantes (`status-panel.tsx:29`) gardent leur rôle, textes réécrits avec ces mots.

### 6.2 Couleurs (C, problème 12, décision du 10 novembre)

Mêmes couleurs partout (pastille, point de la colonne du milieu, Connexions, assistant) :
- Draft : gris neutre (aujourd'hui menthe, `status-pill.tsx:9`) ;
- Offline : gris (aujourd'hui gris en pastille, gris aussi dans la colonne de la liste sur `main`, `apps/web/src/app/[locale]/(app)/page.tsx:26`) ;
- Preview : ambre ;
- Online : menthe (jeton `success` actuel) ;
- mention « Ne répond pas » : rouge (jeton `danger`).
Draft et Offline doivent rester distinguables : le constructeur choisit deux gris (par exemple `surface-subtle` et `muted-2`), ou un contour pour Draft.

### 6.3 Exception aux textes français (F)

Sept mots anglais sont gardés tels quels dans l'interface française : **Draft, Preview, Online, Offline, Whitelist, New, Soon**. Ce sont des noms d'état ou d'étiquette, écrits avec une majuscule, jamais accordés ni conjugués (« passer en Preview », « un agent IA Online »). Dans l'interface anglaise, « Whitelist » se dit « Allowlist » ; les six autres sont identiques. `CLAUDE.md` doit mentionner cette exception dans sa règle des textes français (tâche du plan, soumise à validation de François comme tout changement de `CLAUDE.md`).

### 6.4 Autres termes

- **(F)** La liste d'accès limité devient « Whitelist » partout (titre de l'encart, assistant, raisons, confirmations). Ne jamais dire « numéros de test » pour la whitelist : collision avec le « Numéro de test » Meta de Connexions.
- Raisons des contrats (`TRANSITION_MESSAGES`, `bot-status.ts:28`) : le web les traduit par clé (`agentStatus.reasons.*`), qui suit le nouveau vocabulaire. Les textes français du moteur sont alignés aussi (« Ajoutez au moins un numéro à la whitelist. », « Passez d'abord en Preview : … ») pour qu'aucun texte relayé ne garde l'ancien mot **(C)**.
- Passe de vocabulaire (problème 11, **C**), cas à contrôler dans `fr.json` et `en.json` :
  - « Compte {name} » (`agentNumber.account`) devient « Compte WhatsApp : {name} » ;
  - « Actif » d'une organisation ouvrable (`account.organisations.available`) devient « Active » ; « Organisation active » (`account.organisations.active`) devient « Ouverte » ;
  - « depuis le bandeau » (invitation, compte existant) devient « depuis le bloc Organisation, en haut de la colonne de gauche » ;
  - « Usage & coûts » devient « Usage et coûts » partout (`nav.usage`, `usage.title`, `usage.rail.kicker`, `agentSpace.usage`) ; de même « Conversations & Leads » devient « Conversations et leads », « Personnalité & contenu » devient « Personnalité et contenu », « Créer & tester » devient « Créer et tester » ;
  - tokens : « tokens d'entrée » et « tokens de sortie » partout (tableau, indicateur, carte de coût) ;
  - Connexions : menu « Retirer le compte » (au lieu de « Retirer de WABAGENT »), bouton de confirmation identique ;
  - invitation d'un compte neuf : titre « Activez votre compte », bouton « Activer mon compte » ;
  - agent IA : l'entrée à venir « Paramètres » devient « Réglages » (un seul mot pour l'organisation et l'agent IA ; « Préférences » reste réservé au compte).
- Fil d'Ariane et titres d'une liste filtrée par entité : « Entité : {nom} » (section 10).

## 7. Mention « Ne répond pas »

### 7.1 Règle (F, calcul d'après le moteur)

La pastille dit ce que l'administrateur a choisi, la mention dit ce qui se passe. La mention ne s'affiche que pour un agent IA **Preview** (`limited`) ou **Online** (`active`) : Draft et Offline disent déjà qu'il ne répond pas (le moteur les refuse en `bot_inactive`, `src/core/router.ts:60`) **(C, lecture de la décision)**.

Un agent IA Preview ou Online « ne répond pas » quand le moteur refuserait tout message entrant, quel que soit le contact. Les conditions sont celles de `checkRoute` (`src/core/router.ts:42` à `63`), dans le même ordre ; la première vraie donne le motif :

| Ordre | Condition | Référence moteur | Motif | Texte de la mention |
|---|---|---|---|---|
| 1 | aucun numéro branché (`whatsapp_number` nul) | aucune route n'existe sans numéro (`src/webhooks/pipeline.ts`, routage par le numéro destinataire) | `no_number` | « Ne répond pas : aucun numéro » |
| 2 | numéro retiré chez le fournisseur (`provider_state` vaut `removed`) | `router.ts:50` | `number_removed` | « Ne répond pas : numéro retiré » |
| 3 | compte WhatsApp du numéro pas `connected`, état affiché | `router.ts:53` ; état affiché `bot-number-summary.ts:13` | `account_not_connected` | « Ne répond pas : compte WhatsApp en erreur » (état `error`) ou « … non connecté » (état `disconnected`) |
| 4 | organisation pas `active` | `router.ts:56` | `organization_suspended` | « Ne répond pas : organisation suspendue » |
| 5 | Preview et whitelist vide | `router.ts:60` à `62` | `empty_allowlist` | « Ne répond pas : whitelist vide » |

Précisions établies dans le code :
- Condition 3, état affiché : un compte dont les signatures de webhook sont rejetées en série compte comme en erreur (`displayedAccountState`, `bot-number-summary.ts:13` à `18`). Le routeur ne lit que l'état stocké (`router.ts:53`), mais ces messages sont refusés avant le routage, par l'authentification du webhook (règle de `CLAUDE.md`) : aucun n'est servi. La règle utilise donc l'état affiché, celui que le moteur expose déjà dans `BotNumberSummary.account.state`.
- Conditions 1 et 2 : le moteur met en pause un agent IA en service qui perd son numéro ou dont le numéro est retiré (`BOT_PAUSE_REASONS`, `bot-status.ts:39` à `51`), donc ces cas devraient être rares pour un agent IA Preview ou Online (par exemple entre le retrait chez Meta et le prochain inventaire). Ils sont gardés dans la règle par défense ; je n'ai pas établi depuis le code qu'ils sont impossibles.
- Condition 4 : jamais visible dans le back-office. Une organisation suspendue ne s'ouvre pas : toute requête de l'API d'administration y est refusée (`src/core/auth/access-service.ts:89`, `session.organization_suspended`). Le motif existe pour que la fonction soit complète et testée contre le routeur.
- Ne sont pas des causes de la mention : les messages non servis d'un agent IA Preview dont la whitelist est remplie (contacts hors liste, `not_allowed`, effet voulu) ; les échecs de remise de Meta (`delivery_failures`), où le moteur répond mais Meta refuse la remise : ils restent signalés dans l'encart Numéro WhatsApp (`number-panel.tsx:91`) **(C)**.

### 7.2 Source unique (C)

- Une fonction pure dans `packages/contracts/src/bot-status.ts`, nommée par exemple `decideResponding(facts)`, renvoie `null` (l'agent IA peut répondre à au moins un contact, ou il est Draft ou Offline) ou un motif de `NOT_RESPONDING_REASONS` (`no_number`, `number_removed`, `account_not_connected`, `organization_suspended`, `empty_allowlist`). Faits : statut, numéro (présent ou retiré, état affiché du compte) ou nul, statut de l'organisation, nombre d'entrées de la whitelist.
- Le moteur la calcule et l'expose ; le web ne la recalcule pas à partir de champs épars. Champs ajoutés :
  - `not_responding: NotRespondingReason | null` sur `BotDetail` (`src/core/services/bot-service.ts:20`, donc `GET /bots` et `GET /bots/:botId`) ;
  - `not_responding` et `status_reason` sur `WhatsAppNumberView.bot` (`packages/contracts/src/whatsapp.ts:151`), pour Connexions ;
  - le BFF `GET /api/bots/summary` (`apps/web/src/app/api/bots/summary/route.ts:26`) relaie `not_responding` et `status_reason` dans `AgentSummaryRow` (`apps/web/src/lib/onboarding.ts:3`).
- L'encart Statut de la page de l'agent IA (`status-panel.tsx:107` à `111`) et l'encart de whitelist vide (`status-panel.tsx:98`) lisent ce champ au lieu de leur calcul local.

### 7.3 Où la mention s'affiche (F)

Mention rouge, texte court « Ne répond pas », à droite de la pastille :
1. liste des agents IA, colonne Statut du tableau ;
2. Connexions, sur la ligne du numéro, à côté de la pastille de l'agent IA branché (le cas « Compte Lyon en erreur, agent IA Accès limité » du problème 1 et de la grille Connexions) ;
3. colonne du milieu, groupe Statut de la liste des agents IA ;
4. colonne du milieu de l'agent IA, sous son nom et sa pastille ;
5. page de l'agent IA, encart Statut, avec la phrase du motif et l'action utile (section 10.3).

Dans la liste et Connexions, la mention porte le motif en bulle au survol ; sur la page de l'agent IA, le motif est écrit **(C)**.

Groupe Statut de la colonne du milieu (liste des agents IA) **(C)** : sous Online, Preview, Offline, Draft, une cinquième entrée « Ne répond pas », point rouge, avec le nombre d'agents IA concernés, affichée seulement si ce nombre est au moins 1. Elle filtre la liste (filtre `not_responding`, ajouté à `apps/web/src/lib/agents-filter.ts`). Les compteurs Preview et Online comptent toujours tous les agents IA de ce statut.

### 7.4 Ce que la mention ne change pas

La machine d'états, les refus de transition et le compteur des messages non servis sont inchangés. La mention est une lecture.

## 8. Numéros (F)

- **Numéro d'un agent IA** : en entier pour tous les membres, partout (c'est le numéro de la société, pas une donnée personnelle). Fin du masquage dans la liste des agents IA (`apps/web/src/components/agents/agents-table.tsx:57`) et dans l'encart Numéro WhatsApp (`number-panel.tsx:65`, prop `seeFull`). Format d'affichage : `formatPhone` (`apps/web/src/lib/whatsapp-display.ts`).
- **Numéro d'un contact** : en entier pour l'admin et pour le conseiller de l'entité de l'agent IA ; masqué partout ailleurs. Le masquage est fait par le moteur (section 9.2) : le web affiche ce qu'il reçoit et ne masque ni ne démasque rien.

Sont des numéros de contact : les entrées de la whitelist (numéros E.164 ou identifiants WhatsApp BSUID, `normalizeAllowlistEntry`, `bot-service.ts:43`) et le champ `phone` des leads et des conversations.

## 9. Droits du conseiller (moteur et web)

### 9.1 Coûts (F)

« Usage et coûts » (organisation et agent IA) est masqué au conseiller, et le moteur le refuse.

**Moteur**
- Nouvelle action `usage.read` dans `src/core/auth/permissions.ts:21`, réservée à l'admin : absente de `MEMBER_ACTIONS` et de `READ_ONLY_ACTIONS`. Un super manager, avec ou sans lecture seule, ne l'a pas **(C, « conseiller » lu comme « tout membre non admin »)**.
- `GET /bots/:botId/usage` (`src/api/admin/routes/dashboard.ts:27`) passe de `requireAction('org.read')` à `requireAction('usage.read')`. Le contrôle des droits précède la lecture de l'agent IA : un non-admin reçoit 403 pour un agent IA de son organisation comme pour un identifiant inconnu, sans indice d'existence.
- C'est la seule route du moteur qui renvoie des coûts : l'usage de l'organisation est une agrégation du BFF (`apps/web/src/app/api/usage/summary/route.ts:17`) ; `/metrics` ne porte que des compteurs de messages et de leads (`src/core/database/types.ts:213`) ; `/health` ne porte que le mode du LLM (`dashboard-service.ts:141`) ; le simulateur ne renvoie pas de coût (vérifié par recherche de `cost` et `usd` dans `simulate-service.ts` et `simulate-chat.tsx`).
- Le refus est le 403 générique (`forbidden()`, `src/api/errors.ts:45`), sans nouvelle clé `error.reason` : le web ne fait jamais cet appel pour un non-admin **(C)**.

**BFF et web**
- `GET /api/usage/summary` : un 403 du moteur sur une ligne rend toute la réponse 403, au lieu d'une ligne « indisponible » (`summary/route.ts:26` attrape aujourd'hui toute erreur) **(C)**.
- `GET /api/bots/[botId]/usage` relaie le 403.
- Rail : entrée Usage absente pour le conseiller. Colonne de l'agent IA : section « Usage et coûts » absente. Vue d'ensemble : carte « Coût LLM » absente et son appel (`apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx:36`) non fait.
- Adresses `/usage` et `/agents/:id/usage` ouvertes par un conseiller : refus sur place (section 10.6).

### 9.2 Numéros des contacts (F, règle appliquée côté moteur)

**Qui voit en entier** : l'admin (dont l'opérateur), et le membre qui a une appartenance d'entité (manager ou conseiller) sur l'entité de l'agent IA (`bots.entity_id`). Le super manager, dont le périmètre couvre toutes les entités (spec des comptes et équipes, §4), voit en entier **(C)**. Tous les autres membres reçoivent les numéros masqués.

**Moteur**
- Fonction pure dans `src/core/auth/permissions.ts`, par exemple `canSeeContactNumbers(access, botEntityId)`, à côté de `can()`.
- Fonction de masquage unique dans les contrats (reprise de `apps/web/src/lib/mask-number.ts:2` : « + » et cinq premiers chiffres, puis « •• •• » et les deux derniers ; un identifiant qui n'est pas un numéro E.164 est masqué sans jamais être renvoyé en entier, format laissé au constructeur).
- Routes qui renvoient des numéros de contact, toutes à traiter :
  - `GET /bots` et `GET /bots/:botId` : `allowlist` (`bot-service.ts:133` à `138`) ;
  - `GET /bots/:botId/leads` : `phone` de chaque lead (`dashboard-service.ts:38`). Pour un membre masqué, le paramètre `search` ne cherche que dans le nom, jamais dans le numéro (`sqlite.ts:446` cherche aujourd'hui `l.name LIKE ? OR l.phone LIKE ?`), sinon la recherche dirait si un numéro est un contact **(C)** ; même règle pour le pilote Postgres ;
  - `GET /bots/:botId/leads/:phone` : refusé (403) à un membre masqué, puisqu'il ne peut pas connaître le numéro en entier et que la réponse le contient avec tout l'historique **(C)**.
- Les réponses des écritures (PATCH, PUT whitelist, activate, branchement) ne vont qu'à l'admin (`bots.configure`) : en entier.
- Limite à écrire dans le plan : `qualified_data` et `transcript` sont du texte libre (un champ « Téléphone » collecté, un numéro tapé dans un message) ; ils ne sont pas masqués par ce lot. Leur traitement relève du chantier Conversations et leads **(C, hors périmètre)**.

**Web**
- Dernières conversations (Vue d'ensemble) et whitelist en lecture seule affichent la valeur reçue. Avec un numéro masqué, l'initiale de la ligne n'est pas tirée du numéro (section 10.3).

### 9.3 Ce que le conseiller voit, en résumé

| Élément | Admin | Conseiller |
|---|---|---|
| Rail : Organisation, Usage | oui | absents |
| Créer un agent IA | oui (sauf lecture seule) | non, refus sur place à `/agents/new` |
| Liste des agents IA | toutes les entités | toutes les entités (réglage « Tout le monde voit tout », `packages/contracts/src/accounts.ts:92`) |
| Numéro de l'agent IA | entier | entier |
| Numéros des contacts | entiers | entiers pour son entité, masqués ailleurs (moteur) |
| Mention « Ne répond pas » | oui, avec l'action | oui, avec « Prévenez un administrateur de votre organisation. » |
| Statut, whitelist, numéro de l'agent IA | modifiables | lecture seule |
| Simuler | oui | oui, sauf super manager en lecture seule (`overview.tsx:69`) |
| Coûts | oui | non (moteur) |

## 10. Pages

Pour chaque page : rail (entrée active), colonne du milieu, fil d'Ariane, action principale, différences pour le conseiller. « Org » désigne le nom de l'organisation active. Les états vides et en erreur existants (grille du prototype) sont conservés sauf mention.

### 10.1 Pages hors session

Connexion, Mot de passe oublié, Nouveau mot de passe, Invitation (compte neuf), Invitation (compte existant) : mise en page centrée actuelle (`AuthCard`), sans rail, sans colonne, sans fil, sans barre du haut. Changements de texte seulement :
- Invitation, compte existant : « depuis le bandeau » remplacé (section 6.4).
- Invitation, compte neuf (problème 14, **C**) : la pastille d'accès « {Rôle} · {Entité} » est montrée comme pour un compte existant (`invitation-flow.tsx:278` l'affiche déjà pour ce cas ; `grants_summary` est dans `InvitationInfo` pour les deux cas, `packages/contracts/src/auth.ts:52`). L'adresse reste masquée (`email_hint`, choix du moteur) avec une phrase : « C'est l'adresse qui a reçu cette invitation ; elle servira d'identifiant. » Titre et bouton unifiés (section 6.4).
- Les autres points de la grille (jauge sans libellé, « Retour à la connexion » qui mène à l'invitation, adresse à retaper) : hors périmètre de la navigation, notés pour la passe de vocabulaire si le constructeur les traite sans risque **(C)**.

### 10.2 Liste des agents IA (`/`)

- **Rail** : Agents IA actif.
- **Colonne** : bloc Organisation ; libellé « Agents IA » ; « Tous les agents IA » (n) ; groupe « Par entité » avec la petite étiquette « Entité » (une entrée par entité active, compteur), affiché comme aujourd'hui ; groupe « Statut » : Online, Preview, Offline, Draft (points colorés, section 6.2), puis « Ne répond pas » (section 7.3). Entités illisibles : « Entités indisponibles · Réessayer » à la place du groupe (inchangé).
- **Fil** : « Org › Agents IA › Tous les agents IA », « Org › Agents IA › Entité : Boutique Lyon », « Org › Agents IA › Statut : Preview », « Org › Agents IA › Ne répond pas » **(C)**.
- **Titre de la page** : « Agents IA » ; filtré par entité, « Entité : Boutique Lyon » (problème du titre sans le mot « Entité ») ; filtré par statut, le mot du statut **(C)**.
- **Action principale** : « + Créer un agent IA » (admin hors lecture seule), vers `/agents/new`, ou `/agents/new?entity=<id>` quand la liste est filtrée par entité (`page.tsx:174`, inchangé).
- **Tableau** : pastille de statut, mention « Ne répond pas », motif d'Offline ; numéro de l'agent IA en entier ; colonnes « Messages 30 j » et « Leads » **(C : la période est celle de la page de l'agent IA, `overview.statMessages` ; à vérifier par le constructeur dans `getBotMetrics` avant d'écrire « 30 j »)**.
- **Bandeau « Mise en route »** : « Brancher un numéro » mène à la page du premier agent IA en Draft sans numéro, où le bouton existe, et non plus à Connexions (problème 8) **(C)**.
- **Premier lancement** (aucun agent IA) et **lecture en échec** : rail et colonne présents, la colonne réduite au bloc Organisation et au libellé « Agents IA » (choix du prototype). Le premier lancement retire « À venir » des étapes qui existent.
- **Conseiller** : pas de bouton de création ; premier lancement : « Aucun agent IA pour le moment. L'administrateur de votre organisation peut en créer un. » (inchangé).

### 10.3 Page d'un agent IA, Vue d'ensemble (`/agents/:id`)

- **Rail** : Agents IA actif.
- **Colonne** : bloc Organisation ; « ‹ Tous les agents IA » ; étiquette « Agent IA » ; nom ; pastille, mention « Ne répond pas » ou motif d'Offline ; ligne « Entité · Siège Paris » (problème 7) **(C)** ; puis les sections de `apps/web/src/components/agent/agent-sections.ts` : Vue d'ensemble, Conversations et leads (Soon), Personnalité et contenu (Soon), CRM (Soon), Usage et coûts (admin seulement), Réglages (Soon). Groupe admin « Organisation » : « Numéros WhatsApp de l'organisation », libellé suivi de « ↗ Connexions » pour dire que le lien change d'espace (problème 8) **(C)**. Lecture en échec : identifiant à la place du nom, « Statut inconnu », pas de ligne Entité (inchangé, `agents/[botId]/layout.tsx:29`).
- **Fil** : « Org › Agents IA › {nom} ».
- **Titre de la page** (problème 7) **(C)** : le nom de l'agent IA en titre, avec dessous « Entité · {nom de l'entité} » et les langues (aujourd'hui la page commence par la ligne des langues seule, `overview.tsx:57` à `66`).
- **Action principale** : « ▶ Simuler » (sorti de la page, `overview.tsx:69` à `77`), absent pour un super manager en lecture seule. « Tester dans le simulateur » est retiré des Raccourcis (problème 9) **(C)**.
- **Encart Statut** : pastille avec la phrase de la section 6.1 (Draft : « Ne répond à personne, testez-le dans le simulateur. »). Si `not_responding` n'est pas nul : encadré rouge avec le motif et l'action (admin : « Remplacer les identifiants » ou « Ouvrir Connexions ↗ » pour un compte en erreur, « Ajouter un numéro à la whitelist » pour une whitelist vide, « Brancher un numéro » sans numéro ; conseiller : « Prévenez un administrateur de votre organisation. »). Avec une whitelist vide, « Passer Online » n'est plus dans l'encadré à côté de « Ajouter un numéro » : il reste dans la rangée des actions de statut, avec sa confirmation, pour que le chemin vers l'ouverture à tous ne soit pas le plus court (grille, page de l'agent IA) **(C)**. Draft sans numéro : une seule ligne de raison sous les boutons grisés quand elles sont identiques (problème 9) **(C)**.
- **Encart Whitelist** (titre « Whitelist ») : la présentation sépare qui reçoit une réponse (« Tant que l'agent IA est en Preview, seuls ces numéros reçoivent une réponse. ») et le mot-clé « reset » (phrase à part, plus petite) **(C)**. Entrées masquées ou entières selon le moteur (section 9.2).
- **Encart Numéro WhatsApp** : numéro en entier pour tous ; « Compte WhatsApp : {nom} » (problème 7). Le reste est inchangé (état du compte, échecs de remise, Changer de numéro, Débrancher pour l'admin).
- **Dernières conversations** (problème 7) **(C)** : dates déjà formatées sur `main` (`recent-conversations.tsx:57`, `parseEngineDate`), le constat de date brute est périmé. Initiales : premières lettres des deux premiers mots du nom ; sans nom, une icône de contact au lieu de chiffres (aujourd'hui `(r.name ?? r.phone).slice(0, 2)`, `recent-conversations.tsx:48`). « voir tout » (`overview.seeAll`, texte inerte) est retiré tant que la page Conversations et leads n'existe pas. La ligne montre le nom ou le numéro reçu du moteur (le dernier message n'est pas dans `/leads`, `agents/[botId]/page.tsx:41`).
- **Carte Coût LLM** (admin seulement) : le graphique montre les 7 derniers jours (`cost-card.tsx:47`) sous l'en-tête « 30 derniers jours » ; l'en-tête du graphique dit « 7 derniers jours » et le montant garde « 30 derniers jours » **(C)**.
- **Conseiller** : pas d'actions de statut, de whitelist ni de numéro (inchangé) ; pas de carte de coût ; pas de groupe Organisation dans la colonne ; numéros des contacts selon le moteur.

### 10.4 Usage d'un agent IA (`/agents/:id/usage`, admin)

- **Rail** : Agents IA actif.
- **Colonne** : celle de l'agent IA, section Usage et coûts active.
- **Fil** : « Org › Agents IA › {nom} › Usage et coûts ».
- **Titre** : « Usage et coûts de {nom} » **(C)**.
- **Action principale** : le choix de période 7 j / 30 j / 90 j (`usage-view.tsx:26`, sorti de la page vers la barre du haut) **(C)**.
- **Conseiller** : refus sur place (section 10.6).

### 10.5 Assistant de création (`/agents/new`, admin)

Section 12.

### 10.6 Refus sur place (problème 5, C)

Aujourd'hui les gardes renvoient sans un mot vers la liste des agents IA (`organisation/layout.tsx:30`, `agents/new/page.tsx:21`) et la page `/forbidden` (`apps/web/src/app/[locale]/forbidden/page.tsx`) n'est atteinte par aucune redirection et n'a aucune issue.

Choix : une adresse réservée ouverte par un membre qui n'y a pas droit affiche, à la même adresse, le cadre normal (rail sans entrée active, colonne du milieu réduite au bloc Organisation) et dans la page : titre « Page réservée aux administrateurs », phrase « Cette page de {Org} est réservée aux administrateurs. », lien « Retour aux agents IA ». Fil : « Org › Accès refusé ». Adresses concernées : `/organisation/**`, `/agents/new`, `/usage`, `/agents/:id/usage`. La page `/forbidden`, orpheline, est supprimée (`public-routes.ts` et `describe-failure.ts` la citent : à vérifier par le constructeur).

### 10.7 Organisation (admin)

Commun aux pages de l'espace :
- **Rail** : Organisation actif.
- **Colonne** : bloc Organisation ; libellé « Organisation » ; Entités (n), Utilisateurs (n), Connexions (n), Réglages, puis « Marque et connaissances » grisé « Soon » (section 16). Connexions porte en plus, quand un compte est en erreur, un point rouge et « 1 en erreur » à droite à la place du compteur gris (problème 17) **(C)**. Compteurs inchangés (`organisation/layout.tsx:36` à `66`).
- **Conseiller** : refus sur place (section 10.6).

Pages :
- **Accueil** (`/organisation`) : renvoie vers Entités (inchangé). Pas d'accueil propre dans ce lot (section 14, problème 17).
- **Entités** : fil « Org › Organisation › Entités » ; action « + Nouvelle entité ». « Archiver… » reste dans le menu quand il ne reste qu'une entité active, grisé avec sa raison (problème 9) **(C)**.
- **Utilisateurs** : fil « Org › Organisation › Utilisateurs » ; action « + Inviter ». Ligne d'invitation : « Renvoyer » n'apparaît qu'une fois (bouton seul, retiré du menu « Gérer ») ; sa propre ligne porte, à la place du menu, « Vous ne pouvez pas modifier vos propres accès. » en gris (problème 9) **(C)**.
- **Connexions** : fil « Org › Organisation › Connexions » ; action « + Raccorder un compte WhatsApp » (cachée quand aucun compte n'existe, le bouton est dans l'encart vide, inchangé). Ligne d'un numéro : pastille de l'agent IA branché, mention « Ne répond pas » et motif d'Offline (section 7.3). Menu d'un numéro d'un compte en erreur : « Changer d'agent IA » grisé avec sa raison (« Le compte WhatsApp de ce numéro n'est pas connecté. ») **(C)**. Bandeau « Le jeton expire dans N jours » : porte le bouton « Remplacer les identifiants » comme le bandeau d'erreur **(C)**. Section CRM : règle Soon (section 5.4).
- **Raccorder un compte WhatsApp** : fil « Org › Organisation › Connexions › Raccorder un compte WhatsApp » ; colonne : Connexions actif ; pas d'action dans la barre du haut (« Annuler » et « Vérifier et raccorder » restent au bas du formulaire). Carte Connexion Meta : règle Soon. Le point « Terminer sans vérifier le secret » est hors périmètre (section 14).
- **Réglages** : fil « Org › Organisation › Réglages » ; pas d'action. La page reste active, elle dit la règle en vigueur (« Tout le monde voit tout ») ; les deux modes indisponibles prennent la règle Soon (problème 17) **(C)**.

### 10.8 Usage et coûts de l'organisation (`/usage`, admin)

- **Rail** : Usage actif.
- **Colonne** : bloc Organisation ; libellé « Usage et coûts » ; « Toute l'organisation » ; groupe « Par entité » avec l'étiquette « Entité ».
- **Fil** : « Org › Usage et coûts › Toute l'organisation » ou « Org › Usage et coûts › Entité : Boutique Lyon ».
- **Titre** : « Usage et coûts : toute l'organisation » ou « Usage et coûts : Entité Boutique Lyon » **(C)**.
- **Action principale** (problème 3) **(C)** : le choix de période 7 j / 30 j / 90 j, 30 j par défaut, la période choisie écrite sous le titre (« 30 derniers jours »). Le BFF transmet déjà `since` (`summary/route.ts:13`) ; la page ne l'envoie pas aujourd'hui (`usage/page.tsx:34` à `45`). Même calcul de date que la page de l'agent IA (`periodStart`, `apps/web/src/lib/period.ts`).
- Un agent IA du tableau ouvre sa page d'usage ; son nom est suivi de « ↗ » et le rail passe sur Agents IA (problème 8) **(C)**.
- **Conseiller** : refus sur place.

## 11. Pages du compte (F)

Organisations, Préférences, Sécurité. Entrée par l'avatar en bas du rail.

- **Rail** : Compte actif.
- **Colonne** : commence par « Mon compte » (libellé) et l'adresse e-mail (avec point de rupture après « @ », `account/layout.tsx:12`), sans bloc Organisation ; entrées Organisations (n), Préférences, Sécurité ; « Se déconnecter » en bas de la colonne, séparé des entrées. Le compteur d'Organisations compte toutes les organisations listées dans le tableau, suspendues comprises (aujourd'hui les ouvrables seulement, `account/layout.tsx:28`) **(C)**.
- **Fil** : « Mon compte › Organisations », « Mon compte › Préférences », « Mon compte › Sécurité ».
- **Action principale** : aucune.
- `/account` renvoie vers Organisations (inchangé).
- **Organisations** : statut « Active » (ouvrable) et « Ouverte » (organisation en cours) ; « Suspendue » inchangé.
- **Préférences** : « Mémorisés sur cet appareil. » placé sous le titre, pour la langue et le thème **(C)**.
- **Sécurité** : inchangé. La jauge de solidité absente ici (grille) est hors périmètre.
- **Sans organisation active** : mêmes pages, même colonne (la décision F supprime le besoin du bloc « Aucune organisation » du prototype) ; le rail n'a que Aide et Compte (section 5.1).

**Page « Aucune organisation »** (`/no-organization`, problème 13) **(C)** : mise en page centrée conservée (hors du groupe `(app)`, `no-organization/page.tsx:10`).
- « Mon compte » mène à `/account/organisations` (aujourd'hui `/account/preferences`, `no-organization/page.tsx:65`).
- Si toutes les organisations suspendues du membre étaient des organisations où il est admin (rôle lu dans `/auth/me`) : « Contactez le support. » seul, au lieu de « Contactez l'administrateur de votre organisation ou le support. ».
- Lecture de la session en échec : message distinct, « Impossible de lire votre session pour le moment. » et « Réessayer », au lieu du texte « Vous n'avez accès à aucune organisation… » (aujourd'hui `read` passe à vrai même en échec, `no-organization/page.tsx:36` à `38`).

## 12. Assistant de création

### 12.1 Cadre (F)

L'assistant garde le rail (Agents IA actif) et la colonne du milieu. Le mode concentré actuel (`agents/new/page.tsx:26`, barre propre « WABAGENT » et « ✕ Quitter », `wizard.tsx` barre de 56 px) disparaît.

- **Colonne** : bloc Organisation ; « ‹ Tous les agents IA » ; titre « Créer un agent IA » ; stepper vertical des 5 étapes (Identité, Personnalité, Tester, Numéro, Activer), chacune avec une ligne de description (« Nom, entité, langues », « Rôle, ton, accueil, informations », « Simulation », « Numéro WhatsApp », « Contrôles et whitelist »). Une étape à venir n'est pas cliquable et dit pourquoi au survol (textes de la maquette, `assistant-rail.html`, `LATER_REASON`). Une étape déjà atteinte est cliquable. Sous le stepper, l'encadré d'état : « Rien n'est enregistré avant « Créer et tester » (étape 2). » avant la création ; « ✓ Draft enregistré : « {nom} » est dans la liste des agents IA, en Draft. Il ne répond à personne tant qu'il n'est pas activé. Vous pouvez quitter : vos réglages sont gardés. » après la création ; « ✓ {nom} est Online » ou « … est en Preview » après l'activation.
- **Fil** : « Org › Agents IA › Créer un agent IA ».
- **Action principale** : « ✕ Quitter », précédé d'une ligne grise qui dit ce que la sortie fait : « Retour à Agents IA : rien n'est enregistré », « Retour à Agents IA : le Draft reste dans la liste », ou « Retour à la liste des agents IA » à la fin.
- Le stepper horizontal actuel (`components/wizard/stepper.tsx`) est remplacé par le stepper vertical.

### 12.2 Champs de personnalité (F, variante C)

**(F)** Champs de prompt agrandis en largeur et en hauteur. **(C)** Variante A de la maquette : champs empilés, pleine largeur, redimensionnables en hauteur ; hauteurs de départ de la maquette : « Objectif principal » sur plusieurs lignes, « Informations clés à connaître » 300 px, mode avancé 320 px, message d'accueil 96 px. Pas de panneau de résumé à droite pour l'instant **(C)**.

Mode avancé libellé « Écrire vos propres instructions (remplace le mode guidé) » **(C)**, au lieu de « Mode avancé : instructions générées (prompt) » et « éditable · écrase le mode guidé pour cette langue ».

### 12.3 Corrections du problème 6 (F)

- Organisation visible : bloc Organisation et fil.
- « Draft enregistré » dès que l'agent IA existe (après « Créer et tester », étape 2).
- Titre de fin adapté : sans activation, « Draft enregistré » au lieu de « Votre agent IA est prêt » (`success.title`) ; après activation, le titre actuel « {nom} est en ligne » reste.
- Compte WhatsApp en erreur signalé dès l'étape 4 : le numéro d'un compte qui n'est pas `connected` est affiché non choisissable, avec sa raison (« Le compte WhatsApp de ce numéro n'est pas connecté. »), au lieu d'être bloqué seulement à l'étape 5.
- Bouton principal de fin « Brancher un numéro » quand aucun numéro n'est branché (décision du lot précédent), vers la page de l'agent IA.
- Avec un numéro de test **(C)** : pas de section Whitelist à l'étape 5 ; une phrase dit que l'agent IA passe Online et que Meta ne laisse écrire que les numéros vérifiés ; bouton « Activer et ouvrir à tous ». Rappel de règle : seul un numéro de test peut passer de Draft à Online directement (`decideTransition`, `bot-status.ts:90`).
- Avec un numéro qui n'est pas de test : section « Whitelist » (au moins une entrée exigée, `decideActivation`, `bot-status.ts:101`), bouton « Activer en Preview ».
- L'avertissement « ce numéro sert déjà {agent IA} en service, qui passera Offline » est visible sur la ligne du numéro avant de la cocher (aujourd'hui après, grille de l'assistant) **(C)**.

### 12.4 Quitter (C)

Une confirmation n'est demandée avant de quitter (clic dans le rail, sur un lien de la colonne, dans le sélecteur d'organisation, ou sur « Quitter ») que si une saisie serait perdue : avant la création (étapes 1 et 2), ou après une modification de l'étape 2 non renvoyée (l'étape 2 renvoie un PATCH à « Créer et tester » quand l'agent IA existe déjà, `step-personality.tsx:88`). Après la création, sans saisie en attente : aucune fenêtre, la ligne de la barre du haut dit déjà que le Draft reste dans la liste. Le constructeur couvre aussi la fermeture de l'onglet si c'est simple (`beforeunload`), sinon il le note.

Changer d'organisation depuis l'assistant ramène à la liste des agents IA de l'autre organisation (règle du sélecteur), après la même confirmation.

## 13. Première entité nommée par l'administrateur (F)

Aujourd'hui `ensureDefaultEntity` crée la première entité avec le nom de l'organisation (`src/core/database/migrate-accounts.ts:17` à `23`), appelée par `AdminService.createClient` (`src/core/auth/admin-service.ts:27`). Les organisations sont créées par l'opérateur (`scripts/create-organization.ts`, ou `POST /clients` réservé à l'opérateur, `src/api/admin/routes/clients.ts:19`), avant que l'admin de l'organisation existe ; aucun écran web ne crée d'organisation.

Choix **(C)** : le nom de la première entité devient une donnée obligatoire de la création.
- `CreateClientInput` (`packages/contracts/src/clients.ts:5`) gagne `first_entity_name` (texte non vide, mêmes règles qu'un nom d'entité créé par l'écran Entités) ; `createClient` crée l'entité avec ce nom.
- `scripts/create-organization.ts` prend un quatrième argument obligatoire « <Nom de la première entité> ». L'opérateur le demande à l'admin avant de créer l'organisation.
- La migration (`migrateAccounts`) garde son comportement pour les organisations anciennes sans entité ; aucune entité existante n'est renommée.
- L'admin peut renommer l'entité depuis Organisation › Entités (« Renommer », existant).

Alternative écartée par ce choix, à confirmer par François : laisser créer l'organisation sans entité et demander à l'admin de nommer la première entité à sa première connexion. Elle colle davantage à « l'administrateur nomme lui-même », mais demande un écran et un état « organisation sans entité » que le moteur refuse aujourd'hui (`resolveEntityForCreate`, `bot-service.ts:150`).

## 14. Réponse aux 18 problèmes du prototype

| N° | Problème | Réponse | Marque |
|---|---|---|---|
| 1 | Agents IA muets avec la pastille « Accès limité » | Mention « Ne répond pas » calculée par le moteur, section 7 | F |
| 2 | Organisation suspendue invisible, sélecteur qui disparaît | Flèche et menu dès qu'il existe une deuxième organisation, suspendue comprise, avec « Suspendue » et sa raison ; sous-titre « · N organisations », section 5.2 | C |
| 3 | Période des coûts de l'organisation non dite | Choix 7 j / 30 j / 90 j dans la barre du haut, 30 j par défaut et écrit, section 10.8 | C |
| 4 | Le conseiller voit tous les coûts | Coûts réservés à l'admin, masqués et refusés par le moteur, section 9.1 | F |
| 5 | Redirections silencieuses, « Accès refusé » orpheline | Refus sur place dans le cadre normal, avec « Retour aux agents IA » ; `/forbidden` supprimée, section 10.6 | C |
| 6 | Assistant sans organisation, qui rassure à tort | Section 12 | F et C |
| 7 | Trous de lecture de la page de l'agent IA | Titre avec nom et entité, ligne Entité dans la colonne, initiales corrigées, « voir tout » retiré, « Compte WhatsApp : », légende du graphique, masquage par le moteur ; dates déjà corrigées sur `main`, section 10.3 | C (masquage : F) |
| 8 | Liens qui changent d'espace sans prévenir | Le changement est gardé mais dit : « ↗ » et destination dans le libellé, le rail suit ; « Brancher un numéro » de la Mise en route mène à la page de l'agent IA, sections 10.2, 10.3, 10.8 | C |
| 9 | Actions en double ou cachées sans raison | Une seule occurrence de chaque action (Simuler, Renvoyer, ligne de raison) ; action indisponible grisée avec sa raison (Archiver, sa propre ligne), sections 10.3 et 10.7 | C |
| 10 | Pastilles « à venir » dans les pages, quatre façons de le dire | Règle Soon partout, « À venir » périmés retirés, section 5.4 | C |
| 11 | Vocabulaire | Passe de vocabulaire, liste de contrôle en section 6.4 | C |
| 12 | Couleurs de statut incohérentes | Section 6.2 | C (décision du 10 novembre) |
| 13 | Page « Aucune organisation » : conseils qui tournent en rond | « Contactez le support » pour un admin, « Mon compte » vers Organisations, erreur de lecture distincte, section 11 | C |
| 14 | Invitation d'un compte neuf sans rôle ni adresse | Rôle et entité montrés ; adresse masquée expliquée (le moteur la masque, inchangé), section 10.1 | C |
| 15 | Numéros masqués de façon incohérente | Numéro de l'agent IA entier pour tous ; contacts selon la règle du moteur, section 8 | F |
| 16 | Entrée « Aide » sans rien derrière | Grisée avec sa bulle, section 5.1 | C |
| 17 | Pages sans action ou sans accueil | Réglages gardée active (elle dit la règle en vigueur), modes indisponibles en Soon ; pas d'accueil Organisation dans ce lot (nouvelle page, hors navigation), mais le compte en erreur est signalé sur l'entrée Connexions de la colonne et sur les agents IA concernés (mention), section 10.7 | C |
| 18 | Utilisateurs sans nom, entités sans lien | Hors périmètre : le modèle n'a pas de nom de personne (adresse seule), et les liens et filtres sont du contenu de page de l'espace Organisation, pas de la navigation. À reprendre dans un lot Organisation | C (hors périmètre) |

Points de la grille non numérotés, hors périmètre de ce lot **(C)** : vérification du secret d'application à la fin du raccordement (Raccorder) ; jauge de solidité absente de Sécurité ; nom « Compte Lyon » qui suggère un lien avec une entité (nom choisi par l'admin) ; « Facturation Meta » toujours en avertissement dans l'assistant (contrôle de 2b-3, à revoir avec ses règles) ; « Plus tard » de l'invitation qui mène à « Aucune organisation » ; « Rendez-vous » sans fonction visible.

## 15. Impact multi-organisation

Ce qui pourrait fuir, répondre à tort ou s'afficher à tort, et le test qui l'empêche. Les tests moteur tournent sur SQLite et Postgres (`createTestDatabase()`), les tests HTTP passent par `serve` ; un test qui protège un point de cette section porte en commentaire son repère (`// nav 15.1`).

**15.1 Mention « Ne répond pas » calculée avec les faits d'une autre organisation.** Le numéro, le compte et le statut d'organisation sont lus par `loadBotNumberSummary` et `getClient` avec le `client_id` de l'agent IA (`bot-number-summary.ts:47` à `51`).
- Test : deux organisations, un compte en erreur dans B ; un agent IA de A sur un compte connecté de A n'a pas la mention, et réciproquement (suite `src/__tests__/isolation/`).
- Test d'équivalence (invariant « même règle que le routeur ») : pour chaque combinaison de faits (statut, numéro nul, présent ou retiré, état du compte, statut de l'organisation, whitelist vide ou non), `decideResponding` renvoie un motif si et seulement si `checkRoute` refuse un contact pris dans la whitelist et un contact hors liste. L'équivalence porte sur les statuts Preview et Online et sur l'état stocké du compte ; trois écarts voulus sont couverts par des cas nommés : Draft et Offline (`checkRoute` refuse, `decideResponding` renvoie `null`, la pastille suffit), l'état affiché du compte (signatures rejetées en série vues comme une erreur alors que l'état stocké est connecté : la mention s'affiche, le routeur sert encore) et l'absence de numéro (`checkRoute` n'est pas appelable, la mention s'affiche). Le test casse si l'on change l'ordre ou une condition d'un côté seulement.

**15.2 Sélecteur d'organisation qui montre une organisation d'un autre membre.** Le menu ne liste que `me.organizations` de `/auth/me`, qui ne contient que les appartenances du membre, suspendues comprises.
- Test web : un membre de A seule ne voit ni flèche ni nom de B ; un membre de A et de B (B suspendue) voit B grisée, non ouvrable.
- Test moteur existant à garder : `/auth/me` ne liste que les organisations du membre.

**15.3 Fil d'Ariane, bloc Organisation et compteurs avec une organisation périmée.** Le nom vient de l'organisation active de la session ; un changement d'organisation dans un autre onglet est déjà détecté (`OrgChangedError`, `apps/web/e2e/two-tabs.spec.ts`).
- Test Playwright : après un changement dans un autre onglet, le bloc et le fil de l'onglet resté ouvert ne montrent jamais l'ancienne organisation avec les données de la nouvelle (la page se recharge, comme aujourd'hui).

**15.4 Assistant qui crée l'agent IA dans la mauvaise organisation.** Le bloc Organisation de l'assistant rend l'organisation visible ; la création part avec l'en-tête d'organisation de la session.
- Test Playwright : organisation changée dans un autre onglet pendant l'étape 2 ; « Créer et tester » n'aboutit pas dans l'autre organisation (refus `OrgChangedError` et rechargement), et le Draft n'apparaît que dans la liste de l'organisation affichée au départ.

**15.5 Coûts visibles par un non-admin.**
- Tests moteur : `GET /bots/:botId/usage` répond 403 à un conseiller, un manager, un super manager, un super manager en lecture seule ; 200 à l'admin et à l'opérateur ; 403 aussi pour un identifiant d'agent IA inconnu ou d'une autre organisation quand l'appelant n'est pas admin (aucun indice d'existence) ; 404 pour l'admin de A sur un agent IA de B (comportement actuel à garder).
- Test BFF : `/api/usage/summary` répond 403 (et non des lignes « indisponible ») quand le moteur refuse.
- Test web : ni entrée Usage, ni section Usage et coûts, ni carte de coût pour un conseiller ; aucun appel à `/usage` émis.

**15.6 Numéros de contacts.** Ce n'est pas une fuite entre organisations, mais une donnée personnelle dans l'organisation ; la règle est appliquée par le moteur.
- Tests moteur, pour `GET /bots`, `GET /bots/:botId`, `GET /bots/:botId/leads` : admin et opérateur en entier ; conseiller et manager de l'entité de l'agent IA en entier ; super manager en entier ; conseiller d'une autre entité masqué ; un numéro masqué ne contient jamais le numéro entier.
- Test moteur : un membre masqué qui cherche (`search`) un numéro de contact entier ou partiel n'obtient aucun résultat par le numéro.
- Test moteur : `GET /bots/:botId/leads/:phone` répond 403 à un membre masqué, 200 à un membre qui voit en entier.
- Test d'isolation existant à garder : un membre de B ne lit aucun agent IA ni lead de A (404).
- Garde des journaux : `npm run check:logs` reste vert ; aucun numéro de contact n'est journalisé par le nouveau code.

**15.7 Première entité créée dans une autre organisation.** L'entité est créée avec le `client_id` de l'organisation créée.
- Test moteur : `POST /clients` avec `first_entity_name` crée l'entité dans cette organisation seulement ; refus 400 sans le champ ; aucune entité d'une autre organisation n'est touchée.

**15.8 Identifiants et envoi.** La refonte ne touche ni le chemin des messages, ni les identifiants, ni les webhooks. Le plan le vérifie : aucun fichier de `src/webhooks/`, `src/transport/`, `src/whatsapp/` ni `src/core/router.ts` n'est modifié, à part l'éventuelle lecture de la règle « Ne répond pas » dans les contrats.

**Revue d'isolation** : comme tout plan (spec 2b, §4.5), une tâche de revue par un relecteur qui ne reçoit pas les conclusions de l'implémenteur, sur le code modifié (permissions, routes du tableau de bord, service des agents IA, vue des numéros, BFF d'usage et de résumé) et sur le code qu'il appelle ou qui l'appelle.

## 16. Place réservée à « Marque et connaissances »

- Colonne du milieu de l'espace Organisation : entrée « Marque et connaissances », grisée, pastille « Soon », bulle « Disponible prochainement : la marque, le ton et la base documentaire de l'organisation, de ses entités et de ses agents IA. » **(C, texte)**. Visible par l'admin seulement (l'espace Organisation l'est déjà).
- Page d'une entité : aucune n'existe aujourd'hui (Entités est une liste, `organisation/entites/page.tsx`) ; l'onglet futur « Marque et connaissances » d'une entité sera posé quand cette page existera. Ce lot n'en crée pas.
- **(F)** Tout ce qui touchera ce chantier sera réservé aux administrateurs ; un rôle « Responsable IA », donné par l'équipe WABAGENT, viendra avec lui. Ce lot n'ajoute ni rôle ni action ; il ne fait rien qui empêche d'ajouter une action `brand.manage` à `can()` plus tard.

## 17. Vérification

- `npm run typecheck`, `npm run typecheck:tests`, `npm test`, `npm run test:pg`, `npm run check:tests`, `npm run check:logs`, `npm test -w @wabagent/web`, suite Playwright sur le faux moteur.
- Tests web à mettre à jour ou à ajouter : rail (entrées par rôle, entrée active par adresse, entrées grisées non cliquables avec bulle au focus), bloc Organisation (une organisation, deux, une suspendue, opérateur), fil d'Ariane de chaque page de la section 10, action principale par page, mention « Ne répond pas » aux cinq endroits, couleurs par statut, numéros (agent IA entier pour un conseiller), refus sur place, assistant (stepper vertical, confirmations de sortie, fin Draft, numéro de test, compte en erreur à l'étape 4).
- Recette en réel avec François (règle de méthode) : chaque choix de Claude visible devient une étape à valider, dans l'ordre des sections ; parcours admin puis conseiller sur deux organisations (dont une suspendue), avec un agent IA par cas de la section 7.1 réalisable en réel (compte en erreur, whitelist vide).

## 18. Laissé au constructeur

- Nommage et découpage des composants (renommer `Rail` en colonne du milieu, nouveau composant de rail, barre du haut), sans changer les comportements décrits.
- Icônes du rail et de la colonne : celles du prototype (⌂, ✦, ▦, 💬, ⇆, ?, avatar) ou leur équivalent `lucide-react` déjà utilisé dans le projet.
- Largeur exacte du rail (84 px dans le prototype) et règles d'affichage sur un écran étroit (le back-office n'a pas de version mobile aujourd'hui ; ne pas en créer une).
- Position et animation de la bulle des entrées grisées, à condition qu'elle soit lisible au clavier.
- Deux gris distinguables pour Draft et Offline (section 6.2).
- Format de masquage d'un identifiant de contact qui n'est pas un numéro E.164.
- Texte anglais (`en.json`) de chaque nouvelle clé, en suivant l'exception de la section 6.3.
- Vérification de la période réelle des compteurs « Messages » et « Leads » (`getBotMetrics`) avant d'écrire « 30 j » dans la liste (section 10.2).
- Ordre des tâches du plan, avec cette contrainte : les deux changements moteur (coûts, masquage) et le champ `not_responding` sont livrés avant les écrans qui les lisent, et le faux moteur les reproduit dans la même tâche.

## 19. Choix de Claude à vérifier par François

1. **Validé par François** : « Conseiller » de vos décisions lu comme « tout membre non admin » : super manager (avec ou sans lecture seule), manager et conseiller n'ont pas les coûts (section 4, 9.1).
2. **Validé par François** : Le super manager voit les numéros des contacts en entier, comme l'admin, parce que son périmètre couvre toutes les entités (9.2).
3. Pour un membre masqué, la recherche des leads ne porte que sur le nom, et le détail d'un lead (`/leads/:phone`) lui est refusé (9.2).
4. Les champs libres des leads (`qualified_data`, historique) ne sont pas masqués dans ce lot (9.2).
5. Refus des coûts par le 403 générique, sans nouvelle clé d'erreur (9.1) ; le BFF de l'usage de l'organisation répond 403 en entier (9.1).
6. Mention « Ne répond pas » seulement pour Preview et Online, pas pour Draft ni Offline (7.1) ; échecs de remise Meta exclus de la mention (7.1).
7. Règle « Ne répond pas » dans une fonction des contrats, calculée par le moteur et exposée en champ `not_responding` (7.2).
8. Entrée « Ne répond pas » avec compteur et filtre dans le groupe Statut de la colonne (7.3).
9. Mention courte dans la liste et Connexions, motif en bulle ; motif écrit sur la page de l'agent IA (7.3).
10. Mot du motif `number_unassigned` : « Numéro débranché » ; motif inconnu : « Arrêté » (6.1).
11. Libellés des actions de statut (« Passer en Preview », « Passer Online », « Passer Offline », « Limiter à la whitelist », « Repasser… ») (6.1).
12. Textes du moteur (`TRANSITION_MESSAGES`) alignés sur le nouveau vocabulaire (6.4).
13. Passe de vocabulaire : « Usage et coûts » sans esperluette partout, « Compte WhatsApp : », « Active » et « Ouverte », « Retirer le compte », « Activez votre compte », « Réglages » pour l'agent IA, tokens d'entrée et de sortie (6.4).
14. Aucune entrée ne porte « New » dans ce lot (5.2).
15. Règle Soon appliquée aussi aux éléments à venir dans les pages (5.4).
16. Entrée Aide grisée avec la bulle « Disponible prochainement : aide en ligne et contact du support. » (5.1).
17. Menu de l'avatar supprimé : l'avatar mène directement au compte (5.1).
18. Rail sans organisation active : marque, Aide et Compte seulement (5.1).
19. Sur `/agents/:id/usage`, l'entrée active du rail est Agents IA (5.1).
20. Sélecteur d'organisation présent dès qu'une deuxième organisation existe, suspendue comprise, pour tous les rôles ; sous-titre « {rôle} · N organisations » (5.2).
21. Refus sur place pour les adresses réservées, page `/forbidden` supprimée (10.6).
22. Fil et titre des listes filtrées : « Entité : … », « Statut : … », « Ne répond pas » (10.2, 10.8).
23. « Messages 30 j » dans la liste, sous réserve de la période réelle (10.2).
24. « Brancher un numéro » de la Mise en route vers la page de l'agent IA (10.2).
25. Page de l'agent IA : titre avec nom et entité, ligne Entité dans la colonne, Simuler seul dans la barre du haut (retiré des Raccourcis), « voir tout » retiré, initiales corrigées, légende « 7 derniers jours » du graphique (10.3).
26. Encadré « Ne répond pas » de la page de l'agent IA avec l'action utile ; « Passer Online » sorti de l'encadré de whitelist vide (10.3).
27. Encart Whitelist : le mot-clé « reset » dans une phrase à part (10.3).
28. Liens qui changent d'espace marqués « ↗ » avec leur destination (10.3, 10.8).
29. Choix de période dans la barre du haut pour les deux pages d'usage (10.4, 10.8) ; titres « Usage et coûts de {nom} », « Usage et coûts : toute l'organisation » (10.4, 10.8).
30. Organisation : point rouge « N en erreur » sur l'entrée Connexions ; « Archiver… » grisé avec sa raison ; « Renvoyer » une seule fois ; phrase sur sa propre ligne ; « Changer d'agent IA » grisé pour un compte en erreur ; bouton sur le bandeau d'expiration du jeton ; Réglages gardée active (10.7).
31. Compteur d'Organisations du compte : toutes les organisations listées (11) ; « Mémorisés sur cet appareil. » sous le titre de Préférences (11).
32. Page « Aucune organisation » : « Contactez le support » pour un admin, « Mon compte » vers Organisations, erreur de lecture distincte (11).
33. Invitation d'un compte neuf : rôle et entité montrés, adresse masquée expliquée (10.1).
34. Assistant : variante A, sans panneau de résumé ; libellé du mode avancé ; numéro de test sans whitelist avec « Activer et ouvrir à tous » ; confirmation de sortie seulement si une saisie serait perdue ; avertissement du numéro en service visible avant de le cocher (12).
35. **Validé par François** : Première entité : `first_entity_name` obligatoire à la création de l'organisation (API et script), au lieu d'une saisie par l'admin à sa première connexion (13).
36. Texte de la bulle « Marque et connaissances » (16).
37. Problème 18 et points non numérotés de la grille renvoyés hors périmètre (14).

## 20. Réponses à la relecture du constructeur (10 novembre 2026)

1. Choix de Claude : les n° 1 (coûts réservés à l'administrateur, super manager compris), 2 (numéros des contacts en entier pour le super manager) et 35 (nom de la première entité donné par l'équipe WABAGENT à la création de l'organisation, `first_entity_name` obligatoire sur `POST /clients` et dans le script) sont validés par François. Les autres choix de la section 19 sont acquis pour le plan ; François les relit avec ce document, et un rejet de sa part devient une correction du plan avant exécution. Chacun reste une étape de la recette guidée (règle d'audit des décisions de `CLAUDE.md`).
2. Test d'équivalence de la section 15.1 : restreint à Preview et Online sur l'état stocké, avec les trois écarts nommés écrits en 15.1 (choix de Claude). La règle de la mention garde l'état affiché du compte.
3. Maquettes et texte : ce texte fait foi ; les maquettes donnent la disposition et l'aspect. La charte (couleurs, typographies, espacements définis dans les jetons du thème) est respectée au pixel ; la recette se fait page par page sur l'application, avec une capture des pages principales (liste des agents IA, page d'un agent IA, assistant, Connexions, une page du compte) comparée à la maquette, et non par comparaison automatique au pixel de chaque maquette.
