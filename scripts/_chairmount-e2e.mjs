// 🪑 의자 조종 앉기 + 선제대화 반복 금지 E2E (정적 서버 — /api 전부 404라 실데이터·LLM 무오염,
// 채팅만 라우트 스텁). 페이지 A: sit-침대 등록·⌘앉기·높이·착석 중 자율낚시 가드.
// 페이지 C: 자율 착석 예약 중 강아지 ⌘앉기 차단. 페이지 B: 복귀 인사 → 금지 목록 저장 → 재접 시 주입.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8894;
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
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const CHAIR = { x: -1.9, z: 5.35, rotY: -0.341 };   // world-layout.js의 현재 배치
const AP = { x: CHAIR.x + Math.cos(CHAIR.rotY) * 0.6, z: CHAIR.z - Math.sin(CHAIR.rotY) * 0.6 };

// ---------- 페이지 A: sit-침대 등록 + 조종 ⌘앉기 ----------
{
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`, { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    const reg = await page.evaluate(() => window.__worldDev.chairBedState());
    check('A1 sit-침대 등록(fishchair)', !!reg && reg.occ === null, JSON.stringify(reg));
    const pos = await page.evaluate(([x, z]) => window.__worldDev.possessGo('chick', x, z), [AP.x, AP.z]);
    check('A2 병아리 조종 + 의자 곁 이동', pos === true, String(pos));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));
    let st = null;
    for (let i = 0; i < 20; i++) {   // 접근 → 마운트 → 착석까지 대기
        await page.waitForTimeout(500);
        st = await page.evaluate(() => window.__worldDev.chairBedState());
        if (st && st.phase === 'lying') break;
    }
    check('A3 ⌘ 앉기 → 착석 완료', !!st && st.occ === 'chick' && st.phase === 'lying', JSON.stringify(st));
    check('A4 좌석 높이 = lie.y(±0.03)', !!st && st.y !== null && Math.abs(st.y - st.lieY) < 0.03, st && `y=${st.y} lieY=${st.lieY}`);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));   // 조종 해제 — 앉은 채 유지돼야 한다
    await page.waitForTimeout(1200);
    st = await page.evaluate(() => window.__worldDev.chairBedState());
    check('A5 해제 후에도 좌석 높이 유지(합체 금지)', !!st && st.occ === 'chick' && st.y !== null && Math.abs(st.y - st.lieY) < 0.03, JSON.stringify(st));
    // ⚠️ fishChairGo 훅은 첫 줄에서 병아리를 지면으로 텔레포트시킨다(검사 오염) — 높이 검증 뒤에만 부를 것
    const go2 = await page.evaluate(() => window.__worldDev.fishChairGo());
    check('A6 착석 중 자율 낚시 거부(bed 가드)', go2 === false, String(go2));
    check('A7 JS 에러 없음', errs.length === 0, errs[0] || '');
    await page.context().close();
}

// ---------- 페이지 C: 자율 착석 예약 ↔ 조종 앉기 상호 배타 ----------
{
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`, { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    let go = false;
    for (let i = 0; i < 15 && !go; i++) {   // 선행 자율활동(낚시·물놀이 등)이 병아리를 점유했으면 풀릴 때까지 재시도
        go = await page.evaluate(() => { if (window.__worldDev.fishChairState()) window.__worldDev.fishChairEnd(); return window.__worldDev.fishChairGo(); });
        if (!go) await page.waitForTimeout(2000);
    }
    check('C1 의자 명당 AI 낚시 시작', go === true, String(go));
    let st = null;
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(800);
        st = await page.evaluate(() => window.__worldDev.fishChairState());
        if (st && (st.state === 'wait' || st.state === 'cast')) break;
    }
    await page.evaluate(() => window.__worldDev.fishChairBore());
    await page.waitForTimeout(2500);
    st = await page.evaluate(() => window.__worldDev.fishChairState());
    check('C2 자율 의자 착석(_chairSit)', !!st && st.chair === true, JSON.stringify(st));
    let bs = await page.evaluate(() => window.__worldDev.chairBedState());
    check('C3 착석이 침대 occupant 예약', !!bs && bs.occ === 'chick' && bs.phase === null, JSON.stringify(bs));
    const pp = await page.evaluate(([x, z]) => window.__worldDev.possessGo('puppy', x, z), [AP.x, AP.z]);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' })));
    await page.waitForTimeout(2500);
    bs = await page.evaluate(() => window.__worldDev.chairBedState());
    check('C4 강아지 ⌘앉기 차단(예약 유지)', pp === true && !!bs && bs.occ === 'chick' && bs.phase === null, JSON.stringify(bs));
    const end = await page.evaluate(() => window.__worldDev.fishChairEnd());
    bs = await page.evaluate(() => window.__worldDev.chairBedState());
    check('C5 낚시 종료 → 예약 반납', !!end && !!bs && bs.occ === null, JSON.stringify(bs));
    check('C6 JS 에러 없음', errs.length === 0, errs[0] || '');
    await page.context().close();
}

// ---------- 페이지 B: 복귀 인사(재시도 포함 경로) + 반복 금지 목록 왕복 ----------
{
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    await ctx.addInitScript(() => {
        try { if (!localStorage.getItem('world-last-seen')) localStorage.setItem('world-last-seen', String(Date.now() - 4 * 3600000)); } catch (e) {}
    });
    const page = await ctx.newPage();
    const errs = [];
    const chatBodies = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.route('**/api/world_chat', (route) => {
        chatBodies.push(route.request().postData() || '');
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '멍! 오늘도 와줘서 반가워!' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=14&stats=1`, { waitUntil: 'load' });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));   // headless는 hasFocus=false — winFocused 보정
    for (let i = 0; i < 30 && chatBodies.length < 1; i++) await page.waitForTimeout(2000);   // +12초 발사(+재시도 20초 간격 2회까지 커버)
    check('B1 복귀 인사 발사', chatBodies.length >= 1 && chatBodies[0].includes('오랜만에'), `calls=${chatBodies.length}`);
    check('B2 첫 인사엔 금지 목록 없음', chatBodies.length >= 1 && !chatBodies[0].includes('최근에 네가 먼저 건넸던 말'), '');
    let rec = null;
    for (let i = 0; i < 10; i++) {   // 응답 스트림 완료 후 저장까지 폴링
        await page.waitForTimeout(500);
        rec = await page.evaluate(() => localStorage.getItem('world-proactive-recent'));
        if (rec && rec.includes('반가워')) break;
    }
    check('B3 응답이 금지 목록에 저장', !!rec && rec.includes('멍! 오늘도 와줘서 반가워!'), rec || 'null');
    // 재접: last-seen을 다시 과거로 → 두 번째 인사엔 금지 목록이 주입돼야 한다
    await page.evaluate(() => localStorage.setItem('world-last-seen', String(Date.now() - 4 * 3600000)));
    const n1 = chatBodies.length;
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    for (let i = 0; i < 30 && chatBodies.length <= n1; i++) await page.waitForTimeout(2000);
    const second = chatBodies.slice(1).find((b) => b.includes('오랜만에'));
    check('B4 재접 인사에 금지 목록 주입', !!second && second.includes('최근에 네가 먼저 건넸던 말') && second.includes('반가워'), second ? second.slice(0, 40) + '…' : 'no-2nd-call');
    check('B5 JS 에러 없음', errs.length === 0, errs[0] || '');
    await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
