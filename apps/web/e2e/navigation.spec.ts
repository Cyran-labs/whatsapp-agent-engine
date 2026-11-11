import { test, expect, type Locator, type Page } from '@playwright/test';
import { applyScenario, loginToAgents, orgSwitcher, pageBar, rail, resetMock } from './helpers';

/**
 * Parcours de la navigation (spec refonte de la navigation, 5, 7.3, 9, 10 et 11) : fil d'Ariane et action principale
 * de chaque page, rail par rôle, mention « Ne répond pas » aux cinq endroits, droits du conseiller, sélecteur.
 */

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const ORG = 'Maison Lumière';
const AGENT_NUMBER = '+33 1 84 80 12 34';

function trail(page: Page): Locator {
  return page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('listitem');
}

function orgBlock(page: Page): Locator {
  return page.locator('[data-org-block]');
}

/** Valeur de `data-rail-entry` de chaque entrée du rail, dans l'ordre, sans la marque. */
async function railEntries(page: Page): Promise<string[]> {
  return rail(page)
    .locator('[data-rail-entry]:not([data-rail-entry="brand"])')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rail-entry') ?? ''));
}

/**
 * Action principale d'une page (zone `data-page-action` de la barre du haut) : les libellés de ses liens et boutons,
 * dans l'ordre, et la ligne grise qui la précède s'il y en a une. Nul : la page n'a pas d'action.
 */
interface PageAction { controls: string[]; note?: string }
const PERIOD: PageAction = { controls: ['7 j', '30 j', '90 j'] };

/** Pages de l'administrateur (spec 10 et 11) : adresse, fil d'Ariane attendu, action principale, entrée active du rail. */
const ADMIN_PAGES: { url: string; trail: string[]; action: PageAction | null; space: string | null }[] = [
  { url: '/fr', trail: [ORG, 'Agents IA', 'Tous les agents IA'], action: { controls: ['+ Créer un agent IA'] }, space: 'agents' },
  { url: '/fr?entity=1', trail: [ORG, 'Agents IA', 'Entité : Boutique Paris'], action: { controls: ['+ Créer un agent IA'] }, space: 'agents' },
  { url: '/fr?status=active', trail: [ORG, 'Agents IA', 'Statut : Online'], action: { controls: ['+ Créer un agent IA'] }, space: 'agents' },
  { url: '/fr/agents/demo-1', trail: [ORG, 'Agents IA', 'Support technique'], action: { controls: ['▶ Simuler'] }, space: 'agents' },
  { url: '/fr/agents/demo-1/usage', trail: [ORG, 'Agents IA', 'Support technique', 'Usage et coûts'], action: PERIOD, space: 'agents' },
  { url: '/fr/agents/new', trail: [ORG, 'Agents IA', 'Créer un agent IA'], action: { controls: ['✕ Quitter'], note: "Retour à Agents IA : rien n'est enregistré" }, space: 'agents' },
  { url: '/fr/usage', trail: [ORG, 'Usage et coûts', "Toute l'organisation"], action: PERIOD, space: 'usage' },
  { url: '/fr/usage?entity=1', trail: [ORG, 'Usage et coûts', 'Entité : Boutique Paris'], action: PERIOD, space: 'usage' },
  { url: '/fr/organisation/entites', trail: [ORG, 'Organisation', 'Entités'], action: { controls: ['+ Nouvelle entité'] }, space: 'organisation' },
  { url: '/fr/organisation/utilisateurs', trail: [ORG, 'Organisation', 'Utilisateurs'], action: { controls: ['+ Inviter'] }, space: 'organisation' },
  { url: '/fr/organisation/connexions', trail: [ORG, 'Organisation', 'Connexions'], action: { controls: ['+ Raccorder un compte WhatsApp'] }, space: 'organisation' },
  { url: '/fr/organisation/connexions/raccorder', trail: [ORG, 'Organisation', 'Connexions', 'Raccorder un compte WhatsApp'], action: null, space: 'organisation' },
  { url: '/fr/organisation/reglages', trail: [ORG, 'Organisation', 'Réglages'], action: null, space: 'organisation' },
  { url: '/fr/account/organisations', trail: ['Mon compte', 'Organisations'], action: null, space: 'account' },
  { url: '/fr/account/preferences', trail: ['Mon compte', 'Préférences'], action: null, space: 'account' },
  { url: '/fr/account/securite', trail: ['Mon compte', 'Sécurité'], action: null, space: 'account' },
];

