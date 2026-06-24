# Design — App Next.js : fondation (Plan 5)

Addendum au spec back-office (`2026-06-22-flow-labs-backoffice-design.md`). Ce document précise les décisions structurantes de la première tranche front (sous-système 5 du séquencement §10) : restructuration en workspaces, extraction de `contracts`, BFF d'authentification, design system Émeraude·Ambre, shell et auth.

Le spec back-office reste la référence pour la stack (§3), les surfaces UI (§8), le transversal i18n/erreurs/sécurité (§9) et la palette (§8 « Émeraude·Ambre »).

## 1. Objectif

Poser la fondation de l'app WABAGENT : un shell authentifié, internationalisé (FR/EN) et thémable (clair/sombre), bâti sur le design system Émeraude·Ambre, prêt à recevoir l'onboarding (Plan 6) et le dashboard (Plan 7). Critère de sortie : un utilisateur invité peut définir son mot de passe, se connecter, naviguer dans une coquille authentifiée et changer langue/thème — sans aucune surface métier encore remplie.

## 2. Périmètre

**Dans le Plan 5** : restructuration workspaces + extraction `packages/contracts` ; `apps/web` (Next.js App Router) ; BFF auth (cookies httpOnly) ; design system (tokens, thème, typo, shadcn) ; flux login + accept-invite ; protection de routes ; shell (nav, switch locale, toggle thème, menu utilisateur) ; coquille first-run ; tests (composants, BFF, e2e login/accept-invite).

**Hors Plan 5** (→ Plans 6-7) : wizard de création d'agent, simulateur, liste agents, espace agent (onglets), Usage & coûts, builder.

## 3. Décisions structurantes (validées le 24 juin 2026)

