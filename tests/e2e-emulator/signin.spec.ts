import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const PROJECT = 'demo-cupboard';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

/** Write a doc with the emulator's owner token, which bypasses the rules (like the admin script). */
async function put(path: string, fields: Record<string, unknown> = {}) {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  expect(r.ok).toBe(true);
}

test.beforeEach(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await put('households/home', { name: { stringValue: 'Our house' } });
  await put('households/home/members/shared@example.com');
});

/** Click "Sign in with Google" and complete the auth emulator's account picker. */
async function signIn(page: Page, email: string) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#signin').click()]);
  await popup.waitForLoadState();
  await popup.locator('#add-account-button').click();
  await popup.locator('#email-input').fill(email);
  await popup.getByRole('button', { name: /sign in/i }).click();
  await popup.waitForEvent('close');
}

async function phone(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('close', () => expect(errors).toEqual([]));
  return page;
}

test('household prompt, sign-in, empty household seeded with one cupboard', async ({ context }) => {
  const page = await phone(context);
  await page.goto('/');
  await expect(page.locator('#gate h1')).toHaveText('Which household?');
  await page.locator('#hh').fill('Not valid!');
  await page.locator('#gate button[type=submit]').click();
  await expect(page.locator('#hh-err')).toBeVisible();
  await page.locator('#hh').fill('home');
  await page.locator('#gate button[type=submit]').click();
  await expect(page.locator('#gate')).toContainText('Sign in with Google to open household home.');
  await signIn(page, 'shared@example.com');
  await expect(page.locator('#title')).toHaveText('In the cupboards');
  await expect(page.locator('#locs .chip')).toHaveText(['All', 'Cupboard', '+']);
  await expect(page.locator('#list')).toContainText('Nothing yet. Use Add to stock it.');
  // Remembered: a reload goes straight in.
  await page.reload();
  await expect(page.locator('#title')).toHaveText('In the cupboards');
  await page.locator('#gear').click();
  await expect(page.locator('#sheet')).toContainText('Our house');
  await expect(page.locator('#sheet')).toContainText('shared@example.com');
});

test('a link with #h= picks the household; wrong account is told so and can switch', async ({ context }) => {
  const page = await phone(context);
  await page.goto('/#h=home');
  await expect(page).toHaveURL(/127\.0\.0\.1:5174\/$/);
  await signIn(page, 'stranger@example.com');
  await expect(page.locator('#gate h1')).toHaveText('No access');
  await expect(page.locator('#gate')).toContainText('stranger@example.com');
  await expect(page.locator('#gate')).toContainText('household home');
  await page.locator('#other').click();
  await expect(page.locator('#gate')).toContainText('Sign in with Google to open household home.');
  await signIn(page, 'shared@example.com');
  await expect(page.locator('#title')).toHaveText('In the cupboards');
});

test('a household that does not exist', async ({ context }) => {
  const page = await phone(context);
  await page.goto('/#h=nowhere');
  await signIn(page, 'shared@example.com');
  // Rules deny reading a household you're not a member of, and nobody is a member of one that doesn't exist.
  await expect(page.locator('#gate h1')).toHaveText('No access');
  await page.locator('#switch').click();
  await expect(page.locator('#gate h1')).toHaveText('Which household?');
});

test('two phones on one account stay in sync; sign out', async ({ browser }) => {
  // Separate contexts = separate storage, like two devices.
  const ctxA = await browser.newContext({ ...test.info().project.use });
  const ctxB = await browser.newContext({ ...test.info().project.use });
  const a = await phone(ctxA);
  const b = await phone(ctxB);
  for (const p of [a, b]) {
    await p.goto('/#h=home');
    await signIn(p, 'shared@example.com');
    await expect(p.locator('#title')).toHaveText('In the cupboards');
  }
  // A adds a new item.
  await a.locator('.tab[data-v="add"]').click();
  await a.locator('#q').fill('Chickpeas');
  await a.locator('#list .row.new').click();
  await a.locator('[data-act="month"][data-v="3"]').click();
  await a.locator('[data-act="year"]').nth(2).click();
  await a.locator('[data-act="qty"][data-v="1"]').click();
  await a.locator('[data-act="save-add"]').click();
  await expect(a.locator('#toast')).toContainText('Added 2 Chickpeas');
  // B sees it without reloading, and uses one.
  await expect(b.locator('#list .row', { hasText: 'Chickpeas' })).toContainText('2');
  await b.locator('.tab[data-v="use"]').click();
  await b.locator('#list .row', { hasText: 'Chickpeas' }).click();
  await b.locator('[data-act="confirm-use"]').click();
  await expect(b.locator('#toast')).toContainText('Took 1 Chickpeas. 1 left.');
  await expect(a.locator('#list .row', { hasText: 'Chickpeas' })).toContainText('1');
  // A's open sheet follows B's changes.
  await a.locator('.tab[data-v="home"]').click();
  await a.locator('#list .row', { hasText: 'Chickpeas' }).click();
  await expect(a.locator('#sheet .lede')).toHaveText('1 in stock');
  await b.locator('#list .row', { hasText: 'Chickpeas' }).click();
  await b.locator('[data-act="confirm-use"]').click();
  await expect(a.locator('#sheet .lede')).toHaveText('None in stock');
  // Sign out from settings.
  await a.locator('[data-act="close"]').click();
  await a.locator('#gear').click();
  await a.locator('[data-act="sign-out"]').click();
  await expect(a.locator('#gate')).toContainText('Sign in with Google');
  await ctxA.close();
  await ctxB.close();
});

test('offline add syncs when back online', async ({ browser }) => {
  const ctxA = await browser.newContext({ ...test.info().project.use });
  const ctxB = await browser.newContext({ ...test.info().project.use });
  const a = await phone(ctxA);
  const b = await phone(ctxB);
  for (const p of [a, b]) {
    await p.goto('/#h=home');
    await signIn(p, 'shared@example.com');
    await expect(p.locator('#title')).toHaveText('In the cupboards');
  }
  await ctxA.setOffline(true);
  await a.locator('.tab[data-v="add"]').click();
  await a.locator('#q').fill('Lentils');
  await a.locator('#list .row.new').click();
  await a.locator('[data-act="month"][data-v="5"]').click();
  await a.locator('[data-act="year"]').nth(1).click();
  await a.locator('[data-act="save-add"]').click();
  // A sees its own change straight away.
  await a.locator('.tab[data-v="home"]').click();
  await expect(a.locator('#list .row', { hasText: 'Lentils' })).toBeVisible();
  await b.waitForTimeout(1500);
  await expect(b.locator('#list .row', { hasText: 'Lentils' })).toHaveCount(0);
  await ctxA.setOffline(false);
  await expect(b.locator('#list .row', { hasText: 'Lentils' })).toBeVisible({ timeout: 20_000 });
  await ctxA.close();
  await ctxB.close();
});
