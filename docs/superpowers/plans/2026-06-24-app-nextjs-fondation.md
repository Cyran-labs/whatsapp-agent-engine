# App Next.js — Fondation (Plan 5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser la fondation de l'app WABAGENT (Next.js) : monorepo workspaces, `contracts` partagé, shell authentifié internationalisé et thémable, flux login + accept-invite via BFF cookies httpOnly.

**Architecture:** Le repo devient un monorepo npm workspaces. `src/contracts` est extrait en `packages/contracts` (`@wabagent/contracts`, pur Zod) consommé comme source TS par l'engine et par `apps/web`. `apps/web` est une app Next.js App Router : un BFF (route handlers `/api/auth/*`) parle à l'engine `/api/admin/v1/*` et pose access+refresh en cookies httpOnly ; le navigateur ne voit jamais le JWT. Design system Émeraude·Ambre (tokens CSS + Tailwind + shadcn), i18n next-intl FR/EN, thème clair/sombre.

**Tech Stack:** npm workspaces, Next.js 15 (App Router, React 19), TypeScript strict, Tailwind CSS, shadcn/ui (Radix), lucide-react, next-intl, next-themes, Zod (partagé), Vitest + Testing Library, Playwright.

## Global Constraints

- TypeScript strict partout : `any` interdit, `const` par défaut.
- Logs : format `[Service] message`, sans emoji.
- Auteur git : `Francois Greze <francois@cyran.fr>`. Aucun commit sans validation explicite (le contrôleur SDD commite par tâche ; la validation globale du lancement vaut autorisation des commits de tâches).
- Pas de signature Claude/Anthropic dans les commits.
- Textes français : accents obligatoires (é è ê à â ù û ô ç î ï). Le code et les identifiants techniques restent ASCII.
- Aucune référence aux thématiques de la démo Cyran (golf, immo, voyage, auto, acquisition) dans le code/fixtures/catalogues i18n.
- Branding produit : **WABAGENT**. Icônes : **lucide**. Devise/dates/nombres : par locale.
- Palette : **Émeraude·Ambre**, source de vérité `marketing/design-reference-emeraude-ambre.html`. Défaut light. Dark livré.
- Locales : `fr` (défaut) et `en`.
- Secrets/JWT jamais exposés au JS navigateur. Cookies httpOnly, SameSite=Lax, Secure en production. Le BFF ne logue jamais les tokens.
- L'engine reste fonctionnellement inchangé (la suite engine — 332 tests — doit rester verte après l'extraction `contracts`).

## Interfaces engine consommées (référence, ne pas modifier)

API admin montée sur `/api/admin/v1`. Routes auth (`src/api/admin/routes/auth.ts`) :

- `POST /api/admin/v1/auth/login` body `{ email, password }` → `200 { access_token, refresh_token, user }`
- `POST /api/admin/v1/auth/accept-invite` body `{ token, password }` → `200 { access_token, refresh_token, user }`
- `POST /api/admin/v1/auth/refresh` body `{ refresh_token }` → `200 { access_token, refresh_token, user }`
- `POST /api/admin/v1/auth/logout` body `{ refresh_token }` → `204`
- `GET /api/admin/v1/auth/me` header `Authorization: Bearer <access>` → `200 PublicUser`

Types (depuis `src/core/auth/auth-service.ts`) :

```ts
interface PublicUser { id: number; email: string; role: string; client_id: string | null; status: string }
interface AuthResult { access_token: string; refresh_token: string; user: PublicUser }
```

Corps d'erreur engine (depuis `src/api/errors.ts`), statut HTTP dérivé du code :

```ts
// { error: { code, message, details?: [{path, message}], request_id } }
// VALIDATION_ERROR=400 UNAUTHORIZED=401 FORBIDDEN=403 NOT_FOUND=404
// CONFLICT=409 RATE_LIMITED=429 INTERNAL=500 WA_VALIDATION_FAILED=422 CRM_VALIDATION_FAILED=422
```

`access_token` est un JWT (exp courte) ; `refresh_token` est opaque (stocké hashé côté engine). Le BFF détecte l'expiration via un `401` sur un appel protégé, puis tente un `/refresh`.

---

## File Structure

**Restructuration :**
- `package.json` (racine) — ajoute `workspaces`, reste le package engine.
- `packages/contracts/` — `package.json`, `tsconfig.json`, `src/*.ts` (déplacés depuis `src/contracts`), `src/__tests__/`.
- 10 fichiers engine — imports `./contracts*` → `@wabagent/contracts`.

