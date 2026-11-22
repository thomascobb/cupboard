import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The demo seeds the prototype's sample data relative to today, in memory.
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?demo');
  await expect(page.locator('#title')).toHaveText('In the cupboards');
});
test.afterEach(() => expect(errors).toEqual([]));

const tab = (page: Page, name: string) => page.locator(`.tab[data-v="${name}"]`).click();
const rowNamed = (page: Page, name: string) => page.locator('#list .row', { hasText: name }).first();
const sheet = (page: Page) => page.locator('#sheet .panel');
const toast = (page: Page) => page.locator('#toast');

test('home lists stock with a rotate row and counts', async ({ page }) => {
  await expect(page.locator('#count')).toHaveText('36 items');
  await expect(page.locator('#list .row').first()).toContainText('Rotate stock');
  await expect(rowNamed(page, 'Baked beans')).toContainText('Pantry, Box 1');
  // Search hides the rotate row and filters.
  await page.fill('#q', 'tom chop');
  await expect(page.locator('#list .row')).toHaveCount(1);
  await expect(page.locator('#list .row')).toContainText('Chopped tomatoes');
});

test('cupboard filter persists across tabs', async ({ page }) => {
  await page.locator('#locs .chip', { hasText: 'Box 2' }).click();
  await tab(page, 'use');
  await expect(page.locator('#locs .chip[aria-pressed="true"]')).toHaveText('Box 2');
  await expect(page.locator('#list .row .sub').first()).toHaveText('Take from Box 2');
});

test('use: take the oldest, toast, undo', async ({ page }) => {
  await tab(page, 'use');
  await expect(page.locator('#title')).toHaveText('Use something');
  // Earliest date first: chickpeas are past their date in the seed.
  const first = page.locator('#list .row').first();
  await expect(first).toContainText('Chickpeas');
  await first.click();
  await expect(sheet(page)).toContainText('Take the one dated');
  await expect(sheet(page)).toContainText('1 left after this');
  await sheet(page).locator('[data-act="confirm-use"]').click();
  await expect(toast(page)).toContainText('Took 1 Chickpeas 400g. 1 left.');
  await expect(page.locator('#count')).toHaveText('35 items');
  await toast(page).locator('button', { hasText: 'Undo' }).click();
  await expect(page.locator('#count')).toHaveText('36 items');
});

test('add a new item, then it is found by search', async ({ page }) => {
  await tab(page, 'add');
  await page.fill('#q', 'Oat milk');
  const rows = page.locator('#list .row');
  await expect(rows.last()).toContainText('Add “Oat milk”');
  await rows.last().click();
  await expect(sheet(page).locator('h2')).toHaveText('New item');
  await expect(sheet(page).locator('[data-act="save-add"]')).toHaveText('Pick a month');
  await sheet(page).locator('[data-act="month"][data-v="6"]').click();
  await sheet(page).locator('[data-act="qty"][data-v="1"]').click();
  await sheet(page).locator('[data-act="sloc"]', { hasText: 'Box 2' }).click();
  await expect(sheet(page).locator('[data-act="save-add"]')).toHaveText('Add 2 to Box 2');
  await sheet(page).locator('[data-act="save-add"]').click();
  await expect(toast(page)).toContainText('Added 2 Oat milk');
  await tab(page, 'home');
  await page.fill('#q', 'oat');
  await expect(rowNamed(page, 'Oat milk')).toContainText('Box 2');
});

test('switching tabs keeps the open item; an unsaved Add is restored', async ({ page }) => {
  await rowNamed(page, 'Penne').click();
  await expect(sheet(page).locator('h2')).toHaveText('Penne 500g');
  await tab(page, 'add');
  await expect(sheet(page).locator('h2')).toHaveText('Penne 500g');
  await sheet(page).locator('[data-act="qty"][data-v="1"]').click();
  await sheet(page).locator('[data-act="qty"][data-v="1"]').click();
  await tab(page, 'use');
  await expect(sheet(page)).toContainText('Take the one dated');
  await tab(page, 'add');
  await expect(sheet(page).locator('.stepper output').first()).toHaveText('3');
  // Sheets sit above the tab bar.
  const nav = await page.locator('nav').boundingBox();
  const panel = await sheet(page).boundingBox();
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(nav!.y + 1);
});

