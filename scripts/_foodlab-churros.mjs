// 츄러스 3단계(0/1/2입) 확대 샷 — 베어문 단면이 위로 오는지 검수용.
import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const OUT = process.argv[2] || '/tmp/food-churros.png';
const PORT = 8897;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'application/octet-stream', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const base = url.startsWith('/vrm/') ? REPO : path.join(REPO, 'static');
    const fp = path.normalize(path.join(base, url));
    if (!fp.startsWith(base) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 700, height: 560 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?foodlab=1`, { waitUntil: 'load' });
await page.waitForTimeout(2800);
// foodlab 좌표: 츄러스 i=7 → x=4.6 열, y=21.2-2*1.25=18.7 행
const [ty = 19.15, cy = 19.4, cz = 3.2] = process.argv.slice(3).map(Number);
await page.evaluate(([ty, cy, cz]) => {
    const L = window.__foodlab;
    L.renderer.setAnimationLoop(null);
    L.controls.target.set(4.6, ty, 0);
    L.camera.position.set(4.6, cy, cz);
    L.controls.update();
    L.renderer.render(L.scene, L.camera);
}, [ty, cy, cz]);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT });
console.log('pageerrors:', errs.slice(0, 8));
console.log('saved:', OUT);
await browser.close(); server.close();
