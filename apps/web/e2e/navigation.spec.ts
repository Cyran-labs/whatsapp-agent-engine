import { test, expect, type Locator, type Page } from '@playwright/test';
import { applyScenario, headerParents, loginToAgents, orgSwitcher, pageActionNames, pageHeader, rail, resetMock } from './helpers';

/**
 * Parcours de la navigation (spec refonte de la navigation, 5, 7.3, 9, 10 et 11 ; spec en-tête de page) : en-tête de
 * chaque page (parents, titre, actions), rail par rôle, mention « Ne répond pas » (point rouge, Whitelist vide neutre), droits du conseiller, sélecteur.
 */

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const ORG = 'Maison Lumière';
const AGENT_NUMBER = '+33 1 84 80 12 34';

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
 * Pages de l'administrateur avec l'en-tête de page (spec en-tête de page, 2.1 et 2.2) : adresse, ligne des parents
 * (vide : pas de ligne), titre (seul `h1`), noms accessibles des actions puis du bouton rond, entrée active du rail.
 */
const HEADER_PAGES: { url: string; parents: string[]; title: string; actions: string[]; space: string | null }[] = [
  { url: '/fr', parents: [], title: 'Agents IA', actions: ['Créer un agent IA'], space: 'agents' },
  { url: '/fr?entity=1', parents: ['Agents IA'], title: 'Boutique Paris', actions: ['Créer un agent IA dans Boutique Paris'], space: 'agents' },
  { url: '/fr?status=active', parents: ['Agents IA'], title: 'Online', actions: ['Créer un agent IA'], space: 'agents' },
  { url: '/fr/agents/demo-1', parents: ['Agents IA', 'Boutique Paris'], title: 'Support technique', actions: ['▶ Simuler'], space: 'agents' },
  { url: '/fr/agents/demo-1/usage', parents: ['Agents IA', 'Boutique Paris', 'Support technique'], title: 'Usage et coûts', actions: ['7 j', '30 j', '90 j'], space: 'agents' },
  { url: '/fr/agents/new', parents: ['Agents IA'], title: 'Créer un agent IA', actions: ['✕ Quitter'], space: 'agents' },
  { url: '/fr/agents/new?entity=1', parents: ['Agents IA', 'Boutique Paris'], title: 'Créer un agent IA', actions: ['✕ Quitter'], space: 'agents' },
  { url: '/fr/usage', parents: [], title: 'Usage et coûts', actions: ['7 j', '30 j', '90 j'], space: 'usage' },
  { url: '/fr/usage?entity=1', parents: ['Usage et coûts'], title: 'Boutique Paris', actions: ['7 j', '30 j', '90 j'], space: 'usage' },
  { url: '/fr/organisation/entites', parents: [], title: 'Entités', actions: ['Nouvelle entité'], space: 'organisation' },
  { url: '/fr/organisation/utilisateurs', parents: [], title: 'Utilisateurs', actions: ['Inviter un utilisateur'], space: 'organisation' },
  { url: '/fr/organisation/connexions', parents: [], title: 'Connexions', actions: ['Raccorder un compte WhatsApp'], space: 'organisation' },
  { url: '/fr/organisation/connexions/raccorder', parents: ['Connexions'], title: 'Raccorder un compte WhatsApp', actions: [], space: 'organisation' },
  { url: '/fr/organisation/reglages', parents: [], title: 'Réglages', actions: [], space: 'organisation' },
  { url: '/fr/account/organisations', parents: [], title: 'Organisations', actions: [], space: 'account' },
  { url: '/fr/account/preferences', parents: [], title: 'Préférences', actions: [], space: 'account' },
  { url: '/fr/account/securite', parents: [], title: 'Sécurité', actions: [], space: 'account' },
];

