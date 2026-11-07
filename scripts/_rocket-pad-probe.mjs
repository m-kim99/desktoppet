// 🚀 Launch pad candidate coordinate check — actual clearance from the ferry route / submarine gate / islands / other vehicles / horizon.
// Whenever the position moves, pass the candidate through this script first, then change ROCKET_PAD in world.js.
import { ISLAND_R, ISLANDS, FERRY_PIERS, FERRY_SEA_POINTS } from '../static/js/world-layout.js';

const PAD_R = +(process.env.PAD_R || 1.25);   // Candidate barge radius
const FERRY_BUF = 0.6;        // Ferry route avoidance buffer (same as makeFerryRoute)
const HORIZON = 19.6;

const ferryBerth = (i) => {   // Ported from world.js ferryBerth
    const pr = FERRY_PIERS[i];
    const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    return { x: pr.B.x + uz * 0.6, z: pr.B.z - ux * 0.6 };
};
const B0 = ferryBerth(0), B1 = ferryBerth(1);
// Ferry closed-loop control polygon: berth0 → berth1 → open-sea ring → (closed) berth0
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
    // Ferry route
    const fd = ferryMinDist(p);
    rows.push(['페리 항로', fd, need, fd >= need]);
    // Island overlap/intrusion (over water — at least 0.8m clearance outside the island rim recommended)
    for (const isl of ISLANDS) {
        const d = Math.hypot(x - isl.x, z - isl.z) - isl.r - PAD_R;
        if (d < 2.5) rows.push([`섬(${isl.x},${isl.z})`, d + PAD_R + isl.r, isl.r + PAD_R + 0.8, d >= 0.8]);
    }
    // Other vehicles
    for (const o of OTHER) {
        const d = Math.hypot(x - o.x, z - o.z);
        const lim = PAD_R + o.r + 0.5;
        if (d < lim + 2) rows.push([o.n, d, lim, d >= lim]);
    }
    // Horizon
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
    // Default candidate sweep
    for (const [x, z] of [[2.5, 11.5], [3.0, 13.0], [4.5, 10.5], [1.5, -9.0], [0, -9.5], [3.5, -8.5], [-1.0, -9.0], [6.5, 9.5]]) check(x, z);
} else {
    for (const [x, z] of cands) check(x, z);
}
