// Undersea foraging diversity gate — mirrors the world.js deep-sea spawn rules (4-slot buffer · zone pools · habitats · duplicate protection ·
// same species ≤2), runs a "20-minute walk session" N times and judges the 4 acceptance criteria.
//
//   node scripts/seafood-sim.mjs                 # post-patch (current) verdict
//   node scripts/seafood-sim.mjs --mode both     # pre/post patch side by side
//   options: --runs 400 --seed 42
//
// Acceptance criteria (agreed with the user):
//   ① expected encounters in a 20-min walk (first session) ≥ 6 species   ② expected codex 8/8 completion ≤ 5 sessions
//   ③ same species picked up 3 in a row ≤ 5%                    ④ top-1 near the hydrothermal vent = shrimp, top-1 near kelp = wakame
//
// Model assumptions (static analysis of world.js — not measured):
// - One pickup per 8s × 20 min = 150 pickups per session. Spawn tick is 2.6s, so the buffer (4 slots) refills between pickups.
// - Walk context blocks of 45~90s, distribution: deep-sea plain 70% · kelp forest 15% · hydrothermal vent 10% · shipwreck 3% ·
//   nearshore ring 2% — the ring (island radius + 5m band) is passed within seconds of entering the water, so it is effectively
//   only brushed past. Values that reproduce the real-play report ("barely saw the 4 near species") = this sim's calibration basis.
// - The codex (counts) accumulates across sessions — duplicate protection (unregistered ×2.5) decays naturally as sessions go on.

const ARG = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => {
    if (!a.startsWith('--')) return [];
    const v = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
    return [[a.slice(2), v]];
}));
const RUNS = +(ARG.runs || 400);
const SEED = +(ARG.seed || 42);
const MODE = ARG.mode || 'after';

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// In sync with world.js SEAFOOD (id · zone · w)
const SEAFOOD = [
    { id: 'wakame',   ko: '미역',     zone: 'near', w: 30 },
    { id: 'starfish', ko: '불가사리', zone: 'near', w: 26 },
    { id: 'oyster',   ko: '굴',       zone: 'near', w: 18 },
    { id: 'seasquirt', ko: '멍게',    zone: 'near', w: 14 },
    { id: 'urchin',   ko: '성게',     zone: 'far',  w: 30 },
    { id: 'seacuke',  ko: '해삼',     zone: 'far',  w: 26 },
    { id: 'shrimp',   ko: '새우',     zone: 'far',  w: 18 },
    { id: 'octopus',  ko: '문어',     zone: 'far',  w: 7 },
];
const CONTEXTS = [
    { id: 'plain', share: 0.70, zone: 'far' },
    { id: 'kelp',  share: 0.15, zone: 'far' },
    { id: 'vent',  share: 0.10, zone: 'far' },
    { id: 'wreck', share: 0.03, zone: 'far' },
    { id: 'ring',  share: 0.02, zone: 'near' },
];
const PICK_SEC = 8, SESSION_SEC = 20 * 60, BLOCK_SEC = [45, 90];

function spawnPick(r, ctx, counts, live, after) {
    let pool = SEAFOOD.filter((t) => t.zone === ctx.zone);
    if (after) {
        if (ctx.id === 'kelp') pool = pool.concat(SEAFOOD.filter((t) => t.id === 'wakame' || t.id === 'seasquirt'));
        if (ctx.id === 'wreck') pool = pool.concat(SEAFOOD.filter((t) => t.id === 'oyster'));
        pool = pool.filter((t) => live.filter((x) => x === t.id).length < 2);   // Same species on screen ≤2
        if (!pool.length) pool = SEAFOOD.filter((t) => t.zone === ctx.zone);
    }
    const wOf = (t) => {
        let w = t.w;
        if (ctx.id === 'vent' && t.id === 'shrimp') w = 70;                     // Common to pre/post (existing feature)
        if (after && ctx.id === 'kelp' && t.id === 'wakame') w = 50;
        if (after && ctx.id === 'kelp' && t.id === 'seasquirt') w = 25;
        if (after && ctx.id === 'wreck' && t.id === 'oyster') w = 45;
        return w * (after && !counts[t.id] ? 2.5 : 1);                          // Duplicate protection (post only)
    };
    const total = pool.reduce((q, t) => q + wOf(t), 0);
    let x = r() * total, type = pool[0];
    for (const t of pool) { x -= wOf(t); if (x <= 0) { type = t; break; } }
    return type.id;
}

