# En-tête de page et corrections de recette (suite de la refonte de la navigation)

Date : 11 nov. 2026. Branche : `feat/refonte-navigation` (avant merge). Source : recette en réel du 11 nov. 2026 (registre `.superpowers/sdd/2026-11-10-refonte-navigation/progress.md`, lignes « RECETTE »), maquettes validées par François (`.superpowers/brainstorm/66011-1794417491/content/fil-ariane-options.html`, option B, et `fil-ariane-toutes-pages.html`, « on part sur ça »).

## 1. Pourquoi

Pendant la recette, François a trouvé le haut des pages redondant (« Organisation » répété dans le rail, le bloc, le titre de groupe et le fil), le fil d'Ariane incohérent (« Entité : Boutique Lyon », entité absente de l'assistant ouvert depuis une entité), et une barre du haut qui porte peu d'information. Le fil « détermine pas mal de choses sur les pages : les informations présentes, la présence du header, les boutons ». Il veut le régler avant le merge, avec les défauts trouvés en recette.

Succès : chaque page dit où l'on est sans répéter ce que le rail et la colonne disent déjà ; l'action de création est au même endroit partout ; aucun défaut bloquant de la recette ne reste.

Anti-objectifs : un nom d'organisation ou d'entité affiché qui n'est pas celui de l'organisation ouverte ; un bouton de création visible pour qui n'a pas le droit de créer ; une page sans titre ou dont le titre se répète dans le fil.

## 2. En-tête de page (décision de François : option B)

### 2.1 Règle

- La barre du haut disparaît sur toutes les pages (y compris l'assistant et la page refusée).
- Le haut de page est dans le contenu, aligné sur la largeur des boîtes : une ligne des parents (facultative), le titre, une ligne de description, les actions.
- Première page d'un espace (cible directe d'une entrée du rail ou de la colonne) : titre seul, pas de ligne des parents.
- Page plus profonde : ligne des parents au-dessus du titre, petite, grise, chaque élément cliquable, séparés par « › ». Elle ne contient jamais le nom de l'organisation (il est dans le bloc Organisation) ni le titre de la page.
- Action de création : bouton rond flottant en haut à droite, sur la ligne du titre, qui reste visible au défilement (position collante), avec une icône de ce qu'il crée et un petit « + », une bulle au survol qui dit l'action et un nom accessible identique. Choix de François : en haut à droite, pas en bas à droite.
- Autres actions (Simuler, Quitter, période 7 j / 30 j / 90 j) : à droite du titre, alignées sur le bord droit des boîtes du dessous.
- Description : une ligne courte sous le titre, avec un nombre quand il aide.

### 2.2 Pages

| Page | Ligne des parents | Titre | Description | Actions |
|---|---|---|---|---|
| Agents IA, toute la liste | aucune | Agents IA | Tous les agents IA · n | bouton rond « Créer un agent IA » |
| Agents IA filtrée par entité | Agents IA | {entité} | Entité · n agents IA | bouton rond « Créer un agent IA dans {entité} » |
| Agents IA filtrée par statut | Agents IA | {statut} (Draft, Preview, Online, Offline) | phrase du statut · n agents IA | bouton rond « Créer un agent IA » |
| Page d'un agent IA | Agents IA › {entité} | {nom} + pastille de statut | langues | « ▶ Simuler » |
| Usage d'un agent IA | Agents IA › {entité} › {nom} | Usage et coûts | période choisie | période |
| Assistant | Agents IA › {entité choisie} | Créer un agent IA | état d'enregistrement | « ✕ Quitter » |
| Organisation › Entités | aucune | Entités | phrase existante · n | bouton rond « Nouvelle entité » |
| Organisation › Utilisateurs | aucune | Utilisateurs | n membres · n invitations en attente | bouton rond « Inviter un utilisateur » |
| Organisation › Connexions | aucune | Connexions | phrase existante | bouton rond « Raccorder un compte WhatsApp » (icône WhatsApp) |
| Raccorder un compte | Connexions | Raccorder un compte WhatsApp | phrase existante | aucune |
| Organisation › Réglages | aucune | Réglages | phrase existante | aucune |
| Usage de l'organisation | aucune | Usage et coûts | Toute l'organisation · période | période |
| Usage filtré par entité | Usage et coûts | {entité} | Entité · période | période |
| Mon compte › Organisations, Préférences, Sécurité | aucune | nom de la page | phrase existante | aucune |
| Page réservée aux administrateurs | aucune | Page réservée aux administrateurs | phrase existante | aucune |

