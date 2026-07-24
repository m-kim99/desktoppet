import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const SP = '/private/tmp/claude-501/-Users-mini-Downloads-super-agent-party-main/0572baa5-322f-44b8-9b23-885f11fdafa9/scratchpad';
const OUT = process.argv[2] || `${SP}/dish-lab.png`;
const PORT = 8921;
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
const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/world.html?dishlab=1`, { waitUntil: 'load' });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
    const L = window.__foodlab; if (!L) return 'no lab';
    L.controls.target.set(2.3, 19.2, 0); L.camera.position.set(2.3, 22.6, 9.4); L.controls.update();
    L.renderer.render(L.scene, L.camera);
    let n = 0; L.scene.traverse((o) => { if (o.isMesh && o.position.y > 14) n++; });
    return 'meshes(y>14)=' + n;
});
await page.waitForTimeout(200);
await page.screenshot({ path: OUT });
console.log('evaluate:', r); console.log('pageerrors:', errs.slice(0, 5)); console.log('saved:', OUT);
await browser.close(); server.close();
