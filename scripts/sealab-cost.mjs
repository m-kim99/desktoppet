// Actual cost of review lab entries — draw calls · triangles · material count.
//   node scripts/sealab-cost.mjs [id,id,...]     (defaults to the 8 seafood species)
// Every time a model goes in, confirm here that draws stay at 1 (draw calls are this world's budget axis).
const IDS = (process.argv[2] || 'oyster,starfish,urchin,seacuke,seasquirt,shrimp,octopus,wakame').split(',');
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 900, height: 600 } });
await pg.goto('http://127.0.0.1:8765/world.html?sealab=1', { waitUntil: 'load' });
await pg.waitForTimeout(4800);
console.log(JSON.stringify(await pg.evaluate((IDS) => {   // ⚠️ IDS must be passed into the browser scope
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
