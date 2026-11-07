// 🗺️ World catalog E2E — do islands, key objects and systems make it into the generated data list, and does it ride along in the real chat request
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8933;
const OUT = process.argv[2] || '';   // Path to dump the raw catalog (optional)
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
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
let sent = null;
await page.route('**/api/world_chat', async (route) => {
    sent = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '테스트 삐약!' }) });
});
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
const cat = await page.evaluate(() => window.__worldDev.catalog());
if (OUT) fs.writeFileSync(OUT, cat);
const must = ['본섬', '놀이터섬', '추억의 섬', '모험의 섬', '휴양지 모래섬', '농장 섬', '병아리 동산', '우정반지 둥지', '수박 덩굴', '모닥불', '꼬마 낚시 의자', '동산 벤치', '로켓', '이불'];
const missing = must.filter((k) => !cat.includes(k));
check('C1 카탈로그에 섬 7개·주요 사물·시스템', missing.length === 0, missing.length ? '누락: ' + missing.join(',') : `${cat.length}자`);
check('C2 잡동사니 제외(울타리·바위)', !/울타리|바위/.test(cat), '');
// Real chat send path — type into the input box and send
await page.evaluate(() => {
    const ta = [...document.querySelectorAll('input,textarea')].find((t) => /펫에게/.test(t.placeholder || ''));
    ta.value = '안녕'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '보내기');
    btn.click();
});
for (let i = 0; i < 20 && !sent; i++) await page.waitForTimeout(250);
check('C3 채팅 요청에 catalog 동봉', !!(sent && typeof sent.catalog === 'string' && sent.catalog.includes('본섬') && sent.catalog.includes('이불')), sent ? Object.keys(sent).join(',') : '요청 없음');
check('C4 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
