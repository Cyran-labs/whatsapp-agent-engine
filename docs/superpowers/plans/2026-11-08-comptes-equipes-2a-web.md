# Comptes et équipes, plan 2a (app web) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** rendre utilisables dans l'app web l'organisation active, l'espace Organisation, les entités, Mon compte, l'acceptation d'invitation et le mot de passe oublié, sur la charte Émeraude·Menthe avec un rail sur chaque page.

**Architecture :** deux petites retouches moteur (Express, `src/`), puis l'app Next.js (`apps/web`) : le BFF pose un cookie `wab_org` et l'en-tête `X-Organization-Id` ; un `SessionProvider` client expose l'utilisateur, l'organisation active et ses droits ; un composant `Rail` commun structure chaque page ; chaque écran appelle le moteur via des routes BFF fines.

**Tech Stack :** Next.js 15 App Router, React 19, next-intl, next-themes, Tailwind, Vitest + Testing Library, Playwright ; moteur Express + Vitest + supertest ; contrats Zod dans `packages/contracts`.

**Spec :** `docs/superpowers/specs/2026-11-07-comptes-equipes-2a-web-design.md` (à lire en entier avant toute tâche ; spec parente : `docs/superpowers/specs/2026-11-07-comptes-et-equipes-design.md`). Maquettes de référence : spec §3, dossier `.superpowers/brainstorm/4357-1794068656/content/`.

## Global Constraints

- Branche `feat/comptes-equipes-2a-web`. Auteur git : `Francois Greze <francois@cyran.fr>`. Messages de commit en français, 1 commit = 1 sujet, **aucune ligne de signature Claude/Anthropic** (règle de François). Jamais de push.
- TypeScript strict, pas de `any`, `const` par défaut. Logs au format `[Service] message`, sans emoji.
- Textes FR avec accents ; **aucun tiret cadratin `—` ni demi-cadratin `–`** nulle part (UI, code, commentaires, messages). Toujours « agent IA » (EN : « AI agent »), jamais « agent » seul.
- Charte : jetons du §4 de la spec, au pixel des maquettes, **aucun dégradé**. Titres serif en graisse normale.
- Le moteur reste la seule autorité sur les droits : l'UI masque, le moteur refuse.
- Aucun lien d'invitation ni de réinitialisation affiché dans l'UI ; réponses d'invitation et de mot de passe oublié identiques quel que soit l'état du compte.
- Ne jamais modifier `store/demo.db` sans accord de François.
- Commandes : moteur `npx vitest run <fichier>` et `npx tsc --noEmit` à la racine ; web `cd apps/web && npx vitest run <fichier>`, `npm run typecheck`, `npm run test:e2e`.

## Review Focus

1. Cookie `wab_org` périmé (organisation retirée ou suspendue depuis) : l'app retombe sur la première organisation accessible, sans boucle ni écran vide. Test dans la tâche 5.
2. Super admin sans aucune organisation sur la plateforme : pas de plantage, page « aucune organisation ». Test dans la tâche 6.
3. Super manager en lecture seule : ni simulateur, ni « + Créer un agent IA », ni entrée Organisation. Test dans la tâche 10.
4. Refus moteur « L'organisation doit garder au moins un admin. » lors d'une modification d'accès ou d'une suspension : message affiché tel quel, tiroir ou fenêtre restent ouverts. Test dans la tâche 14.
5. Double clic sur un bouton d'envoi (invitation, acceptation, activation, réinitialisation) : un seul appel. Tests dans les tâches 14 et 16.

---

### Task 1 : moteur, changement de mot de passe

**Files :**
- Modify : `packages/contracts/src/auth.ts`, `src/core/auth/auth-service.ts`, `src/api/admin/routes/auth.ts`
- Test : `src/core/auth/__tests__/auth-service.test.ts`, `src/api/admin/__tests__/auth-routes.test.ts`

**Interfaces :**
- Produces : `ChangePasswordInput = z.object({ current_password: z.string().min(1), new_password: password })` (réutilise le validateur `password` à 10 caractères du fichier) ; `AuthService.changePassword(userId: number, currentPassword: string, newPassword: string): Promise<AuthResult>` ; route `POST /auth/change-password` (sous `requireAuth`, limiteur `{ windowMs: 60_000, max: 10 }`) qui renvoie `AuthResult` comme `/auth/login`.

