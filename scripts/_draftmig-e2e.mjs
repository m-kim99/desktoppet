// 📔 초안 이관·동기 E2E — 레거시 per-date 키가 '읽기 렌더'만으로 증발하지 않고(10/30 버그 재발 방지)
//    이관 즉시 서버 KV로 올라가 다른 기기에서도 🛟 복구가 뜨는지. 샌드박스 백엔드(WORLD_DATA_DIR) 필수.
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3497;
const SBX = fs.mkdtempSync('/tmp/draftmig-');
const srv = spawn(path.join(ROOT, '.venv/bin/python'), ['-u', 'server.py', '--port', String(PORT)],
    { cwd: ROOT, env: { ...process.env, WORLD_DATA_DIR: SBX }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', (d) => (srvLog += d)); srv.stderr.on('data', (d) => (srvLog += d));
for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/world_kv`); if (r.ok) break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
    if (i === 59) { console.log('server never came up\n' + srvLog.slice(-800)); process.exit(1); }
}
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
let fails = 0;
const check = (n, ok, det = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${det ? ' — ' + det : ''}`); };
const kvDrafts = async () => {
    const kv = (await (await fetch(`http://127.0.0.1:${PORT}/api/world_kv`)).json()).kv || {};
    try { return JSON.parse(kv['world-owner-drafts'] || '{}'); } catch (e) { return {}; }
};

// ── 기기 A: 레거시 키 보유 — '오늘 에디터 먼저' 여는 옛 파괴 시퀀스 그대로
const ctxA = await browser.newContext({ viewport: { width: 1100, height: 700 } });
await ctxA.addInitScript(() => { try { localStorage.setItem('world-owner-draft-2026-10-28', '유실의 밤에 쓴 글이에요'); } catch (e) {} });
const pageA = await ctxA.newPage();
const errs = [];
pageA.on('pageerror', (e) => errs.push(String(e.message)));
await pageA.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await pageA.waitForTimeout(9000);
await pageA.evaluate(() => window.__worldDev.diaryOpen());        // 오늘(열린 날짜) 에디터 렌더 = 이관 트리거
await pageA.waitForTimeout(3000);                                  // 푸시 디바운스 1.2s + 왕복
const a1 = await pageA.evaluate(() => ({
    legacy: localStorage.getItem('world-owner-draft-2026-10-28'),
    map: localStorage.getItem('world-owner-drafts') || '',
}));
check('A1 이관: 레거시 키 흡수 + 맵에 저장(증발 금지)', a1.legacy === null && a1.map.includes('유실의 밤'), JSON.stringify(a1).slice(0, 90));
const kv1 = await kvDrafts();
check('A2 이관 즉시 서버 KV 도착', (kv1['2026-10-28'] || '').includes('유실의 밤'), JSON.stringify(kv1).slice(0, 80));
await pageA.evaluate(() => window.__worldDev.diaryOpen('2026-10-28'));   // 오늘 먼저 → 그 다음 잠긴 날짜 (버그 시퀀스)
await pageA.waitForTimeout(400);
const a3 = await pageA.evaluate(() => document.body.innerText);
check('A3 오늘-먼저 시퀀스 후에도 🛟 복구 생존', a3.includes('저장되지 못한 글') && a3.includes('유실의 밤'), '');
await ctxA.close();

// ── 기기 B: 빈 저장소 — 부트 풀만으로 🛟가 떠야 한다 (기기 교차 복구)
const ctxB = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const pageB = await ctxB.newPage();
pageB.on('pageerror', (e) => errs.push(String(e.message)));
await pageB.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`, { waitUntil: 'load' });
await pageB.waitForTimeout(9000);
await pageB.evaluate(() => window.__worldDev.diaryOpen('2026-10-28'));
await pageB.waitForTimeout(400);
const b1 = await pageB.evaluate(() => document.body.innerText);
check('B1 다른 기기에서 부트 풀만으로 🛟', b1.includes('저장되지 못한 글') && b1.includes('유실의 밤'), '');
// 기기 B가 오늘 초안을 타이핑해도 A의 10-28이 서버에서 안 지워져야(날짜 병합 푸시)
const today = await pageB.evaluate(() => window.__worldDev.diaryOpen());
await pageB.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent !== null);
    ta.value = '오늘의 초안'; ta.dispatchEvent(new Event('input'));
});
await pageB.waitForTimeout(3000);
const kv2 = await kvDrafts();
check('B2 병합 푸시: 두 날짜 공존(통맵 덮어쓰기 금지)', (kv2['2026-10-28'] || '').includes('유실의 밤') && (kv2[today] || '').includes('오늘의 초안'), JSON.stringify(kv2).slice(0, 110));
check('C1 JS 에러 없음', errs.length === 0, errs[0] || '');
await browser.close();
srv.kill(); fs.rmSync(SBX, { recursive: true, force: true });
console.log(fails ? `===== ${fails} FAIL =====` : '===== ALL PASS =====');
process.exit(fails ? 1 : 0);