// spec 5.2, 5.3, 10 et 11 : fil, action principale, entrée active du rail ; nom de l'organisation en tête de colonne et
// de fil sur chaque page connectée hors compte, et jamais de bloc Organisation sur les pages du compte
test("admin : fil d'Ariane, action principale et organisation en tête de chaque page", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  for (const p of ADMIN_PAGES) {
    await test.step(p.url, async () => {
      await page.goto(p.url);
      await expect(trail(page)).toHaveText(p.trail);
      // le dernier segment est la page courante, en gras ; les autres sont des liens
      await expect(trail(page).last().locator('[aria-current="page"]')).toHaveText(p.trail[p.trail.length - 1] ?? '');
      const action = pageBar(page).locator('[data-page-action]');
      if (p.action === null) {
        await expect(action).toHaveCount(0);
      } else {
        await expect(action.locator('a, button')).toHaveText(p.action.controls);
        if (p.action.note) await expect(action).toContainText(p.action.note);
      }
      await expect(rail(page).locator('[aria-current="page"]')).toHaveAttribute('data-rail-entry', p.space ?? '');
      if (p.space === 'account') {
        await expect(orgBlock(page)).toHaveCount(0);
      } else {
        await expect(orgBlock(page)).toContainText(ORG);
        await expect(page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('link', { name: ORG })).toHaveAttribute('href', '/fr');
      }
    });
  }
});

// spec 5.1 : sept entrées pour l'admin, dans l'ordre ; le conseiller n'a ni Organisation ni Usage
test('rail par rôle : sept entrées pour l\'admin, cinq pour le conseiller', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  expect(await railEntries(page)).toEqual(['organisation', 'agents', 'usage', 'leads', 'handover', 'help', 'account']);
  await expect(rail(page).getByRole('link', { name: 'Organisation', exact: true })).toHaveAttribute('href', '/fr/organisation');
  await expect(rail(page).getByRole('link', { name: 'Agents IA', exact: true })).toHaveAttribute('href', '/fr');
  await expect(rail(page).getByRole('link', { name: 'Usage', exact: true })).toHaveAttribute('href', '/fr/usage');
  await expect(rail(page).getByRole('link', { name: 'Compte, demo@wabagent.test' })).toHaveAttribute('href', '/fr/account/organisations');

  await page.context().clearCookies();
  await loginToAgents(page, 'advisor@wabagent.test');
  expect(await railEntries(page)).toEqual(['agents', 'leads', 'handover', 'help', 'account']);
  await expect(rail(page).getByRole('link', { name: 'Organisation', exact: true })).toHaveCount(0);
  await expect(rail(page).getByRole('link', { name: 'Usage', exact: true })).toHaveCount(0);
});