- [ ] **Step 1 : tests service** : `changePassword` avec le bon mot de passe actuel renvoie de nouveaux jetons, l'ancien refresh est révoqué (`refresh(ancien)` rejette), `login` avec le nouveau mot de passe réussit, avec l'ancien échoue ; mauvais mot de passe actuel : rejet 401 `'Mot de passe actuel incorrect.'` et aucune session révoquée ; compte non actif : 401 ; une entrée d'audit `action: 'user.password.change'`, `target: 'user:<id>'`, `client_id: null`, sans mot de passe dans `metadata`.
- [ ] **Step 2 : tests route** : 200 avec `access_token`/`refresh_token` ; `new_password` de 9 caractères : 400 forme standard ; sans bearer : 401.
- [ ] **Step 3 : lancer** `npx vitest run src/core/auth/__tests__/auth-service.test.ts src/api/admin/__tests__/auth-routes.test.ts` : FAIL.
- [ ] **Step 4 : implémenter** : vérifier avec `verifyPassword`, `updateUserPassword`, `revokeAllUserSessions`, puis émettre les jetons comme `login` (réutiliser la fonction interne d'émission existante).
- [ ] **Step 5 : relancer** les deux fichiers + `npx tsc --noEmit` : PASS.
- [ ] **Step 6 : commit** `feat(auth): changement de mot de passe sous session (révoque tout, réémet la session courante)`

### Task 2 : moteur, informations d'invitation enrichies et `entity_id` des agents IA

**Files :**
- Modify : `packages/contracts/src/auth.ts`, `src/core/auth/email.ts`, `src/core/auth/auth-service.ts`, éventuellement le mapping public des agents IA (`src/core/services/bot-service.ts` ou la route `GET /bots`)
- Test : `src/core/auth/__tests__/auth-service.test.ts`, `src/api/admin/__tests__/users-routes.test.ts`, `src/api/admin/__tests__/bots-routes.test.ts`

**Interfaces :**
- Produces (contrats, types TS exportés) :
  - `type GrantsSummary = { scope: 'organization'; role: 'admin' | 'super_manager'; read_only: boolean } | { scope: 'entities'; entities: Array<{ entity_name: string; role: 'manager' | 'advisor' }> }`
  - `interface InvitationInfo { organization_name: string; requires_account_creation: boolean; email_hint: string; grants_summary: GrantsSummary }`
- `maskEmail(email: string): string` dans `src/core/auth/email.ts`.
- `AuthService.invitationInfo(token): Promise<InvitationInfo>`.
- `GET /bots` et `GET /bots/:botId` exposent `entity_id: number | null`.

- [ ] **Step 1 : tests** :
  - `maskEmail('lucas.petit@maison-lumiere.fr') === 'l•••••@maison-lumiere.fr'`, `maskEmail('A@x.fr') === 'a•••••@x.fr'` ;
  - le test existant `POST /auth/invitations/info` (users-routes.test.ts, ligne ~289) attend désormais `{ organization_name: 'Acme', requires_account_creation: false, email_hint: <masque>, grants_summary: { scope: 'organization', role: 'admin', read_only: false } }` ;
  - une invitation `[{ entity_id: <id>, role: 'advisor' }]` donne `{ scope: 'entities', entities: [{ entity_name: <nom>, role: 'advisor' }] }` ; une entité archivée depuis l'invitation est omise de la liste ;
  - `GET /bots` renvoie `entity_id` pour chaque agent IA.
- [ ] **Step 2 : lancer** les trois fichiers : FAIL.
- [ ] **Step 3 : implémenter** `maskEmail` (première lettre de la partie locale en minuscule + `•••••` + `@` + domaine complet), le résumé des grants (noms d'entités lus en base, entités non actives ignorées), et l'exposition d'`entity_id` si absente.
- [ ] **Step 4 : relancer** + `npx tsc --noEmit` : PASS.
- [ ] **Step 5 : commit** `feat(auth): invitations/info renvoie l'e-mail masqué et le rôle proposé`

### Task 3 : charte Émeraude·Menthe

**Files :**
- Modify : `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`, tous les fichiers de `apps/web/src` qui utilisent `text-accent-hover` (10 occurrences), `apps/web/src/components/agent/agent-rail.tsx` (repère actif), `apps/web/src/components/wizard/stepper.tsx`
- Rename + modify : `marketing/design-reference-emeraude-ambre.html` vers `marketing/design-reference-emeraude-menthe.html` (`git mv`), puis mettre à jour les liens qui le citent (`grep -rl design-reference-emeraude-ambre docs marketing apps`)
- Test : `apps/web/src/lib/__tests__/theme-tokens.test.ts`

**Interfaces :**
- Produces : classes Tailwind `text-accent-ink`, `border-accent-ink`, `bg-accent-ink`, `shadow-accent-ink` utilisables via `accent.ink: 'var(--accent-ink)'` et `success.ink: 'var(--success-ink)'` dans `tailwind.config.ts`.

- [ ] **Step 1 : test** : mettre à jour `theme-tokens.test.ts` pour exiger `--accent: #6EE7B7`, `--accent-hover: #34D399`, `--accent-soft: #6ee7b729`, `--accent-ink: #0F7A55`, `--success: #16A34A`, `--success-soft: #DCFCE7`, `--success-ink: #15803D`, `--warning: #F59E0B` ; aucune occurrence de `#FEF3C7` comme `--accent-soft` ; toujours aucun `gradient`.
- [ ] **Step 2 : lancer** `npx vitest run src/lib/__tests__/theme-tokens.test.ts` : FAIL.
- [ ] **Step 3 : implémenter** : jetons clairs et sombres (en sombre, `--accent-ink: var(--brand-mint)` si `#0F7A55` est illisible sur `#122620` ; contraste mesuré dans la PR, cible 4,5:1 pour le texte) ; remplacer `text-accent-hover` par `text-accent-ink` ; repère actif du rail `shadow-[inset_3px_0_0_var(--accent-ink)]` + `bg-accent-soft` ; onglets ou soulignements actifs en 3 px `--accent-ink` ; `--warning-soft` reste `#FEF3C7`. Même jetons dans le fichier de référence marketing.
- [ ] **Step 4 : vérifier** `npx vitest run` (toute la suite web) et `npm run typecheck` : PASS. `grep -rn "accent-hover" apps/web/src` ne renvoie plus que des usages en fond (`hover:bg-accent-hover`).
- [ ] **Step 5 : commit** `style(charte): accent menthe, encre menthe, vert succès franc, repères renforcés`

### Task 4 : textes, « agent IA » et plus de tirets longs

**Files :**
- Modify : `apps/web/messages/fr.json`, `apps/web/messages/en.json`
- Create : `apps/web/src/i18n/__tests__/messages-style.test.ts`

- [ ] **Step 1 : test** `messages-style.test.ts` qui aplatit les deux fichiers et vérifie : aucune valeur ne contient `—` ni `–` ; en FR aucune valeur ne matche `/\bagents?\b(?!\s+IA)/i` ; en EN aucune ne matche `/\bagents?\b/i` sans être précédée de `AI ` ; FR et EN ont exactement les mêmes clés.
- [ ] **Step 2 : lancer** : FAIL (ex. `nav.agents = "Agents"`, `wizard.personalityLead`).
- [ ] **Step 3 : corriger** les valeurs (ex. `nav.agents` : « Agents IA » / « AI agents » ; `agents.create` : « + Créer un agent IA » ; `wizard.identityTitle` : « Donnez vie à votre agent IA »). Mettre à jour les tests de composants qui cherchent les anciens libellés (`top-bar.test.tsx`, etc.).
- [ ] **Step 4 : relancer** toute la suite web : PASS.
- [ ] **Step 5 : commit** `fix(textes): agent IA partout, plus de tirets cadratins (FR et EN)`

### Task 5 : BFF, organisation active

**Files :**
- Modify : `apps/web/src/lib/session.ts`, `apps/web/src/lib/engine-fetch.ts`, `apps/web/src/app/api/auth/me/route.ts`
- Create : `apps/web/src/lib/organizations.ts`, `apps/web/src/app/api/auth/org/route.ts`
- Test : `apps/web/src/lib/__tests__/organizations.test.ts`, `apps/web/src/lib/__tests__/engine-fetch.test.ts`, `apps/web/src/app/api/auth/__tests__/auth-routes.test.ts`

**Interfaces :**
- Produces (`lib/organizations.ts`) :
  - `type OrgRole = 'admin' | 'super_manager' | 'manager' | 'advisor'`
  - `interface OrganizationSummary { client_id: string; name: string; role: OrgRole; read_only: boolean; status?: string }`
  - `interface Me { id: number; email: string; role: string; status: string; organizations: OrganizationSummary[] }`
  - `isOpenable(o: OrganizationSummary): boolean` (statut absent ou `'active'`)
  - `resolveActiveOrg(orgs: OrganizationSummary[], cookie: string | undefined): OrganizationSummary | null`
  - `initialsFromEmail(email: string): string`, `monogram(name: string): string`
- Produces (`lib/session.ts`) : `ORG_COOKIE = 'wab_org'`, `readOrg(): Promise<string | undefined>`, `setOrg(clientId: string): Promise<void>`, `clearOrg(): Promise<void>` (mêmes options que les autres cookies ; `clearSession` ne touche pas `wab_org`, pour retrouver la dernière organisation).
- Produces (BFF) : `GET /api/auth/me` → `{ user: Me, active_client_id: string | null }` (pose `wab_org` si la résolution diffère du cookie) ; `POST /api/auth/org { client_id }` → 204 si l'organisation est dans `me.organizations` et ouvrable, sinon 403 `{ error: { code: 'FORBIDDEN' } }`.

- [ ] **Step 1 : tests unitaires** `organizations.test.ts` :
  - `resolveActiveOrg([A, B], 'B').client_id === 'B'` ; cookie inconnu ou d'une organisation suspendue : `A` ; `[]` : `null` ; si la première est suspendue (super admin), la première ouvrable ;
  - `initialsFromEmail('claire.bernard@x.fr') === 'CB'`, `('contact@x.fr') === 'C'`, `('jean-paul_d@x.fr') === 'JP'` ;
  - `monogram('Maison Lumière') === 'ML'`, `monogram('Atelier') === 'AT'`, `monogram('Groupe de la Vallée') === 'GD'`.
- [ ] **Step 2 : tests** `engine-fetch.test.ts` : en-tête `X-Organization-Id: c2` présent quand le cookie vaut `c2`, absent sans cookie ; réponse 403 `FORBIDDEN` hors « Organisation suspendue. » ou 400 dont `details[0].path === 'X-Organization-Id'` : `clearOrg` appelé puis l'erreur est relancée ; 403 « Organisation suspendue. » : cookie conservé.
- [ ] **Step 3 : tests routes** : `GET /api/auth/me` avec cookie périmé renvoie `active_client_id` de la première organisation et pose le cookie ; `POST /api/auth/org` accepte une organisation listée, refuse une autre (403).
- [ ] **Step 4 : lancer** les trois fichiers : FAIL.
- [ ] **Step 5 : implémenter.** `engine-fetch` lit `readOrg()` à chaque appel et l'ajoute aussi à l'appel rejoué après refresh.
- [ ] **Step 6 : relancer** + `npm run typecheck` : PASS.
- [ ] **Step 7 : commit** `feat(bff): organisation active par cookie wab_org et en-tête X-Organization-Id`

### Task 6 : session côté client, garde et page « aucune organisation »

**Files :**
- Create : `apps/web/src/components/providers/session-provider.tsx`, `apps/web/src/app/[locale]/no-organization/page.tsx`, `apps/web/src/components/auth/auth-card.tsx` (logo `● WABAGENT` au-dessus d'une carte centrée, modèle `10-acceptation-invitation.html` ; réutilisée par login et les tâches 16 et 17)
- Modify : `apps/web/src/app/[locale]/(app)/layout.tsx`, `apps/web/messages/fr.json`, `apps/web/messages/en.json`
- Test : `apps/web/src/components/providers/__tests__/session-provider.test.tsx`

**Interfaces :**
- Consumes : `GET /api/auth/me`, `POST /api/auth/org`, types de la tâche 5.
- Produces : `SessionProvider({ children })` et `useSession(): { me: Me; activeOrg: OrganizationSummary | null; isPlatformAdmin: boolean; isAdmin: boolean; readOnly: boolean; switchOrg(clientId: string): Promise<void>; refresh(): Promise<void> }`. `isAdmin` = `activeOrg?.role === 'admin'` ; `readOnly` = `activeOrg?.read_only === true` ; `isPlatformAdmin` = `me.role === 'super_admin'`. `switchOrg` appelle `POST /api/auth/org` puis recharge la page sur `/<locale>` (vide tout état client).

- [ ] **Step 1 : tests** : rendu des enfants quand `/api/auth/me` répond ; `organizations: []` (membre ordinaire **et** super admin) : `router.replace('/no-organization')` sauf si le chemin commence par `/account` ; `switchOrg('c2')` appelle `POST /api/auth/org` avec `{ client_id: 'c2' }` ; 401 sur `/api/auth/me` : redirection `/login`.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter.** La page `/no-organization` utilise `AuthCard`, texte exact de la spec §8, liens « Mon compte » (`/account/preferences`) et « Se déconnecter ». Le layout `(app)` n'affiche rien tant que la session charge.
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): session côté client, garde d'organisation et page sans organisation`

### Task 7 : rail commun

**Files :**
- Create : `apps/web/src/components/shell/rail.tsx`, `apps/web/src/components/shell/page-shell.tsx`
- Modify : `apps/web/src/components/agent/agent-rail.tsx`, `apps/web/src/components/agent/agent-shell.tsx`
- Test : `apps/web/src/components/shell/__tests__/rail.test.tsx`, `apps/web/src/components/agent/__tests__/agent-rail.test.tsx` (inchangé, doit rester vert)

**Interfaces :**
- Produces :
  - `interface RailItem { key: string; label: string; href: string | null; icon?: string; count?: number; dot?: 'success' | 'warning' | 'neutral'; soon?: boolean }`
  - `interface RailGroup { label?: string; items: RailItem[] }`
  - `Rail({ kicker, title, header, groups, activeKey }: { kicker?: string; title: string; header?: React.ReactNode; groups: RailGroup[]; activeKey: string })` : 236 px, en-tête (libellé capitales `kicker` + titre serif + `header` optionnel sous le titre), groupes avec libellé capitales, item actif `bg-accent-soft` + liseré 3 px `--accent-ink`, `aria-current="page"` sur l'actif, items `soon` non cliquables avec pastille « à venir ».
  - `PageShell({ rail, children })` : rail + zone de contenu défilante `px-8 py-7`.

- [ ] **Step 1 : tests** : groupes et libellés rendus ; l'item actif porte `aria-current="page"` ; un `count` s'affiche ; un item `soon` n'est pas un lien.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** `Rail`, `PageShell`, puis réécrire `AgentRail` au-dessus de `Rail` (en-tête : nom + `StatusPill` via `header`).
- [ ] **Step 4 : relancer** rail et agent-rail : PASS.
- [ ] **Step 5 : commit** `feat(web): composant de rail commun, l'espace agent IA l'utilise`

### Task 8 : bandeau, sélecteur d'organisation, menu de l'avatar

**Files :**
- Modify : `apps/web/src/components/shell/top-bar.tsx`, `apps/web/src/components/shell/user-menu.tsx`
- Create : `apps/web/src/components/shell/org-switcher.tsx`
- Delete : `apps/web/src/components/shell/top-bar-actions.tsx`
- Modify : toutes les pages qui rendent `TopBar` (props changées)
- Test : `apps/web/src/components/shell/__tests__/top-bar.test.tsx`, `apps/web/src/components/shell/__tests__/org-switcher.test.tsx`, `apps/web/src/components/shell/__tests__/user-menu.test.tsx`

**Interfaces :**
- Consumes : `useSession()` (tâche 6), `monogram`, `initialsFromEmail` (tâche 5).
- Produces : `TopBar({ active, crumb }: { active?: 'agents' | 'usage' | 'organisation' | 'account'; crumb?: string })`. `crumb` (nom d'agent IA) affiche le fil « Agents IA › nom ».

- [ ] **Step 1 : tests** :
  - top-bar : liens « Agents IA » et « Usage & coûts » ; « Organisation » présent si `isAdmin`, absent pour un conseiller ; plus de bouton « Déconnexion » ni de sélecteur de langue dans le bandeau ;
  - org-switcher : absent avec une seule organisation (membre) ; présent avec deux ; toujours présent pour le super admin ; menu listant nom + rôle (« Super manager · lecture seule ») et coche sur l'active ; champ de recherche seulement au-delà de 6 organisations, qui filtre par nom ; ligne suspendue (super admin) non cliquable avec « Suspendue » ; clic sur une autre ligne : `switchOrg` appelé ;
  - user-menu : initiales de l'e-mail ; menu avec e-mail, « Admin · Maison Lumière », lien « Mon compte » vers `/account/organisations`, « Se déconnecter » (appelle `/api/auth/logout`) ; super admin : badge « Opérateur WABAGENT » et rôle « Admin implicite » ; anneau menthe quand `active === 'account'`.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel des maquettes `01-selecteur-organisation-v4.html` (variante A) et `03-menu-compact-mon-compte-v4.html` (bloc du haut), pastille super admin de `06-palette-menthe.html`. Menus fermables par Échap et clic extérieur, navigables au clavier.
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): bandeau avec sélecteur d'organisation et menu sous l'avatar`

### Task 9 : Mon compte

**Files :**
- Create : `apps/web/src/app/[locale]/(app)/account/layout.tsx`, `.../account/organisations/page.tsx`, `.../account/preferences/page.tsx`, `.../account/securite/page.tsx`, `apps/web/src/app/api/auth/change-password/route.ts`, `apps/web/src/components/account/change-password-form.tsx`, `apps/web/src/components/account/segmented.tsx`
- Modify : `apps/web/src/components/shell/locale-switch.tsx`, `apps/web/src/components/shell/theme-toggle.tsx` (deviennent des boutons à deux positions basés sur `Segmented`), messages FR et EN
- Test : `apps/web/src/components/account/__tests__/change-password-form.test.tsx`, `apps/web/src/app/api/auth/__tests__/auth-routes.test.ts`, tests existants de locale-switch et theme-toggle adaptés

**Interfaces :**
- Consumes : `useSession()`, `Rail`, `PageShell`, `POST /auth/change-password` (tâche 1).
- Produces : BFF `POST /api/auth/change-password` (valide `ChangePasswordInput`, appelle le moteur, remplace la session par `setSession(result)`).

- [ ] **Step 1 : tests** : BFF : succès pose les nouveaux cookies, 401 moteur propagé ; formulaire : nouveau mot de passe de 9 caractères bloqué côté client avec le message du contrat, 401 affiche « Mot de passe actuel incorrect. », succès affiche une confirmation et vide les champs ; page Organisations : bouton « Ouvrir → » appelle `switchOrg`, ligne active marquée « Organisation active », ligne suspendue « indisponible ».
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel de `09-rail-partout.html` (rail et Organisations) et des blocs Préférences et Sécurité de `04-mon-compte-onglets-v4.html`. `/account` redirige vers `/account/organisations`. TopBar `active="account"`.
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): Mon compte (organisations, préférences, sécurité)`

### Task 10 : Agents IA par entité, et masquage selon le rôle

**Files :**
- Modify : `apps/web/src/app/api/bots/summary/route.ts`, `apps/web/src/lib/onboarding.ts` (`AgentSummaryRow.entity_id`), `apps/web/src/app/[locale]/(app)/page.tsx`, `apps/web/src/components/agents/agents-table.tsx`, `apps/web/src/components/agent/overview.tsx`
- Create : `apps/web/src/lib/agents-filter.ts`, `apps/web/src/lib/entities.ts`, `apps/web/src/app/api/entities/route.ts` (GET seulement ici ; POST en tâche 13)
- Test : `apps/web/src/lib/__tests__/agents-filter.test.ts`, `apps/web/src/app/api/bots/__tests__/summary.test.ts`, `apps/web/src/components/agents/__tests__/agents-table.test.tsx`, `apps/web/src/app/[locale]/(app)/__tests__/home.test.tsx`, `apps/web/src/components/agent/__tests__/overview.test.tsx`

**Interfaces :**
- Produces :
  - `interface EntitySummary { id: number; name: string; status: 'active' | 'archived'; bots: number; members: number }` (`lib/entities.ts`), `activeEntities(list): EntitySummary[]`
  - `type AgentFilter = { kind: 'all' } | { kind: 'entity'; entityId: number } | { kind: 'status'; status: 'active' | 'paused' | 'draft' }`, `parseAgentFilter(params: URLSearchParams): AgentFilter`, `applyAgentFilter(rows: AgentSummaryRow[], f: AgentFilter): AgentSummaryRow[]`, `agentFilterQuery(f: AgentFilter): string`
  - BFF `GET /api/entities?include_archived=true|false` (proxy de `GET /entities`)
  - `AgentsTable({ rows, entityNames })` : `entityNames?: Map<number, string>` ; colonne Entité rendue seulement si `entityNames` est fourni.

- [ ] **Step 1 : tests** :
  - `parseAgentFilter` : `?entity=12` → entité 12 ; `?status=paused` → statut ; les deux présents → entité ; valeur invalide → `all` ;
  - summary : chaque ligne porte `entity_id` ;
  - page : avec 3 entités actives, le rail affiche « Tous les agents IA », le groupe Entités avec compteurs et le groupe Statut ; avec une entité, pas de groupe Entités ; filtre entité : colonne Entité absente et titre = nom de l'entité ; « + Créer un agent IA » absent pour un conseiller et pour un super manager en lecture seule ; depuis une entité filtrée, le lien porte `?entity=<id>` ;
  - overview : bouton « Simuler » absent si `readOnly` ; bouton pause absent si non admin.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel du premier bloc de `09-rail-partout.html`. Un seul filtre à la fois ; lien de création `/agents/new?entity=<id>` quand une entité est filtrée.
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): agents IA filtrés par entité ou statut dans le rail, actions masquées selon le rôle`

### Task 11 : Usage & coûts par entité

**Files :**
- Modify : `apps/web/src/app/api/usage/summary/route.ts`, `apps/web/src/app/[locale]/(app)/usage/page.tsx`, `apps/web/src/components/usage/usage-summary-table.tsx`
- Test : `apps/web/src/app/api/usage/__tests__/summary.test.ts`, `apps/web/src/components/usage/__tests__/usage-summary-table.test.tsx`

**Interfaces :**
- Consumes : `EntitySummary`, `GET /api/entities` (tâche 10).
- Produces : lignes de `/api/usage/summary` avec `entity_id: number | null` ; page filtrable par `?entity=<id>`, total recalculé sur les lignes affichées.

- [ ] **Step 1 : tests** : chaque ligne porte `entity_id` ; table avec colonne Entité quand plusieurs entités ; filtre entité : seules ses lignes et un total égal à leur somme.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel du deuxième bloc de `09-rail-partout.html`.
- [ ] **Step 4 : relancer** : PASS.
- [ ] **Step 5 : commit** `feat(web): usage et coûts par entité`

### Task 12 : espace Organisation et Réglages

**Files :**
- Create : `apps/web/src/app/[locale]/(app)/organisation/layout.tsx`, `.../organisation/page.tsx` (redirige vers `entites`), `.../organisation/reglages/page.tsx`, `apps/web/src/components/organisation/organisation-rail.tsx`, `apps/web/src/app/api/settings/route.ts` (GET), `apps/web/src/lib/proxy.ts`
- Test : `apps/web/src/components/organisation/__tests__/organisation-space.test.tsx`, `apps/web/src/lib/__tests__/proxy.test.ts`

**Interfaces :**
- Produces :
  - `proxyEngine(enginePath: string, init?: { method?: string; body?: unknown; schema?: z.ZodTypeAny; status?: number }): Promise<NextResponse>` (`lib/proxy.ts`) : valide `body` avec `schema` (400 forme standard sinon), appelle `engineFetch`, renvoie le JSON ou 204, erreurs via `errorResponse`. À utiliser par toutes les routes BFF des tâches 12 à 17.
  - `OrganisationRail({ activeKey })` : clés `entites`, `utilisateurs`, `reglages`, compteurs entités actives et membres + invitations.
- Le layout redirige vers `/` si `!isAdmin`.

- [ ] **Step 1 : tests** : proxy (validation 400, 204, erreur moteur propagée) ; un conseiller qui ouvre `/organisation/reglages` est redirigé vers `/` ; Réglages affiche trois cartes, seule « Tout le monde voit tout » est cochée, les deux autres portent « bientôt disponible » et ne sont pas sélectionnables, aucun bouton « Enregistrer ».
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel du premier bloc de `08-reglages-et-agents-ia.html`. La carte cochée reflète `GET /api/settings` (`visibility`).
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): espace Organisation et réglage de visibilité`

### Task 13 : Organisation › Entités

**Files :**
- Create : `apps/web/src/app/[locale]/(app)/organisation/entites/page.tsx`, `apps/web/src/components/organisation/entities-table.tsx`, `apps/web/src/components/organisation/archive-entity-dialog.tsx`, `apps/web/src/components/organisation/move-agent-dialog.tsx`, `apps/web/src/app/api/entities/[id]/route.ts` (PATCH)
- Modify : `apps/web/src/app/api/entities/route.ts` (ajout POST, `CreateEntityInput`)
- Test : `apps/web/src/components/organisation/__tests__/entities.test.tsx`, `apps/web/src/app/api/entities/__tests__/entities-routes.test.ts`

**Interfaces :**
- Consumes : `proxyEngine`, `EntitySummary`, `GET /api/bots/summary` (agents IA par `entity_id`), `PATCH /api/bots/:botId` existant (`{ entity_id }`).
- Produces : BFF `POST /api/entities`, `PATCH /api/entities/:id` (`UpdateEntityInput`).

- [ ] **Step 1 : tests** :
  - tableau : nom, pastilles des agents IA rattachés, nombre de membres ; « Archiver » absent du menu de la dernière entité active ;
  - création en ligne : Entrée envoie `POST { name }`, Échap annule ; 409 « nom en double » affiché sous le champ, champ conservé ;
  - archivage d'une entité avec agents IA ou membres : fenêtre listant les agents IA (lien « Déplacer → ») et le nombre de membres, bouton « Archiver » désactivé, aucun appel PATCH ; entité vide : PATCH `{ status: 'archived' }` ;
  - « Afficher les archivées » : appelle `include_archived=true`, ligne « Archivée » avec « Réactiver » (PATCH `{ status: 'active' }`) ;
  - déplacement : la liste des entités cibles exclut la source et les archivées ; « Déplacer » envoie `PATCH /api/bots/<botId> { entity_id }`.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel de `05-organisation-entites-v4.html`. Lien des membres de la fenêtre d'archivage vers `/organisation/utilisateurs?entity=<id>` (filtre client sur les membres qui ont une appartenance à cette entité).
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): gestion des entités (création, renommage, archivage, déplacement d'agent IA)`

### Task 14 : Organisation › Utilisateurs

**Files :**
- Create : `apps/web/src/app/[locale]/(app)/organisation/utilisateurs/page.tsx`, `apps/web/src/components/organisation/members-table.tsx`, `apps/web/src/components/organisation/invitations-table.tsx`, `apps/web/src/components/organisation/access-drawer.tsx`, `apps/web/src/components/organisation/suspend-dialog.tsx`, `apps/web/src/lib/grants.ts`, routes BFF `apps/web/src/app/api/users/route.ts` (GET), `api/users/[userId]/route.ts` (PATCH), `api/users/[userId]/memberships/route.ts` (PUT), `api/invitations/route.ts` (GET, POST), `api/invitations/[id]/route.ts` (DELETE), `api/invitations/[id]/resend/route.ts` (POST)
- Test : `apps/web/src/lib/__tests__/grants.test.ts`, `apps/web/src/components/organisation/__tests__/users.test.tsx`, `apps/web/src/app/api/users/__tests__/users-routes.test.ts`

**Interfaces :**
- Consumes : `proxyEngine`, `EntitySummary`, contrats `CreateInvitationInput`, `SetMembershipsInput`, `SetMemberStatusInput`, `Grants`.
- Produces (`lib/grants.ts`) :
  - `type AccessForm = { scope: 'organization'; role: 'admin' | 'super_manager'; readOnly: boolean } | { scope: 'entities'; entities: Record<number, 'manager' | 'advisor'> }`
  - `formToGrants(f: AccessForm): Grants` (lecture seule seulement pour super manager), `grantsToForm(memberships): AccessForm`, `describeAccess(memberships, entityNames): Array<{ role: string; entity?: string; readOnly?: boolean }>`

- [ ] **Step 1 : tests** :
  - `formToGrants({ scope: 'organization', role: 'admin', readOnly: true })` → `[{ entity_id: null, role: 'admin' }]` (lecture seule ignorée) ; entités `{ 3: 'manager', 5: 'advisor' }` → deux grants ; aller-retour `grantsToForm(formToGrants(x))` stable ;
  - liste : mention « vous » et aucun menu sur sa propre ligne ; accès sur deux lignes pour un membre à deux entités ; pastille « lecture seule » ;
  - invitations : « Expire le … » ou « Expirée » selon `expires_at` ; « Renvoyer » appelle `POST /api/invitations/<id>/resend` ; « Révoquer » appelle DELETE ;
  - tiroir d'invitation : « Lecture seule » visible seulement sous « Super manager » ; « Envoyer l'invitation » désactivé tant qu'aucun accès n'est choisi ; envoi : un seul `POST /api/invitations` même sur double clic, puis message « Invitation envoyée à <email renvoyé par le moteur> » ; l'encart manager/conseiller (texte exact de la spec §6.4) est visible en mode « Certaines entités » ;
  - modification : e-mail figé, `PUT /api/users/<id>/memberships` ; réponse 409 « L'organisation doit garder au moins un admin. » affichée dans le tiroir, tiroir ouvert ;
  - suspension : fenêtre de confirmation, `PATCH { status: 'suspended' }` ; même 409 affiché dans la fenêtre ;
  - `?entity=<id>` filtre les membres de cette entité.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel de `07-organisation-utilisateurs-v2.html`.
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): gestion des utilisateurs et des invitations de l'organisation`

