// 검수 랩 페이지 에러만 뽑는다 — 조형 코드를 고친 뒤 첫 확인용.
//   node scripts/sealab-err.mjs
// 랩이 안 뜨면(sealab: false) 대개 world.js의 문법/중복 선언 에러다. 렌더 스크립트가
// "Cannot read properties of undefined (reading 'cellOf')"로 죽으면 먼저 이걸 돌린다.
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
