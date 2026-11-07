// Full layout check — ① passage clearance between props ② off-island ③ road intrusion ④ house footprint ⑤ bridge geometry
import { ISLAND_R, ISLANDS, BRIDGES, HILLS, HOUSE, FLAT_SPOTS, PROPS, FERRY_PIERS, FERRY_SEA_POINTS } from '../static/js/world-layout.js';

let bad = 0;
const warn = (s) => { console.log('  ✗ ' + s); bad++; };
const CLEAR = 0.5;    // Minimum clearance for a pet to pass between two props
const LAMP_CLEAR = 0.3;   // Street lamp posts are thin
// Visual footprint (correction for types larger than their collider)
const VIS = { garden: 1.0, coffee: 0.62, food: 0.62, library: 0.8, piano: 0.5, fountain: 0.72, photoboard: 0.45, fence: 0.72, hammock: 0.8, swing: 0.62, seesaw: 0.7, gym: 1.05, trampoline: 0.77, vine: 0.32, fruitbasket: 0.26, pecktree: 0.6, well: 0.62, capsule: 0.4, monument: 0.5, cave: 1.0, lookout: 1.0, sunbed: 0.55, palm: 0.5, sandcastle: 0.45, tree: 0.5, boulder: 0.55, house: 2.4, pond: 0.95, mailbox: 0.22, radio: 0.3, bowl: 0.3, lamp: 0.2, flowerbasket: 0.25, hugspot: 0.3, digsite: 0.7, portal: 0.45, car: 0.72, boat: 0.6, plane: 0.75, balloon: 0.8, ferry: 0.95, pier: 0.3, rocketpad: 2.05, bonfire: 0.42, kitchen: 0.62, icebox: 0.3, scarecrow: 0.28, compost: 0.32 };   // The kitchen deck is walkable floor — its obstacle vis matches the booth family (counter depth, long axis tangent to the road)
const vOf = (p) => Math.max(p.r || 0.2, VIS[p.type] ?? 0.4);
// User-finalized layout (locked in construction mode, 2026-07-17) — exempt from pair/road/rim rules. The rules still apply to newly added props.
const PINNED = new Set(["-0.508,3.523", "-1.682,4.923", "-1.771,1.903", "-10.782,-4.548", "-12.369,-3.32", "-2.455,-5.249", "-2.832,4.708", "-2.884,0.803", "-3.668,2.599", "-3.857,4.222", "-3.869,1.411", "-4.881,2.914", "-4.99,-0.57", "-8.97,-5.203", "-9.609,-6.876", "0.521,4.73", "0.882,4.086", "1.586,-5.57", "11.136,2.463", "2.5,-1.15", "2.825,2.131", "3.4,-4.532", "3.42,4.305", "4.98,-2.06", "5.11,-0.213", "5.191,1.315", "9.547,8.597"]);
const isPinned = (p) => PINNED.has(`${p.x},${p.z}`);
const ALL = [...PROPS, { type: 'car', x: 2.5, z: -1.15, r: 0.5 }, { type: 'plane', x: -3.2, z: 10.05, r: 0.55 }, { type: 'balloon', x: 14.0, z: 7.25, r: 0.5 },
    { type: 'ferry', x: 0.94, z: 7.77, r: 0.9, water: true }, { type: 'pier', x: FERRY_PIERS[0].B.x, z: FERRY_PIERS[0].B.z, r: 0.3, water: true }, { type: 'pier', x: FERRY_PIERS[1].B.x, z: FERRY_PIERS[1].B.z, r: 0.3, water: true },
    { type: 'boat', x: 2.4, z: 6.95, r: 0.5, water: true },
    { type: 'rocketpad', x: 2, z: -9.5, r: 2.05, water: true }];   // 🚀 Launch pad (in sync with world.js ROCKET_PAD — move both when relocating)
