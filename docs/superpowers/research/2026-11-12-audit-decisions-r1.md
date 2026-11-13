# Audit des décisions du lot R1 (raccordement automatique du compte WhatsApp)

Date : 12 novembre 2026. Branche : `feat/raccordement-r1`, commits `c516ab8..70ff334` (32 commits). Auditeur neuf : le registre est lu comme une liste d'affirmations à contrôler, pas comme des règles.

Tableau audité : `docs/superpowers/research/2026-11-12-registre-decisions-r1.md`, sections A (P-1 à P-11), B (I-1 à I-6), C (T-1 à T-8), soit 25 décisions ; sections D et E lues pour dire si un point devrait bloquer.

Sources d'autorité lues : `CLAUDE.md`, spec du lot (`docs/superpowers/specs/2026-11-12-raccordement-automatique-r1-design.md`, dite « spec »), `docs/ROADMAP.md` section R, essai du 12 nov. 2026 (`2026-11-12-essai-raccordement-automatique.md`), limites de l'API Meta (`2026-11-12-limites-api-meta-raccordement.md`). Revue d'isolation `2026-11-12-revue-isolation-r1.md` lue pour ses faits, pas pour ses conclusions.

Code lu : `src/core/services/whatsapp-account-service.ts` (en entier), `src/whatsapp/meta-webhooks.ts`, `src/whatsapp/meta-graph.ts` (diff), `src/webhooks/meta.ts` (diff), `src/webhooks/pending-verification.ts`, `src/core/services/meta-webhook-plan.ts`, `src/core/services/bot-number-summary.ts` (diff), pilotes SQLite et Postgres (écritures d'état), `src/api/errors.ts`, contrats (`errors.ts`, `whatsapp.ts`), et côté web `account-webhooks.tsx`, `disconnect-dialog.tsx`, `verification-checks.tsx`, `connect-guide-meta.tsx`, `account-card.tsx`, `account-run-dialog.tsx`, `connect-form.tsx`, `connect-result.tsx`, `number-panel.tsx`, la page Connexions, `describe-failure.ts`, `apps/web/messages/fr.json`.

Limites de cet audit, à savoir avant de s'y fier :
- un seul test lancé : `npx vitest run src/api/__tests__/error-reasons-usage.test.ts` (51 tests verts à `70ff334`). Les suites complètes, Postgres et e2e n'ont pas été rejouées ;
- les constats sur l'écran viennent de la lecture du code et des textes, aucun n'a été rejoué dans un navigateur ;
- je ne connais pas les libellés actuels des pages de Meta : tout ce qui touche au guide est à relever en recette, comme la spec le demande ;
- les numéros de ligne sont ceux de `70ff334`.

## Résumé chiffré

| Verdict | Nombre | Décisions |
|---|---|---|
| Conforme | 15 | P-1, P-6, P-7, P-8, I-1, I-2, I-3, I-4, I-5, I-6, T-1, T-4, T-5, T-6, T-8 |
| À reclasser | 1 | T-7 |
| Contestée | 5 | P-2, P-3, P-5, P-10, T-3 |
| Non conforme au code | 4 | P-4, P-9, P-11, T-2 |
| Total | 25 | |

Décisions prises dans le code et absentes du registre : 10 (N-1 à N-10).

En une phrase : rien de ce que j'ai lu ne fait traverser une donnée entre organisations ; les écarts sont un correctif annoncé et absent du code (P-9), des phrases d'écran qui affirment plus que ce que le moteur sait (P-4, P-10, P-11), un conseil qui ne mène nulle part (P-3), et un cas où un raccordement raté efface chez Meta une adresse que WABAGENT n'avait pas posée (T-3, lié à D-2).

## Décisions non conformes au code

### P-9. Bande bordée vide d'un compte en erreur

**Ce que dit le registre.** La bande bordée vide d'un compte en erreur (carte et encart Numéro) est retirée.

**Ce que fait le code.** Elle est toujours là.
- `apps/web/src/components/connections/account-card.tsx:93` à `106` : le conteneur `<div className="border-t border-border px-[18px] py-3">` est rendu dès que `account.webhooks !== null || account.meta_health !== null`.
- `src/core/services/bot-number-summary.ts:56` à `59` : `presentWebhooks` rend un objet pour tout compte Meta non retiré, compte en erreur compris.
- `apps/web/src/components/connections/account-webhooks.tsx:104` et `138` à `144` : hors `connected`, aucune ligne de webhook ; sans problème signalé par Meta, le composant ne rend rien.
- Résultat pour un compte Meta en erreur sans état Meta à dire : un trait et 24 px de vide sous le bandeau d'erreur de la carte. Même mécanisme dans l'encart Numéro (`apps/web/src/components/agent/number-panel.tsx:90` à `107`, conteneur `mt-2.5` vide, sans trait).
- L'arbre de travail est propre (`git status` : seuls le registre et la revue d'isolation sont non suivis) : il n'y a pas de correctif en attente. Le registre note « en recette », le correctif n'a pas été commité.

