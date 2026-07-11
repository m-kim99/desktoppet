// 월드 스모크 테스트 — 사물/기능 추가 후 30초 안에 회귀를 잡는 안전망.
//   npm run test:world
// 필요: npm i -D playwright && npx playwright install chromium (첫 1회)
// 정적 서버를 스스로 띄우므로 앱/백엔드 없이 돈다 (/api는 404 — 월드는 폴백으로 동작).
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
// hour=14 고정: 심야에 돌리면 펫이 자동취침 중이라 우클릭 프로브가 '깨우기'로 소모된다 (시각 비결정성 제거).
// stats=1: draws 상한 어서션용 오버레이.
const URL0 = `http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`;

// --use-angle=metal: 실제 GPU 경로 — 없으면 SwiftShader(소프트웨어)로 떨어져 느리고 실사용과 다르다.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });

// ---- A. 데스크톱: 로드·무에러·독·공사모드 토글 ----
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
    // 월드 베이크 회귀망: 새 프롭이 MERGE_TYPES/베이크 등록을 빼먹으면 draws가 새기 시작한다.
    // 베이크 기준 ~190 — 상한 250이면 콘텐츠 추가 여유는 있으면서 누수(수십 콜)는 잡힌다.
    const draws = await page.evaluate(() => {
        const t = [...document.querySelectorAll('div')].map((d) => d.textContent).find((s) => / draws · /.test(s)) || '';
        return parseInt((t.match(/(\d+) draws/) || [])[1] || '0', 10);
    });
    check('draws 상한(월드 베이크)', draws > 0 && draws <= 250, false, `${draws} draws`);
    const bi = env.kids.indexOf('🔨');
    if (bi >= 0) {
        await page.evaluate((i) => document.getElementById('world-dock-ui').children[i].click(), bi);
        await page.waitForTimeout(400);
        const on = await page.evaluate(() => [...document.body.children].some((el) => el.textContent && el.textContent.includes('공사 모드') && el.style.display === 'flex'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        check('desktop 공사모드 토글', on);
    } else check('desktop 공사모드 토글', false, false, '🔨 버튼 없음');
    // 펫 우클릭 프로브 — __worldDev.petScreenXY로 펫을 정확히 조준한다 (예전 격자 스캔은 펫 위치
    // 랜덤에 수영·착석까지 겹치면 자주 빗나갔다). 두 마리 다 시도, 하나라도 메뉴가 뜨면 통과.
    let menu = false;
    for (let attempt = 0; attempt < 3 && !menu; attempt++) {
        const spots = await page.evaluate(() => (window.__worldDev ? window.__worldDev.petScreenXY() : []));
        for (const s of spots) {
            if (s.x < 5 || s.y < 5 || s.x > 1275 || s.y > 795) continue;   // 화면 밖 펫은 다음 라운드에
            await page.mouse.click(s.x, s.y, { button: 'right' });
            await page.waitForTimeout(150);
            menu = await page.evaluate(() => { const m = document.getElementById('world-motion-menu'); return !!m && m.style.display === 'block'; });
            if (menu) break;
        }
        if (!menu) await page.waitForTimeout(800);   // 펫이 걷는 중이면 잠깐 뒤 다시
    }
    check('desktop 펫 우클릭→메뉴', menu, true);
    check('desktop JS 에러 없음', errs.length === 0, false, errs.slice(0, 2).join(' | '));
    await page.context().close();
}

// ---- B. 모바일(iPhone): 터치 UI·크기·에코 기본 ----
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

// ---- C. 저장된 레이아웃 적용 경로 (localStorage 폴백) ----
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

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok && !r.warnOnly);
console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} PASS${fails.length ? ` · ${fails.length} FAIL` : ''} =====`);
process.exit(fails.length ? 1 : 0);