**`apps/web/` (nouveau) :**
- `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json` (shadcn), `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `.env.example`.
- `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/middleware.ts`.
- `messages/fr.json`, `messages/en.json`.
- `src/app/globals.css` — tokens Émeraude·Ambre.
- `src/app/[locale]/layout.tsx`, `src/app/[locale]/login/page.tsx`, `src/app/[locale]/accept-invite/page.tsx`, `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/page.tsx`, `src/app/[locale]/forbidden/page.tsx`, `src/app/[locale]/error.tsx`.
- `src/app/api/auth/{login,accept-invite,refresh,logout,me}/route.ts`.
- `src/lib/engine-client.ts` (appel engine + map erreurs), `src/lib/session.ts` (cookies), `src/lib/engine-fetch.ts` (proxy authentifié + refresh).
- `src/components/providers/theme-provider.tsx`, `src/components/shell/{sidebar,header,locale-switch,theme-toggle,user-menu}.tsx`, `src/components/auth/{login-form,accept-invite-form}.tsx`, `src/components/ui/*` (shadcn).
- `e2e/{login,accept-invite}.spec.ts`.

---

## Task 1: Monorepo workspaces + extraction `packages/contracts`

**Files:**
- Modify: `package.json` (racine, ajoute `workspaces`)
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Move: `src/contracts/{auth,bots,clients,connections,dashboard,errors,invitations,index}.ts` → `packages/contracts/src/`
- Move: `src/contracts/__tests__/` → `packages/contracts/src/__tests__/`
- Modify: les 10 fichiers engine important `contracts`

**Interfaces:**
- Produces: package `@wabagent/contracts` exposant tous les schémas Zod + types via `exports: "./src/index.ts"`. Importé par `from '@wabagent/contracts'`.

- [ ] **Step 1: Créer `packages/contracts/package.json`**

```json
{
  "name": "@wabagent/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^3.25.76"
  }
}
```

- [ ] **Step 2: Créer `packages/contracts/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Déplacer les fichiers contracts**

```bash
mkdir -p packages/contracts/src
git mv src/contracts/auth.ts packages/contracts/src/auth.ts
git mv src/contracts/bots.ts packages/contracts/src/bots.ts
git mv src/contracts/clients.ts packages/contracts/src/clients.ts
git mv src/contracts/connections.ts packages/contracts/src/connections.ts
git mv src/contracts/dashboard.ts packages/contracts/src/dashboard.ts
git mv src/contracts/errors.ts packages/contracts/src/errors.ts
git mv src/contracts/invitations.ts packages/contracts/src/invitations.ts
git mv src/contracts/index.ts packages/contracts/src/index.ts
git mv src/contracts/__tests__ packages/contracts/src/__tests__
rmdir src/contracts 2>/dev/null || true
```

- [ ] **Step 4: Déclarer les workspaces dans `package.json` racine**

Ajouter la clé (après `"private": true,`) :

```json
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
```

Et ajouter `@wabagent/contracts` aux dépendances de l'engine :

```json
    "@wabagent/contracts": "*",
```

- [ ] **Step 5: Installer (crée les symlinks workspace)**

Run: `npm install`
Expected: `node_modules/@wabagent/contracts` est un symlink vers `packages/contracts`. Pas d'erreur.

- [ ] **Step 6: Réécrire les imports engine `contracts` → `@wabagent/contracts`**

Lister les sites :

```bash
grep -rln "contracts/index.js\|contracts/index\|/contracts['\"]" src --include="*.ts"
```

Dans chacun des 10 fichiers, remplacer l'import relatif (formes possibles : `from '../../../contracts/index.js'`, `from '../contracts/index.js'`, `from './contracts/index.js'`, ou imports de sous-fichiers) par :

```ts
import { /* …mêmes symboles… */ } from '@wabagent/contracts';
```

Si un fichier importe un sous-module précis (ex. `from '../contracts/errors.js'`), le pointer aussi vers `@wabagent/contracts` (tout est ré-exporté par l'index).

- [ ] **Step 7: Vérifier qu'aucun import relatif `contracts` ne subsiste**

Run: `grep -rn "contracts/" src --include="*.ts" | grep -v node_modules`
Expected: aucune ligne (chaîne vide).

- [ ] **Step 8: Typecheck engine**

Run: `npm run typecheck`
Expected: PASS, 0 erreur.

- [ ] **Step 9: Suite de tests complète (engine + contracts package)**

Run: `npm test` (à la racine ; vitest découvre `packages/**` et `src/**`)
Expected: tous les tests verts, y compris les tests Zod désormais sous `packages/contracts/src/__tests__`. Total ≥ 332.

Si vitest ne ramasse pas `packages/contracts`, vérifier `vitest.config` / `vitest` root ; le cas échéant, lancer aussi `npx vitest run packages` et corriger l'`include` pour couvrir `packages/**/*.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: extraction packages/contracts + monorepo workspaces"
```

---

## Task 2: Scaffold `apps/web` (Next.js + Tailwind + dépendances)

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/postcss.config.mjs`, `apps/web/.env.example`, `apps/web/.gitignore`
- Create: `apps/web/src/app/layout.tsx` (root minimal, remplacé en Task 4), `apps/web/src/app/page.tsx` (placeholder temporaire)

**Interfaces:**
- Produces: app Next.js qui démarre sur `http://localhost:3001`, consomme `@wabagent/contracts` via `transpilePackages`.

- [ ] **Step 1: Créer `apps/web/package.json`**

```json
{
  "name": "@wabagent/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@wabagent/contracts": "*",
    "next": "^15.1.0",
    "next-intl": "^3.26.0",
    "next-themes": "^0.4.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.25.76",
    "lucide-react": "^0.469.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^25.4.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.9.3",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Créer `apps/web/next.config.ts`**

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@wabagent/contracts'],
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 3: Créer `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "esModuleInterop": true,
    "jsx": "preserve",
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "e2e"]
}
```

- [ ] **Step 4: Créer `apps/web/postcss.config.mjs`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 5: Créer `apps/web/.env.example`**

```
# URL de base de l'API admin engine
ENGINE_API_URL=http://localhost:3000/api/admin/v1
```

- [ ] **Step 6: Créer `apps/web/.gitignore`**

```
/.next/
/node_modules
/playwright-report/
/test-results/
next-env.d.ts
.env
```

- [ ] **Step 7: Root layout minimal `apps/web/src/app/layout.tsx`** (provisoire, remplacé Task 4)

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Placeholder `apps/web/src/app/page.tsx`** (provisoire)

```tsx
export default function Page() {
  return <main>WABAGENT — boot OK</main>;
}
```

- [ ] **Step 9: Installer**

Run: `npm install`
Expected: dépendances `apps/web` installées, `@wabagent/contracts` lié.

- [ ] **Step 10: Vérifier le build/boot**

Run: `npm run -w @wabagent/web build`
Expected: build Next réussit (génère `/` et `/page`). Pas d'erreur de résolution de `@wabagent/contracts`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold apps/web (Next.js + Tailwind + deps)"
```

---

## Task 3: Design system Émeraude·Ambre (tokens, Tailwind, fonts, theme provider)

**Files:**
- Create: `apps/web/tailwind.config.ts`, `apps/web/src/app/globals.css`, `apps/web/src/lib/utils.ts`, `apps/web/components.json`
- Create: `apps/web/src/components/providers/theme-provider.tsx`
- Create: `apps/web/src/components/ui/button.tsx` (1ère primitive shadcn, valide les tokens)
- Test: `apps/web/src/components/ui/__tests__/button.test.tsx`
- Create: `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`

