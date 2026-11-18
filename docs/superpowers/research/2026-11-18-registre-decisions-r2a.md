# Registre des décisions du lot R2a (guide en deux temps, profil WhatsApp, nom d'affichage)

Date : 18 nov. 2026. Branche `feat/r2a-guide-profil-nom` (base `1f07bc7`, tête `f7ee8a3`, 31 commits, rien de poussé). Exécution en autonomie, subagent-driven : Claude contrôleur en PO, implémenteurs et relecteurs sur Opus, revue d'isolation et relecture finale comprises (décision de François du 17 nov. 2026).

Sources d'autorité :
- spec `docs/superpowers/specs/2026-11-17-r2a-guide-profil-nom-design.md` (§11 décisions de François, §12 choix du rédacteur, §13 amendements, qui priment) ;
- plan `docs/superpowers/plans/2026-11-17-r2a-guide-profil-nom.md` ;
- essai Meta du 17 nov. 2026 : `docs/superpowers/research/2026-11-17-essai-r2a-profil-nom.md` ;
- `CLAUDE.md` ;
- registre d'exécution `.superpowers/sdd/2026-11-17-r2a-guide-profil-nom/progress.md` (rulings R-1 à R-32 et R-9bis) et rapports des tâches du même dossier (`task-*-report.md`, `final-fix-report.md`).

Revues :
- revue d'isolation `docs/superpowers/research/2026-11-17-revue-isolation-r2a.md` : 0 Bloquant, 0 Important, 4 Mineurs (M-3 corrigé dans la vague finale, M-1, M-2 et M-4 différés) ;
- relecture finale de la branche : 0 Critique, 1 Important (I-1, délai de 14 jours dépassé jamais restitué, corrigé par R-31), Mineurs M-a à M-h (M-a à M-f corrigés dans la vague finale).

**Toutes les décisions des sections A, B et C sont contestables.** Elles ont été prises par le contrôleur (PO) ou par un implémenteur pendant l'exécution, sans validation de François. Leur justification est donnée pour l'audit, pas comme une règle. Chaque décision produit devient une étape de recette (section E). Les seules décisions validées sont celles de François (section 0).

Classes :
- **produit** : visible pour l'administrateur ou pour le contact ;
- **interprétation d'une règle validée** : lecture d'une règle de `CLAUDE.md`, de la spec ou d'un anti-objectif ;
- **technique** : invisible à l'écran.

Notation de la colonne « Source » : `R-n` ruling du contrôleur ; `Impl Tn` décision d'un implémenteur de la tâche n ; `§12` choix du rédacteur de la spec ; `PO-n` constat du contrôle visuel du PO ; `M-x` mineur de la relecture finale.

## 0. Décisions de François (validées, hors contestation)

Listées pour que l'auditeur vérifie que le code s'y conforme, pas pour les rouvrir.

| N° | Date | Décision |
|---|---|---|
| F-1 | 13 nov. 2026 | Saisie du portefeuille en variante A (maquette 01) : un seul champ, adresse d'une page Meta Business ou identifiant seul. |
| F-2 | 13 nov. 2026 | Deux chemins après le portefeuille ; maquette 03 acceptée, à valider définitivement en recette (étape E-9). |
| F-3 | 14 nov. 2026 | Découpage : R2a contient le guide, le profil et le nom d'affichage ; R2b contient l'ajout d'un numéro. |
| F-4 | 14 nov. 2026 | Le portefeuille est relu par le jeton et gardé avec le compte. |
| F-5 | 17 nov. 2026 | Maquette 04 (profil et nom) validée. |
| F-6 | 17 nov. 2026 | Option A pour le code : demandé au moment d'appliquer le nom, jamais gardé, renvoi vers WhatsApp Manager s'il est oublié ou jamais créé. Pour un numéro sans code actif (§13.2), l'encart demande quand même 6 chiffres avec le texte « Aucun code n'est actif sur ce numéro. Choisissez 6 chiffres et notez-les : Meta peut en faire le code du numéro. » |
| F-7 | 17 nov. 2026 | Le code s'appelle « code de vérification en deux étapes » à l'écran, jamais « PIN » seul. |
| F-8 | 17 nov. 2026 | Portefeuille illisible au raccordement : refus « Réessayez dans un moment » (option B). Rien n'est raccordé sans que le portefeuille saisi soit vérifié. |
| F-9 | 17 nov. 2026 | Approche A : profil lu chez Meta à chaque ouverture, jamais stocké ; état du nom gardé avec le numéro. |
| F-10 | 17 nov. 2026 | Un seul lot : une spec, un plan, une recette. |
| F-11 | 17 nov. 2026 | Propositions acceptées : refus si le portefeuille lu diffère du portefeuille saisi ; collage unique (une adresse de WhatsApp Manager donne portefeuille et WABA) ; compte géré par un autre prestataire hors lot ; photo sous réserve de l'essai. |
| F-12 | 17 nov. 2026 | Méthode : Claude tient le rôle de PO ; Opus partout, relecture finale comprise (remplace Fable pour ce lot). |

## A. Décisions produit

### A.1 Guide et raccordement

| N° | Source | Décision | Pourquoi | Si c'est faux | Où |
|---|---|---|---|---|---|
| P-1 | §12 | L'étape 1 ne montre aucun nom de portefeuille : « Portefeuille <identifiant> reconnu. » (la maquette 03 disait « Portefeuille Wabagent reconnu »). | Sans jeton, WABAGENT ne peut rien lire chez Meta à ce stade : c'est un contrôle de forme. | L'administrateur ne voit le nom qu'au résultat du raccordement. | `apps/web/src/components/connections/business-step.tsx` |
| P-2 | R-22 (refuse Impl T8) | Aucun chemin n'est présélectionné. Le chemin 1 n'est coché que si l'adresse collée contient `asset_id`. L'implémenteur avait coché le chemin 1 par défaut : refusé. | Spec §5.1 point 2, maquette 03 ; François : « on ne peut pas décider du cas le plus fréquent ». | Un clic de plus pour chaque raccordement. | `guide-paths.tsx`, `connect-form.tsx` |
| P-3 | R-23 | Sans chemin choisi, seules les deux cartes s'affichent, suivies de « Choisissez d'où vous partez pour voir les étapes. ». Un envoi sans chemin met le focus sur le choix avec « Choisissez d'où vous partez. ». | Un élément sans effet dit pourquoi (anti-objectif de `CLAUDE.md`). | Textes à reprendre. | `guide-paths.tsx`, `connect-form.tsx` |
| P-4 | R-25 (corrige R-23) | La ligne « autre prestataire » s'affiche sous les deux cartes, chemin choisi ou non. Ce n'est pas un lien. | Elle aide à choisir. | Une ligne de plus avant le choix. | `guide-paths.tsx` |
| P-5 | Impl T8 | Tant que le portefeuille n'est pas reconnu, la suite du guide est grisée et réellement inactive (`disabled`, `inert`), avec la raison écrite au-dessus, hors de la zone grisée. | Maquette 01 ; un élément sans effet dit pourquoi. | Aucun, sauf si la zone grisée gêne la lecture. | `guide-paths.tsx` |
| P-6 | R-32 (remplace un texte du PO de la tâche 8) | Un seul texte pour une adresse non reconnue, au champ comme à l'envoi : « Adresse non reconnue : collez l'adresse d'une page de Meta Business Suite qui contient l'ID du portefeuille, ou l'identifiant seul. » | L'ancien texte (« Collez l'adresse complète (https://…) ») était faux pour une adresse https sans `business_id`. | Texte à reprendre. | `business-step.tsx`, `apps/web/messages/fr.json` |
| P-7 | Impl T8 | « Adresse non reconnue » s'affiche à la sortie du champ, pas pendant la frappe. Une adresse qui porte `asset_id` sans `business_id` n'est pas reconnue. | Ne pas afficher d'erreur pendant qu'on tape les premiers chiffres. | L'erreur arrive un geste plus tard. | `business-step.tsx` |
| P-8 | Impl T8 | Un nouvel `asset_id` collé à l'étape 1 remplace une WABA tapée à la main et coche le chemin 1 (la saisie la plus récente l'emporte). | Collage unique (F-11). | Une WABA tapée exprès est écrasée par un collage. | `connect-form.tsx`, `apps/web/src/lib/meta-input.ts` |
| P-9 | Impl T8 | Le nom du compte devient l'étape 7 « Nommer le compte dans WABAGENT », dernier champ de l'écran (ordre du focus changé). | La maquette 03 ne place pas le nom ; la spec garde les quatre saisies de R1. | Ordre des champs à revoir. | `guide-paths.tsx`, `connect-form.tsx` |
| P-10 | Impl T8 | Texte de la carte du chemin 1 : « Dans ce portefeuille. » au lieu de « Dans ce portefeuille, utilisé par l'API ou à créer avec WABAGENT. » | « À créer » contredit « J'ai déjà un compte ». | Texte à reprendre. | `fr.json` (`guideMeta.paths.existing.text`) |
| P-11 | Impl T8 | Les mentions « précis » et « générique » des maquettes ne sont pas affichées : seul le texte du lien change (précis ou générique). | Annotations de relecture des maquettes, comme les encadrés d'adresse. | L'administrateur ne sait pas qu'un lien est générique. | `guide-paths.tsx`, `business-step.tsx` |
| P-12 | R-9, R-9bis | Le lien des utilisateurs système n'est jamais présenté comme précis. Avec le portefeuille, il ouvre `latest/settings/business_info?business_id=…`, sinon les paramètres génériques ; libellé « Ouvrir les paramètres du portefeuille ↗ », chemin de clics « Paramètres de l'entreprise, Utilisateurs, Utilisateurs système » dans l'aide. L'adresse devinée `settings/system_users` a été retirée après la relecture de la tâche 1. | Anti-objectif « lien présenté comme précis sans vérification » ; essai §6 : forme non vérifiée. | Un clic de plus pour l'administrateur jusqu'à la vérification en recette. | `packages/contracts/src/meta-links.ts`, `guide-paths.tsx` |
| P-13 | R-16 (rend exact Impl T4) | La phrase « Les messages de ce compte WhatsApp arrivent désormais dans WABAGENT. L'autre produit relié à l'app ne les reçoit plus. » ne s'affiche que si la WABA était abonnée sans adresse propre avant le raccordement et que le webhook de l'app pointe vers un autre produit. Elle est en ton avertissement (Impl T8). | Un texte faux à l'écran est un défaut produit (la règle de l'implémenteur la montrait aussi quand la WABA portait déjà une adresse). | Phrase absente dans un cas où elle serait vraie, ou ton trop alarmant. | `src/core/services/whatsapp-account-service.ts`, `connect-result.tsx` |
| P-14 | §5.1, choix du rédacteur | Un portefeuille relu chez Meta différent de celui gardé remplace l'ancien et le changement est écrit dans la trace d'administration (`whatsapp_account.business_changed`), sans alerte ni erreur du compte. La trace est aussi écrite quand seul le nom du portefeuille change (Impl T4, différé). | La valeur lue rend les liens justes ; cas rare (WABA déplacée chez Meta). | Un déplacement de WABA chez Meta passe inaperçu, sauf par les liens. | `whatsapp-account-service.ts` (`syncBusiness`) |
| P-15 | M-d (revue finale) | `business_unreadable` n'est marqué transitoire que pour une panne passagère (délai, injoignable, 5xx, limite de débit). Un refus net joint le texte de Meta sur le contrôle `waba_access` (ou `token` pour un jeton refusé). La raison ne change pas : l'écran dit toujours « Réessayez dans un moment. », même pour un refus net. | Ne pas inviter à réessayer comme si c'était passager ; une raison de plus n'a pas été créée. | L'administrateur réessaie en vain sur un refus net (point ouvert E-41). | `whatsapp-account-service.ts` |
| P-16 | PO-1, M-a | Les ligatures de la police à chasse fixe sont désactivées sur le champ du portefeuille, l'identifiant du schéma, les champs d'identifiants Meta et CM.com et l'adresse de la boîte webhook (« https: / » s'affichait). | Défaut visible au contrôle visuel du PO. | Aucun. | `business-step.tsx`, `connect-form.tsx`, `webhook-box.tsx` |

