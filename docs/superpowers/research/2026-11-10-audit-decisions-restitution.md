# Audit des décisions du lot « Restitution des erreurs et vocabulaire »

Date : 10 nov. 2026. Branche `feat/restitution-erreurs` (non mergée), tête `027ec24`.

Objet : juger, une par une, les décisions prises par le contrôleur pendant l'exécution du lot (registre `.superpowers/sdd/2026-11-09-restitution-erreurs-vocabulaire/progress.md`, tri `decisions-triage.md`), contre les sources d'autorité et contre le code, sans tenir les justifications du registre pour acquises.

Sources, dans l'ordre :
1. paroles de François : retours de recette Q-1 à Q-14, choix C-1 à C-8 et choix du rédacteur 1 à 6, tels que présentés dans le plan `docs/superpowers/plans/2026-11-09-restitution-erreurs-vocabulaire.md` (réponse « oui sub agent, toi PO » au plan entier) ;
2. règle de restitution validée : `docs/superpowers/research/2026-11-09-audit-restitution-erreurs.md` §5 ;
3. spec `docs/superpowers/specs/2026-11-08-connexions-whatsapp-2b-design.md` (§2, §7, §8 et ses amendements) ;
4. `CLAUDE.md`.

Les interfaces de tâche du plan (par exemple « en anglais `fallback` » de la tâche 6) ont été écrites par le rédacteur : elles ne sont pas des paroles de François et ne priment pas sur §5.

Verdicts : Fondée, Discutable, Contraire à une source, Fait non vérifié ou faux, Revenait à François.

---

## 1. À trancher par François

**1. Un agent IA qui perd son numéro affiche « Brouillon » (A9).**
Ce que l'utilisateur voit : un agent IA qui répondait à tous, dont on débranche le numéro (ou dont le numéro est branché sur un autre agent IA), passe au statut « Brouillon ». Or le choix C-1 que vous avez validé définit « Brouillon » comme « créé, jamais activé » et ne garde qu'une seule façon d'arrêter, « Désactiver ». Conséquence concrète : pour le remettre en service sur un nouveau numéro, il faut repasser par l'accès limité avec une liste, alors qu'un agent IA « Désactivé » pourrait être réactivé pour tous directement. Option prise : garder le comportement du moteur (spec §7.5) et l'écrire à l'écran. Alternative : le moteur met l'agent IA en « Désactivé » avec un motif (« son numéro a été débranché »), comme il le fait déjà pour un numéro retiré chez le fournisseur. Recommandation : l'alternative ; c'est un changement de deux lignes par pilote (`whatsapp-sqlite.ts:322,388`, `whatsapp-postgres.ts:351,420`), plus l'amendement du §7.5 de la spec.

**2. « Revenir en accès limité » depuis « Ouvert à tous » (A11).**
Ce que l'utilisateur voit : sur un agent IA ouvert à tous, une action qui le restreint de nouveau aux numéros de sa liste, sans l'arrêter. C-1 ne la listait pas. Option prise : gardée, à vous de confirmer. Alternative : la retirer (seul « Désactiver » reste). Recommandation : la garder, utile pour refermer vite sans couper le service ; le mot « Revenir » est celui que Q-1 reprochait à « Revenir en brouillon », « Repasser en accès limité » ou « Limiter l'accès » serait plus net.

**3. Couleur du loader en thème sombre (Q-14, absent du tri).**
Ce que l'utilisateur voit : en thème sombre, une des deux pastilles du loader est presque invisible (contraste mesuré 1,38:1 contre 3:1 attendu, rapport de la tâche 15). Rien n'a été changé, à juste titre : la couleur est la vôtre. Option proposée : `#0F7A55` (couleur d'accent de la charte) en thème sombre seulement, 3,35:1. Recommandation : valider `#0F7A55` en recette sur capture. Ce point n'apparaît pas dans le tri : il risque d'être oublié au merge.

**4. Menu « Remplacer les identifiants » d'un compte aux identifiants illisibles (A23, reporté).**
Ce que l'utilisateur voit : un compte dont les identifiants enregistrés ne se lisent plus (cause « reconnect ») propose toujours « Remplacer les identifiants ». L'admin va chercher un jeton et un secret chez Meta, les colle, valide, puis reçoit un refus. Ce refus lui dit « raccordez un nouveau compte », ce qui échouera aussi tant que l'ancien compte n'est pas retiré (« Ce compte WhatsApp est déjà raccordé. »). Option prise : reporté au lot suivant. Alternative : désactiver l'entrée avec sa raison (le bouton d'actions sait déjà le faire, `disabledReason`) et aligner le texte sur le bandeau (« Retirez ce compte de WABAGENT puis raccordez-le de nouveau »). Recommandation : corriger avant le merge, le coût est faible et le texte actuel est faux.