**Interfaces:**
- Consumes: rien.
- Produces: classes Tailwind sémantiques (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `border-border`, `bg-accent`, `text-accent-fg`, `bg-brand`, `text-success/danger/warning/neutral`), `cn()` util, `<ThemeProvider>`, `<Button variant size>`.

- [ ] **Step 1: Créer `apps/web/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Créer `apps/web/src/app/globals.css` (tokens Émeraude·Ambre light + dark)**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --bg: #F1F5F2;
    --surface: #FFFFFF;
    --fg: #14322A;
    --muted: #44524B;
    --muted-2: #8A998F;
    --border: #E2E8E4;
    --accent: #F59E0B;
    --accent-hover: #D97706;
    --accent-soft: #FEF3C7;
    --accent-fg: #14322A;
    --brand: #1E463B;
    --brand-deep: #14322A;
    --brand-mint: #6EE7B7;
    --success: #10B981;
    --danger: #DC2626;
    --warning: #F59E0B;
    --neutral: #8A998F;
    --radius: 13px;
  }

  .dark {
    --bg: #0C1A15;
    --surface: #122620;
    --fg: #E6EFEA;
    --muted: #B6C5BC;
    --muted-2: #8A998F;
    --border: #1E463B;
    --accent: #F59E0B;
    --accent-hover: #D97706;
    --accent-soft: #3A2E12;
    --accent-fg: #14322A;
    --brand: #1E463B;
    --brand-deep: #14322A;
    --brand-mint: #6EE7B7;
    --success: #10B981;
    --danger: #F87171;
    --warning: #F59E0B;
    --neutral: #8A998F;
  }

  * {
    border-color: var(--border);
  }
  body {
    background-color: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans), system-ui, sans-serif;
  }
}
```

- [ ] **Step 3: Créer `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        fg: 'var(--fg)',
        muted: { DEFAULT: 'var(--muted)', 2: 'var(--muted-2)' },
        border: 'var(--border)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          fg: 'var(--accent-fg)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          deep: 'var(--brand-deep)',
          mint: 'var(--brand-mint)',
        },
        success: 'var(--success)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        neutral: 'var(--neutral)',
      },
      borderRadius: {
        xl: 'var(--radius)',
        lg: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 6px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

- [ ] **Step 4: Créer `apps/web/components.json` (config shadcn, style aligné tokens)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 5: Créer le theme provider `apps/web/src/components/providers/theme-provider.tsx`**

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} {...props}>
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 6: Créer `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 7: Créer `apps/web/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 8: Écrire le test du bouton `apps/web/src/components/ui/__tests__/button.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { Button } from '../button';

test('rend un bouton avec le libellé et la classe accent par défaut', () => {
  render(<Button>Valider</Button>);
  const btn = screen.getByRole('button', { name: 'Valider' });
  expect(btn).toBeInTheDocument();
  expect(btn.className).toContain('bg-accent');
});
```

- [ ] **Step 9: Lancer le test (échoue : pas de Button)**

Run: `npm run -w @wabagent/web test -- button`
Expected: FAIL (`Cannot find module '../button'`).

- [ ] **Step 10: Créer `apps/web/src/components/ui/button.tsx`**

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent-hover',
        outline: 'border border-border bg-surface text-fg hover:bg-bg',
        ghost: 'text-fg hover:bg-bg',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
```

- [ ] **Step 11: Relancer le test (passe)**

Run: `npm run -w @wabagent/web test -- button`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(web): design system Emeraude-Ambre (tokens, Tailwind, theme provider, Button)"
```

---

## Task 4: i18n next-intl (routing locale, catalogues, fonts, root layout)

**Files:**
- Create: `apps/web/src/i18n/routing.ts`, `apps/web/src/i18n/request.ts`, `apps/web/src/middleware.ts`
- Create: `apps/web/messages/fr.json`, `apps/web/messages/en.json`
- Modify: `apps/web/src/app/layout.tsx` (fonts + structure), supprimer `apps/web/src/app/page.tsx` (placeholder)
- Create: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/page.tsx`
- Test: `apps/web/src/i18n/__tests__/routing.test.ts`

**Interfaces:**
- Consumes: `<ThemeProvider>` (Task 3).
- Produces: `routing` (locales `['fr','en']`, defaultLocale `fr`), helpers de navigation localisée, catalogues de messages, fonts CSS vars `--font-sans/--font-serif/--font-mono`.

- [ ] **Step 1: Écrire le test routing `apps/web/src/i18n/__tests__/routing.test.ts`**

```ts
import { routing } from '../routing';

test('locales fr + en, défaut fr', () => {
  expect(routing.locales).toEqual(['fr', 'en']);
  expect(routing.defaultLocale).toBe('fr');
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- routing`
Expected: FAIL (`Cannot find module '../routing'`).

- [ ] **Step 3: Créer `apps/web/src/i18n/routing.ts`**

```ts
import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
```

- [ ] **Step 4: Relancer le test (passe)**

Run: `npm run -w @wabagent/web test -- routing`
Expected: PASS.

- [ ] **Step 5: Créer `apps/web/src/i18n/request.ts`**

```ts
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as 'fr' | 'en')
    ? (requested as 'fr' | 'en')
    : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 6: Créer `apps/web/src/middleware.ts`**

```ts
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

Note : le `matcher` exclut `/api/*` pour que le BFF (Task 6) ne soit pas réécrit par locale.

- [ ] **Step 7: Créer `apps/web/messages/fr.json`**

