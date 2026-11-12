import { test, expect, type Page } from '@playwright/test';
import { applyScenario, failRoute, headerParents, loginToAgents, msg, orgSwitcher, pageHeader, rail, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

/** Deuxième onglet (cookies partagés) qui bascule vers Atelier Nord. */
async function switchInOtherTab(first: Page): Promise<void> {
  const second = await first.context().newPage();
  await second.goto('/fr');
  await orgSwitcher(second).click();
  await second.getByRole('button', { name: /Atelier Nord/ }).click();
  await expect(second.getByText('Assistant atelier')).toBeVisible();
  await second.close();
}

test('bascule dans un autre onglet : un appel du premier onglet est refusé puis l\'onglet se recharge sur la bonne organisation', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.getByText('Support technique')).toBeVisible();
  await switchInOtherTab(page);

  // navigation côté client : la page Usage appelle le BFF avec X-Wab-Org = Maison Lumière, le cookie dit Atelier Nord
  await rail(page).getByRole('link', { name: 'Usage', exact: true }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Atelier Nord');
  // audit R-11 : le rechargement n'est pas silencieux, il dit ce qui s'est passé et nomme la nouvelle organisation
  await expect(page.getByRole('status').filter({ hasText: 'autre onglet' })).toHaveText(
    "Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord.×",
  );
});

test('bascule dans un autre onglet : au retour sur le premier onglet, rechargement sur l\'organisation active', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await switchInOtherTab(page);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByText('Support technique')).toHaveCount(0);
  // audit R-11
  await expect(page.getByRole('status').filter({ hasText: 'autre onglet' })).toContainText('cet onglet affiche maintenant Atelier Nord.');
});

// audit R-13 : Studio Ocre (suspendue) est listée grisée, avec sa raison, et ne s'ouvre pas
test('le sélecteur liste l\'organisation suspendue grisée, non ouvrable, avec sa raison', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await orgSwitcher(page).click();
  const row = page.getByRole('button', { name: /Studio Ocre/ });
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row).toContainText('Suspendue');
  await expect(row).toContainText("Ne peut pas être ouverte : contactez l'administrateur de l'organisation ou le support.");
  await row.click({ force: true });
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Maison Lumière');
});

// recette 3.13, spec en-tête 7.2 : le bandeau ne nomme que l'organisation tentée, jamais une autre suspendue dont on est membre
test('organisation suspendue : bandeau seulement pour celle qui a été tentée, au rechargement', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.getByText('Support technique')).toBeVisible();
  // membre de Studio Ocre (suspendue) sans l'avoir tentée : aucun bandeau
  await expect(page.getByRole('status').filter({ hasText: 'suspendue' })).toHaveCount(0);

  await orgSwitcher(page).click();
  await page.getByRole('button', { name: /Atelier Nord/ }).click();
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'suspendue' })).toHaveCount(0);

  // Atelier Nord, enregistrée comme organisation ouverte, est suspendue ; la page rechargée en ouvre une autre
  await applyScenario(request, 'org-suspended');
  await page.reload();
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Maison Lumière');
  const banner = page.getByRole('status').filter({ hasText: 'suspendue' });
  await expect(banner).toHaveText("Atelier Nord est suspendue. Contactez l'administrateur de votre organisation ou le support.×");
  await expect(page.getByRole('status').filter({ hasText: 'Studio Ocre' })).toHaveCount(0);

  // le bandeau ne revient pas à la lecture suivante : la tentative est passée
  await page.reload();
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'suspendue' })).toHaveCount(0);
});

// audit R-12 : un changement d'organisation refusé le dit dans le sélecteur ; audit R-14 (tâche 16b) : une panne serveur
// montre aussi la référence de la requête, sous le message
test('changement d\'organisation refusé : le message et la référence de la requête restent dans le sélecteur', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await failRoute(request, '/auth/me', 500, { requestId: 'req-org-switch' });
  await orgSwitcher(page).click();
  await page.getByRole('button', { name: /Atelier Nord/ }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Impossible d' });
  await expect(alert.locator('p')).toHaveText([
    "Impossible d'ouvrir Atelier Nord : l'opération a échoué, réessayez.",
    msg('fr', 'errors.generic.reference', { reference: 'req-org-switch' }),
  ]);
  await expect(page.getByText('Support technique')).toBeVisible();
});

/**
 * Pose sur l'onglet un observateur du DOM qui note, dans sessionStorage (gardé d'un rechargement à l'autre), chaque
 * organisation vue en tête du bloc Organisation et du fil d'Ariane, et tout état mêlé : le nom d'une organisation
 * affiché avec des données de l'autre (nav 15.3). À appeler avant la connexion.
 */
