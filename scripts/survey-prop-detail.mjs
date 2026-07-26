// 지정 프롭만 3각도 접사 — survey-props.mjs로 고른 대상을 자세히 본다.
//   node scripts/survey-prop-detail.mjs <outDir> "garden,library,piano"
//   type:n 으로 같은 타입의 n번째 지정 가능 (예: portal:2)
// 3번째 칸은 눈높이 — 두께 0인 판·떠 있는 부품은 여기서만 드러난다.
import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const OUT = process.argv[2] || '/tmp';
const WANT = (process.argv[3] || '').split(',').filter(Boolean);
const PORT = 8948;
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
const EXTRA = { car: { x: 2.5, z: -1.15, rotY: 0 }, boat: { x: 2.4, z: 6.95, rotY: -0.4 }, plane: { x: -3.2, z: 10.05, rotY: 3.14 }, balloon: { x: 14.0, z: 7.25, rotY: 0 }, ferry: { x: 0.94, z: 7.77, rotY: 0 }, rocketpad: { x: 2, z: -9.5, rotY: 0 } };
const seen = {}; const targets = [];
for (const w of WANT) {
    const [type, nStr] = w.split(':');
    const n = Number(nStr || 1);
    if (EXTRA[type]) { targets.push({ type, n: 1, ...EXTRA[type] }); continue; }
    const list = PROPS.filter((p) => p.type === type);
    const p = list[n - 1];
    if (!p) { console.log('?? 없는 타입/번호:', w); continue; }
    targets.push({ type, n, x: p.x, z: p.z, rotY: p.rotY || 0 });
}

const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`http://127.0.0.1:${PORT}/world.html?stats=1&hour=13&weather=clear`, { waitUntil: 'load' });
await pg.waitForTimeout(9000);
await pg.evaluate(() => window.__worldDev.tp(-10.7, -4.7));
await pg.waitForTimeout(2000);

const VIS = { garden: 1.0, coffee: 0.62, food: 0.62, library: 0.8, piano: 0.5, fountain: 0.72, photoboard: 0.45, fence: 0.72, hammock: 0.8, swing: 0.62, seesaw: 0.7, gym: 1.05, trampoline: 0.77, vine: 0.32, fruitbasket: 0.26, pecktree: 0.6, well: 0.62, capsule: 0.4, monument: 0.5, cave: 1.0, lookout: 1.0, sunbed: 0.55, palm: 0.5, sandcastle: 0.45, tree: 0.5, boulder: 0.55, house: 2.4, pond: 0.95, mailbox: 0.22, radio: 0.3, bowl: 0.3, lamp: 0.2, flowerbasket: 0.25, hugspot: 0.3, digsite: 0.7, portal: 0.45, car: 0.72, boat: 0.6, plane: 0.75, balloon: 0.8, ferry: 0.95, rocketpad: 2.05, bonfire: 0.42, kitchen: 0.62, icebox: 0.3, scarecrow: 0.28, compost: 0.32 };   // world-layout-sweep.mjs와 같은 표 — 프롭 루트 식별의 기대 크기
for (const t of targets) t.expect = (VIS[t.type] ?? 0.4) * 2;

