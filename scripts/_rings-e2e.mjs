// 💍 우정반지 E2E — 교환식(열림→떠오름→비행→착용→하트) + 멱등 + 리로드 영속 + 스샷 (정적 서버)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8936; const OUT = process.argv[2] || '/tmp/ring.png';
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
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const page = await ctx.newPage();
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
const st0 = await page.evaluate(() => window.__worldDev.ringState());
check('R1 부트 — 미교환·보석함 반지 2', st0 && !st0.exchanged && st0.boxRings === 2, JSON.stringify(st0));
await page.evaluate(() => window.__worldDev.ringGo());
let mid = null;
for (let i = 0; i < 150; i++) {   // 펫 도보 접근 대기(본섬→추억의 섬 다리까지 ~수십 초) → 연출 중간 샷
    await page.waitForTimeout(300);
    mid = await page.evaluate(() => window.__worldDev.ringState());
    if (mid && mid.scene) break;
}
check('R2 교환식 시작(도보 접근 후)', !!(mid && mid.scene), JSON.stringify(mid));
console.log('   scene시작 위치:', JSON.stringify(mid && mid.pos));
await page.waitForTimeout(1700);   // 덮개 열림 + 반지 떠오름 구간
const shoot = async (tag, px, pz, dist, ly) => {
    const shots = await page.evaluate(async ([px, pz, dist, ly]) => {
        const THREE = await import('/libs/three/build/three.module.js');
        const dev = window.__worldDev;
        if (!window.__lit) { window.__lit = 1; const dl = new THREE.DirectionalLight(0xfff4e0, 2.2); dl.position.set(4, 7, 3); dev.scene.add(dl); dev.scene.add(new THREE.AmbientLight(0xffffff, 0.6)); }
        const cv = document.createElement('canvas'); cv.width = 700; cv.height = 700;
        const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); r.setPixelRatio(1); r.setSize(700, 700, false);
        if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
        const out = [];
        for (const [ox, oy, oz] of [[0.3, 0.5, dist], [-dist * 0.8, 0.55, dist * 0.6]]) {
            cam.position.set(px + ox, oy, pz + oz); cam.lookAt(px, ly, pz);
            r.render(dev.scene, cam); out.push(cv.toDataURL('image/png'));
        }
        r.dispose(); return out;
    }, [px, pz, dist, ly]);
    shots.forEach((d, i) => fs.writeFileSync(OUT.replace('.png', `-${tag}-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
};
await shoot('mid', -11.15, -6.0, 1.0, 0.25);   // 연출 중간 — 열린 둥지 + 떠오른 반지
let done = null;
for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(400);
    done = await page.evaluate(() => window.__worldDev.ringState());
    if (done && done.exchanged) break;
}
console.log('   완료 위치:', JSON.stringify(done && done.pos));
check('R3 교환 완료 — 양쪽 착용 + 보석함 비움', !!(done && done.exchanged && done.chick && done.puppy && done.boxRings === 0), JSON.stringify(done));
// 착용 클로즈업 — 세리머니 자리(둥지 양옆)에서 하트 중인 둘
const pr = { x: -11.15, z: -6.0, rotY: -1.14 };
const cy = Math.cos(pr.rotY), sy = Math.sin(pr.rotY);
const W = (lx, lz) => [pr.x + lx * cy + lz * sy, pr.z - lx * sy + lz * cy];
const [ax, az] = W(-0.66, 0.34), [bx, bz] = W(0.66, 0.34);
await shoot('chick', ax, az, 0.85, 0.2);
await shoot('puppy', bx, bz, 0.85, 0.2);
for (let i = 0; i < 20; i++) {   // 세리머니 마무리(덮개 복귀 ~3.2s) 대기
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => window.__worldDev.ringState());
    if (st && !st.scene) break;
}
const again = await page.evaluate(() => { window.__worldDev.ringGo(); return window.__worldDev.ringState(); });
check('R4 재트리거 멱등(교환 후 무시)', !!(again && again.exchanged && !again.scene), JSON.stringify(again));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(9000);
let re = null;
for (let i = 0; i < 10; i++) {   // equip tick(2.5s) 대기
    await page.waitForTimeout(1000);
    re = await page.evaluate(() => window.__worldDev.ringState());
    if (re && re.chick && re.puppy) break;
}
check('R5 리로드 영속 — 다시 착용·둥지는 빈 채', !!(re && re.exchanged && re.chick && re.puppy && re.boxRings === 0), JSON.stringify(re));
// 🪺 보관 토글 — 착용 중 클릭 = 알 위 보관, 다시 클릭 = 재착용
await page.evaluate(() => window.__worldDev.ringToggle());
let stored = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); stored = await page.evaluate(() => window.__worldDev.ringState()); if (stored && stored.stored && !stored.stashing) break; }
check('R7 보관 — 펫 벗고 알 위에 반지 2', !!(stored && stored.stored && !stored.chick && !stored.puppy && stored.stash === 2), JSON.stringify(stored));
await page.evaluate(() => window.__worldDev.ringToggle());
let worn2 = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); worn2 = await page.evaluate(() => window.__worldDev.ringState()); if (worn2 && !worn2.stored && !worn2.stashing && worn2.chick) break; }
check('R8 재착용 — 알 비우고 양쪽 착용', !!(worn2 && !worn2.stored && worn2.chick && worn2.puppy && worn2.stash === 0), JSON.stringify(worn2));
check('R6 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
