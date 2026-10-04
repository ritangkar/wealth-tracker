import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = '/wealth-tracker/';
declare global { interface Window { __store: any } }

async function fresh(page: Page, hash = '') {
  await page.goto(BASE + hash);
  await page.waitForFunction(() => !!window.__store);
  await page.evaluate(async () => { await window.__store.resetAll(); });
}
async function seed(page: Page) {
  await page.evaluate(async () => {
    const s = window.__store;
    await s.addAccount({ name: 'HDFC Savings', kind: 'bank', ownerId: 'p1', openingBalance: 5000000, openingDate: '2026-01-01' });
  });
  await page.reload(); await page.waitForFunction(() => !!window.__store);
}

test('first run shows welcome nudge; user can add an account via onboarding', async ({ page }) => {
  await fresh(page, '#/welcome');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByLabel('Account name').fill('HDFC Savings');
  await page.getByLabel('Balance today').fill('50000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect.poll(() => page.evaluate(() => window.__store.db.accounts.length)).toBe(1);
  expect(await page.evaluate(() => window.__store.db.accounts[0].openingBalance)).toBe(5000000);
});

test('quick add expense: owner and funding account stay distinct; appears in Activity', async ({ page }) => {
  await fresh(page); await seed(page);
  await page.getByRole('button', { name: /Add/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount').first().fill('1250');
  await dialog.getByRole('radio', { name: 'Groceries' }).click();
  await dialog.getByLabel('Merchant').fill('Blinkit');
  await dialog.getByRole('radio', { name: 'Wife' }).click();
  await dialog.getByRole('radio', { name: 'UPI' }).click();
  await dialog.getByRole('button', { name: /^Save/ }).first().click();
  await expect.poll(() => page.evaluate(() => window.__store.db.transactions.length)).toBe(1);
  const t = await page.evaluate(() => window.__store.db.transactions[0]);
  expect(t).toMatchObject({ type: 'expense', amount: 125000, ownerId: 'p2', paymentMethod: 'upi', merchant: 'Blinkit', categoryId: 'cat_groceries' });
  expect(t.fromAccountId).toBeTruthy();
  await page.goto(BASE + '#/activity');
  await expect(page.getByText('Blinkit').first()).toBeVisible();
});

test('backup → erase → restore round trip, and a malformed file changes nothing', async ({ page }) => {
  await fresh(page); await seed(page);
  await page.evaluate(async () => { const s = window.__store; await s.addTransaction({ type: 'income', date: s.today(), amount: 1000000, ownerId: 'p1', toAccountId: s.db.accounts[0].id, incomeType: 'Salary' }); });
  await page.goto(BASE + '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download backup/ }).click()]);
  const path = await dl.path(); const json = readFileSync(path!, 'utf8');
  expect(JSON.parse(json)).toMatchObject({ app: 'wealth-os', schemaVersion: 1 });
  await page.evaluate(async () => { await window.__store.resetAll(); });
  expect(await page.evaluate(() => window.__store.db.accounts.length)).toBe(0);
  // malformed first
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"wealth-os","schemaVersion":1,"data":{"accounts":[') });
  await expect(page.getByText('This backup can’t be used')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => window.__store.db.accounts.length)).toBe(0);
  // valid
  await page.locator('input[type=file]').setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByText('Review before restoring')).toBeVisible();
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__store.db.accounts.length)).toBe(1);
  expect(await page.evaluate(() => window.__store.db.transactions.length)).toBe(1);
});

test('app lock: set PIN, locked after reload, wrong PIN rejected, right PIN unlocks', async ({ page }) => {
  await fresh(page); await seed(page);
  await page.goto(BASE + '#/settings');
  await page.getByRole('button', { name: 'Set a PIN' }).click();
  await page.getByLabel('New PIN (4–8 digits)').fill('2468');
  await page.getByLabel('Repeat new PIN').fill('2468');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('App lock is on.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Wealth OS is locked' })).toBeVisible();
  for (const d of '1357') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByText('That PIN did not match.').or(page.getByRole('heading', { name: 'Wealth OS is locked' }))).toBeVisible();
  for (const d of '2468') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings & backup' })).toBeVisible();
});