async function watchMixedOrg(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ORGS: Record<string, string[]> = {
      'Maison Lumière': ['Assistant atelier'],
      'Atelier Nord': ['Support technique', 'Accueil boutique', 'Boutique Paris'],
    };
    const note = (key: string, value: string) => {
      const list = JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
      if (!list.includes(value)) sessionStorage.setItem(key, JSON.stringify([...list, value]));
    };
    const check = () => {
      const block = document.querySelector('[data-org-block]')?.textContent ?? '';
      const crumb = document.querySelector('nav[aria-label="Fil d\'Ariane"] li')?.textContent ?? '';
      const body = document.body.textContent ?? '';
      for (const [org, foreign] of Object.entries(ORGS)) {
        for (const where of [block, crumb]) {
          if (!where.includes(org)) continue;
          note('nav-seen', org);
          for (const data of foreign) if (body.includes(data)) note('nav-mixed', `${org} avec ${data} : ${location.pathname}`);
        }
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      check();
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  });
}

async function mixedOrgReport(page: Page): Promise<{ seen: string[]; mixed: string[] }> {
  return page.evaluate(() => ({
    seen: JSON.parse(sessionStorage.getItem('nav-seen') ?? '[]') as string[],
    mixed: JSON.parse(sessionStorage.getItem('nav-mixed') ?? '[]') as string[],
  }));
}

// contrôle positif permanent de l'observateur (relecture tâche 15, M-1) : un état mêlé injecté dans le DOM est signalé,
// dans les deux sens ; sans ce test, un observateur devenu muet laisserait passer les tests nav 15.3 et point 5
test("l'observateur d'organisation signale un état mêlé injecté", async ({ page }) => {
  await watchMixedOrg(page);
  await loginToAgents(page, 'demo@wabagent.test');
  expect((await mixedOrgReport(page)).mixed).toEqual([]);
  await page.evaluate(() => {
    const data = document.createElement('div');
    data.textContent = 'Assistant atelier';
    document.body.appendChild(data);
  });
  await expect.poll(async () => (await mixedOrgReport(page)).mixed).toContain('Maison Lumière avec Assistant atelier : /fr');
  // sens inverse : le bloc renommé Atelier Nord alors que les données de Maison Lumière sont encore là
  await page.evaluate(() => {
    const name = Array.from(document.querySelectorAll('[data-org-block] *')).find((n) => n.childElementCount === 0 && n.textContent === 'Maison Lumière');
    if (name) name.textContent = 'Atelier Nord';
  });
  await expect.poll(async () => (await mixedOrgReport(page)).mixed).toContain('Atelier Nord avec Support technique : /fr');
});

// nav 15.3 : après un changement dans un autre onglet, le bloc Organisation et le fil de l'onglet resté ouvert nomment
// la nouvelle organisation, et ne montrent à aucun moment l'ancienne avec les données de la nouvelle (ni l'inverse)
test("nav 15.3 : bloc et fil nomment la nouvelle organisation, jamais l'ancienne avec les données de la nouvelle", async ({ page }) => {
  await watchMixedOrg(page);
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.locator('[data-org-block]')).toContainText('Maison Lumière');
  await page.getByText('Accueil boutique').click();
  await page.waitForURL('**/agents/demo-3');
  // spec en-tête 2.1 : la ligne des parents ne nomme jamais l'organisation, le bloc Organisation la nomme
  await expect(headerParents(page)).toHaveText(['Agents IA', 'Boutique Paris']);
  await expect(page.getByRole('heading', { name: 'Accueil boutique', level: 1 })).toBeVisible();
  await switchInOtherTab(page);

  // navigation côté client vers la liste : ses lectures partent avec l'ancienne organisation, refus puis rechargement
  await page.locator('aside').getByRole('link', { name: /Tous les agents IA/ }).click();
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.locator('[data-org-block]')).toContainText('Atelier Nord');
  await expect(page.locator('[data-org-block]')).toContainText('Atelier Nord');
  await expect(pageHeader(page).getByRole('heading', { name: 'Agents IA', level: 1 })).toBeVisible();
  await expect(page.getByText('Support technique')).toHaveCount(0);
  await expect(page.getByText('Accueil boutique')).toHaveCount(0);
  const report = await mixedOrgReport(page);
  expect(report.seen).toEqual(['Maison Lumière', 'Atelier Nord']);
  expect(report.mixed).toEqual([]);
});

