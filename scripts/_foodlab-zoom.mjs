// 특정 음식 확대 샷 — 오므라이스(케첩)·삼각김밥(김 wrap) 근접 확인용.
import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const SP = '/private/tmp/claude-501/-Users-mini-Downloads-super-agent-party-main/0572baa5-322f-44b8-9b23-885f11fdafa9/scratchpad';
const PORT = 8899;
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
await page.goto(`http://127.0.0.1:${PORT}/world.html?foodlab=1`, { waitUntil: 'load' });
await page.waitForTimeout(2800);
// foodlab 좌표: col x=[-3.4,0,3.4], row y=[20.6,18.4,16.2]
const shots = [
    { name: 'toast',   tx: 0, ty: 21.2, cz: 3.0, cy: 21.5 },
    { name: 'gimbap',  tx: 4.6, ty: 19.95, cz: 3.0, cy: 20.3 },
    { name: 'omurice', tx: 0, ty: 19.95, cz: 3.0, cy: 20.5 },
];
for (const s of shots) {
    await page.evaluate((s) => {
        const L = window.__foodlab;
        L.controls.target.set(s.tx, s.ty, 0);
        L.camera.position.set(s.tx, s.cy, s.cz);
        L.controls.update();
        L.renderer.render(L.scene, L.camera);
    }, s);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SP}/food-zoom-${s.name}.png` });
    console.log('saved', s.name);
}
await browser.close(); server.close();
