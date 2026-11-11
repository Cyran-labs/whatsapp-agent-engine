# Recette guidée du lot « Refonte de la navigation »

Date : 11 novembre 2026. Branche `feat/refonte-navigation`. Tâche 17, étape 4 du plan `docs/superpowers/plans/2026-11-10-refonte-navigation.md`. À faire par François en réel, avant la revue finale et le merge.

Ce document reprend, dans l'ordre des sections de la spec (`docs/superpowers/specs/2026-11-10-refonte-navigation-design.md`), parcours administrateur puis parcours conseiller :
- chaque choix de Claude de la section 19 de la spec qui se voit à l'écran (repère « 19-n ») ;
- chaque décision « produit visible » (famille A) du registre `docs/superpowers/research/2026-11-11-registre-decisions-navigation.md` (repère « D-n ») ;
- chaque décision « à François » ou « discutable » de l'audit `docs/superpowers/research/2026-11-11-audit-decisions-navigation.md`, et les quatre décisions contraires à la spec que vous gardez sous réserve de votre accord (D-3, D-10, D-14, D-67) ; le bouton D-131 est revenu au texte de la spec ;
- les points gardés pour la recette pendant l'exécution (registre `.superpowers/sdd/2026-11-10-refonte-navigation/progress.md`).

La dernière section, « Corrections du 11 novembre 2026 », couvre le sous-lot « En-tête de page et corrections » (spec `docs/superpowers/specs/2026-11-11-entete-de-page-et-corrections-design.md`) : l'en-tête de chaque page, les corrections 1 à 15 et les décisions du PO que vous tranchez. Elle remplace les cases de ce guide qui testaient l'ancienne barre du haut et son fil d'Ariane (liste dans la section).

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

# 2 bis. Pool de clés LLM de la plateforme et tarifs, dans la copie, avant de lancer le moteur
cd "$WT"
npx tsx scripts/seed-credentials.ts
npx tsx scripts/seed-pricing.ts

# 3. Moteur (terminal 1, port 3800) : journaux ouverts, liens d'invitation écrits
cd "$WT"
MAILER_LOG_LINKS=true ADMIN_WEB_ORIGIN=http://localhost:3001 npm run dev

