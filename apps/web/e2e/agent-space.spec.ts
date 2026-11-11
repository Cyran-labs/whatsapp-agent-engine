import { test, expect } from '@playwright/test';
import { applyScenario, failRoute, loginToAgents, resetMock } from './helpers';

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

  // Navigation vers Usage & coûts
  await page.getByRole('link', { name: 'Usage & coûts' }).click();
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
test("statuts d'activation et liste d'accès limité vide : enregistrée, expliquée, puis désactiver et réactiver", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const status = page.getByRole('region', { name: 'Statut' });
  const list = page.getByRole('region', { name: 'Accès limité' });
  await expect(status.getByText('Ouvert à tous', { exact: true })).toBeVisible();
  // aucun bouton ne parle de brouillon ni de pause
  await expect(status.getByRole('button', { name: /brouillon|pause/i })).toHaveCount(0);

  // liste vide : « Limiter l'accès » est indisponible (décision François A11), la raison propose « Ajouter un numéro »
  // qui met le focus sur le champ
  await expect(status.getByRole('button', { name: "Limiter l'accès" })).toBeDisabled();
  await status.getByRole('button', { name: 'Ajouter un numéro' }).click();
  await expect(page.getByLabel('Numéro à autoriser')).toBeFocused();
  await page.getByLabel('Numéro à autoriser').fill('+33611223344');
  await list.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Liste enregistrée.')).toBeVisible();
  await status.getByRole('button', { name: "Limiter l'accès" }).click();
  const confirm = page.getByRole('dialog', { name: "Limiter l'accès de Support technique ?" });
  await confirm.getByRole('button', { name: "Limiter l'accès" }).click();
  await expect(status.getByText('Accès limité', { exact: true })).toBeVisible();

  // recette Q-10 : vider la liste puis enregistrer est permis, l'encart dit ce que cela veut dire
  await list.getByRole('button', { name: /^Retirer/ }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Liste enregistrée.')).toBeVisible();
  await expect(status.getByRole('status')).toHaveText("Cet agent IA ne répond à personne : sa liste d'accès limité est vide.");
  const notice = status.getByRole('status').locator('..');
  // un seul bouton de chaque nom : l'encart porte les actions, la rangée ne les répète pas
  for (const name of ['Ajouter un numéro', 'Ouvrir à tous', 'Désactiver']) {
    await expect(status.getByRole('button', { name })).toHaveCount(1);
    await expect(notice.getByRole('button', { name })).toBeEnabled();
  }

  // Désactiver (confirmé), puis réactiver en accès limité est refusé tant que la liste est vide
  await notice.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  await expect(status.getByText('Désactivé', { exact: true })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Réactiver en accès limité' })).toBeDisabled();
  await expect(status.getByText("Ajoutez au moins un numéro à la Whitelist.")).toBeVisible();
  await expect(status.getByRole('button', { name: 'Réactiver pour tous' })).toBeEnabled();
  await status.getByRole('button', { name: 'Ajouter un numéro' }).click();
  await expect(page.getByLabel('Numéro à autoriser')).toBeFocused();

  // une entrée de plus : la réactivation en accès limité est permise
  await page.getByLabel('Numéro à autoriser').fill('+33699887766');
  await list.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Liste enregistrée.')).toBeVisible();
  await status.getByRole('button', { name: 'Réactiver en accès limité' }).click();
  await expect(status.getByText('Accès limité', { exact: true })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Désactiver' })).toBeVisible();
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
  await page.getByRole('button', { name: '▶ Simuler' }).click();
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

// recette Q-4 : plus de « Connexions · à venir », le chemin vers les numéros de l'organisation pour l'admin
test("colonne de l'agent IA : « CRM » Soon, lien vers les numéros WhatsApp de l'organisation pour l'admin seulement", async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const rail = page.locator('aside');
  await expect(rail.getByText('CRM', { exact: true })).toBeVisible();
  // section à venir : annoncée indisponible, avec « Soon » (spec 5.2)
  await expect(rail.getByRole('link', { name: 'CRM Soon' })).toHaveAttribute('aria-disabled', 'true');
  await expect(rail.getByText('Connexions')).toHaveCount(0);
  await rail.getByRole('link', { name: "Numéros WhatsApp de l'organisation" }).click();
  await page.waitForURL('**/organisation/connexions');
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toBeVisible();

  // un conseiller n'a pas ce lien
  await resetMock(request);
  await page.context().clearCookies();
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  await expect(page.locator('aside').getByText('CRM', { exact: true })).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: "Numéros WhatsApp de l'organisation" })).toHaveCount(0);
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