### Task 15 : assistant, étape 1 avec entité

**Files :**
- Modify : `apps/web/src/lib/bot-draft.ts` (`WizardState.entityId: number | null`, `buildBotPayload` envoie `entity_id` quand non nul), `apps/web/src/components/wizard/step-identity.tsx`, `apps/web/src/components/wizard/wizard.tsx`, `apps/web/src/app/[locale]/(app)/agents/new/page.tsx`
- Test : `apps/web/src/components/wizard/__tests__/step-identity.test.tsx`, `apps/web/src/lib/__tests__/bot-draft.test.ts`

**Interfaces :**
- Consumes : `GET /api/entities`, `activeEntities`.
- Produces : `StepIdentity` reçoit `entities: EntitySummary[]` ; présélection depuis `?entity=<id>` lu par la page.

- [ ] **Step 1 : tests** : une entité active : champ absent et `entity_id` absent du payload ; trois entités : champ « Entité » sans présélection et « Continuer » désactivé tant qu'aucune n'est choisie ; `?entity=5` présélectionne l'entité 5 ; `buildBotPayload` inclut `entity_id: 5`.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel du dernier bloc de `08-reglages-et-agents-ia.html`.
- [ ] **Step 4 : relancer** : PASS.
- [ ] **Step 5 : commit** `feat(web): choix de l'entité à la création d'un agent IA`

