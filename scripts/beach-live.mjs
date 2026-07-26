// 해변 실스케일 검수 — 조개를 모래 위에 스폰해 게임 시점(내려다봄)으로 찍는다.
//   node scripts/beach-live.mjs <outDir>
// 해저용은 sea-live.mjs. 지상 조명(직사광 강함)과 해저 조명은 결과가 꽤 다르다.
import fs from 'fs'; import path from 'path';
const OUT = process.argv[2];
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8765/world.html?stats=1&hour=13&weather=clear', { waitUntil: 'load' });
await pg.waitForTimeout(9000);
const st = await pg.evaluate(() => { const d = window.__worldDev; for (let i = 0; i < 4; i++) d.shellSpawn && d.shellSpawn(); return d.shellState(); });
console.log('shellState:', JSON.stringify(st).slice(0, 300));
const shots = await pg.evaluate(async (list) => {
    const THREE = await import('/libs/three/build/three.module.js');
    const dev = window.__worldDev;
    const W = 520, H = 520;
    const cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    r.setPixelRatio(2); r.setSize(W, H, false);
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
    const out = [];
    for (const s of list) {
        const gy = dev.groundAt(s.x, s.z);
        // 게임 시점: 펫 눈높이보다 조금 위에서 내려다봄 (실제 플레이 각도)
        for (const [d, el] of [[0.42, 0.34], [0.30, 0.62]]) {
            cam.position.set(s.x + d * 0.7, gy + d * el * 2.2, s.z + d * 0.7);
            cam.lookAt(s.x, gy + 0.02, s.z);
            r.render(dev.scene, cam);
            out.push({ id: s.t, png: cv.toDataURL('image/png') });
        }
    }
    r.dispose();
    return out;
}, st.spots);
shots.forEach((s, i) => fs.writeFileSync(path.join(OUT, `live-${i}-${s.id}.png`), Buffer.from(s.png.split(',')[1], 'base64')));
console.log('shots', shots.length, 'errs', errs.slice(0, 3));
await b.close();
