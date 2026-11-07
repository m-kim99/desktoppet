// 🔬 Draw audit v2 — every visible drawable + coordinate→prop attribution: reports the unmerged bucket as "which type
//    eats how many draws". For picking targets of the 2nd bake pass (read-only probe).
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
import { PROPS, ISLANDS, HOUSE } from '../static/js/world-layout.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8927;
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
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(10000);
const rows = await page.evaluate(() => {
    const scene = window.__worldDev.scene;
    const visChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const v = new window.__worldDev.camera.position.constructor();
    const out = [];
    scene.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
        if (!visChain(o)) return;
        let nm = '';
        for (let p = o; p; p = p.parent) { if (p.name) { nm = p.name; break; } }
        o.getWorldPosition(v);
        out.push({
            kind: o.isInstancedMesh ? 'inst' : o.isPoints ? 'points' : o.isLine ? 'line' : o.isSprite ? 'sprite' : 'mesh',
            nm, x: +v.x.toFixed(1), y: +v.y.toFixed(1), z: +v.z.toFixed(1),
            mat: o.material && !Array.isArray(o.material) ? o.material.uuid.slice(0, 8) : 'multi',
            sig: o.geometry ? Object.keys(o.geometry.attributes).sort().join(',') + (o.geometry.index ? '+i' : '') : '',
        });
    });
    return out;
});
await browser.close(); server.close();

const PET = /chick|puppy|beak|wing|foot|eye|highlight|nose|tongue|ear|tail|bff/i;
const attr = (r) => {
    if (r.nm && PET.test(r.nm)) return '🐾펫';
    if (r.y > 8) return '🚀우주권';
    let best = null, bd = 1e9;
    for (const p of PROPS) {
        const d = Math.hypot(r.x - p.x, r.z - p.z);
        if (d < bd) { bd = d; best = p; }
    }
    if (best && bd <= (best.r || 0.4) + 0.8) return best.type;
    if (Math.hypot(r.x - HOUSE.x, r.z - HOUSE.z) < 2.2) return 'house권';
    let isl = null, id2 = 1e9;
    for (let i = 0; i < ISLANDS.length; i++) {
        const d = Math.hypot(r.x - ISLANDS[i].x, r.z - ISLANDS[i].z);
        if (d < id2) { id2 = d; isl = i; }
    }
    return id2 < (ISLANDS[isl].r + 1.5) ? `섬${isl}바닥/기타` : '바다/하늘';
};
console.log(`보이는 드로어블 총 ${rows.length}개 (프러스텀 무시 상한치)\n== 병합 누락 버킷 → 타입 귀속 ==`);
const buckets = new Map();
for (const r of rows) {
    if (r.kind !== 'mesh' || r.mat === 'multi') continue;
    const k = r.mat + '|' + r.sig;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
}
const savings = new Map();
for (const [, v] of buckets) {
    if (v.length < 2) continue;
    const types = [...new Set(v.map(attr))];
    if (types.some((t) => t === '🐾펫')) continue;   // Pets must not be merged
    const label = types.slice(0, 4).join('+');
    savings.set(label, (savings.get(label) || 0) + v.length - 1);
}
let total = 0;
for (const [label, n] of [...savings.entries()].sort((a, b) => b[1] - a[1])) {
    total += n;
    console.log(`  회수 ${String(n).padStart(3)}장  ← ${label}`);
}
console.log(`  (펫 제외 이론 회수 총 ${total}장)\n== 전체 소비처 상위 25 (타입별 드로어블 수) ==`);
const byType = new Map();
for (const r of rows) { const t = attr(r); byType.set(t, (byType.get(t) || 0) + 1); }
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${String(n).padStart(3)}장  ${t}`);
