# Recette guidée du lot « Refonte de la navigation »

Date : 11 novembre 2026. Branche `feat/refonte-navigation`. Tâche 17, étape 4 du plan `docs/superpowers/plans/2026-11-10-refonte-navigation.md`. À faire par François en réel, avant la revue finale et le merge.

Ce document reprend, dans l'ordre des sections de la spec (`docs/superpowers/specs/2026-11-10-refonte-navigation-design.md`), parcours administrateur puis parcours conseiller :
- chaque choix de Claude de la section 19 de la spec qui se voit à l'écran (repère « 19-n ») ;
- chaque décision « produit visible » (famille A) du registre `docs/superpowers/research/2026-11-11-registre-decisions-navigation.md` (repère « D-n ») ;
- chaque décision « à François » ou « discutable » de l'audit `docs/superpowers/research/2026-11-11-audit-decisions-navigation.md`, et les quatre décisions contraires à la spec que vous gardez sous réserve de votre accord (D-3, D-10, D-14, D-67) ; le bouton D-131 est revenu au texte de la spec ;
- les points gardés pour la recette pendant l'exécution (registre `.superpowers/sdd/2026-11-10-refonte-navigation/progress.md`).

Une case peut porter plusieurs repères quand ils désignent le même comportement. Pour chaque case : où aller, quoi faire, ce qu'on doit voir, et la question quand c'est un choix. Cochez la case si c'est bon ; sinon écrivez « à reprendre » et ce que vous voulez à la place : chaque « à reprendre » deviendra une correction avec son test avant la revue finale.

Les textes entre guillemets sont ceux de `apps/web/messages/fr.json` ; `{nom}` est remplacé à l'écran par la vraie valeur.

## 0. Préparation

### 0.1 Lancer l'environnement

Tout se passe dans une copie jetable : la base `store/demo.db` du dépôt n'est jamais modifiée.

```bash
# Dépôt principal (ne pas y travailler pendant la recette)
REPO=/Users/francoisgreze/www/Cyran-projects/cyran-labs-engine
WT=/tmp/wabagent-recette-nav

# 1. Worktree jetable de la branche
cd "$REPO"
git worktree add --detach "$WT" feat/refonte-navigation
cd "$WT"
npm ci

# 2. Copie de la base (copie cohérente même si un moteur tourne) et des réglages
mkdir -p store
sqlite3 "$REPO/store/demo.db" ".backup '$WT/store/demo.db'"
cp "$REPO/.env" .env
cp "$REPO/apps/web/.env" apps/web/.env

# 3. Moteur (terminal 1, port 3800) : journaux ouverts, liens d'invitation écrits
cd "$WT"
MAILER_LOG_LINKS=true ADMIN_WEB_ORIGIN=http://localhost:3001 npm run dev

# 4. Back-office (terminal 2, port 3001)
cd "$WT/apps/web"
npm run dev
```

Ouvrir http://localhost:3001. Pour finir la recette : arrêter les deux processus, puis `cd "$REPO" && git worktree remove --force "$WT"`.

Ce que la copie contient au départ (base lue le 11 novembre 2026) : l'organisation « Agence Démo » (`demo-agency`) avec une entité, l'agent IA « Support technique » et 12 leads ; l'opérateur `admin@wabagent.local` et l'admin `demo@wabagent.local`. Au premier lancement, le moteur applique les migrations du lot 2b : « Support technique » repasse en Draft et n'a plus de numéro, et aucun compte WhatsApp n'est raccordé (journal `[DB] … repassé(s) en brouillon`). C'est attendu.

Les commandes SQL de ce document se lancent dans un troisième terminal, depuis `$WT`, pendant que le moteur tourne ; le moteur relit tout en base à chaque requête, il suffit de recharger la page.

### 0.2 Comptes et données à préparer

- [ ] Connexion avec `demo@wabagent.local` (votre mot de passe de la base de démo). C'est l'administrateur de tout le parcours admin.
- [ ] Organisation › Connexions › « + Raccorder un compte WhatsApp » : raccorder le compte Meta du portefeuille Ravivo (app WABAGENT Dev), jamais le portefeuille Cyran. Notez combien de numéros apparaissent : la suite dit quoi faire avec un seul numéro.
- [ ] Organisation › Entités › « + Nouvelle entité » : créer « Boutique Lyon ».
- [ ] Organisation › Utilisateurs › « + Inviter » : `conseiller@wabagent.local`, « Certaines entités », Boutique Lyon, rôle Conseiller. Le lien d'invitation est dans le terminal du moteur.
- [ ] Ouvrir ce lien dans une fenêtre privée et créer le compte (spec 10.1, compte neuf, 19-33) : on voit la pastille d'accès « Conseiller · Boutique Lyon », l'adresse masquée avec la phrase « C'est l'adresse qui a reçu cette invitation ; elle servira d'identifiant. », le titre « Activez votre compte » et le bouton « Activer mon compte ». OK ?
- [ ] Deuxième organisation, créée par le script de l'opérateur (spec 13, 19-35, décision de François), dans le troisième terminal :
  ```bash
  cd "$WT"
  MAILER_LOG_LINKS=true ADMIN_WEB_ORIGIN=http://localhost:3001 npx tsx scripts/create-organization.ts atelier-nord "Atelier Nord" demo@wabagent.local "Atelier Nord Paris"
  ```
  Sans le quatrième argument, le script refuse avec son usage. Le lien d'invitation s'écrit dans ce terminal.