### A.2 Connexions : tableau, menu, alertes, liens

| N° | Source | Décision | Pourquoi | Si c'est faux | Où |
|---|---|---|---|---|---|
| P-17 | §12 | Une alerte de la carte du compte signale chaque numéro dont le nom est approuvé et à appliquer, avec sa date limite. | Les 14 jours : l'état ne doit pas se perdre sans ouvrir la fenêtre. | Une alerte en trop. | `apps/web/src/components/connections/account-alerts.tsx` |
| P-18 | Impl T9 | L'alerte dit où agir (« Menu « Gérer » du numéro, « Profil WhatsApp ». ») sans bouton qui ouvre la fenêtre. | Un bouton demanderait de remonter l'état de la fenêtre dans la carte. | Un chemin de clics au lieu d'un clic. | `account-alerts.tsx` |
| P-19 | Impl T9 | Colonne « Nom affiché » en deuxième position du tableau des numéros ; le nom n'est plus écrit sous le numéro. Étiquettes « Nouveau nom en revue » (orange), « Nouveau nom refusé » (rouge), « Nouveau nom à appliquer » (orange). Le nom demandé n'y apparaît jamais. | Maquette 04, partie 1 ; anti-objectif « nom présenté comme affiché alors que Meta ne l'affiche pas ». | Écart à la maquette, colonne en trop. | `numbers-table.tsx` |
| P-20 | Impl T9 | « Profil WhatsApp » est la première entrée du menu « Gérer » d'un numéro présent d'un compte Meta ; absente pour un compte CM.com et un numéro retiré. | Spec §5.2 point 1. | Aucun. | `number-menu.tsx` |
| P-21 | Impl T8 (écart §5.4) | L'encart Numéro de la page de l'agent IA garde un lien générique vers WhatsApp Manager : `BotNumberSummary` ne porte ni portefeuille ni WABA, et n'a pas été modifié. Les autres liens (menu, alertes, échecs de remise, état Meta de la carte et du résultat) portent le portefeuille du compte. | Ne pas élargir `BotNumberSummary` sans avis du relecteur (brief de la tâche 8). | Un lien moins précis sur la page de l'agent IA. | `apps/web/src/components/agent/number-panel.tsx`, `apps/web/src/lib/whatsapp-display.ts` |

### A.3 Fenêtre « Profil WhatsApp »

