// Extracts only the review lab page errors — first check after editing model code.
//   node scripts/sealab-err.mjs
// If the lab does not come up (sealab: false), it is usually a syntax / duplicate declaration error in world.js. When the render script
// dies with "Cannot read properties of undefined (reading 'cellOf')", run this first.
const { chromium } = await import('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(String(e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
await pg.goto('http://127.0.0.1:8765/world.html?sealab=1', { waitUntil: 'load' });
await pg.waitForTimeout(5000);
console.log(errs.slice(0, 6).join('\n---\n') || 'no errors');
console.log('sealab:', await pg.evaluate(() => !!window.__sealab));
await b.close();