// spec 5.1 : une entrée grisée est aria-disabled, n'est pas un lien, ne navigue pas au clic et montre sa bulle au focus clavier
test('rail : entrées grisées sans navigation au clic, bulle au focus clavier', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites');
  const greyed = [
    ['Leads', 'Disponible prochainement : suivi des conversations et des leads.'],
    ['Reprise', 'Disponible prochainement : un conseiller reprend la conversation.'],
    ['Aide', 'Disponible prochainement : aide en ligne et contact du support.'],
  ] as const;
  for (const [name] of greyed) {
    const entry = rail(page).getByRole('link', { name, exact: true });
    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(entry).not.toHaveAttribute('href', /.*/);
    // force : Playwright attend qu'un élément aria-disabled devienne actif ; le clic doit être sans effet
    await entry.click({ force: true });
    await expect(page).toHaveURL(/\/fr\/organisation\/entites$/);
    await expect(trail(page)).toHaveText([ORG, 'Organisation', 'Entités']);
  }
  // clavier : depuis l'entrée Usage, Tab passe sur Leads, Reprise, puis Aide ; chacune montre sa bulle
  await rail(page).getByRole('link', { name: 'Usage', exact: true }).focus();
  for (const [name, tooltip] of greyed) {
    await page.keyboard.press('Tab');
    const entry = rail(page).getByRole('link', { name, exact: true });
    await expect(entry).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(tooltip);
    await expect(entry).toHaveAccessibleDescription(tooltip);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

/**
 * Les cinq endroits de la mention (spec 7.3) pour demo-1 : liste, Connexions, colonne de la liste, colonne de l'agent IA,
 * encart Statut. `statusWord` est la pastille attendue à côté de la mention, `motive` le motif en bulle ou écrit.
 */
async function expectMentionInFivePlaces(page: Page, statusWord: string, motive: string, action: Locator | ((status: Locator) => Locator)): Promise<void> {
  // 1. liste des agents IA, colonne Statut, motif en bulle
  await page.goto('/fr');
  const row = page.getByRole('row', { name: /Support technique/ });
  await expect(row.getByText(statusWord, { exact: true })).toBeVisible();
  const listMention = row.getByText('Ne répond pas', { exact: true });
  await listMention.focus();
  await expect(page.getByRole('tooltip')).toHaveText(motive);
  await expect(page.getByRole('row', { name: /Accueil boutique/ }).getByText('Ne répond pas', { exact: true })).toHaveCount(0);

  // 3. colonne du milieu, groupe Statut : « Ne répond pas » avec son nombre
  await expect(page.getByRole('complementary').getByRole('link', { name: /Ne répond pas/ })).toHaveText(/^Ne répond pas\s*1$/);

  // 2. Connexions, ligne du numéro de demo-1, motif en bulle
  await page.goto('/fr/organisation/connexions');
  const numberRow = page.getByRole('row', { name: /Support technique/ });
  await expect(numberRow.getByText(statusWord, { exact: true })).toBeVisible();
  await numberRow.getByText('Ne répond pas', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText(motive);

  // 4. colonne de l'agent IA, sous son nom et sa pastille
  await page.goto('/fr/agents/demo-1');
  const column = page.getByRole('complementary');
  await expect(column.getByText(statusWord, { exact: true })).toBeVisible();
  await expect(column.getByText('Ne répond pas', { exact: true })).toBeVisible();

  // 5. encart Statut de la page : motif écrit et action utile
  const status = page.getByRole('region', { name: 'Statut' });
  await expect(status.getByRole('status')).toHaveText(motive);
  await expect(typeof action === 'function' ? action(status) : action).toBeVisible();
}

// spec 7.3, choix P-2 : compte WhatsApp en erreur, demo-1 reste Online et porte la mention aux cinq endroits
test('mention « Ne répond pas » aux cinq endroits : compte WhatsApp en erreur', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await loginToAgents(page, 'demo@wabagent.test');
  await expectMentionInFivePlaces(page, 'Online', 'Ne répond pas : compte WhatsApp en erreur', (status) =>
    status.getByRole('link', { name: 'Ouvrir Connexions ↗' }),
  );
  await page.getByRole('region', { name: 'Statut' }).getByRole('link', { name: 'Ouvrir Connexions ↗' }).click();
  await page.waitForURL('**/organisation/connexions');
});

// spec 7.3 : Preview à Whitelist vide, mêmes cinq endroits
test('mention « Ne répond pas » aux cinq endroits : Preview à Whitelist vide', async ({ page, request }) => {
  await applyScenario(request, 'limited-empty-allowlist');
  await loginToAgents(page, 'demo@wabagent.test');
  await expectMentionInFivePlaces(page, 'Preview', 'Ne répond pas : Whitelist vide', (status) =>
    status.getByRole('status').locator('..').getByRole('button', { name: 'Ajouter un numéro à la Whitelist' }),
  );
});

// spec 8, 9.1, 9.3 : le conseiller voit le numéro de l'agent IA en entier (liste et page), aucune carte de coût
test("conseiller : numéro de l'agent IA en entier, aucune carte de coût", async ({ page }) => {
  // contrôle positif : l'admin voit la carte de coût, l'assertion négative du conseiller porte sur un texte réel
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  await expect(page.getByText('Coût LLM')).toBeVisible();
  await expect(page.getByText(/30 derniers jours/).first()).toBeVisible();
  await page.context().clearCookies();

  const usageReads: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/(usage\/summary|bots\/[^/]+\/usage)/.test(req.url())) usageReads.push(req.url());
  });
  await loginToAgents(page, 'advisor@wabagent.test');
  await expect(page.getByRole('row', { name: /Support technique/ })).toContainText(AGENT_NUMBER);
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await expect(page.getByRole('region', { name: 'Numéro WhatsApp' })).toContainText(AGENT_NUMBER);
  await expect(page.getByText('142')).toBeVisible();
  await expect(page.getByText('Coût LLM')).toHaveCount(0);
  await expect(page.getByText(/30 derniers jours/)).toHaveCount(0);
  expect(usageReads).toEqual([]);
});