```json
{
  "common": {
    "appName": "WABAGENT",
    "loading": "Chargement…",
    "error": "Une erreur est survenue.",
    "retry": "Réessayer"
  },
  "nav": {
    "agents": "Agents",
    "usage": "Usage & coûts",
    "settings": "Paramètres"
  },
  "auth": {
    "loginTitle": "Connexion",
    "email": "Adresse e-mail",
    "password": "Mot de passe",
    "submit": "Se connecter",
    "acceptInviteTitle": "Définir votre mot de passe",
    "newPassword": "Nouveau mot de passe",
    "acceptSubmit": "Activer mon compte",
    "logout": "Déconnexion",
    "invalidCredentials": "Identifiants invalides.",
    "invalidInvite": "Invitation invalide ou expirée.",
    "passwordTooShort": "Le mot de passe doit faire au moins 10 caractères.",
    "rateLimited": "Trop de tentatives. Réessayez dans un instant."
  },
  "errors": {
    "forbiddenTitle": "Accès refusé",
    "forbiddenBody": "Vous n'avez pas les droits pour accéder à cette page.",
    "genericTitle": "Quelque chose s'est mal passé"
  },
  "firstRun": {
    "welcome": "Bienvenue sur WABAGENT",
    "subtitle": "Créez votre premier agent WhatsApp."
  },
  "theme": { "toggle": "Changer de thème" },
  "locale": { "switch": "Langue" }
}
```

- [ ] **Step 8: Créer `apps/web/messages/en.json`**

```json
{
  "common": {
    "appName": "WABAGENT",
    "loading": "Loading…",
    "error": "Something went wrong.",
    "retry": "Retry"
  },
  "nav": {
    "agents": "Agents",
    "usage": "Usage & costs",
    "settings": "Settings"
  },
  "auth": {
    "loginTitle": "Sign in",
    "email": "Email address",
    "password": "Password",
    "submit": "Sign in",
    "acceptInviteTitle": "Set your password",
    "newPassword": "New password",
    "acceptSubmit": "Activate my account",
    "logout": "Sign out",
    "invalidCredentials": "Invalid credentials.",
    "invalidInvite": "Invalid or expired invitation.",
    "passwordTooShort": "Password must be at least 10 characters.",
    "rateLimited": "Too many attempts. Please try again shortly."
  },
  "errors": {
    "forbiddenTitle": "Access denied",
    "forbiddenBody": "You don't have permission to access this page.",
    "genericTitle": "Something went wrong"
  },
  "firstRun": {
    "welcome": "Welcome to WABAGENT",
    "subtitle": "Create your first WhatsApp agent."
  },
  "theme": { "toggle": "Toggle theme" },
  "locale": { "switch": "Language" }
}
```

- [ ] **Step 9: Remplacer le root layout `apps/web/src/app/layout.tsx` (fonts)**

```tsx
import type { Metadata } from 'next';
import { Inter, Source_Serif_4, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'WABAGENT',
  description: 'Plateforme d\'agents WhatsApp e-commerce.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 10: Supprimer le placeholder racine**

```bash
git rm apps/web/src/app/page.tsx
```

- [ ] **Step 11: Créer `apps/web/src/app/[locale]/layout.tsx`**

```tsx
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/components/providers/theme-provider';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return (
    <NextIntlClientProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}
```

- [ ] **Step 12: Créer une page locale provisoire `apps/web/src/app/[locale]/page.tsx`**

```tsx
import { useTranslations } from 'next-intl';

export default function Home() {
  const t = useTranslations('common');
  return <main className="p-8 font-serif text-2xl text-fg">{t('appName')}</main>;
}
```

- [ ] **Step 13: Typecheck + tests + build**

Run: `npm run -w @wabagent/web typecheck && npm run -w @wabagent/web test && npm run -w @wabagent/web build`
Expected: typecheck PASS, tests PASS, build génère `/[locale]` (fr, en). Visiter `/` redirige vers `/fr`.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(web): i18n next-intl (routing locale FR/EN, catalogues, fonts)"
```

---

## Task 5: BFF — engine client, session cookies, engineFetch

**Files:**
- Create: `apps/web/src/lib/engine-client.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/engine-fetch.ts`
- Test: `apps/web/src/lib/__tests__/engine-client.test.ts`, `apps/web/src/lib/__tests__/engine-fetch.test.ts`

**Interfaces:**
- Consumes: rien (utilise `fetch` global + `next/headers` cookies).
- Produces:
  - `EngineError { code: ErrorCode; message: string; status: number; details?: {path:string;message:string}[] }`
  - `engineCall<T>(path: string, init?: RequestInit): Promise<T>` — appelle `ENGINE_API_URL+path`, parse JSON, lève `EngineError` sur statut ≥400.
  - `ACCESS_COOKIE='wab_access'`, `REFRESH_COOKIE='wab_refresh'`, `setSession(res)`, `clearSession()`, `readAccess()`, `readRefresh()` (via `cookies()` de `next/headers`).
  - `engineFetch<T>(path, init?)` — appel authentifié serveur : ajoute `Authorization: Bearer <access>`, sur `401` tente `/auth/refresh` avec le refresh cookie (réécrit les cookies) puis rejoue une fois ; échec → lève `EngineError` UNAUTHORIZED.

- [ ] **Step 1: Écrire le test `apps/web/src/lib/__tests__/engine-client.test.ts`**

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { engineCall, EngineError } from '../engine-client';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  vi.restoreAllMocks();
});

test('retourne le JSON sur 200', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  const out = await engineCall<{ ok: boolean }>('/ping');
  expect(out).toEqual({ ok: true });
});

test('lève EngineError typée sur erreur engine', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Non authentifié.', request_id: 'r1' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ),
  ));
  await expect(engineCall('/auth/me')).rejects.toMatchObject({
    name: 'EngineError',
    code: 'UNAUTHORIZED',
    status: 401,
  } satisfies Partial<EngineError>);
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- engine-client`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `apps/web/src/lib/engine-client.ts`**

```ts
import type { ErrorCode, ApiErrorDetail } from '@wabagent/contracts';

export class EngineError extends Error {
  readonly name = 'EngineError';
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
  }
}

function baseUrl(): string {
  const url = process.env.ENGINE_API_URL;
  if (!url) throw new Error('[BFF] ENGINE_API_URL manquant');
  return url.replace(/\/$/, '');
}

