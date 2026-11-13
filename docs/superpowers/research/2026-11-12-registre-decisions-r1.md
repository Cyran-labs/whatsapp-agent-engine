# Registre des décisions du lot R1 (raccordement automatique du compte WhatsApp)

Date : 12 nov. 2026. Branche `feat/raccordement-r1` (base `c516ab8`). Exécution en autonomie, subagent-driven : Claude contrôleur en PO, implémenteurs et relecteurs sur Opus, revue d'isolation et relecture finale sur Fable.

Sources d'autorité : spec `docs/superpowers/specs/2026-11-12-raccordement-automatique-r1-design.md`, plan `docs/superpowers/plans/2026-11-12-raccordement-automatique-r1.md`, `CLAUDE.md`, essais Meta du 12 nov. 2026 (`2026-11-12-essai-raccordement-automatique.md`, `2026-11-12-limites-api-meta-raccordement.md`).

Revues : revue d'isolation `2026-11-12-revue-isolation-r1.md` (0 Bloquant, 1 Important, 5 Mineurs ; Important et Mineurs 1, 4, 5 corrigés) ; relecture finale de branche (0 Critique, 4 Importants, tous corrigés sauf la ligne de `CLAUDE.md`, faite en fin de lot).

Toutes les décisions ci-dessous sont contestables. Les décisions produit deviennent des étapes de recette à valider par François.

## A. Décisions produit (visibles à l'écran ou chez Meta)

| N° | Décision | Pourquoi | Si c'est faux |
|---|---|---|---|
| P-1 (R-6) | Un compte Meta raccordé avant le lot affiche « État du webhook inconnu : lancez Vérifier maintenant. » | Il n'a pas d'état enregistré ; la vérification l'inscrit | Une phrase à changer |
| P-2 (R-11, FR-I2) | « Vérifier maintenant » : si les identifiants sont bons mais que le webhook n'a pas pu être inscrit, l'issue est « vérifié » ; la fenêtre titre « Identifiants vérifiés, webhook non inscrit chez Meta. » avec le contrôle en échec ; le compte reste connecté (une panne passagère du tunnel ou de l'hébergement ne coupe pas les agents IA Online) | Le contrat « non concluant » veut dire « rien n'a changé », faux ici ; ne pas couper les agents IA pour une panne passagère | Agents IA qui ne reçoivent plus rien alors que le compte dit connecté (l'alerte « Webhook absent » le montre) |
| P-3 (R-15) | Après un échec de « Faire pointer vers WABAGENT », le bouton reste (état `elsewhere`) et le refus s'affiche | Pouvoir réessayer | Aucun |
| P-4 (R-18) | Fenêtre de retrait : elle n'avertit que si le webhook de l'app pointe encore vers le compte retiré (`left`) ou si le retrait chez Meta a échoué ; elle dit aussi quand le webhook de l'app a été repointé vers un autre compte (FR-M7) | N'avertir que de ce qui concerne WABAGENT | Une phrase de plus ou de moins |
| P-5 (R-22) | Textes reformulés pour respecter le test de style existant : « L'adresse de WABAGENT n'a pas pu être enlevée chez Meta ; elle ne reçoit plus rien. », nom du cas d'usage Meta reformulé dans le guide | Le test de style interdit certaines tournures | Textes à reprendre |
| P-6 (R-22) | La vérification d'entreprise passe des prérequis au bloc « Recommandé » du guide | Spec §6.1 : elle n'empêche pas le raccordement | Le client ne la fait pas et reste en envoi limité (l'état Meta affiché le dit) |
| P-7 (R-22) | « Webhook inscrit chez Meta. » s'affiche aussi quand tout va bien ; un non-admin lit « prévenez un administrateur » | Rassurer ; dire quoi faire à chacun | Ligne en trop |
| P-8 (R-23, FR-M3) | Sur la page de l'agent IA, une consigne sur le webhook donne le lien « Voir dans Connexions » ; hors état `connected`, aucune ligne de webhook ni bouton « Faire pointer » | Règle « actionnable » ; ne pas afficher « Webhook inscrit » en vert sur un compte en erreur | Aucun |
| P-9 (R-27, en recette) | La bande bordée vide d'un compte en erreur (carte et encart Numéro) est retirée | Défaut visible | Une bande vide |
| P-10 (FR-I1) | Quand un raccordement échoue après avoir écrit chez Meta, le bilan du retrait s'affiche comme une phrase (neutre si l'adresse a été retirée, alerte sinon), plus jamais comme un contrôle rouge à clé technique | Restitution des erreurs | Aucun |
| P-11 (FR-I4) | Sans `PUBLIC_BASE_URL`, le raccordement, la vérification et le remplacement d'un compte Meta sont refusés avec « La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support. » ; avertissement `[Config]` au démarrage | Spec §5.1 : l'adresse publique est indispensable | Aucun raccordement Meta possible sur un déploiement mal configuré, dit clairement |

## B. Interprétations de règles validées

| N° | Décision | Règle | Si c'est faux |
|---|---|---|---|
| I-1 (R-4) | La garde `error-reasons-usage` est restée rouge sur quelques commits de la branche, sans exemption, jusqu'à l'émission des nouvelles raisons | `CLAUDE.md` : aucun test n'est affaibli | Branche non bissectable sur ces commits |
| I-2 (R-12) | Jeton refusé à « Vérifier maintenant » : compte en erreur comme avant (règle 2b) ; sans `PUBLIC_BASE_URL` : non concluant, aucun appel | Spec 2b §7.7, R1 §5.3 | Textes |
| I-3 (R-14) | Identifiants remplacés pendant une vérification : rien n'est écrit chez Meta ni en base avec les anciens ; issue « vérifié » avec contrôle webhook en échec | Revue 2b-2 M-2 | Texte d'issue |
| I-4 (R-16) | « Faire pointer vers WABAGENT » : compte en erreur 422, CM.com 404, sans `PUBLIC_BASE_URL` 422 | Cohérence avec la vérification | Codes HTTP |
| I-5 (R-20) | La ligne §8 « événement de compte d'une autre organisation » figure aussi dans la suite d'isolation | `CLAUDE.md` : suite d'isolation obligatoire | Test redondant |
| I-6 (ISO-I1) | Le registre des vérifications en attente n'est armé qu'au raccordement d'un nouveau compte ; un compte existant est servi par la base (qui refuse un compte retiré) | Revue d'isolation I-1 | Aucun |

## C. Décisions techniques

| N° | Décision | Si c'est faux |
|---|---|---|
| T-1 (R-2) | La vérification Meta est en lecture seule ; le contrôle d'unicité de la WABA (revue 2b-2 I-1) est dans le service, juste après la preuve d'accès, sous réservation | Aucun |
| T-2 (R-5, R-9, R-19) | Réservation en mémoire par WABA autour des écritures sur l'adresse de la WABA (raccordement, vérification, remplacement, déconnexion) et de « Faire pointer vers WABAGENT » ; le webhook de l'app est écrit hors réservation, sans verrou par app (spec §5.4) ; prise avant les contrôles d'unicité et avant la déconnexion en base (corrigé après l'audit des décisions, T-2) | Propre à un processus : à reprendre au chantier Infra (multi-instance), sans supposer de verrou par app |
| T-3 (R-7) | Après une panne passagère de l'écriture chez Meta, le retrait est tenté quand même | Un appel de plus |
| T-4 (R-8, FR-M1) | Refus net autre que 2200 : `verification_failed` ; panne de notre base après l'inscription : 500 avec référence et retrait de l'adresse | Texte moins précis |
| T-5 (R-24, FR-I3) | Appels au jeton d'app avec `appsecret_proof` et en-tête `Authorization` (plus de jeton dans l'URL) | À valider en recette avec « Clé requise » activé et désactivé |
| T-6 (ISO-M1) | Écritures d'état des webhooks et de l'état Meta par organisation et identifiant, partielles (champ par champ) | Aucun |
| T-7 (FR-M2) | Remplacement des identifiants vers une autre app : l'adresse de l'ancienne app est retirée de la WABA ; l'ancienne app reste abonnée (voir D-1) | Doublons rejetés à la signature si l'ancienne app pointe encore vers le compte |
| T-8 (R-28) | Retrait de l'adresse de l'ancienne app hors réservation | Course théorique sur la propre WABA du compte |