« {entité} » dans l'assistant : l'entité choisie à l'étape 1 (préremplie depuis une liste filtrée), mise à jour quand elle change.

Choix de Claude, montrés sur la maquette et non contestés : l'entité dans la ligne des parents d'un agent IA ; le nom du filtre comme titre d'une liste filtrée ; la pastille de statut à côté du nom ; la ligne de description sous chaque titre ; l'icône du bouton rond selon l'objet créé.

### 2.3 Colonne du milieu (retour de recette, même lot)

- Bloc Organisation sans monogramme.
- Pas de titre de groupe « ORGANISATION » au-dessus des entrées de l'espace Organisation.
- Le lien « Numéros WhatsApp de l'organisation ↗ Connexions » de la colonne d'un agent IA reste, mais il doit se voir : le builder choisit la forme, contrôlée en recette.

### 2.4 Droits

Le bouton rond n'apparaît que si l'utilisateur peut faire l'action (mêmes conditions que les boutons actuels : administrateur, organisation non en lecture seule). Le conseiller ne voit ni bouton rond ni « Simuler » s'il ne l'a pas aujourd'hui (il l'a : spec de la refonte 10.3).

## 3. Corrections issues de la recette

Bloquantes :
1. Moteur injoignable : le BFF ne répond plus 500 sur `/api/auth/me` quand le moteur ne répond pas ; le cadre reste, et la page « Aucune organisation » affiche « Impossible de lire votre session pour le moment. » avec « Réessayer » (D-108, D-109, non conformes en recette).
2. Simulateur de la page d'un agent IA : titre (clé `overview.simulate` absente), nom de l'agent IA au lieu de « ? », bulles lisibles dans les deux thèmes, « simulation » sans « en ligne ».
3. Thème sombre : `--surface: #03130e` (validé par François) reporté sur la branche ; contrastes recalculés ; bandeau « Simulation » de l'étape 3 de l'assistant et initiales des dernières conversations lisibles.

Décisions de François à appliquer :
4. Mention « Ne répond pas » : pastille rouge sur la pastille de statut, motif dans une bulle au survol (liste, colonne, Connexions) ; dans Santé, étiquette rouge.
5. Whitelist vide : un état, pas une erreur : invitation neutre à ajouter un numéro, sans rouge.
6. Compte en erreur : « Vérifier maintenant » dans le bandeau, texte moins alarmant, message selon la cause (`error_cause` : support, identifiants, reconnexion) et « si cela continue, remplacez les identifiants » quand c'est la bonne action.
7. Numéro d'un compte en erreur : brancher un agent IA Draft ou Offline est permis (Connexions et assistant) ; Preview et Online refusés avec la raison (D-92, D-114).
8. Assistant : encadré « … sont enregistrées par « Créer et tester » ou en passant à l'étape suivante. » (D-125).
9. Moyenne « ~x/jour » divisée par la durée de la période (carte et pages d'usage, D-91).

Finitions :
10. Rail et colonne sur toute la hauteur, au défilement aussi ; même conteneur pleine largeur sur toutes les pages.
11. Rail : bulle courte (nom et une phrase) sur toutes les entrées, active comprise ; icône active en menthe clair ; Offline gris dans les deux thèmes.
12. Liste des agents IA : toute la ligne cliquable, flèche comprise.
13. Organisation suspendue : bandeau seulement pour l'organisation ouverte, « Contactez le support. » pour l'administrateur ; dans le sélecteur, la phrase passe sous le nom (plus de colonne étroite ni de nom tronqué).
14. Textes et navigation : Réglages « de l'organisation Agence Démo » ; chaque changement de page ouvre en haut ; message clair quand l'identifiant saisi au raccordement n'est pas un WABA (erreur Meta « nonexisting field (subscribed_apps) ») ; « Quitter » de l'assistant ramène à la liste d'où l'on venait.
15. Commentaires des contrats (`bot-status.ts`) au vocabulaire Draft, Preview, Online, Offline, Whitelist ; guide de recette : `seed-credentials` et `seed-pricing` dans la préparation.

## 4. Hors de ce lot

Refonte des rubriques de la page d'un agent IA (« rubriques bizarrement priorisées », maquette à faire) ; tableau des agents IA sur écran de portable ; raccordement automatique du webhook ; purge du `.env` ; « Marque et connaissances » ; contrôle d'accessibilité automatique (D-143).

## 5. Impact multi-organisation

- Ligne des parents et titres : le nom d'entité vient de la liste des entités de l'organisation ouverte, déjà lue par la page ; jamais d'un paramètre d'adresse affiché tel quel. Une entité inconnue de l'organisation ouverte donne « Entité indisponible » (règle existante D-104), jamais un nom d'une autre organisation. Test : liste filtrée sur l'identifiant d'une entité d'une autre organisation, aucun nom affiché.
- Bouton rond : mêmes conditions de droit que les boutons qu'il remplace ; test par rôle (administrateur le voit, conseiller ne le voit pas, organisation suspendue en lecture seule ne le voit pas).
- Correction 7 (branchement sur un compte en erreur) : le moteur applique déjà la règle ; l'écran ne fait que l'afficher, il n'ajoute aucune écriture. Test : la décision d'écran appelle `decideAssign` des contrats, pas une règle recopiée.
- Correction 1 : une lecture de session en échec n'affiche aucune donnée d'organisation mise en cache d'une session précédente.

## 6. Laissé au builder

Forme exacte des icônes du bouton rond, ombre et taille ; forme du lien vers Connexions dans la colonne d'un agent IA ; découpage technique (un composant d'en-tête unique qui remplace `PageBar`, sélecteur `data-page-action` gardé pour les parcours e2e).

## 7. Précisions après relecture (choix de Claude, à contester)

1. Whitelist vide (corrections 4 et 5) : présentation seule. Le moteur garde le motif `empty_allowlist` dans `decideResponding` et le test d'équivalence avec `checkRoute` ne change pas. À l'écran, ce motif n'a ni pastille rouge, ni étiquette rouge dans Santé, ni encadré rouge : une marque neutre « Whitelist vide » et l'invitation « Ajoutez un numéro à la Whitelist pour que cet agent IA réponde. » avec le lien d'ajout. Il reste compté dans le filtre « Ne répond pas » de la liste, qui dit ce qui se passe.
2. Bandeau d'organisation suspendue (correction 13) : il ne s'affiche que lorsque l'utilisateur a tenté d'ouvrir une organisation suspendue (sélecteur, lien, organisation enregistrée au rechargement), et il nomme celle-là. Il ne s'affiche plus pour une autre organisation suspendue dont l'utilisateur est membre.
3. Session illisible (correction 1) : si une session valide a déjà été lue, le cadre de cette session reste (rail, colonne, bloc Organisation) et la page affiche sur place « Impossible de lire votre session pour le moment. » avec « Réessayer » ; aucune donnée de page n'est relue ni montrée d'une autre organisation. Au premier chargement sans session lue, cadre neutre : rail réduit à la marque, Aide et Compte, colonne vide, même message et « Réessayer ».
4. États absents du tableau 2.2 :
   - liste filtrée « Ne répond pas » : parents « Agents IA », titre « Ne répond pas », description « n agents IA » ;
   - liste filtrée sur une entité inconnue de l'organisation ouverte : parents « Agents IA », titre « Entité indisponible », liste vide, lien vers toute la liste (fin du repli silencieux) ;
   - sections Soon d'un agent IA : mêmes parents que la page de l'agent IA plus son nom (« Agents IA › {entité} › {nom} »), titre de la section ;
   - agent IA en chargement : squelette à la place du nom dans le titre et dans les parents ; lecture échouée : titre « Agent IA indisponible », parents « Agents IA » ;
   - assistant sans entité choisie : parents « Agents IA » seul.
5. État vide : quand une page montre déjà l'action dans son encart vide (aucun compte, aucun agent IA, aucune entité), le bouton rond est masqué ; une action n'apparaît jamais deux fois.
6. Assistant : la ligne grise qui dit ce que fait la sortie passe dans la description sous le titre ; elle nomme la vraie destination (la liste d'origine, filtrée ou non) et l'état d'enregistrement.