const hillSet = new Set(['boulder', 'lookout', 'cave', 'digsite']);
// The house is a rectangle (hw×hd×k + porch) — circle-vis pairing over-blocks the corners. Local rectangle + the other's vis margin.
const HOUSE_RECT = { x: 3.42, z: 4.305, rotY: -2.22, hw: 1.3, hd: 1.04, k: 1.2, porch: 0.5 };
function houseRectClear(q, vq) {
    const c = Math.cos(HOUSE_RECT.rotY), sn = Math.sin(HOUSE_RECT.rotY);
    const dx = q.x - HOUSE_RECT.x, dz = q.z - HOUSE_RECT.z;
    const lx = (dx * c - dz * sn) / HOUSE_RECT.k, lz = (dx * sn + dz * c) / HOUSE_RECT.k;
    const m = (vq + 0.5) / HOUSE_RECT.k;
    return Math.abs(lx) > HOUSE_RECT.hw + m || lz < -(HOUSE_RECT.hd + m) || lz > HOUSE_RECT.hd + HOUSE_RECT.porch + m;
}
const exempt = (a, b) => {
    if (a.type === 'hugspot' || b.type === 'hugspot') return true;
    if (hillSet.has(a.type) && hillSet.has(b.type)) return true;              // Hill dressing set
    if ((a.type === 'portal' && b.type === 'cave') || (a.type === 'cave' && b.type === 'portal')) return true;
    if ((a.type === 'plane' && b.type === 'sandcastle') || (a.type === 'sandcastle' && b.type === 'plane')) return true;   // Beach neighbor set (tail-to-castle actual gap 0.4 confirmed)
    const marine = new Set(['ferry', 'pier', 'boat']);
    if (marine.has(a.type) && marine.has(b.type)) return true;   // Offshore neighbor set — berth · pier · boat (actual gaps eyeballed and OK)
    const yard = new Set(['bowl', 'radio', 'lamp', 'mailbox', 'fruitbasket']);
    if ((a.type === 'house' && yard.has(b.type)) || (b.type === 'house' && yard.has(a.type))) return true;   // Yard set + yard path street lamp
    return false;
};

console.log('== ① 소품 페어 통로 여유 ==');
for (let i = 0; i < ALL.length; i++) for (let j = i + 1; j < ALL.length; j++) {
    const a = ALL[i], b = ALL[j];
    if (exempt(a, b) || isPinned(a) || isPinned(b)) continue;
    if (a.type === 'house' || b.type === 'house') {   // House = rectangular footprint check
        const q = a.type === 'house' ? b : a;
        if (!houseRectClear(q, vOf(q))) warn(`house ↔ ${q.type}(${q.x},${q.z}) 풋프린트 여백 부족`);
        continue;
    }
    const gap = Math.hypot(a.x - b.x, a.z - b.z) - vOf(a) - vOf(b);
    const lim = (a.type === 'tree' && b.type === 'tree') ? 0.15   // Trees can cluster together as a grove and still look natural
        : (a.type === 'lamp' || b.type === 'lamp') ? LAMP_CLEAR : CLEAR;
    if (gap < lim) warn(`${a.type}(${a.x},${a.z}) ↔ ${b.type}(${b.x},${b.z}): ${gap.toFixed(2)}m (< ${lim})`);
}

console.log('== ② 섬 이탈 (시각 반경 절반까지 림 안) ==');
const islandFor = (x, z) => {
    let best = -1, bd = 1e9;
    ISLANDS.forEach((il, i) => { const d = Math.hypot(x - il.x, z - il.z); if (d < bd) { bd = d; best = i; } });
    return { i: best, d: bd };
};
for (const p of ALL) {
    if (p.water || isPinned(p)) continue;   // User-finalized layout is exempt from the rim rule too (edge placement = intended)
    const { i, d } = islandFor(p.x, p.z);
    if (p.type === 'plane') { if (d > ISLANDS[i].r - 0.5) warn(`plane 섬 이탈 d ${d.toFixed(2)}`); continue; }   // Parking on the beach slope allowed
    if (p.type === 'balloon') { if (d > ISLANDS[i].r - 0.5) warn(`balloon 섬 이탈 d ${d.toFixed(2)}`); continue; }   // The mooring is a rim deck
    if (d + vOf(p) * 0.5 > ISLANDS[i].r - 0.3) warn(`${p.type}(${p.x},${p.z}) 섬${i} 림 초과: d ${d.toFixed(2)} + vis/2 ${(vOf(p) * 0.5).toFixed(2)} > ${(ISLANDS[i].r - 0.3).toFixed(2)}`);
}
for (const s of FLAT_SPOTS) {
    const { i, d } = islandFor(s.x, s.z);
    if (d > ISLANDS[i].r - 0.1) warn(`패드(${s.x},${s.z}) 섬${i} 중심 이탈`);
}

