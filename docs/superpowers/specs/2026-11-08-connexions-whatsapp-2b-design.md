# Connexions WhatsApp et mise en ligne, plan 2b : design

Date : 8 novembre 2026. Statut : en revue.

Documents d'appui (font autorité sur leur sujet, ce document ne les répète pas) :
- Spec parente des comptes et équipes : `2026-11-07-comptes-et-equipes-design.md` (rôles, `can()`, organisation active, audit).
- Analyse Meta : `docs/superpowers/research/2026-11-07-meta-embedded-signup-analyse.md`.
- Audit ciblé de la zone : `docs/superpowers/research/2026-11-08-audit-zone-2b.md` (numérotation des constats reprise ici sous la forme « audit 1.1 »).

## 1. Intention

WABAGENT doit pouvoir passer en production avec de vraies organisations clientes. Aujourd'hui, un agent IA reçoit ses identifiants WhatsApp et son numéro un par un, en texte libre, et l'audit du 8 novembre a montré que le chemin d'un message n'isole pas les organisations entre elles (sessions, historique, commandes admin, repli sur les identifiants de la plateforme), ignore le statut des agents IA et accepte des webhooks non authentifiés.

Le plan 2b fait trois choses, dans cet ordre :
1. il rend le chemin des messages sûr pour plusieurs organisations, et installe les garde-fous qui empêchent d'y revenir ;
2. il déplace le raccordement WhatsApp au niveau de l'organisation (comptes WhatsApp, inventaire automatique des numéros, en API Meta directe et via CM.com), avec un statut « accès limité » obligatoire avant l'ouverture à tous ;
3. il livre les écrans : Organisation › Connexions et la fin de l'assistant de création (Numéro, Activer).

