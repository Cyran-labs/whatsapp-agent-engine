# Onboarding Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un utilisateur authentifié de créer son premier agent WhatsApp en self-service (wizard 3 étapes : Identité → Personnalité → Tester) et de le tester gratuitement en simulation, avec persistance des champs guidés.

**Architecture:** L'engine gagne un champ `personality` (localisé, structuré) persisté sur les bots et compose côté serveur le `system_prompt` pour les langues guidées (les langues éditées en brut sont préservées). Le web ajoute un BFF `/api/bots/*` (proxy authentifié, pattern Plan 5), une page d'accueil onboarding (first-run + checklist dérivée) et un wizard client mono-page qui crée un draft (POST en fin d'étape 2) puis le teste via `/simulate`.

**Tech Stack:** Engine TypeScript (Express, Vitest, better-sqlite3, pg). Web Next.js 15 App Router, next-intl, Tailwind (tokens Émeraude-Ambre), Vitest/RTL, Playwright. Contrats Zod (`@wabagent/contracts`).

**Spec de référence :** `docs/superpowers/specs/2026-06-25-onboarding-wizard-design.md`.

## Global Constraints

- TypeScript strict : pas de `any`, `const` par défaut.
- Logs : `[Service] message`, sans emoji.
- Author git : `Francois Greze <francois@cyran.fr>`. Pas de signature Claude/Anthropic.
- Textes français (UI, contenu, commentaires) : accents obligatoires (é è ê à â ù û ô ç î ï). Identifiants/code techniques : ASCII.
- Pas de thématique de démo Cyran (golf, immobilier, voyage, auto, acquisition) dans le code, les fixtures ou les exemples. Utiliser des exemples neutres.
- **Aucun gradient** dans l'UI : aplats uniquement.
- Charte Émeraude-Ambre, classes Tailwind sémantiques déjà définies (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `border-border`, `bg-accent`, `text-accent-fg`, `bg-brand-deep`, etc. — cf. `apps/web/src/app/globals.css`).
- Toute chaîne d'UI passe par i18n : ajouter les clés dans **`apps/web/messages/fr.json` ET `apps/web/messages/en.json`** dans la même tâche que l'écran qui les utilise.
- Aucun token/secret exposé au navigateur ; le BFF ne logge jamais de token.
- Ne jamais lancer `npm audit fix --force`. Tests : `npm test` (engine, racine) et `cd apps/web && npm test`.
- Maquettes validées (source de fidélité visuelle) : `.superpowers/brainstorm/62043-1782384014/content/` (`01-first-run`, `02-wizard-step1`, `03-wizard-step2`, `04-wizard-step3`, `05-success`).

## File Structure

**Engine**
- `packages/contracts/src/bots.ts` (modifier) : `PersonalityInput`, `LocalizedPersonality`, `personality` + `system_prompt` optionnel dans `CreateBotInput`.
- `src/core/database/types.ts` (modifier) : `PersonalityFields`, `BotRecord.personality`.
- `src/core/database/sqlite.ts` (modifier) : colonne + ensure-column + mapping.
- `src/core/database/postgres.ts` (modifier) : colonne + ensure-column + mapping.
- `src/core/services/personality.ts` (créer) : `composeSystemPrompt`, `isComposableLanguage`.
- `src/core/services/bot-service.ts` (modifier) : persistance + composition serveur + validation.

**Web (BFF + UI)**
- `apps/web/src/app/api/bots/route.ts` (créer) : GET, POST.
- `apps/web/src/app/api/bots/[botId]/route.ts` (créer) : PATCH.
- `apps/web/src/app/api/bots/[botId]/simulate/route.ts` (créer) : POST.
- `apps/web/src/lib/bot-draft.ts` (créer) : `slugify`, `nextSlug`, `buildBotPayload`.
- `apps/web/src/lib/onboarding.ts` (créer) : `deriveChecklist`.
- `apps/web/src/app/[locale]/(app)/page.tsx` (remplacer) : accueil onboarding.
- `apps/web/src/app/[locale]/(app)/agents/new/page.tsx` (créer) : page wizard.
- `apps/web/src/components/wizard/*` (créer) : `wizard.tsx` (conteneur état), `step-identity.tsx`, `step-personality.tsx`, `step-test.tsx`, `success.tsx`, et primitives UI (`stepper.tsx`).
- `apps/web/messages/{fr,en}.json` (modifier) : namespaces `onboarding`, `wizard`, `simulate`, `agents`.
- `apps/web/e2e/mock-engine.ts` (modifier) + `apps/web/e2e/onboarding.spec.ts` (créer).

---

## Task 1: Contrats — `personality` + `system_prompt` optionnel

**Files:**
- Modify: `packages/contracts/src/bots.ts`
- Test: `packages/contracts/src/__tests__/contracts.test.ts`

**Interfaces:**
- Consumes: `LocalizedInput` (déjà dans `bots.ts`).
- Produces:
  - `PersonalityInput = { role: string(min 1); tones: string[]; objective: string; info: string }`
  - `LocalizedPersonality = Record<string, PersonalityInput>`
  - `CreateBotInput` : `system_prompt` devient optionnel (`default {}`), ajout `personality: LocalizedPersonality | null` (`default null`).
  - `UpdateBotInput` reste `CreateBotInput.partial().omit({ bot_id: true })` (hérite des nouveaux champs).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `packages/contracts/src/__tests__/contracts.test.ts` (importer `CreateBotInput`, `PersonalityInput` depuis `../index.js`) :

```ts
describe('contracts: bots personality', () => {
  it('PersonalityInput exige un role, defaults sur le reste', () => {
    const p = PersonalityInput.parse({ role: 'Conseiller' });
    expect(p).toEqual({ role: 'Conseiller', tones: [], objective: '', info: '' });
    expect(() => PersonalityInput.parse({ role: '' })).toThrow();
  });

  it('CreateBotInput accepte personality et rend system_prompt optionnel', () => {
    const b = CreateBotInput.parse({
      bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud',
      welcome: { enabled: false, message: {} },
      personality: { fr: { role: 'Conseiller' } },
    });
    expect(b.system_prompt).toEqual({});
    expect(b.personality?.fr.role).toBe('Conseiller');
  });

  it('CreateBotInput sans personality => personality null', () => {
    const b = CreateBotInput.parse({
      bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud',
      system_prompt: { fr: 'Agent.' }, welcome: { enabled: false, message: {} },
    });
    expect(b.personality).toBeNull();
  });
});
```

Ajouter `CreateBotInput, PersonalityInput` à l'`import` existant en tête de fichier.

- [ ] **Step 2: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run packages/contracts/src/__tests__/contracts.test.ts`
Expected: FAIL (`PersonalityInput` non exporté ; `system_prompt` encore requis).

- [ ] **Step 3: Implémenter**

Dans `packages/contracts/src/bots.ts`, après `LocalizedInput` :

```ts
export const PersonalityInput = z.object({
  role: z.string().min(1),
  tones: z.array(z.string()).default([]),
  objective: z.string().default(''),
  info: z.string().default(''),
});
export type PersonalityInput = z.infer<typeof PersonalityInput>;

export const LocalizedPersonality = z.record(PersonalityInput);
export type LocalizedPersonality = z.infer<typeof LocalizedPersonality>;
```

Dans `CreateBotInput`, remplacer la ligne `system_prompt: LocalizedInput,` par :

```ts
  system_prompt: LocalizedInput.default({}),
  personality: LocalizedPersonality.nullable().default(null),
```

(`UpdateBotInput` n'a pas besoin de changer ; `.partial()` propage les nouveaux champs.)

- [ ] **Step 4: Lancer le test (passe)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run packages/contracts/src/__tests__/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier la non-régression contrats**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run packages/contracts`
Expected: PASS (toutes les suites contrats).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/bots.ts packages/contracts/src/__tests__/contracts.test.ts
git commit -m "feat(contracts): personality structuree + system_prompt optionnel sur CreateBotInput"
```

---

## Task 2: DB — `BotRecord.personality` + colonne + ensure-column (SQLite & Postgres)

**Files:**
- Modify: `src/core/database/types.ts`
- Modify: `src/core/database/sqlite.ts:11-22` (botRecordToCols), `:26-41` (rowToBotRecord), `:130-148` (schema bots), `:272` (après exec SCHEMA), `:519-537` (upsertBotRecord)
- Modify: `src/core/database/postgres.ts:89-107` (schema bots), `:231` (après exec SCHEMA), `:498-540` (get/list/upsert)
- Test: `src/core/database/__tests__/personality-column.test.ts` (créer)

**Interfaces:**
- Consumes: rien des tâches précédentes (le type DB est indépendant des contrats).
- Produces:
  - `PersonalityFields = { role: string; tones: string[]; objective: string; info: string }` (dans `types.ts`).
  - `BotRecord.personality: Record<string, PersonalityFields> | null`.
  - Round-trip DB de `personality` ; ensure-column idempotent.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/core/database/__tests__/personality-column.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import type { BotRecord } from '../types.js';

function baseBot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'c1', bot_id: 'b1', name: 'Agent', transport: 'meta-cloud', status: 'draft',
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent.' },
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, ...over,
  };
}

describe('DB: colonne personality', () => {
  it('round-trip personality (ecriture/lecture)', async () => {
    const db = createSqliteDriver(':memory:');
    const rec = baseBot({ personality: { fr: { role: 'Conseiller', tones: ['concis'], objective: 'aider', info: '' } } });
    await db.upsertBotRecord(rec);
    const back = await db.getBotRecord('c1', 'b1');
    expect(back?.personality).toEqual(rec.personality);
  });

  it('personality null par defaut', async () => {
    const db = createSqliteDriver(':memory:');
    await db.upsertBotRecord(baseBot());
    const back = await db.getBotRecord('c1', 'b1');
    expect(back?.personality).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/database/__tests__/personality-column.test.ts`
Expected: FAIL (TS : `personality` absent de `BotRecord` ; valeur non persistée).

- [ ] **Step 3: Implémenter — types**

Dans `src/core/database/types.ts`, avant `export interface BotRecord {` :

```ts
export interface PersonalityFields {
  role: string;
  tones: string[];
  objective: string;
  info: string;
}
```

Dans `BotRecord`, après la ligne `crm: { connector: string } | null;` ajouter :

```ts
  personality: Record<string, PersonalityFields> | null;
```

- [ ] **Step 4: Implémenter — SQLite**

Dans `src/core/database/sqlite.ts` :

`botRecordToCols` — ajouter avant la `}` de retour :
```ts
    personality: rec.personality ? JSON.stringify(rec.personality) : null,
```

`rowToBotRecord` — ajouter avant la `}` de retour :
```ts
    personality: j(row.personality),
```

Schéma `CREATE TABLE IF NOT EXISTS bots (...)` — ajouter après la ligne `crm TEXT,` :
```sql
      personality TEXT,
```

Juste après `db.exec(SCHEMA);` (ligne ~272), ajouter l'ensure-column idempotent :
```ts
  // ensure-column : ajoute personality aux bases existantes (CREATE TABLE IF NOT EXISTS ne migre pas).
  const botCols = db.prepare('PRAGMA table_info(bots)').all() as { name: string }[];
  if (!botCols.some((c) => c.name === 'personality')) {
    db.exec('ALTER TABLE bots ADD COLUMN personality TEXT');
  }
```

`upsertBotRecord` — dans le `UPDATE`, ajouter `personality=?` avant `updated_at=...` ; ajouter `vals.personality` dans les params du `.run(...)` (à la même position, juste avant `rec.client_id`). Dans l'`INSERT`, ajouter `personality` à la liste des colonnes, un `?` de plus dans `VALUES`, et `vals.personality` en dernier paramètre du `.run(...)` (avant rien — c'est le dernier). Le bloc devient :