**5. Liens d'invitation dans les journaux : variable `MAILER_LOG_LINKS` (A18).**
Ce que cela change : vous aviez choisi (C-6) « lien écrit hors production, jamais en production ». Le contrôleur a gardé l'intention mais changé le déclencheur : le lien n'est écrit que si `MAILER_LOG_LINKS=true`. Le fait invoqué est vrai : aucun Dockerfile n'est versionné et `.env.example:6` pose `NODE_ENV=development`, donc un déploiement copié de l'exemple aurait écrit les liens. Effet pratique : votre `.env` local ne contient pas cette variable, la recette des invitations ne montrera aucun lien tant qu'elle n'est pas posée. Recommandation : confirmer le changement et poser la variable pour la recette.

**6. Ce qu'un membre non admin voit d'un compte en erreur et des échecs de remise (A12, B25).**
Ce que voit un conseiller sur la page d'un agent IA : « 3 échecs de remise » avec le sens du code Meta, et, si le compte est en erreur, le motif ; aucun lien ni conseil, parce qu'il ne peut pas agir. Aucune fuite entre organisations (lectures filtrées par organisation, `bot-number-summary.ts:47-66`). Deux limites : le compteur d'échecs ne fait que croître (`whatsapp-sqlite.ts:575`, jamais remis à zéro) et n'a pas de date à l'écran, donc la pastille reste pour toujours ; le conseiller n'a aucune suite à donner. Alternative : ajouter « Prévenez un administrateur de votre organisation » pour qui ne peut pas agir, et afficher la date du dernier échec (`last_delivery_error_at` existe déjà en base). Recommandation : ajouter la phrase maintenant, la date avec Conversations et Leads.

---

## 2. Décisions à revoir

### Contraire à une source

**A9. Brouillon après perte du numéro.**
- Fait vérifié : le moteur remet en `draft` un agent IA `limited` ou `active` qui perd son numéro, par remplacement (`src/core/database/whatsapp-sqlite.ts:320-323`, `whatsapp-postgres.ts:349-352`) ou par débranchement (`whatsapp-sqlite.ts:388`, `whatsapp-postgres.ts:420`). Un agent IA en pause qui perd son numéro reste en pause (`packages/contracts/src/bot-status.ts:49-51`). Depuis `draft`, « Ouvert à tous » est refusé hors numéro de test (`bot-status.ts:74`).
- Source contredite : C-1 option A (plan, « Choix à trancher ») : « Brouillon » (créé, jamais activé), une seule façon d'arrêter, « Revenir en brouillon » disparaît de l'écran. La spec §7.5, antérieure, dit « repasse en brouillon » ; C-1 est plus récent et vient de François. La décision « vérité de l'écran » est honnête mais laisse l'écran dire une chose fausse au sens de C-1 (un agent IA activé affiché comme jamais activé).
- À faire : voir « À trancher » 1.

