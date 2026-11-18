# Audit des décisions du lot R2a (guide en deux temps, profil WhatsApp, nom d'affichage)

Date : 18 nov. 2026. Branche `feat/r2a-guide-profil-nom`, code lu par `git diff bb89d3c..HEAD` (33 commits). Auditeur neuf, en lecture seule : aucun fichier du code modifié, aucun commit.

## 1. Méthode

Sources d'autorité lues d'abord :
- `CLAUDE.md` (règles multi-organisations, anti-objectifs, conventions, vocabulaire, textes) ;
- spec `docs/superpowers/specs/2026-11-17-r2a-guide-profil-nom-design.md` : corps de la spec, §11 (décisions de François) et §13 (amendements, qui priment) comme autorité ; §12 (choix du rédacteur) comme contestable ;
- essai `docs/superpowers/research/2026-11-17-essai-r2a-profil-nom.md` (faits observés chez Meta) ;
- maquettes validées : `01-portefeuille-saisie.html` (variante A), `02-guide-liens-precis.html`, `03-deux-chemins.html`, `04-profil-et-nom.html` (texte extrait du HTML, styles compris pour distinguer ce qui est dans le produit de ce qui est une annotation de relecture) ;
- spec R1, §12, pour ce qui lie encore.

Registre audité : `docs/superpowers/research/2026-11-18-registre-decisions-r2a.md`, sections A, B et C (86 décisions : P-1 à P-49, I-1 à I-11, T-1 à T-26), échantillon de la section D, couverture de la section E. Les justifications du registre ont été lues comme des arguments, jamais comme des règles.

Code relu pour chaque décision qui touche une règle : `src/whatsapp/inventory-plan.ts` (`reconcileNameState`), `src/whatsapp/meta-graph.ts` (lecture de `new_name_status`), `src/core/services/whatsapp-number-profile-service.ts`, `src/core/services/whatsapp-account-service.ts` (`checkBusinessAtConnection`, `businessUnreadableDetails`, `syncBusiness`, `business_repointed`), `packages/contracts/src/whatsapp.ts` (schémas du profil, du nom et du code), `packages/contracts/src/meta-links.ts`, `apps/web/src/components/connections/display-name-panel.tsx`, `display-name-deadline.ts`, `profile-dialog.tsx`, `guide-paths.tsx`, `business-step.tsx`, `account-alerts.tsx`, `connect-result.tsx`, `apps/web/src/components/agent/number-panel.tsx`, la route BFF `display-name/apply`, et les lignes ajoutées à `apps/web/messages/fr.json`.

Test lancé : `npx vitest run src/whatsapp/__tests__/inventory-plan.test.ts` (21 tests, verts). Contrôles textuels : aucune ligne ajoutée au code, aux contrats ni aux messages ne contient de tiret cadratin ou demi-cadratin ; aucun texte d'interface ajouté ne dit « PIN » ni « agent » seul (seuls des tests et de faux textes de Meta contiennent « PIN »).

Classement :
- **contraire** : la décision contredit une source d'autorité ;
- **contestable** : elle s'écarte d'une source ou cache un risque qu'un administrateur raisonnable jugerait mauvais, sans contredire une règle à la lettre ;
- **conforme** : rien à redire au regard des sources.

Bilan : 4 contraires, 8 contestables, 74 conformes.

## 2. Décisions contraires

### P-11 : mentions « précis » et « générique » retirées du guide

