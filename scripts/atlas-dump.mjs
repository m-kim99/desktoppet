// 카툰 아틀라스(2048×1024 · 256² 셀 32칸)를 PNG로 덤프 — 텍스처가 의도대로 구워졌는지 확인.
//   node scripts/atlas-dump.mjs <outDir>        → <outDir>/atlas.png
// 셀 i는 (i%8, i/8|0) 칸. 조형이 이상할 때 "텍스처 탓인지 조형 탓인지"를 가르는 첫 단추다.
import fs from 'fs'; import path from 'path';
const OUT = process.argv[2];
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 800, height: 600 } });
await pg.goto('http://127.0.0.1:8765/world.html?sealab=1', { waitUntil: 'load' });
await pg.waitForTimeout(4800);
const png = await pg.evaluate(() => {
    const L = window.__sealab;
    let tex = null;
    L.scene.traverse((o) => { if (!tex && o.isMesh && o.material && o.material.map && o.material.map.image && o.material.map.image.width >= 2048) tex = o.material.map; });
    if (!tex) return null;
    const img = tex.image;
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    return cv.toDataURL('image/png');
});
if (!png) { console.log('아틀라스 못 찾음'); }
else { fs.writeFileSync(path.join(OUT, 'atlas.png'), Buffer.from(png.split(',')[1], 'base64')); console.log('ok'); }
await b.close();