**A23 (partie « Remplacer les identifiants » d'un compte `reconnect`).**
- Fait vérifié : le menu propose toujours l'entrée (`apps/web/src/components/connections/account-menu.tsx:39-45`) ; le moteur refuse toujours ce remplacement (`src/core/services/whatsapp-account-service.ts:260-261`, 409 `whatsapp_account.secrets_unreadable`) ; le texte du refus « raccordez un nouveau compte » (`apps/web/messages/fr.json:158`) mène à un second refus, car un compte en erreur tient toujours sa WABA (`whatsapp-sqlite.ts:160-167`, spec §6 « Unicité »).
- Sources contredites : `CLAUDE.md` et plan (« Aucun élément d'interface sans effet qui ne le dit pas » : l'entrée ne peut jamais réussir et ne le dit qu'après la saisie) ; audit §5.1 (contenu « suivi de l'action à faire ») : l'action indiquée est fausse.
- Le registre classe le point « bas » ; il l'est en fréquence (clé maître perdue), pas en effet pour qui le rencontre.

**A23 (partie « garde des journaux avec deux trous »), avec le texte ajouté à `CLAUDE.md`.**
- Fait vérifié : la garde ne voit que `console.log|info|warn|error(` (`scripts/check-logs.ts:53`) : `console.debug`, `console.trace`, `.catch(console.error)` et la forme `: (err)` d'un ternaire passent. Le registre le reconnaît (tâches 4 et 15, mise en attente finale).
- Source contredite : `CLAUDE.md:105` affirme désormais « aucun appel `console.*` [...] ne reçoit un objet d'erreur entier », alors que la garde ne le prouve pas ; anti-objectif de `CLAUDE.md` : « Un invariant affirmé dans un document sans test qui casse quand on le viole ». Reporter les trous est défendable (aucune occurrence aujourd'hui selon le registre) ; écrire l'invariant sans réserve ne l'est pas.
- À faire : soit fermer les trous (ajouter `debug|trace` et la référence nue `console.error` sans parenthèse au motif), soit écrire dans `CLAUDE.md` ce que la garde ne voit pas.

### Fait non vérifié ou faux

