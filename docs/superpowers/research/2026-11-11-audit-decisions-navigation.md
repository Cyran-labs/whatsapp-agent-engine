# Audit des décisions du lot « Refonte de la navigation »

Date : 11 novembre 2026. Branche : `feat/refonte-navigation`. Auditeur neuf, sans accès aux justifications du contrôleur.

Tableau audité : `docs/superpowers/research/2026-11-11-registre-decisions-navigation.md`, décisions 1 à 148 (F-1 à F-5 exclues, ce sont les décisions de François).

Sources d'autorité lues : spec du lot (`docs/superpowers/specs/2026-11-10-refonte-navigation-design.md`, dite « spec »), `CLAUDE.md`, spec « Comptes et équipes » (dite « spec comptes »), spec 2b, maquettes `navigation-rail-seul.html` et `assistant-rail.html`, code de la branche.

## Résumé chiffré

| Verdict | Nombre | Numéros |
|---|---|---|
| Conformes | 133 | liste en fin de document |
| Discutables | 6 | 42, 59, 90, 91, 122, 140 |
| Contraires à une source | 5 | 3, 10, 14, 67, 131 |
| Reposent sur un fait faux | 1 | 86 |
| Revenaient à François | 3 | 92, 114, 125 |
| Total | 148 | |

En une phrase : aucune décision ne touche à l'isolation entre organisations ni ne fait fuir une donnée ; les écarts sont des textes et des comportements d'écran que la spec fixait autrement, ou que la spec ne tranchait pas et qui changent ce que vous verrez.

## Décisions contraires à une source

### 3. Format du masque d'un numéro de contact

**Ce que l'utilisateur voit.** Un conseiller qui n'a pas le droit de voir un numéro de contact lit `+336 •• •• •• 78` (3 premiers chiffres et 2 derniers) au lieu de `+33612 •• •• 78` (5 premiers chiffres et 2 derniers).

