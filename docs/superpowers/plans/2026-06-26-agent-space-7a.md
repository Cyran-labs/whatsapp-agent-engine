# Plan 7a — Espace agent (lecture) + recalage charte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer l'accueil minimal du Plan 6 en tableau de bord lecture seule (table d'agents + Vue d'ensemble + Usage & coûts par agent + Usage global) et recaler l'app sur la charte canonique Émeraude·Ambre (chrome bandeau émeraude + rail latéral clair + tokens complets).

**Architecture:** Aucune évolution engine — toutes les données viennent d'endpoints admin déjà livrés (`/bots`, `/bots/:id/{health,metrics,usage,leads}`). Nouvelles route handlers BFF Next.js (proxy `engineFetch`, cookie httpOnly, aucun token exposé), dont deux agrégateurs serveur (`/api/bots/summary`, `/api/usage/summary`). Le shell blanc du Plan 5 (sidebar + header) est remplacé par un bandeau supérieur émeraude global + un rail latéral clair dans l'espace agent.

**Tech Stack:** Next 15 (App Router, `[locale]` + `(app)` groups), React 19, next-intl 3.26, next-themes, Tailwind 3.4, Zod, lucide-react, Vitest 4 + Testing Library, Playwright 1.49.

## Global Constraints

- Author git : `Francois Greze <francois@cyran.fr>` — JAMAIS de signature Claude/Anthropic.
- TypeScript strict : pas de `any`, `const` par défaut.
- Logs : format `[Service] message`, sans emoji.
- Textes FR : accents obligatoires (é è ê à â ù û ô ç î ï). Identifiants/code en ASCII.
- **Aucun gradient** dans l'app (règle actée) — barres de graphes en aplats.
- Aucune écriture engine en 7a (lecture seule ; création = wizard Plan 6 conservé).
- Aucun nouvel endpoint engine. Aucun token exposé au navigateur ou loggé.
- Pas de référence aux thématiques de la démo Cyran (golf/immo/voyage/auto/acquisition).
- Source de vérité visuelle : `marketing/design-reference-emeraude-menthe.html` + maquettes validées `.superpowers/brainstorm/31100-1782405346/content/` (`02-agents-table-charte.html`, `03-chrome-topbar.html`, `04-agent-space-overview.html`, `05-usage-couts.html`). **Suivre au pixel, ne pas approximer.**
- Titres `font-serif` (Georgia, graisse `normal`) — jamais `font-bold`/`font-semibold` sur un titre serif.
- i18n FR + EN à parité pour tout nouvel écran. Le contenu utilisateur (noms, transcripts) n'est pas traduit.
- Tests d'abord (TDD) ; commits fréquents par tâche.

## Décision actée (2026-06-26)

Colonnes chiffrées de la table d'agents et Usage global = **agrégation côté BFF** (route serveur Next appelant `/bots` puis `/metrics` ou `/usage` par agent). La colonne s'intitule **« Messages »** (total cumulé `messages_total`), pas « Messages 30 j » — fidèle à la donnée réellement disponible.

## Mapping des tokens (référence pour toutes les tâches UI)

Noms sémantiques **conservés** du Plan 5 : `bg`, `surface`, `fg`(=text), `muted`(=text-secondary), `muted-2`(=text-muted), `border`, `accent`(+hover/soft/fg), `brand`(+deep/mint), `success`, `danger`, `warning`, `neutral`.
Tokens **ajoutés** en 7a : `surface-subtle`, `border-strong`, `tertiary`(+soft), `success-soft`, `danger-soft`, `warning-soft`.
Classes Tailwind correspondantes utilisées dans les composants : `bg-bg`, `bg-surface`, `bg-surface-subtle`, `text-fg`, `text-muted`, `text-muted-2`, `border-border`, `border-border-strong`, `bg-accent`, `bg-accent-soft`, `text-accent-hover`, `text-accent-fg`, `bg-brand-deep`, `bg-brand`, `text-brand-mint`, `bg-success-soft`, `bg-danger-soft`, `bg-warning-soft`, `rounded-sm|md|lg|xl|pill`, `shadow-sm|md|lg`.

Correspondance maquette → token (les maquettes HTML emploient `--text/--text-secondary/--text-muted` ; dans le code ce sont `fg/muted/muted-2`).

---

## Structure des fichiers

**Recalage charte**
- Modifier `apps/web/src/app/globals.css` — `:root` + `.dark` complets.
- Modifier `apps/web/tailwind.config.ts` — exposer nouveaux tokens, échelle radius, shadows.

**Chrome**
- Créer `apps/web/src/components/shell/top-bar.tsx` — bandeau émeraude (logo + nav globale OU fil d'Ariane + actions).
- Créer `apps/web/src/components/shell/top-bar-actions.tsx` — langue + thème + avatar en style sur-sombre (réutilise locale-switch/theme-toggle/user-menu adaptés).
- Modifier `apps/web/src/app/[locale]/(app)/layout.tsx` — assemblage autour du top bar.
- Supprimer `apps/web/src/components/shell/sidebar.tsx` et `header.tsx` (+ leurs tests).

**Composants agents (racine)**
- Créer `apps/web/src/components/agents/status-pill.tsx` — pastille statut (active/draft/paused).
- Créer `apps/web/src/components/agents/agents-table.tsx`.
- Créer `apps/web/src/components/agents/setup-banner.tsx`.
- Modifier `apps/web/src/app/[locale]/(app)/page.tsx` — 0 bot → first-run (conservé) ; ≥1 bot → table + bande mise en route.
- Étendre `apps/web/src/lib/onboarding.ts` — type `AgentSummaryRow`.

**BFF**
- Créer `apps/web/src/app/api/bots/[botId]/health/route.ts`, `metrics/route.ts`, `usage/route.ts`, `leads/route.ts`.
- Créer `apps/web/src/app/api/bots/summary/route.ts` — agrégateur table.
- Créer `apps/web/src/app/api/usage/summary/route.ts` — agrégateur usage global.

**Espace agent**
- Créer `apps/web/src/components/agent/agent-sections.ts` — constantes des 6 sections du rail.
- Créer `apps/web/src/components/agent/agent-rail.tsx`.
- Créer `apps/web/src/app/[locale]/(app)/agents/[botId]/layout.tsx`.
- Créer `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx` — Vue d'ensemble.
- Créer `apps/web/src/app/[locale]/(app)/agents/[botId]/usage/page.tsx` — Usage & coûts.
- Créer `apps/web/src/components/agent/overview.tsx` (+ `health-panel.tsx`, `recent-conversations.tsx`, `cost-card.tsx`, `shortcuts.tsx`).
- Créer `apps/web/src/components/agent/usage-view.tsx`.
- Créer `apps/web/src/components/ui/bar-chart.tsx` — barres en aplats, sans gradient.
- Créer `apps/web/src/components/agent/simulate-panel.tsx` — réutilise le simulateur Plan 6.

**Usage global**
- Créer `apps/web/src/app/[locale]/(app)/usage/page.tsx` + `apps/web/src/components/usage/usage-summary-table.tsx`.

**i18n**
- Modifier `apps/web/messages/fr.json` + `apps/web/messages/en.json` — namespaces `agents`, `agentSpace`, `overview`, `usage`, et extension `nav`.

**Tests e2e**
- Modifier `apps/web/e2e/mock-engine.ts` — endpoints health/metrics/usage/leads.
- Créer `apps/web/e2e/agent-space.spec.ts`.

---

## Pré-requis de vérification (lecture, pas une tâche)

Avant la Task 1, l'implémenteur confirme la forme réelle des réponses engine en lisant `packages/contracts/src/dashboard.ts` et `src/api/admin/routes/dashboard.ts`. Formes attendues (issues de l'exploration) :

```ts
// GET /bots → tableau direct de bots (status, numbers, languages, default_language, name, slug, bot_id, system_prompt)
// GET /bots/:id/health → BotHealth
interface BotHealth {
  status: string;
  numbers: string[];
  languages: string[];
  whatsapp: { validated: boolean; validated_at: string | null; error: string | null };
  crm: { configured: boolean; connector: string | null; last_error: string | null; last_error_at: string | null };
  llm: { mode: string; key_configured: boolean };
}
// GET /bots/:id/metrics → BotMetrics
interface BotMetrics { leads_total: number; rdv_total: number; conversations_total: number; messages_total: number }
// GET /bots/:id/usage → UsageData
interface UsageData {
  totals: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number; calls: number };
  by_model: Array<{ model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>;
  by_day: Array<{ day: string; cost_usd: number; calls: number }>;
}
// GET /bots/:id/leads?page&page_size&search&rdv → { leads: Array<LeadRow & {qualified_data}>, total, page, page_size }
```

Si une forme diffère, signaler avant d'implémenter (ne pas inventer).

---

## Task 1 : Recalage charte (tokens + Tailwind + typo)

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`
- Test: `apps/web/src/lib/__tests__/theme-tokens.test.ts` (créer)

**Interfaces:**
- Produces: classes Tailwind tokenisées consommées par toutes les tâches suivantes (`bg-surface-subtle`, `border-border-strong`, `bg-success-soft`, `bg-danger-soft`, `bg-warning-soft`, `text-tertiary`, `rounded-sm|md|lg|xl|pill`, `shadow-sm|md|lg`).

- [ ] **Step 1 : Écrire le test de présence des tokens**

Le test lit `globals.css` et vérifie que les tokens canoniques et corrections sont présents (garde-fou anti-régression contre la dérive Plan 5).

```ts
// apps/web/src/lib/__tests__/theme-tokens.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