**B7. Trois clés traduites par un texte neutre qui l'emporte aussi en français.**
- Justification du registre : « le détail du fournisseur reste dans la liste des contrôles (À VÉRIFIER EN TÂCHE 10) ».
- Vrai pour `verification_failed` : le formulaire de raccordement et la fenêtre de remplacement affichent les contrôles en échec (`apps/web/src/components/connections/connect-form.tsx:121-125,194`).
- Faux pour `listing_failed` : la fenêtre « Rafraîchir les numéros » n'affiche que `failure.message` (`apps/web/src/components/connections/account-run-dialog.tsx:58-60,74-77`), il n'y a pas de liste de contrôles, et le détail du moteur (`path: 'numbers'`, `whatsapp-account-service.ts:404-408`) n'est lu nulle part. Ce que voit l'admin quand Meta refuse le jeton : « Lecture des numéros auprès du fournisseur impossible. Réessayez. » (`fr.json:161`). « Réessayez » est un conseil faux : réessayer échouera, le compte vient de passer en erreur `token_invalid` (`whatsapp-account-service.ts:401-403`). Le bandeau du compte, relu derrière la fenêtre, dit la vraie cause, mais la fenêtre ouverte dit le contraire.
- Contraire aussi à §5.1 (refus dans une fenêtre : « message du moteur, suivi de l'action à faire »).
- À faire : en cas de `listing_failed`, afficher le détail `numbers` (texte du moteur, déjà en français) ou un texte selon la cause (« Jeton refusé par Meta : remplacez les identifiants »), et ne dire « Réessayez » que pour une panne passagère.

### Discutable

**A12. Échecs de remise lisibles par tout membre.** Défendable (spec §7.6 « visible sur la page de l'agent IA », aucune donnée de contact). Mais le compteur n'est jamais remis à zéro (`whatsapp-sqlite.ts:575`, `whatsapp-postgres.ts:614`) et l'écran ne montre pas de date (`BotNumberSummary` sans `last_delivery_error_at`, `packages/contracts/src/whatsapp.ts:241-243`) : une pastille ancienne se lit comme un problème en cours. Pour un non-admin, aucune suite (§5.1 « cause, conséquence, action »). Voir « À trancher » 6.

**A13. Format des coûts (partie taux).** « < 0,01 $ », tokens en entier et période au minuit de Paris sont fondés. Le taux n'est lu qu'au point décimal (`apps/web/src/lib/money.ts:25-30`) : une saisie française `USD_EUR_RATE=0,92` est ignorée sans avertissement et l'écran affiche les dollars seuls. Alternative : accepter la virgule, ou journaliser au démarrage du back-office que le taux est illisible.

**A16. Tons de l'assistant traduits à l'affichage, valeur française envoyée.** Le moteur insère la valeur telle quelle dans la consigne de la langue concernée (`src/core/services/personality.ts:15,22,38`) : un agent IA dont la personnalité anglaise porte le ton « Warm » reçoit « Your tone: Chaleureux. ». Comportement antérieur, gardé par prudence ; alternative : envoyer le ton dans la langue de l'onglet de personnalité. Effet faible, le modèle comprend.

**A19. Contrôle `app_secret` refusé (422) dans la liste des contrôles, pas sous le champ.** §5.1 : « Champ refusé (`details[].path` = un champ affiché) : sous le champ, `aria-invalid`, focus ». Ici le `path` est `app_secret`, champ affiché du formulaire. Garder la liste complète des contrôles est utile (on voit que le jeton est bon et que le secret ne l'est pas) ; l'alternative qu'un utilisateur préférerait : la liste, et en plus le champ secret marqué en erreur avec le focus.

**A22. `PUT status` de `limited` vers `limited` avec liste vide accepté sans effet.** Le même souhait (« être en accès limité avec une liste vide ») reçoit deux réponses : accepté par `PUT status`, refusé par `POST /activate` (B3, `bot-status.ts:85-90`). Aucun écran n'envoie ce `PUT` aujourd'hui, donc sans effet visible ; mais l'écriture et la ligne d'audit « sans effet » laissent croire à un changement. Alternative : répondre 200 sans écrire ni auditer quand le statut ne change pas.

**B2. Nom d'entité requis ou trop long sans clé.** C-5 option A (validée) : une clé pour chaque refus qui a un écran ; N4 en a un. Avec B8, l'interface anglaise affiche « Check this field. » (`apps/web/src/lib/describe-failure.ts:55-58`, `messages/en.json:197`) au lieu de dire la limite de 80 caractères. Pas de français dans l'anglais, mais un message moins actionnable. Alternative : clé `entity.name_invalid` ou texte côté web.

**B9. Régions d'annonce des notifications.** §5.2 validé : « Une seule région `aria-live` pour toute l'application », réussite `role="status"`, erreur `role="alert"`. Le code monte deux régions (`assertive` et `polite`) et retire les rôles des notifications (`apps/web/src/components/feedback/notification-provider.tsx:99-108`). C'est la pratique d'accessibilité la plus sûre (une région ne peut pas être à la fois polie et immédiate), mais ce n'est pas la lettre de §5.2, et le tri dit « une par niveau d'urgence » sans signaler l'écart. Sans effet visible ; à acter comme amendement de §5.2.

**B25. Compte en erreur : l'agent IA ne répond pas, le panneau Statut le dit, conseil réservé à qui peut agir.** Fait vérifié : un compte qui n'est pas `connected` n'est pas servi (`src/core/router.ts:53`). La correction est juste. Reste le non-admin sans suite à donner (voir A12 et « À trancher » 6).

**C9. Job Playwright ajouté à la CI sans exécution possible avant le premier push.** La suite passe en local (147/147 selon le registre), mais le job lui-même (installation de Chromium, démarrage du faux moteur) n'a jamais tourné : la CI peut être rouge au premier push. Alternative : le lancer une fois sur une branche poussée à part, avec votre accord, avant le merge.

### Amendements de la spec (§8)

- §8.1 (liste vide permise pour un agent IA déjà en accès limité) et §8.3 : conformes à Q-10 et à C-4. La mention « décision de François » couvre aussi le cas du changement de numéro (C-4), qui était une recommandation du rédacteur acceptée par votre « oui » : exact, mais à savoir.
- §8.2 (« l'activation en accès limité exige toujours au moins une entrée, y compris pour un agent IA déjà en accès limité ») : conforme au mot « toujours » de Q-10. Le cas « déjà en accès limité » n'arrive que si l'on relance l'activation de l'assistant après une première activation.
- Non amendés alors que le lot les contredit : §7.5 (« repasse en brouillon ») et la ligne `draft` du §8.1 face à C-1 (voir A9) ; §8.1, §6 et §12 point 8 parlent de « reprise automatique » d'un compte en erreur. Ce qui est vrai : l'agent IA reprend seul quand le compte revient en `connected` ; ce qui est faux : aucune vérification n'est relancée seule (`verify` n'est appelée que par la route `src/api/admin/routes/whatsapp-accounts.ts:60`). Seules les signatures rejetées en série se lèvent seules, à la première signature valide (`src/webhooks/signature-monitor.ts:16-18`, `src/webhooks/meta.ts:191`). Une phrase de précision dans la spec éviterait qu'un futur écran remette la promesse retirée par B17.

---

## 3. Tableau complet

| Id | Verdict | Justification | Preuve |
|---|---|---|---|
| A1 | Fondée | Choix C-1 à C-8 présentés avec leur recommandation, acceptés par « oui sub agent, toi PO » ; deux d'entre eux ont été modifiés ensuite (C-1 par A9, C-6 par A18) | plan, « Choix à trancher » |
| A2 | Fondée | Choix du rédacteur 1 à 6 acceptés de même ; textes conformes (bandeau de session, codes Meta, détail repliable) | `fr.json:67,750-754` |
| A3 | Fondée | Organisation suspendue visible mais jamais ouvrable, seulement pour une appartenance active ; dit ce qui se passe (§5.1) | plan, impact multi-organisation ; ledger tâche 3 |
| A4 | Fondée | Une réussite de l'ancienne organisation serait trompeuse ; le point d'attention 5 vise la navigation, pas la bascule | `notification-provider.tsx:69-75` |
| A5 | Fondée | Sans session connue, dire « session expirée » serait faux ; le retour à la page demandée est gardé | ledger tâche 7 |
| A6 | Fondée | Nomme l'organisation (R-29) ; la page Aucune organisation explique déjà le cas | ledger tâche 8 |
| A7 | Fondée | §5.3 point 1 (l'état change sous les yeux) ; entrée absente plutôt qu'inerte | audit §5.3 |
| A8 | Fondée | Action à conséquence (l'agent IA cesse de répondre), comme Suspendre | ledger tâche 11 |
| A9 | Contraire à une source | « Brouillon » affiché pour un agent IA déjà activé, contre C-1 (« créé, jamais activé », un seul arrêt) | `whatsapp-sqlite.ts:322,388` ; `whatsapp-postgres.ts:351,420` |
| A10 | Fondée | Même vocabulaire que les pastilles (Q-1) | ledger tâche 11 |
| A11 | Revenait à François | Action hors de la liste C-1, gardée en attendant sa confirmation | `fr.json:543` |
| A12 | Discutable | Spec §7.6 respectée, aucune fuite ; compteur jamais remis à zéro, sans date, sans suite pour un non-admin | `whatsapp-sqlite.ts:575` ; `delivery-failures.tsx:23-45` |
| A13 | Discutable | Petits coûts, tokens et minuit de Paris fondés ; taux à virgule ignoré sans avertissement | `money.ts:25-30` |
| A14 | Fondée | Une valeur ancienne présentée comme actuelle serait fausse ; le bandeau dit que l'écriture est enregistrée | commit 9075829 |
| A15 | Fondée | Même logique que C-1 en anglais ; libellés distincts de Connect a account | commit daa41a0 |
| A16 | Discutable | Comportement antérieur gardé ; ton français inséré dans une consigne anglaise | `personality.ts:15,22,38` |
| A17 | Fondée | L'étape est cochée quand un numéro est branché : le libellé dit ce qu'elle mesure ; à montrer en recette | commit 89f5148 |
| A18 | Fondée | Fait vérifié : aucun Dockerfile versionné, `.env.example:6` pose `NODE_ENV=development` ; intention de C-6 gardée ; à confirmer par François, variable absente de son `.env` | `mailer.ts:9-13` ; `.env.example:6,22-26` |
| A19 | Discutable | `path` = champ affiché : §5.1 le met sous le champ ; la liste seule l'éloigne | `connect-form.tsx:121-125` |
| A20 | Fondée | Texte de l'utilisateur, sans jargon, qui nomme la langue | ledger tâche 12 |
| A21 | Fondée | Texte des propres identifiants de l'organisation, renvoyé à son admin, jamais journalisé ; aucun écran du lot ne l'affiche | `connections-service.ts:43-67` ; `hubspot.ts:125` |
| A22 | Discutable | Deux réponses pour la même demande (PUT accepté, activation refusée) ; écriture et audit sans changement | `bot-status.ts:71,85-90` ; commit 7810ce8 |
| A23 | Contraire à une source | Menu « Remplacer » qui ne peut jamais réussir et texte de refus qui mène à un second refus ; invariant des journaux écrit sans réserve dans `CLAUDE.md` alors que la garde a des trous. Autres reports (graphique par jour UTC, date impossible, erreur de type e2e) : défendables | `account-menu.tsx:39-45` ; `fr.json:158` ; `check-logs.ts:53` ; `CLAUDE.md:105` |
| B1 | Fondée | Le BFF valide chaque corps avec le schéma des contrats avant le moteur : aucun écran ne reçoit le message par défaut | ledger tâche 1 et 5 |
| B2 | Discutable | C-5 A demande une clé pour chaque refus à écran ; l'anglais tombe sur « Check this field. » | `describe-failure.ts:55-58` |
| B3 | Fondée | Q-10 : « activer en accès limité exige toujours au moins un numéro » | `bot-status.ts:85-90` ; spec §8.2 |
| B4 | Fondée | Exemption visible, listée et testée, plutôt qu'un détour qui masque l'appel | `mailer.ts:23` |
| B5 | Fondée | Contrainte globale du plan : aucune donnée de contact dans un journal ; une réponse de fournisseur peut en citer | ledger tâche 4 |
| B6 | Fondée | R-24 ; les `details` ne disent que la forme de la requête, l'anti-énumération reste | ledger tâche 5 |
| B7 | Fait non vérifié ou faux | Vrai pour `verification_failed` ; faux pour `listing_failed` : pas de liste de contrôles, détail jamais lu, « Réessayez » faux pour un jeton refusé | `account-run-dialog.tsx:58-60` ; `whatsapp-account-service.ts:401-408` ; `fr.json:161` |
| B8 | Fondée | La règle amendée est une interface de tâche du rédacteur, pas une parole de François ; l'amendement suit §5.1 (actionnable) et le point d'attention 2 (pas de français dans l'anglais) | `describe-failure.ts:55-59,104-106` |
| B9 | Discutable | Deux régions vivantes et aucun rôle, contre la lettre de §5.2 ; meilleure pratique, écart à acter | `notification-provider.tsx:99-108` |
| B10 | Fondée | Une seule façon de lire un refus (clé), plus de comparaison de textes | ledger tâche 7 |
| B11 | Fondée | Point d'attention 1 du plan (next hostile) ; boucle vers /login évitée | ledger tâche 7 |
| B12 | Fondée | §5.1 « événement d'organisation : ce qui s'est passé » | ledger tâche 8 |
| B13 | Fondée | Brief de la tâche 8 et R-13 : « sans parler d'invitation » | ledger tâche 8 |
| B14 | Fondée | Erreur de départ corrigée par le contrôleur lui-même, garde étendue au web | commit bb8e863 |
| B15 | Fondée | Texte exact de §5.1 | `stale-banner.tsx` |
| B16 | Fondée | R-20 et R-22 ; jamais une fausse réussite | commit 1bbdfdf |
| B17 | Fondée | Fait vérifié : aucune vérification relancée seule (`verify` appelée seulement par la route admin) ; cause décidée par le moteur, pas par un texte du fournisseur | `whatsapp-accounts.ts:60` ; `bot-number-summary.ts:38-45` |
| B18 | Fondée | Pas de français en clair dans l'anglais (C-5) ; motif gardé replié | commit 41c4ae2 |
| B19 | Fondée | §5.1 « champ absent de l'écran courant » ; erreur de fait corrigée par le contrôleur, correction vérifiée (champ identifiant à l'étape 1) | `step-identity.tsx:96-99` |
| B20 | Fondée | Lecture conforme au texte du plan (« seulement sur un 409 explicite ») | commit 830ccbe |
| B21 | Fondée | Objet même du lot (R-14, R-15) | ledger tâches 16, 18 |
| B22 | Fondée | Défauts réels, contraires au brief ou au vocabulaire | ledger tâches 11, 18a |
| B23 | Fondée | Une seule règle d'activation appelée partout ; même lecture de date sur les deux moteurs | commits 69b3c19, cc27c51 |
| B24 | Fondée | Seule façon de donner une clé à une règle vérifiée avant le service ; texte et statut inchangés | ledger tâche 1 |
| B25 | Discutable | Fait vérifié, correction juste ; un non-admin n'a aucune suite à donner | `router.ts:53` |
| C1 | Fondée | Règle globale de François (« Pas de signature Claude/Anthropic ») ; aucun commit de la branche ne porte de ligne d'attribution | `git log dd06118..HEAD` |
| C2 | Fondée | Branche isolée, comme les lots 2b | ledger |
| C3 | Fondée | Noms d'agents IA de la même organisation seulement, lus avec `client_id` | `whatsapp-sqlite.ts:423-427` |
| C4 | Fondée | Code mort retiré | ledger tâche 9 |
| C5 | Fondée | Nécessaires au placement sous le champ et au nom accessible | ledger tâche 6 |
| C6 | Fondée | Une CI rouge au hasard masque les vrais échecs | commit 7c09329 |
| C7 | Fondée | Empêche le faux moteur de dériver du vrai | commit 4c86dbb |
| C8 | Fondée | L'état « mergé » ne change qu'au merge | ledger |
| C9 | Discutable | Job jamais exécuté ; risque de CI rouge au premier push | commit fdb7cec |
| H1 | Revenait à François | Q-14 : loader sombre à 1,38:1, couleur proposée, aucune décision prise ; absent du tri | rapport tâche 15, point 10 |
| H2 | Fondée | I-4 accepté : seul le chemin de la page passe dans `next`, aucune donnée ; un autre utilisateur qui s'y rend ne lit que son organisation | ledger tâche 17 |
| H3 | Fondée | Clé `invitation.already_accepted` forcée sur une révocation, puis remplacée par un 403 réel du moteur (correction du contrôleur) | commit f68af3a |
| H4 | Fondée | Texte du moteur `whatsapp_account.disconnected` aligné sur « retiré de WABAGENT » (C-1) | commit b053c08 |

Décompte (57 décisions du tri, plus 4 hors tri) : Fondée 44 (+3 hors tri), Discutable 9, Contraire à une source 2, Fait non vérifié ou faux 1, Revenait à François 1 (+1 hors tri).

---

## 4. Erreurs du tri

- **B7 est une décision produit (groupe A).** Remplacer, en français aussi, le texte précis du moteur par un texte neutre change ce que lit l'admin ; c'est un choix de restitution, pas l'interprétation d'une règle.
- **B25 relève en partie du groupe A.** « Conseil réservé à qui peut agir » décide ce qu'un conseiller voit, et ne voit pas ; même question que A12.
- **B8 change ce que voient les utilisateurs** (anglais : champ et 403 ; français : 403 sans clé), sans que François l'ait vu. Interprétation fondée, mais à montrer en recette comme une décision A.
- **A21 n'est pas une décision produit** : c'est l'interprétation de la règle des journaux (B), sans écran concerné dans ce lot.
- **A3, A4, A5, A6, A7, A10, A14, A15, A20 appliquent directement §5.1 ou §5.3, ou C-1** : ce sont des interprétations (B). Les laisser en A noie les vrais choix produit (A9, A11, A12, A18).
- **B23 (lecture d'une date seule) et B24 (`refine` Zod) sont techniques (C)** ; B10 et B11 aussi pour l'essentiel.
- **B9 est technique (C)** côté effet, mais c'est un écart à la lettre de §5.2 qui devrait être nommé comme tel.
- **Décisions absentes du tri** : Q-14 (loader sombre, en attente de François), I-4 accepté (`next` non lié à l'utilisateur), I-1 et I-2 transformés en tests d'isolation, alignement du texte `whatsapp_account.disconnected`, clé forcée sur une révocation puis corrigée (H1 à H4 du tableau). Q-14 est la seule qui demande une réponse de François.
- **A23 regroupe des reports de poids très différent** : le menu `reconnect` (texte faux à l'écran) et la garde des journaux (invariant affirmé dans `CLAUDE.md`) n'ont pas la même gravité que la date impossible ou l'erreur de type e2e ; ils auraient dû être triés à part.