**Source.** Spec 9.2 : « Fonction de masquage unique dans les contrats (reprise de `apps/web/src/lib/mask-number.ts:2` : « + » et cinq premiers chiffres, puis « •• •• » et les deux derniers ; un identifiant qui n'est pas un numéro E.164 est masqué sans jamais être renvoyé en entier, format laissé au constructeur) ». La spec 18 ne laisse au constructeur que le format d'un identifiant qui n'est pas un numéro. Le code (`packages/contracts/src/contact-mask.ts`) applique le nouveau format.

**Recommandation.** Garder le nouveau format, qui protège mieux : avec l'ancien, un numéro français de 11 chiffres ne cachait que 4 chiffres, soit 10 000 possibilités, ce qui se devine. Mais c'est un changement de règle écrite : à valider par vous, puis corriger la spec 9.2.

### 10. Titre de fin de l'assistant après activation

**Ce que l'utilisateur voit.** Après « Activer », l'écran de fin titre « {nom} est Online » ou « {nom} est en Preview » (`fr.json`, `liveTitleActive` et `liveTitleLimited`).

**Source.** Spec 12.3 : « après activation, le titre actuel « {nom} est en ligne » reste ». La spec 12.1 donne, pour l'encadré d'état de la colonne (pas pour le titre), « ✓ {nom} est Online » ou « … est en Preview ».

**Recommandation.** Garder le nouveau titre : « est en ligne » pour un agent IA en Preview serait faux (il ne répond qu'à la Whitelist) et contredit le vocabulaire de la spec 6.3. La spec se contredit elle-même ; c'est à vous de trancher, puis corriger la spec 12.3.

### 14. Phrase du refus sur place

**Ce que l'utilisateur voit.** « Cette page de l'organisation Acme est réservée aux administrateurs. »

**Source.** Spec 10.6 : phrase « Cette page de {Org} est réservée aux administrateurs. ».

**Recommandation.** Garder : « de l'organisation » évite « de Acme » (élision manquante) et nomme clairement l'organisation. Écart de texte mineur, à valider en recette.

### 67. Encart « Whitelist vide » calculé par l'écran

**Ce que l'utilisateur voit.** Un agent IA en Preview, Whitelist vide, sur un compte WhatsApp en erreur : la page montre l'encadré rouge « Ne répond pas : compte WhatsApp en erreur » et, en dessous, l'encart ambre « Whitelist vide » avec son bouton d'ajout. Deux encarts pour deux problèmes.

**Source.** Spec 7.2 : « L'encart Statut de la page de l'agent IA (`status-panel.tsx:107` à `111`) et l'encart de whitelist vide (`status-panel.tsx:98`) lisent ce champ au lieu de leur calcul local. » Le code (`apps/web/src/components/agent/status-panel.tsx`, ligne 114) calcule l'encart ambre à partir du statut et de la longueur de la liste, pas du champ `not_responding` du moteur.

**Recommandation.** L'effet est utile (l'admin voit les deux choses à réparer) et la mention rouge reste bien celle du moteur. Mais la règle écrite dit le contraire. Soit vous validez et la spec 7.2 est amendée (« l'encart Whitelist vide peut s'ajouter à la mention quand la mention porte une autre cause »), soit l'encart ambre disparaît dans ce cas.

### 131. Bouton d'activation d'un numéro de test

**Ce que l'utilisateur voit.** À l'étape 5 de l'assistant, avec un numéro de test, le bouton dit « Activer et passer Online ».

**Source.** Spec 12.3 : « bouton « Activer et ouvrir à tous » » ; repris en spec 19 n° 34 et dans la maquette `assistant-rail.html` (ligne 572).

**Recommandation.** Le nouveau libellé est cohérent avec le mot Online utilisé partout ailleurs, mais « ouvrir à tous » disait l'effet en clair (tout contact reçoit une réponse). À vous de choisir ; si vous gardez « passer Online », corriger la spec 12.3 et le n° 34 de la section 19.

## Décision qui repose sur un fait faux

### 86. « Admin en lecture seule » dans l'encadré « Ne répond pas »

**Ce que l'utilisateur voit.** Rien de différent en pratique : le cas visé n'existe pas.

**Fait vérifié.** La spec comptes, ligne 85 : « La lecture seule bloque toute écriture, y compris le simulateur ; elle n'existe que sur un super manager. » Le moteur l'applique : `src/core/services/user-admin-service.ts:80` refuse `read_only` sur un autre rôle que super manager, `src/core/auth/auth-service.ts:166` et `:324` ne posent `read_only` que pour un super manager, et `can()` (`src/core/auth/permissions.ts`) donne tout à un admin sans regarder la lecture seule. Un admin en lecture seule ne peut donc pas exister.

**Recommandation.** Sans danger, rien à corriger dans le code (la condition `isAdmin && !readOnly` existait déjà sur `main`). Retirer la décision du registre ou la reformuler : « membre sans droit d'écriture (non-admin) : « Prévenez un administrateur… » », ce que la spec 9.3 demande déjà.

## Décisions qui revenaient à François

### 92. « Brancher sur un agent IA » grisé sur un numéro libre d'un compte en erreur

**Ce que l'utilisateur voit.** Dans Connexions, sur un numéro sans agent IA dont le compte WhatsApp est en erreur, « Brancher sur un agent IA » est grisé avec la raison « Le compte WhatsApp de ce numéro n'est pas connecté : un agent IA branché ici ne répondrait pas. ». Même raison pour « Changer d'agent IA ».

**Source.** Spec 10.7 ne grise que « Changer d'agent IA », avec la raison « Le compte WhatsApp de ce numéro n'est pas connecté. ». Le moteur, lui, accepte de brancher un agent IA Draft ou Offline sur ce numéro (commentaire de `apps/web/src/components/connections/number-menu.tsx`, lignes 43 à 45).

**Pourquoi c'est à vous.** Cela retire une possibilité que le moteur offre : préparer le branchement d'un agent IA en Draft pendant qu'on répare le compte. Aucune source ne le tranche.

**Recommandation.** Étape de recette : vous dites si l'admin doit pouvoir brancher un agent IA en Draft sur un compte en erreur. Si oui, ne griser que pour un agent IA en service.

### 114. Fenêtre « Brancher un numéro » de la page de l'agent IA

**Ce que l'utilisateur voit.** Sur la page d'un agent IA, la fenêtre « Brancher un numéro » refuse les numéros d'un compte en erreur (non choisissables) et montre l'avertissement « passera Offline » avant le choix, comme l'assistant.

**Source.** Spec 12.3 pose cette règle pour l'étape 4 de l'assistant seulement. Le registre le dit : « étendue hors assistant ».

**Pourquoi c'est à vous.** Même question que la 92 : l'extension interdit une action que le moteur permet, sur un écran que la spec ne couvrait pas.

**Recommandation.** Trancher en même temps que la 92, en recette. L'avertissement « passera Offline » avant le choix peut être gardé dans tous les cas.

### 125. Saut d'étape par le stepper qui enregistre

**Ce que l'utilisateur voit.** Après la création, si l'utilisateur modifie l'étape 2 puis clique sur l'étape 3, 4 ou 5 du stepper, l'assistant enregistre les modifications sans qu'il ait cliqué « Créer et tester », y compris un champ de lead tapé mais pas encore « Ajouté » (`apps/web/src/components/wizard/wizard.tsx`, lignes 173 à 214).

**Source.** La spec 12.1 et 12.4 ne parlent d'enregistrement qu'à « Créer et tester » ; l'encadré d'état (décision 126) dit lui aussi « « Créer et tester » les enregistre », ce qui devient inexact puisque le stepper enregistre aussi.

**Pourquoi c'est à vous.** C'est un enregistrement implicite que la spec ne prévoit pas, et qui change ce que l'utilisateur croit avoir validé. L'autre choix possible est de demander confirmation ou de refuser le saut tant que des modifications attendent.

**Recommandation.** Étape de recette. Si vous gardez l'enregistrement au saut, ajuster le texte de l'encadré (décision 126) pour qu'il ne dise pas que seul « Créer et tester » enregistre.

## Décisions discutables

### 42 et 140. Mineurs de relecture « laissés en l'état »

Le registre ne dit pas ce que contiennent le mineur 3 de la relecture de la tâche 2 et le mineur 5 de la relecture de la tâche 14. Je ne peux pas les auditer sans ouvrir les rapports de relecture, que je n'ai pas consultés. Recommandation : écrire leur contenu dans le registre pour que vous sachiez ce qui est laissé.

### 59. Entrées grisées annoncées comme des liens

**Ce que l'utilisateur voit.** Rien à l'écran ; un lecteur d'écran annonce « lien, indisponible » sur Leads, Reprise, Aide et les entrées Soon.

**Source.** Spec 5.1 : « Une entrée grisée est `aria-disabled="true"`, n'est pas un lien ». Le code (`apps/web/src/components/shell/coming-soon.tsx`, ligne 156) n'a pas d'adresse (donc ce n'est pas un vrai lien) mais porte `role="link"`.

