// World smoke test — safety net that catches regressions within 30s after adding objects/features.
//   npm run test:world
// Requires: npm i -D playwright && npx playwright install chromium (first time only)
// Starts its own static server, so it runs without the app/backend (/api is 404 — the world runs on fallbacks).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8899;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const base = url.startsWith('/vrm/') ? ROOT : path.join(ROOT, 'static');
    const fp = path.normalize(path.join(base, url));
    if (!fp.startsWith(base) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let chromium, devices;
try { ({ chromium, devices } = await import('playwright')); }
catch { console.error('✗ playwright가 없어요: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const results = [];
const check = (name, ok, warnOnly = false, detail = '') => {
    results.push({ name, ok, warnOnly });
    console.log(`${ok ? '  PASS' : warnOnly ? '⚠ WARN' : '✗ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const errFilter = (t) => !/VALIDATE_STATUS|favicon|manifest|\/api\/|\/ws|WebSocket|404|sounds\//i.test(t);
// hour=14 fixed: run late at night, the pets are auto-sleeping and the right-click probe gets consumed as 'wake up' (removes time-of-day nondeterminism).
// stats=1: overlay for the draws upper-bound assertion.
const URL0 = `http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`;

// --use-angle=metal: real GPU path — without it, falls back to SwiftShader (software), which is slow and unlike real use.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });

// ---- A. Desktop: load · no errors · dock · construction mode toggle ----
{
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error' && errFilter(m.text())) errs.push(m.text()); });
    await page.goto(URL0, { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    const env = await page.evaluate(() => ({
        canvas: !!document.querySelector('canvas'),
        dock: (document.getElementById('world-dock-ui') || { children: [] }).children.length,
        kids: [...(document.getElementById('world-dock-ui') || { children: [] }).children].map((b) => b.textContent),
    }));
    check('desktop 월드 로드(canvas)', env.canvas);
    check('desktop 독 버튼 존재', env.dock >= 5, false, `${env.dock}개`);
    // World bake regression net: if a new prop misses MERGE_TYPES / bake registration, draws start leaking.
    // Bake baseline ~190 — a 250 cap leaves room for new content while still catching leaks (dozens of calls).
    const draws = await page.evaluate(() => {
        const t = [...document.querySelectorAll('div')].map((d) => d.textContent).find((s) => / draws · /.test(s)) || '';
        return parseInt((t.match(/(\d+) draws/) || [])[1] || '0', 10);
    });
    check('draws 상한(월드 베이크)', draws > 0 && draws <= 250, false, `${draws} draws`);
    // After the dock cleanup (plan A), 🔨 lives inside the ⚙️ drawer — open the drawer and press it like a real user would
    const gear = await page.evaluate(() => {
        const g = [...document.querySelectorAll('#world-dock-ui div')].find((b) => b.textContent.trim().startsWith('⚙️'));
        if (g) g.click();
        return !!g;
    });
    await page.waitForTimeout(400);
    const hb = gear && await page.evaluate(() => {
        const b = [...document.querySelectorAll('#world-dock-ui div')].find((el) => el.textContent === '🔨');
        if (b) b.click();
        return !!b;
    });
    if (hb) {
        await page.waitForTimeout(400);
        const on = await page.evaluate(() => [...document.body.children].some((el) => el.textContent && el.textContent.includes('공사 모드') && el.style.display === 'flex'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        check('desktop 공사모드 토글(서랍 경유)', on);
    } else check('desktop 공사모드 토글(서랍 경유)', false, false, '⚙️/🔨 버튼 없음');
    // Pet right-click probe — aims precisely at the pet via __worldDev.petScreenXY (the old grid scan often missed when the random
    // pet position coincided with swimming or sitting). Try both pets; pass if a menu appears for either.
    let menu = false;
    for (let attempt = 0; attempt < 3 && !menu; attempt++) {
        const spots = await page.evaluate(() => (window.__worldDev ? window.__worldDev.petScreenXY() : []));
        for (const s of spots) {
            if (s.x < 5 || s.y < 5 || s.x > 1275 || s.y > 795) continue;   // Off-screen pets get the next round
            await page.mouse.click(s.x, s.y, { button: 'right' });
            await page.waitForTimeout(150);
            menu = await page.evaluate(() => { const m = document.getElementById('world-motion-menu'); return !!m && m.style.display === 'block'; });
            if (menu) break;
        }
        if (!menu) await page.waitForTimeout(800);   // If the pet is walking, try again shortly
    }
    check('desktop 펫 우클릭→메뉴', menu, true);
    check('desktop JS 에러 없음', errs.length === 0, false, errs.slice(0, 2).join(' | '));
    await page.context().close();
}

// ---- B. Mobile (iPhone): touch UI · size · eco defaults ----
{
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(URL0, { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    const env = await page.evaluate(() => ({
        touchUI: !!document.getElementById('world-touch-ui'),
        dockW: (document.getElementById('world-dock-ui') || { children: [{}] }).children[0].style.width,
        eco: localStorage.getItem('world-eco'),
    }));
    check('mobile 조종 UI 생성', env.touchUI);
    check('mobile 독 48px', env.dockW === '48px', false, env.dockW);
    check('mobile JS 에러 없음', errs.length === 0, false, errs.slice(0, 2).join(' | '));
    await ctx.close();
}

// ---- C. Saved layout apply path (localStorage fallback) ----
{
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.addInitScript(() => localStorage.setItem('world-layout', JSON.stringify({ 'tree-1': { x: -2.2, z: 0.5, rotY: 1.0 }, 'car-1': { x: 0.8, z: -1.2, rotY: 0.4 } })));
    await page.goto(URL0, { waitUntil: 'load' });
    await page.waitForTimeout(8000);
    check('layout 적용 로드(무에러)', errs.length === 0 && await page.evaluate(() => !!document.querySelector('canvas')), false, errs.slice(0, 2).join(' | '));
    await ctx.close();
}

// ---- D. Offline settlement: re-entry after 24h away — settlement happens · caps respected · draws intact ----
// Why 24h: awakeOverlapSec is based on the real clock, so with 8h a smoke run in the early morning may not overlap
// the awake hours (06~22) at all. With 24h, a full day's worth (16h) overlaps whenever it runs.
{
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.addInitScript(() => localStorage.setItem('world-last-seen', String(Date.now() - 24 * 3600000)));
    await page.goto(URL0, { waitUntil: 'load' });
    await page.waitForTimeout(8000);
    const st = await page.evaluate(() => ({
        last: window.__worldDev ? window.__worldDev.offlineLast() : null,
        fruits: window.__worldDev ? window.__worldDev.groundFruitN() : -1,
        traces: /따 먹었다|낚아 올렸다|바구니에 정리했다/.test(localStorage.getItem('world-events') || ''),
        draws: (() => {
            const t = [...document.querySelectorAll('div')].map((d) => d.textContent).find((s) => / draws · /.test(s)) || '';
            return parseInt((t.match(/(\d+) draws/) || [])[1] || '0', 10);
        })(),
    }));
    check('오프라인 정산 발생(24h 부재)', !!(st.last && st.last.parts.length), false, st.last ? `${st.last.awakeMin}분 · ${st.last.parts.join('/')}` : '요약 없음');
    check('정산 낙과 실체화 상한(≤5)', st.fruits >= 0 && st.fruits <= 5, false, `${st.fruits}알`);
    check('정산 이벤트 로그 주입(일기 소재)', st.traces);
    check('정산 후 draws 상한', st.draws > 0 && st.draws <= 250, false, `${st.draws} draws`);
    check('정산 JS 에러 없음', errs.length === 0, false, errs.slice(0, 2).join(' | '));
    await ctx.close();
}

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok && !r.warnOnly);
console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} PASS${fails.length ? ` · ${fails.length} FAIL` : ''} =====`);
process.exit(fails.length ? 1 : 0);