test('globals.css porte les tokens canoniques (clair)', () => {
  expect(css).toMatch(/--border:\s*#DCE5DF/);          // corrige #E2E8E4
  expect(css).toMatch(/--border-strong:\s*#C5D2C8/);
  expect(css).toMatch(/--surface-subtle:\s*#F4F8EE/);
  expect(css).toMatch(/--tertiary:\s*#BE5A4E/);
  expect(css).toMatch(/--success-soft:\s*#D1FAE5/);
  expect(css).toMatch(/--danger-soft:\s*#FEE2E2/);
  expect(css).toMatch(/--warning-soft:\s*#FEF3C7/);
  expect(css).toMatch(/--sh-sm:\s*0 1px 3px rgba\(20,50,42,\.05\)/);
  expect(css).toMatch(/--sh-lg:\s*0 8px 28px rgba\(20,50,42,\.14\)/);
  expect(css).toMatch(/--r-sm:\s*4px/);
  expect(css).toMatch(/--r-pill:\s*999px/);
});

test('globals.css ne contient aucun gradient', () => {
  expect(css).not.toMatch(/gradient/i);
});

test('globals.css porte les tokens sombres recalés', () => {
  expect(css).toMatch(/--surface:\s*#122620/);
  expect(css).toMatch(/--border:\s*#1E463B/);
});
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `cd apps/web && npx vitest run src/lib/__tests__/theme-tokens.test.ts`
Expected: FAIL (tokens absents/incorrects).

- [ ] **Step 3 : Mettre à jour `globals.css`**

Remplacer le bloc `:root` et `.dark` par les valeurs canoniques (conserver `--font-*` et l'éventuelle couche `@layer base`). Valeurs clair :

```css
:root {
  --brand-deep: #14322A;
  --brand: #1E463B;
  --brand-mint: #6EE7B7;
  --accent: #F59E0B;
  --accent-hover: #D97706;
  --accent-soft: #FEF3C7;
  --accent-fg: #14322A;
  --bg: #F1F5F2;
  --surface: #FFFFFF;
  --surface-subtle: #F4F8EE;
  --border: #DCE5DF;
  --border-strong: #C5D2C8;
  --fg: #14322A;
  --muted: #44524B;
  --muted-2: #8A998F;
  --tertiary: #BE5A4E;
  --tertiary-soft: #FCE7F3;
  --success: #10B981;
  --success-soft: #D1FAE5;
  --danger: #DC2626;
  --danger-soft: #FEE2E2;
  --warning: #F59E0B;
  --warning-soft: #FEF3C7;
  --neutral: #8A998F;
  --neutral-status: #8A998F;
  --sh-sm: 0 1px 3px rgba(20,50,42,.05);
  --sh-md: 0 2px 8px rgba(20,50,42,.07);
  --sh-lg: 0 8px 28px rgba(20,50,42,.14);
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;
  --r-xl: 13px;
  --r-pill: 999px;
  --radius: 13px;
}
.dark {
  --bg: #0C1A15;
  --surface: #122620;
  --surface-subtle: #16302A;
  --border: #1E463B;
  --border-strong: #2A5A4B;
  --fg: #E6EFEA;
  --muted: #A7BBB1;
  --muted-2: #7E938A;
  --accent-hover: #FBBF24;
  /* brand/accent/success/danger/warning + ombres : identiques au clair */
}
```

- [ ] **Step 4 : Mettre à jour `tailwind.config.ts`**

Étendre `theme.extend.colors` avec les nouveaux tokens (en conservant les sémantiques existants), l'échelle `borderRadius` explicite et `boxShadow`. `fontWeight` des titres reste géré dans les composants.

```ts
// extrait theme.extend
colors: {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  'surface-subtle': 'var(--surface-subtle)',
  fg: 'var(--fg)',
  muted: 'var(--muted)',
  'muted-2': 'var(--muted-2)',
  border: 'var(--border)',
  'border-strong': 'var(--border-strong)',
  accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', soft: 'var(--accent-soft)', fg: 'var(--accent-fg)' },
  brand: { DEFAULT: 'var(--brand)', deep: 'var(--brand-deep)', mint: 'var(--brand-mint)' },
  tertiary: { DEFAULT: 'var(--tertiary)', soft: 'var(--tertiary-soft)' },
  success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
  danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
  warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
  neutral: 'var(--neutral)',
},
borderRadius: { sm: '4px', md: '6px', lg: '10px', xl: '13px', pill: '999px' },
boxShadow: { sm: 'var(--sh-sm)', md: 'var(--sh-md)', lg: 'var(--sh-lg)' },
```

Note : `success`/`danger`/`warning` deviennent des objets `{DEFAULT, soft}`. Vérifier que les usages existants `bg-success`/`text-danger` continuent de résoudre (`DEFAULT`). Si un composant Plan 6 utilisait `bg-warning` simple, il reste valide.

- [ ] **Step 5 : Migrer les teintes hex arbitraires du Plan 6**

Rechercher et remplacer les hex inline introduits au Plan 6 par des classes tokenisées :

Run: `cd apps/web && grep -rn "bg-\[#" src/ ; grep -rni "font-bold\|font-semibold" src/components/wizard src/components/agents 2>/dev/null`
Pour chaque `bg-[#EAF2EE]`/`bg-[#DCF7E3]`/etc. → `bg-surface-subtle` ou `bg-success-soft` selon l'intention. Pour tout titre `font-serif` portant `font-bold`/`font-semibold` → retirer la graisse (laisser `normal`).

- [ ] **Step 6 : Lancer test + build**

Run: `cd apps/web && npx vitest run src/lib/__tests__/theme-tokens.test.ts && npx tsc --noEmit`
Expected: PASS + 0 erreur de types.

- [ ] **Step 7 : Commit**

```bash
git add apps/web/src/app/globals.css apps/web/tailwind.config.ts apps/web/src/lib/__tests__/theme-tokens.test.ts apps/web/src
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): recalage charte 7a — tokens canoniques + echelle radius/ombres + typo editoriale"
```

---

## Task 2 : Chrome — bandeau supérieur émeraude

**Files:**
- Create: `apps/web/src/components/shell/top-bar.tsx`
- Create: `apps/web/src/components/shell/top-bar-actions.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/layout.tsx`
- Delete: `apps/web/src/components/shell/sidebar.tsx`, `apps/web/src/components/shell/header.tsx` (+ tests associés sous `apps/web/src/components/shell/__tests__/`)
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `nav`)
- Test: `apps/web/src/components/shell/__tests__/top-bar.test.tsx` (créer)

**Interfaces:**
- Consumes: tokens Task 1.
- Produces: `<TopBar variant="root" | "agent" agentName?={string} />` ; le layout `(app)` fournit le top bar global. Réf visuelle : `03-chrome-topbar.html` (racine) + `04-agent-space-overview.html` lignes 99-104 (fil d'Ariane).

- [ ] **Step 1 : Clés i18n `nav`**

Étendre le namespace `nav` (FR puis EN à parité) :

```json
// fr.json → "nav"
{ "agents": "Agents", "usage": "Usage & coûts", "settings": "Paramètres", "comingSoon": "à venir", "breadcrumbAgents": "Agents" }
// en.json → "nav"
{ "agents": "Agents", "usage": "Usage & costs", "settings": "Settings", "comingSoon": "coming soon", "breadcrumbAgents": "Agents" }
```

- [ ] **Step 2 : Écrire le test top-bar**

```tsx
// apps/web/src/components/shell/__tests__/top-bar.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { TopBar } from '../top-bar';

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{ui}</NextIntlClientProvider>);
}

test('variant root : logo + nav globale', () => {
  wrap(<TopBar variant="root" />);
  expect(screen.getByText('WABAGENT')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents' })).toBeInTheDocument();
  expect(screen.getByText('Usage & coûts')).toBeInTheDocument();
});

test('variant agent : fil d Ariane avec le nom', () => {
  wrap(<TopBar variant="agent" agentName="Support" />);
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents' })).toBeInTheDocument();
});
```

- [ ] **Step 3 : Lancer le test (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/shell/__tests__/top-bar.test.tsx`
Expected: FAIL (module `../top-bar` introuvable).

- [ ] **Step 4 : Implémenter `top-bar-actions.tsx`**

Regroupe langue/thème/avatar en style sur-sombre (boutons `border-brand text-brand-mint/70`). Réutilise la logique existante de `locale-switch.tsx`, `theme-toggle.tsx`, `user-menu.tsx` (mêmes appels), en surchargeant les classes pour le fond émeraude.

```tsx
'use client';
import { LocaleSwitch } from './locale-switch';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function TopBarActions() {
  return (
    <div className="flex items-center gap-3">
      <div className="text-brand-mint/80"><LocaleSwitch /></div>
      <div className="text-brand-mint/80"><ThemeToggle /></div>
      <UserMenu />
    </div>
  );
}
```

(Si `locale-switch`/`theme-toggle` ont des classes claires en dur, ajouter une prop `tone?: 'dark'` ou envelopper ; ne pas casser leur usage. Le plus simple : enrober dans un conteneur et viser via classes utilitaires.)

- [ ] **Step 5 : Implémenter `top-bar.tsx`**

```tsx
import { Link } from '@/i18n/routing';
import { getTranslations } from 'next-intl/server';
import { TopBarActions } from './top-bar-actions';

type Props =
  | { variant: 'root'; activeNav?: 'agents' | 'usage' }
  | { variant: 'agent'; agentName: string };

export async function TopBar(props: Props) {
  const t = await getTranslations('nav');
  return (
    <header className="flex h-[60px] flex-shrink-0 items-center gap-2.5 bg-brand-deep px-[22px] text-[#E6EFEA]">
      <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-[0.4px]">
        <span className="h-[11px] w-[11px] rounded-full bg-brand-mint" aria-hidden="true" />
        WABAGENT
      </Link>

      {props.variant === 'root' ? (
        <nav className="ml-3.5 flex items-center gap-1 text-[13.5px]">
          <Link href="/" className={`rounded-md px-3 py-1.5 ${props.activeNav !== 'usage' ? 'bg-brand text-[#E6EFEA]' : 'text-[#A7BBB1] hover:text-[#E6EFEA]'}`}>{t('agents')}</Link>
          <Link href="/usage" className={`rounded-md px-3 py-1.5 ${props.activeNav === 'usage' ? 'bg-brand text-[#E6EFEA]' : 'text-[#A7BBB1] hover:text-[#E6EFEA]'}`}>{t('usage')}</Link>
          <span className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[#A7BBB1]/60">{t('settings')}<span className="rounded-pill border border-brand px-2 py-px text-[9.5px] uppercase tracking-wide">{t('comingSoon')}</span></span>
        </nav>
      ) : (
        <nav className="ml-3.5 flex items-center gap-2 text-[13.5px] text-[#A7BBB1]">
          <Link href="/" className="hover:text-[#E6EFEA]">{t('breadcrumbAgents')}</Link>
          <span aria-hidden="true">›</span>
          <b className="font-semibold text-[#E6EFEA]">{props.agentName}</b>
        </nav>
      )}

      <div className="flex-1" />
      <TopBarActions />
    </header>
  );
}
```

Note : couleurs sur-sombres (`#E6EFEA`, `#A7BBB1`) viennent de la maquette ; on les laisse en hex pour le chrome émeraude (hors palette tokenisée des surfaces claires, comme dans la réf).

- [ ] **Step 6 : Réarchitecturer `(app)/layout.tsx`**

```tsx
import { TopBar } from '@/components/shell/top-bar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-bg">
      <TopBar variant="root" />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

Note : l'espace agent (Task 6) fournira son PROPRE layout imbriqué avec `TopBar variant="agent"` + rail ; pour éviter un double top bar, la racine `(app)/layout.tsx` ne doit PAS forcer le top bar root sur les routes agent. Solution retenue : déplacer le `TopBar variant="root"` dans la page racine et l'éventuel layout `/usage`, et laisser `(app)/layout.tsx` ne contenir que `<div className="flex h-screen flex-col bg-bg">{children}</div>`. **Décision d'implémentation** : `(app)/layout.tsx` ne rend que le conteneur ; chaque sous-arbre (racine, /usage, /agents/[botId]) rend son propre `TopBar`. Documenter ce choix dans le rapport.

- [ ] **Step 7 : Supprimer sidebar/header + tests morts**

Run: `cd apps/web && git rm src/components/shell/sidebar.tsx src/components/shell/header.tsx` ; supprimer les tests `__tests__/sidebar.test.tsx`/`header.test.tsx` s'ils existent. Vérifier qu'aucun import résiduel ne subsiste :
Run: `grep -rn "shell/sidebar\|shell/header" apps/web/src`
Expected: aucun résultat.

- [ ] **Step 8 : Tests + types**

Run: `cd apps/web && npx vitest run src/components/shell && npx tsc --noEmit`
Expected: PASS + 0 erreur.

- [ ] **Step 9 : Commit**

```bash
git add -A apps/web
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): chrome 7a — bandeau superieur emeraude (nav globale + fil d Ariane), remplace sidebar/header blancs"
```

---

## Task 3 : Composant `status-pill`

**Files:**
- Create: `apps/web/src/components/agents/status-pill.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `agents.status`)
- Test: `apps/web/src/components/agents/__tests__/status-pill.test.tsx`

**Interfaces:**
- Produces: `<StatusPill status={string} />`. Mappe `active`→succès, `draft`→ambre, `paused`/autre→neutre. Réf : `02-agents-table-charte.html` lignes 75-79.

- [ ] **Step 1 : Clés i18n `agents.status`**

```json
// fr.json → "agents": { "status": { "active": "Actif", "draft": "Brouillon", "paused": "En pause" } , ... }
// en.json → "agents": { "status": { "active": "Active", "draft": "Draft", "paused": "Paused" } , ... }
```

- [ ] **Step 2 : Écrire le test**

```tsx
// apps/web/src/components/agents/__tests__/status-pill.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { StatusPill } from '../status-pill';

const wrap = (s: string) => render(<NextIntlClientProvider locale="fr" messages={messages}><StatusPill status={s} /></NextIntlClientProvider>);

test('active → libellé Actif + classe succès', () => {
  const { container } = wrap('active');
  expect(screen.getByText('Actif')).toBeInTheDocument();
  expect(container.querySelector('.bg-success-soft')).toBeTruthy();
});
test('draft → Brouillon', () => { wrap('draft'); expect(screen.getByText('Brouillon')).toBeInTheDocument(); });
test('paused → En pause', () => { wrap('paused'); expect(screen.getByText('En pause')).toBeInTheDocument(); });
```

- [ ] **Step 3 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/agents/__tests__/status-pill.test.tsx`
Expected: FAIL.

- [ ] **Step 4 : Implémenter**

```tsx
import { useTranslations } from 'next-intl';

const STYLE: Record<string, string> = {
  active: 'bg-success-soft text-[#0a7a55]',
  draft: 'bg-accent-soft text-accent-hover',
  paused: 'bg-surface-subtle text-muted-2',
};

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('agents.status');
  const cls = STYLE[status] ?? STYLE.paused;
  const label = ['active', 'draft', 'paused'].includes(status) ? t(status) : status;
  return (
    <span className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-semibold ${cls}`}>
      <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
```

- [ ] **Step 5 : Lancer (succès)**

Run: `cd apps/web && npx vitest run src/components/agents/__tests__/status-pill.test.tsx`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/components/agents/status-pill.tsx apps/web/src/components/agents/__tests__/status-pill.test.tsx apps/web/messages
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): composant status-pill (actif/brouillon/pause)"
```

---

## Task 4 : BFF — proxies dashboard par agent

**Files:**
- Create: `apps/web/src/app/api/bots/[botId]/health/route.ts`
- Create: `apps/web/src/app/api/bots/[botId]/metrics/route.ts`
- Create: `apps/web/src/app/api/bots/[botId]/usage/route.ts`
- Create: `apps/web/src/app/api/bots/[botId]/leads/route.ts`
- Test: `apps/web/src/app/api/bots/[botId]/__tests__/dashboard-routes.test.ts`

**Interfaces:**
- Consumes: `engineFetch` (`@/lib/engine-fetch`), `errorResponse` (`@/lib/api-response`).
- Produces: `GET /api/bots/:id/{health,metrics,usage,leads}` qui proxient les endpoints engine homonymes. `usage` et `leads` propagent les query params (`since` ; `page`,`page_size`,`search`,`rdv`).

- [ ] **Step 1 : Écrire les tests BFF**

```ts
// apps/web/src/app/api/bots/[botId]/__tests__/dashboard-routes.test.ts
import { vi, test, expect, beforeEach } from 'vitest';

const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));

beforeEach(() => engineFetch.mockReset());

test('health proxy', async () => {
  engineFetch.mockResolvedValue({ status: 'active' });
  const { GET } = await import('../health/route');
  const res = await GET(new Request('http://x'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/health');
  expect(await res.json()).toEqual({ status: 'active' });
});

test('usage propage le query since', async () => {
  engineFetch.mockResolvedValue({ totals: {} });
  const { GET } = await import('../usage/route');
  await GET(new Request('http://x/api/bots/b1/usage?since=2026-06-01'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/usage?since=2026-06-01');
});

test('leads propage page_size + search', async () => {
  engineFetch.mockResolvedValue({ leads: [] });
  const { GET } = await import('../leads/route');
  await GET(new Request('http://x/api/bots/b1/leads?page=1&page_size=3&search=jean'), { params: Promise.resolve({ botId: 'b1' }) });
  expect(engineFetch).toHaveBeenCalledWith('/bots/b1/leads?page=1&page_size=3&search=jean');
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run "src/app/api/bots/[botId]/__tests__/dashboard-routes.test.ts"`
Expected: FAIL (routes introuvables).

- [ ] **Step 3 : Implémenter `health/route.ts` et `metrics/route.ts`**

```ts
// health/route.ts
import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(_req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    return NextResponse.json(await engineFetch(`/bots/${botId}/health`));
  } catch (err) {
    return errorResponse(err);
  }
}
```

`metrics/route.ts` identique en remplaçant `health` par `metrics`.

- [ ] **Step 4 : Implémenter `usage/route.ts` et `leads/route.ts` (avec query)**

```ts
// usage/route.ts
import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const since = new URL(req.url).searchParams.get('since');
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return NextResponse.json(await engineFetch(`/bots/${botId}/usage${qs}`));
  } catch (err) {
    return errorResponse(err);
  }
}
```

```ts
// leads/route.ts
import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

const ALLOWED = ['page', 'page_size', 'search', 'rdv'] as const;

export async function GET(req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const src = new URL(req.url).searchParams;
    const out = new URLSearchParams();
    for (const k of ALLOWED) { const v = src.get(k); if (v !== null) out.set(k, v); }
    const qs = out.toString();
    return NextResponse.json(await engineFetch(`/bots/${botId}/leads${qs ? `?${qs}` : ''}`));
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5 : Lancer (succès)**

Run: `cd apps/web && npx vitest run "src/app/api/bots/[botId]/__tests__/dashboard-routes.test.ts" && npx tsc --noEmit`
Expected: PASS + 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add "apps/web/src/app/api/bots/[botId]"
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web/bff): proxies dashboard par agent (health/metrics/usage/leads)"
```

---

## Task 5 : BFF — agrégateurs `summary`

**Files:**
- Create: `apps/web/src/app/api/bots/summary/route.ts`
- Create: `apps/web/src/app/api/usage/summary/route.ts`
- Test: `apps/web/src/app/api/bots/__tests__/summary.test.ts`, `apps/web/src/app/api/usage/__tests__/summary.test.ts`

**Interfaces:**
- Consumes: `engineFetch`, `errorResponse`.
- Produces:
  - `GET /api/bots/summary` → `AgentSummaryRow[]` : `{ bot_id, name, slug, status, languages, default_language, numbers, messages_total, leads_total }`.
  - `GET /api/usage/summary?since` → `{ rows: Array<{ bot_id, name, calls, input_tokens, output_tokens, cost_usd }>, total: { calls, input_tokens, output_tokens, cost_usd } }`.
- Note : agrégation séquentielle simple (peu d'agents). Si un appel par-agent échoue, le bot est inclus avec métriques à 0 (ne pas faire échouer toute la table).

- [ ] **Step 1 : Écrire les tests**

```ts
// apps/web/src/app/api/bots/__tests__/summary.test.ts
import { vi, test, expect, beforeEach } from 'vitest';
const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => engineFetch.mockReset());

test('agrège bots + metrics par agent', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'active', languages: ['fr'], default_language: 'fr', numbers: ['+33'] }]);
    if (path === '/bots/b1/metrics') return Promise.resolve({ messages_total: 142, leads_total: 23, rdv_total: 0, conversations_total: 0 });
    return Promise.reject(new Error('x'));
  });
  const { GET } = await import('../summary/route');
  const res = await GET();
  const rows = await res.json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 142, leads_total: 23 });
});

test('metrics en échec → métriques à 0, bot conservé', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A', slug: 'a', status: 'draft', languages: ['fr'], default_language: 'fr', numbers: [] }]);
    return Promise.reject(new Error('boom'));
  });
  const { GET } = await import('../summary/route');
  const rows = await (await GET()).json();
  expect(rows[0]).toMatchObject({ bot_id: 'b1', messages_total: 0, leads_total: 0 });
});
```

```ts
// apps/web/src/app/api/usage/__tests__/summary.test.ts
import { vi, test, expect, beforeEach } from 'vitest';
const engineFetch = vi.fn();
vi.mock('@/lib/engine-fetch', () => ({ engineFetch: (...a: unknown[]) => engineFetch(...a), EngineError: class extends Error {} }));
beforeEach(() => engineFetch.mockReset());