export async function engineCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = body?.error;
    throw new EngineError(
      (e?.code as ErrorCode) ?? 'INTERNAL',
      e?.message ?? 'Erreur engine.',
      res.status,
      e?.details,
    );
  }
  return body as T;
}
```

- [ ] **Step 4: Relancer le test (passe)**

Run: `npm run -w @wabagent/web test -- engine-client`
Expected: PASS.

- [ ] **Step 5: Créer `apps/web/src/lib/session.ts`**

```ts
import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'wab_access';
export const REFRESH_COOKIE = 'wab_refresh';

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function setSession(tokens: { access_token: string; refresh_token: string }): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.access_token, { ...baseCookie });
  store.set(REFRESH_COOKIE, tokens.refresh_token, { ...baseCookie });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function readAccess(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function readRefresh(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}
```

- [ ] **Step 6: Écrire le test `apps/web/src/lib/__tests__/engine-fetch.test.ts`**

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { engineFetch } from '../engine-fetch';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../session';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  store.set(ACCESS_COOKIE, 'old-access');
  store.set(REFRESH_COOKIE, 'refresh-1');
  vi.restoreAllMocks();
});

test('appel authentifié ok : passe le Bearer, retourne le JSON', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const out = await engineFetch<{ id: number }>('/auth/me');
  expect(out).toEqual({ id: 1 });
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer old-access' });
});

test('401 → refresh → rejoue avec le nouveau token et met à jour les cookies', async () => {
  const fetchMock = vi
    .fn()
    // 1er appel protégé → 401
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    // refresh → 200 nouveaux tokens
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'refresh-2', user: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
    // rejoue → 200
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 2 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);

  const out = await engineFetch<{ id: number }>('/bots');
  expect(out).toEqual({ id: 2 });
  expect(store.get(ACCESS_COOKIE)).toBe('new-access');
  expect(store.get(REFRESH_COOKIE)).toBe('refresh-2');
  expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ authorization: 'Bearer new-access' });
});

test('401 puis refresh échoue → EngineError UNAUTHORIZED', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'no', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(engineFetch('/bots')).rejects.toMatchObject({ name: 'EngineError', code: 'UNAUTHORIZED' });
});
```

- [ ] **Step 7: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- engine-fetch`
Expected: FAIL (module introuvable).

- [ ] **Step 8: Créer `apps/web/src/lib/engine-fetch.ts`**

```ts
import { engineCall, EngineError } from './engine-client';
import { readAccess, readRefresh, setSession, clearSession } from './session';

interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: unknown;
}

async function call<T>(path: string, access: string | undefined, init?: RequestInit): Promise<T> {
  return engineCall<T>(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(access ? { authorization: `Bearer ${access}` } : {}) },
  });
}

export async function engineFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const access = await readAccess();
  try {
    return await call<T>(path, access, init);
  } catch (err) {
    if (!(err instanceof EngineError) || err.status !== 401) throw err;
    const refresh = await readRefresh();
    if (!refresh) {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', 'Session expirée.', 401);
    }
    let refreshed: AuthResult;
    try {
      refreshed = await engineCall<AuthResult>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', 'Session expirée.', 401);
    }
    await setSession(refreshed);
    return call<T>(path, refreshed.access_token, init);
  }
}
```

- [ ] **Step 9: Relancer les tests lib (passent)**

Run: `npm run -w @wabagent/web test -- lib`
Expected: PASS (engine-client + engine-fetch).

- [ ] **Step 10: Typecheck**

Run: `npm run -w @wabagent/web typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): BFF (engine client, session cookies, engineFetch + refresh)"
```

---

## Task 6: BFF — route handlers auth

**Files:**
- Create: `apps/web/src/app/api/auth/login/route.ts`, `.../accept-invite/route.ts`, `.../refresh/route.ts`, `.../logout/route.ts`, `.../me/route.ts`
- Create: `apps/web/src/lib/api-response.ts` (mapper EngineError → réponse HTTP)
- Test: `apps/web/src/app/api/auth/__tests__/auth-routes.test.ts`

**Interfaces:**
- Consumes: `engineCall`, `EngineError` (Task 5), `setSession`, `clearSession`, `readRefresh` (Task 5), `engineFetch` (Task 5), `LoginInput`, `AcceptInviteInput` (`@wabagent/contracts`).
- Produces: handlers `POST` login/accept-invite/refresh/logout, `GET` me. login/accept-invite renvoient `{ user }` (jamais les tokens) + posent les cookies.

- [ ] **Step 1: Créer `apps/web/src/lib/api-response.ts`**

```ts
import { NextResponse } from 'next/server';
import { EngineError } from './engine-client';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof EngineError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Erreur interne.' } }, { status: 500 });
}
```

- [ ] **Step 2: Écrire le test `apps/web/src/app/api/auth/__tests__/auth-routes.test.ts`**

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { POST as login } from '../login/route';
import { POST as logout } from '../logout/route';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  vi.restoreAllMocks();
});

function req(body: unknown): Request {
  return new Request('http://web.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('login OK : pose les cookies, renvoie user sans tokens', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 1, email: 'x@y.z', role: 'client_admin', client_id: 'c1', status: 'active' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  const res = await login(req({ email: 'x@y.z', password: 'motdepasse12' }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.user.email).toBe('x@y.z');
  expect(json.access_token).toBeUndefined();
  expect(store.get(ACCESS_COOKIE)).toBe('a');
  expect(store.get(REFRESH_COOKIE)).toBe('r');
});

test('login : validation locale → 400 sans appeler l\'engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await login(req({ email: 'pas-un-email', password: '' }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('login : 401 engine → 401 propagé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.', request_id: 'r' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  ));
  const res = await login(req({ email: 'x@y.z', password: 'motdepasse12' }));
  expect(res.status).toBe(401);
});

test('logout : efface les cookies', async () => {
  store.set(ACCESS_COOKIE, 'a');
  store.set(REFRESH_COOKIE, 'r');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  const res = await logout(new Request('http://web.test/api/auth/logout', { method: 'POST' }));
  expect(res.status).toBe(204);
  expect(store.has(ACCESS_COOKIE)).toBe(false);
  expect(store.has(REFRESH_COOKIE)).toBe(false);
});
```