// spec en-tête de page 2.1, 2.2 : parents, titre, actions, entrée active du rail ; bloc Organisation en tête de colonne
// hors des pages du compte, et jamais le nom de l'organisation dans la ligne des parents
test("admin : en-tête de chaque page, parents, titre et actions", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  for (const p of HEADER_PAGES) {
    await test.step(p.url, async () => {
      await page.goto(p.url);
      await expect(page.locator('h1')).toHaveText([p.title]);
      if (p.parents.length === 0) {
        await expect(pageHeader(page).getByRole('navigation', { name: "Fil d'Ariane" })).toHaveCount(0);
      } else {
        await expect(headerParents(page)).toHaveText(p.parents);
        // spec 2.1 : la ligne des parents ne nomme jamais l'organisation (une description le peut, Réglages)
        await expect(headerParents(page)).not.toContainText([ORG]);
      }
      await expect.poll(() => pageActionNames(page)).toEqual(p.actions);
      await expect(rail(page).locator('[aria-current="page"]')).toHaveAttribute('data-rail-entry', p.space ?? '');
      if (p.space === 'account') await expect(orgBlock(page)).toHaveCount(0);
      else await expect(orgBlock(page)).toContainText(ORG);
    });
  }
});

// entête 5, point d'attention 3 : l'administrateur de Maison Lumière ouvre la liste filtrée sur l'entité 2, celle
// d'Atelier Nord : « Entité indisponible », liste vide, et aucun nom de l'autre organisation dans le contenu
test("liste filtrée sur l'entité d'une autre organisation : « Entité indisponible », aucun nom de cette organisation", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr?entity=2');
  await expect(page.locator('h1')).toHaveText(['Entité indisponible']);
  await expect(headerParents(page)).toHaveText(['Agents IA']);
  await expect(page.getByRole('link', { name: 'Voir tous les agents IA' })).toHaveAttribute('href', '/fr');
  await expect(page.locator('main')).not.toContainText('Atelier');
  await expect(page.locator('main tbody tr')).toHaveCount(0);
  await expect(page.locator('[data-page-create]')).toHaveCount(0);
  // contrôle positif : la même adresse avec l'entité de Maison Lumière nomme l'entité et montre ses agents IA
  await page.goto('/fr?entity=1');
  await expect(page.locator('h1')).toHaveText(['Boutique Paris']);
  await expect(page.locator('main')).toContainText('Support technique');
});

// entête 5, point d'attention 3 : même cas sur l'usage de l'organisation, `/usage?entity=2` (Atelier Nord) ouvert par
// l'administrateur de Maison Lumière : « Entité indisponible », aucune ligne ni nom de l'autre organisation
test("usage filtré sur l'entité d'une autre organisation : « Entité indisponible », aucun nom de cette organisation", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/usage?entity=2');
  await expect(page.locator('h1')).toHaveText(['Entité indisponible']);
  await expect(headerParents(page)).toHaveText(['Usage et coûts']);
  await expect(page.getByRole('link', { name: "Voir l'usage de toute l'organisation" })).toHaveAttribute('href', '/fr/usage');
  await expect(page.locator('main')).not.toContainText('Atelier');
  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.locator('[data-page-action]')).toHaveCount(0);
  // contrôle positif : l'entité de Maison Lumière est nommée et ses lignes affichées
  await page.goto('/fr/usage?entity=1');
  await expect(page.locator('h1')).toHaveText(['Boutique Paris']);
  await expect(page.locator('main tbody tr').first()).toBeVisible();
});

// recette 3.14, C-7 : le bouton rond d'une liste filtrée ouvre l'assistant suivi du filtre ; l'entité est préremplie et
// nommée dans les parents, la description nomme la liste d'origine, et « Quitter » y ramène
test("assistant ouvert depuis la liste d'une entité : « Quitter » ramène à cette liste", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr?entity=1');
  await page.getByRole('link', { name: 'Créer un agent IA dans Boutique Paris', exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/agents\/new\?entity=1$/);
  await expect(page.locator('h1')).toHaveText(['Créer un agent IA']);
  await expect(headerParents(page)).toHaveText(['Agents IA', 'Boutique Paris']);
  await expect(pageHeader(page)).toContainText("Quitter ramène à la liste « Boutique Paris ». Rien n'est enregistré.");
  await pageHeader(page).getByRole('button', { name: 'Quitter' }).click();
  await expect(page).toHaveURL(/\/fr\?entity=1$/);
  await expect(page.locator('h1')).toHaveText(['Boutique Paris']);
});

