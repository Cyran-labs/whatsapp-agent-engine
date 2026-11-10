# Recette guidée du lot « Restitution des erreurs et vocabulaire »

Date : 10 nov. 2026. Branche `feat/restitution-erreurs`. À faire par François en réel (moteur et back-office lancés, worktree jetable, copie de `store/demo.db`, numéro de test Ravivo), avant le merge.

Chaque étape correspond à une décision prise pendant le lot (identifiants de `.superpowers/sdd/2026-11-09-restitution-erreurs-vocabulaire/decisions-triage.md` et de l'audit `2026-11-10-audit-decisions-restitution.md`). Pour chacune : ce qu'il faut faire, ce qu'on doit voir, et une case « OK » ou « à changer ».

> **Recette passée par Claude le 10 nov. 2026** dans le navigateur (localhost:3000, organisation « Agence Démo », rôle admin).
> Légende : `[x]` OK constaté · `[ ]` + **À CHANGER** · `[ ]` + **NON TESTÉ** (raison donnée) · **À TRANCHER** = question de goût pour François.
>
> **Bilan** : 23 points OK, 1 à changer (heures de Paris), 12 non testables par moi (moteur à arrêter, journaux, téléphone, jeton à révoquer, moteur simulé, une seule organisation). Aucun blocage de merge sur les décisions du lot. À corriger avant merge, à mon avis : le menu « Gérer » coupé en bas de tableau, le numéro sur 6 lignes dans la fenêtre « Brancher un numéro », la date brute de « Dernières conversations ». Le reste est de la finition ou des choix à trancher.
>
> **État de la base après recette** : compte WABAGENT dev retiré (plus aucun compte actif), Conseiller Test désactivé sans numéro et avec une liste d'accès vide, agent « Recette Bilingue » créé en brouillon, entité « Boutique Recette » archivée.

## 0. Préparation

- [ ] Dans le `.env` du moteur : `MAILER_LOG_LINKS=true` (sinon aucun lien d'invitation ni de réinitialisation n'apparaît dans les journaux). Décision A18.
  - **NON TESTÉ par Claude** : pas d'accès au `.env`. François confirme que la préparation est faite.
- [x] Dans l'environnement du back-office : `USD_EUR_RATE=0,92` (virgule acceptée) et `USD_EUR_RATE_DATE=2026-11-10`. Décisions C-2, A13.
  - Constaté indirectement : la note des coûts affiche « au taux de 0,92 du 10 novembre 2026 ».
- [ ] Moteur et back-office redémarrés ; journaux du moteur ouverts dans un terminal.
  - **NON TESTÉ par Claude** (pas d'accès au terminal).

## 1. Statuts et vocabulaire (C-1, A8, A9, A10, A11)

- [x] Liste des agents IA : pastilles et filtres « Brouillon », « Accès limité », « Ouvert à tous », « Désactivé ». Aucun « pause », aucun « Revenir en brouillon ».
- [x] Page d'un agent IA en accès limité : actions « Ouvrir à tous », « Désactiver ».
- [x] « Désactiver » demande une confirmation (A8). OK ou à retirer ?
  - Fenêtre « Désactiver Conseiller Test ? » : « cessera de répondre à tous les contacts, y compris à ceux de la liste d'accès limité. Ses conversations sont conservées ». Bouton rouge. Avis : à garder.
- [x] Depuis « Ouvert à tous » : action « Limiter l'accès », avec une fenêtre de confirmation (A11, fenêtre ajoutée pendant le lot). La fenêtre vous convient-elle ?
  - Fenêtre « Limiter l'accès de Conseiller Test ? » claire (qui ne recevra plus de réponse, conversations conservées). Avis : convient.
  - Bonus constaté : « Réactiver pour tous » a aussi sa fenêtre, qui rappelle le coût par conversation. Bien.
- [x] Depuis « Désactivé » : « Réactiver en accès limité » et « Réactiver pour tous ».
- [x] Brancher le numéro d'un agent IA en service sur un autre agent IA : la fenêtre annonce que le premier « passera en Désactivé : il ne répondra plus » ; après coup, sa page affiche « Désactivé : son numéro a été débranché » et « Réactiver pour tous » est possible directement (A9, votre décision).
  - Testé : numéro de Conseiller Test (Ouvert à tous) branché sur Support technique depuis Connexions. Fenêtre : « Ce numéro est branché sur Conseiller Test, qui le perdra et passera en Désactivé : il ne répondra plus. » OK.
  - Page de Conseiller Test : « Désactivé : son numéro a été débranché » (en rouge) OK. Les deux boutons de réactivation sont grisés tant qu'aucun numéro n'est branché (« Branchez un numéro WhatsApp avant d'activer l'agent IA. »). Logique.
  - Après rebranchement du numéro, « Réactiver pour tous » est actif directement (liste vide, donc « en accès limité » reste grisé). Conforme à A9.
  - **À CHANGER (mise en page)** : dans la fenêtre « Brancher un numéro » de la page agent, le numéro s'affiche sur 6 lignes (« +1 / 555 / 164 / 9072 / Test / Number ») : la colonne est trop étroite à côté des deux pastilles.
  - **À VÉRIFIER (texte)** : cette même fenêtre dit « À l'activation, Support technique sera débranché de ce numéro », mais le numéro a été pris tout de suite (Conseiller Test l'affiche « Connecté » alors qu'il est encore désactivé). Soit le texte, soit le comportement est faux.

## 2. Liste d'accès limité vide (Q-10, C-4)

- [x] Retirer le dernier numéro de la liste d'un agent IA en accès limité : enregistrement accepté, encart « Cet agent IA ne répond à personne : sa liste d'accès limité est vide. » avec « Ajouter un numéro », « Ouvrir à tous », « Désactiver ».
  - Enregistrement accepté (« Liste enregistrée. »), encart jaune avec les trois actions.
  - Détail : la phrase de statut « Cet agent IA ne répond qu'aux numéros de la liste d'accès limité. » reste affichée juste au-dessus de l'encart. Pas faux, mais redondant. Mineur.
- [ ] Écrire depuis votre téléphone à cet agent IA : aucune réponse ; le compteur « messages non servis » augmente.
  - **NON TESTÉ par Claude** (nécessite ton téléphone).
- [x] Désactiver puis « Réactiver en accès limité » avec la liste vide : refus clair avec « Ajouter un numéro ».
  - Mieux qu'un refus : le bouton est grisé d'emblée avec la raison « Réactiver en accès limité : Ajoutez au moins un numéro à la liste d'accès limité. » et le lien « Ajouter un numéro ».

## 3. Connexions (Q-5, Q-6, Q-7, A19, A23, B7)

- [x] Chaque compte et chaque numéro ont un bouton « Gérer ▾ » visible ; un numéro libre a un bouton « Brancher ».
  - Après « Débrancher », le numéro affiche « Libre » + « Brancher ». Menu du compte : Renommer, Remplacer les identifiants, Vérifier maintenant, Rafraîchir les numéros, Retirer de WABAGENT.
  - **À CHANGER (mise en page)** : les fenêtres « Débrancher Conseiller Test ? » et « Brancher le numéro sur un agent IA » ont leur titre et leur texte alignés à droite, contrairement aux autres fenêtres (alignées à gauche).
- [x] Le mot « Déconnecter » n'apparaît nulle part ; le compte se retire par « Retirer de WABAGENT » (fenêtre « Retirer {compte} de WABAGENT ? »), puis apparaît dans le repli « 1 compte retiré ».
  - « Déconnecter » absent de toutes les pages vues. Fenêtre « Retirer WABAGENT dev de WABAGENT ? » claire (numéros retirés, identifiants effacés, webhook coupé, raccorder de nouveau pour reprendre). Notification « WABAGENT dev retiré de WABAGENT. » Le repli passe de « 1 compte retiré » (il y en avait déjà un dans la base) à « 2 comptes retirés ». État vide propre : « Aucun compte WhatsApp raccordé » + bouton.
  - Fait en dernier : la base n'a plus de compte WhatsApp actif.
- [x] « Remplacer les identifiants » avec un secret faux : la liste des contrôles montre le contrôle refusé et le champ du secret est marqué en erreur avec le focus (A19).
  - Testé avec le vrai WABA ID mais un jeton et un secret factices (je n'ai pas le vrai jeton, et je ne le saisirais pas). Résultat : « La vérification du compte auprès du fournisseur a échoué. », contrôle « ✕ Jeton d'accès valide · Jeton refusé par Meta », champ du jeton en rouge avec le focus et « Refusé par le fournisseur : voir les contrôles de vérification ci-dessous. » Le mécanisme A19 fonctionne. Le cas exact « secret faux, jeton bon » reste à faire par toi.
  - **À TRANCHER (texte)** : « ✕ Jeton d'accès valide » se lit comme une affirmation contradictoire. Nommer le contrôle par ce qu'il vérifie (« Jeton d'accès ») plutôt que par le résultat attendu.
- [ ] « Rafraîchir les numéros » avec un jeton révoqué : la fenêtre dit « Jeton refusé par le fournisseur : remplacez les identifiants du compte. », sans « Réessayez » (B7).
  - **NON TESTÉ** : il faut révoquer le jeton côté Meta.
- [ ] Compte aux identifiants illisibles (cas rare : seulement sur le moteur simulé, scénario `account-error-unreadable`) : « Remplacer » et « Rafraîchir » désactivés avec la raison « retirez ce compte de WABAGENT puis raccordez-le de nouveau » (A23).
  - **NON TESTÉ** : le moteur lancé est le vrai, pas le simulé.
- [x] En anglais : « Assign to an AI agent », « Unassign », « Connect an account » (A15).
  - Constaté : « Assign to an AI agent » (menu d'un numéro libre), « Assign » (bouton), « Unassign from AI agent », « Change AI agent », « + Connect a WhatsApp account ». Libellés un peu plus longs que le brief, sens conforme.

## 4. Page de l'agent IA (A12, B25, Q-4)

- [x] Rail : « CRM · À venir » ; bloc « Organisation » avec « Numéros WhatsApp de l'organisation » pour l'admin seulement.
  - Vu en admin. Le cas conseiller (absence du bloc) n'est pas vérifiable sans compte conseiller.
- [ ] Compte en erreur : l'encart Numéro dit la cause, la conséquence (« ne peut pas répondre ») et l'action (admin) ou « Prévenez un administrateur de votre organisation. » (conseiller) ; le panneau Statut ne dit plus « répond à tous ».
  - **NON TESTÉ** : impossible de mettre le compte en erreur depuis l'interface sans casser le vrai jeton. À faire avec le moteur simulé ou un jeton révoqué.
  - Vu en passant : agent sans numéro, l'encart dit « Aucun numéro n'est branché : cet agent IA ne peut pas répondre. » + « Brancher un numéro ». Bien.
- [ ] Échecs de remise (si Meta en signale) : pastille avec le sens du code, et pour un conseiller « Prévenez un administrateur ». Le compteur ne se remet jamais à zéro et n'a pas de date (reporté à Conversations & Leads). OK pour l'instant ?
  - **NON TESTÉ** : aucun échec de remise dans la base.

## 5. Assistant de création (Q-12, Q-13, A17, A20)

- [x] « Informations à collecter » : bouton « Ajouter » ; un texte tapé sans Entrée est bien enregistré à « Créer & tester ».
  - « Budget » tapé sans Entrée, puis « Créer & tester » : au retour à l'étape Personnalité, « Budget » est bien une étiquette enregistrée. Un second clic sur « Créer & tester » ne crée pas de doublon.
- [x] Note : les informations collectées ne sont pas encore visibles ni envoyées au CRM.
  - Texte affiché sous le champ : « Elles ne sont pas encore visibles dans WABAGENT ni envoyées à votre CRM : ce sera possible avec la page Conversations & Leads. »
- [x] Deux langues, personnalité remplie seulement dans la langue non principale : le bouton est désactivé avec la raison « Décrivez la personnalité de l'agent IA en français, la langue par défaut. ».
  - Bouton grisé avec la raison, mais le texte réel est « Renseignez la personnalité de la langue par défaut (français). ». Sens conforme, formulation différente du brief. Le bouton s'active dès que le rôle et l'objectif sont remplis en français.
- [x] Mise en route : l'étape s'appelle « Brancher un numéro » (A17). OK ?
  - Oui, dans le bandeau « Mise en route » et sur l'écran final de l'assistant. Dans le fil d'étapes de l'assistant, l'étape s'appelle « Numéro » (court, acceptable). Avis : OK.
  - **À TRANCHER** : écran final « Votre agent IA est prêt », le bouton principal (vert) est « Modifier la personnalité », alors que l'action suivante attendue est « Brancher un numéro » (présent mais en carte secondaire). Et « Personnalité & contenu » est marqué « À venir » sur la page de l'agent : où mène ce bouton ?

## 6. Coûts (C-2, A13, Q-3)

- [x] Carte des coûts : « 1,84 $ (≈ 1,69 €) » (valeurs selon vos données) et la note « Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 10 novembre 2026. ».
  - Page agent, page Usage de l'agent et page Usage de l'organisation : « 0,02 $ ≈ 0,02 € », « < 0,01 $ < 0,01 € » et la note exacte.
- [x] Aucun « 0 erreur » ; barres vides quand tout est à 0 ; tokens écrits en entier (« 184 000 », A13). OK ou préférez « 184 k » ?
  - Agent neuf : graphique vide avec « Aucun coût sur la période », aucun « 0 erreur ». Tokens en entier partout (« 7 210 », « 5 493 »). Avis : garder en entier tant que les volumes sont faibles.
  - **À CHANGER (cohérence)** : la carte Tokens dit « 5 493 entrée · 1 717 sortie », mais la carte Coût de la vue d'ensemble dit « tokens in · out » et les tableaux « TOKENS IN / TOKENS OUT ». Choisir un seul vocabulaire (entrée / sortie en français).
  - **À CHANGER (lisibilité)** : « Coût par jour » de Conseiller Test : une seule barre qui remplit toute la largeur, sans axe ni date. Avec un seul jour de données, on ne lit rien. Ajouter au moins les dates, ou une largeur de barre fixe.
- [ ] Heures affichées en heure de Paris.
  - **À CHANGER (probable)** : bloc « Dernières conversations », la date est brute « 2026-11-09 20:09:02 » (format ISO, pas le format « 9 nov. 2026, 21:14 » utilisé ailleurs). L'écart d'une heure suggère de l'UTC.

## 7. Erreurs et réussites (règle §5)

- [ ] Moteur arrêté, se connecter : « Connexion impossible pour le moment. Réessayez dans un instant. » (jamais « Identifiants invalides. »).
  - **NON TESTÉ par Claude** : je ne peux pas arrêter le moteur.
- [ ] Moteur arrêté pendant une action (par exemple renommer un compte) : texte de l'écran et « Référence : … ».
  - **NON TESTÉ par Claude** : même raison.
- [x] Archiver une entité, retirer un compte, révoquer une invitation : notification qui nomme l'objet.
  - « Entité Boutique Recette archivée. » (entité créée pour le test), « Invitation à conseiller.recette@example.test révoquée. » (invitation factice créée pour le test), « WABAGENT dev retiré de WABAGENT. ». Bonus : « Invitation envoyée à … » à l'envoi.
- [ ] Deux onglets, changer d'organisation dans l'un : l'autre explique le changement au retour.
  - **NON TESTÉ** : la base ne contient qu'une organisation (« Agence Démo »), le sélecteur n'a rien à proposer.
- [x] Interface en anglais sur deux refus : aucun texte français.
  - Refus 1 : nom d'entité en double, « An entity already has this name. ». Refus 2 : réactivation sans numéro, « Reactivate for all: Assign a WhatsApp number before activating the AI agent. ». Aucun français, hors noms de données (« Agence Démo », « Conseiller Test »).

## 8. Journaux du moteur (Q-9, Q-11)

- [ ] Pendant un échange réel avec votre téléphone : aucun numéro de contact en clair, aucun prénom, aucun contenu de message, aucun corps de réponse de Meta dans les journaux.
  - **NON TESTÉ par Claude** (téléphone et terminal).
- [ ] Une invitation créée : le lien apparaît seulement parce que `MAILER_LOG_LINKS=true` est posé.
  - **NON TESTÉ par Claude** (terminal).

## 9. Loader (Q-14)

- [x] En thème sombre, les deux pastilles du loader se voient (pastille sombre `#0F7A55`, votre décision).
  - Pas de bascule de thème dans l'interface : vérifié en forçant la classe `.dark` et en dessinant les deux pastilles avec les variables `--loader-1` / `--loader-2` sur `--bg`. `--loader-1` vaut bien `#0F7A55` en sombre. Les deux pastilles se voient ; contraste calculé de la pastille sombre sur le fond : environ 3,4:1 (au-dessus du seuil 3:1 des éléments graphiques). À confirmer d'un coup d'œil sur le vrai loader.

## Reports acceptés (pour mémoire, rien à tester)

Graphique d'usage groupé par jour UTC ; date et remise à zéro des échecs de remise ; ton de l'assistant envoyé en français dans la consigne anglaise ; deux trous mineurs de la garde des journaux listés dans `CLAUDE.md`.

## Observations hors brief

- Statut « Ouvert à tous » : le bloc « 1 message non servi… ce nombre aide à décider d'ouvrir plus tôt » reste affiché alors que l'agent est déjà ouvert. Le message n'a plus de sens dans cet état. Suggestion : le masquer hors accès limité, ou reformuler.
- Statut « Désactivé » : le panneau Santé affiche toujours « tout est opérationnel ». Défendable (l'infra va bien), mais peut prêter à confusion. **À TRANCHER**.
- **À VÉRIFIER** : dans la liste des agents IA, Conseiller Test est passé de 9 messages / 1 lead à 0 / 0 après le débranchement de son numéro, alors que sa page affiche encore « Messages 30 j : 9 », « Leads : 1 ». Les compteurs de la liste semblent rattachés au numéro et non à l'agent.
- Barre latérale de la liste : la pastille « Désactivé » est orange, comme « Accès limité », alors que dans le tableau la pastille Désactivé est grise. Mineur.
- **À CHANGER (bogue d'affichage)** : le menu « Gérer ▾ » de la dernière ligne d'un tableau est coupé par le bord de la carte (vu sur Entités et sur les invitations en attente) : seul le premier choix est visible et le tableau défile à l'intérieur de la carte. « Archiver… » et « Révoquer » ne sont pas atteignables à la souris sans faire défiler. Le menu doit sortir de la carte (portal ou `overflow: visible`).
- Utilisateurs : juste après l'envoi d'une invitation, la barre latérale compte « 2 » alors que l'en-tête dit « 1 membre · 1 invitation en attente ». Le compteur inclut les invitations. Mineur, à aligner.
- Console : un avertissement d'hydratation React, causé par une extension du navigateur (`cz-shortcut-listen`), pas par l'application. Rien à faire.