test('detail: swap from the rotate panel', async ({ page }) => {
  await rowNamed(page, 'Coconut milk').click();
  const panel = sheet(page).locator('.rotate');
  await expect(panel.locator('button.secondary')).toHaveText('Swap: 1 to Pantry, 1 to Box 1');
  await panel.locator('button.secondary').click();
  await expect(toast(page)).toContainText('Rotated Coconut milk 400ml: 1 forward, 1 back');
  await expect(panel.locator('button.secondary')).toHaveText('Nothing to move');
});

test('rotate stock sheet rotates every ticked item', async ({ page }) => {
  await page.locator('[data-act="open-rotate"]').click();
  await expect(sheet(page).locator('.rot-list > li')).toHaveCount(2);
  await expect(sheet(page).locator('[data-act="do-rotate"]')).toHaveText('Rotate 2 items');
  await sheet(page).locator('.rot-list input[type="checkbox"]').first().uncheck();
  await expect(sheet(page).locator('[data-act="do-rotate"]')).toHaveText('Rotate 1 item');
  await sheet(page).locator('[data-act="do-rotate"]').click();
  await expect(toast(page)).toContainText('Rotated 1 item');
  await expect(page.locator('#list .row').first()).toContainText('1 item has older stock in reserve');
});

test('cupboards: add, long-press to rename, delete when empty', async ({ page }) => {
  await page.locator('[data-act="new-loc"]').click();
  await page.fill('#locname', 'pantry');
  await expect(sheet(page).locator('[data-act="save-loc"]')).toHaveText('That name is taken');
  await page.fill('#locname', 'Shed');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Added Shed');
  const chip = page.locator('#locs .chip', { hasText: 'Shed' });
  // Long-press: hold for 600ms; the sheet must survive the finger lifting.
  const box = (await chip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(sheet(page).locator('h2')).toHaveText('Shed');
  await page.fill('#locname', 'Garage');
  await sheet(page).locator('[data-act="rename-loc"]').click();
  await expect(page.locator('#locs .chip', { hasText: 'Garage' })).toBeVisible();
  await page.locator('#locs .chip', { hasText: 'Garage' }).click({ button: 'right' });
  await sheet(page).locator('[data-act="delete-loc"]').click();
  await expect(page.locator('#locs .chip', { hasText: 'Garage' })).toHaveCount(0);
  await toast(page).locator('button', { hasText: 'Undo' }).click();
  await expect(page.locator('#locs .chip', { hasText: 'Garage' })).toBeVisible();
});

test('a cupboard with stock cannot be deleted', async ({ page }) => {
  await page.locator('#locs .chip', { hasText: 'Pantry' }).click({ button: 'right' });
  await expect(sheet(page)).toContainText('To delete this cupboard, move or use the');
  await expect(sheet(page).locator('[data-act="delete-loc"]')).toHaveCount(0);
});

test('shop lists shortfalls; target changes move items on and off', async ({ page }) => {
  await tab(page, 'shop');
  await expect(page.locator('#title')).toHaveText('Running low');
  const passata = rowNamed(page, 'Passata');
  await expect(passata).toContainText('Have 1 of 2');
  await expect(passata).toContainText('Buy 1');
  await passata.click();
  await sheet(page).locator('[data-act="dtarget"][data-v="-1"]').click();
  await page.locator('[data-act="close"]').click();
  await expect(rowNamed(page, 'Passata')).toHaveCount(0);
});

test('detail: remove the last one, then delete the item and undo', async ({ page }) => {
  await rowNamed(page, 'Peanut butter').click();
  await sheet(page).locator('[data-act="lot-dec"]').click();
  await expect(sheet(page).locator('.lede')).toHaveText('None in stock');
  await sheet(page).locator('[data-act="delete-product"]').click();
  await expect(toast(page)).toContainText('Deleted Peanut butter 340g');
  await tab(page, 'add');
  await page.fill('#q', 'peanut');
  await expect(page.locator('#list .row')).toHaveCount(1);
  await expect(page.locator('#list .row')).toContainText('Add “peanut”');
  await toast(page).locator('button', { hasText: 'Undo' }).click();
  await expect(rowNamed(page, 'Peanut butter')).toContainText('None in stock');
});

test('settings sheet has export and the device name', async ({ page }) => {
  await page.locator('#gear').click();
  await expect(sheet(page).locator('h2')).toHaveText('Settings');
  await expect(sheet(page)).toContainText('Demo: nothing is saved');
  await page.fill('#devname', 'Kitchen');
  const download = page.waitForEvent('download');
  await sheet(page).locator('[data-act="export"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^cupboard-demo-\d{4}-\d{2}-\d{2}\.json$/);
  await tab(page, 'use');
  await expect(page.locator('#gear')).toBeHidden();
});