test('agrège usage par agent + total', async () => {
  engineFetch.mockImplementation((path: string) => {
    if (path === '/bots') return Promise.resolve([{ bot_id: 'b1', name: 'A' }, { bot_id: 'b2', name: 'B' }]);
    if (path.startsWith('/bots/b1/usage')) return Promise.resolve({ totals: { calls: 10, input_tokens: 100, output_tokens: 20, cost_usd: 1 } });
    if (path.startsWith('/bots/b2/usage')) return Promise.resolve({ totals: { calls: 5, input_tokens: 50, output_tokens: 10, cost_usd: 0.5 } });
    return Promise.reject(new Error('x'));
  });
  const { GET } = await import('../summary/route');
  const body = await (await GET(new Request('http://x/api/usage/summary'))).json();
  expect(body.total).toMatchObject({ calls: 15, cost_usd: 1.5 });
  expect(body.rows).toHaveLength(2);
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/app/api/bots/__tests__/summary.test.ts src/app/api/usage/__tests__/summary.test.ts`
Expected: FAIL.

- [ ] **Step 3 : Implémenter `bots/summary/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

interface RawBot { bot_id: string; name: string; slug?: string; status: string; languages?: string[]; default_language?: string; numbers?: string[] }

export async function GET(): Promise<NextResponse> {
  try {
    const bots = (await engineFetch('/bots')) as RawBot[];
    const rows = [];
    for (const b of bots) {
      let messages_total = 0;
      let leads_total = 0;
      try {
        const m = (await engineFetch(`/bots/${b.bot_id}/metrics`)) as { messages_total?: number; leads_total?: number };
        messages_total = m.messages_total ?? 0;
        leads_total = m.leads_total ?? 0;
      } catch {
        // métriques indisponibles : bot conservé avec 0
      }
      rows.push({
        bot_id: b.bot_id, name: b.name, slug: b.slug ?? '', status: b.status,
        languages: b.languages ?? [], default_language: b.default_language ?? '',
        numbers: b.numbers ?? [], messages_total, leads_total,
      });
    }
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4 : Implémenter `usage/summary/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

interface RawBot { bot_id: string; name: string }
interface Totals { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const since = new URL(req.url).searchParams.get('since');
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    const bots = (await engineFetch('/bots')) as RawBot[];
    const rows = [];
    const total: Totals = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    for (const b of bots) {
      let tt: Totals = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
      try {
        const u = (await engineFetch(`/bots/${b.bot_id}/usage${qs}`)) as { totals?: Partial<Totals> };
        tt = { calls: u.totals?.calls ?? 0, input_tokens: u.totals?.input_tokens ?? 0, output_tokens: u.totals?.output_tokens ?? 0, cost_usd: u.totals?.cost_usd ?? 0 };
      } catch {
        // usage indisponible : 0
      }
      rows.push({ bot_id: b.bot_id, name: b.name, ...tt });
      total.calls += tt.calls; total.input_tokens += tt.input_tokens; total.output_tokens += tt.output_tokens; total.cost_usd += tt.cost_usd;
    }
    return NextResponse.json({ rows, total });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5 : Lancer (succès)**

Run: `cd apps/web && npx vitest run src/app/api/bots/__tests__/summary.test.ts src/app/api/usage/__tests__/summary.test.ts && npx tsc --noEmit`
Expected: PASS + 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/app/api/bots/summary apps/web/src/app/api/usage apps/web/src/app/api/bots/__tests__
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web/bff): agregateurs summary (table agents + usage global) cote serveur"
```

---

## Task 6 : Table d'agents + bande « Mise en route » + refonte accueil

**Files:**
- Modify: `apps/web/src/lib/onboarding.ts` (type `AgentSummaryRow`)
- Create: `apps/web/src/components/agents/agents-table.tsx`
- Create: `apps/web/src/components/agents/setup-banner.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/page.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `agents`)
- Test: `apps/web/src/components/agents/__tests__/agents-table.test.tsx`, `setup-banner.test.tsx`

**Interfaces:**
- Consumes: `StatusPill` (Task 3), `deriveChecklist` (`@/lib/onboarding`), `GET /api/bots/summary` (Task 5).
- Produces: `<AgentsTable rows={AgentSummaryRow[]} />`, `<SetupBanner checklist={ChecklistState} hasActive={boolean} />`.
- `AgentSummaryRow = { bot_id, name, slug, status, languages, default_language, numbers, messages_total, leads_total }`.
Réf : `02-agents-table-charte.html`.

- [ ] **Step 1 : Clés i18n `agents`**

```json
// fr.json → "agents"
{
  "title": "Agents",
  "count": "{count, plural, =0 {Aucun agent} one {# agent} other {# agents}}",
  "create": "+ Créer un agent",
  "colAgent": "Agent", "colStatus": "Statut", "colLanguages": "Langues",
  "colNumber": "Numéro WhatsApp", "colMessages": "Messages", "colLeads": "Leads",
  "notConnected": "— non connecté",
  "setupTitle": "Mise en route",
  "setupSubtitle": "Votre premier agent n'est pas encore en ligne",
  "stepCreated": "Créé", "stepPersonalized": "Personnalisé", "stepConnect": "Connecter WhatsApp", "stepActivate": "Activer",
  "connectCta": "Connecter WhatsApp",
  "status": { "active": "Actif", "draft": "Brouillon", "paused": "En pause" }
}
// en.json → équivalents EN (count avec plural en anglais, "coming soon" si besoin).
```

- [ ] **Step 2 : Type `AgentSummaryRow` dans `onboarding.ts`**

Ajouter (sans casser `BotSummary`/`deriveChecklist`) :

```ts
export interface AgentSummaryRow {
  bot_id: string;
  name: string;
  slug: string;
  status: string;
  languages: string[];
  default_language: string;
  numbers: string[];
  messages_total: number;
  leads_total: number;
}
```

- [ ] **Step 3 : Écrire les tests**

```tsx
// agents-table.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentsTable } from '../agents-table';
import type { AgentSummaryRow } from '@/lib/onboarding';

const rows: AgentSummaryRow[] = [
  { bot_id: 'b1', name: 'Support', slug: 'support', status: 'active', languages: ['fr'], default_language: 'fr', numbers: ['+33612000047'], messages_total: 142, leads_total: 23 },
  { bot_id: 'b2', name: 'Boutique', slug: 'boutique', status: 'draft', languages: ['fr', 'en'], default_language: 'fr', numbers: [], messages_total: 0, leads_total: 0 },
];
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><AgentsTable rows={rows} /></NextIntlClientProvider>);

test('rend une ligne par agent + lien vers l espace agent', () => {
  wrap();
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByText('Boutique')).toBeInTheDocument();
  expect(screen.getAllByRole('link').some((a) => a.getAttribute('href')?.includes('/agents/b1'))).toBe(true);
});
test('agent non connecté → mention non connecté', () => {
  wrap();
  expect(screen.getByText('— non connecté')).toBeInTheDocument();
});
test('métriques affichées', () => { wrap(); expect(screen.getByText('142')).toBeInTheDocument(); expect(screen.getByText('23')).toBeInTheDocument(); });
```

```tsx
// setup-banner.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { SetupBanner } from '../setup-banner';

const wrap = (hasActive: boolean) =>
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <SetupBanner checklist={{ created: true, personalized: true, connected: false, active: hasActive }} hasActive={hasActive} />
  </NextIntlClientProvider>);

test('affichée tant qu aucun agent actif', () => { const { container } = wrap(false); expect(screen.getByText('Mise en route')).toBeInTheDocument(); expect(container.firstChild).not.toBeNull(); });
test('masquée quand un agent est actif', () => { const { container } = wrap(true); expect(container.firstChild).toBeNull(); });
test('CTA Connecter WhatsApp désactivé (7c)', () => { wrap(false); const btn = screen.getByRole('button', { name: /Connecter WhatsApp/ }); expect(btn).toBeDisabled(); });
```

- [ ] **Step 4 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/agents/__tests__/agents-table.test.tsx src/components/agents/__tests__/setup-banner.test.tsx`
Expected: FAIL.

- [ ] **Step 5 : Implémenter `setup-banner.tsx`**

```tsx
'use client';
import { useTranslations } from 'next-intl';
import type { ChecklistState } from '@/lib/onboarding';

const STEPS = [
  { key: 'created', label: 'stepCreated' },
  { key: 'personalized', label: 'stepPersonalized' },
  { key: 'connected', label: 'stepConnect' },
  { key: 'active', label: 'stepActivate' },
] as const;

export function SetupBanner({ checklist, hasActive }: { checklist: ChecklistState; hasActive: boolean }) {
  const t = useTranslations('agents');
  if (hasActive) return null;
  return (
    <div className="mb-7 flex items-center gap-5 rounded-xl border border-border border-l-[3px] border-l-accent bg-surface px-5 py-4 shadow-sm">
      <div className="font-serif text-[17px]">
        {t('setupTitle')}
        <small className="mt-px block font-sans text-[12.5px] text-muted-2">{t('setupSubtitle')}</small>
      </div>
      <div className="flex flex-1 justify-center gap-5">
        {STEPS.map((s, i) => {
          const done = checklist[s.key];
          const isNext = !done && STEPS.slice(0, i).every((p) => checklist[p.key]);
          const tone = done ? 'text-fg' : isNext ? 'font-semibold text-accent-hover' : 'text-muted-2';
          const dot = done ? 'bg-success text-white' : isNext ? 'border border-accent bg-accent-soft text-accent-hover' : 'border border-border-strong bg-surface-subtle text-muted-2';
          return (
            <div key={s.key} className={`flex items-center gap-2 text-[13px] ${tone}`}>
              <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-pill text-[10px] font-bold ${dot}`}>{done ? '✓' : i + 1}</span>
              {t(s.label)}
            </div>
          );
        })}
      </div>
      <button type="button" disabled className="cursor-not-allowed rounded-md bg-accent px-[18px] py-2.5 font-bold text-accent-fg opacity-50" title={t('setupSubtitle')}>
        {t('connectCta')}
      </button>
    </div>
  );
}
```

- [ ] **Step 6 : Implémenter `agents-table.tsx`**

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { StatusPill } from './status-pill';
import type { AgentSummaryRow } from '@/lib/onboarding';

function maskNumber(n: string): string {
  if (!n) return '';
  return n.length > 6 ? `${n.slice(0, 5)} •• •• ${n.slice(-2)}` : n;
}

export function AgentsTable({ rows }: { rows: AgentSummaryRow[] }) {
  const t = useTranslations('agents');
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['colAgent', 'colStatus', 'colLanguages', 'colNumber', 'colMessages', 'colLeads'].map((k) => (
              <th key={k} className="border-b border-border px-[18px] py-[13px] text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2">{t(k)}</th>
            ))}
            <th className="border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const num = r.numbers[0] ?? '';
            return (
              <tr key={r.bot_id} className="cursor-pointer border-t border-border first:border-t-0 hover:bg-surface-subtle">
                <td className="px-[18px] py-[15px] align-middle">
                  <Link href={`/agents/${r.bot_id}`} className="block">
                    <div className="font-serif text-base text-fg">{r.name}</div>
                    <div className="mt-px font-mono text-[11.5px] text-muted-2">{r.slug}</div>
                  </Link>
                </td>
                <td className="px-[18px] py-[15px]"><StatusPill status={r.status} /></td>
                <td className="px-[18px] py-[15px] text-[13px] text-muted">{r.languages.map((l) => l.toUpperCase()).join(' · ')}</td>
                <td className="px-[18px] py-[15px]">{num ? <span className="font-mono text-[12.5px]">{maskNumber(num)}</span> : <span className="text-muted-2">{t('notConnected')}</span>}</td>
                <td className={`px-[18px] py-[15px] font-semibold ${num ? '' : 'text-muted-2'}`}>{num ? r.messages_total : '—'}</td>
                <td className={`px-[18px] py-[15px] font-semibold ${num ? '' : 'text-muted-2'}`}>{num ? r.leads_total : '—'}</td>
                <td className="px-[18px] py-[15px] text-right text-base text-muted-2">›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7 : Refondre `page.tsx`**

0 bot → first-run (le bloc « parcours » existant est conservé tel quel). ≥1 bot → `SetupBanner` + en-tête + `AgentsTable`. Fetch `/api/bots/summary`.

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { deriveChecklist, type AgentSummaryRow, type ChecklistState } from '@/lib/onboarding';
import { SetupBanner } from '@/components/agents/setup-banner';
import { AgentsTable } from '@/components/agents/agents-table';
import { TopBar } from '@/components/shell/top-bar';
import { FirstRun } from '@/components/agents/first-run'; // extrait du JSX 0-bot existant

export default function Home() {
  const t = useTranslations('agents');
  const [rows, setRows] = useState<AgentSummaryRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/bots/summary').then((r) => (r.ok ? r.json() : [])).then((d) => { if (alive) setRows(d as AgentSummaryRow[]); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  const list = rows ?? [];
  const checklist: ChecklistState = deriveChecklist(list.map((r) => ({ bot_id: r.bot_id, name: r.name, status: r.status, default_language: r.default_language, languages: r.languages, system_prompt: {} })));
  // NB: personalized via system_prompt absent ici → voir Step 8.
  const hasActive = list.some((r) => r.status === 'active');

  if (rows !== null && list.length === 0) return (<><TopBar variant="root" /><main className="p-6"><FirstRun /></main></>);

  return (
    <>
      <TopBar variant="root" activeNav="agents" />
      <main className="overflow-auto p-9">
        <div className="mx-auto max-w-[1000px]">
          {rows !== null && <SetupBanner checklist={checklist} hasActive={hasActive} />}
          <div className="mb-[18px] flex items-end justify-between">
            <div>
              <h1 className="font-serif text-[28px] leading-none text-fg">{t('title')}</h1>
              <div className="mt-1 text-[13px] text-muted-2">{t('count', { count: list.length })}</div>
            </div>
            <Link href="/agents/new" className="rounded-md bg-accent px-[18px] py-2.5 font-bold text-accent-fg hover:bg-accent-hover">{t('create')}</Link>
          </div>
          <AgentsTable rows={list} />
        </div>
      </main>
    </>
  );
}
```