```ts
    async upsertBotRecord(rec: BotRecord): Promise<void> {
      const vals = botRecordToCols(rec);
      const upd = db.prepare(
        `UPDATE bots SET name=?, transport=?, status=?, default_language=?, languages=?,
           system_prompt=?, lead_fields=?, welcome=?, error_messages=?, catalog=?, llm=?, crm=?,
           personality=?, updated_at=datetime('now')
         WHERE client_id=? AND bot_id=?`
      ).run(vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
            vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm,
            vals.personality, rec.client_id, rec.bot_id);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO bots (client_id, bot_id, name, transport, status, default_language, languages,
             system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(rec.client_id, rec.bot_id, vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
              vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm,
              vals.personality);
      }
    },
```

- [ ] **Step 5: Lancer le test SQLite (passe)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/database/__tests__/personality-column.test.ts`
Expected: PASS.

- [ ] **Step 6: Implémenter — Postgres (parité, non testé sans instance PG)**

Dans `src/core/database/postgres.ts` :

Schéma `CREATE TABLE IF NOT EXISTS bots (...)` — ajouter après `crm JSONB,` :
```sql
      personality JSONB,
```

Juste après `await pool.query(SCHEMA);` (ligne ~231) :
```ts
  // ensure-column : ajoute personality aux bases existantes.
  await pool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS personality JSONB');
```

`getBotRecord` et `listBotRecords` — ajouter `personality` à la fin de la liste `SELECT ... crm` (les deux requêtes) : `... catalog, llm, crm, personality`.

`upsertBotRecord` — ajouter en fin du tableau `params` :
```ts
        rec.personality ? JSON.stringify(rec.personality) : null,
