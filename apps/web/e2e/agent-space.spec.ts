import { test, expect } from '@playwright/test';
import { applyScenario, failRoute, loginToAgents, pageBar, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("table d'agents IA, espace agent IA, Vue d'ensemble, Usage", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  // La table liste l'agent IA pré-seedé
  await expect(page.getByText('Support technique')).toBeVisible();

  // Clic sur la ligne : espace agent IA
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');

  // Vue d'ensemble : bloc Santé + métrique 142 messages
  await expect(page.getByText('Santé')).toBeVisible();
  await expect(page.getByText('142')).toBeVisible();

  // recette 10 nov. 2026 : « Dernières conversations » affiche l'heure de Paris, pas la date brute du moteur (UTC)
  await expect(page.getByText('9 nov. 2026, 21:09')).toBeVisible();
  await expect(page.getByText('2026-11-09 20:09:02')).toHaveCount(0);

  // Navigation vers Usage et coûts
  await page.getByRole('link', { name: 'Usage et coûts' }).click();
  await page.waitForURL('**/agents/demo-1/usage');

  // recette 10 nov. 2026 : dates sous les barres du coût par jour, barres de largeur bornée, vocabulaire entrée / sortie
  await expect(page.getByText('1 juin', { exact: true })).toBeVisible();
  await expect(page.getByText('2 juin', { exact: true })).toBeVisible();
  const barWidth = (await page.locator('[data-bar]').first().boundingBox())!.width;
  expect(barWidth).toBeLessThanOrEqual(56);
  await expect(page.getByRole('columnheader', { name: "Tokens d'entrée" })).toBeVisible();
  await expect(page.getByText(/tokens in/i)).toHaveCount(0);

  // Détail par modèle + ligne Total
  await expect(page.getByText('claude-haiku-4-5')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();

  // recette Q-2 : dollars exacts, équivalent en euros et raison de la devise
  await expect(page.getByText('1,84 $').first()).toBeVisible();
  await expect(page.getByText('≈ 1,69 €').first()).toBeVisible();
  await expect(page.getByText('Anthropic facture en dollars ; équivalent en euros au taux de 0,92 du 9 novembre 2026.')).toBeVisible();
});

// recette Q-1, recette Q-10 et point d'attention 3 du plan : statuts en mots d'activation, liste vide permise et expliquée
test("statuts d'activation et Whitelist vide : enregistrée, expliquée, puis passer Offline et repasser en Preview", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const status = page.getByRole('region', { name: 'Statut' });
  const list = page.getByRole('region', { name: 'Whitelist' });
  await expect(status.getByText('Online', { exact: true })).toBeVisible();
  // aucun bouton ne parle de brouillon ni de pause
  await expect(status.getByRole('button', { name: /brouillon|pause/i })).toHaveCount(0);

  // liste vide : « Limiter à la Whitelist » est indisponible (décision François A11), la raison propose « Ajouter un
  // numéro à la Whitelist » qui met le focus sur le champ
  await expect(status.getByRole('button', { name: 'Limiter à la Whitelist' })).toBeDisabled();
  await status.getByRole('button', { name: 'Ajouter un numéro à la Whitelist' }).click();
  await expect(page.getByLabel('Numéro à autoriser')).toBeFocused();
  await page.getByLabel('Numéro à autoriser').fill('+33611223344');
  await list.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Whitelist enregistrée.')).toBeVisible();
  await status.getByRole('button', { name: 'Limiter à la Whitelist' }).click();
  const confirm = page.getByRole('dialog', { name: 'Limiter Support technique à la Whitelist ?' });
  await confirm.getByRole('button', { name: 'Limiter à la Whitelist' }).click();
  await expect(status.getByText('Preview', { exact: true })).toBeVisible();

  // recette Q-10 : vider la liste puis enregistrer est permis, l'encadré « Ne répond pas » dit ce que cela veut dire
  await list.getByRole('button', { name: /^Retirer/ }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Whitelist enregistrée.')).toBeVisible();
  await expect(status.getByRole('status')).toHaveText('Ne répond pas : Whitelist vide');
  const notice = status.getByRole('status').locator('..');
  await expect(notice).toContainText('il ne répond à personne');
  // un seul bouton de chaque nom ; spec 10.3 : l'encadré porte l'ajout, « Passer Online » et « Passer Offline » restent
  // dans la rangée des actions
  for (const name of ['Ajouter un numéro à la Whitelist', 'Passer Online', 'Passer Offline']) {
    await expect(status.getByRole('button', { name })).toHaveCount(1);
    await expect(status.getByRole('button', { name })).toBeEnabled();
  }
  await expect(notice.getByRole('button')).toHaveText(['Ajouter un numéro à la Whitelist']);

  // Passer Offline (confirmé), puis repasser en Preview est refusé tant que la liste est vide
  await status.getByRole('button', { name: 'Passer Offline' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Passer Offline' }).click();
  await expect(status.getByText('Offline', { exact: true })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Repasser en Preview' })).toBeDisabled();
  await expect(status.getByText("Ajoutez au moins un numéro à la Whitelist.")).toBeVisible();
  await expect(status.getByRole('button', { name: 'Repasser Online' })).toBeEnabled();
  await status.getByRole('button', { name: 'Ajouter un numéro à la Whitelist' }).click();
  await expect(page.getByLabel('Numéro à autoriser')).toBeFocused();

  // une entrée de plus : la réactivation en accès limité est permise
  await page.getByLabel('Numéro à autoriser').fill('+33699887766');
  await list.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Whitelist enregistrée.')).toBeVisible();
  await status.getByRole('button', { name: 'Repasser en Preview' }).click();
  await expect(status.getByText('Preview', { exact: true })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Passer Offline' })).toBeVisible();
});

// audit R-17 : une lecture en échec n'emporte pas la page
test("usage en échec : la page reste, « Coûts indisponibles » avec « Réessayer » dans son panneau", async ({ page, request }) => {
  await failRoute(request, '/bots/demo-1/usage', 500);
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await expect(page.getByText('142')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Statut' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Numéro WhatsApp' })).toContainText('+33 1 84 80 12 34');
  await expect(page.getByText('Marie')).toBeVisible();
  const costs = page.getByText('Coûts indisponibles').locator('..');
  await expect(costs.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await expect(page.getByText("Quelque chose s'est mal passé")).toHaveCount(0);
});

// audit R-9, audit R-25 : un envoi du simulateur refusé garde le message
test('simulateur en panne : la bulle est « Non envoyé », le texte revient dans le champ, « Renvoyer » le renvoie', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await pageBar(page).getByRole('button', { name: '▶ Simuler' }).click();
  const dialogBox = page.getByPlaceholder('Écrivez un message…');
  await failRoute(request, '/bots/demo-1/simulate', 500);
  await dialogBox.fill('Bonjour, une question');
  await dialogBox.press('Enter');
  await expect(page.getByText('Non envoyé')).toBeVisible();
  await expect(dialogBox).toHaveValue('Bonjour, une question');
  await expect(page.getByText('Action impossible pour le moment. Réessayez.')).toBeVisible();
  // le moteur revient : « Renvoyer » envoie le même texte
  await resetMock(request);
  await page.getByRole('button', { name: 'Renvoyer' }).click();
  await expect(page.getByText('Réponse simulée à : Bonjour, une question')).toBeVisible();
  await expect(page.getByText('Non envoyé')).toHaveCount(0);
  await expect(dialogBox).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Fermer' })).toBeVisible();
});

// recette Q-4 : plus de « Connexions · à venir », le chemin vers les numéros de l'organisation pour l'admin ; prototype 8 :
// le lien dit qu'il change d'espace (« ↗ Connexions ») ; spec 10.3 : retour, étiquette, ligne Entité, sections
test("colonne de l'agent IA : en-tête, sections Soon, lien « ↗ Connexions » vers les numéros pour l'admin seulement", async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const rail = page.locator('aside');
  await expect(rail.getByRole('link', { name: /Tous les agents IA/ })).toBeVisible();
  await expect(rail.getByText('Agent IA', { exact: true })).toBeVisible();
  await expect(rail.getByText('Entité · Boutique Paris')).toBeVisible();
  await expect(rail.getByText('CRM', { exact: true })).toBeVisible();
  // section à venir : annoncée indisponible, avec « Soon » (spec 5.2)
  await expect(rail.getByRole('link', { name: 'CRM Soon' })).toHaveAttribute('aria-disabled', 'true');
  await expect(rail.getByRole('link', { name: 'Réglages Soon' })).toHaveAttribute('aria-disabled', 'true');
  // titre de la page : nom de l'agent IA, entité dessous (prototype 7)
  await expect(page.getByRole('heading', { name: 'Support technique', level: 1 })).toBeVisible();
  await expect(page.locator('main').getByText('Entité · Boutique Paris')).toBeVisible();
  await rail.getByRole('link', { name: "Numéros WhatsApp de l'organisation ↗ Connexions" }).click();
  await page.waitForURL('**/organisation/connexions');
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toBeVisible();

  // un conseiller n'a pas ce lien
  await resetMock(request);
  await page.context().clearCookies();
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await expect(page.locator('aside').getByText('CRM', { exact: true })).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: /Numéros WhatsApp de l'organisation/ })).toHaveCount(0);
});

// nav 15.5, prototype 5 : l'usage de l'organisation ouvert par un conseiller, refus sur place sans lecture des coûts
test("conseiller sur /fr/usage : « Page réservée aux administrateurs », aucune requête vers /api/usage/summary", async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  const usageReads: string[] = [];
  page.on('request', (req) => { if (/\/api\/(usage\/summary|bots\/[^/]+\/usage)/.test(req.url())) usageReads.push(req.url()); });
  // aucune entrée Usage dans le rail, aucune section « Usage et coûts » dans la colonne de l'agent IA
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Usage' })).toHaveCount(0);
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await expect(page.locator('aside').getByText('CRM', { exact: true })).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: 'Usage et coûts' })).toHaveCount(0);
  await expect(page.getByText('Coût LLM')).toHaveCount(0);

  await page.goto('/fr/usage');
  await expect(page.getByText('Page réservée aux administrateurs')).toBeVisible();
  // P-12 : « de l'organisation {nom} », sans défaut d'élision
  await expect(page.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Période' })).toHaveCount(0);

  await page.goto('/fr/agents/demo-1/usage');
  await expect(page.getByRole('heading', { name: 'Page réservée aux administrateurs', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Période' })).toHaveCount(0);
  expect(usageReads).toEqual([]);
});

// relecture tâche 11, M-3 : l'assistant de création ouvert par un conseiller, refus sur place à la même adresse (spec 10.6)
test("conseiller sur /fr/agents/new : « Page réservée aux administrateurs », assistant absent", async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.goto('/fr/agents/new');
  await expect(page.getByRole('heading', { name: 'Page réservée aux administrateurs', level: 1 })).toBeVisible();
  await expect(page.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/agents\/new$/);
  await expect(page.getByRole('button', { name: /Créer et tester/ })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

// audit R-6 : les échecs de remise du numéro de l'agent IA sont dits dans son encart Numéro
test("échecs de remise : l'encart Numéro de l'agent IA les affiche comme Connexions", async ({ page, request }) => {
  await applyScenario(request, 'bot-delivery-failures');
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const panel = page.getByRole('region', { name: 'Numéro WhatsApp' });
  await expect(panel.getByText('2 échecs de remise')).toBeVisible();
  await expect(panel.getByText(/n'a peut-être pas WhatsApp/)).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Voir dans WhatsApp Manager ↗' })).toHaveCount(0);
  await panel.getByRole('link', { name: 'Voir dans Connexions' }).click();
  await page.waitForURL('**/organisation/connexions');
});

// audit R-6 : un conseiller lit le même état, sans lien ; audit décisions A12 et B25 : avec la suite à donner
test("échecs de remise : le conseiller voit le nombre et le sens du code, sans lien, et qui prévenir", async ({ page, request }) => {
  await applyScenario(request, 'bot-delivery-failures');
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const panel = page.getByRole('region', { name: 'Numéro WhatsApp' });
  await expect(panel.getByText('2 échecs de remise')).toBeVisible();
  await expect(panel.getByText('Prévenez un administrateur de votre organisation.')).toBeVisible();
  await expect(panel.getByRole('link')).toHaveCount(0);
});

// spec 7.3 (points 1, 2 et 4), prototype 1 : un agent IA Online dont le compte WhatsApp est en erreur ne répond à
// personne ; la mention le dit partout où sa pastille apparaît, avec le motif en bulle, et sa pastille reste Online
test('compte WhatsApp en erreur : demo-1 Online porte « Ne répond pas » dans la liste, dans Connexions et dans sa colonne', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await loginToAgents(page, 'demo@wabagent.test');

  // 1. liste des agents IA, colonne Statut
  const row = page.getByRole('row', { name: /Support technique/ });
  await expect(row.getByText('Online', { exact: true })).toBeVisible();
  const listMention = row.getByText('Ne répond pas', { exact: true });
  await expect(listMention).toBeVisible();
  await listMention.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Ne répond pas : compte WhatsApp en erreur');

  // 4. colonne de l'agent IA, sous son nom
  await page.goto('/fr/agents/demo-1');
  const column = page.locator('aside').filter({ hasText: 'Vue d\'ensemble' });
  await expect(column.getByText('Online', { exact: true })).toBeVisible();
  await expect(column.getByText('Ne répond pas', { exact: true })).toBeVisible();

  // 2. Connexions, ligne du numéro de demo-1, à côté de la pastille de l'agent IA branché
  await page.goto('/fr/organisation/connexions');
  const numberRow = page.getByRole('row', { name: /Support technique/ });
  await expect(numberRow.getByText('Online', { exact: true })).toBeVisible();
  const connectionsMention = numberRow.getByText('Ne répond pas', { exact: true });
  await expect(connectionsMention).toBeVisible();
  await connectionsMention.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Ne répond pas : compte WhatsApp en erreur');
});

// spec 7.3 (point 3), 10.2, prototype 1 : groupe Statut de la colonne, entrée « Ne répond pas » avec son nombre, qui
// filtre la liste ; titre et fil de la liste filtrée
test('Preview à Whitelist vide : entrée « Ne répond pas » (1) dans la colonne, filtre, titre et fil', async ({ page, request }) => {
  await applyScenario(request, 'limited-empty-allowlist');
  await loginToAgents(page, 'demo@wabagent.test');

  const column = page.getByRole('complementary');
  const entry = column.getByRole('link', { name: /Ne répond pas/ });
  await expect(entry).toHaveText(/^Ne répond pas\s*1$/);
  await expect(column.getByRole('link', { name: /Preview/ })).toHaveText(/1$/);
  await entry.click();
  await page.waitForURL('**/fr?status=not_responding');

  await expect(page.getByRole('heading', { name: 'Ne répond pas', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('listitem')).toHaveText(['Maison Lumière', 'Agents IA', 'Ne répond pas']);
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('row', { name: /Support technique/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Accueil boutique/ })).toHaveCount(0);
});

// spec 10.3 : sur la page de l'agent IA, l'encadré rouge écrit le motif et porte l'action utile ; « Passer Online » reste
// dans la rangée des actions, avec sa confirmation
test('Preview à Whitelist vide : encadré « Ne répond pas : Whitelist vide », « Ajouter un numéro à la Whitelist » donne le focus au champ', async ({ page, request }) => {
  await applyScenario(request, 'limited-empty-allowlist');
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const status = page.getByRole('region', { name: 'Statut' });
  const mention = status.getByRole('status');
  await expect(mention).toHaveText('Ne répond pas : Whitelist vide');
  const box = mention.locator('..');
  await expect(box.getByRole('button', { name: 'Passer Online' })).toHaveCount(0);
  await expect(status.getByRole('button', { name: 'Passer Online' })).toBeEnabled();
  await box.getByRole('button', { name: 'Ajouter un numéro à la Whitelist' }).click();
  await expect(page.getByRole('region', { name: 'Whitelist' }).getByLabel('Numéro à autoriser')).toBeFocused();
});

// un agent IA qui répond ne porte jamais la mention
test('sans scénario : aucun agent IA ne porte « Ne répond pas »', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.getByRole('row', { name: /Support technique/ }).getByText('Online', { exact: true })).toBeVisible();
  await expect(page.getByText('Ne répond pas', { exact: true })).toHaveCount(0);
  // spec 7.3 : pas d'entrée « Ne répond pas » dans la colonne quand aucun agent IA n'est concerné
  await expect(page.getByRole('complementary').getByRole('link', { name: /Ne répond pas/ })).toHaveCount(0);
});