# 4. Back-office (terminal 2, port 3001)
cd "$WT/apps/web"
npm run dev
```

Les deux scripts de l'étape 2 bis écrivent dans la copie `store/demo.db` (jamais dans le dépôt principal) : `seed-credentials` sème le pool de clés LLM de la plateforme (il lit `ANTHROPIC_API_KEY` dans le `.env` copié), sans quoi l'agent IA répond « problème technique » au simulateur ; `seed-pricing` sème les tarifs (idempotent), sans quoi les coûts valent 0,00 $.

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
- Attendu modifié, voir K-11 : ce qui touche les bulles (de deux lignes) et l'icône de l'entrée active (menthe clair, en plus du fond) est remplacé, le reste de la case est à tester. Aucune pastille dans le rail, entrée active marquée par le fond seul. Leads, Reprise et Aide sont grisés ; au survol et au clavier (Tab), bulles « Disponible prochainement : suivi des conversations et des leads. », « Disponible prochainement : un conseiller reprend la conversation. », « Disponible prochainement : aide en ligne et contact du support. » ; un clic ne fait rien (19-16). OK ?
- [ ] Entrées grisées au lecteur d'écran (VoiceOver : Cmd+F5) : annoncées « lien, estompé » ou équivalent, la bulle est lue ; Échap la ferme (D-59, discutable dans l'audit : la spec disait « n'est pas un lien », le code garde le rôle de lien pour que l'état « indisponible » soit lu). OK ou préférez-vous qu'elles ne soient pas annoncées comme des liens ?
- [ ] Entrée Compte : rond avec vos initiales, mot « Compte ». Un clic mène directement à « Mon compte › Organisations », sans menu déroulant (19-17). Au lecteur d'écran, son nom est « Compte, demo@wabagent.local » (D-60). OK ?
- [ ] Entrée active par adresse : Organisation sur `/organisation/…`, Agents IA sur `/`, `/agents/new` et la page d'un agent IA, Usage sur `/usage`, Compte sur `/account/…`. Sur la page d'usage d'un agent IA, c'est Agents IA qui est actif (19-19). OK ?
- [ ] Thème sombre (Mon compte › Préférences) : le rail et la colonne du milieu sont proches de teinte (point gardé pour la recette au contrôle de la tâche 5). Lisible ou faut-il plus de contraste entre les deux ?

### 5.2 Colonne du milieu et bloc Organisation

Avec deux organisations ouvrables (Agence Démo et Atelier Nord).

- Attendu modifié, voir H-10 : ce qui touche le monogramme (retiré) est remplacé, le reste de la case est à tester. Bloc en tête de la colonne : « ORGANISATION », monogramme, « Agence Démo » en gras, sous-titre « Admin · 2 organisations », flèche ▾ (19-20). OK ?
- [ ] Ouvrir le menu, choisir Atelier Nord : on arrive sur la liste des agents IA d'Atelier Nord ; pied du menu « Changer d'organisation ramène à la liste des agents IA. ». Revenir sur Agence Démo.
- [ ] Entrée active de la colonne : fond gris clair, contour intérieur, texte en gras, sans barre menthe (aspect de la maquette, D-56). OK ou préférez-vous une barre menthe ?
- [ ] Deux onglets (D-141, point d'attention 5) : onglet 1 sur Organisation › Entités d'Agence Démo ; onglet 2, passer sur Atelier Nord ; revenir sur l'onglet 1. L'onglet se recharge sur la liste des agents IA d'Atelier Nord, avec le bandeau « Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord. » ; il ne montre jamais les entités d'Agence Démo sous le nom d'Atelier Nord. OK ou préférez-vous que l'onglet reste sur la même page (Entités d'Atelier Nord) ?
- Attendu modifié, voir K-13 : ce qui touche le menu et le bandeau d'une organisation suspendue est remplacé, le reste de la case est à tester. Repasser les deux onglets sur Agence Démo, puis suspendre Atelier Nord :
  ```bash
  sqlite3 store/demo.db "UPDATE clients SET status='suspended' WHERE client_id='atelier-nord';"
  ```
  Recharger. Le menu montre Atelier Nord grisé, pastille « Suspendue » et « Ne peut pas être ouverte : contactez l'administrateur de l'organisation ou le support. » ; le sous-titre dit toujours « Admin · 2 organisations » (19-20).
- Remplacée par K-13 (ne pas tester) : Ce même menu, avec une organisation suspendue : il paraît serré (point gardé pour la recette au contrôle de la tâche 5). Lisible ou faut-il plus d'espace ?
- [ ] Facultatif, opérateur (`admin@wabagent.local`, fenêtre privée) : sous-titre « Admin implicite · … », étoile à la place des initiales dans le rail.

### 5.3 Barre du haut

- Remplacée par H-1, H-7 et K-1 (ne pas tester) : Sur chaque page : fil d'Ariane à gauche qui commence par « Agence Démo » (lien vers la liste), séparateur « › », dernier segment en gras ; une seule action à droite, ou rien. Le bandeau d'organisation (par exemple celui des deux onglets) passe au-dessus du rail.
- Remplacée par H-7 (ne pas tester) : Moteur arrêté (Ctrl+C dans le terminal 1), sans recharger, cliquer sur « Support technique » dans la liste : la page dit qu'elle n'a pas pu être lue, la barre du haut garde le fil d'Ariane et n'a pas d'action (D-65). Même chose sur Connexions et sur une page d'usage. Relancer le moteur. OK ?
- Remplacée par H-6 (ne pas tester) : Réseau lent (outils du navigateur › Réseau › « 3G lente »), ouvrir la page d'un agent IA : pendant la lecture, le nom de l'agent IA est un squelette gris dans le fil, jamais un lien vide (D-66). OK ?

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
- Remplacée par K-5 (ne pas tester) : Whitelist vide : sur sa page, retirer votre numéro et « Enregistrer ». Aux cinq endroits, mention rouge « Ne répond pas » à droite de la pastille Preview ; sur la page, encadré rouge « En Preview, il ne répond qu'aux numéros de sa Whitelist, qui est vide : il ne répond à personne. » avec « Ajouter un numéro à la Whitelist » ; « Passer Online » reste dans la rangée des actions de statut, pas dans l'encadré (19-6, 19-26). OK ?
- Attendu modifié, voir K-4 et K-5 : ce qui touche la forme de la mention (point rouge sur la pastille, ou étiquette neutre « Whitelist vide ») est remplacé, le reste de la case est à tester. Dans la liste et Connexions, la mention est un bouton : un clic ou le survol ouvre la bulle « Ne répond pas : Whitelist vide », même texte que la forme longue ; elle ne fait rien d'autre (19-9, D-72, D-73). OK ?
- Attendu modifié, voir H-5 : ce qui touche le fil « Agence Démo › Agents IA › Ne répond pas » (remplacé par les parents et le titre) est remplacé, le reste de la case est à tester. Colonne de la liste, groupe Statut : sous Online, Preview, Offline, Draft, une entrée « Ne répond pas » avec point rouge et compteur 1, qui apparaît à la fin de la lecture avec les autres compteurs ; un clic filtre la liste, fil « Agence Démo › Agents IA › Ne répond pas » (19-8, D-81). Les compteurs ne comptent que les agents IA dont la pastille montre la mention. OK ?
- Remplacée par K-4 et P-11 (ne pas tester) : Panneau Santé de la page : « ne répond pas : voir l'encart Statut » au lieu de « tout est opérationnel » (D-82). OK ?
- Attendu modifié, voir K-4 : ce qui touche la bulle de la mention (désormais un point rouge sur la pastille) est remplacé, le reste de la case est à tester. Compte en erreur, avec la Whitelist toujours vide :
  ```bash
  sqlite3 store/demo.db "UPDATE whatsapp_accounts SET state='error', error_reason='token_invalid', error_detail='Jeton refusé (recette)' WHERE client_id='demo-agency';"
  ```
  Recharger. Bulle de la mention « Ne répond pas : compte WhatsApp en erreur » (le motif du compte passe avant la Whitelist vide, D-68) ; sur la page, encadré rouge « Le compte WhatsApp de son numéro est en erreur : aucun message reçu n'est servi (le motif est dans l'encart Numéro WhatsApp). » avec le lien « Ouvrir Connexions ↗ » vers Connexions, sans second bouton « Remplacer les identifiants » (D-2).
- Attendu modifié, voir K-5 et P-3 : ce qui touche l'ambre (l'encart est désormais neutre) est remplacé, le reste de la case est à tester. Dans ce même cas, sous l'encadré rouge, l'encart ambre « Cet agent IA ne répond à personne : sa Whitelist est vide. » avec « Ajouter un numéro à la Whitelist » reste affiché : deux encarts pour deux problèmes (D-67 ; la spec 7.2 disait de ne lire que la mention, elle est amendée). OK ou préférez-vous un seul encart, celui de la mention ?
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
- Remplacée par H-3 à H-5 (ne pas tester) : Fils et titres des listes filtrées (19-22) : « Agence Démo › Agents IA › Tous les agents IA » ; filtré par entité « … › Entité : Boutique Lyon » et titre « Entité : Boutique Lyon » ; filtré par statut « … › Statut : Preview » et titre « Preview ». OK ?
- [ ] Tableau : colonne « Messages » sans « 30 j », car le compteur compte depuis la création de l'agent IA ; même mot « Messages » dans la Vue d'ensemble (19-23, D-1). OK ?
- Remplacée par H-2 et H-3 (ne pas tester) : Action « + Créer un agent IA » ; filtré par entité, elle ouvre l'assistant avec l'entité choisie.
- [ ] Mise en route avec un agent IA en Draft sans numéro : « Brancher un numéro » mène à la page de cet agent IA, pas à Connexions (19-24). Sans un tel agent IA, le lien porte « ↗ Connexions » et mène à Connexions (D-77). OK ?
- [ ] Liens qui changent d'espace (19-28, D-21) : « Numéros WhatsApp de l'organisation ↗ Connexions » dans la colonne d'un agent IA, « ↗ » derrière le nom d'un agent IA dans le tableau de `/usage` ; le rail suit l'espace d'arrivée. OK ?

### 10.3 Page d'un agent IA

Sur « Support technique ».

- [ ] Colonne : bloc Organisation, « ‹ Tous les agents IA », « AGENT IA », nom, pastille, ligne « Entité · Agence Démo », sections Vue d'ensemble, Conversations et leads (Soon), Personnalité et contenu (Soon), CRM (Soon), Usage et coûts, Réglages (Soon) ; les bulles des Soon : « Disponible prochainement : les conversations et les leads de cet agent IA. », « … modifier la personnalité et le contenu. », « … l'envoi des leads vers votre CRM. », « … les réglages de l'agent IA. » (19-25, D-64). OK ?
- Attendu modifié, voir H-6 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Titre de la page : le nom, avec dessous « Entité · Agence Démo » et les langues ; action « ▶ Simuler » dans la barre du haut, absente des Raccourcis ; « voir tout » retiré (19-25). OK ?
- [ ] Raccourcis : « Modifier la personnalité » grisé, bulle « Disponible prochainement : modifier la personnalité de cet agent IA. » (D-88). OK ?
- [ ] Dernières conversations : initiales tirées du nom ; un lead sans nom montre une icône de contact, pas deux chiffres (19-25).
- [ ] Encart Whitelist (19-27) : « Tant que l'agent IA est en Preview, seuls ces numéros reçoivent une réponse. », puis en plus petit « Mot-clé « reset » : un contact de la Whitelist qui l'envoie efface sa conversation avec cet agent IA (le lead est conservé), même quand l'agent IA est Online. ». OK ?
- [ ] Draft sans numéro (créer un agent IA de test ou utiliser celui du 12) : sous les actions grisées, une seule ligne de raison quand elles ont toutes la même (D-83). OK ?
- [ ] Carte « Coût LLM » : montant sous « 30 derniers jours », graphique sous « 7 derniers jours », 7 jours calendaires de Paris finissant aujourd'hui, un jour sans appel en barre à zéro (19-25, D-89). OK ?
- [ ] Moyenne « ~{montant}/jour » de la carte et de la page d'usage : elle est divisée par les jours où l'agent IA a servi, pas par la période (D-91, discutable dans l'audit : un agent IA actif 3 jours sur 30 affiche une moyenne 10 fois plus forte que la dépense moyenne). OK, ou préférez-vous diviser par la période, ou écrire « par jour d'activité » ?
- [ ] Coûts groupés par jour UTC dans le moteur, affichés en jours de Paris : un appel entre minuit et 1 h ou 2 h (heure de Paris) peut tomber sur la barre de la veille (D-90, discutable, report déjà accepté au lot précédent). OK de laisser en l'état et de le noter dans les points différés ?

### 10.4 Usage d'un agent IA

Colonne de l'agent IA › « Usage et coûts ».

- Remplacée par H-8 (ne pas tester) : Fil « Agence Démo › Agents IA › Support technique › Usage et coûts », titre « Usage et coûts de Support technique » aligné à gauche avec le fil (19-29, D-101). OK ?
- Attendu modifié, voir H-8 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Choix de période « 7 j / 30 j / 90 j » dans la barre du haut, 30 j par défaut ; la période n'est pas dans l'adresse : en rechargeant, on revient à 30 j (19-29, D-8). OK ou préférez-vous que la période choisie reste en rechargeant ?
- [ ] En changeant de période, les chiffres repassent en squelette avant les nouveaux (D-102). OK ?

### 10.6 Refus sur place

Vu au parcours conseiller (B.3). Côté admin, voir la case D-105 en fin de section 11.

### 10.7 Organisation

- Attendu modifié, voir H-10 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Colonne : bloc Organisation, « ORGANISATION », Entités (n), Utilisateurs (n), Connexions (n), Réglages, « Marque et connaissances » grisé Soon avec la bulle « Disponible prochainement : la marque, le ton et la base documentaire de l'organisation, de ses entités et de ses agents IA. » (19-36, D-97). OK ?
- [ ] Compte en erreur (commande SQL du 7) : l'entrée Connexions montre « 1 en erreur » en pastille rouge claire à la place du compteur gris, fond clair aussi en thème sombre (19-30, D-93, D-97). OK ? Remettre le compte avec « Vérifier maintenant ».
- Remplacée par H-11 (ne pas tester) : Entités : fil « Agence Démo › Organisation › Entités », action « + Nouvelle entité » (« Archiver… » grisé sur une entité seule : vu en préparation sur Atelier Nord).
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
- Attendu modifié, voir H-12 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Raccorder un compte WhatsApp : fil « Agence Démo › Organisation › Connexions › Raccorder un compte WhatsApp », pas d'action en haut ; carte « Connexion Meta » grisée Soon, bulle « Disponible prochainement : le raccordement en un clic avec Facebook. » (D-97).
- [ ] Réglages : page active qui dit la règle en vigueur « Tout le monde voit tout » ; les deux autres modes grisés Soon, bulle « Disponible prochainement : ce mode sera au choix avec Conversations et leads. » (19-30, D-97). OK ?

### 10.8 Usage et coûts de l'organisation

Rail › Usage.

- Attendu modifié, voir H-13 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Colonne : « USAGE ET COÛTS », « Toute l'organisation », groupe « Par entité ». Fil « Agence Démo › Usage et coûts › Toute l'organisation », titre « Usage et coûts : toute l'organisation » ; filtré, « … › Entité : Boutique Lyon » et « Usage et coûts : Entité Boutique Lyon » (19-22, 19-29). OK ?
- Attendu modifié, voir H-13 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Période 7 j / 30 j / 90 j dans la barre du haut, 30 j par défaut, période écrite sous le titre (« 30 derniers jours ») ; changement de période en squelette (19-29, D-102).
- Remplacée par H-13 (ne pas tester) : Réseau lent, filtre par entité : le nom de l'entité est un squelette dans le fil et le titre pendant la lecture (D-103). OK ?
- Remplacée par H-13 (ne pas tester) : Entités illisibles : fil « Entité indisponible », titre « Usage et coûts : entité indisponible » (D-104). Non reproductible simplement en réel (il faut que seule la lecture des entités échoue) ; couvert par les tests. OK de valider sur lecture ?

## 11. Pages du compte

- Attendu modifié, voir H-14 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Colonne : « MON COMPTE », adresse e-mail, Organisations (n), Préférences, Sécurité, « Se déconnecter » en bas, séparé ; pas de bloc Organisation. Fil « Mon compte › Organisations », « Mon compte » est un lien vers Organisations (D-58). OK ?
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

- Attendu modifié, voir H-9 : ne testez pas ce qui touche le fil, la barre du haut ou le titre de groupe, le reste de la case est à tester. Rail (Agents IA actif) et colonne gardés : bloc Organisation, « ‹ Tous les agents IA », « Créer un agent IA », stepper vertical Identité, Personnalité, Tester, Numéro, Activer avec leurs lignes « Nom, entité, langues », « Rôle, ton, accueil, informations », « Simulation », « Numéro WhatsApp », « Contrôles et Whitelist » ; fil « Agence Démo › Agents IA › Créer un agent IA » ; à droite « Retour à Agents IA : rien n'est enregistré » et « ✕ Quitter » (19-34). OK ?
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
- Attendu modifié, voir H-9 : ce qui touche le lien du fil d'Ariane (c'est un lien de la ligne des parents) est remplacé, le reste de la case est à tester. Saisie en attente (nom tapé avant la création, ou après la création une modification de l'étape 2, un champ de lead tapé sans « Ajouter », une entrée de Whitelist à l'étape 5) : « Quitter », le rail, la colonne, le sélecteur d'organisation et le lien du fil d'Ariane ouvrent la fenêtre « Quitter la création ? », « Ce que vous avez saisi n'est pas encore enregistré. », boutons « Rester » et « Quitter sans enregistrer » (D-9, D-118, D-119). OK ?
- [ ] Bouton Retour du navigateur avec une saisie en attente : il quitte l'assistant sans fenêtre, la saisie est perdue ; une fenêtre ouverte se ferme au changement de page. Fermer l'onglet ou recharger, en revanche, demande confirmation au navigateur (D-122, discutable, point gardé pour la recette). OK comme limite connue, ou faut-il retenir aussi le bouton Retour ?
- Attendu modifié, voir K-8 : ce qui touche le texte de l'encadré (« elles sont enregistrées par « Créer et tester » ou en passant à l'étape suivante ») est remplacé, le reste de la case est à tester. « Créer et tester », puis modifier l'étape 2 sans cliquer de nouveau sur « Créer et tester » : l'encadré dit « « Essai sortie » est dans la liste des agents IA, en Draft. Vos dernières modifications ne sont pas encore enregistrées : « Créer et tester » les enregistre. » (D-126). OK ?
- Attendu modifié, voir K-8 : ce qui touche la question posée : la décision est prise (l'enregistrement au saut est gardé, le texte de l'encadré est corrigé) est remplacé, le reste de la case est à tester. Dans le même état, cliquer l'étape 3, 4 ou 5 du stepper : les modifications sont enregistrées sans clic sur « Créer et tester », champ de lead tapé compris ; si l'envoi échoue, l'assistant reste sur l'étape (D-125, à vous : la spec ne prévoit l'enregistrement qu'à « Créer et tester », et l'encadré ci-dessus dit le contraire). Gardez-vous l'enregistrement au saut (et on corrige le texte de l'encadré), ou préférez-vous une confirmation, ou refuser le saut tant que des modifications attendent ?

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

- Remplacée par H-15 (ne pas tester) : Taper `/usage`, `/agents/support-demo/usage`, `/agents/new` et `/organisation/entites` dans l'adresse : à la même adresse, le cadre normal (rail sans entrée active, colonne réduite au bloc Organisation), titre « Page réservée aux administrateurs », phrase « Cette page de l'organisation Agence Démo est réservée aux administrateurs. », lien « Retour aux agents IA » ; fil « Agence Démo › Accès refusé » (19-21 ; D-14 : la spec disait « Cette page de {Org} … », elle est amendée pour éviter « de Acme »). OK ?

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

## Corrections du 11 novembre 2026 : recette des points corrigés

Sous-lot « En-tête de page et corrections » (spec `docs/superpowers/specs/2026-11-11-entete-de-page-et-corrections-design.md`, plan `docs/superpowers/plans/2026-11-11-entete-de-page-et-corrections.md`), exécuté sur la même branche après la première recette. À faire par François en réel, après les sections ci-dessus ou à leur place pour ce qu'elles remplacent.

Repères : « H-n » une case de l'en-tête de page (tableau 2.2 de la spec et états de la spec 7.4) ; « K-n » la correction n de la spec (section 3) ; « P-n » une décision du PO (le contrôleur du plan, en autonomie) visible à l'écran, que vous tranchez. Les choix du planificateur C-1 à C-20 sont montrés dans ces cases. Pour chaque case : où aller, quoi faire, ce qu'on doit voir. Cochez la case si c'est bon ; sinon écrivez « à reprendre » et ce que vous voulez à la place : chaque « à reprendre » deviendra une correction avec son test avant la revue finale.

### Cases remplacées et cases dont l'attendu change

Les cases suivantes testaient l'ancienne barre du haut, son fil d'Ariane et le titre de groupe de la colonne, qui n'existent plus. Dans le texte ci-dessus, chacune porte la mention « Remplacée » ou « Attendu modifié ».

Remplacées en entier (ne les testez pas) :
- 5.3, les trois cases (fil sur chaque page, moteur arrêté, réseau lent) : remplacées par H-1, H-7 et K-1.
- 10.2 : « Fils et titres des listes filtrées » et « Action « + Créer un agent IA » » : remplacées par H-2 à H-5.
- 10.4 : « Fil « Agence Démo › Agents IA › Support technique › Usage et coûts »… » : remplacée par H-8.
- 10.7 : « Entités : fil… » : remplacée par H-11.
- 10.8 : « Réseau lent, filtre par entité » et « Entités illisibles : fil… » : remplacées par H-13.
- B.3 (parcours conseiller) : « Taper `/usage`… fil « Agence Démo › Accès refusé » » : remplacée par H-15.

Remplacées en partie : seuls le fil, la barre du haut, le titre de groupe ou l'ancien titre sont remplacés (la case porte « Attendu modifié »), le reste de la case est à tester.
- 10.3 « Titre de la page » (H-6) ; 10.4 « Choix de période » (H-8) ; 10.7 « Colonne : bloc Organisation » (H-10) et « Raccorder un compte WhatsApp : fil » (H-12) ; 10.8 « Colonne : « USAGE ET COÛTS » » et « Période 7 j / 30 j / 90 j » (H-13) ; 11 « Colonne : « MON COMPTE » » (H-14) ; 12.1 et 12.2 « Rail (Agents IA actif) et colonne gardés » (H-9).
- Étendue par rapport à la plage 10.2 à 10.8 : 11, 12.1 et B.3 testent aussi l'ancien fil, elles sont donc traitées de même.

Autres cases dont l'attendu change : en cas de contradiction entre un texte plus haut et ce qui suit, ce qui suit fait foi.
- 5.1 : bulles du rail (désormais de deux lignes, K-11) ; 5.2 : monogramme du bloc Organisation (retiré, H-10) et menu d'une organisation suspendue (K-13) ; 6.2 : gris d'Offline (K-11).
- 7 : mention rouge « Ne répond pas » à droite de la pastille, étiquette rouge de Santé et encadré rouge pour la Whitelist vide (désormais un point rouge sur la pastille, et un état neutre pour la Whitelist vide : K-4 et K-5) ; ligne « panneau Santé : voir l'encart Statut » (retirée) ; fil « Agence Démo › Agents IA › Ne répond pas » (H-5).
- 10.3 : moyenne « ~{montant}/jour » divisée par les jours d'activité (désormais par la période : K-9).
- 10.7 et 12.3 : numéro d'un compte en erreur grisé pour tout agent IA (désormais permis pour un agent IA Draft ou Offline, refusé pour Preview et Online : K-7 ; dans l'assistant, toujours non choisissable : P-1).
- 12.1 : texte de l'encadré « Draft enregistré » (K-8) et ligne « Retour à Agents IA : rien n'est enregistré » (H-9).
- Cases de ces sections déjà marquées « Remplacée » ou « Attendu modifié » dans le texte : 5.1 (bulles du rail), 5.2 (bloc Organisation, menu d'une organisation suspendue, deux cases), 7 (Whitelist vide, forme de la mention, Santé, compte en erreur, encart ambre : sept cases), 12.4 (saisie en attente, encadré D-126, enregistrement au saut D-125). Ne les testez pas telles quelles : la section K les remplace.

### K.0 Préparation de la section

Mêmes comptes et mêmes données qu'à la section 0, avec les deux scripts de départ lancés (0.1). Plus :
- [ ] Identifiants des entités, pour les adresses d'essai (troisième terminal, depuis `$WT`) :
  ```bash
  sqlite3 store/demo.db "SELECT id, client_id, name, status FROM entities;"
  ```
  Notez `ID_LYON` (Boutique Lyon, Agence Démo) et `ID_NORD` (Atelier Nord Paris, Atelier Nord : une entité d'une autre organisation que celle de `demo@wabagent.local` ouverte sur Agence Démo).
- [ ] État de départ : « Support technique » en Preview sur N1 avec votre téléphone en Whitelist ; « Accueil Lyon » (Boutique Lyon) en Preview avec votre téléphone en Whitelist ; Atelier Nord active ; compte WhatsApp connecté (« Vérifier maintenant » si besoin).
- [ ] Un agent IA Draft, utile à K-7 : créer « Essai Draft » par l'assistant (Organisation Agence Démo, entité au choix), le laisser en Draft sans numéro (« Laisser en Draft »). « Accueil Lyon » (Boutique Lyon, Preview) vient de la section 12.3 ; si vous commencez par la section K, créez-le aussi par l'assistant, activé en Preview avec votre téléphone en Whitelist.
- [ ] Les commandes SQL de remise en état de la section 7 (compte en erreur) et de la section 11 (organisation suspendue) servent aussi ici ; chaque case dit quand les lancer et quand remettre.

### H. En-tête de page (spec 2 et 7.4)

Les parents sont la ligne grise au-dessus du titre ; le bouton rond est le rond menthe en haut à droite avec une icône et un petit « + ».

- [ ] **H-1. Plus de barre du haut.** Où : liste des agents IA, page d'un agent IA, assistant, Organisation (cinq pages), Usage, Mon compte, page réservée (compte conseiller). Faire : ouvrir chaque page. Voir : aucune barre en haut de la zone de contenu ; le haut de page est dans le contenu, aligné sur la largeur des boîtes ; le bandeau d'organisation éventuel reste au-dessus du rail. Rail et colonne restent à pleine hauteur (K-10).
- [ ] **H-2. Liste, toute la liste.** Où : `/` (rail › Agents IA). Voir : pas de ligne des parents ; titre « Agents IA » ; description « Tous les agents IA · n agents IA » ; bouton rond « Créer un agent IA » (icône robot et « + »). Survol et Tab : bulle « Créer un agent IA » sous le bouton, même nom pour un lecteur d'écran. Clic : ouvre l'assistant. C-4 : OK pour ces phrases ?
- [ ] **H-3. Liste filtrée par entité.** Où : colonne › groupe « Par entité » › Boutique Lyon. Voir : parents « Agents IA » (lien vers toute la liste) ; titre « Boutique Lyon » ; description « Entité · n agents IA » ; bouton rond « Créer un agent IA dans Boutique Lyon ». Clic sur le bouton : l'assistant s'ouvre avec l'entité Boutique Lyon déjà choisie. **Dépend de la vague finale** : si la lecture des entités échoue, le bouton rond d'une liste filtrée par entité sera masqué (rien à créer dans une entité qu'on ne sait pas nommer) ; au HEAD actuel il reste affiché. Cas rare, non reproductible simplement en réel.
- [ ] **H-4. Liste filtrée par statut.** Où : colonne › groupe « Statut » › chaque mot. Voir, pour Draft, Preview, Online, Offline : parents « Agents IA » ; titre = le mot ; description = une phrase courte sans point final puis « · n agents IA » (Draft « Ne répond à personne », Preview « Répond seulement aux numéros de la Whitelist », Online « Répond à tous les contacts », Offline « Ne répond plus, conversations conservées ») ; bouton rond « Créer un agent IA ». C-4 : OK pour ces phrases ?
- [ ] **H-5. Liste « Ne répond pas ».** Où : colonne › groupe « Statut » › « Ne répond pas » (avec un agent IA concerné : Whitelist vide, ou compte en erreur, voir K-4 et K-5). Voir : parents « Agents IA » ; titre « Ne répond pas » ; description « n agents IA » ; bouton rond « Créer un agent IA ».
- [ ] **H-6. Page d'un agent IA.** Où : `Support technique` (entité Agence Démo), puis `Accueil Lyon` (Boutique Lyon). Voir : parents « Agents IA › {entité de l'agent IA} », chaque élément cliquable (le second ouvre la liste filtrée sur cette entité) ; titre = le nom, avec la pastille de statut à côté (hors du titre) ; description = les langues ; à droite « ▶ Simuler », sans bouton rond ; plus de ligne « Entité · … » sous le titre dans la page. Réseau lent (outils du navigateur › Réseau › « 3G lente »), à l'ouverture : squelettes à la place du nom et de l'entité, jamais un lien vide. Adresse `/fr/agents/inexistant` : titre « Agent IA indisponible », parents « Agents IA ».
- [ ] **H-7. Moteur arrêté, page d'un agent IA ou liste.** Où : liste ouverte, puis Ctrl+C dans le terminal du moteur. Faire : sans recharger, cliquer « Support technique » dans la liste. Voir : le cadre reste (rail, colonne), l'en-tête dit « Agent IA indisponible » avec les parents « Agents IA », la page dit qu'elle n'a pas pu être lue avec « Réessayer », sans bouton rond ni « Simuler ». Même chose sur Connexions et sur une page d'usage. Relancer le moteur. (Remplace D-65 de 5.3.)
- [ ] **H-8. Usage d'un agent IA.** Où : colonne de l'agent IA › « Usage et coûts ». Voir : parents « Agents IA › Boutique Lyon › {nom} » (« Agents IA › {nom} » si l'agent IA n'a pas d'entité nommée) ; titre « Usage et coûts » ; description la période (« 30 derniers jours ») ; à droite le choix 7 j, 30 j, 90 j (30 j par défaut), pas de bouton rond. Adresse `/fr/agents/inexistant/usage` : parents « Agents IA » seulement et aucun identifiant tapé dans l'adresse n'est affiché. **Cette dernière phrase dépend de la vague finale** (M-4 de la revue d'isolation, décision du PO) : au HEAD actuel, l'identifiant tapé apparaît dans les parents ; ne la testez qu'une fois la vague faite.
- [ ] **H-9. Assistant.** Où : liste filtrée sur Boutique Lyon › bouton rond. Voir : parents « Agents IA › Boutique Lyon » (l'entité choisie à l'étape 1, mise à jour quand on la change à l'étape 1) ; titre « Créer un agent IA » ; sous le titre une description : « Quitter ramène à la liste « Boutique Lyon ». Rien n'est enregistré. » ; à droite « ✕ Quitter », pas de bouton rond. Après « Créer et tester » : « … Le Draft reste dans la liste. ». À la fin : « Quitter ramène à la liste « … ». ». Changer l'entité à l'étape 1 (si le champ est proposé) : le dernier parent change. Les liens des parents, « Quitter », le rail et la colonne ouvrent la fenêtre « Quitter la création ? » quand une saisie est en attente. Ouvert depuis la liste filtrée « Preview » : avant création « Quitter » mène à la liste « Preview » ; après création du Draft, la description dit « Agents IA » et « Quitter » mène à toute la liste (P-8).
- [ ] **H-10. Colonne du milieu.** Où : une page de l'espace Organisation, et la page d'un agent IA (compte admin). Voir : bloc Organisation sans monogramme (ni dans le bloc ni dans les lignes du menu d'organisation) ; pas de titre de groupe « ORGANISATION » au-dessus des entrées Entités, Utilisateurs, Connexions, Réglages ; sur la page d'un agent IA, un encart bordé « Numéros WhatsApp de l'organisation » avec le lien « Ouvrir Connexions ↗ » en pied de colonne (admin seulement). Vous voyez ce lien sans le chercher ? (forme laissée au builder). « Marque et connaissances » reste grisé Soon avec sa bulle.
- [ ] **H-11. Entités, Utilisateurs, Connexions.** Où : Organisation › chaque page. Voir : titre seul, sans parents ; descriptions Entités « {phrase existante} · n entités actives », Utilisateurs « n membres · n invitations en attente », Connexions la phrase existante ; bouton rond « Nouvelle entité » (icône boutique), « Inviter un utilisateur » (icône utilisateur), « Raccorder un compte WhatsApp » (glyphe WhatsApp). Clic : même fenêtre ou même tiroir qu'avant ; Connexions mène à Raccorder. Une seule fois le même bouton par page : sur Connexions sans aucun compte, c'est l'encart vide qui porte l'action, pas de bouton rond (à voir sur Atelier Nord si elle n'a pas de compte). **Dépend de la vague finale** : au HEAD actuel, le bouton rond de Connexions est visible pendant le chargement puis masqué si aucun compte n'existe ; l'attendu (jamais de bouton rond sans compte, même pendant le chargement) n'est vrai qu'après la correction. La phrase de description d'Entités passe-t-elle sur deux lignes (spec 2.1 : une ligne courte) ? (P-9)
- [ ] **H-12. Raccorder un compte et Réglages.** Où : Connexions › Raccorder un compte WhatsApp, puis Réglages. Voir : Raccorder : parents « Connexions » (cliquable), titre « Raccorder un compte WhatsApp », aucune action ; la carte « Connexion Meta » reste grisée Soon (bulle « Disponible prochainement : le raccordement en un clic avec Facebook. »). Réglages : pas de parents, aucune action, description « Règles qui s'appliquent à tous les membres de l'organisation Agence Démo. » (K-14).
- [ ] **H-13. Usage de l'organisation.** Où : rail › Usage. Voir : pas de parents ; titre « Usage et coûts » ; description « Toute l'organisation · 30 derniers jours » ; période à droite, pas de bouton rond. Filtré sur Boutique Lyon (colonne) : parents « Usage et coûts » (lien), titre « Boutique Lyon », description « Entité · 30 derniers jours ». Réseau lent avec ce filtre : nom de l'entité en squelette pendant la lecture. Adresse `/fr/usage?entity=ID_NORD` (entité d'une autre organisation) : titre « Entité indisponible », parents « Usage et coûts », aucun nom « Atelier » nulle part, pas de tableau ni de période, lien « Voir l'usage de toute l'organisation ».
- [ ] **H-14. Mon compte.** Où : rail › Compte, puis Préférences, Sécurité. Voir : pas de parents (« Mon compte » n'est plus dans l'en-tête) ; titre = le nom de la page ; phrase existante en description (Sécurité n'en a pas) ; aucune action.
- [ ] **H-15. Page réservée aux administrateurs.** Où : compte conseiller, adresses `/usage`, `/agents/support-demo/usage`, `/agents/new`, `/organisation/entites`. Voir : à la même adresse, le cadre normal ; titre « Page réservée aux administrateurs » ; en description « Cette page de l'organisation Agence Démo est réservée aux administrateurs. » ; ni parents ni action ; lien « Retour aux agents IA ».
- [ ] **H-16. Entité d'une autre organisation dans l'adresse (liste).** Où : admin d'Agence Démo, adresse `/fr?entity=ID_NORD`, puis `/fr?entity=99999`, puis `/fr/agents/new?entity=ID_NORD`. Voir : liste : parents « Agents IA », titre « Entité indisponible », encart « Cette entité n'est pas une entité active de votre organisation. » avec « Voir tous les agents IA », liste vide, pas de bouton rond ; aucun nom d'Atelier Nord nulle part ; plus de repli silencieux sur toute la liste. Assistant : champ Entité non prérempli, « Quitter » mène à toute la liste.
- [ ] **H-17. Bouton rond collant et ordre du clavier.** Où : une page longue (page d'un agent IA, ou assistant étape 2 dans une fenêtre réduite en hauteur). Faire : défiler vers le bas. Voir : le bouton rond reste visible en haut à droite et un clic l'atteint ; au repos son centre est à la hauteur du titre ; rail et colonne gardent la pleine hauteur. Tab depuis le titre : les actions (« Simuler », période) puis le bouton rond. Le petit « + » en exposant touche un peu l'icône : lisible ? (P-10)
- [ ] **H-18. Droits du bouton rond et de « Simuler ».** Où : compte conseiller (fenêtre privée). Voir : liste des agents IA sans bouton rond ; Entités et Utilisateurs : page réservée (H-15), donc ni bouton rond ni action ; « ▶ Simuler » présent sur la page d'un agent IA. Côté admin : bouton rond partout où il est décrit ci-dessus.
- [ ] **H-19. Nom très long.** Où : Organisation › Entités › Renommer, 80 caractères (par exemple le mot « Boutique » répété, si la limite de la page l'accepte), puis la liste filtrée sur cette entité et la page d'un agent IA de cette entité. Voir : le titre et les parents sont tronqués sur une ligne, jamais sous le bouton rond ni sur « Simuler », le nom entier en infobulle au survol. Remettre « Boutique Lyon ».
- [ ] **H-20. Thème sombre de l'en-tête.** Où : Mon compte › Préférences › Sombre, puis les pages ci-dessus. Voir : parents, titre, description et bouton rond (fond menthe, icône lisible), bulles lisibles. Revenir en clair.

### K. Corrections 1 à 15 (spec 3)

- [ ] **K-1. Moteur injoignable (blocant).** Quatre cas, moteur arrêté (Ctrl+C dans le terminal 1) puis relancé à la fin de chacun.
  - Navigation : sur la liste, sans recharger, clic rail › Organisation : le cadre (rail, colonne, bloc Organisation) reste, la page dit sur place qu'elle n'a pas pu charger les entités ; jamais l'écran « Une erreur est survenue. ».
  - Rechargement : recharger `/fr` : cadre neutre (rail réduit à la marque, Aide, Compte ; colonne vide, aucun nom d'organisation), titre « Impossible de lire votre session pour le moment. » et « Réessayer ». Relancer le moteur puis « Réessayer » : pendant la lecture le bouton reste en place, indisponible, « Lecture en cours. » ; puis la liste revient avec le cadre complet.
  - **Aucune organisation rechargée (D-108, D-109, à rejouer).** C'est le cas non conforme de la première recette ; l'exécution n'a pas pu le reproduire sur le build de test (la recette tournait sur `npm run dev`, comme ici). Suspendre Agence Démo et Atelier Nord (SQL de la section 11), se reconnecter : page « Aucune organisation ». Moteur arrêté, recharger : « Impossible de lire votre session pour le moment. » avec « Réessayer » (pas d'écran « Une erreur est survenue. »). Puis, toujours moteur arrêté, cliquer « Mon compte » dans le rail : même message, cadre neutre. Remettre Agence Démo active (SQL de la section 11) et relancer le moteur. Si l'écran d'erreur global réapparaît, notez l'adresse exacte et le geste juste avant : c'est le défaut à reprendre.
  - **Dépend de la vague finale (M-1 de la revue d'isolation).** Autre utilisateur : moteur arrêté, recharger `/fr` (cadre neutre), relancer le moteur, puis dans un autre onglet du même navigateur se connecter avec un autre compte (par exemple `conseiller@wabagent.local`), revenir au premier onglet et « Réessayer » : aucun bandeau ne nomme une organisation de l'utilisateur précédent (« Vous n'avez plus accès à … »). Au HEAD actuel, ce bandeau peut s'afficher.
  - Écriture : Organisation › Entités › Renommer, moteur arrêté, enregistrer : « Action impossible pour le moment. Réessayez. » sur la ligne, adresse inchangée, jamais un renvoi vers la connexion ni la perte du cadre.
- [ ] **K-2. Simulateur.** Où : page de « Support technique » › « ▶ Simuler ». Voir : titre « Simuler Support technique » (pas la clé brute) ; en-tête du fil avec le nom de l'agent IA et son initiale (jamais « ? ») et « Simulation » (sans « en ligne ») ; bulles lisibles en clair et en sombre ; champ de saisie sombre en sombre ; placeholder lisible. Envoyer un message : l'agent IA répond (avec les clés de `seed-credentials` ; sans elles : « problème technique »). Moteur arrêté puis envoyer : la bulle d'échec est lisible (étiquette « Non envoyé », « Renvoyer ») dans les deux thèmes.
- [ ] **K-3. Thème sombre.** Où : Préférences › Sombre, puis liste, page d'un agent IA (Dernières conversations), assistant étapes 2 et 3. Voir : les boîtes (cartes, tableaux) sont plus sombres que le fond (`--surface: #03130e`, P-4) ; textes principaux, secondaires et de plus petite taille lisibles ; bandeau « Simulation » de l'étape 3 de l'assistant lisible ; initiales des Dernières conversations lisibles ; étiquettes des champs de lead de l'étape 2 lisibles. Un test calculé garde les contrastes (au moins 4,5:1) ; `--muted-2` sombre est passé de `#7E938A` à `#8A9F95`.
- [ ] **K-4. Mention « Ne répond pas » en point rouge.** Où : compte en erreur (SQL de la section 7, la Whitelist de Support technique non vide). Voir, aux quatre endroits qui montrent la pastille (liste colonne Statut, ligne de N1 dans Connexions, colonne de l'agent IA, titre de sa page) : un point rouge de 8 px en haut à droite de la pastille Preview, sans texte « Ne répond pas » à côté ; survol ou clic sur le point : bulle « Ne répond pas : compte WhatsApp en erreur », rien d'autre ne se passe ; dans la liste, le clic sur le point n'ouvre pas la page de l'agent IA (K-12). Dans la colonne de la liste, l'entrée « Ne répond pas » compte 1 avec son point rouge. Dans Santé : étiquette rouge « Ne répond pas » dans l'en-tête du panneau (plus de ligne « voir l'encart Statut », P-11) ; encadré rouge de l'encart Statut avec « Ouvrir Connexions ↗ ». Remettre le compte (« Vérifier maintenant »).
- [ ] **K-5. Whitelist vide : un état, pas une erreur.** Où : page de Support technique (compte connecté), retirer votre numéro de la Whitelist, « Enregistrer ». Voir, aux mêmes quatre endroits : une étiquette neutre « Whitelist vide » (fond blanc, contour gris, aucun rouge) à côté de la pastille, bulle « Ajoutez un numéro à la Whitelist pour que cet agent IA réponde. » ; dans Santé, étiquette neutre « Whitelist vide » ; dans l'encart Statut, encadré neutre « Whitelist vide » avec « Ajoutez un numéro à la Whitelist pour que cet agent IA réponde. » et « Ajouter un numéro à la Whitelist ». L'agent IA reste compté dans l'entrée « Ne répond pas » de la colonne (P-2). Avec en plus le compte en erreur : l'encart « Cet agent IA ne répond à personne : sa Whitelist est vide. » est neutre (plus d'ambre) sous l'encadré rouge du compte ; deux textes pour le même état (P-3). Remettre votre téléphone dans la Whitelist.
- [ ] **K-6. Compte en erreur : bandeau de Connexions.** Où : SQL de la section 7 (`error_reason='token_invalid'`), Organisation › Connexions. Voir : la tête du bandeau est « Jeton refusé par Meta. » (la tête propre au motif `token_invalid`, inchangée), suivie de « Vérifiez de nouveau ; si cela continue, remplacez les identifiants. » (conseil adouci) ; boutons « Vérifier maintenant » puis « Remplacer les identifiants » dans le bandeau. « Vérifier maintenant » ouvre la fenêtre de vérification et remet le compte ; l'entrée « Vérifier maintenant » du menu « Gérer » reste. Le bandeau garde le ton rouge (C-12, P-5). L'encart Numéro de la page de l'agent IA garde ses textes, sans bouton. Autres causes, à valider sur lecture (« La dernière vérification du compte a échoué. » remplace « Le compte est en erreur. » seulement pour un motif autre que `token_invalid` et `signature_rejected`, qui gardent leur tête propre) :
  - motif `other` avec identifiants refusés (même commande SQL, `error_reason='other'` et un `error_detail` quelconque) : « La dernière vérification du compte a échoué. » puis « Motif : … » et « Vérifiez de nouveau ; si cela continue, remplacez les identifiants. » avec les deux boutons ;
  - motif `signature_rejected` : « Les messages reçus ne sont pas signés avec le secret de l'app enregistré ici. » puis le même conseil ;
  - identifiants illisibles (`error_reason='other'`, `error_detail='Identifiants enregistrés illisibles'`) : tête « La dernière vérification du compte a échoué. », « Retirez le compte puis raccordez-le de nouveau. », « Vérifier maintenant » sans « Remplacer les identifiants » ; compte qui ne peut pas être raccordé (`error_reason='other'`, `error_detail='Ce compte ne peut pas être raccordé. Contactez le support.'`) : « Ce compte ne peut pas être raccordé. Contactez le support. » avec « Vérifier maintenant » seulement ; scénarios `account-error-unreadable` et `account-error-cannot-connect` du faux moteur (annexe) ;
  - cause inconnue (« Vérifiez de nouveau pour connaître le motif. ») : non reproductible avec le moteur, qui donne toujours une cause à un compte en erreur ; couvert par les tests, à valider sur lecture.
- [ ] **K-7. Brancher sur le numéro d'un compte en erreur.** Où : compte en erreur (SQL de la section 7) ; libérer N1 (mettre « Support technique » Offline, puis le débrancher de N1 depuis Connexions › Gérer). Voir :
  - Connexions › N1 (libre) › « Brancher sur un agent IA » : actif ; dans la fenêtre, « Support technique » (Offline) et un agent IA Draft sont choisissables ; « Accueil Lyon » (Preview) est grisé avec « Le compte WhatsApp de ce numéro n'est pas connecté. ». Brancher « Support technique » : le moteur l'accepte, il reste Offline.
  - Page d'un agent IA Draft › « Brancher un numéro » : les numéros du compte en erreur sont choisissables.
  - Page d'un agent IA Preview ou Online : le numéro d'un compte en erreur est grisé avec sa raison, dite une fois sous l'en-tête du compte.
  - Remettre le compte (« Vérifier maintenant ») et l'état de départ.
- [ ] **K-8. Assistant : encadré d'enregistrement.** Où : nouvel assistant, « Créer et tester », puis modifier l'étape 2 sans recliquer. Voir : « « {nom} » est dans la liste des agents IA, en Draft. Vos dernières modifications ne sont pas encore enregistrées : elles sont enregistrées par « Créer et tester » ou en passant à l'étape suivante. ». Cliquer l'étape 3 : les modifications sont enregistrées (D-125).
- [ ] **K-9. Moyenne par jour.** Où : page d'un agent IA, carte « Coût LLM » (après quelques messages au simulateur), puis « Usage et coûts » en 7 j, 30 j, 90 j. Voir : la moyenne « ~{montant}/jour » = le total de la période divisé par le nombre de jours de la période (30 pour la carte, « 30 derniers jours » ; 7, 30 ou 90 sur la page d'usage), pas par les jours d'activité. Avec `seed-pricing`, le coût n'est pas à 0,00 $.
- [ ] **K-10. Rail et colonne pleine hauteur, même conteneur.** Où : page longue (assistant étape 2, page d'un agent IA), défiler en bas. Voir : le rail sombre et la colonne blanche couvrent toute la hauteur de la fenêtre, y compris en bas de page, sans trait de défilement du document ; toutes les pages ont le même conteneur pleine largeur (la page d'un agent IA n'est plus étroite) ; un formulaire ou un encart garde sa propre largeur de lecture.
- [ ] **K-11. Rail : bulles, icône active, Offline.** Où : survol et Tab sur chaque entrée du rail, l'entrée active comprise. Voir : une bulle de deux lignes, le nom en gras puis une phrase (Organisation « Entités, utilisateurs, connexions et réglages. », Agents IA « La liste et la page de chaque agent IA. », Usage « Coûts des agents IA de l'organisation. », Compte « Vos organisations, préférences et sécurité. », et pour Leads, Reprise, Aide la phrase « Disponible prochainement… ») ; la marque n'a pas de bulle ; l'icône de l'entrée active est en menthe clair (initiales du Compte actif comprises) ; Offline est un gris neutre dans les deux thèmes (pastille et point), distinct de Draft. Lecteur d'écran : le nom de l'entrée reste « Agents IA » et la bulle lit la phrase seule (P-12).
- [ ] **K-12. Liste : toute la ligne cliquable.** Où : liste des agents IA. Voir : un clic n'importe où sur la ligne, flèche comprise, ouvre la page de l'agent IA ; le nom reste le seul lien au clavier (Tab) ; le point rouge ou l'étiquette « Whitelist vide » (K-4, K-5) ouvrent leur bulle sans ouvrir la page ; la ligne n'a pas de focus visible autour de toute la ligne, seulement autour du nom (P-13).
- [ ] **K-13. Organisation suspendue.** Où : deux cas. (a) Ouvrir Atelier Nord par le sélecteur, suspendre Atelier Nord (`sqlite3 store/demo.db "UPDATE clients SET status='suspended' WHERE client_id='atelier-nord';"`), recharger : la page ouvre Agence Démo avec le bandeau « Atelier Nord est suspendue. Contactez le support. » (admin de cette organisation). (b) Atelier Nord suspendue, Agence Démo ouverte, recharger : aucun bandeau (l'organisation n'a pas été tentée). Voir aussi le sélecteur : le nom entier (pas tronqué), puis le rôle et la pastille « Suspendue » sur la même ligne sous le nom, puis la phrase « Ne peut pas être ouverte : contactez l'administrateur de l'organisation ou le support. » ; plus de colonne étroite. Le bandeau ne nomme jamais l'organisation ouverte. Remettre `status='active'`. À trancher : la pastille est à côté du rôle, sous le nom (P-6).
- [ ] **K-14. Textes et navigation.**
  - Réglages : « … de l'organisation Agence Démo. » (H-12).
  - Chaque changement de page ouvre en haut : défiler en bas de la liste, cliquer une page ; la nouvelle page s'ouvre en haut ; idem à chaque étape de l'assistant et après un changement de filtre.
  - Message du raccordement (avec le compte Meta de Ravivo) : Connexions › Raccorder, saisir comme identifiant « Compte WhatsApp (WABA) » l'identifiant d'un numéro (pas celui de la WABA), avec un vrai jeton : « Cet identifiant n'est pas celui d'un compte WhatsApp Business (WABA). Reprenez l'identifiant du compte WhatsApp Business dans le Gestionnaire WhatsApp, pas celui d'un numéro ni de l'app. », sous le champ. À valider avec Meta ; sans jeton valide, le cas se lit dans les tests du moteur.
  - « Quitter » de l'assistant ramène à la liste d'où l'on venait (H-9).
- [ ] **K-15. Commentaires des contrats et préparation.** `packages/contracts/src/bot-status.ts` : commentaires seulement, au vocabulaire Draft, Preview, Online, Offline, Whitelist ; sans effet à l'écran (valider sur lecture : la sortie compilée est identique). Préparation (0.1) : `seed-credentials` et `seed-pricing` sont dans le guide ; le simulateur répond et les coûts s'affichent (K-2, K-9).

### P. Décisions du PO à trancher

Ces décisions ont été prises en cours d'exécution sans vous. Chacune est visible à l'écran : dites « garder » ou ce que vous préférez.
- [ ] **P-1. Assistant : numéro d'un compte en erreur non choisissable à l'étape 4 (écart à la spec 3.7).** La spec disait « brancher un agent IA Draft ou Offline sur un compte en erreur : Connexions et assistant ». Dans l'assistant, l'étape 4 ne branche rien (le branchement a lieu à l'activation) et l'activation est refusée sur un compte en erreur : proposer ce numéro serait un choix sans effet, que le projet interdit (élément d'interface sans effet). Le numéro reste donc grisé à l'étape 4, avec sa raison ; Connexions et la page de l'agent IA le permettent. À voir : nouvel assistant jusqu'à l'étape 4 avec le compte en erreur. Garder, ou faire brancher le numéro par « Laisser en Draft » (changement plus large) ?
- [ ] **P-2. Point rouge de l'entrée « Ne répond pas » pour des agents IA à Whitelist vide seulement.** La colonne de la liste garde un point rouge sur l'entrée « Ne répond pas » (compteur) même quand les seuls agents IA concernés ont une Whitelist vide, alors qu'aucun n'est rouge dans la liste. Garder ce point rouge, ou un point neutre dans ce cas ?
- [ ] **P-3. Deux textes pour l'état Whitelist vide.** L'encart « Cet agent IA ne répond à personne : sa Whitelist est vide. » (avec « Ajouter un numéro à la Whitelist ») et l'encadré « Whitelist vide / Ajoutez un numéro à la Whitelist pour que cet agent IA réponde. » disent la même chose, l'un derrière l'autre quand une autre cause passe en premier. Les aligner en un seul texte, ou garder les deux ?
- [ ] **P-4. Boîtes plus sombres que le fond (`--surface: #03130e`, thème sombre).** Votre valeur validée est plus sombre que le fond de page (`--bg: #0C1A15`) : les boîtes sont donc plus foncées que le fond, et la bulle de l'agent IA du simulateur plus foncée que son fil. Lisible, mais c'est un choix visuel. Garder ?
- [ ] **P-5. Ton du bandeau d'un compte en erreur (C-12).** Le texte est adouci et « Vérifier maintenant » est dans le bandeau, mais la couleur reste rouge : un compte en erreur fait réellement taire l'agent IA. Garder le rouge, ou passer à un ton plus calme (changement d'un jeton) ?
- [ ] **P-6. Pastille « Suspendue » à côté du rôle, sous le nom (spec 3.13).** La spec dit « la phrase passe sous le nom » ; vous aviez parlé d'une bulle. Le menu montre : nom entier, puis rôle et pastille, puis la phrase. Garder cette forme, ou une bulle au survol ?
- [ ] **P-7. Organisation à une seule entité : l'entité n'est pas dans les parents de l'assistant.** Sur Atelier Nord (une seule entité, « Atelier Nord Paris »), l'étape 1 n'affiche pas de champ Entité et rien n'y est « choisi » : les parents restent « Agents IA » seul, même après la création, alors que le moteur attribue l'entité. Garder la lettre de la spec, ou nommer l'entité unique ?
- [ ] **P-8. « Quitter » après création dans l'assistant.** Après « Créer et tester », « Quitter » ramène à la liste d'origine seulement si elle contient le Draft (toute la liste, filtre Draft, filtre de l'entité choisie) ; sinon à toute la liste « Agents IA », et la description le dit. Après une activation, le statut retenu est celui de l'activation ; le filtre « Ne répond pas » n'est jamais gardé après création (le web ne recalcule pas la mention). Garder ?
- [ ] **P-9. Descriptions et petits écarts de texte.** « n entités actives » (et non « n entités ») sur Entités, avec le compte retiré au-dessus du tableau ; Entités : phrase longue qui passe sur deux lignes ; Raccorder et Sécurité sans description ; encart « Entité indisponible » (texte de Claude) ; page réservée : phrase en petit gris. Garder ?
- [ ] **P-10. Bouton rond : forme.** Taille 44 px, « + » en exposant qui touche l'icône, glyphe WhatsApp tracé à la main, bouton collant par une colonne mesurée en JavaScript (au lieu d'une bande CSS, pour garder l'ordre du clavier « titre, actions, bouton rond »). Garder, ou demander un autre dessin ?
- [ ] **P-11. Santé ne renvoie plus à l'encart Statut.** La ligne rouge « ne répond pas : voir l'encart Statut » est retirée, remplacée par l'étiquette de l'en-tête du panneau. Garder ?
- [ ] **P-12. Bulles du rail : description lue.** Le nom en gras de la bulle est ignoré par le lecteur d'écran (le nom de l'entrée le dit déjà) ; seule la phrase est lue. Garder ?
- [ ] **P-13. Ligne de la liste : anneau de focus et texte.** Le lien étiré sur toute la ligne n'a son anneau de focus qu'autour du nom, et le texte de la ligne n'est plus sélectionnable à la souris. Garder ?
- [ ] **P-14. `--muted-2` en clair à 2,9:1 sur blanc.** Les textes secondaires les plus pâles (le placeholder du simulateur est passé en `--muted`) sont peu lisibles en clair ; la charte claire avait été validée au lot précédent et seul le sombre a été corrigé (4,5:1 garanti par test). Éclaircir le contraste en clair dans un lot suivant, ou le faire avant le merge ?
- [ ] **P-15. Bouton « ✕ » des champs de l'étape 2 de l'assistant.** Il est encore en `--muted-2` (même sujet que P-14). Traiter avec P-14 ?
- [ ] **P-16. Entrée « Brancher » de Connexions jamais grisée.** Avec les règles actuelles elle reste ouverte pour tout numéro présent ; l'ancien avertissement « un agent IA branché ici ne répondrait pas » disparaît (le compte reste signalé par « En erreur » et par le bandeau). Garder ?
- [ ] **P-17. Moteur injoignable : pas de référence.** Une panne du moteur s'affiche comme une panne serveur à l'endroit de l'action, sans référence de requête (le moteur n'a pas répondu). Garder ?
- [ ] **P-18. Monogrammes.** Retirés du bloc Organisation et du menu d'organisation, mais gardés dans le tableau de Mon compte › Organisations et dans l'invitation. Les retirer aussi là, ou garder ?