// spec 10.6 : refus sur place à la même adresse, fil « Org › Accès refusé », aucune entrée active du rail
test('conseiller : refus sur place sur /organisation/entites, /agents/new et /usage', async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  for (const url of ['/fr/organisation/entites', '/fr/agents/new', '/fr/usage']) {
    await test.step(url, async () => {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Page réservée aux administrateurs', level: 1 })).toBeVisible();
      await expect(page.getByText(`Cette page de l'organisation ${ORG} est réservée aux administrateurs.`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${url.replace('/', '\\/')}$`));
      await expect(trail(page)).toHaveText([ORG, 'Accès refusé']);
      await expect(rail(page).locator('[aria-current="page"]')).toHaveCount(0);
      await expect(orgBlock(page)).toContainText(ORG);
      await expect(page.getByRole('link', { name: 'Retour aux agents IA' })).toHaveAttribute('href', '/fr');
      // aucune donnée de la page réservée (l'entité de Maison Lumière) n'est rendue sous le refus
      await expect(page.getByText('Boutique Paris')).toHaveCount(0);
    });
  }
});

// spec 9.2, A-10 : lead sans nom, la ligne de Dernières conversations affiche le numéro reçu du moteur : entier pour
// l'admin et pour le conseiller de l'entité, masqué pour le conseiller hors de l'entité de l'agent IA
test('Dernières conversations : numéro du contact entier dans l\'entité, masqué hors de l\'entité', async ({ page, request }) => {
  await applyScenario(request, 'unnamed-lead');
  const recent = page.getByRole('heading', { name: 'Dernières conversations' }).locator('..');

  // conseiller de l'entité de demo-1 : en entier
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  await expect(recent).toContainText('+33611111111');

  // demo-1 passe sur une autre entité : masqué, jamais le numéro entier
  await applyScenario(request, 'advisor-other-entity');
  await page.reload();
  await expect(recent).toContainText('+336 •• •• •• 11');
  await expect(page.getByText('+33611111111')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Numéro WhatsApp' })).toContainText(AGENT_NUMBER);

  // l'admin : en entier
  await page.context().clearCookies();
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  await expect(recent).toContainText('+33611111111');
  await expect(page.getByText('+336 •• •• •• 11')).toHaveCount(0);
});

// spec 5.2, nav 15.2 : demo voit ses trois organisations, Studio Ocre grisée « Suspendue » ; advisor, membre d'une
// seule organisation, n'a ni flèche ni autre nom
test('sélecteur : trois organisations pour demo, Studio Ocre grisée ; ni flèche ni autre nom pour advisor', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(orgBlock(page)).toContainText('Admin · 3 organisations');
  await orgSwitcher(page).click();
  await expect(page.getByRole('button', { name: /Atelier Nord/ })).toBeEnabled();
  const ocre = page.getByRole('button', { name: /Studio Ocre/ });
  await expect(ocre).toHaveAttribute('aria-disabled', 'true');
  await expect(ocre).toContainText('Suspendue');
  await expect(page.getByText("Changer d'organisation ramène à la liste des agents IA.")).toBeVisible();

  await page.context().clearCookies();
  await loginToAgents(page, 'advisor@wabagent.test');
  await expect(orgBlock(page)).toContainText(ORG);
  await expect(orgBlock(page)).toContainText('Conseiller');
  await expect(orgBlock(page)).not.toContainText('organisations');
  await expect(orgSwitcher(page)).toHaveCount(0);
  await expect(orgBlock(page).locator('button')).toHaveCount(0);
  await expect(page.getByText('Atelier Nord')).toHaveCount(0);
  await expect(page.getByText('Studio Ocre')).toHaveCount(0);
});
