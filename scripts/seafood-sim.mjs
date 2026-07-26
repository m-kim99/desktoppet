// 해저 채집 다양성 게이트 — world.js 심해 스폰 규칙(4슬롯 버퍼·존 풀·서식지·중복 보호·동일종
// ≤2)을 미러링해 "20분 산책 세션"을 N회 돌리고 승인 기준 4항목을 판정한다.
//
//   node scripts/seafood-sim.mjs                 # 패치 후(현행) 판정
//   node scripts/seafood-sim.mjs --mode both     # 패치 전/후 나란히
//   옵션: --runs 400 --seed 42
//
// 승인 기준 (사용자 합의):
//   ① 20분 산책(첫 세션)에서 기대 조우 ≥ 6종   ② 도감 8/8 완주 기대 ≤ 5세션
//   ③ 동일종 3연속 픽업 ≤ 5%                    ④ 열수구 곁 1위 = 새우, 켈프 곁 1위 = 미역
//
// 모델 가정 (world.js 정적 분석 — 실측 아님):
// - 픽업 8초당 1회 × 20분 = 세션당 150픽업. 스폰 틱 2.6초라 버퍼(4슬롯)는 픽업 사이에 다시 찬다.
// - 산책 컨텍스트 블록 45~90초, 분포: 심해 평지 70% · 켈프 숲 15% · 열수구 10% · 난파선 3% ·
//   근해 링 2% — 링(섬 반경+5m 띠)은 입수 직후 몇 초 만에 통과하는 동선이라 사실상 스치기만
//   한다. 실플레이 리포트("near 4종 거의 못 봄")를 재현하는 값 = 이 시뮬의 캘리브레이션 근거.
// - 도감(counts)은 세션 간 누적 — 중복 보호(미등록 ×2.5)가 세션이 갈수록 자연 감쇠.

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

// world.js SEAFOOD와 동기 (id·zone·w)
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
        pool = pool.filter((t) => live.filter((x) => x === t.id).length < 2);   // 화면 내 동일종 ≤2
        if (!pool.length) pool = SEAFOOD.filter((t) => t.zone === ctx.zone);
    }
    const wOf = (t) => {
        let w = t.w;
        if (ctx.id === 'vent' && t.id === 'shrimp') w = 70;                     // 전/후 공통 (기존 기능)
        if (after && ctx.id === 'kelp' && t.id === 'wakame') w = 50;
        if (after && ctx.id === 'kelp' && t.id === 'seasquirt') w = 25;
        if (after && ctx.id === 'wreck' && t.id === 'oyster') w = 45;
        return w * (after && !counts[t.id] ? 2.5 : 1);                          // 중복 보호 (후에만)
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
                if (ctxLeft <= 0) {   // 산책 컨텍스트 블록 전환
                    let x = r();
                    ctx = CONTEXTS.find((c) => (x -= c.share) <= 0) || CONTEXTS[0];
                    ctxLeft = BLOCK_SEC[0] + r() * (BLOCK_SEC[1] - BLOCK_SEC[0]);
                }
                ctxLeft -= PICK_SEC;
                while (live.length < 4) live.push(spawnPick(r, ctx, counts, live, after));   // 버퍼 리필 (스폰 틱이 더 빠름)
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
