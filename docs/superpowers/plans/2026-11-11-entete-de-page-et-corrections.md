# Plan de l'en-tête de page et des corrections de recette

> **Pour les exécutants :** sous-skill requise : superpowers:subagent-driven-development (mode retenu), tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`). Registre du plan : `.superpowers/sdd/2026-11-11-entete-de-page/progress.md` (chaque décision prise en cours d'exécution y est écrite sur une ligne `Ruling:`, avec la tâche et le fichier).

**Objectif :** que chaque page dise où l'on est par un en-tête unique dans le contenu (parents, titre, description, actions, bouton rond de création), sans barre du haut ni redite de l'organisation, et qu'aucun défaut bloquant de la recette du 11 nov. 2026 ne reste avant le merge de `feat/refonte-navigation`.

**Architecture :** un composant `PageHeader` remplace `PageBar` ; les pages le reçoivent par espace (Agents IA, assistant, Organisation, Usage, Mon compte, page réservée), puis `PageBar` est supprimé. Les corrections suivent, groupées par nature : lecture de session en échec (BFF, session, faux moteur), thème sombre et simulateur, présentation de « Ne répond pas », compte WhatsApp en erreur (dont un texte du moteur et la décision de branchement prise par `decideAssign`), organisation suspendue, finitions. Le moteur ne change qu'en un texte de refus de Meta (`src/whatsapp/meta-graph.ts`) ; aucune règle de routage, de droit ni de statut ne change.

**Tech :** Next.js App Router, React, next-intl, Tailwind (jetons de `apps/web/src/app/globals.css` et `apps/web/tailwind.config.ts`), `lucide-react`, Vitest et Testing Library, Playwright sur le faux moteur `apps/web/e2e/mock-engine.ts` et `mock-state.ts` ; contrats `@wabagent/contracts` ; moteur Express et TypeScript pour la seule tâche 8.

**Spec (fait autorité) :** `docs/superpowers/specs/2026-11-11-entete-de-page-et-corrections-design.md`, sections 1 à 7. La section 7 précise et tranche : elle fait foi sur les sections précédentes. Chaque exécutant lit la section citée par sa tâche avant d'écrire une ligne. Maquettes (disposition seulement) : `.superpowers/brainstorm/66011-1794417491/content/fil-ariane-options.html` (option B) et `fil-ariane-toutes-pages.html`.

## Choix du planificateur (contestables, à relire par le PO, puis étapes de la recette)

Ces décisions ne sont ni dans la spec ni dans le code. Les relecteurs de tâche les reçoivent comme contestables, jamais comme acquises.

- **C-1. Composant et repères.** `PageHeader` et `PageContent` dans `apps/web/src/components/shell/page-header.tsx`. La ligne des parents est un `nav` `aria-label="Fil d'Ariane"` (repère gardé pour les lecteurs d'écran et les tests) qui ne contient que des liens, sans `aria-current` ; le titre est le seul `h1` de la page. `data-page-header` sur l'en-tête ; `data-page-action` sur une seule zone qui porte les actions et le bouton rond (spec 6).
- **C-2. Bouton rond.** 44 px, fond `accent`, icône `lucide-react` de l'objet créé (agent IA `Bot`, entité `Store`, utilisateur `UserRound`, compte WhatsApp : glyphe WhatsApp monochrome en SVG en ligne, `currentColor`, composant `WhatsAppGlyph`), petit « + » en exposant en bas à droite de l'icône. Collant : bande de hauteur nulle `sticky top-0` en tête de la zone défilante, bouton aligné sur la ligne du titre au repos. Bulle : `HintBubble` de `coming-soon.tsx`, sous le bouton ; le nom accessible est le texte de la bulle.
- **C-3. Conteneur.** `PageContent` : `px-8 pb-10 pt-7`, pleine largeur, sans `max-w` de page (la page d'un agent IA perd `mx-auto max-w-[1000px]`) ; un formulaire ou un encart garde sa propre largeur de lecture à l'intérieur.
- **C-4. Descriptions des listes d'agents IA.** Toute la liste : « Tous les agents IA · {n agents IA} » ; entité : « Entité · {n agents IA} » ; statut : phrase courte sans point final puis « · {n agents IA} », phrases « Ne répond à personne » (Draft), « Répond seulement aux numéros de la Whitelist » (Preview), « Répond à tous les contacts » (Online), « Ne répond plus, conversations conservées » (Offline) ; « Ne répond pas » : « {n agents IA} ». Entités : phrase existante puis « · {n entités} » une fois lue.
- **C-5. Parents d'un agent IA.** « Agents IA » (lien `/`) puis le nom de son entité (lien `/?entity={id}`). Agent IA sans entité, ou entités illisibles : « Agents IA » seul. `AgentInfo` gagne `entity_id: number | null`.
- **C-6. Sections Soon d'un agent IA (spec 7.4).** Aucune n'a de page (`AGENT_SECTIONS`, `href: null`) : rien à construire. La règle est posée dans la fonction `agentParents()` pour la première qui en aura une.
- **C-7. Retour de l'assistant (spec 3.14, 7.6).** Le bouton rond d'une liste ouvre `/agents/new` suivi de `agentFilterQuery(filtre)` ; l'assistant lit l'origine par `parseAgentFilter` (valeur invalide : toute la liste) ; « Quitter » mène à `'/' + agentFilterQuery(origine)`. Description : « Quitter ramène à la liste « {destination} ». Rien n'est enregistré. », « … Le Draft reste dans la liste. », et en fin « Quitter ramène à la liste « {destination} ». ». `{destination}` est le titre de la liste d'origine : « Agents IA », le nom de l'entité (lu dans les entités de l'organisation, sinon « Agents IA »), le mot du statut, « Ne répond pas ».
- **C-8. Moteur injoignable.** `engineCall` transforme un échec réseau de `fetch` en `EngineError('ENGINE_UNREACHABLE', 'Le moteur ne répond pas.', 503)` ; `BffErrorCode` gagne `'ENGINE_UNREACHABLE'`. Faux moteur : `POST /__unreachable` coupe la connexion de toute route du moteur jusqu'au `__reset`. Sur place, le titre (`h1`) est le message « Impossible de lire votre session pour le moment. », suivi de « Réessayer ». Le cadre neutre vient de `AppRailView` (rail extrait de `AppRail`, sans session) : marque, Aide, Compte (icône, sans initiales ni adresse).
- **C-9. Contrastes du thème sombre.** Test calculé (WCAG 2.1) dans `theme-tokens.test.ts` : textes `fg`, `muted`, `muted-2`, `accent-ink` au moins 4,5:1 sur `surface`, `surface-subtle` et `bg` sombres. Valeurs avec `#03130e` (remplacé le 12 nov. 2026 par `#0f251d`, choix de François : `muted-2` y fait 5,74:1 sur `surface`) : `muted-2` 5,83:1 sur `surface`, 5,47:1 sur `bg`, mais 4,31:1 sur `surface-subtle` (`#16302A`, déjà vrai aujourd'hui) : exception écrite dans le test, à trancher par François (garder, ou éclaircir `muted-2` sombre). `--loader-1` passe à 3,57:1 sur `surface`, commentaire mis à jour. Remarque pour la recette : `#03130e` est plus sombre que `--bg` (`#0C1A15`), les boîtes sont donc plus foncées que le fond.
- **C-10. Gris d'Offline.** Jetons `--offline-soft` (clair `#ECEFED`, sombre `#1F2925`) et `--offline-ink` (clair `#5B6660`, sombre `#B3BDB8`), reliés à Tailwind (`offline.soft`, `offline.ink`), couverts par le test de contraste ; `STATUS_STYLE.paused` : `bg-offline-soft text-offline-ink`, point `bg-offline-ink`.
- **C-11. Marques de « Ne répond pas ».** Point rouge de 8 px (`bg-danger`, liseré `surface`) en haut à droite de la pastille de statut, porté par un `button` sans autre effet dont la bulle dit le motif. Motif `empty_allowlist` : à la place, étiquette neutre « Whitelist vide » (`border border-border-strong bg-surface text-muted`) dont la bulle dit l'invitation. Santé : étiquette `danger-soft` « Ne répond pas » dans l'en-tête du panneau, étiquette neutre « Whitelist vide » pour `empty_allowlist`.
- **C-12. Bandeau d'un compte en erreur (correction 6).** Textes : « La dernière vérification du compte a échoué. » (au lieu de « Le compte est en erreur. ») ; cause `credentials` et motifs `token_invalid`, `signature_rejected` : conseil suivi de « Vérifiez de nouveau ; si cela continue, remplacez les identifiants. » ; cause inconnue : « Vérifiez de nouveau pour connaître le motif. » ; `support` et `reconnect` gardent leur conseil. Bouton « Vérifier maintenant » dans le bandeau, aux mêmes conditions que l'entrée du menu « Gérer », qui reste. Ton du bandeau inchangé (danger). Bandeau de Connexions seulement, pas l'encart Numéro de la page de l'agent IA.
- **C-13. Identifiant qui n'est pas un WABA.** Texte du moteur, dans `src/whatsapp/meta-graph.ts` (texte seulement, aucune règle) : erreur Meta code 100 dont le message contient « nonexisting field » et « subscribed_apps » : contrôle `waba_access` en échec, « Cet identifiant n'est pas celui d'un compte WhatsApp Business (WABA). Reprenez l'identifiant du compte WhatsApp Business dans le Gestionnaire WhatsApp, pas celui d'un numéro ni de l'app. », non transitoire, `provider_text` gardé.
- **C-14. Décision de branchement à l'écran.** `assignRefusal()` dans `apps/web/src/lib/assign-choice.ts` appelle `decideAssign` des contrats avec : détenteur attendu = détenteur lu par l'écran, `currentNumberId: null`, `allowlistCount: 0` (sans effet : pour un agent IA en service, `decideTransition` part de son propre statut), `checkServingStatus: true`. Dans l'assistant, l'agent IA est Draft à l'étape 4 : les numéros d'un compte en erreur deviennent choisissables, l'étape 5 garde son refus annoncé (`blockedAccount`).
- **C-15. Bandeau de suspension (spec 7.2).** `/api/auth/me` gagne `refused_client_id: string | null` : l'organisation du cookie quand elle n'est pas ouvrable et que le BFF en a ouvert une autre (ou aucune). Un refus de `switchOrg` pour suspension ferme le menu et pose le bandeau (au lieu du message dans le menu, pour ne pas dire deux fois la même chose). Texte pour un administrateur de cette organisation : « {org} est suspendue. Contactez le support. »
- **C-16. Monogrammes.** Retirés du bloc Organisation (spec 2.3) et aussi des lignes du menu d'organisation (note de recette 5.2).
- **C-17. Bulles du rail.** Deux lignes : le nom en gras, puis une phrase. Organisation « Entités, utilisateurs, connexions et réglages. », Agents IA « La liste et la page de chaque agent IA. », Usage « Coûts des agents IA de l'organisation. », Compte « Vos organisations, préférences et sécurité. » ; Leads, Reprise, Aide gardent leur phrase actuelle. La marque n'a pas de bulle.
- **C-18. Moyenne par jour (D-91).** `perDayAverage(totalUsd: number, days: number): number` dans `apps/web/src/lib/period.ts` ; la carte de la page d'un agent IA divise par 30 (sa période, « 30 derniers jours »), les pages d'usage par la période choisie.
- **C-19. Liste des agents IA cliquable.** Lien étiré : le nom reste le seul lien (clavier, lecteur d'écran), son `::after` couvre la ligne, flèche comprise ; tout autre élément actif de la ligne passe au-dessus (`relative z-10`).
- **C-20. Retour en haut.** `AppFrame` remet sa zone défilante en haut à chaque changement de chemin ou de requête ; un changement d'étape de l'assistant fait de même.

## Contraintes globales

- Règles non négociables de `CLAUDE.md` : multi-organisations, journaux `[Service] message` sans donnée sensible (`npm run check:logs`), aucun repli sur des identifiants de plateforme.
- Aucun fichier de `src/webhooks/`, `src/transport/`, `src/core/router.ts` ne change ; dans `src/whatsapp/`, seul le texte de la tâche 8 (C-13). Codes moteur des statuts inchangés (`draft`, `limited`, `active`, `paused`). `decideResponding` et le test d'équivalence avec `checkRoute` ne changent pas (spec 7.1).
- Le nom d'une entité affiché vient de la liste des entités de l'organisation ouverte, jamais d'un paramètre d'adresse ; une entité inconnue donne « Entité indisponible » (D-104, spec 5).
- Le bouton rond et « Simuler » suivent exactement les conditions des boutons qu'ils remplacent (spec 2.4) ; une action n'apparaît jamais deux fois (spec 7.5).
- Le web ne recalcule jamais « Ne répond pas » : il lit `not_responding` par `shownNotRespondingReason` ; un refus se lit par `describeFailure`.
- Charte : jetons seulement, menthe en accent, aucun dégradé, aucune couleur en dur nouvelle dans un composant. Pas de version mobile (spec 4).
- Textes : français avec tous les accents ; aucun tiret cadratin ni demi-cadratin nulle part, code et commentaires compris ; « agent IA », jamais « agent » seul ; Draft, Preview, Online, Offline, Whitelist, New, Soon avec majuscule, jamais accordés ; en anglais Whitelist se dit Allowlist ; FR et EN ont les mêmes clés (`apps/web/src/i18n/__tests__/messages-style.test.ts`).
- Appels côté client : `apiFetch` / `sendMutation` puis `if (await isOrgChanged(res)) return;`. Routes BFF : `engineFetch`, `errorResponse`.
- Tests HTTP moteur : `request(await serve(app))` ; tests de base : `createTestDatabase()`. Un test qui protège un point de la section 5 de la spec porte `// entête 5` ; un test qui protège une correction, son numéro (`// recette 3.7`).
- Le faux moteur reproduit chaque comportement du moteur ou du BFF dont dépend un parcours, dans la tâche qui le crée.
- Commandes selon la portée : web `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web` (parcours e2e compris), `npm run check:logs` ; toute tâche qui touche l'interface ou le faux moteur : `npm run test:e2e -w @wabagent/web`, entièrement vert ; moteur ou contrats : `npm test`, `npm run test:pg`, `npm run typecheck`, `npm run typecheck:tests`, `npm run check:tests`. Un parcours e2e cassé par l'en-tête est réécrit sur la nouvelle interface sans retirer d'assertion de comportement.
- Commits : 1 commit = 1 sujet, message en français `type(portée): résumé` puis corps factuel ; auteur `Francois Greze <francois@cyran.fr>` ; aucune signature Claude ou Anthropic ; aucun push ni merge sans accord explicite de François.

## Points d'attention de la revue

Cas que la spec implique sans les tester ; chacun a son test dans la tâche citée.

1. Nom d'entité ou d'agent IA de 80 caractères dans les parents et le titre : tronqué sur une ligne avec le nom entier en `title`, jamais sous le bouton rond ni sur les actions. Tâche 1.
2. Page longue défilée : le bouton rond reste visible et cliquable, l'ordre du clavier passe par lui juste après le titre, rail et colonne restent à pleine hauteur. Tâche 1.
3. Entité archivée ou d'une autre organisation dans l'adresse (`/?entity=`, `/agents/new?entity=`, `/usage?entity=`) : « Entité indisponible » ou parents sans entité, aucun nom d'une autre organisation, champ Entité de l'assistant non prérempli. Tâches 2, 3 et 4.
4. Moteur injoignable pendant une écriture (bouton d'une page) : refus « serveur » à l'endroit de l'action avec le texte de l'action, jamais un renvoi vers la connexion ni la perte du cadre. Tâche 5.
5. Organisation changée dans un autre onglet pendant que la session est illisible, puis « Réessayer » : rechargement complet, jamais l'ancien cadre avec les données de la nouvelle organisation. Tâche 5.

## Impact multi-organisation

| Changement | Ce qui pourrait fuir ou mal répondre | Test qui l'empêche (tâche) |
|---|---|---|
| Parents et titres nommant une entité | Nom d'une entité d'une autre organisation lu d'un paramètre d'adresse | Liste, assistant et usage filtrés sur l'entité 2 (Atelier Nord, c2) avec l'admin de c1 : aucun « Atelier » dans le contenu, « Entité indisponible » (2, 3, 4) |
| Bouton rond | Création proposée à qui n'a pas le droit | Par rôle : admin le voit, conseiller non, organisation en lecture seule non (2, 4) |
| Branchement sur un compte en erreur | Règle d'écran recopiée qui diverge du moteur, ou numéro d'une autre organisation proposé | Équivalence de `assignRefusal` avec `decideAssign` sur la matrice des faits, garde statique des écrans ; listes lues dans l'organisation ouverte seulement (8) |
| Session illisible | Cadre ou bandeau d'une organisation d'une session précédente | Premier chargement en échec : aucun nom d'organisation, aucun bandeau relu du stockage ; session déjà lue : seule l'organisation de cet onglet, aucune donnée de page (5) |
| Bandeau de suspension | Bandeau qui nomme une organisation ouverte, ou une autre organisation que celle tentée | `reloadNotice` et `handleOrgError` ne posent jamais `suspended` pour une organisation ouvrable ; `refused_client_id` lu pour l'utilisateur du jeton seulement (9) |

## Carte des fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `apps/web/src/components/shell/page-header.tsx` (nouveau) | `PageHeader`, `PageContent`, `CreateButton`, `WhatsAppGlyph` | 1 |
| `apps/web/src/components/shell/{app-frame,app-rail}.tsx` | hauteur pleine, retour en haut, `AppRailView`, bulles | 1, 5, 10 |
| `apps/web/src/components/shell/page-bar.tsx` | supprimé | 4 |
| `apps/web/src/app/[locale]/(app)/page.tsx`, `components/agents/*` | liste des agents IA | 2, 7, 10 |
| `apps/web/src/app/[locale]/(app)/agents/[botId]/**`, `components/agent/*` | page et usage d'un agent IA, simulateur | 2, 6, 7, 10 |
| `apps/web/src/components/wizard/*`, `agents/new/page.tsx` | assistant | 3, 6, 8 |
| `apps/web/src/app/[locale]/(app)/{organisation,usage,account}/**`, `components/{organisation,connections,usage}/*`, `components/shell/{reserved-page,org-block,middle-column}.tsx` | autres pages, colonne | 4, 8, 9 |
| `apps/web/src/lib/engine-client.ts`, `app/api/auth/me/route.ts`, `components/providers/session-provider.tsx`, `components/shell/session-unreadable.tsx` (nouveau), `app/[locale]/no-organization/page.tsx` | session illisible, suspension | 5, 9 |
| `apps/web/src/app/globals.css`, `tailwind.config.ts`, `src/lib/__tests__/theme-tokens.test.ts` | thème sombre, contrastes, gris d'Offline | 6 |
| `apps/web/src/lib/{assign-choice,period,status-words,org-notice}.ts` | décisions et règles d'écran | 7, 8, 9, 10 |
| `src/whatsapp/meta-graph.ts` | texte « pas un WABA » | 8 |
| `packages/contracts/src/bot-status.ts` | commentaires au vocabulaire | 10 |
| `apps/web/e2e/{mock-engine,mock-state,helpers}.ts`, `apps/web/e2e/*.spec.ts` | faux moteur, parcours | 1 à 10 |
| `apps/web/messages/{fr,en}.json` | textes | 1 à 10 |
| `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/superpowers/research/2026-11-11-recette-refonte-navigation.md` | état, contrats, recette | 12 |

---

### Tâche 1 : composant d'en-tête de page et cadre (spec 2.1, 2.4, 3.10, 3.14, 6)

**Fichiers :**
- Créer : `apps/web/src/components/shell/page-header.tsx`, `apps/web/src/components/shell/__tests__/page-header.test.tsx`.
- Modifier : `apps/web/src/components/shell/app-frame.tsx`, `apps/web/src/components/shell/__tests__/frame-assertions.ts` (constats de l'en-tête), `apps/web/e2e/helpers.ts`, `apps/web/messages/{fr,en}.json` (`shell.pageHeader`).
- Tests : `page-header.test.tsx`, `apps/web/src/components/shell/__tests__/app-frame.test.tsx` (nouveau), `apps/web/e2e/navigation.spec.ts`.

**Interfaces :**
- Produit :
  - `export interface ParentCrumb { label: string | null; href: string }` (label nul : squelette).
  - `export type CreateIcon = 'agent' | 'entity' | 'user' | 'whatsapp'`.
  - `export type CreateAction = { label: string; icon: CreateIcon } & ({ href: string } | { onClick: () => void })` : lien, ou ouverture de la fenêtre que l'ancien bouton ouvrait (Entités, Utilisateurs).
  - `export function PageHeader(props: { parents?: ParentCrumb[]; title: ReactNode; titleAside?: ReactNode; description?: ReactNode; actions?: ReactNode; create?: CreateAction | null }): JSX.Element` : parents absents ou vides, pas de `nav` ; séparateur « › » ; titre `h1` tronqué, texte entier en `title` quand c'est une chaîne ; `actions` et `create` dans la zone `data-page-action`, alignée sur le bord droit du contenu ; `create` nul ou absent, pas de bouton (C-1, C-2).
  - `export function PageContent({ children }: { children: ReactNode }): JSX.Element` (C-3).
  - `export function WhatsAppGlyph(props: { className?: string }): JSX.Element`.
  - `AppFrame` : rail et colonne à pleine hauteur au défilement (seule la zone de contenu défile, jamais le document), zone remise en haut à chaque changement de chemin ou de requête (C-20) ; la zone défilante porte `data-page-scroll`.
  - e2e (`helpers.ts`) : `pageHeader(page): Locator` (`[data-page-header]`), `pageActionNames(page): Promise<string[]>` (nom accessible de chaque lien et bouton de `[data-page-action]`, dans l'ordre), `headerParents(page): Locator` (liens du `nav` « Fil d'Ariane »).
  - `navigation.spec.ts` : nouveau tableau `HEADER_PAGES: { url: string; parents: string[]; title: string; actions: string[]; space: string | null }[]`, vide ici ; les tâches 2 à 4 y déplacent les pages de `ADMIN_PAGES`, que la tâche 4 supprime.

- [ ] **Étape 1 : tests du composant** `page-header.test.tsx` : sans `parents`, aucun `nav` « Fil d'Ariane » ; avec deux parents, deux liens séparés par « › », aucun `aria-current` ; parent à label nul, squelette sans lien ; un seul `h1` ; titre de 80 caractères avec `title` et classe de troncature (point d'attention 1) ; `create` avec `href` : lien vers `href` ; avec `onClick` : bouton qui l'appelle ; dans les deux cas nom accessible `label`, bulle `role="tooltip"` au survol et au focus avec le même texte, icône de l'objet et « + » ; `create={null}` : rien ; `actions` et bouton rond dans la même zone `data-page-action`, bouton rond en dernier dans l'ordre du clavier.
- [ ] **Étape 2 : tests du cadre** `app-frame.test.tsx` : changement de chemin, puis de requête seule, remet `scrollTop` de `[data-page-scroll]` à 0 ; le rail et la colonne sont hors de la zone défilante.
- [ ] **Étape 3 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`.
- [ ] **Étape 4 : e2e** : helpers ajoutés ; un parcours dans `navigation.spec.ts` (`// recette 3.10`) : fenêtre 1280 × 600, page `/fr/agents/demo-1`, zone défilée jusqu'en bas : la boîte du rail fait la hauteur de la fenêtre et `document.scrollingElement.scrollTop` reste 0 ; clic sur « Usage et coûts » dans la colonne, la zone est en haut. `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 5 : commit** `feat(web): en-tête de page unique et cadre à pleine hauteur`.

### Tâche 2 : en-tête des listes d'agents IA, de la page et de l'usage d'un agent IA (spec 2.2, 7.4, 7.5, 3.10)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/page.tsx`, `apps/web/src/app/[locale]/(app)/agents/[botId]/{layout,page}.tsx`, `agents/[botId]/usage/page.tsx`, `apps/web/src/components/agent/{agent-context,overview,usage-view}.tsx`, `apps/web/messages/{fr,en}.json` (`agents.header`), `apps/web/e2e/{navigation,agent-space,onboarding}.spec.ts` touchés.
- Créer : `apps/web/src/components/agent/agent-parents.ts`.
- Tests : `apps/web/src/app/[locale]/(app)/__tests__/home.test.tsx`, `agents/[botId]/__tests__/agent-pages.test.tsx`, `agents/[botId]/__tests__/agent-layout.test.tsx`.

**Interfaces :**
- Consomme : `PageHeader`, `PageContent`, `ParentCrumb`, `CreateAction` (tâche 1) ; `AgentStatusLine` (`components/agents/agent-status-line.tsx`, modifié en tâche 7 sans changer sa signature).
- Produit :
  - `AgentInfo` gagne `entity_id: number | null` (C-5).
  - `agentParents(info: AgentInfo | null, entitiesLoaded: boolean, extra?: ParentCrumb): ParentCrumb[]` dans `agent-parents.ts` : chargement, `[Agents IA, squelette]` ; entité connue, `[Agents IA, {entité}]` ; sinon `[Agents IA]` ; `extra` ajouté à la fin (nom de l'agent IA pour l'usage, C-6).
  - Liste : titres, descriptions et boutons ronds du tableau 2.2 et de la spec 7.4 (C-4) ; libellé « Créer un agent IA dans {entité} » sur une entité ; `href` du bouton rond `/agents/new` suivi de `agentFilterQuery(filter)` (C-7) ; entité inconnue (entités lues, identifiant absent des entités actives) : parents « Agents IA », titre « Entité indisponible », liste vide et lien « Voir tous les agents IA » vers `/`, fin du repli silencieux sur toute la liste ; premier lancement (`FirstRun`) : pas de bouton rond (spec 7.5).
  - Page d'un agent IA : parents `agentParents`, titre nom avec `AgentStatusLine` en `titleAside`, description les langues de la santé (rien si la santé a échoué), action « ▶ Simuler » (mêmes conditions qu'aujourd'hui) ; chargement : squelettes ; lecture échouée : titre « Agent IA indisponible », parents « Agents IA ». `Overview` ne rend plus de titre ni de ligne Entité, et plus de `max-w`.
  - Usage d'un agent IA : parents `agentParents(info, loaded, { label: nom, href: /agents/{id} })`, titre « Usage et coûts », description `usage.periodRange`, action `PeriodChoice`.

- [ ] **Étape 1 : tests de la liste** `home.test.tsx` : pour chaque filtre (tous, entité, statut, « Ne répond pas »), parents, titre, description et bouton rond attendus ; « Créer un agent IA dans Boutique Paris » mène à `/agents/new?entity=1`, celui de `?status=limited` à `/agents/new?status=limited` ; conseiller, puis organisation `read_only`, aucun bouton rond (`// entête 5`) ; `FirstRun` sans bouton rond ; `?entity=2` alors que `/api/entities` ne renvoie que l'entité 1 : titre « Entité indisponible », aucun nom d'entité dans le contenu, liste vide, lien vers `/` (`// entête 5`, point d'attention 3).
- [ ] **Étape 2 : tests des pages d'un agent IA** `agent-pages.test.tsx` et `agent-layout.test.tsx` : parents « Agents IA › Boutique Paris » liés à `/` et `/?entity=1` ; agent IA sans entité, « Agents IA » seul ; titre et pastille ; description « FR » ; lecture échouée, « Agent IA indisponible » ; usage : parents à trois éléments, titre « Usage et coûts », choix de période dans la zone d'action.
- [ ] **Étape 3 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`.
- [ ] **Étape 4 : e2e** : entrées `/fr`, `/fr?entity=1`, `/fr?status=active`, `/fr/agents/demo-1`, `/fr/agents/demo-1/usage` déplacées dans `HEADER_PAGES` ; nouveau parcours (`// entête 5`) : `demo@` sur `/fr?entity=2` (entité d'Atelier Nord) voit « Entité indisponible » et `page.locator('main')` ne contient pas « Atelier » ; défilement de la liste, bouton rond toujours dans la fenêtre (`toBeInViewport`, point d'attention 2). `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 5 : commit** `feat(web): en-tête des listes et des pages d'agents IA`.

### Tâche 3 : en-tête et sortie de l'assistant (spec 2.2, 3.8, 3.14, 7.4, 7.6)

**Fichiers :**
- Modifier : `apps/web/src/components/wizard/{wizard,wizard-column}.tsx`, `apps/web/src/app/[locale]/(app)/agents/new/page.tsx`, `apps/web/messages/{fr,en}.json` (`wizard.bar`, encadré D-125), `apps/web/e2e/{navigation,onboarding,activation}.spec.ts` touchés.
- Tests : `apps/web/src/components/wizard/__tests__/wizard.test.tsx`, `apps/web/src/app/[locale]/(app)/agents/new/__tests__/*`.

**Interfaces :**
- Consomme : `PageHeader`, `PageContent` (tâche 1) ; `parseAgentFilter`, `agentFilterQuery` (`lib/agents-filter.ts`).
- Produit :
  - `Wizard({ initialEntityId, origin }: { initialEntityId: number | null; origin: AgentFilter })` ; la page lit `origin = parseAgentFilter(searchParams)` ; `initialEntityId` seulement si `origin.kind === 'entity'`.
  - En-tête : parents « Agents IA » (lien `'/' + agentFilterQuery(origin)`) puis l'entité choisie à l'étape 1 (nom lu dans les entités de l'organisation, lien `/?entity={id}`), mis à jour quand elle change ; sans entité choisie, « Agents IA » seul ; titre « Créer un agent IA » ; description C-7 selon l'état (rien, Draft, fin) ; action « ✕ Quitter ».
  - `quit()` mène à `'/' + agentFilterQuery(origin)` après la confirmation existante.
  - Chaque changement d'étape remet la zone défilante (`[data-page-scroll]`) en haut (C-20, correction 14).
  - Encadré de l'étape 2 (D-125) : « « {name} » est dans la liste des agents IA, en Draft. Vos dernières modifications ne sont pas encore enregistrées : elles sont enregistrées par « Créer et tester » ou en passant à l'étape suivante. »

- [ ] **Étape 1 : tests** `wizard.test.tsx` : ouvert avec `origin` entité 1, parents « Agents IA › Boutique Paris », champ Entité prérempli ; entité changée à l'étape 1, parents mis à jour ; `origin` statut Preview, parents « Agents IA », « Quitter » puis confirmation mène à `/?status=limited` ; description « Quitter ramène à la liste « Preview ». Rien n'est enregistré. », puis après création « … Le Draft reste dans la liste. » ; passage de l'étape 1 à l'étape 2 avec la zone défilée, zone remise en haut ; adresse `?entity=abc&status=bogus` : origine toute la liste, parents « Agents IA » ; `?entity=2` hors de l'organisation : champ non prérempli, parents « Agents IA », aucun nom d'une autre organisation (`// entête 5`, point d'attention 3) ; texte de l'encadré D-125.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`.
- [ ] **Étape 3 : e2e** : `/fr/agents/new` déplacée dans `HEADER_PAGES` (actions `['✕ Quitter']`) ; parcours (`// recette 3.14`) : depuis `/fr?entity=1`, bouton rond, « Quitter », retour sur `/fr?entity=1`. `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 4 : commit** `feat(web): en-tête de l'assistant et retour à la liste d'origine`.

### Tâche 4 : en-tête des pages Organisation, Usage, Mon compte et réservée ; colonne ; retrait de PageBar (spec 2.2, 2.3, 3.14, 7.4, 7.5)

**Fichiers :**
- Modifier : `apps/web/src/app/[locale]/(app)/organisation/{entites,utilisateurs,connexions,connexions/raccorder,reglages}/page.tsx`, `usage/page.tsx`, `account/{organisations,preferences,securite}/page.tsx`, `apps/web/src/components/shell/{reserved-page,org-block,middle-column}.tsx`, `apps/web/src/components/organisation/organisation-rail.tsx`, `apps/web/src/components/agent/agent-rail.tsx`, `apps/web/messages/{fr,en}.json`, `apps/web/e2e/*.spec.ts` touchés, `apps/web/e2e/helpers.ts`.
- Supprimer : `apps/web/src/components/shell/page-bar.tsx`, `__tests__/page-bar.test.tsx`, l'aide e2e `pageBar` et le tableau `ADMIN_PAGES`.
- Tests : `organisation-space.test.tsx`, `organisation/connexions/__tests__/page.test.tsx`, `usage/__tests__/usage-page.test.tsx`, `account.test.tsx`, `reserved-page.test.tsx`, `org-block.test.tsx`, `middle-column.test.tsx`.

**Interfaces :**
- Consomme : `PageHeader`, `PageContent`, `CreateAction`, `WhatsAppGlyph` (tâche 1).
- Produit :
  - Boutons ronds : Entités « Nouvelle entité » (`entity`), Utilisateurs « Inviter un utilisateur » (`user`), Connexions « Raccorder un compte WhatsApp » (`whatsapp`, masqué sans compte comme aujourd'hui) ; conditions de droit identiques aux boutons actuels ; masqué quand l'encart vide porte l'action (spec 7.5). Le bouton rond d'Entités et d'Utilisateurs ouvre la même fenêtre que l'ancien bouton (`CreateAction` avec `onClick`).
  - Usage : toute l'organisation, titre « Usage et coûts », description « Toute l'organisation · {période} » ; par entité, parents « Usage et coûts » (lien `/usage`), titre {entité}, description « Entité · {période} » ; entité inconnue, « Entité indisponible » ; action `PeriodChoice`.
  - Raccorder : parents « Connexions » (lien `/organisation/connexions`). Réglages : « Règles qui s'appliquent à tous les membres de l'organisation {name}. » (correction 14).
  - `ReservedPage` : titre « Page réservée aux administrateurs », sans parents.
  - Colonne : `OrgBlock` sans monogramme (C-16), lignes du menu sans monogramme ; `OrganisationRail` sans `kicker` ; lien de la colonne d'un agent IA vers Connexions rendu en encart bordé en bas de colonne (« Numéros WhatsApp de l'organisation », « Ouvrir Connexions ↗ »), mêmes conditions d'affichage qu'aujourd'hui.

- [ ] **Étape 1 : tests de pages** : pour chaque page de la liste, titre, description, parents (aucun hors Raccorder et usage par entité) et zone d'action du tableau 2.2 ; bouton rond par rôle (admin oui, conseiller sur le refus sur place, `read_only` non, `// entête 5`) ; Connexions sans compte : pas de bouton rond, l'encart vide garde son action ; `/usage?entity=2` hors de l'organisation : « Entité indisponible », aucun nom d'une autre organisation (`// entête 5`) ; Réglages, texte exact ; page réservée, titre exact.
- [ ] **Étape 2 : tests de la colonne** : `org-block.test.tsx`, aucun monogramme dans le bloc ni dans le menu ; colonne Organisation sans libellé « Organisation » au-dessus des entrées ; encart Connexions de la colonne d'un agent IA, lien vers `/organisation/connexions`.
- [ ] **Étape 3 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`, `grep -rn "PageBar\|pageBar(" apps/web/src apps/web/e2e` vide.
- [ ] **Étape 4 : e2e** : toutes les pages restantes dans `HEADER_PAGES` (Mon compte compris, `space: 'account'`, sans bloc Organisation) ; `ADMIN_PAGES` supprimé ; aucun parcours ne cherche plus le nom de l'organisation dans un fil. `npm run test:e2e -w @wabagent/web` vert, `git diff --stat main -- apps/web/e2e` relu : chaque assertion retirée a son remplaçant cité au rapport.
- [ ] **Étape 5 : commits** `feat(web): en-tête des pages Organisation, Usage et Mon compte` puis `refactor(web): retrait de la barre du haut`.

### Tâche 5 : lecture de session en échec (spec 3.1, 5, 7.3)

**Fichiers :**
- Modifier : `apps/web/src/lib/engine-client.ts`, `apps/web/src/components/providers/session-provider.tsx`, `apps/web/src/components/shell/app-rail.tsx`, `apps/web/src/app/[locale]/no-organization/page.tsx` (si la cause l'exige), `apps/web/e2e/mock-engine.ts`, `apps/web/e2e/helpers.ts`, `apps/web/messages/{fr,en}.json`.
- Créer : `apps/web/src/components/shell/session-unreadable.tsx`, `apps/web/e2e/session-unreadable.spec.ts`.
- Tests : `apps/web/src/lib/__tests__/engine-client.test.ts`, `apps/web/src/app/api/auth/__tests__/me.test.ts`, `apps/web/src/components/providers/__tests__/session-provider.test.tsx`, `apps/web/src/components/shell/__tests__/app-rail.test.tsx`.

**Interfaces :**
- Produit :
  - `BffErrorCode = ErrorCode | 'ORG_CHANGED' | 'ENGINE_UNREACHABLE'` ; `engineCall` : échec de `fetch` (rejet, pas une réponse HTTP) donne `EngineError('ENGINE_UNREACHABLE', 'Le moteur ne répond pas.', 503)`, journal `[BFF] moteur injoignable` sans URL ni jeton (C-8).
  - `AppRailView({ active, withOrg, isAdmin, account }: { active: Space | null; withOrg: boolean; isAdmin: boolean; account: { email: string; platform: boolean } | null })` ; `AppRail` la rend à partir de la session ; `account` nul : entrée Compte avec icône `UserRound` et libellé « Compte ».
  - `SessionUnreadable({ frame, onRetry, retrying }: { frame: 'session' | 'neutral'; onRetry: () => void; retrying: boolean })` : `h1` « Impossible de lire votre session pour le moment. », bouton « Réessayer », indisponible avec « Lecture en cours. » pendant la relecture (D-109) ; `session` : rail, colonne réduite au bloc Organisation de la session déjà lue ; `neutral` : `AppRailView` sans organisation, colonne vide.
  - `SessionProvider` : état `{ status: 'error'; last: MeResponse | null }`. Lecture en échec après une session lue : `last` = cette session, le contexte reste celui de `last`, les pages (enfants) ne sont pas rendues, la liaison d'`apiFetch` reste celle de `last`. Premier chargement en échec : `last` nul, aucun contexte, aucun bandeau. « Réessayer » réussi : même organisation active, enfants rendus ; autre organisation active, `reloadChanged(next, activeOrgOf(last))`.
  - Faux moteur : `POST /__unreachable` (C-8) ; aide e2e `makeEngineUnreachable(request)`.

- [ ] **Étape 1 : reproduire** le défaut de recette (lignes « RECETTE 5.3 » et « RECETTE 11 » du registre de la refonte) dans `session-unreadable.spec.ts` avec `/__unreachable` : navigation depuis la liste, puis rechargement de `/fr/no-organization` ; écrire la cause trouvée au registre (`Ruling:`).
- [ ] **Étape 2 : tests unitaires** : `engine-client.test.ts`, `fetch` rejeté donne `ENGINE_UNREACHABLE` 503 ; `me.test.ts`, `/api/auth/me` répond 503 `ENGINE_UNREACHABLE`, jamais 500 (`// recette 3.1`) ; `session-provider.test.tsx` : premier chargement en échec, aucun nom d'organisation, aucun bloc Organisation, aucun bandeau même avec un message `wab_org_notice` en stockage (`// entête 5`) ; session lue puis `refresh()` en échec, bloc Organisation de cette session, enfants absents, message et « Réessayer » ; « Réessayer » réussi sur la même organisation, enfants rendus ; sur une autre, `window.location.assign` appelé, jamais l'ancien cadre rendu avec la nouvelle organisation (point d'attention 5) ; `app-rail.test.tsx`, `AppRailView` sans compte : marque, Aide, Compte.
- [ ] **Étape 3 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`, `npm run check:logs`.
- [ ] **Étape 4 : e2e** `session-unreadable.spec.ts` : moteur coupé pendant la navigation, rail et colonne visibles, pas d'écran « Une erreur est survenue. » ; `/fr/no-organization` rechargé moteur coupé, « Impossible de lire votre session pour le moment. » puis « Réessayer » après `__reset`, texte de la page relu ; écriture pendant la coupure (renommer une entité) : refus à l'endroit de l'action avec le texte de l'action, URL inchangée, pas de page de connexion (point d'attention 4). `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 5 : commit** `fix(web): moteur injoignable, session illisible sur place et cadre gardé`.

### Tâche 6 : thème sombre, contrastes et simulateur (spec 3.2, 3.3, 3.11 pour Offline)

**Fichiers :**
- Modifier : `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/src/components/agents/status-style.ts`, `apps/web/src/components/agent/{simulate-panel,simulate-chat,recent-conversations}.tsx`, `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx` (nom passé au simulateur), `apps/web/src/components/wizard/step-test.tsx`, `apps/web/messages/{fr,en}.json` (`overview.simulate`, `simulate.online`).
- Tests : `apps/web/src/lib/__tests__/theme-tokens.test.ts`, `apps/web/src/components/agent/__tests__/simulate-panel.test.tsx`, `simulate-chat.test.tsx`, `recent-conversations.test.tsx`, `apps/web/src/components/agents/__tests__/status-pill.test.tsx`, `apps/web/src/components/wizard/__tests__/step-test.test.tsx`.

**Interfaces :**
- Produit :
  - `.dark { --surface: #03130e; }` (valeur validée par François, remplacée le 12 nov. 2026 par `#0f251d`, son choix après la recette à l'écran) ; commentaires de contraste réécrits avec les valeurs recalculées par le test (C-9).
  - Jetons `--offline-soft`, `--offline-ink` (C-10) ; `STATUS_STYLE.paused` les utilise.
  - `SimulatePanel({ botId, agentName, onClose }: { botId: string; agentName: string; onClose: () => void })` : titre « Simuler {agentName} » (clé `overview.simulate`, ajoutée en FR et EN), en-tête du fil au nom de l'agent IA ; `simulate.online` devient « Simulation » ; bulles : agent IA `bg-surface text-fg border border-border`, contact `bg-accent-soft text-fg`, échec inchangé.
  - Bandeau « Simulation » de l'étape 3 : `text-fg` sur `bg-surface-subtle` ; initiales des Dernières conversations : `text-fg` sur `bg-surface-subtle`.

- [ ] **Étape 1 : test de contraste** dans `theme-tokens.test.ts` : fonction locale `contrastRatio(a: string, b: string): number` (WCAG 2.1, luminance relative) ; valeurs lues dans le bloc `.dark` (et `:root` pour les jetons non redéfinis) ; `--surface` sombre vaut `#03130e` (`// recette 3.3`) ; chaque texte `fg`, `muted`, `muted-2`, `accent-ink` au moins 4,5:1 sur `surface`, `surface-subtle`, `bg` sombres, exception nommée `muted-2` sur `surface-subtle` (C-9) ; `offline-ink` sur `offline-soft` au moins 4,5:1 dans les deux thèmes ; Offline n'a plus de fond `surface-subtle`.
- [ ] **Étape 2 : tests du simulateur** : titre « Simuler Support technique », jamais « overview.simulate » ; en-tête au nom de l'agent IA, jamais « ? » ; « Simulation » sans « en ligne » ; aucune classe `bg-white` dans `simulate-chat.tsx` (`// recette 3.2`) ; bandeau de l'étape 3 et initiales sans `text-brand-deep` ni `text-brand` sur `bg-surface-subtle` (`// recette 3.3`).
- [ ] **Étape 3 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`, `grep -rn "#[0-9a-fA-F]\{6\}" apps/web/src/components` sans nouvelle occurrence.
- [ ] **Étape 4 : e2e** : parcours du simulateur existant mis à jour (titre, en-tête) ; capture du simulateur en thème sombre jointe au rapport. `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 5 : commits** `fix(web): thème sombre, surface validée et contrastes vérifiés par test` puis `fix(web): simulateur, titre, nom de l'agent IA et bulles lisibles`.

### Tâche 7 : « Ne répond pas » en point rouge, Whitelist vide en état neutre (spec 3.4, 3.5, 7.1)

**Fichiers :**
- Modifier : `apps/web/src/lib/status-words.ts`, `apps/web/src/components/agents/{agent-status-line,not-responding-mention,status-pill}.tsx`, `apps/web/src/components/agent/{health-panel,status-panel,agent-rail}.tsx`, `apps/web/src/components/connections/numbers-table.tsx`, `apps/web/messages/{fr,en}.json`, `apps/web/e2e/navigation.spec.ts` (mention aux cinq endroits).
- Tests : `apps/web/src/lib/__tests__/status-words.test.ts`, `components/agents/__tests__/{agent-status-line,not-responding-mention}.test.tsx`, `components/agent/__tests__/{health-panel,status-panel}.test.tsx`, `apps/web/src/lib/__tests__/agents-filter.test.ts`.

**Interfaces :**
- Produit :
  - `mentionTone(reason: NotRespondingReason): 'danger' | 'neutral'` (`status-words.ts`) : `empty_allowlist` donne `neutral`, tout autre motif `danger`.
  - `AgentStatusLine` (signature inchangée) : `danger`, point rouge sur la pastille avec bulle du motif ; `neutral`, étiquette « Whitelist vide » avec bulle « Ajoutez un numéro à la Whitelist pour que cet agent IA réponde. » (C-11). Le texte court rouge « Ne répond pas » à côté de la pastille disparaît.
  - Santé : étiquette rouge « Ne répond pas » dans l'en-tête du panneau pour `danger`, étiquette neutre pour `neutral`, ligne de texte rouge actuelle retirée.
  - Encart Statut, motif `empty_allowlist` : encadré neutre (pas `danger-soft`), « Ajoutez un numéro à la Whitelist pour que cet agent IA réponde. » et le lien d'ajout existant (`agentStatus.emptyList.add`).
  - `isNotResponding` inchangé : la Whitelist vide reste comptée dans le filtre « Ne répond pas » (spec 7.1).

- [ ] **Étape 1 : tests** : `mentionTone` pour les cinq motifs ; `AgentStatusLine` : `account_not_connected`, point rouge (`bg-danger`) et bulle au focus avec le motif, aucun texte « Ne répond pas » visible hors bulle ; `empty_allowlist`, aucune classe `danger` dans la ligne, étiquette « Whitelist vide » ; Santé et encart Statut, mêmes règles ; `agents-filter.test.ts`, un agent IA Preview à Whitelist vide reste dans `not_responding` (`// recette 3.5`).
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web` ; `npm test` (moteur) vert sans changement, preuve que `decideResponding` et l'équivalence n'ont pas bougé.
- [ ] **Étape 3 : e2e** : parcours « mention aux cinq endroits » réécrit : `account-error-check`, point rouge dans la liste, la colonne, Connexions, étiquette rouge dans Santé, encadré de la page ; `limited-empty-allowlist`, étiquette neutre aux mêmes endroits, aucun élément rouge, agent IA présent sous le filtre « Ne répond pas ». `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 4 : commit** `feat(web): Ne répond pas en point rouge, Whitelist vide en état neutre`.

### Tâche 8 : compte WhatsApp en erreur, bandeau, identifiant WABA et branchement (spec 3.6, 3.7, 3.14, 5)

**Fichiers :**
- Modifier : `apps/web/src/components/connections/{account-alerts,account-card,number-menu,assign-bot-dialog}.tsx`, `apps/web/src/components/agent/assign-number-dialog.tsx`, `apps/web/src/components/numbers/number-picker.tsx`, `apps/web/src/components/wizard/step-number.tsx`, `src/whatsapp/meta-graph.ts`, `apps/web/e2e/mock-engine.ts` (refus `decideAssign` local remplacé par celui des contrats), `apps/web/messages/{fr,en}.json`.
- Créer : `apps/web/src/lib/assign-choice.ts`, `apps/web/src/lib/__tests__/assign-choice.test.ts`, `apps/web/src/lib/__tests__/assign-readers.test.ts`.
- Tests : `src/whatsapp/__tests__/meta-graph.test.ts`, `components/connections/__tests__/{account-alerts,number-menu,assign-bot-dialog,connect-form}.test.tsx`, `components/agent/__tests__/assign-number-dialog.test.tsx`, `components/wizard/__tests__/step-number.test.tsx`, `apps/web/e2e/connections.spec.ts`.

**Interfaces :**
- Produit :
  - `AccountAlerts` gagne `onVerify?: () => void` : bouton « Vérifier maintenant » dans le bandeau d'erreur ; `AccountCard` ouvre la même fenêtre `AccountRunDialog` (vérification) que le menu « Gérer », aux mêmes conditions. Textes C-12.
  - `src/whatsapp/meta-graph.ts` : `GraphFailure` gagne `{ kind: 'not_a_waba' }`, reconnu dans `classify` (C-13) avant le cas général ; `describeFailure` le rend sur le contrôle `waba_access`.
  - `assignRefusal(bot: { bot_id: string; status: string }, number: WhatsAppNumberView, accountState: WhatsAppAccountStateView): AssignRefusalReason | null` avec `type AssignRefusalReason = Exclude<Extract<AssignDecision, { ok: false }>['reason'], 'not_found' | 'holder_changed'>` (C-14).
  - Connexions : « Brancher sur un agent IA » permis sur un numéro d'un compte en erreur ; dans la fenêtre, un agent IA Preview ou Online refusé est grisé avec sa raison (`TRANSITION_MESSAGES` lu par le texte d'écran existant), un Draft ou Offline choisissable. Page d'un agent IA (« Brancher un numéro », « Changer de numéro ») : numéros d'un compte en erreur choisissables pour un agent IA Draft ou Offline, non choisissables avec la raison pour Preview et Online. Assistant, étape 4 : choisissables (Draft) ; étape 5 inchangée.
  - Faux moteur : le branchement appelle `decideAssign` des contrats (fonction locale `decideAssign` retirée).

- [ ] **Étape 1 : test du moteur** `meta-graph.test.ts` (`// recette 3.14`) : réponse 400 `{ error: { code: 100, message: '(#100) Tried accessing nonexisting field (subscribed_apps) on node type (WhatsAppBusinessPhoneNumber)' } }` sur `GET /subscribed_apps` : contrôle `waba_access` en échec avec le texte C-13, `transient` absent, `provider_text` présent ; un autre code 100 garde le comportement actuel.
- [ ] **Étape 2 : tests de la décision** `assign-choice.test.ts` (`// entête 5`) : pour chaque statut (`draft`, `limited`, `active`, `paused`) × état du compte (`connected`, `error`, `disconnected`) × numéro présent ou retiré × numéro libre ou tenu par un autre agent IA, `assignRefusal` égale la raison de `decideAssign` appelée avec les faits C-14 (et null quand elle accepte) ; Draft et Offline sur un compte en erreur, null ; Preview et Online, `account_not_connected`. `assign-readers.test.ts` (garde statique, modèle `engine-text-readers.test.ts`) : `number-menu.tsx`, `assign-bot-dialog.tsx`, `assign-number-dialog.tsx` et `number-picker.tsx` importent `assignRefusal` et ne comparent plus `state` à `'connected'` pour décider d'un branchement.
- [ ] **Étape 3 : tests d'écran** : bandeau d'erreur, bouton « Vérifier maintenant » qui ouvre la vérification, textes C-12 par cause (`support`, `credentials`, `reconnect`, inconnue) et par motif ; conseiller ou lecture seule, pas de bouton ; `number-menu`, entrée permise sur compte en erreur ; `assign-bot-dialog`, Online grisé avec raison, Offline choisissable ; `assign-number-dialog` et `step-number`, mêmes règles ; formulaire de raccordement, le texte C-13 du moteur affiché sous le contrôle.
- [ ] **Étape 4 : vérifier l'échec, implémenter, vérifier** : `npm test`, `npm run test:pg`, `npm run typecheck`, `npm run typecheck:tests`, `npm run check:logs` ; `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web` ; `git diff --stat main -- src/webhooks src/transport src/core/router.ts` vide.
- [ ] **Étape 5 : e2e** `connections.spec.ts` : scénario `account-error-check`, branchement de `demo-3` (Draft) sur un numéro libre du compte en erreur accepté par le faux moteur ; agent IA Online grisé avec la raison ; « Vérifier maintenant » du bandeau remet le compte. `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 6 : commits** `fix(moteur): message clair quand l'identifiant saisi n'est pas un WABA`, `feat(web): bandeau d'un compte en erreur avec Vérifier maintenant`, `fix(web): brancher un agent IA Draft ou Offline sur un compte en erreur, décision des contrats`.

### Tâche 9 : organisation suspendue, bandeau et sélecteur (spec 3.13, 7.2)

**Fichiers :**
- Modifier : `apps/web/src/app/api/auth/me/route.ts`, `apps/web/src/lib/org-notice.ts`, `apps/web/src/components/providers/session-provider.tsx`, `apps/web/src/components/shell/{org-notice-banner,org-block}.tsx`, `apps/web/e2e/mock-engine.ts` si un scénario manque, `apps/web/messages/{fr,en}.json` (`shell.orgNotice.suspendedSupport`).
- Tests : `apps/web/src/app/api/auth/__tests__/me.test.ts`, `apps/web/src/lib/__tests__/org-notice.test.ts`, `components/providers/__tests__/session-provider.test.tsx`, `components/shell/__tests__/{org-notice-banner,org-block}.test.tsx`, `apps/web/e2e/two-tabs.spec.ts` ou `navigation.spec.ts`.

**Interfaces :**
- Produit :
  - Réponse de `/api/auth/me` : `{ user, active_client_id, refused_client_id: string | null }` (C-15), calculée sur le cookie lu pour l'utilisateur du jeton (`readOrg(user.id)`), jamais sur un autre.
  - `OrgNotice` de genre `suspended` gagne `role?: OrgRole` (rôle de l'utilisateur dans cette organisation) ; `parseOrgNotice` le relit.
  - `SessionProvider` : bandeau `suspended` posé seulement par `reloadNotice` (organisation affichée devenue suspendue), par `refused_client_id` au chargement (organisation de la session listée et suspendue), et par un refus de `switchOrg` pour suspension (menu fermé) ; `handleOrgError('suspended')` ne pose plus de bandeau pour l'organisation active (ligne `if (after && kind === 'suspended')`), il relit seulement la session.
  - `OrgNoticeBanner` : admin de l'organisation nommée, « {org} est suspendue. Contactez le support. » ; sinon le texte actuel.
  - Menu d'organisation : la phrase d'une organisation suspendue sous son nom, nom sur toute la largeur (plus de colonne étroite).

- [ ] **Étape 1 : tests** : `me.test.ts`, cookie sur une organisation suspendue, `refused_client_id` la nomme et `active_client_id` une autre ; cookie d'un autre utilisateur, `refused_client_id` nul (`// entête 5`) ; `session-provider.test.tsx` : membre de A (ouverte) et B (suspendue), aucune tentative, aucun bandeau ; `handleOrgError('suspended')` sur A ouvrable, aucun bandeau nommant A (`// recette 3.13`) ; `refused_client_id` = B, bandeau qui nomme B ; refus de `switchOrg` pour suspension, bandeau et menu fermé ; `org-notice-banner.test.tsx`, admin de B, « Contactez le support. » ; `org-block.test.tsx`, phrase sous le nom, nom non tronqué à 30 caractères.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web`.
- [ ] **Étape 3 : e2e** : `demo@` (membre de Maison Lumière, d'Atelier Nord et de Studio Ocre suspendue) sur la liste : aucun bandeau ; Atelier Nord ouverte, puis suspendue par un scénario du faux moteur (`org-suspended`, ajouté s'il manque), puis rechargement de la page : bandeau qui nomme Atelier Nord, page de Maison Lumière, aucun bandeau qui nomme Studio Ocre. `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 4 : commit** `fix(web): bandeau de suspension pour l'organisation tentée seulement`.

### Tâche 10 : finitions, moyenne, rail, ligne cliquable, commentaires des contrats (spec 3.9, 3.11, 3.12, 3.15)

**Fichiers :**
- Modifier : `apps/web/src/lib/period.ts`, `apps/web/src/components/agent/{cost-card,usage-view}.tsx`, `apps/web/src/components/shell/app-rail.tsx`, `apps/web/src/components/agents/agents-table.tsx`, `packages/contracts/src/bot-status.ts` (commentaires seulement), `apps/web/messages/{fr,en}.json` (`shell.rail.*Hint`), `apps/web/e2e/navigation.spec.ts`.
- Tests : `apps/web/src/lib/__tests__/period.test.ts`, `components/agent/__tests__/{cost-card,usage-view}.test.tsx`, `components/shell/__tests__/app-rail.test.tsx`, `components/agents/__tests__/agents-table.test.tsx`.

**Interfaces :**
- Produit :
  - `perDayAverage(totalUsd: number, days: number): number` (C-18) : `days` au moins 1, sinon 0.
  - `AppRail` : bulle `HintBubble` à droite sur chaque entrée, active comprise (C-17), reliée par `aria-describedby` sans changer le nom accessible ; icône active `text-brand-mint` vérifiée sur les quatre espaces.
  - `AgentsTable` : ligne entière cliquable par lien étiré (C-19), curseur main seulement sur ce qui agit.
  - `bot-status.ts` : commentaires au vocabulaire Draft, Preview, Online, Offline, Whitelist (« accès limité », « brouillon », « désactivé », « liste d'accès » remplacés), code inchangé.

- [ ] **Étape 1 : tests** : `perDayAverage(30, 30)` vaut 1, `perDayAverage(3, 7)` vaut 3/7, `perDayAverage(5, 0)` vaut 0 ; carte : 30 $ sur un seul jour d'activité affiche « ~1,00 $/jour » (`// recette 3.9`) ; page d'usage en 7 j, total divisé par 7 ; rail : bulle au survol et au focus de l'entrée active (« Agents IA », « La liste et la page de chaque agent IA. ») et de Compte ; liste : clic sur la flèche de la ligne mène à la page de l'agent IA, un seul lien par ligne dans l'ordre du clavier.
- [ ] **Étape 2 : vérifier l'échec, implémenter, vérifier** : `npm test -w @wabagent/web`, `npm run typecheck -w @wabagent/web` ; `npm test`, `npm run typecheck` (contrats) ; `grep -n "accès limité\|brouillon\|désactivé\|liste d'accès" packages/contracts/src/bot-status.ts` vide.
- [ ] **Étape 3 : e2e** : parcours de la liste, clic au bout de la ligne de « Support technique » ouvre `/fr/agents/demo-1` (`// recette 3.12`) ; bulle du rail sur l'entrée active. `npm run test:e2e -w @wabagent/web` vert.
- [ ] **Étape 4 : commits** `fix(web): moyenne par jour sur la durée de la période`, `feat(web): bulles du rail et ligne de liste cliquable`, `docs(contrats): commentaires au vocabulaire des statuts`.

### Tâche 11 : revue d'isolation (spec 2b §4.5, spec 5)

Relecteur neuf qui ne reçoit ni les rapports des exécutants, ni le registre, ni la section « Choix du planificateur » comme règle. Il reçoit la spec, `CLAUDE.md` et le code. Périmètre : le code modifié par les tâches 1 à 10 et le code qu'il appelle ou qui l'appelle : `engine-client.ts`, `engine-fetch.ts`, `api/auth/me/route.ts`, `resolveActiveOrg`, `readOrg` et `accessSubject`, `session-provider.tsx` (liaison d'`apiFetch`, `reloadChanged`, `handleOrgError`, `switchOrg`), `org-notice.ts`, les lecteurs de `/api/entities` et de `/api/bots/summary` dont les pages tirent les noms affichés, `assign-choice.ts` et `decideAssign`, les routes BFF de branchement, `meta-graph.ts` (`classify`, `describeFailure`, `sanitizeProviderText`), le faux moteur.

- [ ] **Étape 1 : revue**, rapport `docs/superpowers/research/2026-11-XX-revue-isolation-entete.md` : chaque constat avec fichier, ligne, scénario (entre deux organisations, ou entre deux membres d'une organisation pour le bouton rond et Simuler), gravité, test qui le prouve ou qui manque. Contrôles imposés : aucun nom d'entité ou d'organisation affiché ne vient d'un paramètre d'adresse ; une session illisible ne montre aucune donnée d'une autre session ; `refused_client_id` ne nomme jamais une organisation dont l'utilisateur n'est pas membre ; `git diff --stat main -- src/webhooks src/transport src/core/router.ts` vide et `git diff main -- src/whatsapp` réduit au texte C-13.
- [ ] **Étape 2 : corriger les constats bloquants et importants**, chacun avec son test (`// revue isolation entête n`), puis `npm test`, `npm run test:pg`, suite `src/__tests__/isolation/` sur les deux moteurs, `npm test -w @wabagent/web`, `npm run test:e2e -w @wabagent/web`, `npm run check:logs`.
- [ ] **Étape 3 : commit** du rapport et des corrections (un commit par sujet).

### Tâche 12 : documentation et recette des points corrigés

**Fichiers :**
- Modifier : `CLAUDE.md` (« En cours »), `docs/ARCHITECTURE.md` (section « Navigation du back-office » ; contrats changés), `docs/superpowers/research/2026-11-11-recette-refonte-navigation.md` (section 0 et nouvelle section finale).

- [ ] **Étape 1 : `CLAUDE.md`**, lot « Refonte de la navigation », ajouter sous « En cours » la spec et le plan de ce lot et ses contrats changés : en-tête de page unique (`PageHeader`, plus de barre du haut, `data-page-action`) ; code BFF `ENGINE_UNREACHABLE` (503) ; champ `refused_client_id` de `/api/auth/me` ; décision de branchement des écrans par `decideAssign` (`assignRefusal`) ; texte du moteur pour un identifiant qui n'est pas un WABA ; Whitelist vide présentée comme un état, motif `empty_allowlist` inchangé dans le moteur.
- [ ] **Étape 2 : `docs/ARCHITECTURE.md`** relu contre le code : en-tête de page (règle des parents, bouton rond, droits), session illisible (cadre gardé, cadre neutre), `ENGINE_UNREACHABLE`, `refused_client_id`, branchement d'un agent IA Draft ou Offline sur un compte en erreur.
- [ ] **Étape 3 : guide de recette, préparation** (section 0.1, après la copie de la base) : `npx tsx scripts/seed-credentials.ts` (pool de clés LLM de la plateforme, sans quoi l'agent IA répond « problème technique ») puis `npx tsx scripts/seed-pricing.ts` (tarifs, sans quoi les coûts valent 0,00 $), lancés depuis `$WT` avant le moteur.
- [ ] **Étape 4 : guide de recette, section « Corrections du 11 nov. 2026 »** : une case par correction 1 à 15 de la spec et par choix C-1 à C-20 qui se voit à l'écran, dans l'ordre de la spec : où aller, quoi faire, ce qui doit se voir, case « validé » ou « à reprendre » ; dont l'en-tête de chaque page du tableau 2.2 et des états de la spec 7.4, le bouton rond au défilement, le thème sombre (C-9, exception de `muted-2`), le moteur arrêté sur la liste puis sur « Aucune organisation » (D-108, D-109 à refaire), l'assistant ouvert depuis une liste filtrée puis « Quitter ».
- [ ] **Étape 5 : vérifier** : `grep -nP "\x{2014}|\x{2013}" CLAUDE.md docs/ARCHITECTURE.md docs/superpowers/research/2026-11-11-recette-refonte-navigation.md` vide (aucun tiret cadratin ni demi-cadratin).
- [ ] **Étape 6 : commit** `docs(navigation): en-tête de page et corrections, état du projet et recette`.
- [ ] **Étape 7 : recette en réel avec François** sur ce document ; chaque « à reprendre » devient une correction avec son test avant la revue finale de la branche, puis merge et push seulement avec son accord explicite.