console.log('== ③ 본섬 도로 침범 (루프 r3.6 w0.55 · 스포크 t1.25~3.4 · 광장 r1.45) ==');
const ROAD_LOOP_R = 3.6, ROAD_W = 0.55, PLAZA_R = 1.45, SPOKES = [0.92, 3.6];
for (const p of ALL) {
    if (Math.hypot(p.x, p.z) > 6.3 || ['hugspot', 'portal', 'boat', 'car', 'house', 'lamp', 'pond'].includes(p.type) || isPinned(p)) continue;   // The pondside road is intended scenery + user-finalized layout
    if (p.type === 'fountain' && Math.hypot(p.x, p.z) < 0.2) continue;   // Fountain at the exact plaza center = centerpiece
    const trunk = (p.type === 'tree') ? 0.3 : Math.min(vOf(p), 0.75);   // Roadside trees are OK as long as the trunk is off the road (canopy overhang allowed)
    const rr = Math.hypot(p.x, p.z);
    const need = ROAD_W / 2 + 0.1 + trunk;
    if (Math.abs(rr - ROAD_LOOP_R) < need) warn(`${p.type}(${p.x},${p.z}) 루프길 침범 (|r-3.6|=${Math.abs(rr - 3.6).toFixed(2)} < ${need.toFixed(2)})`);
    if (rr < PLAZA_R + trunk + 0.05) warn(`${p.type}(${p.x},${p.z}) 광장 침범`);
    for (const a of SPOKES) {
        const dx = Math.sin(a), dz = Math.cos(a);
        const t = p.x * dx + p.z * dz;
        if (t < PLAZA_R - 0.2 || t > 3.4) continue;
        const perp = Math.hypot(p.x - dx * t, p.z - dz * t);
        if (perp < need) warn(`${p.type}(${p.x},${p.z}) 스포크(${a}) 침범 (perp ${perp.toFixed(2)} < ${need.toFixed(2)})`);
    }
}

console.log('== ④ 집 풋프린트 (벽 rect + 여유) ==');
const cs = Math.cos(-HOUSE.rotY), sn = Math.sin(-HOUSE.rotY);
for (const p of ALL) {
    if (['house', 'bowl', 'boat', 'radio', 'lamp', 'pond'].includes(p.type) || isPinned(p)) continue;   // Yard set · lamp posts + pond (waterline 0.76 is outside the road's outer edge 3.875 — geometry verified, pondside path design)
    const dx = p.x - HOUSE.x, dz = p.z - HOUSE.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const m = Math.min(vOf(p), 0.6) + 0.3;
    if (Math.abs(lx) < HOUSE.hw + m && Math.abs(lz) < HOUSE.hd + m) warn(`${p.type}(${p.x},${p.z}) 집 벽 근접 (local ${lx.toFixed(2)},${lz.toFixed(2)})`);
}