- [ ] Ouvrir ce lien connecté en `demo@wabagent.local` (spec 10.1, compte existant) : le texte dit de changer d'organisation « depuis le bloc Organisation, en haut de la colonne de gauche » (plus « depuis le bandeau »). Accepter. OK ?
- [ ] Ouvrir Atelier Nord, Organisation › Entités : la seule entité s'appelle « Atelier Nord Paris », pas « Atelier Nord » (spec 13). Comme c'est la seule entité active, son menu garde « Archiver… », grisé avec sa raison (spec 10.7, 19-30). OK ? Revenir sur Agence Démo.
- [ ] Page de « Support technique » : « Brancher un numéro », choisir le numéro de Ravivo (dit « N1 » plus bas), puis « Passer en Preview » ; Whitelist : ajouter votre téléphone, « Enregistrer ». « Support technique » est en Preview sur N1.

Organisation suspendue : elle est préparée au 5.2, après le test des deux onglets, qui demande deux organisations ouvrables.

## Parcours administrateur (`demo@wabagent.local`, Agence Démo)

## 5. Structure

### 5.1 Rail

Sur la liste des agents IA (`/`).

- [ ] Rail sombre à gauche, de haut en bas : marque WABAGENT (lien vers la liste), Organisation, Agents IA, Usage, Leads, Reprise, puis en bas Aide et Compte. Icônes : immeuble (Organisation), robot (Agents IA), barres (Usage), bulles (Leads), casque (Reprise), point d'interrogation (Aide) ; rail de 84 px (D-7). OK ou préférez-vous d'autres icônes ?
- [ ] Aucune pastille dans le rail, entrée active marquée par le fond seul. Leads, Reprise et Aide sont grisés ; au survol et au clavier (Tab), bulles « Disponible prochainement : suivi des conversations et des leads. », « Disponible prochainement : un conseiller reprend la conversation. », « Disponible prochainement : aide en ligne et contact du support. » ; un clic ne fait rien (19-16). OK ?
- [ ] Entrées grisées au lecteur d'écran (VoiceOver : Cmd+F5) : annoncées « lien, estompé » ou équivalent, la bulle est lue ; Échap la ferme (D-59, discutable dans l'audit : la spec disait « n'est pas un lien », le code garde le rôle de lien pour que l'état « indisponible » soit lu). OK ou préférez-vous qu'elles ne soient pas annoncées comme des liens ?
- [ ] Entrée Compte : rond avec vos initiales, mot « Compte ». Un clic mène directement à « Mon compte › Organisations », sans menu déroulant (19-17). Au lecteur d'écran, son nom est « Compte, demo@wabagent.local » (D-60). OK ?
- [ ] Entrée active par adresse : Organisation sur `/organisation/…`, Agents IA sur `/`, `/agents/new` et la page d'un agent IA, Usage sur `/usage`, Compte sur `/account/…`. Sur la page d'usage d'un agent IA, c'est Agents IA qui est actif (19-19). OK ?
- [ ] Thème sombre (Mon compte › Préférences) : le rail et la colonne du milieu sont proches de teinte (point gardé pour la recette au contrôle de la tâche 5). Lisible ou faut-il plus de contraste entre les deux ?

### 5.2 Colonne du milieu et bloc Organisation

Avec deux organisations ouvrables (Agence Démo et Atelier Nord).