François l'a formulé ainsi : « on reste vigilant », « trouver enfin une méthode qui ne nous fait pas dériver au bout d'un moment ». La section 4 décrit cette méthode ; elle est permanente, pas propre au 2b.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. Aucune donnée, aucun message, aucun identifiant d'une organisation ne peut atteindre une autre organisation, et des tests le prouvent sur SQLite et sur Postgres.
2. Un agent IA ne répond que s'il est actif, ou en accès limité pour les numéros de sa liste, sur un numéro raccordé par son organisation, avec les identifiants de son organisation.
3. Une organisation raccorde un ou plusieurs comptes WhatsApp (API Meta directe en mode manuel guidé, ou CM.com) ; les numéros remontent seuls ; chaque numéro sert au plus un agent IA ; chaque agent IA a au plus un numéro.
4. Le numéro de test Meta (et le bac à sable CM.com s'il est exploitable) est utilisable comme un numéro normal, signalé comme tel.
5. Changer le numéro d'un agent IA se fait en une opération, sans fenêtre où le numéro n'a personne ou en a deux.
6. L'assistant de création se termine par le choix du numéro et l'activation (en accès limité), et reste terminable sans numéro.

**Non-objectifs (plus tard)**

- Embedded Signup, coexistence avec l'app WhatsApp Business : après le statut Tech Provider et la mise en ligne de wabagent.com.
- CRM au niveau de l'organisation : plan suivant (même logique : identifiants dans l'organisation, usage dans l'agent IA).
- Compte fournisseur partagé entre plusieurs organisations (par exemple un compte CM.com d'agence qui porte les canaux de plusieurs clients) : hors périmètre. Décision François (8 nov. 2026) : une organisation correspond à un portefeuille Meta, et en pratique une WABA porte un numéro ; un compte WhatsApp appartient toujours à une seule organisation. Le modèle accepte quand même plusieurs comptes par organisation et plusieurs numéros par compte.
- Lien de raccordement pour le client d'une agence, notifications par e-mail, modèles de messages (templates), affichage du coût des messages de service.
- File d'entrée persistante (« inbox ») et verrou partagé entre instances : chantier multi-instance (voir points différés).
- Personnalité & contenu de l'agent IA, Conversations & Leads, Reprise humaine.

**Anti-objectifs (ce qui serait un échec même si tout « marche »)**

- Un message, un historique, un lead ou une commande qui traverse la frontière d'une organisation, même dans un cas limite.
- Un agent IA qui répond avec des identifiants qui ne sont pas ceux de son organisation (repli `.env` compris).
- Un agent IA qui répond alors qu'il est en brouillon, en pause, ou que son organisation est suspendue.
- Un webhook traité sans authentification vérifiée.
- Deux façons de router un message (par exemple un routage par mot-clé « seulement pour le test »). Règle maintenue : 1 numéro = 1 agent IA.
- Un invariant affirmé dans un document sans test qui casse quand on le viole.
- Un élément d'interface sans effet qui ne le dit pas (règle reprise du 2a).

## 3. Découpage en trois lots

Une seule spec, trois plans, livrés et testés en réel l'un après l'autre, chacun mergé avant de commencer le suivant.

| Lot | Contenu | Sections |
|---|---|---|
| 2b-1 Fiabilisation | Chemin des messages sûr, suppressions, webhooks, Postgres, garde-fous permanents | §4, §5 |
| 2b-2 Comptes WhatsApp (moteur) | Modèle, API admin, Meta manuel, CM.com, inventaire, branchement, statuts dont accès limité, événements Meta | §6, §7, §8 |
| 2b-3 Écrans | Organisation › Connexions, raccordement guidé, assistant Numéro et Activer, encarts de la page agent IA | §9 |

Le lot 2b-1 ne connaît pas encore les comptes WhatsApp : il rend sûr le modèle actuel (identifiants par agent IA) pour que le lot 2b-2 le remplace sur une base saine. Quand une correction de 2b-1 serait jetée par 2b-2, elle est réduite au minimum qui protège (indiqué « minimal » ci-dessous).

## 4. Méthode permanente contre la dérive (lot 2b-1, puis chaque plan)

### 4.1 Tests d'isolation qui cassent

Un jeu de tests d'intégration « deux organisations » (`src/__tests__/isolation/` ou équivalent), qui passe par le vrai chemin webhook (express, parse, routage, traitement) avec le LLM et l'envoi WhatsApp simulés. Il couvre au minimum :
- un même contact écrit à l'agent IA de l'organisation A puis à celui de B : chaque message est traité par l'agent IA du numéro destinataire, avec les identifiants de son organisation ;
- le prompt envoyé au LLM pour B ne contient aucun contenu échangé avec A ;
- un agent IA en brouillon, en pause, ou d'une organisation suspendue ne déclenche ni appel LLM ni envoi ;
- un agent IA sans identifiants ne déclenche aucun envoi, même si des variables `META_*` / `CM_*` existent dans l'environnement ;
- un webhook Meta à signature fausse ou absente, un webhook CM.com sans secret valide : ni session, ni écriture en base, ni appel LLM, ni envoi ;
- une relivraison concurrente du même message ne produit qu'une réponse ;
- (lot 2b-2) un numéro rebranché de l'agent IA A1 vers l'agent IA A2 de la même organisation : les messages suivants vont à A2, aucune session ne reste sur A1 ; un numéro repris, sur action d'admin, par le compte valide de l'organisation B après la perte d'accès de A (§6) : aucune donnée de A n'est visible de B ; accès limité : un contact hors liste ne déclenche rien.

Chaque test porte en commentaire le constat d'audit qu'il protège.

### 4.2 Tests sur Postgres

La suite moteur doit tourner aussi contre un vrai Postgres (conteneur jetable), par une commande dédiée (`npm run test:pg` ou équivalent). Les tests de base de données et la suite d'isolation sont obligatoires sur les deux moteurs. Raison : SQLite (synchrone) masque les courses que Postgres expose (audit 5.3, 5.4, 6.5).

### 4.3 Intégration continue

Un workflow GitHub Actions sur le dépôt `Cyran-labs/whatsapp-agent-engine` lance, à chaque push et pull request : typecheck moteur et web, tests moteur sur SQLite, tests moteur sur Postgres (service Postgres du runner), tests web. Il ne déploie rien. (Choix du rédacteur : le coût est faible et c'est le seul garde-fou qui tourne sans que personne y pense. Le push reste soumis à l'accord de François.)

### 4.4 Règles non négociables dans `CLAUDE.md`

Le `CLAUDE.md` du projet décrit encore la phase P0. Il est mis à jour dans le lot 2b-1 :
- état réel du projet et pointeurs vers les specs ;
- une section « Règles non négociables multi-organisations » : les anti-objectifs du §2, la règle « toute donnée d'exécution est clée par organisation et par numéro ou agent IA », « aucun repli sur les identifiants de la plateforme », « aucun effet de bord avant authentification du webhook », « tout invariant a un test » ;
- l'obligation, dans toute spec, d'une section « Impact multi-organisation » (ce qui pourrait fuir, répondre à tort, ou utiliser de mauvais identifiants, et le test qui l'empêche).

### 4.5 Revue d'isolation à chaque branche

Chaque plan (2b-1, 2b-2, 2b-3, puis tous les suivants) inclut une tâche de revue dédiée à l'isolation, faite par un relecteur qui ne reçoit pas les conclusions de l'implémenteur, et qui porte sur le code modifié **et** sur le code qu'il appelle ou qui l'appelle. Elle s'ajoute à la revue finale de branche existante.

### 4.6 Audits avant mise en ligne

Audit complet de l'application à la fin du 2b, avant le chantier Infra (la section 7 du rapport d'audit en donne déjà des entrées), puis avant chaque mise en ligne majeure.

## 5. Lot 2b-1 : chemin des messages sûr

Comportements attendus (le comment est laissé au builder sauf mention).

**5.1 Routage par numéro destinataire, session par (numéro, contact).** Le numéro qui reçoit décide de l'agent IA, toujours. La session n'est qu'un état de conversation, clée par (numéro WhatsApp destinataire, contact) ; elle ne sert plus à choisir l'agent IA. Migration de la table `sessions` (clé composée) sur SQLite et Postgres. Le routage reste en lecture seule avant authentification (invariant existant). Audit 1.1.

**5.2 Statut lu à l'exécution.** La configuration d'exécution porte le statut de l'agent IA et celui de son organisation. Un message vers un agent IA non actif, ou d'une organisation suspendue, n'entraîne ni session, ni appel LLM, ni envoi ; il est compté (§8.4). Audit 3.1.

**5.3 Aucun repli sur les identifiants de la plateforme.** Un agent IA d'organisation sans identifiants complets n'est pas routable et n'envoie rien. CM.com : tous les champs requis, aucune complétion depuis l'environnement, `service_url` retiré de la saisie (valeur fixe de la plateforme). Audit 2.1, 2.2.

**5.4 Parseur de webhook pur.** L'analyse d'un webhook ne crée pas de transport et n'exige aucun identifiant. Elle lit toutes les entrées, tous les changements et tous les messages d'un POST Meta, et sépare messages, statuts et événements de compte (ces derniers sont seulement journalisés en 2b-1, traités en 2b-2). Audit 2.3, 5.1.

**5.5 Authentification des webhooks.** Meta : signature exigée, refus si le corps brut manque, HMAC calculé sur les octets reçus. CM.com : secret dans l'URL, comparé à temps constant (minimal en 2b-1 : un secret par agent IA CM.com ou par organisation ; définitif en 2b-2 : un par compte WhatsApp). Les routes `/webhook` (legacy) et `/webhook/cm-com` sans secret sont supprimées. Jeton de vérification GET : refus si non configuré, réponse en `text/plain`. Audit 4.1 à 4.3.

**5.6 Suppressions.**
- Historique « cross-bot » injecté dans le prompt : supprimé (pas de version intra-organisation). Audit 1.2.
- Commandes de contrôle WhatsApp (`ADMIN_PHONES`, `/sessions`, `/leads`, `/bots`, `/reset`, `menu`, `help`) : supprimées, le back-office les remplace. Audit 1.3.
- Point d'accès `/dashboard` : supprimé. Audit 1.4.
- Mot-clé « reset » d'un contact : conservé seulement pour les numéros de la liste d'accès limité de l'agent IA (§8.3) ; en 2b-1, désactivé. Il n'efface que la session et l'historique de cet agent IA pour ce contact, pas le lead. (Choix du rédacteur : un lead déjà poussé au CRM ne doit pas disparaître du back-office.) Audit 5.10.

**5.7 Traitement d'un message.**
- Dédoublonnage atomique sur les deux moteurs ; le message est marqué traité une fois la réponse envoyée ou l'échec définitif constaté, pas avant. Audit 5.3, 5.5.
- `saveLead` et les upserts touchés par le 2b atomiques sur Postgres (`ON CONFLICT`). Audit 5.4, 6.5.
- Verrou par (numéro destinataire, contact), couvrant création de session, traitement et extraction de lead. Audit 5.7.
- Premier message d'un nouveau contact : accueil envoyé puis le message lui-même est traité ; le vrai texte de l'accueil est stocké. Audit 5.6.
- Types non pris en charge : réponse explicite et journal ; réponse rapide de modèle (`button`) traitée comme du texte. Audit 5.2.
- Identifiant de message de repli aléatoire ; messages plus anciens qu'un seuil ignorés (seuil au choix du builder, défaut 24 h). Audit 5.12, 5.13.
- Arrêt propre : stop de l'écoute, attente des traitements en cours avec un délai maximal. Audit 5.5.

**5.8 Cache des transports invalidé** à chaque changement d'identifiants ou de numéro (minimal en 2b-1, remplacé en 2b-2 par un cache par compte WhatsApp). Audit 5.8.

**5.9 Erreurs d'envoi classées.** Jeton invalide ou expiré, fenêtre de 24 h dépassée, erreurs transitoires, autres : seules les transitoires sont réessayées ; un jeton invalide met à jour l'état de connexion visible dans le back-office. Audit 5.9.

**5.10 Version Graph centralisée**, configurable, défaut sur la version stable courante (à vérifier dans la doc Meta au moment de l'implémentation ; `v22.0` expire le 20 mai 2027). Audit 5.14.

**5.11 Normalisation des numéros** : une seule fonction E.164 partagée pour les numéros WhatsApp de l'organisation (saisie, stockage, routage CM.com) et les listes. L'identifiant du contact reste opaque (BSUID possible, §6). Audit 6.1.

**5.12 Tâches périodiques** de purge (conversations, messages traités, sessions inactives) au lieu du seul démarrage. Audit 6.6.

## 6. Modèle : comptes WhatsApp et numéros (lot 2b-2)

Amendé le 9 nov. 2026 (revue d'isolation 2b-2, I-1), à valider par François : unicité du compte WhatsApp sur la plateforme et reprise d'un numéro réservée à une action d'admin (voir « Unicité » ci-dessous et le choix 11 du §12).

**Compte WhatsApp** (0..n par organisation) : nom donné par l'admin, mode (`meta_manual` ou `cm_com` ; `meta_embedded` réservé pour plus tard), identifiants chiffrés selon le mode, identifiant Meta de la WABA, clé publique de webhook, état, date de dernière vérification réussie, date d'expiration du jeton si connue, alertes, indicateur « compte de test ».

États d'un compte (liste fermée, choix du rédacteur) :

| État | Entrée | Messages entrants | Transitions d'agent IA vers `limited` / `active` |
|---|---|---|---|
| `connected` | vérification réussie (raccordement, « Vérifier maintenant », remplacement des identifiants) | traités selon le statut de l'agent IA | permises |
| `error` (avec motif : jeton invalide ou expiré, signatures rejetées en série, autre) | échec de vérification, jeton refusé à l'envoi, signatures webhook rejetées de façon répétée | non servis (compteur §8.4) ; l'agent IA garde son statut et reprend seul au retour en `connected` | bloquées |
| `disconnected` | action « Déconnecter » de l'admin | refusés à l'authentification (le compte n'a plus de secret) | impossible (ses numéros sont libérés) |

Les alertes (jeton qui expire bientôt, problème de paiement ou d'éligibilité signalé par Meta, qualité dégradée) ne changent pas l'état : elles s'affichent. « Vérifié » veut dire « dernière vérification réussie » ; le contrôle du secret au premier message (§7.1) n'est pas une condition d'activation, il fait passer le compte en `error` s'il échoue.
- `meta_manual` : WABA ID, jeton d'accès (utilisateur système recommandé), secret de l'app Meta du client, jeton de vérification webhook généré par WABAGENT.
- `cm_com` : `accountId` CM.com, productToken. Vérifié le 8 nov. 2026 avec le compte Cyran : `GET https://api.cm.com/channels/v1/accounts/{accountId}/channels` (en-tête `X-CM-PRODUCTTOKEN`) puis `.../whatsapp/{channelRequestId}/profiles?includeMetaQualityRating=true` (numéro, `metaId`, nom, `isSandbox`, qualité, statut) et `.../businessaccount` (`facebookId`, `metaName`). Le compte CM.com peut porter plusieurs canaux WhatsApp : tous sont inventoriés.

**Numéro WhatsApp** (inventorié, jamais saisi) : compte de rattachement, identifiant du numéro chez le fournisseur (`phone_number_id` Meta ; pour CM.com, identifiant du profil et `metaId`), numéro E.164, nom affiché, état chez Meta, qualité, indicateur « numéro de test », agent IA branché (0 ou 1), état « retiré du fournisseur ».

**Agent IA** : au plus un numéro. Les anciens champs (numéros en texte libre, identifiants de transport par agent IA, transport choisi par l'agent IA) disparaissent ; le transport découle du compte du numéro.

Unicité (choix du rédacteur, amendé le 9 nov. 2026, revue d'isolation 2b-2, I-1) :
- un compte WhatsApp (une WABA Meta, un compte CM.com) n'est raccordé qu'une seule fois sur toute la plateforme, quelle que soit l'organisation : il est refusé tant qu'un compte qui le tient n'est pas `disconnected` (`connected` ou `error`), et un compte déconnecté le libère. Le contrôle a lieu après la preuve d'accès au fournisseur (jamais avant, pour ne rien révéler à qui ne prouve rien) et le refus est neutre : il ne dit pas qui tient le compte (audit 1.5) ;
- un numéro (identifiant fournisseur) tenu par un compte `connected` d'une autre WABA est refusé, avec le même message neutre ;
- un numéro tenu par un compte `error` ou `disconnected` d'une autre WABA peut être repris, et seulement par une action d'admin : raccordement, remplacement des identifiants ou « Rafraîchir les numéros ». Jamais par un événement du fournisseur (webhook, inventaire déclenché par le fournisseur). L'ancienne entrée passe en « retiré du fournisseur », l'agent IA qui l'utilisait passe en pause, et aucune donnée (conversation, lead, session) ne change d'organisation ;
- historique de la décision : la première version de la spec laissait le nouveau compte reprendre automatiquement le numéro dès que l'ancien n'était plus `connected` ; la revue I-1 a ajouté l'unicité du compte lui-même et réservé la reprise à l'admin, pour qu'un événement du fournisseur ne puisse jamais déplacer un numéro d'une organisation à une autre ;
- déconnecter un compte libère tous ses numéros ; les agents IA en brouillon qui en tenaient un le perdent.

**Identifiant de contact** : opaque, tel que fourni par le transport (`wa_id` ou BSUID chez Meta, `from.number` ou `from.whatsapp.user_id` chez CM.com, comme le gère déjà `whatsapp-cyran-bot` avec `isBsuid`), jamais normalisé comme un numéro de téléphone. La normalisation E.164 (§5.11) s'applique aux numéros WhatsApp de l'organisation et aux entrées de la liste d'accès limité. Un contact identifié par un BSUID n'est servi en accès limité que si son identifiant figure dans la liste (la liste accepte E.164 et BSUID). La clé de session du lot 2b-1 utilise déjà cet identifiant opaque.

**Migration** (choix du rédacteur, rien n'est déployé) : les identifiants de transport existants et les numéros en texte libre sont supprimés, faute de WABA ID ou d'`accountId` CM.com pour en faire des comptes complets ; tout agent IA en accès limité, actif ou en pause passe en brouillon ; chaque suppression est journalisée. Les tables et routes remplacées sont supprimées dans le même lot.

## 7. Comportements du moteur (lot 2b-2)

**7.1 Raccorder un compte (mode manuel Meta).** Le moteur vérifie, sans rien enregistrer en cas d'échec :
- le jeton est valide et donne accès à la WABA ;
- le secret de l'app est le bon (piste : appel Graph avec `appsecret_proof`, à confirmer sur la sandbox) ;
- l'abonnement de l'app aux webhooks de la WABA (`subscribed_apps`) ; s'il manque, le moteur le crée avec le jeton du client ;
- l'expiration du jeton si Meta permet de la lire avec ce jeton (piste `debug_token`, à confirmer ; sinon « expiration inconnue ») ;
- puis il inventorie les numéros (`GET /{WABA_ID}/phone_numbers`).

Puis il renvoie l'URL de webhook propre au compte et le jeton de vérification à coller dans l'app Meta. Le secret de l'app est contrôlé de nouveau au premier message reçu ; en cas d'échec de signature répété, le compte passe en erreur avec ce motif.

**7.2 Raccorder un compte CM.com** : vérification de l'`accountId` et du productToken par les lectures ci-dessus, inventaire, URL de webhook à secret à configurer chez CM.com.

**7.3 Webhook par compte.** Chaque compte a sa propre URL (`/webhook/meta/<clé>` et `/webhook/cm-com/<clé>`, forme exacte au builder). Ordre strict : identifier le compte par l'URL, authentifier (signature Meta avec le secret du compte, ou secret CM.com), puis seulement router vers le numéro, qui doit appartenir à ce compte. (Choix du rédacteur : en mode manuel chaque client a sa propre app Meta, donc son secret et son jeton de vérification ; l'URL par compte permet d'authentifier avant tout routage. L'Embedded Signup ajoutera une URL plateforme avec le secret de l'app WABAGENT, sans toucher à ce schéma.)

**7.4 Inventaire.** Au raccordement, sur demande (« Rafraîchir les numéros »), et sur les événements Meta de numéro. Un numéro disparu passe en « retiré du fournisseur », reste listé ; son agent IA passe en pause avec un motif visible.

**7.5 Brancher un numéro.** Une seule opération transactionnelle : le numéro quitte son ancien agent IA (qui repasse en brouillon s'il était en accès limité ou actif), l'agent IA cible quitte son ancien numéro s'il en avait un, le numéro rejoint l'agent IA cible, les sessions liées à ce numéro sont closes (l'historique reste attaché à l'ancien agent IA), les caches sont invalidés, l'opération est auditée avec l'avant et l'après. Réservé à l'admin (`can()`).

**7.6 Événements Meta.**
- `statuses` : un échec de livraison est compté sur le numéro avec son code ; les codes de paiement ou d'éligibilité du compte mettent le compte en alerte.
- `account_update` et mises à jour de qualité ou de capacité des numéros : état du compte et des numéros mis à jour.
- Aucune notification sortante en 2b (pas de SMTP) : l'état est visible dans Connexions et sur la page de l'agent IA.

**7.7 Jeton expiré ou révoqué** (à l'envoi ou à la vérification) : le compte passe en `error` (motif jeton) ; les agents IA gardent leur statut, les messages entrants ne sont pas servis ; l'admin remplace le jeton depuis Connexions, ce qui revérifie le compte et le remet en `connected`.

## 8. Statuts de l'agent IA et accès limité (lot 2b-2)

**8.1 Statuts** : `draft` (brouillon), `limited` (accès limité), `active`, `paused`. Machine d'états explicite :

| Vers | Conditions |
|---|---|
| `limited` | numéro branché, compte `connected`, liste d'accès limité non vide pour y entrer ; un agent IA déjà en accès limité peut vider sa liste, il ne répond alors à personne (amendement du 9 nov. 2026, décision de François) |
| `active` | numéro branché, compte `connected` ; depuis `limited` ou `paused`, ou depuis `draft` seulement sur un numéro de test |
| `paused` | depuis `limited` ou `active` |
| `draft` | depuis tout statut |

Un agent IA en brouillon peut garder son numéro (il ne répond pas). Pause automatique avec motif dans un seul cas : son numéro passe en « retiré du fournisseur » (§6, §7.4). Un compte en `error` ne change pas le statut de l'agent IA (reprise automatique, §6). « Déconnecter » est refusé tant qu'un numéro du compte sert un agent IA en `limited` ou `active` (§9.1), donc ne met jamais un agent IA en pause.

**8.2 Activation depuis l'assistant** : une seule opération « brancher ce numéro et passer en accès limité » (ou « actif » sur un numéro de test), pour éviter un état intermédiaire. L'activation en accès limité exige toujours au moins une entrée dans la liste, y compris pour un agent IA déjà en accès limité (décision du 9 nov. 2026).

**8.3 Liste d'accès limité** : propre à l'agent IA, numéros E.164 ou BSUID, au plus 20 (choix du rédacteur), éditable par l'admin, conservée après l'ouverture à tous (elle sert aussi au mot-clé « reset », §5.6) ; la liste peut être vide en accès limité (amendement du 9 nov. 2026) : l'agent IA ne répond alors à personne, le message est compté comme non servi (§8.4) et le mot-clé « reset » n'est accepté de personne.

**8.4 Messages non servis** : pour un numéro hors liste en accès limité, ou un agent IA en brouillon ou en pause : aucune réponse, aucun appel LLM, aucune session ; le moteur incrémente un compteur par agent IA avec la date du dernier, sans stocker le contenu. (Choix du rédacteur, plus prudent que « message enregistré » évoqué en brainstorming : pas de donnée personnelle conservée pour un contact non servi. Le compteur suffit à décider d'ouvrir plus tôt.)

## 9. Écrans (lot 2b-3)

Maquettes validées par François le 8 nov. 2026 (« en l'état non, on reviendra dessus après les premières recettes »), dans `.superpowers/brainstorm/14321-1794139133/content/` (non versionné) : `01-connexions-whatsapp.html`, `02-assistant-numero-activer.html`. À suivre au pixel de la charte Émeraude·Menthe, avec les écarts ci-dessous.

**9.1 Organisation › Connexions** (admin seulement, entrée de rail entre Utilisateurs et Réglages) : un bloc par compte WhatsApp (nom, mode, WABA, état, dernière vérification, menu Renommer, Remplacer les identifiants, Vérifier maintenant, Rafraîchir les numéros, Déconnecter), ses numéros (numéro, nom affiché, état, qualité, agent IA branché ou « Libre » avec « Brancher sur un agent IA »), les bandeaux d'alerte (jeton qui expire, compte en erreur, numéro de test et ses limites avec lien vers Meta), le bloc « CRM : à venir ». Déconnecter un compte est refusé tant qu'un de ses numéros sert un agent IA en accès limité ou actif. Écart avec la maquette : l'URL de webhook affichée est celle du compte (§7.3).

**9.2 Raccorder un compte** : choix du mode (API Meta directe ; Connexion Meta grisée « bientôt » ; CM.com), étapes guidées propres au mode, vérification, résultat avec les numéros trouvés. Le guide Meta explique qu'un numéro dédié est demandé et ce qu'on perd en réutilisant un numéro de l'app WhatsApp Business (suppression du compte dans l'app, historique perdu, coexistence seulement via l'Embedded Signup). Écart avec la maquette : la ligne « secret contrôlé au premier message » reste, la ligne d'abonnement webhook devient « abonnement créé » si le moteur l'a créé.

**9.3 Assistant de création** : cinq étapes (Identité, Personnalité, Tester, Numéro, Activer).
- Numéro : numéros groupés par compte ; un numéro libre se choisit ; un numéro utilisé reste choisissable avec l'avertissement qui nomme l'agent IA qui le perdra ; aucun numéro raccordé : lien vers Connexions dans un nouvel onglet, liste rafraîchie au retour, ou « Laisser en brouillon ». L'étape ne fait que retenir le choix.
- Activer : récapitulatif, contrôles, saisie de la liste d'accès limité (préremplie vide, au moins un numéro), bouton « Activer en accès limité » (« Activer » sur un numéro de test), rappel de facturation Meta avec lien (aucune API ne permet de lire le moyen de paiement), puis confirmation avec QR code et lien `wa.me`.
- Écart avec la maquette : le bouton principal de l'étape 5 devient « Activer en accès limité » et l'étape gagne la liste.

**9.4 Page de l'agent IA** : encart numéro (branché, compte, état ; « Brancher un numéro » s'il n'y en a pas), statut avec les actions permises par la machine d'états (« Ouvrir à tous », « Revenir en accès limité », « Mettre en pause »), liste d'accès limité, compteur des messages non servis. Lecture pour tous les membres, actions pour l'admin.

## 10. Impact multi-organisation

| Risque | Ce qui l'empêche | Test |
|---|---|---|
| Message traité par l'agent IA d'une autre organisation | routage par numéro destinataire, compte identifié par l'URL du webhook, numéro appartenant au compte | isolation : contact commun à A et B |
| Contenu d'une organisation dans le prompt d'une autre | suppression de l'historique cross-bot | isolation : prompt de B |
| Identifiants de la plateforme ou d'une autre organisation utilisés | aucun repli `.env`, identifiants portés par le compte du numéro | isolation : agent sans identifiants |
| Webhook forgé | signature ou secret vérifié avant tout effet de bord | isolation : signature fausse, secret absent |
| Numéro revendiqué par une autre organisation | numéro inventorié par un compte vérifié, unicité plateforme, message neutre | unicité inter-organisations |
| Agent IA non actif qui répond | statut agent IA et organisation lus au routage, liste d'accès limité | isolation : brouillon, pause, suspendue, hors liste |
| Fuite par les journaux | identifiants jamais journalisés ; masquage des numéros et contenus traité à l'audit complet | revue d'isolation |

## 11. Vérification

- Chaque lot : typecheck, tests moteur SQLite et Postgres, tests web, suite d'isolation, revue d'isolation (§4.5), revue finale de branche.
- Test en live à chaque lot sur une copie de `store/demo.db` dans un worktree jetable : 2b-1 avec deux organisations simulées et des webhooks rejoués ; 2b-2 et 2b-3 avec la sandbox Meta de François (numéro de test réel) et, en lecture, le compte CM.com Cyran. Aucun envoi depuis le compte CM.com de production sans accord explicite de François.
- Les pistes Meta marquées « à confirmer » (§7.1) sont vérifiées sur la sandbox au début du lot 2b-2, avant d'écrire le code qui en dépend ; le résultat est noté dans le plan.

## 12. Laissé au builder, et choix du rédacteur

**Laissé au builder** : schéma exact des tables et migrations ; forme des routes admin et du BFF ; forme exacte des URL de webhook ; seuil d'ancienneté des messages ; délai d'arrêt propre ; fréquence des purges ; détection du numéro de test Meta (champ de l'API s'il existe, sinon marquage manuel par l'admin) ; exploitation du bac à sable CM.com si l'inventaire l'expose ; textes FR et EN.

**Choix du rédacteur (à vérifier par François)** :
1. Intégration continue GitHub Actions dès le lot 2b-1 (§4.3).
2. Secret CM.com dans l'URL de webhook : la doc CM.com des messages et événements entrants ne décrit aucune signature (seule l'API Verification signe ses rappels en HMAC) ; vérifié le 8 nov. 2026 sur `developers.cm.com/messaging/docs/incoming-messages` et `incoming-events`. À reconfirmer dans les réglages de webhook de l'app Channels de CM.com.
3. Mot-clé « reset » réservé à la liste d'accès limité et sans effacement du lead (§5.6).
4. Messages non servis : compteur sans contenu (§8.4).
5. Liste d'accès limité de 20 numéros au plus (§8.3).
6. URL de webhook par compte WhatsApp (§7.3).
7. Migration : identifiants de transport et numéros en texte libre supprimés, agents IA repassés en brouillon (§6).
8. Numéro retiré du fournisseur : agent IA mis en pause automatiquement ; compte en erreur : statut conservé, reprise automatique (§6, §8.1).
9. Un agent IA en pause se comporte comme un brouillon pour les messages entrants.
10. États de compte `connected` / `error` / `disconnected`, alertes séparées (§6).
11. Un compte WhatsApp (WABA ou compte CM.com) n'est raccordé qu'une fois sur la plateforme (refus neutre, contrôlé après la preuve d'accès) ; un numéro tenu par un compte `connected` d'une autre WABA est refusé ; tenu par un compte `error` ou `disconnected`, il n'est repris que par une action d'admin (raccordement, remplacement des identifiants, « Rafraîchir les numéros »), jamais par un événement du fournisseur. Amendé le 9 nov. 2026 (I-1), à valider par François ; la version initiale permettait la reprise automatique par tout compte qui prouvait son accès (§6).
12. Identifiant de contact opaque (BSUID compris), E.164 réservé aux numéros de l'organisation et à la liste (§6).
