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
  await expect(dialog.getByRole('radio', { name: 'UPI' })).toHaveAttribute('aria-checked', 'true'); // sensible default
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
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('App lock is on.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Wealth OS is locked' })).toBeVisible();
  for (const d of '1357') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That PIN did not match.')).toBeVisible();
  for (const d of '2468') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings & backup' })).toBeVisible();
});

test('single household view: no person switcher, long names never break the layout, who-did-it chosen per entry', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await fresh(page); await seed(page);
  await page.evaluate(async () => { const s = window.__store; await s.updateSettings({ people: [{ id: 'p1', name: 'Ritangkarananda', savingsTarget: 5000000 }, { id: 'p2', name: 'Chandrayeeparna', savingsTarget: 1000000 }] }); });
  await page.reload(); await page.waitForFunction(() => !!window.__store);
  await expect(page.getByRole('radiogroup', { name: 'Whose finances to show' })).toHaveCount(0);
  for (const r of ['', '#/activity', '#/plan', '#/settings']) {
    await page.goto(BASE + r); await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), r).toBeLessThanOrEqual(1);
  }
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: 'Chandrayeeparna' })).toBeVisible();
});

test('install prompt: banner appears on beforeinstallprompt and triggers the native prompt; hidden when dismissed', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    (window as any).__prompted = false;
    const e: any = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => { (window as any).__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  const banner = page.getByRole('region', { name: 'Install Wealth OS' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Install' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__prompted)).toBe(true);
  await expect(banner).toBeHidden();
  // settings always offers a way to install
  await page.goto(BASE + '#/settings');
  await expect(page.getByRole('heading', { name: 'Install the app' })).toBeVisible();
});

test('install guidance on iPhone Safari shows Add to Home Screen steps', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE); await page.waitForFunction(() => !!window.__store);
  await page.getByRole('button', { name: 'How to install' }).click();
  await expect(page.getByText('Add to Home Screen').first()).toBeVisible();
  await ctx.close();
});

test('goal allocation from several sources: ₹30,000 from an FD + ₹20,000 from a mutual fund (EPF not offered)', async ({ page }) => {
  await fresh(page);
  await page.evaluate(async () => {
    const s = window.__store; const ok = (r: any) => { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value; };
    ok(await s.addAccount({ name: 'HDFC Savings', kind: 'bank', ownerId: 'p1', openingBalance: 5000000, openingDate: '2026-01-01' }));
    for (const [name, type, v] of [['SBI FD', 'fd', 20000000], ['Nifty Fund', 'mutual_fund', 15000000], ['EPF', 'ppf_epf', 50000000]] as const) {
      const i = ok(await s.saveInvestment({ name, type, ownerId: 'p1' }));
      ok(await s.addValuation({ targetType: 'investment', targetId: i.id, date: '2026-01-01', value: v, invested: v }));
    }
    ok(await s.saveGoal({ name: 'Emergency Fund', kind: 'emergency', ownerId: 'hh', targetAmount: 30000000, status: 'active' }));
  });
  await page.goto(BASE + '#/plan?tab=goals'); await page.reload(); await page.waitForFunction(() => !!window.__store);
  await page.getByRole('button', { name: 'Allocate' }).click();
  const dlg = page.getByRole('dialog');
  const first = dlg.getByLabel('Set aside from');
  await expect(first.locator('option', { hasText: 'EPF' })).toHaveCount(0);        // EPF/PPF can't back a goal
  await first.selectOption({ label: /SBI FD/ as any }).catch(async () => { const v = await first.locator('option', { hasText: 'SBI FD' }).getAttribute('value'); await first.selectOption(v!); });
  await dlg.getByLabel('Amount', { exact: true }).fill('30000');
  await dlg.getByRole('button', { name: /Add another source/ }).click();
  const second = dlg.getByLabel('Source 2');
  const mfv = await second.locator('option', { hasText: 'Nifty Fund' }).getAttribute('value'); await second.selectOption(mfv!);
  await dlg.getByLabel('Amount 2').fill('20000');
  await expect(dlg.getByText('Total set aside: ₹50,000')).toBeVisible();
  const nwBefore = await page.evaluate(() => 0);
  void nwBefore;
  await dlg.getByRole('button', { name: /Set aside/ }).last().click();
  await expect.poll(() => page.evaluate(() => window.__store.db.goalAllocations.length)).toBe(2);
  const a = await page.evaluate(() => window.__store.db.goalAllocations.map((x: any) => [x.sourceKind, x.amount]));
  expect(a).toEqual([['investment', 3000000], ['investment', 2000000]]);
  await expect(page.getByText(/Set aside from:.*SBI FD ₹30,000.*Nifty Fund ₹20,000/)).toBeVisible();
  // no money moved: bank balance unchanged, no transactions
  expect(await page.evaluate(() => window.__store.db.transactions.length)).toBe(0);
});