// entête 5, point d'attention 3 : l'assistant ouvert sur l'entité 2 (Atelier Nord) par l'administrateur de Maison Lumière
// ne la préremplit pas et ne nomme rien de l'autre organisation ; « Quitter » ramène à toute la liste
test("assistant ouvert sur l'entité d'une autre organisation : rien de prérempli ni de nommé", async ({ page, request }) => {
  // deux entités actives dans Maison Lumière : le champ Entité est affiché, on peut lire qu'il n'est pas prérempli
  await applyScenario(request, 'advisor-other-entity');
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/new?entity=2');
  await expect(page.locator('h1')).toHaveText(['Créer un agent IA']);
  await expect(pageHeader(page)).toContainText("Quitter ramène à la liste « Agents IA ». Rien n'est enregistré.");
  await expect(headerParents(page)).toHaveText(['Agents IA']);
  await expect(page.getByLabel('Entité', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Entité', { exact: true }).locator('option')).toHaveText(['Choisir une entité', 'Boutique Paris', 'Siège Paris']);
  await expect(page.locator('main')).not.toContainText('Atelier');
  await pageHeader(page).getByRole('button', { name: 'Quitter' }).click();
  await expect(page).toHaveURL(/\/fr$/);
});

// spec en-tête 2.1, point d'attention 2, P12 : le bouton rond reste dans la fenêtre et cliquable sur une page défilée ;
// au repos il est sur la ligne du titre, au bord droit de l'en-tête
test('bouton rond collant : sur la ligne du titre au repos, toujours visible et cliquable une fois la liste défilée', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 260 });
  await loginToAgents(page, 'demo@wabagent.test');
  const round = page.getByRole('link', { name: 'Créer un agent IA', exact: true });
  await expect(round).toBeVisible();
  const scroll = page.locator('[data-page-scroll]');
  // une page plus haute que la zone, sinon rien n'est prouvé
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  const box = await round.boundingBox();
  const title = await page.locator('h1').boundingBox();
  const header = await pageHeader(page).boundingBox();
  expect(box && title && header).toBeTruthy();
  if (!box || !title || !header) return;
  expect(Math.abs(box.y + box.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x + box.width - (header.x + header.width))).toBeLessThanOrEqual(1);

  await scroll.hover();
  await page.mouse.wheel(0, 5000);
  const max = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(max);
  // le titre est sorti de la fenêtre, le bouton rond y est toujours
  await expect(page.locator('h1')).not.toBeInViewport();
  await expect(round).toBeInViewport();
  await round.click();
  await expect(page).toHaveURL(/\/fr\/agents\/new$/);
});

/**
 * Zone de contenu défilée jusqu'en bas : seul `[data-page-scroll]` a bougé, le document reste en haut, et le rail et la
 * colonne font la hauteur de la fenêtre (`height`). Exige d'abord une page plus haute que la zone, sinon rien n'est prouvé.
 */
async function expectOnlyContentScrolls(page: Page, height: number): Promise<void> {
  const scroll = page.locator('[data-page-scroll]');
  const sizes = await scroll.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(sizes.scrollHeight).toBeGreaterThan(sizes.clientHeight);
  await scroll.hover();
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(sizes.scrollHeight - sizes.clientHeight);
  // la zone en butée, un second tour de molette passerait au document s'il avait de quoi défiler
  await page.mouse.wheel(0, 5000);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollHeight ?? -1)).toBe(height);
  expect((await rail(page).boundingBox())?.height).toBe(height);
  expect((await page.getByRole('complementary').boundingBox())?.height).toBe(height);
}

// recette 3.10 : rail et colonne à pleine hauteur au défilement, seule la zone de contenu défile (page d'un agent IA,
// et étape 2 de l'assistant, dont un texte réservé aux lecteurs d'écran faisait défiler le document) ; recette 3.14 : un
// changement de page ouvre en haut
test('cadre : rail et colonne à pleine hauteur, seule la zone de contenu défile, page suivante en haut', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  await expect(page.getByRole('region', { name: 'Statut' })).toBeVisible();
  await expectOnlyContentScrolls(page, 600);

  await page.getByRole('complementary').getByRole('link', { name: 'Usage et coûts' }).click();
  await expect(page).toHaveURL(/\/fr\/agents\/demo-1\/usage$/);
  // page d'arrivée plus haute que la zone, sinon le navigateur la ramènerait en haut de lui-même
  await expect.poll(() => page.locator('[data-page-scroll]').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => page.locator('[data-page-scroll]').evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);

  await page.goto('/fr/agents/new');
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Boutique');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent IA' })).toBeVisible();
  await expectOnlyContentScrolls(page, 600);
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
    await expect(page.locator('h1')).toHaveText(['Entités']);
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