- [ ] **Step 3: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- auth-routes`
Expected: FAIL (modules de route introuvables).

- [ ] **Step 4: Créer `apps/web/src/app/api/auth/login/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { LoginInput } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = LoginInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const result = await engineCall<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(parsed.data) });
    await setSession(result);
    return NextResponse.json({ user: result.user });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: Créer `apps/web/src/app/api/auth/accept-invite/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { AcceptInviteInput } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = AcceptInviteInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const result = await engineCall<AuthResult>('/auth/accept-invite', { method: 'POST', body: JSON.stringify(parsed.data) });
    await setSession(result);
    return NextResponse.json({ user: result.user });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: Créer `apps/web/src/app/api/auth/refresh/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { engineCall, EngineError } from '@/lib/engine-client';
import { readRefresh, setSession, clearSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(): Promise<NextResponse> {
  try {
    const refresh = await readRefresh();
    if (!refresh) {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', 'Session expirée.', 401);
    }
    const result = await engineCall<AuthResult>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
    await setSession(result);
    return NextResponse.json({ user: result.user });
  } catch (err) {
    await clearSession();
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: Créer `apps/web/src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { engineCall } from '@/lib/engine-client';
import { readRefresh, clearSession } from '@/lib/session';

export async function POST(): Promise<NextResponse> {
  const refresh = await readRefresh();
  if (refresh) {
    try {
      await engineCall('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
    } catch {
      // logout best-effort : on efface la session locale quoi qu'il arrive
    }
  }
  await clearSession();
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 8: Créer `apps/web/src/app/api/auth/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await engineFetch('/auth/me');
    return NextResponse.json({ user });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 9: Relancer les tests (passent)**

Run: `npm run -w @wabagent/web test -- auth-routes`
Expected: PASS.

- [ ] **Step 10: Typecheck**

Run: `npm run -w @wabagent/web typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): BFF route handlers auth (login/accept-invite/refresh/logout/me)"
```

---

## Task 7: Pages auth (login, accept-invite) + protection de routes

**Files:**
- Create: `apps/web/src/components/auth/login-form.tsx`, `apps/web/src/components/auth/accept-invite-form.tsx`
- Create: `apps/web/src/app/[locale]/login/page.tsx`, `apps/web/src/app/[locale]/accept-invite/page.tsx`
- Create: `apps/web/src/app/[locale]/forbidden/page.tsx`, `apps/web/src/app/[locale]/error.tsx`
- Modify: `apps/web/src/middleware.ts` (protection : redirige vers login si pas de cookie access sur routes app)
- Test: `apps/web/src/components/auth/__tests__/login-form.test.tsx`

**Interfaces:**
- Consumes: `LoginInput`, `AcceptInviteInput` (`@wabagent/contracts`), `useRouter`/`Link` (`@/i18n/routing`), `Button` (Task 3), messages i18n (Task 4).
- Produces: `<LoginForm>` (POST `/api/auth/login`, succès → redirige `/`), `<AcceptInviteForm token>` (POST `/api/auth/accept-invite`).

- [ ] **Step 1: Écrire le test `apps/web/src/components/auth/__tests__/login-form.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { LoginForm } from '../login-form';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push }), Link: (p: { children: React.ReactNode }) => p.children }));

beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); });

function renderForm() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

test('erreur de validation locale : champ requis, pas d\'appel réseau', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(fetchMock).not.toHaveBeenCalled();
});

test('login réussi : POST puis redirection', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  renderForm();
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'x@y.z');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  expect(push).toHaveBeenCalledWith('/');
});

test('identifiants invalides : message d\'erreur affiché', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
  renderForm();
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'x@y.z');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByText('Identifiants invalides.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- login-form`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `apps/web/src/components/auth/login-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { LoginInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = LoginInput.safeParse({ email, password });
    if (!parsed.success) {
      setError(t('invalidCredentials'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        router.push('/');
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error?.code === 'RATE_LIMITED' ? t('rateLimited') : t('invalidCredentials'));
    } catch {
      setError(t('invalidCredentials'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t('email')}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-md border border-border bg-surface px-3 py-2 text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('password')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-md border border-border bg-surface px-3 py-2 text-fg"
        />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={loading}>{t('submit')}</Button>
    </form>
  );
}
```

Note : le `<label>` enveloppe l'`<input>`, donc `getByLabelText` le retrouve.

- [ ] **Step 4: Relancer le test (passe)**

Run: `npm run -w @wabagent/web test -- login-form`
Expected: PASS.

- [ ] **Step 5: Créer `apps/web/src/components/auth/accept-invite-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AcceptInviteInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';

export function AcceptInviteForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = AcceptInviteInput.safeParse({ token, password });
    if (!parsed.success) {
      setError(t('passwordTooShort'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        router.push('/');
        return;
      }
      setError(t('invalidInvite'));
    } catch {
      setError(t('invalidInvite'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t('newPassword')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-md border border-border bg-surface px-3 py-2 text-fg"
        />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={loading}>{t('acceptSubmit')}</Button>
    </form>
  );
}
```

- [ ] **Step 6: Créer `apps/web/src/app/[locale]/login/page.tsx`**

```tsx
import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-6 font-serif text-2xl text-fg">{t('loginTitle')}</h1>
        <LoginForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Créer `apps/web/src/app/[locale]/accept-invite/page.tsx`**

```tsx
import { useTranslations } from 'next-intl';
import { AcceptInviteForm } from '@/components/auth/accept-invite-form';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptInviteContent token={token ?? ''} />;
}

function AcceptInviteContent({ token }: { token: string }) {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-6 font-serif text-2xl text-fg">{t('acceptInviteTitle')}</h1>
        {token ? (
          <AcceptInviteForm token={token} />
        ) : (
          <p className="text-sm text-danger">{t('invalidInvite')}</p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Créer `apps/web/src/app/[locale]/forbidden/page.tsx`**

```tsx
import { useTranslations } from 'next-intl';

export default function ForbiddenPage() {
  const t = useTranslations('errors');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-bg p-6 text-center">
      <h1 className="font-serif text-3xl text-fg">{t('forbiddenTitle')}</h1>
      <p className="text-muted">{t('forbiddenBody')}</p>
    </main>
  );
}
```

- [ ] **Step 9: Créer l'error boundary `apps/web/src/app/[locale]/error.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <h1 className="font-serif text-2xl text-fg">{t('errors.genericTitle')}</h1>
      <Button onClick={reset}>{t('common.retry')}</Button>
    </main>
  );
}
```

- [ ] **Step 10: Mettre à jour `apps/web/src/middleware.ts` (protection routes)**

```ts
import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { ACCESS_COOKIE } from './lib/session';

const intl = createMiddleware(routing);

const PUBLIC_SEGMENTS = ['login', 'accept-invite', 'forbidden'];

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean); // [locale, ...rest]
  const locale = routing.locales.includes(segments[0] as 'fr' | 'en') ? segments[0] : routing.defaultLocale;
  const rest = routing.locales.includes(segments[0] as 'fr' | 'en') ? segments.slice(1) : segments;
  const isPublic = rest.length === 0 ? false : PUBLIC_SEGMENTS.includes(rest[0]);

  if (!isPublic && !request.cookies.get(ACCESS_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }
  return intl(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

Note : la racine `/[locale]` (rest vide) est considérée protégée (dashboard) → redirige login si pas de cookie. La présence du cookie suffit à laisser passer ; la validité réelle est vérifiée côté serveur par `engineFetch` (401 → refresh/login).

- [ ] **Step 11: Tests + typecheck + build**

Run: `npm run -w @wabagent/web test && npm run -w @wabagent/web typecheck && npm run -w @wabagent/web build`
Expected: tous verts ; build génère login/accept-invite/forbidden pour fr+en.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(web): pages auth (login, accept-invite) + protection de routes"
```

---

## Task 8: Shell authentifié (layout app, sidebar, header, locale switch, theme toggle, first-run)

**Files:**
- Create: `apps/web/src/components/shell/sidebar.tsx`, `.../header.tsx`, `.../locale-switch.tsx`, `.../theme-toggle.tsx`, `.../user-menu.tsx`
- Create: `apps/web/src/app/[locale]/(app)/layout.tsx`, `apps/web/src/app/[locale]/(app)/page.tsx`
- Remove: `apps/web/src/app/[locale]/page.tsx` (provisoire → remplacée par la route group `(app)`)
- Test: `apps/web/src/components/shell/__tests__/theme-toggle.test.tsx`, `.../locale-switch.test.tsx`

**Interfaces:**
- Consumes: `useTheme` (next-themes), `usePathname`/`useRouter`/`Link` (`@/i18n/routing`), `Button` (Task 3), `useTranslations`/`useLocale` (next-intl), lucide icons.
- Produces: shell complet rendu par le layout `(app)`.

- [ ] **Step 1: Écrire le test `apps/web/src/components/shell/__tests__/theme-toggle.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { ThemeToggle } from '../theme-toggle';

const setTheme = vi.fn();
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme }) }));