| N° | Source | Décision | Pourquoi | Si c'est faux | Où |
|---|---|---|---|---|---|
| P-22 | R-4 | Photo : JPEG ou PNG, 5 Mo au plus côté WABAGENT (web, BFF et moteur). Le minimum de 192 × 192 pixels est laissé à Meta (refus restitué en `photo_invalid`). | Meta a accepté 6,7 Mo sans limite connue ; marge sûre. | Un client avec une photo de plus de 5 Mo doit la réduire. | `packages/contracts/src/whatsapp.ts` (`PROFILE_PHOTO_*`), `src/api/admin/routes/whatsapp-accounts.ts`, `apps/web/src/lib/proxy.ts` |
| P-23 | R-5 | « Infos » (`about`) obligatoire et jamais vide : le web bloque avec « Les infos ne peuvent pas être vides. », le moteur refuse en 400 avant l'appel. | Meta répond 500 au vidage (essai §5). | Un champ de moins à vider. | `whatsapp.ts`, `profile-draft.ts`, `profile-dialog.tsx` |
| P-24 | R-6 | Forme de l'e-mail contrôlée par WABAGENT (Meta ne la contrôle pas) ; site web sans schéma accepté tel quel, comme Meta. | Ne pas publier un e-mail faux sur le profil. | Un e-mail inhabituel refusé, ou un site sans `https://` publié. | `whatsapp.ts` |
| P-25 | M-e | Seuls les champs envoyés bloquent l'enregistrement. Un champ non touché tel que Meta le rend (infos vides chez Meta, site de plus de 256 caractères) garde son erreur affichée, sans bloquer les autres. Les sites, envoyés en liste entière, bloquent tous dès qu'ils sont modifiés. | Un champ hérité de Meta ne doit pas empêcher de changer la description. | Une erreur affichée qui ne bloque pas peut surprendre. | `profile-draft.ts`, `profile-dialog.tsx` |
| P-26 | Impl T5, Impl T9 | Rien de modifié : « Aucun changement à enregistrer. », aucun appel ni trace. | Ne pas écrire chez Meta pour rien. | Aucun. | `whatsapp-number-profile-service.ts`, `profile-dialog.tsx` |
| P-27 | R-17, R-28, M-c | Écriture réussie mais relecture en échec : raison `profile_saved_unread` (« Profil enregistré chez Meta, mais sa relecture a échoué. Rouvrez la fenêtre dans un moment pour le vérifier. »), 422 avec le détail `profile` (pas « transitoire », pour ne pas inviter à refaire l'écriture), trace d'audit `ok: true`. À l'écran : avis en ton d'avertissement sur fond `bg-warning-soft`, jamais une erreur ; la saisie envoyée devient la version de référence, sans relecture (Impl T9). | Toute action dit vrai, réussite comprise (règle de restitution). La version de l'implémenteur de la tâche 5 rendait « Meta ne répond pas » : refusée. | Un texte de plus ; la référence affichée peut différer de ce que Meta a gardé. | `whatsapp-number-profile-service.ts`, `profile-dialog.tsx` |
| P-28 | R-17, R-18 | Erreur Meta 100/33 : « numéro retiré » seulement sur les chemins du numéro (`/<PN>`). Aux étapes d'envoi de la photo (`/<APP_ID>/uploads` et la session), refus générique « Meta a renvoyé une erreur », sans le texte de Meta (le client Graph ne le garde pas pour 100/33, non modifié). | Ne pas dire « numéro retiré » pour une erreur de l'app ; cas rare, ne pas toucher `meta-graph.ts`. | Un administrateur voit un refus sans détail. | `whatsapp-number-profile-service.ts` (`metaRefused`) |
| P-29 | Impl T5 | Jeton refusé par Meta sur une opération du profil ou du nom : le compte passe en erreur, raison `listing_token_invalid` (« Jeton refusé par le fournisseur : remplacez les identifiants du compte. »), comme la relecture des numéros. | Même effet qu'ailleurs pour un jeton refusé. | Un compte coupé depuis la fenêtre du profil ; cas différé : jeton refusé à la relecture après une écriture réussie, compte en erreur mais écran `profile_saved_unread`. | `whatsapp-number-profile-service.ts` |
| P-30 | Revue d'isolation, question 9 (non tranché) | Les routes du profil et du nom acceptent un compte en état `error` (pas seulement `connected`), avec ses propres identifiants. La spec ne tranche pas ; constat à décider côté produit. | Aucun choix explicite : comportement de fait. | Un administrateur modifie le profil d'un compte en erreur, ou au contraire en est empêché si on change la règle. | `whatsapp-number-profile-service.ts` (`target`) |
| P-31 | R-27 | Libellés français des 22 secteurs écrits par l'implémenteur (section D.9), dont TRAVEL « Tourisme et transports » (pour éviter « voyage ») et AUTO « Automobile ». Un secteur lu hors liste s'affiche « Non renseigné » et n'est envoyé que s'il est choisi (Impl T9). | Liste fermée de Meta (essai §5) ; règle de `CLAUDE.md` sur les thèmes de la démo Cyran. | Libellés à reprendre ; « Automobile » peut contredire la règle des thèmes. | `fr.json` (`connections.profile.verticals`), `profile-dialog.tsx` |
| P-32 | Impl T9 | Sites : un champ, puis « Ajouter un second site » quand le premier est rempli (2 au plus) ; un site vidé est retiré, des sites tous vidés partent en liste vide. | Maquette 04 ; limite de Meta. | Ergonomie à reprendre. | `profile-dialog.tsx` |
| P-33 | Impl T9 | Aide de la photo selon l'essai (« JPEG ou PNG, 5 Mo au plus, 192 × 192 pixels au minimum. ») au lieu de « carrée, 640 px au moins » de la maquette. | Valeurs mesurées. | Texte à reprendre. | `fr.json` (`connections.profile.photoHint`) |
| P-34 | Impl T9, PO-2, M-b | « Lu chez Meta le <date et heure>. » au lieu de « Lu chez Meta à l'instant. ». Dates en français avec « 1er » pour le premier jour du mois (fenêtre, encart et alerte). | Une date dit vrai même si la fenêtre reste ouverte. | Texte à reprendre. | `profile-dialog.tsx`, `apps/web/src/lib/medium-date.ts` |
| P-35 | Impl T9 | « Fermer » au lieu d'« Annuler » à côté d'« Enregistrer ». | La fenêtre ne revient pas sur une saisie, elle se ferme. | Libellé à reprendre. | `profile-dialog.tsx` |
| P-36 | Impl T9 | L'encart « Nom affiché » est toujours affiché en tête de la fenêtre, même si la lecture du profil échoue ; fenêtre large (880 px). | L'état du nom vient de la base, pas de la lecture du profil. | Aucun. | `profile-dialog.tsx`, `apps/web/src/components/organisation/dialog-frame.tsx` |

### A.4 Nom d'affichage

| N° | Source | Décision | Pourquoi | Si c'est faux | Où |
|---|---|---|---|---|---|
| P-37 | R-7 | Nom demandé : 1 à 512 caractères côté WABAGENT ; Meta reste juge des règles de nom. | Aucune limite relevée chez Meta. | Un refus de Meta restitué au lieu d'un refus de forme. | `whatsapp.ts` (`DISPLAY_NAME_MAX`), `display-name-panel.tsx` |
| P-38 | R-14 | `name_change_limit` n'est pas émis (aucun code Meta connu) : la demande refusée par Meta est restituée de façon générique avec le texte de Meta (motif `provider_text`). La raison n'existe pas dans `ERROR_REASONS`. | Pas d'invariant affirmé sans test. | Au 11e changement, l'administrateur lit le texte anglais de Meta au lieu d'un texte français. | `whatsapp-number-profile-service.ts`, `display-name-panel.tsx` |
| P-39 | Impl T3 | Nom refusé : aucun motif n'est affiché, `rejection_reason` vaut toujours null (aucun champ de motif observé chez Meta). | Ne rien inventer. | Un motif de Meta existant serait perdu. | `src/whatsapp/meta-graph.ts` |
| P-40 | R-2 | Deux applications simultanées du même numéro : la seconde reçoit 409 `name_apply_in_progress` (« Le nouveau nom est déjà en cours d'application. »), sans appel à Meta. | Toute raison a sa clé ; éviter deux réenregistrements. | Une raison de plus. | `whatsapp-number-profile-service.ts` |
| P-41 | R-19 | Après une application réussie, pas de relecture immédiate des numéros : le nom appliqué reste celui écrit ; la relecture ordinaire suivante prend `verified_name` comme vérité. | Meta met `verified_name` à jour en quelques secondes (essai) ; éviter un état « appliqué récemment » en base. | Si Meta tarde plus que l'intervalle de relecture, l'ancien nom réapparaît un moment. | `whatsapp-number-profile-service.ts` |
| P-42 | R-20, Impl T6 (accepté) | Une demande gardée qui disparaît chez Meta (`new_name_status` NONE ou EXPIRED) sans que `verified_name` devienne le nom demandé est effacée ; si `verified_name` devient le nom demandé, elle est effacée et le nom affiché suit. La règle vaut aussi pour une demande en revue (si Meta ne la montrait pas tout de suite après l'envoi, la relecture l'effacerait). | Meta est la source ; l'essai montre la demande immédiatement. | La phrase « délai dépassé » n'est pas montrée dans ce cas ; une demande juste envoyée pourrait disparaître (point ouvert E-44). | `src/whatsapp/inventory-plan.ts` (`reconcileNameState`) |
| P-43 | R-21 (refuse deux décisions Impl T6) | Meta `approved_pending` dont le nom demandé égale `verified_name` ou le nom affiché gardé : nom déjà appliqué, demande effacée, nom affiché = ce nom. L'implémenteur affichait alors le numéro E.164 (refusé) et recréait une demande après une application par WABAGENT si Meta tardait (refusé). | `verified_name` ne change qu'au réenregistrement (essai §1) : l'égalité veut dire « appliqué » ; ferme aussi le retard de Meta après R-19. | Un nom approuvé non appliqué dont le texte égale le nom actuel est montré comme appliqué, sans effet visible pour le contact. | `inventory-plan.ts` |
| P-44 | Impl T6 (accepté) | Dates de la demande (`requested_at`, `approved_at`, `apply_before`) gardées seulement si la demande en base porte le même nom que celle de Meta ; un autre nom approuvé reçoit une nouvelle date limite. | Une demande faite hors de WABAGENT ne doit pas hériter des dates d'une autre. | Date de demande inconnue pour un nom changé hors WABAGENT. | `inventory-plan.ts` |
| P-45 | R-26 | `pin_enabled === null` (jamais lu) est traité comme un code actif : aide « Code oublié : changez-le dans WhatsApp Manager ↗ ». Seul `false` montre le texte de F-6 (« Aucun code n'est actif… »). | Ne jamais affirmer « aucun code » sans l'avoir lu. | Un client sans code lit l'aide standard. | `display-name-panel.tsx` |
| P-46 | R-28 (refuse Impl T9) | Le champ du code est un champ texte visible (`inputMode="numeric"`, `autoComplete="one-time-code"`, 6 caractères au plus), jamais `type="password"`. L'implémenteur l'avait masqué : refusé. | Un champ mot de passe peut être gardé par le gestionnaire du navigateur (contraire à « jamais gardé ») ; on demande de noter un code qu'on ne verrait pas. | Le code est visible à l'écran le temps de la saisie. | `display-name-panel.tsx` |
| P-47 | Impl T9 | Texte de l'état « approuvé, à appliquer » : « « <nom> » approuvé le <date>. Il faut l'appliquer avant le <date>. » (« … environ. » si la date est approchée), au lieu de « réenregistrer le numéro… code PIN » de la maquette. | Règle F-7 ; vocabulaire de l'administrateur. | Texte à reprendre. | `display-name-panel.tsx`, `fr.json` |
| P-48 | Impl T9 | « Demander un autre nom » n'est proposé que sans demande, après un refus ou après un délai dépassé ; jamais pendant une revue ni pour un nom approuvé à appliquer (une demande à la fois). | Ne pas superposer deux demandes. | L'administrateur ne peut pas corriger une demande en revue. | `display-name-panel.tsx` |
| P-49 | R-31 (corrige I-1, remet en cause R-13 et R-20 ensemble) | Délai de 14 jours dépassé. Moteur : après un refus du réenregistrement autre que `pin_rejected`, les numéros du compte sont relus ; si la demande a disparu sans application, la réponse est 409 `name_apply_expired`. Web : si la date limite est passée (date du navigateur), l'encart montre « Le délai pour appliquer ce nom est probablement dépassé. Demandez de nouveau ce nom. » avec « Demander un autre nom », sans champ du code ; l'étiquette reste « Approuvé, à appliquer » (état lu chez Meta). L'alerte de la carte dit « Le délai pour appliquer « <nom> » est probablement dépassé : demandez de nouveau ce nom. », sans nommer le numéro. | Le délai dépassé n'était jamais restitué (R-13 : aucun code Meta connu pour l'expiration). | Textes à reprendre ; avec plusieurs numéros en attente sur un compte, les alertes ne se distinguent que par le nom. | `whatsapp-number-profile-service.ts`, `display-name-deadline.ts`, `display-name-panel.tsx`, `account-alerts.tsx` |

## B. Interprétations de règles validées

| N° | Source | Décision | Règle | Si c'est faux | Où |
|---|---|---|---|---|---|
| I-1 | R-11 | Les raisons R2a ont été retirées de la tâche 1 : chaque tâche qui émet une raison l'ajoute à `ERROR_REASONS` avec ses textes fr et en et son test de restitution, dans le même commit. Les gardes « clé levée » et « texte présent » restent vertes à chaque commit (contrairement à R1, où la garde était restée rouge sur quelques commits). | `CLAUDE.md` : aucun test affaibli ; toute raison a sa clé et son texte. | Rien, sauf l'historique : `0402623` ne compile pas seul (étape E-48). | `packages/contracts/src/errors.ts` |
| I-2 | R-24 | Deux assertions de la recette R1 retirées de `connect-guide-meta.test.tsx` par la réécriture du guide ont été remises dans `guide-paths.test.tsx`. | `CLAUDE.md` : un test retiré est un test affaibli. | Aucun. | `apps/web/src/components/connections/__tests__/guide-paths.test.tsx` |
| I-3 | Impl T4, Impl T8 | Le texte de la raison `business_mismatch` ne nomme pas le portefeuille (la garde ICU des raisons interdit les arguments) ; l'écran compose la phrase avec le nom et l'identifiant lus dans le détail `business_found`, relayé par `api-fetch.ts`. | Le web ne lit un refus que par `describeFailure` et les détails ; textes de raison sans argument. | Sans détail lisible, l'écran montre la phrase sans nom. | `api-fetch.ts`, `connect-form.tsx`, `packages/contracts/src/errors.ts` (`BUSINESS_FOUND_DETAIL`) |
| I-4 | Impl T4 | Au raccordement, la lecture du portefeuille suit la vérification et précède la réservation, les contrôles d'unicité et toute écriture chez Meta. Un appel par l'API sans `business_id` raccorde sans comparaison ; un portefeuille lu est gardé, un échec de lecture raccorde sans portefeuille. Les comptes R1 sont lus à la prochaine vérification, relecture ou remplacement. | Spec 2b §7.1 ; spec R2a §5.1 point 6 et paragraphe des comptes R1. | Un client de l'API ne bénéficie pas du contrôle du portefeuille. | `whatsapp-account-service.ts` (`checkBusinessAtConnection`, `syncBusiness`) |
| I-5 | R-15 | Au remplacement des identifiants qui change de WABA, si la lecture du portefeuille échoue, le portefeuille gardé est effacé (null) et l'effacement est tracé. Branche presque inatteignable aujourd'hui (le remplacement refuse une autre WABA Meta). | Anti-objectif : liens justes ou génériques, jamais faux. | Liens génériques jusqu'à la relecture suivante. | `whatsapp-account-service.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts` (`clearWhatsAppAccountBusiness`) |
| I-6 | Impl T2 (accepté) | Le portefeuille n'est jamais écrit sur un compte déconnecté et n'est pas présenté pour lui (`business: null`) ; la colonne n'est pas effacée à la déconnexion. | Comme les écritures d'état de R1 (revue R1 ISO-M1). | Un compte reraccordé n'affiche son portefeuille qu'après relecture. | `whatsapp-sqlite.ts`, `whatsapp-postgres.ts`, `bot-number-summary.ts` (`presentBusiness`) |
| I-7 | Impl T5 | Un code mal formé sur un numéro inconnu répond 400 (forme) avant 404 (cible). | Isolation : la réponse ne révèle rien d'un autre numéro. | Ordre des erreurs à revoir. | `src/api/admin/routes/whatsapp-accounts.ts` |
| I-8 | Impl T5 | `patch` et `profilePatch` ajoutés à `SENSITIVE_WORDS` de `check:logs`, en plus de `pin`. | « Le corps d'une écriture de profil n'est jamais journalisé » (spec §6.2) devient un invariant tenu par la garde. | Gêne future pour un journal légitime qui contient ces mots (différé). | `scripts/check-logs.ts` |
| I-9 | Impl T9 | Dans le web, le code ne vit que dans l'état du composant, vidé après chaque réponse (réussie ou non), jamais en `sessionStorage`, `localStorage` ni dans l'adresse ; le BFF le relaie dans le corps validé sans le journaliser. | Anti-objectif « code gardé, journalisé ou renvoyé ». | Aucun. | `display-name-panel.tsx`, `apps/web/src/app/api/whatsapp-accounts/[accountId]/numbers/[numberId]/display-name/apply/route.ts` |
| I-10 | Impl T5 | Trace d'audit des quatre actions (`whatsapp_number.profile_updated`, `photo_updated`, `name_requested`, `name_applied`) : cible `whatsapp_account:<organisation>/<compte>`, métadonnées `{ number_id, ok, reason }`, `reason` = clé du refus, `provider_refused` ou `unexpected` ; aucun contenu. | Spec §6.3 : « sans le contenu ». | Trace moins lisible qu'un contenu. | `whatsapp-number-profile-service.ts` |
| I-11 | Impl T6 | Compte CM.com : `name_request` et `pin_enabled` toujours nuls, règle tenue dans le pilote de l'inventaire par le mode du compte. | Spec §2 : CM.com hors profil et nom. | Différé : la vue CM.com ne force pas ces champs à null par mode. | `inventory-plan.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts` |

## C. Décisions techniques

| N° | Source | Décision | Si c'est faux | Où |
|---|---|---|---|---|
| T-1 | R-1 | La règle du nom affiché vit dans la réconciliation de l'inventaire (`reconcileNameState`, appelée par les deux pilotes) ; `toProviderNumber` reste pur et rend le nom de Meta et la demande. | Règle à déplacer, coût faible. | `inventory-plan.ts`, `meta-graph.ts` |
| T-2 | R-3 | Tâche 0 (essai chez Meta) menée par le contrôleur avec François, sans sous-agent (écritures réelles avec accord, jeton en variable de session). | Rien. Incident : clé d'URL du webhook de dev affichée dans la conversation (étape E-1). | `docs/superpowers/research/2026-11-17-essai-r2a-profil-nom.md` |
| T-3 | R-8 | `WhatsAppNumberView.pin_enabled` (booléen ou null) ajouté au contrat. | Un champ en trop. | `packages/contracts/src/whatsapp.ts` |
| T-4 | R-10 | Nouveaux champs obligatoires gardés ; valeurs neutres aux sites d'appel dans un commit séparé (`ba435ea`). | Rien, sauf la bissectabilité (étape E-48). | `whatsapp-account-service.ts`, fixtures |
| T-5 | R-12, Impl T2, Impl T6 | Colonne `pin_enabled` nullable sur `whatsapp_numbers` (nul = jamais lu, jamais converti en false ; `CHECK` sur SQLite, BOOLEAN sur Postgres), setter scopé ; recopiée à chaque relecture, un champ absent chez Meta donne null. | Une colonne en trop. | `whatsapp-sqlite.ts`, `whatsapp-postgres.ts`, `inventory-plan.ts` |
| T-6 | R-13 (contesté par la relecture finale, compensé par R-31) | `registerNumber.expired` n'est vrai que sur un code Meta identifié ; aucun n'est connu, il vaut donc toujours false. L'expiration est lue par la relecture. | L'expiration est vue à la relecture plutôt qu'au clic (voir P-49). | `src/whatsapp/meta-profile.ts` |
| T-7 | R-16, M-3 | Le portefeuille n'est relu que hors état périmé : au remplacement (`!waba.stale`) et à « Vérifier maintenant » (vérification non périmée). | Deux petits changements inutiles. | `whatsapp-account-service.ts` |
| T-8 | R-29 | L'état R2a du faux moteur e2e est posé par le scénario `display-name-approved`, pas dans l'état initial (un portefeuille initial changerait un lien attendu par un parcours existant). | Rien. | `apps/web/e2e/mock-state.ts`, `mock-engine.ts`, `helpers.ts` |
| T-9 | R-30 | Vague finale limitée à I-1, M-a à M-f et M-3 ; le reste du triage de la relecture finale est différé. | Retouches visibles en recette. | `progress.md` |
| T-10 | Impl T1 | `extractMetaIds` : chiffres seuls (5 à 25) = portefeuille ; adresse lue seulement en `https:` ou `http:`, hôte exact `business.facebook.com`, sans identifiants dans l'adresse ; seuls `business_id` et `asset_id`, première valeur d'un paramètre en double, fragment ignoré. | Une adresse valide d'un autre hôte de Meta n'est pas reconnue. | `packages/contracts/src/meta-links.ts` |
| T-11 | Impl T1 | Constantes partagées ajoutées hors brief : `PROFILE_PHOTO_TYPES`, `PROFILE_PHOTO_MAX_BYTES`, `DISPLAY_NAME_MAX`, `BUSINESS_PROFILE_LIMITS` ; `business_id` seulement dans la branche `meta_manual` ; adresse générique des apps avec barre finale (`https://developers.facebook.com/apps/`) ; pas de raison `profile_invalid`. | Constantes à déplacer. | `whatsapp.ts`, `meta-links.ts` |
| T-12 | Impl T2 (accepté) | `setWhatsAppAccountBusiness` : relecture et écriture en transaction locale (`FOR UPDATE` sur Postgres, sans verrou de topologie), `previous` = valeur avant l'appel, un nom changé compte comme un changement ; setters de numéro sans contrôle de présence ; `toStoredNameRequest` strict (forme illisible lue comme null, avertissement sans contenu). | Une demande stockée d'une ancienne forme est lue comme null. | `whatsapp-types.ts`, `whatsapp-sqlite.ts`, `whatsapp-postgres.ts` |
| T-13 | Impl T3 | Client Graph : `setProfilePhoto` ajouté (pose du handle) ; `graphRequest` à côté de `graphCall` ; refus 3441013 reconnu à l'envoi et à la pose ; identifiant de session d'envoi contrôlé (hôte Graph, chemin `/<version>/upload:`) et masqué ; `Content-Type` de l'envoi des octets = type du fichier ; `photo_url` gardée seulement en https ; nom du portefeuille borné à 200 ; contenu du profil lu rendu sans masquage. | `Content-Type` à confirmer avec une vraie photo (étape E-25). | `meta-profile.ts`, `meta-graph.ts` |
| T-14 | Impl T4 | Fournisseur injectable `readMetaBusiness` ; le portefeuille est relu à chaque relecture des numéros, événements Meta compris. | Un appel Graph de plus par relecture (différé). | `whatsapp-account-service.ts` |
| T-15 | Impl T4 | `ApiErrorDetail.business` et `BUSINESS_FOUND_DETAIL` (dans `NON_CHECK_DETAIL_PATHS`) ajoutés aux contrats. | Rien. | `packages/contracts/src/errors.ts`, `whatsapp.ts` |
| T-16 | Impl T5 | Statuts : refus de forme du moteur en 400, refus de Meta en 422, états de la cible en 409. Photo : premiers octets contrôlés et cohérents avec le type annoncé ; `express.raw` sur la seule route de la photo avec sa limite, toute erreur de l'analyseur rendue en `photo_invalid` ; `meta_app_id` absent : `app_unreadable`. | Codes HTTP à revoir. | `whatsapp-accounts.ts`, `whatsapp-number-profile-service.ts` |
| T-17 | Impl T5 | Verrou en mémoire de l'application du nom, propre au processus (clé organisation, compte, numéro). | À reprendre au chantier Infra (multi-instance). | `whatsapp-number-profile-service.ts` |
| T-18 | Impl T5 | Relecture des numéros en échec après une demande ou une application réussie : l'opération réussit avec la vue en base. `pin_enabled` n'est pas mis à true après un réenregistrement (Meta « peut » en faire le code, ce n'est pas certain). | Vue un peu en retard. | `whatsapp-number-profile-service.ts` |
| T-19 | Impl T5 | Six textes d'erreur exportés depuis `whatsapp-account-service.ts` pour être réutilisés. | Rien. | `whatsapp-account-service.ts` |
| T-20 | Impl T6 | Une seule date par inventaire ; la demande réconciliée ne vient que des lignes du compte ; un numéro repris d'un autre compte est une insertion sans demande héritée ; l'inventaire lit le mode du compte. | Rien. | `whatsapp-sqlite.ts`, `whatsapp-postgres.ts` |
| T-21 | Impl T7 | Harnais d'isolation câblé sur le service du profil et le faux Graph ; faux Meta : `GET /<PN>` d'une WABA partagée répond « Unknown path », la session d'envoi impose `file_offset`, le type et la longueur. | Un faux Meta qui s'écarte du vrai (différé). | `src/__tests__/isolation/harness.ts`, `graph-fake.ts` |
| T-22 | Impl T8 | `AccountWebhooks.metaIds` facultatif pour le lien de l'état Meta de la carte et du résultat. | Rien. | `account-webhooks.tsx` |
| T-23 | Impl T9 | `proxyEngineBinary` (BFF de la photo, refus sans appel au moteur) et `sendFile` (même lecture du refus que `sendMutation`) ; `DialogFrame` reçoit l'option `wide`. | Rien. | `apps/web/src/lib/proxy.ts`, `api-fetch.ts`, `dialog-frame.tsx` |
| T-24 | Vague finale | La relecture qui suit un refus générique du réenregistrement relit tous les numéros du compte et peut effacer la demande d'un autre numéro que Meta ne déclare plus (R-20, voulu) ; les tests §9.4 ont été adaptés sans retirer d'assertion. | Effet de bord sur un autre numéro du même compte. | `whatsapp-number-profile-service.ts` |
| T-25 | Vague finale | `formatMediumDate` : « 1er » obtenu par `formatToParts` en français et pour le premier jour seulement, `format` sinon (écart d'espace insécable avant « AM » dans V8). | Rien. | `apps/web/src/lib/medium-date.ts` |
| T-26 | Vague finale | Rebase local de commits non poussés pour replier un correctif de test dans le commit de son constat (un commit par constat). | Historique réécrit localement, rien de poussé. | historique git |

## D. Textes visibles fixés pendant l'exécution

Chaque texte est à valider par François. Origine : **Spec** (texte écrit dans la spec, repris tel quel ou presque), **PO** (fixé par le contrôleur dans un dispatch ou un ruling), **Impl** (écrit par l'implémenteur). Les textes R1 inchangés ne sont pas listés. Les versions anglaises existent pour chaque clé et ne sont pas listées.

### D.1 Raisons de refus (`errors.reasons.whatsapp_account.*`)

- [ ] `business_mismatch` (Impl T4, I-3) : « Ce compte WhatsApp appartient à un autre portefeuille que celui que vous avez saisi. Vérifiez le portefeuille ou le WABA ID. »
- [ ] `business_unreadable` (Spec) : « Le portefeuille Meta Business n'a pas pu être vérifié. Réessayez dans un moment. »
- [ ] `profile_unsupported` (PO) : « Le profil WhatsApp ne se règle pas depuis WABAGENT pour ce compte. »
- [ ] `number_removed` (PO) : « Ce numéro a été retiré chez Meta. »
- [ ] `photo_invalid` (PO) : « Photo refusée : JPEG ou PNG, 5 Mo au plus, 192 × 192 pixels au minimum. »
- [ ] `pin_rejected` (Spec) : « Code de vérification en deux étapes refusé par Meta. Vérifiez-le ou changez-le dans WhatsApp Manager. »
- [ ] `name_apply_expired` (PO) : « Le délai pour appliquer ce nom est dépassé. Demandez de nouveau ce nom. »
- [ ] `name_apply_in_progress` (PO, R-2) : « Le nouveau nom est déjà en cours d'application. »
- [ ] `no_display_name_request` (PO) : « Aucun nouveau nom n'est à appliquer pour ce numéro. »
- [ ] `profile_saved_unread` (PO, R-17) : « Profil enregistré chez Meta, mais sa relecture a échoué. Rouvrez la fenêtre dans un moment pour le vérifier. »

### D.2 Guide, étape 1 (`connectFlow.guideMeta.business.*`)

- [ ] `title` (Impl) : « Votre portefeuille Meta Business »
- [ ] `hint` (Impl) : « Ouvrez n'importe quelle page de Meta Business Suite et collez son adresse ici. L'identifiant seul fonctionne aussi. »
- [ ] `field` (Impl) : « Adresse d'une page Meta Business ou ID du portefeuille »
- [ ] `placeholder` (Impl) : « https://business.facebook.com/latest/…?business_id=… »
- [ ] `recognised` (Spec, P-1) : « Portefeuille {business} reconnu. Les liens ci-dessous ouvrent ses pages. »
- [ ] `wabaFound` (Impl) : « Compte WhatsApp {waba} repéré dans l'adresse : prérempli plus bas. »
- [ ] `unrecognised` (PO, R-32) : « Adresse non reconnue : collez l'adresse d'une page de Meta Business Suite qui contient l'ID du portefeuille, ou l'identifiant seul. »
- [ ] `required` (Impl) : « Collez d'abord l'adresse d'une page Meta Business ou l'ID du portefeuille. »
- [ ] `help` (Spec) : « Où trouver l'identifiant ? »
- [ ] `helpPath` (Impl, libellés Meta à relever) : « Paramètres de l'entreprise, Informations sur l'entreprise : « ID du portefeuille business ». »
- [ ] `schema.label` (Impl) : « Schéma de la page Informations sur le portefeuille business »
- [ ] `schema.title` (Spec) : « Informations sur le portefeuille business »
- [ ] `schema.name` (Impl) : « Nom du portefeuille »
- [ ] `schema.nameExample` (Impl) : « Votre entreprise »
- [ ] `schema.id` (Impl) : « ID du portefeuille business »
- [ ] `link` (Impl, générique) : « Ouvrir les paramètres Meta Business ↗ »
- [ ] `linkPrecise` (Impl, précis) : « Ouvrir les informations de l'entreprise ↗ »

### D.3 Guide, suite et choix du chemin (`connectFlow.guideMeta.*`)

- [ ] `locked` (Impl) : « La suite s'ouvre une fois le portefeuille reconnu : ses liens ouvriront alors les pages de ce portefeuille. »
- [ ] `paths.label` (Impl) : « D'où partez-vous ? »
- [ ] `paths.choose` (PO, R-23) : « Choisissez d'où vous partez pour voir les étapes. »
- [ ] `paths.required` (PO, R-23) : « Choisissez d'où vous partez. »
- [ ] `paths.existing.title` (Spec) : « J'ai déjà un compte WhatsApp Business »
- [ ] `paths.existing.text` (Impl, P-10) : « Dans ce portefeuille. »
- [ ] `paths.scratch.title` (Spec) : « Je pars de zéro »
- [ ] `paths.scratch.text` (Impl) : « Aucune app ni compte WhatsApp chez Meta. »
- [ ] `otherProvider` (Spec, fixé par le PO, R-25) : « Votre compte WhatsApp est géré par un autre prestataire (360dialog, Twilio…) ? Contactez-nous. »
- [ ] `optional` (Impl, maquette 03) : « Facultatif au départ »

### D.4 Guide, étapes des chemins (`connectFlow.guideMeta.*`)

- [ ] `app.hint` (Impl, texte R1 changé) : « Dans Meta for Developers, Mes apps, Créer une app : choisissez le cas d'usage WhatsApp destiné aux échanges avec les clients et rattachez l'app à ce portefeuille. Meta crée alors un compte WhatsApp et un numéro de test. »
- [ ] `app.linkedTitle` (Impl) : « App Meta reliée à ce compte »
- [ ] `app.linkedHint` (Spec) : « Votre app avec le cas d'usage WhatsApp, rattachée au portefeuille. Sans app, créez-la et choisissez ce compte. »
- [ ] `waba.title` (Impl, texte R1 changé) : « Compte WhatsApp (WABA) »
- [ ] `waba.hint` (Impl, texte R1 changé, libellés Meta à relever) : « Paramètres de l'entreprise, Comptes, Comptes WhatsApp : collez l'identifiant du compte, ou l'adresse de sa page dans WhatsApp Manager. »
- [ ] `waba.createdTitle` (Impl) : « Compte WhatsApp créé par Meta (WABA) »
- [ ] `waba.createdHint` (Impl) : « Meta l'a créé avec l'app, dans ce portefeuille : Paramètres de l'entreprise, Comptes, Comptes WhatsApp. Collez son identifiant, ou l'adresse de sa page dans WhatsApp Manager. »
- [ ] `waba.link` (Impl, texte R1 changé, générique) : « Ouvrir les paramètres Meta Business ↗ »
- [ ] `waba.linkPrecise` (Impl) : « Voir les comptes WhatsApp du portefeuille ↗ »
- [ ] `number.title` (Impl, texte R1 changé) : « Numéro dédié à l'agent IA »
- [ ] `number.hint` (Impl, texte R1 changé) : « WhatsApp Manager, Numéros de téléphone : ajoutez un numéro de téléphone dans ce compte. »
- [ ] `number.testHint` (Impl) : « Le numéro de test suffit pour essayer. Pour un vrai numéro : WhatsApp Manager, Numéros de téléphone. »
- [ ] `number.linkPrecise` (Impl) : « Ouvrir les numéros de ce compte ↗ »
- [ ] `token.title` (Impl, texte R1 changé) : « Utilisateur système et jeton sans expiration »
- [ ] `token.link` (PO, P-12) : « Ouvrir les paramètres du portefeuille ↗ »
- [ ] `secret.title` (Impl, texte R1 changé) : « Secret de l'app »
- [ ] `account.title` (Impl, P-9) : « Nommer le compte dans WABAGENT »
- [ ] `account.hint` (Impl) : « Le nom sous lequel ce compte apparaît dans Connexions. »

### D.5 Champs, refus et résultat du raccordement (`connectFlow.*`)

- [ ] `fields.wabaIdHint` (Impl, texte R1 changé) : « L'identifiant seul, ou l'adresse de la page du compte dans WhatsApp Manager. »
- [ ] `fields.wabaFromAddress` (Impl) : « WABA ID lu dans l'adresse : {waba}. »
- [ ] `errors.businessMismatch` (Spec) : « Ce compte WhatsApp appartient au portefeuille {name} ({id}), pas à celui que vous avez saisi. Vérifiez le portefeuille ou le WABA ID. »
- [ ] `result.business` (Spec) : « Portefeuille {name} »
- [ ] `result.businessRepointed` (PO, P-13) : « Les messages de ce compte WhatsApp arrivent désormais dans WABAGENT. L'autre produit relié à l'app ne les reçoit plus. »

### D.6 Tableau, menu et alertes de Connexions

- [ ] `numbers.colName` (Spec) : « Nom affiché »
- [ ] `numbers.nameRequest.in_review` (Impl) : « Nouveau nom en revue »
- [ ] `numbers.nameRequest.rejected` (Impl) : « Nouveau nom refusé »
- [ ] `numbers.nameRequest.approved_pending` (Impl) : « Nouveau nom à appliquer »
- [ ] `menu.profile` (Spec) : « Profil WhatsApp »
- [ ] `alerts.nameToApply` (Impl) : « Nouveau nom approuvé pour le {number} : « {name} ». »
- [ ] `alerts.nameToApplyBefore` (Impl) : « Il faut l'appliquer avant le {date}. »
- [ ] `alerts.nameToApplyBeforeApprox` (Impl) : « Il faut l'appliquer avant le {date} environ. »
- [ ] `alerts.nameToApplyHint` (Impl, P-18) : « Menu « Gérer » du numéro, « Profil WhatsApp ». »
- [ ] `alerts.nameApplyExpired` (PO, R-31) : « Le délai pour appliquer « {name} » est probablement dépassé : demandez de nouveau ce nom. »

### D.7 Fenêtre « Profil WhatsApp » (`connections.profile.*`)

- [ ] `title` (Impl) : « Profil WhatsApp du {number} »
- [ ] `intro` (Impl) : « Ce que voit le contact quand il ouvre la fiche de l'entreprise dans WhatsApp. Les changements du profil s'appliquent dès l'enregistrement, sans revue de Meta. »
- [ ] `loading` (Impl) : « Lecture du profil chez Meta. »
- [ ] `loadFailed` (Impl) : « Lecture du profil impossible. Réessayez. »
- [ ] `retry` (Spec) : « Réessayer »
- [ ] `readAt` (Impl, P-34) : « Lu chez Meta le {date}. »
- [ ] `photo` (Impl) : « Photo »
- [ ] `photoChange` (Spec) : « Changer la photo »
- [ ] `photoHint` (Impl, P-33) : « JPEG ou PNG, 5 Mo au plus, 192 × 192 pixels au minimum. »
- [ ] `photoAlt` (Impl) : « Photo du profil »
- [ ] `photoSending` (Impl) : « Envoi de la photo à Meta. »
- [ ] `photoDone` (Impl) : « Photo enregistrée chez Meta. »
- [ ] `photoFailed` (Impl) : « Envoi de la photo impossible. Réessayez. »
- [ ] `about` (Impl) : « Infos (statut sous le nom) »
- [ ] `description` (Impl) : « Description »
- [ ] `vertical` (Impl) : « Secteur »
- [ ] `verticalNone` (Impl, P-31) : « Non renseigné »
- [ ] `address` (Impl) : « Adresse »
- [ ] `email` (Impl) : « E-mail »
- [ ] `websites` (Impl) : « Sites web »
- [ ] `websitesMax` (Impl) : « 2 au plus »
- [ ] `website1` (Impl) : « Site web »
- [ ] `website2` (Impl) : « Second site web »
- [ ] `addWebsite` (Impl, P-32) : « Ajouter un second site »
- [ ] `counter` (Impl) : « {count} / {max} »
- [ ] `errors.aboutEmpty` (PO, R-5) : « Les infos ne peuvent pas être vides. »
- [ ] `errors.tooLong` (Impl) : « {max} caractères au plus. »
- [ ] `errors.emailInvalid` (Impl) : « Adresse e-mail invalide. »
- [ ] `save` (Spec) : « Enregistrer »
- [ ] `saved` (Spec) : « Profil enregistré chez Meta. »
- [ ] `noChange` (Impl, P-26) : « Aucun changement à enregistrer. »
- [ ] `saveFailed` (Impl) : « Enregistrement du profil impossible. Réessayez. »
- [ ] `close` (Impl, P-35) : « Fermer »
- [ ] `preview.title` (Impl) : « Aperçu : ce que voit le contact »
- [ ] `preview.business` (Impl) : « Compte professionnel »
- [ ] `preview.vertical` (Impl) : « Secteur »
- [ ] `preview.address` (Impl) : « Adresse »
- [ ] `preview.email` (Impl) : « E-mail »
- [ ] `preview.website` (Impl) : « Site web »
- [ ] `preview.note` (Impl) : « Aperçu indicatif : le rendu exact dépend de l'application WhatsApp du contact. »

### D.8 Encart « Nom affiché » (`connections.displayName.*`)

- [ ] `label` (Spec) : « Nom affiché »
- [ ] `approved` (Spec) : « Approuvé »
- [ ] `inReview` (Impl) : « En revue chez Meta »
- [ ] `rejected` (Impl) : « Nouveau nom refusé »
- [ ] `approvedPending` (Impl) : « Approuvé, à appliquer »
- [ ] `limit` (Impl) : « 10 changements de nom au plus par période de 30 jours. »
- [ ] `inReviewText` (Impl) : « Nom demandé le {date} : {name}. »
- [ ] `inReviewTextUndated` (Impl) : « Nom demandé : {name}. »
- [ ] `inReviewHint` (Impl) : « Le nom actuel reste affiché pendant la revue. Meta revoit en général en 1 à 2 jours. »
- [ ] `rejectedText` (Impl) : « « {name} » refusé par Meta. »
- [ ] `rejectedReason` (Impl, jamais affiché aujourd'hui, P-39) : « Motif donné par Meta : {reason} »
- [ ] `rules` (Impl) : « Règles de Meta ↗ »
- [ ] `approvedText` (Impl, P-47) : « « {name} » approuvé le {date}. »
- [ ] `approvedTextUndated` (Impl) : « « {name} » approuvé par Meta. »
- [ ] `applyBefore` (PO, P-47) : « Il faut l'appliquer avant le {date}. »
- [ ] `applyBeforeApprox` (Impl) : « Il faut l'appliquer avant le {date} environ. »
- [ ] `probablyExpired` (PO, R-31) : « Le délai pour appliquer ce nom est probablement dépassé. Demandez de nouveau ce nom. »
- [ ] `code` (Spec, F-7) : « Code de vérification en deux étapes »
- [ ] `codeHelp` (Spec et §13.2, lien ajouté par l'implémenteur) : « Le code à 6 chiffres de la vérification en deux étapes de ce numéro, choisi dans WhatsApp Manager. Code oublié : changez-le dans WhatsApp Manager ↗ »
- [ ] `codeHelpNoCode` (Spec §13.2, F-6) : « Aucun code n'est actif sur ce numéro. Choisissez 6 chiffres et notez-les : Meta peut en faire le code du numéro. »
- [ ] `codeInvalid` (Impl) : « Le code fait 6 chiffres. »
- [ ] `apply` (Spec) : « Appliquer le nouveau nom »
- [ ] `applied` (Impl) : « Nouveau nom appliqué. »
- [ ] `applyFailed` (Impl) : « Application du nouveau nom impossible. Réessayez. »
- [ ] `changeCode` (Impl) : « Changer le code dans WhatsApp Manager ↗ »
- [ ] `request` (Spec) : « Demander un autre nom »
- [ ] `newName` (Impl) : « Nouveau nom »
- [ ] `requestHint` (Impl) : « Le nom passe en revue chez Meta. Meta revoit en général en 1 à 2 jours. Le nom actuel reste affiché pendant la revue. »
- [ ] `nameEmpty` (Impl) : « Le nom est requis. »
- [ ] `tooLong` (Impl) : « {max} caractères au plus. »
- [ ] `send` (Impl) : « Envoyer la demande »
- [ ] `cancel` (Impl) : « Annuler »
- [ ] `requested` (Impl) : « Demande envoyée à Meta. »
- [ ] `requestFailed` (Impl) : « Demande du nouveau nom impossible. Réessayez. »

### D.9 Les 22 secteurs (`connections.profile.verticals.*`, R-27, Impl T9)

- [ ] OTHER : « Autre »
- [ ] AUTO : « Automobile » (à trancher au regard de la règle des thèmes de la démo Cyran, étape E-46)
- [ ] BEAUTY : « Beauté, spa et salons »
- [ ] APPAREL : « Vêtements et accessoires »
- [ ] EDU : « Éducation »
- [ ] ENTERTAIN : « Divertissement »
- [ ] EVENT_PLAN : « Organisation d'événements »
- [ ] FINANCE : « Finance et banque »
- [ ] GROCERY : « Alimentation et épicerie »
- [ ] GOVT : « Services publics »
- [ ] HOTEL : « Hôtellerie et hébergement »
- [ ] HEALTH : « Santé »
- [ ] NONPROFIT : « Association à but non lucratif »
- [ ] PROF_SERVICES : « Services professionnels »
- [ ] RETAIL : « Commerce de détail »
- [ ] TRAVEL : « Tourisme et transports » (choisi pour éviter « voyage », étape E-46)
- [ ] RESTAURANT : « Restauration »
- [ ] ALCOHOL : « Boissons alcoolisées »
- [ ] ONLINE_GAMBLING : « Jeux d'argent en ligne »
- [ ] PHYSICAL_GAMBLING : « Jeux d'argent hors ligne »
- [ ] OTC_DRUGS : « Médicaments sans ordonnance »
- [ ] MATRIMONY_SERVICE : « Agences matrimoniales »

### D.10 Messages de validation des contrats (Impl T1)

Messages des schémas de `packages/contracts/src/whatsapp.ts`, rendus par le moteur ou le BFF dans un refus 400 `VALIDATION_ERROR`. Ils ne sont visibles que si un refus de forme remonte à l'écran ; l'écran a ses propres textes pour les cas qu'il contrôle lui-même (D.7, D.8). À vérifier à l'écran en même temps que la valeur.

- [ ] « ID du portefeuille : 5 à 25 chiffres. »
- [ ] « Les infos ne peuvent pas être vides. »
- [ ] « Les infos font 139 caractères au plus. »
- [ ] « La description fait 512 caractères au plus. »
- [ ] « L'adresse fait 256 caractères au plus. »
- [ ] « L'e-mail fait 128 caractères au plus. »
- [ ] « Adresse e-mail invalide. »
- [ ] « L'adresse du site fait 256 caractères au plus. »
- [ ] « 2 sites web au plus. »
- [ ] « Secteur inconnu. »
- [ ] « Le nom est requis. »
- [ ] « Le nom fait 512 caractères au plus. »
- [ ] « Le code fait 6 chiffres. »

## E. Étapes de recette

Cadre (plan, tâche 12, étape 3) : recette pilotée par Claude Code (navigateur et terminal), dans la copie `/Users/francoisgreze/www/Cyran-projects/wabagent-recette-r1` mise à jour sur la branche, moteur avec `PUBLIC_BASE_URL=https://dev.wabagent.com`, tunnel lancé par François, WABA de dev `1122051030798254` et son numéro de test. Une étape marquée **faux moteur** se joue sur le faux moteur e2e parce qu'elle n'est pas provocable en réel ; une étape qui ne peut être jouée nulle part est déclarée non recettée dans le rapport.

### E.1 Préalable

| N° | Où | Ce qu'on regarde, ce qui est attendu | Décisions |
|---|---|---|---|
| E-1 | Connexions, compte de dev | Retirer le compte de dev puis le raccorder de nouveau (étape E-2) : la clé d'URL du webhook change (incident de l'essai, §7). L'ancienne adresse ne répond plus. | T-2 |

### E.2 Guide et raccordement

| N° | Où | Ce qu'on regarde, ce qui est attendu | Décisions |
|---|---|---|---|
| E-2 | Connexions › Raccorder, mode Meta | Coller l'adresse de WhatsApp Manager du compte de dev : « Portefeuille <identifiant> reconnu », sans nom ; « Compte WhatsApp <WABA> repéré dans l'adresse » ; WABA préremplie ; chemin 1 coché. « https:// » s'affiche sans ligature. | P-1, P-2, P-8, P-16, F-1, F-11 |
| E-3 | Même écran, page rechargée | Coller l'identifiant seul : reconnu, aucun chemin coché, les deux cartes, la ligne « autre prestataire » (sans lien) puis « Choisissez d'où vous partez pour voir les étapes. ». | P-2, P-3, P-4 |
| E-4 | Même écran, avant tout portefeuille | La suite est grisée et ne réagit pas (ni clic, ni tabulation), la raison est écrite au-dessus. | P-5 |
| E-5 | Champ du portefeuille | Taper une adresse sans `business_id`, une adresse sans schéma, une adresse d'un autre hôte : aucun message pendant la frappe, le texte unique « Adresse non reconnue : … » à la sortie du champ. Envoyer sans portefeuille : « Collez d'abord… », focus sur le champ, aucun appel. | P-6, P-7, T-10 |
| E-6 | Portefeuille reconnu, aucun chemin | Envoyer : focus sur le premier choix, « Choisissez d'où vous partez. », aucun appel. Changer ensuite le portefeuille : noter si le message reste (mineur différé). | P-3 |
| E-7 | Chemin 1, WABA tapée à la main | Coller ensuite à l'étape 1 une adresse avec un autre `asset_id` : la WABA tapée est remplacée, chemin 1 coché. Juger si c'est acceptable. | P-8 |
| E-8 | Chemin 1 | Ordre des étapes 2 à 7 ; le nom du compte en dernier ; carte « Dans ce portefeuille. » ; aucune mention « précis » ou « générique » ; libellé « Ouvrir les paramètres du portefeuille ↗ » pour les utilisateurs système. | P-9, P-10, P-11, P-12 |
| E-9 | Chemin 1 et chemin 2, avec François dans les vraies pages | Ouvrir chaque lien un par un : les liens précis ouvrent la page du portefeuille (et de la WABA) ; les liens génériques (apps, secret) ouvrent la page générique. Relire le chemin 2 sans le jouer jusqu'au bout. Valider définitivement la maquette 03. | F-2, P-11, P-12 |
| E-10 | Vraies pages de Meta | Relever les libellés cités dans le guide (« Paramètres de l'entreprise, Informations sur l'entreprise », « ID du portefeuille business », « Comptes, Comptes WhatsApp », « Utilisateurs, Utilisateurs système », « Informations sur le portefeuille business ») et l'adresse réelle de la page des utilisateurs système. Si elle est confirmée, décider si le lien peut devenir précis dans un lot suivant. | P-12, D.2, D.4 |
| E-11 | Raccordement avec un portefeuille faux | Refus avant toute écriture chez Meta, phrase qui nomme le portefeuille lu « Wabagent (1270659448489249) » ; rien de raccordé. | F-11, I-3, I-4 |
| E-12 | Résultat du raccordement réussi | « Portefeuille Wabagent » sous le nom du compte. La phrase de l'autre produit n'apparaît pas (la WABA de dev n'est pas reliée à un autre produit). | P-13 |
| E-13 | Faux moteur, ou non recetté | Phrase « Les messages de ce compte WhatsApp arrivent désormais dans WABAGENT… » en ton avertissement : à juger sur le texte et le ton. Le faux moteur ne la simule pas aujourd'hui : déclarer non recettée en réel si aucun autre produit n'est disponible. | P-13 |
| E-14 | Compte raccordé avant le lot (copie de recette, s'il en reste un) | « Vérifier maintenant » : le portefeuille est lu sans comparaison ; les liens du menu et des alertes deviennent précis. Aucune alerte ne signale un changement de portefeuille. | I-4, P-14 |

### E.3 Connexions : tableau, menu, alertes, liens

| N° | Où | Ce qu'on regarde, ce qui est attendu | Décisions |
|---|---|---|---|
| E-15 | Tableau des numéros | Colonne « Nom affiché » en deuxième position ; le nom n'est plus sous le numéro ; plus tard (E-31), étiquette orange « Nouveau nom à appliquer », jamais le nom demandé dans la colonne. | P-19 |
| E-16 | Menu « Gérer » d'un numéro | « Profil WhatsApp » en première entrée ; absente pour un numéro CM.com et un numéro retiré (faux moteur si aucun n'est disponible). | P-20 |
| E-17 | Carte du compte, menu, échecs de remise, état Meta | Les liens vers Meta portent le portefeuille et la WABA du compte ; avec deux comptes, chacun porte les siens. | F-4, T-22 |
| E-18 | Page de l'agent IA, encart Numéro | Le lien « Ouvrir WhatsApp Manager » reste générique (écart au §5.4). Décider s'il faut porter le portefeuille dans `BotNumberSummary`. | P-21 |
| E-19 | Carte du compte, nom approuvé à appliquer (après E-31) | Alerte orange avec le numéro, le nom et la date limite (« environ »), et l'aide « Menu « Gérer » du numéro, « Profil WhatsApp ». », sans bouton. Juger si un bouton manque. | P-17, P-18 |

### E.4 Fenêtre « Profil WhatsApp »

| N° | Où | Ce qu'on regarde, ce qui est attendu | Décisions |
|---|---|---|---|
| E-20 | Ouverture de la fenêtre | Squelette pendant la lecture, puis champs dans l'ordre de la maquette ; encart du nom en tête ; « Lu chez Meta le <date et heure>. » (« 1er » si c'est le premier du mois) ; fenêtre large ; « Fermer » à côté d'« Enregistrer » ; focus rendu au bouton « Gérer » à la fermeture. Regarder en clair et en sombre. | P-34, P-35, P-36, F-5, F-9 |
| E-21 | Lecture en échec (si provocable, par exemple tunnel coupé côté moteur vers Meta ; sinon faux moteur) | Raison lisible et « Réessayer » ; l'encart du nom reste affiché. | P-36 |
| E-22 | Modifier infos, description, adresse | Compteurs en caractères (un emoji compte 1) ; aperçu qui suit la saisie ; « Enregistrer » n'envoie que les champs modifiés ; « Profil enregistré chez Meta. » et version relue (par exemple barre finale ajoutée par Meta à un site). Vérifier la fiche de l'entreprise sur le téléphone de François. | P-25, P-26, F-9 |
| E-23 | Infos vidées ; champ non touché en erreur | Infos vidées : « Les infos ne peuvent pas être vides. », enregistrement bloqué, focus sur le champ. Si Meta rend un champ hors règle non touché, la description s'enregistre seule malgré l'erreur affichée. | P-23, P-25 |
| E-24 | E-mail et sites | E-mail mal formé refusé ; site sans schéma accepté et publié tel quel ; « Ajouter un second site » ; 2 sites au plus ; site vidé retiré. Rien modifié : « Aucun changement à enregistrer. » sans appel. | P-24, P-26, P-32 |
| E-25 | Photo | JPEG puis PNG de taille normale : « Photo enregistrée chez Meta. », photo relue dans le formulaire et l'aperçu, puis sur le téléphone. GIF et fichier de plus de 5 Mo : refus sans appel. Image de 191 pixels : refus de Meta restitué en `photo_invalid`. Aide de la photo selon l'essai. | P-22, P-33, T-13 |
| E-26 | Secteur | Liste des 22 libellés (section D.9) ; un secteur lu hors liste s'affiche « Non renseigné ». | P-31 |
| E-27 | Avis `profile_saved_unread` (faux moteur, non provocable en réel) | Avis en ton d'avertissement sur fond, lisible en sombre, jamais en rouge ni en vert ; la saisie envoyée reste affichée. | P-27 |
| E-28 | Erreurs rares, lues dans les tests (déclarer non recettées si non provocables) | Erreur 100/33 aux étapes d'envoi de la photo (refus générique) ; jeton refusé pendant une opération du profil (compte en erreur). | P-28, P-29 |
| E-29 | Compte en erreur | Décider si la fenêtre du profil doit rester accessible pour un compte en état `error` (comportement actuel : oui). | P-30 |

### E.5 Nom d'affichage

| N° | Où | Ce qu'on regarde, ce qui est attendu | Décisions |
|---|---|---|---|
| E-30 | Encart, aucune demande | Nom actuel, « Approuvé », « 10 changements de nom au plus par période de 30 jours. », « Demander un autre nom ». | P-48 |
| E-31 | « Demander un autre nom » sur le numéro de test | Compteur sur 512 ; nom vide : « Le nom est requis. » sans appel ; envoi : « Demande envoyée à Meta. ». Le numéro de test passe aussitôt en « Approuvé, à appliquer » (Meta l'accepte sans revue) : vérifier que la demande ne disparaît pas à la relecture qui suit l'envoi. | P-37, P-42, P-44 |
| E-32 | État « approuvé, à appliquer » | « « <nom> » approuvé le <date>. Il faut l'appliquer avant le <date> environ. » ; le nom demandé n'apparaît pas comme nom affiché, ni dans la colonne ni dans l'aperçu. Observer dans les journaux si l'événement `phone_number_name_update` arrive et s'il porte une date (essai §1). | P-47, P-43, T-1 |
| E-33 | Champ du code | Champ texte visible, clavier numérique, 6 chiffres au plus ; le gestionnaire de mots de passe du navigateur ne propose pas de l'enregistrer. Numéro de test (`is_pin_enabled` false) : texte « Aucun code n'est actif sur ce numéro… ». Faux moteur avec `pin_enabled` null : aide « Code oublié ». | P-45, P-46, F-6, F-7 |
| E-34 | Pendant une revue ou un nom à appliquer | « Demander un autre nom » n'est pas proposé. Juger si c'est gênant. | P-48 |
| E-35 | « Appliquer le nouveau nom » avec un code de 6 chiffres | « Nouveau nom appliqué. » ; colonne et encart montrent le nouveau nom ; l'alerte de la carte disparaît ; « Rafraîchir les numéros » ensuite garde le nouveau nom (aucune demande recréée). | P-41, P-43 |
| E-36 | Téléphone de François après le réenregistrement | Envoyer un message au numéro de test : l'agent IA répond (webhook intact, essai §3) ; le nom affiché dans WhatsApp est le nouveau. | P-41 |
| E-37 | Code refusé (faux moteur ; en réel seulement avec un vrai numéro, E-40) | « Code de vérification en deux étapes refusé par Meta… » avec le lien précis « Changer le code dans WhatsApp Manager ↗ » ; champ vidé ; nom inchangé. | D.1, I-9 |
| E-38 | Délai dépassé (faux moteur, date limite passée) | Encart : « Le délai pour appliquer ce nom est probablement dépassé… » avec « Demander un autre nom », sans champ du code, étiquette « Approuvé, à appliquer » gardée. Alerte de la carte sans le numéro. Juger l'étiquette et l'alerte. | P-49 |
| E-39 | Nom refusé (faux moteur) | « « <nom> » refusé par Meta. », aucun motif, lien « Règles de Meta ↗ », « Demander un autre nom ». Refus de Meta à la demande (par exemple limite des 10 changements) : refus générique avec le texte de Meta replié, en anglais. | P-38, P-39 |

### E.6 Points ouverts du registre d'exécution

| N° | Point | Ce qu'il faut établir |
|---|---|---|
| E-40 | Vrai numéro pour le refus du code | Sur un vrai numéro de François avec un code actif : un mauvais code donne-t-il bien `133005` (`pin_rejected`) ? Sinon le refus est générique et R-31 relit les numéros. Sans vrai numéro : déclaré non recetté en réel (spec §13.3). |
| E-41 | `owner_business_info` avec un jeton qui n'a que les permissions du guide | Générer un jeton d'utilisateur système avec seulement `whatsapp_business_management` et `whatsapp_business_messaging` : la lecture du portefeuille réussit-elle ? Si elle échoue, tout raccordement par le guide est refusé (`business_unreadable`, P-15, F-8). |
| E-42 | WABA partagée avec le portefeuille d'une agence | Une WABA possédée par le portefeuille du client et partagée à celui d'une agence : `owner_business_info` rend le propriétaire. Une agence qui saisit son propre portefeuille est refusée (`business_mismatch`). Décider si ce cas doit être accepté. |
| E-43 | Lien des règles de nom de Meta | Ouvrir `https://www.facebook.com/business/help/757569725593362` (adresse donnée par le contrôleur, jamais ouverte) : est-ce bien la page des règles du nom d'affichage ? |
| E-44 | Demande suivie juste après l'envoi | Sur un vrai numéro soumis à revue : Meta rend-il la demande `PENDING_REVIEW` dès la relecture qui suit l'envoi ? Sinon R-20 efface la demande en revue que WABAGENT vient d'écrire (P-42), et il faut une tolérance. |
| E-45 | Délai d'envoi d'une photo de 5 Mo | Envoyer une photo proche de 5 Mo par le tunnel : l'envoi tient-il dans le délai de 10 s de `httpJson` ? Sinon le relever pour cette route. |
| E-46 | « Automobile » et « Tourisme et transports » | Trancher si la règle de `CLAUDE.md` sur les thèmes de la démo Cyran (golf, immo, voyage, auto, acquisition) s'applique aux libellés des secteurs de Meta, et valider les deux libellés. |
| E-47 | Retards de Meta sur le nom | Observer en réel : délai de mise à jour de `verified_name` après le réenregistrement (R-19) ; un `verified_name` changé pour une autre raison pendant `approved_pending` reste invisible jusqu'à 14 jours ; refus de Meta rendu alors que la relecture montre le nom appliqué (constat parqué). |
| E-48 | Historique git avant le merge | `0402623` ne compile pas seul et `ba435ea` porte les valeurs neutres qui le réparent ; le message de `712af8a` décrit le futur alors qu'il retire les raisons. Décider avec François d'un rebase qui replie `ba435ea` dans `0402623` (et corrige le message de `712af8a`) pour que chaque commit compile et passe ses tests. Rebase seulement sur accord, avant tout push. |

## F. Constats parqués et mineurs différés

### F.1 Constats parqués de la relecture finale (avec leur ruling)

- Le test §9.4 du service ne vérifie pas que l'échec est bien le refus de Meta (ajouter `provider_text` défini). Ruling : mineur, le test HTTP verrouille le chemin par le statut 422.
- Refus de Meta rendu alors que la relecture montre le nom appliqué. Ruling : cas rare, point de recette (E-47).
- Relecture aussi sur refus transitoire ou jeton refusé (appels inutiles). Ruling : sans effet nuisible.
- Course résiduelle M-3 pendant `readBusiness`. Ruling : même compte, déjà acceptée pour R-16.
- `provider-text.tsx` en chasse fixe avec ligatures. Ruling : hors guide, mineur.

### F.2 Mineurs de la revue d'isolation non corrigés (R-30)

- M-1 : le code n'est cherché dans les octets bruts de la base que sous SQLite ; sous Postgres, seules trois lectures sont contrôlées.
- M-2 : la garde statique du code (`pin`) ne couvre que le moteur ; dans le web le code s'appelle `code`, et le test BFF ne capture pas les journaux.
- M-4 : délai entre la recherche du numéro et l'appel à Meta, sans nouvelle lecture de l'état du numéro (fenêtre de quelques millisecondes, jeton de l'organisation qui appelle).

### F.3 Mineurs différés des tâches (triage de la relecture finale accepté par R-30)

- Tâche 1 : expression `^\d{5,25}$` écrite deux fois (`meta-links.ts`, `whatsapp.ts`) ; test du code sans commentaire `// spec R2a §9.4` ; message de `712af8a` (E-48) ; `0402623` non compilable seul (E-48) ; `systemUsers` et `businessInfo` ont la même adresse avec un `precise` différent (le web présente `systemUsers` comme une page à parcourir). Réglés : barre finale de `systemUsers` (R-9bis), adresse sans schéma (R-32).
- Tâche 2 : vue CM.com qui ne force pas `pin_enabled` et `display_name_request` à null par mode ; contrat de `business` sans le cas « compte déconnecté » ; `UPDATE` final de `setWhatsAppAccountBusiness` sans `AND client_id` (sûr par la relecture en transaction).
- Tâche 3 : envoi de la photo avec le délai de 10 s (E-45) ; traitement des réponses dupliqué dans `sendUploadBytes` ; `name_status` demandé à Meta mais jamais utilisé.
- Tâche 4 : trace `business_changed` sur simple changement de nom ; appel Graph de plus par relecture.
- Tâche 5 : audit des refus inégal (`no_display_name_request` avant le verrou, `name_apply_in_progress` et refus de forme non tracés) ; booléens des setters non lus ; `patch` et `profilePatch` dans `SENSITIVE_WORDS` ; jeton refusé à la relecture après écriture : compte en erreur mais écran `profile_saved_unread`.
- Tâche 6 : commentaire de `meta-events.test.ts` ; `verified_name` changé pendant `approved_pending` invisible jusqu'à 14 jours (E-47) ; en revue et « Meta ne dit rien » : l'ancien nom peut réapparaître si Meta tarde (E-47) ; date de Meta illisible qui donnerait une date limite nulle (théorique).
- Tâche 7 : partie Meta de `betaState` lue par identifiant seul ; faux Meta « Unknown path » sur `GET /<PN>` ; recherche du code dans les octets bruts sous Postgres (devenu M-1).
- Tâche 8 : `role="status"` monté déjà rempli dans `business-step.tsx` ; erreurs des champs masqués enregistrées par un envoi sans portefeuille ; « Choisissez d'où vous partez. » qui reste si le portefeuille change (E-6) ; phrase de choix et mention de verrouillage qui se suivent avant la reconnaissance ; pas de test de collage d'une adresse de WhatsApp Manager depuis l'état sans chemin. Réglé : texte de l'adresse https sans `business_id` (R-32).
- Tâche 9 : erreurs de photo non rattachées au champ fichier (`aria-describedby`) ; lecture du profil non annoncée (pas de `role="status"` sur le squelette) ; contrôle de `content-length` du BFF de la photo non testé par l'en-tête ; `readOnly` ignoré par le menu (comportement existant). Réglé : contraste de l'avis en sombre (M-c).
- Tâche 10 : `photo_invalid` du faux moteur avec « Données invalides. » ; ordre photo et identifiants inversé ; sélecteur `b` fragile ; `business_unreadable`, `business_repointed`, `name_apply_expired` et `name_apply_in_progress` non couverts en e2e.
- Relecture finale : les mineurs M-g et M-h ne sont pas décrits dans les sources de ce registre (le registre d'exécution ne garde que leur existence et leur report par R-30) ; à reprendre du rapport de la relecture finale si l'auditeur en a besoin.

## Compléments de la revue finale de branche (ajoutés par le contrôleur)

- M-g : une demande de nom `in_review` écrite après la réponse de Meta est effacée par la relecture immédiate si Meta ne rend pas encore `new_display_name` (`src/core/services/whatsapp-number-profile-service.ts`, `src/whatsapp/inventory-plan.ts`) ; l'encart montrerait alors « aucune demande » juste après « Demande envoyée ». Immédiat à l'essai ; reporté par R-30, à observer en recette sur un vrai numéro (rejoint E-43).
- M-h : le refus `business_mismatch` ne marque ni ne met le focus sur le champ du portefeuille (`apps/web/src/components/connections/connect-form.tsx`) ; le focus va à la zone d'erreur, dont le texte nomme le portefeuille lu. Reporté par R-30, à juger en recette.
