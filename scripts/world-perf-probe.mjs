// 월드 발열 프로브 — 상태별 fps·draws·CPU%를 headless로 잰다 (창이 뜨지 않는다).
//   npm run perf:world
// 시나리오: active(입력 중) / parked(커서를 캔버스 위에 둔 채 정지) / ambient(무접촉) /
//           toast(말풍선·토스트 웨이크 — ?stats=1 의 __worldDev 훅이 있을 때만).
// 최적화 단계마다 전/후 숫자를 남기는 계측 도구다 — 합격선 검사는 스모크 테스트가 맡는다.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8898;   // 스모크(8899)와 다른 포트 — 동시 실행 충돌 방지
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

// ps의 %cpu는 최근 사용률의 감쇠 평균 — 시나리오 말미에 3회 찍어 평균낸다 (지표용).
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

// --use-angle=metal: headless도 실제 GPU(Metal)로 렌더 — 이게 없으면 SwiftShader(소프트웨어)로
// 떨어져 CPU 수백%에 fps 한 자릿수가 나와 측정이 무의미해진다.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/world.html?stats=1&weather=clear&hour=14`, { waitUntil: 'load' });
await page.waitForTimeout(7000);   // 씬 로드 정착

// ---- A. active: 입력이 계속 들어오는 동안 (기대: 60fps) ----
{
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
        await page.mouse.move(300 + Math.random() * 600, 250 + Math.random() * 300);
        await page.waitForTimeout(170);
    }
    row('A active(입력 중)', await readStats(page), await cpuAvg(page));
}

// ---- B. parked: 커서를 캔버스 위에 둔 채 정지 16초 (기대: 12초 내 30fps 진입) ----
{
    await page.mouse.move(640, 430);
    await page.waitForTimeout(16000);
    row('B parked(커서 정지 16s)', await readStats(page), await cpuAvg(page));
}

// ---- C. toast 웨이크: 잠깐 깨고 곧 복귀해야 한다 (기대: 직후 60 → +6s에 30) ----
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

// ---- D. ambient: 마우스가 창에 닿은 적 없는 새 페이지 (기대: 30fps 바닥) ----
{
    const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await p2.goto(`http://127.0.0.1:${PORT}/world.html?stats=1&weather=clear&hour=14`, { waitUntil: 'load' });
    await p2.waitForTimeout(19000);
    row('D ambient(무접촉 19s)', await readStats(p2), await cpuAvg(p2));

    // ---- E. 장기 구경: 입력 60초+ (기대: 15fps) — ageInput 훅으로 대기 없이 재현 ----
    const hasAge = await p2.evaluate(() => !!(window.__worldDev && window.__worldDev.ageInput));
    if (hasAge) {
        await p2.evaluate(() => window.__worldDev.ageInput(61000));
        await p2.waitForTimeout(2500);
        row('E long-idle(구경 60s+)', await readStats(p2), await cpuAvg(p2, 2));

        // ---- F. 비포커스: 옆에 띄워두고 딴 일 (기대: 15fps) ----
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