**Recommandation.** Corriger avant la recette (ne monter le conteneur que si le composant a une ligne à dire), avec un test sur la carte et sur l'encart. Constat de lecture, non rejoué à l'écran.

### P-4. Fenêtre de retrait

**Ce que dit le registre.** La fenêtre n'avertit que si le webhook de l'app pointe encore vers le compte retiré (`left`) ou si le retrait chez Meta a échoué ; elle dit aussi le repointage.

**Ce que fait le code.** `left` ne veut pas seulement dire « pointe encore vers ce compte ». Le moteur rend `left` aussi quand il n'a rien pu lire :
- identifiants illisibles : `whatsapp-account-service.ts:1163` ;
- app ou adresse publique inconnue : `:1221` à `1224` ;
- lecture du webhook de l'app en échec chez Meta : `:1225` à `1229` ;
- panne inattendue : `:1201` à `1208` ;
- repointage en échec : `:1255` à `1256`.

Dans ces cas la fenêtre (`disconnect-dialog.tsx:92`, texte `appWebhookLeft`) affirme « Le webhook de votre app Meta pointe encore vers ce compte retiré », ce que le moteur ne sait pas. Le registre le reconnaît à moitié dans la section E (« `PUBLIC_BASE_URL` changée qui donne `not_applicable` au lieu de `left` »), sans dire que l'inverse existe.

Le repointage n'est pas dit par la fenêtre mais par la notification de la page (`connexions/page.tsx`, `disconnect.done` suivi de `appWebhookRepointed`), sauf si la fenêtre reste ouverte pour une autre raison (`disconnect-dialog.tsx:71` à `73` et `93`). C'est cohérent, mais ce n'est pas ce qu'écrit le registre.

**Source.** Spec §5.5 : la fenêtre le dit « avec la marche à suivre si le client veut le changer chez Meta ». Le texte dit « changez-le dans Meta si l'app sert à autre chose », sans chemin de clics ni lien. Principe de François : toute erreur visible, compréhensible et actionnable.

**Recommandation.** Distinguer dans le contrat « laissé » (lu, pointe vers ce compte) de « non lu » (phrase prudente : « WABAGENT n'a pas pu lire le webhook de votre app Meta »), et donner le chemin dans Meta (tableau de bord de l'app, WhatsApp, Configuration), à relever en recette.

### P-11. Sans `PUBLIC_BASE_URL`

**Ce que dit le registre.** Le raccordement, la vérification et le remplacement sont refusés avec « La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support. » ; avertissement `[Config]` au démarrage.

**Ce que fait le code.**
- Raccordement : refus 422 avec la raison `whatsapp_account.public_url_missing` avant tout appel (`whatsapp-account-service.ts:241` à `247`, `:327`). Conforme.
- Remplacement : même refus (`:851`). Conforme.
- Avertissement : `src/core/config.ts:157` à `159`, appelé dans `src/index.ts`. Conforme.
- « Vérifier maintenant » : ce n'est pas un refus. Le moteur répond 200, issue `inconclusive`, avec un contrôle `webhook_waba` en échec dont le détail est la phrase (`:935` à `942`). L'écran titre alors « Vérification non concluante. Réessayez. » (`account-run-dialog.tsx:125`, texte `verify.inconclusive`) au-dessus d'une ligne qui dit « Contactez le support ». Deux consignes contraires, et réessayer ne peut pas réussir. La raison stable n'est pas portée par la réponse : en anglais le texte français du moteur est replié sous « Échec » (`verification-checks.tsx:89`).
- « Faire pointer vers WABAGENT » : refusé aussi (422, `:790` à `791`), non cité dans P-11 (cité dans I-4).

**Source.** Spec §5.3 : « vérification refusée avec la raison `public_url_missing`, non concluante, état du compte inchangé ». L'état inchangé est tenu ; la raison stable ne l'est pas.

**Recommandation.** Garder le 200 non concluant, mais faire porter au résultat de quoi afficher la phrase par sa clé et un titre sans « Réessayez » dans ce cas.

### T-2. Réservation en mémoire par WABA

**Ce que dit le registre.** Réservation « autour de toute écriture chez Meta (raccordement, vérification, remplacement, « Faire pointer », déconnexion) ».