function simulate(after) {
    const r = rng(SEED);
    let firstSessionSpecies = 0, completeSessions = 0, streak3 = 0, totalPicks = 0;
    const ctxTop = { vent: {}, kelp: {} };
    for (let run = 0; run < RUNS; run++) {
        const counts = {};
        let done = 0;
        for (let sess = 1; sess <= 40; sess++) {
            const seen = new Set(Object.keys(counts));
            const startSeen = seen.size;
            let live = [], ctx = CONTEXTS[0], ctxLeft = 0, s1 = null, s2 = null;
            for (let t = 0; t < SESSION_SEC; t += PICK_SEC) {
                if (ctxLeft <= 0) {   // Walk context block switch
                    let x = r();
                    ctx = CONTEXTS.find((c) => (x -= c.share) <= 0) || CONTEXTS[0];
                    ctxLeft = BLOCK_SEC[0] + r() * (BLOCK_SEC[1] - BLOCK_SEC[0]);
                }
                ctxLeft -= PICK_SEC;
                while (live.length < 4) live.push(spawnPick(r, ctx, counts, live, after));   // Buffer refill (spawn tick is faster)
                const pick = live.splice(Math.floor(r() * live.length), 1)[0];
                counts[pick] = (counts[pick] || 0) + 1;
                seen.add(pick);
                totalPicks += 1;
                if (pick === s1 && pick === s2) streak3 += 1;
                s2 = s1; s1 = pick;
                if (ctx.id === 'vent' || ctx.id === 'kelp') ctxTop[ctx.id][pick] = (ctxTop[ctx.id][pick] || 0) + 1;
            }
            if (sess === 1) firstSessionSpecies += seen.size;
            if (!done && seen.size >= SEAFOOD.length) done = sess;
            if (done) break;
            void startSeen;
        }
        completeSessions += done || 40;
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    return {
        species20: firstSessionSpecies / RUNS,
        complete: completeSessions / RUNS,
        streak3: streak3 / totalPicks,
        ventTop: top(ctxTop.vent),
        kelpTop: top(ctxTop.kelp),
    };
}

function judge(label, s) {
    const ok = (b) => (b ? 'PASS' : '✗ FAIL');
    console.log(`\n== ${label} (${RUNS}런, 시드 ${SEED}) ==`);
    console.log(`① 첫 20분 조우 종수     ${s.species20.toFixed(2)}종  (기준 ≥6)   ${ok(s.species20 >= 6)}`);
    console.log(`② 도감 8/8 완주        ${s.complete.toFixed(2)}세션 (기준 ≤5)   ${ok(s.complete <= 5)}`);
    console.log(`③ 동일종 3연속 픽업     ${(s.streak3 * 100).toFixed(2)}%   (기준 ≤5%)  ${ok(s.streak3 <= 0.05)}`);
    console.log(`④ 서식지 개성          열수구 1위=${s.ventTop} · 켈프 1위=${s.kelpTop} (기준 shrimp·wakame)   ${ok(s.ventTop === 'shrimp' && s.kelpTop === 'wakame')}`);
    return s.species20 >= 6 && s.complete <= 5 && s.streak3 <= 0.05 && s.ventTop === 'shrimp' && s.kelpTop === 'wakame';
}

let pass = true;
if (MODE === 'both' || MODE === 'before') judge('패치 전 (존 배타 + 열수구만) — 참고용, 게이트 미포함', simulate(false));
if (MODE === 'both' || MODE === 'after') pass = judge('패치 후 (서식지 + 중복 보호 + 동일종 ≤2)', simulate(true));
process.exit(pass ? 0 : 1);