console.log('== ⑤ 섬 간격 + 다리 기하 ==');
const names = ['본섬', 'NE', 'SW', 'SE', '모래', '농장', '동산'];
for (let i = 0; i < ISLANDS.length; i++) for (let j = i + 1; j < ISLANDS.length; j++) {
    const a = ISLANDS[i], b = ISLANDS[j];
    const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
    if (i === 0) console.log(`  ${names[i]}↔${names[j]}: ${gap.toFixed(2)}m`);
    if (i === 0 && j <= 3 && (gap < 2.0 || gap > 4.0)) warn(`본섬↔${names[j]} 간격 ${gap.toFixed(2)} — 목표 2.0~4.0`);
    if (gap < 1.5) warn(`${names[i]}↔${names[j]} 간격 ${gap.toFixed(2)} < 1.5`);
}
BRIDGES.forEach((br, i) => {
    if (!br) { console.log(`  다리${i + 1}(${names[i + 1]}): 없음(보트/수영 전용)`); return; }
    const sat = ISLANDS[i + 1];
    const dA = Math.hypot(br.A.x, br.A.z);
    const dB = Math.hypot(br.B.x - sat.x, br.B.z - sat.z);
    const span = Math.hypot(br.B.x - br.A.x, br.B.z - br.A.z);
    console.log(`  다리${i + 1}(${names[i + 1]}): A@본섬r${dA.toFixed(2)} B@위성r${dB.toFixed(2)} 스팬 ${span.toFixed(2)}m`);
    if (dA > ISLAND_R - 0.3) warn(`다리${i + 1} A가 본섬 밖`);
    if (dB > sat.r - 0.3) warn(`다리${i + 1} B가 위성섬 밖`);
    if (Math.hypot(br.inner.x, br.inner.z) > ISLAND_R - 0.25) warn(`다리${i + 1} inner가 뭍 밖`);
    if (Math.hypot(br.outer.x - sat.x, br.outer.z - sat.z) > sat.r - 0.25) warn(`다리${i + 1} outer가 뭍 밖`);
    const un = Math.hypot(sat.x, sat.z);
    const u = { x: sat.x / un, z: sat.z / un };
    const offA = Math.abs(br.A.x * u.z - br.A.z * u.x);
    const offB = Math.abs((br.B.x - sat.x) * u.z - (br.B.z - sat.z) * u.x);
    if (offA > 0.05 || offB > 0.05) warn(`다리${i + 1} 방사축 이탈 A${offA.toFixed(3)} B${offB.toFixed(3)}`);
    // Traffic around bridge heads: no blocking props within radius 0.5 of the outer/inner nodes
    for (const nd of [br.inner, br.outer]) for (const p of ALL) {
        if (!p.r || p.type === 'boat') continue;
        const g = Math.hypot(p.x - nd.x, p.z - nd.z) - p.r;
        if (g < 0.35) warn(`다리${i + 1} 노드(${nd.x},${nd.z}) 옆 ${p.type} 근접 ${g.toFixed(2)}`);
    }
});
// HILLS · cave pad · lookout alignment (one unified set)
const hill = HILLS[0];
const lookout = PROPS.find((p) => p.type === 'lookout');
const cave = PROPS.find((p) => p.type === 'cave');
const cavePad = FLAT_SPOTS.find((s) => Math.hypot(s.x - cave.x, s.z - cave.z) < 0.01);
if (Math.hypot(hill.x - lookout.x, hill.z - lookout.z) > 0.01) warn('전망대가 언덕 정상에서 벗어남');
if (!cavePad) warn('동굴 평탄 패드가 동굴 좌표와 불일치');
// ⛴️ Ferry route validity: pier end and berth are in open water + fallback ring segments do not cross islands
{
    const berth = (i) => {
        const pr = FERRY_PIERS[i];
        const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z, L = Math.hypot(dx, dz);
        return { x: pr.B.x + (dz / L) * 0.6, z: pr.B.z - (dx / L) * 0.6 };
    };
    const b0 = berth(0), b1 = berth(1);
    for (const [nm, pt] of [['선석0', b0], ['선석1', b1], ['잔교0끝', FERRY_PIERS[0].B], ['잔교1끝', FERRY_PIERS[1].B]]) {
        for (const il of ISLANDS) if (Math.hypot(pt.x - il.x, pt.z - il.z) < il.r + 0.15) warn(`페리 ${nm}이 섬과 겹침`);
    }
    const lane = [b0, b1, ...FERRY_SEA_POINTS, b0];
    for (let i = 0; i < lane.length - 1; i++) {
        const A = lane[i], B = lane[i + 1];
        const margin = (i <= 1 || i === lane.length - 2) ? 0.55 : 1.0;   // Legs adjacent to the berth are slow straight lines — relaxed
        for (let k = 0; k <= 20; k++) {
            const x = A.x + (B.x - A.x) * (k / 20), z = A.z + (B.z - A.z) * (k / 20);
            if (Math.hypot(x, z) > 19.6) { warn(`페리 링 세그먼트 ${i} 수평선 이탈`); break; }
            let bad = false;
            for (const il of ISLANDS) if (Math.hypot(x - il.x, z - il.z) < il.r + margin) bad = true;   // Curve convexity margin
            for (const br of BRIDGES) {
                if (!br) continue;
                const bdx = br.B.x - br.A.x, bdz = br.B.z - br.A.z, l2 = bdx * bdx + bdz * bdz;
                const tt = Math.max(0, Math.min(1, ((x - br.A.x) * bdx + (z - br.A.z) * bdz) / l2));
                if (Math.hypot(br.A.x + bdx * tt - x, br.A.z + bdz * tt - z) < 1.35) bad = true;
            }
            if (bad) { warn(`페리 링 세그먼트 ${i} (${A.x},${A.z})→(${B.x},${B.z}) 섬/다리 간섭`); break; }
        }
    }
}
// SWIM_LEASH / sea radius
for (let i = 1; i < ISLANDS.length; i++) {
    const il = ISLANDS[i];
    const ext = Math.hypot(il.x, il.z) + il.r;
    if (ext > 17) warn(`${names[i]} 외곽 ${ext.toFixed(1)} — SWIM_LEASH 18 여유 부족`);
}
console.log(bad ? `\n결과: 위반 ${bad}건` : '\n결과: ✓ 전수검사 통과');
process.exit(bad ? 1 : 0);
