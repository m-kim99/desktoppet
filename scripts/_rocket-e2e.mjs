// 🚀 별똥호 E2E — 탑승→카운트다운→발사→우주→역추진 착륙 전 구간 헤드리스 검증 + 스크린샷.
// world-smoke 하네스 축소판. 임시 스크립트 (커밋 후 유지 여부는 선택).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8897;
const SHOT = process.env.SHOT_DIR || '/tmp';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'application/octet-stream', '.svg': 'image/svg+xml' };
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
const errFilter = (t) => !/VALIDATE_STATUS|favicon|manifest|\/api\/|\/ws|WebSocket|404|sounds\//i.test(t);
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error' && errFilter(m.text())) errs.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);

const st = () => page.evaluate(() => window.__worldDev.rocketState());
const log = (tag, o) => console.log(tag.padEnd(10), JSON.stringify(o));

// 1) 병아리 빙의 → 패드로 tp → 탑승
await page.evaluate(() => {
    [...document.querySelectorAll('[title]')].find((b) => (b.title || '').includes('병아리 조종하기')).click();   // 독 버튼은 div — 서랍이 닫혀 있어도 프로그램 click은 onclick을 태운다
});
await page.waitForTimeout(600);
await page.evaluate(() => { window.__worldDev.tp(2, -9.5); });
await page.waitForTimeout(300);
const deckY = await page.evaluate(() => {
    const p = window.__worldDev;
    p.interact();
    return null;
});
await page.waitForTimeout(400);
log('boarded', await st());
await page.screenshot({ path: path.join(SHOT, 'rk1-countdown.png') });

// 2) 발사까지 대기 (count 5s + ignite 1.15s)
await page.waitForTimeout(6600);
log('liftoff', await st());
await page.screenshot({ path: path.join(SHOT, 'rk2-liftoff.png') });

// 3) 우주 진입 폴링 (상승 ~4s)
let s = null;
for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    s = await st();
    if (s.mode === 'space') break;
}
log('space', s);
await page.waitForTimeout(2500);   // spaceF 만개 + 별 뜨는 시간
log('spaceMid', await st());
await page.screenshot({ path: path.join(SHOT, 'rk3-space.png') });

// 4) 궤도 반 바퀴 지점 한 컷 더 (약 29초)
await page.waitForTimeout(27000);
log('halfLap', await st());
await page.screenshot({ path: path.join(SHOT, 'rk4-space-half.png') });

// 5) 착륙까지 폴링 (남은 궤도 ~29s + 하강 ~12s)
for (let i = 0; i < 300; i++) {   // 랜덤 코스(플라이바이 포함)라 최대 ~150s
    await page.waitForTimeout(500);
    s = await st();
    if (s.mode === 'parked' && !s.riding) break;
}
log('landed', s);
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(SHOT, 'rk5-landed.png') });

// 6) 판정
const who = await page.evaluate(() => window.__worldDev.who());
const ctrl = await page.evaluate(() => window.__worldDev.ctrl());
console.log('possessed:', who, JSON.stringify(ctrl));
console.log('errors:', errs.length ? errs : 'none');
const pass = s && s.mode === 'parked' && !s.riding && errs.length === 0;   // lap 고정 어서션 폐기 — 코스가 랜덤
console.log(pass ? '===== ROCKET E2E PASS =====' : '===== ROCKET E2E FAIL =====');
await browser.close();
server.close();
process.exit(pass ? 0 : 1);