// point d'attention 5 du plan : admin de Maison Lumière, conseiller d'Atelier Nord, sur les entités de Maison Lumière ;
// après le changement dans l'autre onglet, l'onglet resté ouvert ne montre jamais les entités de Maison Lumière sous
// Atelier Nord : rechargé à la même adresse, il affiche le refus sur place qui nomme Atelier Nord
test("point d'attention 5 : entités de A, passage sur B ailleurs, l'onglet rechargé affiche le refus qui nomme B", async ({ page }) => {
  await watchMixedOrg(page);
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites');
  await expect(page.getByRole('heading', { name: 'Entités', level: 1 })).toBeVisible();
  await expect(page.getByText('Boutique Paris')).toBeVisible();
  await switchInOtherTab(page);

  await page.reload();
  await expect(page).toHaveURL(/\/fr\/organisation\/entites$/);
  await expect(page.getByRole('heading', { name: 'Page réservée aux administrateurs', level: 1 })).toBeVisible();
  await expect(page.getByText("Cette page de l'organisation Atelier Nord est réservée aux administrateurs.")).toBeVisible();
  // spec en-tête 2.2 : la page réservée n'a pas de ligne des parents ; le bloc Organisation et la phrase nomment B
  await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toHaveCount(0);
  await expect(page.locator('[data-org-block]')).toContainText('Atelier Nord');
  await expect(page.getByRole('heading', { name: 'Entités', level: 1 })).toHaveCount(0);
  await expect(page.getByText('Boutique Paris')).toHaveCount(0);
  const report = await mixedOrgReport(page);
  expect(report.seen).toEqual(['Maison Lumière', 'Atelier Nord']);
  expect(report.mixed).toEqual([]);
});

// point d'attention 5, retour sur l'onglet sans rechargement manuel : la vérification au focus recharge sur la liste
// des agents IA de B (règle du sélecteur), jamais la liste des entités de A sous le nom de B
test("point d'attention 5 : entités de A, retour sur l'onglet après passage sur B, jamais les entités de A", async ({ page }) => {
  await watchMixedOrg(page);
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites');
  await expect(page.getByText('Boutique Paris')).toBeVisible();
  await switchInOtherTab(page);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.locator('[data-org-block]')).toContainText('Atelier Nord');
  await expect(pageHeader(page).getByRole('heading', { name: 'Agents IA', level: 1 })).toBeVisible();
  await expect(page.getByText('Boutique Paris')).toHaveCount(0);
  // Atelier Nord, où demo est conseiller : plus d'entrée Organisation dans le rail
  await expect(rail(page).getByRole('link', { name: 'Organisation', exact: true })).toHaveCount(0);
  const report = await mixedOrgReport(page);
  expect(report.seen).toEqual(['Maison Lumière', 'Atelier Nord']);
  expect(report.mixed).toEqual([]);
});

/** Assistant ouvert depuis la liste, jusqu'à l'étape 2 remplie (rien n'est encore enregistré). */
async function wizardAtStep2(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Créer un agent IA', exact: true }).click();
  await expect(pageHeader(page).getByRole('heading', { name: 'Créer un agent IA', level: 1 })).toBeVisible();
  // appelé dans Maison Lumière, qui n'a qu'une entité active : elle est nommée (décision du 12 nov. 2026, recette P-7)
  await expect(headerParents(page)).toHaveText(['Agents IA', 'Boutique Paris']);
  await page.getByLabel("Nom de l'agent IA").fill(name);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
}

// nav 15.4 : organisation changée ailleurs pendant l'étape 2 ; « Créer et tester » n'aboutit pas dans Atelier Nord
// (409 ORG_CHANGED du BFF, avant tout appel au moteur, puis rechargement) ; le Draft n'apparaît ensuite que dans la
// liste de Maison Lumière, l'organisation affichée au départ
test("nav 15.4 : « Créer et tester » après un changement d'organisation ailleurs n'aboutit pas dans l'autre organisation", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await wizardAtStep2(page, 'Agent croisé');
  await switchInOtherTab(page);

  const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/bots');
  await page.getByRole('button', { name: /Créer et tester/ }).click();
  const refused = await creation;
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('ORG_CHANGED');

  // rechargé sur la liste d'Atelier Nord, qui le dit ; le Draft n'y est pas
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.locator('[data-org-block]')).toContainText('Atelier Nord');
  await expect(page.locator('[data-org-block]')).toContainText('Atelier Nord');
  await expect(pageHeader(page).getByRole('heading', { name: 'Agents IA', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'autre onglet' })).toContainText('cet onglet affiche maintenant Atelier Nord.');
  await expect(page.getByText('Agent croisé')).toHaveCount(0);

  // retour sur Maison Lumière : rien n'a été écrit ; recréé ici, le Draft n'existe que dans Maison Lumière
  await orgSwitcher(page).click();
  await page.getByRole('button', { name: /Maison Lumière/ }).click();
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(page.getByText('Agent croisé')).toHaveCount(0);
  await wizardAtStep2(page, 'Agent croisé');
  await page.getByRole('button', { name: /Créer et tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();
  await page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('link', { name: 'Agents IA' }).click();
  await expect(page.getByRole('row', { name: /Agent croisé/ }).getByText('Draft', { exact: true })).toBeVisible();
  await orgSwitcher(page).click();
  await page.getByRole('button', { name: /Atelier Nord/ }).click();
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByText('Agent croisé')).toHaveCount(0);
});
