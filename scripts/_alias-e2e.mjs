// 🏷️ 별명 라우팅 E2E — '멍뭉이' 오배달 회귀 방지 (정적 서버)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8924;
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
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('world-pet-aliases', JSON.stringify({ puppy: ['왕왕이'] })); } catch (e) {} });
const page = await ctx.newPage();
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(8000);
const cases = [
    ['멍뭉이는 오늘 하루 어떻게 보낼거야?', 'puppy'],
    ['멍뭉아 산책 가자', 'puppy'],
    ['댕댕이 뭐해', 'puppy'],
    ['예쁜새 굿모닝', 'chick'],
    ['아기닭 놀아줘', 'chick'],
    ['삐약이 보고싶었어', 'chick'],
    ['왕왕이 이리와', 'puppy'],   // KV 사용자 추가 별명
    ['강아지랑 병아리 둘 다 사랑해', 'chick'],   // 둘 다 호명 = 병아리 우선(종전 규칙) + 거들기
];
for (const [t, want] of cases) {
    const got = await page.evaluate((x) => window.__worldDev.routePet(x), t);
    check(`"${t.slice(0, 18)}" → ${want}`, got === want, `got=${got}`);
}
const sticky = await page.evaluate(() => window.__worldDev.routePet('밥 먹었어?'));
check('이름 없음 → sticky/기본', sticky === 'chick' || sticky === 'puppy', String(sticky));
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
