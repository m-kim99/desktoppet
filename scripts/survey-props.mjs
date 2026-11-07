// Contact sheet of all world props — one representative per type in 3/4 view on a grid + 4 wide-angle shots.
//   node scripts/survey-props.mjs <outDir>
// Framing is computed automatically by identifying prop roots via the VIS (visual footprint) table of world-layout-sweep.mjs.
// Use it to skim low-quality props and pick what to fix. For detailed per-prop review use survey-prop-detail.mjs.
//   node scripts/_survey-sheet.mjs <outDir>
import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const OUT = process.argv[2] || '/tmp';
const PORT = 8947;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const base = url.startsWith('/vrm/') ? REPO : path.join(REPO, 'static');
    const fp = path.normalize(path.join(base, url));
    if (!fp.startsWith(base) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const { PROPS } = await import(`${REPO}/static/js/world-layout.js`);
// One representative per type (the first if there are several of the same type) + up to 2 for trees/palms/rocks
const seen = {}; const targets = [];
for (const p of PROPS) {
    seen[p.type] = (seen[p.type] || 0) + 1;
    const cap = ({ tree: 2, palm: 2, boulder: 2, lamp: 1, vine: 1, portal: 2 })[p.type] ?? 1;
    if (seen[p.type] <= cap) targets.push({ type: p.type, n: seen[p.type], x: p.x, z: p.z, rotY: p.rotY || 0 });
}
// Vehicles · special spots (outside PROPS)
targets.push({ type: 'car', n: 1, x: 2.5, z: -1.15, rotY: 0 }, { type: 'boat', n: 1, x: 2.4, z: 6.95, rotY: -0.4 },
    { type: 'plane', n: 1, x: -3.2, z: 10.05, rotY: 3.14 }, { type: 'balloon', n: 1, x: 14.0, z: 7.25, rotY: 0 },
    { type: 'ferry', n: 1, x: 0.94, z: 7.77, rotY: 0 }, { type: 'rocketpad', n: 1, x: 2, z: -9.5, rotY: 0 });

const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/404|favicon|\/api\/|ws|sounds\//i.test(m.text())) errs.push(m.text()); });
await pg.goto(`http://127.0.0.1:${PORT}/world.html?stats=1&hour=13&weather=clear`, { waitUntil: 'load' });
await pg.waitForTimeout(9000);

// Send the controlled pet far from the house to release the roof cutaway (proximity transparency) and let it settle
await pg.evaluate(() => window.__worldDev.tp(-10.7, -4.7));
await pg.waitForTimeout(2500);

// ---- Wide-angle overview, 4 directions ----
const wide = await pg.evaluate(async () => {
    const THREE = await import('/libs/three/build/three.module.js');
    const dev = window.__worldDev;
    const W = 1000, H = 640;
    const cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    r.setPixelRatio(2); r.setSize(W, H, false);
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    const cam = new THREE.PerspectiveCamera(45, W / H, 0.05, 400);
    const out = [];
    const views = [
        ['본섬 남서 항공', 9, 7.5, 11, 0, 0.3, 0],
        ['본섬 북동 항공', -8, 7, -10, 0, 0.3, 0],
        ['본섬 저각 남', 1, 1.9, 9.5, 0.5, 0.8, 1],
        ['군도 전체 상공', 4, 24, 22, 0, 0, 1],
    ];
    for (const [label, cx, cy, cz, tx, ty, tz] of views) {
        const fog = dev.scene.fog;
        if (label.includes('군도')) dev.scene.fog = null;   // Distance fog washes the archipelago panorama out to white
        cam.position.set(cx, cy, cz); cam.lookAt(tx, ty, tz);
        r.render(dev.scene, cam);
        dev.scene.fog = fog;
        out.push({ label, png: cv.toDataURL('image/png') });
    }
    r.dispose();
    return out;
});
wide.forEach((w, i) => fs.writeFileSync(path.join(OUT, `wide-${i}.png`), Buffer.from(w.png.split(',')[1], 'base64')));
console.log('wide:', wide.map((w) => w.label).join(' / '));

// ---- Per-type close-up contact sheet ----
const sheets = await pg.evaluate(async (targets) => {
    const THREE = await import('/libs/three/build/three.module.js');
    const dev = window.__worldDev;
    const TILE = 420, COLS = 3, ROWS = 4, PER = COLS * ROWS;
    const rc = document.createElement('canvas'); rc.width = rc.height = TILE * 2;
    const r = new THREE.WebGLRenderer({ canvas: rc, antialias: true });
    r.setPixelRatio(2); r.setSize(TILE, TILE, false);
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 300);
    // Finding prop roots: the build loop sets obj.position = (p.x, terrainHeight, p.z), so the coordinates are the fingerprint
    const roots = [];
    dev.scene.traverse((o) => { if (o.parent && o.children.length) roots.push(o); });
    const boxOf = (t) => {
        const box = new THREE.Box3();
        let found = 0;
        for (const o of roots) {
            if (Math.abs(o.position.x - t.x) > 0.03 || Math.abs(o.position.z - t.z) > 0.03) continue;
            const b = new THREE.Box3().setFromObject(o);
            if (b.isEmpty()) continue;
            const s = b.getSize(new THREE.Vector3());
            if (s.y < 0.02 && s.x > 0.25) continue;      // Exclude shadow blob decals
            box.union(b); found++;
        }
        return found ? box : null;
    };
    const sheets = []; let sheet = null, sctx = null;
    const labels = [];
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (i % PER === 0) {
            sheet = document.createElement('canvas');
            sheet.width = TILE * COLS; sheet.height = TILE * ROWS;
            sctx = sheet.getContext('2d');
            sctx.fillStyle = '#11151a'; sctx.fillRect(0, 0, sheet.width, sheet.height);
            sheets.push(sheet);
        }
        const gy = dev.groundAt(t.x, t.z);
        const box = boxOf(t);
        const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(0.8, 0.8, 0.8);
        const ctr = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(t.x, gy + 0.4, t.z);
        const span = Math.max(size.x, size.z, size.y);
        const dist = Math.min(9, Math.max(1.1, span * 1.9));
        const ang = (t.rotY || 0) + Math.PI * 0.8;   // Twist slightly off the front for a 3/4 view
        cam.position.set(ctr.x + Math.sin(ang) * dist, ctr.y + dist * 0.42, ctr.z + Math.cos(ang) * dist);
        cam.lookAt(ctr.x, ctr.y, ctr.z);
        r.render(dev.scene, cam);
        const col = (i % PER) % COLS, row = Math.floor((i % PER) / COLS);
        sctx.drawImage(rc, col * TILE, row * TILE, TILE, TILE);
        sctx.font = 'bold 19px monospace';
        sctx.fillStyle = 'rgba(0,0,0,0.72)'; sctx.fillRect(col * TILE + 6, row * TILE + 6, 200, 26);
        sctx.fillStyle = box ? '#7cf' : '#f97'; sctx.fillText(`${t.type}${t.n > 1 ? '-' + t.n : ''} ${span.toFixed(2)}m${box ? '' : ' ?'}`, col * TILE + 12, row * TILE + 25);
        labels.push(t.type);
    }
    r.dispose();
    return { pngs: sheets.map((s) => s.toDataURL('image/png')), labels };
}, targets);
sheets.pngs.forEach((d, i) => fs.writeFileSync(path.join(OUT, `sheet-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
console.log('sheets:', sheets.pngs.length, 'tiles:', sheets.labels.length);
console.log('pageerrors:', errs.slice(0, 5));
await b.close(); server.close();
