# Plan 7a — Espace agent (lecture) + recalage charte — Design

Date : 2026-06-25
Statut : validé (brainstorming), prêt pour `writing-plans`.

## 1. Contexte et objectif

Le Plan 7 (espace agent complet, self-service jusqu'au go-live) est découpé en **trois sous-plans** :
- **7a (ce document)** : recalage du chrome sur la charte + table d'agents + coquille de l'espace agent (rail latéral) + onglets *Vue d'ensemble* et *Usage & coûts* (lecture seule).
- **7b** : Conversations & Leads + Personnalité & contenu + Paramètres.
- **7c** : Connexions (WhatsApp BYO + setup guidé + validation) + activation = bot opérationnel.

Objectif 7a : transformer l'accueil minimal du Plan 6 en un **tableau de bord lecture seule utilisable** (liste d'agents + vue d'ensemble + usage/coûts par agent), et **recaler l'app sur la charte canonique** (le shell livré au Plan 5 a dérivé : menus blancs, tokens incomplets).

Aucune évolution de l'engine : toutes les données viennent d'endpoints admin déjà livrés.

## 2. Périmètre

Dans le périmètre (7a) :
- **Recalage charte** : tokens canoniques (`globals.css` + `tailwind.config.ts`) + chrome (bandeau supérieur émeraude, rail latéral dans l'espace agent) + typographie éditoriale. Cf. §3.
- **Table d'agents** (racine) + bande « Mise en route » persistante.
- **Coquille espace agent** : route `/agents/[botId]`, rail latéral des 6 sections (4 grisées « à venir »).
- **Onglet Vue d'ensemble** (santé, métriques, dernières conversations, coût LLM, raccourcis).
- **Onglet Usage & coûts** (par agent : KPI, coût/jour, détail par modèle).
- i18n FR/EN des nouveaux écrans ; tests unitaires + e2e.

Hors périmètre :
- Onglets Conversations & Leads, Personnalité & contenu, Connexions, Paramètres (7b/7c).
- Toute écriture/édition (création exceptée : le wizard du Plan 6 reste la création) ; activation, credentials (7c).
- Mode sombre : les tokens `.dark` sont mis à jour par cohérence, mais la validation visuelle dark complète n'est pas un critère de sortie 7a.

## 3. Recalage charte (fondation)

Source de vérité : `marketing/design-reference-emeraude-ambre.html`. Maquettes 7a validées (25 juin) :
`.superpowers/brainstorm/31100-1782405346/content/` (`02-agents-table-charte`, `03-chrome-topbar`, `04-agent-space-overview`, `05-usage-couts`).

### 3.1 Tokens (à compléter dans `globals.css` + exposer dans `tailwind.config.ts`)

Le Plan 5 a des tokens incomplets/dérivés. Valeurs canoniques à appliquer (clair) :

```
--brand-deep:#14322A  --brand:#1E463B  --brand-mint:#6EE7B7
--accent:#F59E0B  --accent-hover:#D97706  --accent-soft:#FEF3C7  --accent-fg:#14322A
--bg:#F1F5F2  --surface:#FFFFFF  --surface-subtle:#F4F8EE
--border:#DCE5DF        (corrige #E2E8E4)
--border-strong:#C5D2C8 (nouveau)
--fg/text:#14322A  --muted/text-secondary:#44524B  --muted-2/text-muted:#8A998F
--tertiary:#BE5A4E  --tertiary-soft:#FCE7F3   (nouveau)
--success:#10B981  --success-soft:#D1FAE5
--danger:#DC2626   --danger-soft:#FEE2E2
--warning:#F59E0B  --warning-soft:#FEF3C7
--neutral-status:#8A998F
ombres : --sh-sm:0 1px 3px rgba(20,50,42,.05) ; --sh-md:0 2px 8px rgba(20,50,42,.07) ; --sh-lg:0 8px 28px rgba(20,50,42,.14)
rayons : --r-sm:4px --r-md:6px --r-lg:10px --r-xl:13px --r-pill:999px
```

Équivalents `.dark` (de la référence) : `--bg:#0C1A15 --surface:#122620 --surface-subtle:#16302A --border:#1E463B --border-strong:#2A5A4B --text:#E6EFEA --text-secondary:#A7BBB1 --text-muted:#7E938A --accent-hover:#FBBF24`. (Les ombres et tokens fonctionnels restent identiques.)

`tailwind.config.ts` : exposer `surface-subtle`, `border-strong`, `tertiary`(+soft), `success-soft`/`danger-soft`/`warning-soft`, l'échelle `borderRadius` (sm 4 / md 6 / lg 10 / xl 13 / pill 999) et `boxShadow` (sm/md/lg → `--sh-*`). Conserver les noms sémantiques existants.

**Conséquence** : ceci remplace les teintes hex arbitraires introduites au Plan 6 (`bg-[#EAF2EE]`, `#DCF7E3`, etc., cf. dette consignée) par des classes tokenisées. Les composants du Plan 6 qui les utilisent sont migrés vers les nouveaux tokens (`bg-surface-subtle`, etc.) dans la tâche de recalage.

### 3.2 Typographie

Stacks canoniques (déjà branchées via `--font-*` par next/font au Plan 5, à vérifier) :
- display (titres) : `Georgia, 'Source Serif 4', serif` — **graisse `normal`** (éditorial, pas de gras).
- ui (corps) : `Calibri, Inter, 'Helvetica Neue', system-ui, sans-serif`.
- mono : `'JetBrains Mono', 'Fira Code', Menlo, monospace`.

Les titres `font-serif` doivent rendre en graisse normale (corriger tout `font-bold`/`font-semibold` résiduel sur les titres serif).

### 3.3 Chrome

- **Bandeau supérieur émeraude** (`brand-deep`, hauteur ~60px) : logo `● WABAGENT` (pastille menthe + wordmark) ; au niveau racine, **nav globale inline** (Agents [actif] / Usage & coûts [7a] / Paramètres [grisé « à venir », global = 7b/ultérieur]) ; dans un agent, **fil d'Ariane** (« Agents › <nom> ») à la place de la nav ; puis actions à droite (langue, thème, avatar) en style sur-sombre. **Remplace** la sidebar blanche + le header blanc du Plan 5.
- **Rail latéral clair** (`surface`, ~236px) : présent **dans l'espace agent**, porte le nom+statut de l'agent puis les 6 sections (actif = liseré ambre `inset 2px 0 0 accent` + fond `surface-subtle`). Pas de rail sur la liste d'agents.
- **Aucun gradient** (règle actée).

## 4. Architecture

### 4.1 API engine consommée (déjà livrée, lecture seule)

| Écran | Endpoint | Notes |
|---|---|---|
| Table agents | `GET /api/admin/v1/bots` | `BotSummary[]` (status, numbers, languages, ...) |
| Vue d'ensemble | `GET /bots/:id/health`, `/metrics`, `/usage`, `/leads?page_size=3` | santé + métriques + coût + dernières convs |
| Usage & coûts | `GET /bots/:id/usage` | totals, by_model, by_day |

Aucun nouvel endpoint. La « Usage & coûts » **globale** (entrée nav top bar) n'a pas d'endpoint d'agrégat client-level : en 7a elle affiche un **tableau récapitulatif par agent** (une ligne par bot — coût, tokens, appels sur la période — + ligne Total), construit **côté client** par `GET /bots` puis `GET /bots/:id/usage` pour chaque agent. Le détail complet (coût/jour, par modèle) vit dans l'onglet Usage & coûts par-agent.

### 4.2 BFF Next.js (nouvelles route handlers, pattern Plan 5/6)

- `GET /api/bots/[botId]/health|metrics|usage` → proxy `engineFetch` des endpoints dashboard.
- `GET /api/bots/[botId]/leads` (query `page`, `page_size`, `search`, `rdv`) → proxy.
- (`GET /api/bots` et `/api/bots/[botId]` existent déjà — Plan 6.)

Normalisation d'erreurs via `errorResponse`, auth via cookie httpOnly, aucun token exposé.

### 4.3 Pages / composants web

- `apps/web/src/components/shell/` : remplacer `sidebar.tsx`+`header.tsx` par `top-bar.tsx` (bandeau émeraude). `(app)/layout.tsx` ré-architecturé autour du top bar.
- `apps/web/src/app/[locale]/(app)/page.tsx` : accueil — 0 bot → first-run (Plan 6, conservé) ; ≥1 bot → **table d'agents** + bande « Mise en route ».
- `apps/web/src/components/agents/agents-table.tsx`, `setup-banner.tsx`, `status-pill.tsx`.
- `apps/web/src/app/[locale]/(app)/agents/[botId]/layout.tsx` : layout espace agent (rail latéral `agent-rail.tsx` + zone contenu, charge `GET /bots/:id` pour l'entête).
- `apps/web/src/app/[locale]/(app)/agents/[botId]/page.tsx` : Vue d'ensemble.
- `apps/web/src/app/[locale]/(app)/agents/[botId]/usage/page.tsx` : Usage & coûts.
- `apps/web/src/components/agent/` : `overview.tsx` (+ sous-composants `health-panel`, `stat-grid`, `recent-conversations`, `cost-card`, `shortcuts`), `usage-view.tsx` (`kpi-grid`, `bar-chart`, `model-table`), `bar-chart.tsx` (barres en aplats, **sans gradient**).
- Le rail liste les 6 sections ; *Vue d'ensemble* et *Usage & coûts* sont des liens, les 4 autres sont rendues désactivées avec un badge « à venir » (constantes prêtes pour 7b/7c).

### 4.4 Bande « Mise en route » (dérivée)

Réutilise `deriveChecklist` (Plan 6, `@/lib/onboarding`). La bande s'affiche tant que **le premier agent n'est pas en ligne** (aucun agent avec `status === 'active'`). Étapes : Créé / Personnalisé / Connecter WhatsApp / Activer. En 7a, le CTA « Connecter WhatsApp » est **présent mais désactivé** avec un badge « à venir » (la section Connexions relève de 7c) ; il deviendra actif au Plan 7c.

## 5. Écrans (maquettes validées)

1. **Racine — table d'agents** (`02-agents-table-charte`) : bande mise en route + titre + CTA « Créer un agent » (→ wizard Plan 6) + table (Agent[nom+slug], Statut[pill], Langues, Numéro WhatsApp, Messages 30 j, Leads, chevron). Ligne cliquable → `/agents/:id`.
2. **Chrome** (`03-chrome-topbar`) : bandeau émeraude global.
3. **Espace agent — Vue d'ensemble** (`04-agent-space-overview`) : entête (nom serif + pill statut + sous-titre slug·numéro·langues + actions Simuler/Pause) ; grille 2 colonnes — Santé (4 cartes + dots) + Stats (Messages/Leads/Qualifiés) + Dernières conversations | Coût LLM (chiffre + mini-barres) + Raccourcis.
4. **Espace agent — Usage & coûts** (`05-usage-couts`) : sélecteur période (7/30/90 j) ; 3 KPI ; coût par jour (barres) ; détail par modèle (table + total).

Action « Simuler » (Vue d'ensemble) : réutilise le simulateur du Plan 6 (`StepTest`) dans un panneau/modale, en lecture (gratuit `use_bot_config:false`). « Modifier la personnalité » pointe vers la section Personnalité (7b, désactivée en 7a).

## 6. i18n

Nouvelles clés FR + EN (parité), namespaces : `agents` (table, colonnes, statuts), `agentSpace` (sections du rail, entête), `overview` (santé/stats/conversations/coût/raccourcis), `usage` (période, KPI, colonnes). Le contenu utilisateur (noms, transcripts) n'est pas traduit.

## 7. Tests

- Web unitaires (Vitest/RTL) : table d'agents (rendu, lignes, lien), bande mise en route (affichage conditionnel selon `deriveChecklist`/présence d'un actif), rail (sections actives vs « à venir »), Vue d'ensemble (rendu santé/stats à partir de données mockées), Usage (KPI + table par modèle + sélecteur de période), bar-chart (hauteurs proportionnelles, aucun gradient).
- BFF : nouvelles routes `/api/bots/[botId]/{health,metrics,usage,leads}` (succès, 401→refresh, erreurs normalisées, aucun token).
- e2e Playwright (mock-engine étendu : health/metrics/usage/leads) : login → table d'agents → ouvrir un agent → Vue d'ensemble visible → Usage & coûts visible.

## 8. Décisions actées

1. **Plan 7 en 3 sous-plans** : 7a (read + recalage) / 7b (contenu) / 7c (go-live). 7c = BYO + setup guidé + validation + activation ; Embedded Signup parké (chantier Meta Tech Provider).
2. **Chrome = bandeau supérieur émeraude** (remplace la sidebar/header blancs du Plan 5) + **rail latéral clair dans l'espace agent**. Aucun gradient.
3. **Recalage tokens canoniques** dans 7a (corrige border, ajoute surface-subtle/border-strong/tertiary/ombres/échelle de rayons), remplace les teintes hex arbitraires du Plan 6.
4. **Typo éditoriale** : titres Georgia/Source Serif en graisse normale.
5. **Racine** : 0 bot → first-run (Plan 6) ; ≥1 bot → table d'agents + bande mise en route persistante jusqu'au 1er agent en ligne.
6. **6 sections affichées** dans le rail ; seules Vue d'ensemble + Usage & coûts actives en 7a, les autres « à venir ».
7. **Usage & coûts global** = agrégation côté client (pas d'endpoint engine dédié).
8. **Aucune écriture engine** en 7a (lecture seule ; création = wizard Plan 6).
