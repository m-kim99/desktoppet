// 검수 랩 항목들의 실비용 — 드로우 · 삼각형 · 재질 수.
//   node scripts/sealab-cost.mjs [id,id,...]     (생략하면 해산물 8종)
// 조형을 올릴 때마다 여기서 드로우가 1로 유지되는지 확인한다(이 월드의 예산 축은 드로우다).
const IDS = (process.argv[2] || 'oyster,starfish,urchin,seacuke,seasquirt,shrimp,octopus,wakame').split(',');
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 900, height: 600 } });
await pg.goto('http://127.0.0.1:8765/world.html?sealab=1', { waitUntil: 'load' });
await pg.waitForTimeout(4800);
console.log(JSON.stringify(await pg.evaluate((IDS) => {   // ⚠️ IDS는 브라우저 스코프로 넘겨야 한다
    const L = window.__sealab, out = {};
    const triOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const id of IDS) {
        const cell = L.cellOf[id]; if (!cell) { out[id] = 'no cell'; continue; }
        const grp = L.scene.children.find((o) => o.isGroup && Math.abs(o.position.x - cell.x) < 0.01 && Math.abs(o.position.y - cell.y) < 0.01);
        if (!grp) { out[id] = 'no group'; continue; }
        let draws = 0, tri = 0, mats = new Set(), bb = null;
        grp.traverse((o) => { if (o.isMesh) { draws++; tri += triOf(o.geometry); mats.add(o.material.uuid); o.geometry.computeBoundingBox(); } });
        out[id] = { draws, tri: Math.round(tri), mats: mats.size };
    }
    return out;
}, IDS), null, 1));
await b.close();