- [ ] Bloc en tête de la colonne : « ORGANISATION », monogramme, « Agence Démo » en gras, sous-titre « Admin · 2 organisations », flèche ▾ (19-20). OK ?
- [ ] Ouvrir le menu, choisir Atelier Nord : on arrive sur la liste des agents IA d'Atelier Nord ; pied du menu « Changer d'organisation ramène à la liste des agents IA. ». Revenir sur Agence Démo.
- [ ] Entrée active de la colonne : fond gris clair, contour intérieur, texte en gras, sans barre menthe (aspect de la maquette, D-56). OK ou préférez-vous une barre menthe ?
- [ ] Deux onglets (D-141, point d'attention 5) : onglet 1 sur Organisation › Entités d'Agence Démo ; onglet 2, passer sur Atelier Nord ; revenir sur l'onglet 1. L'onglet se recharge sur la liste des agents IA d'Atelier Nord, avec le bandeau « Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord. » ; il ne montre jamais les entités d'Agence Démo sous le nom d'Atelier Nord. OK ou préférez-vous que l'onglet reste sur la même page (Entités d'Atelier Nord) ?
- [ ] Repasser les deux onglets sur Agence Démo, puis suspendre Atelier Nord :
  ```bash
  sqlite3 store/demo.db "UPDATE clients SET status='suspended' WHERE client_id='atelier-nord';"
  ```
  Recharger. Le menu montre Atelier Nord grisé, pastille « Suspendue » et « Ne peut pas être ouverte : contactez l'administrateur de l'organisation ou le support. » ; le sous-titre dit toujours « Admin · 2 organisations » (19-20).
- [ ] Ce même menu, avec une organisation suspendue : il paraît serré (point gardé pour la recette au contrôle de la tâche 5). Lisible ou faut-il plus d'espace ?
- [ ] Facultatif, opérateur (`admin@wabagent.local`, fenêtre privée) : sous-titre « Admin implicite · … », étoile à la place des initiales dans le rail.

### 5.3 Barre du haut

- [ ] Sur chaque page : fil d'Ariane à gauche qui commence par « Agence Démo » (lien vers la liste), séparateur « › », dernier segment en gras ; une seule action à droite, ou rien. Le bandeau d'organisation (par exemple celui des deux onglets) passe au-dessus du rail.
- [ ] Moteur arrêté (Ctrl+C dans le terminal 1), sans recharger, cliquer sur « Support technique » dans la liste : la page dit qu'elle n'a pas pu être lue, la barre du haut garde le fil d'Ariane et n'a pas d'action (D-65). Même chose sur Connexions et sur une page d'usage. Relancer le moteur. OK ?
- [ ] Réseau lent (outils du navigateur › Réseau › « 3G lente »), ouvrir la page d'un agent IA : pendant la lecture, le nom de l'agent IA est un squelette gris dans le fil, jamais un lien vide (D-66). OK ?

### 5.4 Éléments à venir dans les pages

- [ ] Partout dans les pages, un élément à venir est grisé avec la pastille « Soon » et une bulle « Disponible prochainement : … » ; plus aucun « à venir », « Bientôt », « bientôt disponible » ni « Pas encore disponible. » (19-15). Vu sur la page d'un agent IA, Connexions, Raccorder et Réglages (cases plus bas). OK ?
- [ ] Aucune entrée ne porte la pastille « New » dans ce lot (19-14).

## 6. Statuts et vocabulaire

### 6.1 et 6.2 Statuts et couleurs

Sur la liste des agents IA, puis la page de « Support technique ».

- [ ] Mots des statuts : Draft, Preview, Online, Offline (codes moteur inchangés).
- [ ] Couleurs : Online menthe, Preview ambre, Draft fond blanc avec contour gris et point en contour seul, Offline fond gris et point gris plein ; Draft et Offline se distinguent (D-6, D-75). OK ou préférez-vous deux autres gris ?
- [ ] Thème sombre : les pastilles Online, Preview, « Ne répond pas » et l'encadré rouge gardent un fond clair (jetons de la charte inchangés, contrastes mesurés ; D-78, point gardé pour la recette). OK ou préférez-vous des pastilles sombres en thème sombre ?
- [ ] Libellés des actions de statut (19-11) : « Passer en Preview », « Repasser en Preview », « Limiter à la Whitelist », « Passer Online », « Repasser Online », « Passer Offline ». OK ?
- [ ] Textes des fenêtres de confirmation (D-74) : « Limiter {nom} à la Whitelist ? » avec « … passera en Preview et ne répondra plus qu'aux numéros de sa Whitelist … » ; « Passer {nom} Offline ? » avec « … vous pourrez le remettre en Preview ou Online. » ; sous un compteur de messages non servis d'un agent IA Offline, « … ce nombre aide à décider de le remettre en service. ». OK ?
- [ ] Motifs d'Offline (19-10) : « Passer Offline » sur Support technique donne « Offline · Arrêté par un administrateur » ; le motif « Numéro débranché » se voit au 12.3. Un motif inconnu s'afficherait « Arrêté » (non reproductible en réel). Remettre Support technique en Preview avec « Repasser en Preview ».

### 6.3 et 6.4 Vocabulaire

- [ ] « Whitelist » avec majuscule partout, y compris en milieu de phrase ; jamais « liste d'accès », « accès limité » ni « numéros de test » pour la Whitelist.
- [ ] Passe de vocabulaire (19-13, D-134) : « Usage et coûts » sans esperluette, « Conversations et leads », « Personnaliser et tester », « Compte WhatsApp : {nom} » dans l'encart Numéro, « {in} tokens d'entrée · {out} tokens de sortie » sur l'usage et la Vue d'ensemble, « Réglages » pour l'agent IA. OK ?
- [ ] Textes du moteur relayés (19-12) : à la page d'un agent IA en Draft sans numéro, la raison « Branchez un numéro WhatsApp avant d'activer l'agent IA. » ; en Preview sans entrée, « Ajoutez au moins un numéro à la Whitelist. ». OK ?
- [ ] Mise en route (bandeau de la liste quand un agent IA est en Draft) : « Votre premier agent IA ne répond encore à personne » et « Activez votre agent IA pour qu'il réponde à vos clients. » (D-133). OK ?
- [ ] Interface en anglais (Mon compte › Préférences › English), puis revenir en français :
  - bulles des éléments à venir qui commencent toutes par « Coming soon: » (D-98) ;
  - statut d'une organisation ouverte « Open » dans Mon compte › Organisations (D-110) ;
  - Whitelist dite « Allowlist », les six autres mots inchangés ;
  - bouton de l'assistant « Create and test » (D-123).
  OK ?

## 7. Mention « Ne répond pas »

Scénario sur « Support technique » (Preview sur N1, votre téléphone en Whitelist). Les cinq endroits de la mention : liste (colonne Statut), colonne de la liste (groupe Statut), Connexions (ligne de N1), colonne de l'agent IA, encart Statut de sa page.

- [ ] Départ : aucune mention nulle part ; la phrase de statut dit « Répond seulement aux numéros de la Whitelist. ».
- [ ] Whitelist vide : sur sa page, retirer votre numéro et « Enregistrer ». Aux cinq endroits, mention rouge « Ne répond pas » à droite de la pastille Preview ; sur la page, encadré rouge « En Preview, il ne répond qu'aux numéros de sa Whitelist, qui est vide : il ne répond à personne. » avec « Ajouter un numéro à la Whitelist » ; « Passer Online » reste dans la rangée des actions de statut, pas dans l'encadré (19-6, 19-26). OK ?
- [ ] Dans la liste et Connexions, la mention est un bouton : un clic ou le survol ouvre la bulle « Ne répond pas : Whitelist vide », même texte que la forme longue ; elle ne fait rien d'autre (19-9, D-72, D-73). OK ?
- [ ] Colonne de la liste, groupe Statut : sous Online, Preview, Offline, Draft, une entrée « Ne répond pas » avec point rouge et compteur 1, qui apparaît à la fin de la lecture avec les autres compteurs ; un clic filtre la liste, fil « Agence Démo › Agents IA › Ne répond pas » (19-8, D-81). Les compteurs ne comptent que les agents IA dont la pastille montre la mention. OK ?
- [ ] Panneau Santé de la page : « ne répond pas : voir l'encart Statut » au lieu de « tout est opérationnel » (D-82). OK ?
- [ ] Compte en erreur, avec la Whitelist toujours vide :
  ```bash
  sqlite3 store/demo.db "UPDATE whatsapp_accounts SET state='error', error_reason='token_invalid', error_detail='Jeton refusé (recette)' WHERE client_id='demo-agency';"
  ```
  Recharger. Bulle de la mention « Ne répond pas : compte WhatsApp en erreur » (le motif du compte passe avant la Whitelist vide, D-68) ; sur la page, encadré rouge « Le compte WhatsApp de son numéro est en erreur : aucun message reçu n'est servi (le motif est dans l'encart Numéro WhatsApp). » avec le lien « Ouvrir Connexions ↗ » vers Connexions, sans second bouton « Remplacer les identifiants » (D-2).
- [ ] Dans ce même cas, sous l'encadré rouge, l'encart ambre « Cet agent IA ne répond à personne : sa Whitelist est vide. » avec « Ajouter un numéro à la Whitelist » reste affiché : deux encarts pour deux problèmes (D-67 ; la spec 7.2 disait de ne lire que la mention, elle est amendée). OK ou préférez-vous un seul encart, celui de la mention ?
- [ ] Phrases des autres motifs de l'encadré (D-88), non reproductibles simplement en réel, à valider sur lecture : « Aucun numéro WhatsApp n'est branché : aucun contact ne peut lui écrire. », « Son numéro a été retiré chez le fournisseur : les messages envoyés à ce numéro ne lui parviennent plus. » (action « Changer de numéro », D-2), « Le compte WhatsApp de son numéro n'est pas connecté : aucun message reçu n'est servi. ». OK ?
- [ ] Remettre en état : Organisation › Connexions › « Gérer » du compte › « Vérifier maintenant » (le compte repasse connecté avec le vrai jeton) ; remettre votre téléphone dans la Whitelist de Support technique et « Enregistrer ». Plus aucune mention.

## 8. Numéros

- [ ] Liste des agents IA et encart Numéro WhatsApp : le numéro de l'agent IA est affiché en entier (format `+33 6 …`). Le masquage des numéros de contacts se vérifie au parcours conseiller.

## 9. Droits

Le côté conseiller se vérifie au parcours conseiller (9.1, 9.2, 9.3). Côté admin :

- [ ] La Whitelist et les numéros des contacts (Dernières conversations) sont en entier pour l'admin.

## 10. Pages

### 10.2 Liste des agents IA

- [ ] Colonne : bloc Organisation, « AGENTS IA », « Tous les agents IA » (n), groupe « Par entité » avec l'étiquette « Entité » (Agence Démo, Boutique Lyon), groupe « Statut ».
- [ ] Fils et titres des listes filtrées (19-22) : « Agence Démo › Agents IA › Tous les agents IA » ; filtré par entité « … › Entité : Boutique Lyon » et titre « Entité : Boutique Lyon » ; filtré par statut « … › Statut : Preview » et titre « Preview ». OK ?
- [ ] Tableau : colonne « Messages » sans « 30 j », car le compteur compte depuis la création de l'agent IA ; même mot « Messages » dans la Vue d'ensemble (19-23, D-1). OK ?
- [ ] Action « + Créer un agent IA » ; filtré par entité, elle ouvre l'assistant avec l'entité choisie.
- [ ] Mise en route avec un agent IA en Draft sans numéro : « Brancher un numéro » mène à la page de cet agent IA, pas à Connexions (19-24). Sans un tel agent IA, le lien porte « ↗ Connexions » et mène à Connexions (D-77). OK ?
- [ ] Liens qui changent d'espace (19-28, D-21) : « Numéros WhatsApp de l'organisation ↗ Connexions » dans la colonne d'un agent IA, « ↗ » derrière le nom d'un agent IA dans le tableau de `/usage` ; le rail suit l'espace d'arrivée. OK ?

### 10.3 Page d'un agent IA

Sur « Support technique ».

- [ ] Colonne : bloc Organisation, « ‹ Tous les agents IA », « AGENT IA », nom, pastille, ligne « Entité · Agence Démo », sections Vue d'ensemble, Conversations et leads (Soon), Personnalité et contenu (Soon), CRM (Soon), Usage et coûts, Réglages (Soon) ; les bulles des Soon : « Disponible prochainement : les conversations et les leads de cet agent IA. », « … modifier la personnalité et le contenu. », « … l'envoi des leads vers votre CRM. », « … les réglages de l'agent IA. » (19-25, D-64). OK ?
- [ ] Titre de la page : le nom, avec dessous « Entité · Agence Démo » et les langues ; action « ▶ Simuler » dans la barre du haut, absente des Raccourcis ; « voir tout » retiré (19-25). OK ?
- [ ] Raccourcis : « Modifier la personnalité » grisé, bulle « Disponible prochainement : modifier la personnalité de cet agent IA. » (D-88). OK ?
- [ ] Dernières conversations : initiales tirées du nom ; un lead sans nom montre une icône de contact, pas deux chiffres (19-25).
- [ ] Encart Whitelist (19-27) : « Tant que l'agent IA est en Preview, seuls ces numéros reçoivent une réponse. », puis en plus petit « Mot-clé « reset » : un contact de la Whitelist qui l'envoie efface sa conversation avec cet agent IA (le lead est conservé), même quand l'agent IA est Online. ». OK ?
- [ ] Draft sans numéro (créer un agent IA de test ou utiliser celui du 12) : sous les actions grisées, une seule ligne de raison quand elles ont toutes la même (D-83). OK ?
- [ ] Carte « Coût LLM » : montant sous « 30 derniers jours », graphique sous « 7 derniers jours », 7 jours calendaires de Paris finissant aujourd'hui, un jour sans appel en barre à zéro (19-25, D-89). OK ?
- [ ] Moyenne « ~{montant}/jour » de la carte et de la page d'usage : elle est divisée par les jours où l'agent IA a servi, pas par la période (D-91, discutable dans l'audit : un agent IA actif 3 jours sur 30 affiche une moyenne 10 fois plus forte que la dépense moyenne). OK, ou préférez-vous diviser par la période, ou écrire « par jour d'activité » ?
- [ ] Coûts groupés par jour UTC dans le moteur, affichés en jours de Paris : un appel entre minuit et 1 h ou 2 h (heure de Paris) peut tomber sur la barre de la veille (D-90, discutable, report déjà accepté au lot précédent). OK de laisser en l'état et de le noter dans les points différés ?

### 10.4 Usage d'un agent IA

Colonne de l'agent IA › « Usage et coûts ».

- [ ] Fil « Agence Démo › Agents IA › Support technique › Usage et coûts », titre « Usage et coûts de Support technique » aligné à gauche avec le fil (19-29, D-101). OK ?
- [ ] Choix de période « 7 j / 30 j / 90 j » dans la barre du haut, 30 j par défaut ; la période n'est pas dans l'adresse : en rechargeant, on revient à 30 j (19-29, D-8). OK ou préférez-vous que la période choisie reste en rechargeant ?
- [ ] En changeant de période, les chiffres repassent en squelette avant les nouveaux (D-102). OK ?

### 10.6 Refus sur place

Vu au parcours conseiller (B.3). Côté admin, voir la case D-105 en fin de section 11.

### 10.7 Organisation

- [ ] Colonne : bloc Organisation, « ORGANISATION », Entités (n), Utilisateurs (n), Connexions (n), Réglages, « Marque et connaissances » grisé Soon avec la bulle « Disponible prochainement : la marque, le ton et la base documentaire de l'organisation, de ses entités et de ses agents IA. » (19-36, D-97). OK ?
- [ ] Compte en erreur (commande SQL du 7) : l'entrée Connexions montre « 1 en erreur » en pastille rouge claire à la place du compteur gris, fond clair aussi en thème sombre (19-30, D-93, D-97). OK ? Remettre le compte avec « Vérifier maintenant ».
- [ ] Entités : fil « Agence Démo › Organisation › Entités », action « + Nouvelle entité » (« Archiver… » grisé sur une entité seule : vu en préparation sur Atelier Nord).
- [ ] Utilisateurs : votre ligne porte « Vous ne pouvez pas modifier vos propres accès. » en gris à la place du menu ; une invitation en attente n'a qu'un bouton « Renvoyer », hors du menu « Gérer » (19-30). OK ?
- [ ] « Renvoyer » : pendant l'envoi, le bouton est indisponible avec la bulle « Envoi en cours », un second clic n'envoie rien ; notification « Invitation renvoyée à {adresse}. » (D-95). OK ?
- [ ] Connexions, ligne de N1 : pastille de l'agent IA branché, sortie du lien de son nom ; la mention et le motif d'Offline y apparaissent comme au 7 (D-71). OK ?
- [ ] « Brancher sur un agent IA » sur un numéro libre : la fenêtre montre, à côté de la pastille d'un agent IA Offline, son motif (D-69). OK ?
- [ ] Compte en erreur (SQL du 7), menu « Gérer » d'un numéro branché : « Changer d'agent IA » grisé avec la raison « Le compte WhatsApp de ce numéro n'est pas connecté : un agent IA branché ici ne répondrait pas. » (19-30). Sur un numéro libre de ce compte (s'il n'y en a pas, débranchez celui d'un agent IA Offline), « Brancher sur un agent IA » est grisé aussi, même raison (D-92, à vous : le moteur, lui, accepte de brancher un agent IA en Draft ou Offline sur ce numéro, par exemple pour préparer le branchement pendant qu'on répare le compte). Faut-il griser pour tout agent IA, ou seulement interdire un agent IA en Preview ou Online ? Remettre le compte avec « Vérifier maintenant ».
- [ ] Bandeau d'expiration du jeton (19-30), facultatif :
  ```bash
  sqlite3 store/demo.db "UPDATE whatsapp_accounts SET token_expiry=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 days') WHERE client_id='demo-agency';"
  ```
  Recharger : « Le jeton expire dans 5 jours. » (ou 4 selon l'heure) avec le bouton « Remplacer les identifiants ». « Vérifier maintenant » remet la vraie date. OK ?
- [ ] Identifiants illisibles : le bandeau n'a pas de bouton « Remplacer les identifiants », il dit « Retirez le compte puis raccordez-le de nouveau. » (D-94). Non reproductible en réel sans casser le compte ; à voir sur le faux moteur (annexe), scénario `account-error-unreadable`. OK ?
- [ ] « Gérer » du compte › « Retirer le compte » : fenêtre « Retirer le compte {nom} ? » et bouton « Retirer le compte » (19-13, D-130). Ne confirmer que si un agent IA est en Preview ou Online sur ce compte (Support technique l'est) : le moteur refuse avec « Mettez d'abord Offline les agents IA qui utilisent ce compte : » suivi de « Support technique », et rien n'est retiré (D-11) ; en anglais « First take Offline the AI agents that use this account: » (D-132). Sinon, Annuler : le retrait effacerait le compte de la copie. OK ?
- [ ] Section CRM de Connexions : grisée Soon, bulle « Disponible prochainement : le raccordement d'un CRM à l'organisation, puis son usage réglé dans chaque agent IA. » (D-97).
- [ ] Raccorder un compte WhatsApp : fil « Agence Démo › Organisation › Connexions › Raccorder un compte WhatsApp », pas d'action en haut ; carte « Connexion Meta » grisée Soon, bulle « Disponible prochainement : le raccordement en un clic avec Facebook. » (D-97).
- [ ] Réglages : page active qui dit la règle en vigueur « Tout le monde voit tout » ; les deux autres modes grisés Soon, bulle « Disponible prochainement : ce mode sera au choix avec Conversations et leads. » (19-30, D-97). OK ?

### 10.8 Usage et coûts de l'organisation

Rail › Usage.

- [ ] Colonne : « USAGE ET COÛTS », « Toute l'organisation », groupe « Par entité ». Fil « Agence Démo › Usage et coûts › Toute l'organisation », titre « Usage et coûts : toute l'organisation » ; filtré, « … › Entité : Boutique Lyon » et « Usage et coûts : Entité Boutique Lyon » (19-22, 19-29). OK ?
- [ ] Période 7 j / 30 j / 90 j dans la barre du haut, 30 j par défaut, période écrite sous le titre (« 30 derniers jours ») ; changement de période en squelette (19-29, D-102).
- [ ] Réseau lent, filtre par entité : le nom de l'entité est un squelette dans le fil et le titre pendant la lecture (D-103). OK ?
- [ ] Entités illisibles : fil « Entité indisponible », titre « Usage et coûts : entité indisponible » (D-104). Non reproductible simplement en réel (il faut que seule la lecture des entités échoue) ; couvert par les tests. OK de valider sur lecture ?

## 11. Pages du compte

- [ ] Colonne : « MON COMPTE », adresse e-mail, Organisations (n), Préférences, Sécurité, « Se déconnecter » en bas, séparé ; pas de bloc Organisation. Fil « Mon compte › Organisations », « Mon compte » est un lien vers Organisations (D-58). OK ?
- [ ] Compteur d'Organisations : 2, Atelier Nord suspendue comprise (19-31). OK ?
- [ ] Tableau des organisations : statuts « Ouverte » (organisation en cours), « Active » (ouvrable), « Suspendue » ; la colonne d'action est vide pour l'organisation ouverte, « Ouvrir → » pour les autres (D-107). OK ?
- [ ] Préférences : « Mémorisés sur cet appareil. » sous le titre (19-31). OK ?
- [ ] Page « Aucune organisation » (19-32, D-111) : suspendre aussi Agence Démo,
  ```bash
  sqlite3 store/demo.db "UPDATE clients SET status='suspended' WHERE client_id='demo-agency';"
  ```
  se reconnecter avec `demo@wabagent.local` : « Agence Démo et Atelier Nord sont suspendues. Contactez le support. » (noms dans l'ordre de la liste ; « Contactez le support. » seul parce que vous êtes admin des deux) ; « Mon compte » mène à Organisations ; le rail n'a que la marque, Aide et Compte (19-18). OK ?
- [ ] Toujours sans organisation ouvrable, taper `/usage` dans l'adresse : on revient sur « Aucune organisation ». Le texte « Cette page est réservée aux administrateurs. » (D-105) est une défense de l'écran de refus qui ne s'atteint pas par la navigation ; à valider sur lecture.
- [ ] Lecture de session en échec (D-108, D-109) : sur « Aucune organisation », arrêter le moteur et recharger : « Impossible de lire votre session pour le moment. » avec « Réessayer » (et non « Vous n'avez accès à aucune organisation… ») ; relancer le moteur, « Réessayer » : pendant la relecture, le bouton reste en place, indisponible, « Lecture en cours. ». OK ?
- [ ] Remettre Agence Démo active :
  ```bash
  sqlite3 store/demo.db "UPDATE clients SET status='active' WHERE client_id='demo-agency';"
  ```

## 12. Assistant de création

Depuis la liste filtrée sur Boutique Lyon : « + Créer un agent IA ».

### 12.1 et 12.2 Cadre et personnalité

- [ ] Rail (Agents IA actif) et colonne gardés : bloc Organisation, « ‹ Tous les agents IA », « Créer un agent IA », stepper vertical Identité, Personnalité, Tester, Numéro, Activer avec leurs lignes « Nom, entité, langues », « Rôle, ton, accueil, informations », « Simulation », « Numéro WhatsApp », « Contrôles et Whitelist » ; fil « Agence Démo › Agents IA › Créer un agent IA » ; à droite « Retour à Agents IA : rien n'est enregistré » et « ✕ Quitter » (19-34). OK ?
- [ ] Étapes à venir : non cliquables, bulle au survol (« Disponible après l'étape Identité : nommez l'agent IA puis « Continuer ». » …) ; au lecteur d'écran, leur état est « pas encore atteinte », en minuscule (D-135, point gardé pour la recette). OK ou préférez-vous « Pas encore atteinte » ?
- [ ] Personnalité (19-34) : champs empilés pleine largeur, redimensionnables en hauteur ; mode avancé « Écrire vos propres instructions (remplace le mode guidé) » ; pas de panneau de résumé. OK ?
- [ ] Encadré d'état : « Rien n'est enregistré avant « Créer et tester » (étape 2). » ; après « Créer et tester », « Draft enregistré » et « « Accueil Lyon » est dans la liste des agents IA, en Draft. … Vous pouvez quitter : vos réglages sont gardés. ».
- [ ] Champ de lead tapé à l'étape 2 sans « Ajouter », aller à l'étape 1 puis revenir : le texte tapé est toujours là (D-129). OK ?

### 12.3 Numéro et activation

Sur N1, branché sur Support technique en Preview.

- [ ] Étape 4 : sur la ligne de N1, avant de la cocher, « Utilisé par Support technique » et l'avertissement qu'il « sera débranché de ce numéro et passera Offline : il ne répondra plus » (19-34). OK ?
- [ ] Étape 5, numéro ordinaire : section « Whitelist » ; ajouter votre téléphone, « Activer en Preview ». Titre de fin « Accueil Lyon est en Preview » (D-10 ; la spec disait « {nom} est en ligne », elle est amendée) ; encadré de la colonne « Accueil Lyon est en Preview ». OK ?
- [ ] Écran de fin : aucune étape du stepper n'est cliquable, bulle « L'assistant est terminé : la suite se règle sur la page de l'agent IA. » ; l'étape 5 n'est cochée que si l'agent IA a été activé ; à droite « Retour à la liste des agents IA » (D-124). OK ?
- [ ] Support technique : « Offline · Numéro débranché » dans la liste, la colonne et sa page (19-10).
- [ ] Numéro de test (D-131, corrigé : retour au texte de la spec 12.3 et de la maquette) : dans Connexions, « Gérer » de N1 › « Marquer comme numéro de test » (ou utiliser le numéro de test Meta s'il est raccordé). Nouvel assistant « Essai test » jusqu'à l'étape 5 sur ce numéro : pas de section Whitelist, phrase « L'agent IA passe Online ; Meta ne laisse écrire que les numéros vérifiés de votre app. », bouton « Activer et ouvrir à tous » (19-34). Ne pas activer : « Laisser en Draft ». Puis « Ce n'est pas un numéro de test » sur N1. OK ?
- [ ] Avec deux numéros seulement (un ordinaire et un de test) : à l'étape 5 avec des entrées en Whitelist, « Changer de numéro » et choisir le numéro de test : la Whitelist tenue par l'assistant est vidée, l'activation l'envoie vide (D-128). OK ?
- [ ] Draft sans activation : titre de fin « Draft enregistré » et bouton principal « Brancher un numéro » vers la page de l'agent IA si aucun numéro n'est branché.
- [ ] Compte en erreur (SQL du 7), nouvel assistant jusqu'à l'étape 4 : la raison « Le compte WhatsApp de ce numéro n'est pas connecté. » s'affiche une fois, sous l'en-tête du compte « Compte en erreur », pas sous chaque numéro ; les numéros de ce compte ne se cochent pas (D-113) ; si aucun numéro n'est utilisable, « Aucun numéro n'est utilisable : le compte WhatsApp n'est pas connecté. Réparez-le dans Connexions, ou choisissez Plus tard. » (D-115). OK ?
- [ ] Même compte en erreur, page d'un agent IA › « Brancher un numéro » (ou « Changer de numéro ») : mêmes règles que l'assistant, numéros du compte en erreur non choisissables, avertissement « passera Offline » visible avant le choix, et « Aucun numéro n'est utilisable : le compte WhatsApp n'est pas connecté. Réparez-le dans Connexions. » (D-114, D-115, à vous : la spec ne posait cette règle que pour l'assistant, et le moteur accepte de brancher un agent IA en Draft ou Offline sur ce numéro). Même question qu'en 10.7 : interdire pour tout agent IA, ou seulement pour un agent IA en service ? Remettre le compte avec « Vérifier maintenant ».

### 12.4 Quitter

Nouvel assistant « Essai sortie », depuis la liste (il restera en Draft dans la copie).

- [ ] Assistant ouvert sans rien toucher : « Quitter » et un clic dans le rail sortent sans fenêtre (19-34).
- [ ] Saisie en attente (nom tapé avant la création, ou après la création une modification de l'étape 2, un champ de lead tapé sans « Ajouter », une entrée de Whitelist à l'étape 5) : « Quitter », le rail, la colonne, le sélecteur d'organisation et le lien du fil d'Ariane ouvrent la fenêtre « Quitter la création ? », « Ce que vous avez saisi n'est pas encore enregistré. », boutons « Rester » et « Quitter sans enregistrer » (D-9, D-118, D-119). OK ?
- [ ] Bouton Retour du navigateur avec une saisie en attente : il quitte l'assistant sans fenêtre, la saisie est perdue ; une fenêtre ouverte se ferme au changement de page. Fermer l'onglet ou recharger, en revanche, demande confirmation au navigateur (D-122, discutable, point gardé pour la recette). OK comme limite connue, ou faut-il retenir aussi le bouton Retour ?
- [ ] « Créer et tester », puis modifier l'étape 2 sans cliquer de nouveau sur « Créer et tester » : l'encadré dit « « Essai sortie » est dans la liste des agents IA, en Draft. Vos dernières modifications ne sont pas encore enregistrées : « Créer et tester » les enregistre. » (D-126). OK ?
- [ ] Dans le même état, cliquer l'étape 3, 4 ou 5 du stepper : les modifications sont enregistrées sans clic sur « Créer et tester », champ de lead tapé compris ; si l'envoi échoue, l'assistant reste sur l'étape (D-125, à vous : la spec ne prévoit l'enregistrement qu'à « Créer et tester », et l'encadré ci-dessus dit le contraire). Gardez-vous l'enregistrement au saut (et on corrige le texte de l'encadré), ou préférez-vous une confirmation, ou refuser le saut tant que des modifications attendent ?

## 13. Première entité

- [ ] Vu en préparation : le script exige le nom de la première entité, et Atelier Nord a son entité « Atelier Nord Paris » (19-35, décision de François). L'admin peut la renommer depuis Organisation › Entités › « Renommer ».

## 14. Hors périmètre

- [ ] Utilisateurs sans nom (adresse seule), entités sans lien, et les points non numérotés de la grille (vérification du secret à la fin du raccordement, jauge de Sécurité, « Facturation Meta » toujours en avertissement, « Plus tard » de l'invitation, « Rendez-vous ») restent tels quels dans ce lot (19-37). OK pour les reprendre dans un lot Organisation ?

## Comparaison avec les maquettes (spec 20, n° 3)

Maquettes dans le dépôt principal (dossier ignoré par git, absent du worktree) : `/Users/francoisgreze/www/Cyran-projects/cyran-labs-engine/.superpowers/brainstorm/41277-1794332796/content/navigation-rail-seul.html` et `assistant-rail.html`. Une capture de chaque page, à côté de la maquette ; la disposition et l'aspect doivent correspondre, le texte de la spec fait foi.

- [ ] Liste des agents IA.
- [ ] Page d'un agent IA (Support technique).
- [ ] Assistant (étape 2, puis écran de fin).
- [ ] Organisation › Connexions.
- [ ] Mon compte › Organisations.

## Parcours conseiller (`conseiller@wabagent.local`, Conseiller de Boutique Lyon)

Fenêtre privée. Remettre avant de commencer : Support technique a votre téléphone en Whitelist (même Offline) ; Accueil Lyon (Boutique Lyon) est en Preview avec votre téléphone en Whitelist.

### B.1 Rail, colonne et liste (spec 5, 9.3, 10.2)

- [ ] Rail : Agents IA, Leads, Reprise, Aide, Compte ; ni Organisation ni Usage (19-1, décision de François, coûts réservés à l'administrateur).
- [ ] Bloc Organisation : « Agence Démo », sous-titre « Conseiller », ni flèche ni menu (une seule organisation).
- [ ] La liste montre tous les agents IA de l'organisation, des deux entités ; pas de bouton de création. Numéro de l'agent IA en entier.

### B.2 Page d'un agent IA (spec 9.2, 10.3)

- [ ] Support technique (entité Agence Démo, hors de la sienne) : la Whitelist en lecture montre votre numéro masqué, `+336 •• •• •• 12` pour un numéro français (3 premiers chiffres, `•• •• ••`, 2 derniers ; D-3 : la spec disait 5 premiers chiffres et `•• ••`, elle est amendée, car l'ancien format ne cachait que 4 chiffres d'un numéro français). OK ?
- [ ] Dernières conversations de Support technique : numéros masqués de la même façon, initiale jamais tirée du numéro ; un nom de profil WhatsApp égal au numéro, lui, n'est pas masqué (texte libre, point gardé pour la recette) ; les champs libres des leads ne sont pas masqués (19-4). OK pour ce lot ?
- [ ] Accueil Lyon (son entité) : Whitelist et numéros en entier (19-2 pour le super manager, même règle pour le membre de l'entité).
- [ ] Recherche d'un lead par numéro sur un agent IA hors de son entité : aucun résultat par le numéro, seulement par le nom ; le détail d'un lead lui est refusé (19-3). Visible seulement par l'API tant que la page Conversations et leads n'existe pas : à valider sur lecture.
- [ ] Pas d'actions de statut, de Whitelist ni de numéro ; pas de carte « Coût LLM » ; pas de groupe Organisation ni de section « Usage et coûts » dans la colonne ; « ▶ Simuler » présent (19-1).
- [ ] Compte en erreur (SQL du 7, depuis le terminal) : sur Accueil Lyon, encadré rouge avec le motif et « Prévenez un administrateur de votre organisation. » à la place de l'action, sans lien vers Connexions (D-86 : vaut pour tout membre qui n'est pas administrateur ; un admin n'est jamais en lecture seule). Remettre le compte avec « Vérifier maintenant » (connecté en admin). OK ?

### B.3 Refus sur place (spec 10.6)

- [ ] Taper `/usage`, `/agents/support-demo/usage`, `/agents/new` et `/organisation/entites` dans l'adresse : à la même adresse, le cadre normal (rail sans entrée active, colonne réduite au bloc Organisation), titre « Page réservée aux administrateurs », phrase « Cette page de l'organisation Agence Démo est réservée aux administrateurs. », lien « Retour aux agents IA » ; fil « Agence Démo › Accès refusé » (19-21 ; D-14 : la spec disait « Cette page de {Org} … », elle est amendée pour éviter « de Acme »). OK ?

### B.4 Pages du compte (spec 11)

- [ ] Mon compte › Organisations : Agence Démo « Ouverte », rôle Conseiller ; compteur 1.

## Décisions sans effet à l'écran, à valider sur lecture

- [ ] D-42 (mineur 3 de la relecture de la tâche 2, discutable car le registre ne disait pas son contenu) : chaque refus 403 de l'usage relit `/auth/me`, soit un appel de plus par refus ; comportement antérieur, borné à un appel par lecture du résumé. OK de laisser ?
- [ ] D-140 (mineur 5 de la relecture de la tâche 14, même raison) : l'ancien vocabulaire (« liste d'accès limité », « en brouillon », « désactivé ») reste dans des commentaires de code et des titres de tests, jamais affiché. OK de laisser, ou faut-il une passe sur les commentaires des contrats (`bot-status.ts`), lus par le web et le faux moteur ?
- [ ] D-143 (point gardé pour la recette) : aucun contrôle d'accessibilité automatique (axe) n'est dans le dépôt ; ce lot n'ajoute pas de dépendance. Proposition : l'ajouter à la suite Playwright dans un lot suivant, sur les pages principales. D'accord ?

## Annexe : faux moteur, pour les cas non reproductibles en réel

```bash
cd "$WT/apps/web"
npx tsx e2e/mock-engine.ts                                                # terminal A, port 4999
ENGINE_API_URL=http://localhost:4999/api/admin/v1 npx next dev -p 3002   # terminal B
curl -X POST http://localhost:4999/__scenario -H 'content-type: application/json' -d '{"name":"account-error-unreadable"}'
```

Se connecter sur http://localhost:3002 avec `demo@wabagent.test` / `motdepasse12`, ouvrir Organisation › Connexions. Autres scénarios utiles : `limited-empty-allowlist`, `advisor-other-entity`, `unnamed-lead` (compte conseiller `advisor@wabagent.test`, même mot de passe).

## Reports acceptés (rien à tester)

- Champs libres des leads (`qualified_data`, historique) non masqués : chantier « Conversations et leads » (revue d'isolation, m-1).
- Faux moteur moins strict que le moteur sur le détail d'un lead : sans effet (revue d'isolation, m-3).
- Règle « coûts réservés à l'admin » dupliquée dans le BFF de l'usage, en plus du moteur (revue d'isolation, m-4).
- Choix de la section 19 sans effet à l'écran : n° 5 (refus des coûts par le 403 générique ; le web ne fait jamais l'appel pour un non-admin) et n° 7 (règle « Ne répond pas » dans une fonction des contrats, vérifiée par le test d'équivalence avec le routeur).
- Point « Retry » et « Try again », deux traductions anglaises de « Réessayer » : hors périmètre de la garde des sept mots.
- Compteur des messages non servis cumulatif, jamais remis à zéro (report du lot précédent).