```
Dans l'`UPDATE`, ajouter `personality=$15,` avant `updated_at=NOW()`. Dans l'`INSERT`, ajouter `personality` aux colonnes et `$15` aux `VALUES`.

- [ ] **Step 7: Vérifier la non-régression DB + config-store**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/database src/core/__tests__`
Expected: PASS (le round-trip n'a pas cassé les autres mappings).

- [ ] **Step 8: Commit**

```bash
git add src/core/database/types.ts src/core/database/sqlite.ts src/core/database/postgres.ts src/core/database/__tests__/personality-column.test.ts
git commit -m "feat(db): colonne personality (JSON) sur bots + ensure-column idempotent (sqlite/postgres)"
```

---

## Task 3: Module de composition `system_prompt`

**Files:**
- Create: `src/core/services/personality.ts`
- Test: `src/core/services/__tests__/personality.test.ts`

**Interfaces:**
- Consumes: `PersonalityFields` (de `types.ts`, Task 2).
- Produces:
  - `composeSystemPrompt(fields: PersonalityFields, lang: string): string`
  - `isComposableLanguage(lang: string): boolean`
  - Langues supportées : `fr`, `en`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/core/services/__tests__/personality.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { composeSystemPrompt, isComposableLanguage } from '../personality.js';

describe('composeSystemPrompt', () => {
  it('compose un prompt FR complet', () => {
    const out = composeSystemPrompt(
      { role: 'Conseiller commercial', tones: ['chaleureux', 'concis'], objective: 'qualifier le besoin', info: 'Ouvert du mardi au samedi' },
      'fr',
    );
    expect(out).toContain('Tu es Conseiller commercial.');
    expect(out).toContain('Ton ton : chaleureux, concis.');
    expect(out).toContain('Ton objectif principal : qualifier le besoin.');
    expect(out).toContain('Informations à connaître : Ouvert du mardi au samedi.');
    expect(out).toContain('Réponds en français, en messages courts adaptés à WhatsApp.');
  });

  it('omet les lignes vides (tones/objective/info)', () => {
    const out = composeSystemPrompt({ role: 'Assistant', tones: [], objective: '', info: '' }, 'fr');
    expect(out).toContain('Tu es Assistant.');
    expect(out).not.toContain('Ton ton');
    expect(out).not.toContain('objectif');
    expect(out).not.toContain('Informations');
  });

  it('compose en EN', () => {
    const out = composeSystemPrompt({ role: 'Sales advisor', tones: ['friendly'], objective: 'qualify', info: '' }, 'en');
    expect(out).toContain('You are Sales advisor.');
    expect(out).toContain('Your tone: friendly.');
    expect(out).toContain('Reply in English, in short WhatsApp-friendly messages.');
  });

  it('lève une erreur pour une langue sans template', () => {
    expect(() => composeSystemPrompt({ role: 'X', tones: [], objective: '', info: '' }, 'de')).toThrow();
  });

  it('isComposableLanguage', () => {
    expect(isComposableLanguage('fr')).toBe(true);
    expect(isComposableLanguage('de')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/services/__tests__/personality.test.ts`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Implémenter**

Créer `src/core/services/personality.ts` :

```ts
import type { PersonalityFields } from '../database/types.js';

interface Template {
  you: (role: string) => string;
  tone: (tones: string) => string;
  objective: (o: string) => string;
  info: (i: string) => string;
  reply: string;
}

// Contenu francais/anglais : accents volontaires (chaines de contenu, pas des identifiants).
const TEMPLATES: Record<string, Template> = {
  fr: {
    you: (role) => `Tu es ${role}.`,
    tone: (tones) => `Ton ton : ${tones}.`,
    objective: (o) => `Ton objectif principal : ${o}.`,
    info: (i) => `Informations à connaître : ${i}.`,
    reply: 'Réponds en français, en messages courts adaptés à WhatsApp.',
  },
  en: {
    you: (role) => `You are ${role}.`,
    tone: (tones) => `Your tone: ${tones}.`,
    objective: (o) => `Your main objective: ${o}.`,
    info: (i) => `Useful information: ${i}.`,
    reply: 'Reply in English, in short WhatsApp-friendly messages.',
  },
};

export function isComposableLanguage(lang: string): boolean {
  return lang in TEMPLATES;
}

export function composeSystemPrompt(fields: PersonalityFields, lang: string): string {
  const tpl = TEMPLATES[lang];
  if (!tpl) throw new Error(`[Personality] Pas de template pour la langue: ${lang}`);
  const lines: string[] = [tpl.you(fields.role.trim())];
  const tones = fields.tones.map((t) => t.trim()).filter(Boolean);
  if (tones.length) lines.push(tpl.tone(tones.join(', ')));
  if (fields.objective.trim()) lines.push(tpl.objective(fields.objective.trim()));
  if (fields.info.trim()) lines.push(tpl.info(fields.info.trim()));
  lines.push(tpl.reply);
  return lines.join('\n');
}
```

- [ ] **Step 4: Lancer le test (passe)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/services/__tests__/personality.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/personality.ts src/core/services/__tests__/personality.test.ts
git commit -m "feat(engine): module de composition system_prompt (templates FR/EN)"
```

---

## Task 4: bot-service — persistance personality + composition serveur + validation

**Files:**
- Modify: `src/core/services/bot-service.ts`
- Test: `src/core/services/__tests__/bot-service-personality.test.ts` (créer)

**Interfaces:**
- Consumes: `CreateBotInput.personality` / `system_prompt` (Task 1), `BotRecord.personality` + `PersonalityFields` (Task 2), `composeSystemPrompt` (Task 3), `validationError` (`src/api/errors.ts`).
- Produces: `createBot`/`updateBot` qui composent le `system_prompt` des langues guidées, préservent les langues brutes, persistent `personality`, et valident une source pour `default_language`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/core/services/__tests__/bot-service-personality.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore } from '../../config-store.js';
import { BotService } from '../bot-service.js';
import type { CreateBotInput } from '@wabagent/contracts';

function input(over: Partial<CreateBotInput> = {}): CreateBotInput {
  return {
    bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud',
    default_language: 'fr', languages: ['fr'], system_prompt: {},
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, ...over,
  } as CreateBotInput;
}

describe('BotService — personality', () => {
  let svc: BotService;
  beforeEach(() => {
    const db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    svc = new BotService({ db });
  });

  it('compose le system_prompt depuis personality (langue guidee)', async () => {
    const bot = await svc.createBot('c1', null, input({ personality: { fr: { role: 'Conseiller', tones: [], objective: '', info: '' } } }));
    expect(bot.system_prompt.fr).toContain('Tu es Conseiller.');
    expect(bot.personality?.fr.role).toBe('Conseiller');
  });

  it('preserve le system_prompt brut (langue sans personality)', async () => {
    const bot = await svc.createBot('c1', null, input({ system_prompt: { fr: 'Prompt brut.' } }));
    expect(bot.system_prompt.fr).toBe('Prompt brut.');
    expect(bot.personality).toBeNull();
  });

  it('mixte : fr guide, en brut', async () => {
    const bot = await svc.createBot('c1', null, input({
      languages: ['fr', 'en'], default_language: 'fr',
      system_prompt: { en: 'Raw EN.' },
      personality: { fr: { role: 'Conseiller', tones: [], objective: '', info: '' } },
    }));
    expect(bot.system_prompt.fr).toContain('Tu es Conseiller.');
    expect(bot.system_prompt.en).toBe('Raw EN.');
  });

  it('rejette si aucune source pour default_language', async () => {
    await expect(svc.createBot('c1', null, input({ default_language: 'fr', system_prompt: {}, personality: null })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updateBot recompose quand personality change', async () => {
    await svc.createBot('c1', null, input({ personality: { fr: { role: 'A', tones: [], objective: '', info: '' } } }));
    const upd = await svc.updateBot('c1', 'sales', null, { personality: { fr: { role: 'B', tones: [], objective: '', info: '' } } });
    expect(upd.system_prompt.fr).toContain('Tu es B.');
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/services/__tests__/bot-service-personality.test.ts`
Expected: FAIL (composition absente ; pas de validation).

- [ ] **Step 3: Implémenter — helper de résolution**

Dans `src/core/services/bot-service.ts`, ajouter aux imports :
```ts
import type { Database, BotRecord, PersonalityFields } from '../database/types.js';
import { composeSystemPrompt } from './personality.js';
import { conflict, notFound, validationError } from '../../api/errors.js';
```
(remplacer la ligne d'import existante `import { conflict, notFound } from '../../api/errors.js';` et la ligne `import type { Database, BotRecord } ...`).

Ajouter, après `normalizeNumbers` :
```ts
/**
 * Resout les prompts par langue : compose depuis personality (langue guidee),
 * preserve le system_prompt fourni (langue brute). Valide une source pour defaultLang.
 */
function resolvePrompts(
  defaultLang: string,
  systemPrompt: Record<string, string>,
  personality: Record<string, PersonalityFields> | null,
): { system_prompt: Record<string, string>; personality: Record<string, PersonalityFields> | null } {
  const out: Record<string, string> = { ...systemPrompt };
  if (personality) {
    for (const [lang, fields] of Object.entries(personality)) {
      out[lang] = composeSystemPrompt(fields, lang);
    }
  }
  if (!out[defaultLang]?.trim()) {
    throw validationError(
      [{ path: 'system_prompt', message: `Aucune personnalité ni prompt pour la langue par défaut (${defaultLang}).` }],
    );
  }
  return { system_prompt: out, personality: personality ?? null };
}
```

- [ ] **Step 4: Implémenter — createBot**

Remplacer `inputToRecord` pour intégrer la résolution et `personality` :

```ts
function inputToRecord(clientId: string, input: CreateBotInput): BotRecord {
  const resolved = resolvePrompts(input.default_language, input.system_prompt, input.personality);
  return {
    client_id: clientId,
    bot_id: input.bot_id,
    name: input.name,
    transport: input.transport,
    status: 'draft',
    default_language: input.default_language,
    languages: input.languages,
    system_prompt: resolved.system_prompt,
    lead_fields: input.lead_fields,
    welcome: input.welcome,
    error_messages: input.error_messages,
    catalog: input.catalog,
    llm: input.llm,
    crm: input.crm,
    personality: resolved.personality,
  };
}
```

- [ ] **Step 5: Implémenter — updateBot**

Dans `updateBot`, construire d'abord le `merged` (champs simples), puis recalculer prompts/personality. Remplacer le corps de `merged` et la suite par :

```ts
    const mergedDefaultLang = patch.default_language ?? existing.default_language;
    const mergedSystemPrompt = patch.system_prompt ?? existing.system_prompt;
    const mergedPersonality = patch.personality !== undefined ? patch.personality : existing.personality;
    const resolved = resolvePrompts(mergedDefaultLang, mergedSystemPrompt, mergedPersonality);
    const merged: BotRecord = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
      default_language: mergedDefaultLang,
      ...(patch.languages !== undefined ? { languages: patch.languages } : {}),
      system_prompt: resolved.system_prompt,
      personality: resolved.personality,
      ...(patch.lead_fields !== undefined ? { lead_fields: patch.lead_fields } : {}),
      ...(patch.welcome !== undefined ? { welcome: patch.welcome } : {}),
      ...(patch.error_messages !== undefined ? { error_messages: patch.error_messages } : {}),
      ...(patch.catalog !== undefined ? { catalog: patch.catalog } : {}),
      ...(patch.llm !== undefined ? { llm: patch.llm } : {}),
      ...(patch.crm !== undefined ? { crm: patch.crm } : {}),
    };
```

(Le reste de `updateBot` — `numbersOf`, `upsertBot`, `recordAudit`, `return this.detail(merged)` — est inchangé.)

- [ ] **Step 6: Lancer le test (passe)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npx vitest run src/core/services/__tests__/bot-service-personality.test.ts`
Expected: PASS.

- [ ] **Step 7: Vérifier la non-régression engine (routes bots + suite complète)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine && npm test`
Expected: PASS. Note : les fixtures de `bots-routes.test.ts` envoient `system_prompt: { fr: 'Agent.' }` (langue par défaut `fr`) — la validation passe. Si une suite échoue parce qu'elle créait un bot sans `system_prompt[default_language]` ni `personality`, corriger la fixture en ajoutant `system_prompt: { fr: '...' }` (ne pas relâcher la validation).

- [ ] **Step 8: Commit**

```bash
git add src/core/services/bot-service.ts src/core/services/__tests__/bot-service-personality.test.ts
git commit -m "feat(engine): bot-service compose le system_prompt (guide) et persiste personality"
```

---

## Task 5: BFF — routes `/api/bots/*`

**Files:**
- Create: `apps/web/src/app/api/bots/route.ts`
- Create: `apps/web/src/app/api/bots/[botId]/route.ts`
- Create: `apps/web/src/app/api/bots/[botId]/simulate/route.ts`
- Test: `apps/web/src/app/api/bots/__tests__/bots-routes.test.ts` (créer)

**Interfaces:**
- Consumes: `engineFetch` (`@/lib/engine-fetch`), `errorResponse` (`@/lib/api-response`), `CreateBotInput`/`UpdateBotInput`/`SimulateInput` (`@wabagent/contracts`).
- Produces (réponses JSON) :
  - `GET /api/bots` -> `BotSummary[]`
  - `POST /api/bots` -> `BotDetail` (201)
  - `PATCH /api/bots/:botId` -> `BotDetail`
  - `POST /api/bots/:botId/simulate` -> `{ session_id, reply, model }`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/app/api/bots/__tests__/bots-routes.test.ts` (mirroir de `auth-routes.test.ts`) :

```ts
import { test, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
  }),
}));

import { GET as listBots, POST as createBot } from '../route';
import { PATCH as patchBot } from '../[botId]/route';
import { POST as simulate } from '../[botId]/simulate/route';
import { ACCESS_COOKIE } from '@/lib/session';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  store.clear();
  store.set(ACCESS_COOKIE, 'access-1');
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('GET /api/bots renvoie la liste', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes([{ bot_id: 'a', name: 'A' }])));
  const res = await listBots();
  expect(res.status).toBe(200);
  expect((await res.json())[0].bot_id).toBe('a');
});

test('POST /api/bots : validation locale → 400 sans appel engine', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await createBot(new Request('http://web.test/api/bots', { method: 'POST', body: JSON.stringify({ name: '' }) }));
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('POST /api/bots OK → 201', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ bot_id: 'sales', name: 'Ventes' }, 201)));
  const body = { bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', welcome: { enabled: false, message: {} }, personality: { fr: { role: 'Conseiller' } } };
  const res = await createBot(new Request('http://web.test/api/bots', { method: 'POST', body: JSON.stringify(body) }));
  expect(res.status).toBe(201);
  expect((await res.json()).bot_id).toBe('sales');
});

test('PATCH /api/bots/:id OK', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ bot_id: 'sales', name: 'Ventes 2' })));
  const res = await patchBot(new Request('http://web.test/api/bots/sales', { method: 'PATCH', body: JSON.stringify({ name: 'Ventes 2' }) }), { params: Promise.resolve({ botId: 'sales' }) });
  expect(res.status).toBe(200);
});

test('POST simulate OK', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ session_id: 's1', reply: 'Bonjour', model: 'haiku' })));
  const res = await simulate(new Request('http://web.test/api/bots/sales/simulate', { method: 'POST', body: JSON.stringify({ message: 'salut', use_bot_config: false }) }), { params: Promise.resolve({ botId: 'sales' }) });
  expect((await res.json()).reply).toBe('Bonjour');
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/app/api/bots`
Expected: FAIL (routes inexistantes).

- [ ] **Step 3: Implémenter — `/api/bots/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { CreateBotInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await engineFetch('/bots'));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = CreateBotInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const bot = await engineFetch('/bots', { method: 'POST', body: JSON.stringify(parsed.data) });
    return NextResponse.json(bot, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: Implémenter — `/api/bots/[botId]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { UpdateBotInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function PATCH(request: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const parsed = UpdateBotInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const bot = await engineFetch(`/bots/${encodeURIComponent(botId)}`, { method: 'PATCH', body: JSON.stringify(parsed.data) });
    return NextResponse.json(bot);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: Implémenter — `/api/bots/[botId]/simulate/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { SimulateInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const parsed = SimulateInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const out = await engineFetch(`/bots/${encodeURIComponent(botId)}/simulate`, { method: 'POST', body: JSON.stringify(parsed.data) });
    return NextResponse.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: Lancer le test (passe)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/app/api/bots`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/bots
git commit -m "feat(web/bff): routes /api/bots (list/create/patch/simulate) proxy authentifie"
```

---

## Task 6: Web utils — slug, payload, checklist (purs, TDD)

**Files:**
- Create: `apps/web/src/lib/bot-draft.ts`
- Create: `apps/web/src/lib/onboarding.ts`
- Test: `apps/web/src/lib/__tests__/bot-draft.test.ts`, `apps/web/src/lib/__tests__/onboarding.test.ts`

**Interfaces:**
- Produces:
  - `slugify(name: string): string` (conforme `^[a-z0-9][a-z0-9-]*$`).
  - `nextSlug(base: string, taken: string[]): string`.
  - Types `LangPersonality`, `WizardState`.
  - `buildBotPayload(state: WizardState): CreateBotInput` (objet POST).
  - `BotSummary` (type web), `ChecklistState`, `deriveChecklist(bots: BotSummary[]): ChecklistState`.

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/web/src/lib/__tests__/bot-draft.test.ts` :

```ts
import { test, expect } from 'vitest';
import { slugify, nextSlug, buildBotPayload, type WizardState } from '../bot-draft';

test('slugify normalise', () => {
  expect(slugify('Assistant Boutique')).toBe('assistant-boutique');
  expect(slugify('  Café & Thé!! ')).toBe('cafe-the');
  expect(slugify('123 Go')).toBe('123-go');
});

test('nextSlug suffixe en cas de collision', () => {
  expect(nextSlug('sales', [])).toBe('sales');
  expect(nextSlug('sales', ['sales'])).toBe('sales-2');
  expect(nextSlug('sales', ['sales', 'sales-2'])).toBe('sales-3');
});

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
    perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: ['concis'], objective: 'aider', info: '', raw: '' } },
    welcomeEnabled: true, welcome: { fr: 'Bonjour' }, leadFields: ['Nom', 'Téléphone'], ...over,
  };
}

test('buildBotPayload : langue guidee -> personality, pas de system_prompt', () => {
  const p = buildBotPayload(state());
  expect(p.personality?.fr.role).toBe('Conseiller');
  expect(p.system_prompt.fr).toBeUndefined();
  expect(p.welcome).toEqual({ enabled: true, message: { fr: 'Bonjour' } });
  expect(p.lead_fields).toBe('Nom, Téléphone');
  expect(p.transport).toBe('meta-cloud');
});

test('buildBotPayload : langue brute -> system_prompt, pas de personality', () => {
  const p = buildBotPayload(state({ perLang: { fr: { mode: 'raw', role: '', tones: [], objective: '', info: '', raw: 'Prompt brut.' } } }));
  expect(p.system_prompt.fr).toBe('Prompt brut.');
  expect(p.personality).toBeNull();
});
```

`apps/web/src/lib/__tests__/onboarding.test.ts` :

```ts
import { test, expect } from 'vitest';
import { deriveChecklist, type BotSummary } from '../onboarding';

function bot(over: Partial<BotSummary> = {}): BotSummary {
  return { bot_id: 'b', name: 'B', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'x' }, ...over };
}

test('checklist vide', () => {
  expect(deriveChecklist([])).toEqual({ created: false, personalized: false, connected: false, active: false });
});

test('checklist : agent draft personnalise', () => {
  expect(deriveChecklist([bot()])).toMatchObject({ created: true, personalized: true, active: false });
});

test('checklist : agent actif', () => {
  expect(deriveChecklist([bot({ status: 'active' })])).toMatchObject({ created: true, active: true });
});

test('checklist : agent sans prompt pour la langue par defaut', () => {
  expect(deriveChecklist([bot({ system_prompt: {} })])).toMatchObject({ created: true, personalized: false });
});
```

- [ ] **Step 2: Lancer les tests (échouent)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/lib`
Expected: FAIL (modules inexistants).

- [ ] **Step 3: Implémenter — `lib/bot-draft.ts`**

```ts
import type { CreateBotInput } from '@wabagent/contracts';

export interface LangPersonality {
  mode: 'guided' | 'raw';
  role: string;
  tones: string[];
  objective: string;
  info: string;
  raw: string;
}

export interface WizardState {
  name: string;
  slug: string;
  languages: string[];
  defaultLanguage: string;
  perLang: Record<string, LangPersonality>;
  welcomeEnabled: boolean;
  welcome: Record<string, string>;
  leadFields: string[];
}

export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function nextSlug(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function buildBotPayload(state: WizardState): CreateBotInput {
  const personality: Record<string, { role: string; tones: string[]; objective: string; info: string }> = {};
  const systemPrompt: Record<string, string> = {};
  for (const lang of state.languages) {
    const p = state.perLang[lang];
    if (!p) continue;
    if (p.mode === 'guided' && p.role.trim()) {
      personality[lang] = { role: p.role.trim(), tones: p.tones, objective: p.objective.trim(), info: p.info.trim() };
    } else if (p.mode === 'raw' && p.raw.trim()) {
      systemPrompt[lang] = p.raw.trim();
    }
  }
  const welcomeMsg: Record<string, string> = {};
  for (const lang of state.languages) {
    if (state.welcome[lang]?.trim()) welcomeMsg[lang] = state.welcome[lang].trim();
  }
  return {
    bot_id: state.slug,
    name: state.name.trim(),
    transport: 'meta-cloud',
    default_language: state.defaultLanguage,
    languages: state.languages,
    system_prompt: systemPrompt,
    personality: Object.keys(personality).length ? personality : null,
    lead_fields: state.leadFields.map((f) => f.trim()).filter(Boolean).join(', '),
    welcome: { enabled: state.welcomeEnabled, message: welcomeMsg },
    error_messages: {},
    catalog: null,
    llm: null,
    crm: null,
  } as CreateBotInput;
}
```

- [ ] **Step 4: Implémenter — `lib/onboarding.ts`**

```ts
export interface BotSummary {
  bot_id: string;
  name: string;
  status: string;
  default_language: string;
  languages: string[];
  system_prompt: Record<string, string>;
}

export interface ChecklistState {
  created: boolean;
  personalized: boolean;
  connected: boolean;
  active: boolean;
}

export function deriveChecklist(bots: BotSummary[]): ChecklistState {
  const created = bots.length > 0;
  const personalized = bots.some((b) => (b.system_prompt?.[b.default_language] ?? '').trim().length > 0);
  const active = bots.some((b) => b.status === 'active');
  // connected : etat du transport WhatsApp — surface du Plan 7 ; non lu ici (apercu verrouille).
  const connected = false;
  return { created, personalized, connected, active };
}
```

- [ ] **Step 5: Lancer les tests (passent)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/lib`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/bot-draft.ts apps/web/src/lib/onboarding.ts apps/web/src/lib/__tests__/bot-draft.test.ts apps/web/src/lib/__tests__/onboarding.test.ts
git commit -m "feat(web): utils slug/payload/checklist (purs)"
```

---

## Task 7: Accueil onboarding — first-run + checklist

**Files:**
- Replace: `apps/web/src/app/[locale]/(app)/page.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `onboarding`)
- Test: `apps/web/src/app/[locale]/(app)/__tests__/home.test.tsx` (créer)

**Maquette de référence :** `.superpowers/brainstorm/62043-1782384014/content/01-first-run.html`.

**Interfaces:**
- Consumes: `deriveChecklist`, `BotSummary` (Task 6) ; `GET /api/bots` (Task 5) ; `Link` (`@/i18n/routing`).
- Produces: page d'accueil (composant client) ; clé i18n `onboarding.*`.

- [ ] **Step 1: Ajouter les clés i18n**

Dans `apps/web/messages/fr.json`, remplacer le bloc `"firstRun": { ... }` par un bloc `"onboarding"` :

```json
  "onboarding": {
    "welcomeTitle": "Bienvenue sur WABAGENT",
    "welcomeSubtitle": "Créez votre premier agent WhatsApp en quelques minutes. Vous pourrez tout modifier ensuite.",
    "createFirst": "Créer mon premier agent",
    "createAnother": "Créer un agent",
    "journeyTitle": "Votre parcours de démarrage",
    "agentsCount": "{count, plural, one {# agent} other {# agents}} — brouillon",
    "stepCreate": "Créer l'agent",
    "stepCreateDesc": "Nom, langues et personnalité de votre assistant.",
    "stepPersonalize": "Personnaliser & tester",
    "stepPersonalizeDesc": "Ajustez le ton, simulez une conversation gratuitement.",
    "stepConnect": "Connecter WhatsApp",
    "stepConnectDesc": "Reliez votre numéro WhatsApp Business.",
    "stepActivate": "Activer l'agent",
    "stepActivateDesc": "Mettez votre agent en ligne pour vos clients.",
    "statusDone": "Fait",
    "statusNext": "À faire",
    "statusLocked": "Verrouillé",
    "comingSoon": "Plan 7"
  },
```

Dans `apps/web/messages/en.json`, ajouter le bloc équivalent (mêmes clés) :

```json
  "onboarding": {
    "welcomeTitle": "Welcome to WABAGENT",
    "welcomeSubtitle": "Create your first WhatsApp agent in minutes. You can change everything later.",
    "createFirst": "Create my first agent",
    "createAnother": "Create an agent",
    "journeyTitle": "Your getting-started journey",
    "agentsCount": "{count, plural, one {# agent} other {# agents}} — draft",
    "stepCreate": "Create the agent",
    "stepCreateDesc": "Name, languages and personality of your assistant.",
    "stepPersonalize": "Personalize & test",
    "stepPersonalizeDesc": "Tune the tone, simulate a conversation for free.",
    "stepConnect": "Connect WhatsApp",
    "stepConnectDesc": "Link your WhatsApp Business number.",
    "stepActivate": "Activate the agent",
    "stepActivateDesc": "Bring your agent online for your customers.",
    "statusDone": "Done",
    "statusNext": "To do",
    "statusLocked": "Locked",
    "comingSoon": "Plan 7"
  },
```

Vérifier qu'aucune autre clé `firstRun` n'est référencée : `grep -rn "firstRun" apps/web/src`. S'il en reste, les migrer vers `onboarding`.

- [ ] **Step 2: Écrire le test qui échoue**

Créer `apps/web/src/app/[locale]/(app)/__tests__/home.test.tsx` :

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import Home from '../page';

vi.mock('@/i18n/routing', () => ({ Link: (p: { children: React.ReactNode; href: string }) => <a href={p.href}>{p.children}</a> }));

beforeEach(() => vi.restoreAllMocks());

function renderHome() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Home /></NextIntlClientProvider>);
}

test('first-run : 0 bot → CTA creer premier agent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  renderHome();
  expect(await screen.findByText('Créer mon premier agent')).toBeInTheDocument();
});

test('>=1 bot → checklist avec etape Creer cochee', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ bot_id: 'a', name: 'A', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'x' } }]), { status: 200 })));
  renderHome();
  await waitFor(() => expect(screen.getByText("Créer un agent")).toBeInTheDocument());
});
```

- [ ] **Step 3: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run "src/app/[locale]/(app)/__tests__/home.test.tsx"`
Expected: FAIL (page actuelle = stub `firstRun`).

- [ ] **Step 4: Implémenter — page d'accueil**

Remplacer `apps/web/src/app/[locale]/(app)/page.tsx` (composant client qui charge `/api/bots` et dérive la checklist). Fidélité visuelle : maquette `01-first-run.html`. Classes Tailwind sémantiques uniquement, **pas de gradient**.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { deriveChecklist, type BotSummary, type ChecklistState } from '@/lib/onboarding';

type StepKey = 'created' | 'personalized' | 'connected' | 'active';
const STEPS: { key: StepKey; plan7?: boolean }[] = [
  { key: 'created' }, { key: 'personalized' }, { key: 'connected', plan7: true }, { key: 'active', plan7: true },
];
const LABEL: Record<StepKey, { t: string; d: string }> = {
  created: { t: 'stepCreate', d: 'stepCreateDesc' },
  personalized: { t: 'stepPersonalize', d: 'stepPersonalizeDesc' },
  connected: { t: 'stepConnect', d: 'stepConnectDesc' },
  active: { t: 'stepActivate', d: 'stepActivateDesc' },
};

export default function Home() {
  const t = useTranslations('onboarding');
  const [bots, setBots] = useState<BotSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/bots').then((r) => (r.ok ? r.json() : [])).then((b) => { if (alive) setBots(b as BotSummary[]); }).catch(() => { if (alive) setBots([]); });
    return () => { alive = false; };
  }, []);

  const checklist: ChecklistState = deriveChecklist(bots ?? []);
  const hasBots = (bots?.length ?? 0) > 0;

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl text-fg">{t('welcomeTitle')}</h1>
      <p className="mt-2 max-w-lg text-muted">{t('welcomeSubtitle')}</p>

      <div className="mt-8 rounded-xl border border-border bg-surface p-7">
        <div className="font-semibold text-fg">{t('journeyTitle')}</div>
        {hasBots && <div className="mt-1 text-sm text-muted">{t('agentsCount', { count: bots!.length })}</div>}
        <ul className="mt-5 divide-y divide-border">
          {STEPS.map(({ key, plan7 }) => {
            const done = checklist[key];
            const status = done ? 'statusDone' : plan7 ? 'statusLocked' : 'statusNext';
            return (
              <li key={key} className="flex items-center gap-4 py-3.5">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-success text-white' : plan7 ? 'border-2 border-dashed border-muted-2 text-muted-2' : 'border-2 border-accent bg-accent-soft text-accent-hover'}`}>
                  {done ? '✓' : STEPS.findIndex((s) => s.key === key) + 1}
                </span>
                <span className="flex-1">
                  <span className="block font-medium text-fg">{t(LABEL[key].t)}</span>
                  <span className="block text-xs text-muted">{t(LABEL[key].d)}</span>
                </span>
                <span className="text-xs font-semibold text-muted-2">{plan7 ? `${t('statusLocked')} · ${t('comingSoon')}` : t(status)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-7 text-center">
        <Link href="/agents/new" className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg hover:bg-accent-hover">
          {hasBots ? t('createAnother') : t('createFirst')} →
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Lancer le test (passe) + non-régression web**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run`
Expected: PASS (y compris les suites existantes ; si une suite référençait `firstRun`, elle a été migrée au Step 1).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/[locale]/(app)/page.tsx" apps/web/messages/fr.json apps/web/messages/en.json "apps/web/src/app/[locale]/(app)/__tests__/home.test.tsx"
git commit -m "feat(web): accueil onboarding first-run + checklist derivee"
```

---

## Task 8: Wizard — conteneur d'état + Étape 1 « Identité »

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/agents/new/page.tsx`
- Create: `apps/web/src/components/wizard/wizard.tsx`
- Create: `apps/web/src/components/wizard/stepper.tsx`
- Create: `apps/web/src/components/wizard/step-identity.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `wizard`)
- Test: `apps/web/src/components/wizard/__tests__/step-identity.test.tsx`

**Maquette :** `.superpowers/brainstorm/62043-1782384014/content/02-wizard-step1.html`.

**Interfaces:**
- Consumes: `slugify` + types `WizardState`/`LangPersonality` (Task 6).
- Produces:
  - `wizard.tsx` : état partagé `WizardState` + `step` (1|2|3|'success') + `createdBotId` ; helpers `update(patch)`, `goNext`, `goBack`, `setStep`.
  - Props attendues par chaque étape : `{ state: WizardState; update: (p: Partial<WizardState>) => void; onNext: () => void; onBack?: () => void }`.
  - `wizard.*` i18n.

- [ ] **Step 1: Ajouter les clés i18n `wizard` (FR + EN)**

`fr.json` — ajouter :
```json
  "wizard": {
    "stepIdentity": "Identité",
    "stepPersonality": "Personnalité",
    "stepTest": "Tester",
    "quit": "Quitter",
    "cancel": "Annuler",
    "back": "Retour",
    "continue": "Continuer",
    "identityTitle": "Donnez vie à votre agent",
    "identityLead": "Commençons par l'essentiel : son nom et les langues qu'il parlera à vos clients.",
    "name": "Nom de l'agent",
    "namePlaceholder": "Ex. Conseiller commercial",
    "slugHint": "identifiant technique : {slug} · généré automatiquement, modifiable",
    "languages": "Langues prises en charge",
    "languagesHint": "L'agent répond dans la langue du client. La personnalité se rédige par langue.",
    "defaultLanguage": "Langue par défaut",
    "defaultBadge": "par défaut"
  },
```
`en.json` — équivalent :
```json
  "wizard": {
    "stepIdentity": "Identity",
    "stepPersonality": "Personality",
    "stepTest": "Test",
    "quit": "Quit",
    "cancel": "Cancel",
    "back": "Back",
    "continue": "Continue",
    "identityTitle": "Bring your agent to life",
    "identityLead": "Let's start with the basics: its name and the languages it will speak to your customers.",
    "name": "Agent name",
    "namePlaceholder": "e.g. Sales advisor",
    "slugHint": "technical id: {slug} · auto-generated, editable",
    "languages": "Supported languages",
    "languagesHint": "The agent replies in the customer's language. Personality is written per language.",
    "defaultLanguage": "Default language",
    "defaultBadge": "default"
  },
```

- [ ] **Step 2: Écrire le test qui échoue**

`apps/web/src/components/wizard/__tests__/step-identity.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { Wizard } from '../wizard';

vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push: vi.fn() }), Link: (p: { children: React.ReactNode }) => p.children }));
beforeEach(() => vi.restoreAllMocks());

function renderWizard() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Wizard /></NextIntlClientProvider>);
}

test('le nom genere le slug automatiquement', async () => {
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent'), 'Assistant Boutique');
  expect(screen.getByText(/assistant-boutique/)).toBeInTheDocument();
});

test('Continuer passe a l\'etape Personnalite', async () => {
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent'), 'Ventes');
  await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(screen.getByText('La personnalité de votre agent')).toBeInTheDocument();
});
```

(La 2e assertion dépend de l'Étape 2 — Task 9. Marquer ce test `.skip` sur la 2e jusqu'à Task 9, OU implémenter un placeholder d'étape 2 minimal dans Task 8 puis l'enrichir en Task 9. **Choix retenu** : en Task 8, `step-personality.tsx` est un stub affichant le titre « La personnalité de votre agent » ; Task 9 le remplit. Ainsi les deux tests passent dès Task 8.)

- [ ] **Step 3: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/components/wizard`
Expected: FAIL (composants inexistants).

- [ ] **Step 4: Implémenter — `stepper.tsx`**

```tsx
import { useTranslations } from 'next-intl';

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const t = useTranslations('wizard');
  const steps = [t('stepIdentity'), t('stepPersonality'), t('stepTest')];
  return (
    <div className="mx-auto flex max-w-xl items-center justify-center py-8">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < current;
        const active = n === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-accent text-accent-fg' : done ? 'bg-success text-white' : 'border-2 border-border bg-surface text-muted-2'}`}>
                {done ? '✓' : n}
              </span>
              <span className={`text-sm font-semibold ${active || done ? 'text-fg' : 'text-muted-2'}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <span className={`mx-3.5 h-0.5 w-14 ${done ? 'bg-success' : 'bg-border'}`} />}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Implémenter — `wizard.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Stepper } from './stepper';
import { StepIdentity } from './step-identity';
import { StepPersonality } from './step-personality';
import { StepTest } from './step-test';
import { Success } from './success';
import type { WizardState } from '@/lib/bot-draft';

const initialState: WizardState = {
  name: '', slug: '', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [],
};

export function Wizard() {
  const t = useTranslations('wizard');
  const router = useRouter();
  const [state, setState] = useState<WizardState>(initialState);
  const [step, setStep] = useState<1 | 2 | 3 | 'success'>(1);
  const [createdBotId, setCreatedBotId] = useState<string | null>(null);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex h-14 items-center justify-between border-b border-border bg-surface px-5">
        <span className="font-semibold tracking-wide text-fg">WABAGENT</span>
        <button onClick={() => router.push('/')} className="font-medium text-muted hover:text-fg">✕ {t('quit')}</button>
      </div>

      {step !== 'success' && <Stepper current={step} />}

      {step === 1 && <StepIdentity state={state} update={update} onNext={() => setStep(2)} onBack={() => router.push('/')} />}
      {step === 2 && (
        <StepPersonality
          state={state}
          update={update}
          createdBotId={createdBotId}
          onCreated={(id) => { setCreatedBotId(id); setStep(3); }}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && createdBotId && <StepTest botId={createdBotId} state={state} onFinish={() => setStep('success')} onBack={() => setStep(2)} />}
      {step === 'success' && <Success state={state} onHome={() => router.push('/')} onEdit={() => setStep(2)} />}
    </div>
  );
}
```

- [ ] **Step 6: Implémenter — `step-identity.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { slugify, type WizardState, type LangPersonality } from '@/lib/bot-draft';

const ALL_LANGS = ['fr', 'en'] as const;
const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'English' };

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

function blankLang(): LangPersonality {
  return { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' };
}

export function StepIdentity({ state, update, onNext, onBack }: Props) {
  const t = useTranslations('wizard');
  const [slugEdited, setSlugEdited] = useState(false);

  const onName = (name: string) => {
    update({ name, ...(slugEdited ? {} : { slug: slugify(name) }) });
  };

  const toggleLang = (lang: string) => {
    const has = state.languages.includes(lang);
    if (has && state.languages.length === 1) return; // au moins une langue
    const languages = has ? state.languages.filter((l) => l !== lang) : [...state.languages, lang];
    const perLang = { ...state.perLang };
    if (!has) perLang[lang] = blankLang();
    const defaultLanguage = languages.includes(state.defaultLanguage) ? state.defaultLanguage : languages[0];
    update({ languages, perLang, defaultLanguage });
  };

  const canContinue = state.name.trim().length > 0 && state.slug.length > 0;

  return (
    <div className="mx-auto max-w-xl px-5 pb-16">
      <div className="rounded-xl border border-border bg-surface p-8">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-hover">1 / 3</div>
        <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('identityTitle')}</h1>
        <p className="mt-1.5 mb-6 text-muted">{t('identityLead')}</p>

        <label className="mb-1.5 block font-semibold text-fg" htmlFor="agent-name">{t('name')}</label>
        <input id="agent-name" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none"
          value={state.name} placeholder={t('namePlaceholder')} onChange={(e) => onName(e.target.value)} />
        <input aria-label="slug" className="mt-2 w-full bg-transparent font-mono text-xs text-muted focus:text-fg focus:outline-none"
          value={state.slug} onChange={(e) => { setSlugEdited(true); update({ slug: slugify(e.target.value) }); }} />
        <p className="mt-1 font-mono text-xs text-muted-2">{t('slugHint', { slug: state.slug || '—' })}</p>

        <div className="mt-6">
          <span className="mb-2 block font-semibold text-fg">{t('languages')}</span>
          <div className="flex flex-wrap gap-2.5">
            {ALL_LANGS.map((lang) => {
              const on = state.languages.includes(lang);
              return (
                <button key={lang} type="button" onClick={() => toggleLang(lang)}
                  className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent-hover' : 'border-border text-fg'}`}>
                  {on ? '✓ ' : ''}{LANG_LABEL[lang]}{state.defaultLanguage === lang ? ` ★ ${t('defaultBadge')}` : ''}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted-2">{t('languagesHint')}</p>
        </div>

        <div className="mt-6">
          <span className="mb-2 block font-semibold text-fg">{t('defaultLanguage')}</span>
          <div className="flex gap-2.5">
            {state.languages.map((lang) => (
              <button key={lang} type="button" onClick={() => update({ defaultLanguage: lang })}
                className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold ${state.defaultLanguage === lang ? 'border-brand bg-[#EAF2EE] text-brand-deep' : 'border-border text-fg'}`}>
                {LANG_LABEL[lang]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('cancel')}</button>
          <button onClick={onNext} disabled={!canContinue}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">{t('continue')} →</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implémenter — stubs `step-personality.tsx`, `step-test.tsx`, `success.tsx` + page**

`step-personality.tsx` (stub minimal, rempli en Task 9) :
```tsx
'use client';
import type { WizardState } from '@/lib/bot-draft';
interface Props { state: WizardState; update: (p: Partial<WizardState>) => void; createdBotId: string | null; onCreated: (id: string) => void; onBack: () => void; }
export function StepPersonality(_props: Props) {
  return <div className="mx-auto max-w-xl px-5 pb-16"><div className="rounded-xl border border-border bg-surface p-8"><h1 className="font-serif text-2xl text-fg">La personnalité de votre agent</h1></div></div>;
}
```
`step-test.tsx` (stub minimal, rempli en Task 10) :
```tsx
'use client';
import type { WizardState } from '@/lib/bot-draft';
interface Props { botId: string; state: WizardState; onFinish: () => void; onBack: () => void; }
export function StepTest(_props: Props) { return <div className="mx-auto max-w-xl px-5 pb-16" />; }
```
`success.tsx` (stub minimal, rempli en Task 10) :
```tsx
'use client';
import type { WizardState } from '@/lib/bot-draft';
interface Props { state: WizardState; onHome: () => void; onEdit: () => void; }
export function Success(_props: Props) { return <div className="mx-auto max-w-xl px-5 pb-16" />; }
```
`apps/web/src/app/[locale]/(app)/agents/new/page.tsx` :
```tsx
import { Wizard } from '@/components/wizard/wizard';
export default function NewAgentPage() { return <Wizard />; }
```

- [ ] **Step 8: Lancer le test (passe) + non-régression web**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/wizard "apps/web/src/app/[locale]/(app)/agents" apps/web/messages/fr.json apps/web/messages/en.json
git commit -m "feat(web): wizard conteneur + etape 1 Identite (nom auto-slug, langues)"
```

---

## Task 9: Wizard — Étape 2 « Personnalité » (+ création/PATCH du draft)

**Files:**
- Replace: `apps/web/src/components/wizard/step-personality.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespace `wizard`, ajout des clés Personnalité)
- Test: `apps/web/src/components/wizard/__tests__/step-personality.test.tsx`

**Maquette :** `.superpowers/brainstorm/62043-1782384014/content/03-wizard-step2.html`.

**Interfaces:**
- Consumes: `buildBotPayload`, `nextSlug` (Task 6) ; `POST /api/bots`, `PATCH /api/bots/:id`, `GET /api/bots` (Task 5) ; props de Task 8 (`state`, `update`, `createdBotId`, `onCreated`, `onBack`).
- Produces: étape 2 complète ; au submit, crée le draft (POST) ou le met à jour (PATCH si `createdBotId` déjà posé), gère la collision de slug (409), puis `onCreated(botId)`.

- [ ] **Step 1: Ajouter les clés i18n (FR + EN)**

Ajouter aux objets `wizard` existants (FR) :
```json
    "personalityTitle": "La personnalité de votre agent",
    "personalityLead": "Décrivez son rôle en quelques mots — on en fait des instructions claires. Réglages par langue.",
    "role": "Rôle / métier",
    "tone": "Ton",
    "objective": "Objectif principal",
    "info": "Informations clés à connaître",
    "advanced": "Mode avancé — instructions générées (prompt)",
    "advancedHint": "éditable · écrase le mode guidé pour cette langue",
    "welcomeSection": "Message d'accueil",
    "welcomeToggle": "Envoyer un message d'accueil automatique",
    "leadSection": "Informations à collecter",
    "leadHint": "Champs que l'agent cherchera à recueillir (lead).",
    "addField": "Ajouter un champ",
    "createAndTest": "Créer & tester",
    "creating": "Création…",
    "createError": "La création a échoué. Vérifiez les champs et réessayez."
```
(EN équivalent : `personalityTitle: "Your agent's personality"`, `role: "Role / business"`, `tone: "Tone"`, `objective: "Main objective"`, `info: "Key information"`, `advanced: "Advanced mode — generated instructions (prompt)"`, `advancedHint: "editable · overrides guided mode for this language"`, `welcomeSection: "Welcome message"`, `welcomeToggle: "Send an automatic welcome message"`, `leadSection: "Information to collect"`, `leadHint: "Fields the agent will try to collect (lead)."`, `addField: "Add a field"`, `createAndTest: "Create & test"`, `creating: "Creating…"`, `createError: "Creation failed. Check the fields and try again."`)

- [ ] **Step 2: Écrire le test qui échoue**

`apps/web/src/components/wizard/__tests__/step-personality.test.tsx` :

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { useState } from 'react';
import { StepPersonality } from '../step-personality';
import type { WizardState } from '@/lib/bot-draft';

beforeEach(() => vi.restoreAllMocks());

const baseState: WizardState = {
  name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [],
};

// Wrapper a etat reel : sans lui, l'input controle par `state` ne refleterait pas la frappe.
function Harness({ onCreated }: { onCreated: (id: string) => void }) {
  const [state, setState] = useState<WizardState>(baseState);
  const update = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  return <StepPersonality state={state} update={update} createdBotId={null} onCreated={onCreated} onBack={() => {}} />;
}

function renderStep(onCreated = vi.fn()) {
  render(<NextIntlClientProvider locale="fr" messages={messages}><Harness onCreated={onCreated} /></NextIntlClientProvider>);
  return { onCreated };
}

test('Créer & tester poste le draft puis appelle onCreated', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bot_id: 'ventes' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes'));
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.personality.fr.role).toBe('Conseiller');
});

test('collision de slug (409) → suffixe et réessaie', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'bot_id déjà pris.' } }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ bot_id: 'ventes' }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ bot_id: 'ventes-2' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const { onCreated } = renderStep();
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ventes-2'));
});
```

- [ ] **Step 3: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/components/wizard/__tests__/step-personality.test.tsx`
Expected: FAIL (stub actuel).

- [ ] **Step 4: Implémenter — `step-personality.tsx`**

Remplacer le stub. Logique de soumission : construire le payload (`buildBotPayload`), POST `/api/bots` ; si déjà créé (`createdBotId`), PATCH `/api/bots/:id` à la place ; sur 409, GET `/api/bots`, recalculer le slug via `nextSlug(state.slug, taken)`, mettre à jour l'état et re-POST une fois.

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildBotPayload, nextSlug, type WizardState, type LangPersonality } from '@/lib/bot-draft';

const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'English' };
const TONES = ['Chaleureux', 'Professionnel', 'Concis', 'Enthousiaste', 'Formel'];

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  createdBotId: string | null;
  onCreated: (id: string) => void;
  onBack: () => void;
}

export function StepPersonality({ state, update, createdBotId, onCreated, onBack }: Props) {
  const t = useTranslations('wizard');
  const [lang, setLang] = useState(state.defaultLanguage);
  const [advanced, setAdvanced] = useState(false);
  const [leadInput, setLeadInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const p: LangPersonality = state.perLang[lang] ?? { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' };
  const setP = (patch: Partial<LangPersonality>) => update({ perLang: { ...state.perLang, [lang]: { ...p, ...patch } } });

  const toggleTone = (tone: string) => {
    const has = p.tones.includes(tone);
    setP({ tones: has ? p.tones.filter((x) => x !== tone) : [...p.tones, tone] });
  };

  const addLead = () => {
    const v = leadInput.trim();
    if (v && !state.leadFields.includes(v)) update({ leadFields: [...state.leadFields, v] });
    setLeadInput('');
  };

  async function postOrPatch(slug: string): Promise<Response> {
    const payload = buildBotPayload({ ...state, slug });
    if (createdBotId) return fetch(`/api/bots/${encodeURIComponent(createdBotId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }

  const submit = async () => {
    setBusy(true); setError(false);
    try {
      if (createdBotId) {
        const res = await postOrPatch(state.slug);
        if (!res.ok) throw new Error('patch');
        onCreated(createdBotId);
        return;
      }
      let res = await postOrPatch(state.slug);
      if (res.status === 409) {
        const list = await (await fetch('/api/bots')).json() as { bot_id: string }[];
        const slug = nextSlug(state.slug, list.map((b) => b.bot_id));
        update({ slug });
        res = await postOrPatch(slug);
      }
      if (!res.ok) throw new Error('create');
      const bot = await res.json() as { bot_id: string };
      onCreated(bot.bot_id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = state.languages.some((l) => {
    const x = state.perLang[l];
    return x && ((x.mode === 'guided' && x.role.trim()) || (x.mode === 'raw' && x.raw.trim()));
  });

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16">
      <div className="rounded-xl border border-border bg-surface p-8">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-hover">2 / 3</div>
        <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('personalityTitle')}</h1>
        <p className="mt-1.5 mb-6 text-muted">{t('personalityLead')}</p>

        {state.languages.length > 1 && (
          <div className="mb-6 flex w-fit gap-1.5 rounded-lg border border-border p-1">
            {state.languages.map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`rounded-md px-4 py-1.5 font-semibold ${lang === l ? 'bg-brand-deep text-[#E6EFEA]' : 'text-muted'}`}>{LANG_LABEL[l]}</button>
            ))}
          </div>
        )}

        <label className="mb-1.5 block font-semibold text-fg" htmlFor="role">{t('role')}</label>
        <input id="role" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none" value={p.role} onChange={(e) => setP({ role: e.target.value, mode: 'guided' })} />

        <div className="mt-5">
          <span className="mb-2 block font-semibold text-fg">{t('tone')}</span>
          <div className="flex flex-wrap gap-2.5">
            {TONES.map((tone) => (
              <button key={tone} onClick={() => toggleTone(tone)} className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${p.tones.includes(tone) ? 'border-accent bg-accent-soft text-accent-hover' : 'border-border text-fg'}`}>{tone}</button>
            ))}
          </div>
        </div>

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="objective">{t('objective')}</label>
        <input id="objective" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none" value={p.objective} onChange={(e) => setP({ objective: e.target.value })} />

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="info">{t('info')}</label>
        <textarea id="info" className="min-h-[74px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none" value={p.info} onChange={(e) => setP({ info: e.target.value })} />

        <div className="mt-3 rounded-xl border border-dashed border-border">
          <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-between bg-bg px-4 py-3 text-left text-sm font-semibold text-fg">
            <span>{advanced ? '▾' : '▸'} {t('advanced')}</span><span className="text-xs font-normal text-muted-2">{t('advancedHint')}</span>
          </button>
          {advanced && (
            <div className="border-t border-dashed border-border p-4">
              <textarea className="min-h-[130px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 font-mono text-xs text-fg focus:border-accent focus:outline-none"
                value={p.raw} onChange={(e) => setP({ raw: e.target.value, mode: 'raw' })} />
            </div>
          )}
        </div>

        <div className="my-6 h-px bg-border" />
        <div className="font-semibold text-fg">{t('welcomeSection')}</div>
        <div className="mt-3 mb-3 flex items-center justify-between rounded-lg border border-border px-4 py-3">
          <span className="text-fg">{t('welcomeToggle')}</span>
          <button onClick={() => update({ welcomeEnabled: !state.welcomeEnabled })} aria-pressed={state.welcomeEnabled}
            className={`relative h-6 w-11 rounded-full ${state.welcomeEnabled ? 'bg-success' : 'bg-muted-2'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${state.welcomeEnabled ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>
        {state.welcomeEnabled && (
          <textarea className="min-h-[60px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none"
            value={state.welcome[lang] ?? ''} onChange={(e) => update({ welcome: { ...state.welcome, [lang]: e.target.value } })} />
        )}

        <div className="my-6 h-px bg-border" />
        <div className="font-semibold text-fg">{t('leadSection')}</div>
        <p className="mb-3 text-sm text-muted">{t('leadHint')}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          {state.leadFields.map((f) => (
            <span key={f} className="flex items-center gap-1.5 rounded-md bg-[#EAF2EE] px-2.5 py-1 text-sm font-semibold text-brand-deep">
              {f}<button onClick={() => update({ leadFields: state.leadFields.filter((x) => x !== f) })} className="text-muted-2">✕</button>
            </span>
          ))}
          <input className="min-w-[140px] flex-1 bg-transparent px-1.5 py-1 text-sm focus:outline-none" placeholder={t('addField')}
            value={leadInput} onChange={(e) => setLeadInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLead(); } }} />
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-danger">{t('createError')}</p>}

        <div className="mt-7 flex items-center justify-between">
          <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
          <button onClick={submit} disabled={!canSubmit || busy}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            {busy ? t('creating') : t('createAndTest')} →
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Lancer le test (passe)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/components/wizard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/wizard/step-personality.tsx apps/web/messages/fr.json apps/web/messages/en.json apps/web/src/components/wizard/__tests__/step-personality.test.tsx
git commit -m "feat(web): wizard etape 2 Personnalite (guide/brut, accueil, leads) + creation/PATCH draft"
```

---

## Task 10: Wizard — Étape 3 « Tester » (simulateur) + Écran de succès

**Files:**
- Replace: `apps/web/src/components/wizard/step-test.tsx`
- Replace: `apps/web/src/components/wizard/success.tsx`
- Modify: `apps/web/messages/fr.json`, `apps/web/messages/en.json` (namespaces `simulate`, `success`)
- Test: `apps/web/src/components/wizard/__tests__/step-test.test.tsx`

**Maquettes :** `04-wizard-step3.html`, `05-success.html`.

**Interfaces:**
- Consumes: `POST /api/bots/:id/simulate` (Task 5) ; props de Task 8 (`StepTest`: `botId`, `state`, `onFinish`, `onBack` ; `Success`: `state`, `onHome`, `onEdit`).
- Produces: simulateur de chat gratuit (`use_bot_config:false`, gestion `session_id`, réinitialisation) ; écran de succès récap draft.

- [ ] **Step 1: Ajouter les clés i18n (FR + EN)**

`fr.json` :
```json
  "simulate": {
    "title": "Discutez avec votre agent",
    "lead": "Testez son comportement comme un vrai client. Modifiez la personnalité à l'étape précédente si besoin.",
    "freeBadge": "Simulation gratuite — clés de la plateforme, modèle Haiku. Aucune consommation sur votre quota.",
    "reset": "Réinitialiser",
    "placeholder": "Écrivez un message…",
    "online": "en ligne · simulation",
    "finish": "Terminer — agent créé",
    "back": "Retour à la personnalité",
    "sendError": "L'envoi a échoué. Réessayez."
  },
  "success": {
    "title": "Votre agent est prêt",
    "subtitle": "« {name} » est créé en brouillon. Il ne reçoit pas encore de clients — il faut le connecter à WhatsApp puis l'activer.",
    "agent": "Agent",
    "languages": "Langues",
    "status": "Statut",
    "draft": "Brouillon",
    "connectTitle": "Connecter WhatsApp",
    "connectDesc": "Reliez votre numéro WhatsApp Business pour mettre l'agent en ligne.",
    "comingSoon": "Plan 7",
    "backToAgents": "Retour aux agents",
    "editPersonality": "Modifier la personnalité"
  },
```
`en.json` (équivalent) :
```json
  "simulate": {
    "title": "Chat with your agent",
    "lead": "Test its behavior like a real customer. Edit the personality in the previous step if needed.",
    "freeBadge": "Free simulation — platform keys, Haiku model. No quota consumption.",
    "reset": "Reset",
    "placeholder": "Type a message…",
    "online": "online · simulation",
    "finish": "Finish — agent created",
    "back": "Back to personality",
    "sendError": "Sending failed. Try again."
  },
  "success": {
    "title": "Your agent is ready",
    "subtitle": "“{name}” is created as a draft. It does not receive customers yet — connect it to WhatsApp then activate it.",
    "agent": "Agent",
    "languages": "Languages",
    "status": "Status",
    "draft": "Draft",
    "connectTitle": "Connect WhatsApp",
    "connectDesc": "Link your WhatsApp Business number to bring the agent online.",
    "comingSoon": "Plan 7",
    "backToAgents": "Back to agents",
    "editPersonality": "Edit personality"
  },
```

- [ ] **Step 2: Écrire le test qui échoue**

`apps/web/src/components/wizard/__tests__/step-test.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { StepTest } from '../step-test';
import type { WizardState } from '@/lib/bot-draft';

beforeEach(() => vi.restoreAllMocks());

const state: WizardState = {
  name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: { fr: 'Bonjour 👋' }, leadFields: [],
};

function renderStep() {
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <StepTest botId="ventes" state={state} onFinish={vi.fn()} onBack={vi.fn()} />
  </NextIntlClientProvider>);
}

test('affiche le message d\'accueil et envoie un message gratuit', async () => {
  expect.assertions(3);
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string).use_bot_config).toBe(false);
    return new Response(JSON.stringify({ session_id: 's1', reply: 'Bonjour, comment aider ?', model: 'haiku' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  renderStep();
  expect(screen.getByText('Bonjour 👋')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), 'Salut');
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText('Bonjour, comment aider ?')).toBeInTheDocument();
});
```

- [ ] **Step 3: Lancer le test (échoue)**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run src/components/wizard/__tests__/step-test.test.tsx`
Expected: FAIL (stub actuel).

- [ ] **Step 4: Implémenter — `step-test.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WizardState } from '@/lib/bot-draft';

interface Msg { role: 'bot' | 'me'; text: string }
interface Props { botId: string; state: WizardState; onFinish: () => void; onBack: () => void }

export function StepTest({ botId, state, onFinish, onBack }: Props) {
  const t = useTranslations('simulate');
  const welcome = state.welcomeEnabled ? state.welcome[state.defaultLanguage]?.trim() : '';
  const initial: Msg[] = welcome ? [{ role: 'bot', text: welcome }] : [];
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [session, setSession] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const reset = () => { setMessages(initial); setSession(undefined); setError(false); };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput(''); setError(false); setBusy(true);
    setMessages((m) => [...m, { role: 'me', text }]);
    try {
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/simulate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, use_bot_config: false, ...(session ? { session_id: session } : {}) }),
      });
      if (!res.ok) throw new Error('simulate');
      const out = await res.json() as { session_id: string; reply: string };
      setSession(out.session_id);
      setMessages((m) => [...m, { role: 'bot', text: out.reply }]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-5 pb-12">
      <div className="text-center text-xs font-semibold uppercase tracking-wider text-accent-hover">3 / 3</div>
      <h1 className="mt-1.5 text-center font-serif text-2xl text-fg">{t('title')}</h1>
      <p className="mt-1.5 mb-4 text-center text-muted">{t('lead')}</p>

      <div className="mb-4 rounded-lg border border-[#CFE3D8] bg-[#EAF2EE] px-3 py-2.5 text-center text-xs font-medium text-brand-deep">⚡ {t('freeBadge')}</div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-3 bg-brand-deep px-4 py-3 text-[#E6EFEA]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-bold text-brand-mint">{state.name.charAt(0).toUpperCase()}</span>
          <span className="flex-1"><span className="block font-semibold">{state.name}</span><span className="block text-[11px] text-brand-mint">{t('online')}</span></span>
          <button onClick={reset} className="text-xs text-[#B6C5BC]">↻ {t('reset')}</button>
        </div>
        <div className="flex min-h-[320px] flex-col gap-2.5 bg-[#E7EDE9] p-4">
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${m.role === 'bot' ? 'self-start rounded-tl-sm bg-white text-fg' : 'self-end rounded-tr-sm bg-[#DCF7E3] text-fg'}`}>{m.text}</div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border bg-surface p-3">
          <input className="flex-1 rounded-full border border-border px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
            placeholder={t('placeholder')} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} />
          <button onClick={() => void send()} disabled={busy} className="h-10 w-10 shrink-0 rounded-full bg-accent font-bold text-accent-fg disabled:opacity-50">➤</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{t('sendError')}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
        <button onClick={onFinish} className="rounded-xl bg-success px-6 py-3 font-semibold text-white">{t('finish')} ✓</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implémenter — `success.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { WizardState } from '@/lib/bot-draft';

const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'English' };
interface Props { state: WizardState; onHome: () => void; onEdit: () => void }

export function Success({ state, onHome, onEdit }: Props) {
  const t = useTranslations('success');
  return (
    <div className="mx-auto max-w-lg px-5 py-12 text-center">
      <div className="mx-auto mb-5 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#E7F6EF] text-4xl text-success">✓</div>
      <h1 className="font-serif text-3xl text-fg">{t('title')}</h1>
      <p className="mx-auto mt-2 mb-7 max-w-md text-muted">{t('subtitle', { name: state.name })}</p>

      <div className="rounded-xl border border-border bg-surface p-5 text-left">
        <div className="flex justify-between py-2"><span className="text-muted">{t('agent')}</span><span className="font-semibold text-fg">{state.name}</span></div>
        <div className="flex justify-between border-t border-border py-2"><span className="text-muted">{t('languages')}</span><span className="font-semibold text-fg">{state.languages.map((l) => LANG_LABEL[l]).join(' · ')}</span></div>
        <div className="flex justify-between border-t border-border py-2"><span className="text-muted">{t('status')}</span><span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-hover">● {t('draft')}</span></div>
      </div>

      <div className="mt-6 flex items-center gap-3.5 rounded-xl border border-border bg-surface p-4 text-left opacity-75">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg text-lg">🔗</span>
        <span className="flex-1"><span className="block font-semibold text-fg">{t('connectTitle')}</span><span className="block text-xs text-muted">{t('connectDesc')}</span></span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted-2">{t('comingSoon')}</span>
      </div>

      <div className="mt-7 flex justify-center gap-3">
        <button onClick={onHome} className="rounded-xl border border-border bg-surface px-5 py-3 font-semibold text-fg">{t('backToAgents')}</button>
        <button onClick={onEdit} className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover">{t('editPersonality')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Lancer le test (passe) + non-régression web**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/wizard/step-test.tsx apps/web/src/components/wizard/success.tsx apps/web/messages/fr.json apps/web/messages/en.json apps/web/src/components/wizard/__tests__/step-test.test.tsx
git commit -m "feat(web): wizard etape 3 simulateur gratuit + ecran de succes"
```

---

## Task 11: e2e Playwright — parcours onboarding complet

**Files:**
- Modify: `apps/web/e2e/mock-engine.ts` (ajouter le store bots + endpoints)
- Create: `apps/web/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: tout le parcours web (Tasks 5-10) ; mock-engine auth existant.
- Produces: mock-engine avec `GET/POST /bots`, `PATCH /bots/:id`, `POST /bots/:id/simulate` ; spec du parcours complet (login → wizard → simulate → succès).

- [ ] **Step 1: Étendre `mock-engine.ts`**

Remplacer le contenu de `apps/web/e2e/mock-engine.ts` par (ajoute un store bots en mémoire, garde l'auth) :

```ts
import { createServer } from 'node:http';

const PORT = 4999;

function send(res: import('node:http').ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

const user = { id: 1, email: 'demo@wabagent.test', role: 'client_admin', client_id: 'c1', status: 'active' };
const bots: Record<string, unknown>[] = [];

createServer(async (req, res) => {
  const url = (req.url ?? '').split('?')[0];
  const method = req.method ?? 'GET';

  if (url.endsWith('/auth/login')) {
    const body = await readBody(req);
    if (body.email === 'demo@wabagent.test' && body.password === 'motdepasse12') return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/me')) return send(res, 200, user);
  if (url.endsWith('/auth/logout')) return send(res, 204);

  // /bots
  if (url.endsWith('/bots') && method === 'GET') return send(res, 200, bots);
  if (url.endsWith('/bots') && method === 'POST') {
    const body = await readBody(req);
    const detail = { ...body, status: 'draft', numbers: [] };
    bots.push(detail);
    return send(res, 201, detail);
  }
  // /bots/:id/simulate
  if (url.endsWith('/simulate') && method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, { session_id: 'sess-1', reply: `Réponse simulée à : ${String(body.message)}`, model: 'claude-haiku-4-5' });
  }
  // /bots/:id (PATCH)
  if (/\/bots\/[^/]+$/.test(url) && method === 'PATCH') {
    const body = await readBody(req);
    return send(res, 200, { ...body, status: 'draft', numbers: [] });
  }

  return send(res, 404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
}).listen(PORT, () => console.log(`[MockEngine] http://localhost:${PORT}`));
```

- [ ] **Step 2: Écrire la spec e2e**

Créer `apps/web/e2e/onboarding.spec.ts` :

```ts
import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenue sur WABAGENT' })).toBeVisible();
}

test('parcours onboarding complet : creation + simulation + succes', async ({ page }) => {
  await login(page);

  await page.getByRole('link', { name: /Créer mon premier agent/ }).click();

  // Etape 1 — Identite
  await page.getByLabel('Nom de l\'agent').fill('Assistant Boutique');
  await page.getByRole('button', { name: /Continuer/ }).click();

  // Etape 2 — Personnalite
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent' })).toBeVisible();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer & tester/ }).click();

  // Etape 3 — Simulateur
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent' })).toBeVisible();
  await page.getByPlaceholder('Écrivez un message…').fill('Bonjour');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Réponse simulée à : Bonjour/)).toBeVisible();

  // Terminer -> Succes
  await page.getByRole('button', { name: /Terminer/ }).click();
  await expect(page.getByRole('heading', { name: 'Votre agent est prêt' })).toBeVisible();
});
```

- [ ] **Step 3: Lancer l'e2e**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx playwright test e2e/onboarding.spec.ts`
Expected: PASS (1 test). Note : le webServer Playwright lance `npm run build` ; prévoir le temps de build.

- [ ] **Step 4: Vérifier la non-régression e2e complète**

Run: `cd /Users/francoisgreze/www/cyran-labs-engine/apps/web && npx playwright test`
Expected: PASS (login + accept-invite + onboarding).

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/mock-engine.ts apps/web/e2e/onboarding.spec.ts
git commit -m "test(web/e2e): parcours onboarding complet (login -> wizard -> simulate -> succes)"
```

---

## Vérification finale (avant revue de branche)

- [ ] Engine : `cd /Users/francoisgreze/www/cyran-labs-engine && npm test` → vert.
- [ ] Web unitaires : `cd apps/web && npm test` → vert.
- [ ] Web e2e : `cd apps/web && npx playwright test` → vert.
- [ ] `grep -rn "firstRun" apps/web/src` → aucun résultat (migration i18n complète).
- [ ] Aucun gradient introduit (`grep -rn "gradient" apps/web/src` → aucun).
- [ ] Author git de tous les commits : `Francois Greze <francois@cyran.fr>`.