**Recommandation.** Acceptable : sans rôle, `aria-disabled` n'est pas lu. Le sens de la spec (rien ne se passe au clic, la bulle se lit au clavier) est respecté. À noter seulement.

### 90. Coûts groupés par jour UTC, affichés en jours de Paris

**Ce que l'utilisateur voit.** Dans le graphique « 7 derniers jours » de la Vue d'ensemble, un coût engagé entre minuit et 1 h ou 2 h du matin (heure de Paris) peut tomber sur la barre de la veille.

**Source.** Aucune ne le règle ; c'est un défaut connu laissé en l'état.

**Recommandation.** Petit écart d'affichage, sans risque. Le noter dans les points différés pour qu'il ne soit pas oublié.

### 91. Moyenne « ~{montant}/jour »

**Ce que l'utilisateur voit.** La moyenne par jour est calculée sur les seuls jours où l'agent IA a servi, pas sur la période : un agent IA actif 3 jours sur 30 affiche une moyenne 10 fois plus forte que la dépense réelle moyenne.

**Source.** Comportement antérieur, que la spec ne change pas.

**Recommandation.** Conforme au sens strict (inchangé), mais un admin qui lit « par jour » comprend « par jour de la période ». À vous de dire en recette si la moyenne doit être divisée par la période, ou libellée « par jour d'activité ».

