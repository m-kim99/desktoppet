// 🛌 Blanket E2E — auto-cover on winter nights · owner tap tucks in · slipped off→bestie re-covers · folded on wake-up · summer guard
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8926;
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
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const errs = [];
const state = (pg) => pg.evaluate(() => window.__worldDev.blanketState());
const force = (pg, n, a) => pg.evaluate(([n, a]) => window.__worldDev.blanketForce(n, a), [n, a]);
const waitSt = async (pg, cond, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = await state(pg);
        if (cond(s)) return s;
        await pg.waitForTimeout(500);
    }
    return await state(pg);
};

const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?season=winter&hour=23&weather=clear&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
// Wait for bedtime — the 22:00 logic sends them to bed
let s = await waitSt(page, (s) => s.length === 2 && s.every((q) => q.sleeping && q.bed && q.phase === 'lying'), 60000);
check('B0 겨울밤 둘 다 침대 취침', s.every((q) => q.sleeping && q.phase === 'lying'), JSON.stringify(s));
// B1 auto-cover (forced trigger instead of waiting 40s)
await force(page, 'chick', 'auto'); await force(page, 'puppy', 'auto');
s = await waitSt(page, (s) => s.every((q) => q.st === 'on'), 6000);
check('B1 자동 덮임 — 둘 다 on', s.every((q) => q.st === 'on'), JSON.stringify(s));
// B2 owner tap — tucks the slipped blanket back without waking the pet
await force(page, 'chick', 'slip');
const tapOk = await force(page, 'chick', 'tap');
s = await waitSt(page, (s) => s.find((q) => q.n === 'chick').st === 'on', 5000);
const c2 = s.find((q) => q.n === 'chick');
check('B2 주인 탭 덮어주기 — 기상 없이 on 복귀', tapOk === true && c2.st === 'on' && c2.sleeping, JSON.stringify(c2));
// B3 slipped off → bestie re-covers (the chick gets up, tucks the puppy's blanket, returns to its own bed)
await force(page, 'puppy', 'slip'); await force(page, 'puppy', 'retuck');
s = await waitSt(page, (s) => s.find((q) => q.n === 'puppy').st === 'on', 55000);
check('B3a 절친 재덮기 — 강아지 이불 on', s.find((q) => q.n === 'puppy').st === 'on', JSON.stringify(s));
s = await waitSt(page, (s) => { const c = s.find((q) => q.n === 'chick'); return c.sleeping && c.bed && c.phase === 'lying'; }, 55000);
const c3 = s.find((q) => q.n === 'chick');
check('B3b 재덮기 후 병아리 제 침대 복귀·재취침', c3.sleeping && !!c3.bed && c3.phase === 'lying', JSON.stringify(c3));
// B4 wake-up = folded
await force(page, 'chick', 'wake');
s = await waitSt(page, (s) => s.find((q) => q.n === 'chick').st === 'off', 5000);
check('B4 기상 시 이불 개킴(off)', s.find((q) => q.n === 'chick').st === 'off', JSON.stringify(s.find((q) => q.n === 'chick')));
await page.close();

// B5 summer guard — no blanket appears even when the auto trigger is pulled early
const pg2 = await browser.newPage({ viewport: { width: 1100, height: 700 } });
pg2.on('pageerror', (e) => errs.push(String(e.message)));
await pg2.goto(`http://127.0.0.1:${PORT}/world.html?season=summer&hour=23&weather=clear&stats=1`, { waitUntil: 'load' });
await pg2.waitForTimeout(9000);
s = await waitSt(pg2, (s) => s.length === 2 && s.every((q) => q.sleeping && q.phase === 'lying'), 60000);
await force(pg2, 'chick', 'auto'); await force(pg2, 'puppy', 'auto');
await pg2.waitForTimeout(3000);
s = await state(pg2);
check('B5 여름엔 이불 없음', s.every((q) => q.st === 'off'), JSON.stringify(s));
await pg2.close();
check('B6 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
