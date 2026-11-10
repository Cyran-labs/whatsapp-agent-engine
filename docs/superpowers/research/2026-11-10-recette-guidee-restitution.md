# Recette guidée du lot « Restitution des erreurs et vocabulaire »

Date : 10 nov. 2026. Branche `feat/restitution-erreurs`. À faire par François en réel (moteur et back-office lancés, worktree jetable, copie de `store/demo.db`, numéro de test Ravivo), avant le merge.

Chaque étape correspond à une décision prise pendant le lot (identifiants de `.superpowers/sdd/2026-11-09-restitution-erreurs-vocabulaire/decisions-triage.md` et de l'audit `2026-11-10-audit-decisions-restitution.md`). Pour chacune : ce qu'il faut faire, ce qu'on doit voir, et une case « OK » ou « à changer ».

## 0. Préparation

- [ ] Dans le `.env` du moteur : `MAILER_LOG_LINKS=true` (sinon aucun lien d'invitation ni de réinitialisation n'apparaît dans les journaux). Décision A18.
- [ ] Dans l'environnement du back-office : `USD_EUR_RATE=0,92` (virgule acceptée) et `USD_EUR_RATE_DATE=2026-11-10`. Décisions C-2, A13.
- [ ] Moteur et back-office redémarrés ; journaux du moteur ouverts dans un terminal.

## 1. Statuts et vocabulaire (C-1, A8, A9, A10, A11)

- [ ] Liste des agents IA : pastilles et filtres « Brouillon », « Accès limité », « Ouvert à tous », « Désactivé ». Aucun « pause », aucun « Revenir en brouillon ».
- [ ] Page d'un agent IA en accès limité : actions « Ouvrir à tous », « Désactiver ».
- [ ] « Désactiver » demande une confirmation (A8). OK ou à retirer ?
- [ ] Depuis « Ouvert à tous » : action « Limiter l'accès », avec une fenêtre de confirmation (A11, fenêtre ajoutée pendant le lot). La fenêtre vous convient-elle ?
- [ ] Depuis « Désactivé » : « Réactiver en accès limité » et « Réactiver pour tous ».
- [ ] Brancher le numéro d'un agent IA en service sur un autre agent IA : la fenêtre annonce que le premier « passera en Désactivé : il ne répondra plus » ; après coup, sa page affiche « Désactivé : son numéro a été débranché » et « Réactiver pour tous » est possible directement (A9, votre décision).

## 2. Liste d'accès limité vide (Q-10, C-4)

- [ ] Retirer le dernier numéro de la liste d'un agent IA en accès limité : enregistrement accepté, encart « Cet agent IA ne répond à personne : sa liste d'accès limité est vide. » avec « Ajouter un numéro », « Ouvrir à tous », « Désactiver ».
- [ ] Écrire depuis votre téléphone à cet agent IA : aucune réponse ; le compteur « messages non servis » augmente.
- [ ] Désactiver puis « Réactiver en accès limité » avec la liste vide : refus clair avec « Ajouter un numéro ».

## 3. Connexions (Q-5, Q-6, Q-7, A19, A23, B7)

- [ ] Chaque compte et chaque numéro ont un bouton « Gérer ▾ » visible ; un numéro libre a un bouton « Brancher ».
- [ ] Le mot « Déconnecter » n'apparaît nulle part ; le compte se retire par « Retirer de WABAGENT » (fenêtre « Retirer {compte} de WABAGENT ? »), puis apparaît dans le repli « 1 compte retiré ».
- [ ] « Remplacer les identifiants » avec un secret faux : la liste des contrôles montre le contrôle refusé et le champ du secret est marqué en erreur avec le focus (A19).
- [ ] « Rafraîchir les numéros » avec un jeton révoqué : la fenêtre dit « Jeton refusé par le fournisseur : remplacez les identifiants du compte. », sans « Réessayez » (B7).
- [ ] Compte aux identifiants illisibles (cas rare : seulement sur le moteur simulé, scénario `account-error-unreadable`) : « Remplacer » et « Rafraîchir » désactivés avec la raison « retirez ce compte de WABAGENT puis raccordez-le de nouveau » (A23).
- [ ] En anglais : « Assign to an AI agent », « Unassign », « Connect an account » (A15).

## 4. Page de l'agent IA (A12, B25, Q-4)

- [ ] Rail : « CRM · À venir » ; bloc « Organisation » avec « Numéros WhatsApp de l'organisation » pour l'admin seulement.
- [ ] Compte en erreur : l'encart Numéro dit la cause, la conséquence (« ne peut pas répondre ») et l'action (admin) ou « Prévenez un administrateur de votre organisation. » (conseiller) ; le panneau Statut ne dit plus « répond à tous ».
- [ ] Échecs de remise (si Meta en signale) : pastille avec le sens du code, et pour un conseiller « Prévenez un administrateur ». Le compteur ne se remet jamais à zéro et n'a pas de date (reporté à Conversations & Leads). OK pour l'instant ?

## 5. Assistant de création (Q-12, Q-13, A17, A20)

- [ ] « Informations à collecter » : bouton « Ajouter » ; un texte tapé sans Entrée est bien enregistré à « Créer & tester ».
- [ ] Note : les informations collectées ne sont pas encore visibles ni envoyées au CRM.
- [ ] Deux langues, personnalité remplie seulement dans la langue non principale : le bouton est désactivé avec la raison « Décrivez la personnalité de l'agent IA en français, la langue par défaut. ».
- [ ] Mise en route : l'étape s'appelle « Brancher un numéro » (A17). OK ?

## 6. Coûts (C-2, A13, Q-3)

- [ ] Carte des coûts : « 1,84 $ (≈ 1,69 €) » (valeurs selon vos données) et la note « Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 10 novembre 2026. ».
- [ ] Aucun « 0 erreur » ; barres vides quand tout est à 0 ; tokens écrits en entier (« 184 000 », A13). OK ou préférez « 184 k » ?
- [ ] Heures affichées en heure de Paris.

## 7. Erreurs et réussites (règle §5)

- [ ] Moteur arrêté, se connecter : « Connexion impossible pour le moment. Réessayez dans un instant. » (jamais « Identifiants invalides. »).
- [ ] Moteur arrêté pendant une action (par exemple renommer un compte) : texte de l'écran et « Référence : … ».
- [ ] Archiver une entité, retirer un compte, révoquer une invitation : notification qui nomme l'objet.
- [ ] Deux onglets, changer d'organisation dans l'un : l'autre explique le changement au retour.
- [ ] Interface en anglais sur deux refus : aucun texte français.

## 8. Journaux du moteur (Q-9, Q-11)

- [ ] Pendant un échange réel avec votre téléphone : aucun numéro de contact en clair, aucun prénom, aucun contenu de message, aucun corps de réponse de Meta dans les journaux.
- [ ] Une invitation créée : le lien apparaît seulement parce que `MAILER_LOG_LINKS=true` est posé.

## 9. Loader (Q-14)

- [ ] En thème sombre, les deux pastilles du loader se voient (pastille sombre `#0F7A55`, votre décision).

## Reports acceptés (pour mémoire, rien à tester)

Graphique d'usage groupé par jour UTC ; date et remise à zéro des échecs de remise ; ton de l'assistant envoyé en français dans la consigne anglaise ; deux trous mineurs de la garde des journaux listés dans `CLAUDE.md`.

## Résultats

Recette passée le 10 novembre 2026.

- Parcours guidés (sections 1 à 6 et 9) : passés par François avec Claude Desktop ; 23 points OK, défauts d'affichage relevés dans `docs/debug/2026-11-10-recette-guidee-restitution.md` et corrigés par la tâche 20 du plan (relue, deux tours de correction).
- Décisions prises pendant la recette : contrôles de vérification nommés par ce qu'ils vérifient ; panneau Santé d'un agent IA désactivé ou en brouillon qui dit qu'il ne répond pas ; bouton principal de fin d'assistant « Brancher un numéro ».
- En réel avec le numéro de test (sections 7 et 8) : connexion avec le moteur arrêté, texte « Connexion impossible pour le moment. Réessayez dans un instant. » ; message d'un contact hors liste d'accès limité non servi, journal propre ; échange complet servi (réponse reçue sur le téléphone), journaux sans numéro de contact, prénom, contenu de message ni corps de réponse de Meta ; avertissement `MAILER_LOG_LINKS` affiché au démarrage.
- Point reporté après le merge : le compteur des messages non servis est cumulatif et n'est jamais remis à zéro ; l'indice le dit, la remise à zéro à l'activation reste à décider.
