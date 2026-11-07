// 🍉 Harvest E2E: controlled ⌘ shake → fallen fruit (whole watermelon) → pick up (1/4 piece) → basket — static server (no contamination)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8938;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'application/octet-stream' };
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const base = url.startsWith('/vrm/') ? ROOT : path.join(ROOT, 'static');
    const fp = path.normalize(path.join(base, url));
    if (!fp.startsWith(base) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
// Possess next to the watermelon patch — 1m from the patch (-10.05,4.25) (inside the harvest radius, outside→inside the pickup radius)
await page.evaluate(() => window.__worldDev.possessGo('chick', -10.05, 5.1));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));   // ⌘ harvest (shake)
await page.waitForTimeout(3500);   // Wobble → fruit drops → settles
const g1 = await page.evaluate(() => JSON.parse(localStorage.getItem('world-fruit-ground') || '[]').filter((f) => f.t === 'watermelon').length);
check('H1 흔들기 → 통수박 낙과', g1 >= 1, `ground=${g1}`);
// Move next to the fallen fruit, then ⌘ pick up → 1/4 piece in hand (if a random snack gift already occupies the hand, empty it first — E2E determinism)
for (let k = 0; k < 6; k++) {
    const h0 = await page.evaluate(() => window.__worldDev.heldOf('chick'));
    if (!h0 || h0.food === null) break;
    await page.evaluate(() => window.__worldDev.fruitEat());
    await page.waitForTimeout(2400);
}
await page.evaluate(() => { const f = JSON.parse(localStorage.getItem('world-fruit-ground') || '[]').find((q) => q.t === 'watermelon'); if (f) window.__worldDev.possessGo('chick', f.x + 0.2, f.z); });
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));
await page.waitForTimeout(1000);
const held = await page.evaluate(() => window.__worldDev.heldOf('chick'));
check('H2 줍기 → 손에 수박(1/4통)', !!held && held.food === '수박' && held.bites === 0, JSON.stringify(held));
// ⌘ nom-nom, 3 bites to finish
// One ⌘ nom-nom = 1 bite (sequence ~1.95s, calls while in progress are ignored) — judge completion via the event log.
// The bestie's random snack gift can swap what is in hand, so if it is no longer watermelon, hand it back (determinism).
let gone = false;
for (let k = 0; k < 10 && !gone; k++) {
    const h = await page.evaluate(() => window.__worldDev.heldOf('chick'));
    if (!h || h.food !== '수박') await page.evaluate(() => window.__worldDev.fruitGive('watermelon'));
    await page.evaluate(() => window.__worldDev.fruitEat());
    await page.waitForTimeout(2400);
    gone = await page.evaluate(() => (localStorage.getItem('world-events') || '').includes('수박') && (localStorage.getItem('world-events') || '').includes('다 먹었다'));
}
check('H3 3입 완식 → 손 비움', gone, '');
check('H4 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
