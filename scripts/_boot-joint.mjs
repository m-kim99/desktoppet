// 장화 통↔발 이음매 접사 — 랩 카메라를 이음매에 직접 맞춘다
import fs from 'fs'; import path from 'path';
const OUT = process.argv[2];
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8765/world.html?sealab=1', { waitUntil: 'load' });
await pg.waitForTimeout(4600);
const shots = await pg.evaluate(async () => {
    const THREE = await import('/libs/three/build/three.module.js');
    const L = window.__sealab, cell = L.cellOf.boot;
    const holder = L.scene.children.find((o) => o.isGroup && Math.abs(o.position.x - cell.x) < 0.01 && Math.abs(o.position.y - cell.y) < 0.01);
    for (const o of L.scene.children) if (o !== holder) o.visible = false;
    const box = new THREE.Box3().setFromObject(holder);
    const sz = box.getSize(new THREE.Vector3()), mn = box.min;
    // 이음매 ≈ 발 위·통 아래 = 전체 높이의 30% 지점
    const c = new THREE.Vector3(box.min.x + sz.x * 0.5, mn.y + sz.y * 0.30, box.min.z + sz.z * 0.5);
    const d = Math.max(sz.x, sz.z) * 1.25;
    const out = [];
    for (const [tag, ax, ay, az] of [['side', 1, 0.28, 0.05], ['q34', 0.85, 0.30, 0.75], ['front', 0.06, 0.26, 1], ['rear', 0.10, 0.26, -1]]) {
        L.camera.position.set(c.x + ax * d, c.y + ay * d, c.z + az * d);
        L.camera.lookAt(c.x, c.y, c.z);
        L.renderer.render(L.scene, L.camera);
        out.push({ tag, png: L.renderer.domElement.toDataURL('image/png') });
    }
    return out;
});
shots.forEach((s) => fs.writeFileSync(path.join(OUT, `j-${s.tag}.png`), Buffer.from(s.png.split(',')[1], 'base64')));
console.log('errs', errs.slice(0, 2));
await b.close();
