import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Votre agenda, l’esprit léger.' })).toBeVisible();
});

test('creates client, persists, books, rejects overlaps, edits and cancels', async ({ page }) => {
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: '+ Nouvelle cliente' }).click();
  await page.getByLabel('Nom et prénom').fill('Test E2E');
  await page.getByLabel('Téléphone', { exact: true }).fill('06 12 34 56 78');
  await page.getByLabel('Autorise les rappels de rendez-vous').check();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Test E2E/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Test E2E/ }).click();
  await page.getByRole('button', { name: '+ Prendre rendez-vous' }).click();
  await page.getByLabel('Début (heure de Paris)').fill('2026-10-21T15:00');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('button', { name: /15:00.*Test E2E/ })).toBeVisible();
  await page.getByRole('button', { name: '+ Nouveau rendez-vous' }).click();
  await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: 'Test E2E' });
  await page.getByLabel('Début (heure de Paris)').fill('2026-10-21T15:30');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('chevauche');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: /15:00.*Test E2E/ }).click();
  await page.getByRole('combobox', { name: 'Statut', exact: true }).selectOption('cancelled');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('button', { name: /15:00.*Test E2E/ })).toContainText('Annulé');
});

test('reminders and refills are visible, dismiss survives reload, no message is sent', async ({ page }) => {
  const externalWrites = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) externalWrites.push(request.url()); });
  await page.getByRole('button', { name: /^Rappels/ }).click();
  await expect(page.getByRole('heading', { name: 'Camille · exemple' })).toBeVisible();
  await expect(page.getByText('Messages préparés · aucun envoi automatique')).toBeVisible();
  await page.getByRole('button', { name: 'Marquer comme traité' }).click();
  await page.getByRole('button', { name: 'Traités', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camille · exemple' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Tout est à jour.')).toBeVisible();
  await page.getByRole('button', { name: /^Remplissages/ }).click();
  await expect(page.getByRole('heading', { name: 'Sarah · exemple' })).toBeVisible();
  expect(externalWrites).toHaveLength(0);
});

test('search, archive, mobile layout and escaping', async ({ page }) => {
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: '+ Nouvelle cliente' }).click();
  await page.getByLabel('Nom et prénom').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByRole('searchbox').fill('<img');
  await expect(page.locator('.client-card')).toHaveCount(1);
  await expect(page.locator('.client-card img')).toHaveCount(0);
  await page.locator('.client-card').click();
  await page.getByRole('button', { name: 'Archiver cette cliente' }).click();
  await expect(page.locator('.client-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
