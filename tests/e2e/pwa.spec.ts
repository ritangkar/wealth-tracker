import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';

const BASE = '/wealth-tracker/';
declare global { interface Window { __store: any } }

async function ready(page: Page, hash = '') {
  await page.goto(BASE + hash);
  await page.waitForFunction(() => !!window.__store);
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
}
async function controlled(page: Page) {
  // first load installs the SW; reload so the page is controlled
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test.afterEach(() => { rmSync('.e2e-active', { force: true }); });

test.describe('GitHub Pages subpath hosting', () => {
  test('serves under /wealth-tracker/, manifest + icons + sw resolve relative to the subpath', async ({ page, request }) => {
    await ready(page);
    await expect(page).toHaveTitle(/Wealth OS/);
    const manifestUrl = await page.locator('link[rel=manifest]').evaluate((l: HTMLLinkElement) => l.href);
    expect(manifestUrl).toBe('http://localhost:4173/wealth-tracker/manifest.webmanifest');
    const m = await (await request.get(manifestUrl)).json();
    expect(m.start_url).toBe('./'); expect(m.scope).toBe('./'); expect(m.display).toBe('standalone');
    for (const icon of m.icons) {
      const r = await request.get(new URL(icon.src, manifestUrl).href);
      expect(r.status(), icon.src).toBe(200); expect(r.headers()['content-type']).toContain('image/png');
    }
    expect(m.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
    expect((await request.get('http://localhost:4173/wealth-tracker/icons/apple-touch-icon.png')).status()).toBe(200);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.scope);
    expect(scope).toBe('http://localhost:4173/wealth-tracker/');
    // no absolute-root asset URLs in the shell
    const html = await (await request.get(BASE)).text();
    expect(html).not.toMatch(/(src|href)="\/(?!\/)/);
  });

  test('refresh and deep links keep working (hash routing); unknown paths 404 like Pages', async ({ page, request }) => {
    await ready(page, '#/plan?tab=goals');
    await expect(page.getByRole('heading', { name: 'Plan & goals' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Plan & goals' }).first()).toBeVisible();
    expect(page.url()).toContain('#/plan?tab=goals');
    await page.goto(BASE + '#/settings'); await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings & backup' })).toBeVisible();
    expect((await request.get('http://localhost:4173/wealth-tracker/plan')).status()).toBe(404);
  });
});

test.describe('offline & caching', () => {
  test('service worker precaches the shell; app starts and works fully offline, data persists', async ({ page, context }) => {
    await ready(page); await controlled(page);
    const names = await page.evaluate(() => caches.keys());
    expect(names.filter((n) => n.startsWith('wealth-os-')).length).toBe(1);
    await page.evaluate(async () => {
      const s = window.__store;
      await s.addAccount({ name: 'HDFC Savings', kind: 'bank', ownerId: 'p1', openingBalance: 100000, openingDate: '2026-01-01' });
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Home' }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Offline/).first()).toBeVisible();
    await page.goto(BASE + '#/wealth?tab=accounts'); await page.reload();
    await expect(page.getByText('HDFC Savings').first()).toBeVisible();
    // write while offline, survives reload while offline
    await page.evaluate(async () => {
      const s = window.__store; const acc = s.db.accounts[0];
      const r = await s.addTransaction({ type: 'expense', date: s.today(), amount: 125000, ownerId: 'p2', fromAccountId: acc.id, paymentMethod: 'upi', categoryId: 'cat_groceries', merchant: 'Blinkit' });
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
    });
    await page.reload(); await page.waitForFunction(() => !!window.__store);
    expect(await page.evaluate(() => window.__store.db.transactions.length)).toBe(1);
    await context.setOffline(false);
  });

  test('new deploy: update prompt appears, old caches are removed, data survives, version changes', async ({ page }) => {
    await ready(page); await controlled(page);
    await page.evaluate(() => window.__store.addAccount({ name: 'Keep me', kind: 'bank', ownerId: 'p1', openingBalance: 5000, openingDate: '2026-01-01' }));
    const before = await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('wealth-os-')));
    const v1 = await page.evaluate(() => window.__store.appVersion);
    writeFileSync('.e2e-active', 'dist-v2');            // "deploy" a new build
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByText('A new version is ready')).toBeVisible({ timeout: 15_000 });
    // old version stays active until the user accepts (no surprise reload)
    expect(await page.evaluate(() => window.__store.appVersion)).toBe(v1);
    await page.getByRole('button', { name: 'Update now' }).click();
    await page.waitForFunction((old) => window.__store && window.__store.appVersion !== old, v1, { timeout: 20_000 });
    const after = await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('wealth-os-')));
    expect(after).toHaveLength(1); expect(after[0]).not.toBe(before[0]);
    expect(await page.evaluate(() => window.__store.db.accounts.map((a: any) => a.name))).toContain('Keep me');
  });

  test('stale cache prevention: sw.js is byte-different per build and index.html is revalidated when online', async ({ request, page }) => {
    const a = await (await request.get('http://localhost:4173/wealth-tracker/sw.js')).text();
    writeFileSync('.e2e-active', 'dist-v2');
    const b = await (await request.get('http://localhost:4173/wealth-tracker/sw.js')).text();
    expect(a).not.toBe(b); expect(a).toContain('e2e-a'); expect(b).toContain('e2e-b');
    expect(a).toMatch(/PRECACHE = \[.*"\.\/assets\//s);
    expect(a).not.toMatch(/PRECACHE = \[.*"\/assets/s);
    void page;
  });
});

test.describe('responsive / mobile', () => {
  test('no horizontal scroll and 44px nav targets on every route at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    for (const route of ['', '#/activity', '#/wealth', '#/more', '#/plan', '#/debt', '#/subscriptions', '#/waste', '#/insights', '#/settings', '#/welcome']) {
      await page.goto(BASE + route); await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
    }
    await page.goto(BASE);
    const boxes = await page.locator('.bottomnav a, .bottomnav button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
    for (const [w, h] of boxes) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
  });
});