const res = await pg.evaluate(async (targets) => {
    const THREE = await import('/libs/three/build/three.module.js');
    const dev = window.__worldDev;
    // 지붕 컷어웨이 강제 해제 — 근접 투명은 기능이지만 검수 샷에선 실루엣을 지운다
    dev.scene.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.roofFade && o.material) { o.material.opacity = 1; o.material.transparent = false; }
    });
    const TILE = 430, COLS = 3, ROWS = 4;
    const rc = document.createElement('canvas'); rc.width = rc.height = TILE * 2;
    const r = new THREE.WebGLRenderer({ canvas: rc, antialias: true });
    r.setPixelRatio(2); r.setSize(TILE, TILE, false);
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 300);
    const roots = [];
    dev.scene.traverse((o) => { if (o.parent && o.children.length) roots.push(o); });
    // 프롭 루트 = 좌표가 지문(빌드 루프가 obj.position에 p.x/p.z를 심는다). 원점(광장 중앙) 같은
    // 곳은 바다·포장·씬까지 같은 좌표로 걸리므로, 레이아웃 스윕의 시각 풋프린트(2×VIS)에
    // 가장 가까운 박스를 고른다 — '가장 큰 것'은 광장 포장을, '가장 작은 것'은 부품을 집는다.
    const boxOf = (t, expect) => {
        let best = null, bestErr = 1e9;
        for (const o of roots) {
            if (Math.abs(o.position.x - t.x) > 0.05 || Math.abs(o.position.z - t.z) > 0.05) continue;
            if (o.type === 'Sprite' || o.isPoints) continue;
            const bb = new THREE.Box3().setFromObject(o);
            if (bb.isEmpty()) continue;
            const s = bb.getSize(new THREE.Vector3());
            if (s.x > 7 || s.z > 7 || s.y > 7) continue;   // 바다·지면·돔 같은 거대 노드 배제
            if (s.y < 0.02 && s.x > 0.25) continue;        // 그림자 블롭 데칼 배제
            const err = Math.abs(Math.max(s.x, s.z) - expect);
            if (err < bestErr) { bestErr = err; best = bb; }
        }
        return best;
    };
    const sheets = []; let sheet = null, sctx = null;
    const notes = [];
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (i % ROWS === 0) {
            sheet = document.createElement('canvas');
            sheet.width = TILE * COLS; sheet.height = TILE * ROWS;
            sctx = sheet.getContext('2d');
            sctx.fillStyle = '#11151a'; sctx.fillRect(0, 0, sheet.width, sheet.height);
            sheets.push(sheet);
        }
        const live = dev.prop(`${t.type}-${t.n}`);      // 공사모드로 이사했을 수 있다 — 실좌표 우선
        if (live) { t.x = live.x; t.z = live.z; }
        const gy = dev.groundAt(t.x, t.z);
        const box = boxOf(t, t.expect);
        const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(0.8, 0.8, 0.8);
        const ctr = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(t.x, gy + 0.4, t.z);
        const span = Math.max(size.x, size.z, size.y);
        const dist = Math.min(9, Math.max(0.95, span * 1.75));
        notes.push({ type: t.type, span: +span.toFixed(2), size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)] });
        const row = i % ROWS;
        [0.0, 0.66, 1.33].forEach((k, c) => {
            const ang = (t.rotY || 0) + Math.PI * (0.15 + k);
            const el = c === 2 ? 0.12 : 0.4;                 // 3번째는 눈높이 (실루엣 확인)
            cam.position.set(ctr.x + Math.sin(ang) * dist, ctr.y + dist * el, ctr.z + Math.cos(ang) * dist);
            cam.lookAt(ctr.x, ctr.y, ctr.z);
            r.render(dev.scene, cam);
            sctx.drawImage(rc, c * TILE, row * TILE, TILE, TILE);
            if (c === 0) {
                sctx.font = 'bold 19px monospace';
                sctx.fillStyle = 'rgba(0,0,0,0.72)'; sctx.fillRect(c * TILE + 6, row * TILE + 6, 240, 26);
                sctx.fillStyle = box ? '#7cf' : '#f97';
                sctx.fillText(`${t.type}${t.n > 1 ? '-' + t.n : ''} ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`, c * TILE + 12, row * TILE + 25);
            }
        });
    }
    r.dispose();
    return { pngs: sheets.map((s) => s.toDataURL('image/png')), notes };
}, targets);
res.pngs.forEach((d, i) => fs.writeFileSync(path.join(OUT, `detail-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
console.log(res.notes.map((n) => `${n.type} ${n.size.join('×')}`).join('  |  '));
console.log('sheets:', res.pngs.length, 'pageerrors:', errs.slice(0, 3));
await b.close(); server.close();
