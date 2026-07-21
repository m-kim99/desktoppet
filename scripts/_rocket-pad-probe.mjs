// 🚀 발사 플랫폼 후보 좌표 검증 — 페리 항로/잠수정 게이트/섬/다른 탈것/수평선과의 실간격.
// 위치를 옮길 때마다 이 스크립트로 후보를 먼저 통과시킨 뒤 world.js의 ROCKET_PAD를 바꾼다.
import { ISLAND_R, ISLANDS, FERRY_PIERS, FERRY_SEA_POINTS } from '../static/js/world-layout.js';

const PAD_R = +(process.env.PAD_R || 1.25);   // 후보 바지선 반경
const FERRY_BUF = 0.6;        // 페리 항로 회피 버퍼 (makeFerryRoute와 동일)
const HORIZON = 19.6;

const ferryBerth = (i) => {   // world.js ferryBerth 이식
    const pr = FERRY_PIERS[i];
    const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    return { x: pr.B.x + uz * 0.6, z: pr.B.z - ux * 0.6 };
};
const B0 = ferryBerth(0), B1 = ferryBerth(1);
// 페리 폐곡선 제어폴리곤: berth0 → berth1 → 외해 링 → (닫힘) berth0
const ferryLoop = [B0, B1, ...FERRY_SEA_POINTS];
function segDist(p, a, b) {
    const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2));
    return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}
function ferryMinDist(p) {
    let m = Infinity;
    for (let i = 0; i < ferryLoop.length; i++) {
        m = Math.min(m, segDist(p, ferryLoop[i], ferryLoop[(i + 1) % ferryLoop.length]));
    }
    return m;
}
const OTHER = [
    { n: 'plane', x: -3.2, z: 10.05, r: 0.75 },
    { n: 'boat', x: 2.4, z: 6.95, r: 0.6 },
    { n: 'subHome', x: -7.0, z: 14.3, r: 1.2 },
    { n: 'balloon', x: 14.0, z: 7.25, r: 0.5 },
    { n: 'ferryB0', x: B0.x, z: B0.z, r: 0.95 },
    { n: 'ferryB1', x: B1.x, z: B1.z, r: 0.95 },
];

function check(x, z) {
    const p = { x, z };
    const rows = [];
    const need = PAD_R + FERRY_BUF;
    // 페리 항로
    const fd = ferryMinDist(p);
    rows.push(['페리 항로', fd, need, fd >= need]);
    // 섬 이탈/침범 (물 위 — 섬 rim 밖 최소 0.8m 여유 권장)
    for (const isl of ISLANDS) {
        const d = Math.hypot(x - isl.x, z - isl.z) - isl.r - PAD_R;
        if (d < 2.5) rows.push([`섬(${isl.x},${isl.z})`, d + PAD_R + isl.r, isl.r + PAD_R + 0.8, d >= 0.8]);
    }
    // 다른 탈것
    for (const o of OTHER) {
        const d = Math.hypot(x - o.x, z - o.z);
        const lim = PAD_R + o.r + 0.5;
        if (d < lim + 2) rows.push([o.n, d, lim, d >= lim]);
    }
    // 수평선
    const rr = Math.hypot(x, z);
    rows.push(['수평선', rr, HORIZON - PAD_R, rr <= HORIZON - PAD_R]);
    const ok = rows.every((r) => r[3]);
    console.log(`\n=== (${x}, ${z})  r${PAD_R} → ${ok ? '✅ PASS' : '❌ FAIL'} ===`);
    for (const [name, val, lim, pass] of rows) {
        console.log(`  ${pass ? '✓' : '✗'} ${name.padEnd(16)} ${(+val).toFixed(2)}  (기준 ${typeof lim === 'number' ? lim.toFixed(2) : lim})`);
    }
    return ok;
}

const cands = process.argv.slice(2).map((s) => s.split(',').map(Number));
if (cands.length === 0) {
    // 기본 후보 스윕
    for (const [x, z] of [[2.5, 11.5], [3.0, 13.0], [4.5, 10.5], [1.5, -9.0], [0, -9.5], [3.5, -8.5], [-1.0, -9.0], [6.5, 9.5]]) check(x, z);
} else {
    for (const [x, z] of cands) check(x, z);
}
