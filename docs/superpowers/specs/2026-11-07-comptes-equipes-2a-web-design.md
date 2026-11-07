# Comptes et équipes, plan 2a (app web) : design

Date : 7 novembre 2026. Statut : en revue. Spec parente : `2026-11-07-comptes-et-equipes-design.md` (fait autorité sur les rôles, les droits, l'API et la migration ; ce document ne la répète pas).

## 1. Intention

Le plan 1 a livré dans le moteur les organisations, les entités, les rôles par périmètre et les invitations à accepter. L'app web n'en exploite rien : elle tourne grâce au repli mono-organisation. Le plan 2a rend tout cela utilisable par un admin d'organisation, un super admin et un membre invité, et profite de ce passage sur tout le chrome pour livrer deux décisions de François prises pendant les maquettes : la nouvelle charte (accent menthe) et un rail latéral sur chaque page.

Le moteur et l'app web ne sont déployés nulle part. Le chantier Infra vient après le plan 2a et le plan 2b (voir §11) : François veut un produit au point avant de le mettre en ligne.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. Organisation active choisie dans le bandeau, mémorisée, envoyée au moteur à chaque appel.
2. Espace Organisation pour l'admin : Entités, Utilisateurs, Réglages.
3. Agents IA rattachés à une entité : visibles, filtrables, choisis à la création.
4. Page d'acceptation d'invitation pour un compte neuf et pour un compte existant.
5. Menu utilisateur sous un avatar et page Mon compte (organisations, préférences, sécurité avec changement de mot de passe), parcours « mot de passe oublié ».
6. Charte Émeraude·Menthe sur toute l'app, rail latéral sur chaque page, textes FR et EN corrigés.

**Non-objectifs (plan 2b ou plus tard)**

- Assistant de mise en ligne complet (numéro WhatsApp, activation) et écran Organisation › Connexions : plan 2b, après l'analyse Meta Embedded Signup.
- Page Personnalité & contenu de l'agent IA (prompt, base de connaissances) : chantier à part.
- Nom affiché des utilisateurs, quitter une organisation, refuser une invitation, mobile.
- Les quatre règles de gestion des réglages (§6 de la spec parente) dans l'UI.

**Anti-objectifs**

- Un élément d'interface sans effet qui ne le dit pas (bouton, réglage, rôle). D'où l'encart sur manager et conseiller, l'absence de bouton Enregistrer dans Réglages, l'absence d'entrée « Mon compte » vide.
- Un lien d'invitation affiché dans l'UI, ou une réponse d'invitation qui révèle si l'adresse a un compte.
- Agir dans une organisation sans le voir : l'organisation active est toujours lisible quand l'utilisateur en a plusieurs.
- Régression des écrans existants (vue d'ensemble agent IA, usage, simulateur, assistant).

## 3. Maquettes de référence

Validées par François le 7 novembre 2026, dans `.superpowers/brainstorm/4357-1794068656/content/` (non versionné, conservé localement). À suivre au pixel. Versions finales :

| Sujet | Fichier |
|---|---|
| Sélecteur d'organisation | `01-selecteur-organisation-v4.html` (variante A) |
| Menu utilisateur compact | `03-menu-compact-mon-compte-v4.html` (bloc du haut) |
| Palette | `06-palette-menthe.html` (succès : option B, vert franc) |
| Rail partout, Agents IA, Usage, Mon compte › Organisations | `09-rail-partout.html` |
| Mon compte › Préférences et Sécurité (contenu) | `04-mon-compte-onglets-v4.html` (blocs du bas ; les onglets sont remplacés par le rail de `09`) |
| Organisation › Entités | `05-organisation-entites-v4.html` |
| Organisation › Utilisateurs | `07-organisation-utilisateurs-v2.html` |
| Organisation › Réglages, assistant étape 1 | `08-reglages-et-agents-ia.html` (le filtre déroulant de ce fichier est remplacé par le rail de `09`) |
| Acceptation d'invitation | `10-acceptation-invitation.html` |

Les autres fichiers du dossier sont des versions intermédiaires.

## 4. Charte Émeraude·Menthe

Décision François : l'accent ambre devient menthe **pour toute la charte**. Principe : le menthe remplit (boutons, fonds doux), l'encre menthe trace (textes, soulignements, liserés, bordures actives).

| Jeton | Avant | Après |
|---|---|---|
| `--accent` | `#F59E0B` | `#6EE7B7` |
| `--accent-hover` | `#D97706` | `#34D399` |
| `--accent-soft` | `#FEF3C7` | `#6ee7b729` |
| `--accent-ink` | (absent) | `#0F7A55` |
| `--accent-fg` (texte sur accent) | `#14322A` | `#14322A` (inchangé) |
| `--success` / `-soft` / texte | `#10B981` / `#D1FAE5` / `#0a7a55` | `#16A34A` / `#DCFCE7` / `#15803D` |
| `--warning` | `#F59E0B` | inchangé (reste ambre : « En pause », invitation en attente) |

- Tout texte en couleur d'accent passe sur `--accent-ink` (aujourd'hui `text-accent-hover`, 10 occurrences).
- Repères fins : onglet actif, entrée de rail active, champ actif passent à 3 px en `--accent-ink` ; l'entrée de rail active prend en plus le fond `--accent-soft`.
- Mode sombre : mêmes jetons d'accent ; vérifier que `--accent-ink` reste lisible sur `--surface` sombre, sinon le définir à `--brand-mint` en sombre (choix du rédacteur, à confirmer visuellement en live).
- Référence : `marketing/design-reference-emeraude-ambre.html` est mise à jour avec ces jetons et renommée `design-reference-emeraude-menthe.html` (choix du rédacteur ; mettre à jour les liens qui la citent).
- Toujours aucun dégradé.

## 5. Chrome : bandeau, menu utilisateur, rail

**Bandeau** (de gauche à droite) : `● WABAGENT`, séparateur, sélecteur d'organisation, nav globale (« Agents IA », « Usage & coûts », « Organisation » pour l'admin seulement ; « Paramètres » grisé disparaît), puis l'avatar seul à droite. Langue, thème et déconnexion quittent le bandeau.

