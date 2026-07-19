// 푸드 랩 헤드리스 샷 — world.html?foodlab 을 띄워 9종 온전 모델 격자를 PNG로.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const REPO = '/Users/mini/Downloads/super-agent-party-main';
const OUT = process.argv[2] || '/private/tmp/claude-501/-Users-mini-Downloads-super-agent-party-main/0572baa5-322f-44b8-9b23-885f11fdafa9/scratchpad/food-lab.png';
const PORT = 8898;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
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
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?foodlab=1`, { waitUntil: 'load' });
await page.waitForTimeout(2800);
const r = await page.evaluate(() => {
    const L = window.__foodlab; if (!L) return 'no __foodlab';
    L.controls.target.set(2.3, 18.8, 0); L.camera.position.set(2.3, 18.8, 8.4); L.controls.update();
    L.renderer.render(L.scene, L.camera);
    // 병합 실패(보이지 않는 음식) 감지: foodlab이 scene에 추가한 Mesh 수 (9×3=27 기대)
    let meshes = 0; L.scene.traverse((o) => { if (o.isMesh && o.geometry && o.position.y > 15) meshes++; });
    return 'visible food meshes(y>15)=' + meshes + ' (expect 27)';
});
await page.waitForTimeout(250);
await page.screenshot({ path: OUT });
console.log('evaluate:', r);
console.log('pageerrors:', errs.slice(0, 8));
console.log('saved:', OUT);
await browser.close(); server.close();
