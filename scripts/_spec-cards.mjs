// 임시: design/*-spec.html 을 카드별로 잘라 스크린샷 (검토용). argv[2]=html, argv[3]=outdir
import { chromium } from 'playwright';
const FILE = process.argv[2];
const OUTDIR = process.argv[3];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file://' + FILE, { waitUntil: 'load' });
await page.waitForTimeout(600);
const cards = await page.$$('.card');
const out = [];
for (let i = 0; i < cards.length; i++) {
    const id = await cards[i].$eval('.id', (el) => el.textContent.trim()).catch(() => 'card' + i);
    const p = `${OUTDIR}/spec-${String(i).padStart(2, '0')}-${id}.png`;
    await cards[i].scrollIntoViewIfNeeded();
    await cards[i].screenshot({ path: p });
    out.push(p);
}
console.log(JSON.stringify(out));
await browser.close();