### 122. Bouton Retour du navigateur dans l'assistant

**Ce que l'utilisateur voit.** Dans l'assistant, avec une saisie non enregistrée, le bouton Retour du navigateur quitte sans fenêtre de confirmation : la saisie est perdue. La fermeture de l'onglet et le rechargement, eux, sont retenus (`beforeunload`, `apps/web/src/components/shell/navigation-guard.tsx`).

**Source.** Spec 12.4 : la confirmation est demandée « que si une saisie serait perdue » ; elle énumère rail, colonne, sélecteur et « Quitter », et demande `beforeunload` « si c'est simple, sinon il le note ». Le bouton Retour n'est pas cité, mais il perd une saisie.

**Recommandation.** Le noter comme limite connue (le registre le fait) et le faire valider en recette ; à traiter si vous jugez le cas fréquent.

## Décisions conformes

1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 87, 88, 89, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 115, 116, 117, 118, 119, 120, 121, 123, 124, 126, 127, 128, 129, 130, 132, 133, 134, 135, 136, 137, 138, 139, 141, 142, 143, 144, 145, 146, 147, 148.

Faits vérifiés dans le code pour quelques-unes d'entre elles :
- 1 : `getBotMetrics` (`src/core/database/sqlite.ts:661`) compte les messages depuis la création, sans période ; l'ancien libellé « Messages 30 j » était faux, « Messages » est juste.
- 8 : la page d'usage d'un agent IA avait déjà 30 jours par défaut, en état local, sur `main`.
- 40 : `/auth/me` liste l'opérateur avec `role: 'admin'` (`src/core/auth/auth-service.ts:152`).
- 43 : le moteur écrit bien le numéro dans les données du lead (`saveLead(phone, …, { phone, … })`, `src/core/handler.ts:498`) ; sans masquage de cette copie, le moteur enverrait le numéro en entier, ce que la spec interdit (section 2, anti-objectifs).
- 56 : la maquette `navigation-rail-seul.html` (ligne 61) marque l'entrée active par fond, contour intérieur et gras.
- 57 : la spec 4 donne 236 px pour la colonne existante ; la maquette (250 px) ne fait foi que pour la disposition (spec 20 n° 3).
- 77 : « Brancher un numéro » mène à la page du premier agent IA Draft sans numéro et ne retombe sur Connexions que s'il n'y en a pas (`apps/web/src/lib/onboarding.ts`, `connectTarget`).
- 94 : le moteur refuse de remplacer des identifiants illisibles (409 `whatsapp_account.secrets_unreadable`, `src/core/services/whatsapp-account-service.ts:264`) ; un bouton « Remplacer » serait sans effet.
- 106 et 111 : la lecture seule n'existe que sur un super manager (voir 86) ; ces deux décisions restent justes.
- 124 : la maquette `assistant-rail.html` (lignes 367 à 369) verrouille toutes les étapes à la fin, avec la même bulle.

Remarques sur des conformes qui deviennent des étapes de recette (choix visibles que la spec laissait au constructeur) : textes de la fenêtre de sortie (9), refus anglais (132), textes des confirmations de statut (74), fond clair des pastilles en thème sombre (78), résumé du panneau Santé (82), bulles de l'espace Organisation (97).
