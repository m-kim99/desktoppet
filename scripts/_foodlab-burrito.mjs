import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const OUT = process.argv[2] || '/tmp/food-burrito.png';
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
const page = await browser.newPage({ viewport: { width: 900, height: 460 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?foodlab=1`, { waitUntil: 'load' });
await page.waitForTimeout(2800);
const [tx = 1.15, ty = 18.7, cx = -1.5, cy = 18.8, cz = 0.3] = process.argv.slice(3).map(Number);
await page.evaluate(([tx, ty, cx, cy, cz]) => {
    const L = window.__foodlab;
    L.renderer.setAnimationLoop(null);
    L.controls.target.set(tx, ty, 0);
    L.camera.position.set(cx, cy, cz);
    L.controls.update();
    L.renderer.render(L.scene, L.camera);
}, [tx, ty, cx, cy, cz]);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT });
console.log('pageerrors:', errs.slice(0, 8));
console.log('saved:', OUT);
await browser.close(); server.close();