| Sujet | Décision |
|---|---|
| Structure repo | **npm workspaces**. La racine reste le package engine et déclare `"workspaces": ["packages/*", "apps/*"]`. |
| Partage des schémas | **Extraction** de `src/contracts` → `packages/contracts` (`@wabagent/contracts`, pur Zod). Engine et front consomment la même définition. |
| Session navigateur | **BFF Next.js + cookies httpOnly**. Des route handlers Next reçoivent l'auth, parlent à l'engine, posent access+refresh en cookies httpOnly SameSite=Lax. Le JWT n'est jamais exposé au JS. |
| Frontière (nuance §3 spec) | Le navigateur parle au **BFF Next.js**, qui parle à l'engine. Les partenaires gardent l'accès **direct** à l'API engine `/api/admin/v1/*` avec leur propre JWT. « Client pur » du spec = séparation logique, pas interdiction de route handlers. |
| Thème | `next-themes`, stratégie `class`, défaut **light**, **dark livré dès la fondation** (tokens déjà définis dans la référence). Toggle persistant. |
| Tests e2e | **Playwright dès le Plan 5** sur les parcours critiques login + accept-invite (l'auth est critique : on pose le harnais tout de suite). |

## 4. Restructuration repo

```
cyran-labs-engine/                 workspace root (= package engine, inchangé fonctionnellement)
├── package.json      + "workspaces": ["packages/*", "apps/*"]
├── packages/
│   └── contracts/    extrait de src/contracts (pur Zod)
│       ├── package.json   "@wabagent/contracts", type module, exports ESM, dep: zod
│       ├── tsconfig.json
│       └── src/       auth, bots, clients, connections, dashboard, errors, invitations, index
│           └── __tests__/   tests Zod existants déplacés ici
├── apps/
│   └── web/          Next.js App Router
└── src/              engine, importe @wabagent/contracts
```

- Les 8 fichiers de `src/contracts` migrent dans `packages/contracts/src`. Les suffixes `.js` internes restent cohérents avec la résolution du package.
- Les **10 sites d'import** engine `from './contracts...'` / `'../contracts...'` deviennent `from '@wabagent/contracts'`. Mécanique, sans changement de comportement.
- La suite de tests engine doit rester verte après extraction (332 tests). Les tests `contracts` tournent désormais dans le package.

## 5. `apps/web` — structure Next.js + BFF

- Next.js App Router, TypeScript strict (`any` interdit), Tailwind + shadcn/ui (Radix) + lucide-react + next-intl.
- **Routing par locale** : `app/[locale]/...`, locales `fr` (défaut) et `en`, middleware next-intl pour la négociation + redirection.
- **BFF auth** : `app/api/auth/{login,accept-invite,refresh,logout,me}/route.ts`. Chaque handler appelle l'engine `/api/admin/v1/*`, puis pose ou efface les cookies httpOnly (`access`, `refresh`) SameSite=Lax, Secure en production.
- **Accès data serveur** : helper `engineFetch(path, init)` qui lit le cookie access, ajoute l'en-tête `Authorization`, et sur **401** tente un refresh (via le cookie refresh) puis rejoue une fois ; échec → signal de redirection login. Base configurée par `ENGINE_API_URL`.
- Variables d'env app : `ENGINE_API_URL`, `NODE_ENV` (Secure cookies). Aucun secret engine côté navigateur.

## 6. Design system (Émeraude·Ambre)

- Source de vérité : `marketing/design-reference-emeraude-ambre.html`.
- **Tokens** → `app/globals.css` : variables CSS sous `:root` (light) et `.dark`, mappées dans `tailwind.config` en rôles sémantiques (`bg`, `surface`, `text`, `text-muted`, `border`, `accent`/ambre, `brand`/`brand-mint`, états `success`/`danger`/`warning`/`neutral`). Radius xl ~13px.
- **Light** (défaut) : fond `#F1F5F2`, surface `#FFFFFF`, texte `#14322A`, accent ambre `#F59E0B`, marque menthe `#6EE7B7`.
- **Dark** : fond `#0C1A15`, surface `#122620`, bordure `#1E463B`, texte `#E6EFEA` ; ambre + menthe conservés.
- **États santé** : succès `#10B981`, problème `#DC2626`, non configuré `#8A998F`, attention `#F59E0B`.
- **Typo** via `next/font` : titres Source Serif 4 (serif éditorial), corps Inter (sans), code JetBrains Mono.
- shadcn/ui initialisé sur ces tokens ; icônes lucide.

## 7. Authentification (flux)

- **Login** : formulaire email + mot de passe (validation Zod partagée) → `POST /api/auth/login` (BFF) → engine → cookies posés → redirection dashboard.
- **Accept-invite** : `/[locale]/accept-invite?token=…` → formulaire définition mot de passe → `POST /api/auth/accept-invite` (BFF) → engine valide le token → cookies posés → session.
- **Protection routes** : middleware Next vérifie la présence d'une session (cookie) ; non authentifié → redirection `/[locale]/login`. `403` → écran dédié.
- **Logout** : `POST /api/auth/logout` (BFF) efface les cookies + révoque la session côté engine.
- **Refresh** : transparent côté serveur via `engineFetch` ; en dernier ressort, 401 non récupérable → login.

## 8. Shell

- Layout authentifié : navigation latérale (entrées Agents / Usage / Paramètres en **placeholders** remplis aux Plans 6-7), header avec **switch locale**, **toggle thème** et menu utilisateur (logout).
- **First-run global** : coquille (accueil + emplacement checklist persistante non bloquante) posée ici ; contenu rempli au Plan 6.
- États transversaux sur surfaces async : loading / empty / error ; error boundary par route ; toasts.

## 9. i18n

- next-intl, catalogues `messages/fr.json` + `messages/en.json` dès le départ, routing par locale, formats date/nombre/devise par locale. Ajouter une langue = ajouter un catalogue. Les codes d'erreur API (contracts) sont mappés vers des messages localisés.

## 10. Tests

- **`@wabagent/contracts`** : tests Zod existants, exécutés dans le package.
- **Composants** (Vitest + Testing Library) : formulaires login et accept-invite (validation Zod partagée), toggle thème, switch locale.
- **BFF** (Vitest) : route handlers auth avec engine **mocké** — pose/effacement des cookies, mapping des erreurs engine → réponses BFF, comportement refresh/401.
- **e2e Playwright** : parcours **login** et **accept-invite** (les autres parcours critiques arrivent aux Plans 6-7).

## 11. Sécurité

- JWT jamais exposé au JS (cookies httpOnly). Secrets engine jamais côté navigateur. Cookies Secure + SameSite=Lax en production. CORS engine reste restreint à l'origine web. Le BFF ne logue jamais les tokens.

## 12. Séquencement interne du Plan (indicatif)

1. Workspaces + extraction `packages/contracts` (engine reste vert).
2. Scaffold `apps/web` (Next.js, Tailwind, deps).
3. Design system : tokens, theme provider, typo, shadcn.
4. i18n : next-intl, routing locale, catalogues.
5. BFF auth + `engineFetch` + middleware protection.
6. Pages login + accept-invite.
7. Shell (nav, header, switch locale, toggle thème, first-run coquille).
8. Tests composants + BFF + e2e Playwright.