## D. Décisions laissées à François

Tranchées par François le 12 nov. 2026, après l'audit des décisions (`2026-11-12-audit-decisions-r1.md`) :
- D-1 : au retrait d'un compte, WABAGENT désabonne toujours l'app de la WABA (et l'ancienne app au remplacement vers une autre app ; au raccordement raté, l'app si elle n'était pas abonnée avant).
- D-2 : une adresse propre posée par un autre outil est remplacée et le résultat le dit (domaine seul) ; WABAGENT ne retire jamais une adresse qu'il n'a pas posée.
- P-2 : un compte qui sort d'erreur repasse « Connecté » même si le webhook n'a pas pu être inscrit, avec l'alerte ; titre prudent « Identifiants vérifiés, webhook à contrôler chez Meta. ».
- D-3 : réservation et registre en mémoire acceptés pour R1, au chantier Infra.

Questions d'origine :

| N° | Question | Recommandation du contrôleur |
|---|---|---|
| D-1 (ISO-M3, FR-M2) | Au retrait d'un compte (et au remplacement vers une autre app), faut-il aussi désabonner l'app de la WABA chez Meta (`DELETE /<WABA>/subscribed_apps`) ? Aujourd'hui on retire seulement notre adresse ; l'app reste abonnée et reçoit encore les événements à l'adresse de l'app | Désabonner seulement si le webhook de l'app pointe vers WABAGENT ; ne pas toucher une app qui sert un autre outil |
| D-2 (FR-M6) | Au raccordement, une adresse propre déjà posée sur la WABA par un autre outil du client est remplacée sans le dire (spec §5.1) | Le dire dans le résultat du raccordement (« L'adresse précédente de la WABA pointait vers {domaine} : elle est remplacée par WABAGENT ») |
| D-3 (T-2) | Réservation et registre en mémoire : acceptés pour R1, à reprendre au chantier Infra | Inscrire au chantier Infra |

## E. Reportés (mineurs non corrigés dans R1)

`view()` final non protégé après création (500 rare, compte créé) ; `handOverAppWebhook` sans relecture de la cible avant d'écrire son état ; `markWhatsAppAccountVerified` non gardé par les secrets (code 2b) ; `PUBLIC_BASE_URL` changée qui donne `not_applicable` au lieu de `left` ; `meta_health` jamais effacé ; forme JSON des états non validée champ par champ ; e2e de la boîte CM.com absent (couverte en unitaire) ; faux moteur e2e qui sert encore `GET /webhook` pour Meta.
