// World thermal probe — measures fps · draws · CPU% per state headlessly (no window opens).
//   npm run perf:world
// Scenarios: active (input ongoing) / parked (cursor left still over the canvas) / ambient (no contact) /
//           toast (speech bubble / toast wake — only when the __worldDev hook from ?stats=1 is present).
// An instrumentation tool that records before/after numbers for each optimization step — the pass/fail check belongs to the smoke test.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8898;   // Different port from the smoke test (8899) — avoids collisions when run concurrently
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const base = url.startsWith('/vrm/') ? ROOT : path.join(ROOT, 'static');
    const fp = path.normalize(path.join(base, url));
    if (!fp.startsWith(base) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
});
server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `✗ 포트 ${PORT}가 사용 중이에요 — 다른 프로브/서버를 끄고 다시 실행하세요.` : `✗ 서버 오류: ${e.message}`);
    process.exit(2);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('✗ playwright가 없어요: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

// ps %cpu is a decaying average of recent usage — sample 3 times at the end of each scenario and average (as a metric).
function cpuSample() {
    try {
        const out = execSync("ps -Ao %cpu,args | grep ms-playwright | grep -v grep", { encoding: 'utf8' });
        return out.trim().split('\n').map((l) => parseFloat(l.trim().split(/\s+/)[0]) || 0).reduce((a, b) => a + b, 0);
    } catch { return NaN; }
}
async function cpuAvg(page, n = 3, gapMs = 1500) {
    const vals = [];
    for (let i = 0; i < n; i++) { vals.push(cpuSample()); await page.waitForTimeout(gapMs); }
    const ok = vals.filter((v) => !isNaN(v));
    return ok.length ? (ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(1) : 'n/a';
}
const readStats = (page) => page.evaluate(() => [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /fps · /.test(t)) || '(stats 없음)');
const row = (name, stats, cpu) => console.log(`${name.padEnd(28)} ${String(stats).padEnd(48)} CPU ${cpu}%`);

// --use-angle=metal: headless also renders on the real GPU (Metal) — without it, it falls back to SwiftShader (software),
// giving several hundred % CPU and single-digit fps, making the measurement meaningless.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/world.html?stats=1&weather=clear&hour=14`, { waitUntil: 'load' });
await page.waitForTimeout(7000);   // Let the scene load settle

// ---- A. active: while input keeps coming in (expect: 60fps) ----
{
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
        await page.mouse.move(300 + Math.random() * 600, 250 + Math.random() * 300);
        await page.waitForTimeout(170);
    }
    row('A active(입력 중)', await readStats(page), await cpuAvg(page));
}

// ---- B. parked: cursor left still over the canvas for 16s (expect: drops to 30fps within 12s) ----
{
    await page.mouse.move(640, 430);
    await page.waitForTimeout(16000);
    row('B parked(커서 정지 16s)', await readStats(page), await cpuAvg(page));
}

// ---- C. toast wake: must wake briefly and return soon (expect: 60 right after → 30 at +6s) ----
{
    const hasHook = await page.evaluate(() => !!(window.__worldDev && window.__worldDev.toast));
    if (hasHook) {
        await page.evaluate(() => window.__worldDev.toast('프로브 토스트'));
        await page.waitForTimeout(1200);
        const during = await readStats(page);
        await page.waitForTimeout(5000);
        row('C toast(+1.2s → +6.2s)', `${during}  →  ${await readStats(page)}`, await cpuAvg(page, 2));
    } else {
        console.log('C toast                     (건너뜀 — __worldDev 훅 없음: 수정 전 코드)');
    }
}

// ---- D. ambient: fresh page the mouse has never touched (expect: 30fps floor) ----
{
    const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await p2.goto(`http://127.0.0.1:${PORT}/world.html?stats=1&weather=clear&hour=14`, { waitUntil: 'load' });
    await p2.waitForTimeout(19000);
    row('D ambient(무접촉 19s)', await readStats(p2), await cpuAvg(p2));

    // ---- E. long watching: input 60s+ (expect: 15fps) — reproduced without waiting via the ageInput hook ----
    const hasAge = await p2.evaluate(() => !!(window.__worldDev && window.__worldDev.ageInput));
    if (hasAge) {
        await p2.evaluate(() => window.__worldDev.ageInput(61000));
        await p2.waitForTimeout(2500);
        row('E long-idle(구경 60s+)', await readStats(p2), await cpuAvg(p2, 2));

        // ---- F. unfocused: left open on the side while doing other things (expect: 15fps) ----
        await p2.evaluate(() => window.dispatchEvent(new Event('blur')));
        await p2.waitForTimeout(2500);
        row('F unfocused(블러)', await readStats(p2), await cpuAvg(p2, 2));
        await p2.evaluate(() => window.dispatchEvent(new Event('focus')));
    } else {
        console.log('E/F                         (건너뜀 — ageInput 훅 없음: 수정 전 코드)');
    }
    await p2.context().close();
}

await browser.close();
server.close();
console.log('(CPU%는 headless Chromium 프로세스군 합 — 절대값보다 전/후 비교용)');