**Ce que fait le code.** La réservation couvre les écritures sur l'adresse de la WABA, pas celles sur le webhook de l'app, sauf « Faire pointer » :
- raccordement : réservation rendue à `:473`, webhook de l'app écrit ensuite à `:481` ;
- « Vérifier maintenant » : `reconcileWabaOverride` rend la réservation (`:597` à `599`), la règle de l'app est appliquée après (`:1037`) ;
- remplacement : même enchaînement (`:903` puis `:907`) ;
- déconnexion : réservation rendue à `:1160`, repointage du webhook de l'app à `:1163` ;
- retrait de l'adresse de l'ancienne app : hors réservation (`:896`), ce que T-8 dit lui-même.

Les parties exactes du registre : réservation prise avant les contrôles d'unicité (`:414` puis `:417` à `:425`) et avant la déconnexion en base (`:1144` puis `:1147`) ; « Faire pointer » est bien sous réservation (`:793` à `817`).

**Source.** Spec §5.4 : « Aucun verrou par app en R1 ». Le comportement est donc conforme à la spec ; c'est la phrase du registre qui est trop large. À corriger dans le registre pour que le chantier Infra ne parte pas d'une garantie qui n'existe pas.

## Décisions contestées

### P-2. « Vérifier maintenant » : issue « vérifié » quand le webhook n'a pas pu être inscrit

**Ce que l'utilisateur voit.** Titre ambre « Identifiants vérifiés, webhook non inscrit chez Meta. », contrôle du webhook en échec, compte toujours « Connecté », ligne ambre « Webhook absent chez Meta : lancez Vérifier maintenant. » sur Connexions et sur la page de l'agent IA.

**Code.** Conforme au registre : `whatsapp-account-service.ts:986` à `995` (issue `verified` sauf jeton refusé), `account-run-dialog.tsx:119` à `127`.

**Source.** Spec §5.3 : l'échec de réinscription « est non concluante (`transient`) et ne met jamais le compte en `error` ». Le code tient le fond (jamais `error`, alerte visible) mais rend `verified`, pas « non concluant ». L'argument du registre tient : « non concluant » promet que rien n'a changé, alors que la date de vérification a été écrite (`:981`).

**Trois points à trancher.**
1. Un compte en erreur dont le jeton est de nouveau bon repasse « Connecté » même si le webhook n'a pas pu être inscrit (`:981` avant `:987`). Ses agents IA Online sont alors comptés comme répondant (la mention « Ne répond pas » ne lit pas l'état des webhooks) alors qu'aucun message n'arrive. La spec l'accepte pour une panne passagère ; pour un compte qui sort d'erreur, c'est proche de l'anti-objectif « un compte affiché raccordé alors que Meta n'a pas accepté notre webhook ».
2. Le titre est posé dès qu'un contrôle `webhook_waba` ou `webhook_app` est en échec. Il dit donc « webhook non inscrit chez Meta » dans des cas où rien n'est su : autre opération en cours (`:552` à `556`), identifiants changés entre-temps (`:559` à `562`), lecture chez Meta en panne (`:565` à `570`), ou quand seul le webhook de l'app a échoué alors que les messages arrivent.
3. Amender la spec §5.3 si l'issue `verified` est gardée.

**Recommandation.** Garder la décision ; titre plus prudent (« Identifiants vérifiés, webhook à contrôler. ») ou deux titres selon le cas.

### P-3. Après un échec de « Faire pointer vers WABAGENT »

**Ce que l'utilisateur voit.** Dans la fenêtre : « WABAGENT n'a pas pu inscrire le webhook de votre app Meta. Les messages arrivent, mais pas les alertes de compte de Meta. Réessayez avec Vérifier maintenant. » Le bouton « Faire pointer vers WABAGENT » reste sur la carte.

**Code.** Le bouton reste : conforme (`whatsapp-account-service.ts:813` à `814`, état `elsewhere` gardé). Le refus affiché est le texte de la raison `whatsapp_account.app_webhook_failed`, seul (`account-webhooks.tsx:216` et `229`).

**Ce qui est contestable.**
- Le conseil ne mène nulle part : « Vérifier maintenant » ne remplace jamais une adresse hors de WABAGENT (`:1037`, `allowReplaceElsewhere` faux par défaut, `:748` à `754`). L'utilisateur qui suit le conseil retrouve la même ligne. Le seul geste utile est de recliquer « Faire pointer vers WABAGENT ».
- La cause n'est pas montrée : le détail du moteur (« Une autre opération est en cours », « Ce compte a changé pendant l'opération », « Ce compte n'est pas connecté ») et le message de Meta (`provider_text`) sont dans `details` (`:783` à `785`, `:822`) et la fenêtre ne les lit pas. La spec §5.1 étape 7 demande l'alerte « et la raison ».

**Source.** Principe de François : toute erreur visible, compréhensible et actionnable.

**Recommandation.** Un texte propre à cette fenêtre (« Réessayez ») et le détail replié du fournisseur, comme dans la liste des contrôles.