Décision : extraire le JSX du cas 0-bot actuel (le bloc « parcours » + CTA) dans `apps/web/src/components/agents/first-run.tsx` (préserver le namespace `onboarding` existant). C'est un simple déplacement, pas un changement de comportement.

- [ ] **Step 8 : Ajuster `deriveChecklist` pour le summary**

`deriveChecklist` exige `system_prompt` pour `personalized`. Le summary ne le porte pas. Décision : ajouter à `AgentSummaryRow` un booléen `personalized` calculé côté BFF (`summary/route.ts`) à partir de `GET /bots` (chaque bot a `system_prompt`), et faire dériver `SetupBanner` directement de ce flag + `hasActive`. Mettre à jour : (a) `summary/route.ts` ajoute `personalized: !!(b.system_prompt?.[b.default_language]?.trim())` ; (b) le test summary (Task 5) — ajouter l'assertion ; (c) `page.tsx` construit `checklist` depuis `{ created: list.length>0, personalized: list.some(r=>r.personalized), connected:false, active:hasActive }` sans rappeler `deriveChecklist`. **Cette sous-étape modifie aussi Task 5** : l'implémenteur Task 6 ajoute le champ et son test.

- [ ] **Step 9 : Lancer tests + types**

Run: `cd apps/web && npx vitest run src/components/agents && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10 : Commit**

```bash
git add apps/web/src/components/agents apps/web/src/lib/onboarding.ts "apps/web/src/app/[locale]/(app)/page.tsx" apps/web/src/app/api/bots/summary apps/web/messages
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): accueil 7a — table d agents + bande mise en route (>=1 bot), first-run conserve (0 bot)"
```

---

## Task 7 : Composant `bar-chart` (aplats, sans gradient)

**Files:**
- Create: `apps/web/src/components/ui/bar-chart.tsx`
- Test: `apps/web/src/components/ui/__tests__/bar-chart.test.tsx`

**Interfaces:**
- Produces: `<BarChart data={number[]} labels?={string[]} highlightIndex?={number} className?={string} />` — hauteurs proportionnelles au max, barre `highlightIndex` en `bg-accent`, autres en `bg-brand`, coins hauts `rounded-sm`. Aucun gradient.
Réf : `04` lignes 90-93, `05` lignes 59-62.

- [ ] **Step 1 : Écrire le test**

```tsx
// bar-chart.test.tsx
import { render } from '@testing-library/react';
import { test, expect } from 'vitest';
import { BarChart } from '../bar-chart';

