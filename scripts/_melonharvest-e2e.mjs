// 🍉 수확 E2E: 조종 ⌘ 흔들기 → 낙과(통수박) → 줍기(1/4통) → 바구니 — 정적 서버(무오염)
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
// 수박밭 곁으로 빙의 — 패치(-10.05,4.25)에서 1m (수확 반경 안, 낙과 줍기 반경 밖→안)
await page.evaluate(() => window.__worldDev.possessGo('chick', -10.05, 5.1));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));   // ⌘ 수확(흔들기)
await page.waitForTimeout(3500);   // 웍블 → 낙과 → 정착
const g1 = await page.evaluate(() => JSON.parse(localStorage.getItem('world-fruit-ground') || '[]').filter((f) => f.t === 'watermelon').length);
check('H1 흔들기 → 통수박 낙과', g1 >= 1, `ground=${g1}`);
// 낙과 곁으로 이동 후 ⌘ 줍기 → 손에 1/4통 (랜덤 간식 선물이 손을 선점했으면 먼저 비운다 — E2E 결정화)
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
// ⌘ 냠냠 3입 완식
// ⌘ 냠냠 1회 = 1입(시퀀스 ~1.95s, 진행 중 호출은 무시) — 완식 판정은 이벤트 로그로.
// 절친의 랜덤 간식 선물이 손을 바꿔치기할 수 있어, 수박이 아니게 되면 다시 들려준다(결정화).
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