### P-5. Textes reformulés pour le test de style

**Code.** `fr.json`, `disconnect.wabaCleanupFailed` : « L'adresse de WABAGENT n'a pas pu être enlevée chez Meta ; elle ne reçoit plus rien. » (le test `messages-style.test.ts:179` refuse « WABAGENT » et « retir » dans la même phrase). `guideMeta.app.hint` : « choisissez le cas d'usage WhatsApp destiné aux échanges avec les clients ».

**Ce qui est contestable.** La première reformulation ne pose pas de problème. La seconde paraphrase un libellé de Meta pour satisfaire une règle faite pour nos propres textes (`messages-style.test.ts:267` à `269`, qui refuse « connecter … WhatsApp »). Or l'utilisateur doit reconnaître ce libellé dans la page de Meta.

**Source.** Spec §2, anti-objectif : « un guide qui décrit des écrans de Meta faux » ; §6.1 : « Les libellés exacts des pages Meta sont relevés en recette ». Un libellé paraphrasé n'est pas un libellé exact.

**Recommandation.** Relever le libellé réel en recette et le citer tel quel, avec une exception écrite dans le test pour cette clé. Je ne connais pas le libellé actuel de Meta : à constater dans la page.

### P-10. Bilan du retrait après un raccordement raté

**Code.** Conforme sur la forme : le bilan sort de la liste des contrôles et devient une phrase (`verification-checks.tsx:43`, `55` à `69` ; `connect-form.tsx:138` et `222` ; clés `WEBHOOK_CLEANUP_DETAIL` dans `packages/contracts/src/whatsapp.ts`).

