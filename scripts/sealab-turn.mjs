// 검수 랩(?sealab=1) 항목 하나를 8방위로 촬영 — 조형 리뷰의 기본 도구.
//   node scripts/sealab-turn.mjs <outDir> <id> [dist]
//   id = 어종/조개/해산물 셀 키 (oyster · starfish · seacuke · wakame · scallop …)
//   dist: 작은 것 1.0~1.2 · 큰 것 1.5~1.7. 너무 가까우면 프레임을 넘긴다.
// ⚠️ 정적 서버가 127.0.0.1:8765에 떠 있어야 한다 (scripts/_preview-server.mjs 또는 앱).
import path from 'path';
const DIR = process.argv[2], ID = process.argv[3], D = Number(process.argv[4] || 1.7);
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 760, height: 760 }, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8765/world.html?sealab=1', { waitUntil: 'load' });
await pg.waitForTimeout(4600);
await pg.evaluate((id) => {
    const L = window.__sealab, cell = L.cellOf[id];
    const keep = L.scene.children.find((o) => o.isGroup && Math.abs(o.position.x - cell.x) < 0.01 && Math.abs(o.position.y - cell.y) < 0.01);
    for (const o of L.scene.children) if (o.isGroup && o !== keep) o.visible = false;
}, ID);
const views = [['a000', 0, 0.10], ['a045', 45, 0.10], ['a090', 90, 0.10], ['a135', 135, 0.10],
               ['a180', 180, 0.10], ['a270', 270, 0.10], ['hi30', 30, 0.55], ['top', 5, 0.92]];
for (const [tag, yaw, elev] of views) {
    await pg.evaluate((a) => { const L = window.__sealab; L.view(a.id, a.yaw, a.elev, a.d); L.renderer.render(L.scene, L.camera); }, { id: ID, yaw, elev, d: D });
    await pg.waitForTimeout(60);
    await (await pg.$('canvas')).screenshot({ path: path.join(DIR, `t-${ID}-${tag}.png`) });
}
console.log('errs:', errs.slice(0, 3));
await b.close();