/** Zones où la mention de demo-1 est marquée (choix P15 : sélecteurs bornés par zone). */
function mentionZones(page: Page) {
  return {
    // ligne de demo-1 dans le contenu de la page : liste des agents IA, ou ligne de son numéro dans Connexions
    row: page.locator('main').getByRole('row', { name: /Support technique/ }),
    column: page.getByRole('complementary'),
    title: pageHeader(page),
    health: page.locator('main h3', { hasText: 'Santé' }),
    status: page.getByRole('region', { name: 'Statut' }),
  };
}

/**
 * Bulle de la marque au focus, lue par son `aria-describedby` : la souris peut rester sur une autre entrée de la colonne
 * qui a sa propre bulle (Soon), seule celle de la marque compte ici.
 */
async function expectOwnBubble(page: Page, trigger: Locator, text: string): Promise<void> {
  await trigger.focus();
  const id = await trigger.getAttribute('aria-describedby');
  const bubble = page.locator(`[id="${id ?? ''}"]`);
  await expect(bubble).toHaveRole('tooltip');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveText(text);
  await expect(trigger).toHaveAccessibleDescription(text);
  await trigger.blur();
  await expect(bubble).toBeHidden();
}

/** Point rouge de la zone : visible, nommé « Ne répond pas », le motif en bulle au focus ; aucun texte visible « Ne répond pas ». */
async function expectDangerDot(page: Page, zone: Locator, statusWord: string, motive: string): Promise<void> {
  await expect(zone.getByText(statusWord, { exact: true })).toBeVisible();
  const dot = zone.locator('[data-mention="danger"]');
  await expect(dot).toHaveCount(1);
  await expect(dot).toBeVisible();
  await expect(dot).toHaveAccessibleName('Ne répond pas');
  await expect(zone.getByText('Ne répond pas', { exact: true })).toHaveCount(0);
  await expect(zone.locator('[data-mention="neutral"]')).toHaveCount(0);
  await expectOwnBubble(page, dot, motive);
}

/** Étiquette neutre « Whitelist vide » de la zone, l'invitation en bulle au focus, aucun élément rouge dans la zone. */
async function expectNeutralLabel(page: Page, zone: Locator, statusWord: string): Promise<void> {
  await expect(zone.getByText(statusWord, { exact: true })).toBeVisible();
  const label = zone.locator('[data-mention="neutral"]');
  await expect(label).toHaveCount(1);
  await expect(label).toHaveText('Whitelist vide');
  await expect(zone.locator('[data-mention="danger"]')).toHaveCount(0);
  await expect(zone.locator('[class*="danger"]')).toHaveCount(0);
  await expectOwnBubble(page, label, INVITATION);
}

const INVITATION = 'Ajoutez un numéro à la Whitelist pour que cet agent IA réponde.';

// recette 3.4, spec 7.3, choix P-2 : compte WhatsApp en erreur, demo-1 reste Online ; point rouge sur la pastille dans la
// liste, Connexions, la colonne et le titre de l'agent IA, étiquette rouge dans Santé, encadré rouge de l'encart Statut
test('mention « Ne répond pas » : compte WhatsApp en erreur, point rouge et encadré rouge', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await loginToAgents(page, 'demo@wabagent.test');
  const motive = 'Ne répond pas : compte WhatsApp en erreur';
  const zones = mentionZones(page);

  // 1. liste des agents IA, colonne Statut ; l'autre agent IA, qui répond, n'a aucune marque
  await page.goto('/fr');
  await expectDangerDot(page, zones.row, 'Online', motive);
  await expect(page.locator('main').getByRole('row', { name: /Accueil boutique/ }).locator('[data-mention]')).toHaveCount(0);

  // 2. colonne du milieu de la liste, groupe Statut : « Ne répond pas » avec son nombre
  await expect(zones.column.getByRole('link', { name: /Ne répond pas/ })).toHaveText(/^Ne répond pas\s*1$/);

  // 3. Connexions, ligne du numéro de demo-1
  await page.goto('/fr/organisation/connexions');
  await expectDangerDot(page, zones.row, 'Online', motive);

  // 4 et 5. page de l'agent IA : colonne sous son nom, titre de la page (P15 : un endroit de plus)
  await page.goto('/fr/agents/demo-1');
  await expectDangerDot(page, zones.column, 'Online', motive);
  await expectDangerDot(page, zones.title, 'Online', motive);

  // 6. Santé : étiquette rouge « Ne répond pas » dans l'en-tête du panneau
  const healthLabel = zones.health.locator('[data-mention="danger"]');
  await expect(healthLabel).toHaveText('Ne répond pas');
  await expect(healthLabel).toHaveClass(/bg-danger-soft/);

  // 7. encart Statut : encadré rouge, motif écrit et action utile
  await expect(zones.status.locator('[data-not-responding]')).toHaveClass(/bg-danger-soft/);
  await expect(zones.status.getByRole('status')).toHaveText(motive);
  const open = zones.status.getByRole('link', { name: 'Ouvrir Connexions ↗' });
  await expect(open).toBeVisible();
  await open.click();
  await page.waitForURL('**/organisation/connexions');
});

