// 🌸 동산 소풍 E2E — 본섬→새 다리 도보→벤치 착석(듀오)→타이머 하차 (정적 서버)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8928; const OUT = process.argv[2] || '/tmp/meadow.png';
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
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
// 결정화: 강아지를 동산에 한가하게 세워둔다 (자율활동이 선점했으면 합류 게이트가 막는 건 설계)
await page.evaluate(() => window.__worldDev.possessGo('puppy', -2.6, -12.0));
await page.waitForTimeout(400);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
await page.waitForTimeout(900);
const go = await page.evaluate(() => window.__worldDev.meadowGo(14000));
check('M1 소풍 시작(강제)', go === true, String(go));
let st = null;
for (let i = 0; i < 300; i++) {   // 본섬→동산 다리 도보 — 넉넉히 2분
    await page.waitForTimeout(400);
    st = await page.evaluate(() => window.__worldDev.meadowState());
    if (st && st.find((r) => r[0] === 'chick' && r[1] && r[2] === 'lying')) break;
}
check('M2 병아리 — 다리 건너 벤치 착석', !!(st && st.find((r) => r[0] === 'chick' && r[1] && r[2] === 'lying')), JSON.stringify(st));
const pos = await page.evaluate(() => window.__worldDev.ringState().pos);
const cp = pos.find((r) => r[0] === 'chick');
check('M3 착석 좌표 = 동산 벤치', !!cp && Math.hypot(cp[1] + 3.1, cp[2] + 12.8) < 0.7, JSON.stringify(pos));
let duo = null;
for (let i = 0; i < 60; i++) {   // 절친 합류(한가했다면)
    await page.waitForTimeout(400);
    duo = await page.evaluate(() => window.__worldDev.meadowState());
    if (duo && duo.every((r) => r[1])) break;
}
check('M4 절친 합류 — 나란히 착석', !!(duo && duo.every((r) => r[1])), JSON.stringify(duo));
// 📸 나란히 앉은 순간
const shots = await page.evaluate(async () => {
    const THREE = await import('/libs/three/build/three.module.js');
    const dev = window.__worldDev;
    const dl = new THREE.DirectionalLight(0xfff4e0, 2.2); dl.position.set(4, 7, 3); dev.scene.add(dl); dev.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const cv = document.createElement('canvas'); cv.width = 700; cv.height = 700;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); r.setPixelRatio(1); r.setSize(700, 700, false);
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    const out = [];
    for (const [ox, oy, oz] of [[0, 1.5, -2.2], [1.6, 1.2, -1.2]]) {
        cam.position.set(-3.1 + ox, 0.78 + oy, -12.8 + oz);
        cam.lookAt(-3.1, 1.08, -12.8);
        r.render(dev.scene, cam); out.push(cv.toDataURL('image/png'));
    }
    r.dispose(); return out;
});
shots.forEach((d, i) => fs.writeFileSync(OUT.replace('.png', `-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
let off = null;
for (let i = 0; i < 60; i++) {   // 타이머(14s) 하차
    await page.waitForTimeout(500);
    off = await page.evaluate(() => window.__worldDev.meadowState());
    if (off && !off.find((r) => r[0] === 'chick')[1]) break;
}
check('M5 타이머 하차(병아리)', !!(off && !off.find((r) => r[0] === 'chick')[1]), JSON.stringify(off));
// 🎮 조종 착석 — 'player' 유지(입력 생존) · 방향키 = 일어나기
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
await page.waitForTimeout(600);
for (let i = 0; i < 10; i++) { const ok = await page.evaluate(() => window.__worldDev.possessGo('chick', -3.1, -12.2, 0)); if (ok) break; await page.waitForTimeout(400); }
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));
let sit = null;
for (let i = 0; i < 30; i++) { await page.waitForTimeout(400); sit = await page.evaluate(() => ({ m: window.__worldDev.meadowState(), pos: window.__worldDev.ringState().pos })); if (sit.m.find((r) => r[0] === 'chick' && r[1] && r[2] === 'lying')) break; }
const chRow = sit && sit.pos.find((r) => r[0] === 'chick');
check('M7 조종 착석 — ai state = player 유지', !!(chRow && chRow[3] === 'player' && sit.m.find((r) => r[0] === 'chick' && r[1])), JSON.stringify(sit && sit.pos));
await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' })), 300); });
let up = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(400); up = await page.evaluate(() => window.__worldDev.meadowState()); if (!up.find((r) => r[0] === 'chick')[1]) break; }
check('M8 방향키 = 일어나기', !!(up && !up.find((r) => r[0] === 'chick')[1]), JSON.stringify(up));
// 📞 벤치에서 전화 — 친구가 옆자리에 앉는다 (완전히 일어선 뒤 재착석 — 기상 트윈 중 ⌘는 삼켜진다)
await page.waitForTimeout(1500);
for (let t = 0; t < 5; t++) {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));
    let ok = false;
    for (let i = 0; i < 14; i++) { await page.waitForTimeout(400); const st2 = await page.evaluate(() => window.__worldDev.meadowState()); if (st2.find((r) => r[0] === 'chick' && r[1] && r[2] === 'lying')) { ok = true; break; } }
    if (ok) break;
}
await page.evaluate(() => window.__worldDev.callFriend());
let both = null;
for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); both = await page.evaluate(() => window.__worldDev.meadowState()); if (both.every((r) => r[1] && r[2] === 'lying')) break; }
check('M9 벤치 전화 — 절친 옆자리 착석', !!(both && both.every((r) => r[1])), JSON.stringify(both));
check('M6 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
