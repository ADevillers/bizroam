/** Local, read-only rendering of an actual walk. Never contacts research providers. */
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { chromium, devices } from '@playwright/test';
import { createWeb } from '../services/web/src/app.ts';

const snapshot = JSON.parse(readFileSync('.data/presentation-snapshot.json', 'utf8'));
const state = snapshot.state;
const password = randomBytes(24).toString('hex');
const origin = 'http://127.0.0.1:4178';
mkdirSync('presentation/assets', { recursive: true });
const app = await createWeb({
  dbPath: ':memory:', passwordHash: await hash(password), origin,
  toolsUrl: 'http://read-only-snapshot', toolsToken: 'local-capture-only', secure: false,
  transport: async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/web/config') return Response.json({ configured: true });
    if (path === '/web/action' && body.action === 'state') return Response.json(state);
    if (path === '/web/place') return Response.json(state.candidates.find((c: any) => c.id === body.id));
    if (path === '/web/company') return Response.json(state.profiles.find((p: any) => p.id === body.id));
    return Response.json({ error: 'Capture is read-only' }, { status: 405 });
  },
});
await app.listen({ host: '127.0.0.1', port: 4178 });
const browser = await chromium.launch({ headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      ...(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }),
      geolocation: { latitude: snapshot.position.lat, longitude: snapshot.position.lng, accuracy: snapshot.position.accuracy },
      permissions: ['geolocation'], locale: 'en-US', timezoneId: 'America/Los_Angeles',
    });
    const page = await context.newPage();
    page.on('pageerror', e => console.error('UI error:', e.message));
    await page.goto(origin);
    await page.evaluate(async ({ state }) => {
      sessionStorage.setItem('bizroam-walk', state.id);
      sessionStorage.setItem('bizroam-active', 'false');
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open('bizroam', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('settings')) req.result.createObjectStore('settings');
          if (!req.result.objectStoreNames.contains('encounters')) req.result.createObjectStore('encounters', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'encounters'], 'readwrite');
        tx.objectStore('settings').put(state.preferences, 'preferences');
        for (const e of state.encounters) tx.objectStore('encounters').put(e);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, { state });
    const login = await context.request.post(`${origin}/api/auth/login`, { headers: { origin }, data: { password } });
    if (!login.ok()) throw new Error('Capture login failed');
    await page.reload();
    await page.getByRole('button', { name: /Nearby/ }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.leaflet-tile')].filter(i => i.complete && i.naturalWidth > 0).length >= 4, { timeout: 40000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `presentation/assets/${mobile ? 'mobile' : 'desktop'}-map.png` });
    console.log(`${mobile ? 'Mobile' : 'Desktop'} map captured`);

    if (mobile) {
      await page.getByRole('button', { name: 'Expand discoveries' }).click();
      await page.getByRole('button', { name: /Passed by/ }).click();
      const card = page.locator('.company-card').filter({ has: page.getByRole('heading', { name: 'Zendesk', exact: true }) });
      await card.evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: 'presentation/assets/mobile-history.png' });
    } else {
      const nylas = page.locator('.company-card').filter({ has: page.getByRole('heading', { name: 'Nylas', exact: true }) });
      await nylas.evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: 'presentation/assets/desktop-discoveries.png' });
      await nylas.click();
      const modal = page.getByRole('dialog', { name: 'Company profile' });
      await modal.waitFor();
      await modal.screenshot({ path: 'presentation/assets/profile-nylas.png' });
      await modal.evaluate(el => el.scrollTop = el.scrollHeight);
      await page.waitForTimeout(200);
      await modal.screenshot({ path: 'presentation/assets/profile-sources.png' });
      await page.getByRole('button', { name: 'Close company profile' }).click();
      await page.getByRole('button', { name: 'Preferences', exact: true }).click();
      await page.getByRole('dialog', { name: 'Discovery preferences' }).screenshot({ path: 'presentation/assets/preferences.png' });
    }
    await context.close();
  }
} finally {
  await browser.close();
  await app.close();
}
