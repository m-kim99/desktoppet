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
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); stored = await page.evaluate(() => window.__worldDev.ringState()); if (stored && stored.stored.length === 2 && !stored.stashing) break; }
check('R7 전체 보관(빙의 없음) — 둘 벗고 알 위 2', !!(stored && stored.stored.length === 2 && !stored.chick && !stored.puppy && stored.stash === 2), JSON.stringify(stored));
await page.evaluate(() => window.__worldDev.ringToggle());
let worn2 = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); worn2 = await page.evaluate(() => window.__worldDev.ringState()); if (worn2 && !worn2.stored.length && !worn2.stashing && worn2.chick) break; }
check('R8 전체 재착용 — 알 비우고 양쪽 착용', !!(worn2 && !worn2.stored.length && worn2.chick && worn2.puppy && worn2.stash === 0), JSON.stringify(worn2));
// 🐥 펫 단위: 병아리로 빙의해 누르면 병아리 것만 보관·재착용 (주인 설계)
await page.evaluate(() => window.__worldDev.possessGo('chick', -11.73, -6.46));
await page.evaluate(() => window.__worldDev.ringToggle());
let solo = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); solo = await page.evaluate(() => window.__worldDev.ringState()); if (solo && solo.stored.length === 1 && !solo.stashing) break; }
check('R9 병아리 단독 보관 — 강아지는 착용 유지', !!(solo && solo.stored.length === 1 && solo.stored[0] === 'chick' && !solo.chick && solo.puppy && solo.stash === 1), JSON.stringify(solo));
await page.evaluate(() => window.__worldDev.ringToggle());
let solo2 = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); solo2 = await page.evaluate(() => window.__worldDev.ringState()); if (solo2 && !solo2.stored.length && !solo2.stashing && solo2.chick) break; }
check('R10 병아리 단독 재착용', !!(solo2 && !solo2.stored.length && solo2.chick && solo2.puppy && solo2.stash === 0), JSON.stringify(solo2));
// 💍 재회식 — 빙의 해제 후 둘 다 보관 → ringReunion → 걸어와 마주 서고 함께 재착용
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
await page.waitForTimeout(800);
await page.evaluate(() => window.__worldDev.ringToggle());   // 빙의 없음 → 둘 다 보관
let st2 = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); st2 = await page.evaluate(() => window.__worldDev.ringState()); if (st2 && st2.stored.length === 2 && !st2.stashing) break; }
await page.evaluate(() => window.__worldDev.ringReunion());
let reu = null;
for (let i = 0; i < 150; i++) { await page.waitForTimeout(500); reu = await page.evaluate(() => window.__worldDev.ringState()); if (reu && !reu.stored.length && !reu.scene && reu.chick) break; }
check('R11 재회식 — 걸어와 함께 재착용', !!(reu && !reu.stored.length && reu.chick && reu.puppy && reu.stash === 0), JSON.stringify(reu));
// ✨ 추억 재생 — 상태 불변(착용 그대로), 씬만 돌았다 끝남
await page.evaluate(() => window.__worldDev.ringReplay());
let rep = null, sawScene = false;
for (let i = 0; i < 150; i++) { await page.waitForTimeout(500); rep = await page.evaluate(() => window.__worldDev.ringState()); if (rep && rep.scene && rep.sceneKind === 'replay') sawScene = true; if (sawScene && rep && !rep.scene) break; }
check('R12 추억 재생 — 씬 완주 + 상태 불변', !!(sawScene && rep && !rep.scene && rep.chick && rep.puppy && !rep.stored.length), JSON.stringify(rep));
// ✨ 보관 중 추억 재생 — 끝나면 보관분까지 둘 다 착용하고 끝난다 (주인 지정)
await page.evaluate(() => window.__worldDev.ringToggle());   // 둘 다 보관
let sb = null;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); sb = await page.evaluate(() => window.__worldDev.ringState()); if (sb && sb.stored.length === 2 && !sb.stashing) break; }
await page.evaluate(() => window.__worldDev.ringReplay());
let rp3 = null, saw3 = false;
for (let i = 0; i < 150; i++) { await page.waitForTimeout(500); rp3 = await page.evaluate(() => window.__worldDev.ringState()); if (rp3 && rp3.scene) saw3 = true; if (saw3 && rp3 && !rp3.scene) break; }
check('R12b 보관 중 리플레이 — 끝엔 둘 다 착용', !!(saw3 && rp3 && !rp3.scene && rp3.chick && rp3.puppy && !rp3.stored.length && rp3.stash === 0), JSON.stringify(rp3));
// 🎮 조종 중 추억 재생 — 씬이 끝나면 조종('player')으로 복귀해야 한다 (안무 중 영구 잠금 버그 회귀 방지)
await page.evaluate(() => window.__worldDev.possessGo('chick', -11.73, -6.46));
await page.evaluate(() => window.__worldDev.ringReplay());
let pr2 = null, saw2 = false;
for (let i = 0; i < 150; i++) { await page.waitForTimeout(500); pr2 = await page.evaluate(() => window.__worldDev.ringState()); if (pr2 && pr2.scene) saw2 = true; if (saw2 && pr2 && !pr2.scene) break; }
await page.waitForTimeout(800);
pr2 = await page.evaluate(() => window.__worldDev.ringState());
const chickRow = pr2 && pr2.pos.find((r) => r[0] === 'chick');
check('R13 조종 중 리플레이 — 끝나면 조종 복귀', !!(saw2 && pr2 && !pr2.scene && chickRow && chickRow[3] === 'player'), JSON.stringify(pr2 && pr2.pos));
check('R6 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
