# Contre-audit de restitution des erreurs et des réussites

Date : 10 nov. 2026. Branche : `feat/restitution-erreurs`, tête `2cb732e`. Relecteur indépendant : aucun rapport des implémenteurs reçu ; lecture seule sur le dépôt (ce fichier est la seule écriture).

Question rejouée : la grille de l'audit du 9 nov. 2026 (`2026-11-09-audit-restitution-erreurs.md`, matrice §2, 87 cas, et table §3, 34 actions d'écriture) contre la règle §5 (5.1 emplacement, 5.2 notifications, 5.3 réussite) et les décisions produit du lot.

Réponse courte : sur le moteur simulé, 83 cas sur 87 sont restitués à leur place, compréhensibles et actionnables, et les 34 actions d'écriture ont un retour de réussite visible et une garde de double envoi. Il reste 4 défauts dans la matrice (1 de gravité moyenne, 3 basses) et quelques écarts de détail avec les décisions produit. Aucun défaut de gravité haute.

---

## 1. Méthode et environnement

### 1.1 Environnement

- Back-office construit depuis la tête (`npm run build` dans `apps/web`, sortie `.next` ignorée par git) et lancé par `next start -p 3012` avec `ENGINE_API_URL=http://localhost:4012/api/admin/v1`, `USD_EUR_RATE=0.92`, `USD_EUR_RATE_DATE=2026-11-09`.
- Moteur simulé : copie de `apps/web/e2e/mock-engine.ts` et `mock-state.ts` dans le bloc-notes, seul changement le port (4999 vers 4012). Les fichiers `e2e/*.ts` du dépôt ont été copiés de même (port du faux moteur changé dans `helpers.ts` et `mock-whatsapp.spec.ts`).
- Seconde instance `next start -p 3013` pour deux cas qui exigent un autre moteur : moteur injoignable (rien n'écoute sur 4013, T8), puis réponse 502 en HTML (`stub-502.mjs` sur 4013, T9) ; ensuite une instance avec `USD_EUR_RATE=abc` sur le faux moteur (taux illisible).
- Ports 3000 et 3800 jamais utilisés. Tous les serveurs lancés ont été arrêtés à la fin (vérifié par `lsof`). `git status` propre à la fin, hors ce rapport.

### 1.2 Preuves

- Scripts Playwright rejouables, dossier `/private/tmp/claude-501/-Users-francoisgreze-www-Cyran-projects-cyran-labs-engine/4467e026-d369-4f8f-835a-40e607d88af7/scratchpad/contre-audit/` :
  - `e2e/ca-1-transversal.spec.ts` (T1 à T7, T12, A1 à A9) ;
  - `e2e/ca-2-panne.spec.ts` (T8, T9) ;
  - `e2e/ca-3-organisation.spec.ts` (U, N, S) ;
  - `e2e/ca-4-connexions.spec.ts` (W) ;
  - `e2e/ca-5-agents.spec.ts` (B, vocabulaire) ;
  - `e2e/ca-6-complements.spec.ts`, `e2e/ca-7-complements.spec.ts` (relevés élargis, anglais, focus, notifications) ;
  - `e2e/ca-8-double-envoi.spec.ts` (garde de double envoi) ;
  - `e2e/ca-9-taux.spec.ts` (taux illisible) ;
  - `e2e/ca-10-stale.spec.ts` (relecture en échec après réussite, pages Organisation).
- Chaque étape écrit dans `results.jsonl` (même dossier) ce que voit l'utilisateur : adresse, textes des rôles `alert` et `status`, fenêtre ouverte, élément focalisé, texte de la zone concernée. Les citations de la matrice viennent de ce fichier.
- Refus et pannes forcés par `POST /__fail` du faux moteur. Les états que le faux moteur ne sait pas produire (motifs `token_invalid` et `signature_rejected`, alertes du fournisseur, compte retiré, issue « refusée » ou « non concluante » d'une vérification, numéro retiré, messages non servis, texte brut du fournisseur dans un contrôle) sont injectés dans la réponse du BFF par `page.route`, sur une vue conforme aux contrats : le rendu est jugé, pas la production de l'état par le moteur.
- Les corps illisibles et les messages de validation du BFF (T10, T11) ont été vérifiés par `curl` sur l'instance 3012, session ouverte.
- Suite existante `apps/web/e2e/` rejouée sur ces ports : 128 tests, 128 réussis. Les tests cités ont été lus : ils vérifient bien l'emplacement (alerte dans la fenêtre, la ligne ou le panneau), le texte lu dans `messages/<langue>.json`, la référence de requête et l'absence de « Erreur interne. ».
- Légende : **OK** ; **Défaut D-n** (section 5) ; « lecture du code » quand la preuve est le code (fichier:ligne).

---

## 2. Matrice rejouée

### 2.1 Transversal

| # | Ce que voit l'utilisateur maintenant | Verdict | Preuve |
|---|---|---|---|
| T1 | Action sous session perdue : renvoi vers `/fr/login?reason=session&next=%2Ffr%2Forganisation%2Fentites`, bandeau « Votre session a expiré. Reconnectez-vous pour reprendre là où vous étiez. Ce qui n'était pas enregistré est perdu. » ; après reconnexion, retour sur Entités | OK | ca-1 « T1 » ; `login.spec.ts:28` |
| T2 | Bascule dans un autre onglet puis action dans le premier : rechargement sur l'accueil, bandeau « Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord. » | OK | ca-1 « T2 » ; `two-tabs.spec.ts:18,34` |
| T3 | Seule organisation suspendue : page « Aucune organisation » avec « Studio Ocre est suspendue. Contactez l'administrateur de votre organisation ou le support. », sans parler d'invitation. Pendant la session : bandeau « Maison Lumière est suspendue. … » et refus sous la ligne. Autre organisation ouvrable : rechargement avec le bandeau `suspended` qui nomme l'organisation | OK | ca-1 « T3 » ; lecture du code `lib/org-notice.ts:48-55`, `session-provider.tsx:147,206` |
| T4 | 403 sans clé sur une action : FR « Accès refusé. » (texte brut du moteur) sous la ligne ; EN « You don't have permission for this action. » | Défaut D-2 | ca-1 « T4 » ; `lib/describe-failure.ts:96` |
| T5 | Cookie d'organisation périmé (400 « Organisation à préciser ») : la page Entités s'affiche normalement, rien à lire | OK | ca-1 « T5 » ; `lib/engine-fetch.ts:76` |
| T6 | 429 : « Trop de tentatives. Réessayez dans un instant. » sur Connexion, Mot de passe oublié, page d'invitation (avec Réessayer) et Changer le mot de passe (plus le texte brut) | OK | ca-1 « T6 » |
| T7 | Panne 500 sur une écriture : « Action impossible pour le moment. Réessayez. » et « Référence : ca-t7 », jamais « Erreur interne. » | OK | ca-1 « T7 » ; `restitution.spec.ts` (toutes les gardes D-1) |
| T8 | Moteur injoignable : FR « Connexion impossible pour le moment. Réessayez dans un instant. », EN « Sign-in is unavailable right now. Please try again in a moment. » ; Mot de passe oublié « Envoi impossible pour le moment. Réessayez. » ; invitation « Impossible de charger l'invitation pour le moment. Réessayez. » et Réessayer | OK | ca-2 « T8 » ; `login.spec.ts:15` |
| T9 | Réponse 502 non JSON : mêmes textes contextuels que T8, aucun mot technique. Dans l'app, un 5xx prend le texte contextuel | OK | ca-2 « T9 » ; lecture du code `lib/describe-failure.ts:83` |
| T10 | Messages de validation du BFF en français : « Le nom est requis. », « Le jeton d'accès semble incomplet : collez-le en entier. », « Identifiant de compte CM.com invalide. », « Écrivez un message. », « Adresse e-mail invalide. » ; aucun « String must » ni « Invalid » | OK | `curl` (§1.2) ; ca-4 « W14 », « W15 » |
| T11 | Corps illisible : 400 sur les 14 routes d'écriture essayées (`api/bots`, `api/bots/demo-1`, `simulate`, `status`, `allowlist`, entités, invitations, comptes WhatsApp, `auth/login`, `auth/change-password`, `auth/org`) | OK | `curl` (§1.2) ; `lib/request-body.ts` |
| T12 | EN : refus à clé traduit ; refus sans clé connue : texte contextuel anglais (« Action failed. Please try again. »), jamais le texte français du moteur. FR : texte du moteur | OK | ca-1 « T12 » ; ca-7 (EN) ; `restitution.spec.ts:923-1011` |

### 2.2 Authentification et invitations

| # | Ce que voit l'utilisateur maintenant | Verdict | Preuve |
|---|---|---|---|
| A1 | « Identifiants invalides. » sous le formulaire (EN « Invalid credentials. ») | OK | ca-1 « A1 », ca-7 |
| A2 | « Mot de passe actuel incorrect. » | OK | ca-1 « A2 » |
| A3 | « Le mot de passe doit faire au moins 10 caractères. » sur Sécurité, Nouveau mot de passe et Invitation (compte neuf) | OK | ca-1 « A3 » |
| A4 | Jeton inconnu : carte « Ce lien d'invitation n'est plus valable. … » et « Aller à la connexion » ; panne : « Impossible de charger l'invitation pour le moment. Réessayez. » et Réessayer, qui recharge l'invitation | OK | ca-1 « A4 » |
| A5 | Compte existant : 429 « Trop de tentatives… », réseau coupé « Enregistrement impossible pour le moment. Réessayez. », 401 « Invitation invalide ou expirée. », 500 avec référence : chaque cas a son texte | OK | ca-1 « A5 » ; `restitution.spec.ts:862` |
| A6 | Compte neuf : 429 « Trop de tentatives… », 500 « Enregistrement impossible pour le moment. Réessayez. Référence : ca-a6 » | OK | ca-1 « A6 » |
| A7 | Carte « Lien de réinitialisation invalide ou expiré. » et « Recevoir un nouveau lien » (EN traduit) | OK | ca-1 « A7 », ca-7 |
| A8 | Adresse inconnue : même confirmation que pour une adresse connue | OK | ca-1 « A8 » |
| A9 | Session perdue à l'acceptation : retour au formulaire « Connectez-vous pour accepter » de la même page, jeton gardé dans l'adresse | OK | ca-1 « A9 » |

### 2.3 Organisation

| # | Ce que voit l'utilisateur maintenant | Verdict | Preuve |
|---|---|---|---|
| U1 | Tiroir Inviter : « Cette personne est déjà membre de l'organisation : modifiez ses accès. » (EN traduit) | OK | ca-3 « U1 » |
| U2 | Tiroir : « Cette adresse appartient à un compte de la plateforme : contactez le support. » | OK | ca-3 « U2 » |
| U3 | Sous la ligne : « nouveau@wabagent.test : Cette invitation a déjà été acceptée. » avec Fermer ; la liste des invitations est relue | OK | ca-3 « U3 » (1 relecture `GET /api/invitations` après le refus) |
| U4 | Fenêtre de confirmation « Révoquer l'invitation à … ? » ; double clic : un seul `DELETE`, notification « Invitation à nouveau@wabagent.test révoquée. » ; 404 (déjà supprimée) : la fenêtre se ferme, la liste est relue, ni fausse réussite ni fausse erreur ; Échap ne ferme pas pendant l'envoi | OK | ca-3 « U4 », ca-7 « U4 bis » ; lecture du code `utilisateurs/page.tsx:212-219` |
| U5 | Tiroir : « L'organisation doit garder au moins un admin. » | OK | ca-3 « U5 » |
| U6 | Tiroir : « Entité introuvable ou archivée. » | OK | ca-3 « U6 » |
| U7 | Tiroir et fenêtre Suspendre : « Utilisateur introuvable. » | OK | ca-3 « U7 » |
| U8 | « Impossible de charger les utilisateurs. » et Réessayer, qui relit (EN « Could not load users. Retry ») | OK | ca-3 « U8 » |
| N1 | Sous le champ en cours d'édition : « Une entité porte déjà ce nom. », champ `aria-invalid` | OK | ca-3 « N1 » ; `restitution.spec.ts:65` |
| N2 | Seule entité active : pas d'« Archiver… » dans le menu ; refus du moteur dans la fenêtre : « L'organisation doit garder au moins une entité active. » | OK | ca-3 « N2 » |
| N3 | Contrôle préalable « Impossible pour l'instant : des agents IA et des membres y sont encore rattachés… » avec « Déplacer → » et « Voir le membre → » ; refus du moteur dans la fenêtre si l'état a bougé | OK | ca-3 « N3 » |
| N4 | Contrôles locaux « Le nom est requis. », « Le nom ne peut pas dépasser 80 caractères. » sous le champ (réserve latente : D-6) | OK | ca-3 « N4 » |
| N5 | Sous la ligne : « Entité introuvable. » | OK | ca-3 « N5 » |
| N6 | Sous la ligne, en nommant l'entité : « Boutique Lyon : Une entité porte déjà ce nom. » ; double clic sur Réactiver : un seul `PATCH` | OK | ca-3 « N6 » ; `restitution.spec.ts:137` |
| N7 | « Impossible de charger les entités. » et Réessayer ; archivées : « Impossible de charger les entités archivées. » et Réessayer | OK | ca-3 « U8 N7 S2 » |
| S1 | Mode « Tout le monde voit tout » ; les deux autres portent « BIENTÔT DISPONIBLE » ; note « Seul mode disponible aujourd'hui : rien à enregistrer. … » | OK | ca-6 « S1 » |
| S2 | « Impossible de charger les réglages. » et Réessayer, aucune carte de mode affichée | OK | ca-6 « S2 » |

### 2.4 Connexions

| # | Ce que voit l'utilisateur maintenant | Verdict | Preuve |
|---|---|---|---|
| W1 | Sous le champ concerné, relié par `aria-describedby` et `aria-invalid="true"` : « Saisissez la valeur complète : une valeur masquée n'est pas acceptée. » (Raccorder et Remplacer). Le focus n'est pas porté sur le champ fautif | Défaut D-3 | ca-6 « W1 » (`focused: false`), ca-4 « W1 » |
| W2 | « Ce compte WhatsApp est déjà raccordé. » près du bouton | OK | ca-4 « W2 » ; `restitution.spec.ts:348` |
| W3 | « Ce compte ne peut pas être raccordé. Contactez le support. » (Raccorder et Remplacer) | OK | ca-4 « W3 » |
| W4 | Indice sous le WABA ID « Doit rester celui de ce compte : 104829371625544. » ; refus « Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte. » dans la fenêtre | OK | ca-4 « W4 » |
| W5 | Compte retiré : section repliée « 1 compte retiré », aucun bouton « Gérer » pour lui | OK | ca-4 « W5 » (injecté) |
| W6 | Dans la fenêtre : « Les identifiants enregistrés de ce compte sont illisibles : raccordez un nouveau compte. » | OK | ca-4 « W6 » ; `restitution.spec.ts:457` |
| W7 | Message général et liste « Contrôles de vérification » : « ✗ Jeton d'accès valide : Échec Le jeton est refusé par Meta. », « ✗ Accès au compte WhatsApp Business : Échec … » ; texte brut de Meta dans un détail replié « Texte renvoyé par le fournisseur » | OK | ca-6 « W7 », ca-7 « W7 bis » (injecté) ; `connections.spec.ts:62` |
| W8 | Contrôle « app » en échec : « Impossible de lire l'application du jeton auprès de Meta, réessayez. » | OK | ca-4 « W8 » |
| W9 | Titre « Vérification refusée : le compte est passé en erreur. » ou « Vérification non concluante. Réessayez. » et contrôles avec leur état | OK | ca-4 « W9 » (injecté) |
| W10 | Fenêtre Rafraîchir : « Lecture des numéros auprès du fournisseur impossible. Réessayez. » ; la liste des comptes est relue | OK | ca-4 « W10 » |
| W11 | « Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré. » | OK | ca-4 « W11 » |
| W12 | Fenêtre Retirer : « Désactivez d'abord les agents IA qui utilisent ce compte : » et « Support technique » (sans lien) ; EN « First deactivate the AI agents that use this account: » | OK | ca-4 « W12 », ca-7 ; `connections.spec.ts:126` |
| W13 | Dans la fenêtre : « Compte WhatsApp introuvable. » (EN « WhatsApp account not found. ») | OK | ca-4 « W13 », ca-7 |
| W14 | Renommer : « Le nom est requis. », « Le nom fait 80 caractères au plus. » ; EN « Check this field. » | OK | ca-4 « W14 », ca-7 |
| W15 | Remplacer, valeurs trop courtes : sous chaque champ « Le jeton d'accès semble incomplet : collez-le en entier. », « Le secret de l'app semble incomplet : collez-le en entier. » | OK | ca-4 « W15 » |
| W16 | Bandeau « Jeton refusé par Meta. Les agents IA de ce compte ne peuvent plus répondre : remplacez les identifiants du compte. » et bouton « Remplacer les identifiants » | OK | ca-4 « W16 » (injecté) |
| W17 | Bandeau « Les messages reçus ne sont pas signés avec le secret de l'app enregistré ici. Vérifiez le secret de l'app dans Meta, puis remplacez les identifiants du compte. » et bouton | OK | ca-4 « W17 » (injecté) |
| W18 | Connexions : « Le compte est en erreur. Motif : Secret de l'app refusé. Remplacez les identifiants du compte. » et bouton ; cause support : « Ce compte ne peut pas être raccordé. Contactez le support. » sans bouton ni reprise promise ; texte du fournisseur replié ; EN : motif français replié. Page de l'agent IA : seulement « Compte Boutique principale · En erreur » dans l'encart Numéro et « WhatsApp Non connecté » dans Santé, alors que le Statut dit « Cet agent IA répond à tous les contacts qui lui écrivent. » ; ni motif, ni action, ni lien dans la page | Défaut D-1 | ca-4 « W18 », ca-7 « W18 » ; `components/agent/number-panel.tsx:68-69`, `packages/contracts/src/whatsapp.ts:242-248` ; `connections.spec.ts:173,186,199` |
| W19 | Bandeaux « Meta signale un problème de paiement… », « Meta a verrouillé ce compte. », « Meta bloque ce compte… », « Meta a mis à jour ce compte. » avec « Ouvrir WhatsApp Manager ↗ » | OK | ca-4 « W16 » (injecté) |
| W20 | « Le jeton expire dans 3 jours. » et la marche à suivre | OK | ca-4 « W16 » (injecté) |
| W21 | « La qualité du numéro +33 6 12 45 78 90 est basse. Meta peut limiter les messages… » | OK | ca-4 « W16 » (injecté) |
| W22 | Ligne du numéro : « 3 échecs de remise », sens du code 131047, « Voir dans WhatsApp Manager ↗ » ; repris dans l'encart Numéro de l'agent IA | OK | ca-4 « W22 » ; `agent-space.spec.ts:150,164` |
| W23 | Boîte webhook : « Impossible de lire le webhook du compte. » et Réessayer | OK | ca-4 « W23 » |
| W24 | « Copie impossible » à côté du bouton | OK | ca-4 « W24 » |
| W25 | Lecture en échec : « Quelque chose s'est mal passé » et Réessayer (générique, voir D-5) ; relecture en échec après un renommage réussi : « Modification enregistrée. L'affichage n'a pas pu être actualisé. » et Réessayer | OK | ca-4 « W25 », ca-6 « W25 bis » |

### 2.5 Agents IA

| # | Ce que voit l'utilisateur maintenant | Verdict | Preuve |
|---|---|---|---|
| B1 | Actions impossibles désactivées avec leur raison sous la rangée (« Activer en accès limité : Branchez un numéro WhatsApp avant d'activer l'agent IA. ») ; refus du moteur dans le panneau Statut (EN traduit) | OK | ca-5 « B1 », ca-7 ; `restitution.spec.ts:650` |
| B2 | « Désactivé : son numéro a été retiré chez le fournisseur » sous la pastille ; réactivations désactivées avec la raison ; encart Numéro « Retiré du fournisseur » | OK | ca-5 « B2 » (injecté) |
| B3 | Fenêtre : « Ce numéro a changé depuis votre lecture : vérifiez la liste. », choix à refaire ; étape Activer : même texte et « Ouvrir Connexions ↗ » | OK | ca-5 « B3 » ; `restitution.spec.ts:540,684` |
| B4 | « Ce numéro a été retiré chez le fournisseur. » dans la fenêtre ; à l'étape Activer avec « Ouvrir Connexions ↗ » | OK | ca-5 « B4 » |
| B5 | « Agent IA ou numéro WhatsApp introuvable. » dans la fenêtre | OK | ca-5 « B5 » |
| B6 | Sous l'entrée fautive : « Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu. » (page de l'agent IA, étape Activer) ; EN : traduit avec le moteur réel, qui envoie la clé | OK | ca-5 « B6 » ; lecture du code `src/core/services/bot-service.ts:47` |
| B7 | « 20 numéros au plus », champ désactivé ; étape Activer « Ajoutez au moins un numéro à la liste d'accès limité pour activer. » | OK | ca-5 « B7 » |
| B8 | Liste vidée en accès limité : « Liste enregistrée. », encart « Cet agent IA ne répond à personne : sa liste d'accès limité est vide. » avec exactement « Ajouter un numéro », « Ouvrir à tous », « Désactiver » | OK | ca-5 « B8 » ; `agent-space.spec.ts:37` |
| B9 | Refus `entity_id` : retour à l'étape 1, « Choisissez une entité. » ; entités illisibles : « La liste des entités n'a pas pu être chargée. » et Réessayer, Continuer bloqué avec « Chargez la liste des entités pour continuer. » | OK | ca-5 « B9 », « B23 » ; `onboarding.spec.ts:64` |
| B10 | Retour à l'étape 1, « Entité introuvable ou archivée. » ; Déplacer : message dans la fenêtre | OK | ca-5 « B10 » ; `restitution.spec.ts:165` |
| B11 | « Créer & tester » désactivé tant que la langue par défaut est vide, avec « Renseignez la personnalité de la langue par défaut (français). » ; refus du moteur : « Décrivez la personnalité de l'agent IA en français, la langue par défaut. » et champ en erreur | OK | ca-6 « B11 », ca-5 « B11 » ; `onboarding.spec.ts:73` |
| B12 | Identifiant pris : nouvel essai automatique, passage à l'étape Tester | OK | ca-5 « B12 » |
| B13 | 403 à la création : FR « Accès refusé. » (texte brut) sous le bouton ; EN « You don't have permission for this action. » | Défaut D-2 | ca-5 « B13 », ca-7 |
| B14 | « Agent IA introuvable. » et « Retour aux agents IA » ; rail : l'identifiant et « Statut inconnu », plus de « Brouillon » inventé | OK | ca-5 « B14 » |
| B15 | Par panneau : « Santé indisponible », « Statistiques indisponibles », « Conversations indisponibles », chacun avec Réessayer, le reste de la page s'affiche ; lecture de l'agent IA en échec : page « Quelque chose s'est mal passé » et Réessayer | OK | ca-5 « B15 » ; `agent-space.spec.ts:91` |
| B16 | « Conversations indisponibles » et Réessayer, jamais une liste vide | OK | ca-5 « B15 » |
| B17 | Panne : bulle « Non envoyé », texte gardé, « Renvoyer », texte contextuel et référence ; 404 « Cet agent IA n'existe plus. » sans renvoi ; 403 : « Accès refusé. » (D-2) | OK | ca-5 « B17 » ; `restitution.spec.ts:753,769`, `agent-space.spec.ts:106` |
| B18 | « 4 messages non servis, le dernier le 9 nov. 2026, 22:30 » (heure de Paris pour 21:30 UTC) et le conseil | OK | ca-5 « B18 » (injecté) |
| B19 | Liste des agents IA : « indisponible » dans Messages et Leads ; Usage et coûts : ligne « indisponible » et « Total partiel » | OK | ca-5 « B19 », ca-6 « B19 », « B19 bis » |
| B20 | Carte Coût « 1,84 $ ≈ 1,69 € », « 184 000 tokens in · 39 000 out », note du taux ; aucun « 0 erreur » (FR et EN) | OK | ca-5 « B20 », ca-6 « B20 » |
| B21 | Page Usage de l'agent IA en échec : « Quelque chose s'est mal passé » et Réessayer (générique, voir D-5) | OK | ca-6 « B21 » |
| B22 | Fenêtre Brancher : « Impossible de lire les numéros de l'organisation. » et Réessayer, qui relit | OK | ca-5 « B22 » |
| B23 | Rails de l'accueil et d'Usage : « Entités indisponibles » et Réessayer ; assistant bloqué (B9) | OK | ca-6 « B23 », ca-5 « B23 » |
| B24 | Accueil : « Une erreur est survenue. » et Réessayer (générique, voir D-5), jamais la liste vide | OK | ca-6 « B24 » |

**Total matrice : 87 cas, 83 OK, 4 Défaut (T4, B13, W1, W18), 0 non vérifiable.** Dix cas sont jugés sur un état injecté dans la réponse du BFF (W5, W9, W16 à W21, B2, B18, une partie de W7) et deux par lecture du code (variante multi-organisation de T3, clé de B6 en anglais).

---

## 3. Actions d'écriture

| # | Action | Ce que voit l'utilisateur maintenant (réussite, refus, double envoi) | Verdict | Preuve |
|---|---|---|---|---|
| 1 | Se connecter | Redirection, retour à la page quittée après une session expirée ; panne avec texte de panne et référence | OK | `login.spec.ts:15,28` ; ca-1 « T1 » |
| 2 | Mot de passe oublié | Encadré « Si un compte existe… » ; panne « Envoi impossible pour le moment. Réessayez. » avec référence | OK | ca-1 « A8 » ; `restitution.spec.ts:793,806` |
| 3 | Nouveau mot de passe | Bandeau sur la connexion ; panne avec texte contextuel et référence | OK | `restitution.spec.ts:814,827` ; `password-reset.spec.ts:10` |
| 4 | Accepter (compte neuf) | Accueil avec « Bienvenue dans Maison Lumière. » ; refus et panne à leur place | OK | `restitution.spec.ts:835` ; ca-1 « A6 » |
| 5 | Accepter (compte existant) | « Bienvenue dans Atelier Nord. » ; 401, 429, réseau, 500 distingués | OK | `restitution.spec.ts:862` ; ca-1 « A5 » |
| 6 | Changer le mot de passe | « Mot de passe modifié. Vos autres sessions ont été déconnectées. » ; 429 et 500 traduits | OK | `restitution.spec.ts:882` ; ca-1 « T6 » |
| 7 | Changer d'organisation | Rechargement ; refus dans le sélecteur « Impossible d'ouvrir Atelier Nord : l'opération a échoué, réessayez. » et référence ; organisation suspendue grisée avec sa raison ; double clic : un seul `POST` | OK | `two-tabs.spec.ts:46,60` ; ca-8 (ligne 7) ; `org-switcher.tsx:44` |
| 8 | Se déconnecter | Redirection même si le moteur échoue | OK | `restitution.spec.ts:895` |
| 9 | Créer une entité | Ligne ajoutée, compteur ; relecture en échec : « Modification enregistrée… » ; Entrée deux fois : un seul `POST` | OK | `restitution.spec.ts:65` ; ca-10 ; ca-8 (ligne 9) |
| 10 | Renommer une entité | Nom changé dans la ligne ; refus sous le champ | OK | `restitution.spec.ts:91` ; ca-3 « N5 » |
| 11 | Archiver une entité | Notification « Entité Boutique Lyon archivée. », lisible après changement de page, effacée après 5 s ; une seule région de notifications | OK | `restitution.spec.ts:113` ; ca-6 « NOTIF » |
| 12 | Réactiver une entité | Pastille retirée ; refus sous la ligne qui nomme l'entité ; un seul `PATCH` au double clic | OK | `restitution.spec.ts:137` ; ca-3 « N6 » |
| 13 | Déplacer un agent IA | Notification « Support technique déplacé vers Boutique Lyon. » | OK | `restitution.spec.ts:165` |
| 14 | Inviter | Notification « Invitation envoyée à lea@wabagent.test. », ligne ajoutée | OK | `restitution.spec.ts:197` ; ca-3 « U4 » |
| 15 | Renvoyer une invitation | Notification ; refus sous la ligne ; un seul `POST` au double clic | OK | `restitution.spec.ts:220` ; ca-8 (ligne 15) |
| 16 | Révoquer une invitation | Confirmation, notification, ligne retirée ; un seul `DELETE` ; fenêtre non fermable pendant l'envoi | OK | `restitution.spec.ts:238` ; `organisation.spec.ts:69` ; ca-3 « U4 », ca-7 |
| 17 | Modifier les accès | Notification « Accès de advisor@wabagent.test modifiés. » | OK | `restitution.spec.ts:260` |
| 18 | Suspendre | Notification « advisor@wabagent.test suspendu. », statut « Suspendu » ; relecture en échec dite | OK | `restitution.spec.ts:281` ; ca-10 |
| 19 | Réactiver un membre | Statut « Actif » ; refus sous la ligne ; garde par identifiant (entrée de menu désactivée « Envoi en cours ») | OK | `restitution.spec.ts:281` ; ca-8 (ligne 19) ; lecture du code `members-table.tsx:92` |
| 20 | Raccorder un compte | Écran de résultat ; refus près du bouton ; contrôles | OK | `restitution.spec.ts:348,364` ; `connections.spec.ts:62` |
| 21 | Renommer un compte | Carte renommée ; relecture en échec : bandeau « Modification enregistrée… » et focus rendu au bouton « Gérer » | OK | `restitution.spec.ts:382` ; ca-4 « W25 », ca-7 « R22 » |
| 22 | Remplacer les identifiants | « Identifiants remplacés, compte revérifié. » | OK | `restitution.spec.ts:416` |
| 23 | Vérifier maintenant | Issue en titre et contrôles | OK | `restitution.spec.ts:457` ; ca-4 « W9 » |
| 24 | Rafraîchir les numéros | Bilan d'inventaire ; refus dans la fenêtre | OK | `restitution.spec.ts:457` ; ca-4 « W10 » |
| 25 | Retirer de WABAGENT | Notification « Boutique principale retiré de WABAGENT. », compteur du rail, section « 1 compte retiré » | OK | `connections.spec.ts:149` ; `restitution.spec.ts:479` |
| 26 | Numéro de test | Badge dans la ligne ; refus dans la fenêtre | OK | `restitution.spec.ts:503` |
| 27 | Brancher (Connexions) | Agent IA dans la ligne ; « numéro changé » dans la fenêtre | OK | `restitution.spec.ts:540` |
| 28 | Débrancher | « Libre » dans la ligne | OK | `restitution.spec.ts:569` |
| 29 | Créer l'agent IA | Passage à l'étape 3 ; refus routés vers le bon champ ou la bonne étape | OK | `onboarding.spec.ts:8,52,64,73` ; ca-5 « B9 » à « B12 » |
| 30 | Activer (assistant) | Écran de confirmation, QR code, lien `wa.me` ; refus sous le bouton | OK | `activation.spec.ts:23` ; `restitution.spec.ts:615` |
| 31 | Changer le statut | Pastille ; relecture en échec dite sans fausse erreur ; confirmation au double clic : un seul `PUT` | OK | `restitution.spec.ts:650` ; ca-8 (ligne 31) |
| 32 | Brancher le numéro (page de l'agent IA) | Nouveau numéro dans l'encart ; relecture en échec dite | OK | `restitution.spec.ts:684` |
| 33 | Enregistrer la liste | « Liste enregistrée. » ; un seul `PUT` au double clic | OK | `restitution.spec.ts:720` ; ca-8 (ligne 33) |
| 34 | Simulateur | Réponse dans le fil ; échec sans perte ; Entrée deux fois : un seul `POST` | OK | `restitution.spec.ts:753` ; ca-8 (ligne 34) |

**Total actions : 34, 34 OK, 0 Défaut, 0 non vérifiable.**

---

## 4. Écarts avec les décisions produit

| Décision | Constat | Gravité |
|---|---|---|
| Statuts Brouillon, Accès limité, Ouvert à tous, Désactivé ; EN Draft, Limited access, Open to all, Deactivated | Conformes sur la pastille et la description, FR et EN (ca-5 « Vocabulaire »). | Aucun écart |
| Actions Activer en accès limité, Ouvrir à tous, Désactiver, Réactiver en accès limité, Réactiver pour tous ; jamais « Revenir en brouillon » ni « pause » | Aucun « brouillon » ni « pause » en action. Une sixième action existe depuis Ouvert à tous : « Revenir en accès limité » (EN « Back to limited access »), absente de la liste décidée (`lib/bot-transitions.ts:31`). Elle est utile (le moteur garde la transition) mais n'a pas été tranchée. | Basse : à confirmer par François |
| « Brouillon » réservé à « créé, jamais activé » | Le sélecteur de numéro et l'étape Activer disent qu'un agent IA en service qui perd son numéro « passera au statut Brouillon : il ne répondra plus » (`numberPicker.swapWarning`, `wizard.activate.checks.numberTaken`) : le moteur le remet bien en brouillon, la pastille dira alors « Brouillon » pour un agent IA déjà activé. | Basse |
| Compte WhatsApp : « Retirer de WABAGENT », jamais « Déconnecter » | FR conforme partout (menu, fenêtre, notification, section « comptes retirés »). EN : « Remove from WABAGENT » pour le compte, mais « Disconnect » pour Débrancher (encart Numéro de l'agent IA, `agentNumber.unassign`) et « Connect » à la fois pour Brancher et pour Raccorder : l'ambiguïté que la décision voulait lever subsiste en anglais. | Basse |
| Boutons « Gérer ▾ » à la place des ⋯ | Conforme sur comptes, numéros, membres, invitations, entités ; « Brancher » et « Renvoyer » en boutons directs. Aucun ⋯ affiché (seule occurrence dans un commentaire de `action-menu.tsx:40`). | Aucun écart |
| Liste vide en accès limité | Conforme : enregistrable, encart et trois actions (B8). | Aucun écart |
| Coûts en dollars avec équivalent en euros, note, formats, « indisponible », « Total partiel », pas de « 0 erreur », heure de Paris | Conforme : « 1,84 $ ≈ 1,69 € », note « Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 9 novembre 2026. », « 184 000 », « 9 nov. 2026, 22:30 » pour 21:30 UTC ; taux illisible (`USD_EUR_RATE=abc`) : dollars seuls et « Anthropic facture en dollars. », ni NaN ni 0,00 € (ca-9). | Aucun écart |
| En anglais, jamais de texte français du moteur | Aucun texte du moteur en français relevé dans l'interface anglaise (refus à clé traduits, refus sans clé en texte contextuel anglais, motif d'erreur de compte replié sous « Details from WABAGENT (in French) »). Hors texte du moteur : les tons de l'assistant restent en français dans l'interface anglaise (« Chaleureux, Professionnel, Concis, Enthousiaste, Formel », `step-personality.tsx:12`). | Basse (D-4) |
| Relecture en échec après réussite : « Modification enregistrée. L'affichage n'a pas pu être actualisé. » et Réessayer | Conforme sur Entités, Utilisateurs, Connexions et la page de l'agent IA. | Aucun écart |
| 5xx : texte contextuel et « Référence : … » | Conforme sur toutes les écritures essayées ; le texte du moteur « Erreur interne. » n'apparaît nulle part. | Aucun écart |

---

## 5. Défauts restants classés

### Gravité haute

Aucun.

### Gravité moyenne

**D-1. Page de l'agent IA : compte WhatsApp en erreur sans cause ni action (W18).**
- Constat : avec le compte en erreur (motif « Secret de l'app refusé »), la page de l'agent IA montre « Compte Boutique principale · En erreur » dans l'encart Numéro et « WhatsApp Non connecté » dans Santé, mais le panneau Statut dit toujours « Cet agent IA répond à tous les contacts qui lui écrivent. ». Aucun motif, aucun conseil, aucun lien dans le contenu de la page (seul le rail de l'admin mène à « Numéros WhatsApp de l'organisation »). La règle §5.1 demande pour un état durable « repris là où l'objet est utilisé (page de l'agent IA) : cause précise, conséquence, action ». Le résumé de numéro des contrats ne porte que `state` et `error_reason` (`packages/contracts/src/whatsapp.ts:242-248`), ni `error_cause` ni `error_detail`.
- Correction : ajouter `error_cause` (et `error_detail`) au compte du résumé de numéro côté moteur et contrats ; dans l'encart Numéro, un bandeau qui reprend la phrase de Connexions (« Le compte est en erreur. Motif : … ») avec la conséquence (« cet agent IA ne peut pas répondre ») et l'action (« Voir dans Connexions » pour l'admin, « Prévenez un administrateur » sinon) ; la description du statut le dit tant que le compte n'est pas connecté. Test e2e avec `applyScenario('account-error-check')` sur `/fr/agents/demo-1`.

### Gravité basse

**D-2. Refus 403 sans clé : en français, le texte brut « Accès refusé. » (T4, B13, B17 en 403).** En anglais l'écran affiche « You don't have permission for this action. », en français le texte du moteur, ni explicatif ni actionnable (`lib/describe-failure.ts:96` : le texte du moteur est préféré en français). Correction : pour un refus `forbidden` sans clé, utiliser `errors.generic.forbidden` dans les deux langues (« Vous n'avez pas les droits pour cette action. »), ou donner une clé aux 403 de rôle.

**D-3. Champ refusé par le moteur : le focus n'est pas porté sur le premier champ fautif (W1).** Le message est bien sous le champ, avec `aria-invalid` et `aria-describedby`, mais le focus reste ailleurs (ca-6 « W1 » : `focused: false`), contre §5.1 (« focus sur le premier champ fautif »). Correction : dans Raccorder et Remplacer, focaliser le premier champ de `fieldErrors` après un refus.

**D-4. Tons de l'assistant en français dans l'interface anglaise.** `step-personality.tsx:12` : « Chaleureux, Professionnel, Concis, Enthousiaste, Formel » affichés tels quels en anglais. Correction : clés de traduction pour l'affichage, valeur stockée inchangée si le moteur en dépend.

**D-5. Pages en échec : texte générique, sans rôle d'alerte (W25, B15, B21, B24).** « Quelque chose s'est mal passé » (Connexions, page et Usage de l'agent IA) ou « Une erreur est survenue. » (accueil) ne nomment pas ce qui n'a pas pu être lu, contre §5.1 (« Impossible de charger … »), et la page d'erreur de Connexions n'a aucun élément `role="alert"` (ca-6 « W25 bis » ; `app/[locale]/error.tsx`). Réessayer est présent et fonctionne. Correction : `LoadError` avec un texte par page (« Impossible de charger les connexions. ») et `role="alert"`.

**D-6. Entités : un refus de champ du moteur sans clé affiche « Données invalides. » (réserve de N4, latent).** Refus 400 du moteur sur `name` avec un détail et sans clé : la ligne affiche « Données invalides. » au lieu du détail (ca-3 « N4 », refus forcé), car `entities-table.tsx:96-98` lit `error.message` et ignore `fieldErrors.name`. Aujourd'hui peu atteignable (contrôle local, puis BFF avec le même contrat). Correction : afficher `fieldErrors.name` quand il existe.

**D-7. Écarts du faux moteur qui empêchent de garder deux cas en anglais.** Le faux moteur n'envoie pas la clé `allowlist.invalid_entry` que le moteur réel envoie (`src/core/services/bot-service.ts:47`) : en anglais, sur le faux moteur, l'entrée invalide affiche « Check this field. ». Et `POST /__fail` retire `provider_text` des détails forcés (`forcedOf` de `mock-engine.ts`) : le détail replié du texte du fournisseur n'est vérifiable qu'en injectant la réponse du BFF. Correction : aligner `parseEntries` sur le moteur (clé) et garder `provider_text` dans `forcedOf`, puis un test e2e anglais pour chacun.

---

## 6. Ce qui n'a pas pu être vérifié et pourquoi

- **Production des états par le moteur réel.** Les états injectés (alertes du fournisseur, motifs `token_invalid` et `signature_rejected`, compte retiré, issues de vérification, numéro retiré, messages non servis) prouvent le rendu sur une vue conforme aux contrats, pas que le moteur les produit dans ces conditions. À couvrir par la recette en réel (Meta, tâche 18) et les tests du moteur.
- **Clés de refus envoyées par le moteur réel.** Le contre-audit a forcé les clés `reason` dans le faux moteur ; il n'a pas vérifié, refus par refus, que le moteur réel envoie la même clé que celle forcée (seul `allowlist.invalid_entry` a été lu dans le code, D-7). Une divergence ferait retomber l'interface anglaise sur le texte contextuel.
- **Suspension de l'organisation pendant la session avec relecture de `/auth/me`.** Le faux moteur ne sait pas suspendre une organisation à chaud : le 403 « Organisation suspendue. » a été forcé, mais `/auth/me` dit encore l'organisation ouvrable. Le rechargement vers une autre organisation avec le bandeau qui nomme l'organisation suspendue est vérifié par lecture du code seulement (`lib/org-notice.ts:48-55`).
- **Lecteurs d'écran.** Seuls les rôles `alert` et `status`, `aria-invalid`, `aria-describedby`, `aria-live` et le focus ont été relevés ; aucun test avec un vrai lecteur d'écran.
- **Thème sombre, petits écrans, autres navigateurs que Chromium.** Hors de ce contre-audit.
- **Codes Meta des échecs de remise autres que 131047 et 131026.** Le libellé des autres codes de la table (`connections.delivery.*`) n'a pas été déclenché en navigateur ; leur sens n'a pas été recontrôlé dans la documentation Meta.