beforeEach(() => setTheme.mockReset());

test('bascule light → dark', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ThemeToggle />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Changer de thème' }));
  expect(setTheme).toHaveBeenCalledWith('dark');
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- theme-toggle`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `apps/web/src/components/shell/theme-toggle.tsx`**

```tsx
'use client';

import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations('theme');
  const isDark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('toggle')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
```

- [ ] **Step 4: Relancer le test (passe)**

Run: `npm run -w @wabagent/web test -- theme-toggle`
Expected: PASS.

- [ ] **Step 5: Écrire le test `apps/web/src/components/shell/__tests__/locale-switch.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { LocaleSwitch } from '../locale-switch';

const replace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  usePathname: () => '/agents',
  useRouter: () => ({ replace }),
}));

beforeEach(() => replace.mockReset());

test('bascule fr → en sur le même chemin', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <LocaleSwitch />
    </NextIntlClientProvider>,
  );
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Langue' }), 'en');
  expect(replace).toHaveBeenCalledWith('/agents', { locale: 'en' });
});
```

- [ ] **Step 6: Lancer le test (échoue)**

Run: `npm run -w @wabagent/web test -- locale-switch`
Expected: FAIL.

- [ ] **Step 7: Créer `apps/web/src/components/shell/locale-switch.tsx`**

```tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { routing } from '@/i18n/routing';