**Sélecteur d'organisation**

- Visible si l'utilisateur a plusieurs organisations dans `/auth/me`, toujours pour le super admin.
- Bouton : monogramme (initiales du nom) + nom + caret. Menu : une ligne par organisation (monogramme, nom, rôle résumé avec « lecture seule » le cas échéant, coche sur l'active). Champ de recherche au-delà de 6 organisations.
- Statut « Suspendue » : `/auth/me` ne renvoie le statut d'organisation qu'au super admin ; les autres comptes ne reçoivent que leurs organisations actives (choix moteur du plan 1). La ligne grisée « Suspendue » n'existe donc que pour le super admin, non cliquable.
- Choisir une organisation pose le cookie httpOnly `wab_org` et ramène à la liste des agents IA.
- Connexion : une organisation, sélection automatique ; plusieurs, dernière utilisée (cookie encore valable et organisation toujours présente dans `/auth/me`), sinon la première.
- Dans l'espace d'un agent IA, le sélecteur reste visible, suivi du fil d'Ariane « Agents IA › nom ».

**Menu de l'avatar**

- Avatar : initiales tirées de l'e-mail (`claire.bernard@` donne CB, `contact@` donne C), pas de nom en base.
- Contenu : e-mail, « rôle · organisation active », « Mon compte », séparateur, « Se déconnecter ».
- Super admin : pastille blanche cerclée d'émeraude sur l'avatar, badge « Opérateur WABAGENT » dans le menu, rôle affiché « Admin implicite ».
- Sur les pages Mon compte, l'avatar porte un anneau menthe (aucune entrée de nav n'est active).

**Rail latéral sur chaque page.** Règle : le bandeau dit où l'on est, le rail liste ce qu'il y a dedans. Même largeur (236 px), même en-tête (petit libellé en capitales + titre serif), mêmes groupes. Seul l'assistant de création garde son stepper plein écran.

| Zone | En-tête | Entrées |
|---|---|---|
| Agents IA | « Agents IA » / nom de l'organisation | Tous les agents IA ; groupe Entités (si plus d'une entité active) ; groupe Statut (Actifs, En pause, Brouillons) ; compteurs |
| Un agent IA | nom + statut | sections actuelles, inchangées |
| Usage & coûts | « Usage & coûts » / organisation | Toute l'organisation ; groupe Entités (si plus d'une) |
| Organisation | « Organisation » / nom | Entités, Utilisateurs (compteurs), Réglages |
| Mon compte | « Mon compte » / e-mail | Organisations, Préférences, Sécurité |