### Task 16 : page d'acceptation d'invitation

**Files :**
- Modify : `apps/web/src/app/[locale]/accept-invite/page.tsx`, `apps/web/src/components/auth/accept-invite-form.tsx`
- Create : `apps/web/src/components/auth/invitation-flow.tsx`, `apps/web/src/components/auth/password-field.tsx` (Afficher + jauge), routes BFF `apps/web/src/app/api/auth/invitations/info/route.ts`, `apps/web/src/app/api/auth/invitations/accept/route.ts`
- Test : `apps/web/src/components/auth/__tests__/invitation-flow.test.tsx`, `apps/web/src/app/api/auth/__tests__/auth-routes.test.ts`

**Interfaces :**
- Consumes : `InvitationInfo` (tâche 2), `setOrg` (tâche 5), `AuthCard` (tâche 6).
- Produces : BFF `POST /api/auth/invitations/info { token }` (public, `engineCall` sans session) ; `POST /api/auth/invitations/accept { token }` (sous session) qui, en cas de succès, pose `wab_org` sur l'organisation acceptée (dernière ajoutée dans `organizations`).
- `emailMatchesHint(email: string, hint: string): boolean` dans `invitation-flow.tsx` (même première lettre et même domaine).

- [ ] **Step 1 : tests** :
  - info 401 : état « Ce lien d'invitation n'est plus valable » avec bouton vers la connexion ;
  - `requires_account_creation: true` : e-mail masqué en lecture seule, mot de passe, « Activer mon compte » envoie un seul `POST /api/auth/accept-invite` sur double clic ;
  - `false` sans session : formulaire de connexion ; après connexion réussie, état 3 ;
  - `false` avec session dont l'e-mail correspond à l'indice : organisation, rôle proposé (« Conseiller · Boutique Lyon »), « Accepter l'invitation » envoie un seul `POST /api/auth/invitations/accept` puis redirige vers `/` ; « Plus tard » redirige vers `/` sans appel ;
  - session dont l'e-mail ne correspond pas : état « Cette invitation est destinée à l•••••@… » avec « Changer de compte » (déconnexion puis état 2) ;
  - `emailMatchesHint('lucas@x.fr', 'l•••••@x.fr') === true`, `('claire@x.fr', 'l•••••@x.fr') === false`.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** au pixel de `10-acceptation-invitation.html` ; passer la page de connexion sur `AuthCard`. Message « Bienvenue dans <organisation> » à l'arrivée (paramètre d'URL lu par la liste des agents IA).
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): page d'acceptation d'invitation pour compte neuf ou existant`

### Task 17 : mot de passe oublié

**Files :**
- Create : `apps/web/src/app/[locale]/forgot-password/page.tsx`, `apps/web/src/app/[locale]/reset-password/page.tsx`, `apps/web/src/components/auth/forgot-password-form.tsx`, `apps/web/src/components/auth/reset-password-form.tsx`, routes BFF `apps/web/src/app/api/auth/forgot-password/route.ts`, `apps/web/src/app/api/auth/reset-password/route.ts`
- Modify : `apps/web/src/middleware.ts` (`PUBLIC_SEGMENTS` + `forgot-password`, `reset-password`), `apps/web/src/components/auth/login-form.tsx` (lien), `apps/web/src/components/auth/invitation-flow.tsx` (lien de l'état 2 avec `?invite=<token>`)
- Test : `apps/web/src/components/auth/__tests__/password-reset.test.tsx`, `apps/web/src/app/api/auth/__tests__/auth-routes.test.ts`

**Interfaces :**
- Consumes : `ForgotPasswordInput`, `ResetPasswordInput`, `AuthCard`, `PasswordField`.
- Produces : BFF `POST /api/auth/forgot-password` → toujours 204 (même si le moteur échoue en 4xx, pour ne rien révéler ; erreurs 5xx propagées) ; `POST /api/auth/reset-password` → 204 ou 401.

- [ ] **Step 1 : tests** : demande : message exact « Si un compte existe pour cette adresse, un lien vous a été envoyé. Il est valable 2 heures. » quelle que soit la réponse moteur ; réinitialisation : 9 caractères refusés côté client, succès redirige vers `/login?reset=1` (ou vers `/accept-invite?token=<invite>` si `invite` est présent), 401 affiche le message d'expiration avec lien vers `/forgot-password` ; un seul appel sur double clic ; middleware : `/fr/forgot-password` et `/fr/reset-password` accessibles sans cookie.
- [ ] **Step 2 : lancer** : FAIL.
- [ ] **Step 3 : implémenter** sur `AuthCard` (modèle visuel : `10-acceptation-invitation.html`).
- [ ] **Step 4 : relancer** + typecheck : PASS.
- [ ] **Step 5 : commit** `feat(web): parcours mot de passe oublié`

### Task 18 : faux moteur et parcours e2e

**Files :**
- Modify : `apps/web/e2e/mock-engine.ts`, `apps/web/e2e/login.spec.ts`, `apps/web/e2e/accept-invite.spec.ts`, `apps/web/e2e/onboarding.spec.ts`, `apps/web/e2e/agent-space.spec.ts`
- Create : `apps/web/e2e/organisation.spec.ts`, `apps/web/e2e/password-reset.spec.ts`

**Interfaces :**
- Consumes : toutes les routes moteur citées par les tâches 1 à 17.
- Le faux moteur garde un état en mémoire par processus : deux organisations (`c1` « Maison Lumière » admin, `c2` « Atelier Nord » conseiller) pour `demo@wabagent.test`, un compte `advisor@wabagent.test` mono-organisation, entités, agents IA avec `entity_id`, membres, invitations (`invite-new` compte neuf, `invite-existing` compte existant), réglages, `change-password`, `forgot-password`, `reset-password` (jeton `reset-ok`). Il lit `X-Organization-Id` pour répondre selon l'organisation.

- [ ] **Step 1 : écrire les parcours** : connexion multi-organisation puis bascule vers Atelier Nord (l'entrée Organisation disparaît) ; création d'entité puis d'agent IA rattaché (colonne Entité visible) ; invitation (message de confirmation identique) ; acceptation compte neuf et compte existant ; mot de passe oublié puis réinitialisation ; conseiller : ni Organisation ni « + Créer un agent IA ».
- [ ] **Step 2 : lancer** `cd apps/web && npm run test:e2e` : PASS (les anciens parcours adaptés compris).
- [ ] **Step 3 : commit** `test(e2e): parcours comptes et équipes sur le faux moteur aligné`

### Task 19 : test en live et vérification finale

- [ ] **Step 1 :** suites complètes : `npx vitest run` et `npx tsc --noEmit` à la racine ; `cd apps/web && npx vitest run && npm run typecheck && npm run test:e2e`. Tout PASS, sortie conservée pour le compte rendu.
- [ ] **Step 2 :** lancer moteur et web sur des ports non standard, sur une **copie** de `store/demo.db` (jamais l'original). Parcourir : admin migré (bandeau, Organisation complète, création d'entité et d'agent IA), super admin avec sélecteur et pastille, conseiller invité (acceptation, rien d'Organisation), changement de mot de passe, mot de passe oublié (lien lu dans les journaux du moteur), en clair puis en sombre (contraste de `--accent-ink`).
- [ ] **Step 3 :** comparer chaque écran à sa maquette (spec §3) et noter les écarts ; corriger ou les remonter à François.
- [ ] **Step 4 :** compte rendu à François (ce qui marche, écarts, captures). Pas de merge ni de push sans son accord.
