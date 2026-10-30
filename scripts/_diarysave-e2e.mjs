// 📔 일기 저장 UX E2E — 실패 모달(닫기 버튼) + 잠긴 날짜 draft 복구 (정적 서버 = POST 실패 환경)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8925;
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
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
await ctx.addInitScript(() => { try { localStorage.setItem('world-owner-draft-2026-10-28', '유실 복구 테스트 글이에요'); } catch (e) {} });
const page = await ctx.newPage();
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
// D1: 오늘 일기 저장 실패 → 닫기 버튼 있는 모달
await page.evaluate(() => window.__worldDev.diaryOpen());
await page.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent !== null);
    if (ta) { ta.value = '저장 실패 경로 테스트'; ta.dispatchEvent(new Event('input')); }
    const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && b.textContent.trim().startsWith('💾'));
    if (btn) btn.click();
});
await page.waitForTimeout(4500);   // 재시도 1회(1.4s) 포함
const d1 = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('div')].find((el) => el.style.zIndex === '260' && el.style.display !== 'none');
    return dlg ? { text: dlg.textContent.slice(0, 40), close: !!([...dlg.querySelectorAll('button')].find((b) => b.textContent === '닫기')) } : null;
});
check('D1 저장 실패 모달 + 닫기 버튼', !!(d1 && d1.text.includes('실패') && d1.close), JSON.stringify(d1));
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '닫기'); if (b) b.click(); });
// D2: 임시저장 생존 (실패했으니 draft 유지)
const draftKept = await page.evaluate(() => (localStorage.getItem('world-owner-draft-' + new Date(Date.now() - 6 * 3600000).toLocaleDateString('sv-SE')) || '').includes('테스트') || Object.keys(localStorage).some((k) => k.startsWith('world-owner-draft-') && (localStorage.getItem(k) || '').includes('저장 실패 경로')));
check('D2 실패 시 임시저장 유지', draftKept, '');
// D3: 잠긴 과거 날짜(10/28)의 draft 복구 UI
await page.evaluate(() => window.__worldDev.diaryOpen('2026-10-28'));
await page.waitForTimeout(400);
const d3 = await page.evaluate(() => {
    const body = document.body.innerText;
    return { note: body.includes('저장되지 못한 글'), text: body.includes('유실 복구 테스트'), btn: !!([...document.querySelectorAll('button')].find((b) => b.textContent.includes('그날 일기로 저장'))) };
});
check('D3 잠긴 날짜 draft 복구 UI', !!(d3.note && d3.text && d3.btn), JSON.stringify(d3));
check('D4 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