test('hauteurs proportionnelles au max', () => {
  const { container } = render(<BarChart data={[5, 10, 0]} />);
  const bars = container.querySelectorAll('[data-bar]');
  expect(bars).toHaveLength(3);
  expect((bars[0] as HTMLElement).style.height).toBe('50%');
  expect((bars[1] as HTMLElement).style.height).toBe('100%');
  expect((bars[2] as HTMLElement).style.height).toBe('0%');
});
test('aucun gradient', () => {
  const { container } = render(<BarChart data={[1, 2]} highlightIndex={1} />);
  expect(container.innerHTML).not.toMatch(/gradient/i);
  expect(container.querySelectorAll('.bg-accent')).toHaveLength(1);
});
test('max=0 → toutes barres à 0%', () => {
  const { container } = render(<BarChart data={[0, 0]} />);
  container.querySelectorAll('[data-bar]').forEach((b) => expect((b as HTMLElement).style.height).toBe('0%'));
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/ui/__tests__/bar-chart.test.tsx`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

```tsx
export function BarChart({ data, labels, highlightIndex, className }: { data: number[]; labels?: string[]; highlightIndex?: number; className?: string }) {
  const max = Math.max(0, ...data);
  return (
    <div className={className}>
      <div className="flex items-end gap-1.5" style={{ height: 80 }}>
        {data.map((v, i) => (
          <div
            key={i}
            data-bar
            className={`flex-1 rounded-t-sm ${i === highlightIndex ? 'bg-accent' : 'bg-brand'}`}
            style={{ height: max > 0 ? `${Math.round((v / max) * 100)}%` : '0%' }}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-1.5 flex gap-1.5 text-[9px] text-muted-2">
          {labels.map((l, i) => <span key={i} className="flex-1 text-center">{l}</span>)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer (succès)**

Run: `cd apps/web && npx vitest run src/components/ui/__tests__/bar-chart.test.tsx`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/components/ui/bar-chart.tsx apps/web/src/components/ui/__tests__/bar-chart.test.tsx
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): composant bar-chart (aplats, sans gradient, hauteurs proportionnelles)"
```

---

## Task 8 : Coquille espace agent (rail latéral + layout)

**Files:**
- Create: `apps/web/src/components/agent/agent-sections.ts`
- Create: `apps/web/src/components/agent/agent-rail.tsx`
- Create: `apps/web/src/app/[locale]/(app)/agents/[botId]/layout.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `agentSpace`)
- Test: `apps/web/src/components/agent/__tests__/agent-rail.test.tsx`

**Interfaces:**
- Consumes: `TopBar variant="agent"` (Task 2), `StatusPill` (Task 3), `GET /api/bots/:id` (existant), `GET /api/bots/:id/health` (Task 4).
- Produces: `AGENT_SECTIONS` (constantes), `<AgentRail botId activeKey agentName status />`, layout `/agents/[botId]` rendant top bar + rail + zone contenu.
Réf : `04-agent-space-overview.html` lignes 40-118.

- [ ] **Step 1 : Clés i18n `agentSpace`**

```json
// fr.json → "agentSpace"
{
  "overview": "Vue d'ensemble",
  "conversations": "Conversations & Leads",
  "personality": "Personnalité & contenu",
  "connections": "Connexions",
  "usage": "Usage & coûts",
  "settings": "Paramètres",
  "comingSoon": "à venir"
}
// en.json → équivalents EN.
```

- [ ] **Step 2 : `agent-sections.ts`**

```ts
export interface AgentSection { key: string; i18n: string; href: string | null; icon: string; soon: boolean }

// href relatif au segment /agents/[botId] ; null => non navigable
export const AGENT_SECTIONS: AgentSection[] = [
  { key: 'overview', i18n: 'overview', href: '', icon: '▤', soon: false },
  { key: 'conversations', i18n: 'conversations', href: null, icon: '💬', soon: true },
  { key: 'personality', i18n: 'personality', href: null, icon: '✦', soon: true },
  { key: 'connections', i18n: 'connections', href: null, icon: '🔗', soon: true },
  { key: 'usage', i18n: 'usage', href: 'usage', icon: '▦', soon: false },
  { key: 'settings', i18n: 'settings', href: null, icon: '⚙', soon: true },
];
```

- [ ] **Step 3 : Écrire le test rail**

```tsx
// agent-rail.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentRail } from '../agent-rail';

const wrap = (active: string) => render(
  <NextIntlClientProvider locale="fr" messages={messages}>
    <AgentRail botId="b1" activeKey={active} agentName="Support" status="active" />
  </NextIntlClientProvider>);

test('6 sections affichées', () => { wrap('overview'); ['Vue d\'ensemble', 'Conversations & Leads', 'Personnalité & contenu', 'Connexions', 'Usage & coûts', 'Paramètres'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument()); });
test('sections actives = liens, "à venir" = non-liens', () => {
  wrap('overview');
  const links = screen.getAllByRole('link');
  expect(links.some((a) => a.getAttribute('href')?.endsWith('/agents/b1'))).toBe(true);
  expect(links.some((a) => a.getAttribute('href')?.endsWith('/agents/b1/usage'))).toBe(true);
  expect(screen.getAllByText('à venir')).toHaveLength(4);
});
test('nom + statut de l agent dans l entête du rail', () => { wrap('overview'); expect(screen.getByText('Support')).toBeInTheDocument(); expect(screen.getByText('Actif')).toBeInTheDocument(); });
```

- [ ] **Step 4 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/agent/__tests__/agent-rail.test.tsx`
Expected: FAIL.

- [ ] **Step 5 : Implémenter `agent-rail.tsx`**

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { StatusPill } from '@/components/agents/status-pill';
import { AGENT_SECTIONS } from './agent-sections';

export function AgentRail({ botId, activeKey, agentName, status }: { botId: string; activeKey: string; agentName: string; status: string }) {
  const t = useTranslations('agentSpace');
  return (
    <aside className="w-[236px] flex-shrink-0 overflow-auto border-r border-border bg-surface p-[18px_12px]">
      <div className="mb-3 border-b border-border px-2.5 pb-4 pt-1.5">
        <div className="font-serif text-lg leading-tight">{agentName}</div>
        <div className="mt-1.5"><StatusPill status={status} /></div>
      </div>
      {AGENT_SECTIONS.map((s) => {
        const label = t(s.i18n);
        const isActive = s.key === activeKey;
        const base = 'mb-px flex items-center gap-2.5 rounded-md px-[11px] py-[9px] text-[13.5px]';
        if (s.soon || s.href === null) {
          return (
            <div key={s.key} className={`${base} cursor-default text-muted-2`}>
              <span className="w-4 text-center opacity-80" aria-hidden="true">{s.icon}</span>{label}
              <span className="ml-auto rounded-pill border border-border px-[7px] py-px text-[9.5px] uppercase tracking-wide text-muted-2">{t('comingSoon')}</span>
            </div>
          );
        }
        const href = s.href === '' ? `/agents/${botId}` : `/agents/${botId}/${s.href}`;
        return (
          <Link key={s.key} href={href} className={`${base} ${isActive ? 'bg-surface-subtle font-semibold text-fg shadow-[inset_2px_0_0_var(--accent)]' : 'text-muted hover:bg-surface-subtle'}`}>
            <span className="w-4 text-center opacity-80" aria-hidden="true">{s.icon}</span>{label}
          </Link>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 6 : Implémenter `agents/[botId]/layout.tsx`**

Charge le bot pour l'entête (nom/statut). Le `activeKey` est déterminé par le segment enfant ; on le calcule côté client via un petit wrapper, ou on rend le rail dans chaque page. Décision retenue : le layout charge le bot et fournit top bar + rail, en lisant le segment actif via `usePathname` dans un composant client `AgentShell`.

```tsx
// layout.tsx (server)
import { engineFetch } from '@/lib/engine-fetch';
import { TopBar } from '@/components/shell/top-bar';
import { AgentShell } from '@/components/agent/agent-shell';

export default async function AgentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ botId: string; locale: string }> }) {
  const { botId } = await params;
  let name = ''; let status = 'draft';
  try {
    const bot = (await engineFetch(`/bots/${botId}`)) as { name?: string; status?: string };
    name = bot.name ?? ''; status = bot.status ?? 'draft';
  } catch {
    // bot introuvable : la page enfant gérera l'erreur
  }
  return (
    <div className="flex h-screen flex-col bg-bg">
      <TopBar variant="agent" agentName={name} />
      <AgentShell botId={botId} agentName={name} status={status}>{children}</AgentShell>
    </div>
  );
}
```

```tsx
// apps/web/src/components/agent/agent-shell.tsx (client — calcule activeKey via pathname)
'use client';
import { usePathname } from '@/i18n/routing';
import { AgentRail } from './agent-rail';

export function AgentShell({ botId, agentName, status, children }: { botId: string; agentName: string; status: string; children: React.ReactNode }) {
  const path = usePathname();
  const activeKey = path.endsWith('/usage') ? 'usage' : 'overview';
  return (
    <div className="flex flex-1 overflow-hidden">
      <AgentRail botId={botId} activeKey={activeKey} agentName={agentName} status={status} />
      <div className="flex-1 overflow-auto px-8 py-7">{children}</div>
    </div>
  );
}
```

- [ ] **Step 7 : Lancer tests + types**

Run: `cd apps/web && npx vitest run src/components/agent && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8 : Commit**

```bash
git add apps/web/src/components/agent "apps/web/src/app/[locale]/(app)/agents/[botId]/layout.tsx" apps/web/messages
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): coquille espace agent — rail lateral 6 sections (2 actives, 4 a venir) + layout"
```

---

## Task 9 : Onglet Vue d'ensemble

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx`
- Create: `apps/web/src/components/agent/overview.tsx`
- Create: `apps/web/src/components/agent/health-panel.tsx`
- Create: `apps/web/src/components/agent/recent-conversations.tsx`
- Create: `apps/web/src/components/agent/cost-card.tsx`
- Create: `apps/web/src/components/agent/shortcuts.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `overview`)
- Test: `apps/web/src/components/agent/__tests__/overview.test.tsx`

**Interfaces:**
- Consumes: `BarChart` (Task 7), `StatusPill` (Task 3), `GET /api/bots/:id/{health,metrics,usage,leads}` (Task 4).
- Produces: `<Overview data={OverviewData} botId />`. Données chargées côté client par la page, regroupées en `OverviewData`.
- `OverviewData = { health: BotHealth; metrics: BotMetrics; usage: UsageData; recent: Array<{ phone: string; name: string | null; last: string; qualified: boolean; when: string }> }`.
Réf : `04-agent-space-overview.html`.

- [ ] **Step 1 : Clés i18n `overview`**

```json
// fr.json → "overview"
{
  "healthTitle": "Santé",
  "healthAllOk": "tout est opérationnel",
  "whatsapp": "WhatsApp", "crm": "CRM", "ai": "IA", "languages": "Langues",
  "connected": "Connecté", "notConnected": "Non connecté", "platform": "Plateforme",
  "statMessages": "Messages 30 j", "statLeads": "Leads", "statQualified": "Qualifiés",
  "recentTitle": "Dernières conversations", "seeAll": "voir tout", "qualified": "qualifié", "noRecent": "Aucune conversation",
  "costTitle": "Coût LLM", "costRange": "30 derniers jours", "perDay": "~{amount} $/jour",
  "tokensLine": "{in} tokens in · {out} out · {errors} erreur",
  "shortcutsTitle": "Raccourcis", "simulate": "Tester dans le simulateur", "editPersonality": "Modifier la personnalité",
  "simulateAction": "Simuler", "pauseAction": "Mettre en pause"
}
// en.json → équivalents.
```

- [ ] **Step 2 : Écrire le test overview**

```tsx
// overview.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { Overview } from '../overview';

const data = {
  health: { status: 'active', numbers: ['+33'], languages: ['fr'], whatsapp: { validated: true, validated_at: null, error: null }, crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null }, llm: { mode: 'platform', key_configured: false } },
  metrics: { leads_total: 23, rdv_total: 9, conversations_total: 40, messages_total: 142 },
  usage: { totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 }, by_model: [], by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }] },
  recent: [{ phone: '+33', name: 'ML', last: 'Bonjour', qualified: true, when: '2 min' }],
};
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><Overview data={data} botId="b1" /></NextIntlClientProvider>);

test('santé + stats rendues', () => { wrap(); expect(screen.getByText('Santé')).toBeInTheDocument(); expect(screen.getByText('142')).toBeInTheDocument(); expect(screen.getByText('23')).toBeInTheDocument(); });
test('coût LLM affiché', () => { wrap(); expect(screen.getByText(/1[.,]84/)).toBeInTheDocument(); });
test('dernières conversations', () => { wrap(); expect(screen.getByText(/Bonjour/)).toBeInTheDocument(); });
```

- [ ] **Step 3 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/agent/__tests__/overview.test.tsx`
Expected: FAIL.

- [ ] **Step 4 : Implémenter les sous-composants**

`health-panel.tsx` (4 cartes santé + dots ok/na/pb + grille stats) :

```tsx
import { useTranslations } from 'next-intl';
import type { BotHealth, BotMetrics } from '@/lib/agent-types';

function dotClass(state: 'ok' | 'na' | 'pb') { return state === 'ok' ? 'bg-success' : state === 'pb' ? 'bg-danger' : 'bg-neutral'; }

export function HealthPanel({ health, metrics }: { health: BotHealth; metrics: BotMetrics }) {
  const t = useTranslations('overview');
  const cards = [
    { t: t('whatsapp'), s: health.whatsapp.validated ? t('connected') : t('notConnected'), d: health.whatsapp.validated ? 'ok' as const : 'pb' as const },
    { t: t('crm'), s: health.crm.configured ? (health.crm.connector ?? t('connected')) : t('notConnected'), d: health.crm.configured ? 'ok' as const : 'na' as const },
    { t: t('ai'), s: `${health.llm.mode === 'platform' ? t('platform') : health.llm.mode}`, d: 'na' as const },
    { t: t('languages'), s: health.languages.map((l) => l.toUpperCase()).join(' · '), d: 'na' as const },
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 flex items-baseline justify-between font-serif text-base font-normal">{t('healthTitle')}<span className="font-sans text-[11px] text-muted-2">{t('healthAllOk')}</span></h3>
      <div className="grid grid-cols-2 gap-2.5">
        {cards.map((c, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border p-[11px]">
            <span className={`h-[9px] w-[9px] flex-shrink-0 rounded-full ${dotClass(c.d)}`} aria-hidden="true" />
            <div><div className="text-[13px] font-semibold">{c.t}</div><div className="text-[11.5px] text-muted-2">{c.s}</div></div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[{ k: t('statMessages'), v: metrics.messages_total }, { k: t('statLeads'), v: metrics.leads_total }, { k: t('statQualified'), v: metrics.rdv_total }].map((s, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface-subtle p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-muted-2">{s.k}</div>
            <div className="mt-0.5 font-serif text-2xl">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`recent-conversations.tsx` :

```tsx
import { useTranslations } from 'next-intl';

export interface RecentRow { phone: string; name: string | null; last: string; qualified: boolean; when: string }

export function RecentConversations({ rows }: { rows: RecentRow[] }) {
  const t = useTranslations('overview');
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 flex items-baseline justify-between font-serif text-base font-normal">{t('recentTitle')}<span className="font-sans text-[11px] text-muted-2">{t('seeAll')}</span></h3>
      {rows.length === 0 ? <p className="text-[13px] text-muted-2">{t('noRecent')}</p> : rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] last:border-b-0">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[10px] font-bold text-brand">{(r.name ?? r.phone).slice(0, 2).toUpperCase()}</span>
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted">{r.last}</span>
          {r.qualified && <span className="rounded-pill bg-success-soft px-2 py-px text-[10px] font-semibold text-[#0a7a55]">{t('qualified')}</span>}
          <span className="text-[11px] text-muted-2">{r.when}</span>
        </div>
      ))}
    </div>
  );
}
```

`cost-card.tsx` (utilise `BarChart`) :

```tsx
import { useTranslations } from 'next-intl';
import { BarChart } from '@/components/ui/bar-chart';
import type { UsageData } from '@/lib/agent-types';

export function CostCard({ usage }: { usage: UsageData }) {
  const t = useTranslations('overview');
  const days = usage.by_day.slice(-7);
  const data = days.map((d) => d.cost_usd);
  const hi = data.length ? data.indexOf(Math.max(...data)) : undefined;
  const perDay = usage.by_day.length ? (usage.totals.cost_usd / usage.by_day.length) : 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="flex items-baseline justify-between font-serif text-base font-normal">{t('costTitle')}<span className="font-sans text-[11px] text-muted-2">{t('costRange')}</span></h3>
      <div className="font-serif text-[30px]">{usage.totals.cost_usd.toFixed(2)} $</div>
      <div className="mb-3.5 text-[11.5px] text-muted-2">{t('perDay', { amount: perDay.toFixed(2) })}</div>
      <BarChart data={data} highlightIndex={hi} />
      <div className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-muted-2">
        {t('tokensLine', { in: `${Math.round(usage.totals.input_tokens / 1000)} k`, out: `${Math.round(usage.totals.output_tokens / 1000)} k`, errors: 0 })}
      </div>
    </div>
  );
}
```

`shortcuts.tsx` :

```tsx
'use client';
import { useTranslations } from 'next-intl';

export function Shortcuts({ onSimulate }: { onSimulate: () => void }) {
  const t = useTranslations('overview');
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 font-serif text-base font-normal">{t('shortcutsTitle')}</h3>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={onSimulate} className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-left text-[13px] hover:bg-surface-subtle">💬 {t('simulate')}</button>
        <button type="button" disabled className="flex cursor-not-allowed items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-left text-[13px] opacity-50">✦ {t('editPersonality')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5 : Créer `lib/agent-types.ts` (types partagés)**

```ts
export interface BotHealth { status: string; numbers: string[]; languages: string[]; whatsapp: { validated: boolean; validated_at: string | null; error: string | null }; crm: { configured: boolean; connector: string | null; last_error: string | null; last_error_at: string | null }; llm: { mode: string; key_configured: boolean } }
export interface BotMetrics { leads_total: number; rdv_total: number; conversations_total: number; messages_total: number }
export interface UsageData { totals: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number; calls: number }; by_model: Array<{ model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>; by_day: Array<{ day: string; cost_usd: number; calls: number }> }
```

- [ ] **Step 6 : Implémenter `overview.tsx` (assemble + entête + Simuler)**

```tsx
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/agents/status-pill';
import { HealthPanel } from './health-panel';
import { RecentConversations, type RecentRow } from './recent-conversations';
import { CostCard } from './cost-card';
import { Shortcuts } from './shortcuts';
import { SimulatePanel } from './simulate-panel';
import type { BotHealth, BotMetrics, UsageData } from '@/lib/agent-types';

export interface OverviewData { health: BotHealth; metrics: BotMetrics; usage: UsageData; recent: RecentRow[] }

export function Overview({ data, botId }: { data: OverviewData; botId: string }) {
  const t = useTranslations('overview');
  const [simOpen, setSimOpen] = useState(false);
  const num = data.health.numbers[0] ?? '';
  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 font-serif text-[26px] leading-none">{/* nom géré par le rail/topbar ; ici sous-titre */}</div>
          <div className="mt-1.5 text-[12.5px] text-muted-2">{[num && num, data.health.languages.map((l) => l.toUpperCase()).join(' · ')].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSimOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[13px] hover:bg-surface-subtle">▶ {t('simulateAction')}</button>
          <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[13px] opacity-50">⏸ {t('pauseAction')}</button>
        </div>
      </div>
      <div className="grid grid-cols-[1.7fr_1fr] gap-4">
        <div>
          <HealthPanel health={data.health} metrics={data.metrics} />
          <RecentConversations rows={data.recent} />
        </div>
        <div>
          <CostCard usage={data.usage} />
          <Shortcuts onSimulate={() => setSimOpen(true)} />
        </div>
      </div>
      {simOpen && <SimulatePanel botId={botId} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
```

Note : `StatusPill` import conservé si l'entête le réutilise ; sinon retirer l'import inutilisé (le nom+statut vivent dans le rail). L'implémenteur supprime tout import non utilisé pour respecter `tsc`/lint.

- [ ] **Step 7 : Implémenter la page (chargement données)**

```tsx
// agents/[botId]/page.tsx
'use client';
import { use, useEffect, useState } from 'react';
import { Overview, type OverviewData } from '@/components/agent/overview';
import type { BotHealth, BotMetrics, UsageData } from '@/lib/agent-types';

interface LeadsResp { leads: Array<{ phone: string; name: string | null; qualified_data: unknown; last_message_at: string | null }> }

export default function OverviewPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [data, setData] = useState<OverviewData | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/bots/${botId}/health`).then((r) => r.json()),
      fetch(`/api/bots/${botId}/metrics`).then((r) => r.json()),
      fetch(`/api/bots/${botId}/usage`).then((r) => r.json()),
      fetch(`/api/bots/${botId}/leads?page_size=3`).then((r) => r.json()).catch(() => ({ leads: [] })),
    ]).then(([health, metrics, usage, leads]: [BotHealth, BotMetrics, UsageData, LeadsResp]) => {
      if (!alive) return;
      setData({
        health, metrics, usage,
        recent: (leads.leads ?? []).map((l) => ({ phone: l.phone, name: l.name, last: l.name ?? l.phone, qualified: !!l.qualified_data, when: l.last_message_at ?? '' })),
      });
    }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [botId]);
  if (!data) return <div className="text-sm text-muted-2">…</div>;
  return <Overview data={data} botId={botId} />;
}
```

Note : `recent.last` idéalement = dernier message ; l'endpoint leads ne renvoie pas le dernier texte dans la liste — on affiche le nom/numéro comme libellé (pas de faux contenu). Documenter cette limite (le contenu de message viendra en 7b avec le détail lead).

- [ ] **Step 8 : Lancer tests + types**

Run: `cd apps/web && npx vitest run src/components/agent && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9 : Commit**

```bash
git add apps/web/src/components/agent apps/web/src/lib/agent-types.ts "apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx" apps/web/messages
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): onglet Vue d ensemble — sante + stats + dernieres convs + cout LLM + raccourcis"
```

---

## Task 10 : Onglet Usage & coûts (par agent)

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/agents/[botId]/usage/page.tsx`
- Create: `apps/web/src/components/agent/usage-view.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `usage`)
- Test: `apps/web/src/components/agent/__tests__/usage-view.test.tsx`

**Interfaces:**
- Consumes: `BarChart` (Task 7), `GET /api/bots/:id/usage?since` (Task 4), type `UsageData` (`@/lib/agent-types`).
- Produces: `<UsageView usage={UsageData} period={7|30|90} onPeriod={(p)=>void} />`.
Réf : `05-usage-couts.html`.

- [ ] **Step 1 : Clés i18n `usage`**

```json
// fr.json → "usage"
{
  "title": "Usage & coûts",
  "p7": "7 j", "p30": "30 j", "p90": "90 j",
  "kpiCost": "Coût total", "kpiTokens": "Tokens", "kpiCalls": "Appels LLM",
  "perDay": "~{amount} $/jour", "tokensSplit": "{in} k entrée · {out} k sortie", "noError": "0 erreur",
  "costPerDay": "Coût par jour", "byModel": "Détail par modèle",
  "colModel": "Modèle", "colCalls": "Appels", "colIn": "Tokens in", "colOut": "Tokens out", "colCost": "Coût", "total": "Total"
}
// en.json → équivalents.
```

- [ ] **Step 2 : Écrire le test**

```tsx
// usage-view.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { UsageView } from '../usage-view';

const usage = {
  totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
  by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }],
  by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }],
};
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={usage} period={30} onPeriod={vi.fn()} /></NextIntlClientProvider>);

test('3 KPI rendus', () => { wrap(); expect(screen.getByText('Coût total')).toBeInTheDocument(); expect(screen.getByText('Tokens')).toBeInTheDocument(); expect(screen.getByText('Appels LLM')).toBeInTheDocument(); });
test('table par modèle + total', () => { wrap(); expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument(); expect(screen.getByText('Total')).toBeInTheDocument(); });
test('sélecteur de période', () => { wrap(); expect(screen.getByText('7 j')).toBeInTheDocument(); expect(screen.getByText('90 j')).toBeInTheDocument(); });
```

- [ ] **Step 3 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/agent/__tests__/usage-view.test.tsx`
Expected: FAIL.

- [ ] **Step 4 : Implémenter `usage-view.tsx`**

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { BarChart } from '@/components/ui/bar-chart';
import type { UsageData } from '@/lib/agent-types';

export function UsageView({ usage, period, onPeriod }: { usage: UsageData; period: 7 | 30 | 90; onPeriod: (p: 7 | 30 | 90) => void }) {
  const t = useTranslations('usage');
  const data = usage.by_day.map((d) => d.cost_usd);
  const hi = data.length ? data.indexOf(Math.max(...data)) : undefined;
  const perDay = usage.by_day.length ? usage.totals.cost_usd / usage.by_day.length : 0;
  const periods: Array<7 | 30 | 90> = [7, 30, 90];
  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-serif text-[26px] font-normal">{t('title')}</h1>
        <div className="flex overflow-hidden rounded-md border border-border-strong">
          {periods.map((p) => (
            <button key={p} type="button" onClick={() => onPeriod(p)} className={`px-3.5 py-1.5 text-[13px] ${p === period ? 'bg-brand-deep font-semibold text-[#E6EFEA]' : 'bg-surface text-muted hover:bg-surface-subtle'}`}>{t(`p${p}`)}</button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Kpi k={t('kpiCost')} v={`${usage.totals.cost_usd.toFixed(2)} $`} sub={t('perDay', { amount: perDay.toFixed(2) })} />
        <Kpi k={t('kpiTokens')} v={`${Math.round((usage.totals.input_tokens + usage.totals.output_tokens) / 1000)} k`} sub={t('tokensSplit', { in: Math.round(usage.totals.input_tokens / 1000), out: Math.round(usage.totals.output_tokens / 1000) })} />
        <Kpi k={t('kpiCalls')} v={String(usage.totals.calls)} sub={t('noError')} />
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        <h3 className="mb-4 font-serif text-base font-normal">{t('costPerDay')}</h3>
        <BarChart data={data} highlightIndex={hi} className="[&_.flex]:!h-[140px]" />
      </div>

      <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        <h3 className="mb-4 font-serif text-base font-normal">{t('byModel')}</h3>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="border-b border-border px-2.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-2">{t('colModel')}</th>
            {['colCalls', 'colIn', 'colOut', 'colCost'].map((c) => <th key={c} className="border-b border-border px-2.5 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-muted-2">{t(c)}</th>)}
          </tr></thead>
          <tbody>
            {usage.by_model.map((m) => (
              <tr key={m.model} className="border-t border-border">
                <td className="px-2.5 py-2.5 font-mono text-[12.5px]">{m.model}</td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">{m.calls}</td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">{Math.round(m.input_tokens / 1000)} k</td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">{Math.round(m.output_tokens / 1000)} k</td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">{m.cost_usd.toFixed(2)} $</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border-strong bg-surface-subtle font-bold">
              <td className="px-2.5 py-2.5">{t('total')}</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">{usage.totals.calls}</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">{Math.round(usage.totals.input_tokens / 1000)} k</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">{Math.round(usage.totals.output_tokens / 1000)} k</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">{usage.totals.cost_usd.toFixed(2)} $</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{k}</div>
      <div className="mt-1 font-serif text-[30px]">{v}</div>
      <div className="text-[11.5px] text-muted-2">{sub}</div>
    </div>
  );
}
```

Note : pour la hauteur 140px du graphe d'usage vs 80px de l'overview, ajouter une prop `height?: number` à `BarChart` (mettre à jour Task 7 si nécessaire) plutôt que le hack `[&_.flex]`. **Décision** : ajouter `height = 80` en prop à `BarChart` ; l'implémenteur Task 10 étend le composant + son test (hauteur appliquée au conteneur).

- [ ] **Step 5 : Implémenter la page (période → since)**

```tsx
// agents/[botId]/usage/page.tsx
'use client';
import { use, useEffect, useState } from 'react';
import { UsageView } from '@/components/agent/usage-view';
import type { UsageData } from '@/lib/agent-types';

function sinceFor(days: number): string {
  // since calculé sans Date.now interdit ? Date.now() est autorisé hors workflow-scripts.
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export default function UsagePage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [usage, setUsage] = useState<UsageData | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/bots/${botId}/usage?since=${sinceFor(period)}`).then((r) => r.json()).then((u: UsageData) => { if (alive) setUsage(u); }).catch(() => { if (alive) setUsage(null); });
    return () => { alive = false; };
  }, [botId, period]);
  if (!usage) return <div className="text-sm text-muted-2">…</div>;
  return <UsageView usage={usage} period={period} onPeriod={setPeriod} />;
}
```

(`Date.now()` est interdit uniquement dans les scripts de workflow ; en code applicatif Next il est normal.)

- [ ] **Step 6 : Lancer tests + types**

Run: `cd apps/web && npx vitest run src/components/agent/__tests__/usage-view.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add apps/web/src/components/agent/usage-view.tsx "apps/web/src/app/[locale]/(app)/agents/[botId]/usage" apps/web/src/components/ui/bar-chart.tsx apps/web/src/components/ui/__tests__/bar-chart.test.tsx apps/web/messages
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): onglet Usage & couts par agent — KPI + cout/jour + detail par modele + selecteur periode"
```

---

## Task 11 : Usage & coûts global (nav top bar)

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/usage/page.tsx`
- Create: `apps/web/src/components/usage/usage-summary-table.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `usage` — clés globales)
- Test: `apps/web/src/components/usage/__tests__/usage-summary-table.test.tsx`

**Interfaces:**
- Consumes: `GET /api/usage/summary` (Task 5), `TopBar variant="root" activeNav="usage"` (Task 2).
- Produces: `<UsageSummaryTable rows total />` — une ligne par agent + ligne Total.

- [ ] **Step 1 : Clés i18n `usage` (globales)**

Ajouter au namespace `usage` : `globalTitle` (« Usage & coûts — tous les agents »), `colAgent` (« Agent »). EN à parité.

- [ ] **Step 2 : Écrire le test**

```tsx
// usage-summary-table.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { UsageSummaryTable } from '../usage-summary-table';

const rows = [
  { bot_id: 'b1', name: 'Support', calls: 312, input_tokens: 184000, output_tokens: 39000, cost_usd: 1.84 },
  { bot_id: 'b2', name: 'Boutique', calls: 10, input_tokens: 5000, output_tokens: 1000, cost_usd: 0.1 },
];
const total = { calls: 322, input_tokens: 189000, output_tokens: 40000, cost_usd: 1.94 };
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={rows} total={total} /></NextIntlClientProvider>);

test('une ligne par agent', () => { wrap(); expect(screen.getByText('Support')).toBeInTheDocument(); expect(screen.getByText('Boutique')).toBeInTheDocument(); });
test('ligne Total', () => { wrap(); expect(screen.getByText('Total')).toBeInTheDocument(); expect(screen.getByText(/1[.,]94/)).toBeInTheDocument(); });
```

- [ ] **Step 3 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/usage/__tests__/usage-summary-table.test.tsx`
Expected: FAIL.

- [ ] **Step 4 : Implémenter `usage-summary-table.tsx`**

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

interface Row { bot_id: string; name: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }
interface Total { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }

export function UsageSummaryTable({ rows, total }: { rows: Row[]; total: Total }) {
  const t = useTranslations('usage');
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead><tr>
          <th className="border-b border-border px-[18px] py-3 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-2">{t('colAgent')}</th>
          {['colCalls', 'colIn', 'colOut', 'colCost'].map((c) => <th key={c} className="border-b border-border px-[18px] py-3 text-right text-[10.5px] font-bold uppercase tracking-wide text-muted-2">{t(c)}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bot_id} className="border-t border-border hover:bg-surface-subtle">
              <td className="px-[18px] py-3"><Link href={`/agents/${r.bot_id}/usage`} className="font-serif text-[15px] hover:underline">{r.name}</Link></td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{r.calls}</td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{Math.round(r.input_tokens / 1000)} k</td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{Math.round(r.output_tokens / 1000)} k</td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{r.cost_usd.toFixed(2)} $</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-strong bg-surface-subtle font-bold">
            <td className="px-[18px] py-3">{t('total')}</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{total.calls}</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{Math.round(total.input_tokens / 1000)} k</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{Math.round(total.output_tokens / 1000)} k</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{total.cost_usd.toFixed(2)} $</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5 : Implémenter la page globale**

```tsx
// [locale]/(app)/usage/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TopBar } from '@/components/shell/top-bar';
import { UsageSummaryTable } from '@/components/usage/usage-summary-table';

interface Summary { rows: Array<{ bot_id: string; name: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>; total: { calls: number; input_tokens: number; output_tokens: number; cost_usd: number } }

export default function GlobalUsagePage() {
  const t = useTranslations('usage');
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/usage/summary').then((r) => r.json()).then((d: Summary) => { if (alive) setS(d); }).catch(() => { if (alive) setS(null); });
    return () => { alive = false; };
  }, []);
  return (
    <>
      <TopBar variant="root" activeNav="usage" />
      <main className="overflow-auto p-9">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="mb-5 font-serif text-[28px] font-normal">{t('globalTitle')}</h1>
          {s && <UsageSummaryTable rows={s.rows} total={s.total} />}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 6 : Lancer tests + types**

Run: `cd apps/web && npx vitest run src/components/usage && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add apps/web/src/components/usage "apps/web/src/app/[locale]/(app)/usage" apps/web/messages
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): Usage & couts global — tableau recapitulatif par agent + total (agregation BFF)"
```

---

## Task 12 : Panneau « Simuler » dans l'espace agent

**Files:**
- Create: `apps/web/src/components/agent/simulate-panel.tsx`
- Test: `apps/web/src/components/agent/__tests__/simulate-panel.test.tsx`

**Interfaces:**
- Consumes: l'UI de chat du Plan 6 (`step-test.tsx`) ; `POST /api/bots/:id/simulate` (existant) avec `use_bot_config:false` (gratuit, persona stockée).
- Produces: `<SimulatePanel botId onClose />` — modale légère réutilisant le simulateur.
- Décision : extraire le cœur réutilisable de `step-test.tsx` (zone messages + input + appel simulate) dans un composant partagé `apps/web/src/components/agent/simulate-chat.tsx`, consommé par `simulate-panel.tsx` ET par le wizard `step-test.tsx` (refactor sans changement de comportement). Si le risque de régression du wizard est jugé trop élevé par le reviewer, repli : `SimulatePanel` réimplémente la même logique d'appel (DRY moindre mais isolé). Préférer l'extraction.

- [ ] **Step 1 : Écrire le test**

```tsx
// simulate-panel.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { SimulatePanel } from '../simulate-panel';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ session_id: 's1', reply: 'Bonjour !' }) }))); });

test('envoie un message et affiche la réponse (use_bot_config:false)', async () => {
  render(<NextIntlClientProvider locale="fr" messages={messages}><SimulatePanel botId="b1" onClose={vi.fn()} /></NextIntlClientProvider>);
  await userEvent.type(screen.getByRole('textbox'), 'Salut');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByText('Bonjour !')).toBeInTheDocument());
  const call = (fetch as unknown as vi.Mock).mock.calls[0];
  expect(JSON.parse(call[1].body)).toMatchObject({ use_bot_config: false });
});

test('bouton fermer appelle onClose', async () => {
  const onClose = vi.fn();
  render(<NextIntlClientProvider locale="fr" messages={messages}><SimulatePanel botId="b1" onClose={onClose} /></NextIntlClientProvider>);
  await userEvent.click(screen.getByRole('button', { name: /Fermer|×/ }));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd apps/web && npx vitest run src/components/agent/__tests__/simulate-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3 : Extraire `simulate-chat.tsx` depuis `step-test.tsx`**

Déplacer la logique (état messages, `sessionId`, fonction d'envoi appelant `/api/bots/${botId}/simulate` avec `{ message, use_bot_config: false, session_id }`, rendu bulles) dans `simulate-chat.tsx` exportant `<SimulateChat botId onFinish?={()=>void} />`. Adapter `step-test.tsx` pour le consommer. Vérifier que les tests existants du wizard passent toujours.

Run: `cd apps/web && npx vitest run src/components/wizard/__tests__/step-test.test.tsx`
Expected: PASS (comportement inchangé).

- [ ] **Step 4 : Implémenter `simulate-panel.tsx`**

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { SimulateChat } from './simulate-chat';

export function SimulatePanel({ botId, onClose }: { botId: string; onClose: () => void }) {
  const t = useTranslations('overview');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-deep/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-serif text-base">{t('simulate')}</span>
          <button type="button" aria-label="Fermer" onClick={onClose} className="text-muted-2 hover:text-fg">×</button>
        </div>
        <div className="p-4"><SimulateChat botId={botId} /></div>
      </div>
    </div>
  );
}
```

Note : pas de `confirm()`/`alert()` (règle dialogues). Fond `bg-brand-deep/40` = aplat translucide (pas un gradient).

- [ ] **Step 5 : Lancer tests + types**

Run: `cd apps/web && npx vitest run src/components/agent/__tests__/simulate-panel.test.tsx src/components/wizard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/components/agent/simulate-panel.tsx apps/web/src/components/agent/simulate-chat.tsx apps/web/src/components/wizard/step-test.tsx apps/web/src/components/agent/__tests__/simulate-panel.test.tsx
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "feat(web): panneau Simuler dans l espace agent (reutilise le simulateur gratuit Plan 6)"
```

---

## Task 13 : e2e — mock-engine étendu + parcours espace agent

**Files:**
- Modify: `apps/web/e2e/mock-engine.ts`
- Create: `apps/web/e2e/agent-space.spec.ts`

**Interfaces:**
- Consumes: tout le parcours. Réutilise le mock login existant (`demo@wabagent.test` / `motdepasse12`).
- Le mock doit servir health/metrics/usage/leads + au moins 1 bot pré-existant pour la table.

- [ ] **Step 1 : Étendre `mock-engine.ts`**

Ajouter un bot pré-existant et les endpoints dashboard. Insérer AVANT le `return 404`, et amorcer `bots` avec un agent :

```ts
// remplacer: const bots: Record<string, unknown>[] = [];
const bots: Record<string, unknown>[] = [
  { bot_id: 'demo-1', name: 'Support technique', slug: 'support-technique', status: 'active', languages: ['fr'], default_language: 'fr', numbers: ['+33612000047'], system_prompt: { fr: 'Tu es un agent de support.' } },
];

// endpoints dashboard (avant le 404) :
if (/\/bots\/[^/]+\/health$/.test(url) && method === 'GET') return send(res, 200, { status: 'active', numbers: ['+33612000047'], languages: ['fr'], whatsapp: { validated: true, validated_at: '2026-06-01', error: null }, crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null }, llm: { mode: 'platform', key_configured: false } });
if (/\/bots\/[^/]+\/metrics$/.test(url) && method === 'GET') return send(res, 200, { leads_total: 23, rdv_total: 9, conversations_total: 40, messages_total: 142 });
if (/\/bots\/[^/]+\/usage/.test(url) && method === 'GET') return send(res, 200, { totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 }, by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }], by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }] });
if (/\/bots\/[^/]+\/leads/.test(url) && method === 'GET') return send(res, 200, { leads: [{ phone: '+33611111111', name: 'Marie', qualified_data: { budget: 'x' }, last_message_at: '2 min' }], total: 1, page: 1, page_size: 3 });
// GET /bots/:id (détail, pour le layout agent)
if (/\/bots\/[^/]+$/.test(url) && method === 'GET') { const id = url.split('/').pop(); return send(res, 200, bots.find((b) => b.bot_id === id) ?? bots[0]); }
```

Veiller à l'ordre : le test `\/bots\/[^/]+$` (GET détail) doit être placé APRÈS les routes plus spécifiques (`/health`, `/metrics`...) pour ne pas les capter.

- [ ] **Step 2 : Écrire le parcours e2e**

```ts
// apps/web/e2e/agent-space.spec.ts
import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/fr/login');
  await page.getByLabel(/e-?mail/i).fill('demo@wabagent.test');
  await page.getByLabel(/mot de passe/i).fill('motdepasse12');
  await page.getByRole('button', { name: /connexion|se connecter/i }).click();
  await page.waitForURL('**/fr');
}

test('table d agents → espace agent → Vue d ensemble → Usage', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expect(page.getByText('Support technique')).toBeVisible();

  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await expect(page.getByText('Santé')).toBeVisible();
  await expect(page.getByText('142')).toBeVisible();

  await page.getByRole('link', { name: 'Usage & coûts' }).click();
  await page.waitForURL('**/agents/demo-1/usage');
  await expect(page.getByText('claude-haiku-4-5')).toBeVisible();
  await expect(page.getByText('Total')).toBeVisible();
});
```

Adapter les sélecteurs de login aux labels réels (lire `apps/web/src/components/auth/` si besoin).

- [ ] **Step 3 : Lancer l'e2e**

Run: `cd apps/web && npx playwright test e2e/agent-space.spec.ts`
Expected: PASS (le webServer build + lance Next + mock engine).

- [ ] **Step 4 : Lancer la suite e2e complète (non-régression onboarding)**

Run: `cd apps/web && npx playwright test`
Expected: PASS (onboarding + agent-space).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/e2e
git -c user.name="Francois Greze" -c user.email="francois@cyran.fr" commit -m "test(web/e2e): mock-engine dashboard + parcours table d agents -> espace agent -> usage"
```

---

## Vérification finale (avant remise au PO)

- [ ] `cd apps/web && npx vitest run` → toute la suite unitaire verte.
- [ ] `cd apps/web && npx tsc --noEmit` → 0 erreur de types.
- [ ] `cd apps/web && npx next build` → build OK.
- [ ] `cd apps/web && npx playwright test` → e2e verts.
- [ ] `grep -rn "gradient" apps/web/src` → aucun résultat (règle anti-gradient).
- [ ] `grep -rn "bg-\[#" apps/web/src` → aucune teinte hex arbitraire résiduelle.
- [ ] Revue finale opus sur toute la branche (subagent-driven : code-reviewer).
- [ ] **NE PAS push / merge.** Remettre la branche `feat/agent-space-7a` à François pour : revue PO + validation visuelle au pixel (vs maquettes) + test live engine+web bout-en-bout.

## Self-Review (couverture du spec)

- §3.1 tokens → Task 1. §3.2 typo → Task 1 (step 5). §3.3 chrome → Task 2 + Task 8 (rail). 
- §4.1 API engine → Pré-requis + Tasks 4/5. §4.2 BFF → Tasks 4/5. §4.3 pages/composants → Tasks 6/8/9/10/11/12. §4.4 bande mise en route → Task 6.
- §5 écrans → table (6), chrome (2), vue d'ensemble (9), usage (10) ; Simuler (12). §6 i18n → clés ajoutées dans chaque tâche concernée. §7 tests → unitaires (chaque tâche), BFF (4/5), e2e (13).
- §8 décisions → respectées (3 sous-plans ; chrome ; tokens ; typo ; racine 0/≥1 bot ; 6 sections 2 actives ; usage global agrégé BFF ; aucune écriture engine).
- Écart documenté : colonne « Messages » (cumul) au lieu de « Messages 30 j » (décision PO 2026-06-26). `recent.last` = nom/numéro faute de dernier message dans la liste leads (contenu complet en 7b).