- Source : spec §2, troisième anti-objectif (« un lien du guide présenté comme précis alors qu'il ouvre une page générique. La maquette 02 distingue « précis » et « générique » ») ; maquettes 02 et 03, validées, où l'étiquette « précis » ou « générique » est dans le titre de chaque étape. La note de la maquette 02 (« visible ici pour la relecture seulement, pas dans le produit ») ne vise que l'encadré de l'adresse sous chaque lien, pas les étiquettes ; l'étiquette voisine « facultatif au départ » de la maquette 03 a d'ailleurs été gardée (`optional`).
- Ce que fait le code : `guide-paths.tsx` ne montre aucune étiquette ; seul le texte du lien change. Les textes validés de l'étape 1 restent : « Portefeuille {business} reconnu. Les liens ci-dessous ouvrent ses pages. » et, avant la reconnaissance, « La suite s'ouvre une fois le portefeuille reconnu : ses liens ouvriront alors les pages de ce portefeuille. » Ces deux phrases ne sont vraies qu'avec les étiquettes : sans elles, elles présentent comme liens du portefeuille « Ouvrir mes apps Meta ↗ » (Meta for Developers, générique), le lien du secret de l'app (générique) et « Ouvrir les paramètres du portefeuille ↗ », qui n'ouvre pas la page des utilisateurs système (P-12).
- Conséquence : l'administrateur croit que chaque lien ouvre la bonne page de son portefeuille ; à l'étape de l'app, il arrive sur la dernière app ou le dernier compte Meta ouverts, ce qui est exactement la douleur que le lot doit supprimer (spec §1, point 1).
- Correction proposée : remettre les étiquettes « précis » et « générique » des maquettes 02 et 03 (texte et ton des maquettes), ou, à défaut, corriger les deux phrases (« Les liens vers Meta Business Suite ouvrent ses pages ; ceux de Meta for Developers restent généraux. »). Étape de recette E-8 à reprendre en conséquence.

### P-21 : encart Numéro de la page de l'agent IA sans lien précis

- Source : spec §5.4, corps de la spec (« Avec un portefeuille gardé, les liens existants vers Meta (menu « Ouvrir dans WhatsApp Manager », alertes de la carte du compte, encart Numéro de la page de l'agent IA) ouvrent la page du portefeuille et de la WABA »). Ce n'est pas un choix du rédacteur (§12).
- Ce que fait le code : `number-panel.tsx` rend `AccountWebhooks` sans `metaIds` et `DeliveryFailures` avec `managerUrl={null}` ; `BotNumberSummary` ne porte pas le portefeuille. L'écart a été décidé par l'implémenteur « pour ne pas élargir `BotNumberSummary` sans avis du relecteur », sans retour vers François.
- Conséquence : depuis la page de l'agent IA, le lien vers Meta ouvre le dernier portefeuille utilisé (lien générique, pas faux). Faible gravité, mais c'est un point de la spec non livré.
- Correction proposée : ajouter `business` (`{ id, name } | null`, présenté comme pour `WhatsAppAccountView`, nul pour un compte déconnecté) au compte de `BotNumberSummary` et passer `metaIds` à l'encart ; sinon, amender le §5.4 avec François. Étape E-18 déjà prévue pour la décision.

### P-24 : forme des adresses web non contrôlée

- Source : spec §6.2 (« L'écriture valide les champs (longueurs, forme de l'e-mail et des adresses web, nombre de sites, secteur dans la liste) avant l'appel à Meta »). Le §13.4 n'amende que l'e-mail et le nombre de sites ; il ne retire pas le contrôle de forme des adresses web.
- Ce que fait le code : `UpdateWhatsAppBusinessProfileInput.websites` (contrats) ne contrôle qu'une valeur non vide et 256 caractères au plus. « Notre boutique », « exemple .fr » ou « htps//exemple.fr » sont acceptés par l'écran, le BFF et le moteur, puis envoyés à Meta. Le raisonnement donné pour l'e-mail (« ne pas publier un e-mail faux sur le profil ») vaut aussi pour le site.
- Conséquence : un site illisible ou cassé est publié sur la fiche que voit le contact, sans aucun avertissement.
- Correction proposée : accepter l'adresse avec ou sans schéma, comme Meta, mais exiger une forme d'adresse (lecture par `URL` après ajout de `https://` si le schéma manque, hôte avec un point, aucun espace), avec un texte « Adresse du site invalide. » ; ajouter le cas à E-24.

### P-27 : « Profil enregistré chez Meta » sans relecture

- Source : spec §2, sixième anti-objectif (« un bouton « Enregistrer » du profil qui dit « enregistré » sans avoir relu le profil chez Meta »).
- Ce que fait le code : quand l'écriture est confirmée par Meta mais que la relecture échoue, la raison `profile_saved_unread` dit « Profil enregistré chez Meta, mais sa relecture a échoué. Rouvrez la fenêtre dans un moment pour le vérifier. », et `profile-dialog.tsx` fait de la saisie envoyée la version de référence (`baseline: previous.draft`). La seconde moitié du texte est honnête, mais la première affirme « enregistré » sans relecture, ce que l'anti-objectif interdit à la lettre ; et la référence affichée n'est pas celle de Meta (Meta transforme au moins les sites, essai §5 : barre finale ajoutée).
- Conséquence : l'administrateur continue sur une version que Meta n'a pas confirmée ; un enregistrement suivant compare ses champs à cette version supposée et peut ne pas renvoyer un champ que Meta aurait gardé autrement.
- Correction proposée : texte qui ne dit pas « enregistré » (par exemple « Meta a accepté l'écriture, mais le profil n'a pas pu être relu : rouvrez la fenêtre dans un moment pour voir ce que Meta a gardé. »), et garder l'ancienne référence en marquant la fenêtre « non relue » (ou bloquer un second enregistrement jusqu'à une relecture réussie). À faire valider par François, l'anti-objectif étant sa règle.

## 3. Décisions contestables

### P-4 : « Contactez-nous » sans moyen de contact

- Source : règle de restitution (mémoire « Restitution des erreurs » : visible, compréhensible et actionnable) et anti-objectif de `CLAUDE.md` sur un élément sans effet. Le texte vient de la spec (§5.1, point 3), la décision porte sur le fait qu'il n'est pas un lien.
- Conséquence : l'administrateur d'un compte géré par 360dialog ou Twilio lit « Contactez-nous » sans savoir comment.
- Correction proposée : une adresse ou un lien de contact (même provisoire), ou « Contactez le support de WABAGENT » avec le canal existant.

### P-14 : portefeuille changé chez Meta, remplacé en silence

- Source : spec §2, quatrième anti-objectif (« un compte raccordé dans un portefeuille différent de celui saisi, sans que l'administrateur le sache »), dans son esprit ; la règle elle-même est un choix du rédacteur (§5.1), donc contestable.
- Ce que fait le code : `syncBusiness` remplace le portefeuille et écrit `whatsapp_account.business_changed` dans la trace d'administration, que l'écran ne montre pas. Le nom du portefeuille n'est affiché qu'au résultat du raccordement (`connect-result.tsx`) ; la carte du compte ne le montre jamais.
- Conséquence : une WABA passée dans un autre portefeuille (agence qui reprend la propriété, par exemple) n'est visible que par des liens qui changent de cible.
- Correction proposée : afficher « Portefeuille <nom> » sur la carte du compte, et une alerte d'information quand il change ; ou faire valider le silence par François en recette (E-14 ne joue aujourd'hui que la première lecture, pas un changement).

### P-15 : refus net de la lecture du portefeuille rendu « Réessayez dans un moment »

- Source : règle de restitution (actionnable) ; F-8 décide « Réessayez dans un moment » pour un portefeuille **illisible**, ce qui couvre la panne, pas un refus net de Meta.
- Ce que fait le code : `businessUnreadableDetails` rend bien le texte de Meta sur `waba_access` ou `token` pour un refus net, mais la raison et son texte français restent « Le portefeuille Meta Business n'a pas pu être vérifié. Réessayez dans un moment. ».
- Risque caché : si `owner_business_info` exige une permission que le guide ne fait pas donner au jeton (point ouvert E-41, jamais vérifié : l'essai du 14 nov. a utilisé un jeton dont les permissions ne sont pas consignées), **tout** raccordement par le guide est refusé, avec une invitation à réessayer qui ne mènera nulle part.
- Correction proposée : jouer E-41 avant le merge ; pour un refus net, une raison distincte (ou le même code avec un texte « Meta refuse de dire à quel portefeuille appartient ce compte avec ce jeton : vérifiez les permissions du jeton »), à faire trancher par François.

### P-38 : `name_change_limit` non émis

- Source : spec §6.5, qui liste `whatsapp_account.name_change_limit` parmi les raisons nouvelles ; règle de restitution.
- Argument du registre : aucun code de Meta connu, et pas d'invariant affirmé sans test. Il se tient, mais il n'a pas été soumis à François.
- Conséquence : au 11e changement en 30 jours, l'administrateur lit le texte anglais de Meta replié sous « Demande du nouveau nom impossible. Réessayez. », qui l'invite à réessayer à tort.
- Correction proposée : amender §6.5 avec François ; au minimum, le texte générique d'un refus de demande ne doit pas dire « Réessayez » quand Meta a répondu par un refus net (texte de Meta présent).

### P-42 : demande disparue chez Meta effacée sans le dire

- Source : spec §5.3, point 4 (« délai de 14 jours dépassé : l'encart repasse à « Demander un autre nom », avec la phrase qui le dit ») et §2, cinquième anti-objectif ; règle de restitution.
- Ce que fait le code : `readNameRequest` (`meta-graph.ts`) lit `EXPIRED` et toute valeur inconnue comme « aucune demande » ; `reconcileNameState` efface alors la demande gardée. L'encart repasse à l'état « aucune demande » : ancien nom, étiquette « Approuvé », aucune phrase. L'alerte de la carte disparaît. La phrase « probablement dépassé » (R-31, P-49) ne s'affiche que si la demande est encore en base, donc seulement tant qu'aucune relecture (événement de Meta, « Rafraîchir les numéros », « Vérifier maintenant ») n'est passée après l'expiration.
- Conséquence : un nom approuvé et perdu disparaît sans explication ; l'administrateur voit « Approuvé » à côté de l'ancien nom et peut croire que son nouveau nom n'a jamais été demandé. Second risque, déjà noté (M-g, E-44) : une demande en revue que Meta ne rend pas encore juste après l'envoi est effacée, et l'encart dit « aucune demande » juste après « Demande envoyée à Meta. ».
- Correction proposée : garder une trace minimale de la fin d'une demande (`EXPIRED` lu, ou demande `approved_pending` disparue sans que `verified_name` devienne le nom demandé) pour afficher une fois « Le délai pour appliquer « <nom> » est dépassé. Demandez de nouveau ce nom. » ; tolérance de quelques minutes pour une demande en revue juste écrite. Ajouter l'étape de recette (section 7).

### P-46 : champ du code en clair

- Source : maquette 04, validée (F-5), où le champ est masqué (« • • • • • • ») ; F-7 n'a changé que le libellé.
- Argument du registre : un champ `password` peut être gardé par le gestionnaire du navigateur, et l'option A de F-6 demande de noter un code choisi. Il se tient pour un numéro sans code actif, moins pour un numéro dont le code est actif.
- Conséquence : le code de vérification en deux étapes d'un numéro actif est lisible à l'écran pendant la saisie (partage d'écran, regard d'un tiers). C'est le seul secret que WABAGENT fait taper en clair.
- Correction proposée : faire trancher par François : masqué par défaut avec un bouton « Afficher », ou en clair seulement quand `pin_enabled === false`.

### P-49 : délai dépassé décidé par la date du navigateur

- Source : spec §6.3 (« Elle est seulement affichée : le moteur ne bloque pas l'application à cette date, puisqu'elle peut n'être qu'approchée. C'est le refus de Meta qui fait passer l'encart à « Demander un autre nom » »). La partie moteur de R-31 (relecture après un refus, 409 `name_apply_expired`) est conforme ; la partie web s'en écarte.
- Ce que fait le code : `applyDeadlinePassed` compare `apply_before` à l'horloge du navigateur ; passé ce moment, `display-name-panel.tsx` retire le champ du code et le bouton « Appliquer », sans jamais laisser Meta trancher. L'étiquette reste « Approuvé, à appliquer » à côté d'une phrase qui dit le contraire. L'alerte de la carte ne nomme pas le numéro.
- Conséquence : la date approchée est toujours au moins égale à la vraie (première relecture qui observe l'approbation), donc le blocage est rarement faux ; il l'est avec une horloge de poste en avance, ou si Meta laisse un délai de grâce. Dans ces cas l'administrateur ne peut plus appliquer un nom encore applicable et doit refaire une demande (10 changements par 30 jours). Avec plusieurs numéros en attente sur un compte, les alertes ne se distinguent que par le nom.
- Correction proposée : garder la phrase « probablement dépassé » mais laisser le champ du code et « Appliquer » (le refus de Meta tranche, comme le dit le §6.3), étiquette en accord ; nommer le numéro dans l'alerte.

### T-26 : rebase local sans accord

- Source : `CLAUDE.md` global (« Aucun commit/push/merge sans validation explicite ») et la règle que le registre se donne lui-même en E-48 (« Rebase seulement sur accord, avant tout push »).
- Conséquence : aucune sur le produit, rien n'est poussé ; mais l'historique a déjà été réécrit une fois en autonomie alors que E-48 en fait une décision de François. Incohérence de méthode à signaler, pas à corriger.

## 4. Décisions conformes

A, produit : P-1, P-2, P-3, P-5, P-6, P-7, P-8, P-9, P-10, P-12, P-13, P-16, P-17, P-18, P-19, P-20, P-22, P-23, P-25, P-26, P-28, P-29, P-30, P-31, P-32, P-33, P-34, P-35, P-36, P-37, P-39, P-40, P-41, P-43, P-44, P-45, P-47, P-48.

B, interprétations : I-1, I-2, I-3, I-4, I-5, I-6, I-7, I-8, I-9, I-10, I-11.

C, techniques : T-1, T-2, T-3, T-4, T-5, T-6, T-7, T-8, T-9, T-10, T-11, T-12, T-13, T-14, T-15, T-16, T-17, T-18, T-19, T-20, T-21, T-22, T-23, T-24, T-25.

Remarques sur certaines décisions conformes :
- P-1 : conforme à la maquette 01 (variante A, retenue par F-1), qui dit « Portefeuille 1270659448489249 reconnu » ; la maquette 03 n'était pas la source de cette phrase.
- P-2 : conforme à la maquette 03 (« si l'adresse collée contient déjà un compte WhatsApp, le premier chemin est présélectionné ») et au §5.1, point 2.
- P-10 : la maquette 03 dit déjà « Dans ce portefeuille. » dans sa vue du chemin 2 ; l'implémenteur a levé une incohérence de la maquette.
- P-13 : la condition « abonnée sans adresse propre » est juste : une adresse déjà posée sur la WABA primait sur le webhook de l'app, l'autre produit ne recevait donc rien.
- P-28 : juste pour les étapes d'envoi de la photo ; voir en section 5 le texte `number_removed`, plus large que son cas.
- P-30 : comportement de fait, à trancher en E-29 ; aucune source ne l'interdit (un compte déconnecté est bien refusé par `target`).
- P-31 : la règle de `CLAUDE.md` sur les thèmes de la démo Cyran vise les contenus de démonstration, pas une liste fermée de Meta ; « Automobile » est juste, « Tourisme et transports » aussi (TRAVEL couvre le transport chez Meta). À valider en E-46.
- P-35 : « Fermer » est plus vrai qu'« Annuler » ; la fermeture perd une saisie non enregistrée sans avertir, à regarder en recette.
- P-45 : ne jamais affirmer « aucun code » sans l'avoir lu est juste ; l'aide « Code oublié » suppose un code, ce qui est le cas le plus probable.
- I-4 : un appel par l'API sans `business_id` raccorde sans comparaison, comme le dit le §5.1, point 6.
- T-12 : l'`UPDATE` sans `AND client_id` suit une lecture filtrée dans la même transaction ; l'isolation tient.
- T-24 : effet de la règle R-20, à revoir avec P-42 et non pour lui-même.

## 5. Échantillon des textes (section D)

48 textes contrôlés dans `apps/web/messages/fr.json` (lignes ajoutées par la branche) et dans les contrats, sur cinq critères : accents, vocabulaire (« agent IA », jamais « agent » seul, sept mots anglais), aucun tiret cadratin ni demi-cadratin, jamais « PIN » seul, vérité (le texte dit-il ce que fait le code ?).

Résultat global : accents, vocabulaire, tirets et « PIN » sans défaut sur tout l'échantillon (et, par recherche, sur toutes les lignes ajoutées). Aucun des sept mots anglais n'apparaît ; « WABA ID », « Meta Business Suite » et « WhatsApp Manager » sont des noms de produits ou d'identifiants de Meta déjà en usage en R1. « Numéro dédié à l'agent IA » respecte le vocabulaire.

Textes conformes sur les cinq critères (41) :
- D.1 : `business_mismatch`, `profile_unsupported`, `photo_invalid`, `pin_rejected`, `name_apply_in_progress`, `no_display_name_request` ;
- D.2 : `title`, `hint`, `field`, `wabaFound`, `unrecognised`, `required`, `help`, `helpPath` (libellés Meta à relever en E-10), `schema.title`, `linkPrecise` ;
- D.3 : `paths.label`, `paths.choose`, `paths.required`, `paths.existing.text`, `paths.scratch.text`, `optional` ;
- D.4 : `app.linkedHint`, `waba.createdHint`, `number.title`, `number.testHint`, `token.link`, `account.hint` ;
- D.5 : `errors.businessMismatch`, `result.business`, `result.businessRepointed` ;
- D.6 : `alerts.nameToApply`, `alerts.nameToApplyHint` ;
- D.7 : `intro` (« sans revue de Meta » : vrai selon l'essai), `photoHint`, `readAt`, `errors.aboutEmpty`, `noChange`, `preview.note` ;
- D.8 : `code`, `codeHelpNoCode` (texte de F-6 à la lettre).

Textes à reprendre (7) :
1. `business.recognised` : « Les liens ci-dessous ouvrent ses pages. » Faux sans les étiquettes « précis » et « générique » (voir P-11) : les liens de Meta for Developers et celui des utilisateurs système n'ouvrent pas une page de ce portefeuille.
2. `locked` : « ses liens ouvriront alors les pages de ce portefeuille. » Même défaut.
3. `displayName.approved` : « Approuvé » est affiché pour tout numéro sans demande. Le moteur lit `name_status` chez Meta mais ne s'en sert pas (F.3, tâche 3) : pour un vrai numéro dont le nom actuel est encore en revue ou refusé par Meta, l'étiquette est fausse. La spec (§5.3, point 2) prévoit cette étiquette, mais le risque n'y est pas vu. À regarder avec François : lire `name_status` ou retirer l'étiquette.
4. `errors.reasons.whatsapp_account.name_apply_expired` : « Le délai pour appliquer ce nom est dépassé. » Le moteur le déduit (demande disparue à la relecture qui suit un refus), il ne le lit pas ; une demande retirée dans WhatsApp Manager donnerait le même texte. Aligner sur le texte du web, « est probablement dépassé ».
5. `errors.reasons.whatsapp_account.number_removed` : « Ce numéro a été retiré chez Meta. » Rendu pour l'erreur Meta 100/33 sur le chemin du numéro, qui veut dire aussi « vous n'avez pas la permission » ; affirmatif pour un cas incertain, sans changer l'état du numéro.
6. `displayName.codeHelp` et `changeCode` : le lien mène à la liste des numéros de la WABA (`metaLinks().phoneNumbers`), alors que la spec (§5.3, point 2) demande « le lien précis vers la page du numéro » et que le texte invite à changer le code d'un numéro précis. Libellé vrai (« WhatsApp Manager »), cible moins précise que prévu.
7. `connections.profile.saved` : affiché aussi quand la réponse du moteur n'est pas un profil lisible (`profile-dialog.tsx`, branche `isProfile(body)` fausse) : la fenêtre garde alors l'ancienne version sous « Profil enregistré chez Meta. ». Cas rare, même famille que P-27.

Remarque hors échantillon : le message de contrat « L'adresse du site est vide. » (`whatsapp.ts`) manque à la liste D.10.

## 6. Constats hors registre

- `name_status` demandé à Meta et jamais utilisé (voir texte 3 ci-dessus) : c'est le seul champ qui dirait si le nom actuel est lui-même approuvé.
- Le parcours « délai dépassé » n'a aucun code de Meta connu (T-6) et repose sur deux mécanismes, la date du navigateur (P-49) et l'effacement à la relecture (P-42), qui se contredisent selon l'ordre des événements. Les deux sont à revoir ensemble.

## 7. Étapes de recette manquantes ou incomplètes (section E)

Décisions produit sans étape :
- **P-40** : deux applications simultanées du même numéro, « Le nouveau nom est déjà en cours d'application. » (faux moteur, ou double clic rapide en réel).

Décisions à effet visible sans étape :
- **I-5** et **I-6** : liens génériques d'un compte reraccordé ou dont la WABA a changé, jusqu'à la relecture suivante.

Étapes qui ne jouent pas la décision qu'elles citent :
- **P-14** (E-14) : E-14 ne joue que la première lecture du portefeuille d'un compte R1 ; le cas « portefeuille relu différent de celui gardé » n'est joué nulle part. Le jouer sur le faux moteur ou le déclarer non recetté.
- **P-42** (E-31) : E-31 vérifie qu'une demande ne disparaît pas après l'envoi ; aucune étape ne montre ce que voit l'administrateur quand Meta rend `EXPIRED` (ou plus aucune demande) pour un nom approuvé. Étape à ajouter sur le faux moteur : demande `approved_pending`, puis relecture sans demande, puis ouverture de la fenêtre et de la carte.
- **P-15** : seulement en point ouvert (E-41). Ajouter une étape : refus net de `owner_business_info` (faux moteur), texte et détail affichés.
- **P-24** : E-24 vérifie le site sans schéma, pas un site illisible (« Notre boutique »).
- **P-35** : E-20 regarde le bouton « Fermer », pas la perte d'une saisie non enregistrée à la fermeture.

Textes de la section D sans étape où ils s'affichent : `profile_unsupported`, `number_removed`, `no_display_name_request`, `name_apply_in_progress`, `photoFailed`, `saveFailed`, `applyFailed`, `requestFailed`.