export function LocaleSwitch() {
  const locale = useLocale();
  const t = useTranslations('locale');
  const pathname = usePathname();
  const router = useRouter();
  return (
    <select
      aria-label={t('switch')}
      value={locale}
      onChange={(e) => router.replace(pathname, { locale: e.target.value as 'fr' | 'en' })}
      className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>{l.toUpperCase()}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 8: Relancer le test (passe)**

Run: `npm run -w @wabagent/web test -- locale-switch`
Expected: PASS.

- [ ] **Step 9: Créer `apps/web/src/components/shell/user-menu.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function UserMenu() {
  const t = useTranslations('auth');
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <Button variant="ghost" size="sm" onClick={logout} aria-label={t('logout')}>
      <LogOut className="h-4 w-4" />
      {t('logout')}
    </Button>
  );
}
```

- [ ] **Step 10: Créer `apps/web/src/components/shell/sidebar.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { Bot, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/', key: 'agents', icon: Bot },
  { href: '/usage', key: 'usage', icon: BarChart3 },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <aside className="flex w-56 flex-col gap-1 border-r border-border bg-surface p-4">
      <span className="mb-4 px-2 font-serif text-lg text-brand">WABAGENT</span>
      {items.map(({ href, key, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-fg hover:bg-bg',
            pathname === href && 'bg-accent-soft font-medium',
          )}
        >
          <Icon className="h-4 w-4" />
          {t(key)}
        </Link>
      ))}
    </aside>
  );
}
```

- [ ] **Step 11: Créer `apps/web/src/components/shell/header.tsx`**

```tsx
import { LocaleSwitch } from './locale-switch';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function Header() {
  return (
    <header className="flex items-center justify-end gap-3 border-b border-border bg-surface px-6 py-3">
      <LocaleSwitch />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
```

- [ ] **Step 12: Créer le layout app `apps/web/src/app/[locale]/(app)/layout.tsx`**

```tsx
import { Sidebar } from '@/components/shell/sidebar';
import { Header } from '@/components/shell/header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 13: Créer la page first-run `apps/web/src/app/[locale]/(app)/page.tsx` et supprimer le provisoire**

```bash
git rm apps/web/src/app/[locale]/page.tsx
```

```tsx
import { useTranslations } from 'next-intl';

export default function FirstRunPage() {
  const t = useTranslations('firstRun');
  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-border bg-surface p-8">
      <h1 className="font-serif text-3xl text-fg">{t('welcome')}</h1>
      <p className="mt-2 text-muted">{t('subtitle')}</p>
    </section>
  );
}
```

- [ ] **Step 14: Tests + typecheck + build**

Run: `npm run -w @wabagent/web test && npm run -w @wabagent/web typecheck && npm run -w @wabagent/web build`
Expected: tous verts ; build OK.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(web): shell authentifie (sidebar, header, locale switch, theme toggle, first-run)"
```

---

## Task 9: e2e Playwright (login + accept-invite)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/login.spec.ts`, `apps/web/e2e/accept-invite.spec.ts`, `apps/web/e2e/mock-engine.ts`

**Interfaces:**
- Consumes: l'app `apps/web` buildée + servie ; un engine mocké local.
- Produces: 2 specs e2e vertes sans dépendre d'un vrai engine.

**Approche :** pour rester déterministe et sans vrai engine, l'app sous test pointe `ENGINE_API_URL` vers un petit serveur mock lancé par Playwright (`webServer` x2 : le mock + `next start`). Le mock implémente login/accept-invite/refresh/logout/me.

- [ ] **Step 1: Créer le mock engine `apps/web/e2e/mock-engine.ts`**

```ts
import { createServer } from 'node:http';

const PORT = 4999;

function send(res: import('node:http').ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

const user = { id: 1, email: 'demo@wabagent.test', role: 'client_admin', client_id: 'c1', status: 'active' };

createServer(async (req, res) => {
  const url = req.url ?? '';
  if (url.endsWith('/auth/login')) {
    const body = (await readBody(req)) as { email: string; password: string };
    if (body.email === 'demo@wabagent.test' && body.password === 'motdepasse12') {
      return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    }
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/accept-invite')) {
    const body = (await readBody(req)) as { token: string; password: string };
    if (body.token === 'invite-ok' && body.password.length >= 10) {
      return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    }
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/me')) return send(res, 200, user);
  if (url.endsWith('/auth/logout')) return send(res, 204);
  return send(res, 404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
}).listen(PORT, () => console.log(`[MockEngine] http://localhost:${PORT}`));
```

- [ ] **Step 2: Créer `apps/web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3002' },
  webServer: [
    {
      command: 'npx tsx e2e/mock-engine.ts',
      port: 4999,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && npx next start -p 3002',
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: { ENGINE_API_URL: 'http://localhost:4999/api/admin/v1' },
      timeout: 120_000,
    },
  ],
});
```

Note : `tsx` est déjà dispo à la racine du monorepo (dépendance engine), résolu via npm workspaces.

- [ ] **Step 3: Créer `apps/web/e2e/login.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('login échoue avec un mauvais mot de passe', async ({ page }) => {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('mauvais-mdp1');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toHaveText('Identifiants invalides.');
});

test('login réussit et atterrit sur le shell', async ({ page }) => {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenue sur WABAGENT' })).toBeVisible();
});

test('route protégée sans session → redirige vers login', async ({ page }) => {
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr\/login$/);
});
```

- [ ] **Step 4: Créer `apps/web/e2e/accept-invite.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('accept-invite avec token valide active le compte', async ({ page }) => {
  await page.goto('/fr/accept-invite?token=invite-ok');
  await page.getByLabel('Nouveau mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Activer mon compte' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenue sur WABAGENT' })).toBeVisible();
});

test('accept-invite sans token affiche une erreur', async ({ page }) => {
  await page.goto('/fr/accept-invite');
  await expect(page.getByText('Invitation invalide ou expirée.')).toBeVisible();
});
```

- [ ] **Step 5: Installer les navigateurs Playwright**

Run: `npx -w @wabagent/web playwright install chromium`
Expected: Chromium installé.

- [ ] **Step 6: Lancer les e2e**

Run: `npm run -w @wabagent/web test:e2e`
Expected: 5 tests verts (3 login + 2 accept-invite).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(web): e2e Playwright login + accept-invite (engine mocke)"
```

---

## Notes d'exécution

- **Ordre des cookies / `next/headers`** : `cookies()` est async en Next 15 ; tous les helpers `session.ts` l'attendent. Dans les route handlers, modifier les cookies via `cookies()` fonctionne (contexte de requête).
- **`engineFetch` dans les Server Components** (Plans 6-7) : utilisable directement ; sur `EngineError` UNAUTHORIZED non récupérable, faire `redirect('/login')`. Hors scope Plan 5 (aucun Server Component ne consomme encore l'API métier).
- **Pas de vrai engine requis** pour la suite `apps/web` : tous les tests unit/composant/BFF mockent `fetch`/`next/headers` ; les e2e mockent l'engine via un serveur HTTP local.
- **Suite engine inchangée** : aucune tâche ne touche le comportement runtime ; seule la Task 1 déplace `contracts` (vérifié par `npm run typecheck` + `npm test` racine verts).
```