// recette 3.5, spec 7.1 : Preview à Whitelist vide, un état et pas une erreur ; étiquette neutre aux mêmes endroits,
// aucun élément rouge, et l'agent IA reste compté et listé sous le filtre « Ne répond pas »
test('mention « Ne répond pas » : Preview à Whitelist vide, étiquette neutre, aucun rouge', async ({ page, request }) => {
  await applyScenario(request, 'limited-empty-allowlist');
  await loginToAgents(page, 'demo@wabagent.test');
  const zones = mentionZones(page);

  // 1. liste des agents IA
  await page.goto('/fr');
  await expectNeutralLabel(page, zones.row, 'Preview');

  // 2. colonne de la liste : toujours comptée dans « Ne répond pas », et listée sous ce filtre
  const filter = zones.column.getByRole('link', { name: /Ne répond pas/ });
  await expect(filter).toHaveText(/^Ne répond pas\s*1$/);
  await filter.click();
  await page.waitForURL(/\/fr\?status=not_responding$/);
  await expect(page.locator('h1')).toHaveText(['Ne répond pas']);
  await expect(page.locator('main tbody tr')).toHaveCount(1);
  await expectNeutralLabel(page, zones.row, 'Preview');

  // 3. Connexions
  await page.goto('/fr/organisation/connexions');
  await expectNeutralLabel(page, zones.row, 'Preview');

  // 4 et 5. colonne et titre de l'agent IA
  await page.goto('/fr/agents/demo-1');
  await expectNeutralLabel(page, zones.column, 'Preview');
  await expectNeutralLabel(page, zones.title, 'Preview');

  // 6. Santé : étiquette neutre, rien de rouge
  await expect(zones.health.locator('[data-mention="neutral"]')).toHaveText('Whitelist vide');
  await expect(zones.health.locator('[class*="danger"]')).toHaveCount(0);

  // 7. encart Statut : encadré neutre, invitation et action d'ajout
  const box = zones.status.locator('[data-not-responding]');
  await expect(box).not.toHaveClass(/danger/);
  await expect(box.locator('[class*="danger"]')).toHaveCount(0);
  await expect(zones.status.getByRole('status')).toHaveText('Whitelist vide');
  await expect(box).toContainText(INVITATION);
  await expect(box.getByRole('button', { name: 'Ajouter un numéro à la Whitelist' })).toBeVisible();
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

// spec 10.6 : refus sur place à la même adresse, aucune entrée active du rail ; spec en-tête 2.2 : titre seul, sans ligne
// des parents ni action
test('conseiller : refus sur place sur /organisation/entites, /agents/new et /usage', async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  for (const url of ['/fr/organisation/entites', '/fr/agents/new', '/fr/usage']) {
    await test.step(url, async () => {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Page réservée aux administrateurs', level: 1 })).toBeVisible();
      await expect(page.getByText(`Cette page de l'organisation ${ORG} est réservée aux administrateurs.`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${url.replace('/', '\\/')}$`));
      await expect(page.locator('h1')).toHaveText(['Page réservée aux administrateurs']);
      await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toHaveCount(0);
      await expect(page.locator('[data-page-action]')).toHaveCount(0);
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