**Ce qui est contestable : le texte.** `checks.cleanupDone` : « L'adresse inscrite chez Meta pendant ce raccordement a été retirée : rien ne reste chez Meta. » Ce n'est pas toujours vrai :
- le retrait est `POST /<WABA>/subscribed_apps` sans corps (`meta-webhooks.ts:94` à `97`), qui abonne l'app. Si l'app n'était pas abonnée à la WABA avant la tentative (contrôle `subscription` en attente), elle le reste après : il reste quelque chose chez Meta, et les messages de la WABA partent vers le webhook de l'app (revue d'isolation M-3) ;
- si la WABA portait déjà, pour cette app, une adresse posée par un autre outil du client, elle a été remplacée puis effacée : il ne reste rien, mais ce qui a disparu n'était pas à nous (voir T-3 et D-2).

**Source.** Spec §2, anti-objectif : un raccordement qui échoue en laissant quelque chose chez Meta « sans le dire ». Spec §6.3 : l'échec de retrait devait avoir sa clé dans `ERROR_REASONS` ; il a une clé de détail stable à la place, traduite par le web. Équivalent dans l'esprit, écart à la lettre, à noter.

**Recommandation.** Retirer « rien ne reste chez Meta » (« L'adresse de WABAGENT inscrite pendant ce raccordement a été retirée. ») tant que D-1 et D-2 ne sont pas tranchées.

### T-3. Retrait tenté après une panne passagère de l'écriture

**Ce que dit le registre.** Après une panne passagère de l'écriture chez Meta, le retrait est tenté quand même. Si c'est faux : « un appel de plus ».

**Code.** Conforme : `whatsapp-account-service.ts:659` à `666`.

**Ce qui est contestable.** Le coût annoncé est sous-estimé. Le retrait efface l'adresse propre de la WABA pour l'app du jeton, quelle qu'elle soit. Si l'écriture n'a jamais atteint Meta (délai dépassé, 5xx) et que la WABA portait une adresse posée par un autre outil du client sur la même app, le raccordement raté efface cette adresse sans l'avoir remplacée, et l'écran dit « rien ne reste chez Meta ». Même effet pour les deux autres retraits du raccordement (`:435`, `:458`, `:462`). Le cas demande que le client réutilise la même app Meta pour deux outils : rare, mais c'est exactement la famille de l'anti-objectif « remplacer sans prévenir un webhook qui sert un autre produit du client ».

**Tri.** Cette décision écrit chez Meta : au sens du titre de la section A (« visibles à l'écran ou chez Meta »), c'est une décision produit, pas technique.

**Recommandation.** La traiter avec D-2 : la vérification lit déjà `subscribed_apps` (`meta-graph.ts`, `verifyMetaManual`) ; si l'entrée de l'app porte une adresse qui n'est pas de WABAGENT, le dire avant d'écrire, et ne pas retirer une adresse qu'on n'a pas posée.

## Décision à reclasser

### T-7. Remplacement des identifiants vers une autre app

**Code.** Conforme : l'adresse inscrite pour l'ancienne app est retirée avec les anciens identifiants avant l'inscription avec les nouveaux (`whatsapp-account-service.ts:895` à `897`, `:691` à `702`) ; l'ancienne app reste abonnée.

**Tri.** Classée technique, mais elle écrit chez Meta sur une app que l'utilisateur est en train de quitter : décision produit au sens de la section A. De plus son échec n'est dit nulle part à l'écran : il va au journal et à l'audit seulement (`old_app_cleanup`, `:915` à `921`). Si le retrait échoue, chaque message arrive deux fois, dont une signée avec l'ancien secret et rejetée.

**Recommandation.** La passer en section A, en faire une étape de recette, et dire l'échec dans le résultat du remplacement (contrôle ou phrase).

## Décisions conformes

P-1, P-6, P-7, P-8, I-1, I-2, I-3, I-4, I-5, I-6, T-1, T-4, T-5, T-6, T-8.

Preuves et remarques :
- **P-1.** `bot-number-summary.ts:50` à `59` (état `unknown` pour un compte jamais relu) ; `account-webhooks.tsx:108` à `114` ; `fr.json`, `webhooks.wabaUnknown` et `verifyHint`. Texte exact du registre.
- **P-6.** Conforme, et ce n'est pas une décision d'exécution : la spec §6.1 range déjà la vérification d'entreprise sous « Recommandé ». `connect-guide-meta.tsx:10` et `52` à `58` ; `fr.json`, `connectFlow.prerequisite` passé de « avec l'entreprise vérifiée » à « au nom de votre entreprise ».
- **P-7.** `account-webhooks.tsx:105` à `106` (ligne verte) et `:100` à `101` (« prévenez un administrateur »). Remarque : la ligne verte s'affiche aussi sur la page de chaque agent IA, pour tout membre qui la lit, et dans le résultat du raccordement.
- **P-8.** `account-webhooks.tsx:27` à `30` et `:104` ; `number-panel.tsx:100` à `105` (lien « Voir dans Connexions » pour qui peut l'ouvrir). Test : `account-webhooks.test.tsx:243`.
- **I-1.** Les cinq raisons sont déclarées dans le premier commit (`19f843f`) ; quatre sont émises à partir de `33cdabc`, la cinquième (`app_webhook_failed`) à partir de `7e019fd`. La garde est donc rouge sur 8 commits des 32 (`19f843f`, `e8850db`, `3827d86`, `27fc0c5`, `33cdabc`, `c289abd`, `0e217b3`, `29b244c`), plus que « quelques ». Verte à `70ff334` (test lancé). Aucune exemption ajoutée.
- **I-2.** Jeton refusé : `:589`, `:1030` à `1036` (compte en erreur). Sans adresse publique : `:935` à `942`, aucun appel. Voir P-11 pour l'affichage.
- **I-3.** `:559` à `562` (rien écrit), `:1029` (issue `verified`, contrôle en échec). Remarque : le titre dit alors « webhook non inscrit chez Meta », ce qui n'est pas su (voir P-2, point 2).
- **I-4.** `:781` (CM.com, 404), `:786` (compte en erreur, 422), `:790` à `791` (sans adresse publique, 422), `:782` (compte retiré, 409). `src/api/errors.ts:11` : `WA_VALIDATION_FAILED` vaut 422.
- **I-5.** `src/__tests__/isolation/raccordement.test.ts:365`.
- **I-6.** Un seul appel à `registerPendingVerification` dans le moteur : `whatsapp-account-service.ts:428`, dans `createMeta`. Test : `raccordement.test.ts:161`.
- **T-1.** `meta-graph.ts`, `verifyMetaManual` : plus aucun `POST`, l'option `beforeWrite` est supprimée ; contrôle d'unicité sous réservation à `:414` à `425`. Remarque : à « Vérifier maintenant », si l'app n'est pas abonnée et que la réinscription échoue, le contrôle « Abonnement aux webhooks » affiche « Abonnement fait au raccordement », hors de propos dans cette fenêtre.
- **T-4.** Refus net : `:667` à `670`. Panne de la base : `:455` à `459`, 500 avec le bilan du retrait en détail. À l'écran : texte de panne générique, référence et phrase du retrait (`describe-failure.ts`, statut 500 ; `connect-form.tsx:138`). Le texte `SAVE_FAILED` du moteur n'est jamais affiché par le web, ce qui est la règle du lot « Restitution ».
- **T-5.** `meta-graph.ts`, `makeAppContext` et `graphCall` : jeton d'app dans l'en-tête `Authorization`, `appsecret_proof` calculé sur le jeton d'app. Précision : l'adresse du webhook (qui contient la clé du compte) et le jeton de vérification partent, eux, en paramètres d'URL vers `graph.facebook.com` (`meta-webhooks.ts:89` à `91` et `:119` à `121`). Rien n'est journalisé de notre côté ; à noter pour le chantier S. Reste à valider en recette avec « Clé requise » activé puis désactivé, comme le registre le dit.
- **T-6.** SQLite : `whatsapp-sqlite.ts:566` à `604`. Postgres : `whatsapp-postgres.ts:601` à `626`. Filtre par organisation et identifiant, écriture champ par champ, compte retiré exclu.
- **T-8.** `:896`, hors de toute réservation. Voir T-7 pour le tri.

## Décisions prises dans le code et absentes du registre

| N° | Décision constatée | Preuve | Nature | Avis |
|---|---|---|---|---|
| N-1 | Le domaine de l'autre outil du client (`app_host`) et les textes de Meta sur l'état du compte sont lus par tout membre qui ouvre la page d'un agent IA, conseiller compris | `bot-number-summary.ts:82` à `85` ; `number-panel.tsx:90` à `99` | Produit | Déjà signalée par la revue d'isolation comme « à valider en recette », jamais reportée au registre. À trancher par François |
| N-2 | Liste des champs abonnés sur le webhook de l'app : 8 champs, dont 4 que le moteur ne lit pas (`account_alerts`, `account_review_update`, `message_template_status_update`, `security`) ; l'écriture remplace l'abonnement de l'app pour cet objet | `meta-webhooks.ts:18` à `21` ; `meta-events.ts:34` à `36` | Produit (écrit chez Meta) | La spec §5.4 demande une liste « d'après les champs que le moteur sait lire ». L'essai avait relu 10 champs. À justifier ou à réduire |
| N-3 | La déconnexion répond 200 avec un bilan au lieu de 204 ; un compte déjà retiré répond 200 « rien à faire » | `src/api/admin/routes/whatsapp-accounts.ts:72` à `75` ; `whatsapp-account-service.ts:1137` | Technique (contrat) | À inscrire dans les contrats changés de `CLAUDE.md` |
| N-4 | `GET /whatsapp-accounts/:id/webhook` d'un compte Meta répond 404 « Compte WhatsApp introuvable. » | `whatsapp-account-service.ts:315` à `319` | Technique | Laissé au builder par la spec §6.2 : choix à consigner. Le texte « introuvable » pour un compte qui existe est acceptable tant qu'aucun écran ne lit cette route pour Meta |
| N-5 | Deux raisons en plus de celles de la spec §6.3 (`webhook_unconfirmed`, `webhook_url_too_long`) ; les cinq textes renvoient au support ; une panne de Meta pendant l'écriture (délai, 5xx) est rendue sous `webhook_unreachable`, dont le texte dit « Meta n'a pas pu joindre WABAGENT » | `packages/contracts/src/errors.ts` ; `fr.json`, `errors.reason.whatsapp_account` ; `whatsapp-account-service.ts:659` à `666` | Produit (textes) | Le dernier point dit une cause fausse en tête ; la vraie cause est dans la ligne du contrôle. À revoir |
| N-6 | État lu chez Meta : textes (« Meta bloque les envois de ce compte : les agents IA ne peuvent plus répondre. »), liens codés en dur vers le Centre de sécurité et WhatsApp Manager, seul le code 141010 traduit, aucune date affichée alors que l'état date de la dernière vérification ou du dernier rafraîchissement | `account-webhooks.tsx:16` à `20` et `:153` à `181` ; `fr.json`, `webhooks.*` | Produit | L'agent IA reste Online sans mention « Ne répond pas » pendant que la carte dit qu'il ne peut plus répondre : cohérent avec la spec §5.6, mais à montrer à François. Afficher la date de lecture (`read_at`) éviterait une alerte périmée |
| N-7 | Opérations simultanées : un second raccordement de la même WABA par la même organisation est refusé par « Ce compte WhatsApp est déjà raccordé. » alors que le premier est seulement en cours ; vérification ou remplacement concurrent : contrôle en échec « Une autre opération est en cours sur ce compte WhatsApp, réessayez. » | `whatsapp-account-service.ts:284` à `290`, `:552` à `556` | Produit (textes) | Premier texte inexact si le premier raccordement échoue ensuite. Mineur |
| N-8 | Guide : liens retenus (dont l'ancienne adresse de la documentation Meta, que le document des limites dit en cours de migration), bloc « Recommandé » sans aucun lien, avertissement sur le WABA ID, mention du numéro de test | `connect-guide-meta.tsx:5` à `7` et `:52` à `58` ; `fr.json`, `guideMeta.*` | Produit | La spec §6.1 demande le chemin de clics et le lien direct quand il existe : le Centre de sécurité a un lien dans la carte du compte, pas dans le guide. À relever en recette |
| N-9 | Un webhook inscrit par le moteur s'affiche « Webhook de la WABA chez Meta abonnement créé » dans la liste des contrôles | `verification-checks.tsx:97` ; `fr.json`, `checks.created` | Produit (texte) | La spec §6.2 attend « Webhook inscrit chez Meta ». Texte hérité du contrôle d'abonnement, à adapter pour ces deux clés |
| N-10 | Avant le retrait, la fenêtre de confirmation ne dit pas que la WABA revient au webhook de l'app, donc que l'autre outil du client, s'il y en a un, recevra les messages | `fr.json`, `disconnect.text` (inchangé) ; spec §5.5 | Produit | À traiter avec D-1 |

## Sections D et E : ce qui devrait bloquer

- **D-2 (adresse d'un autre outil remplacée sans le dire).** Recommandation du contrôleur juste, mais incomplète : le cas le plus gênant n'est pas le raccordement réussi, c'est le raccordement raté qui efface cette adresse (T-3) et l'écran qui dit « rien ne reste chez Meta » (P-10). Rien n'est déployé, donc pas de dommage aujourd'hui ; je recommande de trancher avant le merge, parce que la correction est petite (la lecture existe déjà) et que le cas est de la famille d'un anti-objectif de la spec.
- **D-1 (désabonner l'app).** Bien laissée à François. Fait à ajouter à sa décision : un raccordement raté sur une WABA où l'app n'était pas abonnée la laisse abonnée (revue d'isolation M-3), et la fenêtre de retrait ne prévient pas du retour au webhook de l'app (N-10).
- **D-3.** Rien à ajouter ; corriger la phrase de T-2 avant de l'inscrire au chantier Infra.
- **Section E.** Aucun des mineurs listés ne me paraît bloquant. Deux précisions : « `view()` final non protégé » vaut aussi pour l'écriture d'audit de `:491` (une panne à cet endroit répond 500 pour un compte créé, puis « déjà raccordé » au second essai), ce qui contredit le commentaire de `:480` ; et la liste oublie P-9, qui n'est pas corrigé.

## Étapes de recette à faire valider par François

Recette sur le compte de dev (WABA `1122051030798254`, app WABAGENT Dev, tunnel `wabagent-dev`), dans une copie de recette. Chaque étape correspond à une décision produit, reclassée ou non consignée.

1. **Guide (P-5, P-6, N-8).** Organisation, Connexions, Raccorder, mode Meta. Lire les cinq étapes et le bloc « Recommandé » en ouvrant chaque lien. À valider : chaque libellé cité existe tel quel dans la page de Meta (dont le nom du cas d'usage WhatsApp et « Clé requise »), le prérequis dit « au nom de votre entreprise », la vérification d'entreprise est sous « Recommandé », aucune étape ne parle de webhook.
2. **Raccordement réussi (P-7, N-9).** Saisir le nom, le WABA ID, le jeton, le secret. À voir : la liste des contrôles avec « Webhook de la WABA chez Meta » et « Webhook de l'app Meta », la ligne verte « Webhook inscrit chez Meta. », aucune adresse ni jeton à copier. À valider : le mot « abonnement créé » sur les deux lignes de webhook.
3. **Sans adresse publique (P-11).** Relancer le moteur sans `PUBLIC_BASE_URL`. À voir au démarrage : `[Config] PUBLIC_BASE_URL absente : le raccordement Meta est impossible`. Raccorder : « La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support. » Sur un compte existant, menu Gérer, Vérifier maintenant : à valider, le titre « Vérification non concluante. Réessayez. » au-dessus de « Contactez le support ».
4. **Tunnel arrêté au raccordement (N-5).** Arrêter le tunnel, raccorder. À voir : « Meta n'a pas pu joindre WABAGENT pour vérifier l'adresse du webhook. Réessayez dans quelques minutes ; si cela continue, contactez le support. », aucun compte dans la liste.
5. **Raccordement raté après l'écriture (P-10, T-3).** Cas à provoquer côté moteur (relecture qui ne montre pas l'adresse, ou base arrêtée juste après l'inscription). À voir : la phrase grise « L'adresse inscrite chez Meta pendant ce raccordement a été retirée : rien ne reste chez Meta. » hors de la liste des contrôles. À valider : cette phrase, sachant que l'app reste abonnée à la WABA et qu'une adresse posée avant par un autre outil sur la même app serait effacée.
6. **Compte raccordé avant le lot (P-1).** Sur un compte Meta dont l'état des webhooks est vide en base. À voir sur sa carte : « État du webhook inconnu : lancez Vérifier maintenant. » avec le bouton. Cliquer : le webhook est inscrit, la ligne passe au vert.
7. **Vérifier maintenant, webhook non inscrit (P-2).** Retirer l'adresse de la WABA chez Meta à la main, arrêter le tunnel, puis Vérifier maintenant. À voir : titre ambre « Identifiants vérifiés, webhook non inscrit chez Meta. », compte toujours « Connecté », ligne « Webhook absent chez Meta : lancez Vérifier maintenant. » sur la carte et sur la page de l'agent IA, agent IA toujours Online sans « Ne répond pas ». À valider : ce choix, y compris pour un compte qui sortait d'erreur.
8. **Webhook de l'app ailleurs (spec §10, question 1 ; N-1).** Dans l'app Meta, WhatsApp, Configuration, faire pointer le webhook vers une autre adresse, puis Vérifier maintenant. À voir sur la carte : « Le webhook de votre app Meta pointe vers {domaine} : les alertes de compte de Meta n'arrivent pas à WABAGENT. » et le bouton « Faire pointer vers WABAGENT ». Ouvrir la page de l'agent IA avec un compte conseiller : à valider, il lit le domaine de l'autre outil et « prévenez un administrateur de votre organisation ».
9. **Faire pointer vers WABAGENT, réussite (N-2).** Cliquer le bouton, lire la confirmation (« {domaine} ne recevra plus les événements de cette app Meta »), confirmer. À voir : « Le webhook de votre app Meta pointe maintenant vers WABAGENT. » Dans Meta : à valider, la liste des champs abonnés de l'app après l'écriture.
10. **Faire pointer vers WABAGENT, échec (P-3).** Refaire l'étape 8, arrêter le tunnel, cliquer le bouton. À voir : « WABAGENT n'a pas pu inscrire le webhook de votre app Meta. […] Réessayez avec Vérifier maintenant. », bouton toujours présent sur la carte. À valider : ce conseil, sachant que « Vérifier maintenant » ne remplace pas l'adresse.
11. **Page de l'agent IA (P-7, P-8).** Agent IA branché sur un compte connecté : ligne verte « Webhook inscrit chez Meta. », aucun bouton. Avec un webhook absent : la ligne ambre et le lien « Voir dans Connexions » pour un administrateur. Compte en erreur : aucune ligne de webhook.
12. **Compte en erreur, bande vide (P-9).** Mettre un compte Meta en erreur (jeton révoqué, Vérifier maintenant). À voir sur sa carte, sous le bandeau rouge : aucun trait ni espace vide. En l'état du code, la bande vide est attendue : à corriger avant cette étape.
13. **État du compte lu chez Meta (N-6).** Sur le compte de dev, dont l'entreprise n'est pas vérifiée : à voir « Meta limite les envois de ce compte. », la cause « Vérification d'entreprise à faire chez Meta » et le lien « Ouvrir le Centre de sécurité de Meta ». À valider : les deux liens ouvrent la bonne page, l'absence de date, et le texte du cas bloqué.
14. **Retrait, dernier compte de l'app (P-4, N-10).** Mettre l'agent IA Offline, menu Gérer, Retirer le compte. À voir : fenêtre « Compte {nom} retiré » avec « Le webhook de votre app Meta pointe encore vers ce compte retiré ; changez-le dans Meta si l'app sert à autre chose. » À valider : la phrase sans chemin dans Meta, et le texte de confirmation qui ne dit pas que la WABA revient au webhook de l'app. Dans Meta : l'adresse propre de la WABA a disparu.
15. **Retrait avec repointage (P-4).** Deux comptes de l'organisation sur la même app, le webhook de l'app pointant vers le premier. Retirer le premier. À voir : la fenêtre se ferme, la notification dit « Compte WhatsApp {nom} retiré. Le webhook de votre app Meta pointe maintenant vers le compte {autre}. »
16. **Retrait, Meta injoignable (P-4, P-5).** Révoquer le jeton chez Meta puis retirer le compte. À voir : « L'adresse de WABAGENT n'a pas pu être enlevée chez Meta ; elle ne reçoit plus rien. », compte retiré quand même.
17. **Remplacement vers une autre app (T-7).** Menu Gérer, Remplacer les identifiants, avec le jeton et le secret d'une seconde app de la même organisation. À voir : contrôles des deux webhooks. Dans Meta : l'ancienne app n'a plus d'adresse propre sur la WABA et reste abonnée. À valider : ce comportement, et le fait qu'un échec de ce retrait ne soit dit nulle part à l'écran.
18. **« Clé requise » (T-5).** Dans l'app Meta, Paramètres, Avancé, activer « Clé requise », puis Vérifier maintenant et « Faire pointer vers WABAGENT » ; refaire désactivé. À voir : les deux réussissent dans les deux cas.
19. **Décisions laissées à François (D-1, D-2).** Avec les faits des étapes 5, 14 et 17 sous les yeux : désabonner ou non l'app au retrait ; prévenir ou non quand la WABA porte déjà une adresse qui n'est pas de WABAGENT.
