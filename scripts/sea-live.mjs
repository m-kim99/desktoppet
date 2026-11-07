// Undersea real-scale review — dive, place the specified seafood directly and shoot from the game viewpoint.
//   node scripts/sea-live.mjs <outDir> [id,id,id]   (defaults to wakame,seacuke,starfish)
// ⚠️ The review lab lies because of its white ambient. The world uses hemiLight (groundColor 0x8fca62), so
// downward-facing surfaces get tinted green and the resting height on the floor differs from the lab — once a model is in,
// always check it here once. (Skipping this for oyster/wakame led to three wrong guesses.)
// ⚠️ Place and shoot **inside the same evaluate** — the submarine keeps moving and the coordinates drift.
import fs from 'fs'; import path from 'path';
const OUT = process.argv[2];
const IDS = (process.argv[3] || 'wakame,seacuke,starfish').split(',');
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 1000, height: 660 }, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8765/world.html?stats=1&hour=13&weather=clear', { waitUntil: 'load' });
await pg.waitForTimeout(9000);
await pg.evaluate(() => { const btn = [...document.querySelectorAll('#world-dock-ui button, #world-dock-ui *')].filter((e) => /🐥|🐕/.test(e.textContent || '')); if (btn[0]) btn[0].click(); });
await pg.evaluate(() => { const d = window.__worldDev, s = d.subState(); if (s && s.x != null) d.tp(s.x + 0.6, s.z + 0.6); });
await pg.waitForTimeout(2500);
console.log('subEnter', await pg.evaluate(() => window.__worldDev.subEnter()));
await pg.waitForTimeout(16000);
const res = await pg.evaluate(async (ids) => {
    const THREE = await import('/libs/three/build/three.module.js');
    const dev = window.__worldDev;
    const p = dev.petPos('chick') || { x: 0, z: 0 };
    const ox = p.x + 0.55, oz = p.z + 0.55;
    const OFF = [[0, 0], [0.32, -0.05], [-0.34, -0.02], [0.04, 0.34]];
    const info = ids.map((id, i) => dev.seaMake(id, 1.5, ox + (OFF[i] || [0, 0])[0], oz + (OFF[i] || [0, 0])[1]));
    const gy = dev.seabedAt(ox, oz);
    const cv = document.createElement('canvas'); cv.width = 560 * 2; cv.height = 560 * 2;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    r.setPixelRatio(2); r.setSize(560, 560, false);
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
    const out = [];
    for (const [d, ey, tag] of [[0.95, 0.30, 'low'], [0.88, 0.56, 'high'], [0.52, 0.26, 'near']]) {
        cam.position.set(ox + d * 0.75, gy + ey, oz + d * 0.75);
        cam.lookAt(ox, gy + 0.05, oz);
        r.render(dev.scene, cam);
        out.push({ tag, png: cv.toDataURL('image/png') });
    }
    r.dispose();
    return { info, gy, ox: +ox.toFixed(2), oz: +oz.toFixed(2), shots: out };
}, IDS);
console.log('seaMake', JSON.stringify(res.info), 'gy', res.gy);
res.shots.forEach((s) => fs.writeFileSync(path.join(OUT, `oyl-${s.tag}.png`), Buffer.from(s.png.split(',')[1], 'base64')));
console.log('errs', errs.slice(0, 3));
await b.close();
