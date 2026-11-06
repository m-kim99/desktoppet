// 🧭 행동 태그 E2E (C0+C1) — goto 목록 자동 생성·요청 동봉·실행(근처 장소/먼 섬)·모래섬 가드·일기 1줄 쿼터
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
import { PROPS } from '../static/js/world-layout.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8934;
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '응! <goto=kitchen>' }) });
});
await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
const dev = (fn, ...args) => page.evaluate(([fn, args]) => window.__worldDev[fn](...args), [fn, args]);
const near = async (name, type, tol) => {
    const prop = PROPS.find((p) => p.type === type);
    const ps = await dev('petWorldPos');
    const me = ps.find((p) => p.n === name);
    return { d: +Math.hypot(me.x - prop.x, me.z - prop.z).toFixed(2), ok: Math.hypot(me.x - prop.x, me.z - prop.z) <= tol };
};
const waitNear = async (name, type, tol, ms) => {
    const t0 = Date.now(); let r = null;
    while (Date.now() - t0 < ms) { r = await near(name, type, tol); if (r.ok) return r; await page.waitForTimeout(700); }
    return r;
};
// G1 goto 목록 자동 생성
const ids = await dev('gotoIds');
const must = ['gardenbench(동산 벤치 — 병아리 동산', 'ringnest(우정반지 둥지 — 추억의 섬', 'kitchen(주방', 'trampoline(트램펄린 — 놀이터섬', 'melonpatch(수박 덩굴 — 농장 섬', 'plaza(광장)', 'friend(절친 옆)'];
const miss = must.filter((k) => !ids.includes(k));
check('G1 goto 목록 자동 생성(C1 장소 포함)', miss.length === 0 && !ids.includes('bonfire('), miss.length ? '누락: ' + miss.join(' | ') : (ids.includes('bonfire(') ? '모래섬 bonfire가 목록에 있음' : `${ids.split('·').length}곳`));
// G2 채팅 요청 동봉 + 실제 답장 경로로 goto 실행
await page.evaluate(() => {
    const ta = [...document.querySelectorAll('input,textarea')].find((t) => /펫에게/.test(t.placeholder || ''));
    ta.value = '주방 가자'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '보내기').click();
});
for (let i = 0; i < 20 && !sent; i++) await page.waitForTimeout(250);
check('G2 채팅 요청에 gotoIds 동봉', !!(sent && typeof sent.gotoIds === 'string' && sent.gotoIds.includes('kitchen(')), sent ? Object.keys(sent).join(',') : '요청 없음');
const g3 = await waitNear('chick', 'kitchen', 1.3, 40000);
check('G3 실제 답장 <goto=kitchen> → 병아리가 주방 곁 도착', g3 && g3.ok, `거리 ${g3 && g3.d}m`);
// G4 먼 섬(동산 벤치) — 다리 경로로 도착
await dev('say', 'puppy', '그래! <goto=gardenbench>');
const g4 = await waitNear('puppy', 'gardenbench', 1.3, 150000);
check('G4 <goto=gardenbench> → 강아지가 동산 벤치 곁 도착(다리 건너)', g4 && g4.ok, `거리 ${g4 && g4.d}m`);
// G5 모래섬 가드 — 목적지 해석이 null, 펫은 섬 위에 남는다
const spot = await dev('gotoSpot', 'chick', 'bonfire');
await dev('say', 'chick', '<goto=bonfire>');
await page.waitForTimeout(5000);
const isl = await dev('islandAt', 'chick');
check('G5 모래섬(다리 없음) goto 가드 — 해석 null·섬 이탈 없음', spot === null && isl >= 0, `spot=${JSON.stringify(spot)} island=${isl}`);
// G6 일기 1줄 쿼터 — 태그로 두 번 눕히면 이벤트는 2개(src:chat), 일기 소재엔 1줄
await dev('say', 'chick', '<mount=hammock>');
await page.waitForTimeout(1500);
await dev('say', 'puppy', '<mount=sunbed>');
await page.waitForTimeout(1500);
const raw = await dev('eventsRaw', 12);
const chatEv = raw.filter((e) => e.src === 'chat' && /누우러/.test(e.text));
const day = await dev('dayEvents');
const inDiary = (day.match(/누우러 갔다/g) || []).length;
check('G6 일기 1줄 쿼터 — 이벤트 2건(src:chat) · 일기 소재 1줄', chatEv.length === 2 && inDiary === 1, `chat이벤트 ${chatEv.length} · 일기 ${inDiary}`);
check('G7 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