Un composant de rail commun est attendu (le rail de l'espace agent IA actuel en est la base).

## 6. Écrans

### 6.1 Agents IA

- Le rail filtre le tableau : une entité **ou** un statut, jamais les deux. Le filtre est dans l'URL (`?entity=<id>` ou `?status=<statut>`).
- Colonne « Entité » (pastille) affichée quand l'organisation a plusieurs entités actives et qu'aucune entité n'est filtrée.
- Titre de la page : le libellé de l'entrée choisie (« Tous les agents IA », nom de l'entité, ou statut), avec le compte.
- « + Créer un agent IA » : admin seulement ; depuis une entité filtrée, l'assistant présélectionne cette entité.
- Le résumé `/api/bots/summary` du BFF doit porter `entity_id` (et le nom d'entité, ou la liste des entités chargée à part).

### 6.2 Usage & coûts

- Rail : Toute l'organisation, puis une entrée par entité. Le regroupement par entité se calcule côté web à partir des agents IA ; aucun changement moteur.
- Tableau actuel + colonne « Entité » quand plusieurs entités ; ligne de total.

### 6.3 Organisation › Entités (admin)

- Tableau : nom (serif), agents IA rattachés (pastilles nommées, issues du croisement avec la liste des agents IA), nombre de membres actifs, menu « ⋯ ».
- Création en ligne dans le tableau (un champ, Entrée valide, Échap annule). Renommage : même champ dans la ligne. Nom en double : message du moteur sous le champ.
- Menu « ⋯ » : Renommer, Déplacer un agent IA…, Archiver…. « Archiver » absent sur la dernière entité active.
- Case « Afficher les archivées (n) » : lignes grisées, pastille « Archivée », action « Réactiver ». Pas de suppression.
- Archivage d'une entité encore utilisée : fenêtre qui liste les agents IA (lien « Déplacer → » par agent IA) et le nombre de membres actifs (lien vers Utilisateurs filtrés sur l'entité, choix du rédacteur sur la forme du filtre) ; bouton Archiver désactivé. La vérification se fait côté web avant l'appel, le 409 moteur reste le filet.
- Déplacer un agent IA : fenêtre avec agent IA (parmi ceux de l'entité) et entité cible (actives, hors source) ; `PATCH /bots/:botId {entity_id}`. Texte : numéro, connexions et historique ne changent pas.

### 6.4 Organisation › Utilisateurs (admin)

- En-tête : « n membres · m invitations en attente », bouton « + Inviter ».
- Tableau des membres : avatar (initiales), e-mail, mention « vous » sur sa ligne, accès sur une ou deux lignes (« Admin » ; « Super manager » + pastille « lecture seule » ; « Manager · entité » puis « Conseiller · entité »), statut (Actif, Suspendu), menu « ⋯ » (Modifier les accès, Suspendre ou Réactiver). Aucune action sur sa propre ligne.
- Section « Invitations en attente » : e-mail, accès proposé, statut « Expire le … » (ambre) ou « Expirée » ; bouton « Renvoyer » direct ; menu « ⋯ » (Renvoyer, Révoquer).
- Tiroir latéral droit, un seul formulaire pour inviter et modifier :
  - e-mail (figé en modification) ;
  - choix « Toute l'organisation » (cartes Admin, Super manager ; interrupteur « Lecture seule » sous Super manager seulement) ou « Certaines entités » (une ligne par entité active : case + bascule Manager / Conseiller) ;
  - encart : « Aujourd'hui, managers et conseillers ont les mêmes droits : voir les agents IA, les leads et utiliser le simulateur. La différence (affecter des contacts) arrive avec Conversations & Leads. » (validé par François) ;
  - sortie : `POST /invitations` ou `PUT /users/:userId/memberships` avec les `grants` du contrat Zod.
- Après invitation : message « Invitation envoyée à … », identique dans tous les cas. Le lien n'est jamais affiché.
- Suspension : fenêtre de confirmation (« perd immédiatement l'accès à cette organisation ; ses autres organisations ne sont pas touchées ; réactivable avec les mêmes accès »), `PATCH /users/:userId {status}`.
- Le refus moteur « dernier admin actif » s'affiche tel quel dans le tiroir ou la fenêtre.

### 6.5 Organisation › Réglages (admin)

- Panneau « Visibilité des conversations et des leads » : trois cartes radio. « Tout le monde voit tout » sélectionnée ; « Chacun voit ses entités » et « Chacun voit ses contacts et le pool » grisées avec « bientôt disponible ».
- Pas de bouton Enregistrer ; note « Seul mode disponible aujourd'hui : rien à enregistrer. » Lecture par `GET /settings`.

### 6.6 Assistant de création, étape 1

- Champ « Entité » sous le nom, liste des entités actives, sans présélection (sauf arrivée depuis une entité filtrée), aide « L'agent IA appartiendra à cette entité. Vous pourrez le déplacer depuis Organisation › Entités. » Masqué s'il n'y a qu'une entité.
- « Continuer » bloqué tant qu'aucune entité n'est choisie (s'il y en a plusieurs). `POST /bots` envoie `entity_id`.
- Le reste de l'assistant est inchangé dans ce plan (le plan 2b l'étend).

### 6.7 Mon compte (tous les rôles)

Pages `/account/organisations` (par défaut), `/account/preferences`, `/account/securite`.

- Organisations : tableau (monogramme, nom, mon rôle, statut « Organisation active » ou « Actif », bouton « Ouvrir → » qui a l'effet du sélecteur). Super admin : statut « Suspendue » visible, ligne non ouvrable.
- Préférences : langue (Français / English) et thème (Clair / Sombre), propres à l'appareil comme aujourd'hui.
- Sécurité : e-mail en lecture seule (« sert d'identifiant, ne se modifie pas »), formulaire mot de passe actuel + nouveau (10 caractères minimum), bouton « Changer le mot de passe ». Nécessite la route moteur du §7.

### 6.8 Acceptation d'invitation (`/accept-invite?token=…`)

Hors de l'app : logo au-dessus d'une carte centrée, comme la connexion. Appel `POST /auth/invitations/info {token}` au chargement, puis :

1. **Compte neuf** (`requires_account_creation: true`) : en-tête « Invitation · organisation », e-mail masqué en lecture seule (« votre identifiant de connexion »), mot de passe avec Afficher et jauge, « Activer mon compte » (`POST /auth/accept-invite`).
2. **Compte existant, sans session** : « Connectez-vous pour accepter », e-mail + mot de passe + « Mot de passe oublié ? », puis état 3.
3. **Compte existant, connecté** : organisation et rôle proposé, compte connecté, « Accepter l'invitation » (`POST /auth/invitations/accept {token}`), « Plus tard » (retour à l'app, l'invitation reste valable), « Changer de compte » (déconnexion puis état 2).
4. **Problèmes** : lien invalide ou expiré (401 générique : « Ce lien d'invitation n'est plus valable », demander un renvoi, bouton vers la connexion) ; mauvais compte connecté (« Cette invitation est destinée à l•••••@… », bouton « Changer de compte »).

Après acceptation : entrée dans l'app avec l'organisation de l'invitation active (`wab_org`), message « Bienvenue dans … ».

### 6.9 Mot de passe oublié (décision François, 7 nov. 2026 : inclus dans le plan 2a)

Le moteur a déjà `POST /auth/forgot-password {email}` et `POST /auth/reset-password {token, password}`, et construit un lien `${webOrigin}/reset-password?token=…`. L'app web n'a ni ces pages ni le lien.

- Lien « Mot de passe oublié ? » sur la page de connexion et dans l'état 2 de la page d'acceptation (avec retour vers l'invitation une fois le mot de passe réinitialisé, en conservant le jeton d'invitation dans l'URL ; choix du rédacteur).
- Page publique `/forgot-password` : champ e-mail, « Recevoir un lien ». Réponse toujours identique, que l'adresse existe ou non : « Si un compte existe pour cette adresse, un lien vous a été envoyé. Il est valable 2 heures. » (durée par défaut du moteur, `ADMIN_RESET_TTL_HOURS`).
- Page publique `/reset-password?token=…` : nouveau mot de passe (Afficher, jauge, 10 caractères minimum), « Enregistrer » ; succès : retour à la connexion avec message ; jeton invalide ou expiré : message et lien vers `/forgot-password`.
- Mise en page : carte centrée comme la connexion et l'acceptation (maquette `10-acceptation-invitation.html` comme modèle).
- Middleware : ajouter `forgot-password` et `reset-password` aux segments publics.
- Tant que le SMTP n'est pas branché (chantier Infra), le lien n'apparaît que dans les journaux du serveur, comme les invitations.

## 7. Changements moteur (petits, inclus dans le plan 2a)

1. **`POST /auth/change-password`** sous session : `{ current_password, new_password }`, mêmes règles de longueur que l'acceptation, mot de passe actuel vérifié, limitation de débit comme le login, audit. Choix du rédacteur : toutes les sessions de l'utilisateur sont révoquées (`revokeAllUserSessions`), puis la route renvoie de nouveaux jetons comme le login ; le BFF remplace la session courante. L'utilisateur reste connecté sur l'appareil où il a changé son mot de passe, déconnecté partout ailleurs, sans ajouter d'identifiant de session au JWT. Contrat Zod dans `packages/contracts`.
2. **`POST /auth/invitations/info`** renvoie en plus `email_hint` (adresse masquée : première lettre de la partie locale + `•••••` + domaine complet) et `grants_summary` (rôle d'organisation, ou liste `{ entity_name, role }`). Le jeton reste la seule clé ; réponse 401 générique inchangée sinon.
3. **`POST /auth/invitations/accept`** avec un autre compte répond 401 générique « Invitation invalide ou expirée. » (vérifié dans le code). Pas de changement : la page détecte le mauvais compte avant l'appel en comparant l'e-mail de la session à `email_hint` (même première lettre, même domaine) ; si l'appel échoue malgré tout, message générique.

## 8. BFF et données

- `wab_org` : cookie httpOnly, `SameSite=Lax`, posé par une route BFF de choix d'organisation et par la connexion ; `engine-fetch` ajoute `X-Organization-Id` à chaque appel admin quand il est présent.
- Erreurs à traiter : 403 « Organisation suspendue. » (retour au sélecteur ou à Mon compte › Organisations avec message), 403 sans appartenance (cookie effacé, repli sur la première organisation), 400 organisation à préciser (même repli).
- **Aucune organisation accessible** (`/auth/me` renvoie `organizations: []` pour un compte non super admin : suspendu dans sa seule organisation, organisation suspendue, ou « Plus tard » sur sa première invitation) : la garde de `(app)/layout` redirige vers une page `/no-organization` (session requise, hors rail) : « Vous n'avez accès à aucune organisation pour le moment. Si vous attendez une invitation, ouvrez le lien reçu par e-mail ; sinon contactez l'administrateur de votre organisation. », avec « Mon compte » (seule page de l'app accessible dans cet état, sur Préférences et Sécurité) et « Se déconnecter ». Pas d'appel à l'API admin dans cet état, donc pas de boucle de redirection. Choix du rédacteur.
- Masquage des actions selon le rôle à partir de `/auth/me` (rôle résumé, `read_only`) ; le moteur reste la seule autorité. Lecture seule : simulateur masqué.
- Faux moteur e2e (`apps/web/e2e/mock-engine.ts`) aligné : `/auth/me` avec `organizations`, `entity_id` des agents IA, routes entités, utilisateurs, invitations, réglages, `info` enrichi, `change-password`, `forgot-password`, `reset-password`.

## 9. Textes

- « Agent » seul remplacé par « agent IA » dans tous les libellés FR et EN (nav, liste, assistant, espace agent IA, bandeau de mise en route).
- Plus aucun tiret cadratin ni demi-cadratin dans les textes (exemple actuel : la clé `wizard.personalityLead` de `apps/web/messages/fr.json`).
- Nouveaux écrans en FR et EN, dans le ton existant.

## 10. Vérification

- Tests web (composants et routes BFF) : sélecteur et `wab_org`, rail et filtres, tiroir d'invitation (sortie `grants`), fenêtres d'archivage et de déplacement, Mon compte, états de la page d'acceptation, masquage selon le rôle.
- Tests moteur : `change-password` (succès, mauvais mot de passe, révocation des autres sessions), `info` enrichi.
- e2e Playwright : mot de passe oublié puis réinitialisation, compte sans organisation accessible, connexion multi-organisation et bascule, création d'entité puis d'agent IA rattaché, invitation puis acceptation (compte neuf et compte existant), masquage pour un conseiller.
- **Test en live** (engine et web lancés, ports non standard si besoin) : admin migré, super admin avec sélecteur, conseiller invité, en clair et en sombre. Ne pas modifier `store/demo.db` sans accord.

## 11. Suite

- **Plan 2b, assistant de mise en ligne** : écran Organisation › Connexions (raccordement WhatsApp au niveau de l'organisation, selon l'analyse Meta en cours : `docs/superpowers/research/2026-11-07-meta-embedded-signup-analyse.md`), étapes « Numéro WhatsApp » et « Activer » dans l'assistant. Révise la règle §8 de la spec parente (« connexions par agent IA avec repli organisation ») pour WhatsApp : raccordement par organisation, numéro attribué à chaque agent IA. Position du CRM à trancher.
- **Personnalité & contenu** : page de l'agent IA pour le prompt, la base de connaissances et les modifications courantes.
- Puis Infra et déploiement, Conversations & Leads, Reprise humaine.

## 12. Laissé au builder, et choix du rédacteur

Laissé au builder : découpage en tâches, structure des fichiers, composants partagés, forme exacte des routes BFF, textes EN.

Choix du rédacteur à vérifier par François :

- Renommage du fichier de référence en `design-reference-emeraude-menthe.html`.
- `--accent-ink` en mode sombre.
- Changement de mot de passe : tout révoquer puis réémettre les jetons de la session courante.
- Page `/no-organization` pour un compte sans organisation accessible.
- Seuil de 6 organisations pour la recherche du sélecteur.
- Forme masquée de l'e-mail (`l•••••@domaine`).
