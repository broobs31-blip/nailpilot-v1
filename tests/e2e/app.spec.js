import { test, expect } from '@playwright/test';

// Mercredi 21 octobre 2026, 10 h à Paris. Le jeu de démo est calculé relativement à « maintenant ».
const NOW = new Date('2026-10-21T08:00:00Z');
const isMobile = testInfo => testInfo.project.name === 'telephone';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
});

async function noHorizontalScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('onboarding démo : métiers, mode de travail, zone, slug puis page publique', async ({ page }) => {
  await page.goto('/#/bienvenue');
  await expect(page.getByRole('heading', { name: 'Parlez-nous de votre activité' })).toBeVisible();
  // Étape 1 : la validation refuse un formulaire incomplet.
  await page.getByLabel('Nom de votre activité').fill('');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByRole('alert')).toContainText('activité');
  await page.getByLabel('Coiffure').check();
  await page.getByLabel('Nom de votre activité').fill('Atelier Inès');
  await page.getByLabel('Ville', { exact: true }).fill('Lyon');
  await page.getByRole('button', { name: /Continuer/ }).click();
  // Étape 2 : mode « les deux » → adresse de base + zone.
  await expect(page.getByRole('heading', { name: 'Où travaillez-vous ?' })).toBeVisible();
  await page.getByLabel(/Les deux/).check();
  await page.getByLabel('Adresse', { exact: true }).fill('5 rue Mercière');
  await page.getByLabel('Code postal').fill('69002');
  await page.getByLabel('Ville', { exact: true }).fill('Lyon');
  await page.getByLabel('Codes postaux desservis').fill('69001, 69002, 69003');
  await page.getByLabel('Trajet entre deux clientes (min)').fill('20');
  await page.getByRole('button', { name: /Continuer/ }).click();
  // Étape 3 : slug proposé depuis le nom commercial.
  await expect(page.getByRole('heading', { name: 'Votre page de réservation' })).toBeVisible();
  await expect(page.getByLabel('Adresse de votre page')).toHaveValue('atelier-ines');
  await expect(page.getByText('Disponible !')).toBeVisible();
  await page.getByRole('button', { name: /Terminer/ }).click();
  await expect(page.getByRole('heading', { name: /(Bonjour|Bonsoir), Atelier Inès/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir ma page' }).first()).toHaveAttribute('href', /\/r\/atelier-ines$/);
  await noHorizontalScroll(page);
  await page.goto('/r/atelier-ines');
  await expect(page.getByRole('heading', { name: 'Atelier Inès', level: 1 })).toBeVisible();
  await expect(page.getByText('Lyon').first()).toBeVisible();
});

test('création d’un RDV à domicile : tampon de trajet visible et chevauchement refusé', async ({ page }) => {
  await page.goto('/#/agenda/jour/2026-10-22');
  await expect(page.getByRole('heading', { name: 'Jeudi 22 octobre' })).toBeVisible();
  await page.getByRole('button', { name: /Nouveau RDV/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau rendez-vous' });
  await dialog.getByRole('combobox', { name: 'Cliente' }).selectOption('demo-c2');
  await dialog.getByRole('combobox', { name: 'Prestation' }).selectOption('demo-s4');
  await dialog.getByRole('radio', { name: 'Chez la cliente' }).check();
  await expect(dialog.getByLabel('Adresse de la cliente')).toContainText('8 avenue de Lyon');
  await dialog.getByLabel('Heure de début').fill('15:00');
  await expect(dialog.getByLabel('Trajet avant (min)')).toHaveValue('30');
  await expect(dialog.getByText(/agenda bloqué/)).toContainText('14 h 30 – 16 h 15');
  await dialog.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await expect(dialog).toBeHidden();
  const block = page.locator('.tl-appt', { hasText: 'Sofia Benali' });
  await expect(block.locator('.tl-buffer-before')).toContainText('Trajet 30 min avant');
  await expect(block.locator('.tl-buffer-after')).toContainText('Trajet 30 min après');
  // 16 h chez moi tombe dans le trajet retour (jusqu'à 16 h 15) : refusé.
  await page.getByRole('button', { name: /Nouveau RDV/ }).click();
  const second = page.getByRole('dialog', { name: 'Nouveau rendez-vous' });
  await second.getByRole('combobox', { name: 'Cliente' }).selectOption('demo-c1');
  await second.getByRole('combobox', { name: 'Prestation' }).selectOption('demo-s3');
  await second.getByRole('radio', { name: 'Chez moi' }).check();
  await second.getByLabel('Heure de début').fill('16:00');
  await expect(second.locator('.callout-error')).toContainText('chevauche');
  await second.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await expect(second.getByRole('alert')).toContainText('chevauche');
  await second.getByRole('button', { name: 'Fermer' }).click();
  // 16 h 15 pile est accepté (écart = tampon le plus grand, R1).
  await page.getByRole('button', { name: /Nouveau RDV/ }).click();
  const third = page.getByRole('dialog', { name: 'Nouveau rendez-vous' });
  await third.getByRole('combobox', { name: 'Cliente' }).selectOption('demo-c1');
  await third.getByRole('combobox', { name: 'Prestation' }).selectOption('demo-s3');
  await third.getByRole('radio', { name: 'Chez moi' }).check();
  await third.getByLabel('Heure de début').fill('16:15');
  await third.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await expect(third).toBeHidden();
  await expect(page.locator('.tl-appt', { hasText: '16 h 15' })).toContainText('Camille Martin');
  await noHorizontalScroll(page);
});

test('réservation publique de bout en bout puis acceptation par la pro', async ({ page }, testInfo) => {
  await page.goto('/r/studio-demo');
  await expect(page.getByRole('heading', { name: 'Studio Démo', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Coupe femme/ }).click();
  await expect(page.getByRole('heading', { name: 'Où se passe le rendez-vous ?' })).toBeVisible();
  // Hors zone → message clair.
  await page.getByRole('radio', { name: /Elle vient chez moi/ }).check();
  await page.getByLabel('Adresse', { exact: true }).fill('1 rue de Paris');
  await page.getByLabel('Code postal').fill('75001');
  await page.getByLabel('Ville').fill('Paris');
  await page.getByRole('button', { name: /Voir les créneaux/ }).click();
  await expect(page.getByRole('alert')).toContainText('ne se déplace pas');
  await page.getByRole('radio', { name: /Je viens chez Studio Démo/ }).check();
  await page.getByRole('button', { name: /Voir les créneaux/ }).click();
  await expect(page.getByRole('heading', { name: 'Choisissez votre créneau' })).toBeVisible();
  const slot = page.locator('.pb-slot').first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(page.getByRole('heading', { name: 'Vos coordonnées' })).toBeVisible();
  await expect(page.getByLabel(/rappel la veille/)).not.toBeChecked();
  await page.getByLabel('Prénom').fill('Julie');
  await page.getByLabel('Nom', { exact: true }).fill('<b>Test</b>');
  await page.getByLabel('Téléphone mobile').fill('06 11 22 33 44');
  await page.getByLabel(/rappel la veille/).check();
  await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page.getByRole('heading', { name: 'Demande envoyée !' })).toBeVisible();
  await expect(page.getByText('en attente de validation')).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto('/#/demandes');
  const card = page.locator('.request', { hasText: 'Julie <b>Test</b>' });
  await expect(card).toBeVisible();
  await expect(page.locator('.request b')).toHaveCount(0);
  if (isMobile(testInfo)) await expect(page.locator('.tabbar a[href="#/demandes"] .count-badge')).toHaveText('2');
  await card.getByRole('button', { name: 'Accepter' }).click();
  const message = page.getByRole('dialog', { name: 'Prévenez votre cliente' });
  await expect(message).toBeVisible();
  await expect(message.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /wa\.me\/33611223344/);
  await expect(message.getByRole('link', { name: 'SMS' })).toHaveAttribute('href', /^sms:/);
  await message.getByRole('button', { name: 'Terminé' }).click();
  await expect(page.locator('.request', { hasText: 'Julie' })).toHaveCount(0);
  await expect(page.getByText('Traitées récemment')).toBeVisible();
});

test('rappels préparés : copier, WhatsApp, marquer comme traité', async ({ page }) => {
  const writes = [];
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
  await page.goto('/#/messages/rappels');
  await expect(page.getByRole('heading', { name: 'Rappels & relances' })).toBeVisible();
  const card = page.locator('.message-card').first();
  await expect(card.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /wa\.me/);
  const before = await page.locator('.message-card').count();
  await card.getByRole('button', { name: 'Marquer comme traité' }).click();
  await expect(page.locator('.message-card')).toHaveCount(before - 1);
  expect(writes).toHaveLength(0);
});

test('fiches clientes : échappement, recherche, archivage', async ({ page }) => {
  await page.goto('/#/clientes');
  await page.getByRole('button', { name: /Nouvelle cliente/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle cliente' });
  await dialog.getByLabel('Nom et prénom').fill('<img src=x onerror=alert(1)>');
  await dialog.getByLabel('Téléphone').fill('06 12 34 56 78');
  await dialog.getByRole('button', { name: 'Créer la fiche' }).click();
  await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  await page.getByRole('button', { name: /Archiver/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archiver' }).click();
  await page.goto('/#/clientes');
  await page.getByRole('searchbox').fill('img');
  await expect(page.locator('.client-row')).toHaveCount(0);
  await noHorizontalScroll(page);
});
